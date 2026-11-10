/** Background work goes on without anyone opening the app (DC, 10 Nov). On Vercel Hobby the Cron runs once a day, and the
 * request drain (request-drain.ts) runs only while someone uses the app, so a long policy's table reading whose first run
 * ended with the rest queued (benefit-table/table-reading-job.ts) waited for the next visit or 03:00Z.
 *
 * When work is queued and due soon, the function that left it sends ONE authenticated POST to this deployment's own job
 * runner (JOB_RUNNER_PATH, `Authorization: Bearer <CRON_SECRET>`, the same check the daily Cron passes). That route answers
 * at once and, after its response, in a function with its own time limit:
 *   1. waits, inside its own time, for the next job when it is due within a few minutes;
 *   2. runs one batch through runJobBatch (the same claim, lease, heartbeat, retry and dead-letter rules as every runner);
 *   3. sends the next POST when work is still due soon: a chain, one link at a time.
 * Bounds:
 * - only work due within KICK_HORIZON_MS starts a chain; later work (a reading waiting hours after failed runs) is left to
 *   the drain and the daily Cron;
 * - a link that waited for a job and then found nothing to claim (another runner took it) ends its chain, so chains never
 *   pile up; a chain also ends after MAX_KICK_HOPS links;
 * - a function starts at most one chain per KICK_MIN_INTERVAL_MS;
 * - the address is this deployment's own (VERCEL_PROJECT_PRODUCTION_URL in production, VERCEL_URL elsewhere), never one
 *   taken from a request; off Vercel, or with no CRON_SECRET, or with JOB_DRAIN_ON_REQUEST off, nothing is sent.
 * Never throws; logs an error class only. */
import { pool } from "@/lib/db/client";
import { MIN_CRON_SECRET_LENGTH } from "@/lib/launch/guards";
import { JOB_RUNNER_PATH, runJobBatch, type JobBatchSummary } from "./cron-runner";
import { FUNCTION_LIMIT_MS } from "./function-time";
import type { WorkerJobTypeConfig } from "./worker-runtime";

export const KICK_HOP_HEADER = "x-dearpolicy-kick-hop";
/** Work due within this long starts (or keeps) a chain. */
export const KICK_HORIZON_MS = 15 * 60_000;
export const MAX_KICK_HOPS = 40;
export const KICK_MIN_INTERVAL_MS = 15_000;
/** A link waits for the next job only while this much of its function's time is left for the batch. */
const BATCH_RESERVE_MS = 200_000;
const KICK_TIMEOUT_MS = 10_000;

const drainOn = (env: NodeJS.ProcessEnv) => !/^(0|false|off|no)$/i.test(env.JOB_DRAIN_ON_REQUEST?.trim() ?? "");

/** This deployment's own job-runner address, or null off Vercel. */
export function kickUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.VERCEL) return null;
  const host = ((env.VERCEL_ENV === "production" ? env.VERCEL_PROJECT_PRODUCTION_URL : "") || env.VERCEL_URL || "").trim()
    .replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host || /[\s/?#@]/.test(host)) return null;
  return `https://${host}${JOB_RUNNER_PATH}`;
}

/** Milliseconds until the soonest queued job is due (0: due now, or a lease has expired), or null when none is due within
 * KICK_HORIZON_MS. */
export async function nextDueInMs(db: { query: typeof pool.query } = pool): Promise<number | null> {
  const r = await db.query<{ wait_ms: string | number | null }>(
    // GREATEST skips a NULL, so an empty queue is told apart before it (MIN over no rows is NULL).
    `SELECT CASE WHEN MIN(due) IS NULL THEN NULL ELSE GREATEST(0, EXTRACT(EPOCH FROM (MIN(due) - now())) * 1000) END AS wait_ms FROM (
       SELECT available_at AS due FROM background_jobs WHERE status IN ('queued','failed_retryable') AND NOT cancel_requested
       UNION ALL SELECT now() FROM background_jobs WHERE status = 'processing' AND lease_expires_at < now()) d`);
  const raw = r.rows[0]?.wait_ms;
  if (raw == null) return null;
  const ms = Math.ceil(Number(raw));
  return Number.isFinite(ms) && ms <= KICK_HORIZON_MS ? ms : null;
}

let lastKickAt = Number.NEGATIVE_INFINITY;
export function resetKickStateForTests() { lastKickAt = Number.NEGATIVE_INFINITY; }

export type KickOutcome = "sent" | "off" | "no_work" | "throttled" | "last_hop" | "failed";
/** Sends one POST to the job runner when work is due soon. `hop` 0 starts a chain (throttled per function); a chain's
 * next link passes its own hop. */
export async function kickIfPending(params: { hop?: number; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; db?: { query: typeof pool.query }; now?: () => number } = {}): Promise<KickOutcome> {
  const env = params.env ?? process.env, now = params.now ?? Date.now, hop = params.hop ?? 0;
  try {
    const url = kickUrl(env), secret = env.CRON_SECRET?.trim() ?? "";
    if (!url || !drainOn(env) || secret.length < MIN_CRON_SECRET_LENGTH) return "off";
    if (hop >= MAX_KICK_HOPS) { console.warn(`job kick: chain ended after ${hop} links (the drain and the daily run go on with it)`); return "last_hop"; }
    if (hop === 0 && now() - lastKickAt < KICK_MIN_INTERVAL_MS) return "throttled";
    if ((await nextDueInMs(params.db)) == null) return "no_work";
    if (hop === 0) lastKickAt = now();
    const res = await (params.fetchImpl ?? fetch)(url, { method: "POST", headers: { authorization: `Bearer ${secret}`, [KICK_HOP_HEADER]: String(hop + 1) },
      signal: AbortSignal.timeout(KICK_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) { console.error(`job kick: runner answered ${res.status}`); return "failed"; }
    return "sent";
  } catch (error) {
    console.error(`job kick: failed (${error instanceof Error ? error.name : "unknown"})`);
    return "failed";
  }
}

export function kickHop(header: string | null): number {
  const n = Number(header ?? "");
  return Number.isInteger(n) && n >= 1 && n <= MAX_KICK_HOPS ? n : 1;
}

export type KickedRun = { waitedMs: number; summary: JobBatchSummary | null; next: KickOutcome | "ended" };
/** One link of a chain, run after the runner's POST has answered (app/api/internal/jobs/run/route.ts). */
export async function runKickedLink(params: { hop: number; startedAt: number; jobTypes: WorkerJobTypeConfig[]; env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number; db?: { query: typeof pool.query } }): Promise<KickedRun> {
  const now = params.now ?? Date.now, sleep = params.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const next = (hop: number) => kickIfPending({ hop, env: params.env, fetchImpl: params.fetchImpl, db: params.db, now });
  try {
    let due = await nextDueInMs(params.db);
    if (due == null) return { waitedMs: 0, summary: null, next: "ended" };
    let waitedMs = 0;
    if (due > 0) {
      const room = params.startedAt + FUNCTION_LIMIT_MS - BATCH_RESERVE_MS - now();
      waitedMs = Math.max(0, Math.min(due, room));
      if (waitedMs > 0) await sleep(waitedMs);
      due = await nextDueInMs(params.db);
      // Not due yet within this function's time: the next link waits on.
      if (due == null) return { waitedMs, summary: null, next: "ended" };
      if (due > 0) return { waitedMs, summary: null, next: await next(params.hop) };
    }
    const summary = await runJobBatch({ jobTypes: params.jobTypes, workerId: `kick-${params.hop}-${Math.random().toString(36).slice(2, 10)}` });
    // Nothing to claim after all: another runner has it, and this chain ends.
    if (!summary.claimed) return { waitedMs, summary, next: "ended" };
    return { waitedMs, summary, next: await next(params.hop) };
  } catch (error) {
    console.error(`job kick: link failed (${error instanceof Error ? error.name : "unknown"})`);
    return { waitedMs: 0, summary: null, next: "failed" };
  }
}
