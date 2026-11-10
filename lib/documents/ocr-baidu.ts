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
const TEXT_VERSION = "baidu-md-v2";

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

export type BaiduFailureKind = "not_configured" | "unsupported_model" | "auth" | "rate_limit" | "unavailable" | "bad_request" | "network" | "timeout" | "job_failed" | "format" | "unverified";
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
  const submitted = await apiData(await call(jobsUrl, { method: "POST", headers: auth, body: form }, timeout()));
  const jobId = submitted.jobId;
  if (typeof jobId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(jobId)) throw new BaiduOcrError("format");

  let interval = s.pollIntervalMs;
  for (;;) {
    const data = await apiData(await call(`${jobsUrl}/${encodeURIComponent(jobId)}`, { method: "GET", headers: auth }, timeout()));
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
      const res = await call(url.href, { method: "GET" }, timeout());
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

/** Time kept back, inside the function's limit, for the AI reader to read whatever Baidu did not. */
export const AI_FALLBACK_RESERVE_MS = 120_000;
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
  accountId: string; resourceId?: string; bytes: Uint8Array; pages: PdfPage[]; pageNumbers: number[];
}): Promise<{ pages: PdfPage[]; unread: number[] }> {
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

  for (let i = 0; i < args.pageNumbers.length; i += s.pagesPerJob) {
    const chunk = args.pageNumbers.slice(i, i + s.pagesPerJob);
    if (deadline - Date.now() < MIN_BAIDU_MS) { failures.push("timeout"); break; }
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
            job = await readPdfWithBaidu(await subsetPdf(args.bytes, chunk), process.env, deadline);
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
      failures.push(error instanceof BaiduOcrError ? error.kind : "unexpected");
      // Pages after a failed job are not sent to Baidu again in this reading: the AI reader reads them.
      break;
    }
  }

  const unread = args.pageNumbers.filter((n) => !texts.has(n));
  if (failures.length) {
    const kind = failures.join(",");
    void recordErrorEvent({ name: "documents.ocr_baidu.failed", correlationId, householdRef, error: new BaiduOcrError(failures[0] as BaiduFailureKind),
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, kind, durationMs: Date.now() - started } });
    if (args.resourceId) await recordProcessingFailure({ accountId: args.accountId, resourceType: "policy_document", resourceId: args.resourceId,
      failureCode: "BAIDU_OCR_FALLBACK", error: `pages ${unread.join(", ")}: ${kind}; read by the AI reader instead` }).catch(() => undefined);
  } else {
    void recordEvent({ name: "documents.ocr_baidu.completed", correlationId, status: "success", householdRef,
      extra: { pagesRequested: args.pageNumbers.length, pagesRead: texts.size, pagesToFallback: unread.length, durationMs: Date.now() - started } });
  }
  return {
    pages: args.pages.map((page) => (texts.has(page.pageNumber) ? { ...page, text: texts.get(page.pageNumber)!, extractionMethod: "ocr" as const } : page)),
    unread,
  };
}
