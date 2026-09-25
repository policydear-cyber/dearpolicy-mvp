import type { CauseOfDeathDocumentType, MedicalEvidenceDocumentType, MedicalClaimDocumentType } from "@/lib/claims/calculators/evidence";

/** The claim-evidence pipeline (documents, extraction, identity, review
 * state machine, audit trail) is shared, generic infrastructure -- see
 * this module's other types below, none of which are cause-of-death
 * specific. `ClaimEvidenceDocumentType` is therefore the union of every
 * document kind the pipeline accepts: the original official cause-of-death
 * set (PR #9) plus the medical-evidence set this PR adds. Widening this
 * union, and CLAIM_EVIDENCE_DOCUMENT_TYPES below, is what lets a medical
 * document flow through createEvidenceDocument/processClaimEvidence/etc.
 * with zero changes to those functions. */
export type ClaimEvidenceDocumentType = CauseOfDeathDocumentType | MedicalEvidenceDocumentType | MedicalClaimDocumentType;

export const CAUSE_OF_DEATH_DOCUMENT_TYPES: CauseOfDeathDocumentType[] = [
  "death_certificate", "police_report", "coroners_report", "medical_examiner_report", "other_official_document",
];
export const MEDICAL_EVIDENCE_DOCUMENT_TYPES: MedicalEvidenceDocumentType[] = [
  "specialist_memo", "medical_report", "pathology_report", "imaging_report",
  "laboratory_report", "discharge_summary", "surgical_report", "other_medical_evidence",
];
/** The medical-CLAIM document set (PR: v1-medical-claims-engine) -- a
 * hospital bill and the records around it, as distinct from
 * MEDICAL_EVIDENCE_DOCUMENT_TYPES above (clinical evidence for a
 * critical-illness DIAGNOSIS). `discharge_summary` and `surgical_report`
 * are deliberately not duplicated here: a medical claim reuses those two
 * existing medical-evidence types as-is (see isMedicalClaimEligibleDocumentType
 * below), so the same discharge summary a CI claim already accepts can
 * also support a hospital-cash/medical-reimbursement claim without a
 * second upload. */
export const MEDICAL_CLAIM_DOCUMENT_TYPES: MedicalClaimDocumentType[] = [
  "hospital_bill", "itemised_bill", "doctor_memo", "referral", "pre_authorisation",
  "procedure_report", "receipt_payment_proof", "other_insurer_settlement_statement",
  "medishield_integrated_shield_settlement_statement",
];
export const CLAIM_EVIDENCE_DOCUMENT_TYPES: ClaimEvidenceDocumentType[] = [
  ...CAUSE_OF_DEATH_DOCUMENT_TYPES, ...MEDICAL_EVIDENCE_DOCUMENT_TYPES, ...MEDICAL_CLAIM_DOCUMENT_TYPES,
];
export function isMedicalEvidenceDocumentType(value: ClaimEvidenceDocumentType): value is MedicalEvidenceDocumentType {
  return (MEDICAL_EVIDENCE_DOCUMENT_TYPES as string[]).includes(value);
}
export function isMedicalClaimDocumentType(value: ClaimEvidenceDocumentType): value is MedicalClaimDocumentType {
  return (MEDICAL_CLAIM_DOCUMENT_TYPES as string[]).includes(value);
}
/** Every document type a medical claim's bill evidence may actually be
 * drawn from -- the medical-claim set plus the two clinical-evidence types
 * it reuses from MEDICAL_EVIDENCE_DOCUMENT_TYPES (see that const's own
 * doc comment). */
export function isMedicalClaimEligibleDocumentType(value: ClaimEvidenceDocumentType): boolean {
  return isMedicalClaimDocumentType(value) || value === "discharge_summary" || value === "surgical_report";
}

/** uploaded -> quarantined -> processing -> extracted -> needs_review ->
 * matched | rejected | failed. See ./state-machine.ts for the allowed
 * transitions between these. */
export type ClaimEvidenceStatus =
  | "uploaded" | "quarantined" | "processing" | "extracted" | "needs_review" | "matched" | "rejected" | "failed";

/** No malware scanner is wired into this environment (see ./scan-adapter.ts
 * for the documented extension point) -- so this stays "pending_scan" or
 * "scan_unavailable" throughout, and processing is never gated on it. A
 * value here of "clean" or "infected" is only ever set by a real adapter,
 * never assumed. */
export type ClaimEvidenceScanStatus = "pending_scan" | "clean" | "infected" | "scan_unavailable";

export type ClaimEvidenceIdentityStatus = "pending" | "confirmed" | "needs_review" | "mismatch";

export type ClaimEvidenceIdentityConflict = {
  code:
    | "NAME_MISMATCH" | "MULTIPLE_PEOPLE_MENTIONED" | "MISSING_IDENTIFIERS"
    | "CONFLICTING_DATE_OF_DEATH" | "REUSED_FOR_ANOTHER_CLAIM" | "REUSED_FOR_ANOTHER_FAMILY_MEMBER";
  message: string;
};

export type ClaimEvidenceDocumentRow = {
  id: string;
  account_id: string;
  family_member_id: string;
  claim_session_id: string;
  document_type: ClaimEvidenceDocumentType;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  file_hash: string;
  status: ClaimEvidenceStatus;
  scan_status: ClaimEvidenceScanStatus;
  identity_status: ClaimEvidenceIdentityStatus;
  processing_error: string | null;
  processing_error_code: string | null;
  processing_attempts: number;
  supersedes_id: string | null;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClaimEvidencePageCitation = {
  field: string;
  pageStart: number;
  pageEnd: number;
  excerpt: string;
};

/** Untrusted model output, structurally validated (see ./extraction-schema.ts)
 * before it is ever persisted. Never authoritative by itself -- see the
 * module doc comment on ./extract.ts.
 *
 * One combined shape covers both an official cause-of-death document and a
 * medical-evidence document (the `deceasedName...mannerOfDeath` fields are
 * death-specific and stay exactly as PR #9 defined them; the
 * `patientName...priorCriticalIllnessClaims` fields are new here and are
 * the medical equivalents) -- extractClaimEvidence() asks the model to fill
 * in null for whichever half does not apply to the document type actually
 * being read, exactly like every other optional/nullable field on this
 * type. This keeps one shared pipeline (types, schema, identity check,
 * state machine, storage, audit) rather than forking a second one -- see
 * the module doc comment on ../evidence for why.
 *
 * The medical-evidence-only fields are additionally marked `?:` (optional),
 * not just nullable, so a caller built before they existed -- constructing
 * a death-only ClaimEvidenceExtractedFields literal, or an older stored
 * extraction row -- stays valid without listing them. Every real reader
 * (evaluateClaimEvidenceIdentity's `?? args.fields.patientName`, etc.)
 * already treats `undefined` exactly like `null`, so this is purely
 * additive: extract.ts's parsed output (extraction-schema.ts's `.default()`
 * fields) still always populates them. */
export type ClaimEvidenceExtractedFields = {
  deceasedName: string | null;
  otherNamesMentioned: string[];
  personIdentifiers: { label: string; value: string }[];
  dateOfDeath: string | null;
  statedCauseOfDeath: string | null;
  mannerOfDeath: string | null;
  /** The patient/subject named in a medical-evidence document -- the
   * medical equivalent of `deceasedName`, used by evaluateClaimEvidenceIdentity()
   * to confirm the document belongs to the family member the claim is for. */
  patientName?: string | null;
  /** The exact diagnosis as stated in THIS document -- distinct from a
   * family's own chat-reported diagnosis, which is never treated as
   * evidence. */
  exactDiagnosis?: string | null;
  diagnosisDate?: string | null;
  firstSymptomDate?: string | null;
  firstConsultationDate?: string | null;
  /** The disease stage/severity as explicitly stated in the document (e.g.
   * "Stage 2", "Early Stage", "Intermediate"). Left null when the document
   * does not state one -- never inferred from the diagnosis name alone. */
  diseaseStage?: string | null;
  /** Pathology, imaging, laboratory, specialist, surgical or other
   * supporting clinical findings explicitly stated in the document, each
   * with its own exact excerpt -- the raw material a deterministic
   * comparison against a policy's numeric/named threshold can be checked
   * against (see lib/claims/ci-rules.ts's clinical-comparison boundary). */
  supportingFindings?: { type: string; description: string; excerpt: string }[];
  treatingSpecialist?: string | null;
  issuingInstitution?: string | null;
  survivalPeriodDates?: string[];
  priorDiagnosisHistory?: string | null;
  priorCriticalIllnessClaims?: string | null;
  /** The following medical-CLAIM-only fields (hospitalName..thirdPartyPayments)
   * are the bill-evidence analogue of the medical-evidence fields above --
   * see this type's own module doc comment for why one combined shape
   * covers every claim-evidence document kind. Every amount is reported as
   * the document's own printed text (`amountText`), never as a number the
   * model computed -- see lib/claims/evidence/medical-bill-evidence.ts's
   * parseAmountMinor(), the only place an amountText is ever turned into
   * minor units, deterministically and never guessed. */
  hospitalName?: string | null;
  hospitalCountry?: string | null;
  admissionDate?: string | null;
  dischargeDate?: string | null;
  admissionType?: string | null;
  wardType?: string | null;
  billLineItems?: { category: string; description: string | null; amountText: string; currency: string | null }[];
  thirdPartyPayments?: { source: string; amountText: string; currency: string | null }[];
  issuingAuthority: string | null;
  documentReference: string | null;
  documentType: ClaimEvidenceDocumentType | null;
  pageCitations: ClaimEvidencePageCitation[];
  confidence: Record<string, number>;
};

export type ClaimEvidenceExtractionRow = {
  id: string;
  account_id: string;
  evidence_document_id: string;
  source_document_version: string;
  extracted_fields: ClaimEvidenceExtractedFields;
  reviewed_fields: Partial<ClaimEvidenceExtractedFields> | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  extraction_model: string;
  extraction_provider: string;
  extraction_version: string;
  processing_timestamp: string;
  identity_conflicts: ClaimEvidenceIdentityConflict[];
  /** Untrusted jsonb until re-validated by ./extraction-provenance.ts's
   * parseStoredExecution(); NULL/absent for rows written before provenance
   * was persisted (fail closed). */
  model_execution?: unknown;
  created_at: string;
  updated_at: string;
};

export type CauseDefinitionMatchResultValue = "matches" | "does_not_match" | "needs_review";
export type CIDefinitionMatchResultValue = "matches" | "does_not_match" | "needs_medical_review" | "needs_policy_review" | "insufficient_evidence" | "ambiguous";
export type DisabilityDefinitionMatchResultValue = "matches" | "does_not_match" | "needs_medical_review" | "needs_policy_review" | "insufficient_evidence" | "ambiguous";

export type ClaimCauseDefinitionMatchRow = {
  id: string;
  account_id: string;
  family_member_id: string;
  claim_session_id: string;
  contract_id: string;
  coverage_id: string | null;
  evidence_document_id: string;
  cause_evidence: unknown;
  definition_evidence: unknown;
  result: CauseDefinitionMatchResultValue;
  reviewed_at: string;
  reviewed_by: string;
  reason: string | null;
  superseded_at: string | null;
  superseded_reason: string | null;
  /** Untrusted jsonb snapshot until re-validated by
   * ./extraction-provenance.ts's resolveMatchProvenance(); NULL/absent for
   * rows recorded before provenance was persisted (fail closed). */
  evidence_provenance?: unknown;
  created_at: string;
};

/** The critical-illness analogue of ClaimCauseDefinitionMatchRow -- scoped
 * additionally to `benefit_code` and `illness_name`, since one CI policy
 * can define many benefit rows that must never cross-unlock each other
 * (see lib/claims/calculators/evidence.ts's CIDefinitionMatch doc comment). */
export type ClaimCIDefinitionMatchRow = {
  id: string;
  account_id: string;
  family_member_id: string;
  claim_session_id: string;
  contract_id: string;
  coverage_id: string | null;
  evidence_document_id: string;
  benefit_code: string;
  illness_name: string;
  medical_evidence: unknown;
  definition_evidence: unknown;
  result: CIDefinitionMatchResultValue;
  reviewed_at: string;
  reviewed_by: string;
  reason: string | null;
  superseded_at: string | null;
  superseded_reason: string | null;
  /** Untrusted jsonb snapshot until re-validated by
   * ./extraction-provenance.ts's resolveMatchProvenance(); NULL/absent for
   * rows recorded before provenance was persisted (fail closed). */
  evidence_provenance?: unknown;
  created_at: string;
};

/** The disability analogue of ClaimCIDefinitionMatchRow -- scoped
 * additionally to `benefit_code` and `match_key` (a fixed
 * "total_permanent_disability"/"disability_income" sentinel, or an exact
 * schedule-of-injuries row code), since one disability policy can define
 * many benefit rows -- TPD, several schedule-of-injuries rows, disability
 * income -- that must never cross-unlock each other. See
 * lib/claims/calculators/evidence.ts's DisabilityDefinitionMatch doc
 * comment. */
export type ClaimDisabilityDefinitionMatchRow = {
  id: string;
  account_id: string;
  family_member_id: string;
  claim_session_id: string;
  contract_id: string;
  coverage_id: string | null;
  evidence_document_id: string;
  benefit_code: string;
  match_key: string;
  medical_evidence: unknown;
  definition_evidence: unknown;
  result: DisabilityDefinitionMatchResultValue;
  reviewed_at: string;
  reviewed_by: string;
  reason: string | null;
  superseded_at: string | null;
  superseded_reason: string | null;
  /** Untrusted jsonb snapshot until re-validated by
   * ./extraction-provenance.ts's resolveMatchProvenance(); NULL/absent for
   * rows recorded before provenance was persisted (fail closed). */
  evidence_provenance?: unknown;
  created_at: string;
};

export type ClaimEvidenceAuditEntry = {
  actor: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  evidenceDocumentId?: string | null;
  claimSessionId?: string | null;
  contractId?: string | null;
  coverageId?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
};

export type ClaimEvidenceAuditRow = {
  id: string;
  account_id: string;
  actor: string;
  action: string;
  occurred_at: string;
  previous_value: unknown;
  new_value: unknown;
  evidence_document_id: string | null;
  claim_session_id: string | null;
  contract_id: string | null;
  coverage_id: string | null;
  reason: string | null;
  reason_code: string | null;
};
