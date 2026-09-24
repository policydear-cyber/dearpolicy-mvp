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
import type { BackgroundJobRow } from "./queue";
import type { JobProcessor, WorkerJobTypeConfig } from "./worker-runtime";

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

export const processPolicyProcessingJob: JobProcessor = async (job) => {
  const payload = job.payload as Record<string, unknown> | null;
  const args: ProcessPolicyArgs = {
    accountId: requireAccountId(job),
    familyMemberId: requireStringField(payload, "familyMemberId"),
    policyId: requireStringField(payload, "policyId"),
    storageKey: requireStringField(payload, "storageKey"),
    pdfPassword: typeof payload?.pdfPassword === "string" ? payload.pdfPassword : undefined,
    linkUploadMember: Boolean(payload?.linkUploadMember),
  };
  await processPolicy(args);
};

export const processClaimEvidenceProcessingJob: JobProcessor = async (job) => {
  const payload = job.payload as Record<string, unknown> | null;
  const args: ProcessClaimEvidenceArgs = {
    accountId: requireAccountId(job),
    documentId: requireStringField(payload, "documentId"),
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
];
