/**
 * Runs one bounded scan retry (see ./retry.ts for the policy). The retry
 * never has its own path to "clean": it re-enters the SAME single entry
 * point that first scanned the document -- lib/rag/ingest.ts's
 * processPolicy() (whose quarantine gate rescans a scan_pending document)
 * or lib/claims/evidence/pipeline.ts's processClaimEvidence() with
 * rescanUnavailable -- so exactly the same release rules apply.
 *
 * A document that is gone, deleted, superseded, rejected (infected) or
 * already clean is a completed no-op: it is never rescanned. When the last
 * permitted attempt still leaves the document on hold, the job is
 * dead-lettered (SCAN_RETRY_EXHAUSTED_ERROR, classified non-retryable) and
 * the document keeps its hold with a fixed, safe audit message.
 */
import { pool, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { BackgroundJobRow } from "@/lib/jobs/queue";
import { getPolicyQuarantineRow } from "@/lib/policies/quarantine/store";
import { appendPolicyDocumentAudit } from "@/lib/policies/quarantine/audit";
import { appendClaimEvidenceAudit } from "@/lib/claims/evidence/audit";
import { getEvidenceDocument } from "@/lib/claims/evidence/store";
import { processClaimEvidence } from "@/lib/claims/evidence/pipeline";
import { processPolicy, type ProcessPolicyArgs } from "@/lib/rag/ingest";
import { POLICY_PROCESSING_JOB_TYPE } from "@/lib/rag/processing-queue";
import { heartbeatJob } from "@/lib/jobs/queue";
import { releaseHeldPassword } from "./held-password";
import {
  isScanRetryPayload, MAX_SCAN_RETRY_ATTEMPTS, SCAN_RETRY_EXHAUSTED_ERROR, SCAN_RETRY_EXHAUSTED_MESSAGE, countScanRetries,
} from "./retry";

export class ScanRetryExhaustedError extends Error {
  constructor() { super(SCAN_RETRY_EXHAUSTED_ERROR); this.name = "ScanRetryExhaustedError"; }
}

async function policyArgs(accountId: string, policyId: string, jobHeartbeat?: () => Promise<void>): Promise<ProcessPolicyArgs | null> {
  // The original upload's processing arguments, from its own durable job row
  // (lib/rag/processing-queue.ts); the policies row is the fallback.
  const job = await query<{ payload: Record<string, unknown> | null }>(
    `SELECT payload FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2 AND account_id=$3`,
    [POLICY_PROCESSING_JOB_TYPE, policyId, accountId],
  );
  const payload = job.rows[0]?.payload ?? null;
  const row = await query<{ family_member_id: string | null; storage_key: string }>(
    `SELECT family_member_id::text, storage_key FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`, [policyId, accountId],
  );
  const familyMemberId = typeof payload?.familyMemberId === "string" ? payload.familyMemberId : row.rows[0]?.family_member_id;
  const storageKey = typeof payload?.storageKey === "string" ? payload.storageKey : row.rows[0]?.storage_key;
  if (!familyMemberId || !storageKey) return null;
  return {
    accountId, policyId, familyMemberId, storageKey,
    pdfPassword: typeof payload?.pdfPassword === "string" ? payload.pdfPassword : undefined,
    linkUploadMember: Boolean(payload?.linkUploadMember),
    jobHeartbeat,
  };
}

async function exhausted(attempt: number, resourceType: "policy_document" | "claim_evidence", resourceId: string): Promise<boolean> {
  // Exhausted only when THIS is the last permitted attempt and no later
  // attempt was scheduled by the rescan that just ran.
  return attempt >= MAX_SCAN_RETRY_ATTEMPTS && (await countScanRetries(resourceType, resourceId)) <= attempt;
}

export async function processScanRetryJob(job: BackgroundJobRow): Promise<void> {
  if (!job.account_id) throw new Error(`scan retry job ${job.id} has no account`);
  if (!isScanRetryPayload(job.payload)) throw new Error(`scan retry job ${job.id} has an invalid payload`);
  const accountId = job.account_id;
  const { resourceType, resourceId, attempt } = job.payload;
  const workerId = job.lease_owner;
  const jobHeartbeat = workerId ? async () => { await heartbeatJob(pool, { jobId: job.id, workerId }); } : undefined;

  if (resourceType === "policy_document") {
    const row = await getPolicyQuarantineRow(accountId, resourceId);
    // Gone, deleted, superseded, rejected or already clean: never rescanned.
    if (!row || row.superseded_at || row.quarantine_status !== "scan_pending") { await releaseHeldPassword(accountId, resourceId); return; }
    const args = await policyArgs(accountId, resourceId, jobHeartbeat);
    if (!args) { await releaseHeldPassword(accountId, resourceId); return; }
    // The held password (lib/scanning/held-password.ts) is dropped once the
    // document no longer waits for its scan, whether this read succeeded or not.
    try { await processPolicy(args); } finally { await releaseHeldPassword(accountId, resourceId); }
    const after = await getPolicyQuarantineRow(accountId, resourceId);
    if (after && !after.superseded_at && after.quarantine_status === "scan_pending" && await exhausted(attempt, resourceType, resourceId)) {
      await releaseHeldPassword(accountId, resourceId, true);
      await appendPolicyDocumentAudit(accountId, {
        actor: "system", action: "scan_retry_exhausted", policyId: resourceId,
        newValue: { attempts: attempt }, reason: SCAN_RETRY_EXHAUSTED_MESSAGE, reasonCode: "SCAN_RETRY_EXHAUSTED",
      });
      throw new ScanRetryExhaustedError();
    }
    return;
  }

  const doc = await getEvidenceDocument(accountId, resourceId);
  if (!doc || doc.status !== "quarantined" || doc.scan_status !== "scan_unavailable") return;
  await processClaimEvidence({ accountId, documentId: resourceId, jobHeartbeat, rescanUnavailable: true });
  const after = await getEvidenceDocument(accountId, resourceId);
  if (after && after.status === "quarantined" && after.scan_status === "scan_unavailable" && await exhausted(attempt, resourceType, resourceId)) {
    await appendClaimEvidenceAudit(accountId, {
      actor: "system", action: "scan_retry_exhausted", evidenceDocumentId: resourceId, claimSessionId: after.claim_session_id,
      newValue: { attempts: attempt }, reason: SCAN_RETRY_EXHAUSTED_MESSAGE, reasonCode: "SCAN_RETRY_EXHAUSTED",
    });
    throw new ScanRetryExhaustedError();
  }
}
