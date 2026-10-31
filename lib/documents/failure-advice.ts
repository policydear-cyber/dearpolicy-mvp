import {
  DOCUMENT_READING_FAILED_MESSAGE, DOCUMENT_READING_SERVICE_MESSAGE, INCOMPLETE_PDF_MESSAGE, READING_LIMIT_REACHED_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE,
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
  kind: "password_missing" | "password_wrong" | "no_text" | "unopenable" | "incomplete" | "photo" | "service" | "limit" | "reading_failed" | "unknown";
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
/** When the monthly reading limit resets, from lib/ai/ledger.ts (the cap counts use since the start of the month). */
export const READING_LIMIT_RESETS = "at the start of next month";
const READING_LIMIT_HINT = "The limit resets " + READING_LIMIT_RESETS + "; press Try reading it again after that. There is no need to upload it again.";
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
  // The household's monthly limit stopped reading. Reading again works only once the limit resets (it counts the
  // calendar month's use, lib/ai/ledger.ts), so the step says when; nothing is wrong with the file, so never another copy.
  [READING_LIMIT_REACHED_MESSAGE]: { kind: "limit", nextStep: "read_again", action: READ_AGAIN, hint: READING_LIMIT_HINT },
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

/** The same advice, as chat says it: why (a clause about "it", to follow "couldn’t be read because") and the one next
 * step, naming the Documents page. Built from failedDocumentAdvice, so chat and the Documents page always agree on the
 * kind, and on the button a step names (its own `action` label). Fixed strings only: no stored text, file name, amount
 * or date is ever put in them. An unknown reason gets the generic wording, as on the page. */
export type FailedDocumentChatAdvice = { kind: FailedDocumentAdvice["kind"]; why: string; step: string };

const PHOTO_RETAKE = "lay the page flat in good light with no shadow across it, hold the phone steady and straight above the page, and keep the whole page in the frame";
const CHAT_WHY: Record<FailedDocumentAdvice["kind"], string> = {
  password_missing: "it is password-protected and was uploaded without its password",
  password_wrong: "it is password-protected and the password entered for it didn’t work",
  no_text: "DearPolicy found no readable text in it",
  unopenable: "the file couldn’t be opened — it may be damaged",
  incomplete: "the file is incomplete — it stops part-way, as happens when a download or copy is cut off",
  photo: "it is a photo too blurred, dark or faint to read",
  service: "DearPolicy’s reading service wasn’t available — nothing is wrong with the file",
  limit: "reading was paused when the monthly reading limit was reached — nothing is wrong with the file",
  reading_failed: "DearPolicy couldn’t finish reading it",
  unknown: "DearPolicy couldn’t finish reading it",
};
/** The step for a document the Documents page offers another copy for, by kind. */
const CHAT_UPLOAD_STEP: Partial<Record<FailedDocumentAdvice["kind"], string>> = {
  no_text: SAME_FILE + " Upload the original PDF from the insurer, or a clearer scan, on the Documents page, then delete the old one.",
  unopenable: SAME_FILE + " Upload the original file on the Documents page (or ask the insurer for a fresh copy), then delete the old one.",
  incomplete: "Download it again from the insurer’s email or website (or ask the insurer for a fresh copy), upload the new copy on the Documents page, then delete the old one.",
  photo: "Take it again — " + PHOTO_RETAKE + " — then upload the new photo on the Documents page and delete the old one. A PDF from the insurer is even better.",
  unknown: "If you have a clearer copy or the original file, upload it on the Documents page, then delete the old one.",
};

export function failedDocumentChatAdvice(error: string | null | undefined, { hasPages }: { hasPages: boolean }): FailedDocumentChatAdvice {
  const advice = failedDocumentAdvice(error, { hasPages });
  const why = CHAT_WHY[advice.kind];
  const press = "Press “" + advice.action + "” on the Documents page";
  const step = advice.kind === "password_missing"
    ? "Enter its password on the Documents page and DearPolicy will read it — the insurer’s covering email or letter usually says what it is — or ask the insurer for an unlocked copy."
    : advice.kind === "password_wrong"
      ? "Check the password (passwords are case-sensitive) and enter it again on the Documents page, or ask the insurer for an unlocked copy."
      : advice.nextStep === "read_again"
        ? advice.kind === "service" ? press + " in a little while."
          : advice.kind === "limit" ? press + " after the limit resets " + READING_LIMIT_RESETS + ". There is no need to upload it again."
          : press + ". If it still can’t be read, delete it and upload a clearer copy or the original file."
        : CHAT_UPLOAD_STEP[advice.kind] ?? CHAT_UPLOAD_STEP.unknown!;
  return { kind: advice.kind, why, step };
}

/** What the Documents page tells a household about a document read in part (lib/documents/layout-check.ts
 * uncheckedPagesNote): which pages, what that means, and the next step that can work. The status said only "Read in
 * part", with no next step (live review on 4103e10, finding 5). Allow-list: only the note DearPolicy writes is shown,
 * page numbers and all; any other text gets the plain sentence. */
export type ReadInPartAdvice = { what: string; next: string };
const NUMBERS = String.raw`\d{1,4}(?:(?:, | and )\d{1,4})*`;
const WHOLE = new RegExp(String.raw`^Pages? ${NUMBERS} could not be checked: a second reading from the page image did not agree with (?:its|their) text, so no amount on (?:it|them) is used\.$`);
const PART = new RegExp(String.raw`^Some amounts on pages? ${NUMBERS} could not be checked against the page image, so they are shown as not checked and not used; the rest of (?:that page|those pages) agreed and is used\.$`);
export function readInPartAdvice(message: string | null | undefined): ReadInPartAdvice | null {
  const text = (message ?? "").trim();
  if (!/^Read in part\b/.test(text)) return null;
  // The note leads the stored message; other notes may follow it (an unreadable page, sideways pages), and are shown
  // elsewhere. Only the leading sentences that are this note, word for word, are shown (TE pr217 B1-B5).
  const sentences = text.replace(/^Read in part\.\s*/, "").split(/(?<=\.)\s+(?=\p{Lu})/u).filter(Boolean);
  const known: string[] = [];
  for (const sentence of sentences) { if (!WHOLE.test(sentence) && !PART.test(sentence)) break; if (!known.includes(sentence)) known.push(sentence); }
  return {
    what: known.length ? known.join(" ") : "Some amounts in it could not be checked against the page they came from, so they are not used.",
    next: "Everything else in it is used, and you can still ask about it. A clearer copy, such as the insurer's original PDF instead of a scan or photo, usually fixes this: upload it and delete this one. Read again checks those pages once more, but with the same copy the result may not change.",
  };
}
