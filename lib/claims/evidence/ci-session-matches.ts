/**
 * Loads the currently-active, reviewer-confirmed CIDefinitionMatch records
 * for one family member/claim, straight from claim_ci_definition_matches
 * -- the single source of truth -- for lib/claims/orchestrator.ts to feed
 * into ClaimFacts.ciDefinitionMatches on every chat turn, in place of
 * whatever might already be sitting in the stored claim_sessions.facts
 * JSON blob. See lib/claims/evidence/session-matches.ts's identical
 * rationale for causeDefinitionMatches, and lib/claims/types.ts's doc
 * comment on ciDefinitionMatches: never set from chat text or any model
 * output, always reloaded fresh here on every turn, which is also what
 * makes invalidation (a superseded document, a corrected match) take
 * effect immediately with no separate cache-busting step anywhere.
 */
import type { CIDefinitionMatch } from "@/lib/claims/calculators/evidence";
import { loadActiveCIDefinitionMatches } from "./store";

export async function loadCIDefinitionMatchesForFacts(accountId: string, familyMemberId: string, claimSessionId: string): Promise<CIDefinitionMatch[]> {
  const rows = await loadActiveCIDefinitionMatches(accountId, familyMemberId, claimSessionId);
  return rows.map((row) => ({
    familyMemberId: row.family_member_id,
    claimEventId: row.claim_session_id,
    contractId: row.contract_id,
    coverageId: row.coverage_id ?? undefined,
    benefitCode: row.benefit_code,
    illnessName: row.illness_name,
    medicalEvidence: row.medical_evidence,
    definitionEvidence: row.definition_evidence,
    result: row.result,
    reviewedAt: row.reviewed_at,
  }));
}
