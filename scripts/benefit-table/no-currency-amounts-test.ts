/** Scripted tests: a printed amount in a document that prints no currency anywhere is shown in the chat as printed, with
 * "Currency not stated", never dropped and never given a currency (live 13 Nov, category 4: a TPD answer left out two
 * schedules' printed TPD sums as amounts it "couldn't find printed in your documents", while Coverage showed both with
 * "currency not stated"). A document that prints any currency, a declared page currency and a count are controls.
 * Made-up households; no model, database or network.
 *   npm run -s benefit-table:no-currency-amounts-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const ACC = "44444444-4444-4444-4444-444444444455";
const ID = "eeeeeeee-0000-4000-8000-0000000000c1";
const PERSON = "Tan Mei Ling Rachel";

/** A two-page component schedule. `lines` are the component rows [name, sum]; `extra` adds a line to page 1. */
function build(lines: [string, string][], o: { extra?: string; head?: string } = {}) {
  const row = ([n, s]: [string, string]) => `${n}\tIn Force\t${s}\t0.00\t02-Mar-2015\t02-Mar-2040`;
  const page1 = ["Client Information", `Policyowner:\t${PERSON}`, "Policy Number:\t70112233", o.extra ?? "Policy Status:\tIn Force"].join("\n");
  const page2 = ["Benefit Details:", `Life Assured Name:\t${PERSON}`, o.head ?? "Component\tStatus\tSum Assured\tComponent Premium\tCover Start Date\tCover Expiry Date", ...lines.map(row),
    "Example Assurance (Pte) Limited\tCONFIDENTIAL"].join("\n");
  const doc: Household["documents"][number] = { policyId: ID, name: "Harbour Protector.pdf", insurer: "Example Assurance", productName: "Harbour Protector", policyNumber: "70112233",
    documentType: null, documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: [PERSON], supersededAt: null,
    processingStatus: "ready", pages: [{ page: 1, text: page1 }, { page: 2, text: page2 }] };
  const house: Household = { accountId: ACC, members: [{ name: PERSON, relationship: "self" }], documents: [doc] };
  const src: SourceDoc = { id: ID, name: doc.name, readable: true, pages: doc.pages };
  const num = (s: string) => Number(s.replace(/[^\d.]/g, ""));
  const covers = lines.map(([n, s], i) => ({ person: PERSON, product: "Harbour Protector", cover: n, plan: null, riderOf: i ? lines[0][0] : null, policyNumber: "70112233", premium: null,
    premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 2, sumInsured: num(s), quote: row([n, s]) }));
  const benefits = lines.map(([n, s]) => ({ section: "Component", column: "Sum Assured", benefit: n, pays: "amount", value: num(s), period: null, basis: null, asOf: null, percentOf: null,
    baseAmount: null, baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, quote: row([n, s]) }));
  const reading = checkReading(src, { document: { kind: "personal_proof", product: "Harbour Protector", insurer: "Example Assurance", namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
    covers, benefits });
  const family: FamilyMember[] = [{ id: "m0", display_name: PERSON }];
  const table = assembleTable([reading], family, []);
  void coverKeyOf; void sectionKeyOf;
  return { house, rows: chatRows(table, house) };
}
/** The model names one row, through the row step, the chat's checks and the label check, as the app's turn does. */
function ask(h: ReturnType<typeof build>, benefit: RegExp) {
  const row = h.rows.find((r) => benefit.test(r.benefit) && r.figure.kind !== "none");
  assert.ok(row, `the table has a row with a figure for ${benefit}`);
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row!.benefit, person: PERSON, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row!.id, rowBenefit: row!.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const q = "She is totally and permanently disabled. How much can she claim?";
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-13T04:00:00Z"), q, []);
  const { answer } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [q], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const cards = kept.filter((s) => s.amount);
  return { cards: cards.map((s) => s.amount as unknown as { text: string; currencyResolved: boolean }), all: answer.statements ?? [] };
}
const LEFT_OUT = /couldn.t find printed/i;

const LINES: [string, string][] = [["Harbour Protector", "100,000.00"], ["Total and Permanent Disability", "100,000.00"], ["Accelerated Disability", "13,500.00"]];

test("A1 no currency anywhere: the TPD sum is shown as printed, currency not stated, never 'couldn't find'", () => {
  const r = ask(build(LINES), /^Total and Permanent Disability/);
  assert.deepEqual(r.cards.map((c) => [c.text, c.currencyResolved]), [["100,000", false]]);
  assert.ok(!r.all.some((s) => LEFT_OUT.test(String((s as { text?: string }).text))), "no left-out note");
});
test("A2 a smaller rider sum on the same schedule (13,500.00)", () => {
  const r = ask(build(LINES), /^Accelerated Disability/);
  assert.deepEqual(r.cards.map((c) => [c.text, c.currencyResolved]), [["13,500", false]]);
});
test("A3 a page whose other lines were held back by the page check is still a page with no currency", () => {
  const r = ask(build([...LINES, ["Medical Reimbursement III", "[amount not checked]"]]), /^Accelerated Disability/);
  assert.deepEqual(r.cards.map((c) => c.text), ["13,500"]);
});
// Controls: any currency printed anywhere keeps the figure unresolved as on main (it may be that currency or another).
test("C1 another page prints USD: the plain figure is not shown", () => {
  const r = ask(build(LINES, { extra: "Premium Paid:\tUSD 150.00" }), /^Total and Permanent Disability/);
  assert.deepEqual(r.cards, []);
});
test("C2 a bare $ elsewhere: the plain figure is not shown", () => {
  const r = ask(build(LINES, { extra: "Premium Amount:\t$181.44" }), /^Total and Permanent Disability/);
  assert.deepEqual(r.cards, []);
});
test("C3 a declared currency field still gives the currency (S$, resolved)", () => {
  const r = ask(build(LINES, { head: "Currency : Singapore Dollar\nComponent\tStatus\tSum Assured\tComponent Premium\tCover Start Date\tCover Expiry Date" }), /^Total and Permanent Disability/);
  assert.deepEqual(r.cards.map((c) => [c.text, c.currencyResolved]), [["S$100,000", true]]);
});
test("C4 a ringgit schedule declared in words stays ringgit", () => {
  const r = ask(build(LINES, { head: "Currency : Ringgit Malaysia\nComponent\tStatus\tSum Assured\tComponent Premium\tCover Start Date\tCover Expiry Date" }), /^Total and Permanent Disability/);
  assert.ok(r.cards.every((c) => !c.text.startsWith("S$") && !c.text.startsWith("$")), JSON.stringify(r.cards));
});
test("C5 a count is never money, currency or not", () => {
  const r = ask(build([["Harbour Protector", "100,000.00"], ["Physiotherapy visits per year", "12.00"]]), /^Physiotherapy/);
  assert.deepEqual(r.cards, []);
});

console.log(`no-currency amounts: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
