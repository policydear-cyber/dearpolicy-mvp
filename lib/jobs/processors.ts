/**
 * Checkpoint 14f (claude/v1-launch-hardening): decodes a claimed
 * BackgroundJobRow back into the real pipeline call it represents, and
 * calls the REAL, existing pipeline function -- processPolicy() /
 * processClaimEvidence() -- never a reimplementation.
 *
 * This is deliberately the only place a background_jobs row's jsonb
 * payload gets decoded back into ProcessPolicyArgs/
 * ProcessClaimEvidenceArgs: lib/rag/processing-queue.ts and
 * lib/claims/evidence/queue.ts each own the encode side (what goes into
 * the payload when enqueuing); this module owns the matching decode side
 * (what a worker reconstructs when it claims that row later, possibly in
 * a different process with none of the original request's in-memory
 * state). Keeping both sides next to their own queue module would let
 * them drift silently; keeping the decode side here, imported by
 * scripts/worker.ts and by regression suites, keeps it in exactly one
 * place.
 */
import { processPolicy, type ProcessPolicyArgs } from "@/lib/rag/ingest";
import { processClaimEvidence, type ProcessClaimEvidenceArgs } from "@/lib/claims/evidence/pipeline";
import { POLICY_PROCESSING_JOB_TYPE } from "@/lib/rag/processing-queue";
import { CLAIM_EVIDENCE_PROCESSING_JOB_TYPE } from "@/lib/claims/evidence/queue";
import { HOUSEHOLD_EXPORT_JOB_TYPE } from "@/lib/household/export-queue";
import { processHouseholdExportJob } from "./household-export-processor";
import { MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE, processModelExecutionStalenessAuditJob } from "./model-execution-staleness-processor";
import { pool } from "@/lib/db/client";
import { heartbeatJob, type BackgroundJobRow } from "./queue";
import type { JobProcessor, WorkerJobTypeConfig } from "./worker-runtime";
import { CHAT_ANALYSIS_JOB_TYPE, processChatAnalysisJob } from "@/lib/chat/jobs";
import { SCAN_RETRY_JOB_TYPE } from "@/lib/scanning/retry";
import { processScanRetryJob } from "@/lib/scanning/retry-processor";

// Checkpoint 14i: re-exported so existing importers of
// lib/jobs/processors.ts (scripts/worker.ts, the e2e stages, this
// module's own PRODUCTION_JOB_TYPES below) see no change at all -- see
// lib/jobs/household-export-processor.ts's own doc comment for why the
// household_export processor itself lives in a separate, lighter-weight
// module instead of being defined inline here.
export { processHouseholdExportJob };
export { processModelExecutionStalenessAuditJob };

function requireStringField(payload: unknown, key: string): string {
  const value = (payload as Record<string, unknown> | null | undefined)?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`background job payload missing required string field "${key}"`);
  }
  return value;
}

function requireAccountId(job: BackgroundJobRow): string {
  if (job.account_id) return job.account_id;
  throw new Error(`background job ${job.id} has no account_id`);
}

// D14 (background job durability): processPolicy() -- OCR + LLM structured
// extraction over a potentially long PDF -- is the job type named in the
// audit as most likely to run past DEFAULT_LEASE_DURATION_MS (5 minutes).
// job.lease_owner IS this worker's workerId at this point: claimNextJob()
// (lib/jobs/queue.ts) only ever hands a job to process() after CAS-setting
// lease_owner=workerId for the claim that produced it, so this is never a
// different worker's id. jobHeartbeat is threaded through into
// processPolicy()'s existing progress() helper (see lib/rag/ingest.ts),
// which is already called at every natural checkpoint through the
// pipeline, so this reaches all of them without any new call sites there.
export const processPolicyProcessingJob: JobProcessor = async (job) => {
  const payload = job.payload as Record<string, unknown> | null;
  const workerId = job.lease_owner;
  if (!workerId) throw new Error(`background job ${job.id} has no lease_owner; cannot heartbeat`);
  const args: ProcessPolicyArgs = {
    accountId: requireAccountId(job),
    familyMemberId: requireStringField(payload, "familyMemberId"),
    policyId: requireStringField(payload, "policyId"),
    storageKey: requireStringField(payload, "storageKey"),
    pdfPassword: typeof payload?.pdfPassword === "string" ? payload.pdfPassword : undefined,
    linkUploadMember: Boolean(payload?.linkUploadMember),
    // Round 5: a deferred re-read (see scheduleDeferredRead) and its queue.
    deferredRetry: Boolean(payload?.deferredRetry),
    jobType: job.job_type,
    jobHeartbeat: async () => {
      await heartbeatJob(pool, { jobId: job.id, workerId });
    },
    // attempt_count was incremented when this attempt claimed the job.
    attempt: { number: job.attempt_count, max: job.max_attempts },
  };
  await processPolicy(args);
};

export const processClaimEvidenceProcessingJob: JobProcessor = async (job) => {
  const payload = job.payload as Record<string, unknown> | null;
  // D14 (background job durability): same requirement as
  // processPolicyProcessingJob above -- processClaimEvidence() runs OCR and
  // an LLM extraction call, either of which can run past
  // DEFAULT_LEASE_DURATION_MS on a scanned or multi-page document, so this
  // job type needs the same in-flight heartbeat.
  const workerId = job.lease_owner;
  if (!workerId) throw new Error(`background job ${job.id} has no lease_owner; cannot heartbeat`);
  const args: ProcessClaimEvidenceArgs = {
    accountId: requireAccountId(job),
    documentId: requireStringField(payload, "documentId"),
    jobHeartbeat: async () => {
      await heartbeatJob(pool, { jobId: job.id, workerId });
    },
  };
  await processClaimEvidence(args);
};

/** The full set of job types this codebase's standalone worker
 * (scripts/worker.ts) knows how to run -- passed straight to
 * lib/jobs/worker-runtime.ts's runWorkerLoop(). Adding a new durable job
 * type means adding one entry here, not touching the worker loop
 * itself. */
export const PRODUCTION_JOB_TYPES: WorkerJobTypeConfig[] = [
  { jobType: POLICY_PROCESSING_JOB_TYPE, process: processPolicyProcessingJob },
  { jobType: CLAIM_EVIDENCE_PROCESSING_JOB_TYPE, process: processClaimEvidenceProcessingJob },
  { jobType: HOUSEHOLD_EXPORT_JOB_TYPE, process: processHouseholdExportJob },
  { jobType: MODEL_EXECUTION_STALENESS_AUDIT_JOB_TYPE, process: processModelExecutionStalenessAuditJob },
  { jobType: CHAT_ANALYSIS_JOB_TYPE, process: processChatAnalysisJob },
  { jobType: SCAN_RETRY_JOB_TYPE, process: processScanRetryJob },
];
