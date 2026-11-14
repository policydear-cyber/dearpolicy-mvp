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
  "BAIDU_AISTUDIO_TOKEN", "BAIDU_OCR_ENABLED", "BAIDU_PADDLEOCR_MODEL", "BAIDU_OCR_BASE_URL", "BAIDU_OCR_MAX_WAIT_MS", "BAIDU_OCR_PAGES_PER_JOB", "VERCEL"]) delete process.env[k];
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

const ACCOUNT = "00000000-0000-4000-8000-0000000000b1";
async function main() {
  const { installDatabase } = await import("../r6/fixture");
  const db = await installDatabase();
  await db.query("INSERT INTO accounts(id,name) VALUES($1,$2)", [ACCOUNT, "Test household Baidu OCR"]);
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { completePdfPagesWithOcr, pagesNeedingOcr } = await import("@/lib/documents/ocr");
  const bd = await import("@/lib/documents/ocr-baidu");
  // This file stands Baidu in with a fake globalThis.fetch; the node:https transport has its own test (baidu-transport-test.ts).
  bd.setBaiduTransportForTests("fetch");
  const { completePdfPagesWithBaidu } = bd;
  const { withFunctionDeadline } = await import("@/lib/jobs/function-time");
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
  // Nothing is left out of the Markdown: a page's footnotes, header, footer and page number are read too.
  assert.deepEqual(JSON.parse(calls[0].form!.optionalPayload), { useDocOrientationClassify: true, markdownIgnoreLabels: [] });
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

  // 2b. Each Baidu job is booked to the ledger ($0, priced, page count as input) and recorded as a VERIFIED provenance
  // attempt carrying Baidu's job id and the model Baidu reported.
  const usage = await db.query<{ input_tokens: number; cost_usd: string; priced: boolean; ok: boolean; model: string }>("SELECT input_tokens, cost_usd::text, priced, ok, model FROM model_usage WHERE provider='baidu'");
  assert.equal(usage.rows.length, 1, "one ledger row for the one Baidu job");
  assert.equal(Number(usage.rows[0].input_tokens), 2); assert.equal(Number(usage.rows[0].cost_usd), 0); assert.equal(usage.rows[0].priced, true); assert.equal(usage.rows[0].ok, true);
  const prov = await db.query<{ operation: string; resolved_model: string; provider_request_id: string; verified: boolean }>("SELECT operation, resolved_model, provider_request_id, verified FROM model_executions WHERE requested_provider='baidu'");
  assert.equal(prov.rows.length, 1);
  assert.deepEqual({ ...prov.rows[0] }, { operation: "hosted_ocr", resolved_model: "PaddleOCR-VL-1.6", provider_request_id: "job-abc123", verified: true });

  // 2c. BAIDU_IDENTITY_EXCEPTION: Baidu reports no model name -> the attempt is recorded with the SUBMITTED model and
  // Baidu's job id, counts as verified, and its text is used. A model Baidu does report is recorded as reported.
  await db.query("DELETE FROM model_executions WHERE requested_provider='baidu'");
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])], { model: null });
  out = await run();
  assert.equal(out[1].text, PAGE_A); assert.equal(aiCalls().length, 0, "no AI fallback: the job counts as verified");
  const noModel = await db.query<{ resolved_model: string; provider_request_id: string; verified: boolean }>("SELECT resolved_model, provider_request_id, verified FROM model_executions WHERE requested_provider='baidu'");
  assert.deepEqual({ ...noModel.rows[0] }, { resolved_model: "PaddleOCR-VL-1.6", provider_request_id: "job-abc123", verified: true });
  await db.query("DELETE FROM model_executions WHERE requested_provider='baidu'");
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])], { model: "PaddleOCR-VL-1.6-20261101" });
  await run();
  assert.equal((await db.query<{ resolved_model: string }>("SELECT resolved_model FROM model_executions WHERE requested_provider='baidu'")).rows[0].resolved_model, "PaddleOCR-VL-1.6-20261101");

  // 3. A page Baidu returns empty is read by the AI reader, alone; the page Baidu read keeps Baidu's text.
  seen = []; baidu = baiduJob([vlLine([PAGE_A, "   "])]);
  out = await run();
  assert.equal(out[1].text, PAGE_A);
  assert.equal(out[2].text, "AI reading of page 3");
  assert.equal(aiCalls().length, 1);
  assert.match(aiCalls()[0].body.messages[1].content[1].text, /in this order: 3\./, "only the empty page goes to the AI reader");

  // 3b. A page Baidu reads too little of (under the 24-character scan bar) goes to the AI reader too.
  seen = []; baidu = baiduJob([vlLine([PAGE_A, "Page 7 of 12"])]);
  out = await run();
  assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, "AI reading of page 3");

  // 3c. Caching: a document's full Baidu reading is cached; a reading with a weak page is NOT, so a later re-read asks again.
  const POLICY = "00000000-0000-4000-8000-0000000000c1";
  const PERSON = "00000000-0000-4000-8000-0000000000d1";
  await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Person A','Person A','self')", [PERSON, ACCOUNT]);
  await db.query("INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status) VALUES($1,$2,$3,'synthetic.pdf','synthetic/key','processing')", [POLICY, ACCOUNT, PERSON]);
  const runCached = () => completePdfPagesWithOcr({ accountId: ACCOUNT, resourceId: POLICY, bytes, pages });
  seen = []; baidu = baiduJob([vlLine([PAGE_A, "Page 7 of 12"])]);
  await runCached();
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
  out = await runCached();
  assert.equal(baiduCalls().filter((c) => c.method === "POST").length, 1, "the weak reading was not cached: Baidu is asked again");
  assert.equal(out[2].text, PAGE_B);
  seen = [];
  out = await runCached();
  assert.equal(baiduCalls().length, 0, "the full reading is served from the cache");
  assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, PAGE_B);

  // 4. Fallbacks: every Baidu failure sends all the scanned pages to the AI reader; nothing fails, nothing is lost.
  const fallbacks: [string, (s: Seen) => Reply, Record<string, string>?][] = [
    ["over daily quota (HTTP 429)", baiduJob([], { submit: { status: 429, json: { code: 429, msg: "quota" } } })],
    ["bad token (HTTP 401)", baiduJob([], { submit: { status: 401, json: { code: 401, msg: "unauthorised" } } })],
    ["error code with HTTP 200", baiduJob([], { submit: { status: 200, json: { code: 10001, msg: "limit" } } })],
    ["service down (HTTP 503)", baiduJob([], { submit: { status: 503, json: {} } })],
    ["no job id", baiduJob([], { submit: { status: 200, json: { code: 0, data: {} } } })],
    ["job failed", baiduJob([], { states: ["running", "failed"] })],
    ["never finishes", baiduJob([], { states: ["running"] }), { BAIDU_OCR_MAX_WAIT_MS: "30" }],
    ["page count mismatch", baiduJob([vlLine(["only one page"])])],
    ["malformed JSONL", baiduJob(["not json"])],
    ["plain-http result link", baiduJob([vlLine(["a", "b"])], { jsonUrl: "http://fake-baidu-bucket.test/r.jsonl" })],
    ["unknown model", baiduJob([vlLine([PAGE_A, PAGE_B])]), { BAIDU_PADDLEOCR_MODEL: "Not-A-Model" }],
    ["unversioned family alias PaddleOCR-VL", baiduJob([vlLine([PAGE_A, PAGE_B])]), { BAIDU_PADDLEOCR_MODEL: "PaddleOCR-VL" }],
    ["result link on a host that is not Baidu's", baiduJob([vlLine([PAGE_A, PAGE_B])], { jsonUrl: "https://fake-elsewhere.test/r.jsonl" })],
    ["no time left in the function for Baidu", baiduJob([vlLine([PAGE_A, PAGE_B])]), { VERCEL: "1", __DEADLINE__: "1" }],
  ];
  for (const [label, fake, env] of fallbacks) {
    seen = []; baidu = fake;
    const { __DEADLINE__, ...vars } = env ?? {};
    Object.assign(process.env, vars);
    // 121 s left in a 300 s function: less than the 120 s kept for the AI reader plus Baidu's 5 s minimum.
    out = __DEADLINE__ ? await withFunctionDeadline(Date.now() - 300_000 + 121_000, run) : await run();
    for (const k of Object.keys(vars)) delete process.env[k];
    assert.equal(out[1].text, "AI reading of page 2", `${label}: page 2 read by the AI reader`);
    assert.equal(out[2].text, "AI reading of page 3", `${label}: page 3 read by the AI reader`);
    assert.equal(aiCalls().length, 1, `${label}: one AI request`);
    if (/model|alias/.test(label) && !/report/.test(label)) assert.equal(baiduCalls().length, 0, `${label}: refused before anything is sent to Baidu`);
  }

  // 5. The token never appears anywhere but the Authorization header to the Baidu host: not in a URL, a body, or an error.
  for (const s of seen) assert.ok(!s.url.includes(TOKEN) && !JSON.stringify(s.body ?? {}).includes(TOKEN) && !JSON.stringify(s.form ?? {}).includes(TOKEN));
  assert.equal(bd.resultHostAllowed("bj.bcebos.com"), true); assert.equal(bd.resultHostAllowed("evilbcebos.com"), false); assert.equal(bd.resultHostAllowed("example.com"), false);
  baidu = baiduJob([], { submit: { status: 401, json: { code: 401, msg: "unauthorised" } } });
  const err = await bd.readPdfWithBaidu(new Uint8Array(await (await PDFDocument.create()).save()), { ...process.env, BAIDU_AISTUDIO_TOKEN: TOKEN } as NodeJS.ProcessEnv).catch((e) => e);
  assert.ok(err instanceof bd.BaiduOcrError && !String(err.message).includes(TOKEN) && !String(err.stack).includes(TOKEN));

  // 6. Baidu set up but no AI reader: Baidu still reads; when Baidu fails, the pages are marked NOT READ (never read and empty).
  process.env.READING_MODEL = "openai:gpt-5-mini";
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
  out = await run();
  assert.equal(out[1].text, PAGE_A);
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

  // 8b. No spend cap on reading: a household past its monthly limit still has its scanned pages read by Baidu.
  await db.query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cached_tokens,cost_usd,priced,duration_ms,ok) VALUES($1,'chat','openai','gpt-6-luna',0,0,0,100000,true,1,true)", [ACCOUNT]);
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
  const capped = await completePdfPagesWithBaidu({ accountId: ACCOUNT, bytes, pages, pageNumbers: [2, 3] });
  assert.deepEqual(capped.unread, []); assert.equal(capped.pages[1].text, PAGE_A);
  await db.query("DELETE FROM model_usage WHERE role='chat'");

  // 9. Plain OCR models (PP-OCRv5/v6) are read from rec_texts; large documents are split into several jobs.
  assert.deepEqual(bd.baiduPagesFromJsonl(JSON.stringify({ result: { ocrResults: [{ prunedResult: { rec_texts: ["Death", "S$100,000"] } }, { prunedResult: {} }] } }), "PP-OCRv5"), ["Death\nS$100,000", ""]);
  // 9a. A text block in Baidu's layout list that its Markdown left out (a schedule's last line) is put back at its own
  // place in reading order, never at the page's end by default; a block the Markdown already has (any spacing or case),
  // a picture, a table or a formula is not. Titles of any kind are text.
  {
    const vl = (md: string, list: unknown) => JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: md }, prunedResult: { parsing_res_list: list } }] } });
    const warned: string[] = []; const warn = console.warn; console.warn = (m: string) => { warned.push(String(m)); };
    try {
      const md = "Schedule\n\nHarbour Shield Plan In Force 25,000.00\n\nExample Assurance Ltd";
      const list = [
        { block_label: "doc_title", block_content: "Schedule" },
        { block_label: "text", block_content: "Harbour  shield plan in force 25,000.00" },
        { block_label: "footnote", block_content: "Note: cover ends at age 65." },
        { block_label: "image", block_content: "<img src=\"x.png\">" },
        { block_label: "table", block_content: "<table><tr><td>Extra</td><td>S$9</td></tr></table>" },
        { block_label: "formula", block_content: "x^2" },
        { block_label: "header_image", block_content: "Logo text" },
        { block_label: "footer", block_content: "Example Assurance Ltd" },
        { block_label: "footer", block_content: "Co. Reg. 200412345K (Printed: 03-Mar-2026)" },
        { block_label: "footer", block_content: "Co. Reg. 200412345K (Printed: 03-Mar-2026)" },
      ];
      assert.deepEqual(bd.baiduPagesFromJsonl(vl(md, list), "PaddleOCR-VL-1.5"),
        ["Schedule\n\nHarbour Shield Plan In Force 25,000.00\n\nNote: cover ends at age 65.\n\nExample Assurance Ltd\n\nCo. Reg. 200412345K (Printed: 03-Mar-2026)"]);
      assert.equal(warned.length, 1);
      assert.match(warned[0], /^\[baidu-ocr\] job page 1: 2 block\(s\) not in Baidu's Markdown added from its layout list \(labels: footnote, footer\)$/);
      assert.ok(!warned[0].includes("200412345"), "the log never carries a block's text");
      // Baidu's block_order, where every block has one, is the reading order; a missing block before every present one
      // goes first. Titles ("figure_title", "table_title") are text and are put back alike.
      assert.deepEqual(bd.baiduPagesFromJsonl(vl("Benefits\n\nDeath S$100,000", [
        { block_label: "text", block_content: "Death S$100,000", block_order: 3 },
        { block_label: "table_title", block_content: "Table 1: Benefits in Singapore Dollars", block_order: 2 },
        { block_label: "header", block_content: "Policy Schedule 2026", block_order: 0 },
        { block_label: "paragraph_title", block_content: "Benefits", block_order: 1 },
        { block_label: "figure_title", block_content: "Figure 2: How the 30-day wait works", block_order: 4 },
      ]), "PaddleOCR-VL-1.5"), ["Policy Schedule 2026\n\nBenefits\n\nTable 1: Benefits in Singapore Dollars\n\nDeath S$100,000\n\nFigure 2: How the 30-day wait works"]);
      assert.equal(warned.length, 2);
      // Nothing missing, no layout list, or a list that is not an array: the Markdown text alone, and nothing logged.
      const plain = ["Schedule\n\nHarbour Shield Plan In Force 25,000.00\n\nExample Assurance Ltd"];
      assert.deepEqual(bd.baiduPagesFromJsonl(vl(md, list.slice(0, 2)), "PaddleOCR-VL-1.5"), plain);
      assert.deepEqual(bd.baiduPagesFromJsonl(vl(md, "x"), "PaddleOCR-VL-1.5"), plain);
      assert.deepEqual(bd.baiduPagesFromJsonl(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: md } }] } }), "PaddleOCR-VL-1.5"), plain);
      // An empty Markdown page with a text block: the block is the page.
      assert.deepEqual(bd.baiduPagesFromJsonl(vl("", [{ block_label: "text", block_content: "Death S$100,000" }]), "PaddleOCR-VL-1.5"), ["Death S$100,000"]);
      assert.equal(warned.length, 3);
    } finally { console.warn = warn; }
  }
  // 9b. Every document-model page logs what Baidu's layout list holds, in fixed words and Baidu's labels only.
  {
    const said: string[] = []; const info = console.info; console.info = (m: string) => { said.push(String(m)); };
    try {
      const page = (list?: unknown) => ({ markdown: { text: "Death S$100,000" }, ...(list === undefined ? {} : { prunedResult: { parsing_res_list: list } }) });
      bd.baiduPagesFromJsonl(JSON.stringify({ result: { layoutParsingResults: [
        page([{ block_label: "text", block_content: "Death S$100,000" }, { block_label: "footer", block_content: "Reg 200412345K" }, { block_label: "text", block_content: "Death S$100,000" }, { block_label: "Weird Label!", block_content: "x" }]),
        page(), page([]),
      ] } }), "PaddleOCR-VL-1.5");
      // Without the document's page numbers, a page is named by its place in the Baidu job, and says so.
      assert.deepEqual(said.filter((m) => m.startsWith("[baidu-ocr]")), [
        "[baidu-ocr] job page 1 layout: 4 blocks: text 2, footer 1, other 1; added 1",
        "[baidu-ocr] job page 2 layout: no list; added 0",
        "[baidu-ocr] job page 3 layout: 0 blocks; added 0",
      ]);
      // With them, the document page is logged. A label not on Baidu's known list (a name, say) is logged as "other".
      said.length = 0;
      bd.baiduPagesFromJsonl(JSON.stringify({ result: { layoutParsingResults: [
        page([{ block_label: "john_tan", block_content: "x" }, { block_label: "text", block_content: "Death S$100,000" }]),
        page([{ block_label: "footer", block_content: "Reg 200412345K" }]),
      ] } }), "PaddleOCR-VL-1.5", [7, 9]);
      assert.deepEqual(said.filter((m) => m.startsWith("[baidu-ocr]")), [
        "[baidu-ocr] page 7 layout: 2 blocks: other 1, text 1; added 0",
        "[baidu-ocr] page 9 layout: 1 block: footer 1; added 1",
      ]);
      assert.ok(said.every((m) => !m.includes("john")), "an unknown label never prints");
      assert.ok(said.every((m) => !m.includes("200412345") && !m.includes("Death")), "never a block's text");
    } finally { console.info = info; }
  }
  process.env.BAIDU_OCR_PAGES_PER_JOB = "1";
  seen = []; baidu = baiduJob([vlLine([PAGE_A])], { states: ["done"] });
  out = await run();
  assert.equal(baiduCalls().filter((c) => c.method === "POST").length, 2, "one job per page when limited to one page a job");
  assert.ok(baiduCalls().filter((c) => c.method === "POST").every((c) => c.filePages === 1));
  assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, PAGE_A);
  delete process.env.BAIDU_OCR_PAGES_PER_JOB;

  // 11. Merged table cells keep every value under its own column and every row its own name; a figure that spans rows
  // (one shared limit) is printed once, never copied onto each row as that row's own.
  assert.equal(bd.baiduMarkdownToText('<table><tr><td rowspan="2">Hospital Benefits</td><td>Room &amp; Board</td><td>S$500 per day</td></tr><tr><td>ICU</td><td>S$1,000 per day</td></tr><tr><td colspan="2">Annual Limit</td><td>S$150,000</td></tr></table>'),
    "Hospital Benefits\tRoom & Board\tS$500 per day\nHospital Benefits\tICU\tS$1,000 per day\nAnnual Limit\t\tS$150,000");
  assert.equal(bd.baiduMarkdownToText("<table><tr><th>Benefit</th><th>Amount</th><th>Overall</th></tr><tr><td>Outpatient</td><td>RM 200</td><td rowspan=3>RM 5,000 per year</td></tr><tr><td>Dental</td><td>RM 300</td></tr><tr><td>Optical</td><td>RM 150</td></tr></table>"),
    "Benefit\tAmount\tOverall\nOutpatient\tRM 200\tRM 5,000 per year\nDental\tRM 300\nOptical\tRM 150");
  assert.equal(bd.baiduMarkdownToText('<table><tr><th colspan="3">Plan B</th></tr><tr><td>Death</td><td>EUR 20.000</td><td>100%</td></tr></table>'), "Plan B\nDeath\tEUR 20.000\t100%");
  // 12. Inline maths a vision model may print around figures never leaves a "$" that reads as a currency sign; printed money stays as printed.
  assert.equal(bd.baiduMarkdownToText("Co-insurance $10\\%$ of the bill; $\\text{RM}\\ 50,000$; $$\\mathrm{HK\\$}\\,2{,}000$$"), "Co-insurance 10% of the bill; RM 50,000; HK$ 2,000");
  assert.equal(bd.baiduMarkdownToText("Sum Assured $ 100,000 and S$1,000 to S$2,000 or US$5 and $3"), "Sum Assured $ 100,000 and S$1,000 to S$2,000 or US$5 and $3");
  // Critic #410 F1: a "$" after a letter never opens maths and a "$" before a digit or comma never closes it, so two
  // amounts are never paired into one span and lose their currency.
  for (const line of ["Hospital cash S$200^{1} per day, max S$9,000", "S$500 per day^ and S$1,000 overall", "HK$300{a} or US$40", "$500 and $600^{2}", "$500^{2} per day and $600", "Hospital S$200^{1} per day, max $ 9,000"])
    assert.equal(bd.baiduMarkdownToText(line), line);
  assert.equal(bd.baiduMarkdownToText("\\$1{,}000 and \\$2{,}000"), "$1,000 and $2,000");
  // F2: a span with real working is left exactly as printed (no clean figure is made from it).
  assert.equal(bd.baiduMarkdownToText("$$\\frac{1}{2} \\times 100{,}000$$ payable; $\\sqrt{4}$"), "$$\\frac{1}{2} \\times 100{,}000$$ payable; $\\sqrt{4}$");
  // F3/F4: by position, not wording. A rowspan cell in the label column (column 0, or left of the row's first number)
  // repeats on each row ("Age 18-65", "Section 2 Accident"); anywhere else a cell with a number, however written, is one
  // shared figure, printed once.
  const grid = (t: string) => bd.baiduMarkdownToText(`<table>${t}</table>`);
  assert.equal(grid('<tr><td rowspan="2">Age 18-65</td><td>Death</td><td>S$100,000</td></tr><tr><td>TPD</td><td>S$50,000</td></tr>'), "Age 18-65\tDeath\tS$100,000\nAge 18-65\tTPD\tS$50,000");
  assert.equal(grid('<tr><td rowspan="2">Section 2 Accident</td><td>Death</td><td>25%</td></tr><tr><td>TPD</td><td>10%</td></tr>'), "Section 2 Accident\tDeath\t25%\nSection 2 Accident\tTPD\t10%");
  assert.equal(grid('<tr><th>Benefit</th><th>Limit (S$)</th><th>Overall (S$)</th></tr><tr><td>Outpatient</td><td>200</td><td rowspan="3">5000</td></tr><tr><td>Dental</td><td>300</td></tr><tr><td>Optical</td><td>150</td></tr>'),
    "Benefit\tLimit (S$)\tOverall (S$)\nOutpatient\t200\t5000\nDental\t300\nOptical\t150");
  assert.equal(grid('<tr><td>A</td><td rowspan="2">SGD5000</td></tr><tr><td>B</td></tr>'), "A\tSGD5000\nB");
  assert.equal(grid('<tr><td>Death</td><td rowspan="2">One hundred thousand dollars</td></tr><tr><td>TPD</td></tr>'), "Death\tOne hundred thousand dollars\nTPD");
  assert.equal(grid('<tr><td>Hospital cash</td><td>S$100 per day</td><td rowspan="2">up to 30 days</td></tr><tr><td>ICU cash</td><td>S$200 per day</td></tr>'), "Hospital cash\tS$100 per day\tup to 30 days\nICU cash\tS$200 per day");
  assert.equal(grid('<tr><td>Physio</td><td>S$80 per visit</td><td rowspan="2">max 10 visits</td></tr><tr><td>Chiro</td><td>S$60 per visit</td></tr>'), "Physio\tS$80 per visit\tmax 10 visits\nChiro\tS$60 per visit");
  // F5: column 0 still holds back a currency-marked amount (a sideways table), but names with numbers repeat.
  assert.equal(grid('<tr><td rowspan="2">S$5,000 overall</td><td>Outpatient</td><td>S$200</td></tr><tr><td>Dental</td><td>S$300</td></tr>'), "S$5,000 overall\tOutpatient\tS$200\n\tDental\tS$300");
  for (const [cell, kept] of [["RM 5000", false], ["SGD5000", false], ["1,000,000", false], ["80%", false], ["5000 EUR", false], ["Section 2 Accident", true], ["Plan 3 (age 66-75)", true], ["Table 1", true]] as const)
    assert.equal(grid(`<tr><td rowspan="2">${cell}</td><td>A</td></tr><tr><td>B</td></tr>`).split("\n")[1].startsWith(cell), kept, cell);
  // TE #410 T4: the second row of a sideways table (column 0's shared amount held back) keeps its own name and amount
  // all the way to the benefit rows the catalogue reads; a row of values only is still not given a name.
  {
    const { benefitRowsFromText } = await import("@/lib/documents/layout");
    const t4 = grid('<tr><th>Overall limit</th><th>Benefit</th><th>Own limit</th></tr><tr><td rowspan="2">S$5,000 overall</td><td>Physiotherapy</td><td>S$60</td></tr><tr><td>Chiropractic</td><td>S$75</td></tr><tr><td rowspan="2">Outpatient group</td><td>Specialist visit</td><td>S$200</td></tr><tr><td>Blood test</td><td>S$80</td></tr>');
    const rows = benefitRowsFromText(t4).map((r) => `${r.label}=${r.value}`);
    assert.ok(rows.includes("Chiropractic=S$75"), rows.join(" | "));
    assert.ok(rows.includes("Blood test=S$80") && rows.includes("Specialist visit=S$200"), rows.join(" | "));
    assert.ok(!rows.some((r) => r.startsWith("Chiropractic=Chiropractic")));
    assert.deepEqual(benefitRowsFromText("Benefit\tPlan A\tPlan B\nRoom\tS$300\tS$500\n\tS$100\tS$200").map((r) => r.label), ["Room", "Room"]);
    // Critic #410 F6: a shifted cell is a name only under a column headed as benefit names. Under people's names it
    // belongs to nobody known, and the row is skipped (never TPD S$80,000 for John Roe).
    const joint = benefitRowsFromText("Benefit\tJane Doe\tJohn Roe\nDeath\tS$100,000\tS$50,000\n\tTPD\tS$80,000").map((r) => `${r.label}=${r.value}`);
    assert.deepEqual(joint, ["Death=S$100,000", "Death=S$50,000"], joint.join(" | "));
    assert.ok(!benefitRowsFromText("Overall\tPlan A\tPlan B\nS$5,000 overall\tRoom\tS$300\n\tICU\tS$600").some((r) => r.label === "ICU"), "a plan heading is not a name column");
    // TE #410 T5: under "Detail" a condition or footnote is never a benefit of its own.
    const t5 = benefitRowsFromText("Benefit\tDetail\tLimit\nHospital cash\tPer day of stay\tS$100\n\tSubject to pre-approval\tS$500\n\t* Per policy year\tS$1,000\n\tAfter a 90-day waiting period\tS$2,000").map((r) => r.label);
    assert.deepEqual([...new Set(t5)], ["Hospital cash"], t5.join(" | "));
    // A repeated group name in column 0 under a non-name heading: each row is named by its own benefit cell.
    const grouped = benefitRowsFromText("Overall limit\tBenefit\tOwn limit\nOutpatient group\tSpecialist visit\tS$200\nOutpatient group\tBlood test\tS$80").map((r) => `${r.label}=${r.value}`);
    assert.deepEqual(grouped, ["Specialist visit=S$200", "Blood test=S$80"], grouped.join(" | "));
    // Critic #410 F7: a lower-case or footnote-marked cell continues the row above; it is never named as a benefit.
    for (const cont of ["per visit", "* per policy year", "*Per policy year", "subject to approval"])
      assert.ok(!benefitRowsFromText(`Section\tBenefit\tLimit\nA\tOutpatient\tS$1,000\n\t${cont}\tS$100`).some((r) => r.label === cont), cont);
    assert.ok(benefitRowsFromText("Section\tBenefit\tLimit\nA\tOutpatient\tS$1,000\n\tDental\tS$100").some((r) => r.label === "Dental" && r.value === "S$100"));
    // Critic #411 F8: only clear continuations are skipped; names that start in lower case or with a mark stay (as on main).
    for (const [name, amount] of [["eye test", "S$50"], ["e-consultation", "S$30"], ["iPhone repair", "S$200"], ["*Dental", "S$300"], ["in-patient", "S$900"], ["office visit", "S$40"]])
      assert.ok(benefitRowsFromText(`Section\tBenefit\tLimit\nA\tOutpatient\tS$1,000\n\t${name}\t${amount}`).some((r) => r.label.includes(name.replace("*", "")) && r.value === amount), name);
    for (const cont of ["each visit", "up to 10 visits", "max 3 claims", "including X-rays", "* subject to approval", "*Per policy year", "in hospital only"])
      assert.ok(!benefitRowsFromText(`Section\tBenefit\tLimit\nA\tOutpatient\tS$1,000\n\t${cont}\tS$100`).some((r) => r.label === cont), cont);
    // A label column already headed as names keeps its name, even when a later column is headed as names too.
    assert.deepEqual([...new Set(benefitRowsFromText("Benefit\tDescription\tLimit\nRoom and board\tWard A\tS$100").map((r) => r.label))], ["Room and board"]);
    // "Injury | Benefit": the Benefit column holds the amounts, so the name stays in column 0.
    assert.deepEqual(benefitRowsFromText("Injury\tBenefit\tNotes\nLoss of eye\t50%\tper eye\nLoss of limb\tS$10,000\t-").map((r) => `${r.label}=${r.value}`), ["Loss of eye=50%", "Loss of limb=S$10,000"]);
    for (const head of ["Benefit", "Type of benefit", "Description", "Coverage", "Item"])
      assert.ok(benefitRowsFromText(`Overall limit\t${head}\tOwn limit\nS$5,000 overall\tPhysiotherapy\tS$60\n\tChiropractic\tS$75`).some((r) => r.label === "Chiropractic" && r.value === "S$75"), head);
  }
  assert.equal(grid('<tr><td rowspan="2">Plan 1</td><td rowspan="2">Hospital</td><td>Room</td><td>S$300</td></tr><tr><td>ICU</td><td>S$600</td></tr>'), "Plan 1\tHospital\tRoom\tS$300\nPlan 1\tHospital\tICU\tS$600");

  // 13. Baidu unreachable (the first live run, 10 Nov: connection failures after ~10 s from Vercel): the AI reader reads the
  // pages, the processing history says which call failed and the system's error code, and this instance then skips
  // Baidu for the cool-down instead of waiting on a connection for every later document.
  process.env.BAIDU_OCR_COOLDOWN_MS = "600000";
  process.env.BAIDU_OCR_PROBE_STEP_MS = "300";
  const POLICY2 = "00000000-0000-4000-8000-0000000000c2";
  await db.query("INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status) VALUES($1,$2,$3,'synthetic2.pdf','synthetic/key2','processing')", [POLICY2, ACCOUNT, PERSON]);
  seen = []; baidu = () => ({ status: 0, throwCode: "UND_ERR_CONNECT_TIMEOUT" });
  const bytes2 = await fixturePdf("-B"); // other bytes: no reading of them is cached yet
  out = await completePdfPagesWithOcr({ accountId: ACCOUNT, resourceId: POLICY2, bytes: bytes2, pages: await extractPdfPages(bytes2) });
  assert.equal(out[1].text, "AI reading of page 2");
  const why = await db.query<{ detail: string }>("SELECT detail FROM processing_failure_diagnostics WHERE resource_id::text=$1 AND failure_code='BAIDU_OCR_FALLBACK'", [POLICY2]);
  assert.match(why.rows[0].detail, /network submit UND_ERR_CONNECT_TIMEOUT/);
  assert.ok(!why.rows[0].detail.includes(TOKEN));
  // ...and the path probe then records which step of the connection fails (here the made-up host has no address), with no token.
  const probe = await db.query<{ detail: string }>("SELECT detail FROM processing_failure_diagnostics WHERE resource_id::text=$1 AND failure_code='BAIDU_OCR_PATH_PROBE'", [POLICY2]);
  assert.equal(probe.rows.length, 1, "one path probe after an unreachable Baidu");
  assert.match(probe.rows[0].detail, /^region=local host=fake-baidu\.test dns=\S+/);
  assert.ok(!probe.rows[0].detail.includes(TOKEN));
  process.env.BAIDU_OCR_PROBE_STEP_MS = "0";
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
  out = await run();
  assert.equal(baiduCalls().length, 0, "cooling down: Baidu is not tried again at once");
  assert.equal(out[1].text, "AI reading of page 2");
  // Another (or a fresh) function instance shares the cool-down through the database.
  bd.forgetLocalBaiduCooldown();
  seen = []; out = await run();
  assert.equal(baiduCalls().length, 0, "the cool-down is shared by every instance");
  assert.equal(out[1].text, "AI reading of page 2");
  await bd.resetBaiduCooldown();
  seen = []; out = await run();
  assert.equal(out[1].text, PAGE_A, "after the cool-down Baidu reads again");
  // 13b. Baidu takes the upload but never answers the submit (11 Nov, from Singapore: "timeout submit" after 60 s): the
  // timeout starts the same shared cool-down, so the next document, on any instance, goes straight to the AI reader.
  process.env.BAIDU_OCR_REQUEST_TIMEOUT_MS = "200";
  const POLICY3 = "00000000-0000-4000-8000-0000000000c3";
  await db.query("INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status) VALUES($1,$2,$3,'synthetic3.pdf','synthetic/key3','processing')", [POLICY3, ACCOUNT, PERSON]);
  seen = []; baidu = (q) => (q.method === "POST" ? { status: 0, hang: true } : baiduJob([vlLine([PAGE_A, PAGE_B])])(q));
  const bytes3 = await fixturePdf("-C");
  out = await completePdfPagesWithOcr({ accountId: ACCOUNT, resourceId: POLICY3, bytes: bytes3, pages: await extractPdfPages(bytes3) });
  assert.equal(out[1].text, "AI reading of page 2");
  const why3 = await db.query<{ detail: string }>("SELECT detail FROM processing_failure_diagnostics WHERE resource_id::text=$1 AND failure_code='BAIDU_OCR_FALLBACK'", [POLICY3]);
  assert.match(why3.rows[0].detail, /timeout submit/);
  bd.forgetLocalBaiduCooldown();
  seen = []; out = await run();
  assert.equal(baiduCalls().length, 0, "a submit timeout starts the shared cool-down");
  await bd.resetBaiduCooldown();
  // A timeout while POLLING (the job was taken) does not: Baidu is reachable.
  seen = []; baidu = (q) => (q.method === "GET" && /jobs\//.test(q.url) ? { status: 0, hang: true } : baiduJob([vlLine([PAGE_A, PAGE_B])])(q));
  out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: await fixturePdf("-D"), pages: await extractPdfPages(await fixturePdf("-D")) });
  bd.forgetLocalBaiduCooldown();
  seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
  out = await run();
  assert.equal(out[1].text, PAGE_A, "no cool-down after a poll timeout");
  delete process.env.BAIDU_OCR_REQUEST_TIMEOUT_MS;
  await bd.resetBaiduCooldown();
  process.env.BAIDU_OCR_COOLDOWN_MS = "0";

  // 14. TE #410: a locked file saved with object streams that pdf-lib cannot open. Page 1 (one image) is rebuilt by
  // PDF.js and read; page 2 (two images) cannot be copied for any reader, so it is marked NOT READ (named to the person),
  // and the document finishes instead of failing its job over and over.
  {
    const { readFileSync } = await import("node:fs");
    const locked = new Uint8Array(readFileSync(require("node:path").join(__dirname, "fixtures", "scan-locked-objstm-2p.pdf")));
    const blank = [1, 2].map((n) => ({ pageNumber: n, text: "" })) as unknown as Awaited<ReturnType<typeof extractPdfPages>>;
    seen = []; baidu = baiduJob([vlLine(["Baidu page 1"])]);
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: locked, password: "Harbour-2026", pages: blank, pageNumbers: [1, 2] });
    assert.equal(out[0].text, "AI reading of page 1", "the page PDF.js rebuilt is read");
    assert.equal(out[1].notRead, true, "the page no reader can be sent is named as not read"); assert.equal(out[1].unreadable, true);
    assert.equal(aiCalls().length, 1); assert.match(aiCalls()[0].body.messages[1].content[1].text, /in this order: 1\./);
    // Without the password nothing can be rebuilt: every page is named, no reader is sent noise.
    seen = [];
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: locked, pages: blank, pageNumbers: [1, 2] });
    assert.deepEqual(out.map((p) => p.notRead), [true, true]); assert.equal(aiCalls().length, 0);
  }

  // 2a. Baidu refuses that option (a 400: no job made): the pages are submitted once more with its default Markdown and
  //     still read by Baidu, not handed to the AI reader. Any other refusal is not retried this way.
  {
    seen = []; ai = aiReads;
    const ok = baiduJob([vlLine(["Page two text read by Baidu here", "Page three text read by Baidu here"])]);
    baidu = (q) => q.method === "POST" && JSON.parse(q.form!.optionalPayload).markdownIgnoreLabels ? { status: 400, json: { code: 400, msg: "bad option" } } : ok(q);
    const again = await run();
    const posts = baiduCalls().filter((c) => c.method === "POST");
    assert.equal(posts.length, 2, "submitted again once");
    assert.deepEqual(JSON.parse(posts[1].form!.optionalPayload), { useDocOrientationClassify: true });
    assert.equal(again[1].text, "Page two text read by Baidu here"); assert.equal(aiCalls().length, 0);
    await bd.resetBaiduCooldown();
    seen = [];
    baidu = baiduJob([], { submit: { status: 401, json: { code: 401, msg: "Unauthorized" } } });
    await run();
    assert.equal(baiduCalls().filter((c) => c.method === "POST").length, 1, "an auth refusal is not submitted again");
    await bd.resetBaiduCooldown();
    seen = [];
    baidu = baiduJob([], { submit: { status: 413, json: { code: 413, msg: "too large" } } });
    await run();
    assert.equal(baiduCalls().filter((c) => c.method === "POST").length, 1, "a too-large refusal is not uploaded again");
  }
  // 15. Link submit (fileUrl): the pages are staged in our storage, Baidu downloads them through a short-lived signed
  // link, and the staged copy is removed whatever happens. The local storage driver has no link (stage gives null), so
  // every case above uploaded the file, exactly as before.

  {
    await bd.resetBaiduCooldown();
    const LINK = "https://storage.example/sign/k-1?token=SECRET-LINK";
    let staged: { accountId: string; ttlSeconds: number; pages: number }[] = [];
    let removed: string[] = [];
    let stageMode: "ok" | "throw" | "null" = "ok";
    let removeThrows = false;
    bd.setBaiduHandoffForTests({
      stage: async ({ accountId, bytes: b, ttlSeconds }) => {
        if (stageMode === "throw") throw new Error("storage down");
        if (stageMode === "null") return null;
        staged.push({ accountId, ttlSeconds, pages: (await PDFDocument.load(b)).getPageCount() });
        return { storageKey: `k-${staged.length}`, url: LINK };
      },
      remove: async (key) => { if (removeThrows) throw new Error("remove failed"); removed.push(key); },
    });
    const submits = () => baiduCalls().filter((c) => c.method === "POST");

    // Happy path: a small JSON submit with the link, no file in the request; Baidu's text is used; the copy is removed.
    seen = []; ai = aiReads; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
    out = await run();
    assert.equal(submits().length, 1);
    assert.equal(submits()[0].form, undefined, "link mode sends no multipart form");
    assert.equal(submits()[0].filePages, undefined, "link mode uploads no file");
    assert.deepEqual(submits()[0].body, { fileUrl: LINK, model: "PaddleOCR-VL-1.6", optionalPayload: { useDocOrientationClassify: true, markdownIgnoreLabels: [] } });
    assert.equal(submits()[0].auth, `Bearer ${TOKEN}`);
    assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, PAGE_B); assert.equal(aiCalls().length, 0);
    assert.deepEqual(staged, [{ accountId: ACCOUNT, ttlSeconds: 900, pages: 2 }], "only the two scanned pages are staged, with a 15-minute link");
    assert.deepEqual(removed, ["k-1"], "staged copy removed after a successful job");

    // A failed job (e.g. Baidu could not download the link): the copy is still removed and the AI reader reads the pages.
    seen = []; staged = []; removed = []; baidu = baiduJob([], { states: ["failed"] });
    out = await run();
    assert.deepEqual(removed, ["k-1"], "staged copy removed after a failed job");
    assert.equal(out[1].text, "AI reading of page 2"); assert.equal(aiCalls().length, 1);

    // Removal fails: the copy is queued for the storage purge instead of being left behind.
    seen = []; staged = []; removed = []; removeThrows = true; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
    await db.query("DELETE FROM storage_purge_queue WHERE storage_key='k-1'").catch(() => undefined);
    out = await run();
    assert.equal(out[1].text, PAGE_A);
    const queued = await db.query("SELECT storage_domain, reason FROM storage_purge_queue WHERE storage_key='k-1'");
    assert.deepEqual(queued.rows, [{ storage_domain: "policy", reason: "ocr_handoff" }], "unremoved copy queued for purge");
    removeThrows = false;

    // Staging fails: Baidu is not called (no link to give it); the AI reader reads the pages.
    seen = []; staged = []; removed = []; stageMode = "throw";
    out = await run();
    assert.equal(baiduCalls().length, 0, "no Baidu call without a staged copy");
    assert.equal(out[1].text, "AI reading of page 2"); assert.equal(aiCalls().length, 1);

    // No link available (the local storage driver): the file is uploaded as before.
    seen = []; stageMode = "null"; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
    out = await run();
    assert.equal(submits()[0].filePages, 2, "falls back to uploading the file"); assert.equal(submits()[0].form?.model, "PaddleOCR-VL-1.6");
    assert.equal(out[1].text, PAGE_A);

    // BAIDU_OCR_SUBMIT=upload: storage is never touched.
    seen = []; staged = []; stageMode = "ok"; process.env.BAIDU_OCR_SUBMIT = "upload";
    out = await run();
    assert.equal(staged.length, 0, "upload mode never stages a copy"); assert.equal(submits()[0].filePages, 2);
    delete process.env.BAIDU_OCR_SUBMIT;
    // The link never reaches a log or error: only the submit body carries it.
    for (const s of seen) assert.ok(!s.url.includes("SECRET-LINK"));
    bd.setBaiduHandoffForTests(null);
  }

  // 16. The connection to Baidu sometimes does not open at all (11 Nov, 12:57: TCP timed out where 12:47 had worked).
  // A call that failed BEFORE sending anything is tried again (1 s, then 2 s later); a call that sent anything is not.
  {
    await bd.resetBaiduCooldown();
    process.env.BAIDU_OCR_CONNECT_RETRIES = "2";
    process.env.BAIDU_OCR_SUBMIT = "upload";
    const posts = () => baiduCalls().filter((c) => c.method === "POST");
    // Two failed connections, then it opens: one job, Baidu's text, no AI reader.
    let refusals = 2;
    const ok = baiduJob([vlLine([PAGE_A, PAGE_B])]);
    seen = []; baidu = (q) => (q.method === "POST" && refusals-- > 0 ? { status: 0, throwCode: "ECONNREFUSED" } : ok(q));
    let t0 = Date.now();
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: await fixturePdf("-R1"), pages: await extractPdfPages(await fixturePdf("-R1")) });
    assert.equal(posts().length, 3, "two retries after connections that did not open");
    assert.ok(Date.now() - t0 >= 2_900, "waits 1 s, then 2 s");
    assert.equal(out[1].text, PAGE_A); assert.equal(aiCalls().length, 0);
    assert.equal(baiduCalls().filter((c) => c.method === "GET" && /jobs\//.test(c.url)).length >= 1, true);
    // Never opens: three tries in all, then the AI reader; the failure says how many tries.
    seen = []; baidu = () => ({ status: 0, throwCode: "ECONNREFUSED" });
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: await fixturePdf("-R2"), pages: await extractPdfPages(await fixturePdf("-R2")) });
    assert.equal(posts().length, 3, "1 try + 2 retries, no more");
    assert.equal(out[1].text, "AI reading of page 2");
    await bd.resetBaiduCooldown();
    // A failure AFTER the request may have reached Baidu (connection reset) is never repeated: no second paid submit.
    seen = []; baidu = () => ({ status: 0, throwCode: "ECONNRESET" });
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: await fixturePdf("-R3"), pages: await extractPdfPages(await fixturePdf("-R3")) });
    assert.equal(posts().length, 1, "a reset is not retried");
    await bd.resetBaiduCooldown();
    // An HTTP reply is never retried either.
    seen = []; baidu = baiduJob([], { submit: { status: 503, json: { code: 503 } } });
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: await fixturePdf("-R4"), pages: await extractPdfPages(await fixturePdf("-R4")) });
    assert.equal(posts().length, 1, "an HTTP error is not retried");
    // No retry once too little of the job's time is left for one: the job's own limit holds.
    process.env.BAIDU_OCR_MAX_WAIT_MS = "5500"; // enough to start a job (5 s), not enough for a 1 s wait plus 5 s
    seen = []; baidu = () => ({ status: 0, throwCode: "ECONNREFUSED" }); t0 = Date.now();
    out = await completePdfPagesWithOcr({ accountId: ACCOUNT, bytes: await fixturePdf("-R5"), pages: await extractPdfPages(await fixturePdf("-R5")) });
    assert.equal(posts().length, 1, "no retry without time for it"); assert.ok(Date.now() - t0 < 5_500);
    delete process.env.BAIDU_OCR_MAX_WAIT_MS;
    await bd.resetBaiduCooldown();
    // The rule itself: only a failure before any byte was sent counts.
    const { TransportError } = await import("@/lib/documents/baidu-transport");
    const tr = (phase: "dns" | "connect" | "tls" | "upload" | "reply", sentBytes: number) => new TransportError("network", { phase, sentBytes, totalBytes: 10, elapsedMs: 1 });
    assert.deepEqual([tr("dns", 0), tr("connect", 0), tr("tls", 0), tr("upload", 0), tr("upload", 5), tr("reply", 10)].map(bd.failedBeforeSending), [true, true, true, false, false, false]);
    // A retry gets the short connect limit (5 s by default; a healthy connection opens in about 1.3 s); the first try keeps
    // the full one, and a retry is never given a longer limit than the first try.
    const l = { totalMs: 80_000, idleMs: 60_000, connectMs: 30_000, family: 4 as const };
    assert.deepEqual([0, 1, 2].map((a) => bd.limitsForTry(l, a, 5_000).connectMs), [30_000, 5_000, 5_000]);
    assert.equal(bd.limitsForTry({ ...l, connectMs: 3_000 }, 1, 5_000).connectMs, 3_000);
    assert.equal(bd.baiduOcrSettings({} as NodeJS.ProcessEnv).retryConnectTimeoutMs, 5_000);
    // All tries of one call stay within ~40 s: a connection that never opens (30 s, then a 5 s retry) gets one retry, not two;
    // fast refusals get both; a retry also needs 5 s of the job's time after the wait.
    assert.equal(bd.retryFits(30_000, 60_000, 1_000, 5_000), true, "30 s + 1 s + 5 s = 36 s: one retry");
    assert.equal(bd.retryFits(36_000, 54_000, 2_000, 5_000), false, "36 s + 2 s + 5 s = 43 s: no second retry");
    assert.equal(bd.retryFits(15_400, 70_000, 1_000, 5_000), true); assert.equal(bd.retryFits(21_400, 64_000, 2_000, 5_000), true, "15.4 s system timeout: both retries, ~28 s in all");
    assert.equal(bd.retryFits(1_000, 70_000, 2_000, 5_000), true, "fast refusals: both retries");
    assert.equal(bd.retryFits(0, 5_500, 1_000, 5_000), false, "too little of the job's time left");
    process.env.BAIDU_OCR_CONNECT_RETRIES = "0";
    delete process.env.BAIDU_OCR_SUBMIT;
  }

  // 17. Background reading: when Baidu has not finished within the run (or could not be reached), the reading waits and
  // looks again later instead of handing the pages to the AI reader; the same Baidu job is looked at again, never a second.
  {
    await bd.resetBaiduCooldown();
    const { BaiduReadingPending, parseBaiduWaitState, baiduWaitDelayMs } = await import("@/lib/documents/baidu-wait");
    const KEY = (n: number) => `${ACCOUNT}/ocr-handoff/0000000${n}-0000-4000-8000-000000000000/pages.pdf`;
    let staged = 0; let removed: string[] = [];
    bd.setBaiduHandoffForTests({ stage: async () => ({ storageKey: KEY(++staged), url: "https://storage.example/sign/x?token=SECRET-LINK" }), remove: async (k) => { removed.push(k); } });
    const submits = () => baiduCalls().filter((c) => c.method === "POST");
    const bg = (wait: any) => completePdfPagesWithOcr({ accountId: ACCOUNT, bytes, pages, baiduWait: wait });
    const pending = async (wait: any) => {
      try { await bg(wait); } catch (e) { if (e instanceof BaiduReadingPending) return e; throw e; }
      assert.fail("expected the reading to wait for Baidu");
    };
    // Each run gives Baidu 5.5 s here (the floor is 5 s); live it is 90 s.
    process.env.BAIDU_OCR_MAX_WAIT_MS = "5500";

    // Run 1: Baidu takes the job but is still on it when the run's time is up -> wait; nothing for the AI reader.
    seen = []; ai = aiReads; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])], { states: ["pending"] });
    const t1 = Date.now();
    const w1 = await pending("start");
    assert.ok(Date.now() - t1 < 9_000, "the run ends within its Baidu time");
    assert.equal(submits().length, 1); assert.equal(aiCalls().length, 0, "the AI reader is not called while Baidu reads");
    assert.deepEqual(w1.pages, [2, 3]);
    assert.equal(w1.state.runs, 1); assert.deepEqual(w1.state.gaveUp, []);
    assert.deepEqual(w1.state.jobs.map((j) => [j.pages, j.jobId, j.stagedKey]), [[[2, 3], "job-abc123", KEY(1)]]);
    assert.deepEqual(removed, [], "the staged copy is kept while Baidu may still download it");
    // What the job payload carries survives the round trip, and holds no text, link or token.
    const carried = parseBaiduWaitState(JSON.parse(JSON.stringify(w1.state)));
    assert.deepEqual(carried, w1.state);
    assert.ok(!/SECRET-LINK|Death Benefit|test-token/.test(JSON.stringify(w1.state)));
    assert.equal(baiduWaitDelayMs(1), 20_000); assert.equal(baiduWaitDelayMs(2), 40_000); assert.equal(baiduWaitDelayMs(99), 300_000);

    // Run 2: the job is done -> its result is read, with no second submit; the staged copy is removed; no AI reader.
    seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])], { states: ["done"] });
    out = await bg(carried!);
    assert.equal(submits().length, 0, "the same job is looked at again, never submitted twice");
    assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, PAGE_B); assert.equal(aiCalls().length, 0);
    assert.deepEqual(removed, [KEY(1)]);

    // Baidu not reached at all (the connection is refused) -> wait, no job kept; the next run submits again and reads.
    seen = []; removed = []; staged = 0; baidu = () => ({ status: 0, throwCode: "ECONNREFUSED" });
    const w2 = await pending("start");
    assert.deepEqual(w2.state.jobs, []); assert.deepEqual(w2.pages, [2, 3]); assert.equal(aiCalls().length, 0);
    assert.deepEqual(removed, [KEY(1)], "the copy staged for a submit that failed is removed at once");
    seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])]);
    out = await bg(w2.state);
    assert.equal(submits().length, 1); assert.equal(out[1].text, PAGE_A); assert.equal(aiCalls().length, 0);

    // Baidu fails the job (or refuses the request): not waited on -> the AI reader reads the pages in this same run.
    seen = []; removed = []; staged = 0; baidu = baiduJob([], { states: ["failed"] });
    out = await bg("start");
    assert.equal(out[1].text, "AI reading of page 2"); assert.equal(aiCalls().length, 1);
    assert.deepEqual(removed, [KEY(1)]);
    seen = []; removed = []; staged = 0; baidu = baiduJob([], { submit: { status: 401, json: { code: 401 } } });
    out = await bg("start");
    assert.equal(out[1].text, "AI reading of page 2"); assert.equal(aiCalls().length, 1, "a refused request goes to the AI reader at once");

    // The waiting window is over (30 min from the first try): the job is looked at one last time, then the AI reader reads.
    seen = []; removed = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])], { states: ["running"] });
    const old = { ...w1.state, since: Date.now() - 31 * 60_000, runs: 9 };
    out = await bg(old);
    assert.equal(submits().length, 0); assert.equal(out[1].text, "AI reading of page 2"); assert.equal(aiCalls().length, 1);
    assert.deepEqual(removed, [KEY(1)], "no staged copy is left when the reading stops waiting");
    // Window over and nothing submitted yet: no new Baidu job; the AI reader reads.
    seen = []; out = await bg({ since: Date.now() - 31 * 60_000, runs: 9, jobs: [], gaveUp: [] });
    assert.equal(baiduCalls().length, 0); assert.equal(out[1].text, "AI reading of page 2");

    // Two jobs (one page each): one read, one still running -> wait; the next run reads the second, and the first page's
    // text is not lost (its job is read again from Baidu: here there is no reading cache, since no document id is given).
    process.env.BAIDU_OCR_PAGES_PER_JOB = "1";
    seen = []; removed = []; staged = 0;
    let polls = 0;
    baidu = (s) => {
      if (s.method === "POST") return { status: 200, json: { code: 0, data: { jobId: `job-${submits().length}` } } };
      const id = s.url.match(/jobs\/(job-\d)/)?.[1];
      if (id) { polls++; const done = id === "job-1" || polls > 1_000_000; return { status: 200, json: { code: 0, data: { state: done ? "done" : "running", ...(done ? { resultUrl: { jsonUrl: `https://fake-baidu-bucket.test/${id}.jsonl` } } : {}) } } }; }
      if (/job-1\.jsonl/.test(s.url)) return { status: 200, text: vlLine([PAGE_A]) + "\n" };
      if (/job-2\.jsonl/.test(s.url)) return { status: 200, text: vlLine([PAGE_B]) + "\n" };
      return { status: 404, json: {} };
    };
    const w3 = await pending("start");
    assert.deepEqual(baiduCalls().slice(0, 2).map((c) => c.method), ["POST", "POST"], "a long document's jobs are all handed to Baidu first, then waited on");
    assert.deepEqual(w3.pages, [3]); assert.equal(aiCalls().length, 0);
    assert.deepEqual(w3.state.jobs.map((j) => [j.pages, j.jobId, j.stagedKey ?? null]), [[[2], "job-1", null], [[3], "job-2", KEY(2)]], "the read job's copy is removed, the other kept");
    assert.deepEqual(removed, [KEY(1)]);
    seen = []; polls = 2_000_000;
    out = await bg(w3.state);
    assert.equal(submits().length, 0); assert.equal(out[1].text, PAGE_A); assert.equal(out[2].text, PAGE_B); assert.equal(aiCalls().length, 0);
    assert.deepEqual(removed, [KEY(1), KEY(2)]);
    delete process.env.BAIDU_OCR_PAGES_PER_JOB;

    // Switched off (BAIDU_OCR_BACKGROUND=off): the reading never waits; a job still running is handed to the AI reader.
    process.env.BAIDU_OCR_BACKGROUND = "off";
    seen = []; baidu = baiduJob([vlLine([PAGE_A, PAGE_B])], { states: ["pending"] });
    out = await bg("start");
    assert.equal(out[1].text, "AI reading of page 2");
    delete process.env.BAIDU_OCR_BACKGROUND;
    // A caller that does not ask for background reading (a claim document, the table check) never waits either.
    seen = []; out = await run();
    assert.equal(out[1].text, "AI reading of page 2");
    // A payload that is not exactly the state's shape is not used.
    for (const bad of [null, {}, { since: 1, runs: 0, jobs: [{ pages: [2], jobId: "../x", submittedAt: 1 }], gaveUp: [] },
      { since: 1, runs: 0, jobs: [{ pages: [2], jobId: "j", submittedAt: 1, stagedKey: "other/../../policy.pdf" }], gaveUp: [] }])
      assert.equal(parseBaiduWaitState(bad), null);
    delete process.env.BAIDU_OCR_MAX_WAIT_MS;
    bd.setBaiduHandoffForTests(null);
  }

  // 10. Markdown clean-up keeps every figure exactly.
  assert.equal(bd.baiduMarkdownToText("# Title\n\n<div style=\"text-align: center;\">Policy No. <b>SYN-1</b></div>\n\nSum &lt;S$1,000&gt; &amp; 25%"), "Title\n\nPolicy No. SYN-1\n\nSum <S$1,000> & 25%");

  // 11. A label and its value printed side by side (two layout blocks, two Markdown paragraphs) go back on one line.
  {
    const blk = (content: string, bbox: number[], label = "text") => ({ block_label: label, block_content: content, block_bbox: bbox });
    const md = "Policy Schedule\n\nSum Insured\n\nUSD 980,000\n\nAnnual premium\n\nUSD 9,000";
    const list = [blk("Policy Schedule", [76, 76, 300, 124], "paragraph_title"), blk("Sum Insured", [89, 348, 222, 375]), blk("USD 980,000", [451, 347, 577, 372]),
      blk("Annual premium", [89, 390, 263, 418]), blk("USD 9,000", [451, 389, 556, 414])];
    const r = bd.sameRowPairsJoined(list, md);
    assert.equal(r.joined, 2);
    assert.equal(r.text, "Policy Schedule\n\nSum Insured\tUSD 980,000\n\nAnnual premium\tUSD 9,000");
    // Through the result parser too, with the layout list Baidu returns.
    const jsonl = JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: md }, prunedResult: { parsing_res_list: list } }] } });
    assert.equal(bd.baiduPagesFromJsonl(jsonl, "PaddleOCR-VL-1.6")[0], r.text);
    // Negative controls: a block below (not beside), a value to the left, two columns of running text (many lines),
    // a long label, a block that is not plain text, and paragraphs that are not each a whole block: nothing joined.
    const keep = (l: unknown[], t: string) => assert.deepEqual(bd.sameRowPairsJoined(l, t), { text: t, joined: 0 });
    keep([blk("Sum Insured", [89, 348, 222, 375]), blk("USD 980,000", [89, 390, 210, 416])], "Sum Insured\n\nUSD 980,000");
    keep([blk("Sum Insured", [451, 348, 580, 375]), blk("USD 980,000", [89, 347, 210, 372])], "Sum Insured\n\nUSD 980,000");
    keep([blk("We will pay the costs incurred\nwithin 30 days of the Accident", [56, 300, 290, 400]), blk("The Insurer may refuse any loss\narising from war for the Insured", [305, 300, 540, 400])],
      "We will pay the costs incurred\nwithin 30 days of the Accident\n\nThe Insurer may refuse any loss\narising from war for the Insured");
    keep([blk("Total sum insured for all named persons on this policy", [89, 348, 400, 375]), blk("USD 980,000", [451, 347, 577, 372])], "Total sum insured for all named persons on this policy\n\nUSD 980,000");
    keep([blk("Sum Insured", [89, 348, 222, 375], "paragraph_title"), blk("USD 980,000", [451, 347, 577, 372])], "Sum Insured\n\nUSD 980,000");
    keep([blk("Sum Insured", [89, 348, 222, 375]), blk("USD 980,000", [451, 347, 577, 372])], "Sum Insured USD 980,000 and more");
    keep([], "Sum Insured\n\nUSD 980,000");
  }

  console.log("DearPolicy Baidu PaddleOCR (mocked contract): request shape, token handling, polling, result parsing, per-page, weak-page and whole-job fallback to the AI reader, ledger row, verified provenance, result-host allow-list, function deadline, cache only of full readings, no cap on reading, not-read marking, switch-off, ledger fail-closed, signed-link submit with staged copy removal, connection retry only before anything is sent, background reading that waits for Baidu instead of handing pages to the AI reader -- passed. Live Baidu behaviour is NOT covered by this test.");
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
