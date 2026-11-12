/**
 * OCR_AI_READER=off (DC, 12 Nov: "it should run fully on paddleocr, how do i turn off the ai reader"): no page image is
 * read by the AI reader. Baidu reads; a page it gives no text for is marked not read (and named by the document), never
 * handed to the AI reader. Unset or "on": the AI reader reads what Baidu could not, as before. The image check of text
 * pages whose figures did not verify keeps the pages as they were when nothing read them.
 * MOCKED: fake Baidu and fake AI reader via globalThis.fetch (the same contract as ocr-baidu-test.ts). No token, no
 * network, no paid call.
 *   npm run -s documents:ai-reader-switch-test
 */
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";

process.env.DATABASE_URL = "postgres://nobody:none@127.0.0.1:9/none";
process.env.MODEL_RETRY_WINDOW_MS = "1000";
for (const k of ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "DEARPOLICY_DETERMINISTIC_MODEL", "MODEL_PRESET", "OCR_ENABLED", "GEMINI_BASE_URL",
  "BAIDU_AISTUDIO_TOKEN", "BAIDU_OCR_ENABLED", "BAIDU_PADDLEOCR_MODEL", "BAIDU_OCR_BASE_URL", "BAIDU_OCR_MAX_WAIT_MS", "BAIDU_OCR_PAGES_PER_JOB", "VERCEL", "OCR_AI_READER"]) delete process.env[k];
process.env.READING_MODEL = "openai:gpt-6-luna";
process.env.OPENAI_API_KEY = "dummy-not-a-key";
process.env.OPENAI_BASE_URL = "http://fake-openai.test/v1";
process.env.BAIDU_OCR_BASE_URL = "https://fake-baidu.test";
process.env.BAIDU_OCR_POLL_INTERVAL_MS = "1";
process.env.BAIDU_OCR_RESULT_HOSTS = "fake-baidu-bucket.test";
// Each case starts with Baidu reachable; the cool-down after an unreachable Baidu has its own case below.
process.env.BAIDU_OCR_COOLDOWN_MS = "0";
// The path probe after an unreachable Baidu is switched on only in case 13 (it would otherwise look up real DNS).
process.env.BAIDU_OCR_PROBE_STEP_MS = "0";
// Connection retries are switched on only in case 16 (each would otherwise wait 1-2 s).
process.env.BAIDU_OCR_CONNECT_RETRIES = "0";
// Two pages of ordinary scanned schedule text, each well over the 24-character bar.
const PAGE_A = "Death Benefit\tS$100,000 payable on death of the life assured";
const PAGE_B = "Hospital Cash Benefit\tS$50 per day, up to 30 days a year";
const TOKEN = "test-token-NOT-REAL-7f3c";

type Seen = { url: string; method: string; auth: string | null; body: any; form?: Record<string, string>; filePages?: number };
let seen: Seen[] = [];
type Reply = { status: number; json?: unknown; text?: string; throwCode?: string; hang?: boolean };
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
  if (r.throwCode) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code: r.throwCode }) });
  // No answer at all: the request waits until the caller's own time limit aborts it (as Baidu did from Vercel, 11 Nov).
  // (A real socket keeps the process alive while it waits; the timer stands in for it, since AbortSignal.timeout does not.)
  if (r.hang) await new Promise((_, reject) => { const alive = setInterval(() => undefined, 1000);
    init?.signal?.addEventListener("abort", () => { clearInterval(alive); reject(init.signal!.reason); }); });
  return new Response(r.text ?? JSON.stringify(r.json), { status: r.status, headers: { "content-type": r.text ? "application/jsonl" : "application/json" } });
}) as typeof fetch;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
async function fixturePdf(variant = "") {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([400, 400]).drawText("SYNTHETIC-DPTEST Policy Schedule. Insured: Placeholder Person. Policy number SYN-0001" + variant + ".", { x: 10, y: 300, size: 8, font });
  const img = await doc.embedPng(PNG);
  doc.addPage([400, 400]).drawImage(img, { x: 0, y: 0, width: 400, height: 400 }); // page 2: scan
  doc.addPage([400, 400]).drawImage(img, { x: 0, y: 0, width: 400, height: 400 }); // page 3: scan
  return new Uint8Array(await doc.save());
}

// --- Fake Baidu job API --------------------------------------------------------------------------------------------
const vlLine = (pages: string[]) => JSON.stringify({ result: { layoutParsingResults: pages.map((text) => ({ markdown: { text, images: {} }, prunedResult: {} })), dataInfo: { numPages: pages.length } } });
/** A job that is pending, then running, then done with the given JSONL lines. */
function baiduJob(lines: string[], opts: { states?: string[]; jsonUrl?: string; submit?: Reply; model?: string | null } = {}) {
  const states = [...(opts.states ?? ["pending", "running", "done"])];
  return (s: Seen): Reply => {
    if (s.method === "POST" && s.url === "https://fake-baidu.test/api/v2/ocr/jobs") return opts.submit ?? { status: 200, json: { code: 0, msg: "ok", data: { jobId: "job-abc123" } } };
    if (s.method === "GET" && s.url === "https://fake-baidu.test/api/v2/ocr/jobs/job-abc123") {
      const state = states.length > 1 ? states.shift()! : states[0];
      return { status: 200, json: { code: 0, data: { jobId: "job-abc123", state, extractProgress: { totalPages: 2, extractedPages: state === "done" ? 2 : 0 },
        ...(state === "done" && opts.model !== null ? { model: opts.model ?? "PaddleOCR-VL-1.6" } : {}), ...(state === "done" ? { resultUrl: { jsonUrl: opts.jsonUrl ?? "https://fake-baidu-bucket.test/result.jsonl?sig=presigned" } } : {}), ...(state === "failed" ? { errorMsg: "boom" } : {}) } } };
    }
    // Any host serves the result, so only the client's own host check can refuse a link that is not Baidu's.
    if (/\.jsonl(\?|$)/.test(s.url)) return { status: 200, text: lines.join("\n") + "\n" };
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

const ACCOUNT = "00000000-0000-4000-8000-0000000000b2";
async function main() {
  const { installDatabase } = await import("../r6/fixture");
  const db = await installDatabase();
  await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household AI reader switch"]);
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { completePdfPagesWithOcr } = await import("@/lib/documents/ocr");
  const { aiPageReaderOn } = await import("@/lib/documents/ai-reader-switch");
  const bd = await import("@/lib/documents/ocr-baidu");
  bd.setBaiduTransportForTests("fetch");
  const run = async (v: string) => { const bytes = await fixturePdf(v); return completePdfPagesWithOcr({ accountId: ACCOUNT, bytes, pages: await extractPdfPages(bytes) }); };
  let passed = 0;
  const check = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log("  ok " + name); };

  await check("S1 the switch reads off/false/0/no as off; unset, on or anything else as on", () => {
    for (const v of ["off", "OFF", "false", "0", "no", " off "]) assert.equal(aiPageReaderOn({ OCR_AI_READER: v } as unknown as NodeJS.ProcessEnv), false, v);
    for (const v of [undefined, "", "on", "true", "1", "yes"]) assert.equal(aiPageReaderOn({ OCR_AI_READER: v } as unknown as NodeJS.ProcessEnv), true, String(v));
  });

  process.env.BAIDU_AISTUDIO_TOKEN = TOKEN;
  await check("S2 on (control): Baidu unreachable, the AI reader reads the scanned pages", async () => {
    seen = []; ai = aiReads; baidu = () => ({ status: 0, throwCode: "ECONNREFUSED" });
    const out = await run("-S2");
    assert.equal(aiCalls().length > 0, true); assert.equal(out[1].text, "AI reading of page 2");
    await bd.resetBaiduCooldown();
  });
  process.env.OCR_AI_READER = "off";
  await check("S3 off: Baidu unreachable, the AI reader is never asked; the scanned pages are marked not read", async () => {
    seen = []; ai = aiReads; baidu = () => ({ status: 0, throwCode: "ECONNREFUSED" });
    const out = await run("-S3");
    assert.equal(aiCalls().length, 0, "no AI reader request");
    assert.equal(baiduCalls().length > 0, true, "Baidu was tried");
    assert.deepEqual(out.filter((p) => p.notRead).map((p) => p.pageNumber), [2, 3]);
    assert.equal(out[1].text, "", "nothing invented for the unread page");
    await bd.resetBaiduCooldown();
  });
  await check("S4 off: Baidu reads, the AI reader is not needed", async () => {
    seen = []; ai = aiReads; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
    const out = await run("-S4");
    assert.equal(aiCalls().length, 0); assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, PAGE_B);
    assert.equal(out.some((p) => p.notRead), false);
  });
  await check("S5 off, no Baidu token: nothing reads the scans, they are marked not read (never read by the AI reader)", async () => {
    delete process.env.BAIDU_AISTUDIO_TOKEN;
    seen = []; ai = aiReads;
    const out = await run("-S5");
    assert.equal(seen.length, 0, "no request at all");
    assert.deepEqual(out.filter((p) => p.notRead).map((p) => p.pageNumber), [2, 3]);
  });
  delete process.env.OCR_AI_READER;

  await check("S6 ingest: the image check of unverified figures keeps the pages when nothing read them (source)", async () => {
    const src = (await import("node:fs")).readFileSync("lib/rag/ingest.ts", "utf8");
    assert.match(src, /await crossCheck\(failed, true\)/, "the unverified-figure check keeps unread pages");
    assert.match(src, /await crossCheck\(ocrSourceBytes && sniffed\.format === "pdf" \? suspectPages\(pages\) : \[\]\);/, "the scrambled-table check does not");
    assert.match(src, /noImage = keepUnread && !aiPageReaderOn\(\)/);
  });
  console.log(`ai-reader-switch: ${passed} passed, 0 failed`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
