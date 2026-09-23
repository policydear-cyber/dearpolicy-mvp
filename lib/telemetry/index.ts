/**
 * Checkpoint 9 (claude/v1-launch-hardening): the central telemetry
 * boundary. recordEvent() is the ONE function every part of this codebase
 * (API routes, authentication, authorization failures, uploads, malware
 * scanning, extraction, OCR, embeddings, chat, claim evidence,
 * calculators, composition, lifecycle deletion, exports, durable jobs,
 * storage cleanup, model providers) is expected to call instead of
 * talking to a telemetry vendor directly -- there is exactly one adapter
 * boundary (lib/telemetry/adapters.ts's TelemetryAdapter interface) and
 * production code never reaches past it.
 *
 * Every event passed to recordEvent() is run through redactDeep()
 * (lib/telemetry/redact.ts) before it reaches the adapter -- a caller
 * cannot opt out of redaction, and cannot bypass it by nesting a sensitive
 * value somewhere unexpected (redactDeep() is recursive and depth-bounded
 * specifically so that isn't a hole). Sending is failure-isolated and
 * time-bounded: a slow or failing adapter can never make application code
 * fail or hang because it tried to record telemetry -- see
 * TELEMETRY_SEND_TIMEOUT_MS and the try/catch below.
 */
import { redactDeep } from "./redact";
import type { TelemetryAdapter } from "./adapters";
import { LocalConsoleTelemetryAdapter, NoopTelemetryAdapter } from "./adapters";
import type { SafeErrorCategory, TelemetryEvent } from "./types";
import { classifyError } from "./errors";
import { isProduction } from "@/lib/launch/guards";

export const TELEMETRY_SEND_TIMEOUT_MS = 2000;

function defaultAdapterForEnv(): TelemetryAdapter {
  // No real production adapter exists in this codebase yet (see
  // adapters.ts's doc comment) -- NoopTelemetryAdapter is the deliberate,
  // launch-guard-flagged default rather than a silent illusion of
  // coverage. Local/dev gets a visible console adapter so the boundary is
  // actually exercisable without a vendor.
  return isProduction() ? new NoopTelemetryAdapter() : new LocalConsoleTelemetryAdapter();
}

let currentAdapter: TelemetryAdapter = defaultAdapterForEnv();

/** Swaps the active adapter. Used by regression tests (a
 * CapturingTelemetryAdapter to assert against, a FailingTelemetryAdapter/
 * HangingTelemetryAdapter to prove failure isolation) and by application
 * bootstrap code IF a real production adapter is ever wired in -- never
 * called from a request-handling code path itself. */
export function setTelemetryAdapter(adapter: TelemetryAdapter): TelemetryAdapter {
  const previous = currentAdapter;
  currentAdapter = adapter;
  return previous;
}

export function getTelemetryAdapter(): TelemetryAdapter {
  return currentAdapter;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`telemetry adapter timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type RecordEventInput = Omit<TelemetryEvent, "timestamp">;

/** Records one structured operational event. Never throws, never rejects,
 * and never blocks its caller beyond TELEMETRY_SEND_TIMEOUT_MS -- a
 * failing or slow telemetry adapter must never be able to fail or delay
 * the actual operation being recorded. Every field is redacted before it
 * reaches the adapter, so it is safe to pass through values that MIGHT
 * contain something sensitive (an error object, a raw header bag) without
 * hand-scrubbing them at the call site first. */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  const event: TelemetryEvent = { timestamp: new Date().toISOString(), ...input };
  // correlationId, timestamp and name are carved out before redaction and
  // reattached after. correlationId/timestamp: see redact.ts's
  // redactString() doc comment for why a blanket "UUID-shaped strings are
  // safe" exemption inside the redactor itself would be a hole (it would
  // also let a raw household/resource id through if a caller ever put one
  // somewhere unexpected). name: it is always a short, code-defined
  // literal (e.g. "lifecycle.deletion.finished") chosen by the call site,
  // never user- or provider-derived data -- without this carve-out, a
  // sufficiently long dotted/underscored event name (>=20 chars) is
  // indistinguishable from an opaque token to LONG_TOKEN_PATTERN and gets
  // mangled into "[REDACTED:token]", corrupting the one field every
  // downstream alert/dashboard groups and matches on.
  // Checkpoint 14b: monetaryGateReason joins this carve-out for the exact
  // same reason as name -- it is always a short, closed-enum,
  // code-defined literal (lib/claims/monetary-gate.ts's
  // MonetaryBlockReason, e.g. "UNRESOLVED_COVERAGE_MAPPING", 28 chars),
  // never user- or model-derived text, and several of that enum's own
  // values are >=20 chars -- discovered because wiring real telemetry
  // into the calculator chokepoint (enforceMonetarySafety()) was the
  // first production call site to actually populate this field, and its
  // own regression suite (scripts/monetary-gate-regressions.ts) caught
  // "NO_DETERMINISTIC_AMOUNT"/"UNRESOLVED_COVERAGE_MAPPING"/
  // "MISSING_RULE_EVIDENCE" all silently becoming "[REDACTED:token]" to
  // LONG_TOKEN_PATTERN before this carve-out existed.
  const { correlationId, timestamp, name, monetaryGateReason, ...rest } = event;
  const redactedRest = redactDeep(rest) as Omit<TelemetryEvent, "correlationId" | "timestamp" | "name" | "monetaryGateReason">;
  const redacted: TelemetryEvent = { name, correlationId, timestamp, monetaryGateReason, ...redactedRest };
  try {
    await withTimeout(currentAdapter.send([redacted]), TELEMETRY_SEND_TIMEOUT_MS);
  } catch {
    // Failure isolation: telemetry must never be able to fail the caller.
    // Deliberately no rethrow, no unhandled rejection, no application
    // state mutated -- this function's contract is "best effort, always
    // resolves".
  }
}

/** Convenience wrapper for the extremely common "an operation failed,
 * record it" case -- classifies the error via lib/telemetry/errors.ts
 * (so the emitted errorCategory always comes from the shared taxonomy,
 * never a caller's own ad hoc string) and folds the classification into
 * the event before redaction. */
export async function recordErrorEvent(
  input: Omit<RecordEventInput, "errorCategory" | "httpStatus"> & { error: unknown },
): Promise<void> {
  const { error, ...rest } = input;
  const classified = classifyError(error);
  await recordEvent({
    ...rest,
    status: "failure",
    errorCategory: classified.category,
    httpStatus: classified.httpStatus,
    extra: { ...(rest.extra ?? {}), error },
  });
}

export type { SafeErrorCategory, TelemetryEvent };
export { classifyError } from "./errors";
export { redactDeep } from "./redact";
export { pseudonymizeId, isUsingInsecurePseudonymSecret } from "./pseudonymize";
export { resolveCorrelationId, isValidCorrelationId, CORRELATION_ID_HEADER } from "./correlation";
export type { TelemetryAdapter } from "./adapters";
export type { AlertCondition, AlertSeverity, AlertEvaluationContext, AlertEvaluationResult } from "./alerts";
export { ALERT_CONDITIONS, getAlertCondition, evaluateAllAlertConditions } from "./alerts";
