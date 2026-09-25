/**
 * Authenticated scan-provider callback verification (checkpoint 4,
 * claude/v1-launch-hardening) -- domain-agnostic, shared by every document
 * pipeline that will accept an asynchronous scan-result callback (today:
 * the policy-document quarantine gate; see lib/policies/quarantine/
 * store.ts's recordPolicyScanResult() for the document-level idempotency
 * this layers on top of).
 *
 * A callback is accepted only if ALL of the following hold, checked in
 * this order (cheapest/most decisive checks first):
 *   1. A provider-specific shared secret is configured at all (an
 *      unconfigured provider can never be verified "open" -- see
 *      requireCallbackSecret()).
 *   2. The request carries a timestamp header within a bounded age window
 *      (not too old -- a stale replay -- and not implausibly far in the
 *      future -- clock skew abuse).
 *   3. The HMAC-SHA256 signature over `${timestamp}.${rawBody}`, keyed by
 *      that provider's secret, matches the header-supplied signature,
 *      compared in constant time (crypto.timingSafeEqual, length-padded
 *      first -- see lib/auth/gate.ts's checkPassword() for the same
 *      pattern and its own comment on why).
 *   4. The (provider, eventId) pair has never been seen before -- recorded
 *      via a single INSERT into scan_provider_events, whose PRIMARY KEY
 *      does the uniqueness enforcement atomically; a 23505 unique-violation
 *      here IS the replay detection, not a side effect of it.
 *
 * Signature verification happens over the RAW body bytes, read before any
 * JSON parsing -- parsing and re-serializing first would let a
 * semantically-irrelevant formatting change (key order, whitespace) slip
 * past a signature computed by the provider over its own original bytes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { query } from "@/lib/db/client";

export const MAX_CALLBACK_AGE_SECONDS = 5 * 60;
export const MAX_CALLBACK_CLOCK_SKEW_SECONDS = 30;

export type CallbackVerificationFailureCode =
  | "PROVIDER_NOT_CONFIGURED" | "MISSING_TIMESTAMP" | "TIMESTAMP_TOO_OLD" | "TIMESTAMP_IN_FUTURE"
  | "MISSING_SIGNATURE" | "INVALID_SIGNATURE" | "MISSING_EVENT_ID" | "REPLAYED_EVENT";

export type CallbackVerificationResult =
  | { ok: true }
  | { ok: false; code: CallbackVerificationFailureCode; message: string };

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  const length = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(length);
  const paddedB = Buffer.alloc(length);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length;
}

/** Provider-specific shared secret, read from `SCAN_CALLBACK_SECRET_<PROVIDER>`
 * (e.g. SCAN_CALLBACK_SECRET_NULL for the "null" provider used by tests).
 * Returns null -- never throws -- so the caller can produce a uniform
 * "not configured" verification failure rather than a 500. */
export function callbackSecretForProvider(provider: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const key = `SCAN_CALLBACK_SECRET_${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  const value = env[key]?.trim();
  return value ? value : null;
}

export function computeCallbackSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Verifies signature + timestamp bounds only (steps 1-3 above) -- pure and
 * side-effect-free, safe to call as many times as needed (e.g. to produce
 * a sanitized rejection reason for telemetry) without consuming replay
 * protection. Call recordCallbackEventOnce() separately, and only once
 * verification has already passed, to actually consume the event id.
 */
export function verifyCallbackSignature(args: {
  provider: string; timestampHeader: string | null; signatureHeader: string | null; rawBody: string; env?: NodeJS.ProcessEnv;
}): CallbackVerificationResult {
  const secret = callbackSecretForProvider(args.provider, args.env);
  if (!secret) return { ok: false, code: "PROVIDER_NOT_CONFIGURED", message: `No callback secret configured for scan provider "${args.provider}".` };

  if (!args.timestampHeader) return { ok: false, code: "MISSING_TIMESTAMP", message: "Missing callback timestamp header." };
  const timestampSeconds = Number(args.timestampHeader);
  if (!Number.isFinite(timestampSeconds)) return { ok: false, code: "MISSING_TIMESTAMP", message: "Malformed callback timestamp header." };
  const nowSeconds = Date.now() / 1000;
  if (nowSeconds - timestampSeconds > MAX_CALLBACK_AGE_SECONDS) return { ok: false, code: "TIMESTAMP_TOO_OLD", message: "Callback timestamp is too old." };
  if (timestampSeconds - nowSeconds > MAX_CALLBACK_CLOCK_SKEW_SECONDS) return { ok: false, code: "TIMESTAMP_IN_FUTURE", message: "Callback timestamp is implausibly far in the future." };

  if (!args.signatureHeader) return { ok: false, code: "MISSING_SIGNATURE", message: "Missing callback signature header." };
  const expected = computeCallbackSignature(secret, args.timestampHeader, args.rawBody);
  if (!constantTimeEqual(expected, args.signatureHeader)) return { ok: false, code: "INVALID_SIGNATURE", message: "Callback signature does not match." };

  return { ok: true };
}

/** Consumes (provider, eventId) exactly once via a single atomic INSERT.
 * Returns false (never throws) on a replay -- the unique-violation on the
 * primary key IS the check, so there is no read-then-write race between
 * two concurrent deliveries of the same event. Call this ONLY after
 * verifyCallbackSignature() has already returned ok:true -- an
 * unauthenticated request must never be allowed to burn a real event id
 * out from under a later, genuine delivery of it. */
export async function recordCallbackEventOnce(provider: string, eventId: string): Promise<boolean> {
  try {
    await query(`INSERT INTO scan_provider_events(provider, event_id) VALUES($1,$2)`, [provider, eventId]);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "23505") return false;
    throw error;
  }
}

/** Full verification: signature/timestamp checks, THEN (only if those
 * passed) the atomic replay check. A single entry point so a route can
 * never accidentally call these out of order. */
export async function verifyAndConsumeCallback(args: {
  provider: string; eventId: string | null; timestampHeader: string | null; signatureHeader: string | null; rawBody: string; env?: NodeJS.ProcessEnv;
}): Promise<CallbackVerificationResult> {
  const signatureResult = verifyCallbackSignature(args);
  if (!signatureResult.ok) return signatureResult;
  if (!args.eventId) return { ok: false, code: "MISSING_EVENT_ID", message: "Missing callback event id." };
  const firstDelivery = await recordCallbackEventOnce(args.provider, args.eventId);
  if (!firstDelivery) return { ok: false, code: "REPLAYED_EVENT", message: "This callback event has already been processed." };
  return { ok: true };
}
