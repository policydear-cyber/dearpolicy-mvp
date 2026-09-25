/**
 * The household-facing review status of each policy-definition document.
 * Returns only one of four fixed statuses per document -- never who the
 * reviewer is, never their notes, never the decision's reason.
 */
import { query } from "@/lib/db/client";
import { ensureCriticalIllnessSchema } from "@/lib/claims/evidence/ci-schema";
import { ensureDisabilitySchema } from "@/lib/claims/evidence/disability-schema";
import type { HouseholdReviewStatus } from "./copy";
import { ensureClaimReviewerSchema } from "./schema";

/** A decision that settles the definition question either way. Every other
 * stored result (needs_review, insufficient_evidence, ...) asks for more. */
const SETTLED_RESULTS = new Set(["matches", "does_not_match"]);

export async function loadHouseholdReviewStatuses(accountId: string, claimSessionId: string, documentIds: string[]): Promise<Map<string, HouseholdReviewStatus>> {
  const statuses = new Map<string, HouseholdReviewStatus>();
  if (documentIds.length === 0) return statuses;
  await ensureClaimReviewerSchema();
  await ensureCriticalIllnessSchema();
  await ensureDisabilitySchema();

  // The most recent ACTIVE (not superseded) decision per document decides.
  const decisions = await query<{ evidence_document_id: string; result: string }>(
    `SELECT DISTINCT ON (evidence_document_id) evidence_document_id, result FROM (
        SELECT evidence_document_id::text AS evidence_document_id, result, reviewed_at FROM claim_cause_definition_matches
         WHERE account_id=$1 AND claim_session_id=$2 AND superseded_at IS NULL AND evidence_document_id=ANY($3::uuid[])
        UNION ALL
        SELECT evidence_document_id::text, result, reviewed_at FROM claim_ci_definition_matches
         WHERE account_id=$1 AND claim_session_id=$2 AND superseded_at IS NULL AND evidence_document_id=ANY($3::uuid[])
        UNION ALL
        SELECT evidence_document_id::text, result, reviewed_at FROM claim_disability_definition_matches
         WHERE account_id=$1 AND claim_session_id=$2 AND superseded_at IS NULL AND evidence_document_id=ANY($3::uuid[])
     ) decisions ORDER BY evidence_document_id, reviewed_at DESC`,
    [accountId, claimSessionId, documentIds],
  );
  for (const d of decisions.rows) statuses.set(d.evidence_document_id, SETTLED_RESULTS.has(d.result) ? "reviewed" : "more_evidence_required");

  const assignments = await query<{ evidence_document_id: string | null }>(
    `SELECT a.evidence_document_id::text AS evidence_document_id
       FROM claim_review_assignments a JOIN claim_reviewers r ON r.user_id=a.reviewer_user_id AND r.status='active'
      WHERE a.account_id=$1 AND a.claim_session_id=$2 AND a.status='active' AND a.revoked_at IS NULL AND a.expires_at > now()
        AND NOT EXISTS (SELECT 1 FROM household_members hm WHERE hm.household_id=a.account_id AND hm.user_id=a.reviewer_user_id)`,
    [accountId, claimSessionId],
  );
  const wholeClaim = assignments.rows.some((a) => a.evidence_document_id === null);
  const assigned = new Set(assignments.rows.map((a) => a.evidence_document_id).filter((id): id is string => id !== null));
  for (const id of documentIds) {
    if (statuses.has(id)) continue;
    statuses.set(id, wholeClaim || assigned.has(id) ? "in_review" : "awaiting_assignment");
  }
  return statuses;
}
