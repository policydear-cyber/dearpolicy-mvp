/**
 * Scanned pages with an OpenAI reading model (production: READING_MODEL=openai:gpt-6-luna).
 *
 * Before: lib/documents/ocr.ts returned the pages unchanged whenever the reading provider was not Anthropic/Gemini, so
 * with OpenAI a scanned page was NEVER read and nothing said so (the Gemini fallback inside hostedDocumentToText was
 * unreachable from there). Now the configured reading model reads it when it takes PDF input (a Chat Completions file
 * content part), and a page nothing can read is marked unread.
 *
 * Deterministic: a fake endpoint (globalThis.fetch) stands in for OpenAI / Gemini; no key, no network. The household's
 * usage ledger is real SQL on PGlite (every production schema file, scripts/r6/fixture.ts), because every hosted call
 * first reads this month's spend and refuses when it cannot (the spend cap fails closed, #244). DATABASE_URL points at a
 * closed local port so nothing can reach a real database; the last check makes the ledger unreadable and shows the
 * scanned page is then never sent.
 *   node --import tsx scripts/ocr-openai-regressions.ts
 */
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.DATABASE_URL = "postgres://nobody:none@127.0.0.1:9/none";
process.env.MODEL_RETRY_WINDOW_MS = "1000";
for (const k of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL", "MODEL_PRESET", "OCR_ENABLED", "GEMINI_BASE_URL"]) delete process.env[k];
const setReading = (v: string) => { process.env.READING_MODEL = v; };
process.env.OPENAI_API_KEY = "dummy-not-a-key";
process.env.OPENAI_BASE_URL = "http://fake-openai.test/v1";

type Seen = { url: string; body: any };
let seen: Seen[] = [];
let respond: (s: Seen) => { status: number; json: unknown } = () => ({ status: 500, json: {} });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (!/fake-|googleapis|anthropic|openai\.com/.test(url)) return realFetch(input as RequestInfo, init);
  const s = { url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
  seen.push(s);
  const r = respond(s);
  return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function fixturePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([400, 400]);
  p1.drawText("SYNTHETIC-DPTEST Policy Schedule. Insured: Placeholder Person. Policy number SYN-0001.", { x: 10, y: 300, size: 8, font });
  p1.drawText("Hospital Cash Benefit: S$50 per day of hospitalisation, up to 30 days per year.", { x: 10, y: 280, size: 8, font });
  const img = await doc.embedPng(PNG);
  doc.addPage([400, 400]).drawImage(img, { x: 0, y: 0, width: 400, height: 400 }); // page 2: a scan, no text layer
  return new Uint8Array(await doc.save());
}
const okReply = (text: string, id = "chatcmpl-fake-1") => ({ status: 200, json: { id, model: "gpt-6-luna-2026-09-01", choices: [{ message: { content: text }, finish_reason: "stop" }], usage: { prompt_tokens: 1800, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 0 } } } });
const transcript = (n: number, text: string) => JSON.stringify({ pages: [{ pageNumber: n, text, orientation: "upright", rotation: 0, legibility: "good" }] });

const ACCOUNT = "00000000-0000-4000-8000-0000000000e1";
async function main() {
  // The usage ledger the spend cap reads before any hosted call: an empty month for this household.
  const { installDatabase } = await import("./r6/fixture");
  const db = await installDatabase();
  await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household OCR"]);
  const providers = await import("@/lib/ai/providers");
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { completePdfPagesWithOcr, pagesNeedingOcr } = await import("@/lib/documents/ocr");
  const bytes = await fixturePdf();
  const pages = await extractPdfPages(bytes);
  assert.deepEqual(pagesNeedingOcr(pages), [2], "fixture: page 1 has a text layer, page 2 is image-only");

  // 1. Capability: gpt-6-luna takes PDF input; an OpenAI model without that record does not; bare provider unchanged.
  assert.equal(providers.supportsHostedDocumentReading({ provider: "openai", model: "gpt-6-luna" }), true);
  assert.equal(providers.supportsHostedDocumentReading({ provider: "openai", model: "gpt-5-mini" }), false);
  assert.equal(providers.supportsHostedDocumentReading("openai"), false);
  assert.equal(providers.supportsHostedDocumentReading("gemini"), true);

  // 2. Request shape (the official Chat Completions file content part).
  const shape = providers.openAiDocumentRequest({ provider: "openai", model: "gpt-6-luna" }, { system: "S", user: "U", pdfBase64: "QUJD", maxOutputTokens: 2048 }) as any;
  assert.deepEqual(shape.messages[1].content[0], { type: "file", file: { filename: "pages.pdf", file_data: "data:application/pdf;base64,QUJD" } });
  assert.deepEqual(shape.messages[1].content[1], { type: "text", text: "U" });
  assert.equal(shape.max_completion_tokens, 2048, "output bounded");
  assert.equal(shape.reasoning_effort, "none", "reasoning off: the bound covers the transcription itself");
  assert.ok(!JSON.stringify(shape).includes("detail"), "Chat Completions file inputs do not support detail");

  // 3. The scanned page is read by the configured OpenAI reading model; the text-layer page is untouched.
  setReading("openai:gpt-6-luna");
  seen = []; respond = (s) => okReply(transcript(2, "Hospital Cash Benefit S$100 per day (scanned page)"));
  const read = await completePdfPagesWithOcr({ accountId: "00000000-0000-4000-8000-0000000000e1", bytes, pages });
  assert.equal(seen.length, 1, "one provider request for the one scanned page");
  assert.equal(seen[0].url, "http://fake-openai.test/v1/chat/completions");
  const sent = seen[0].body;
  assert.equal(sent.model, "gpt-6-luna");
  assert.ok(sent.max_completion_tokens >= 2048 && sent.max_completion_tokens <= 4096, "bounded output");
  const part = sent.messages[1].content[0];
  assert.equal(part.type, "file");
  assert.match(part.file.file_data, /^data:application\/pdf;base64,/);
  const subset = await PDFDocument.load(Buffer.from(part.file.file_data.split(",")[1], "base64"));
  assert.equal(subset.getPageCount(), 1, "only the scanned page is sent, never the text-layer page");
  assert.match(sent.messages[1].content[1].text, /in this order: 2\./);
  assert.equal(read[1].text, "Hospital Cash Benefit S$100 per day (scanned page)");
  assert.equal(read[1].extractionMethod, "ocr");
  assert.equal(read[0].text, pages[0].text, "text-layer page unchanged");
  assert.equal(read[0].extractionMethod, "native");
  assert.ok(!read.some((p) => p.unreadable));

  // 4. Provider identity of the reading call (requested model, provider-reported model, provider request id).
  seen = []; respond = () => okReply(transcript(1, "x"), "chatcmpl-identity-7");
  const reply = await providers.hostedDocumentToText({ provider: "openai", model: "gpt-6-luna" }, { system: "S", user: "U", pdfBase64: "QUJD", maxOutputTokens: 100 });
  assert.deepEqual(reply.servedBy, { provider: "openai", model: "gpt-6-luna" });
  assert.equal(reply.resolved.resolvedModel, "gpt-6-luna-2026-09-01");
  assert.equal(reply.resolved.providerRequestId, "chatcmpl-identity-7");
  assert.equal(reply.resolved.resolvedProvider, "openai");

  // 5. A page the reader drops (twice) is kept visibly UNREAD, not silently empty.
  seen = []; respond = () => okReply(JSON.stringify({ pages: [] }));
  const dropped = await completePdfPagesWithOcr({ accountId: "00000000-0000-4000-8000-0000000000e1", bytes, pages });
  assert.equal(seen.length, 2, "the dropped page is asked for once more, alone");
  assert.equal(dropped[1].unreadable, true);
  assert.equal(dropped[0].unreadable, undefined);

  // 6. A provider error is an error (the ingestion job retries, then marks the pages unread) -- never a silent pass.
  seen = []; respond = () => ({ status: 400, json: { error: { message: "Invalid file data" } } });
  await assert.rejects(() => completePdfPagesWithOcr({ accountId: "00000000-0000-4000-8000-0000000000e1", bytes, pages }), /Model request failed \(400\)/);

  // 7. Nothing configured can read documents: the scanned page is marked unread, no request is made.
  setReading("openai:gpt-5-mini");
  seen = [];
  const none = await completePdfPagesWithOcr({ accountId: "00000000-0000-4000-8000-0000000000e1", bytes, pages });
  assert.equal(seen.length, 0);
  assert.equal(none[1].unreadable, true, "BEFORE THE FIX: returned unchanged with no mark (the production defect)");
  assert.equal(none[0].unreadable, undefined);

  // 8. Fallback (reading model cannot look at documents, a Gemini key exists): served by -- and booked to -- Gemini.
  process.env.GEMINI_API_KEY = "dummy-gemini"; process.env.GEMINI_BASE_URL = "http://fake-gemini.test/v1beta";
  seen = []; respond = (s) => /fake-gemini.test\/v1beta\/models\?/.test(s.url) || s.body == null ? { status: 200, json: { models: [] } } : { status: 200, json: { modelVersion: "gemini-2.5-flash-lite", responseId: "g-1", candidates: [{ content: { parts: [{ text: transcript(1, "y") }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } };
  const fb = await providers.hostedDocumentToText({ provider: "openai", model: "gpt-5-mini" }, { system: "S", user: "U", pdfBase64: "QUJD", maxOutputTokens: 100 });
  assert.equal(fb.servedBy.provider, "gemini");
  assert.equal(fb.resolved.resolvedProvider, "gemini");
  delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_BASE_URL;

  // 9. The spend cap fails closed: with the usage ledger unreadable, the scanned page is never sent to any model.
  setReading("openai:gpt-6-luna");
  await db.exec("ALTER TABLE model_usage RENAME TO model_usage_unreadable");
  seen = []; respond = (s) => okReply(transcript(2, "should never be read"));
  await assert.rejects(() => completePdfPagesWithOcr({ accountId: ACCOUNT, bytes, pages }), (e: Error) => e.name === "SpendCheckUnavailable");
  assert.equal(seen.length, 0, "no request leaves when this month's spend cannot be read");
  await db.exec("ALTER TABLE model_usage_unreadable RENAME TO model_usage");

  console.log("DearPolicy OCR with an OpenAI reading model: request shape, scanned page read, text page untouched, provider identity, unread pages visible, fallback identity -- passed (the live guard's PDF reservation: scripts/rag2-live/fetch-guard-pdf-regressions.ts).");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
