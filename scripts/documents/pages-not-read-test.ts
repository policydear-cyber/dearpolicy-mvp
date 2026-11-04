/**
 * A ready document with a page that could not be read at all says so on its card, whatever leads its stored message
 * ("Ready.", "Read in part.", a cover-reading note). The note was stored (lib/documents/processing-errors.ts
 * unreadablePagesNote) but no card showed it, so a household could not tell that a page of its schedule was missing.
 * Only the note's own sentence is shown, never other stored text. Pure, no database, no network, no model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as errors from "@/lib/documents/processing-errors";
import { coverReadingPending, notReadPagesAdvice, readInPartAdvice, unreadablePagesAdvice } from "@/lib/documents/failure-advice";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const one = errors.unreadablePagesNote([4])!;
const many = errors.unreadablePagesNote([7, 2, 5, 2])!;

test("the writer's own notes are found, one page or several", () => {
  assert.equal(unreadablePagesAdvice("Ready. " + one)?.what, "Page 4 could not be read, so anything printed only there is not available.");
  assert.equal(unreadablePagesAdvice("Ready. " + many)?.what, "Pages 2, 5 and 7 could not be read, so anything printed only there is not available.");
  assert.equal(unreadablePagesAdvice("Ready. " + errors.unreadablePagesNote([3, 9]))?.what, "Pages 3 and 9 could not be read, so anything printed only there is not available.");
  // The next step is true whatever left the page unread, and never claims the rest is used (Critic #326 M1, L1).
  const next = unreadablePagesAdvice("Ready. " + one)!.next;
  assert.match(next, /^Use Read again to try that page once more\. If it still can't be read, a clearer copy of it/);
  assert.doesNotMatch(next, /is used|nothing is wrong|upload it|those pages/i);
  // Several pages: "those pages" (#326 nit: one page was "those pages" too).
  assert.match(unreadablePagesAdvice("Ready. " + many)!.next, /^Use Read again to try those pages once more\. If they still can't be read, a clearer copy of them/);
});

test("found wherever it sits: after Ready, a read-in-part note, a cover-reading note, and before later notes", () => {
  const turned = "Page 2 was sideways or upside down; DearPolicy turned it upright to read it.";
  const forms = [
    `Ready. ${one} ${turned}`,
    `Read in part. 2 cover amounts could not be checked word for word against the document's pages, so they are not shown as confirmed. ${one}`,
    `${errors.DOCUMENT_READ_IN_PART_MESSAGE} ${one} ${turned}`,
    `${errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE} ${one}`,
    one,
  ];
  for (const message of forms) assert.equal(unreadablePagesAdvice(message)?.what, one, message);
  // The other notices for the same message are unchanged by it.
  assert.ok(coverReadingPending(`${errors.DOCUMENT_READ_IN_PART_MESSAGE} ${one}`));
  assert.doesNotMatch(readInPartAdvice(forms[1])!.what, /could not be read, so/);
});

test("anything else shows nothing: no note, other wording, a look-alike, a non-number", () => {
  for (const message of [null, undefined, "", "Ready.", errors.DOCUMENT_READ_IN_PART_MESSAGE,
    "Page 4 could not be read by hand.", "Page four could not be read, so anything printed only there is not available.",
    "Page 4 could not be read, so anything printed only there is not available", // no full stop
    "Ready. XPage 4 could not be read, so anything printed only there is not available.",
    "Page 4 could not be read, so anything printed only there is not available.Extra"]) {
    assert.equal(unreadablePagesAdvice(message), null, String(message));
  }
});

test("the Documents card shows it for every ready document", () => {
  const page = readFileSync("app/policies/page.tsx", "utf8");
  assert.match(page, /import \{[^}]*\bunreadablePagesAdvice\b[^}]*\} from "@\/lib\/documents\/failure-advice"/);
  assert.match(page, /const missing = !processing && policy\.processing_status === "ready" \? unreadablePagesAdvice\(policy\.processing_message\) : null;/);
  assert.match(page, /\{missing && <div className="accuracy-warning" data-testid="pages-not-read">/);
});

// #323 follow-up: scanned pages no reader looked at (no reader configured, reading scans switched off) are "not read
// yet", never "could not be read", and their next step never asks for a clearer copy: nothing is known to be wrong.
const notOne = errors.notReadPagesNote([6])!;
const notMany = errors.notReadPagesNote([9, 3, 6])!;

test("pages no reader looked at: their own note and card, never 'could not be read'", () => {
  assert.equal(notOne, "Page 6 is a scanned page that has not been read yet, so anything printed only there is not available.");
  assert.equal(notMany, "Pages 3, 6 and 9 are scanned pages that have not been read yet, so anything printed only there is not available.");
  assert.equal(errors.notReadPagesNote([2, 5]), "Pages 2 and 5 are scanned pages that have not been read yet, so anything printed only there is not available.");
  for (const note of [notOne, notMany]) assert.doesNotMatch(note, /could not be read|unreadable|clearer/i);
  assert.deepEqual(notReadPagesAdvice("Ready. " + notOne), { title: "A page hasn’t been read yet", what: notOne, next: "Use Read again later to read it." });
  assert.deepEqual(notReadPagesAdvice("Ready. " + notMany), { title: "Some pages haven’t been read yet", what: notMany, next: "Use Read again later to read them." });
  // One page or several, in the unreadable card's heading too (TE #332 nit).
  assert.equal(unreadablePagesAdvice("Ready. " + one)!.title, "A page couldn’t be read");
  assert.equal(unreadablePagesAdvice("Ready. " + many)!.title, "Some pages couldn’t be read");
  // Neither notice takes the other's sentence.
  assert.equal(unreadablePagesAdvice("Ready. " + notMany), null);
  assert.equal(notReadPagesAdvice("Ready. " + many), null);
  // Both kinds in one document: each card shows its own pages.
  const both = `Ready. ${one} ${notMany} Page 2 was sideways in the photo or scan; DearPolicy turned it upright to read it.`;
  assert.equal(unreadablePagesAdvice(both)?.what, one);
  assert.equal(notReadPagesAdvice(both)?.what, notMany);
  for (const message of [`${errors.DOCUMENT_READ_IN_PART_MESSAGE} ${notOne}`, `${errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE} ${notOne}`, notOne]) {
    assert.equal(notReadPagesAdvice(message)?.what, notOne, message);
  }
});

test("not-read look-alikes show nothing", () => {
  for (const message of [null, undefined, "", "Ready.", notOne.slice(0, -1), "X" + notOne, notOne + "Extra",
    "Page 6 are scanned pages that have not been read yet, so anything printed only there is not available.",
    "Pages 3, 6 and 9 are scanned pages that has not been read yet, so anything printed only there is not available.",
    "Page six is a scanned page that has not been read yet, so anything printed only there is not available."]) {
    assert.equal(notReadPagesAdvice(message), null, String(message));
  }
});

test("the writer splits the two kinds, and the card shows the not-read one", () => {
  const ingest = readFileSync("lib/rag/ingest.ts", "utf8");
  assert.match(ingest, /unreadablePagesNote\(pages\.filter\(\(p\) => p\.unreadable && !p\.notRead\)/);
  assert.match(ingest, /notReadPagesNote\(pages\.filter\(\(p\) => p\.notRead\)/);
  const page = readFileSync("app/policies/page.tsx", "utf8");
  assert.match(page, /const unread = !processing && policy\.processing_status === "ready" \? notReadPagesAdvice\(policy\.processing_message\) : null;/);
  assert.match(page, /\{unread && <div className="accuracy-warning" data-testid="pages-not-read-yet"><b>\{unread\.title\}<\/b>/);
  assert.match(page, /\{missing && <div className="accuracy-warning" data-testid="pages-not-read"><b>\{missing\.title\}<\/b>/);
});
