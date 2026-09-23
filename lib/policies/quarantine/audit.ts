import { query } from "@/lib/db/client";
import type { PolicyDocumentAuditEntry, PolicyDocumentAuditRow } from "./types";

/** The one place allowed to write to policy_document_audit_log -- every
 * quarantine/scan status change anywhere in this pipeline goes through
 * here, and nothing else ever UPDATEs or DELETEs a row, so the trail stays
 * immutable for real. Mirrors lib/claims/evidence/audit.ts exactly. */
export async function appendPolicyDocumentAudit(accountId: string, entry: PolicyDocumentAuditEntry): Promise<void> {
  await query(
    `INSERT INTO policy_document_audit_log(account_id,actor,action,previous_value,new_value,policy_id,reason,reason_code)
     VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)`,
    [
      accountId, entry.actor, entry.action,
      entry.previousValue !== undefined ? JSON.stringify(entry.previousValue) : null,
      entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
      entry.policyId ?? null, entry.reason ?? null, entry.reasonCode ?? null,
    ],
  );
}

export async function listPolicyDocumentAudit(accountId: string, policyId: string): Promise<PolicyDocumentAuditRow[]> {
  const result = await query<PolicyDocumentAuditRow>(
    `SELECT id::text,account_id,actor,action,occurred_at::text,previous_value,new_value,policy_id,reason,reason_code
       FROM policy_document_audit_log WHERE account_id=$1 AND policy_id=$2 ORDER BY occurred_at DESC, id DESC`,
    [accountId, policyId],
  );
  return result.rows;
}
