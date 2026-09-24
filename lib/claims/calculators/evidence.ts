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

import type { EvidenceProvenance } from "../evidence-authority";

export type EvidenceBlockReasonCode =
  | "MALFORMED_RULE_EVIDENCE"
  | "MALFORMED_OWNERSHIP_EVIDENCE"
  | "MALFORMED_CAUSE_EVIDENCE"
  | "MALFORMED_POLICY_DEFINITION_EVIDENCE"
  | "MALFORMED_MEDICAL_CLAIM_EVIDENCE";

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
  /** Model-execution provenance for the AI extraction this match's
   * reviewed causeEvidence rests on -- see lib/claims/evidence-authority.ts's
   * EvidenceProvenance and evaluateEvidenceAuthority(). Optional only
   * because every existing writer of this type predates this field;
   * absent is treated as EVIDENCE_PROVENANCE_MISSING (fail closed) by any
   * calculator that checks it, never as "no check needed". */
  provenance?: EvidenceProvenance;
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

/**
 * Evidence for a critical-illness claim -- the medical-evidence analogue of
 * `ValidCauseEvidenceRef`/`validateCauseEvidence` above, and
 * `CIDefinitionMatch`/`CIDefinitionMatchResult` the analogue of
 * `CauseDefinitionMatch`/`CauseDefinitionMatchResult`.
 *
 * Critical illness is stricter in one respect death is not: a policy can
 * define dozens of distinct benefit rows (major cancer, an early-stage
 * table, an accelerated benefit, an additional rider, several multi-pay
 * tranches), so a match is scoped to one exact `benefitCode` and
 * `illnessName` as well as to family member/claim/contract/coverage -- a
 * match confirmed for "Major Cancer" can never unlock "Early Stage Cancer",
 * even under the very same policy and the very same claim.
 */

export type MedicalEvidenceDocumentType =
  | "specialist_memo" | "medical_report" | "pathology_report" | "imaging_report"
  | "laboratory_report" | "discharge_summary" | "surgical_report" | "other_medical_evidence";

const SUPPORTED_MEDICAL_DOCUMENT_TYPES = new Set<MedicalEvidenceDocumentType>([
  "specialist_memo", "medical_report", "pathology_report", "imaging_report",
  "laboratory_report", "discharge_summary", "surgical_report", "other_medical_evidence",
]);

/** Evidence that specific, reviewed medical evidence was actually checked
 * for this family member and this claim -- mirrors `ValidCauseEvidenceRef`
 * exactly, with a `documentType` drawn from the medical set instead of the
 * official cause-of-death set. Either a valid page range or a structured
 * source location is required; a label describing the document is not, by
 * itself, a source location. */
export type ValidMedicalEvidenceRef = {
  documentId: string;
  documentType: MedicalEvidenceDocumentType;
  pageStart?: number;
  pageEnd?: number;
  sourceLocation?: string;
  familyMemberId: string;
  claimEventId: string;
};

export function validateMedicalEvidence(value: unknown): EvidenceValidation<ValidMedicalEvidenceRef> {
  if (!value || typeof value !== "object") return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "No medical evidence was supplied." };
  const v = value as Record<string, unknown>;
  if (!nonEmptyString(v.documentId)) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The medical evidence is missing a document ID." };
  if (!nonEmptyString(v.documentType) || !SUPPORTED_MEDICAL_DOCUMENT_TYPES.has(v.documentType as MedicalEvidenceDocumentType)) {
    return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The medical evidence does not name a supported document type." };
  }
  const pageStartOk = v.pageStart === undefined || validPage(v.pageStart);
  const pageEndOk = v.pageEnd === undefined || (validPage(v.pageEnd) && (!validPage(v.pageStart) || (v.pageEnd as number) >= (v.pageStart as number)));
  const hasValidPage = validPage(v.pageStart) && pageEndOk;
  const hasSourceLocation = nonEmptyString(v.sourceLocation);
  if (!pageStartOk || !pageEndOk) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The medical evidence has an invalid or reversed page range." };
  if (!hasValidPage && !hasSourceLocation) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The medical evidence has no valid source page or structured source location." };
  if (!nonEmptyString(v.familyMemberId)) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The medical evidence is not associated with a family member." };
  if (!nonEmptyString(v.claimEventId)) return { valid: false, reasonCode: "MALFORMED_CAUSE_EVIDENCE", message: "The medical evidence is not associated with a claim event." };
  return {
    valid: true,
    evidence: {
      documentId: (v.documentId as string).trim(),
      documentType: v.documentType as MedicalEvidenceDocumentType,
      pageStart: validPage(v.pageStart) ? (v.pageStart as number) : undefined,
      pageEnd: validPage(v.pageEnd) ? (v.pageEnd as number) : undefined,
      sourceLocation: hasSourceLocation ? (v.sourceLocation as string).trim() : undefined,
      familyMemberId: (v.familyMemberId as string).trim(),
      claimEventId: (v.claimEventId as string).trim(),
    },
  };
}

/** Six-valued per the critical-illness policy-matching requirement -- wider
 * than `CauseDefinitionMatchResult`'s three, because clinical comparison
 * carries two distinct kinds of "not yet": evidence that has not been
 * medically reviewed at all (`needs_medical_review`), and evidence that HAS
 * been reviewed but whose comparison against the policy's own wording is
 * unclear (`needs_policy_review`), plus a case with no usable evidence at
 * all (`insufficient_evidence`) distinct from one that is merely unclear
 * (`ambiguous`). Only `matches` may ever unlock a monetary calculation. */
export type CIDefinitionMatchResult = "matches" | "does_not_match" | "needs_medical_review" | "needs_policy_review" | "insufficient_evidence" | "ambiguous";

/**
 * A policy-specific record that reviewed medical evidence has been checked
 * against ONE specific policy's own critical-illness benefit definition,
 * for ONE specific benefit and illness. See `CauseDefinitionMatch`'s doc
 * comment for the general shape and rationale; this is stricter in scope
 * (`benefitCode`/`illnessName`) because one CI policy can define many
 * benefit rows that must never cross-unlock each other.
 */
export type CIDefinitionMatch = {
  familyMemberId: string;
  claimEventId: string;
  contractId: string;
  coverageId?: string;
  /** The exact calculator-facing benefit code this match applies to (e.g.
   * "ci-major", "ci-early", "ci-intermediate", "ci-accelerated",
   * "ci-additional", or a multi-pay tranche code). A match for one code can
   * never unlock a calculation for another. */
  benefitCode: string;
  /** The exact illness/condition name the match was reviewed against, as
   * named in the policy's own schedule. A match for one illness can never
   * unlock another, even under the same benefitCode (e.g. two different
   * cancers under "Major Cancer"). */
  illnessName: string;
  medicalEvidence: unknown;
  definitionEvidence: unknown;
  result: CIDefinitionMatchResult;
  reviewedAt: string;
  /** Model-execution provenance for the AI extraction this match's
   * reviewed medicalEvidence rests on -- see
   * lib/claims/evidence-authority.ts's EvidenceProvenance. Optional only
   * because every existing writer of this type predates this field;
   * absent is treated as EVIDENCE_PROVENANCE_MISSING (fail closed). */
  provenance?: EvidenceProvenance;
};

/**
 * Medical-CLAIM evidence -- distinct from `MedicalEvidenceDocumentType`
 * above, which is clinical evidence supporting a critical-illness
 * DIAGNOSIS. These are the documents a hospital-cash/medical-reimbursement
 * claim is actually proved from: the bill itself, and the records around
 * it. `discharge_summary` and `surgical_report` are deliberately NOT
 * repeated here -- they already exist in `MedicalEvidenceDocumentType` and
 * are reused as-is for a medical claim (see MEDICAL_CLAIM_ELIGIBLE_DOCUMENT_TYPES
 * below), exactly as lib/claims/evidence/types.ts's module doc comment
 * already establishes for the shared pipeline.
 */
export type MedicalClaimDocumentType =
  | "hospital_bill" | "itemised_bill" | "doctor_memo" | "referral" | "pre_authorisation"
  | "procedure_report" | "receipt_payment_proof" | "other_insurer_settlement_statement"
  | "medishield_integrated_shield_settlement_statement";

const SUPPORTED_MEDICAL_CLAIM_DOCUMENT_TYPES = new Set<MedicalClaimDocumentType>([
  "hospital_bill", "itemised_bill", "doctor_memo", "referral", "pre_authorisation",
  "procedure_report", "receipt_payment_proof", "other_insurer_settlement_statement",
  "medishield_integrated_shield_settlement_statement",
]);
/** The full set of document types a medical claim's bill evidence may be
 * drawn from, including the two clinical-evidence types it shares with
 * critical illness. */
const MEDICAL_CLAIM_ELIGIBLE_DOCUMENT_TYPES = new Set<string>([
  ...SUPPORTED_MEDICAL_CLAIM_DOCUMENT_TYPES, "discharge_summary", "surgical_report",
]);

/** Evidence that a specific medical-claim document (a bill, receipt,
 * referral, pre-authorisation, etc.) was actually reviewed for this family
 * member and this claim -- mirrors `ValidMedicalEvidenceRef` exactly. */
export type ValidMedicalClaimEvidenceRef = {
  documentId: string;
  documentType: string;
  pageStart?: number;
  pageEnd?: number;
  sourceLocation?: string;
  familyMemberId: string;
  claimEventId: string;
};

export function validateMedicalClaimEvidence(value: unknown): EvidenceValidation<ValidMedicalClaimEvidenceRef> {
  if (!value || typeof value !== "object") return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "No medical-claim evidence was supplied." };
  const v = value as Record<string, unknown>;
  if (!nonEmptyString(v.documentId)) return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "The medical-claim evidence is missing a document ID." };
  if (!nonEmptyString(v.documentType) || !MEDICAL_CLAIM_ELIGIBLE_DOCUMENT_TYPES.has(v.documentType as string)) {
    return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "The medical-claim evidence does not name a supported document type." };
  }
  const pageStartOk = v.pageStart === undefined || validPage(v.pageStart);
  const pageEndOk = v.pageEnd === undefined || (validPage(v.pageEnd) && (!validPage(v.pageStart) || (v.pageEnd as number) >= (v.pageStart as number)));
  const hasValidPage = validPage(v.pageStart) && pageEndOk;
  const hasSourceLocation = nonEmptyString(v.sourceLocation);
  if (!pageStartOk || !pageEndOk) return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "The medical-claim evidence has an invalid or reversed page range." };
  if (!hasValidPage && !hasSourceLocation) return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "The medical-claim evidence has no valid source page or structured source location." };
  if (!nonEmptyString(v.familyMemberId)) return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "The medical-claim evidence is not associated with a family member." };
  if (!nonEmptyString(v.claimEventId)) return { valid: false, reasonCode: "MALFORMED_MEDICAL_CLAIM_EVIDENCE", message: "The medical-claim evidence is not associated with a claim event." };
  return {
    valid: true,
    evidence: {
      documentId: (v.documentId as string).trim(),
      documentType: (v.documentType as string).trim(),
      pageStart: validPage(v.pageStart) ? (v.pageStart as number) : undefined,
      pageEnd: validPage(v.pageEnd) ? (v.pageEnd as number) : undefined,
      sourceLocation: hasSourceLocation ? (v.sourceLocation as string).trim() : undefined,
      familyMemberId: (v.familyMemberId as string).trim(),
      claimEventId: (v.claimEventId as string).trim(),
    },
  };
}

/** One line item DearPolicy has actually verified from a REVIEWED bill
 * document -- never from chat text, never from a raw model proposal (see
 * lib/claims/evidence/medical-bill-evidence.ts, the only writer of
 * `VerifiedMedicalBillFacts`). `amountMinor` is always the result of a
 * deterministic, structurally-validated parse of the document's own
 * printed amount (see that module's `parseAmountMinor()`) -- the model
 * that read the document is never trusted to do currency arithmetic
 * itself. */
export type MedicalBillLineItem = {
  category: string;
  description: string | null;
  amountMinor: number;
  currency: string;
  documentId: string;
  documentType: string;
};

export type MedicalBillThirdPartyPayment = {
  source: string;
  amountMinor: number;
  currency: string;
  documentId: string;
};

/** The aggregate of every "matched" (reviewer-confirmed) medical-claim
 * document for one family member's one claim -- the ONLY source a medical
 * calculator may treat as a verified eligible billed expense or a verified
 * admission/discharge/ward/panel fact. A chat-reported figure
 * (`ClaimFacts.hospitalBill`, an admission date the family typed) can
 * drive a question or a low-confidence day-count estimate, but it is never
 * substituted for this when a calculator needs a VERIFIED figure -- see
 * lib/claims/medical-rules.ts. Empty/null fields simply mean nothing has
 * been reviewed yet for that fact, never that the fact is zero. */
export type VerifiedMedicalBillFacts = {
  lineItems: MedicalBillLineItem[];
  thirdPartyPayments: MedicalBillThirdPartyPayment[];
  admissionISO: string | null;
  dischargeISO: string | null;
  hospitalName: string | null;
  hospitalCountry: string | null;
  admissionType: string | null;
  wardType: string | null;
  sourceDocumentIds: string[];
  /** Model-execution provenance for every source document's extraction
   * that fed this aggregate, one entry per sourceDocumentIds entry -- see
   * lib/claims/evidence-authority.ts's EvidenceProvenance and
   * evaluateAggregateEvidenceAuthority(). Optional only because every
   * existing writer of this type (lib/claims/evidence/medical-bill-
   * evidence.ts's loadVerifiedMedicalBillFacts()) predates this field;
   * absent/empty is treated as EVIDENCE_PROVENANCE_MISSING (fail closed)
   * by any calculator-consuming rules module that checks it. */
  provenance?: EvidenceProvenance[];
};


/**
 * Evidence for a disability claim -- the disability analogue of
 * `CIDefinitionMatch`/`CIDefinitionMatchResult` above.
 *
 * TPD (Total & Permanent Disability), permanent partial disability and
 * dismemberment (paid via a policy's own schedule-of-injuries table), and
 * disability income all share the same safety requirement: DearPolicy must
 * NEVER autonomously decide that a disability is permanent, or that an
 * injury matches a named schedule row -- only a reviewed clinical
 * assessment, explicitly matched against the policy's own wording by a
 * human reviewer (or a deterministic rule standing in for one), can ever
 * establish that. `matchKey` plays exactly the role `illnessName` plays for
 * critical illness: a fixed, calculator-facing identifier for WHAT this
 * match was reviewed against --
 *   - "total_permanent_disability" for a TPD benefit (see
 *     lib/claims/calculators/disability-benefit.ts's TOTAL_PERMANENT_DISABILITY_MATCH_KEY),
 *   - the exact, verbatim schedule-row code (never a fuzzy/paraphrased
 *     injury description) for a permanent-partial-disability/dismemberment
 *     benefit paid from a schedule of injuries, and
 *   - "disability_income" for a disability-income benefit.
 * A match for one of these can never unlock another, even under the same
 * policy and the same claim -- calculateDisabilityBenefit() and
 * calculateDisabilityIncome() independently re-validate every field of
 * whichever match a caller supplies, exactly like calculateCriticalIllness()
 * does for CIDefinitionMatch.
 */
export type DisabilityDefinitionMatchResult = "matches" | "does_not_match" | "needs_medical_review" | "needs_policy_review" | "insufficient_evidence" | "ambiguous";

export type DisabilityDefinitionMatch = {
  familyMemberId: string;
  claimEventId: string;
  contractId: string;
  coverageId?: string;
  /** The exact calculator-facing benefit code this match applies to (e.g.
   * "tpd-lump-sum", "ppd-schedule", "di-monthly"). A match for one code can
   * never unlock a calculation for another. */
  benefitCode: string;
  /** What this match was reviewed against -- see this type's own doc
   * comment above. Strict, exact-string equality only: never normalised
   * beyond trimming/case-folding, and never fuzzily compared against an
   * injury description. */
  matchKey: string;
  medicalEvidence: unknown;
  definitionEvidence: unknown;
  result: DisabilityDefinitionMatchResult;
  reviewedAt: string;
  /** Model-execution provenance for the AI extraction this match's
   * reviewed medicalEvidence rests on -- see
   * lib/claims/evidence-authority.ts's EvidenceProvenance. Optional only
   * because every existing writer of this type predates this field;
   * absent is treated as EVIDENCE_PROVENANCE_MISSING (fail closed). */
  provenance?: EvidenceProvenance;
};
