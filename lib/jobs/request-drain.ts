/**
 * Request-driven job drain: the prompt trigger for background work on a
 * Vercel plan whose Cron runs at most once a day (Hobby).
 *
 * A household that is waiting for work (an upload being scanned and
 * processed, a claim document being read, an asynchronous chat answer, an
 * export) is, by construction, polling a status route. Those routes, and the
 * routes that enqueue the work, call scheduleRequestDrain() which -- AFTER the
 * response has been sent (next/server after(), kept alive by Vercel's
 * waitUntil) -- runs ONE small bounded batch through exactly the same
 * runJobBatch() the authenticated cron route uses: lease recovery, the
 * FOR UPDATE SKIP LOCKED + CAS claim, heartbeats, bounded retries and
 * dead-lettering. Scan retries (document_scan_retry) are ordinary delayed
 * background_jobs rows, so they are picked up by the first drain after their
 * available_at while anyone is using the app; the daily Cron remains the
 * backstop for idle periods.
 *
 * Safety properties:
 * - Nothing the drain does is visible in the triggering response: it runs
 *   after the response, returns nothing to the caller, and logs an error
 *   class only. The caller cannot choose job types, households, workers or
 *   limits (all fixed here).
 * - It never widens what a job may do: the processors are the same, so an
 *   infected verdict stays terminal and deleted/superseded documents are
 *   skipped by the processors themselves (lib/scanning/retry-processor.ts,
 *   lib/rag/ingest.ts, lib/claims/evidence/pipeline.ts).
 * - Bounded: at most REQUEST_DRAIN_MAX_JOBS claims and a
 *   REQUEST_DRAIN_CLAIM_BUDGET_MS claim window per drain, at most one drain
 *   in flight per server instance, and at most one drain start per
 *   REQUEST_DRAIN_MIN_INTERVAL_MS per instance. A cheap indexed EXISTS query
 *   skips the batch entirely when nothing is claimable.
 * - Only called from authenticated household routes (after
 *   requireHouseholdContext succeeds), never from an anonymous path.
 * - JOB_DRAIN_ON_REQUEST=false disables it (e.g. where a standalone
 *   `npm run jobs:worker` or a frequent Cron is the trigger).
 */
import { after } from "next/server";
import { pool } from "@/lib/db/client";
import { runJobBatch, type JobBatchSummary } from "./cron-runner";
import type { WorkerJobTypeConfig } from "./worker-runtime";

export const REQUEST_DRAIN_MAX_JOBS = 2;
export const REQUEST_DRAIN_CLAIM_BUDGET_MS = 20_000;
export const REQUEST_DRAIN_MIN_INTERVAL_MS = 5_000;
export const REQUEST_DRAIN_FLAG = "JOB_DRAIN_ON_REQUEST";

export function requestDrainEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(0|false|off|no)$/i.test(env[REQUEST_DRAIN_FLAG]?.trim() ?? "");
}

type DrainState = { inFlight: boolean; lastStartedAt: number };
const state: DrainState = { inFlight: false, lastStartedAt: Number.NEGATIVE_INFINITY };

/** Test hook: resets the per-instance throttle. */
export function resetRequestDrainStateForTests() {
  state.inFlight = false;
  state.lastStartedAt = Number.NEGATIVE_INFINITY;
}

/** True when some job is claimable now, or a processing lease has expired
 * (recoverExpiredLeases would return it to the queue). */
export async function hasClaimableWork(): Promise<boolean> {
  const result = await pool.query<{ ready: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM background_jobs
        WHERE (status IN ('queued','failed_retryable') AND available_at <= now() AND NOT cancel_requested)
           OR (status = 'processing' AND lease_expires_at < now())
     ) AS ready`,
  );
  return Boolean(result.rows[0]?.ready);
}

export type RequestDrainOutcome =
  | { ran: false; reason: "disabled" | "in_flight" | "throttled" | "no_work" | "failed" }
  | { ran: true; summary: JobBatchSummary };

/** Runs one bounded drain now (awaitable; used by tests and by
 * scheduleRequestDrain's after() callback). */
export async function drainOnce(params: { jobTypes?: WorkerJobTypeConfig[]; now?: () => number; env?: NodeJS.ProcessEnv } = {}): Promise<RequestDrainOutcome> {
  const env = params.env ?? process.env;
  const now = params.now ?? Date.now;
  if (!requestDrainEnabled(env)) return { ran: false, reason: "disabled" };
  if (state.inFlight) return { ran: false, reason: "in_flight" };
  if (now() - state.lastStartedAt < REQUEST_DRAIN_MIN_INTERVAL_MS) return { ran: false, reason: "throttled" };
  state.inFlight = true;
  state.lastStartedAt = now();
  try {
    if (!(await hasClaimableWork())) return { ran: false, reason: "no_work" };
    const jobTypes = params.jobTypes ?? (await import("./processors")).PRODUCTION_JOB_TYPES;
    const summary = await runJobBatch({ jobTypes, maxJobs: REQUEST_DRAIN_MAX_JOBS, claimBudgetMs: REQUEST_DRAIN_CLAIM_BUDGET_MS, now, workerId: `request-${Math.random().toString(36).slice(2, 10)}` });
    return { ran: true, summary };
  } catch (error) {
    // Error class only: never a message, payload or identifier.
    console.error(`request drain: batch failed (${error instanceof Error ? error.name : "unknown"})`);
    return { ran: false, reason: "failed" };
  } finally {
    state.inFlight = false;
  }
}

/** Schedules a bounded drain after the current response. Call only after
 * the request has been authenticated. Never throws and never delays or
 * changes the response. */
export function scheduleRequestDrain(): void {
  if (!requestDrainEnabled()) return;
  const task = async () => { await drainOnce(); };
  try {
    after(task);
  } catch {
    // Outside a request scope (a route handler invoked directly, as the
    // PGlite suites do) there is no response to run after: do nothing, so a
    // test's own queue assertions are never raced by a detached drain.
  }
}
