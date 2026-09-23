import { processClaimEvidence, type ProcessClaimEvidenceArgs } from "./pipeline";
import { runAsDurableJob } from "@/lib/jobs/pipeline-worker";

type QueueGlobal = typeof globalThis & { __dearpolicyClaimEvidenceQueue?: Promise<void> };

const JOB_TYPE = "claim_evidence_processing";

/**
 * Checkpoint 8 (claude/v1-launch-hardening): migrated onto
 * lib/jobs/pipeline-worker.ts's runAsDurableJob() -- every call now
 * persists a background_jobs row (idempotency-keyed on documentId, so a
 * retried/duplicate upload request can never double-process the same
 * document), claims a real lease, and classifies failure into bounded
 * retry vs. dead-letter through lib/jobs/queue.ts, rather than the
 * in-memory-only promise chain this used to be the entirety of.
 *
 * Per-process serialization (jobs run one at a time so a burst of uploads
 * cannot collide) is unchanged and still comes from the chained promise
 * below, exactly as before this migration -- see pipeline-worker.ts's own
 * comment on why that stays the caller's responsibility for now.
 */
export function enqueueClaimEvidenceProcessing(args: ProcessClaimEvidenceArgs) {
  const state = globalThis as QueueGlobal;
  const previous = state.__dearpolicyClaimEvidenceQueue ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await runAsDurableJob({
          jobType: JOB_TYPE,
          idempotencyKey: args.documentId,
          accountId: args.accountId,
          payload: { documentId: args.documentId },
          work: () => processClaimEvidence(args),
        });
      } catch (error) {
        // processClaimEvidence() already writes the user-visible failure
        // (status='failed' + processing_error/_code) to the database, and
        // runAsDurableJob() has already recorded the durable job failure
        // above -- this is just the same best-effort process-level log the
        // old in-memory chain always had.
        console.error("DearPolicy claim-evidence background processing failed:", error instanceof Error ? error.message : error);
      }
    });
  state.__dearpolicyClaimEvidenceQueue = next;
  return next;
}
