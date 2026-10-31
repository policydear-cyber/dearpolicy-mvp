/**
 * The household spend cap guards every structured model call (lib/ai/llm.ts structuredCompletion): document reading,
 * "Read again" and every other job that goes through it. A household already past its plan's hard stop is refused
 * before any provider request is made, whether the household is named by the caller or set for the whole request
 * (runWithModelHousehold). Scripted: the ledger read is answered in memory, model keys are removed, and every outbound
 * request is refused and counted, so the test can never spend anything.
 *   npm run ai:read-spend-cap-test
 */
import assert from "node:assert/strict";
import { z } from "zod";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
delete process.env.DATABASE_URL;
let outbound = 0;
globalThis.fetch = (async () => { outbound++; throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const { pool } = await import("@/lib/db/client");
  // The month's spend per household, as the ledger would sum it; every other query (usage and execution records) is a
  // no-op, and is counted so a refused call is seen to record nothing.
  const spent = new Map<string, number>();
  const writes: string[] = [];
  pool.query = (async (text: string, params: unknown[] = []) => {
    if (/sum\(cost_usd\)/i.test(text) && /FROM\s+model_usage/i.test(text)) return { rows: [{ cost: String(spent.get(String(params[0])) ?? 0) }], rowCount: 1 };
    if (/^\s*INSERT/i.test(text)) writes.push(text.split(/\s+/).slice(0, 3).join(" "));
    return { rows: [], rowCount: 0 };
  }) as unknown as typeof pool.query;
  const { structuredCompletion } = await import("@/lib/ai/llm");
  const { SpendCapReached, planLimits } = await import("@/lib/ai/ledger");
  const { runWithModelHousehold } = await import("@/lib/ai/usage");
  const call = (householdId?: string) => structuredCompletion({ system: "Read the page.", user: "Page 1: Hospital cash S$100 a day.", schema: z.object({ ok: z.boolean() }),
    role: "reading", operation: "policy_extraction" as never, householdId, attempts: 1, timeoutMs: 1_000 } as never);
  const outcome = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e; } };

  const over = "11111111-1111-4111-8111-111111111111", under = "22222222-2222-4222-8222-222222222222";
  const cap = planLimits().hardStopUsd;
  assert.ok(cap > 0, "the plan has a hard stop");
  spent.set(over, cap + 0.01); spent.set(under, 0);

  await test("a household past its hard stop is refused before any provider request, named by the caller", async () => {
    const before = outbound; writes.length = 0;
    const e = await outcome(call(over));
    assert.ok(e instanceof SpendCapReached, `expected the spend cap, got: ${e instanceof Error ? e.message : String(e)}`);
    assert.equal(outbound, before, "a provider request was attempted for a household past its limit");
    assert.deepEqual(writes, [], "a refused call recorded usage");
  });
  await test("a household past its hard stop is refused when it is set for the whole request (document reading, Read again)", async () => {
    const before = outbound;
    const e = await outcome(runWithModelHousehold(over, () => call()));
    assert.ok(e instanceof SpendCapReached, `expected the spend cap, got: ${e instanceof Error ? e.message : String(e)}`);
    assert.equal(outbound, before);
  });
  await test("exactly at the hard stop is past it", async () => {
    spent.set(over, cap);
    assert.ok((await outcome(call(over))) instanceof SpendCapReached);
    spent.set(over, cap + 0.01);
  });
  await test("control: a household under its limit goes on to the provider (refused here only because no model is set up)", async () => {
    const e = await outcome(call(under));
    assert.ok(e && !(e instanceof SpendCapReached), `a household under its limit was refused for spend: ${e instanceof Error ? e.message : String(e)}`);
    const e2 = await outcome(runWithModelHousehold(under, () => call()));
    assert.ok(e2 && !(e2 instanceof SpendCapReached));
  });

  console.log(`read spend cap: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  if (failures.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
