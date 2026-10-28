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

  console.log(`failed-document advice regressions passed: ${cases} cases`);
}

main().catch((error) => { console.error(error); process.exit(1); });
