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

export const USER_ACTIONABLE_PROCESSING_ERRORS: ReadonlySet<string> = new Set([
  PDF_PASSWORD_REQUIRED_MESSAGE,
  PDF_PASSWORD_INCORRECT_MESSAGE,
]);

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
