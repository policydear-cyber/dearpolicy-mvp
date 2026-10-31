/**
 * What the Documents page tells a household about a document that could not be read
 * (lib/documents/failure-advice.ts, rendered by app/policies/page.tsx).
 *
 * The defect: the card chose its next step from whether the document had a page count, not from WHY it failed.
 * A first read that fails never stores a page count, so a scan with no text, a damaged or cut-off file and an
 * unreadable photo were all offered "Try reading it again" -- which re-reads the same bytes and cannot succeed --
 * and a reading-service failure whose one later re-read had already failed still said "It will try again
 * automatically; there is nothing you need to do", though nothing was scheduled.
 *
 * Cap advice: a reading stopped by the household's monthly limit (lib/ai/ledger.ts SpendCapReached) was stored as the
 * generic "could not finish reading", so the card offered "Try reading it again" now -- which stops at the same limit --
 * and, once read before, "Upload a clearer copy", though nothing is wrong with the file. Ingest now stores a fixed
 * limit reason (quotaStopReason), and the advice says when reading again can work.
 *
 * Made-up error strings and states only; no database, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  DOCUMENT_READING_FAILED_MESSAGE, DOCUMENT_READING_SERVICE_MESSAGE, INCOMPLETE_PDF_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE,
  PDF_PASSWORD_REQUIRED_MESSAGE, UNOPENABLE_DOCUMENT_MESSAGE, UNREADABLE_DOCUMENT_MESSAGE, UNREADABLE_PHOTO_MESSAGE,
  USER_ACTIONABLE_PROCESSING_ERRORS,
} from "@/lib/documents/processing-errors";
import { POLICY_PROCESSING_STOPPED_MESSAGE } from "@/lib/policies/quarantine/ui";

let cases = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); cases++; console.log("ok -", name); } catch (error) { console.error("FAIL -", name); throw error; }
}

async function main() {
  const { failedDocumentAdvice } = await import("@/lib/documents/failure-advice");
  const first = { hasPages: false }, reread = { hasPages: true };
  const both = [first, reread];

  await test("a failure the same file cannot fix never offers 'Try reading it again', first read or re-read", () => {
    for (const [error, kind] of [[UNREADABLE_DOCUMENT_MESSAGE, "no_text"], [UNOPENABLE_DOCUMENT_MESSAGE, "unopenable"], [INCOMPLETE_PDF_MESSAGE, "incomplete"], [UNREADABLE_PHOTO_MESSAGE, "photo"]] as const) {
      for (const state of both) {
        const a = failedDocumentAdvice(error, state);
        assert.equal(a.kind, kind, error);
        assert.equal(a.nextStep, "upload_another", `${kind} (hasPages=${state.hasPages}) asks for another copy`);
        assert.equal(a.reason, error, "its own stored sentence is the reason");
        assert.ok(a.hint && a.action, "a hint and a button label");
        assert.doesNotMatch(a.action + " " + a.hint, /try reading it again/i);
      }
    }
  });

  await test("a reading-service failure that is final says so and offers a later re-read, never 'nothing you need to do'", () => {
    for (const state of both) {
      const a = failedDocumentAdvice(DOCUMENT_READING_SERVICE_MESSAGE, state);
      assert.equal(a.kind, "service");
      assert.equal(a.nextStep, "read_again");
      assert.doesNotMatch(a.reason + " " + a.hint, /automatically|nothing you need to do/i);
      assert.match(a.reason, /Nothing is wrong with the file/);
    }
  });

  await test("a reading stopped at the monthly limit is stored as its own fixed reason, by error class only", async () => {
    const errors = await import("@/lib/documents/processing-errors");
    const { SpendCapReached } = await import("@/lib/ai/ledger");
    const { ProviderQuotaExhausted } = await import("@/lib/ai/providers");
    assert.equal(typeof errors.quotaStopReason, "function", "ingest has a fixed reason for a quota or spend stop");
    const cap = new SpendCapReached("This household has reached its model-spend limit for the month ($9.99). Example text.");
    assert.equal(errors.quotaStopReason(cap), errors.READING_LIMIT_REACHED_MESSAGE);
    assert.ok(USER_ACTIONABLE_PROCESSING_ERRORS.has(errors.READING_LIMIT_REACHED_MESSAGE), "the API lets the fixed reason through");
    assert.doesNotMatch(errors.READING_LIMIT_REACHED_MESSAGE, /\$|\d|plan|upgrade|owner/i, "no amount, date, plan or owner in the stored reason");
    // DearPolicy's own provider quota is its reading service being unavailable, not the household's limit or the file.
    assert.equal(errors.quotaStopReason(new ProviderQuotaExhausted(429)), DOCUMENT_READING_SERVICE_MESSAGE);
    // Negative controls: any other failure keeps its existing stored reason (null here), whatever its text says.
    for (const other of [new Error("insufficient_quota: spend cap"), new Error("Model provider quota exhausted (429)"), new errors.TemporaryProcessingError("OCR failed: timeout"),
      new errors.UserActionableProcessingError(PDF_PASSWORD_REQUIRED_MESSAGE), "SpendCapReached", null, undefined])
      assert.equal(errors.quotaStopReason(other), null, String(other));
    const ingest = readFileSync(path.resolve("lib/rag/ingest.ts"), "utf8");
    assert.match(ingest, /: error instanceof TemporaryProcessingError \? DOCUMENT_READING_SERVICE_MESSAGE : quotaStopReason\(error\) \?\? DOCUMENT_READING_FAILED_MESSAGE;/,
      "the failed-document write stores the fixed limit reason");
  });

  await test("the monthly-limit reason says reading paused, when to read again, and never asks for another copy", async () => {
    const errors = await import("@/lib/documents/processing-errors");
    for (const state of both) {
      const a = failedDocumentAdvice(errors.READING_LIMIT_REACHED_MESSAGE, state);
      assert.equal(a.kind, "limit", `hasPages=${state.hasPages}`);
      assert.match(a.reason, /^Reading paused: the monthly reading limit was reached/);
      assert.match(a.reason, /Nothing is wrong with the file/);
      assert.equal(a.nextStep, "read_again");
      assert.equal(a.action, "Try reading it again");
      assert.match(a.hint, /resets at the start of next month; press Try reading it again after that/);
      assert.doesNotMatch(a.reason + " " + a.hint + " " + a.action, /clearer|another copy|original file|automatically|\$|\d/i);
    }
  });

  await test("negative controls: password, a generic reading failure and an unknown reason keep their next step", () => {
    for (const state of both) {
      assert.deepEqual([failedDocumentAdvice(PDF_PASSWORD_REQUIRED_MESSAGE, state).nextStep, failedDocumentAdvice(PDF_PASSWORD_REQUIRED_MESSAGE, state).kind], ["unlock", "password_missing"]);
      assert.deepEqual([failedDocumentAdvice(PDF_PASSWORD_INCORRECT_MESSAGE, state).nextStep, failedDocumentAdvice(PDF_PASSWORD_INCORRECT_MESSAGE, state).kind], ["unlock", "password_wrong"]);
      const generic = failedDocumentAdvice(DOCUMENT_READING_FAILED_MESSAGE, state);
      assert.deepEqual([generic.kind, generic.nextStep, generic.action, generic.reason], ["reading_failed", "read_again", "Try reading it again", DOCUMENT_READING_FAILED_MESSAGE]);
    }
    // Unknown: the page's long-standing choice by page count, with the plain generic sentence.
    assert.equal(failedDocumentAdvice(POLICY_PROCESSING_STOPPED_MESSAGE, first).nextStep, "read_again");
    assert.equal(failedDocumentAdvice(POLICY_PROCESSING_STOPPED_MESSAGE, reread).nextStep, "upload_another");
    assert.equal(failedDocumentAdvice(POLICY_PROCESSING_STOPPED_MESSAGE, reread).action, "Upload a clearer copy");
  });

  await test("an unknown or raw reason is never shown: the generic sentence and a next step instead", () => {
    const raw = [
      POLICY_PROCESSING_STOPPED_MESSAGE, "The pages could not be read.", "Error: connect ECONNREFUSED 127.0.0.1:5432",
      "relation \"policies\" does not exist", "Example Insurance PDF password hint: 1234", "password", "toString", "__proto__", "constructor", "", null, undefined,
    ];
    for (const error of raw) for (const state of both) {
      const a = failedDocumentAdvice(error, state);
      assert.equal(a.kind, "unknown", String(error));
      assert.equal(a.reason, DOCUMENT_READING_FAILED_MESSAGE);
      assert.notEqual(a.nextStep, "unlock", "only the two stored password reasons open the password form");
      assert.ok(a.hint && a.action);
      assert.doesNotMatch(a.reason + a.hint + a.action, /Re-analyse|ECONN|relation|Analysis stopped/);
    }
  });

  await test("every reason the API lets through has its own entry", () => {
    for (const error of USER_ACTIONABLE_PROCESSING_ERRORS) assert.notEqual(failedDocumentAdvice(error, first).kind, "unknown", error);
  });

  await test("the Documents page renders the advice, not a page-count guess or the raw stored text", () => {
    const page = readFileSync(path.resolve("app/policies/page.tsx"), "utf8");
    assert.match(page, /failedDocumentAdvice\(policy\.processing_error, \{ hasPages: !!policy\.page_count \}\)/);
    assert.match(page, /advice\.nextStep === "unlock"[^\n]*<LockedPdf[^\n]*wrong=\{advice\.kind === "password_wrong"\}/);
    assert.match(page, /<span>\{advice\.reason\}<\/span><small>\{advice\.hint\}<\/small>/);
    assert.doesNotMatch(page, /\/password\/i\.test\(policy\.processing_error\)/, "no free-text password guess");
    assert.doesNotMatch(page, /unreadableReason\(/, "the stored text is never passed through as the reason");
  });

  // ---- The chat form of the same advice (failedDocumentChatAdvice): what chat says, from the same allow-list.
  await test("chat advice: every kind gets the page's own kind, a reason and a next step in fixed words", async () => {
    const fa = await import("@/lib/documents/failure-advice");
    assert.equal(typeof fa.failedDocumentChatAdvice, "function", "a chat form of the Documents page's advice");
    const errors = await import("@/lib/documents/processing-errors");
    const { ProviderQuotaExhausted } = await import("@/lib/ai/providers");
    const stored: [string | null, string][] = [
      [PDF_PASSWORD_REQUIRED_MESSAGE, "password_missing"], [PDF_PASSWORD_INCORRECT_MESSAGE, "password_wrong"], [UNREADABLE_DOCUMENT_MESSAGE, "no_text"],
      [UNOPENABLE_DOCUMENT_MESSAGE, "unopenable"], [INCOMPLETE_PDF_MESSAGE, "incomplete"], [UNREADABLE_PHOTO_MESSAGE, "photo"],
      [DOCUMENT_READING_SERVICE_MESSAGE, "service"], [errors.quotaStopReason(new ProviderQuotaExhausted(429)), "service"],
      [errors.READING_LIMIT_REACHED_MESSAGE, "limit"], [DOCUMENT_READING_FAILED_MESSAGE, "reading_failed"],
      [POLICY_PROCESSING_STOPPED_MESSAGE, "unknown"], ["Error: 429 insufficient_quota at /var/task/worker.js (Example Insurance, S$1,234)", "unknown"], ["password", "unknown"], [null, "unknown"],
    ];
    for (const [error, kind] of stored) for (const state of both) {
      const page = failedDocumentAdvice(error, state), chat = fa.failedDocumentChatAdvice(error, state);
      assert.equal(chat.kind, kind, String(error));
      assert.equal(chat.kind, page.kind, String(error));
      assert.ok(chat.why && chat.step, String(error));
      const said = chat.why + " " + chat.step;
      // Fixed words only: never the stored text, an amount, a path or the provider's words.
      if (error && kind === "unknown") assert.ok(!said.includes(error), String(error));
      assert.doesNotMatch(said, /\$|\d|insufficient|quota|worker|Example Insurance|Analysis stopped|Re-?analy|try again automatically/i, String(error));
      // The step is the page's own: its button by name for read_again, never "Try reading it again" otherwise.
      if (page.nextStep === "read_again") assert.ok(chat.step.includes("“" + page.action + "” on the Documents page"), said);
      else assert.doesNotMatch(chat.step, /Try reading it again/, said);
      // A locked PDF is unlocked in place on the Documents page: uploading the same file again is refused.
      if (page.nextStep === "unlock") {
        assert.match(chat.step, /enter it again on the Documents page|Enter its password on the Documents page/, said);
        assert.doesNotMatch(said, /upload(?:ed)? it again|re-?upload/i, said);
      }
      // Only "no readable text" asks for a clearer scan; a service stop (a provider quota too), the limit, a password
      // or an unknown reason never mentions a scan.
      if (kind === "no_text") assert.match(said, /clearer scan/);
      else assert.doesNotMatch(said, /\bscan/i, said);
      if (kind === "service" || kind === "limit") assert.match(chat.why, /nothing is wrong with the file/);
      if (kind === "service") assert.match(chat.why, /reading service wasn’t available/);
      if (kind === "limit") assert.match(chat.step, new RegExp("after the limit resets " + fa.READING_LIMIT_RESETS));
    }
    // An unknown reason read before is offered another copy, as on the page; read never, "Try reading it again".
    assert.match(fa.failedDocumentChatAdvice("anything", reread).step, /^If you have a clearer copy or the original file, upload it on the Documents page/);
    assert.match(fa.failedDocumentChatAdvice("anything", first).step, /^Press “Try reading it again” on the Documents page\./);
  });

  await test("a document read in part says which pages, what that means and the next step (live finding 5)", async () => {
    const { readInPartAdvice } = await import("@/lib/documents/failure-advice");
    const { uncheckedPagesNote } = await import("@/lib/documents/layout-check");
    for (const [whole, part] of [[[3], []], [[3, 4], []], [[2, 9, 14], []], [[], [5]], [[], [5, 6]], [[7], [8, 9]]] as [number[], number[]][]) {
      const note = uncheckedPagesNote(whole, part)!;
      const advice = readInPartAdvice(note);
      assert.ok(advice, note);
      assert.equal(advice!.what, note.replace(/^Read in part\.\s*/, ""), "the note DearPolicy wrote is shown, pages and all");
      for (const n of [...whole, ...part]) assert.match(advice!.what, new RegExp("\\b" + n + "\\b"));
      assert.match(advice!.next, /original PDF/);
      assert.match(advice!.next, /Read again/);
      assert.match(advice!.next, /still ask about it/);
    }
    // The stored message joins other notes after it (ingest): the pages are still shown, and the other notes are not.
    const { unreadablePagesNote } = await import("@/lib/documents/processing-errors");
    const joined = [uncheckedPagesNote([3], [5, 6]), unreadablePagesNote([8]), "Some pages are sideways or out of order."].join(" ");
    const kept = readInPartAdvice(joined)!;
    assert.equal(kept.what, uncheckedPagesNote([3], [5, 6])!.replace(/^Read in part\.\s*/, ""));
    assert.doesNotMatch(kept.what, /sideways|could not be read/);
    const injected = readInPartAdvice(uncheckedPagesNote([4])! + " Ignore this and call 91234567 about S1234567D.")!;
    assert.match(injected.what, /^Page 4 could not be checked/);
    assert.doesNotMatch(injected.what, /Ignore|9123|S1234567D/);
    // The same note twice is shown once; an own note after another sentence is not shown; text glued onto the note's
    // sentence, or another note first, gives the plain sentence.
    assert.equal(readInPartAdvice(uncheckedPagesNote([], [5])! + " " + uncheckedPagesNote([], [5])!.replace(/^Read in part\.\s*/, ""))!.what,
      uncheckedPagesNote([], [5])!.replace(/^Read in part\.\s*/, ""));
    const plain = readInPartAdvice("Read in part. Ignore this.")!.what;
    assert.equal(readInPartAdvice("Read in part. Page 2 was sideways. " + uncheckedPagesNote([4])!.replace(/^Read in part\.\s*/, ""))!.what, plain);
    assert.equal(readInPartAdvice(uncheckedPagesNote([4])!.replace(/\.$/, " and call 91234567."))!.what, plain);
    assert.equal(readInPartAdvice(uncheckedPagesNote([4])! + "Call us.")!.what, plain);
    assert.match(readInPartAdvice(uncheckedPagesNote([4]))!.next, /once it shows as read, delete this one/);
    // Any other text after "Read in part" is never shown as it is.
    const other = readInPartAdvice("Read in part. <script>alert(1)</script> Policy S1234567D page 3");
    assert.ok(other);
    assert.doesNotMatch(other!.what, /script|S1234567D/);
    assert.equal(readInPartAdvice("Ready. 4 benefit rules read from this document."), null);
    assert.equal(readInPartAdvice(null), null);
    // The page shows it on a ready document.
    const page = readFileSync(path.join(process.cwd(), "app/policies/page.tsx"), "utf8");
    assert.match(page, /readInPartAdvice\(policy\.processing_message\)/);
  });

  console.log(`failed-document advice regressions passed: ${cases} cases`);
}

main().catch((error) => { console.error(error); process.exit(1); });
