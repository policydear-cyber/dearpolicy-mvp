/**
 * The ONLY place a DisabilityDefinitionMatch is ever finalised -- the
 * disability analogue of lib/claims/evidence/ci-matches.ts's
 * confirmCIDefinitionMatch(). Never reads chat text, never calls a model,
 * and is reachable only from an explicit reviewer action (see
 * app/api/claims/evidence/[id]/disability-match/route.ts). Deterministic
 * cross-scope re-validation happens twice: once here, and again,
 * independently, inside calculateDisabilityBenefit()/calculateDisabilityIncome()
 * themselves at calculation time -- exactly the two-deterministic-checks
 * pattern confirmCIDefinitionMatch() already uses.
 *
 * The disability DEFINITION evidence (which exact clause, which exact
 * benefit code, which exact match key, which exact page) is never taken
 * from the reviewer's request body -- it is derived here, server-side,
 * from the policy's CURRENT wording via lib/claims/disability-evidence.ts,
 * the same module lib/claims/disability-rules.ts uses to build the
 * definition evidence a calculation will independently check a stored
 * match against. A reprocessed document whose chunk id or page changes
 * therefore invalidates an old match automatically, the moment
 * calculateDisabilityBenefit()'s/calculateDisabilityIncome()'s own
 * `sameDefinition` check runs -- no separate invalidation step is required
 * here.
 *
 * A match is scoped to one exact (family member, claim, contract,
 * coverage, benefit code, match key) tuple -- confirming a match for the
 * TPD definition never touches, supersedes, or unlocks a calculation for a
 * specific schedule-of-injuries row, or for disability income, under the
 * very same policy and claim. See recordDisabilityDefinitionMatch()'s own
 * doc comment in ./store.ts.
 *
 * `matchKey` is NEVER taken from freeform reviewer text for a
 * "ppd-schedule" benefit -- it must equal, verbatim, one of the exact
 * schedule-row codes lib/claims/disability-evidence.ts's own
 * findDisabilityRules() already resolved from this policy's own wording,
 * which is what "strict injury-schedule matching" (see this PR's own
 * documented safety boundary) means in practice: a reviewer confirms which
 * ALREADY-EVIDENCED row an injury matches, they can never invent or
 * fuzzily paraphrase a new one here.
 */
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { loadDisabilityEvidence } from "@/lib/claims/disability-evidence";
import { validateMedicalEvidence, validatePolicyEvidence, type DisabilityDefinitionMatchResult } from "@/lib/claims/calculators/evidence";
import { appendClaimEvidenceAudit } from "./audit";
import { provenanceSnapshotForExtraction } from "./extraction-provenance";
import { getScopedEvidenceDocument, getLatestExtraction, recordDisabilityDefinitionMatch, transitionEvidenceStatus } from "./store";
import { isMedicalEvidenceDocumentType, type ClaimEvidenceExtractedFields } from "./types";

export class ClaimEvidenceMatchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const DISABILITY_BENEFIT_CODES = ["tpd-lump-sum", "ppd-schedule", "di-monthly"] as const;
type DisabilityBenefitCode = (typeof DISABILITY_BENEFIT_CODES)[number];

/** Reviewer-confirmed fields win; anything the reviewer has not touched
 * falls back to the model's (already citation-verified) proposal -- see
 * lib/claims/evidence/ci-matches.ts's identical helper. */
function effectiveFields(extracted: ClaimEvidenceExtractedFields, reviewed: Partial<ClaimEvidenceExtractedFields> | null): ClaimEvidenceExtractedFields {
  return reviewed ? { ...extracted, ...reviewed } : extracted;
}

export async function confirmDisabilityDefinitionMatch(args: {
  accountId: string;
  reviewerName: string;
  familyMemberId: string;
  claimSessionId: string;
  evidenceDocumentId: string;
  contractId: string;
  coverageId: string | null;
  /** The exact calculator-facing benefit this reviewer decision is scoped
   * to -- must equal a lib/claims/disability-evidence.ts rule's
   * benefitCode for this coverage, or DEFINITION_EVIDENCE_NOT_AVAILABLE is
   * thrown. */
  benefitCode: DisabilityBenefitCode;
  /** The exact matchKey this policy's own wording uses -- must equal the
   * resolved rule's matchKey verbatim (the fixed TPD/disability-income
   * sentinel, or the exact schedule-row code -- see
   * lib/claims/disability-evidence.ts's findDisabilityRules()). Never
   * inferred from the document or a freeform description. */
  matchKey: string;
  result: DisabilityDefinitionMatchResult;
  reason?: string | null;
  medicalEvidenceOverride?: { pageStart?: number; pageEnd?: number; sourceLocation?: string };
}) {
  const document = await getScopedEvidenceDocument({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId, id: args.evidenceDocumentId,
  });
  if (!document) throw new ClaimEvidenceMatchError("EVIDENCE_NOT_FOUND", "That claim-evidence document was not found for this family member and claim.");
  if (!isMedicalEvidenceDocumentType(document.document_type)) {
    throw new ClaimEvidenceMatchError("NOT_MEDICAL_EVIDENCE", "That document is not medical evidence, so it cannot be matched against a disability policy definition.");
  }
  if (!["needs_review", "matched"].includes(document.status)) {
    throw new ClaimEvidenceMatchError("EVIDENCE_NOT_READY", "This document has not finished processing yet, or was rejected, so it cannot be matched against a policy definition.");
  }
  if (args.result === "matches" && document.identity_status !== "confirmed") {
    throw new ClaimEvidenceMatchError("IDENTITY_NOT_CONFIRMED", "The document's identity has not been confirmed for this family member, so it cannot be used to confirm a match yet.");
  }

  const extraction = await getLatestExtraction(args.accountId, document.id);
  if (!extraction) throw new ClaimEvidenceMatchError("EXTRACTION_NOT_FOUND", "This document has not been read yet.");
  const fields = effectiveFields(extraction.extracted_fields, extraction.reviewed_fields);

  const coverages = await confirmedOwnedCoverages(args.accountId, args.familyMemberId);
  const coverage = coverages.find((c) => c.id === args.coverageId || (args.coverageId == null && c.policyId === args.contractId));
  if (!coverage || coverage.policyId !== args.contractId) {
    throw new ClaimEvidenceMatchError("COVERAGE_NOT_FOUND", "That coverage was not found under this family member's confirmed policies.");
  }
  const disabilityEvidence = await loadDisabilityEvidence(args.accountId, args.familyMemberId, coverages);
  const rule = disabilityEvidence.rules.find((r) => r.coverageId === coverage.id && r.benefitCode === args.benefitCode && r.matchKey.trim().toLowerCase() === args.matchKey.trim().toLowerCase());
  if (!rule) {
    throw new ClaimEvidenceMatchError("DEFINITION_EVIDENCE_NOT_AVAILABLE", "DearPolicy has not verified this policy's own wording for this exact disability benefit and match key yet, so no match can be confirmed against it.");
  }
  const definitionEvidence = {
    policyId: rule.citation.policyId, chunkId: rule.citation.chunkId,
    pageStart: rule.citation.pageStart, pageEnd: rule.citation.pageEnd, label: rule.citation.evidenceLabel,
  };
  const assessmentCitation = fields.pageCitations.find((c) => c.field === "exactDiagnosis") ?? fields.pageCitations.find((c) => c.field === "diseaseStage");
  const medicalEvidence = {
    documentId: document.id, documentType: document.document_type,
    familyMemberId: args.familyMemberId, claimEventId: args.claimSessionId,
    pageStart: args.medicalEvidenceOverride?.pageStart ?? assessmentCitation?.pageStart,
    pageEnd: args.medicalEvidenceOverride?.pageEnd ?? assessmentCitation?.pageEnd,
    sourceLocation: args.medicalEvidenceOverride?.sourceLocation,
  };

  const definitionCheck = validatePolicyEvidence(definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) throw new ClaimEvidenceMatchError(definitionCheck.reasonCode, definitionCheck.message);
  const medicalCheck = validateMedicalEvidence(medicalEvidence);
  if (!medicalCheck.valid) throw new ClaimEvidenceMatchError(medicalCheck.reasonCode, medicalCheck.message);

  const match = await recordDisabilityDefinitionMatch({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId,
    contractId: args.contractId, coverageId: args.coverageId, evidenceDocumentId: document.id,
    benefitCode: args.benefitCode, matchKey: rule.matchKey,
    medicalEvidence: medicalCheck.evidence, definitionEvidence: definitionCheck.evidence,
    result: args.result, reviewedBy: args.reviewerName, reason: args.reason ?? null,
    // Server-side, from the stored extraction this review read -- never
    // from the request. Null (no persisted provenance) keeps amounts blocked.
    evidenceProvenance: provenanceSnapshotForExtraction(extraction, document.id),
  });

  await appendClaimEvidenceAudit(args.accountId, {
    actor: args.reviewerName, action: "disability_definition_match_recorded", evidenceDocumentId: document.id,
    claimSessionId: args.claimSessionId, contractId: args.contractId, coverageId: args.coverageId,
    reasonCode: args.result, reason: args.reason ?? undefined,
    newValue: { result: args.result, matchId: match.id, benefitCode: args.benefitCode, matchKey: rule.matchKey },
  });

  if (args.result === "matches") {
    const moved = await transitionEvidenceStatus({ accountId: args.accountId, id: document.id, from: "needs_review", to: "matched" });
    if (moved) {
      await appendClaimEvidenceAudit(args.accountId, {
        actor: args.reviewerName, action: "status_transition", evidenceDocumentId: document.id, claimSessionId: args.claimSessionId,
        previousValue: { status: "needs_review" }, newValue: { status: "matched" },
      });
    }
  }
  return match;
}
