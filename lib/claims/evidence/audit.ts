import { query } from "@/lib/db/client";
import { ensureClaimEvidenceSchema } from "./schema";
import type { ClaimEvidenceAuditEntry, ClaimEvidenceAuditRow } from "./types";

/** The one place allowed to write to claim_evidence_audit_log -- every
 * status change, correction, rejection and match decision anywhere in this
 * pipeline goes through here, and nothing else ever UPDATEs or DELETEs a
 * row in that table, so the trail stays immutable for real. */
export async function appendClaimEvidenceAudit(accountId: string, entry: ClaimEvidenceAuditEntry): Promise<void> {
  await ensureClaimEvidenceSchema();
  await query(
    `INSERT INTO claim_evidence_audit_log(account_id,actor,action,previous_value,new_value,evidence_document_id,claim_session_id,contract_id,coverage_id,reason,reason_code)
     VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
    [
      accountId, entry.actor, entry.action,
      entry.previousValue !== undefined ? JSON.stringify(entry.previousValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      entry.evidenceDocumentId ?? null, entry.claimSessionId ?? null, entry.contractId ?? null, entry.coverageId ?? null,
      entry.reason ?? null, entry.reasonCode ?? null,
    ],
  );
}

export async function listClaimEvidenceAudit(accountId: string, claimSessionId: string): Promise<ClaimEvidenceAuditRow[]> {
  await ensureClaimEvidenceSchema();
  const result = await query<ClaimEvidenceAuditRow>(
    `SELECT id::text,account_id,actor,action,occurred_at::text,previous_value,new_value,evidence_document_id,claim_session_id,contract_id,coverage_id,reason,reason_code
       FROM claim_evidence_audit_log WHERE account_id=$1 AND claim_session_id=$2 ORDER BY occurred_at DESC, id DESC`,
    [accountId, claimSessionId],
  );
  return result.rows;
}
