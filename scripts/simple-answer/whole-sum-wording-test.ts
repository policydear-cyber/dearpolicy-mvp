/** Scripted tests (Speed S2): a schedule and its wording uploaded as two documents of one product, with no policy number on
 * either, and a question the wording answers with "100% of the Sum Assured will be payable in one lump sum". The person's
 * sum assured printed on the schedule's plan table ("Critical Illness Cover  200,000.00 ...") is shown as what the 100%
 * pays, whether the model quotes the wording or quotes the schedule's line and gives the wording as a condition.
 * Fail-safe controls: a third document of the same product, another insurer's or product's schedule, two policy numbers
 * that differ, a wording that limits the sum, a condition from another benefit's wording, or a base that is not the
 * plan's sum all give no figure. Made-up households in S$ and RM. No model, database or network.
 *   npm run -s simple:whole-sum-wording-test */
import assert from "node:assert/strict";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|PINECONE/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

type Doc = Household["documents"][number];
const doc = (policyId: string, name: string, role: string, text: string, over: Partial<Doc> = {}): Doc => ({ policyId, name, insurer: "Example Life", productName: "Example Critical Illness Plan",
  policyNumber: null, documentType: null, documentRole: role, effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: "Jane Doe", linkedPeople: ["Jane Doe"],
  supersededAt: null, processingStatus: "ready", pages: [{ page: role === "schedule" ? 1 : 4, text }], ...over } as Doc);
const house = (docs: Doc[]): Household => ({ accountId: "55555555-5555-4555-8555-555555555555", members: [{ name: "Jane Doe", relationship: "self" }, { name: "John Doe", relationship: "spouse" }], documents: docs } as Household);

const SCHEDULE = ["Example Life Ltd", "Policy Schedule", "Plan\t: Example Critical Illness Plan", "Assured\t: Jane Doe", ": Singapore Dollar", "Instalment Premium\t: 350.50\tCurrency",
  "Basic Benefits\tSum\tInstalment\tPremium\tBenefit\tBenefit", "Assured/\tPremium\tCessation\tCommencement\tCessation", "Benefit\tDate\tDate\tDate",
  "Critical Illness Cover\t200,000.00\t250.25\t01/10/2036\t01/10/2026\t01/10/2036", "- Occupation Extra\t---\t100.25\t01/10/2036\t---\t---", "Death Benefit\t10,000.00\t---\t---\t01/10/2026\t01/10/2036"].join("\n");
const WORDING = ["2. BENEFITS", "2.1. Death Benefit", "If the Life Assured dies within the Policy term, We will pay S$10,000 in one lump sum.", "2.2. Critical Illness Benefit",
  "If the Life Assured is diagnosed with any one of the covered Early, Intermediate or Severe Stage Critical Illnesses, 100% of the Sum Assured will be payable in one lump sum.",
  "i.\tThe Life Assured survives at least 7 days after the date of diagnosis.", "Refer to Appendix A for the list of Critical Illnesses covered."].join("\n");
const CI_WORDS = "diagnosed with any one of the covered Early, Intermediate or Severe Stage Critical Illnesses, 100% of the Sum Assured will be payable in one lump sum.";
const BASE = "Critical Illness Cover\t200,000.00";

/** One statement: "the full sum assured", quoting `quote` in document `document`, 100% of the schedule's line. */
function ask(h: Household, quote: string, document: string, conditions: { text: string; quote: string | null }[] = [], baseAmount = "200,000.00", baseQuote = BASE) {
  const raw = { bottomLine: "Here is what the documents print.", nextSteps: [], question: null, statements: [{ kind: "amount", text: "Critical illness benefit: the full sum assured is payable in one lump sum.",
    person: "Jane Doe", document, quote, amount: null, percentOf: { percent: 100, baseAmount, baseDocument: "D1", baseQuote }, conditions, alternativeGroup: null }] };
  const { answer } = verifyAnswer(h, readModelAnswer(raw)!, ["I was diagnosed with early stage cancer, what can I claim?"]);
  const st = answer.statements ?? [];
  return { amounts: st.filter((s) => s.amount).map((s) => s.amount!.text), st };
}
const COND = [{ text: "The illness must be a covered one.", quote: CI_WORDS }];
const PAIR = () => house([doc("s1", "Policy Schedule.pdf", "schedule", SCHEDULE), doc("w1", "Policy Wording.pdf", "policy_wording", WORDING)]);

test("W1 the model quotes the wording: 100% is her schedule's S$200,000", () => {
  const r = ask(PAIR(), CI_WORDS, "D2");
  assert.deepEqual(r.amounts, ["S$200,000"], JSON.stringify(r.st));
  assert.match(r.st.find((s) => s.amount)!.basis ?? "", /100% of Jane Doe's sum insured of S\$200,000/);
});
test("W2 the model quotes the schedule's line and gives the wording as a condition: the same S$200,000, the card on the wording with its condition", () => {
  const r = ask(PAIR(), BASE, "D1", COND);
  assert.deepEqual(r.amounts, ["S$200,000"], JSON.stringify(r.st));
  const card = r.st.find((s) => s.amount)!;
  assert.match(card.source?.policyName ?? "", /Wording/);
  assert.ok((card.conditions ?? []).some((c) => /covered/.test(c)), JSON.stringify(card));
});
test("W3 one policy number on the schedule only: still one policy", () => {
  const h = PAIR(); h.documents[0].policyNumber = "EX-1234567";
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, ["S$200,000"]);
});
test("W4 a ringgit schedule: RM", () => {
  const h = house([doc("s1", "Policy Schedule.pdf", "schedule", SCHEDULE.replace(": Singapore Dollar", ": Ringgit Malaysia (RM)")), doc("w1", "Policy Wording.pdf", "policy_wording", WORDING.replace("S$10,000", "RM 10,000"))]);
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts.map((a) => a.replace(/\s/g, "")), ["RM200,000"]);
});

// ---- controls: no figure
test("N1 a third document of the same product (a second policy): no figure", () => {
  const h = PAIR(); h.documents.push(doc("s2", "Policy Schedule 2.pdf", "schedule", SCHEDULE.replace("200,000.00", "350,000.00")));
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, []);
});
test("N2 the wording is another product's: no figure", () => {
  const h = PAIR(); h.documents[1].productName = "Example Term Plan";
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, []);
});
test("N3 the wording is another insurer's: no figure", () => {
  const h = PAIR(); h.documents[1].insurer = "Other Assurance";
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, []);
});
test("N4 two different policy numbers: no figure", () => {
  const h = PAIR(); h.documents[0].policyNumber = "EX-1"; h.documents[1].policyNumber = "EX-2";
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, []);
});
test("N5 the wording is linked to someone else: no figure", () => {
  const h = PAIR(); h.documents[1].linkedPeople = ["John Doe"];
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, []);
});
test("N6 a wording that limits the 100% (up to a figure): no figure", () => {
  const limited = WORDING.replace("payable in one lump sum.", "payable in one lump sum, up to S$150,000.");
  const h = house([doc("s1", "Policy Schedule.pdf", "schedule", SCHEDULE), doc("w1", "Policy Wording.pdf", "policy_wording", limited)]);
  assert.deepEqual(ask(h, BASE, "D1", [{ text: "Covered illness.", quote: CI_WORDS.replace("payable in one lump sum.", "payable in one lump sum, up to S$150,000.") }]).amounts, []);
});
test("N7 the condition is another benefit's wording (death): the plan row is not that benefit's, no figure", () => {
  const h = house([doc("s1", "Policy Schedule.pdf", "schedule", SCHEDULE), doc("w1", "Policy Wording.pdf", "policy_wording", WORDING.replace("We will pay S$10,000 in one lump sum.", "100% of the Sum Assured is payable."))]);
  assert.deepEqual(ask(h, BASE, "D1", [{ text: "Death.", quote: "100% of the Sum Assured is payable." }]).amounts, []);
});
test("N8 the model's base is not the plan's sum (the death row): no figure", () => {
  assert.deepEqual(ask(PAIR(), CI_WORDS, "D2", [], "10,000.00", "Death Benefit\t10,000.00").amounts, []);
});
test("N9 the schedule's line quoted with no wording condition: no figure (as before)", () => {
  assert.deepEqual(ask(PAIR(), BASE, "D1").amounts, []);
});
test("N10 a superseded schedule copy counts as no policy: no figure", () => {
  const h = PAIR(); h.documents[0].supersededAt = "2026-10-05";
  assert.deepEqual(ask(h, CI_WORDS, "D2").amounts, []);
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
console.log(`whole-sum-wording: ${passed} passed, 0 failed`);
