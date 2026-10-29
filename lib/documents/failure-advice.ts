import {
  DOCUMENT_READING_FAILED_MESSAGE, DOCUMENT_READING_SERVICE_MESSAGE, INCOMPLETE_PDF_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE,
  PDF_PASSWORD_REQUIRED_MESSAGE, UNOPENABLE_DOCUMENT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE, UNREADABLE_PHOTO_MESSAGE,
} from "@/lib/documents/processing-errors";

/** What the Documents page tells a household about a document that could not be read: why, in their words, and
 * the one next step that can actually work for that kind of failure.
 *
 * An allow-list: each stored reason DearPolicy writes (lib/documents/processing-errors.ts) has its own entry. A
 * reading that cannot succeed a second time from the same file (no text in a scan, a damaged or cut-off file, an
 * unreadable photo) never offers "Try reading it again"; a failure of the reading service never says "it will try
 * again automatically" once nothing is scheduled. Any other value -- including the API's fixed "Analysis stopped"
 * stand-in for a raw error -- gets the plain generic sentence, never its own text.
 *
 * Pure and dependency-free apart from the fixed strings, so the client page can import it. */
export type FailedDocumentNextStep = "unlock" | "read_again" | "upload_another";
export type FailedDocumentAdvice = {
  kind: "password_missing" | "password_wrong" | "no_text" | "unopenable" | "incomplete" | "photo" | "service" | "reading_failed" | "unknown";
  /** One or two sentences: why it could not be read. */
  reason: string;
  /** What to do, said under the reason. */
  hint: string;
  nextStep: FailedDocumentNextStep;
  /** The button's label for read_again / upload_another. */
  action: string;
};

const READ_AGAIN = "Try reading it again";
const READ_AGAIN_HINT = "Try reading it again. If it still can’t be read, delete it and upload a clearer copy or the original file.";
const UPLOAD_HINT = "If you have a clearer copy or the original file, upload that, then delete this one.";
const SAME_FILE = "Reading the same file again won’t change this.";

export const READING_SERVICE_STOPPED_REASON =
  "DearPolicy couldn’t finish reading this document because its reading service wasn’t available. Nothing is wrong with the file.";

const KNOWN = new Map<string, Omit<FailedDocumentAdvice, "reason"> & { reason?: string }>(Object.entries({
  [PDF_PASSWORD_REQUIRED_MESSAGE]: { kind: "password_missing", nextStep: "unlock", hint: "", action: "" },
  [PDF_PASSWORD_INCORRECT_MESSAGE]: { kind: "password_wrong", nextStep: "unlock", hint: "", action: "" },
  [UNREADABLE_DOCUMENT_MESSAGE]: { kind: "no_text", nextStep: "upload_another", action: "Upload a clearer copy",
    hint: SAME_FILE + " Upload the original PDF or a clearer scan, then delete this one." },
  [UNOPENABLE_DOCUMENT_MESSAGE]: { kind: "unopenable", nextStep: "upload_another", action: "Upload another copy",
    hint: SAME_FILE + " Upload the original file (or ask the insurer for a fresh copy), then delete this one." },
  [INCOMPLETE_PDF_MESSAGE]: { kind: "incomplete", nextStep: "upload_another", action: "Upload the new copy",
    hint: "Upload the new download, then delete this one." },
  [UNREADABLE_PHOTO_MESSAGE]: { kind: "photo", nextStep: "upload_another", action: "Upload a new photo",
    hint: "Upload the new photo, then delete this one." },
  // Stored only once the job's attempts AND its one later re-read have failed: nothing else is scheduled, so the
  // stored "it will try again automatically" would never come true here.
  [DOCUMENT_READING_SERVICE_MESSAGE]: { kind: "service", nextStep: "read_again", action: READ_AGAIN, reason: READING_SERVICE_STOPPED_REASON,
    hint: "Try reading it again in a little while." },
  [DOCUMENT_READING_FAILED_MESSAGE]: { kind: "reading_failed", nextStep: "read_again", action: READ_AGAIN, hint: READ_AGAIN_HINT },
}));

/** `hasPages`: the document was read before (it has a page count), so an unknown failure is more likely the file's
 * than the service's -- the page's long-standing choice for a reason it does not know. */
export function failedDocumentAdvice(error: string | null | undefined, { hasPages }: { hasPages: boolean }): FailedDocumentAdvice {
  const known = typeof error === "string" ? KNOWN.get(error) : undefined;
  if (known) return { ...known, reason: known.reason ?? (error as string) };
  return hasPages
    ? { kind: "unknown", reason: DOCUMENT_READING_FAILED_MESSAGE, hint: UPLOAD_HINT, nextStep: "upload_another", action: "Upload a clearer copy" }
    : { kind: "unknown", reason: DOCUMENT_READING_FAILED_MESSAGE, hint: READ_AGAIN_HINT, nextStep: "read_again", action: READ_AGAIN };
}
