/**
 * The household spend cap fails closed: when this month's spend cannot be read from the ledger, no model call is made
 * and the household is told plainly to try again shortly. An unknown spend is never taken as no spend.
 *
 * Real chat route and real schema on PGlite (the adversarial harness), with the ledger table made unreadable for the
 * check; model keys removed and every outbound request refused and counted.
 *   npm run ai:spend-check-fails-closed-test
 */
import assert from "node:assert/strict";
import { z } from "zod";
import { setAdvEnv, startAdvHarness } from "../fixtures/rag2-adv/harness";
import { ACCOUNT_N } from "../fixtures/rag2-adv/household";

setAdvEnv();
for (const k of Object.keys(process.env)) if (/ANTHROPIC|GEMINI/i.test(k)) delete process.env[k];
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function main() {
  const H = await startAdvHarness();
  let outbound = 0;
  const refuse = globalThis.fetch;
  globalThis.fetch = (async (...a: Parameters<typeof fetch>) => { outbound++; return refuse(...a); }) as typeof fetch;
  const { overSpendCap, SpendCheckUnavailable, SPEND_CHECK_UNAVAILABLE_TEXT } = await import("@/lib/ai/ledger");
  const { structuredCompletion, householdModelFailure } = await import("@/lib/ai/llm");
  const { runWithModelHousehold } = await import("@/lib/ai/usage");
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/api/chat/route");
  const post = async (question: string) => {
    process.env.DEV_ACCOUNT_ID = ACCOUNT_N;
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: null, scope: "family", question, asynchronous: false, timeZone: "Asia/Singapore" }) }));
    return { status: res.status, data: await res.json() };
  };
  const outcome = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e; } };
  const call = (householdId?: string) => structuredCompletion({ system: "Read the page.", user: "Page 1.", schema: z.object({ ok: z.boolean() }),
    role: "reading", householdId, attempts: 1, timeoutMs: 1_000 } as never);
  const modelCalls = { n: 0 };
  installLoopModel({ id: "spend-check-test", kind: "scripted", next: async () => { modelCalls.n++; throw new Error("the model must not be called"); } } as never);
  const unreadable = async <T>(fn: () => Promise<T>) => {
    await H.db.query("ALTER TABLE model_usage RENAME TO model_usage_unreadable");
    try { return await fn(); } finally {
      // A fail-open build re-creates the ledger table while it is renamed; put the real one back either way.
      await H.db.query("DROP TABLE IF EXISTS model_usage"); await H.db.query("ALTER TABLE model_usage_unreadable RENAME TO model_usage");
    }
  };
  const chatRows = async () => Number((await H.db.query("SELECT count(*)::int AS n FROM chat_messages WHERE account_id=$1", [ACCOUNT_N])).rows[0].n);

  await test("an unreadable ledger is not 'no spend': the check throws SpendCheckUnavailable", async () => {
    const e = await unreadable(() => outcome(overSpendCap(ACCOUNT_N)));
    assert.ok(e instanceof SpendCheckUnavailable, `expected SpendCheckUnavailable, got: ${e instanceof Error ? e.message : String(e)}`);
  });
  await test("the chat route refuses with a plain 'try again shortly' and makes no model call and saves nothing", async () => {
    const before = await chatRows(), sent = outbound;
    const r = await unreadable(() => post("What does FamilyFirst cover for Rohan?"));
    assert.equal(r.status, 503, JSON.stringify(r.data).slice(0, 300));
    assert.equal(r.data.code, "spend_check_unavailable");
    assert.equal(r.data.error, SPEND_CHECK_UNAVAILABLE_TEXT);
    assert.match(r.data.error, /try again shortly/i); assert.doesNotMatch(r.data.error, /ledger|database|sql|model_usage/i);
    assert.equal(modelCalls.n, 0); assert.equal(outbound, sent); assert.equal(await chatRows(), before);
  });
  await test("a document read (any structured call) is refused before any provider request, named or set for the request", async () => {
    const sent = outbound;
    for (const e of [await unreadable(() => outcome(call(ACCOUNT_N))), await unreadable(() => outcome(runWithModelHousehold(ACCOUNT_N, () => call())))]) {
      assert.ok(e instanceof SpendCheckUnavailable, `expected SpendCheckUnavailable, got: ${e instanceof Error ? e.message : String(e)}`);
      assert.equal(householdModelFailure(e), SPEND_CHECK_UNAVAILABLE_TEXT);
    }
    assert.equal(outbound, sent, "a provider request was attempted while the spend could not be read");
  });
  await test("a document job that meets it is retried later, never dead-lettered", async () => {
    const { classifyPipelineError } = await import("@/lib/jobs/pipeline-worker");
    assert.equal(classifyPipelineError(new SpendCheckUnavailable(new Error("connection terminated"))), "transient");
  });
  await test("control: with the ledger readable, the route goes past the spend check", async () => {
    const r = await post("What does FamilyFirst cover for Rohan?");
    assert.notEqual(r.data.code, "spend_check_unavailable"); assert.notEqual(r.status, 503);
    assert.equal(await overSpendCap(ACCOUNT_N), false);
  });
  installLoopModel(null);

  console.log(`spend check fails closed: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
