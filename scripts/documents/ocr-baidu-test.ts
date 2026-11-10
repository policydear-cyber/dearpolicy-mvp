/**
 * Scanned pages read by Baidu AI Studio's hosted PaddleOCR first, the hosted AI reader as the automatic fallback.
 *
 * Deterministic, MOCKED CONTRACT: a fake endpoint (globalThis.fetch) stands in for Baidu's async jobs API and for the
 * OpenAI reading model. The request and reply shapes mirror the official `paddleocr` Python SDK 3.7.0
 * (paddleocr/_api_client). No token, no network, no paid call. This does NOT prove Baidu's live service behaves this
 * way or how well it reads; that needs a live run with a real token on the synthetic evaluation set.
 * The usage ledger is real SQL on PGlite (scripts/r6/fixture.ts) because every reader first reads this month's spend
 * and refuses when it cannot.
 *   node --import tsx scripts/documents/ocr-baidu-test.ts
 */
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.DATABASE_URL = "postgres://nobody:none@127.0.0.1:9/none";
process.env.MODEL_RETRY_WINDOW_MS = "1000";
for (const k of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL", "MODEL_PRESET", "OCR_ENABLED", "GEMINI_BASE_URL",
  "BAIDU_AISTUDIO_TOKEN", "BAIDU_OCR_ENABLED", "BAIDU_PADDLEOCR_MODEL", "BAIDU_OCR_BASE_URL", "BAIDU_OCR_MAX_WAIT_MS", "BAIDU_OCR_PAGES_PER_JOB"]) delete process.env[k];
process.env.READING_MODEL = "openai:gpt-6-luna";
process.env.OPENAI_API_KEY = "dummy-not-a-key";
process.env.OPENAI_BASE_URL = "http://fake-openai.test/v1";
process.env.BAIDU_OCR_BASE_URL = "https://fake-baidu.test";
process.env.BAIDU_OCR_POLL_INTERVAL_MS = "1";
const TOKEN = "test-token-NOT-REAL-7f3c";

type Seen = { url: string; method: string; auth: string | null; body: any; form?: Record<string, string>; filePages?: number };
let seen: Seen[] = [];
type Reply = { status: number; json?: unknown; text?: string };
let baidu: (s: Seen) => Reply = () => ({ status: 500, json: {} });
let ai: (s: Seen) => Reply = () => ({ status: 500, json: {} });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (!/fake-/.test(url)) return realFetch(input as RequestInfo, init);
  const headers = new Headers(init?.headers);
  const s: Seen = { url, method: init?.method ?? "GET", auth: headers.get("authorization"), body: null };
  if (init?.body instanceof FormData) {
    s.form = {};
    for (const [k, v] of init.body.entries()) {
      if (typeof v === "string") s.form[k] = v;
      else s.filePages = (await PDFDocument.load(new Uint8Array(await v.arrayBuffer()))).getPageCount();
    }
  } else if (typeof init?.body === "string") s.body = JSON.parse(init.body);
  seen.push(s);
  const r = /fake-openai/.test(url) ? ai(s) : baidu(s);
  return new Response(r.text ?? JSON.stringify(r.json), { status: r.status, headers: { "content-type": r.text ? "application/jsonl" : "application/json" } });
}) as typeof fetch;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function fixturePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 400]).drawText("SYNTHETIC-DPTEST Policy Schedule. Insured: Placeholder Person. Policy number SYN-0001.", { x: 10, y: 300, size: 8, font });
  const img = await doc.embedPng(PNG);
  doc.addPage([400, 400]).drawImage(img, { x: 0, y: 0, width: 400, height: 400 }); // page 2: scan
  doc.addPage([400, 400]).drawImage(img, { x: 0, y: 0, width: 400, height: 400 }); // page 3: scan
  return new Uint8Array(await doc.save());
}

// --- Fake Baidu job API --------------------------------------------------------------------------------------------
const vlLine = (pages: string[]) => JSON.stringify({ result: { layoutParsingResults: pages.map((text) => ({ markdown: { text, images: {} }, prunedResult: {} })), dataInfo: { numPages: pages.length } } });
/** A job that is pending, then running, then done with the given JSONL lines. */
function baiduJob(lines: string[], opts: { states?: string[]; jsonUrl?: string; submit?: Reply } = {}) {
  const states = [...(opts.states ?? ["pending", "running", "done"])];
  return (s: Seen): Reply => {
    if (s.method === "POST" && s.url === "https://fake-baidu.test/api/v2/ocr/jobs") return opts.submit ?? { status: 200, json: { code: 0, msg: "ok", data: { jobId: "job-abc123" } } };
    if (s.method === "GET" && s.url === "https://fake-baidu.test/api/v2/ocr/jobs/job-abc123") {
      const state = states.length > 1 ? states.shift()! : states[0];
      return { status: 200, json: { code: 0, data: { jobId: "job-abc123", state, extractProgress: { totalPages: 2, extractedPages: state === "done" ? 2 : 0 },
        ...(state === "done" ? { resultUrl: { jsonUrl: opts.jsonUrl ?? "https://fake-baidu-bucket.test/result.jsonl?sig=presigned" } } : {}), ...(state === "failed" ? { errorMsg: "boom" } : {}) } } };
    }
    if (s.url.startsWith("https://fake-baidu-bucket.test/") || s.url.startsWith("http://fake-baidu-bucket.test/")) return { status: 200, text: lines.join("\n") + "\n" };
    return { status: 404, json: { code: 404, msg: "not found" } };
  };
}
// --- Fake AI reader: transcribes whichever pages it is asked for -----------------------------------------------------
const aiReads = (s: Seen): Reply => {
  const asked = String(s.body?.messages?.[1]?.content?.[1]?.text ?? "").match(/in this order: ([\d, ]+)\./)?.[1].split(",").map((n) => Number(n.trim())) ?? [];
  const content = JSON.stringify({ pages: asked.map((n) => ({ pageNumber: n, text: `AI reading of page ${n}`, orientation: "upright", rotation: 0, legibility: "good" })) });
  return { status: 200, json: { id: "chatcmpl-fake", model: "gpt-6-luna", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } } };
};
const baiduCalls = () => seen.filter((s) => /fake-baidu/.test(s.url));
const aiCalls = () => seen.filter((s) => /fake-openai/.test(s.url));

const ACCOUNT = "00000000-0000-4000-8000-0000000000b1";
async function main() {
  const { installDatabase } = await import("../r6/fixture");
  const db = await installDatabase();
  await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household Baidu OCR"]);
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { completePdfPagesWithOcr, pagesNeedingOcr } = await import("@/lib/documents/ocr");
  const bd = await import("@/lib/documents/ocr-baidu");
  const bytes = await fixturePdf();
  const pages = await extractPdfPages(bytes);
  assert.deepEqual(pagesNeedingOcr(pages), [2, 3], "fixture: page 1 has a text layer, pages 2 and 3 are scans");
  const run = () => completePdfPagesWithOcr({ accountId: ACCOUNT, bytes, pages });

  // 1. No token: Baidu is never called; the AI reader reads the scans exactly as before.
  seen = []; ai = aiReads; baidu = baiduJob([]);
  let out = await run();
  assert.equal(baiduCalls().length, 0, "no Baidu request without a token");
  assert.equal(out[1].text, "AI reading of page 2");
  assert.equal(bd.baiduOcrConfigured({ BAIDU_AISTUDIO_TOKEN: "x", BAIDU_OCR_ENABLED: "off" } as unknown as NodeJS.ProcessEnv), false, "switch-off honoured");

  process.env.BAIDU_AISTUDIO_TOKEN = TOKEN;
  // 2. Happy path: one job for the two scanned pages; text filled in; the AI reader is not called.
  seen = [];
  baidu = baiduJob([vlLine([
    "## Schedule of Benefits\n\n<table><tr><th>Benefit</th><th>Sum Assured</th></tr><tr><td>Death</td><td>S$100,000</td></tr><tr><td>Total &amp; Permanent Disability</td><td>S$100,000</td></tr></table>\n\n**Premium**: S$1,234.50 yearly",
    "| Rider | Amount |\n|---|---|\n| Hospital Cash | S$50 per day |\n\n![](imgs/logo.png)",
  ])]);
  out = await run();
  const calls = baiduCalls();
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://fake-baidu.test/api/v2/ocr/jobs");
  assert.equal(calls[0].auth, `Bearer ${TOKEN}`, "token sent as a Bearer header");
  assert.equal(calls[0].form?.model, "PaddleOCR-VL-1.6", "default model");
  assert.deepEqual(JSON.parse(calls[0].form!.optionalPayload), { useDocOrientationClassify: true });
  assert.equal(calls[0].filePages, 2, "only the two scanned pages are uploaded, never the text-layer page");
  assert.equal(calls.filter((c) => c.method === "GET" && /\/jobs\/job-abc123$/.test(c.url)).length, 3, "polled until done");
  const result = calls.find((c) => c.url.startsWith("https://fake-baidu-bucket.test/"))!;
  assert.equal(result.auth, null, "the pre-signed result link is fetched WITHOUT the token");
  assert.equal(aiCalls().length, 0, "AI reader not called when Baidu read every page");
  assert.equal(out[1].text, "Schedule of Benefits\n\nBenefit\tSum Assured\nDeath\tS$100,000\nTotal & Permanent Disability\tS$100,000\n\nPremium: S$1,234.50 yearly");
  assert.equal(out[2].text, "Rider\tAmount\nHospital Cash\tS$50 per day");
  assert.equal(out[1].extractionMethod, "ocr");
  assert.equal(out[0].text, pages[0].text, "text-layer page untouched");
  assert.ok(!out.some((p) => p.unreadable));

  // 3. A page Baidu returns empty is read by the AI reader, alone; the page Baidu read keeps Baidu's text.
  seen = []; baidu = baiduJob([vlLine(["Death\tS$100,000", "   "])]);
  out = await run();
  assert.equal(out[1].text, "Death\tS$100,000");
  assert.equal(out[2].text, "AI reading of page 3");
  assert.equal(aiCalls().length, 1);
  assert.match(aiCalls()[0].body.messages[1].content[1].text, /in this order: 3\./, "only the empty page goes to the AI reader");

  // 4. Fallbacks: every Baidu failure sends all the scanned pages to the AI reader; nothing fails, nothing is lost.
  const fallbacks: [string, (s: Seen) => Reply, Record<string, string>?][] = [
    ["over daily quota (HTTP 429)", baiduJob([], { submit: { status: 429, json: { code: 429, msg: "quota" } } })],
    ["bad token (HTTP 401)", baiduJob([], { submit: { status: 401, json: { code: 401, msg: "unauthorised" } } })],
    ["error code with HTTP 200", baiduJob([], { submit: { status: 200, json: { code: 10001, msg: "limit" } } })],
    ["service down (HTTP 503)", baiduJob([], { submit: { status: 503, json: {} } })],
    ["job failed", baiduJob([], { states: ["running", "failed"] })],
    ["never finishes", baiduJob([], { states: ["running"] }), { BAIDU_OCR_MAX_WAIT_MS: "30" }],
    ["page count mismatch", baiduJob([vlLine(["only one page"])])],
    ["malformed JSONL", baiduJob(["not json"])],
    ["plain-http result link", baiduJob([vlLine(["a", "b"])], { jsonUrl: "http://fake-baidu-bucket.test/r.jsonl" })],
    ["unknown model", baiduJob([vlLine(["a", "b"])]), { BAIDU_PADDLEOCR_MODEL: "Not-A-Model" }],
  ];
  for (const [label, fake, env] of fallbacks) {
    seen = []; baidu = fake;
    Object.assign(process.env, env ?? {});
    out = await run();
    for (const k of Object.keys(env ?? {})) delete process.env[k];
    assert.equal(out[1].text, "AI reading of page 2", `${label}: page 2 read by the AI reader`);
    assert.equal(out[2].text, "AI reading of page 3", `${label}: page 3 read by the AI reader`);
    assert.equal(aiCalls().length, 1, `${label}: one AI request`);
  }

  // 5. The token never appears anywhere but the Authorization header to the Baidu host: not in a URL, a body, or an error.
  for (const s of seen) assert.ok(!s.url.includes(TOKEN) && !JSON.stringify(s.body ?? {}).includes(TOKEN) && !JSON.stringify(s.form ?? {}).includes(TOKEN));
  baidu = baiduJob([], { submit: { status: 401, json: { code: 401, msg: "unauthorised" } } });
  const err = await bd.readPdfWithBaidu(new Uint8Array(await (await PDFDocument.create()).save()), { ...process.env, BAIDU_AISTUDIO_TOKEN: TOKEN } as NodeJS.ProcessEnv).catch((e) => e);
  assert.ok(err instanceof bd.BaiduOcrError && !String(err.message).includes(TOKEN) && !String(err.stack).includes(TOKEN));

  // 6. Baidu set up but no AI reader: Baidu still reads; when Baidu fails, the pages are marked NOT READ (never read and empty).
  process.env.READING_MODEL = "openai:gpt-5-mini";
  seen = []; baidu = baiduJob([vlLine(["Death\tS$100,000", "Hospital Cash\tS$50"])]);
  out = await run();
  assert.equal(out[1].text, "Death\tS$100,000");
  seen = []; baidu = baiduJob([], { submit: { status: 503, json: {} } });
  out = await run();
  assert.equal(out[1].unreadable, true); assert.equal(out[1].notRead, true); assert.equal(out[2].notRead, true);
  assert.equal(aiCalls().length, 0);
  process.env.READING_MODEL = "openai:gpt-6-luna";

  // 7. OCR switched off: neither reader is called.
  process.env.OCR_ENABLED = "off"; seen = [];
  out = await run();
  assert.equal(seen.length, 0); assert.equal(out[1].notRead, true);
  delete process.env.OCR_ENABLED;

  // 8. Fails closed: with the usage ledger unreadable, no page is sent to Baidu or to any model.
  await db.exec("ALTER TABLE model_usage RENAME TO model_usage_unreadable");
  seen = []; baidu = baiduJob([vlLine(["x", "y"])]);
  await assert.rejects(run, (e: Error) => e.name === "SpendCheckUnavailable");
  assert.equal(seen.length, 0, "nothing leaves when this month's spend cannot be read");
  await db.exec("ALTER TABLE model_usage_unreadable RENAME TO model_usage");

  // 9. Plain OCR models (PP-OCRv5/v6) are read from rec_texts; large documents are split into several jobs.
  assert.deepEqual(bd.baiduPagesFromJsonl(JSON.stringify({ result: { ocrResults: [{ prunedResult: { rec_texts: ["Death", "S$100,000"] } }, { prunedResult: {} }] } }), "PP-OCRv5"), ["Death\nS$100,000", ""]);
  process.env.BAIDU_OCR_PAGES_PER_JOB = "1";
  seen = []; baidu = baiduJob([vlLine(["one page"])], { states: ["done"] });
  out = await run();
  assert.equal(baiduCalls().filter((c) => c.method === "POST").length, 2, "one job per page when limited to one page a job");
  assert.ok(baiduCalls().filter((c) => c.method === "POST").every((c) => c.filePages === 1));
  assert.equal(out[1].text, "one page"); assert.equal(out[2].text, "one page");
  delete process.env.BAIDU_OCR_PAGES_PER_JOB;

  // 10. Markdown clean-up keeps every figure exactly.
  assert.equal(bd.baiduMarkdownToText("# Title\n\n<div style=\"text-align: center;\">Policy No. <b>SYN-1</b></div>\n\nSum &lt;S$1,000&gt; &amp; 25%"), "Title\n\nPolicy No. SYN-1\n\nSum <S$1,000> & 25%");

  console.log("DearPolicy Baidu PaddleOCR (mocked contract): request shape, token handling, polling, result parsing, per-page and whole-job fallback to the AI reader, not-read marking, switch-off, ledger fail-closed -- passed. Live Baidu behaviour is NOT covered by this test.");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
