/**
 * Everything the database holds about an account that does NOT go automatically when its households are deleted.
 *
 * Most tables hang off accounts(id) with ON DELETE CASCADE, so deleting a household removes them (documents, readings,
 * benefits, chats, people, plans, jobs ...). These are the columns where that is not enough: they hold a user id, an
 * email, a household id or a pseudonym of one WITHOUT a cascading foreign key (usage and audit rows that must outlive
 * a document, invitations that name people, rate-limit counters, the storage queue's file keys). Each is listed here
 * with what happens to it, so deleting an account leaves no row that still points at it.
 *
 * scripts/admin/account-deletion-test.ts reads the live schema and FAILS if a table gains an identity-looking column
 * that is neither cascade-covered nor listed here (or kept with a reason below), and scans every column of every
 * table after a deletion for the account's ids, email and household ids.
 */

export type DeletionContext = {
  userId: string;
  /** Lower-case sign-in email. */
  email: string;
  /** Households being deleted whole. */
  householdIds: string[];
  /** pseudonymizeId() of each household (model_executions keys its rows by that, not the id). */
  householdRefs: string[];
  /** Background jobs of those households (their audit rows keep only the job id). */
  jobIds: string[];
  /** Every stored-file key the household's documents, claim documents and exports held (collected before deletion). */
  storageKeys: string[];
};

export type DataRule = {
  /** "table.column" the rule covers. */
  key: string;
  /** Other columns the same statement (or the cascade it triggers) takes care of. */
  alsoCovers?: string[];
  /** household: keyed by a household being deleted (run before and after it goes). user: keyed by the person. */
  scope: "household" | "user";
  sql: string;
  params: (ctx: DeletionContext) => unknown[];
  why: string;
};

const REDACTED = "deleted-account";

export const ACCOUNT_DATA_RULES: DataRule[] = [
  // ---- keyed by a household being deleted, no cascading foreign key ----
  { key: "model_usage.account_id", scope: "household", sql: `DELETE FROM model_usage WHERE account_id = ANY($1::uuid[])`, params: (c) => [c.householdIds],
    why: "Usage records keyed by household id, kept after a household's rows cascade away." },
  { key: "model_executions.household_ref", alsoCovers: ["model_executions.resource_ref"], scope: "household", sql: `UPDATE model_executions SET household_ref = NULL, resource_ref = NULL WHERE household_ref = ANY($1::text[])`, params: (c) => [c.householdRefs],
    why: "Model-call ledger. The link to the household is cut (the rows keep tokens and cost for spend accounting, with no identifier)." },
  { key: "rate_limit_buckets.bucket_key", scope: "household", sql: `DELETE FROM rate_limit_buckets WHERE bucket_key = ANY($1::text[])`, params: (c) => [c.householdIds],
    why: "Re-read counters are keyed by household id." },
  { key: "background_job_audit_log.job_id", scope: "household", sql: `DELETE FROM background_job_audit_log WHERE job_id = ANY($1::uuid[])`, params: (c) => [c.jobIds],
    why: "Status history of the household's background jobs (the jobs themselves cascade)." },
  { key: "storage_purge_queue.storage_key", scope: "household",
    sql: `DELETE FROM storage_purge_queue WHERE purged_at IS NOT NULL AND (storage_key = ANY($1::text[]) OR left(storage_key, 36) = ANY($2::text[]))`, params: (c) => [c.storageKeys, c.householdIds],
    why: "Finished removal entries still hold the stored file's path, which includes the file name. Entries not yet removed stay so they are retried." },

  // ---- keyed by the person ----
  { key: "household_members.user_id", scope: "user", sql: `DELETE FROM household_members WHERE user_id = $1`, params: (c) => [c.userId], why: "Memberships, including households that stay." },
  { key: "household_members.invited_by", scope: "user", sql: `UPDATE household_members SET invited_by = NULL WHERE invited_by = $1`, params: (c) => [c.userId], why: "Who invited a remaining member." },
  { key: "household_invitations.invited_by", scope: "user", sql: `DELETE FROM household_invitations WHERE invited_by = $1`, params: (c) => [c.userId], why: "Invitations the person sent; each names the invitee's email." },
  { key: "household_invitations.accepted_by", scope: "user", sql: `UPDATE household_invitations SET accepted_by = NULL WHERE accepted_by = $1`, params: (c) => [c.userId], why: "Which account accepted an invitation to a household that stays." },
  { key: "household_invitations.email", scope: "user", sql: `DELETE FROM household_invitations WHERE lower(email) = $1`, params: (c) => [c.email], why: "Invitations addressed to the person's email, in any household." },
  { key: "household_exports.requested_by", scope: "user", sql: `DELETE FROM household_exports WHERE requested_by = $1`, params: (c) => [c.userId], why: "Exports the person made of a household that stays. Their files are removed from storage too." },
  { key: "household_export_audit_log.actor", scope: "user", sql: `UPDATE household_export_audit_log SET actor = NULL WHERE actor = $1`, params: (c) => [c.userId], why: "The household's export history stays; the actor is cleared." },
  { key: "deletion_requests.requested_by", scope: "user", sql: `UPDATE deletion_requests SET requested_by = NULL WHERE requested_by = $1`, params: (c) => [c.userId], why: "A remaining household's deletion history stays; the requester is cleared." },
  { key: "deletion_audit_log.actor", scope: "user", sql: `UPDATE deletion_audit_log SET actor = NULL WHERE actor = $1`, params: (c) => [c.userId], why: "As above." },
  { key: "claim_evidence_audit_log.actor", scope: "user", sql: `UPDATE claim_evidence_audit_log SET actor = '${REDACTED}' WHERE actor = $1::text`, params: (c) => [c.userId], why: "A remaining household's evidence history stays; the actor is replaced by a label." },
  { key: "policy_document_audit_log.actor", scope: "user", sql: `UPDATE policy_document_audit_log SET actor = '${REDACTED}' WHERE actor = $1::text`, params: (c) => [c.userId], why: "As above, for document history." },
  { key: "claim_reviewers.user_id", alsoCovers: ["claim_review_assignments.reviewer_user_id"], scope: "user", sql: `DELETE FROM claim_reviewers WHERE user_id = $1`, params: (c) => [c.userId], why: "A reviewer record (its assignments cascade)." },
];

/** Identity-looking columns that are deliberately left, and why. Nothing here names a person, email or household. */
export const ACCOUNT_DATA_KEPT: { key: string; why: string }[] = [
  { key: "admin_audit_log.admin_ref", why: "The record that an admin deleted an account. Keyed-hash references only, never an email, name or id." },
  { key: "admin_audit_log.target_ref", why: "As above: a keyed hash that cannot be turned back into the account without the server's secret." },
  { key: "claim_reviewer_audit_log.account_id", why: "Staff-access log, append-only by design (the database refuses edits and deletes). It holds opaque ids only (household, claim, reviewer), no names, emails or document content." },
  { key: "claim_reviewer_audit_log.reviewer_user_id", why: "As above: kept so staff access to household data stays provable after the household is gone." },
  { key: "claim_reviewer_audit_log.actor", why: "As above: opaque ids only, append-only by design." },
  { key: "storage_cleanup_audit_log.actor", why: "The storage-cleanup operator's own log (operator label, redacted file path); nothing about a household." },
];

/** Columns that can name a PERSON. They matter in every table, because a household that stays keeps rows a leaving member wrote. */
export const PERSON_COLUMN = /^(user_id|actor|requested_by|invited_by|accepted_by|created_by|owner_id|.*_user_id)$/;
/** Columns that name a household, a pseudonym of one, an email or a stored file. They matter in tables that are not removed by a household's own deletion. */
export const HOUSEHOLD_COLUMN = /^(account_id|household_id|household_ref|resource_ref|email|bucket_key|job_id|storage_key)$/;
