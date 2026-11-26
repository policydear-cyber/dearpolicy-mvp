/**
 * Live tester, 26 Nov 2026: "What does my policy not cover?" in a household with five insurers answered with one policy's
 * exclusions only, and the others' documented exclusions were never mentioned. The server now names the other policies
 * whose own pages print exclusions that the answer did not name, and says how to see them. It adds no figure.
 *   node --import tsx scripts/simple-answer/other-exclusions-test.ts
 */
import assert from "node:assert/strict";
import { asksWhatIsNotCovered, otherExclusionsNote } from "@/lib/simple-chat/other-exclusions";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import { runSimpleChat } from "@/lib/simple-chat/hook";
import type { SimpleModel } from "@/lib/simple-chat/model";
import type { ChatContext } from "@/lib/chat/workflow";
import type { AnswerStatement } from "@/components/answer-cards";

let passed = 0; const failures: string[] = [];
async function t(name: string, fn: () => void | Promise<void>) { try { await fn(); passed++; console.log(`ok - ${name}`); } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : e}`); console.log(`FAIL - ${name}`); } }

const doc = (id: string, product: string, page: string, extra: Partial<HouseholdDocument> = {}): HouseholdDocument => ({
  policyId: id, name: `${id}.pdf`, insurer: "Insurer", productName: product, policyNumber: null, documentType: "policy", documentRole: "policy_schedule",
  effectiveDate: null, expiryDate: null, uploadedAt: null, uploadedFor: null, linkedPeople: ["Ana"], supersededAt: null, pages: [{ page: 1, text: page }], ...extra });
const EXCL = "Exclusions. We will not pay for any claim arising from war.";
const NONE = "Benefit schedule. Hospital room and board.";
const hh = (documents: HouseholdDocument[]): Household => ({ accountId: "a", members: [{ name: "Ana", relationship: "self" }], documents });
const label = (d: HouseholdDocument) => d.productName ?? d.name;
const Q = "What does my policy not cover?";

async function main() {
await t("asks: not covered, exclusions, doesn't cover; not an amount or a claim question", () => {
  for (const m of ["What does my policy not cover?", "what are the exclusions", "What isn't covered?", "Does it not cover dental?", "what doesn't it cover", "what won't it pay for"]) assert.ok(asksWhatIsNotCovered(m), m);
  for (const m of ["How much hospital cover do I have?", "Can I claim for my child's dental?", "When does my policy start?"]) assert.ok(!asksWhatIsNotCovered(m), m);
});
await t("names the other policies that print exclusions and were not named", () => {
  const h = hh([doc("1", "Alpha Plan", EXCL), doc("2", "Beta Travel", EXCL), doc("3", "Gamma Care", EXCL), doc("4", "Delta Cash", NONE)]);
  const n = otherExclusionsNote(h, Q, "Alpha Plan does not cover war.", label)!;
  assert.match(n, /Beta Travel/); assert.match(n, /Gamma Care/); assert.doesNotMatch(n, /Alpha Plan\b.*which/); assert.doesNotMatch(n, /Delta Cash/);
  assert.match(n, /also print exclusions/);
});
await t("nothing to say when the answer named every policy with exclusions", () => {
  const h = hh([doc("1", "Alpha Plan", EXCL), doc("2", "Beta Travel", EXCL)]);
  assert.equal(otherExclusionsNote(h, Q, "Alpha Plan: war. Beta Travel: war.", label), null);
});
await t("nothing for one policy, or when the question is not about what is not covered", () => {
  assert.equal(otherExclusionsNote(hh([doc("1", "Alpha Plan", EXCL), doc("2", "Delta Cash", NONE)]), Q, "x", label), null);
  assert.equal(otherExclusionsNote(hh([doc("1", "Alpha Plan", EXCL), doc("2", "Beta Travel", EXCL)]), "How much hospital cover do I have?", "x", label), null);
});
await t("a superseded, unreadable or no-cover document is never named", () => {
  const h = hh([doc("1", "Alpha Plan", EXCL), doc("2", "Beta Travel", EXCL, { supersededAt: "2026-01-01" }), doc("3", "Gamma Care", EXCL, { unreadablePages: [1] }), doc("4", "Delta Cash", EXCL, { documentRole: "medical_bill" }), doc("5", "Eps Home", EXCL)]);
  const n = otherExclusionsNote(h, Q, "Alpha Plan: war.", label)!;
  assert.match(n, /Eps Home/); for (const x of ["Beta Travel", "Gamma Care", "Delta Cash"]) assert.doesNotMatch(n, new RegExp(x));
});
await t("two documents of one policy are one policy; at most four named, the rest counted", () => {
  const h = hh([doc("1", "Alpha Plan", EXCL), doc("2", "Alpha Plan", EXCL), ...["B", "C", "D", "E", "F", "G"].map((x, i) => doc(String(i + 3), `Plan ${x}`, EXCL))]);
  const n = otherExclusionsNote(h, Q, "none named", label)!;
  assert.match(n, /and 3 more/); assert.equal((n.match(/Alpha Plan/g) ?? []).length >= 1, true);
});
await t("a chat about one person names only that person's policies", () => {
  const h = hh([doc("1", "Alpha Plan", EXCL), doc("2", "Beta Travel", EXCL, { linkedPeople: ["Ben"] }), doc("3", "Gamma Care", EXCL)]);
  const n = otherExclusionsNote(h, Q, "Alpha Plan: war.", label, ["Ana"])!;
  assert.match(n, /Gamma Care/); assert.doesNotMatch(n, /Beta Travel/);
});
await t("works for any wording of an exclusion page and adds no figure or file name", () => {
  const h = hh([doc("1", "Alpha Plan", EXCL), doc("2", "Beta Travel", "General exceptions and limitations. The company shall not pay for losses of S$5,000."), doc("3", "Gamma Care", "Not covered: cosmetic surgery.")]);
  const n = otherExclusionsNote(h, Q, "Alpha Plan: war.", label)!;
  assert.match(n, /Beta Travel/); assert.match(n, /Gamma Care/); assert.doesNotMatch(n, /\d|\.pdf/);
});
await t("in the app's chat turn: the saved answer names the policies the model left out, and no figure", async () => {
  const H = { accountId: "44444444-4444-4444-4444-444444444444", members: [{ name: "Grace Tan", relationship: "self" }], documents: [
    doc("aaaaaaaa-0000-0000-0000-000000000001", "Alpha Plan", EXCL, { linkedPeople: ["Grace Tan"] }),
    doc("aaaaaaaa-0000-0000-0000-000000000002", "Beta Travel", EXCL, { linkedPeople: ["Grace Tan"] })] } as unknown as Household;
  const model: SimpleModel = { choice: { provider: "anthropic", model: "test" }, async call() {
    return { json: { bottomLine: "Alpha Plan does not pay for war.", question: null, nextSteps: [], statements: [
      { kind: "fact", text: "Alpha Plan does not pay for war.", person: "Grace Tan", document: "D1", quote: "We will not pay for any claim arising from war.", amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null }] },
      stopReason: "end_turn", model: "test", usage: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 } };
  } };
  const q = "What does my policy not cover?";
  const context = { request: { accountId: H.accountId, familyMemberId: null, question: q, submittedQuestion: q },
    family: [{ id: "p1", display_name: "Grace Tan", preferred_name: null, relationship: "self" }], people: [],
    conversation: { id: "c1", account_id: H.accountId, family_member_id: null, title: "t", revision: 1, state: {} }, token: {}, holdings: [] } as unknown as ChatContext;
  const saved: { answer: { statements?: AnswerStatement[] } }[] = [];
  await runSimpleChat(context, {}, { model, household: async () => H, history: async () => [], save: (async (s: unknown) => { saved.push(s as never); }) as never, ledger: false, table: async () => null, today: () => new Date("2026-11-16T04:00:00Z") });
  const st = (saved[0].answer.statements ?? []).find((s) => s.id === "other-exclusions");
  assert.ok(st, JSON.stringify(saved[0].answer.statements));
  assert.match(st!.text, /Beta Travel/); assert.doesNotMatch(st!.text, /Alpha Plan\b[^.]*which/); assert.ok(!st!.amount);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`other-exclusions test passed: ${passed} cases`);
}
void main();
