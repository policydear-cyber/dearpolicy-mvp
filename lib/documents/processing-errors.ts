/** Failure reasons a household member can act on, and is therefore allowed
 * to see verbatim.
 *
 * Everything else the pipeline throws stays server-side
 * (lib/diagnostics/processing-failures.ts) and the person sees the fixed
 * "Analysis stopped" wording, because raw provider and storage errors can
 * leak paths and internals. A reason earns a place here only when the
 * person themselves can fix it -- a missing or wrong PDF password is
 * exactly that: without being told, they are left staring at "DearPolicy
 * hit a problem reading this document" with no way to know the fix is to
 * re-upload with the password typed in.
 *
 * This module is deliberately tiny (no pdf.js import) so API routes can
 * allowlist against it without pulling the PDF stack into their bundle. */
export const PDF_PASSWORD_REQUIRED_MESSAGE =
  "This PDF is password protected and was uploaded without its password.";
export const PDF_PASSWORD_INCORRECT_MESSAGE =
  "The PDF password entered at upload was incorrect.";

/** V1.1: a document that cannot be read tells the household, in one
 * sentence, WHAT is unavailable -- never the model, provider, retry or
 * storage detail behind it (that stays in lib/diagnostics). These are fixed
 * strings: no error text is ever interpolated into them. */
export const UNREADABLE_DOCUMENT_MESSAGE =
  "DearPolicy could not find readable text in this document, so the insured people, benefits and amounts in it are not available. The original PDF or a clearer scan would let DearPolicy read it.";
export const UNOPENABLE_DOCUMENT_MESSAGE =
  "This file could not be opened as a document, so none of its contents are available. It may be damaged; the original file would let DearPolicy read it.";
export const DOCUMENT_READING_FAILED_MESSAGE =
  "DearPolicy could not finish reading this document after several automatic attempts, so the insured people, benefits and amounts in it are not available.";
/** Shown (as the progress message, not an error) while an automatic retry
 * is scheduled after a temporary failure. */
export const DOCUMENT_READING_RETRY_MESSAGE =
  "DearPolicy is still reading this document and will finish automatically.";

export const USER_ACTIONABLE_PROCESSING_ERRORS: ReadonlySet<string> = new Set([
  PDF_PASSWORD_REQUIRED_MESSAGE,
  PDF_PASSWORD_INCORRECT_MESSAGE,
  UNREADABLE_DOCUMENT_MESSAGE,
  UNOPENABLE_DOCUMENT_MESSAGE,
  DOCUMENT_READING_FAILED_MESSAGE,
]);

/** Pages of an otherwise readable document that could not be read. One
 * sentence, built only from page numbers. */
export function unreadablePagesNote(pageNumbers: number[]): string | null {
  const pages = [...new Set(pageNumbers)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!pages.length) return null;
  const list = pages.length === 1 ? "Page " + pages[0] + " could not be read" : "Pages " + pages.slice(0, -1).join(", ") + " and " + pages[pages.length - 1] + " could not be read";
  return list + ", so anything printed only there is not available.";
}

/** A processing failure whose message is safe and useful to show the
 * household member who uploaded the document. Writers store its message in
 * the household-readable processing_error column ONLY when it is also in
 * the allowlist above -- belt and braces against a future subclass carrying
 * a raw error text. */
export class UserActionableProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserActionableProcessingError";
  }
}
