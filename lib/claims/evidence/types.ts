import type { CauseOfDeathDocumentType } from "@/lib/claims/calculators/evidence";

export type ClaimEvidenceDocumentType = CauseOfDeathDocumentType;

export const CLAIM_EVIDENCE_DOCUMENT_TYPES: ClaimEvidenceDocumentType[] = [
  "death_certificate", "police_report", "coroners_report", "medical_examiner_report", "other_official_document",
];

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
 * module doc comment on ./extract.ts. */
export type ClaimEvidenceExtractedFields = {
  deceasedName: string | null;
  otherNamesMentioned: string[];
  personIdentifiers: { label: string; value: string }[];
  dateOfDeath: string | null;
  statedCauseOfDeath: string | null;
  mannerOfDeath: string | null;
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
  created_at: string;
  updated_at: string;
};

export type CauseDefinitionMatchResultValue = "matches" | "does_not_match" | "needs_review";

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
