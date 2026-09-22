import { CLAIM_EVIDENCE_DOCUMENT_TYPES, type ClaimEvidenceDocumentType } from "./types";

/** PDF only for V1, mirroring app/api/policies/upload/route.ts exactly --
 * this pipeline reuses the same PDF text/OCR extraction path
 * (lib/documents/pdf.ts, lib/documents/ocr.ts) as policy documents, and
 * that path only understands PDFs. A phone photo of a death certificate
 * needs to be saved or exported as a PDF before upload; this is a known
 * limitation, not an oversight -- see the PR description. */
const ALLOWED_MIME_TYPES = new Set(["application/pdf"]);
const ALLOWED_EXTENSIONS = new Set([".pdf"]);
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB -- claim evidence is a handful of pages, well under the 50 MB policy-document ceiling.

export type EvidenceUploadRejection =
  | "UNSUPPORTED_DOCUMENT_TYPE"
  | "UNSUPPORTED_MIME_TYPE"
  | "UNSUPPORTED_EXTENSION"
  | "MIME_EXTENSION_MISMATCH"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE";

export type EvidenceUploadValidation =
  | { valid: true }
  | { valid: false; reasonCode: EvidenceUploadRejection; message: string };

function extensionOf(filename: string) {
  const match = /\.[a-z0-9]+$/i.exec(filename.trim());
  return match ? match[0].toLowerCase() : "";
}

export function isSupportedDocumentType(value: unknown): value is ClaimEvidenceDocumentType {
  return typeof value === "string" && (CLAIM_EVIDENCE_DOCUMENT_TYPES as string[]).includes(value);
}

/** Validates everything about an upload that can be checked BEFORE the
 * bytes are read for content -- MIME type, extension, extension-vs-MIME
 * agreement (a renamed .exe wearing a .pdf name, or a form field lying
 * about the MIME type, must not slip through on either check alone), size,
 * and that the file is not empty. Fails closed: an unrecognised or
 * unsupported combination is always rejected, never defaulted through. */
export function validateEvidenceUpload(args: {
  documentType: unknown;
  filename: string;
  mimeType: string;
  byteSize: number;
}): EvidenceUploadValidation {
  if (!isSupportedDocumentType(args.documentType)) {
    return { valid: false, reasonCode: "UNSUPPORTED_DOCUMENT_TYPE", message: "That is not a supported claim-evidence document type." };
  }
  if (args.byteSize <= 0) {
    return { valid: false, reasonCode: "EMPTY_FILE", message: "The uploaded file is empty." };
  }
  if (args.byteSize > MAX_BYTES) {
    return { valid: false, reasonCode: "FILE_TOO_LARGE", message: `Claim evidence files must be ${Math.floor(MAX_BYTES / (1024 * 1024))} MB or smaller.` };
  }
  const mime = (args.mimeType || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return { valid: false, reasonCode: "UNSUPPORTED_MIME_TYPE", message: "DearPolicy currently accepts PDF claim-evidence documents only." };
  }
  const extension = extensionOf(args.filename);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { valid: false, reasonCode: "UNSUPPORTED_EXTENSION", message: "DearPolicy currently accepts .pdf claim-evidence documents only." };
  }
  // The browser/client supplies both the MIME type and the filename
  // separately; a script or a renamed file can make them disagree even
  // when each one alone looks acceptable.
  if (mime === "application/pdf" && extension !== ".pdf") {
    return { valid: false, reasonCode: "MIME_EXTENSION_MISMATCH", message: "The file's extension does not match its declared type." };
  }
  return { valid: true };
}

/** A PDF's own magic bytes ("%PDF-"), checked against the ACTUAL uploaded
 * bytes rather than trusting the client-declared MIME type or filename --
 * closes the gap those two checks cannot close on their own (a file that
 * simply isn't a PDF at all, renamed and mislabelled to pass both). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  const header = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  return header === "%PDF-";
}
