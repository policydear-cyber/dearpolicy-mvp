/**
 * Client-safe catalogue of the claim-evidence document types a household can
 * upload -- the ONE place user-facing labels, groups and guidance live.
 *
 * Every identifier comes from ./types.ts (CLAIM_EVIDENCE_DOCUMENT_TYPES and
 * its three group constants), which is also what the upload route validates
 * against and what the database CHECK constraint is kept equal to (see
 * scripts/claim-evidence-document-type-regressions.ts). DOCUMENT_TYPE_COPY is
 * a Record keyed by ClaimEvidenceDocumentType, so adding or removing a type
 * without updating this copy fails typecheck.
 *
 * Imports nothing server-only: safe to use from a "use client" page.
 */
import {
  CAUSE_OF_DEATH_DOCUMENT_TYPES, CLAIM_EVIDENCE_DOCUMENT_TYPES, MEDICAL_CLAIM_DOCUMENT_TYPES, MEDICAL_EVIDENCE_DOCUMENT_TYPES,
  type ClaimEvidenceDocumentType,
} from "./types";

export type DocumentTypeGroupId = "cause_of_death" | "medical_evidence" | "bills_and_settlements";

export type DocumentTypeOption = {
  value: ClaimEvidenceDocumentType;
  label: string;
  description: string;
  group: DocumentTypeGroupId;
};

export type DocumentTypeGroup = {
  id: DocumentTypeGroupId;
  label: string;
  guidance: string;
  options: DocumentTypeOption[];
};

const DOCUMENT_TYPE_COPY: Record<ClaimEvidenceDocumentType, { label: string; description: string }> = {
  death_certificate: { label: "Death certificate", description: "The official certificate registering the death." },
  police_report: { label: "Police report", description: "A police report describing how the death happened." },
  coroners_report: { label: "Coroner's report", description: "The coroner's findings on the cause of death." },
  medical_examiner_report: { label: "Medical examiner's report", description: "A medical examiner's or autopsy report." },
  other_official_document: { label: "Other official document", description: "Another official record about the death." },
  specialist_memo: { label: "Specialist memo", description: "A letter or memo from the treating specialist." },
  medical_report: { label: "Medical report", description: "A doctor's report on the diagnosis or condition." },
  pathology_report: { label: "Pathology report", description: "Biopsy or tissue test results." },
  imaging_report: { label: "Imaging report", description: "An X-ray, CT, MRI or ultrasound report." },
  laboratory_report: { label: "Laboratory report", description: "Blood or other lab test results." },
  discharge_summary: { label: "Discharge summary", description: "The hospital's summary when the patient was discharged." },
  surgical_report: { label: "Surgical report", description: "The operation or procedure notes." },
  other_medical_evidence: { label: "Other medical evidence", description: "Another medical record an insurer asked for." },
  hospital_bill: { label: "Hospital bill", description: "The final bill from the hospital or clinic." },
  itemised_bill: { label: "Itemised bill", description: "A bill listing each charge line by line." },
  doctor_memo: { label: "Doctor's memo", description: "A doctor's note or memo supporting the claim." },
  referral: { label: "Referral letter", description: "A referral to a specialist or hospital." },
  pre_authorisation: { label: "Pre-authorisation letter", description: "The insurer's letter issued before treatment was given." },
  procedure_report: { label: "Procedure report", description: "A report of a medical procedure that was billed." },
  receipt_payment_proof: { label: "Receipt or proof of payment", description: "A receipt or payment record for money already paid." },
  other_insurer_settlement_statement: { label: "Other insurer's settlement statement", description: "What another insurer has already paid on this bill." },
  medishield_integrated_shield_settlement_statement: {
    label: "MediShield / Integrated Shield settlement statement",
    description: "What MediShield Life or an Integrated Shield Plan has already paid.",
  },
};

const GROUPS: { id: DocumentTypeGroupId; label: string; guidance: string; members: readonly ClaimEvidenceDocumentType[] }[] = [
  {
    id: "cause_of_death", label: "Cause-of-death documents",
    guidance: "For a death claim: official records that state who died, when and how.",
    members: CAUSE_OF_DEATH_DOCUMENT_TYPES,
  },
  {
    id: "medical_evidence", label: "Medical evidence",
    guidance: "Clinical records that describe a diagnosis, treatment or condition.",
    members: MEDICAL_EVIDENCE_DOCUMENT_TYPES,
  },
  {
    id: "bills_and_settlements", label: "Bills, receipts and settlement documents",
    guidance: "What was charged, what you paid, and what other insurers or MediShield already covered.",
    members: MEDICAL_CLAIM_DOCUMENT_TYPES,
  },
];

export const DOCUMENT_TYPE_GROUPS: DocumentTypeGroup[] = GROUPS.map((group) => ({
  id: group.id, label: group.label, guidance: group.guidance,
  options: group.members.map((value) => ({ value, group: group.id, ...DOCUMENT_TYPE_COPY[value] })),
}));

export const DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = DOCUMENT_TYPE_GROUPS.flatMap((group) => group.options);

export function isUploadableDocumentType(value: unknown): value is ClaimEvidenceDocumentType {
  return typeof value === "string" && (CLAIM_EVIDENCE_DOCUMENT_TYPES as string[]).includes(value);
}

export function documentTypeGroup(value: string): DocumentTypeGroupId | null {
  return DOCUMENT_TYPE_OPTIONS.find((option) => option.value === value)?.group ?? null;
}

export function documentTypeLabel(value: string): string {
  return isUploadableDocumentType(value) ? DOCUMENT_TYPE_COPY[value].label : "Unrecognised document type";
}

/** Only a death claim has one unambiguous starting point. Every other claim
 * (or a claim whose event type is not known yet) starts with NO selection,
 * so the household must choose -- a medical document type is never guessed. */
export function defaultDocumentTypeFor(eventType: unknown): ClaimEvidenceDocumentType | "" {
  return eventType === "death" ? "death_certificate" : "";
}

export type EvidenceUploadFormResult = { ok: true; form: FormData } | { ok: false; message: string };

/** The one place the page turns a selection into the upload request. Refuses
 * an empty or unrecognised selection rather than defaulting it, and always
 * sends the exact canonical identifier. */
export function buildEvidenceUploadForm(args: { file: Blob | null | undefined; fileName?: string; familyMemberId: string; claimSessionId: string; documentType: string }): EvidenceUploadFormResult {
  if (!args.documentType) return { ok: false, message: "Choose what kind of document this is before uploading." };
  if (!isUploadableDocumentType(args.documentType)) return { ok: false, message: "That document type is not supported." };
  if (!args.file) return { ok: false, message: "Choose a PDF file to upload." };
  const form = new FormData();
  if (args.fileName) form.set("file", args.file, args.fileName);
  else form.set("file", args.file);
  form.set("familyMemberId", args.familyMemberId);
  form.set("claimSessionId", args.claimSessionId);
  form.set("documentType", args.documentType);
  return { ok: true, form };
}

export type EvidenceStatusTone = "pending" | "attention" | "done" | "stopped";
export type EvidenceStatusDisplay = { label: string; tone: EvidenceStatusTone; detail: string };

const SAFE_FAILURE_DETAIL: Record<string, string> = {
  MALWARE_DETECTED: "This file was flagged by the security scan and was not processed. Please upload a clean copy.",
  NOT_A_PDF: "This file could not be opened as a PDF. Please upload it again as a PDF.",
  UNREADABLE_DOCUMENT: "DearPolicy could not read enough text from this file. A clearer scan or the original PDF may help.",
  FAMILY_MEMBER_NOT_FOUND: "The family member this document belongs to is no longer on file.",
};

/** A user-facing status for one evidence document. Built only from the
 * status, scan status and a stable error CODE -- never from the stored
 * processing_error text, which can carry internal exception detail. Nothing
 * here says or implies anything about the outcome of a claim. */
export function evidenceStatusDisplay(doc: { status: string; scan_status: string; processing_error_code?: string | null }): EvidenceStatusDisplay {
  switch (doc.status) {
    case "uploaded":
      return { label: "Waiting for security scan", tone: "pending", detail: "The file is saved and will be scanned before anything reads it." };
    case "quarantined":
      return doc.scan_status === "scan_unavailable"
        ? { label: "On hold", tone: "pending", detail: "Security scanning is not available right now, so this file will not be processed until it is." }
        : { label: "Waiting for security scan", tone: "pending", detail: "This file is waiting for its security scan to finish before it can be processed." };
    case "processing":
    case "extracted":
      return { label: "Processing", tone: "pending", detail: "DearPolicy is reading this document." };
    case "needs_review":
      return { label: "Needs review", tone: "attention", detail: "Check what DearPolicy read from this document before it is used." };
    case "matched":
      return { label: "Reviewed", tone: "done", detail: "This document has been reviewed. It is one piece of evidence; the insurer makes the final decision." };
    case "rejected":
      return { label: "Rejected", tone: "stopped", detail: SAFE_FAILURE_DETAIL[doc.processing_error_code ?? ""] ?? "This document was rejected and will not be used." };
    case "failed":
      return { label: "Could not process", tone: "stopped", detail: SAFE_FAILURE_DETAIL[doc.processing_error_code ?? ""] ?? "DearPolicy could not process this document. You can upload it again." };
    default:
      return { label: "Status unavailable", tone: "stopped", detail: "This document's status could not be confirmed, so it will not be used yet." };
  }
}
