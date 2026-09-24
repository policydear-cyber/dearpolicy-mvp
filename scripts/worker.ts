/**
 * Checkpoint 14f (claude/v1-launch-hardening): the standalone worker
 * process -- `npm run jobs:worker`.
 *
 * This is the piece scripts/launch-check.ts's background_job_reliability
 * diagnosis found missing: every real call site (policy processing,
 * claim-evidence processing) previously claimed and ran the job it had
 * just enqueued, synchronously, inside the same process that accepted
 * the HTTP upload. This script is a genuinely separate process: start it
 * with `npm run jobs:worker` (a long-running Node process, kept alive by
 * whatever process manager/orchestrator runs it -- systemd, a container
 * restart policy, a platform's worker/background-process primitive; this
 * script itself never assumes anything about how it is kept alive) and
 * it polls lib/jobs/queue.ts's real background_jobs table for claimable
 * work, independent of any HTTP request being in flight. A web
 * server instance that only ever calls enqueuePolicyProcessing()/
 * enqueueClaimEvidenceProcessing() (lib/rag/processing-queue.ts,
 * lib/claims/evidence/queue.ts) never itself claims or runs the
 * pipeline again after this checkpoint -- that is now exclusively this
 * process's job, whether it runs on the same host or a different one.
 *
 * Reuses lib/jobs/worker-runtime.ts's runWorkerLoop() (which itself
 * reuses lib/jobs/queue.ts's claim/complete/fail/recoverExpiredLeases()
 * primitives) and lib/jobs/processors.ts's PRODUCTION_JOB_TYPES list --
 * no pipeline or queue logic is duplicated here; this file is purely the
 * process entry point and its shutdown handling.
 */
import { pool } from "@/lib/db/client";
import { runWorkerLoop } from "@/lib/jobs/worker-runtime";
import { PRODUCTION_JOB_TYPES } from "@/lib/jobs/processors";

const POLL_INTERVAL_MS = Number(process.env.DEARPOLICY_WORKER_POLL_INTERVAL_MS ?? 2000);

async function main() {
  const controller = new AbortController();
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`worker: received ${signal}, finishing the in-flight claim then exiting...`);
    controller.abort();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(
    `worker: starting -- polling every ${POLL_INTERVAL_MS}ms for job types: ` +
      PRODUCTION_JOB_TYPES.map((t) => t.jobType).join(", "),
  );

  await runWorkerLoop({
    jobTypes: PRODUCTION_JOB_TYPES,
    pollIntervalMs: POLL_INTERVAL_MS,
    signal: controller.signal,
    onWork: (jobType, outcome) => console.log(`worker: ${jobType} job ${outcome}`),
  });

  await pool.end();
  console.log("worker: stopped");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
