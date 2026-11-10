import { createHash } from "node:crypto";
import type { PdfPage } from "@/lib/documents/pdf";
import { assertUnderSpendCap } from "@/lib/ai/ledger";
import { cachedReading } from "@/lib/documents/evidence";
import { subsetPdf } from "@/lib/documents/ocr-hosted";
import { recordErrorEvent, recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { recordProcessingFailure } from "@/lib/diagnostics/processing-failures";

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
const DOC_MODELS = new Set(["PP-StructureV3", "PaddleOCR-VL", "PaddleOCR-VL-1.5", "PaddleOCR-VL-1.6"]);
/** Bumped whenever the way a Baidu result is turned into page text changes, so an older cached reading is not reused. */
const TEXT_VERSION = "baidu-md-v1";

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
  };
}

export type BaiduFailureKind = "not_configured" | "unsupported_model" | "auth" | "rate_limit" | "unavailable" | "bad_request" | "network" | "timeout" | "job_failed" | "format";
/** A Baidu failure. Its message names the kind and the HTTP status only: never the token, never page text. */
export class BaiduOcrError extends Error {
  kind: BaiduFailureKind; status?: number;
  constructor(kind: BaiduFailureKind, status?: number) {
    super(`Baidu PaddleOCR ${kind.replace(/_/g, " ")}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "BaiduOcrError"; this.kind = kind; this.status = status;
  }
}

function kindForStatus(status: number): BaiduFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 400 || status === 413 || status === 422) return "bad_request";
  return "unavailable";
}

async function call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new BaiduOcrError((error as Error)?.name === "TimeoutError" ? "timeout" : "network");
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
  text = text.replace(/<table\b[\s\S]*?<\/table>/gi, (table) => {
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
    return "\n" + rows.map((row) => (row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? []).map(cellText).join("\t"))
      .filter((r) => r.replace(/\t/g, "").trim()).join("\n") + "\n";
  });
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

/** One job: the given PDF (already only the pages to read) in, one text per page out, in the PDF's page order. */
export async function readPdfWithBaidu(pdf: Uint8Array, env: Env = process.env): Promise<string[]> {
  const token = env.BAIDU_AISTUDIO_TOKEN?.trim();
  if (!token || !baiduOcrConfigured(env)) throw new BaiduOcrError("not_configured");
  const s = baiduOcrSettings(env);
  if (!OCR_MODELS.has(s.model) && !DOC_MODELS.has(s.model)) throw new BaiduOcrError("unsupported_model");
  const auth = { Authorization: `Bearer ${token}` };
  const jobsUrl = `${s.baseUrl}${JOBS_PATH}`;

  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(pdf)], { type: "application/pdf" }), "pages.pdf");
  form.append("model", s.model);
  // Pages photographed sideways or upside down are turned upright by Baidu's own orientation step.
  form.append("optionalPayload", JSON.stringify({ useDocOrientationClassify: true }));
  const submitted = await apiData(await call(jobsUrl, { method: "POST", headers: auth, body: form }, s.requestTimeoutMs));
  const jobId = submitted.jobId;
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(jobId)) throw new BaiduOcrError("format");

  const deadline = Date.now() + s.maxWaitMs;
  let interval = s.pollIntervalMs;
  for (;;) {
    const data = await apiData(await call(`${jobsUrl}/${encodeURIComponent(jobId)}`, { method: "GET", headers: auth }, s.requestTimeoutMs));
    const state = data.state;
    if (state === "done") {
      const jsonUrl = (data.resultUrl as { jsonUrl?: unknown } | undefined)?.jsonUrl;
      if (typeof jsonUrl !== "string") throw new BaiduOcrError("format");
      let url: URL;
      try { url = new URL(jsonUrl); } catch { throw new BaiduOcrError("format"); }
      // The result link is pre-signed: fetched WITHOUT the token, and only over https (plain http only when the
      // configured service itself is plain http, i.e. a local test double).
      if (url.protocol !== "https:" && !(url.protocol === "http:" && s.baseUrl.startsWith("http:"))) throw new BaiduOcrError("format");
      const res = await call(url.href, { method: "GET" }, s.requestTimeoutMs);
      if (!res.ok) throw new BaiduOcrError(kindForStatus(res.status), res.status);
      return baiduPagesFromJsonl(await res.text(), s.model);
    }
    if (state === "failed") throw new BaiduOcrError("job_failed");
    if (state !== "pending" && state !== "running") throw new BaiduOcrError("format");
    const left = deadline - Date.now();
    if (left <= 0) throw new BaiduOcrError("timeout");
    await sleep(Math.min(interval, left));
    interval = Math.min(Math.round(interval * 1.5), 15_000);
  }
}

const usable = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length > 0;

/** Reads the given scanned pages with Baidu. Returns the pages with Baidu's text filled in, and the page numbers Baidu
 * did not give text for (all of them when Baidu failed): those go to the AI reader. Spend-ledger failures are NOT
 * swallowed: reading fails closed when the ledger cannot be read, the same as every other reader. */
export async function completePdfPagesWithBaidu(args: {
  accountId: string; resourceId?: string; bytes: Uint8Array; pages: PdfPage[]; pageNumbers: number[];
}): Promise<{ pages: PdfPage[]; unread: number[] }> {
  const correlationId = resolveCorrelationId(undefined);
  const householdRef = pseudonymizeId(args.accountId);
  await assertUnderSpendCap(args.accountId);
  const s = baiduOcrSettings();
  const started = Date.now();
  const texts = new Map<number, string>();
  try {
    const read = await cachedReading(
      args.resourceId ? { accountId: args.accountId, policyId: args.resourceId } : undefined,
      "baidu_ocr", { bytes: createHash("sha256").update(args.bytes).digest("hex"), pages: args.pageNumbers, version: TEXT_VERSION },
      `baidu:${s.model}`,
      async () => {
        const out: { pageNumber: number; text: string }[] = [];
        for (let i = 0; i < args.pageNumbers.length; i += s.pagesPerJob) {
          const chunk = args.pageNumbers.slice(i, i + s.pagesPerJob);
          const got = await readPdfWithBaidu(await subsetPdf(args.bytes, chunk));
          // One entry per page sent, in order. A reply with a different count cannot be mapped to pages safely.
          if (got.length !== chunk.length) throw new BaiduOcrError("format");
          chunk.forEach((n, k) => out.push({ pageNumber: n, text: got[k] }));
        }
        return out;
      });
    for (const p of read) if (typeof p?.text === "string" && usable(p.text)) texts.set(p.pageNumber, p.text.trim());
  } catch (error) {
    const kind = error instanceof BaiduOcrError ? error.kind : "unexpected";
    void recordErrorEvent({ name: "documents.ocr_baidu.failed", correlationId, householdRef, error: new BaiduOcrError(error instanceof BaiduOcrError ? error.kind : "unavailable", error instanceof BaiduOcrError ? error.status : undefined),
      extra: { pagesRequested: args.pageNumbers.length, kind, durationMs: Date.now() - started } });
    if (args.resourceId) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.resourceId,
      failureCode: "BAIDU_OCR_FALLBACK", error: `pages ${args.pageNumbers.join(", ")}: ${kind}; read by the AI reader instead` }).catch(() => undefined);
    return { pages: args.pages, unread: [...args.pageNumbers] };
  }
  const unread = args.pageNumbers.filter((n) => !texts.has(n));
  void recordEvent({ name: "documents.ocr_baidu.completed", correlationId, status: "success", householdRef,
    extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, pagesToFallback: unread.length, durationMs: Date.now() - started } });
  return {
    pages: args.pages.map((page) => (texts.has(page.pageNumber) ? { ...page, text: texts.get(page.pageNumber)!, extractionMethod: "ocr" as const } : page)),
    unread,
  };
}
