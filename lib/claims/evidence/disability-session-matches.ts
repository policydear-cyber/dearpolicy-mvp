/**
 * Loads the currently-active, reviewer-confirmed DisabilityDefinitionMatch
 * records for one family member/claim, straight from
 * claim_disability_definition_matches -- the single source of truth --
 * for lib/claims/orchestrator.ts to feed into
 * ClaimFacts.disabilityDefinitionMatches on every chat turn, in place of
 * whatever might already be sitting in the stored claim_sessions.facts
 * JSON blob. See lib/claims/evidence/ci-session-matches.ts's identical
 * rationale.
 */
import type { DisabilityDefinitionMatch } from "@/lib/claims/calculators/evidence";
import { loadActiveDisabilityDefinitionMatches, loadEvidenceProvenanceContext } from "./store";
import { resolveMatchProvenance } from "./extraction-provenance";

export async function loadDisabilityDefinitionMatchesForFacts(accountId: string, familyMemberId: string, claimSessionId: string): Promise<DisabilityDefinitionMatch[]> {
  const rows = await loadActiveDisabilityDefinitionMatches(accountId, familyMemberId, claimSessionId);
  // Provenance is re-bound to the CURRENT document state on every read --
  // see resolveMatchProvenance(). No rows means no extra query.
  const contexts = await loadEvidenceProvenanceContext(accountId, rows.map((row) => row.evidence_document_id));
  return rows.map((row) => {
    const provenance = resolveMatchProvenance(row.evidence_provenance, contexts.get(row.evidence_document_id), {
      documentId: row.evidence_document_id, familyMemberId: row.family_member_id, claimSessionId: row.claim_session_id,
    });
    const match: DisabilityDefinitionMatch = {
      familyMemberId: row.family_member_id,
      claimEventId: row.claim_session_id,
      contractId: row.contract_id,
      coverageId: row.coverage_id ?? undefined,
      benefitCode: row.benefit_code,
      matchKey: row.match_key,
      medicalEvidence: row.medical_evidence,
      definitionEvidence: row.definition_evidence,
      result: row.result,
      reviewedAt: row.reviewed_at,
    };
    if (provenance) match.provenance = provenance;
    return match;
  });
}
