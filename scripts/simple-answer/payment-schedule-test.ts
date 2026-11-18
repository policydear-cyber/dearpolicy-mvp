/** Scripted tests: a figure that only says when or how a large claim is paid in parts is never shown as an amount, in chat
 * or on the benefits table (live 18 Nov: a group policy's TPD terms print "If the sum payable in respect of a valid claim is
 * above S$200,000, the Company will first pay a lump sum of S$200,000 and pay the balance in three (3) equal annual
 * instalments."; the chat could show S$200,000 as the person's TPD amount). Made-up wordings, any insurer, with controls:
 * a TPD sum, a cap ("not exceeding"), and a benefit paid in instalments whose own figure is its amount keep their figures.
 * No model, database or network.
 *   npm run simple:payment-schedule-test */
import assert from "node:assert/strict";
import { checkReading } from "@/lib/benefit-table/check";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, scheduleFigure, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const PERSON = "Alex Tan";
const TERMS = "4. Total and Permanent Disability Benefit\nWe will pay the Sum Assured if the Insured Person suffers Total and Permanent Disability.\nIf the sum payable in respect of a valid claim is above S$200,000, the Company\nwill first pay a lump sum of S$200,000 and pay the balance in three (3) equal annual\ninstalments. The first annual instalment will be paid on the 1st anniversary of the\ninitial lump sum payment.";
const SCHEDULE = "Example Group Life\nCERTIFICATE OF INSURANCE\nInsured Person: Alex Tan\nBenefit\tSum Assured\nDeath\tS$500,000\nTotal and Permanent Disability\tS$500,000\nCritical Illness\tS$200,000";
const house = (pages: string[]): Household => ({ accountId: "a", members: [{ name: PERSON, relationship: "self" }], documents: [{ policyId: "d1", name: "group.pdf", insurer: "Example Group Life",
  productName: "Group Term Life", policyNumber: "G-1", documentType: null, documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null,
  linkedPeople: [PERSON], supersededAt: null, processingStatus: "ready", pages: pages.map((text, i) => ({ page: i + 1, text })) }] } as never);
function say(h: Household, text: string, quote: string, amount: string) {
  const raw = { bottomLine: "x", nextSteps: [], question: null, statements: [{ kind: "amount", text, person: PERSON, document: "group.pdf", quote, amount, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: null, rowBenefit: null, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const { answer, report } = verifyAnswer(h, readModelAnswer(raw)!, ["How much is my TPD cover?"]);
  return { amounts: (answer.statements ?? []).map((s) => (s as { amount?: { text: string } | null }).amount?.text).filter(Boolean), dropped: report.dropped };
}

test("scheduleFigure: the threshold and the first lump sum before instalments", () => {
  assert.equal(scheduleFigure(TERMS, 200000), true);
  for (const [t, v] of [["Where the benefit exceeds RM 100,000, we will pay RM 100,000 first and the balance in 12 monthly instalments.", 100000],
    ["Claims of more than US$250,000 are paid as an initial lump sum of US$250,000 and the remainder in two annual instalments.", 250000]] as const)
    assert.equal(scheduleFigure(t, v), true, t);
});
test("scheduleFigure control: a sum, a cap or an instalment benefit's own figure is an amount", () => {
  for (const [t, v] of [
    ["Total and Permanent Disability\tS$500,000", 500000],
    ["We will pay the Sum Assured, not exceeding S$200,000, in five annual instalments.", 200000],
    ["We will pay a monthly income of S$2,000 in instalments for 5 years.", 2000],
    ["If the bill is above S$1,000, we pay 80% of it.", 1000],
    ["We will pay a lump sum of S$50,000 on diagnosis.", 50000],
    ["We will pay S$200,000 on diagnosis. Premiums are payable in monthly instalments.", 200000],
  ] as const) assert.equal(scheduleFigure(t, v), false, t);
});
test("chat: the first lump sum of a TPD payment schedule is never the person's TPD amount", () => {
  const h = house([SCHEDULE, TERMS]);
  for (const [text, quote] of [["TPD: S$200,000 lump sum", "will first pay a lump sum of S$200,000"],
    ["TPD initial payment", "If the sum payable in respect of a valid claim is above S$200,000, the Company\nwill first pay a lump sum of S$200,000"],
    ["TPD threshold", "is above S$200,000"]]) {
    const a = say(h, text, quote, "S$200,000");
    assert.deepEqual(a.amounts, [], `${text}: ${JSON.stringify(a)}`);
  }
});
test("chat control: the TPD sum on the certificate, and a critical illness sum of the same figure, stay amounts", () => {
  const h = house([SCHEDULE, TERMS]);
  assert.deepEqual(say(h, "TPD", "Total and Permanent Disability\tS$500,000", "S$500,000").amounts, ["S$500,000"]);
  assert.deepEqual(say(h, "Critical illness", "Critical Illness\tS$200,000", "S$200,000").amounts, ["S$200,000"]);
});
test("table: a row read from the payment schedule keeps no figure; the certificate's TPD sum keeps its own", () => {
  const pages = [SCHEDULE, TERMS].map((text, i) => ({ page: i + 1, text }));
  const r = checkReading({ id: "d1", name: "group.pdf", readable: true, pages }, {
    document: { kind: "personal_proof", product: "Group Term Life", insurer: "Example Group Life", namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: PERSON, product: "Group Term Life", cover: "Total and Permanent Disability", plan: null, riderOf: null, policyNumber: "G-1", premium: null, premiumFrequency: null, asOf: null,
      startDate: null, endDate: null, page: 1, sumInsured: 500000, quote: "Total and Permanent Disability\tS$500,000" }],
    benefits: [{ section: "4. Total and Permanent Disability Benefit", benefit: "TPD first payment", column: null, pays: "amount", value: 200000, period: null, basis: null, asOf: null, percentOf: null,
      baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: "will first pay a lump sum of S$200,000" }] } as never);
  const row = r.benefits.find((b) => b.benefit === "TPD first payment");
  assert.ok(row, JSON.stringify(r.dropped));
  assert.equal(row!.value, null, JSON.stringify(row));
  assert.equal(r.covers[0].sumInsured, 500000);
});

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  console.error(`simple payment schedule: ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`simple payment schedule: ${passed} passed, 0 failed`);
