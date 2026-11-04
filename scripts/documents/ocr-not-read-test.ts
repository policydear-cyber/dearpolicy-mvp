/**
 * Scanned pages no reader looked at are marked "not read", never "read and empty", so a scan is never called "no
 * readable text, upload a clearer scan" because the page reader was missing or switched off (new-household audit,
 * 3 Nov: an image-only scan failed with that advice while the reader was unavailable). Pure; no network, no model.
 *   npm run documents:ocr-not-read-test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|GROQ|_API_KEY|DETERMINISTIC_MODEL/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;

const pages = [
  { pageNumber: 1, text: "", imageCount: 1 },
  { pageNumber: 2, text: "Schedule of benefits\nAccidental death\tRM 100,000\nMedical expenses\tRM 5,000 per accident", imageCount: 0 },
];

test("no reader configured: the scanned page is marked not read (and unread), the text page is untouched", async () => {
  const { completePdfPagesWithOcr } = await import("@/lib/documents/ocr");
  const out = await completePdfPagesWithOcr({ accountId: "a", bytes: new Uint8Array(), pages });
  assert.deepEqual(out.map((p) => [p.pageNumber, !!p.notRead, !!p.unreadable]), [[1, true, true], [2, false, false]]);
  assert.equal(fetches, 0);
});

test("reading scans switched off: the scanned page is marked not read and unread (so its note names it), nothing else changes", async () => {
  process.env.OCR_ENABLED = "off";
  try {
    const { completePdfPagesWithOcr } = await import("@/lib/documents/ocr");
    const out = await completePdfPagesWithOcr({ accountId: "a", bytes: new Uint8Array(), pages });
    assert.deepEqual(out.map((p) => [p.pageNumber, !!p.notRead, !!p.unreadable, p.text.length > 0]), [[1, true, true, false], [2, false, false, true]]);
  } finally { delete process.env.OCR_ENABLED; }
});

test("a document with no scanned pages is returned as it is", async () => {
  const { completePdfPagesWithOcr } = await import("@/lib/documents/ocr");
  const textOnly = [pages[1]];
  assert.equal(await completePdfPagesWithOcr({ accountId: "a", bytes: new Uint8Array(), pages: textOnly }), textOnly);
});

test("intake: too little text with pages no reader looked at is a service failure, checked before the 'no readable text' and photo messages", () => {
  const ingest = readFileSync("lib/rag/ingest.ts", "utf8");
  const notRead = ingest.indexOf("if (pages.some((p) => p.notRead) && pages.reduce((sum, p) => sum + (p.notRead ? 0 : p.text.length), 0) < 100) {");
  assert.ok(notRead > 0, "the not-read check is in intake");
  assert.match(ingest.slice(notRead, notRead + 200), /throw new TemporaryProcessingError\(/);
  const photo = ingest.indexOf("throw new UserActionableProcessingError(UNREADABLE_PHOTO_MESSAGE)");
  const noText = ingest.indexOf("throw new UserActionableProcessingError(UNREADABLE_DOCUMENT_MESSAGE)");
  assert.ok(notRead < photo && notRead < noText, "checked before both file-blaming messages");
});

test("the service failure's final advice never blames the file or suggests a clearer scan", async () => {
  const { failedDocumentAdvice } = await import("@/lib/documents/failure-advice");
  const { DOCUMENT_READING_SERVICE_MESSAGE } = await import("@/lib/documents/processing-errors");
  const advice = failedDocumentAdvice(DOCUMENT_READING_SERVICE_MESSAGE, { hasPages: true });
  assert.equal(advice.kind, "service");
  assert.equal(advice.nextStep, "read_again");
  assert.doesNotMatch(advice.reason + " " + advice.hint, /clearer|scan|upload/i);
});
