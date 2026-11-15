/** The second call of a turn that asked whose with no figure (lib/simple-chat/hook.ts asksWhoseOnly) is held to the
 * household's spend cap like the first (gate #503 ASK-H1): when the first call has taken the household past its hard stop,
 * or the month's spend cannot be read, no second call is made and the first answer stands; under the stop it is made and
 * both calls are in the ledger. Against a real, disposable PostgreSQL; a scripted model, no network, nothing paid.
 *   DEARPOLICY_DISPOSABLE_DB=1 DATABASE_URL=postgres://... npm run -s simple:each-person-spend-cap-test */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ChatContext } from "@/lib/chat/workflow";
import type { Household } from "@/lib/simple-chat/library";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { SimpleChatState } from "@/lib/simple-chat/hook";

const url = process.env.DATABASE_URL ?? "";
if (process.env.DEARPOLICY_DISPOSABLE_DB !== "1" || !/@(localhost|127\.0\.0\.1)[:/]|host=\//.test(url)) {
  console.log("each person spend cap: skipped (set DEARPOLICY_DISPOSABLE_DB=1 and a local DATABASE_URL to run)");
  process.exit(0);
}
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0; const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const A = "Wong Kai Ming", B = "Lee Siew Lan";
const doc = (policyId: string, person: string, text: string) => ({ policyId, name: `${person} schedule.pdf`, insurer: "Kestrel Assurance", productName: `${person.split(" ")[0]} Cover`, policyNumber: null, documentType: null,
  documentRole: "schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-20", uploadedFor: person, linkedPeople: [person], supersededAt: null, processingStatus: "ready", pages: [{ page: 1, text }] });
const house = (accountId: string) => ({ accountId, members: [{ name: A, relationship: "self" }, { name: B, relationship: "spouse" }], documents: [
  doc("d2000000-0000-4000-8000-000000000001", A, `Life Assured: ${A}\nEarly Stage Critical Illness Benefit: up to S$50,000 per claim`),
  doc("d2000000-0000-4000-8000-000000000002", B, `Insured: ${B}\nEarly stage: maximum S$18,000 per claim`),
] } as unknown as Household);
const st = (kind: string, text: string, person: string, document: string, quote: string, amount: string | null) => ({ kind, text, person, document, quote, amount, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
const WHOSE_ONLY = { bottomLine: "I need to know whose diagnosis this is.", statements: [st("fact", "Kai Ming's cover prints an early stage benefit.", A, "D1", "Early Stage Critical Illness Benefit: up to S$50,000 per claim", null)],
  nextSteps: [], question: `Whose diagnosis is this: ${A}'s or ${B}'s?` };
const EACH = { bottomLine: "Here is each member's early stage benefit.", statements: [
  st("amount", "Kai Ming: the early stage benefit per claim.", A, "D1", "Early Stage Critical Illness Benefit: up to S$50,000 per claim", "S$50,000"),
  st("amount", "Siew Lan: the early stage benefit per claim.", B, "D2", "Early stage: maximum S$18,000 per claim", "S$18,000"),
], nextSteps: [], question: `Who was diagnosed: ${A} or ${B}?` };
const QUESTION = "I was diagnosed with an early stage heart attack. What can I claim?";
const contextFor = (accountId: string) => ({ request: { accountId, familyMemberId: null, question: QUESTION },
  family: [{ id: "m1", display_name: A, relationship: "self" }, { id: "m2", display_name: B, relationship: "spouse" }], people: [],
  conversation: { id: "c1", account_id: accountId, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } }, token: {}, holdings: [] }) as unknown as ChatContext;
type Saved = { answer: { statements?: { amount?: unknown }[]; questions: { text: string }[] }; state: SimpleChatState };

async function main() {
  const { query, pool } = await import("@/lib/db/client");
  const { ensureLedgerSchema } = await import("@/lib/ai/ledger");
  const { runSimpleChat } = await import("@/lib/simple-chat/hook");
  await ensureLedgerSchema();
  /** One turn with the ledger on. `first` runs during the first call. Each scripted call reports 1,000,000 input tokens,
   * US$2 at Sonnet 5.5's price, unless `tokens` says otherwise. */
  async function turn(stopUsd: string, first: () => Promise<void> = async () => {}, tokens = 1_000_000, beforeSave: () => Promise<void> = async () => {}) {
    process.env.PLAN_HARD_STOP_USD = stopUsd;
    const accountId = randomUUID();
    let calls = 0;
    const model: SimpleModel = { choice: { provider: "anthropic", model: "claude-sonnet-5-5" }, async call() {
      calls++;
      if (calls === 1) await first();
      return { json: structuredClone(calls === 1 ? WHOSE_ONLY : EACH), stopReason: "end_turn", model: "test", usage: { input: tokens, cacheWrite: 0, cacheRead: 0, output: 0 } };
    } };
    const saved: Saved[] = [];
    await runSimpleChat(contextFor(accountId), {}, { model, household: async () => house(accountId), history: async () => [], ledger: true, table: async () => null,
      save: (async (x: unknown) => { await beforeSave(); saved.push(x as never); }) as never, today: () => new Date("2026-11-15T04:00:00Z") });
    const rows = (await query<{ n: number; usd: string }>("SELECT count(*)::int AS n, coalesce(sum(cost_usd),0)::text AS usd FROM model_usage WHERE account_id=$1", [accountId])).rows[0];
    return { calls, rows: rows.n, usd: Number(rows.usd), answer: saved[0].answer, turn: saved[0].state.simpleChat!.turns.at(-1)! };
  }
  try {
    await test("H1 the first call takes the household past its hard stop: no second call, the first answer stands", async () => {
      const r = await turn("1");
      assert.equal(r.calls, 1);
      assert.equal(r.rows, 1);
      assert.equal(r.turn.eachPerson?.skipped, "spend cap");
      assert.equal((r.answer.statements ?? []).filter((x) => x.amount).length, 0);
      assert.match(r.answer.questions[0]?.text ?? "", /Whose diagnosis/);
    });
    await test("H2 control: under the hard stop, the second call is made and both calls are in the ledger", async () => {
      const r = await turn("1000");
      assert.equal(r.calls, 2);
      assert.equal(r.rows, 2);
      assert.ok(Math.abs(r.usd - 4) < 1e-6, `ledger US$${r.usd}`);
      assert.equal(r.turn.eachPerson?.kept, true);
      assert.equal((r.answer.statements ?? []).filter((x) => x.amount).length, 2);
    });
    await test("H3 the month's spend cannot be read before the second call: no second call (the cap fails closed)", async () => {
      // The ledger table is hidden during the first call and back before the save.
      const restore = () => query("ALTER TABLE IF EXISTS model_usage_hidden RENAME TO model_usage").then(() => {});
      try {
        const r = await turn("1000", () => query("ALTER TABLE model_usage RENAME TO model_usage_hidden").then(() => {}), 10, restore);
        assert.equal(r.calls, 1);
        assert.equal(r.turn.eachPerson?.skipped, "spend cap");
      } finally { await restore(); }
    });
  } finally { await pool.end().catch(() => {}); }
  assert.deepEqual(outbound, []);
  console.log(`each person spend cap: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
