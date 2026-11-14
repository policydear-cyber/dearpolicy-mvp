import { createHash, randomUUID } from "node:crypto";
import { aiPageReaderOn } from "@/lib/documents/ai-reader-switch";
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
import { TransportError, baiduConnection, type BaiduConnection, traceSummary, transportRequest, type TransportRequest, type TransportResponse } from "@/lib/documents/baidu-transport";
import { query } from "@/lib/db/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { probeBaiduPath, probeSummary } from "@/lib/documents/baidu-probe";
import { removeOcrHandoff, stageOcrHandoff } from "@/lib/storage";
import { enqueueStoragePurge } from "@/lib/storage/purge";
import type { BaiduWaitJob, BaiduWaitState } from "@/lib/documents/baidu-wait";

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
const TEXT_VERSION = "baidu-md-v6"; // v4: headers, footers and footnotes kept (#441); v5: blocks only in the layout list added; v6: read again once so each page logs its layout list

type Env = NodeJS.ProcessEnv;
const intEnv = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number(v?.trim());
  return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : fallback;
};

/** Baidu reads scanned pages when a token is set and it is not switched off (BAIDU_OCR_ENABLED=0/false/off). */
export function baiduOcrConfigured(env: Env = process.env) {
  return Boolean(env.BAIDU_AISTUDIO_TOKEN?.trim()) && !/^(0|false|off)$/i.test(env.BAIDU_OCR_ENABLED?.trim() ?? "");
}

/** Baidu's front door for its overseas users: aistudio.baidu.com (like Baidu's other public hosts) resolves outside
 * China to Baidu's edge servers, which pass a request on to the service named in its Host header. The OCR service's own
 * name resolves only to one Beijing address (180.76.248.9) that the paths from Vercel's Singapore and Hong Kong regions
 * drop (12 Nov 2026, from throwaway sin1 and hkg1 machines: 0 of 30 TCP connects there, while the front door answered
 * every request in about 0.3 s, the token-less submit with the service's own 401 reply and trace id). */
export const BAIDU_DEFAULT_VIA = "aistudio.baidu.com";
/** Only a Baidu host may carry the token: the front door must be one of Baidu's own domains. The TLS name (SNI) of each
 * call is the front door's name and its certificate is checked against that name (baidu-transport.ts `via`). */
const BAIDU_VIA_DOMAINS = ["baidu.com", "baidubce.com", "aistudio-app.com"];

/** The host to open connections to for the configured service, or undefined to connect to the service's own host.
 * BAIDU_OCR_VIA: unset = the front door for Baidu's own service host (none for any other base URL); off/direct/0 = connect
 * directly; a host name under one of Baidu's domains = that host. Anything else connects directly. */
export function baiduVia(env: Env, baseUrl: string): string | undefined {
  const raw = env.BAIDU_OCR_VIA?.trim().toLowerCase() ?? "";
  if (/^(0|off|false|direct|none)$/.test(raw)) return undefined;
  let baseHost = "";
  try { baseHost = new URL(baseUrl).hostname.toLowerCase(); } catch { return undefined; }
  if (!raw) return baseHost === new URL(BAIDU_DEFAULT_BASE_URL).hostname ? BAIDU_DEFAULT_VIA : undefined;
  const ok = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)
    && BAIDU_VIA_DOMAINS.some((d) => raw === d || raw.endsWith("." + d));
  return ok && raw !== baseHost ? raw : undefined;
}

export function baiduOcrSettings(env: Env = process.env) {
  const model = env.BAIDU_PADDLEOCR_MODEL?.trim() || BAIDU_DEFAULT_MODEL;
  const baseUrl = (env.BAIDU_OCR_BASE_URL?.trim() || BAIDU_DEFAULT_BASE_URL).replace(/\/+$/, "");
  return {
    model,
    baseUrl,
    // Connect through Baidu's front door (baiduVia): only calls to the service's own host go this way.
    via: baiduVia(env, baseUrl),
    // Bounded so a slow queue leaves time for the AI reader inside the 300 s request: give up and fall back after this.
    maxWaitMs: intEnv(env.BAIDU_OCR_MAX_WAIT_MS, 90_000, 1, 240_000),
    pollIntervalMs: intEnv(env.BAIDU_OCR_POLL_INTERVAL_MS, 2_000, 1, 15_000),
    // No bytes moving for this long (after connecting) ends a call. Not a cap on the whole call: a slow but moving
    // upload keeps going until the job's own limit (maxWaitMs / the function deadline).
    requestTimeoutMs: intEnv(env.BAIDU_OCR_REQUEST_TIMEOUT_MS, 60_000, 1, 120_000),
    // DNS + TCP + TLS. fetch (undici) fixed this at 10 s, which is where half the production attempts died.
    connectTimeoutMs: intEnv(env.BAIDU_OCR_CONNECT_TIMEOUT_MS, 30_000, 1, 120_000),
    // 4 (default): ask DNS for IPv4 only. 0: either family. 6: IPv6 only.
    ipFamily: ([0, 4, 6] as const).find((f) => f === intEnv(env.BAIDU_OCR_IP_FAMILY, 4, 0, 6)) ?? 4,
    pagesPerJob: intEnv(env.BAIDU_OCR_PAGES_PER_JOB, 50, 1, 100),
    // After Baidu cannot be reached (connect failure or timeout on submit), this instance skips it for this long.
    cooldownMs: intEnv(env.BAIDU_OCR_COOLDOWN_MS, 600_000, 0, 3_600_000),
    // After such a failure, check each step of the path to Baidu (lib/documents/baidu-probe.ts), each within this limit.
    // 0 switches the check off.
    probeStepMs: intEnv(env.BAIDU_OCR_PROBE_STEP_MS, 6_000, 0, 15_000),
    // A call whose connection did not open (nothing sent) is tried again this many times, 1 s then 2 s apart, within
    // the job's time. 0 switches retrying off.
    connectRetries: intEnv(env.BAIDU_OCR_CONNECT_RETRIES, 2, 0, 3),
    // The connect limit for those retries. A healthy connection to Baidu opens in about 0.2 s (TCP) and 1.3 s (TLS
    // done); a silently dropped one waits until the system gives up (15.4 s live, 11 Nov). So a retry gets a short limit,
    // and dead connections cost at most ~36 s of the job's time (CONNECT_RETRY_CAP_MS), not 90 s.
    retryConnectTimeoutMs: intEnv(env.BAIDU_OCR_RETRY_CONNECT_TIMEOUT_MS, 5_000, 1_000, 30_000),
    // "link" (default): the pages are staged in our own storage and Baidu downloads them through a short-lived signed
    // link (the official `fileUrl` submit), because pushing the file from Vercel to Baidu was measured at under
    // 20 KB/s (11 Nov 2026: 1.4 of 8.4 MB in 90 s). "upload": send the file in the request, as before. Without
    // Supabase Storage (the local driver) there is no link Baidu could reach, so the file is uploaded.
    submitVia: (/^upload$/i.test(env.BAIDU_OCR_SUBMIT?.trim() ?? "") ? "upload" : "link") as "link" | "upload",
    // How long that signed link works. It is removed as soon as the job ends anyway.
    linkTtlSeconds: intEnv(env.BAIDU_OCR_LINK_TTL_S, 900, 60, 3_600),
    // Background reading (on unless BAIDU_OCR_BACKGROUND=0/false/off): when Baidu has not finished, or could not be
    // reached, a document's reading waits and looks again a little later (BAIDU_WAIT_DELAYS_MS), in a run of its own,
    // instead of handing the pages to the AI reader at once. Only for a document's own reading run by the job queue.
    background: !/^(0|false|off)$/i.test(env.BAIDU_OCR_BACKGROUND?.trim() ?? ""),
    // How long, from the first try, a reading keeps waiting for Baidu before the AI reader reads what is left.
    backgroundWindowMs: intEnv(env.BAIDU_OCR_BACKGROUND_WINDOW_MIN, 30, 5, 180) * 60_000,
  };
}

export type BaiduFailureKind = "handoff_failed" | "not_configured" | "unsupported_model" | "auth" | "rate_limit" | "unavailable" | "bad_request" | "network" | "timeout" | "job_failed" | "format" | "unverified" | "cooling_down";
/** A Baidu failure. Its message names the kind and the HTTP status only: never the token, never page text. */
export class BaiduOcrError extends Error {
  kind: BaiduFailureKind; status?: number;
  /** For a network failure: which call (submit, poll, result) and the system's error code (UND_ERR_CONNECT_TIMEOUT,
   * ENOTFOUND, ECONNRESET, a certificate code...) -- fixed words only, never a message, URL or token. */
  stage?: "submit" | "poll" | "result"; code?: string;
  /** For a network failure or timeout: how far the call got (see baidu-transport.ts traceSummary). Fixed words,
   * numbers and Baidu's IP address only. */
  trace?: string;
  constructor(kind: BaiduFailureKind, status?: number, stage?: BaiduOcrError["stage"], code?: string, trace?: string) {
    super(`Baidu PaddleOCR ${kind.replace(/_/g, " ")}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "BaiduOcrError"; this.kind = kind; this.status = status; this.stage = stage; this.code = code; this.trace = trace;
  }
  /** What the processing history records: the kind, and where known the call, the error code and how far it got. */
  get summary() { return [this.kind, this.stage, this.code, this.status ? `HTTP ${this.status}` : undefined, this.trace].filter(Boolean).join(" "); }
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

type Limits = { totalMs: number; idleMs: number; connectMs: number; family: 0 | 4 | 6; connection?: BaiduConnection; reusedReplyMs?: number;
  /** Calls to the service's own host (`for`) connect to `host` instead (baiduVia). A result link on another host does not. */
  via?: { host: string; for: string } };
type Transport = (url: string, req: TransportRequest, limits: Limits) => Promise<TransportResponse>;

/** The front door for one call: only a call to the service's own host goes through it (a result link on a storage
 * host, for example, connects to that host itself). */
export function viaHostFor(url: string, via?: { host: string; for: string }): string | undefined {
  if (!via) return undefined;
  try { return new URL(url).hostname.toLowerCase() === via.for ? via.host : undefined; } catch { return undefined; }
}

/** Production: node:https with separate connect / no-progress / total limits and a trace (baidu-transport.ts). */
const httpsTransport: Transport = async (url, req, l) => {
  try {
    const via = viaHostFor(url, l.via);
    return await transportRequest(url, req, { connectTimeoutMs: Math.min(l.connectMs, l.totalMs), idleTimeoutMs: l.idleMs, totalTimeoutMs: l.totalMs, family: l.family, connection: l.connection, reusedReplyMs: l.reusedReplyMs, via });
  } catch (error) {
    if (error instanceof TransportError) throw Object.assign(error, { summary: traceSummary(error.trace) });
    throw error;
  }
};
/** Tests that stand in for Baidu with a fake globalThis.fetch. */
const fetchTransport: Transport = (url, req, l) => fetch(url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(l.totalMs) });
let transport: Transport = httpsTransport;
/** Tests only: "fetch" sends Baidu calls through globalThis.fetch; "https" (the default) through node:https. */
export function setBaiduTransportForTests(kind: "fetch" | "https") { transport = kind === "fetch" ? fetchTransport : httpsTransport; }

/** Codes of a fetch failure that mean the connection never opened, so nothing of the request reached Baidu. */
const FETCH_NOT_CONNECTED = new Set(["UND_ERR_CONNECT_TIMEOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);
/** True only when the call failed before ANY byte of the request was sent: DNS, TCP or the TLS handshake did not finish.
 * Such a call never reached Baidu's service, so trying it again cannot submit (or pay for) a job twice. */
export function failedBeforeSending(error: unknown): boolean {
  if (error instanceof TransportError) return (error.trace.phase === "dns" || error.trace.phase === "connect" || error.trace.phase === "tls") && error.trace.sentBytes === 0;
  const code = errorCode(error);
  return code !== undefined && FETCH_NOT_CONNECTED.has(code);
}
/** Waits between connection attempts: the first retry after 1 s, the next after 2 s, then 4 s. */
const CONNECT_BACKOFF_MS = [1_000, 2_000, 4_000];
/** A retry is started only with at least this much of the job's time left after the wait. */
const MIN_RETRY_MS = 5_000;
/** All tries of one call together (the failed connections, the waits and the next try's connect limit) stay within this,
 * so a connection that never opens hands the pages to the AI reader after at most ~36 s (30 + 1 + 5), not 90 s. */
export const CONNECT_RETRY_CAP_MS = 40_000;

/** One Baidu call. The connection to Baidu sometimes does not open at all from Vercel (11 Nov 2026: TCP timed out at
 * 12:57 although the same path worked at 12:47), so a call that failed BEFORE sending anything is tried again, up to
 * `connectRetries` times with a short wait and a short connect limit (retryConnectTimeoutMs), and only while the job's
 * own time (limits()) allows. A call that sent any byte is never repeated. */
/** Whether one more try fits: the job keeps 5 s after the wait, and all tries of the call stay within CONNECT_RETRY_CAP_MS. */
export function retryFits(elapsedMs: number, jobLeftMs: number, waitMs: number, retryConnectMs: number): boolean {
  return jobLeftMs > waitMs + MIN_RETRY_MS && elapsedMs + waitMs + retryConnectMs <= CONNECT_RETRY_CAP_MS;
}

/** The limits for one try: a retry gets the shorter connect limit (never longer than the first try's). */
export function limitsForTry(l: Limits, attempt: number, retryConnectMs: number): Limits {
  return attempt === 0 ? l : { ...l, connectMs: Math.min(l.connectMs, retryConnectMs) };
}

async function call(url: string, req: TransportRequest, limits: () => Limits, stage: NonNullable<BaiduOcrError["stage"]>,
  retry: { retries: number; connectMs: number } = { retries: 0, connectMs: 0 }): Promise<TransportResponse> {
  const retries = retry.retries;
  const firstTry = Date.now();
  let reopened = false;
  for (let attempt = 0; ; attempt++) {
    const l = limitsForTry(limits(), attempt, retry.connectMs);
    try {
      return await transport(url, req, { ...l, reusedReplyMs: REUSED_REPLY_MS });
    } catch (error) {
      // A kept-open connection Baidu had already closed: a GET (poll or result: nothing is created) is sent once more on a
      // new connection, at once. A POST is never repeated once sent.
      if (!reopened && req.method === "GET" && staleKeptConnection(error)) { reopened = true; attempt--; continue; }
      const wait = CONNECT_BACKOFF_MS[Math.min(attempt, CONNECT_BACKOFF_MS.length - 1)];
      if (attempt < retries && failedBeforeSending(error) && retryFits(Date.now() - firstTry, limitsLeft(limits), wait, retry.connectMs)) { await sleep(wait); continue; }
      const tries = attempt > 0 ? `tries=${attempt + 1}` : undefined;
      if (error instanceof TransportError) {
        const trace = [(error as TransportError & { summary?: string }).summary, tries].filter(Boolean).join(" ") || undefined;
        throw new BaiduOcrError(error.kind, undefined, stage, error.code, trace);
      }
      throw new BaiduOcrError((error as Error)?.name === "TimeoutError" ? "timeout" : "network", undefined, stage, errorCode(error), tries);
    }
  }
}
/** True when a call over a kept-open connection failed before any reply arrived (the far end had closed it). */
export function staleKeptConnection(error: unknown): boolean {
  // "network": the far end had closed it; "timeout": the path went silent on it (no reply within REUSED_REPLY_MS).
  return error instanceof TransportError && error.trace.reused === true && error.trace.firstByteMs === undefined;
}
/** How long a poll or result request on a kept connection waits for the first reply byte before that connection is
 * dropped and the request sent once more on a new one. A poll's reply is small and normally comes in under a second. */
export const REUSED_REPLY_MS = 10_000;

/** The kept-open connection for the Baidu calls running inside withBaiduConnection (one reading, or one readPdfWithBaidu). */
const keptConnection = new AsyncLocalStorage<BaiduConnection>();
/** Runs `fn` with one kept-open connection to Baidu for its polls and result calls, as Baidu's own client does (one
 * requests.Session), and closes it at the end. Inside an outer one, the outer connection is used. The calls inside one
 * scope must stay one at a time (no Promise.all): the agent holds ONE socket, and a request queued for it would have its
 * connect limit running while it waits, failing as a "connect" timeout. */
export async function withBaiduConnection<T>(fn: () => Promise<T>): Promise<T> {
  if (keptConnection.getStore()) return fn();
  const conn = baiduConnection();
  try { return await keptConnection.run(conn, fn); } finally { conn.close(); }
}

/** The job's time left, or 0 when it has run out. */
function limitsLeft(limits: () => Limits): number {
  try { return limits().totalMs; } catch { return 0; }
}

/** The `data` object of a Baidu reply; any non-2xx status, non-zero `code` or missing `data` is a typed failure. */
async function apiData(res: TransportResponse): Promise<Record<string, unknown>> {
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

/** The layout labels Baidu's document models (PaddleOCR-VL, PP-StructureV3) are known to print. Only these are ever
 * written to a log; any other label is counted as "other", so nothing a document says can reach a log through a label. */
const BAIDU_LAYOUT_LABELS = new Set([
  "text", "paragraph_title", "doc_title", "abstract", "content", "reference", "reference_content", "footnote",
  "vision_footnote", "header", "footer", "header_image", "footer_image", "number", "page_number", "aside_text",
  "vertical_text", "image", "figure", "chart", "table", "seal", "formula", "display_formula", "inline_formula",
  "formula_number", "algorithm", "figure_title", "table_title", "chart_title",
]);
const loggedLabel = (label: unknown) => (typeof label === "string" && BAIDU_LAYOUT_LABELS.has(label) ? label : "other");

/** Letters and digits only, lower case: how a block's text is looked for in the page's Markdown text. */
const blockKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
/** Labels whose blocks are pictures, tables or formulas: never added as text from the layout list (a table is already in
 * the Markdown as a grid; a picture's block holds no reading of its own). Exact labels only: a title of any kind
 * ("figure_title", "table_title", "chart_title") is text and is kept alike. */
const NON_TEXT_BLOCK = /^(?:image|chart|table|seal|formula|figure|header_image|footer_image)$/i;
/** The page's text with the text blocks Baidu's layout list holds but its Markdown left out put back, each at its own
 * place in reading order. The document models print some blocks only in the layout list (13 Nov 2026: a schedule's last
 * line, a registration number and print date, was in neither the Markdown nor the reading, with every other footer line
 * kept), so a page's figures went unchecked. A block counts as present when its letters and digits stand, in order,
 * anywhere in the page's Markdown text, so nothing the Markdown already has is added twice. A missing block goes right
 * after the paragraph that holds the block before it in the list's reading order (block_order where given, else list
 * order), or first when none does, so it stands under the same heading as on the page, never at the page's end by
 * default. */
export function blocksMissingFromText(list: unknown, text: string): { text: string; added: number; labels: string[] } {
  const none = { text, added: 0, labels: [] as string[] };
  if (!Array.isArray(list)) return none;
  const have = blockKey(text);
  const blocks = list.flatMap((block, at) => {
    if (!block || typeof block !== "object") return [];
    const b = block as { block_label?: unknown; block_content?: unknown; block_order?: unknown };
    const label = typeof b.block_label === "string" ? b.block_label : "";
    if (typeof b.block_content !== "string" || NON_TEXT_BLOCK.test(label)) return [];
    const clean = baiduMarkdownToText(b.block_content), key = blockKey(clean);
    if (key.length < 2) return [];
    const order = typeof b.block_order === "number" && Number.isFinite(b.block_order) ? b.block_order : null;
    return [{ clean, key, label: loggedLabel(label), order, at }];
  });
  // Reading order: Baidu's block_order where every block has one, else the list's own order.
  if (blocks.every((b) => b.order !== null)) blocks.sort((a, b) => a.order! - b.order! || a.at - b.at);
  const paras = text ? text.split(/\n{2,}/) : [];
  const keys = paras.map(blockKey);
  const labels: string[] = [], seen = new Set<string>();
  let cursor = -1;
  for (const b of blocks) {
    if (have.includes(b.key) || seen.has(b.key)) {
      // Present: the place it stands in moves the cursor on (never back), so the next missing block follows it.
      const k = keys.findIndex((x, i) => i > cursor && x.includes(b.key));
      if (k >= 0) cursor = k;
      continue;
    }
    seen.add(b.key);
    paras.splice(cursor + 1, 0, b.clean); keys.splice(cursor + 1, 0, b.key);
    cursor++;
    labels.push(b.label);
  }
  return labels.length ? { text: paras.join("\n\n"), added: labels.length, labels } : none;
}

/** What a page's layout list holds, in fixed words and Baidu's own labels: "no list", or the block count with each label's
 * count ("12 blocks: text 7, footer 2, table 1"). A label not on BAIDU_LAYOUT_LABELS is counted as "other". */
export function layoutSummary(list: unknown): string {
  if (!Array.isArray(list)) return "no list";
  const counts = new Map<string, number>();
  for (const block of list) {
    const label = loggedLabel(block && typeof block === "object" ? (block as { block_label?: unknown }).block_label : undefined);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const parts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => `${l} ${n}`);
  return `${list.length} block${list.length === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : ""}`;
}

/** Each page's text, in page order, from the result JSONL. `pageNumbers` are the document's own numbers of the pages the
 * job held, in order, so a log names the document page; without them a log names the page's place in the job. */
export function baiduPagesFromJsonl(jsonl: string, model: string, pageNumbers?: number[]): string[] {
  const pageName = (i: number) => (pageNumbers?.[i] !== undefined ? `page ${pageNumbers[i]}` : `job page ${i + 1}`);
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
      for (const item of result.layoutParsingResults as { markdown?: { text?: unknown }; prunedResult?: { parsing_res_list?: unknown } }[]) {
        const md = item?.markdown?.text;
        const text = typeof md === "string" ? baiduMarkdownToText(md) : "";
        const list = item?.prunedResult?.parsing_res_list;
        const missing = blocksMissingFromText(list, text);
        // Every page, fixed words and Baidu's own layout labels only (never a block's text): whether Baidu returned a
        // layout list and what it holds, so a line that is in neither the Markdown nor the reading can be told apart from
        // one Baidu never detected (13 Nov 2026: a schedule's last line missing, with no layout list seen).
        console.info(`[baidu-ocr] ${pageName(pages.length)} layout: ${layoutSummary(list)}; added ${missing.added}`);
        if (missing.added) {
          // Fixed words and Baidu's own layout labels only: never a block's text.
          console.warn(`[baidu-ocr] ${pageName(pages.length)}: ${missing.added} block(s) not in Baidu's Markdown added from its layout list (labels: ${missing.labels.join(", ")})`);
        }
        pages.push(missing.text);
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
export async function readPdfWithBaidu(pdf: Uint8Array, env: Env = process.env, deadline?: number, opts: { fileUrl?: string; pageNumbers?: number[] } = {}): Promise<BaiduJobResult> {
  const end = Math.min(deadline ?? Infinity, Date.now() + baiduOcrSettings(env).maxWaitMs);
  return withBaiduConnection(async () => {
    const { jobId, submitted } = await submitBaiduJob(pdf, env, end, opts.fileUrl ? { fileUrl: opts.fileUrl } : {});
    return awaitBaiduJob(jobId, env, end, submitted, undefined, opts.pageNumbers);
  });
}

/** What every call of one job needs: the token's header, the settings, and the limits by the job's end (ms since 1970). */
function jobContext(env: Env, end: number) {
  const token = env.BAIDU_AISTUDIO_TOKEN?.trim();
  if (!token || !baiduOcrConfigured(env)) throw new BaiduOcrError("not_configured");
  const s = baiduOcrSettings(env);
  if (!OCR_MODELS.has(s.model) && !DOC_MODELS.has(s.model)) throw new BaiduOcrError("unsupported_model");
  // Each call: connect within connectTimeoutMs, never sit idle for requestTimeoutMs, and end by the job's deadline.
  const timeout = (): Limits => {
    const left = end - Date.now();
    if (left <= 0) throw new BaiduOcrError("timeout");
    return { totalMs: left, idleMs: Math.min(s.requestTimeoutMs, left), connectMs: s.connectTimeoutMs, family: s.ipFamily, connection: keptConnection.getStore(),
      ...(s.via ? { via: { host: s.via, for: new URL(s.baseUrl).hostname.toLowerCase() } } : {}) };
  };
  return { s, auth: { Authorization: `Bearer ${token}` }, jobsUrl: `${s.baseUrl}${JOBS_PATH}`, timeout,
    retry: { retries: s.connectRetries, connectMs: s.retryConnectTimeoutMs } };
}

/** Submits one job (the PDF holds only the pages to read) and returns Baidu's job id. `end` (ms since 1970) bounds it. */
export async function submitBaiduJob(pdf: Uint8Array, env: Env, end: number, opts: { fileUrl?: string } = {}): Promise<{ jobId: string; submitted: Record<string, unknown> }> {
  const { s, auth, jobsUrl, timeout, retry } = jobContext(env, end);
  // Pages photographed sideways or upside down are turned upright by Baidu's own orientation step.
  const basePayload = { useDocOrientationClassify: true };
  // The document models leave a page's header, footer, footnotes, page number and margin text out of their Markdown
  // unless told otherwise (paddleocr 3.7.0 / PaddleX PaddleOCR-VL: markdown_ignore_labels defaults to number, footnote,
  // header, header_image, footer, footer_image, aside_text). A footnote can hold a policy's conditions, and the page
  // check then finds figures the text printed that the image reading left out (12 Nov 2026: a footnote year, a
  // registration number and a print date on a schedule's last lines). So nothing is left out; images are dropped by
  // baiduMarkdownToText anyway.
  const docModel = DOC_MODELS.has(s.model);
  const fullPayload = docModel ? { ...basePayload, markdownIgnoreLabels: [] as string[] } : basePayload;
  const submitWith = async (optionalPayload: Record<string, unknown>) => {
    let submitRequest: TransportRequest;
    if (opts.fileUrl) {
      // Baidu downloads the pages itself (the SDK's submit_url): a small JSON request instead of the whole file. The
      // link is a secret for its short life: it goes only into this request body, never into a log or error.
      submitRequest = { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ fileUrl: opts.fileUrl, model: s.model, optionalPayload }) };
    } else {
      const form = new FormData();
      form.append("file", new Blob([Uint8Array.from(pdf)], { type: "application/pdf" }), "pages.pdf");
      form.append("model", s.model);
      form.append("optionalPayload", JSON.stringify(optionalPayload));
      submitRequest = { method: "POST", headers: auth, body: form };
    }
    return apiData(await call(jobsUrl, submitRequest, timeout, "submit", retry));
  };
  let submitted: Record<string, unknown>;
  try {
    submitted = await submitWith(fullPayload);
  } catch (error) {
    // Should Baidu's service refuse the option (400 or 422: no job was made), the pages are still read, with its
    // default Markdown, rather than handed to the AI reader. A 413 (too large) is not retried: the same file would be
    // refused again. The fallback is logged, so production shows whether footnotes are being read.
    if (!(docModel && error instanceof BaiduOcrError && (error.status === 400 || error.status === 422))) throw error;
    console.warn(`[baidu-ocr] option markdownIgnoreLabels refused (status ${error.status}); submitted again with Baidu's default Markdown (headers, footers, footnotes left out)`);
    submitted = await submitWith(basePayload);
  }
  const jobId = submitted.jobId;
  if (typeof jobId !== "string" || !BAIDU_JOB_ID.test(jobId)) throw new BaiduOcrError("format");
  return { jobId, submitted };
}
/** The shape of a Baidu job id: the only form one is ever put in a URL or kept between runs. */
const BAIDU_JOB_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** Waits for a submitted job until `end` (ms since 1970) and returns its pages. A job still pending or running at `end`
 * is a "timeout". `onState` hears each state Baidu reports ("pending", "running", "done", "failed"). */
export async function awaitBaiduJob(jobId: string, env: Env, end: number, submitted: Record<string, unknown> = {}, onState?: (state: string) => void, pageNumbers?: number[]): Promise<BaiduJobResult> {
  const { s, auth, jobsUrl, timeout, retry } = jobContext(env, end);
  if (!BAIDU_JOB_ID.test(jobId)) throw new BaiduOcrError("format");
  let interval = s.pollIntervalMs;
  for (;;) {
    const data = await apiData(await call(`${jobsUrl}/${encodeURIComponent(jobId)}`, { method: "GET", headers: auth }, timeout, "poll", retry));
    const state = data.state;
    if (typeof state === "string") onState?.(state);
    if (state === "done") {
      const jsonUrl = (data.resultUrl as { jsonUrl?: unknown } | undefined)?.jsonUrl;
      if (typeof jsonUrl !== "string") throw new BaiduOcrError("format");
      let url: URL;
      try { url = new URL(jsonUrl); } catch { throw new BaiduOcrError("format"); }
      // The result link is pre-signed: fetched WITHOUT the token, only from Baidu's own hosts, and only over https
      // (plain http only when the configured service itself is plain http, i.e. a local test double).
      if (url.protocol !== "https:" && !(url.protocol === "http:" && s.baseUrl.startsWith("http:"))) throw new BaiduOcrError("format");
      if (!resultHostAllowed(url.hostname, env)) throw new BaiduOcrError("format");
      const res = await call(url.href, { method: "GET" }, timeout, "result", retry);
      if (!res.ok) throw new BaiduOcrError(kindForStatus(res.status), res.status);
      const jsonl = await res.text();
      let first: { model?: unknown; result?: { model?: unknown; dataInfo?: unknown } } | null = null;
      try { first = JSON.parse(jsonl.split(/\r?\n/).find((l) => l.trim()) ?? "null"); } catch { /* parsed (and refused) below */ }
      const pages = baiduPagesFromJsonl(jsonl, s.model, pageNumbers);
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

type Handoff = {
  stage: (args: { accountId: string; handoffId: string; bytes: Uint8Array; ttlSeconds: number }) => Promise<{ storageKey: string; url: string } | null>;
  remove: (storageKey: string) => Promise<void>;
};
const storageHandoff: Handoff = { stage: stageOcrHandoff, remove: removeOcrHandoff };
let handoff: Handoff = storageHandoff;
/** Tests only: stand in for the storage hand-off (null restores the real one). */
export function setBaiduHandoffForTests(h: Handoff | null) { handoff = h ?? storageHandoff; }

/** Reads one chunk with Baidu: through a signed link to a staged copy when "link" is on and storage can make one,
 * otherwise by uploading the file. The staged copy is removed when the job ends, whatever the outcome; if that
 * removal fails it is queued for the storage purge, so no copy is left behind. */
async function readChunkWithBaidu(accountId: string, pdf: Uint8Array, deadline: number, via: { used: "link" | "upload" }, pageNumbers: number[]): Promise<BaiduJobResult> {
  const s = baiduOcrSettings();
  if (s.submitVia !== "link") { via.used = "upload"; return readPdfWithBaidu(pdf, process.env, deadline, { pageNumbers }); }
  let staged: { storageKey: string; url: string } | null;
  try {
    staged = await handoff.stage({ accountId, handoffId: randomUUID(), bytes: pdf, ttlSeconds: s.linkTtlSeconds });
  } catch {
    throw new BaiduOcrError("handoff_failed");
  }
  if (!staged) { via.used = "upload"; return readPdfWithBaidu(pdf, process.env, deadline, { pageNumbers }); }
  via.used = "link";
  try {
    return await readPdfWithBaidu(pdf, process.env, deadline, { fileUrl: staged.url, pageNumbers });
  } finally {
    const key = staged.storageKey;
    await handoff.remove(key).catch(() => enqueueStoragePurge([{ domain: "policy", storageKey: key }], "ocr_handoff").catch(() => undefined));
  }
}

/** Background reading: submits one chunk and returns at once with Baidu's job id. With "link" on, the pages are staged
 * for Baidu to download; the staged copy is kept (its key is returned) until the job ends, since Baidu may download it
 * only when the job starts, and removed at once when the submit fails. */
async function submitChunkWithBaidu(accountId: string, pdf: Uint8Array, end: number, via: { used: "link" | "upload" }): Promise<{ jobId: string; submitted: Record<string, unknown>; stagedKey?: string }> {
  const s = baiduOcrSettings();
  if (s.submitVia !== "link") { via.used = "upload"; return submitBaiduJob(pdf, process.env, end); }
  let staged: { storageKey: string; url: string } | null;
  try {
    staged = await handoff.stage({ accountId, handoffId: randomUUID(), bytes: pdf, ttlSeconds: s.linkTtlSeconds });
  } catch {
    throw new BaiduOcrError("handoff_failed");
  }
  if (!staged) { via.used = "upload"; return submitBaiduJob(pdf, process.env, end); }
  via.used = "link";
  try {
    return { ...await submitBaiduJob(pdf, process.env, end, { fileUrl: staged.url }), stagedKey: staged.storageKey };
  } catch (error) {
    await removeStaged(staged.storageKey);
    throw error;
  }
}
/** Removes a staged copy; when that fails it is queued for the storage purge, so no copy is left behind. */
async function removeStaged(key: string): Promise<void> {
  await handoff.remove(key).catch(() => enqueueStoragePurge([{ domain: "policy", storageKey: key }], "ocr_handoff").catch(() => undefined));
}

/** A waiting reading that will not go on (its document was deleted): every staged copy it kept is removed. */
export async function abandonBaiduWait(state: BaiduWaitState): Promise<void> {
  for (const job of state.jobs) if (job.stagedKey) await removeStaged(job.stagedKey);
}

/** A chunk with a page Baidu read too little of: used for this reading, never cached, so a later re-read asks again. */
class WeakChunk extends Error {
  pages: { pageNumber: number; text: string }[];
  constructor(pages: { pageNumber: number; text: string }[]) { super("weak chunk"); this.name = "WeakChunk"; this.pages = pages; }
}
/** Background reading's first pass: the chunk was handed to Baidu (nothing to cache yet). */
class JustSubmitted extends Error { constructor() { super("submitted"); this.name = "JustSubmitted"; } }
/** Background reading: Baidu has not finished this chunk yet (or could not be reached): it is looked at again in a later run. */
class ChunkWaiting extends Error {
  why: string;
  constructor(why: string) { super("chunk waiting"); this.name = "ChunkWaiting"; this.why = why; }
}
/** Failures a later run can get past: Baidu not reached, not answering in time, briefly unavailable (5xx), or our own
 * storage not staging the pages. A refused request, a failed job or a result that cannot be used is never waited on. */
function worthWaiting(error: unknown): error is BaiduOcrError {
  return error instanceof BaiduOcrError && (error.kind === "network" || error.kind === "timeout" || error.kind === "unavailable" || error.kind === "handoff_failed");
}
const samePages = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Reads the given scanned pages with Baidu. Returns the pages with Baidu's text filled in, and the page numbers Baidu
 * did not give enough text for (all of them when Baidu failed): those go to the AI reader.
 * Reading has no spend cap, but it fails closed when this month's spend cannot be read (overSpendCap throws
 * SpendCheckUnavailable). Each job is booked to the ledger ($0, page count as input) and recorded as a provenance
 * attempt; text is used only when that attempt is verified (Baidu's job id plus the model, per BAIDU_IDENTITY_EXCEPTION).
 *
 * Background reading (`wait` given, BAIDU_OCR_BACKGROUND on): a chunk Baidu has not finished within this run, or could
 * not be reached for, is not handed to the AI reader. The result then carries `wait` (the jobs to look at again) and
 * `waitingPages`, and the caller puts the reading back to wait (lib/rag/ingest.ts). Each later run looks at the same Baidu
 * job again (never a second job for the same pages while one is going), or submits again after a connection failure.
 * Only after BAIDU_OCR_BACKGROUND_WINDOW_MIN from the first try does the AI reader read what Baidu still has not; a
 * failed job or a refused request goes to the AI reader at the end of the reading, as before. */
export function completePdfPagesWithBaidu(args: Parameters<typeof completeWithBaidu>[0]): ReturnType<typeof completeWithBaidu> {
  return withBaiduConnection(() => completeWithBaidu(args));
}
async function completeWithBaidu(args: {
  accountId: string; resourceId?: string; bytes: Uint8Array; password?: string; pages: PdfPage[]; pageNumbers: number[];
  /** Background reading: "start" on a reading's first run, then the state the previous run returned. */
  wait?: BaiduWaitState | "start";
}): Promise<{ pages: PdfPage[]; unread: number[]; probe?: () => Promise<void>; wait?: BaiduWaitState; waitingPages?: number[] }> {
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
  // Background reading: the state carried between runs (a copy: the caller's is never changed).
  const state: BaiduWaitState | null = args.wait === undefined || !s.background ? null
    : args.wait === "start" ? { since: started, runs: 0, jobs: [], gaveUp: [] }
    : { ...args.wait, jobs: args.wait.jobs.map((j) => ({ ...j, pages: [...j.pages] })), gaveUp: [...args.wait.gaveUp] };
  const windowOpen = state !== null && started - state.since < s.backgroundWindowMs;
  const waiting: number[] = [], waitWhy: string[] = [];
  /** Chunks (by their first index) the reading cache already held. */
  const cachedChunks = new Set<number>();
  /** A background job that has ended (read, failed or given up on): its staged copy is removed and it is not looked at again. */
  const settle = async (job: BaiduWaitJob | undefined) => {
    if (!state || !job) return;
    state.jobs = state.jobs.filter((j) => j !== job);
    if (job.stagedKey) await removeStaged(job.stagedKey);
  };

  /** Background: a chunk Baidu has read. Its staged copy is no longer needed, but the job stays known while the reading
   * waits on other chunks, so a later run reads its result again from Baidu (no new job) when the reading cache does not
   * hold it (a weak page is never cached). */
  const release = async (chunk: number[]) => {
    const job = state?.jobs.find((j) => samePages(j.pages, chunk));
    if (job?.stagedKey) { const key = job.stagedKey; delete job.stagedKey; await removeStaged(key); }
  };

  let unreachable = false;
  const via: { used: "link" | "upload" } = { used: s.submitVia };
  const owner = args.resourceId ? { accountId: args.accountId, policyId: args.resourceId } : undefined;
  const cacheMaterial = (chunk: number[]) => ({ bytes: bytesHash, pages: chunk, version: TEXT_VERSION });
  // Background: every chunk not yet with Baidu is submitted first, so Baidu reads a long document's chunks side by side
  // while this run waits on the first. A chunk the reading cache already holds is not sent; a submit that fails is
  // handled again by that chunk's turn below (its error, not a second try).
  const submitFailed = new Map<number, unknown>();
  if (state && windowOpen) {
    for (let i = 0; i < args.pageNumbers.length; i += s.pagesPerJob) {
      const chunk = args.pageNumbers.slice(i, i + s.pagesPerJob);
      if (chunk.every((n) => state.gaveUp.includes(n)) || state.jobs.some((j) => samePages(j.pages, chunk))) continue;
      if (deadline - Date.now() < MIN_BAIDU_MS) break;
      try {
        accept(await cachedReading(owner, "baidu_ocr", cacheMaterial(chunk), `baidu:${s.model}`, async (): Promise<{ pageNumber: number; text: string }[]> => {
          const sent = await submitChunkWithBaidu(args.accountId, await subsetPdf(args.bytes, chunk, undefined, args.password), deadline, via);
          state.jobs.push({ pages: [...chunk], jobId: sent.jobId, submittedAt: Date.now(), ...(sent.stagedKey ? { stagedKey: sent.stagedKey } : {}) });
          throw new JustSubmitted();
        }));
        // From the cache: read before, nothing sent.
        cachedChunks.add(i);
      } catch (error) {
        if (error instanceof JustSubmitted) continue;
        // Not sent: this chunk's turn below reports it, and later chunks are submitted in their own turns.
        submitFailed.set(i, error);
        break;
      }
    }
  }
  for (let i = 0; i < args.pageNumbers.length; i += s.pagesPerJob) {
    const chunk = args.pageNumbers.slice(i, i + s.pagesPerJob);
    if (cachedChunks.has(i) || (state && chunk.every((n) => state.gaveUp.includes(n)))) continue;
    const known = state?.jobs.find((j) => samePages(j.pages, chunk));
    if (state && !known && !windowOpen) { failures.push(`timeout waited ${Math.round((started - state.since) / 1000)}s`); state.gaveUp.push(...chunk); continue; }
    if (deadline - Date.now() < MIN_BAIDU_MS) {
      if (windowOpen) { waiting.push(...chunk); waitWhy.push("no time left in this run"); continue; }
      failures.push("timeout"); if (state) { state.gaveUp.push(...chunk); await settle(known); continue; } break;
    }
    // A background reading tries Baidu on every run whatever the cool-down says: its own waits space the tries out, and
    // nobody is kept waiting on the connection (the cool-down spares a reading that would hand its pages on at once).
    if (!state && (Date.now() < baiduUnreachableUntil || (i === 0 && await sharedCooldownActive(s.cooldownMs)))) { failures.push("cooling_down"); break; }
    try {
      const got = await cachedReading(owner, "baidu_ocr", cacheMaterial(chunk), `baidu:${s.model}`,
        async () => {
          const attemptGroupId = randomUUID();
          const requestedAt = known ? new Date(known.submittedAt) : new Date();
          const t0 = known?.submittedAt ?? Date.now();
          const requested = { provider: choice.provider, model: choice.model, capability: "reading" as const, inputArtifactType: "application/pdf" };
          let job: BaiduJobResult;
          // Background: the last state Baidu reported for the job ("pending": queued at Baidu, "running": reading).
          let lastState: string | undefined;
          try {
            if (!state) {
              job = await readChunkWithBaidu(args.accountId, await subsetPdf(args.bytes, chunk, undefined, args.password), deadline, via, chunk);
            } else {
              // Background: look at the job a previous run submitted, or submit one now and keep its id for later runs.
              let entry = known ?? state.jobs.find((j) => samePages(j.pages, chunk)), submitted: Record<string, unknown> = {};
              if (submitFailed.has(i)) throw submitFailed.get(i);
              if (!entry) {
                const sent = await submitChunkWithBaidu(args.accountId, await subsetPdf(args.bytes, chunk, undefined, args.password), deadline, via);
                entry = { pages: [...chunk], jobId: sent.jobId, submittedAt: t0, ...(sent.stagedKey ? { stagedKey: sent.stagedKey } : {}) };
                state.jobs.push(entry);
                submitted = sent.submitted;
              }
              job = await awaitBaiduJob(entry.jobId, process.env, deadline, submitted, (st) => { lastState = st; }, chunk);
            }
            // One entry per page sent, in order. A reply with a different count cannot be mapped to pages safely.
            if (job.pages.length !== chunk.length) throw new BaiduOcrError("format");
          } catch (error) {
            // Background: not finished, or not reached, and the window is still open: looked at again later, nothing recorded.
            if (state && windowOpen && worthWaiting(error)) throw new ChunkWaiting(`${error.summary} via=${via.used}${lastState ? ` baidu=${lastState}` : ""}`);
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
      await release(chunk);
    } catch (error) {
      if (error instanceof WeakChunk) { accept(error.pages); await release(chunk); continue; }
      if (error instanceof ChunkWaiting) { waiting.push(...chunk); waitWhy.push(error.why); continue; }
      failures.push(`${error instanceof BaiduOcrError ? error.summary : "unexpected"} via=${via.used}`);
      // Baidu could not be reached at all, or did not answer the submit in time: every instance stops trying for a while, so each later scanned document does
      // not wait 10-60 s for a connection that is not coming before the AI reader reads it.
      if (error instanceof BaiduOcrError && error.stage === "submit" && (error.kind === "network" || error.kind === "timeout")) {
        baiduUnreachableUntil = Date.now() + baiduOcrSettings().cooldownMs;
        if (baiduOcrSettings().cooldownMs > 0) await startSharedCooldown();
        unreachable = true;
      }
      // Background: these pages go to the AI reader at the end of the reading; the other chunks still go to Baidu.
      if (state) { state.gaveUp.push(...chunk); await settle(state.jobs.find((j) => samePages(j.pages, chunk))); continue; }
      // Pages after a failed job are not sent to Baidu again in this reading: the AI reader reads them.
      break;
    }
  }

  const merged = args.pages.map((page) => (texts.has(page.pageNumber) ? { ...page, text: texts.get(page.pageNumber)!, extractionMethod: "ocr" as const } : page));
  const unread = args.pageNumbers.filter((n) => !texts.has(n));
  const probeFor = (): (() => Promise<void>) | undefined => {
    // Which step of the path to Baidu fails, and from which region (no token is used). Only after a submit could not
    // be completed, and run by the caller only AFTER the AI reader has read the pages, so the upload is not held up
    // (Critic #411); it is skipped when the function no longer has time to spare for it.
    if (!unreachable || !args.resourceId || s.probeStepMs <= 0) return undefined;
    const resourceId = args.resourceId, stepMs = s.probeStepMs;
    return async () => {
      if ((fnDeadline ?? Infinity) - PROBE_MARGIN_MS - Date.now() <= stepMs * 4) return;
      const found = await probeBaiduPath(s.baseUrl, { stepMs, via: s.via }).catch(() => null);
      if (found) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId,
        failureCode: "BAIDU_OCR_PATH_PROBE", error: probeSummary(found) }).catch(() => undefined);
    };
  };

  // Background: Baidu is still reading (or was not reached) and the window is open: the reading waits and looks again.
  if (state && waiting.length) {
    state.runs += 1;
    if (args.resourceId) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.resourceId,
      failureCode: "BAIDU_OCR_WAITING", error: `pages ${waiting.join(", ")}: ${waitWhy.join(",")}; wait ${state.runs}, ${Math.round((Date.now() - state.since) / 1000)}s since the first try`
        + (failures.length ? `; pages ${state.gaveUp.join(", ")} left for the AI reader: ${failures.join(",")}` : "") }).catch(() => undefined);
    void recordEvent({ name: "documents.ocr_baidu.waiting", correlationId, status: "in_progress", householdRef,
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, pagesWaiting: waiting.length, wait: state.runs, durationMs: Date.now() - started } });
    return { pages: merged, unread, probe: probeFor(), wait: state, waitingPages: waiting };
  }
  // The reading ends here: no Baidu job is looked at again, so no staged copy is kept.
  if (state) for (const job of [...state.jobs]) await settle(job);
  // Pages Baidu failed on in an earlier run of this reading are named too: the AI reader reads them now.
  if (state && !failures.length && state.gaveUp.some((n) => !texts.has(n))) failures.push("failed in an earlier run (see BAIDU_OCR_WAITING)");

  if (failures.length) {
    const kind = failures.join(",");
    void recordErrorEvent({ name: "documents.ocr_baidu.failed", correlationId, householdRef, error: new BaiduOcrError(failures[0].split(" ")[0] as BaiduFailureKind),
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, kind, durationMs: Date.now() - started } });
    if (args.resourceId) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.resourceId,
      failureCode: "BAIDU_OCR_FALLBACK", error: `pages ${unread.join(", ")}: ${kind}; ${aiPageReaderOn() ? "read by the AI reader instead" : "not read: the AI reader is switched off (OCR_AI_READER=off)"}` }).catch(() => undefined);
  } else {
    void recordEvent({ name: "documents.ocr_baidu.completed", correlationId, status: "success", householdRef,
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, pagesToFallback: unread.length, durationMs: Date.now() - started } });
  }
  return { pages: merged, unread, probe: failures.length ? probeFor() : undefined };
}
