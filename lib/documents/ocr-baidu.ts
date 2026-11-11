import { createHash, randomUUID } from "node:crypto";
import type { PdfPage } from "@/lib/documents/pdf";
import { overSpendCap, recordUsage } from "@/lib/ai/ledger";
import { assertVerifiedForMonetaryUse, recordModelExecution } from "@/lib/ai/provenance";
import { functionDeadline } from "@/lib/jobs/function-time";
import { OCR_TEXT_BAR, usableCharacters } from "@/lib/documents/ocr";
import { cachedReading } from "@/lib/documents/evidence";
import { subsetPdf } from "@/lib/documents/ocr-hosted";
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { recordProcessingFailure } from "@/lib/diagnostics/processing-failures";
import { query } from "@/lib/db/client";
import { probeBaiduPath, probeSummary } from "@/lib/documents/baidu-probe";

/**
 * Baidu AI Studio's hosted PaddleOCR (async jobs API) as the FIRST reader of scanned, image-only pages. It runs as a
 * web call from the app (Vercel), nothing runs on any household's or operator's computer. The hosted AI reader
 * (./ocr-hosted.ts) stays the automatic fallback: any page Baidu does not return text for -- the service is not set
 * up, it fails, it times out, it is over its daily quota, or a page comes back empty -- is read by the AI reader as
 * before.
 *
 * Contract (the official `paddleocr` Python SDK 3.7.0, paddleocr/_api_client, mirrored here):
 *   POST {base}/api/v2/ocr/jobs  Authorization: Bearer <token>; multipart: file, model, optionalPayload (JSON string)
 *     -> { code: 0, data: { jobId } }
 *   GET  {base}/api/v2/ocr/jobs/{jobId}
 *     -> { code: 0, data: { state: "pending"|"running"|"done"|"failed", errorMsg?, extractProgress?, resultUrl?: { jsonUrl } } }
 *   GET  jsonUrl (pre-signed, NO token sent) -> JSONL; each line { result: { layoutParsingResults: [{ markdown: { text } }] } }
 *     for the document-parsing models (PaddleOCR-VL*, PP-StructureV3), or { result: { ocrResults: [{ prunedResult: { rec_texts } }] } }
 *     for the plain OCR models (PP-OCRv5/v6). One entry per page, in page order.
 *
 * The token is read from BAIDU_AISTUDIO_TOKEN at call time and only ever placed in the Authorization header of a
 * request to the configured Baidu host. It is never logged, recorded or returned in an error.
 */

export const BAIDU_DEFAULT_BASE_URL = "https://paddleocr.aistudio-app.com";
export const BAIDU_DEFAULT_MODEL = "PaddleOCR-VL-1.6";
const JOBS_PATH = "/api/v2/ocr/jobs";
const OCR_MODELS = new Set(["PP-OCRv5", "PP-OCRv5-latin", "PP-OCRv6"]);
// Only exact, versioned names: the bare "PaddleOCR-VL" is a family alias, and a Baidu job is recorded under the name it
// was submitted with (BAIDU_IDENTITY_EXCEPTION), so an alias is refused before anything is sent.
const DOC_MODELS = new Set(["PP-StructureV3", "PaddleOCR-VL-1.5", "PaddleOCR-VL-1.6"]);
/** Bumped whenever the way a Baidu result is turned into page text changes, so an older cached reading is not reused. */
const TEXT_VERSION = "baidu-md-v3";

type Env = NodeJS.ProcessEnv;
const intEnv = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v?.trim());
  return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : fallback;
};

/** Baidu reads scanned pages when a token is set and it is not switched off (BAIDU_OCR_ENABLED=0/false/off). */
export function baiduOcrConfigured(env: Env = process.env) {
  return Boolean(env.BAIDU_AISTUDIO_TOKEN?.trim()) && !/^(0|false|off)$/i.test(env.BAIDU_OCR_ENABLED?.trim() ?? "");
}

export function baiduOcrSettings(env: Env = process.env) {
  const model = env.BAIDU_PADDLEOCR_MODEL?.trim() || BAIDU_DEFAULT_MODEL;
  const baseUrl = (env.BAIDU_OCR_BASE_URL?.trim() || BAIDU_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    model,
    baseUrl,
    // Bounded so a slow queue leaves time for the AI reader inside the 300 s request: give up and fall back after this.
    maxWaitMs: intEnv(env.BAIDU_OCR_MAX_WAIT_MS, 90_000, 1, 240_000),
    pollIntervalMs: intEnv(env.BAIDU_OCR_POLL_INTERVAL_MS, 2_000, 1, 15_000),
    requestTimeoutMs: intEnv(env.BAIDU_OCR_REQUEST_TIMEOUT_MS, 60_000, 1, 120_000),
    pagesPerJob: intEnv(env.BAIDU_OCR_PAGES_PER_JOB, 50, 1, 100),
    // After Baidu cannot be reached (connect failure or timeout on submit), this instance skips it for this long.
    cooldownMs: intEnv(env.BAIDU_OCR_COOLDOWN_MS, 600_000, 0, 3_600_000),
    // After such a failure, check each step of the path to Baidu (lib/documents/baidu-probe.ts), each within this limit.
    // 0 switches the check off.
    probeStepMs: intEnv(env.BAIDU_OCR_PROBE_STEP_MS, 6_000, 0, 15_000),
  };
}

export type BaiduFailureKind = "not_configured" | "unsupported_model" | "auth" | "rate_limit" | "unavailable" | "bad_request" | "network" | "timeout" | "job_failed" | "format" | "unverified" | "cooling_down";
/** A Baidu failure. Its message names the kind and the HTTP status only: never the token, never page text. */
export class BaiduOcrError extends Error {
  kind: BaiduFailureKind; status?: number;
  /** For a network failure: which call (submit, poll, result) and the system's error code (UND_ERR_CONNECT_TIMEOUT,
   * ENOTFOUND, ECONNRESET, a certificate code...) -- fixed words only, never a message, URL or token. */
  stage?: "submit" | "poll" | "result"; code?: string;
  constructor(kind: BaiduFailureKind, status?: number, stage?: BaiduOcrError["stage"], code?: string) {
    super(`Baidu PaddleOCR ${kind.replace(/_/g, " ")}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "BaiduOcrError"; this.kind = kind; this.status = status; this.stage = stage; this.code = code;
  }
  /** What the processing history records: the kind, and where known the call and the error code. */
  get summary() { return [this.kind, this.stage, this.code, this.status ? `HTTP ${this.status}` : undefined].filter(Boolean).join(" "); }
}

/** The error code of a failed fetch (undici puts it on `cause`, sometimes one level deeper), when it is a plain code. */
function errorCode(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return undefined;
}

function kindForStatus(status: number): BaiduFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 413 || status === 422) return "bad_request";
  return "unavailable";
}

async function call(url: string, init: RequestInit, timeoutMs: number, stage: NonNullable<BaiduOcrError["stage"]>): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new BaiduOcrError((error as Error)?.name === "TimeoutError" ? "timeout" : "network", undefined, stage, errorCode(error));
  }
}

/** The `data` object of a Baidu reply; any non-2xx status, non-zero `code` or missing `data` is a typed failure. */
async function apiData(res: Response): Promise<Record<string, unknown>> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* handled below */ }
  if (!res.ok) throw new BaiduOcrError(kindForStatus(res.status), res.status);
  const payload = body as { code?: unknown; data?: unknown } | null;
  if (!payload || typeof payload !== "object") throw new BaiduOcrError("format", res.status);
  if (payload.code !== 0 && payload.code != null) {
    // A quota or rate message can arrive with HTTP 200 and an error code.
    const code = Number(payload.code);
    throw new BaiduOcrError(code === 429 ? "rate_limit" : code === 401 || code === 403 ? "auth" : "unavailable", res.status);
  }
  if (!payload.data || typeof payload.data !== "object") throw new BaiduOcrError("format", res.status);
  return payload.data as Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A digit or a number written as a word: such a cell may be a figure ("5000", "up to 30 days", "One hundred thousand"). */
const NUMBERISH = /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|lakh|crore|half|double|twice|once)\b/i;
/** An HTML table as a grid of cell texts, with merged cells expanded so every row keeps its columns:
 * - colspan: the text in the first column it covers, the others left empty, so a value stays under its own column;
 * - rowspan: a LABEL (in column 0 and not an amount, or holding no number at all) is repeated on each
 *   row it covers, so every row keeps its own name; any other cell with a number (a digit or a number word) is printed
 *   once, on its first row, and left empty below, so one shared amount (an overall limit beside several benefits) is never copied onto each row as if it were that row's own. */
/** A currency-marked amount (a currency sign or code beside a number), a grouped number or a percentage: even in the
 * label column such a cell is a shared figure, never a name (Critic #410 F5: a sideways "S$5,000 overall"). */
const CUR = "(?:[$£€¥₹₩]|\\b(?:[A-Z]{1,3}\\$|RM|EUR|USD|SGD|HKD|GBP|MYR|AUD|NZD|CNY|RMB|JPY|IDR|THB|PHP|INR|Rp|Rs)(?![A-Za-z]))";
const AMOUNT = new RegExp(`${CUR}\\s?\\d|\\d\\s?${CUR}|\\d{1,3}(?:[,.' ]\\d{3})+|\\d+(?:\\.\\d+)?\\s*%`);
export function tableGrid(table: string, cellText: (html: string) => string): string[][] {
  const grid: string[][] = [];
  const pending: { col: number; rows: number; text: string }[] = [];
  const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const span = (attrs: string, name: string) => {
    const n = Number(attrs.match(new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, "i"))?.[1] ?? 1);
    return Number.isInteger(n) && n >= 1 ? Math.min(n, 50) : 1;
  };
  for (const row of rows) {
    const out: string[] = [];
    // Cells carried down from a rowspan above take their columns first.
    for (const p of pending) if (p.rows > 0) { out[p.col] = p.text; p.rows--; }
    let col = 0;
    const spans: { col: number; cs: number; rs: number; text: string }[] = [];
    for (const m of row.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi)) {
      while (out[col] !== undefined) col++;
      const text = cellText(m[3]);
      const cs = span(m[2], "colspan"), rs = span(m[2], "rowspan");
      for (let k = 0; k < cs; k++) out[col + k] = k === 0 ? text : "";
      if (rs > 1) spans.push({ col, cs, rs, text });
      col += cs;
    }
    // Decided by position, never by how a figure is written (Critic #410 F4): a rowspan cell in column 0 is the rows'
    // name and repeats, unless it is a currency-marked amount (F5); anywhere else a cell with a number (a digit or a number word) is one shared figure, printed once.
    // (A column left of the row's first number holds no number by definition, so it repeats under the same rule.)
    for (const sp of spans) {
      const carried = (sp.col === 0 ? !AMOUNT.test(sp.text) : !NUMBERISH.test(sp.text)) ? sp.text : "";
      for (let k = 0; k < sp.cs; k++) pending.push({ col: sp.col + k, rows: sp.rs - 1, text: k === 0 ? carried : "" });
    }
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].rows <= 0) pending.splice(i, 1);
    grid.push(Array.from({ length: out.length }, (_, i) => out[i] ?? ""));
  }
  return grid;
}

/** Inline maths a vision model can print for figures ("$80\\%$", "$\\text{RM}\\ 50,000$") becomes plain text, so its "$"
 * delimiters are never read as a currency sign. Only a span with a LaTeX command or brace is touched: "$ 100,000" and
 * "S$1,000 to S$2,000" are printed money and stay exactly as they are. A "$" right after a letter (S$, US$, HK$) or a
 * backslash never opens maths, and a "$" before a digit or comma never closes it, so two amounts are never paired as
 * one span (Critic #410: "S$200^{1} per day, max S$9,000"). A span with real working (a fraction, a sum, a root) is
 * left exactly as printed: turning it into plain words could make a figure the page does not print. Outside maths an
 * escaped "\\$" is a dollar sign and "1{,}000" is 1,000. */
export function plainMath(text: string): string {
  const unlatex = (m: string) => m
    .replace(/\\(?:text|mathrm|mathbf|textbf|mbox|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\([%$&#_])/g, "$1").replace(/\\(?:,|;|:|!|quad|qquad| )/g, " ").replace(/\\(?:times)/g, "x")
    .replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  const mathy = (m: string) => /\\[A-Za-z%$&#_,;: !]|[{}^]/.test(m);
  const working = (m: string) => /\\(?:d?t?frac|sum|prod|int|oint|sqrt|div|cdot|pm|mp|binom|over|lim|log|ln|exp|min|max|le|ge|leq|geq|approx|neq|left|right)(?![A-Za-z])/.test(m);
  // A span kept as printed is set aside (a private-use mark) so the clean-up below never touches it.
  const kept: string[] = [];
  const keep = (whole: string) => `\uE000${kept.push(whole) - 1}\uE001`;
  const swap = (whole: string, m: string) => (!mathy(m) ? whole : working(m) ? keep(whole) : unlatex(m));
  return text.replace(/[\uE000\uE001]/g, "")
    .replace(/(?<![A-Za-z\\])\$\$([\s\S]+?)(?<!\\)\$\$(?![\d,])/g, swap)
    .replace(/(?<![A-Za-z\\$])\$(?!\$)([^$\n]+?)(?<!\\)\$(?![\d,$])/g, swap)
    .replace(/\\\$/g, "$").replace(/(\d)\{,\}(?=\d)/g, "$1,")
    .replace(/\uE000(\d+)\uE001/g, (_, i: string) => kept[Number(i)]);
}

/** Turns one page of Baidu's Markdown into the plain page text the rest of the pipeline reads: a table row becomes
 * one line with its cells separated by TAB (the same shape the AI reader is asked for), headings and emphasis marks
 * are dropped, images are dropped. Figures are copied exactly. */
export function baiduMarkdownToText(markdown: string): string {
  const decode = (s: string) => s
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, "&");
  const cellText = (html: string) => decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  let text = String(markdown ?? "");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<img\b[^>]*>/gi, "");
  // HTML tables (the VL and structure models print tables this way): one line per row, cells TAB-separated.
  text = text.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => "\n" + tableGrid(table, cellText)
    .map((r) => r.join("\t").replace(/\t+$/, "")).filter((r) => r.replace(/\t/g, "").trim()).join("\n") + "\n");
  text = plainMath(text);
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw;
    // Markdown pipe tables: | a | b | -> a\tb; the |---|---| rule is dropped.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) continue;
      line = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).join("\t");
    }
    line = line.replace(/<br\s*\/?>/gi, " ").replace(/<\/?[A-Za-z][^>]*>/g, "");
    line = decode(line).replace(/^\s{0,3}#{1,6}\s+/, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1");
    lines.push(line.replace(/[ ]+$/, ""));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Each page's text, in page order, from the result JSONL. */
export function baiduPagesFromJsonl(jsonl: string, model: string): string[] {
  const pages: string[] = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: { result?: { layoutParsingResults?: unknown; ocrResults?: unknown } };
    try { obj = JSON.parse(line); } catch { throw new BaiduOcrError("format"); }
    const result = obj?.result;
    if (!result || typeof result !== "object") throw new BaiduOcrError("format");
    if (OCR_MODELS.has(model)) {
      if (!Array.isArray(result.ocrResults)) throw new BaiduOcrError("format");
      for (const item of result.ocrResults as { prunedResult?: { rec_texts?: unknown } }[]) {
        const texts = item?.prunedResult?.rec_texts;
        pages.push(Array.isArray(texts) ? texts.filter((t) => typeof t === "string").join("\n").trim() : "");
      }
    } else {
      if (!Array.isArray(result.layoutParsingResults)) throw new BaiduOcrError("format");
      for (const item of result.layoutParsingResults as { markdown?: { text?: unknown } }[]) {
        const md = item?.markdown?.text;
        pages.push(typeof md === "string" ? baiduMarkdownToText(md) : "");
      }
    }
  }
  return pages;
}

/** The model name Baidu itself reports for a job, when its reply carries one. Never taken from the request: the
 * provenance gate only trusts a provider-reported identity (lib/ai/provenance.ts computeVerified). */
function reportedModel(...sources: unknown[]): string | null {
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const o = src as Record<string, unknown>;
    for (const key of ["model", "modelName"]) {
      const v = o[key];
      if (typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v)) return v;
    }
  }
  return null;
}

/** Hosts a pre-signed result link may point at: Baidu's own domains (BOS object storage and AI Studio), the configured
 * service's host, and any added in BAIDU_OCR_RESULT_HOSTS (comma-separated host suffixes). */
export function resultHostAllowed(host: string, env: Env = process.env) {
  const h = host.toLowerCase().replace(/\.$/, "");
  const baseHost = (() => { try { return new URL(baiduOcrSettings(env).baseUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const extra = (env.BAIDU_OCR_RESULT_HOSTS ?? "").split(",").map((x) => x.trim().toLowerCase().replace(/^\.+/, "")).filter(Boolean);
  const suffixes = ["bcebos.com", "baidubce.com", "baidu.com", "aistudio-app.com", ...extra];
  return h === baseHost || suffixes.some((sfx) => h === sfx || h.endsWith("." + sfx));
}

/** Documented exception to the provenance rule that a resolved model must be provider-reported (owner decision,
 * 10 Nov 2026; lib/ai/provenance.ts computeVerified). Baidu's jobs API does not return a model name. A Baidu job is
 * bound at submission to one exact, versioned model name from a closed list (never a family alias), and Baidu returns
 * its own job id for it. So a Baidu attempt is recorded with resolvedModel = the model Baidu reports when it reports
 * one, otherwise the model the job was submitted with, and providerRequestId = Baidu's job id. Everything else stays
 * fail-closed: no job id, a failed or timed-out job, a page-count mismatch, an unparsable result, a result link off
 * Baidu's hosts, or a page under the 24-character bar sends those pages to the AI reader. */
export const BAIDU_IDENTITY_EXCEPTION = "baidu-submitted-model-with-job-id";

export type BaiduJobResult = { pages: string[]; jobId: string; model: string | null };

/** One job: the given PDF (already only the pages to read) in, one text per page out, in the PDF's page order.
 * `deadline` (ms since 1970) bounds the whole job, every HTTP call included. */
export async function readPdfWithBaidu(pdf: Uint8Array, env: Env = process.env, deadline?: number): Promise<BaiduJobResult> {
  const token = env.BAIDU_AISTUDIO_TOKEN?.trim();
  if (!token || !baiduOcrConfigured(env)) throw new BaiduOcrError("not_configured");
  const s = baiduOcrSettings(env);
  if (!OCR_MODELS.has(s.model) && !DOC_MODELS.has(s.model)) throw new BaiduOcrError("unsupported_model");
  const auth = { Authorization: `Bearer ${token}` };
  const jobsUrl = `${s.baseUrl}${JOBS_PATH}`;
  const end = Math.min(deadline ?? Infinity, Date.now() + s.maxWaitMs);
  const timeout = () => {
    const left = end - Date.now();
    if (left <= 0) throw new BaiduOcrError("timeout");
    return Math.min(s.requestTimeoutMs, left);
  };

  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(pdf)], { type: "application/pdf" }), "pages.pdf");
  form.append("model", s.model);
  // Pages photographed sideways or upside down are turned upright by Baidu's own orientation step.
  form.append("optionalPayload", JSON.stringify({ useDocOrientationClassify: true }));
  const submitted = await apiData(await call(jobsUrl, { method: "POST", headers: auth, body: form }, timeout(), "submit"));
  const jobId = submitted.jobId;
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(jobId)) throw new BaiduOcrError("format");

  let interval = s.pollIntervalMs;
  for (;;) {
    const data = await apiData(await call(`${jobsUrl}/${encodeURIComponent(jobId)}`, { method: "GET", headers: auth }, timeout(), "poll"));
    const state = data.state;
    if (state === "done") {
      const jsonUrl = (data.resultUrl as { jsonUrl?: unknown } | undefined)?.jsonUrl;
      if (typeof jsonUrl !== "string") throw new BaiduOcrError("format");
      let url: URL;
      try { url = new URL(jsonUrl); } catch { throw new BaiduOcrError("format"); }
      // The result link is pre-signed: fetched WITHOUT the token, only from Baidu's own hosts, and only over https
      // (plain http only when the configured service itself is plain http, i.e. a local test double).
      if (url.protocol !== "https:" && !(url.protocol === "http:" && s.baseUrl.startsWith("http:"))) throw new BaiduOcrError("format");
      if (!resultHostAllowed(url.hostname, env)) throw new BaiduOcrError("format");
      const res = await call(url.href, { method: "GET" }, timeout(), "result");
      if (!res.ok) throw new BaiduOcrError(kindForStatus(res.status), res.status);
      const jsonl = await res.text();
      let first: { model?: unknown; result?: { model?: unknown; dataInfo?: unknown } } | null = null;
      try { first = JSON.parse(jsonl.split(/\r?\n/).find((l) => l.trim()) ?? "null"); } catch { /* parsed (and refused) below */ }
      const pages = baiduPagesFromJsonl(jsonl, s.model);
      return { pages, jobId, model: reportedModel(data, submitted, first, first?.result, first?.result?.dataInfo) };
    }
    if (state === "failed") throw new BaiduOcrError("job_failed");
    if (state !== "pending" && state !== "running") throw new BaiduOcrError("format");
    const left = end - Date.now();
    if (left <= 0) throw new BaiduOcrError("timeout");
    await sleep(Math.min(interval, left));
    interval = Math.min(Math.round(interval * 1.5), 15_000);
  }
}

/** Until when (ms since 1970) this instance skips Baidu after it could not be reached. */
let baiduUnreachableUntil = 0;
/** The cool-down is also kept in the database (one row, storage_cleanup_locks key BAIDU_COOLDOWN_KEY), so every function
 * instance shares it: on Vercel a later upload usually lands on another (or a fresh) instance, which would otherwise wait
 * the full 10-60 s again (11 Nov: the first upload after the Singapore redeploy waited 60 s). A database error never
 * blocks reading: the instance's own cool-down still applies, and Baidu is tried as before. */
export const BAIDU_COOLDOWN_KEY = "baidu-ocr-unreachable";
async function sharedCooldownActive(cooldownMs: number): Promise<boolean> {
  if (cooldownMs <= 0) return false;
  try {
    const r = await query<{ on: boolean }>(`SELECT EXISTS (SELECT 1 FROM storage_cleanup_locks WHERE lock_key = $1 AND acquired_at > now() - ($2 || ' milliseconds')::interval) AS on`, [BAIDU_COOLDOWN_KEY, String(cooldownMs)]);
    return r.rows[0]?.on === true;
  } catch { return false; }
}
async function startSharedCooldown(): Promise<void> {
  try {
    await query(`INSERT INTO storage_cleanup_locks(lock_key, holder, acquired_at) VALUES ($1, 'baidu-cooldown', now())
      ON CONFLICT (lock_key) DO UPDATE SET acquired_at = now()`, [BAIDU_COOLDOWN_KEY]);
  } catch { /* the instance's own cool-down still applies */ }
}
/** Tests only: this instance forgets its own cool-down, as a fresh instance would. */
export function forgetLocalBaiduCooldown() { baiduUnreachableUntil = 0; }
/** Tests only. */
export async function resetBaiduCooldown() {
  baiduUnreachableUntil = 0;
  await query(`DELETE FROM storage_cleanup_locks WHERE lock_key = $1`, [BAIDU_COOLDOWN_KEY]).catch(() => undefined);
}

/** Time kept back, inside the function's limit, for the AI reader to read whatever Baidu did not. */
export const AI_FALLBACK_RESERVE_MS = 120_000;
/** Time kept free after the path probe for the rest of the document's processing. */
const PROBE_MARGIN_MS = 30_000;
/** Below this much time, Baidu is not started at all: the AI reader gets all of it. */
const MIN_BAIDU_MS = 5_000;

/** A chunk with a page Baidu read too little of: used for this reading, never cached, so a later re-read asks again. */
class WeakChunk extends Error {
  pages: { pageNumber: number; text: string }[];
  constructor(pages: { pageNumber: number; text: string }[]) { super("weak chunk"); this.name = "WeakChunk"; this.pages = pages; }
}

/** Reads the given scanned pages with Baidu. Returns the pages with Baidu's text filled in, and the page numbers Baidu
 * did not give enough text for (all of them when Baidu failed): those go to the AI reader.
 * Reading has no spend cap, but it fails closed when this month's spend cannot be read (overSpendCap throws
 * SpendCheckUnavailable). Each job is booked to the ledger ($0, page count as input) and recorded as a provenance
 * attempt; text is used only when that attempt is verified (Baidu's job id plus the model, per BAIDU_IDENTITY_EXCEPTION). */
export async function completePdfPagesWithBaidu(args: {
  accountId: string; resourceId?: string; bytes: Uint8Array; password?: string; pages: PdfPage[]; pageNumbers: number[];
}): Promise<{ pages: PdfPage[]; unread: number[]; probe?: () => Promise<void> }> {
  const correlationId = resolveCorrelationId(undefined);
  const householdRef = pseudonymizeId(args.accountId);
  await overSpendCap(args.accountId);
  const s = baiduOcrSettings();
  const started = Date.now();
  const fnDeadline = functionDeadline(started);
  const deadline = Math.min(started + s.maxWaitMs, fnDeadline !== undefined ? fnDeadline - AI_FALLBACK_RESERVE_MS : Infinity);
  const texts = new Map<number, string>();
  const failures: string[] = [];
  const bytesHash = createHash("sha256").update(args.bytes).digest("hex");
  const choice = { provider: "baidu" as const, model: s.model };
  const accept = (got: { pageNumber: number; text: string }[]) => {
    for (const p of got) if (typeof p?.text === "string" && usableCharacters(p.text) >= OCR_TEXT_BAR) texts.set(p.pageNumber, p.text.trim());
  };

  let unreachable = false;
  for (let i = 0; i < args.pageNumbers.length; i += s.pagesPerJob) {
    const chunk = args.pageNumbers.slice(i, i + s.pagesPerJob);
    if (deadline - Date.now() < MIN_BAIDU_MS) { failures.push("timeout"); break; }
    if (Date.now() < baiduUnreachableUntil || (i === 0 && await sharedCooldownActive(s.cooldownMs))) { failures.push("cooling_down"); break; }
    try {
      const got = await cachedReading(
        args.resourceId ? { accountId: args.accountId, policyId: args.resourceId } : undefined,
        "baidu_ocr", { bytes: bytesHash, pages: chunk, version: TEXT_VERSION }, `baidu:${s.model}`,
        async () => {
          const attemptGroupId = randomUUID();
          const requestedAt = new Date();
          const t0 = Date.now();
          const requested = { provider: choice.provider, model: choice.model, capability: "reading" as const, inputArtifactType: "application/pdf" };
          let job: BaiduJobResult;
          try {
            job = await readPdfWithBaidu(await subsetPdf(args.bytes, chunk, undefined, args.password), process.env, deadline);
            // One entry per page sent, in order. A reply with a different count cannot be mapped to pages safely.
            if (job.pages.length !== chunk.length) throw new BaiduOcrError("format");
          } catch (error) {
            const latencyMs = Date.now() - t0;
            await recordUsage({ accountId: args.accountId, role: "reading", choice, input: chunk.length, output: 0, durationMs: latencyMs, ok: false });
            await recordModelExecution({ correlationId, attemptGroupId, attemptIndex: 0, operation: "hosted_ocr", role: "reading",
              householdId: args.accountId, resourceId: args.resourceId ?? null, requested, requestedAt, resolved: null,
              status: "failed", errorCategory: "model_provider", latencyMs });
            throw error;
          }
          const latencyMs = Date.now() - t0;
          await recordUsage({ accountId: args.accountId, role: "reading", choice, input: chunk.length, output: 0, durationMs: latencyMs, ok: true });
          const record = await recordModelExecution({ correlationId, attemptGroupId, attemptIndex: 0, operation: "hosted_ocr", role: "reading",
            householdId: args.accountId, resourceId: args.resourceId ?? null, requested, requestedAt,
            // BAIDU_IDENTITY_EXCEPTION: the submitted model stands in when Baidu reports none (see above).
            resolved: { resolvedModel: job.model ?? choice.model, providerRequestId: job.jobId, finishReason: null, region: null, resolvedProvider: "baidu" },
            status: "succeeded", usage: { input: chunk.length, output: 0 }, costUsd: 0, latencyMs });
          // The same chokepoint as the AI reader (ocr-hosted.ts): text that feeds figures only from a verified attempt.
          // A record that could not be saved (null) does not block, the same failure-isolation contract.
          if (record && !record.verified) throw new BaiduOcrError("unverified");
          if (record) assertVerifiedForMonetaryUse(record);
          const out = chunk.map((n, k) => ({ pageNumber: n, text: job.pages[k] }));
          if (out.some((p) => usableCharacters(p.text) < OCR_TEXT_BAR)) throw new WeakChunk(out);
          return out;
        });
      accept(got);
    } catch (error) {
      if (error instanceof WeakChunk) { accept(error.pages); continue; }
      failures.push(error instanceof BaiduOcrError ? error.summary : "unexpected");
      // Baidu could not be reached at all, or did not answer the submit in time: every instance stops trying for a while, so each later scanned document does
      // not wait 10-60 s for a connection that is not coming before the AI reader reads it.
      if (error instanceof BaiduOcrError && error.stage === "submit" && (error.kind === "network" || error.kind === "timeout")) {
        baiduUnreachableUntil = Date.now() + baiduOcrSettings().cooldownMs;
        if (baiduOcrSettings().cooldownMs > 0) await startSharedCooldown();
        unreachable = true;
      }
      // Pages after a failed job are not sent to Baidu again in this reading: the AI reader reads them.
      break;
    }
  }

  const unread = args.pageNumbers.filter((n) => !texts.has(n));
  let probe: (() => Promise<void>) | undefined;
  if (failures.length) {
    const kind = failures.join(",");
    void recordErrorEvent({ name: "documents.ocr_baidu.failed", correlationId, householdRef, error: new BaiduOcrError(failures[0].split(" ")[0] as BaiduFailureKind),
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, kind, durationMs: Date.now() - started } });
    if (args.resourceId) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.resourceId,
      failureCode: "BAIDU_OCR_FALLBACK", error: `pages ${unread.join(", ")}: ${kind}; read by the AI reader instead` }).catch(() => undefined);
    // Which step of the path to Baidu fails, and from which region (no token is used). Only after a submit could not
    // be completed, and run by the caller only AFTER the AI reader has read the pages, so the upload is not held up
    // (Critic #411); it is skipped when the function no longer has time to spare for it.
    if (unreachable && args.resourceId && s.probeStepMs > 0) {
      const resourceId = args.resourceId, stepMs = s.probeStepMs;
      probe = async () => {
        if ((fnDeadline ?? Infinity) - PROBE_MARGIN_MS - Date.now() <= stepMs * 4) return;
        const found = await probeBaiduPath(s.baseUrl, { stepMs }).catch(() => null);
        if (found) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId,
          failureCode: "BAIDU_OCR_PATH_PROBE", error: probeSummary(found) }).catch(() => undefined);
      };
    }
  } else {
    void recordEvent({ name: "documents.ocr_baidu.completed", correlationId, status: "success", householdRef,
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, pagesToFallback: unread.length, durationMs: Date.now() - started } });
  }
  return {
    pages: args.pages.map((page) => (texts.has(page.pageNumber) ? { ...page, text: texts.get(page.pageNumber)!, extractionMethod: "ocr" as const } : page)),
    unread,
    probe,
  };
}
