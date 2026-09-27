import { CLAIM_EVIDENCE_DOCUMENT_TYPES, type ClaimEvidenceDocumentType } from "./types";
import {
  FORMAT_EXTENSIONS, FORMAT_MIME_TYPES, sniffFileFormat, validateDocumentUpload,
  type SupportedUploadFormat,
} from "@/lib/documents/formats";

/** Claim evidence accepts PDFs and photos/scans (JPEG/PNG/WebP/TIFF) --
 * bills, memos and certificates are very often phone photos. Word documents
 * are policy-side only; evidence stays image/PDF so every stored page is a
 * faithful picture of the source. Validation and normalization both live in
 * lib/documents/formats.ts, shared with the policy-document path. */
export const EVIDENCE_UPLOAD_FORMATS: SupportedUploadFormat[] = ["pdf", "jpeg", "png", "webp", "tiff"];
export const EVIDENCE_ACCEPTED_FORMATS_MESSAGE =
  "Claim evidence can be a PDF or a photo/scan as JPEG, PNG, WebP or TIFF.";
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB -- claim evidence is a handful of pages, well under the 50 MB policy-document ceiling.

export type EvidenceUploadRejection =
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "UNSUPPORTED_MIME_TYPE"
  | "UNSUPPORTED_EXTENSION"
  | "MIME_EXTENSION_MISMATCH"
  | "SIGNATURE_MISMATCH"
  | "EXECUTABLE_FILE"
  | "ARCHIVE_FILE"
  | "UNSUPPORTED_FORMAT"
  | "CORRUPTED_FILE"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE";

export type EvidenceUploadValidation =
  | { valid: true; format: SupportedUploadFormat }
  | { valid: false; reasonCode: EvidenceUploadRejection; message: string };

export function isSupportedDocumentType(value: unknown): value is ClaimEvidenceDocumentType {
  return typeof value === "string" && (CLAIM_EVIDENCE_DOCUMENT_TYPES as string[]).includes(value);
}

/** Validates everything about an evidence upload: the declared document
 * type, size, the REAL file signature, and extension/MIME/signature
 * agreement. Fails closed: an unrecognised or unsupported combination is
 * always rejected with a message naming what is accepted, never defaulted
 * through. */
export function validateEvidenceUpload(args: {
  documentType: unknown;
  filename: string;
  mimeType: string;
  byteSize: number;
  bytes: Uint8Array;
}): EvidenceUploadValidation {
  if (!isSupportedDocumentType(args.documentType)) {
    return { valid: false, reasonCode: "UNSUPPORTED_DOCUMENT_TYPE", message: "That is not a supported claim-evidence document type." };
  }
  const result = validateDocumentUpload({ filename: args.filename, mimeType: args.mimeType, byteSize: args.byteSize, bytes: args.bytes, maxBytes: MAX_BYTES });
  if (!result.valid) {
    return { valid: false, reasonCode: result.reasonCode, message: `${result.message.split(" DearPolicy accepts")[0]} ${EVIDENCE_ACCEPTED_FORMATS_MESSAGE}`.trim() };
  }
  if (!EVIDENCE_UPLOAD_FORMATS.includes(result.format)) {
    return { valid: false, reasonCode: "UNSUPPORTED_FORMAT", message: EVIDENCE_ACCEPTED_FORMATS_MESSAGE };
  }
  return { valid: true, format: result.format };
}

/** Canonical MIME type for a validated evidence upload, stored on the row
 * (never the client-declared string). */
export function canonicalMimeType(format: SupportedUploadFormat): string {
  return FORMAT_MIME_TYPES[format][0];
}

export function evidenceAcceptAttribute(): string {
  return EVIDENCE_UPLOAD_FORMATS.flatMap((f) => FORMAT_MIME_TYPES[f].slice(0, 1).concat(FORMAT_EXTENSIONS[f])).join(",");
}

/** A PDF's own magic bytes ("%PDF-"), checked against the ACTUAL uploaded
 * bytes rather than trusting the client-declared MIME type or filename.
 * Kept for the call sites that genuinely require a PDF specifically. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const sniffed = sniffFileFormat(bytes);
  return sniffed.ok && sniffed.format === "pdf";
}
