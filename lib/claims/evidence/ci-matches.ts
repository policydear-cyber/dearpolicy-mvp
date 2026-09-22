/**
 * The ONLY place a CIDefinitionMatch is ever finalised -- the
 * critical-illness analogue of lib/claims/evidence/matches.ts's
 * confirmCauseDefinitionMatch(). Never reads chat text, never calls a
 * model, and is reachable only from an explicit reviewer action (see
 * app/api/claims/evidence/[id]/ci-match/route.ts). Deterministic
 * cross-scope re-validation happens twice: once here, and again,
 * independently, inside calculateCriticalIllness() itself at calculation
 * time (see lib/claims/calculators/critical-illness.ts) -- exactly the
 * two-deterministic-checks pattern confirmCauseDefinitionMatch() already
 * uses for accidental death.
 *
 * The CI DEFINITION evidence (which exact clause, which exact illness
 * name, which exact page) is never taken from the reviewer's request body
 * -- it is derived here, server-side, from the policy's CURRENT wording
 * via lib/claims/ci-evidence.ts, the same module lib/claims/ci-rules.ts
 * uses to build the definition evidence a calculation will independently
 * check a stored match against. A reprocessed document whose chunk id or
 * page changes therefore invalidates an old match automatically, the
 * moment calculateCriticalIllness()'s own `sameDefinition` check runs --
 * no separate invalidation step is required here.
 *
 * A match is scoped to one exact (family member, claim, contract,
 * coverage, benefit code, illness name) tuple -- confirming a match for
 * "Major Cancer" never touches, supersedes, or unlocks a calculation for
 * "Early Stage Cancer" under the very same policy and claim. See
 * recordCIDefinitionMatch()'s own doc comment in ./store.ts.
 */
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { loadCIRuleEvidence } from "@/lib/claims/ci-evidence";
import { validateMedicalEvidence, validatePolicyEvidence, type CIDefinitionMatchResult } from "@/lib/claims/calculators/evidence";
import { appendClaimEvidenceAudit } from "./audit";
import { getScopedEvidenceDocument, getLatestExtraction, recordCIDefinitionMatch, transitionEvidenceStatus } from "./store";
import { isMedicalEvidenceDocumentType, type ClaimEvidenceExtractedFields } from "./types";

export class ClaimEvidenceMatchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** Reviewer-confirmed fields win; anything the reviewer has not touched
 * falls back to the model's (already citation-verified) proposal -- see
 * lib/claims/evidence/matches.ts's identical helper and
 * lib/claims/evidence/store.ts's `correctExtraction()` doc comment for why
 * this direction, never the reverse. */
function effectiveFields(extracted: ClaimEvidenceExtractedFields, reviewed: Partial<ClaimEvidenceExtractedFields> | null): ClaimEvidenceExtractedFields {
  return reviewed ? { ...extracted, ...reviewed } : extracted;
}

export async function confirmCIDefinitionMatch(args: {
  accountId: string;
  reviewerName: string;
  familyMemberId: string;
  claimSessionId: string;
  evidenceDocumentId: string;
  contractId: string;
  coverageId: string | null;
  /** The exact calculator-facing benefit this reviewer decision is
   * scoped to -- must equal a lib/claims/ci-evidence.ts rule's
   * benefitCode for this coverage, or DEFINITION_EVIDENCE_NOT_AVAILABLE
   * is thrown. Never inferred from the document or the illness name
   * alone. */
  benefitCode: "ci-major" | "ci-early" | "ci-intermediate";
  /** The exact illness name this policy's own wording uses for the
   * benefit named above -- must equal the resolved rule's illnessName
   * verbatim (see lib/claims/ci-evidence.ts's findCIRules()); a reviewer
   * cannot match against an illness name the policy's current wording
   * does not itself state. */
  illnessName: string;
  result: CIDefinitionMatchResult;
  reason?: string | null;
  /** Optional reviewer override/refinement of exactly where in the
   * document the diagnosis is stated -- defaults to the extraction's own
   * (already citation-verified) page for exactDiagnosis. */
  medicalEvidenceOverride?: { pageStart?: number; pageEnd?: number; sourceLocation?: string };
}) {
  const document = await getScopedEvidenceDocument({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId, id: args.evidenceDocumentId,
  });
  if (!document) throw new ClaimEvidenceMatchError("EVIDENCE_NOT_FOUND", "That claim-evidence document was not found for this family member and claim.");
  if (!isMedicalEvidenceDocumentType(document.document_type)) {
    throw new ClaimEvidenceMatchError("NOT_MEDICAL_EVIDENCE", "That document is not medical evidence, so it cannot be matched against a critical-illness policy definition.");
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
  const ciRules = await loadCIRuleEvidence(args.accountId, args.familyMemberId, coverages);
  const rule = ciRules.find((r) => r.coverageId === coverage.id && r.benefitCode === args.benefitCode && r.illnessName === args.illnessName);
  if (!rule) {
    throw new ClaimEvidenceMatchError("DEFINITION_EVIDENCE_NOT_AVAILABLE", "DearPolicy has not verified this policy's own wording for this exact critical-illness benefit and illness yet, so no match can be confirmed against it.");
  }
  const definitionEvidence = {
    policyId: rule.citation.policyId, chunkId: rule.citation.chunkId,
    pageStart: rule.citation.pageStart, pageEnd: rule.citation.pageEnd, label: rule.citation.evidenceLabel,
  };
  const diagnosisCitation = fields.pageCitations.find((c) => c.field === "exactDiagnosis");
  const medicalEvidence = {
    documentId: document.id, documentType: document.document_type,
    familyMemberId: args.familyMemberId, claimEventId: args.claimSessionId,
    pageStart: args.medicalEvidenceOverride?.pageStart ?? diagnosisCitation?.pageStart,
    pageEnd: args.medicalEvidenceOverride?.pageEnd ?? diagnosisCitation?.pageEnd,
    sourceLocation: args.medicalEvidenceOverride?.sourceLocation,
  };

  const definitionCheck = validatePolicyEvidence(definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) throw new ClaimEvidenceMatchError(definitionCheck.reasonCode, definitionCheck.message);
  const medicalCheck = validateMedicalEvidence(medicalEvidence);
  if (!medicalCheck.valid) throw new ClaimEvidenceMatchError(medicalCheck.reasonCode, medicalCheck.message);

  const match = await recordCIDefinitionMatch({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId,
    contractId: args.contractId, coverageId: args.coverageId, evidenceDocumentId: document.id,
    benefitCode: args.benefitCode, illnessName: args.illnessName,
    medicalEvidence: medicalCheck.evidence, definitionEvidence: definitionCheck.evidence,
    result: args.result, reviewedBy: args.reviewerName, reason: args.reason ?? null,
  });

  await appendClaimEvidenceAudit(args.accountId, {
    actor: args.reviewerName, action: "ci_definition_match_recorded", evidenceDocumentId: document.id,
    claimSessionId: args.claimSessionId, contractId: args.contractId, coverageId: args.coverageId,
    reasonCode: args.result, reason: args.reason ?? undefined,
    newValue: { result: args.result, matchId: match.id, benefitCode: args.benefitCode, illnessName: args.illnessName },
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
