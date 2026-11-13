/** Scripted tests: a cover named "Term Life", "... Plan" or "Long Term Care" keeps its printed sum in the chat; the words
 * "term" and "plan" in a cover's own name are not what its figure counts (follow-up to PR #460: on main the chat dropped
 * such rows even under a declared currency, as "the figure's row names a count or a rate"). A plan number, a term, a count
 * and a rate stay held. Made-up households; no model, database or network.
 *   npm run -s benefit-table:cover-name-count-test */
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
function build(lines: [string, string][], o: { extra?: string; head?: string; bare?: boolean } = {}) {
  const row = ([n, s]: [string, string]) => (o.bare ? `${n}\t${s}` : `${n}\tIn Force\t${s}\t0.00\t02-Mar-2015\t02-Mar-2040`);
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

const S = "Currency : Singapore Dollar\nComponent\tStatus\tSum Assured\tComponent Premium\tCover Start Date\tCover Expiry Date";
const shown = (lines: [string, string][], benefit: RegExp, head = S) => ask(build(lines, { head }), benefit).cards.map((c) => c.text);
const BASE: [string, string] = ["Harbour Protector", "100,000.00"];

// A cover's own name is not what a figure counts: "Term Life", "... Plan", "Long Term Care" keep their sums.
test("K1 Term Life keeps its sum", () => assert.deepEqual(shown([BASE, ["Term Life", "50,000.00"]], /^Term Life/), ["S$50,000"]));
test("K2 a plan's name ending in 'Plan' keeps its sum", () => assert.deepEqual(shown([["Harbour Flexi Plan", "100,000.00"], ["Term Life", "50,000.00"]], /^Harbour Flexi Plan/), ["S$100,000"]));
test("K3 'Long Term Care' keeps its sum", () => assert.deepEqual(shown([BASE, ["Long Term Care Rider", "36,000.00"]], /^Long Term Care/), ["S$36,000"]));
test("K4 'Decreasing Term Assurance' keeps its sum", () => assert.deepEqual(shown([BASE, ["Decreasing Term Assurance", "250,000.00"]], /^Decreasing Term/), ["S$250,000"]));
test("K5 'Hospital Plan B' keeps its sum (a plan letter is part of the name)", () => assert.deepEqual(shown([BASE, ["Hospital Plan B", "20,000.00"]], /^Hospital Plan B/), ["S$20,000"]));
test("K6 'Plans for Kids Protector' keeps its sum", () => assert.deepEqual(shown([BASE, ["Plans for Kids Protector", "30,000.00"]], /^Plans for Kids/), ["S$30,000"]));
test("K7 ringgit: 'Term Life' declared in words", () => {
  const t = shown([BASE, ["Term Life", "80,000.00"]], /^Term Life/, S.replace("Singapore Dollar", "Ringgit Malaysia"));
  assert.equal(t.length, 1); assert.ok(t[0].endsWith("80,000") && !t[0].startsWith("S$"), t[0]);
});
test("K8 a plan's name with no status cell keeps a sum printed as an amount", () => assert.deepEqual(
  ask(build([BASE, ["Harbour Flexi Plan", "100,000.00"]], { head: S, bare: true }), /^Harbour Flexi Plan/).cards.map((c) => c.text), ["S$100,000"]));
test("K9 'Plan 3  100,000.00': the plan number is a label and the sum is the plan's (as #456 reads 'Plan 3 SGD 100,000')", () => assert.deepEqual(
  ask(build([BASE, ["Plan 3", "100,000.00"]], { head: S, bare: true }), /^Plan 3/).cards.map((c) => c.text), ["S$100,000"]));
// Critic #463: a one-line schedule row that names the plan or term beside the sum keeps the sum (main shows it).
for (const [n, line, want] of [["Plan Type", "Plan Type:\tHarbour Flexi Plan\tSum Assured:", "S$100,000"], ["Policy Term", "Policy Term:\t20 years\tSum Assured:", "S$100,000"],
  ["Coverage Term", "Coverage Term:\t20\tDeath Benefit:", "S$200,000"]] as const) {
  test(`K10 '${line.replace(/\t/g, " ")}' keeps the sum`, () => assert.deepEqual(
    ask(build([BASE, [line, want === "S$200,000" ? "200,000.00" : "100,000.00"]], { head: S, bare: true }), new RegExp("^" + n)).cards.map((c) => c.text), [want]));
}
// Held: the figure IS a plan number, a term, a count or a rate.
test("H1 'Plan 3' is a plan number, never money", () => assert.deepEqual(shown([BASE, ["Plan", "3.00"]], /^Plan$/), []));
test("H2 'Premium Term' figure is a term", () => assert.deepEqual(shown([BASE, ["Premium Term", "20.00"]], /^Premium Term/), []));
test("H3 'Policy Term (Years)' figure is a term", () => assert.deepEqual(shown([BASE, ["Policy Term (Years)", "25.00"]], /^Policy Term/), []));
test("H4 'Term' alone is a term", () => assert.deepEqual(shown([BASE, ["Term", "10.00"]], /^Term$/), []));
test("H5 visits per year is a count", () => assert.deepEqual(shown([BASE, ["Physiotherapy visits per year", "12.00"]], /^Physiotherapy/), []));
test("H6 'Number of Plans' is a count", () => assert.deepEqual(shown([BASE, ["Number of Plans", "2.00"]], /^Number of Plans/), []));
test("H8 'Plan 3' with no status cell: the 3 is a plan number", () => assert.deepEqual(
  ask(build([BASE, ["Plan", "3"]], { head: S, bare: true }), /^Plan$/).cards, []));
test("H9 'Policy Term 20' with no status cell", () => assert.deepEqual(
  ask(build([BASE, ["Policy Term", "20"]], { head: S, bare: true }), /^Policy Term/).cards, []));
test("H7 'Plan No.' is a plan number", () => assert.deepEqual(shown([BASE, ["Plan No.", "4.00"]], /^Plan No/), []));

console.log(`cover-name count words: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log("  FAIL " + f);
if (failures.length) process.exit(1);
