/**
 * A scanned page whose OCR text is only placeholders or noise ("[illegible] [illegible] …") was NOT read: it is marked
 * unreadable and named to the household, never stored as read (journey retest TE-ACC-20261116, HIGH 2). A page with real
 * words or figures -- even with an inline "[illegible]", even a short one, even a table of numbers only -- is read
 * exactly as before, and a blank page stays blank. The rule: lib/documents/placeholder-text.ts.
 *
 * Offline: PGlite for the spend ledger, a mocked network (fetch) standing in for Baidu and an OpenAI-compatible AI
 * reader. No key, no token, no paid call. Made-up page texts only.
 *   npm run documents:illegible-page-test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|GROQ|_API_KEY|BAIDU|OCR_|READING_MODEL|DETERMINISTIC|CHAOS|MODEL_PRESET|VERCEL/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;

import { ocrTextIsPlaceholderOnly } from "@/lib/documents/placeholder-text";
import * as errors from "@/lib/documents/processing-errors";
import { documentReadLabel, unreadPageNumbers } from "@/lib/documents/upload-problems";

// The made-up page texts a reader might return, page 2 onwards (page 1 has a text layer and needs no reader).
const PURE_PLACEHOLDER = "[illegible] [illegible] [illegible] [illegible] [illegible] [illegible]";
const PLACEHOLDER_AND_NOISE = "[unreadable]\n.... ---- ~~~ | l ; ' :\n[image] (illegible text) <blank> [...] i";
const REAL_WITH_INLINE = "Made-up angioplasty benefit\tS$25,000 per procedure [illegible] up to two procedures a year\nIntensive care [illegible] S$300 per day";
const SHORT_REAL = "Page 3 of 3. End of schedule.";
const NUMBERS_ONLY = "1,000\t2,000\t5,000\n10,000\t20,000\t50,000\n100\t200\t500";
const BLANK = "";
const TEXTS = [PURE_PLACEHOLDER, PLACEHOLDER_AND_NOISE, REAL_WITH_INLINE, SHORT_REAL, NUMBERS_ONLY, BLANK];

test("the rule: only placeholder or noise is not read; a real word or figure is", () => {
  for (const notRead of [PURE_PLACEHOLDER, PLACEHOLDER_AND_NOISE, "[unreadable]", "[Illegible text]", "(illegible)", "(unclear)",
    "<unreadable>", "[blurred text]", "[...] [?]", "!!!!!!!! ??????", "— — — — —", ". . . . .", "l ; ' i |", "[illegible] [signature]"]) {
    assert.equal(ocrTextIsPlaceholderOnly(notRead), true, JSON.stringify(notRead));
  }
  for (const read of [REAL_WITH_INLINE, SHORT_REAL, NUMBERS_ONLY, "Page 3", "7", "S$ 50", "Death [illegible] benefit", "[illegible] Intensive care",
    "(see image) Notes", "[Amount] 400", "[Benefit schedule]", "保险金额", "入院", "ICU", "Ward A1", "Résumé des garanties", "[Figure 1]", "(continued)"]) {
    assert.equal(ocrTextIsPlaceholderOnly(read), false, JSON.stringify(read));
  }
  // An empty page is the reader's own blank or unreadable verdict, judged as before, never by this rule.
  for (const blank of [BLANK, "   \n\t "]) assert.equal(ocrTextIsPlaceholderOnly(blank), false);
});

test("a note that the page is blank on purpose, signed, stamped or a picture never makes it unread (every variant)", () => {
  for (const nothing of ["[Page intentionally left blank]", "[This page is intentionally left blank]", "(This page has been intentionally left blank)",
    "<page intentionally left blank>", "{intentionally blank}", "【intentionally left blank】", "(blank)", "<blank page>", "[blank]", "[Blank Page]",
    "[Signature]", "[signature] [stamp]", "[image]", "[image: logo]", "[photo]", "(missing)", "[Signature] ....", "[stamp] — —",
    "This page is intentionally left blank."]) {
    assert.equal(ocrTextIsPlaceholderOnly(nothing), false, JSON.stringify(nothing));
  }
});

test("a blurred page that kept only its header or footer is not read; a page with any real word or amount is", () => {
  for (const notRead of ["[illegible] [illegible] Page 3", "[illegible]\n[illegible]\nPage 3 of 8", "[illegible] [illegible]\n3/8", "[illegible] [illegible]\n3",
    "[illegible text] [illegible text]\nii", "- 3 -\n[illegible] [illegible]", "Policy No. ABC-12345\n[illegible] [illegible] [illegible]",
    "Reference: RP-2026-0042 [illegible] [illegible] Page 2 of 3", "[illegible] Certificate number 778812 [illegible] 2/3"]) {
    assert.equal(ocrTextIsPlaceholderOnly(notRead), true, JSON.stringify(notRead));
  }
  for (const read of ["[illegible] [illegible] Page 3 Angioplasty", "[illegible] S$25,000 [illegible] Page 3", "[illegible] [illegible]\n25,000",
    "[illegible]\n1,500.00", "Policy Schedule\n[illegible] [illegible]", "[illegible] Policy No. ABC-12345 Intensive care", "Page 3", "Page 3 of 8", "3/8",
    "Policy No. ABC-12345", "[illegible] ICU", "[illegible] 4,000"]) {
    assert.equal(ocrTextIsPlaceholderOnly(read), false, JSON.stringify(read));
  }
});

test("more unreadable spellings are caught, and short Indic words are real text", () => {
  for (const notRead of ["[illeg.]", "[text not legible]", "【illegible】", "[ilegible]", "[cannot read]", "(can't be read)", "（illegible）", "「illegible」 [illeg.]"]) {
    assert.equal(ocrTextIsPlaceholderOnly(notRead), true, JSON.stringify(notRead));
  }
  for (const read of ["किताब", "ভা", "[illegible] किताब", "নাম [illegible]", "தமிழ்"]) {
    assert.equal(ocrTextIsPlaceholderOnly(read), false, JSON.stringify(read));
  }
});

// --- A made-up scanned PDF: page 1 with a text layer, pages 2-7 image only ---------------------------------------
/** `variant` makes each case's file different, so no case reads another's cached reading. */
async function scannedPdf(variant = ""): Promise<Uint8Array> {
  const { StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const png = await pdf.embedPng(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDGgAcwFAI/AAf+qJ1N2AAAAAElFTkSuQmCC", "base64"));
  pdf.addPage([400, 400]).drawText("Made-up Insurance Co. Critical illness schedule for a made-up person. Sum assured 150,000." + variant, { x: 10, y: 300, size: 8, font });
  for (let i = 0; i < TEXTS.length; i++) pdf.addPage([400, 400]).drawImage(png, { x: 0, y: 0, width: 400, height: 400 });
  return pdf.save();
}

type Seen = { url: string; method: string; body: any };
let seen: Seen[] = [];
/** Baidu's reply per page sent, or null for Baidu being unreachable. */
let baiduTexts: string[] | null = null;
function installNetwork() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    const s: Seen = { url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
    seen.push(s);
    const json = (status: number, body: unknown, type = "application/json") =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
    if (/fake-openai/.test(url)) {
      // The AI reader: each page as TEXTS gives it (page n is TEXTS[n - 2]); a blank page is said to be blank.
      const asked = String(s.body?.messages?.[1]?.content?.[1]?.text ?? "").match(/in this order: ([\d, ]+)\./)?.[1].split(",").map((n) => Number(n.trim())) ?? [];
      const content = JSON.stringify({ pages: asked.map((n) => ({ pageNumber: n, text: TEXTS[n - 2] ?? "", orientation: "upright", rotation: 0,
        legibility: TEXTS[n - 2] ? (n === 2 || n === 3 ? "poor" : "good") : "blank" })) });
      return json(200, { id: "chatcmpl-fake", model: "gpt-6-luna", choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    }
    if (!/fake-baidu/.test(url) || baiduTexts === null) throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" }) });
    if (s.method === "POST" && url === "https://fake-baidu.test/api/v2/ocr/jobs") return json(200, { code: 0, msg: "ok", data: { jobId: "job-ill" } });
    if (s.method === "GET" && url === "https://fake-baidu.test/api/v2/ocr/jobs/job-ill") return json(200, { code: 0, data: { jobId: "job-ill", state: "done",
      extractProgress: { totalPages: TEXTS.length, extractedPages: TEXTS.length }, model: "PaddleOCR-VL-1.6", resultUrl: { jsonUrl: "https://fake-baidu-bucket.test/r.jsonl?sig=x" } } });
    if (/fake-baidu-bucket\.test\/r\.jsonl/.test(url)) return json(200, JSON.stringify({ result: { layoutParsingResults: baiduTexts.map((text) => ({ markdown: { text, images: {} }, prunedResult: {} })), dataInfo: { numPages: baiduTexts.length } } }) + "\n", "application/jsonl");
    return json(404, { code: 404 });
  }) as typeof fetch;
}

const ACCOUNT = "00000000-0000-4000-8000-0000000e1b01";
let ready: Promise<void> | null = null;
async function setUp() {
  ready ??= (async () => {
    const db = await (await import("../r6/fixture")).installDatabase();
    await db.query("INSERT INTO accounts(id,name) VALUES($1,'Made-up illegible-page household') ON CONFLICT DO NOTHING", [ACCOUNT]);
  })();
  await ready;
  Object.assign(process.env, {
    BAIDU_OCR_BASE_URL: "https://fake-baidu.test", BAIDU_OCR_RESULT_HOSTS: "fake-baidu-bucket.test", BAIDU_OCR_POLL_INTERVAL_MS: "1", BAIDU_OCR_COOLDOWN_MS: "0",
    BAIDU_OCR_PROBE_STEP_MS: "0", BAIDU_OCR_CONNECT_RETRIES: "0", BAIDU_OCR_PAGES_PER_JOB: "50", MODEL_RETRY_WINDOW_MS: "1000",
    READING_MODEL: "openai:gpt-6-luna", OPENAI_API_KEY: "dummy-not-a-key", OPENAI_BASE_URL: "http://fake-openai.test/v1", OCR_AI_READER: "on",
  });
  installNetwork();
  const bd = await import("@/lib/documents/ocr-baidu");
  bd.setBaiduTransportForTests("fetch");
  await bd.resetBaiduCooldown();
}
async function read(bytes: Uint8Array) {
  const { extractPdfPages } = await import("@/lib/documents/pdf");
  const { completePdfPagesWithOcr, pagesNeedingOcr } = await import("@/lib/documents/ocr");
  const pages = await extractPdfPages(bytes);
  assert.deepEqual(pagesNeedingOcr(pages), [2, 3, 4, 5, 6, 7], "fixture: page 1 has a text layer, pages 2-7 are scans");
  seen = [];
  return completePdfPagesWithOcr({ accountId: ACCOUNT, bytes, pages });
}
const storedNotes = (pages: { pageNumber: number; unreadable?: boolean; notRead?: boolean }[]) => errors.withPageNotes("Ready.", [
  errors.unreadablePagesNote(pages.filter((p) => p.unreadable && !p.notRead).map((p) => p.pageNumber)),
  errors.notReadPagesNote(pages.filter((p) => p.notRead).map((p) => p.pageNumber))]);
const aiPagesAsked = () => seen.filter((s) => /fake-openai/.test(s.url))
  .flatMap((s) => String(s.body?.messages?.[1]?.content?.[1]?.text ?? "").match(/in this order: ([\d, ]+)\./)?.[1].split(",").map((n) => Number(n.trim())) ?? []);

function assertNamedAndKept(out: Awaited<ReturnType<typeof read>>) {
  // Pages 2 (pure placeholder) and 3 (placeholder and noise) were not read, and are named.
  assert.deepEqual(out.filter((p) => p.unreadable).map((p) => p.pageNumber), [2, 3]);
  assert.ok(!out.some((p) => p.notRead), "a reader looked at every page");
  const message = storedNotes(out);
  assert.equal(message, "Ready. Pages 2 and 3 could not be read, so anything printed only there is not available.");
  assert.deepEqual(unreadPageNumbers(message), [2, 3]);
  assert.equal(documentReadLabel({ processing_status: "ready", processing_message: message }).fullyRead, false);
  // Every page with real content is read, its text whole: no word dropped around the inline "[illegible]".
  assert.equal(out[3].text, REAL_WITH_INLINE);
  assert.equal(out[4].text, SHORT_REAL);
  assert.equal(out[5].text, NUMBERS_ONLY);
  for (const p of [out[3], out[4], out[5]]) { assert.equal(p.extractionMethod, "ocr"); assert.ok(!p.unreadable); }
  // The blank page stays blank and read, as before.
  assert.equal(out[6].text, "");
  assert.ok(!out[6].unreadable && !out[6].notRead);
  // The text-layer page is untouched.
  assert.ok(!out[0].unreadable && /Critical illness schedule/.test(out[0].text));
}

test("AI reader (Baidu unreachable): placeholder-only pages are unreadable and named; real, short, numbers-only and blank pages are as before; one reading, no re-read", async () => {
  await setUp();
  baiduTexts = null;
  const out = await read(await scannedPdf());
  assertNamedAndKept(out);
  // One request for all six scanned pages: nothing is read again because of a placeholder page.
  assert.equal(seen.filter((s) => /fake-openai/.test(s.url)).length, 1);
  assert.deepEqual(aiPagesAsked(), [2, 3, 4, 5, 6, 7]);
});

test("Baidu first: a placeholder-only page is not accepted from Baidu, and the AI reader gets its chance, as for an empty page", async () => {
  await setUp();
  process.env.BAIDU_AISTUDIO_TOKEN = "made-up-token-not-real";
  try {
    baiduTexts = TEXTS;
    const out = await read(await scannedPdf(" Baidu case"));
    // Baidu's pages 2 and 3 are placeholders (their letters alone clear the 24-character bar): handed on, like the short
    // page 5 and the blank page 7, which are under the bar as before. Pages 4 and 6 are Baidu's reading.
    assert.deepEqual(aiPagesAsked(), [2, 3, 5, 7]);
    assertNamedAndKept(out);
  } finally { delete process.env.BAIDU_AISTUDIO_TOKEN; }
});

test("a page Baidu reads with real text plus inline [illegible] is accepted from Baidu, unchanged", async () => {
  await setUp();
  process.env.BAIDU_AISTUDIO_TOKEN = "made-up-token-not-real";
  try {
    baiduTexts = [REAL_WITH_INLINE, REAL_WITH_INLINE, REAL_WITH_INLINE, NUMBERS_ONLY, NUMBERS_ONLY, NUMBERS_ONLY];
    const out = await read(await scannedPdf(" Baidu inline case"));
    assert.deepEqual(aiPagesAsked(), [], "every page was read by Baidu: no AI reading");
    assert.ok(!out.some((p) => p.unreadable || p.notRead));
    assert.deepEqual(out.slice(1).map((p) => p.text), baiduTexts);
  } finally { delete process.env.BAIDU_AISTUDIO_TOKEN; }
});
