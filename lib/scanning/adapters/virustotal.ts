/**
 * VirusTotal API v3 file-scan adapter (checkpoint 14e, claude/v1-launch-hardening).
 *
 * This is the first REAL entry in lib/scanning/adapter.ts's SCAN_ADAPTERS
 * registry -- selected by setting MALWARE_SCANNER_PROVIDER=virustotal and
 * VIRUSTOTAL_API_KEY. Until now the registry only had nullFileScanAdapter,
 * which always returns "scan_unavailable" and is never treated as "clean"
 * by any caller (lib/policies/quarantine/store.ts's runPolicyQuarantineGate,
 * lib/claims/evidence/pipeline.ts) -- that fail-closed behaviour is
 * preserved unchanged here: this module is ADDED to the registry, the null
 * adapter stays the default whenever MALWARE_SCANNER_PROVIDER is unset or
 * set to anything this registry does not recognise (see
 * currentFileScanAdapter()'s `?? nullFileScanAdapter` fallback).
 *
 * PRIVACY (31 Oct): by default NO FILE CONTENT LEAVES DEARPOLICY. Uploads are
 * people's policy documents (health and identity details), and VirusTotal
 * shares submitted files with its partners. So scanFile() only looks up the
 * file's SHA-256 (GET {baseUrl}/files/{sha256}). A file VirusTotal knows as
 * malicious or suspicious is rejected. Every other file, including one it has
 * never seen (almost every personal document), then goes through DearPolicy's
 * own local check (lib/scanning/local-file-check.ts: strict type, structure,
 * size, no active content): it proceeds when that passes and is rejected when
 * it does not, so no upload is held forever. Uploading the whole file, the
 * flow described below, happens ONLY when VIRUSTOTAL_UPLOAD_FILES is set to
 * true; it is off by default.
 *
 * API contract (https://docs.virustotal.com/reference/files-scan and
 * .../reference/analysis, fetched and verified against VirusTotal's own
 * docs while building this):
 *   1. POST {baseUrl}/files, header `x-apikey: <key>`, multipart body with
 *      a `file` field -- 200 response is `{ data: { id: <analysisId>,
 *      type: "analysis" } }`.
 *   2. GET {baseUrl}/analyses/{analysisId}, header `x-apikey: <key>` --
 *      200 response is `{ data: { attributes: { status: "queued" |
 *      "in-progress" | "completed", stats: { malicious, suspicious,
 *      undetected, harmless, timeout, "confirmed-timeout", failure,
 *      "type-unsupported" } } } }`. Polled (with a bounded time budget,
 *      never indefinitely) until status is "completed".
 *   3. Errors are `{ error: { code: <MachineCode>, message: <string> } }`.
 *      code/HTTP-status pairs are classified below into "auth" (bad/missing
 *      key -- never worth retrying, always a misconfiguration),
 *      "transient" (rate limit / server hiccup -- worth a bounded retry),
 *      or "other" (unexpected -- surfaced, not silently swallowed).
 *
 * Verdict mapping: infected iff stats.malicious > 0 OR stats.suspicious > 0
 * (i.e. ANY engine flagging it beyond a plain "undetected/harmless" is
 * treated as not-clean -- the conservative, fail-closed reading). Anything
 * else genuinely reached "completed" with zero malicious/suspicious
 * engines is "clean". If VirusTotal itself cannot produce a verdict inside
 * this adapter's poll budget (still queued/in-progress, or the submit/poll
 * calls exhaust their transient-error retry budget), scanFile() returns
 * "scan_unavailable" -- exactly like the null adapter's own honest
 * default -- rather than guessing. A misconfigured deployment (provider
 * selected, no API key) throws instead: runPolicyQuarantineGate() and
 * lib/claims/evidence/pipeline.ts already catch a thrown scanFile() error
 * and leave the document at scan_pending/quarantined with an audited
 * "scan_attempt_failed" entry -- a config mistake must be loud, not a
 * silent scan_unavailable indistinguishable from "no scanner configured
 * at all".
 *
 * Why polling inside scanFile() rather than using this app's own
 * app/api/policies/scan-callback/route.ts (checkpoint 4's HMAC-verified
 * async callback receiver): VirusTotal's public v3 API has no per-submission
 * caller-supplied webhook/notify-url parameter for file analysis --
 * GET /analyses/{id} is the only way to learn a submission's outcome, so a
 * bounded poll loop inside this adapter's synchronous scanFile() call is
 * the correct integration for THIS provider. The callback route stays
 * exactly as checkpoint 4 left it, unmodified, ready for a future provider
 * that IS webhook-based (recordPolicyScanResult()'s idempotent CAS write
 * doesn't care which path produced the verdict).
 */
import { createHash } from "node:crypto";
import { checkFileLocally } from "../local-file-check";
import type { FileScanAdapter, FileScanResult, FileScanStatus, ScanRetryHint } from "../adapter";

export const VIRUSTOTAL_DEFAULT_BASE_URL = "https://www.virustotal.com/api/v3";
export const VIRUSTOTAL_DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const VIRUSTOTAL_DEFAULT_POLL_INTERVAL_MS = 3_000;
export const VIRUSTOTAL_DEFAULT_POLL_BUDGET_MS = 60_000;
export const VIRUSTOTAL_DEFAULT_MAX_TRANSIENT_RETRIES = 3;
export const VIRUSTOTAL_DEFAULT_RETRY_BACKOFF_BASE_MS = 1_000;

export type VirusTotalStats = {
  malicious: number;
  suspicious: number;
  undetected: number;
  harmless: number;
  timeout: number;
  "confirmed-timeout": number;
  failure: number;
  "type-unsupported": number;
};

export type VirusTotalAnalysisStatus = "queued" | "in-progress" | "completed";

export type VirusTotalConfig = {
  apiKey: string;
  baseUrl: string;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  pollBudgetMs: number;
  maxTransientRetries: number;
  retryBackoffBaseMs: number;
  /** Upload the whole file for analysis. Off by default: only the file's hash is looked up (see the module note). */
  uploadFiles: boolean;
};

/** Thrown for anything scanFile() cannot recover from by itself: a missing
 * API key (misconfiguration), an auth failure VirusTotal itself reports
 * (bad/revoked key), or an unexpected non-transient API error. Deliberately
 * a distinct class from a plain Error so tests (and, if ever useful,
 * callers) can tell "this scan attempt failed" apart from other exceptions
 * without string-matching a message. */
export class VirusTotalAdapterError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "VirusTotalAdapterError";
  }
}

export function readVirusTotalConfig(env: NodeJS.ProcessEnv = process.env): VirusTotalConfig | null {
  const apiKey = env.VIRUSTOTAL_API_KEY?.trim();
  if (!apiKey) return null;
  // >= 0, not > 0: an operator explicitly setting e.g.
  // VIRUSTOTAL_POLL_BUDGET_MS=0 or VIRUSTOTAL_MAX_TRANSIENT_RETRIES=0 means
  // exactly that (no poll budget / no retries), not "value not supplied" --
  // only an unset, blank, negative, or non-numeric value falls back to the
  // documented default below.
  const intOr = (value: string | undefined, fallback: number): number => {
    const parsed = value !== undefined && value.trim() !== "" ? Number(value) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    apiKey,
    baseUrl: env.VIRUSTOTAL_API_BASE_URL?.trim() || VIRUSTOTAL_DEFAULT_BASE_URL,
    requestTimeoutMs: intOr(env.VIRUSTOTAL_REQUEST_TIMEOUT_MS, VIRUSTOTAL_DEFAULT_REQUEST_TIMEOUT_MS),
    pollIntervalMs: intOr(env.VIRUSTOTAL_POLL_INTERVAL_MS, VIRUSTOTAL_DEFAULT_POLL_INTERVAL_MS),
    pollBudgetMs: intOr(env.VIRUSTOTAL_POLL_BUDGET_MS, VIRUSTOTAL_DEFAULT_POLL_BUDGET_MS),
    maxTransientRetries: intOr(env.VIRUSTOTAL_MAX_TRANSIENT_RETRIES, VIRUSTOTAL_DEFAULT_MAX_TRANSIENT_RETRIES),
    retryBackoffBaseMs: intOr(env.VIRUSTOTAL_RETRY_BACKOFF_BASE_MS, VIRUSTOTAL_DEFAULT_RETRY_BACKOFF_BASE_MS),
    // Only an explicit "true" turns uploads on; anything else (unset, "1", "yes", a typo) keeps hash-only.
    uploadFiles: env.VIRUSTOTAL_UPLOAD_FILES?.trim().toLowerCase() === "true",
  };
}

/** Pure classification of a VirusTotal error response against its
 * documented (status, error.code) pairs (docs.virustotal.com/reference/errors).
 * "auth" -> never worth retrying, always a VirusTotalAdapterError.
 * "transient" -> worth a bounded retry (rate limiting / a momentary server
 * problem on VirusTotal's side, not this deployment's fault).
 * "other" -> unexpected; surfaced as a VirusTotalAdapterError rather than
 * silently treated as either of the above. */
export function classifyVirusTotalErrorResponse(status: number, code: string | undefined): "auth" | "transient" | "other" {
  if (status === 401 || status === 403 || code === "WrongCredentialsError" || code === "AuthenticationRequiredError" || code === "ForbiddenError" || code === "UserNotActiveError") {
    return "auth";
  }
  if (status === 429 || status === 503 || status === 504 || code === "QuotaExceededError" || code === "TooManyRequestsError" || code === "TransientError" || code === "DeadlineExceededError") {
    return "transient";
  }
  return "other";
}

type ParsedVirusTotalError = { code?: string; message: string };

function parseVirusTotalErrorBody(bodyText: string): ParsedVirusTotalError {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { code?: string; message?: string } };
    if (parsed?.error?.message) return { code: parsed.error.code, message: parsed.error.message };
  } catch {
    // Body wasn't the documented { error: { code, message } } shape --
    // fall through to a generic message built from the raw text below.
  }
  return { message: bodyText.slice(0, 500) || "No response body." };
}

/** Infected iff ANY engine reported malicious or suspicious -- the
 * conservative, fail-closed reading of a completed VirusTotal analysis.
 * Pure and exported so the regression suite can exercise this exact
 * mapping against realistic example stats objects without touching the
 * network at all. */
export function classifyVirusTotalStats(stats: VirusTotalStats): Extract<FileScanStatus, "clean" | "infected"> {
  return stats.malicious > 0 || stats.suspicious > 0 ? "infected" : "clean";
}

export function describeVirusTotalStats(analysisId: string, stats: VirusTotalStats): string {
  return (
    `VirusTotal analysis ${analysisId}: malicious=${stats.malicious} suspicious=${stats.suspicious} ` +
    `harmless=${stats.harmless} undetected=${stats.undetected} timeout=${stats.timeout}.`
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries a single VirusTotal HTTP call up to `config.maxTransientRetries`
 * additional times (exponential backoff, capped) when the failure is
 * classified "transient" (rate limit / momentary server error) OR the
 * network call itself threw (DNS, connection reset, our own timeout
 * abort). An "auth" classification never retries -- it throws immediately,
 * since retrying a bad API key cannot succeed. Returns null (never
 * throws) once retries are exhausted on a transient failure, so the
 * caller can fall back to "scan_unavailable" instead of failing the whole
 * scan attempt; throws a VirusTotalAdapterError for "auth"/"other". */
/** What the last transient failure of a call looked like, so scanFile() can
 * tell the caller WHY it gave up (lib/scanning/retry.ts schedules a bounded
 * retry from this) -- never the provider's raw text. */
type TransientTrace = { reason: ScanRetryHint["reason"] | null; retryAfterSeconds: number | null };

/** The provider's own Retry-After metadata (seconds or an HTTP date), bounded
 * to one day; null when absent or unreadable -- never guessed. */
export function parseRetryAfterHeader(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed), 86_400);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.min(Math.max(Math.ceil((at - now) / 1000), 0), 86_400);
}

async function callWithTransientRetry(
  label: string,
  attempt: () => Promise<Response>,
  config: VirusTotalConfig,
  trace: TransientTrace = { reason: null, retryAfterSeconds: null },
  passThroughStatuses: number[] = [],
): Promise<Response | null> {
  let lastError: unknown = null;
  for (let attemptNumber = 0; attemptNumber <= config.maxTransientRetries; attemptNumber++) {
    try {
      const response = await attempt();
      if (response.ok || passThroughStatuses.includes(response.status)) return response;
      const bodyText = await response.text();
      const parsed = parseVirusTotalErrorBody(bodyText);
      const classification = classifyVirusTotalErrorResponse(response.status, parsed.code);
      if (classification === "auth") {
        throw new VirusTotalAdapterError(`VirusTotal ${label} failed with an authentication error (${parsed.code ?? response.status}): ${parsed.message}`);
      }
      if (classification === "other") {
        throw new VirusTotalAdapterError(`VirusTotal ${label} failed (${parsed.code ?? response.status}): ${parsed.message}`);
      }
      lastError = new VirusTotalAdapterError(`VirusTotal ${label} transient failure (${parsed.code ?? response.status}): ${parsed.message}`);
      trace.reason = response.status === 429 || parsed.code === "QuotaExceededError" || parsed.code === "TooManyRequestsError" ? "rate_limited" : "provider_unavailable";
      trace.retryAfterSeconds = parseRetryAfterHeader(response.headers.get("retry-after"));
    } catch (error) {
      if (error instanceof VirusTotalAdapterError) throw error;
      lastError = error;
      trace.reason = "provider_timeout";
      trace.retryAfterSeconds = null;
    }
    if (attemptNumber < config.maxTransientRetries) {
      const backoffMs = Math.min(config.retryBackoffBaseMs * 2 ** attemptNumber, config.retryBackoffBaseMs * 10);
      await sleep(backoffMs);
    }
  }
  void lastError;
  return null;
}

async function submitFile(bytes: Uint8Array, config: VirusTotalConfig, trace?: TransientTrace): Promise<string | null> {
  const form = new FormData();
  // Cast needed because TS's lib.dom BlobPart type only accepts a view over
  // a plain ArrayBuffer, not the wider ArrayBufferLike (which also covers
  // SharedArrayBuffer) that Uint8Array's own type carries generically --
  // functionally this is exactly the bytes handed to scanFile(), unchanged.
  form.append("file", new Blob([bytes as unknown as BlobPart]), "upload");
  const response = await callWithTransientRetry(
    "file submission",
    () => fetchWithTimeout(`${config.baseUrl}/files`, { method: "POST", headers: { "x-apikey": config.apiKey }, body: form }, config.requestTimeoutMs),
    config,
    trace,
  );
  if (!response) return null;
  const json = (await response.json()) as { data?: { id?: string } };
  const analysisId = json.data?.id;
  if (!analysisId) throw new VirusTotalAdapterError("VirusTotal file submission response did not include an analysis id.");
  return analysisId;
}

async function fetchAnalysis(analysisId: string, config: VirusTotalConfig, trace?: TransientTrace): Promise<{ status: VirusTotalAnalysisStatus; stats: VirusTotalStats } | null> {
  const response = await callWithTransientRetry(
    "analysis lookup",
    () => fetchWithTimeout(`${config.baseUrl}/analyses/${encodeURIComponent(analysisId)}`, { method: "GET", headers: { "x-apikey": config.apiKey } }, config.requestTimeoutMs),
    config,
    trace,
  );
  if (!response) return null;
  const json = (await response.json()) as { data?: { attributes?: { status?: string; stats?: VirusTotalStats } } };
  const status = json.data?.attributes?.status;
  const stats = json.data?.attributes?.stats;
  if (status !== "queued" && status !== "in-progress" && status !== "completed") {
    throw new VirusTotalAdapterError(`VirusTotal analysis response had an unrecognised status: ${String(status)}.`);
  }
  if (status === "completed" && !stats) {
    throw new VirusTotalAdapterError("VirusTotal analysis reported completed but included no stats object.");
  }
  return { status, stats: stats as VirusTotalStats };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Hash-only lookup: GET /files/{sha256}, no file content sent. "unknown" when VirusTotal has never seen the file
 * (404 NotFoundError); null when transient failures exhausted the retries. */
async function lookupFileHash(sha256: string, config: VirusTotalConfig, trace?: TransientTrace): Promise<{ known: true; stats: VirusTotalStats } | { known: false } | null> {
  const response = await callWithTransientRetry(
    "hash lookup",
    () => fetchWithTimeout(`${config.baseUrl}/files/${encodeURIComponent(sha256)}`, { method: "GET", headers: { "x-apikey": config.apiKey } }, config.requestTimeoutMs),
    config,
    trace,
    [404],
  );
  if (!response) return null;
  if (response.status === 404) return { known: false };
  const json = (await response.json()) as { data?: { attributes?: { last_analysis_stats?: VirusTotalStats } } };
  const stats = json.data?.attributes?.last_analysis_stats;
  if (!stats || typeof stats.malicious !== "number" || typeof stats.suspicious !== "number") {
    throw new VirusTotalAdapterError("VirusTotal hash lookup response included no last_analysis_stats.");
  }
  return { known: true, stats };
}

async function scanByHash(bytes: Uint8Array, config: VirusTotalConfig): Promise<FileScanResult> {
  const trace: TransientTrace = { reason: null, retryAfterSeconds: null };
  const sha256 = sha256Hex(bytes);
  const found = await lookupFileHash(sha256, config, trace);
  if (!found) {
    return { status: "scan_unavailable", detail: "VirusTotal hash lookup did not succeed after retrying transient failures.", retry: { reason: trace.reason ?? "provider_unavailable", retryAfterSeconds: trace.retryAfterSeconds } };
  }
  if (found.known && classifyVirusTotalStats(found.stats) === "infected") {
    return { status: "infected", detail: describeVirusTotalStats("hash lookup", found.stats) };
  }
  // Known and not flagged, or never seen (the file is not uploaded to find out): DearPolicy's own local check decides.
  const seen = found.known ? describeVirusTotalStats("hash lookup", found.stats) : "VirusTotal has no record of this file (hash-only lookup; the file was not uploaded).";
  const local = checkFileLocally(bytes);
  if (!local.ok) return { status: "infected", detail: `${seen} Local file check failed (${local.reason}): ${local.detail}.` };
  return { status: "clean", detail: `${seen} Local file check passed (${local.format}: type, structure, size, no active content).` };
}

async function scanFile(bytes: Uint8Array, env: NodeJS.ProcessEnv = process.env): Promise<FileScanResult> {
  const config = readVirusTotalConfig(env);
  if (!config) {
    throw new VirusTotalAdapterError(
      "MALWARE_SCANNER_PROVIDER=virustotal is selected but VIRUSTOTAL_API_KEY is not configured. This is a " +
        "misconfiguration, not provider unavailability -- fix it rather than leaving documents stuck in quarantine.",
    );
  }

  if (!config.uploadFiles) return scanByHash(bytes, config);

  const trace: TransientTrace = { reason: null, retryAfterSeconds: null };
  const hint = (): ScanRetryHint => ({ reason: trace.reason ?? "provider_unavailable", retryAfterSeconds: trace.retryAfterSeconds });
  const analysisId = await submitFile(bytes, config, trace);
  if (!analysisId) {
    return { status: "scan_unavailable", detail: "VirusTotal file submission did not succeed after retrying transient failures.", retry: hint() };
  }

  const deadline = Date.now() + config.pollBudgetMs;
  for (;;) {
    const analysis = await fetchAnalysis(analysisId, config, trace);
    if (!analysis) {
      return { status: "scan_unavailable", detail: `VirusTotal analysis ${analysisId} lookup did not succeed after retrying transient failures.`, retry: hint() };
    }
    if (analysis.status === "completed") {
      const status = classifyVirusTotalStats(analysis.stats);
      return { status, detail: describeVirusTotalStats(analysisId, analysis.stats) };
    }
    if (Date.now() >= deadline) {
      return {
        status: "scan_unavailable",
        detail: `VirusTotal analysis ${analysisId} did not complete within the ${config.pollBudgetMs}ms poll budget (still "${analysis.status}").`,
        retry: { reason: "analysis_pending", retryAfterSeconds: null },
      };
    }
    await sleep(config.pollIntervalMs);
  }
}

export const virusTotalFileScanAdapter: FileScanAdapter = {
  name: "virustotal",
  scanFile: (bytes: Uint8Array) => scanFile(bytes),
};
