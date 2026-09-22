/**
 * Structurally validated evidence references for death-benefit and
 * accidental-death calculations.
 *
 * A calculator must never accept an evidence object on the strength of it
 * merely existing. Under TypeScript's structural typing, an empty object
 * `{}` satisfies a type whose fields are all optional -- so a check like
 * `if (!input.ruleEvidence)` passes for `{}` even though it proves nothing.
 * Every field below is therefore validated AT RUNTIME, not just typed: the
 * input may come from LLM extraction, stored JSON, or an API payload, none
 * of which TypeScript's compile-time types can police. A label alone is
 * never evidence, and a missing, blank, zero/negative, or reversed field
 * fails closed rather than being silently accepted.
 */

export type EvidenceBlockReasonCode =
  | "MALFORMED_RULE_EVIDENCE"
  | "MALFORMED_OWNERSHIP_EVIDENCE"
  | "MALFORMED_CAUSE_EVIDENCE"
  | "MALFORMED_POLICY_DEFINITION_EVIDENCE";

export type EvidenceValidation<T> =
  | { valid: true; evidence: T }
  | { valid: false; reasonCode: EvidenceBlockReasonCode; message: string };

/** Evidence for a policy's own rule wording -- a payout formula, a cap, or
 * an accidental-death definition clause. All four fields are required and
 * independently checked: a partially-filled object, a blank/whitespace-only
 * ID, or a reversed page range are all rejected the same as a missing
 * field. */
export type ValidPolicyEvidenceRef = {
  policyId: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  label?: string;
};

/** Evidence that a specific family member owns a specific, persistent
 * coverage record. `coverageId` stands in for "a persistent coverageId or
 * equivalent ownership-record ID" -- whatever the caller's stable
 * identifier for the owned record is. */
export type ValidOwnershipEvidenceRef = {
  policyId: string;
  coverageId: string;
  familyMemberId?: string;
  label?: string;
};

export type CauseOfDeathDocumentType =
  | "death_certificate"
  | "police_report"
  | "coroners_report"
  | "medical_examiner_report"
  | "other_official_document";

const SUPPORTED_CAUSE_DOCUMENT_TYPES = new Set<CauseOfDeathDocumentType>([
  "death_certificate", "police_report", "coroners_report", "medical_examiner_report", "other_official_document",
]);

/** Evidence that an official cause-of-death document was actually reviewed,
 * tied to the specific family member and claim it was reviewed for. Either
 * a valid page range or a structured source location is required -- a
 * label describing the document is not, by itself, a source location. */
export type ValidCauseEvidenceRef = {
  documentId: string;
  documentType: CauseOfDeathDocumentType;
  pageStart?: number;
  pageEnd?: number;
  sourceLocation?: string;
  familyMemberId: string;
  claimEventId: string;
};

export type CauseDefinitionMatchResult = "matches" | "does_not_match" | "needs_review";

/**
 * A policy-specific record that an official, reviewed cause-of-death
 * document has been checked against ONE specific policy's own
 * accidental-death definition.
 *
 * A cause can satisfy one policy's definition and not another's, so this is
 * never a single global flag: `ClaimFacts.causeDefinitionMatches` keeps a
 * list of these, one per contract/coverage/claim/family-member combination
 * that has actually been reviewed. `causeEvidence` and `definitionEvidence`
 * are deliberately typed `unknown` here rather than as the validated
 * `Valid*EvidenceRef` shapes: this record round-trips through JSON storage,
 * so its declared TypeScript shape can never be trusted at calculation
 * time. `calculateAccidentalDeath()` re-validates every field of a match
 * independently before it can unlock an amount.
 */
export type CauseDefinitionMatch = {
  familyMemberId: string;
  claimEventId: string;
  contractId: string;
  coverageId?: string;
  causeEvidence: unknown;
  definitionEvidence: unknown;
  result: CauseDefinitionMatchResult;
  reviewedAt: string;
};

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/** Validates evidence for a policy's own rule wording (a payout formula, a
 * cap, or an accidental-death definition clause). The caller supplies which
 * reason code to report so the same structural check can distinguish an
 * ordinary payout-rule problem from a policy-definition problem. */
export function validatePolicyEvidence(
  value: unknown,
  reasonCode: "MALFORMED_RULE_EVIDENCE" | "MALFORMED_POLICY_DEFINITION_EVIDENCE" = "MALFORMED_RULE_EVIDENCE",
): EvidenceValidation<ValidPolicyEvidenceRef> {
  const kind = reasonCode === "MALFORMED_POLICY_DEFINITION_EVIDENCE" ? "policy-definition" : "policy-rule";
  if (!value || typeof value !== "object") return { valid: false, reasonCode, message: `No ${kind} evidence was supplied.` };
  const v = value as Record<string, unknown>;
  if (!nonEmptyString(v.policyId)) return { valid: false, reasonCode, message: `The ${kind} evidence is missing a policy ID.` };
  if (!nonEmptyString(v.chunkId)) return { valid: false, reasonCode, message: `The ${kind} evidence is missing a source chunk ID.` };
  if (!validPage(v.pageStart)) return { valid: false, reasonCode, message: `The ${kind} evidence has no valid starting page.` };
  if (!validPage(v.pageEnd) || (v.pageEnd as number) < (v.pageStart as number)) {
    return { valid: false, reasonCode, message: `The ${kind} evidence has an invalid or reversed page range.` };
  }
  return {
    valid: true,
    evidence: {
      policyId: (v.policyId as string).trim(),
      chunkId: (v.chunkId as string).trim(),
      pageStart: v.pageStart as number,
      pageEnd: v.pageEnd as number,
      label: nonEmptyString(v.label) ? (v.label as string).trim() : undefined,
    },
  };
}

/** Validates evidence that a specific family member owns a specific,
 * persistent coverage record. A label alone, or an object missing a
 * persistent coverage/ownership-record ID, is rejected. */
export function validateOwnershipEvidence(value: unknown): EvidenceValidation<ValidOwnershipEvidenceRef> {
  if (!value || typeof value !== "object") return { valid: false, reasonCode: "MALFORMED_OWNERSHIP_EVIDENCE", message: "No ownership evidence was supplied." };
  const v = value as Record<string, unknown>;
  if (!nonEmptyString(v.policyId)) return { valid: false, reasonCode: "MALFORMED_OWNERSHIP_EVIDENCE", message: "The ownership evidence is missing a policy ID." };
  if (!nonEmptyString(v.coverageId)) return { valid: false, reasonCode: "MALFORMED_OWNERSHIP_EVIDENCE", message: "The ownership evidence is missing a persistent coverage/ownership-record ID." };
  return {
    valid: true,
    evidence: {
      policyId: (v.policyId as string).trim(),
      coverageId: (v.coverageId as string).trim(),
      familyMemberId: nonEmptyString(v.familyMemberId) ? (v.familyMemberId as string).trim() : undefined,
      label: nonEmptyString(v.label) ? (v.label as string).trim() : undefined,
    },
  };
}

/** Validates evidence that an official cause-of-death document was actually
 * reviewed. Requires a document ID, a supported document type, a valid
 * source page or structured source location, and both a family-member and
 * a claim-event association -- a label alone is never evidence. */
export function validateCauseEvidence(value: unknown): EvidenceValidation<ValidCauseEvidenceRef> {
  if (!value || typeof value !== "object") return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "No cause-of-death evidence was supplied." };
  const v = value as Record<string, unknown>;
  if (!nonEmptyString(v.documentId)) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The cause-of-death evidence is missing a document ID." };
  if (!nonEmptyString(v.documentType) || !SUPPORTED_CAUSE_DOCUMENT_TYPES.has(v.documentType as CauseOfDeathDocumentType)) {
    return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The cause-of-death evidence does not name a supported document type." };
  }
  const pageStartOk = v.pageStart === undefined || validPage(v.pageStart);
  const pageEndOk = v.pageEnd === undefined || (validPage(v.pageEnd) && (!validPage(v.pageStart) || (v.pageEnd as number) >= (v.pageStart as number)));
  const hasValidPage = validPage(v.pageStart) && pageEndOk;
  const hasSourceLocation = nonEmptyString(v.sourceLocation);
  if (!pageStartOk || !pageEndOk) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The cause-of-death evidence has an invalid or reversed page range." };
  if (!hasValidPage && !hasSourceLocation) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The cause-of-death evidence has no valid source page or structured source location." };
  if (!nonEmptyString(v.familyMemberId)) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The cause-of-death evidence is not associated with a family member." };
  if (!nonEmptyString(v.claimEventId)) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The cause-of-death evidence is not associated with a claim event." };
  return {
    valid: true,
    evidence: {
      documentId: (v.documentId as string).trim(),
      documentType: v.documentType as CauseOfDeathDocumentType,
      pageStart: validPage(v.pageStart) ? (v.pageStart as number) : undefined,
      pageEnd: validPage(v.pageEnd) ? (v.pageEnd as number) : undefined,
      sourceLocation: hasSourceLocation ? (v.sourceLocation as string).trim() : undefined,
      familyMemberId: (v.familyMemberId as string).trim(),
      claimEventId: (v.claimEventId as string).trim(),
    },
  };
}
