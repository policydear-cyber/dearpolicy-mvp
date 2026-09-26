/**
 * Bounded, durable, fail-closed automatic retry of a malware scan that did
 * not complete for a TRANSIENT reason (lib/scanning/adapter.ts's
 * ScanRetryHint: provider rate limit/quota, provider timeout, temporary
 * provider failure, analysis still pending).
 *
 * - Durable: every retry is a background_jobs row (lib/jobs/queue.ts), run
 *   by the standalone worker, never an in-memory timer.
 * - Bounded: at most MAX_SCAN_RETRY_ATTEMPTS automatic retries per document,
 *   with exponential backoff capped at SCAN_RETRY_MAX_DELAY_MS. The provider's
 *   own retry metadata (Retry-After) is respected when it sends any; a rate
 *   limit without metadata waits a conservative SCAN_RETRY_RATE_LIMIT_FLOOR_MS
 *   -- quota-reset timing is never guessed.
 * - Idempotent: attempt N for a document has the fixed idempotency key
 *   `<type>:<id>:scan-retry:<N>`, so duplicate Cron/worker invocations can
 *   never double-schedule or double-run it.
 * - Fail closed: a retry only ever re-runs the SAME quarantine gate; nothing
 *   is released unless that gate records a real clean verdict. An infected
 *   verdict is terminal. A deleted or superseded document is never retried.
 *   After the last attempt the job is dead-lettered (visible to operators
 *   through lib/jobs/dead-letter.ts) and the document stays on hold with a
 *   fixed, safe message -- no provider text ever reaches a household-readable
 *   column or a job payload.
 * - No hint, no retry: "no scanner configured" and adapter misconfiguration
 *   carry no ScanRetryHint and are never retried automatically.
 */
import { pool } from "@/lib/db/client";
import { enqueueJob } from "@/lib/jobs/queue";
import type { ScanRetryHint } from "./adapter";

export const SCAN_RETRY_JOB_TYPE = "document_scan_retry";
export const MAX_SCAN_RETRY_ATTEMPTS = 6;
export const SCAN_RETRY_BASE_DELAY_MS = 2 * 60 * 1000;
export const SCAN_RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;
export const SCAN_RETRY_RATE_LIMIT_FLOOR_MS = 60 * 60 * 1000;
export const SCAN_RETRY_PROVIDER_MAX_WAIT_MS = 24 * 60 * 60 * 1000;
/** Job-level attempts for infrastructure errors while running one retry
 * (a database hiccup) -- separate from, and not counted as, scan attempts. */
export const SCAN_RETRY_JOB_MAX_ATTEMPTS = 3;

export const SCAN_RETRY_SCHEDULED_MESSAGE = "The malware scan could not be completed yet. DearPolicy will try again automatically; the document stays on hold until then.";
export const SCAN_RETRY_EXHAUSTED_MESSAGE = "The malware scan could not be completed after several automatic attempts. The document stays on hold; use Re-analyse to try again.";
export const SCAN_RETRY_EXHAUSTED_ERROR = "SCAN_RETRY_EXHAUSTED: automatic scan attempts used up; document kept on hold";

export type ScanRetryResourceType = "policy_document" | "claim_evidence";
export type ScanRetryPayload = { resourceType: ScanRetryResourceType; resourceId: string; attempt: number; reason: ScanRetryHint["reason"] };

type DbClient = { query: typeof pool.query };

/** Delay before retry attempt `attempt` (1-based). Deterministic. */
export function computeScanRetryDelayMs(attempt: number, hint: ScanRetryHint): number {
  const n = Math.max(1, Math.floor(attempt));
  let delay = Math.min(SCAN_RETRY_BASE_DELAY_MS * 2 ** (n - 1), SCAN_RETRY_MAX_DELAY_MS);
  if (hint.reason === "rate_limited") delay = Math.max(delay, SCAN_RETRY_RATE_LIMIT_FLOOR_MS);
  const providerSeconds = typeof hint.retryAfterSeconds === "number" && Number.isFinite(hint.retryAfterSeconds) && hint.retryAfterSeconds > 0 ? hint.retryAfterSeconds : null;
  if (providerSeconds != null) delay = Math.max(delay, Math.min(providerSeconds * 1000, SCAN_RETRY_PROVIDER_MAX_WAIT_MS));
  return delay;
}

export function scanRetryKey(resourceType: ScanRetryResourceType, resourceId: string, attempt: number) {
  return `${resourceType}:${resourceId}:scan-retry:${attempt}`;
}

/** How many automatic retries have already been scheduled for a document. */
export async function countScanRetries(resourceType: ScanRetryResourceType, resourceId: string, db: DbClient = pool): Promise<number> {
  const prefix = `${resourceType}:${resourceId}:scan-retry:`;
  const result = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM background_jobs WHERE job_type=$1 AND left(idempotency_key, $3)=$2`,
    [SCAN_RETRY_JOB_TYPE, prefix, prefix.length],
  );
  return Number(result.rows[0]?.n ?? 0);
}

export type ScheduleScanRetryOutcome =
  | { scheduled: true; attempt: number; availableAt: Date; created: boolean }
  | { scheduled: false; exhausted: true; attempts: number };

/** Schedules the next automatic retry for a document whose scan ended with a
 * transient ScanRetryHint. Idempotent per attempt number; refuses beyond
 * MAX_SCAN_RETRY_ATTEMPTS. The payload carries only ids, the attempt number
 * and the classified reason -- never provider text. */
export async function scheduleScanRetry(args: {
  accountId: string; resourceType: ScanRetryResourceType; resourceId: string; hint: ScanRetryHint; now?: Date; db?: DbClient;
}): Promise<ScheduleScanRetryOutcome> {
  const db = args.db ?? pool;
  const done = await countScanRetries(args.resourceType, args.resourceId, db);
  if (done >= MAX_SCAN_RETRY_ATTEMPTS) return { scheduled: false, exhausted: true, attempts: done };
  const attempt = done + 1;
  const availableAt = new Date((args.now ?? new Date()).getTime() + computeScanRetryDelayMs(attempt, args.hint));
  const payload: ScanRetryPayload = { resourceType: args.resourceType, resourceId: args.resourceId, attempt, reason: args.hint.reason };
  const { row, created } = await enqueueJob(db, {
    jobType: SCAN_RETRY_JOB_TYPE, idempotencyKey: scanRetryKey(args.resourceType, args.resourceId, attempt),
    accountId: args.accountId, payload, maxAttempts: SCAN_RETRY_JOB_MAX_ATTEMPTS, availableAt,
  });
  return { scheduled: true, attempt, availableAt: new Date(row.available_at), created };
}

export function isScanRetryPayload(value: unknown): value is ScanRetryPayload {
  const v = value as Partial<ScanRetryPayload> | null;
  return !!v && (v.resourceType === "policy_document" || v.resourceType === "claim_evidence")
    && typeof v.resourceId === "string" && v.resourceId.length > 0
    && typeof v.attempt === "number" && Number.isInteger(v.attempt) && v.attempt >= 1 && v.attempt <= MAX_SCAN_RETRY_ATTEMPTS;
}
