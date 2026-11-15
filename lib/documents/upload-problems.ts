/** What a household is told when an upload, or the reading after it, did not fully work: one place for the words, so
 * the upload routes, the browser upload and the Documents page always say the same thing.
 *
 * Owner's rules: never give up on reading a policy, and name any page that was not read. A failure on our side (a
 * dropped connection, a server error, the reading service not answering) is said to be ours, never the file's. Only a
 * file that really is invalid (a type DearPolicy can't read, a password it wasn't given, too big, empty) is said to be
 * the file's, and that is said by the checks that know it (lib/documents/formats.ts, processing-errors.ts).
 *
 * Pure and dependency-free apart from the fixed advice readers, so the client page and offline tests import it. */
import { coverReadingPending, notReadPagesAdvice, readInPartAdvice, unreadablePagesAdvice } from "@/lib/documents/failure-advice";

/** Which step of an upload went wrong (components/upload-document.ts). */
export type UploadStep = "start" | "send" | "finalize";

export const UPLOAD_COPY = {
  /** The browser lost its connection to DearPolicy before the file was taken. */
  connectionLost: "We lost the connection while uploading, so your file wasn't saved. Nothing is wrong with your file. Upload it again in a moment.",
  /** The connection dropped after the file was sent, while DearPolicy was taking it in: it may have arrived. */
  connectionLostAtFinish: "We lost the connection just as your upload was finishing. Refresh the page to see if it arrived. If it isn't listed, upload it again.",
  /** Sending the file took too long and the browser stopped it. */
  timedOut: "The upload took too long and stopped, so your file wasn't saved. Nothing is wrong with your file. Upload it again in a moment.",
  /** Storage refused or failed the file's bytes for a reason that isn't the file's size. */
  storageFailed: "We couldn't save your file just now because of a problem on our side. Nothing is wrong with your file. Upload it again in a moment.",
  /** A server error (or a gateway page instead of an answer) before the file was sent. */
  startFailed: "We couldn't start your upload because of a problem on our side. Nothing is wrong with your file. Upload it again in a moment.",
  /** A server error while taking the file in: it may or may not be listed. */
  finishFailed: "We couldn't finish your upload because of a problem on our side. Nothing is wrong with your file. Refresh the page, and if it isn't listed, upload it again.",
  /** A part of a local-driver upload was refused as malformed: our own sending went wrong, not the file. */
  interrupted: "The upload was interrupted on our side, so your file wasn't saved. Nothing is wrong with your file. Upload it again in a moment.",
  /** The file's name is longer than DearPolicy keeps. */
  nameTooLong: "This file's name is too long to upload. Rename it to something shorter, then upload it again.",
  /** The person chosen at upload is no longer an active family member. */
  memberGone: "The family member you chose is no longer in your household. Choose who it's for again, then upload it.",
} as const;

/** The message for one failed step. `status` 0 means no answer came back at all (offline, a dropped connection, a
 * blocked request); `serverMessage` is the server's own `error`, used only for a refusal it explains (4xx). A 5xx, or
 * an answer with no usable message, is our side's failure and gets the fixed copy, never a raw text or code. */
export function uploadFailureMessage(step: UploadStep, outcome: { status: number; serverMessage?: string | null; timedOut?: boolean }): string {
  if (outcome.timedOut) return UPLOAD_COPY.timedOut;
  if (!outcome.status) return step === "finalize" ? UPLOAD_COPY.connectionLostAtFinish : UPLOAD_COPY.connectionLost;
  const said = typeof outcome.serverMessage === "string" ? outcome.serverMessage.trim() : "";
  if (outcome.status >= 400 && outcome.status < 500 && said) return said;
  if (step === "send") return UPLOAD_COPY.storageFailed;
  return step === "finalize" ? UPLOAD_COPY.finishFailed : UPLOAD_COPY.startFailed;
}

/** Page numbers a ready document's stored message names as not read: pages tried and not readable, and scanned pages
 * no reader has looked at yet. Only the notes DearPolicy writes are matched (failure-advice.ts), so no other stored
 * text is ever taken for a page list. */
export function unreadPageNumbers(message: string | null | undefined): number[] {
  const notes = [unreadablePagesAdvice(message)?.what, notReadPagesAdvice(message)?.what].filter(Boolean) as string[];
  const pages = notes.flatMap((note) => (note.split(/,? so anything printed/)[0].match(/\d+/g) ?? []).map(Number));
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** "page 4", "pages 4 and 7", "pages 2, 5 and 7". */
export function pageList(pages: number[]): string {
  if (pages.length === 1) return "page " + pages[0];
  return "pages " + pages.slice(0, -1).join(", ") + " and " + pages[pages.length - 1];
}

/** How a document's status label reads. A document with any page not read, or whose cover reading has not finished, is
 * never labelled plain "Ready": the label says what is missing. */
export type DocumentReadLabel = { label: string; fullyRead: boolean; tone: "ready" | "partial" | "failed" | "reading" };
export function documentReadLabel(doc: { processing_status: string; processing_message: string | null }): DocumentReadLabel {
  if (doc.processing_status === "failed") return { label: "Could not be read", fullyRead: false, tone: "failed" };
  if (doc.processing_status !== "ready") return { label: "Reading", fullyRead: false, tone: "reading" };
  const message = doc.processing_message;
  if (unreadPageNumbers(message).length) return { label: "Some pages not read", fullyRead: false, tone: "partial" };
  if (coverReadingPending(message)) return { label: "Not fully read", fullyRead: false, tone: "partial" };
  if (readInPartAdvice(message)) return { label: "Some amounts not used", fullyRead: false, tone: "partial" };
  return { label: "Ready", fullyRead: true, tone: "ready" };
}

/** The line the upload box shows once every document being read has finished. Names each partly read document's
 * unread pages (or says how many documents when there are several), so "ready" is never said of a document with a page
 * missing. `name` gives a document's household name. */
export function readingFinishedSummary<T extends { processing_status: string; processing_message: string | null }>(docs: T[], name: (doc: T) => string): { text: string; problem: boolean } {
  const failed = docs.filter((d) => d.processing_status === "failed").length;
  const partly = docs.filter((d) => d.processing_status === "ready" && !documentReadLabel(d).fullyRead);
  const parts: string[] = [];
  if (failed) parts.push(`${failed === 1 ? "One document" : `${failed} documents`} could not be read.`);
  if (partly.length === 1) {
    const pages = unreadPageNumbers(partly[0].processing_message);
    parts.push(pages.length
      ? `We couldn't read ${pageList(pages)} of ${name(partly[0])} yet. Answers won't use ${pages.length === 1 ? "that page" : "those pages"} until ${pages.length === 1 ? "it's" : "they're"} read.`
      : `${name(partly[0])} wasn't fully read yet.`);
  } else if (partly.length > 1) parts.push(`${partly.length} documents weren't fully read yet.`);
  if (!parts.length) return { text: "Your documents are ready. Home has been updated.", problem: false };
  return { text: `Finished. ${parts.join(" ")} See below for what to do.`, problem: true };
}

/** What a document card says while it is still being read, by the stage the reading stored. A reading that is waiting
 * on our side (a retry after a dropped connection, the one later re-read, scanned pages still with the reader) says so
 * and that the file is fine, instead of "usually ready in under a minute". */
export function readingWaitCopy(stage: string | null | undefined): { title: string; note: string; eta: string } {
  if (stage === "retrying") return { title: "Still reading",
    note: "A connection on our side dropped, so DearPolicy is trying again on its own. Nothing is wrong with your file.", eta: "Taking a little longer than usual" };
  if (stage === "retry_scheduled") return { title: "Reading paused for now",
    note: "We couldn't finish reading it just now because of a connection problem on our side. DearPolicy tries again on its own within about 30 minutes. Nothing is wrong with your file, and you don't need to upload it again.", eta: "Trying again soon" };
  if (stage === "ocr") return { title: "Reading scanned pages…", note: "Scanned pages can take a few minutes. You can keep using DearPolicy while this finishes.", eta: "Can take a few minutes" };
  return { title: "Reading this document…", note: "You can keep using the app while this finishes.", eta: "Usually ready in under a minute" };
}
