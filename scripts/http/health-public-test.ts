/**
 * /api/health is open to anyone signed out (middleware.ts OPEN_PATHS), so its answer is only whether DearPolicy is
 * up: no model supplier, model name, search service, region or fix hint. The per-service table is for DearPolicy
 * staff on /operator. Uptime checks only read the HTTP status, which is unchanged. No network, no model.
 *   npm run http:health-public-test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY|SUPABASE|DEV_AUTH|PINECONE|DATABASE_URL/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("signed out, /api/health says only ok/status, and names no supplier or internals", async () => {
  const { GET } = await import("../../app/api/health/route");
  const res = await GET(new Request("http://localhost/api/health", { headers: { "x-forwarded-for": "192.0.2.10" } }));
  assert.equal(res.status, 200, "uptime checks read the status code: it stays 200");
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body).sort(), ["hosted", "ok", "status"]);
  assert.equal(typeof body.ok, "boolean");
  assert.ok(body.status === "ok" || body.status === "degraded");
  assert.equal(body.hosted, true, "the signed-in sidebar still reads hosted");
  assert.doesNotMatch(text, /claude|anthropic|openai|gpt|sonnet|haiku|opus|pinecone|supabase|baidu|paddle|model|region|DATABASE_URL|services/i);
});

test("the full service table is behind the same staff check as /operator", () => {
  const src = readFileSync("app/api/health/route.ts", "utf8");
  const body = src.slice(src.indexOf("export async function GET("));
  const gate = body.indexOf("requireActiveClaimReviewer()");
  assert.ok(gate > 0, "the route checks for a staff account");
  assert.ok(gate < body.indexOf("services,hosted"), "the staff check comes before the detailed answer");
  assert.match(readFileSync("app/operator/layout.tsx", "utf8"), /requireActiveClaimReviewer\(\)/, "the same gate as the operator area");
});
