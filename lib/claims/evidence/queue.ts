import type { ProcessClaimEvidenceArgs } from "./pipeline";
import { enqueueJob } from "@/lib/jobs/queue";
import { pool } from "@/lib/db/client";

export const CLAIM_EVIDENCE_PROCESSING_JOB_TYPE = "claim_evidence_processing";

/**
 * Checkpoint 14f (claude/v1-launch-hardening): enqueue-only, no inline
 * processing.
 *
 * Checkpoint 8 wired this onto lib/jobs/pipeline-worker.ts's
 * runAsDurableJob(), which enqueues a background_jobs row AND immediately
 * claims AND runs processClaimEvidence() -- all inside the SAME process
 * that received the upload request. That gave the job an idempotency key
 * and a durable record of what happened, but never actually separated
 * "who accepts the request" from "who does the work" -- see
 * lib/rag/processing-queue.ts's enqueuePolicyProcessing() (this module's
 * exact counterpart) for the full rationale, identical here.
 *
 * This now does exactly what a real producer in a producer/consumer
 * queue does: persist an idempotency-keyed background_jobs row (via
 * lib/jobs/queue.ts's enqueueJob(), reused directly, not reimplemented)
 * and return. ProcessClaimEvidenceArgs is only { accountId, documentId }
 * -- both already round-trip through the job row itself (accountId is
 * the row's own account_id column; documentId is the idempotency key),
 * so the payload below is redundant with the row's own columns by
 * design, kept explicit so lib/jobs/processors.ts's decode step matches
 * the policy-processing job's shape rather than being a special case.
 *
 * The job is claimed and actually run by scripts/worker.ts's standalone
 * poll loop (lib/jobs/worker-runtime.ts's runWorkerLoop(), configured
 * with lib/jobs/processors.ts's processClaimEvidenceProcessingJob) -- a
 * process that may be, and in a real deployment must be, genuinely
 * separate from whichever one received the HTTP upload.
 */
export async function enqueueClaimEvidenceProcessing(args: ProcessClaimEvidenceArgs): Promise<void> {
  await enqueueJob(pool, {
    jobType: CLAIM_EVIDENCE_PROCESSING_JOB_TYPE,
    idempotencyKey: args.documentId,
    accountId: args.accountId,
    payload: { documentId: args.documentId },
  });
}
