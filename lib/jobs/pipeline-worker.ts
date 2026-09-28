/**
 * Checkpoint 8 (claude/v1-launch-hardening): the real-queue migration.
 *
 * Shared "enqueue durably, then process in THIS process" driver used by
 * both lib/claims/evidence/queue.ts and lib/rag/processing-queue.ts,
 * replacing the in-memory-only promise chain each used to run its own copy
 * of with a persisted background_jobs row around every real attempt:
 * idempotency-keyed enqueue (a retried upload request can never
 * double-process the same document), an actual claimed/CAS-guarded lease
 * while the work runs, attempt-count-bounded retry classification on
 * failure via failJob(), and a durable audit trail
 * (background_job_audit_log) -- none of which the old in-memory chain had.
 *
 * Still a single-process worker: the same process that enqueues
 * immediately claims and runs the job, synchronously, inside its own
 * chained promise (that per-process serialization -- never two jobs of the
 * SAME job type running concurrently in one process -- is unchanged from
 * before this module existed, and stays the caller's responsibility, since
 * the underlying pipelines were never proven safe for concurrent
 * execution). This is a deliberately incremental step: it gives every
 * existing call site the durable job MODEL without changing the
 * deployment topology to a distributed worker fleet pulling from the
 * queue, which is a separate, larger change (see scripts/launch-check.ts's
 * background_job_reliability note on what remains after this).
 *
 * Concurrency across MULTIPLE processes/instances is a genuine, free
 * improvement this migration brings even without a worker fleet: two
 * instances racing to process the SAME document now share one
 * idempotency-keyed background_jobs row and FOR UPDATE SKIP LOCKED
 * claiming, so at most one of them actually runs processClaimEvidence()/
 * processPolicy() for it -- the old in-memory chain gave zero protection
 * across instances at all.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";
import { classifyError } from "@/lib/telemetry/errors";
import { enqueueJob, claimNextJob, completeJob, failJob, type ErrorCategory, type BackgroundJobRow } from "./queue";

const TERMINAL_STATUSES: BackgroundJobRow["status"][] = ["succeeded", "dead_letter", "cancelled"];

/** Heuristic, deliberately conservative: only a small, well-understood set
 * of transient-looking signatures (rate limits, network resets/timeouts)
 * is classified as retryable; everything else defaults to non_retryable so
 * a permanently-malformed input (a missing file, a corrupt PDF) is
 * dead-lettered immediately rather than silently burning through
 * DEFAULT_MAX_ATTEMPTS retries and 15+ minutes of accumulated backoff for
 * an error that will never stop happening. */
export function classifyPipelineError(error: unknown): ErrorCategory {
  const message = error instanceof Error ? error.message : String(error);
  // V1.1: an exhausted provider quota, a billing stop or DearPolicy's own
  // spend cap will not clear on a retry minutes later -- fail cleanly and
  // promptly instead of burning attempts. Checked first so a quota error
  // that also says "429" is not retried.
  if (/insufficient_quota|quota|billing|spend.?cap|SpendCapReached/i.test(message)
    || (error instanceof Error && error.constructor?.name === "SpendCapReached")) return "non_retryable";
  return /\b429\b|rate.?limit|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|timeout|timed out|\b50[0234]\b|overloaded|temporarily unavailable|service unavailable/i.test(message)
    ? "transient"
    : "non_retryable";
}

/** Runs `work()` under the durable job framework for one (jobType,
 * idempotencyKey): enqueues (idempotent -- a repeat call for a job already
 * terminal is a no-op, never reprocessing finished work), claims it in
 * THIS process, and completes/fails it through lib/jobs/queue.ts around
 * the real work. If claiming does not return THIS call's own row (because
 * it is already 'processing' under another claim, or was raced by a
 * concurrent caller), this call returns without running `work()` at all --
 * the job is not lost, it is simply being handled by whichever call
 * actually holds its lease. Re-throws whatever `work()` threw after
 * recording the durable failure, so a caller's existing catch/logging
 * behavior around the old in-memory chain keeps working unchanged. */
export async function runAsDurableJob(params: {
  jobType: string;
  idempotencyKey: string;
  accountId?: string | null;
  payload?: unknown;
  correlationId?: string | null;
  work: () => Promise<unknown>;
}): Promise<void> {
  const workerId = randomUUID();
  const { row } = await enqueueJob(pool, {
    jobType: params.jobType,
    idempotencyKey: params.idempotencyKey,
    payload: params.payload ?? {},
    accountId: params.accountId ?? null,
    correlationId: params.correlationId ?? null,
  });
  if (TERMINAL_STATUSES.includes(row.status)) return;

  const claimed = await claimNextJob(pool, { jobType: params.jobType, workerId });
  if (!claimed || claimed.id !== row.id) return;

  try {
    await params.work();
    await completeJob(pool, { jobId: claimed.id, workerId });
  } catch (error) {
    // D22 (Wave 2 adversarial audit): failJob() PERSISTS errorMessage into
    // background_jobs / background_job_audit_log, which a durable-job
    // debugging UI, an export, or a support tool could later surface --
    // the raw error.message (previously used here) is exactly the kind of
    // unredacted exception text this codebase's telemetry checkpoint
    // (lib/telemetry/redact.ts, lib/telemetry/errors.ts) exists to keep
    // out of anything that isn't purely server-side application logs.
    // classifyError()'s safeMessage is the fixed, taxonomy-level text
    // instead. classifyPipelineError(error) just below still runs against
    // the REAL, unredacted error object for its retry-category decision
    // (transient vs non_retryable) -- only what gets PERSISTED as
    // errorMessage changes here, never the retry logic itself.
    const safeMessage = classifyError(error).safeMessage;
    try {
      await failJob(pool, { jobId: claimed.id, workerId, errorCategory: classifyPipelineError(error), errorMessage: safeMessage.slice(0, 2000) });
    } catch (failError) {
      console.error(`runAsDurableJob(${params.jobType}): failed to record job failure for ${claimed.id}:`, failError instanceof Error ? failError.message : failError);
    }
    throw error;
  }
}
