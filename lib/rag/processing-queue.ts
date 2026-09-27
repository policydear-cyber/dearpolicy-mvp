import type { ProcessPolicyArgs } from "@/lib/rag/ingest";
import { enqueueJob } from "@/lib/jobs/queue";
import { pool } from "@/lib/db/client";

export const POLICY_PROCESSING_JOB_TYPE = "policy_processing";

/**
 * Checkpoint 14f (claude/v1-launch-hardening): enqueue-only, no inline
 * processing.
 *
 * Checkpoint 8 wired this onto lib/jobs/pipeline-worker.ts's
 * runAsDurableJob(), which enqueues a background_jobs row AND immediately
 * claims AND runs processPolicy() -- all inside the SAME process that
 * received the upload request. That made the job durable (survives a
 * crash mid-run, safe against a duplicate/retried upload) but never
 * actually separated "who accepts the request" from "who does the work":
 * a distributed worker fleet pulling from the queue never existed, which
 * is exactly the gap scripts/launch-check.ts's background_job_reliability
 * check named.
 *
 * This now does exactly what a real producer in a producer/consumer
 * queue does: persist an idempotency-keyed background_jobs row (via
 * lib/jobs/queue.ts's enqueueJob() -- the same primitive
 * runAsDurableJob() itself calls, reused directly here, not
 * reimplemented) and return. Idempotent: a retried/duplicate call for the
 * same policyId can never double-enqueue (enqueueJob()'s ON CONFLICT DO
 * NOTHING + re-read), exactly as before.
 *
 * The job is claimed and actually run by scripts/worker.ts's standalone
 * poll loop (lib/jobs/worker-runtime.ts's runWorkerLoop(), configured
 * with lib/jobs/processors.ts's processPolicyProcessingJob) -- a process
 * that may be, and in a real deployment must be, a genuinely separate
 * process/instance from whichever one received the HTTP upload. Nothing
 * about the args needed to actually run processPolicy() lives in this
 * process's memory once this function returns; everything the worker
 * needs is in the persisted payload below, decoded back into
 * ProcessPolicyArgs by lib/jobs/processors.ts.
 *
 * The one field this cannot avoid persisting to get a fully-detached
 * worker: pdfPassword, for a password-protected PDF. It goes into the
 * SAME jsonb payload column policyId/storageKey/etc. already live in --
 * no new exposure relative to the rest of this table, which already
 * holds every other processing argument -- but it does mean a
 * password-protected upload's password now sits in background_jobs until
 * that row is pruned, which it was not exposed to before this change.
 * Documented honestly in Checkpoint 14f rather than left implicit.
 */
export async function enqueuePolicyProcessing(args: ProcessPolicyArgs): Promise<void> {
  await enqueueJob(pool, {
    jobType: POLICY_PROCESSING_JOB_TYPE,
    idempotencyKey: args.policyId,
    accountId: args.accountId,
    // Re-analyse of a document whose previous job already finished (or died
    // in dead_letter) must actually run again: revive the terminal row
    // instead of returning it untouched. Safe here because processing is
    // idempotent -- every stage replaces its own output.
    resurrectTerminal: true,
    payload: {
      policyId: args.policyId,
      familyMemberId: args.familyMemberId,
      storageKey: args.storageKey,
      pdfPassword: args.pdfPassword ?? null,
      linkUploadMember: Boolean(args.linkUploadMember),
    },
  });
}
