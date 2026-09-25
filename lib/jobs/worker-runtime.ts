/**
 * Checkpoint 14f (claude/v1-launch-hardening): the real, standalone
 * worker loop -- the piece that was genuinely missing after Checkpoint
 * 8's real-queue migration.
 *
 * lib/jobs/pipeline-worker.ts's runAsDurableJob() enqueues AND claims AND
 * runs work, all inside the caller's own process; that is what
 * lib/rag/processing-queue.ts and lib/claims/evidence/queue.ts used to be
 * built on (before this checkpoint split them onto enqueueJob() alone).
 * This module is the other half: a driver that ONLY ever claims and runs
 * work someone else already enqueued, using nothing but
 * lib/jobs/queue.ts's existing claim/complete/fail primitives -- the
 * exact same primitives runAsDurableJob() itself is built on, reused, not
 * reimplemented. That is what makes it safe to run this from a genuinely
 * separate process (scripts/worker.ts) than whatever process accepted
 * the original HTTP request: this module never assumes it is the same
 * process that enqueued anything.
 */
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db/client";
import { claimNextJob, completeJob, failJob, recoverExpiredLeases, type BackgroundJobRow } from "./queue";
import { classifyPipelineError } from "./pipeline-worker";

export type JobProcessor = (job: BackgroundJobRow) => Promise<void>;

export type WorkerJobTypeConfig = { jobType: string; process: JobProcessor };

export type ClaimOutcome = "empty" | "succeeded" | "failed";

/**
 * Claims and runs AT MOST ONE queued/failed_retryable job of `jobType`,
 * entirely through claimNextJob()/completeJob()/failJob() -- no
 * enqueueing here, ever. This is the primitive both runWorkerLoop() below
 * and a regression suite that wants to prove "a separately-invoked
 * worker pass claims and completes a job the request handler only
 * enqueued" call directly, one claim at a time, without needing a whole
 * poll loop running in the background.
 */
export async function claimAndProcessOne(params: {
  jobType: string;
  workerId: string;
  process: JobProcessor;
}): Promise<ClaimOutcome> {
  const claimed = await claimNextJob(pool, { jobType: params.jobType, workerId: params.workerId });
  if (!claimed) return "empty";

  try {
    await params.process(claimed);
    await completeJob(pool, { jobId: claimed.id, workerId: params.workerId });
    return "succeeded";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failJob(pool, {
      jobId: claimed.id,
      workerId: params.workerId,
      errorCategory: classifyPipelineError(error),
      errorMessage: message.slice(0, 2000),
    });
    return "failed";
  }
}

/**
 * Polls for claimable work across every configured job type, in one
 * long-lived loop -- the actual "separate worker process" the durable-job
 * model has always assumed exists but that, before this checkpoint,
 * nothing in this codebase ever ran: every real call site claimed and
 * ran its own job inline. scripts/worker.ts is the intended caller: a
 * dedicated `node` process kept alive by the platform/orchestrator
 * (`npm run jobs:worker`), never inside a request/response cycle.
 *
 * Drains each job type fully (repeated claimAndProcessOne() calls until
 * "empty") before moving to the next, rather than one claim per poll
 * tick, so a burst of enqueued work is processed as fast as the
 * pipeline itself allows instead of being throttled to
 * one-job-per-pollIntervalMs.
 *
 * Also runs recoverExpiredLeases() every `leaseRecoveryEveryNPolls` poll
 * cycles, so a worker that crashed mid-job (lease left dangling) is
 * reclaimed by whichever worker instance is still alive, without a
 * separate cron process -- reusing lib/jobs/queue.ts's own reaper, not a
 * new implementation of the same idea.
 *
 * `signal`/`maxIterations`/`onIdle` exist purely so a regression suite
 * can run this to a deterministic, bounded stop instead of forever; a
 * real deployment passes none of them and lets it run until the process
 * itself is stopped.
 */
export async function runWorkerLoop(params: {
  jobTypes: WorkerJobTypeConfig[];
  workerId?: string;
  pollIntervalMs?: number;
  leaseRecoveryEveryNPolls?: number;
  signal?: AbortSignal;
  maxIterations?: number;
  onIdle?: (iteration: number) => void;
  onWork?: (jobType: string, outcome: ClaimOutcome) => void;
}): Promise<void> {
  const workerId = params.workerId ?? randomUUID();
  const pollIntervalMs = params.pollIntervalMs ?? 2000;
  const leaseRecoveryEveryNPolls = params.leaseRecoveryEveryNPolls ?? 30;
  let iteration = 0;
  let pollsSinceRecovery = 0;

  while (!params.signal?.aborted) {
    let anyWork = false;
    for (const { jobType, process } of params.jobTypes) {
      let outcome = await claimAndProcessOne({ jobType, workerId, process });
      while (outcome !== "empty") {
        anyWork = true;
        params.onWork?.(jobType, outcome);
        if (params.signal?.aborted) break;
        outcome = await claimAndProcessOne({ jobType, workerId, process });
      }
    }

    pollsSinceRecovery++;
    if (pollsSinceRecovery >= leaseRecoveryEveryNPolls) {
      pollsSinceRecovery = 0;
      await recoverExpiredLeases(pool).catch((error) =>
        console.error("runWorkerLoop: recoverExpiredLeases failed:", error instanceof Error ? error.message : error),
      );
    }

    if (!anyWork) params.onIdle?.(iteration);
    iteration++;
    if (params.maxIterations !== undefined && iteration >= params.maxIterations) return;
    if (params.signal?.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
