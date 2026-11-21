/** Scripted tests for what an error report to Sentry may contain (lib/telemetry/sentry-scrub.ts, sentry.ts). Made-up
 * names and numbers; no network. The reports carry a household's private details on purpose, and every one must be gone.
 *   npm run telemetry:sentry-test */
import assert from "node:assert/strict";
import { routeOnly, scrubSentryEvent } from "@/lib/telemetry/sentry-scrub";
import { sentryEnabled } from "@/lib/telemetry/sentry";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.stack : String(e)}`); } }

const SECRETS = ["Lim Ah Kow", "S$250,000", "ahkow@example.com", "POL-8841-22", "session=abc123", "Bearer tok", "4111111111111111"];
const dirty = {
  event_id: "e1", timestamp: 1, platform: "node", level: "error", release: "abc", environment: "production",
  message: "failed for Lim Ah Kow ahkow@example.com",
  exception: { values: [{ type: "SyntaxError", value: "Unexpected token in 'Lim Ah Kow sum insured S$250,000 policy POL-8841-22'",
    mechanism: { type: "auto", handled: false },
    stacktrace: { frames: [{ filename: "/var/task/lib/chat/answer.ts?x=Lim Ah Kow", function: "parse", lineno: 10, colno: 2, in_app: true,
      vars: { name: "Lim Ah Kow" }, context_line: "const n = 'S$250,000'", pre_context: ["a"], post_context: ["b"] }] } }] },
  request: { method: "POST", url: "https://dearpolicy.com/api/policies/6f1c2a9e-1b2c-4d3e-8f90-123456789abc/reprocess?email=ahkow@example.com",
    headers: { cookie: "session=abc123", authorization: "Bearer tok" }, cookies: { session: "abc123" }, data: { card: "4111111111111111" }, query_string: "email=ahkow@example.com" },
  user: { email: "ahkow@example.com", id: "u1", ip_address: "1.2.3.4" }, extra: { policy: "POL-8841-22" }, breadcrumbs: [{ message: "Lim Ah Kow" }],
  contexts: { runtime: { name: "node", version: "22" }, device: { name: "Lim Ah Kow's laptop" } }, tags: { route: "/api/policies/123456/reprocess", other: "Lim Ah Kow" }, server_name: "Lim Ah Kow",
  transaction: "POST /api/policies/6f1c2a9e-1b2c-4d3e-8f90-123456789abc",
};

test("no private detail survives anywhere in the report", () => {
  const out = JSON.stringify(scrubSentryEvent(dirty as never));
  for (const s of SECRETS) assert.ok(!out.includes(s), `leaked: ${s}`);
  for (const k of ["headers", "cookies", "query_string", "\"data\"", "\"user\"", "\"extra\"", "breadcrumbs", "vars", "context_line", "message\"", "server_name"]) assert.ok(!out.includes(k), `kept: ${k}`);
});
test("what is useful for fixing it is kept: error type, stack location, route without ids, method, runtime", () => {
  const out = scrubSentryEvent(dirty as never)!;
  assert.equal(out.exception!.values![0].type, "SyntaxError");
  assert.match(out.exception!.values![0].value!, /^SyntaxError \(/);
  const frame = out.exception!.values![0].stacktrace!.frames![0];
  assert.deepEqual([frame.function, frame.lineno, frame.colno, frame.in_app], ["parse", 10, 2, true]);
  assert.equal(frame.filename, "/var/task/lib/chat/answer.ts");
  assert.deepEqual(out.request, { method: "POST", url: "/api/policies/:id/reprocess" });
  assert.equal(out.contexts!.runtime!.name, "node");
  assert.equal(out.tags!.route, "/api/policies/:id/reprocess");
  assert.equal(out.release, "abc");
});
test("an unrecognised field the SDK adds later is dropped (allowlist, not blocklist)", () => {
  const out = JSON.stringify(scrubSentryEvent({ ...dirty, brand_new_field: { name: "Lim Ah Kow" }, sdkMetadata: "x" } as never));
  assert.ok(!out.includes("brand_new_field") && !out.includes("Lim Ah Kow"));
});
test("a report with no exception (a message or transaction) is not sent", () => {
  assert.equal(scrubSentryEvent({ message: "Lim Ah Kow", event_id: "e" } as never), null);
});
test("routeOnly drops host, query, fragment and ids", () => {
  assert.equal(routeOnly("https://x.test/a/12345/b?c=1#d"), "/a/:id/b");
  assert.equal(routeOnly("/api/x/AbCdEfGhIjKlMnOpQrStUvWx"), "/api/x/:id");
  assert.equal(routeOnly(""), undefined);
});
test("Sentry is off without a DSN and outside production", () => {
  assert.equal(sentryEnabled({ NODE_ENV: "production" } as never), false);
  assert.equal(sentryEnabled({ SENTRY_DSN: "https://k@o.ingest.sentry.io/1", NODE_ENV: "development" } as never), false);
  assert.equal(sentryEnabled({ SENTRY_DSN: " ", NODE_ENV: "production" } as never), false);
  assert.equal(sentryEnabled({ SENTRY_DSN: "https://k@o.ingest.sentry.io/1", NODE_ENV: "production" } as never), true);
});

if (failures.length) { console.error(failures.join("\n\n")); console.error(`\n${failures.length} failed, ${passed} passed`); process.exit(1); }
console.log(`${passed} passed`);
