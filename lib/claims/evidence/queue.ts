import { processClaimEvidence, type ProcessClaimEvidenceArgs } from "./pipeline";

type QueueGlobal = typeof globalThis & { __dearpolicyClaimEvidenceQueue?: Promise<void> };

/**
 * Local-first background queue for claim-evidence processing, exactly the
 * same shape as lib/rag/processing-queue.ts (policy documents): jobs run
 * one at a time so a burst of uploads cannot collide, and the HTTP upload
 * request can return immediately (see app/api/claims/evidence/upload/route.ts)
 * while processClaimEvidence() persists progress to Postgres as it goes.
 */
export function enqueueClaimEvidenceProcessing(args: ProcessClaimEvidenceArgs) {
  const state = globalThis as QueueGlobal;
  const previous = state.__dearpolicyClaimEvidenceQueue ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      try {
        await processClaimEvidence(args);
      } catch (error) {
        // processClaimEvidence() already writes the user-visible failure
        // (status='failed' + processing_error/_code) to the database.
        console.error("DearPolicy claim-evidence background processing failed:", error instanceof Error ? error.message : error);
      }
    });
  state.__dearpolicyClaimEvidenceQueue = next;
  return next;
}
