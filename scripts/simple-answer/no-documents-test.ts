/** Scripted tests: a household with people but no documents gets a fixed answer with no model call (TE main journeys
 * 11 Nov: "people but no documents" spent one model call to say "I could not find that in your documents"). A household
 * with any document, even one still being read or one that failed, still asks the model; a question about DearPolicy
 * itself keeps its own fixed answer. Made-up household; no model, network or database.
 *   npm run -s simple:no-documents-test */
import assert from "node:assert/strict";
import type { StructuredAnswer } from "@/components/answer-cards";
import type { ChatContext } from "@/lib/chat/workflow";
import type { Household } from "@/lib/simple-chat/library";
import type { SimpleModel } from "@/lib/simple-chat/model";
import { runSimpleChat } from "@/lib/simple-chat/hook";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
const outbound: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => { outbound.push(String(input)); throw new Error("no network"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const ACCOUNT = "61616161-6161-4616-8616-616161616161";
const house = (documents: Household["documents"]): Household => ({ accountId: ACCOUNT, members: [{ name: "Rosa Quill", relationship: "self" }], documents } as unknown as Household);
const DOC = (processingStatus: string) => ({ policyId: "p1", name: "Quill Shield schedule.pdf", insurer: "Kestrel Assurance", productName: "Quill Shield", policyNumber: null, documentType: null, documentRole: "personal_schedule",
  effectiveDate: null, expiryDate: null, uploadedAt: "2026-11-01", uploadedFor: "Rosa Quill", linkedPeople: ["Rosa Quill"], supersededAt: null, processingStatus,
  pages: processingStatus === "ready" ? [{ page: 1, text: "Life assured: Rosa Quill\nDeath Benefit S$50,000" }] : [] }) as unknown as Household["documents"][number];

async function ask(h: Household, question: string) {
  let calls = 0;
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
    calls++;
    return { json: { bottomLine: "I could not find that in your documents.", statements: [], nextSteps: [], question: null }, stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } };
  } };
  const context = {
    request: { accountId: ACCOUNT, familyMemberId: null, question, submittedQuestion: question },
    family: [{ id: "m1", display_name: "Rosa Quill", preferred_name: null, relationship: "self" }], people: [],
    conversation: { id: "c1", account_id: ACCOUNT, family_member_id: null, title: "t", revision: 1, state: { subjects: {} } },
    token: {}, holdings: [],
  } as unknown as ChatContext;
  const saved: { answer: StructuredAnswer }[] = [];
  await runSimpleChat(context, {}, { model, household: async () => h, history: async () => [], save: (async (x: unknown) => { saved.push(x as never); }) as never, ledger: false, table: async () => null,
    today: () => new Date("2026-11-11T04:00:00Z") });
  return { calls, answer: saved[0].answer };
}

async function main() {
  await check("N1 people but no documents: a fixed answer, no model call, no figures", async () => {
    const { calls, answer } = await ask(house([]), "What is Rosa covered for?");
    assert.equal(calls, 0);
    assert.match(answer.bottomLine!, /no documents in your household yet/);
    assert.ok((answer.nextSteps ?? []).some((s) => /Documents page/.test(String(s))));
    assert.equal((answer.statements ?? []).filter((s) => s.amount).length, 0);
  });
  await check("N2 a question about DearPolicy itself keeps its own fixed answer", async () => {
    const { calls, answer } = await ask(house([]), "What is DearPolicy?");
    assert.equal(calls, 0);
    assert.match(answer.bottomLine!, /keeps your household's insurance documents/);
  });
  await check("C1 control: a household with a read document asks the model", async () => {
    assert.equal((await ask(house([DOC("ready")]), "What is Rosa covered for?")).calls, 1);
  });
  await check("C2 control: a document still being read still asks the model (it can say so)", async () => {
    assert.equal((await ask(house([DOC("processing")]), "What is Rosa covered for?")).calls, 1);
  });
  await check("C3 control: a document that failed still asks the model (it can say why)", async () => {
    assert.equal((await ask(house([DOC("failed")]), "What is Rosa covered for?")).calls, 1);
  });
  assert.deepEqual(outbound, []);
  console.log(`no documents: ${passed} passed, ${failures.length} failed`);
  if (failures.length) { for (const f of failures) console.error(" - " + f); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
