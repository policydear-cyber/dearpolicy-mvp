/**
 * TRUSTED OPERATOR PROCEDURE ONLY. Provisioning, suspending and assigning
 * DearPolicy claim reviewers.
 *
 * Nothing under app/, components/ or middleware.ts may import this module
 * (scripts/import-boundary-regressions.ts enforces it), so there is no HTTP
 * route -- household, reviewer or otherwise -- that can create a reviewer
 * or an assignment. The only caller is scripts/claim-reviewer-admin.ts, run
 * by an operator who already holds direct database credentials; that
 * database access is the trust boundary. Every change is written to the
 * append-only claim_reviewer_audit_log together with the operator name
 * given on the command line and the database role the change was made as.
 */
import type { PoolClient } from "pg";
import { isUuid, pool } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { getScopedEvidenceDocument } from "@/lib/claims/evidence/store";
import { appendReviewerAudit } from "./audit";
import { ensureClaimReviewerSchema } from "./schema";

export class ReviewerAdminError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** Assignments are always time-limited; 30 days is the longest allowed. */
export const MAX_ASSIGNMENT_HOURS = 24 * 30;

function operatorActor(operator: string): string {
  const name = (operator ?? "").trim();
  if (!/^[A-Za-z0-9._@+-]{2,80}$/.test(name)) {
    throw new ReviewerAdminError("OPERATOR_REQUIRED", "An operator name (2-80 letters, digits or ._@+-) is required for the audit record.");
  }
  return `operator:${name}`;
}

function requireUuid(value: string | null | undefined, label: string): string {
  if (!value || !isUuid(value)) throw new ReviewerAdminError("INVALID_ID", `${label} must be a uuid.`);
  return value;
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  await ensureClaimReviewerSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function databaseRole(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ role: string }>("SELECT session_user::text AS role");
  return rows[0]?.role ?? "unknown";
}

export async function provisionClaimReviewer(args: { userId: string; displayLabel: string; operator: string }) {
  const actor = operatorActor(args.operator);
  const userId = requireUuid(args.userId, "The reviewer's user id");
  const displayLabel = (args.displayLabel ?? "").trim();
  if (displayLabel.length < 1 || displayLabel.length > 80) throw new ReviewerAdminError("INVALID_LABEL", "A display label of 1-80 characters is required.");
  return inTransaction(async (client) => {
    // On Supabase the reviewer must be a real authenticated user.
    const authUsers = await client.query<{ present: boolean }>("SELECT to_regclass('auth.users') IS NOT NULL AS present");
    if (authUsers.rows[0]?.present) {
      const exists = await client.query("SELECT 1 FROM auth.users WHERE id=$1", [userId]);
      if (!exists.rows[0]) throw new ReviewerAdminError("USER_NOT_FOUND", "No Supabase Auth user has that id.");
    }
    const inserted = await client.query<{ user_id: string }>(
      `INSERT INTO claim_reviewers(user_id, display_label, status, provisioned_by) VALUES($1,$2,'active',$3)
       ON CONFLICT (user_id) DO NOTHING RETURNING user_id::text`,
      [userId, displayLabel, actor],
    );
    if (!inserted.rows[0]) throw new ReviewerAdminError("ALREADY_PROVISIONED", "That user is already a reviewer. Use reactivate to restore a suspended reviewer.");
    await appendReviewerAudit({ actor, action: "reviewer_provisioned", reviewerUserId: userId, details: { displayLabel, databaseRole: await databaseRole(client) } }, client);
    return { userId, displayLabel, status: "active" as const };
  });
}

/** Suspension takes effect on the reviewer's very next request (the
 * boundary requires status='active') and also revokes every assignment
 * they hold, so reactivation never silently restores old access. */
export async function setClaimReviewerStatus(args: { userId: string; status: "active" | "suspended"; operator: string; reason: string }) {
  const actor = operatorActor(args.operator);
  const userId = requireUuid(args.userId, "The reviewer's user id");
  if (args.status !== "active" && args.status !== "suspended") throw new ReviewerAdminError("INVALID_STATUS", "Status must be active or suspended.");
  const reason = (args.reason ?? "").trim();
  if (!reason) throw new ReviewerAdminError("REASON_REQUIRED", "A reason is required.");
  return inTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE claim_reviewers SET status=$2, status_reason=$3, updated_at=now() WHERE user_id=$1 RETURNING user_id`,
      [userId, args.status, reason],
    );
    if (!updated.rows[0]) throw new ReviewerAdminError("REVIEWER_NOT_FOUND", "No reviewer has that user id.");
    let revoked = 0;
    if (args.status === "suspended") {
      const result = await client.query(
        `UPDATE claim_review_assignments SET status='revoked', revoked_at=now(), revoked_by=$2, revoke_reason='reviewer_suspended'
          WHERE reviewer_user_id=$1 AND status='active' RETURNING id`,
        [userId, actor],
      );
      revoked = result.rows.length;
    }
    await appendReviewerAudit({
      actor, action: args.status === "suspended" ? "reviewer_suspended" : "reviewer_reactivated", reviewerUserId: userId,
      details: { reason, assignmentsRevoked: revoked, databaseRole: await databaseRole(client) },
    }, client);
    return { userId, status: args.status, assignmentsRevoked: revoked };
  });
}

export async function assignClaimReview(args: {
  reviewerUserId: string; accountId: string; claimSessionId: string; evidenceDocumentId?: string | null;
  expiresInHours: number; operator: string;
}) {
  const actor = operatorActor(args.operator);
  const reviewerUserId = requireUuid(args.reviewerUserId, "The reviewer's user id");
  const accountId = requireUuid(args.accountId, "The household id");
  const claimSessionId = requireUuid(args.claimSessionId, "The claim id");
  const evidenceDocumentId = args.evidenceDocumentId ? requireUuid(args.evidenceDocumentId, "The evidence document id") : null;
  if (!Number.isInteger(args.expiresInHours) || args.expiresInHours < 1 || args.expiresInHours > MAX_ASSIGNMENT_HOURS) {
    throw new ReviewerAdminError("INVALID_EXPIRY", `The assignment must expire within 1-${MAX_ASSIGNMENT_HOURS} hours.`);
  }
  // Resolve the scope before taking the transaction.
  await ensureClaimReviewerSchema();
  const scope = await pool.query<{ family_member_id: string }>(
    `SELECT cs.family_member_id::text AS family_member_id
       FROM claim_sessions cs
       JOIN accounts acc ON acc.id=cs.account_id AND ${activePredicate("acc")}
       JOIN family_members fm ON fm.id=cs.family_member_id AND fm.account_id=cs.account_id AND ${activePredicate("fm")}
      WHERE cs.id=$1 AND cs.account_id=$2`,
    [claimSessionId, accountId],
  );
  const familyMemberId = scope.rows[0]?.family_member_id;
  if (!familyMemberId) throw new ReviewerAdminError("CLAIM_NOT_FOUND", "That claim was not found in that household.");
  if (evidenceDocumentId) {
    const document = await getScopedEvidenceDocument({ accountId, familyMemberId, claimSessionId, id: evidenceDocumentId });
    if (!document) throw new ReviewerAdminError("EVIDENCE_NOT_FOUND", "That evidence document is not a current document of that claim.");
  }
  return inTransaction(async (client) => {
    const reviewer = await client.query(`SELECT 1 FROM claim_reviewers WHERE user_id=$1 AND status='active'`, [reviewerUserId]);
    if (!reviewer.rows[0]) throw new ReviewerAdminError("REVIEWER_NOT_ACTIVE", "That user is not an active reviewer.");
    const member = await client.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [accountId, reviewerUserId]);
    if (member.rows[0]) throw new ReviewerAdminError("SELF_REVIEW_FORBIDDEN", "A reviewer cannot be assigned a claim from a household they belong to.");
    const existing = await client.query(
      `SELECT 1 FROM claim_review_assignments WHERE reviewer_user_id=$1 AND claim_session_id=$2
          AND evidence_document_id IS NOT DISTINCT FROM $3 AND status='active'`,
      [reviewerUserId, claimSessionId, evidenceDocumentId],
    );
    if (existing.rows[0]) throw new ReviewerAdminError("ALREADY_ASSIGNED", "That reviewer already has an active assignment for this scope. Revoke it first.");
    const inserted = await client.query<{ id: string; expires_at: string }>(
      `INSERT INTO claim_review_assignments(reviewer_user_id, account_id, family_member_id, claim_session_id, evidence_document_id, expires_at, assigned_by)
       VALUES($1,$2,$3,$4,$5, now() + make_interval(hours => $6::int), $7)
       RETURNING id::text, expires_at::text`,
      [reviewerUserId, accountId, familyMemberId, claimSessionId, evidenceDocumentId, args.expiresInHours, actor],
    );
    const assignment = inserted.rows[0];
    await appendReviewerAudit({
      actor, action: "assignment_created", reviewerUserId, assignmentId: assignment.id, accountId, claimSessionId, evidenceDocumentId,
      details: { expiresAt: assignment.expires_at, databaseRole: await databaseRole(client) },
    }, client);
    return { assignmentId: assignment.id, reviewerUserId, accountId, familyMemberId, claimSessionId, evidenceDocumentId, expiresAt: assignment.expires_at };
  });
}

/** Revocation takes effect on the reviewer's very next request: document
 * downloads and decisions both re-check the assignment every time. */
export async function revokeClaimReviewAssignment(args: { assignmentId: string; operator: string; reason: string }) {
  const actor = operatorActor(args.operator);
  const assignmentId = requireUuid(args.assignmentId, "The assignment id");
  const reason = (args.reason ?? "").trim();
  if (!reason) throw new ReviewerAdminError("REASON_REQUIRED", "A reason is required.");
  return inTransaction(async (client) => {
    const revoked = await client.query<{ reviewer_user_id: string; account_id: string; claim_session_id: string; evidence_document_id: string | null }>(
      `UPDATE claim_review_assignments SET status='revoked', revoked_at=now(), revoked_by=$2, revoke_reason=$3
        WHERE id=$1 AND status='active'
        RETURNING reviewer_user_id::text, account_id::text, claim_session_id::text, evidence_document_id::text`,
      [assignmentId, actor, reason],
    );
    const row = revoked.rows[0];
    if (!row) throw new ReviewerAdminError("ASSIGNMENT_NOT_ACTIVE", "No active assignment has that id.");
    await appendReviewerAudit({
      actor, action: "assignment_revoked", reviewerUserId: row.reviewer_user_id, assignmentId, accountId: row.account_id,
      claimSessionId: row.claim_session_id, evidenceDocumentId: row.evidence_document_id, details: { reason, databaseRole: await databaseRole(client) },
    }, client);
    return { assignmentId, status: "revoked" as const };
  });
}
