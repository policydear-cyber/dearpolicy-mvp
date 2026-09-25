import { query } from "@/lib/db/client";

export type ReviewerAuditAction =
  | "reviewer_provisioned"
  | "reviewer_suspended"
  | "reviewer_reactivated"
  | "assignment_created"
  | "assignment_revoked"
  | "assignment_opened"
  | "document_viewed"
  | "definition_decision_recorded";

export type ReviewerAuditEntry = {
  /** "reviewer:<user id>" for a reviewer's own action, "operator:<name>"
   * for the trusted provisioning procedure. Never taken from a request. */
  actor: string;
  action: ReviewerAuditAction;
  reviewerUserId?: string | null;
  assignmentId?: string | null;
  accountId?: string | null;
  claimSessionId?: string | null;
  evidenceDocumentId?: string | null;
  details?: Record<string, unknown>;
};

type Queryable = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/** The only writer of claim_reviewer_audit_log, which is append-only at
 * the database level (a trigger rejects UPDATE and DELETE). Pass `client`
 * to write inside the caller's own transaction. */
export async function appendReviewerAudit(entry: ReviewerAuditEntry, client?: Queryable): Promise<void> {
  const text = `INSERT INTO claim_reviewer_audit_log(actor,action,reviewer_user_id,assignment_id,account_id,claim_session_id,evidence_document_id,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`;
  const params = [
    entry.actor, entry.action, entry.reviewerUserId ?? null, entry.assignmentId ?? null, entry.accountId ?? null,
    entry.claimSessionId ?? null, entry.evidenceDocumentId ?? null, JSON.stringify(entry.details ?? {}),
  ];
  if (client) await client.query(text, params);
  else await query(text, params);
}
