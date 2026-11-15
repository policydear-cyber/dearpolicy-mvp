/**
 * Every way an upload, or the reading after it, can go wrong, and what the household is told: a specific message in
 * plain words, the page numbers of any page not read, and the retry path where one exists. A document with a page not
 * read is never labelled or summed up as fully read (lib/documents/upload-problems.ts).
 *
 * Offline: no database server (PGlite), no network (fetch and XMLHttpRequest are mocked), no model, no OCR provider
 * (Baidu is pointed at a mocked network that fails; no AI reader key is set). Made-up documents only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY|BAIDU|OCR_|DETERMINISTIC|CHAOS/i.test(k)) delete process.env[k];
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;

import * as errors from "@/lib/documents/processing-errors";
import { ACCEPTED_FORMATS_MESSAGE, NOT_A_REAL_PDF_MESSAGE, validateDocumentUpload } from "@/lib/documents/formats";
import { failedDocumentAdvice, unreadablePagesAdvice, notReadPagesAdvice } from "@/lib/documents/failure-advice";
import { UPLOAD_COPY, documentReadLabel, pageList, readingFinishedSummary, readingWaitCopy, unreadPageNumbers, uploadFailureMessage } from "@/lib/documents/upload-problems";
import { customerError, customerMessage } from "@/components/customer-text";
import { UploadError, uploadPolicyDocument } from "@/components/upload-document";

void realFetch;
/** One made-up database for the whole file (the spend check before any reading, and the Home count). */
let database: Promise<import("@electric-sql/pglite").PGlite> | null = null;
const installed = () => (database ??= import("../r6/fixture").then((f) => f.installDatabase()));
const MB = 1024 * 1024;
const name = (_doc: unknown) => "Made-up Travel Certificate";
/** Every message a household sees passes the screen guard unchanged: no raw text, code or internal word. */
const shown = (message: string) => { assert.equal(customerMessage(message, "FALLBACK"), message, "the screen guard would hide: " + message); return message; };
/** Never the file's fault for a failure on our side. */
const notBlamingFile = (message: string) => assert.doesNotMatch(message, /clearer|damaged|corrupt|your file is|invalid file|re-?export|re-?save/i, message);

// ---------------------------------------------------------------------------------------------------------------------
// The browser upload (components/upload-document.ts) with fetch and XMLHttpRequest mocked.

type Reply = { status: number; body?: unknown; text?: string } | "network";
function mockFetch(replies: Record<string, Reply>) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    const key = String(url);
    calls.push(key);
    const reply = replies[key];
    if (!reply || reply === "network") throw new TypeError("Failed to fetch");
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status: reply.status, headers: { "content-type": reply.text ? "text/html" : "application/json" } });
  }) as typeof fetch;
  return calls;
}
type XhrOutcome = { status: number; text?: string } | "error" | "timeout";
function mockXhr(outcome: XhrOutcome) {
  class FakeXhr {
    status = 0; responseText = "";
    upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number }) => void } = {};
    onload?: () => void; onerror?: () => void; ontimeout?: () => void;
    open() {} setRequestHeader() {}
    send(body: Blob) {
      queueMicrotask(() => {
        if (outcome === "error") return this.onerror?.();
        if (outcome === "timeout") return this.ontimeout?.();
        this.upload.onprogress?.({ lengthComputable: true, loaded: body.size });
        this.status = outcome.status; this.responseText = outcome.text ?? "";
        this.onload?.();
      });
    }
  }
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
}
const pdfFile = (bytes = 2048) => new File([new Uint8Array(bytes)], "made-up-schedule.pdf", { type: "application/pdf" });
const signed = { status: 200, body: { token: "t", mode: "signed-url", uploadUrl: "https://storage.example/put", method: "PUT" } };
const parts = { status: 200, body: { token: "t", mode: "parts", partUrl: "/api/policies/upload/part", partBytes: 4 * MB } };
async function uploadError(file: File): Promise<UploadError> {
  try { await uploadPolicyDocument(file); } catch (error) { assert.ok(error instanceof UploadError, String(error)); return error; }
  throw new Error("the upload was expected to fail");
}

test("network error during upload: never the browser's raw 'Failed to fetch', and says the file wasn't saved", async () => {
  mockFetch({});
  const atStart = await uploadError(pdfFile());
  assert.equal(atStart.message, UPLOAD_COPY.connectionLost);
  assert.doesNotMatch(atStart.message, /fetch|network ?error|load failed/i);
  // What the Documents page shows (customerError keeps a plain message and hides anything else).
  assert.equal(customerError(atStart, "FALLBACK"), UPLOAD_COPY.connectionLost);
  notBlamingFile(shown(atStart.message));

  mockFetch({ "/api/policies/upload/start": signed });
  mockXhr("error");
  assert.equal((await uploadError(pdfFile())).message, UPLOAD_COPY.connectionLost);
  mockXhr("timeout");
  const slow = await uploadError(pdfFile());
  assert.equal(slow.message, UPLOAD_COPY.timedOut);
  notBlamingFile(shown(slow.message));

  // The connection drops at the last step: the file may have arrived, so the step is to look before uploading again.
  mockFetch({ "/api/policies/upload/start": signed });
  mockXhr({ status: 200 });
  const atFinish = await uploadError(pdfFile());
  assert.equal(atFinish.message, UPLOAD_COPY.connectionLostAtFinish);
  assert.match(atFinish.message, /Refresh the page/);
  shown(atFinish.message);
});

test("the server returning 500 (or a gateway page): our side's plain copy, never a code or raw text", async () => {
  mockFetch({ "/api/policies/upload/start": { status: 500, body: { error: "relation \"policies\" does not exist" } } });
  const start = await uploadError(pdfFile());
  assert.equal(start.message, UPLOAD_COPY.startFailed);
  assert.equal(start.status, 500);
  notBlamingFile(shown(start.message));

  mockFetch({ "/api/policies/upload/start": signed });
  mockXhr({ status: 503, text: "<html>Service Unavailable</html>" });
  const storage = await uploadError(pdfFile());
  assert.equal(storage.message, UPLOAD_COPY.storageFailed);
  notBlamingFile(shown(storage.message));

  mockFetch({ "/api/policies/upload/start": signed, "/api/policies/upload/finalize": { status: 504, text: "<html>An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT</html>" } });
  mockXhr({ status: 200 });
  const finish = await uploadError(pdfFile());
  assert.equal(finish.message, UPLOAD_COPY.finishFailed);
  assert.doesNotMatch(finish.message, /504|FUNCTION|deployment/);
  notBlamingFile(shown(finish.message));

  // The local parts driver: a refused part says the server's own plain words; a broken one says ours.
  mockFetch({ "/api/policies/upload/start": parts });
  mockXhr({ status: 409, text: JSON.stringify({ error: UPLOAD_COPY.interrupted }) });
  assert.equal((await uploadError(pdfFile())).message, UPLOAD_COPY.interrupted);
  mockXhr({ status: 500, text: "Internal Server Error" });
  assert.equal((await uploadError(pdfFile())).message, UPLOAD_COPY.storageFailed);
});

test("a refusal the server explains (4xx) is shown in its own words", async () => {
  const refusal = `".txt" is not a supported file extension. ${ACCEPTED_FORMATS_MESSAGE}`;
  mockFetch({ "/api/policies/upload/start": { status: 400, body: { error: refusal, reasonCode: "UNSUPPORTED_EXTENSION" } } });
  assert.equal((await uploadError(new File(["x".repeat(20)], "notes.txt", { type: "text/plain" }))).message, refusal);
  // A 4xx with no message is still ours to explain, never empty.
  assert.equal(uploadFailureMessage("finalize", { status: 409, serverMessage: "" }), UPLOAD_COPY.finishFailed);
});

test("a file over the size limit, or empty, is refused before anything is sent", async () => {
  const calls = mockFetch({});
  const big = new File([new Uint8Array(1)], "big.pdf", { type: "application/pdf" });
  Object.defineProperty(big, "size", { value: 51 * MB });
  assert.match((await uploadError(big)).message, /^Files must be 50 MB or smaller\. Split the document or export it at a lower resolution/);
  assert.match((await uploadError(new File([], "empty.pdf", { type: "application/pdf" }))).message, /empty/);
  assert.equal(calls.length, 0, "nothing is sent for a file refused in the browser");
  // The same refusal from storage (413) says the limit and the way forward too.
  mockFetch({ "/api/policies/upload/start": signed });
  mockXhr({ status: 413 });
  assert.match((await uploadError(pdfFile())).message, /^Files must be 50 MB or smaller\. Split the document/);
  // And on the server: the shared check refuses it by size with its reason code.
  const v = validateDocumentUpload({ filename: "big.pdf", mimeType: "application/pdf", byteSize: 51 * MB, bytes: new Uint8Array(8), maxBytes: 50 * MB });
  assert.equal(v.valid, false);
  assert.equal(!v.valid && v.reasonCode, "FILE_TOO_LARGE");
});

// ---------------------------------------------------------------------------------------------------------------------
// Files that really are invalid: refused at upload, saying what would work.

test("a file that is not a PDF or image is refused, saying what DearPolicy accepts", () => {
  const cases: [string, string, Uint8Array][] = [
    ["notes.txt", "text/plain", new TextEncoder().encode("Made-up notes, not a document at all")],
    ["setup.exe", "application/octet-stream", new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0, 0, 0, 0, 0])],
    ["photos.zip", "application/zip", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0])],
  ];
  for (const [filename, mimeType, bytes] of cases) {
    const v = validateDocumentUpload({ filename, mimeType, byteSize: bytes.length, bytes, maxBytes: 50 * MB });
    assert.equal(v.valid, false, filename);
    if (!v.valid) assert.ok(v.message.endsWith(ACCEPTED_FORMATS_MESSAGE), filename + ": " + v.message);
  }
  // Named .pdf but not one: said as what the person thinks it is.
  const fake = new TextEncoder().encode("<html>a saved web page</html>");
  const v = validateDocumentUpload({ filename: "schedule.pdf", mimeType: "application/pdf", byteSize: fake.length, bytes: fake, maxBytes: 50 * MB });
  assert.equal(!v.valid && v.message, NOT_A_REAL_PDF_MESSAGE);
});

test("an over-long file name is the one start refusal that names the fix; other bad requests are ours", async () => {
  const { POST } = await import("@/app/api/policies/upload/start/route");
  const { NextRequest } = await import("next/server");
  const call = async (body: unknown) => {
    const response = await POST(new NextRequest("http://localhost/api/policies/upload/start", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));
    return { status: response.status, body: await response.json() as { error: string; reasonCode?: string } };
  };
  const long = await call({ filename: "a".repeat(300) + ".pdf", mimeType: "application/pdf", byteSize: 100 });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, UPLOAD_COPY.nameTooLong);
  shown(long.body.error);
  const garbled = await call({ filename: "x.pdf", byteSize: "lots" });
  assert.equal(garbled.body.error, UPLOAD_COPY.startFailed);
});

test("the upload routes answer a server error with our side's copy, and a gone family member plainly", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  for (const [route, copy] of [["app/api/policies/upload/route.ts", "finishFailed"], ["app/api/policies/upload/start/route.ts", "startFailed"],
    ["app/api/policies/upload/finalize/route.ts", "finishFailed"], ["app/api/policies/upload/part/route.ts", "interrupted"]] as const) {
    const source = read(route);
    assert.match(source, new RegExp(String.raw`status === 500\) return NextResponse\.json\(\{ error: UPLOAD_COPY\.${copy} \}`), route);
    assert.doesNotMatch(source, /"Upload failed"|"Invalid upload part\."|Please try again\./, route);
  }
  assert.match(read("app/api/policies/upload/accept.ts"), /FamilyMemberNotFound\) \{ reject\(\); return NextResponse\.json\(\{ error: UPLOAD_COPY\.memberGone \}/);
  for (const message of Object.values(UPLOAD_COPY)) { shown(message); assert.doesNotMatch(message, /--|—|e\.g\./); }
  for (const message of [UPLOAD_COPY.connectionLost, UPLOAD_COPY.timedOut, UPLOAD_COPY.storageFailed, UPLOAD_COPY.startFailed, UPLOAD_COPY.finishFailed, UPLOAD_COPY.interrupted]) {
    notBlamingFile(message);
    assert.match(message, /Nothing is wrong with your file\./);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Reading: what the stored outcome says on the Documents page.

async function pdfWith(pageKinds: ("text" | "scan" | "blank")[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  // A tiny made-up "scan": a 2x2 PNG drawn over the page, with no text layer.
  const png = await pdf.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDGgAcwFAI/AAf+qJ1N2AAAAAElFTkSuQmCC", "base64"));
  for (const kind of pageKinds) {
    const page = pdf.addPage([400, 400]);
    if (kind === "text") page.drawText("Made-up Insurance Co. Schedule of benefits. Hospital cash 100 per day for each night in hospital.", { x: 10, y: 300, size: 8, font });
    if (kind === "scan") page.drawImage(png, { x: 0, y: 0, width: 400, height: 400 });
  }
  return pdf.save();
}

test("an encrypted PDF: the household is asked for its password, never told the file is broken", () => {
  for (const [message, kind] of [[errors.PDF_PASSWORD_REQUIRED_MESSAGE, "password_missing"], [errors.PDF_PASSWORD_INCORRECT_MESSAGE, "password_wrong"]] as const) {
    assert.ok(errors.USER_ACTIONABLE_PROCESSING_ERRORS.has(message));
    const advice = failedDocumentAdvice(message, { hasPages: false });
    assert.equal(advice.kind, kind);
    assert.equal(advice.nextStep, "unlock");
  }
});

test("a zero-page or corrupt PDF: said to be a file that couldn't be opened, never 'try a clearer scan'", async () => {
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
  const shownPages = await extractPdfPages(empty);
  assert.equal(shownPages.length, 0);
  const problem = errors.noPagesProblem(shownPages.length);
  assert.ok(problem instanceof errors.UserActionableProcessingError);
  assert.equal(problem!.message, errors.UNOPENABLE_DOCUMENT_MESSAGE);
  assert.equal(errors.noPagesProblem(1), null);
  const advice = failedDocumentAdvice(errors.UNOPENABLE_DOCUMENT_MESSAGE, { hasPages: false });
  assert.equal(advice.kind, "unopenable");
  assert.doesNotMatch(advice.reason + advice.hint, /clearer scan/);
  // The reading stops on it before any reader is asked (lib/rag/ingest.ts).
  assert.match(readFileSync("lib/rag/ingest.ts", "utf8"), /const empty = ocrSourceBytes \? noPagesProblem\(pages\.length\) : null;\n\s*if \(empty\) throw empty;\n\n\s*const ocrPageNumbers/);
  // A PDF cut off part-way says so.
  assert.equal(failedDocumentAdvice(errors.INCOMPLETE_PDF_MESSAGE, { hasPages: false }).kind, "incomplete");
  await assert.rejects(extractPdfPages(new TextEncoder().encode("%PDF-1.7\nnot really a pdf")));
});

// A mocked OCR network: Baidu's host refuses every connection (it is down, or unreachable from where DearPolicy runs);
// the AI reader (a fake OpenAI-compatible host) transcribes what it is asked, and says which page it could not make out.
const OCR_ACCOUNT = "00000000-0000-4000-8000-0000000e0b01";
function mockOcrNetwork(unreadableByAi: number[]) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    asked.push(url);
    if (!/fake-openai/.test(url)) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }) });
    const body = JSON.parse(String(init?.body ?? "{}"));
    const pagesAsked = String(body?.messages?.[1]?.content?.[1]?.text ?? "").match(/in this order: ([\d, ]+)\./)?.[1].split(",").map((n: string) => Number(n.trim())) ?? [];
    const content = JSON.stringify({ pages: pagesAsked.map((n: number) => unreadableByAi.includes(n)
      ? { pageNumber: n, text: "", orientation: "upright", rotation: 0, legibility: "unreadable" }
      : { pageNumber: n, text: `Made-up reading of page ${n}: Hospital cash 100 per day`, orientation: "upright", rotation: 0, legibility: "good" }) });
    return new Response(JSON.stringify({ id: "chatcmpl-fake", model: "gpt-6-luna", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return asked;
}
async function readWithMockedOcr(kinds: ("text" | "scan" | "blank")[], unreadableByAi: number[], aiReader: boolean) {
  const db = await installed();
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up OCR household') ON CONFLICT DO NOTHING", [OCR_ACCOUNT]);
  Object.assign(process.env, {
    BAIDU_AISTUDIO_TOKEN: "made-up-token-not-real", BAIDU_OCR_BASE_URL: "https://fake-baidu.test", BAIDU_OCR_RESULT_HOSTS: "fake-baidu-bucket.test",
    BAIDU_OCR_POLL_INTERVAL_MS: "1", BAIDU_OCR_COOLDOWN_MS: "0", BAIDU_OCR_PROBE_STEP_MS: "0", BAIDU_OCR_CONNECT_RETRIES: "0", MODEL_RETRY_WINDOW_MS: "1000",
    READING_MODEL: "openai:gpt-6-luna", OPENAI_API_KEY: "dummy-not-a-key", OPENAI_BASE_URL: "http://fake-openai.test/v1", OCR_AI_READER: aiReader ? "on" : "off",
  });
  const asked = mockOcrNetwork(unreadableByAi);
  const bd = await import("@/lib/documents/ocr-baidu");
  bd.setBaiduTransportForTests("fetch");
  await bd.resetBaiduCooldown();
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { completePdfPagesWithOcr } = await import("@/lib/documents/ocr");
  const bytes = await pdfWith(kinds);
  try {
    const read = await completePdfPagesWithOcr({ accountId: OCR_ACCOUNT, bytes, pages: await extractPdfPages(bytes) });
    return { read, asked };
  } finally {
    for (const k of Object.keys(process.env)) if (/BAIDU|OPENAI|READING_MODEL|OCR_AI_READER|MODEL_RETRY/.test(k)) delete process.env[k];
    await bd.resetBaiduCooldown();
  }
}
/** The page notes the reading stores (lib/rag/ingest.ts), from the pages as the readers left them. */
const storedNotes = (pages: { pageNumber: number; unreadable?: boolean; notRead?: boolean }[]) => errors.withPageNotes("Ready.", [
  errors.unreadablePagesNote(pages.filter((p) => p.unreadable && !p.notRead).map((p) => p.pageNumber)),
  errors.notReadPagesNote(pages.filter((p) => p.notRead).map((p) => p.pageNumber))]);

test("OCR down with no backup reader (Baidu refuses, the AI reader is off): the scanned pages are named as not read, never dropped", async () => {
  const { read, asked } = await readWithMockedOcr(["text", "scan", "text", "scan"], [], false);
  assert.ok(asked.some((u) => /fake-baidu/.test(u)), "Baidu was tried first");
  assert.ok(!asked.some((u) => /fake-openai/.test(u)), "the AI reader is off");
  assert.deepEqual(read.filter((p) => p.notRead).map((p) => p.pageNumber), [2, 4], "every page not read is marked, so its number is stored");
  const message = storedNotes(read);
  assert.deepEqual(unreadPageNumbers(message), [2, 4]);
  assert.equal(notReadPagesAdvice(message)?.what, "Pages 2 and 4 are scanned pages that have not been read yet, so anything printed only there is not available.");
  const label = documentReadLabel({ processing_status: "ready", processing_message: message });
  assert.equal(label.fullyRead, false);
  assert.equal(label.label, "Some pages not read");
  const summary = readingFinishedSummary([{ processing_status: "ready", processing_message: message }], name);
  assert.equal(summary.problem, true);
  assert.match(summary.text, /We couldn't read pages 2 and 4 of Made-up Travel Certificate yet\. Answers won't use those pages until they're read\./);
  notBlamingFile(summary.text);
});

test("partial pages failed in OCR (Baidu down, the backup reader can't make out page 4): page 4 is named, page 2 is read", async () => {
  const { read, asked } = await readWithMockedOcr(["text", "scan", "text", "scan"], [4], true);
  assert.ok(asked.some((u) => /fake-baidu/.test(u)) && asked.some((u) => /fake-openai/.test(u)), "Baidu first, then the backup reader");
  assert.match(read[1].text, /Made-up reading of page 2/);
  assert.deepEqual(read.filter((p) => p.unreadable).map((p) => p.pageNumber), [4]);
  const message = storedNotes(read);
  assert.equal(message, "Ready. Page 4 could not be read, so anything printed only there is not available.");
  assert.equal(unreadablePagesAdvice(message)?.title, "A page couldn’t be read");
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: message }).label, "Some pages not read");
  assert.match(readingFinishedSummary([{ processing_status: "ready", processing_message: message }], name).text,
    /We couldn't read page 4 of Made-up Travel Certificate yet\. Answers won't use that page until it's read\./);
});

test("a blank scanned page the reader says is blank is read (nothing printed), not named as unread", async () => {
  const { read } = await readWithMockedOcr(["text", "blank", "text"], [], true);
  // A page with no text and no image needs no reader at all; it is never marked unread.
  assert.equal(read.some((p) => p.unreadable || p.notRead), false);
  assert.equal(storedNotes(read), "Ready.");
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: storedNotes(read) }).fullyRead, true);
});

test("OCR timeout or retries exhausted: our side, nothing wrong with the file, and Read again is offered", () => {
  // While the job retries, and while its one later re-read waits, the card says so instead of "under a minute".
  const retrying = readingWaitCopy("retrying"), scheduled = readingWaitCopy("retry_scheduled");
  for (const copy of [retrying, scheduled]) {
    assert.match(copy.note, /Nothing is wrong with your file\b/);
    assert.doesNotMatch(copy.eta, /under a minute/);
    shown(copy.note);
  }
  assert.match(scheduled.note, /tries again on its own/);
  assert.match(readingWaitCopy("ocr").eta, /few minutes/);
  assert.equal(readingWaitCopy("reading_pdf").eta, "Usually ready in under a minute");
  // Every attempt used up, with no readable text layer to fall back on: the document failed for a service reason.
  const advice = failedDocumentAdvice(errors.DOCUMENT_READING_SERVICE_MESSAGE, { hasPages: false });
  assert.equal(advice.kind, "service");
  assert.equal(advice.nextStep, "read_again");
  assert.match(advice.reason, /Nothing is wrong with the file\./);
  notBlamingFile(advice.reason + " " + advice.hint);
  // ...and with a readable text layer: ready, its scanned pages named, the cover reading still to finish.
  const message = errors.withPageNotes(errors.DOCUMENT_READ_IN_PART_FINAL_MESSAGE, [errors.unreadablePagesNote([3, 5])]);
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: message }).fullyRead, false);
  assert.deepEqual(unreadPageNumbers(message), [3, 5]);
  // A failed document is never summed up as ready.
  const failed = readingFinishedSummary([{ processing_status: "failed", processing_message: "Analysis stopped" }], name);
  assert.equal(failed.text, "Finished. One document could not be read. See below for what to do.");
});

test("partial pages failed: the card and the finished line name pages 4 and 7, and offer Read again", () => {
  const message = errors.withPageNotes("Ready.", [errors.unreadablePagesNote([7, 4])]);
  assert.equal(message, "Ready. Pages 4 and 7 could not be read, so anything printed only there is not available.");
  const card = unreadablePagesAdvice(message)!;
  assert.equal(card.title, "Some pages couldn’t be read");
  assert.match(card.next, /^Use Read again to try those pages once more\./);
  assert.deepEqual(unreadPageNumbers(message), [4, 7]);
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: message }).label, "Some pages not read");
  const one = readingFinishedSummary([{ processing_status: "ready", processing_message: message }], name);
  assert.equal(one.text, "Finished. We couldn't read pages 4 and 7 of Made-up Travel Certificate yet. Answers won't use those pages until they're read. See below for what to do.");
  shown(one.text.slice(0, 220));
  const single = readingFinishedSummary([{ processing_status: "ready", processing_message: "Ready. " + errors.unreadablePagesNote([4]) }], name);
  assert.match(single.text, /We couldn't read page 4 of Made-up Travel Certificate yet\. Answers won't use that page until it's read\./);
  // Two documents partly read and one failed: counted, never "ready".
  const many = readingFinishedSummary([
    { processing_status: "ready", processing_message: message },
    { processing_status: "ready", processing_message: errors.DOCUMENT_READ_IN_PART_MESSAGE },
    { processing_status: "failed", processing_message: null },
    { processing_status: "ready", processing_message: "Ready." },
  ], name);
  assert.equal(many.text, "Finished. One document could not be read. 2 documents weren't fully read yet. See below for what to do.");
  assert.equal(pageList([2, 5, 7]), "pages 2, 5 and 7");
  // The page offers Read again inside the page note itself, with the same confirming click as the actions row.
  const page = readFileSync("app/policies/page.tsx", "utf8");
  assert.match(page, /data-testid="pages-not-read"><b>\{missing\.title\}<\/b><span>\{missing\.what\}<\/span><small>\{missing\.next\}<\/small>\{readAgainButton\}/);
  assert.match(page, /const read = documentReadLabel\(policy\);/);
  assert.match(page, /readingFinishedSummary\(/);
  assert.doesNotMatch(page, /"Your documents are ready\. Home has been updated\."/, "the page no longer says ready on its own");
});

test("a blank page with nothing printed is not called unread; only a fully read document is labelled Ready", () => {
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: "Ready." }).label, "Ready");
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: "Ready." }).fullyRead, true);
  assert.deepEqual(unreadPageNumbers("Ready. Page 2 was sideways in the photo or scan; DearPolicy turned it upright to read it."), []);
  assert.equal(readingFinishedSummary([{ processing_status: "ready", processing_message: "Ready." }], name).text, "Your documents are ready. Home has been updated.");
  // Other stored text is never read as a page list.
  assert.deepEqual(unreadPageNumbers("Ready. Pages 4 and 7 were great."), []);
  assert.equal(documentReadLabel({ processing_status: "failed", processing_message: null }).label, "Could not be read");
  assert.equal(documentReadLabel({ processing_status: "extracting", processing_message: null }).fullyRead, false);
});

test("Home and Coverage count a ready document with an unread page as not fully read", async () => {
  const db = await installed();
  const { notFullyRead } = await import("@/lib/policies/not-fully-read");
  const ACCOUNT = "00000000-0000-0000-0000-0000000e0001", ADA = "7e000000-0000-4000-8000-000000000001";
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up household')", [ACCOUNT]);
  await db.query("INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Ada Example','self')", [ADA, ACCOUNT]);
  let n = 0;
  const add = async (message: string) => {
    const pid = "7e100000-0000-4000-8000-" + String(++n).padStart(12, "0");
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_message,document_role,product_name,quarantine_status)
      VALUES($1,$2,$3,$4,$5,$6,'ready',$7,'certificate',$8,'scan_clean')`, [pid, ACCOUNT, ADA, `upload-${n}.pdf`, "k/" + pid, "h" + pid, message, "Made-up Plan " + n]);
    await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,'Made-up page')", [ACCOUNT, pid]);
    await db.query("INSERT INTO policy_members(account_id,policy_id,family_member_id) VALUES($1,$2,$3)", [ACCOUNT, pid, ADA]);
    return pid;
  };
  const pagesMissing = await add(errors.withPageNotes("Ready.", [errors.unreadablePagesNote([4, 7])]));
  const scansNotRead = await add(errors.withPageNotes("Ready.", [errors.notReadPagesNote([2])]));
  await add("Ready.");
  await add("Ready. Page 2 was sideways in the photo or scan; DearPolicy turned it upright to read it.");
  const result = await notFullyRead(ACCOUNT, ADA);
  assert.deepEqual(result.ids.sort(), [pagesMissing, scansNotRead].sort());
});
