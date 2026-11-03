/**
 * The per-IP brake on endpoints anyone can call signed out (lib/http/open-endpoint-limit.ts). A 5-minute ping and the
 * app's own polling stay far below it; one client looping is stopped with an empty 429, per IP and per endpoint; and
 * /api/health answers the 429 before it touches the database. No network, no model.
 *   npm run http:open-endpoint-limit-test
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY|PINECONE/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;
const from = (ip: string) => new Request("http://localhost/api/health", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });

test("real pollers never reach the limit; a loop is stopped per IP and per endpoint, and the window resets", async () => {
  const { limitOpenEndpoint, OPEN_ENDPOINT_MAX, OPEN_ENDPOINT_WINDOW_MS } = await import("@/lib/http/open-endpoint-limit");
  const t0 = 1_800_000_000_000;
  // A day of 5-minute pings, plus one office's sidebars (10 tabs, once a minute) and an operator page every 30 s.
  for (let m = 0; m < 24 * 60; m++) {
    const now = t0 + m * 60_000;
    if (m % 5 === 0) assert.equal(limitOpenEndpoint(from("203.0.113.5"), "health", now), null, "cron ping at minute " + m);
    for (let tab = 0; tab < 10; tab++) assert.equal(limitOpenEndpoint(from("198.51.100.7"), "health", now + tab * 1000), null);
    for (const s of [0, 30_000]) assert.equal(limitOpenEndpoint(from("198.51.100.7"), "health", now + 15_000 + s), null);
  }
  const t1 = t0 + 2 * 86_400_000, loop = "192.0.2.66";
  for (let i = 0; i < OPEN_ENDPOINT_MAX; i++) assert.equal(limitOpenEndpoint(from(loop), "health", t1 + i), null);
  const stopped = limitOpenEndpoint(from(loop), "health", t1 + OPEN_ENDPOINT_MAX);
  assert.ok(stopped);
  assert.equal(stopped!.status, 429);
  assert.equal(await stopped!.text(), "", "nothing about the app in the refusal");
  assert.ok(Number(stopped!.headers.get("retry-after")) >= 1);
  assert.match(stopped!.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(limitOpenEndpoint(from("192.0.2.67"), "health", t1 + OPEN_ENDPOINT_MAX), null, "another IP is not affected");
  assert.equal(limitOpenEndpoint(from(loop), "warm", t1 + OPEN_ENDPOINT_MAX), null, "another endpoint keeps its own count");
  assert.equal(limitOpenEndpoint(from(loop), "health", t1 + OPEN_ENDPOINT_WINDOW_MS), null, "the next window starts afresh");
});

test("/api/health answers a limited caller with the 429 before any database or search check", async () => {
  const db = await import("@/lib/db/client");
  const { GET } = await import("../../app/api/health/route");
  const { OPEN_ENDPOINT_MAX } = await import("@/lib/http/open-endpoint-limit");
  const ip = "192.0.2.99";
  let limited: Response | null = null;
  for (let i = 0; i <= OPEN_ENDPOINT_MAX + 1 && !limited; i++) { const r = await GET(from(ip)); if (r.status === 429) limited = r; }
  assert.ok(limited, "the route applies the limit");
  assert.equal(await limited!.text(), "");
  const { readFileSync } = await import("node:fs");
  const route = readFileSync("app/api/health/route.ts", "utf8");
  const body = route.slice(route.indexOf("export async function GET("));
  assert.ok(body.indexOf("limitOpenEndpoint(request") > 0 && body.indexOf("limitOpenEndpoint(request") < body.indexOf("query(\"SELECT 1\")"), "the limit comes before the database check");
  void db;
});
