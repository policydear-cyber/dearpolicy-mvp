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
/** Round 10: a photo the reader could not make out at all (blurred, dark, faint). Says how to take it again. */
export const UNREADABLE_PHOTO_MESSAGE =
  "DearPolicy couldn’t read this photo — it is too blurred, dark or faint to make out the words, so nothing in it is available. Take it again: lay the page flat in good light with no shadow across it, hold the phone steady and straight above the page, and keep the whole page in the frame. A PDF from the insurer is even better.";
/** Round 10: a PDF that stops part-way (cut off while downloading or copying). */
export const INCOMPLETE_PDF_MESSAGE =
  "This PDF is incomplete — the file stops part-way, as happens when a download or copy is cut off, so none of its contents could be opened. Download it again from the insurer’s email or website (or ask the insurer for a fresh copy) and upload the new file.";
export const DOCUMENT_READING_FAILED_MESSAGE =
  "DearPolicy could not finish reading this document, so the insured people, benefits and amounts in it are not available.";
/** Round 5: the reading SERVICE failed (a provider outage, a timeout), not
 * the file. Shown after the job's own attempts ran out, while one later
 * retry is scheduled. Never says the document is unreadable. */
export const DOCUMENT_READING_SERVICE_MESSAGE =
  "DearPolicy couldn't finish reading this document right now. It will try again automatically; there is nothing you need to do.";
/** Round 5: the reading service failed but the document's own text layer was
 * readable, so what plain code can read (its tables, conditions and text
 * search) is available now. The progress message of a ready document. */
export const DOCUMENT_READ_IN_PART_MESSAGE =
  "Ready. DearPolicy read this document's text and tables, but couldn't finish reading who it covers and its cover amounts right now. It will try again automatically.";
/** Shown (as the progress message, not an error) while an automatic retry
 * is scheduled after a temporary failure. */
export const DOCUMENT_READING_RETRY_MESSAGE =
  "DearPolicy is still reading this document and will finish automatically.";

export const USER_ACTIONABLE_PROCESSING_ERRORS: ReadonlySet<string> = new Set([
  PDF_PASSWORD_REQUIRED_MESSAGE,
  PDF_PASSWORD_INCORRECT_MESSAGE,
  UNREADABLE_DOCUMENT_MESSAGE,
  UNOPENABLE_DOCUMENT_MESSAGE,
  UNREADABLE_PHOTO_MESSAGE,
  INCOMPLETE_PDF_MESSAGE,
  DOCUMENT_READING_FAILED_MESSAGE,
  DOCUMENT_READING_SERVICE_MESSAGE,
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

/** Round 5: a failure of a service DearPolicy depends on (the reading model,
 * hosted OCR), not of the document. Always retried by the durable queue
 * (lib/jobs/pipeline-worker.ts classifyPipelineError), bounded by the job's
 * max_attempts. Never used for an exhausted quota or spend cap. */
export class TemporaryProcessingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TemporaryProcessingError";
  }
}

/** An exhausted provider quota, billing stop or DearPolicy's own spend cap:
 * waiting minutes does not clear it, so it is never retried. */
export function isQuotaOrSpendStop(error: unknown): boolean {
  const name = error instanceof Error ? error.name || error.constructor?.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return name === "ProviderQuotaExhausted" || name === "SpendCapReached"
    || (error instanceof Error && error.constructor?.name === "SpendCapReached")
    || /insufficient_quota|quota|billing|spend.?cap|SpendCapReached/i.test(message);
}
