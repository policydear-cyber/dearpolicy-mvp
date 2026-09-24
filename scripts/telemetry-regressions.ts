/**
 * Regression suite for Checkpoint 9 (claude/v1-launch-hardening):
 * lib/telemetry/* -- the central telemetry boundary, recursive redaction,
 * correlation ids, pseudonymization, the safe error taxonomy, and adapter
 * failure isolation. Pure unit-level (no DB needed) except for the
 * middleware-wiring cases at the end, which import the real exported
 * middleware() the same way scripts/csrf-regressions.ts does, to prove
 * correlation-id propagation is reachable on a real request/response, not
 * just correct in isolation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { redactDeep, DEFAULT_MAX_DEPTH } from "../lib/telemetry/redact";
import { classifyError, CategorizedError } from "../lib/telemetry/errors";
import { resolveCorrelationId, isValidCorrelationId, CORRELATION_ID_HEADER } from "../lib/telemetry/correlation";
import { pseudonymizeId, isUsingInsecurePseudonymSecret } from "../lib/telemetry/pseudonymize";
import { recordEvent, recordErrorEvent, setTelemetryAdapter, getTelemetryAdapter, TELEMETRY_SEND_TIMEOUT_MS } from "../lib/telemetry/index";
import {
  CapturingTelemetryAdapter,
  FailingTelemetryAdapter,
  HangingTelemetryAdapter,
  NoopTelemetryAdapter,
} from "../lib/telemetry/adapters";
import { checkTelemetryProductionAdapterConfigured } from "../lib/launch/guards";
import { ALERT_CONDITIONS, evaluateAllAlertConditions, getAlertCondition } from "../lib/telemetry/alerts";
import type { TelemetryEvent } from "../lib/telemetry/types";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}
function test(name: string, fn: () => void) {
  try {
    fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

const AUTH_HEADER_VALUE = "Bearer sk-live-abcdefghijklmnopqrstuvwxyz0123456789";
const COOKIE_HEADER_VALUE = "dp_household=11111111-2222-3333-4444-555555555555; sb-access-token=abcdefghijklmnopqrstuvwxyz";
const SIGNED_URL = "https://storage.example.com/bucket/doc.pdf?X-Amz-Signature=deadbeefdeadbeefdeadbeef&token=verySecretToken1234567890";
const MEDICAL_TEXT = "Patient reports chest pain and was diagnosed with type 2 diabetes in 2019.";
const POLICY_TEXT = "Benefit clause 4.2: coverage excludes pre-existing conditions disclosed prior to the policy start date.";
const EMAIL = "alice@example.com";
const PROVIDER_API_KEY = "sk_live_51H8sJKabcdefghijklmnopqrstuvwxyz0123456789";

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

async function main() {
  // ============================================================
  // Recursive redaction
  // ============================================================

  test("redactDeep strips an authorization-named field by key alone, independent of the value looking like a token", () => {
    // Deliberately NOT Bearer/JWT-shaped and under the 20-char long-token
    // threshold, so the value-based patterns (BEARER_PATTERN, JWT_PATTERN,
    // LONG_TOKEN_PATTERN) cannot catch it -- this isolates the key-based
    // denylist (DENIED_KEY_SUBSTRINGS containing "authorization") as the
    // ONLY thing standing between this value and the adapter. A value-only
    // test (e.g. a Bearer-prefixed token) would pass even with the
    // key-based denylist entry deleted, silently hiding that regression.
    const shortBasicAuthValue = "Basic dXNlcjpwYXNz";
    const out = redactDeep({ authorizationHeader: shortBasicAuthValue, unrelatedField: "kept" }) as Record<string, unknown>;
    assert.notEqual(out.authorizationHeader, shortBasicAuthValue, "an authorization-named field must never pass its raw value through, key-based denial alone must catch it");
    assert.equal(out.unrelatedField, "kept", "an unrelated field must survive untouched");
  });

  test("redactDeep strips a top-level authorization header", () => {
    const out = redactDeep({ headers: { authorization: AUTH_HEADER_VALUE, "x-correlation-id": "abc12345" } });
    const json = serialized(out);
    assert.ok(!json.includes("sk-live-"), "the raw bearer token must never survive redaction");
    assert.ok(json.includes("REDACTED:headers"), "the whole headers bag must be dropped, not selectively scrubbed");
  });

  test("redactDeep strips cookies wholesale, including a nested session token", () => {
    const out = redactDeep({ request: { cookies: COOKIE_HEADER_VALUE } });
    const json = serialized(out);
    assert.ok(!json.includes("sb-access-token"), "cookie contents must never survive redaction");
  });

  test("redactDeep strips a signed URL's query string (the actual signature/token)", () => {
    const out = redactDeep({ documentUrl: SIGNED_URL });
    const json = serialized(out);
    assert.ok(!json.includes("X-Amz-Signature"), "a signed URL's query string must be stripped");
    assert.ok(!json.includes("verySecretToken"), "a signed URL's token parameter must be stripped");
    assert.ok(json.includes("https://storage.example.com/bucket/doc.pdf"), "the path itself is not sensitive and may survive");
  });

  test("redactDeep strips a signed URL's query string even when the signature is short/numeric and would not itself match a value pattern", () => {
    // A signature under the 20-char LONG_TOKEN_PATTERN floor and made only
    // of digits under the 9-digit LONG_DIGIT_RUN_PATTERN floor (here 6
    // digits) cannot be caught by any value-based pattern on its own --
    // this isolates stripQueryString() itself as the ONLY thing standing
    // between the query string and the adapter, the same way the
    // short-Basic-auth test isolates the key-based denylist above.
    const shortSignedUrl = "https://storage.example.com/bucket/doc.pdf?sig=482913&exp=999";
    const out = redactDeep({ documentUrl: shortSignedUrl }) as Record<string, unknown>;
    assert.notEqual(out.documentUrl, shortSignedUrl, "the query string must be stripped even when its values are too short to match a value-based pattern on their own");
    assert.ok(String(out.documentUrl).startsWith("https://storage.example.com/bucket/doc.pdf"), "the path itself is not sensitive and may survive");
  });

  test("redactDeep never emits medical facts or policy wording, however they're nested", () => {
    const out = redactDeep({
      evidence: { review: { medicalHistory: MEDICAL_TEXT, notes: { diagnosis: "type 2 diabetes" } } },
      policy: { clauses: [{ policyWording: POLICY_TEXT }] },
    });
    const json = serialized(out);
    assert.ok(!json.includes("chest pain"), "medical narrative text must never survive redaction");
    assert.ok(!json.includes("diabetes"), "a diagnosis value must never survive redaction");
    assert.ok(!json.includes("pre-existing conditions"), "policy wording text must never survive redaction");
  });

  test("redactDeep catches free text under a singular 'note' key, not just the plural 'notes'", () => {
    // Regression: GENERIC_TEXT_KEY_SUBSTRINGS previously listed "notes" but not "note", so a
    // key literally named "note" (a plausible real field on a claim/evidence review object) never
    // matched isGenericLongTextKey(), and free text placed under it survived redaction unredacted.
    const out = redactDeep({
      claim: { assessment: { details: { note: MEDICAL_TEXT } } },
    });
    const json = serialized(out);
    assert.ok(!json.includes("chest pain"), "medical narrative under a singular 'note' key must never survive redaction");
    assert.ok(!json.includes("diabetes"), "a diagnosis mentioned in a 'note' field must never survive redaction");
  });

  test("redactDeep scrubs emails, provider API keys, and long digit runs wherever they appear, regardless of key name", () => {
    const out = redactDeep({ metadata: { contact: EMAIL, config: { key: PROVIDER_API_KEY }, note: "id 987654321" } });
    const json = serialized(out);
    assert.ok(!json.includes(EMAIL), "a raw email must never survive redaction, even under a generic key name");
    assert.ok(!json.includes(PROVIDER_API_KEY), "a provider API key-shaped value must never survive redaction");
    assert.ok(!json.includes("987654321"), "a long digit run (SSN/NRIC/passport-shaped) must never survive redaction");
  });

  test("redactDeep handles arrays, and does not choke on or leak through a circular structure", () => {
    type Node = { name: string; self?: Node; children: unknown[] };
    const node: Node = { name: "root", children: [] };
    node.self = node;
    node.children = [{ token: "leaked-if-not-redacted-1234567890" }, node];
    const out = redactDeep(node) as Record<string, unknown>;
    assert.equal(out.name, "root");
    assert.ok(Array.isArray(out.children));
    const json = serialized(out);
    assert.ok(json.includes("REDACTED:circular"), "a circular reference must be detected and replaced, not looped forever");
    assert.ok(!json.includes("leaked-if-not-redacted"), "an array element's sensitive value must still be redacted");
  });

  test("redactDeep redacts an Error's message via the safe taxonomy and recurses through its cause chain", () => {
    const root = new Error(`Connection failed: password=hunter2 host=db.internal user=${EMAIL}`);
    const wrapped = new Error("Extraction failed", { cause: root });
    const out = redactDeep(wrapped) as Record<string, unknown>;
    const json = serialized(out);
    assert.ok(!json.includes("hunter2"), "a raw error message must never survive redaction");
    assert.ok(!json.includes(EMAIL), "an email embedded in a nested cause's message must never survive redaction");
    assert.equal(out.errorCategory, "internal_unknown");
    assert.ok(typeof out.safeMessage === "string" && out.safeMessage.length > 0);
    const cause = out.cause as Record<string, unknown>;
    assert.ok(cause, "the cause chain must be preserved (redacted), not dropped");
  });

  test("redactDeep bounds recursion depth rather than passing deeply-nested content through unredacted", () => {
    let deep: Record<string, unknown> = { token: "should-be-redacted-1234567890" };
    for (let i = 0; i < DEFAULT_MAX_DEPTH + 5; i++) deep = { child: deep };
    const out = redactDeep(deep);
    const json = serialized(out);
    assert.ok(!json.includes("should-be-redacted"), "content past the depth cap must be replaced, never passed through as-is");
    assert.ok(json.includes("REDACTED:max-depth"), "the depth cap must be visible in the output, not silently truncated");
  });

  // ============================================================
  // Safe error taxonomy
  // ============================================================

  test("classifyError never leaks an unrecognized error's raw message", () => {
    const secretish = new Error("password authentication failed for user \"postgres\" at 10.0.4.12:5432");
    const classified = classifyError(secretish);
    assert.equal(classified.category, "internal_unknown");
    assert.ok(!classified.safeMessage.includes("10.0.4.12"), "classifyError's safe message must never include raw internal detail");
    assert.ok(!classified.safeMessage.includes("postgres"));
  });

  test("classifyError recognizes this codebase's own domain error classes by constructor name", () => {
    class ForbiddenError extends Error {}
    class NotFoundError extends Error {}
    assert.equal(classifyError(new ForbiddenError("x")).category, "authorization");
    assert.equal(classifyError(new NotFoundError("x")).category, "validation");
  });

  test("CategorizedError carries its own explicit category through classifyError", () => {
    const err = new CategorizedError("model_provider", "The model provider timed out.", 504);
    const classified = classifyError(err);
    assert.equal(classified.category, "model_provider");
    assert.equal(classified.httpStatus, 504);
  });

  // ============================================================
  // Correlation ids
  // ============================================================

  test("resolveCorrelationId accepts a well-formed incoming id unchanged", () => {
    const id = "abc12345-DEF-678";
    assert.equal(resolveCorrelationId(id), id);
    assert.ok(isValidCorrelationId(id));
  });

  test("resolveCorrelationId rejects malformed/oversized/missing ids and generates a fresh one instead", () => {
    const tooShort = resolveCorrelationId("abc");
    assert.notEqual(tooShort, "abc");
    assert.ok(isValidCorrelationId(tooShort));

    const withInjection = resolveCorrelationId("abc\r\nX-Evil: 1");
    assert.ok(isValidCorrelationId(withInjection), "a header-injection attempt must never be passed through as the correlation id");

    const tooLong = resolveCorrelationId("a".repeat(200));
    assert.ok(isValidCorrelationId(tooLong));

    const missing = resolveCorrelationId(null);
    assert.ok(isValidCorrelationId(missing));

    assert.notEqual(tooShort, missing, "each independently-generated fallback id must be its own random value");
  });

  // ============================================================
  // Pseudonymization
  // ============================================================

  test("pseudonymizeId is stable for the same id and secret, and never returns the raw id", () => {
    const rawId = randomUUID();
    const env = { TELEMETRY_PSEUDONYM_SECRET: "test-secret-one" } as NodeJS.ProcessEnv;
    const first = pseudonymizeId(rawId, env);
    const second = pseudonymizeId(rawId, env);
    assert.equal(first, second, "the same id must pseudonymize to the same value within one environment/secret");
    assert.notEqual(first, rawId);
    assert.equal(pseudonymizeId(null, env), null);
  });

  test("pseudonymizeId produces different pseudonyms for the same id under different secrets", () => {
    const rawId = randomUUID();
    const a = pseudonymizeId(rawId, { TELEMETRY_PSEUDONYM_SECRET: "secret-a" } as NodeJS.ProcessEnv);
    const b = pseudonymizeId(rawId, { TELEMETRY_PSEUDONYM_SECRET: "secret-b" } as NodeJS.ProcessEnv);
    assert.notEqual(a, b, "two different secrets must never produce the same pseudonym for the same underlying id");
  });

  test("isUsingInsecurePseudonymSecret reports true only when unconfigured", () => {
    assert.equal(isUsingInsecurePseudonymSecret({} as NodeJS.ProcessEnv), true);
    assert.equal(isUsingInsecurePseudonymSecret({ TELEMETRY_PSEUDONYM_SECRET: "real-secret" } as NodeJS.ProcessEnv), false);
  });

  // ============================================================
  // recordEvent()/recordErrorEvent(): failure isolation, timeout, and that
  // no raw identifier reaches the adapter
  // ============================================================

  const originalAdapter = getTelemetryAdapter();
  try {
    await testAsync("recordEvent delivers a redacted event to the active adapter, with no raw identifier surviving", async () => {
      const capturing = new CapturingTelemetryAdapter();
      setTelemetryAdapter(capturing);
      const rawHouseholdId = randomUUID();
      await recordEvent({
        name: "route.request",
        correlationId: "abc12345",
        route: "/api/household",
        status: "success",
        extra: { authorization: AUTH_HEADER_VALUE, householdIdForDebugging: rawHouseholdId },
      });
      assert.equal(capturing.events.length, 1);
      const json = serialized(capturing.events[0]);
      assert.ok(!json.includes(rawHouseholdId), "a raw household id must never reach the adapter, even if a caller carelessly includes it");
      assert.ok(!json.includes("sk-live-"));
    });

    await testAsync("recordEvent never throws and never hangs when the adapter fails", async () => {
      setTelemetryAdapter(new FailingTelemetryAdapter());
      const start = Date.now();
      await recordEvent({ name: "job.failed", correlationId: "abc12345", status: "failure" });
      assert.ok(Date.now() - start < TELEMETRY_SEND_TIMEOUT_MS + 500, "a failing adapter must resolve quickly, not hang the caller");
    });

    await testAsync("recordEvent is bounded by TELEMETRY_SEND_TIMEOUT_MS even when the adapter never resolves", async () => {
      setTelemetryAdapter(new HangingTelemetryAdapter());
      const start = Date.now();
      await recordEvent({ name: "job.claimed", correlationId: "abc12345", status: "in_progress" });
      const elapsed = Date.now() - start;
      assert.ok(elapsed < TELEMETRY_SEND_TIMEOUT_MS + 1000, `a hanging adapter must be bounded by the timeout, took ${elapsed}ms`);
    });

    await testAsync("recordErrorEvent classifies the error via the shared taxonomy and never leaks its raw message", async () => {
      const capturing = new CapturingTelemetryAdapter();
      setTelemetryAdapter(capturing);
      await recordErrorEvent({
        name: "route.error",
        correlationId: "abc12345",
        route: "/api/household",
        error: new Error("password authentication failed for user \"postgres\""),
      });
      assert.equal(capturing.events.length, 1);
      const event = capturing.events[0];
      assert.equal(event.errorCategory, "internal_unknown");
      assert.equal(event.status, "failure");
      const json = serialized(event);
      assert.ok(!json.includes("postgres"), "the raw error message must never reach the adapter");
    });
  } finally {
    setTelemetryAdapter(originalAdapter);
  }

  test("NoopTelemetryAdapter is the default in production; production launch guard flags it as unconfigured", () => {
    const noop = new NoopTelemetryAdapter();
    assert.equal(noop.name, "noop");
    const result = checkTelemetryProductionAdapterConfigured({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    assert.equal(result.ok, false, "production with no TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED flag must fail this guard");
    const configured = checkTelemetryProductionAdapterConfigured({
      NODE_ENV: "production",
      TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: "true",
    } as NodeJS.ProcessEnv);
    assert.equal(configured.ok, true);
    const nonProd = checkTelemetryProductionAdapterConfigured({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
    assert.equal(nonProd.ok, true, "the guard must be a no-op outside production");
  });

  await testAsync("recordEvent preserves a long, code-defined event name intact instead of mangling it as an opaque token", async () => {
    const capturing = new CapturingTelemetryAdapter();
    setTelemetryAdapter(capturing);
    await recordEvent({ name: "lifecycle.deletion.household_closure_started", correlationId: randomUUID(), status: "in_progress" });
    const sent = capturing.events[capturing.events.length - 1];
    assert.equal(
      sent.name,
      "lifecycle.deletion.household_closure_started",
      "a >=20-char underscored event name must not be caught by LONG_TOKEN_PATTERN and rewritten to [REDACTED:token]",
    );
  });

  // ============================================================
  // Alert conditions (lib/telemetry/alerts.ts)
  // ============================================================

  test("every required alert category has exactly one defined condition with a severity and operational response", () => {
    const requiredIds = [
      "auth_attack_spike",
      "cross_household_access_attempt",
      "rate_limit_spike",
      "upload_scan_failure_rate",
      "processing_backlog",
      "dead_letter_growth",
      "extraction_failure_rate",
      "evidence_review_backlog",
      "monetary_result_anomaly",
      "model_fallback_rate",
      "db_storage_latency",
      "calculation_engine_version_mismatch",
      "deletion_cleanup_failure",
    ];
    for (const id of requiredIds) {
      const condition = getAlertCondition(id);
      assert.ok(condition, `missing alert condition for required category: ${id}`);
      assert.ok(condition!.operationalResponse.length > 0);
      assert.ok(["critical", "high", "medium", "low"].includes(condition!.severity));
    }
    assert.equal(ALERT_CONDITIONS.length, requiredIds.length, "no unexpected extra or missing conditions");
  });

  function fakeEvent(overrides: Partial<TelemetryEvent>): TelemetryEvent {
    return { name: "test.event", correlationId: randomUUID(), timestamp: new Date().toISOString(), ...overrides };
  }

  test("auth_attack_spike fires once authentication failures cross the threshold in the window, not before", () => {
    const condition = getAlertCondition("auth_attack_spike")!;
    const now = Date.now();
    const below = Array.from({ length: 19 }, () => fakeEvent({ errorCategory: "authentication", status: "failure", timestamp: new Date(now).toISOString() }));
    assert.equal(condition.evaluate(below, { nowMs: now }).fired, false);
    const atThreshold = Array.from({ length: 20 }, () => fakeEvent({ errorCategory: "authentication", status: "failure", timestamp: new Date(now).toISOString() }));
    assert.equal(condition.evaluate(atThreshold, { nowMs: now }).fired, true);
  });

  test("auth_attack_spike ignores events outside the 5-minute window", () => {
    const condition = getAlertCondition("auth_attack_spike")!;
    const now = Date.now();
    const stale = Array.from({ length: 50 }, () =>
      fakeEvent({ errorCategory: "authentication", status: "failure", timestamp: new Date(now - 10 * 60 * 1000).toISOString() }),
    );
    assert.equal(condition.evaluate(stale, { nowMs: now }).fired, false, "events 10 minutes old must not count toward a 5-minute window");
  });

  test("cross_household_access_attempt fires on a single occurrence (zero-tolerance category)", () => {
    const condition = getAlertCondition("cross_household_access_attempt")!;
    const now = Date.now();
    const events = [fakeEvent({ errorCategory: "authorization", timestamp: new Date(now).toISOString(), extra: { crossHousehold: true } })];
    assert.equal(condition.evaluate(events, { nowMs: now }).fired, true);
    const ordinaryAuthzFailure = [fakeEvent({ errorCategory: "authorization", timestamp: new Date(now).toISOString(), extra: { crossHousehold: false } })];
    assert.equal(condition.evaluate(ordinaryAuthzFailure, { nowMs: now }).fired, false, "an ordinary (same-household) authorization failure must not fire this zero-tolerance condition");
  });

  test("monetary_result_anomaly fires on any gate-bypass event and ignores ordinary gated results", () => {
    const condition = getAlertCondition("monetary_result_anomaly")!;
    const now = Date.now();
    const bypassed = [fakeEvent({ name: "calculation.gated", monetaryGateReason: "gate_bypassed", timestamp: new Date(now).toISOString() })];
    assert.equal(condition.evaluate(bypassed, { nowMs: now }).fired, true);
    const ordinary = [fakeEvent({ name: "calculation.completed", monetaryGateReason: "verified", timestamp: new Date(now).toISOString() })];
    assert.equal(condition.evaluate(ordinary, { nowMs: now }).fired, false);
  });

  test("calculation_engine_version_mismatch fires when engineVersion is missing on a completed calculation", () => {
    const condition = getAlertCondition("calculation_engine_version_mismatch")!;
    const now = Date.now();
    const missing = [fakeEvent({ name: "calculation.completed", engineVersion: null, timestamp: new Date(now).toISOString() })];
    assert.equal(condition.evaluate(missing, { nowMs: now }).fired, true);
    const present = [fakeEvent({ name: "calculation.completed", engineVersion: "v3", timestamp: new Date(now).toISOString() })];
    assert.equal(condition.evaluate(present, { nowMs: now }).fired, false);
  });

  test("evaluateAllAlertConditions returns only the conditions that actually fired, each with its own detail", () => {
    const now = Date.now();
    const events = [fakeEvent({ errorCategory: "authorization", timestamp: new Date(now).toISOString(), extra: { crossHousehold: true } })];
    const fired = evaluateAllAlertConditions(events, { nowMs: now });
    assert.ok(fired.some((f) => f.condition.id === "cross_household_access_attempt"));
    assert.ok(!fired.some((f) => f.condition.id === "auth_attack_spike"), "an unrelated condition must not fire off unrelated events");
    for (const f of fired) assert.ok(f.result.detail.length > 0);
  });

  test("alert thresholds are overridable via context.thresholds without changing the condition definition", () => {
    const condition = getAlertCondition("dead_letter_growth")!;
    const now = Date.now();
    const events = Array.from({ length: 3 }, () => fakeEvent({ name: "job.dead_letter", timestamp: new Date(now).toISOString() }));
    assert.equal(condition.evaluate(events, { nowMs: now }).fired, false, "3 events must not fire the default threshold of 10");
    assert.equal(condition.evaluate(events, { nowMs: now, thresholds: { dead_letter_growth: 2 } }).fired, true, "a lowered threshold must fire on the same 3 events");
  });

  // ============================================================
  // Middleware wiring: correlation id propagation on a real request
  // ============================================================

  const { middleware } = await import("../middleware");

  await testAsync("middleware() returns a valid correlation id header even when none was supplied", async () => {
    const request = new NextRequest("http://localhost/api/health", { method: "GET" });
    const response = await middleware(request);
    const id = response.headers.get(CORRELATION_ID_HEADER);
    assert.ok(id && isValidCorrelationId(id), "every response must carry a valid correlation id");
  });

  await testAsync("middleware() echoes back a well-formed incoming correlation id unchanged", async () => {
    const suppliedId = "caller-supplied-id-123";
    const request = new NextRequest("http://localhost/api/health", {
      method: "GET",
      headers: { [CORRELATION_ID_HEADER]: suppliedId },
    });
    const response = await middleware(request);
    assert.equal(response.headers.get(CORRELATION_ID_HEADER), suppliedId);
  });

  await testAsync("middleware() replaces a malformed incoming correlation id rather than reflecting it back", async () => {
    const request = new NextRequest("http://localhost/api/health", {
      method: "GET",
      headers: { [CORRELATION_ID_HEADER]: "bad id with spaces" },
    });
    const response = await middleware(request);
    const id = response.headers.get(CORRELATION_ID_HEADER);
    assert.ok(id && isValidCorrelationId(id) && id !== "bad id with spaces");
  });

  console.log(
    `telemetry regressions passed: ${cases} cases (recursive redaction of headers/cookies/signed-URLs/medical & policy text/emails/provider ` +
      `keys/digit-runs, circular-structure & depth-bounded handling, error cause-chain redaction, safe error taxonomy, correlation id accept/` +
      `reject/generate, pseudonym stability & secret-sensitivity, adapter failure isolation & timeout, production adapter launch guard, machine-` +
      `readable alert conditions for all 13 required categories with overridable thresholds, and real middleware() correlation-id wiring).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
