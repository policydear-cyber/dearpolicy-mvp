/**
 * The ONLY place a CauseDefinitionMatch is ever finalised.
 *
 * Per the product requirement, "The LLM may propose a classification. Only
 * deterministic rules or an explicit reviewer action may finalise" one of
 * `matches` / `does_not_match` / `needs_review`. This module never reads
 * chat text, never calls a model, and is reachable only from an explicit
 * reviewer action (see app/api/claims/evidence/[id]/match/route.ts) -- the
 * "deterministic rule" half of that requirement is the structural
 * validation and cross-scope checks performed here and, independently
 * again, inside calculateAccidentalDeath() itself (see
 * lib/claims/calculators/accidental-death.ts) at calculation time.
 *
 * The accidental-death DEFINITION evidence is never taken from the
 * reviewer's request body -- it is derived here, server-side, from the
 * policy's CURRENT wording via lib/claims/death-evidence.ts, the exact same
 * function lib/claims/rules.ts uses to build the definition evidence a
 * calculation will independently check a stored match against. That is
 * what makes "a new policy-document version invalidates the old match"
 * hold automatically: if the wording is reprocessed and its chunk id or
 * page changes, a match recorded against the old citation simply stops
 * equalling the citation recomputed at calculation time (see
 * calculateAccidentalDeath()'s `sameDefinition` check), with no separate
 * invalidation step required here.
 */
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { loadDeathEvidence } from "@/lib/claims/death-evidence";
import { validateCauseEvidence, validatePolicyEvidence, type CauseDefinitionMatchResult } from "@/lib/claims/calculators/evidence";
import { appendClaimEvidenceAudit } from "./audit";
import { provenanceSnapshotForExtraction } from "./extraction-provenance";
import { getScopedEvidenceDocument, getLatestExtraction, recordCauseDefinitionMatch, transitionEvidenceStatus } from "./store";
import type { ClaimEvidenceExtractedFields } from "./types";

export class ClaimEvidenceMatchError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

/** Reviewer-confirmed fields win; anything the reviewer has not touched
 * falls back to the model's (already citation-verified) proposal. Never
 * the other way around -- see lib/claims/evidence/store.ts's
 * `correctExtraction()` doc comment. */
function effectiveFields(extracted: ClaimEvidenceExtractedFields, reviewed: Partial<ClaimEvidenceExtractedFields> | null): ClaimEvidenceExtractedFields {
  return reviewed ? { ...extracted, ...reviewed } : extracted;
}

export async function confirmCauseDefinitionMatch(args: {
  accountId: string;
  reviewerName: string;
  familyMemberId: string;
  claimSessionId: string;
  evidenceDocumentId: string;
  contractId: string;
  coverageId: string | null;
  result: CauseDefinitionMatchResult;
  reason?: string | null;
  /** Optional reviewer override/refinement of exactly where in the
   * document the cause of death is stated -- defaults to the extraction's
   * own (already citation-verified) page for statedCauseOfDeath. */
  causeEvidenceOverride?: { pageStart?: number; pageEnd?: number; sourceLocation?: string };
}) {
  const document = await getScopedEvidenceDocument({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId, id: args.evidenceDocumentId,
  });
  if (!document) throw new ClaimEvidenceMatchError("EVIDENCE_NOT_FOUND", "That claim-evidence document was not found for this family member and claim.");
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
  const deathEvidence = await loadDeathEvidence(args.accountId, args.familyMemberId, coverages);
  const rule = deathEvidence.rules.find((r) => r.coverageId === coverage.id && r.benefit === "gpa-accidental-death");
  if (!rule) {
    throw new ClaimEvidenceMatchError("DEFINITION_EVIDENCE_NOT_AVAILABLE", "DearPolicy has not verified this policy's own accidental-death definition wording yet, so no match can be confirmed against it.");
  }
  const definitionEvidence = {
    policyId: rule.citation.policyId, chunkId: rule.citation.chunkId,
    pageStart: rule.citation.pageStart, pageEnd: rule.citation.pageEnd, label: rule.citation.evidenceLabel,
  };
  const causeCitation = fields.pageCitations.find((c) => c.field === "statedCauseOfDeath");
  const causeEvidence = {
    documentId: document.id, documentType: document.document_type,
    familyMemberId: args.familyMemberId, claimEventId: args.claimSessionId,
    pageStart: args.causeEvidenceOverride?.pageStart ?? causeCitation?.pageStart,
    pageEnd: args.causeEvidenceOverride?.pageEnd ?? causeCitation?.pageEnd,
    sourceLocation: args.causeEvidenceOverride?.sourceLocation,
  };

  const definitionCheck = validatePolicyEvidence(definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) throw new ClaimEvidenceMatchError(definitionCheck.reasonCode, definitionCheck.message);
  const causeCheck = validateCauseEvidence(causeEvidence);
  if (!causeCheck.valid) throw new ClaimEvidenceMatchError(causeCheck.reasonCode, causeCheck.message);

  const match = await recordCauseDefinitionMatch({
    accountId: args.accountId, familyMemberId: args.familyMemberId, claimSessionId: args.claimSessionId,
    contractId: args.contractId, coverageId: args.coverageId, evidenceDocumentId: document.id,
    causeEvidence: causeCheck.evidence, definitionEvidence: definitionCheck.evidence,
    result: args.result, reviewedBy: args.reviewerName, reason: args.reason ?? null,
    // Server-side, from the stored extraction this review read -- never
    // from the request. Null (no persisted provenance) keeps amounts blocked.
    evidenceProvenance: provenanceSnapshotForExtraction(extraction, document.id),
  });

  await appendClaimEvidenceAudit(args.accountId, {
    actor: args.reviewerName, action: "cause_definition_match_recorded", evidenceDocumentId: document.id,
    claimSessionId: args.claimSessionId, contractId: args.contractId, coverageId: args.coverageId,
    reasonCode: args.result, reason: args.reason ?? undefined, newValue: { result: args.result, matchId: match.id },
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
