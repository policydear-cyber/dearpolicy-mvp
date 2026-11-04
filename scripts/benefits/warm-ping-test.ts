/**
 * The Benefits keep-awake ping (lib/http/warm-ping.ts). Signed out, exactly GET /api/benefits?warm=1 reaches the route,
 * which answers an empty 204 before reading any session or household. Every other signed-out request to the route, and
 * the same query on any other API path, is still refused by middleware.ts. PGlite, no network, no model.
 *   npm run benefits:warm-ping-test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { installDatabase } from "../r6/fixture";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY|SUPABASE|DEV_AUTH/i.test(k)) delete process.env[k];
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("no network in this test"); }) as typeof fetch;
const at = (path: string, method = "GET") => new NextRequest("http://localhost" + path, { method });

test("signed out, middleware lets through exactly GET or HEAD /api/benefits?warm=1 and nothing else", async () => {
  const { middleware } = await import("../../middleware");
  for (const m of ["GET", "HEAD"]) assert.notEqual((await middleware(at("/api/benefits?warm=1", m))).status, 401, m);
  for (const [path, method] of [
    ["/api/benefits", "GET"], ["/api/benefits?warm=1&familyMemberId=76000000-0000-4000-8000-000000000001", "GET"],
    ["/api/benefits?familyMemberId=x&warm=1", "GET"], ["/api/benefits?warm=2", "GET"], ["/api/benefits?Warm=1", "GET"],
    ["/api/benefits?warm=1&warm=1", "GET"], ["/api/benefits?warm=1%26familyMemberId%3Dx", "GET"], ["/api/benefits/?warm=1", "GET"],
    ["/api/benefits/x?warm=1", "GET"], ["/api/dashboard?warm=1", "GET"], ["/api/policies?warm=1", "GET"], ["/api/chat?warm=1", "GET"],
    ["/api/benefits?warm=1", "POST"], ["/api/benefits?warm=1", "DELETE"],
  ] as const) {
    const res = await middleware(at(path, method));
    assert.ok(res.status === 401 || res.status === 403 || res.status === 307, `${method} ${path} must stay closed, got ${res.status}`);
  }
});

test("the route answers the ping with an empty 204 before any sign-in, and anything else still needs one", async () => {
  await installDatabase();
  const { GET } = await import("../../app/api/benefits/route");
  const ping = await GET(at("/api/benefits?warm=1"));
  assert.equal(ping.status, 204);
  assert.equal(await ping.text(), "");
  assert.match(ping.headers.get("cache-control") ?? "", /no-store/);
  for (const path of ["/api/benefits", "/api/benefits?warm=1&familyMemberId=76000000-0000-4000-8000-000000000001", "/api/benefits?warm=true"]) {
    // Here sign-in is not configured, so the route's own sign-in step refuses (401, or 500 for the missing setup).
    const res = await GET(at(path));
    assert.ok(res.status >= 400, `${path} must be refused, got ${res.status}`);
    assert.doesNotMatch(await res.text(), /"benefits"/);
  }
  assert.equal(fetches, 0);
});

test("the ping is decided before the route reads a session or household", async () => {
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/benefits/route.ts", "utf8");
  const body = route.slice(route.indexOf("export async function GET("));
  const line = 'if(isWarmPing(request))return limitOpenEndpoint(request,"warm")??warmPing();';
  assert.ok(body.indexOf(line) > 0);
  assert.ok(body.indexOf(line) < body.indexOf("requireHouseholdContext"));
  const start = route.indexOf("async function warmPing()"), warm = route.slice(start, route.indexOf("\n}\n", start));
  assert.doesNotMatch(warm, /account|household|family|policies|request/i, "the ping reads nothing about anyone");
});

test("a caller looping on the ping gets an empty 429 from the open-endpoint brake; other callers and /api/health keep going", async () => {
  await installDatabase();
  const { GET } = await import("../../app/api/benefits/route");
  const { OPEN_ENDPOINT_MAX, limitOpenEndpoint } = await import("../../lib/http/open-endpoint-limit");
  const from = (ip: string) => new NextRequest("http://localhost/api/benefits?warm=1", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
  for (let i = 0; i < OPEN_ENDPOINT_MAX; i++) assert.equal((await GET(from("203.0.113.77"))).status, 204, "ping " + (i + 1));
  const stopped = await GET(from("203.0.113.77"));
  assert.equal(stopped.status, 429);
  assert.equal(await stopped.text(), "");
  assert.ok(Number(stopped.headers.get("retry-after")) >= 1);
  assert.match(stopped.headers.get("cache-control") ?? "", /no-store/);
  assert.equal((await GET(from("198.51.100.77"))).status, 204, "another IP is not affected");
  assert.equal(limitOpenEndpoint(new Request("http://localhost/api/health", { headers: { "x-forwarded-for": "203.0.113.77" } }), "health"), null, "the ping keeps its own count");
  assert.equal(fetches, 0);
});
