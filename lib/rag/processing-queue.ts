import { processPolicy, type ProcessPolicyArgs } from "@/lib/rag/ingest";
import { runAsDurableJob } from "@/lib/jobs/pipeline-worker";

type QueueGlobal = typeof globalThis & { __dearpolicyPolicyQueue?: Promise<void> };

const JOB_TYPE = "policy_processing";

/**
 * Checkpoint 8 (claude/v1-launch-hardening): migrated onto
 * lib/jobs/pipeline-worker.ts's runAsDurableJob() -- every call now
 * persists a background_jobs row (idempotency-keyed on policyId, so a
 * retried/duplicate upload request can never double-process the same
 * policy document), claims a real lease, and classifies failure into
 * bounded retry vs. dead-letter through lib/jobs/queue.ts, rather than the
 * in-memory-only promise chain this used to be the entirety of.
 *
 * Per-process serialization (policy jobs run one at a time so a large
 * upload cannot collide with another Qwen/BGE job) is unchanged and still
 * comes from the chained promise below, exactly as before this migration.
 */
export function enqueuePolicyProcessing(args: ProcessPolicyArgs) {
  const state = globalThis as QueueGlobal;
  const previous = state.__dearpolicyPolicyQueue ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await runAsDurableJob({
          jobType: JOB_TYPE,
          idempotencyKey: args.policyId,
          accountId: args.accountId,
          payload: { policyId: args.policyId },
          work: () => processPolicy(args),
        });
      } catch (error) {
        // processPolicy already writes the user-visible failure to the
        // database, and runAsDurableJob() has already recorded the durable
        // job failure above -- this is the same best-effort process-level
        // log the old in-memory chain always had.
        console.error("DearPolicy background processing failed:", error);
      }
    });
  state.__dearpolicyPolicyQueue = next;
  return next;
}
