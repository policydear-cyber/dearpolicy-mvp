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
import { coverReadingPending, readInPartAdvice, unreadablePagesAdvice } from "@/lib/documents/failure-advice";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const one = errors.unreadablePagesNote([4])!;
const many = errors.unreadablePagesNote([7, 2, 5, 2])!;

test("the writer's own notes are found, one page or several", () => {
  assert.equal(unreadablePagesAdvice("Ready. " + one)?.what, "Page 4 could not be read, so anything printed only there is not available.");
  assert.equal(unreadablePagesAdvice("Ready. " + many)?.what, "Pages 2, 5 and 7 could not be read, so anything printed only there is not available.");
  assert.equal(unreadablePagesAdvice("Ready. " + errors.unreadablePagesNote([3, 9]))?.what, "Pages 3 and 9 could not be read, so anything printed only there is not available.");
  assert.match(unreadablePagesAdvice("Ready. " + one)!.next, /clearer copy of those pages/);
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
