/**
 * Regression suite for lib/http/csrf.ts's checkRequestOrigin() (unit-level,
 * against plain Request/NextRequest-shaped objects -- no DB needed) and for
 * middleware.ts's wiring of it (calling the real exported `middleware()`
 * function against constructed NextRequest objects, proving the check is
 * actually reachable on a real request, not just correct in isolation).
 *
 * Before choosing the Origin/Referer approach (see lib/http/csrf.ts's own
 * header comment for why, over a synchronizer token), this codebase's
 * app/api/**\/route.ts files were checked for any non-browser caller that
 * would lack an Origin/Referer header on a real, legitimate request (a
 * webhook receiver, a server-to-server callback): `grep -rl "webhook"
 * app/api/` returns nothing, and every state-changing route requires a
 * browser-set session cookie via requireHouseholdContext()/
 * requireCurrentUser() or is itself a browser-facing auth form endpoint
 * (login/signup/signin/reset-password/invitations) -- there is no
 * documented caller this check would legitimately break.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { checkRequestOrigin } from "../lib/http/csrf";

const APP_ORIGIN = "https://app.dearpolicy.example";

function req(method: string, headers: Record<string, string> = {}) {
  return { method, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } };
}

async function main() {
  // ============================================================
  // Unit-level: checkRequestOrigin()
  // ============================================================

  // Non-state-changing methods are never checked, regardless of headers.
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const result = checkRequestOrigin(req(method, { origin: "https://evil.example" }), APP_ORIGIN);
    assert.deepEqual(result, { allowed: true }, `${method} must never be blocked by the CSRF check`);
  }

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    // matching Origin: allowed
    const ok = checkRequestOrigin(req(method, { origin: APP_ORIGIN }), APP_ORIGIN);
    assert.deepEqual(ok, { allowed: true }, `${method} with a matching Origin must be allowed`);

    // cross-origin Origin: blocked
    const blocked = checkRequestOrigin(req(method, { origin: "https://evil.example" }), APP_ORIGIN);
    assert.deepEqual(blocked, { allowed: false, reason: "cross_origin" }, `${method} with a mismatched Origin must be blocked`);

    // neither header: blocked (fails CLOSED -- the opposite of db-rate-limit.ts's fail-open choice)
    const missing = checkRequestOrigin(req(method), APP_ORIGIN);
    assert.deepEqual(missing, { allowed: false, reason: "missing_origin" }, `${method} with neither Origin nor Referer must be blocked`);
  }

  // Referer fallback, only consulted when Origin is absent
  const refererOk = checkRequestOrigin(req("POST", { referer: `${APP_ORIGIN}/policies` }), APP_ORIGIN);
  assert.deepEqual(refererOk, { allowed: true }, "a matching Referer must be accepted when Origin is absent");

  const refererCross = checkRequestOrigin(req("POST", { referer: "https://evil.example/steal" }), APP_ORIGIN);
  assert.deepEqual(refererCross, { allowed: false, reason: "cross_origin" }, "a cross-origin Referer must be blocked when Origin is absent");

  // Origin takes priority even when Referer would have matched -- an
  // attacker cannot use a benign Referer to smuggle past a forged Origin.
  const originWins = checkRequestOrigin(req("POST", { origin: "https://evil.example", referer: `${APP_ORIGIN}/policies` }), APP_ORIGIN);
  assert.deepEqual(originWins, { allowed: false, reason: "cross_origin" }, "Origin must be checked even when a matching Referer is also present");

  // The literal string "null" (sandboxed iframe / cross-origin redirect) must never match a real origin.
  const nullOrigin = checkRequestOrigin(req("POST", { origin: "null" }), APP_ORIGIN);
  assert.deepEqual(nullOrigin, { allowed: false, reason: "cross_origin" }, '"null" Origin must be rejected, not throw or be treated as missing');

  // A different port on the same host is a different origin.
  const differentPort = checkRequestOrigin(req("POST", { origin: "https://app.dearpolicy.example:8443" }), APP_ORIGIN);
  assert.equal(differentPort.allowed, false, "a different port must count as cross-origin");

  // A malformed Origin value must be rejected safely, not throw.
  assert.doesNotThrow(() => checkRequestOrigin(req("POST", { origin: "not a url" }), APP_ORIGIN));
  const malformed = checkRequestOrigin(req("POST", { origin: "not a url" }), APP_ORIGIN);
  assert.equal(malformed.allowed, false, "a malformed Origin header must be rejected, not accidentally allowed");

  // Method comparison is case-insensitive (defensive -- Next.js normalizes this already).
  const lowerMethod = checkRequestOrigin(req("post", { origin: "https://evil.example" }), APP_ORIGIN);
  assert.equal(lowerMethod.allowed, false, "method comparison must not be defeated by unexpected casing");

  console.log("checkRequestOrigin() unit regressions passed.");

  // ============================================================
  // Middleware-level: prove the real exported middleware() actually
  // enforces this on a real request, not just that the pure function is
  // correct in isolation.
  // ============================================================
  const { middleware } = await import("../middleware");

  const crossOriginPost = new NextRequest("http://localhost/api/household/invitations", {
    method: "POST",
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com" }),
  });
  const blockedResponse = await middleware(crossOriginPost);
  assert.equal(blockedResponse.status, 403, "middleware() must return 403 for a cross-origin POST to an API route");
  const blockedBody = await blockedResponse.json();
  assert.equal(blockedBody.error, "Cross-origin request blocked");

  const sameOriginPost = new NextRequest("http://localhost/api/household/invitations", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com" }),
  });
  const passedResponse = await middleware(sameOriginPost);
  // No session cookie is set here, so this specific route's own auth gate
  // rejects it next (401) -- what matters for THIS suite is that it is NOT
  // the CSRF check's 403, proving the request passed the Origin check and
  // reached the normal auth logic beneath it.
  assert.notEqual(passedResponse.status, 403, "a same-origin POST must not be blocked by the CSRF check");

  const crossOriginGet = new NextRequest("http://localhost/api/health", {
    method: "GET",
    headers: { origin: "https://evil.example" },
  });
  const getResponse = await middleware(crossOriginGet);
  assert.notEqual(getResponse.status, 403, "GET requests must never be blocked by the CSRF check, even cross-origin");

  // The one explicit exemption (checkpoint 4): a real scan-provider
  // callback carries no Origin/Referer at all and must not be blocked by
  // this check -- but the exemption must be scoped to EXACTLY that path,
  // never a prefix match that could be abused.
  const callbackNoOrigin = new NextRequest("http://localhost/api/policies/scan-callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: "evt-1" }),
  });
  const callbackResponse = await middleware(callbackNoOrigin);
  assert.notEqual(callbackResponse.status, 403, "the scan-callback route must not be blocked by the CSRF check even with no Origin header");

  const notActuallyExempt = new NextRequest("http://localhost/api/policies/scan-callback-evil", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const notExemptResponse = await middleware(notActuallyExempt);
  assert.equal(notExemptResponse.status, 403, "a similarly-named path must NOT be swept into the exemption by a prefix match");

  // The Vercel Cron job runner authenticates itself with CRON_SECRET, so it
  // is exempt from the session requirement -- for exactly that path only.
  const jobRunner = await middleware(new NextRequest("http://localhost/api/internal/jobs/run", { method: "GET" }));
  assert.notEqual(jobRunner.status, 401, "the cron job runner must reach its own CRON_SECRET check, not the session gate");
  assert.notEqual(jobRunner.status, 403, "the cron job runner must not be blocked by the CSRF check");
  const jobRunnerLookalike = await middleware(new NextRequest("http://localhost/api/internal/jobs/run-evil", { method: "GET" }));
  assert.equal(jobRunnerLookalike.status, 401, "a similarly-named path must NOT inherit the job runner's session exemption");

  console.log("middleware() CSRF-wiring regressions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
