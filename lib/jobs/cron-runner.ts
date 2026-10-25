/**
 * The production execution trigger for every durable background job.
 *
 * On Vercel there is no long-running process to host scripts/worker.ts
 * (`npm run jobs:worker`): request handlers only ever enqueue
 * (lib/rag/processing-queue.ts, lib/claims/evidence/queue.ts,
 * lib/household/export-queue.ts, lib/chat/jobs.ts,
 * scripts/model-execution-staleness-check.ts), so without a scheduled
 * invocation every enqueued job would stay `queued` forever. Vercel Cron
 * calls app/api/internal/jobs/run/route.ts on the schedule in vercel.json;
 * that route authenticates the call (authorizeJobRunner) and runs ONE
 * bounded batch (runJobBatch) through the exact same primitives the
 * standalone worker uses -- lib/jobs/queue.ts's lease-safe claim
 * (FOR UPDATE SKIP LOCKED, so overlapping invocations never run the same
 * job twice), heartbeats, bounded retries and dead-lettering, and
 * lib/jobs/worker-runtime.ts's claimAndProcessOne().
 *
 * Timeout safety: the batch stops CLAIMING new work once claimBudgetMs has
 * elapsed or maxJobs have been claimed, leaving the rest of the function's
 * maxDuration for the job already in flight. A job cut off by the platform
 * mid-run simply stops heartbeating; its lease expires and the next
 * invocation's recoverExpiredLeases() returns it to failed_retryable (or
 * dead_letter once max_attempts is reached), exactly as for a crashed
 * standalone worker.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "@/lib/db/client";
import { MIN_CRON_SECRET_LENGTH } from "@/lib/launch/guards";
import { recoverExpiredLeases } from "./queue";
import { claimAndProcessOne, type WorkerJobTypeConfig } from "./worker-runtime";

export const JOB_RUNNER_PATH = "/api/internal/jobs/run";
export const DEFAULT_JOB_RUNNER_MAX_JOBS = 10;
/** Half the runner route's maxDuration (300 s): one long document no longer ends the batch before the next one is
 * claimed (25 Oct: a second document waited a day behind the first). */
export const DEFAULT_JOB_RUNNER_CLAIM_BUDGET_MS = 150_000;
/** Shorter secrets are treated as not configured (fail closed). Defined in
 * lib/launch/guards.ts so the startup guard and this endpoint agree. */
export { MIN_CRON_SECRET_LENGTH } from "@/lib/launch/guards";

export type JobRunnerAuthorization = { ok: true } | { ok: false; status: 401 | 503 };

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
 * project has a CRON_SECRET environment variable. No secret configured
 * means the runner refuses every call (503) rather than running
 * unauthenticated. The comparison is constant-time. */
export function authorizeJobRunner(authorizationHeader: string | null, env: NodeJS.ProcessEnv = process.env): JobRunnerAuthorization {
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (secret.length < MIN_CRON_SECRET_LENGTH) return { ok: false, status: 503 };
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const given = Buffer.from(authorizationHeader ?? "", "utf8");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, status: 401 };
  return { ok: true };
}

export type JobBatchSummary = {
  claimed: number;
  byType: Record<string, { succeeded: number; failed: number }>;
  recoveredLeases: number;
  deadLetteredLeases: number;
  stoppedBy: "empty" | "max_jobs" | "time_budget";
};

/** Runs one bounded batch: lease recovery first, then round-robin claims
 * across every job type until the queue is empty, maxJobs have been
 * claimed, or the claim budget has elapsed. Returns counts only -- never a
 * payload, error message or identifier. */
export async function runJobBatch(params: {
  jobTypes: WorkerJobTypeConfig[];
  maxJobs?: number;
  claimBudgetMs?: number;
  now?: () => number;
  workerId?: string;
}): Promise<JobBatchSummary> {
  const now = params.now ?? Date.now;
  const started = now();
  const maxJobs = params.maxJobs ?? DEFAULT_JOB_RUNNER_MAX_JOBS;
  const claimBudgetMs = params.claimBudgetMs ?? DEFAULT_JOB_RUNNER_CLAIM_BUDGET_MS;
  const workerId = params.workerId ?? `cron-${randomUUID()}`;

  const recovery = await recoverExpiredLeases(pool);
  const byType: JobBatchSummary["byType"] = {};
  let claimed = 0;
  let stoppedBy: JobBatchSummary["stoppedBy"] = "empty";

  outer: for (;;) {
    let anyWork = false;
    for (const { jobType, process } of params.jobTypes) {
      if (claimed >= maxJobs) { stoppedBy = "max_jobs"; break outer; }
      if (now() - started >= claimBudgetMs) { stoppedBy = "time_budget"; break outer; }
      const outcome = await claimAndProcessOne({ jobType, workerId, process });
      if (outcome === "empty") continue;
      anyWork = true;
      claimed++;
      const counts = (byType[jobType] ??= { succeeded: 0, failed: 0 });
      if (outcome === "succeeded") counts.succeeded++;
      else counts.failed++;
    }
    if (!anyWork) break;
  }

  return {
    claimed,
    byType,
    recoveredLeases: recovery.recoveredToRetry.length,
    deadLetteredLeases: recovery.movedToDeadLetter.length,
    stoppedBy,
  };
}
