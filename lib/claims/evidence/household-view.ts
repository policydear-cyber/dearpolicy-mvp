/**
 * What a household browser may see of, and fetch from, an evidence
 * document. Household-facing routes use these instead of returning the
 * stored row as-is.
 */
import type { ClaimEvidenceDocumentRow } from "./types";

/** The stored row minus server-only fields: the raw storage object key and
 * the internal processing-error text (the household sees
 * processing_error_code, which the UI maps to safe copy). */
export type HouseholdEvidenceDocument = Omit<ClaimEvidenceDocumentRow, "storage_key" | "processing_error">;

export function householdEvidenceDocument(doc: ClaimEvidenceDocumentRow): HouseholdEvidenceDocument {
  const visible: Partial<ClaimEvidenceDocumentRow> = { ...doc };
  delete visible.storage_key;
  delete visible.processing_error;
  return visible as HouseholdEvidenceDocument;
}

/** A new download (signed URL or streamed bytes) is issued only for a file
 * the malware scan has cleared and that has left the upload/quarantine
 * holding states without being rejected. Callers must already have
 * resolved the document through getScopedEvidenceDocument(), which
 * enforces ownership, active lifecycle and not-superseded. */
export function isEvidenceDownloadable(doc: Pick<ClaimEvidenceDocumentRow, "status" | "scan_status">): boolean {
  return doc.scan_status === "clean" && doc.status !== "uploaded" && doc.status !== "quarantined" && doc.status !== "rejected";
}

export const PRIVATE_NO_STORE = "private, no-store";
