/** Reading a document is never stopped by the household's spend limit (DC, 10 Nov: "do not limit cost for reading
 * documents"); chat and other answering calls still are. Against a real, disposable PostgreSQL: a made-up household past
 * its hard stop. Every call goes out to a stubbed network that refuses, so nothing is paid: an intake reading call gets
 * past the limit to the network, a chat call is stopped before it with the spend-limit error.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run -s ai:reading-spend-cap-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("reading spend cap: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
for (const k of Object.keys(process.env)) if (/API_KEY|ANTHROPIC|OPENAI|GEMINI/i.test(k)) delete process.env[k];
// A key so the call is attempted; the network below refuses every request, so no call is ever paid.
process.env.ANTHROPIC_API_KEY = "test-key-not-real";
process.env.MODEL_PRESET = "anthropic";
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
}

async function main() {
  const { query } = await import("@/lib/db/client");
  const { ensureLedgerSchema, SpendCapReached } = await import("@/lib/ai/ledger");
  const { structuredCompletion, readsDocument } = await import("@/lib/ai/llm");
  await ensureLedgerSchema();
  const account = randomUUID();
  await query("INSERT INTO accounts(id,name) VALUES($1,'Test household past its limit')", [account]);
  await query("INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cost_usd,priced) VALUES($1,'reading','anthropic','claude-sonnet-5',1000000,200000,20,true)", [account]);
  process.env.PLAN_HARD_STOP_USD = "15";
  const ask = (operation: "policy_extraction" | "chat_reply", role: "reading" | "chat") => structuredCompletion({ system: "Reply with JSON.", user: "Made-up page text.", schema: z.object({ ok: z.boolean() }),
    householdId: account, operation, role, attempts: 1, timeoutMs: 2_000, maxOutputTokens: 50 });
  try {
    await test("an intake reading call goes on past the household's spend limit", async () => {
      const before = outbound.length;
      const error = await ask("policy_extraction", "reading").then(() => null, (e: unknown) => e);
      assert.ok(!(error instanceof SpendCapReached), `reading was stopped by the spend limit: ${error instanceof Error ? error.message : error}`);
      assert.ok(outbound.length > before, "the reading call was attempted");
    });
    await test("a reading call still fails closed when this month's usage cannot be read: nothing is sent unbooked", async () => {
      const { SpendCheckUnavailable } = await import("@/lib/ai/ledger");
      const before = outbound.length;
      await query("ALTER TABLE model_usage RENAME TO model_usage_unreadable");
      try {
        const error = await ask("policy_extraction", "reading").then(() => null, (e: unknown) => e);
        assert.ok(error instanceof SpendCheckUnavailable, `reading went on with the ledger unreadable: ${error instanceof Error ? error.message : error}`);
        assert.equal(outbound.length, before, "no reading request was sent");
      } finally { await query("ALTER TABLE model_usage_unreadable RENAME TO model_usage"); }
    });
    await test("a chat call is still stopped at the spend limit, before any request", async () => {
      const before = outbound.length;
      const error = await ask("chat_reply", "chat").then(() => null, (e: unknown) => e);
      assert.ok(error instanceof SpendCapReached || /model-spend limit/.test(error instanceof Error ? error.message : ""), `chat was not stopped: ${error instanceof Error ? error.message : error}`);
      assert.equal(outbound.length, before, "no chat request was sent");
    });
    await test("which operations read documents: intake, OCR and evidence, never answering", async () => {
      for (const op of ["policy_extraction", "benefit_extraction", "hosted_ocr", "catalog_building", "claim_evidence_extraction"]) assert.equal(readsDocument(op), true, op);
      // coverage_extraction is the chat's per-question reading of passages (analyzePolicyWindow): an answer, so capped (Critic #405).
      for (const op of ["chat_reply", "chat_fact_finding", "rag_answer", "relevance_judging", "claim_fact_finding", "coverage_extraction"]) assert.equal(readsDocument(op), false, op);
    });
    await test("the chat's per-question reading of a policy (analyzePolicyWindow) is stopped at the spend limit, before any request", async () => {
      const { analyzePolicyWindow } = await import("@/lib/chat/policy-analysis");
      const { runWithModelHousehold } = await import("@/lib/ai/usage");
      const before = outbound.length;
      const contract = { ownerId: null, ownerName: "Test Person", name: "Made-up Plan", documents: [], coverages: [] } as unknown as Parameters<typeof analyzePolicyWindow>[0]["contract"];
      // As the chat route runs it: inside its household's model context, which is what the spend limit is checked against.
      const error = await runWithModelHousehold(account, () => analyzePolicyWindow({ accountId: account, contract, question: "What does this plan pay for a fracture?", intent: "coverage",
        sources: [{ id: "s1", text: "Made-up passage: Simple Fracture S$1,000.", productScopes: [], pageStart: 1, pageEnd: 1 }] as unknown as Parameters<typeof analyzePolicyWindow>[0]["sources"] }))
        .then(() => null, (e: unknown) => e);
      assert.ok(error instanceof SpendCapReached || /model-spend limit/.test(error instanceof Error ? error.message : ""), `the chat reading was not stopped: ${error instanceof Error ? error.message : error}`);
      assert.equal(outbound.length, before, "no request was sent");
    });
  } finally {
    delete process.env.PLAN_HARD_STOP_USD;
    await query("DELETE FROM accounts WHERE id=$1", [account]).catch(() => undefined);
  }
  console.log(`reading spend cap: ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log("  FAIL " + f);
  process.exit(failures.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
