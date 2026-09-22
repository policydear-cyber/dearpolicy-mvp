/**
 * Loads the currently-active, reviewer-confirmed CauseDefinitionMatch
 * records for one family member/claim, straight from
 * claim_cause_definition_matches -- the single source of truth -- for
 * lib/claims/orchestrator.ts to feed into ClaimFacts.causeDefinitionMatches
 * on every chat turn, in place of whatever might already be sitting in the
 * stored claim_sessions.facts JSON blob. That JSON blob is convenient
 * storage but is never itself the source of truth for a fact this
 * sensitive -- see lib/claims/facts.ts's own comment on why
 * causeDefinitionMatches is never set from chat text -- and reloading it
 * fresh here on every turn is also what makes invalidation (a superseded
 * document, a corrected match) take effect immediately, with no separate
 * cache-busting step anywhere.
 */
import type { CauseDefinitionMatch } from "@/lib/claims/calculators/evidence";
import { loadActiveCauseDefinitionMatches } from "./store";

export async function loadCauseDefinitionMatchesForFacts(accountId: string, familyMemberId: string, claimSessionId: string): Promise<CauseDefinitionMatch[]> {
  const rows = await loadActiveCauseDefinitionMatches(accountId, familyMemberId, claimSessionId);
  return rows.map((row) => ({
    familyMemberId: row.family_member_id,
    claimEventId: row.claim_session_id,
    contractId: row.contract_id,
    coverageId: row.coverage_id ?? undefined,
    causeEvidence: row.cause_evidence,
    definitionEvidence: row.definition_evidence,
    result: row.result,
    reviewedAt: row.reviewed_at,
  }));
}
