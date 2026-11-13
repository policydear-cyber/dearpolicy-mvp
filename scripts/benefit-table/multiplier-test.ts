/** Scripted tests: a row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid
 * at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident") is applied only when the household's
 * own words state that case, and never past the printed maximum (lib/benefit-table/multiplier.ts). Harbourline test, 13 Nov:
 * "It was a compound fracture." still showed the single 2% of Grace's sum (GBP 400) beside prose saying it is doubled.
 * General rule, tested on made-up households in two currencies with negative controls:
 * - stated case: the share times the multiple, within the printed maximum, with the condition in the working;
 * - case not stated, negated, or only some of its words said: the card is as before;
 * - a multiplied share above the maximum is the maximum only when the condition keeps it, else no amount;
 * - a row whose figure cannot be worked out with the multiple (a printed amount) shows no amount in the stated case;
 * - rows without such a condition never change.
 * No model, database or network.
 *   npm run benefit-table:multiplier-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import { multipleIn, multiplierFor } from "@/lib/benefit-table/multiplier";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

type Person = { name: string; relationship: string; line: string; sum: number };
const ACC = "55555555-5555-4555-8555-555555555555";
const DOC = "eeeeeeee-0000-4000-8000-000000000071";
const ben = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });

/** A family accident schedule: people and their sums on page 1, the table of benefits with its notes on page 2. */
function schedule(people: Person[], tableLines: string[], benefits: Record<string, unknown>[], product = "Family Personal Accident") {
  const page1 = `Example Insurance plc\n${product.toUpperCase()} - SCHEDULE\nInsured person\tRelationship\tSum Insured\n${people.map((p) => p.line).join("\n")}`;
  const page2 = `TABLE OF BENEFITS\nSection\tBenefit\tAmount payable\n${tableLines.join("\n")}`;
  const d: Household["documents"][number] = { policyId: DOC, name: `${product}.pdf`, insurer: "Example Insurance plc", productName: product, policyNumber: null, documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: people.map((p) => p.name), supersededAt: null,
    processingStatus: "ready", pages: [page1, page2].map((text, i) => ({ page: i + 1, text })) };
  const house: Household = { accountId: ACC, members: people.map((p) => ({ name: p.name, relationship: p.relationship })), documents: [d] };
  const family: FamilyMember[] = people.map((p, i) => ({ id: `m${i}`, display_name: p.name, relationship: p.relationship, date_of_birth: null }));
  const src: SourceDoc = { id: d.policyId, name: d.name, readable: true, pages: d.pages };
  const reading = checkReading(src, { document: { kind: "personal_proof", product, insurer: d.insurer, namedPeople: people.map((p) => p.name), plan: null, periodFrom: null, periodTo: null },
    covers: people.map((p) => ({ person: p.name, product, cover: product, plan: null, riderOf: null, policyNumber: null, premium: null, premiumFrequency: null, asOf: null,
      startDate: null, endDate: null, page: 1, sumInsured: p.sum, quote: p.line })), benefits });
  const key = coverKeyOf({ product, cover: product, plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: key, why: "the schedule's table of benefits" }));
  const table = assembleTable([reading], family, links);
  return { house, rows: chatRows(table, house) };
}
/** The model's reply naming one row, through the row step, the chat's checks and the label check, as the app's turn does. */
function ask(h: ReturnType<typeof schedule>, person: string, benefit: RegExp, question: string, earlier: string[] = []) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit) && r.figure.kind !== "none");
  assert.ok(row, `no row for ${person} ${benefit}`);
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-13T04:00:00Z"), question, earlier);
  const { answer } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question, ...earlier], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const cards = kept.filter((s) => s.amount && s.personName === person);
  return { amounts: cards.map((s) => s.amount!.text), basis: cards[0]?.basis ?? "", leftOut: fromRows.report.dropped.length > 0 };
}

const GRACE: Person = { name: "Grace Okafor", relationship: "spouse", line: "Grace Okafor\tSpouse\tGBP 20,000", sum: 20000 };
const DANIEL: Person = { name: "Daniel Okafor", relationship: "self", line: "Daniel Okafor\tPolicyholder\tGBP 80,000", sum: 80000 };
const FRACTURE = "3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)";
const KEEPS = "Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident.";
const BURNS = "4\tBurns\t10% of the Sum Insured";
function fractureSchedule(note = KEEPS, pct = 2, people = [DANIEL, GRACE]) {
  const line = FRACTURE.replace("2%", `${pct}%`);
  return schedule(people, [line, note, BURNS], [
    ben({ section: "3", benefit: "Fracture of arm, wrist or leg", pays: "percent", value: pct, percentOf: "sum_insured", quote: line, cap: 1500, capQuote: "maximum GBP 1,500 per accident",
      conditions: [note] }),
    ben({ section: "4", benefit: "Burns", pays: "percent", value: 10, percentOf: "sum_insured", quote: BURNS }),
  ]);
}
const TURNS = ["Daniel broke his arm playing football. What can we claim?", "Actually it was Grace, not Daniel."];

// ---------- Reading the multiple ----------
test("the multiple is read from the words of the amount only", () => {
  const cases: [string, number | null][] = [
    [KEEPS, 2], ["The benefit is doubled while travelling on public transport.", 2], ["A fracture of the skull is paid at treble the amount.", 3],
    ["For a fracture of the skull or spine, three times the Section 3 amount is paid.", 3], ["Burns to the face: 150% of the Section 4 amount.", 1.5],
    ["A hairline fracture is paid at half the amount.", 0.5], ["A private room or a double room in hospital.", null], ["2% of the Sum Insured per fracture", null],
    ["100% of the benefit is paid.", null], ["This benefit cannot be claimed twice for the same injury or for the same benefit.", null], ["Paid once, or two times in a policy year.", null],
["The fracture must be confirmed by X-ray.", null]];
  for (const [text, want] of cases) { const m = multipleIn(text); assert.equal(m && m !== "unsure" ? m.times : m, want, text); }
});
test("the case is the condition's own words, not the row's: 'compound' for a fracture row", () => {
  const own = "Fracture of arm, wrist or leg\n" + FRACTURE;
  const m = multiplierFor([KEEPS.replace(/^Note \(a\): /, "")], own, "It was a compound fracture.", 1500);
  assert.ok(m && m !== "unsure" && m.times === 2 && m.keepsCap, JSON.stringify(m));
  assert.equal(multiplierFor([KEEPS], own, "Grace broke her arm, it is a fracture of the wrist.", 1500), null);
  assert.equal(multiplierFor([KEEPS], own, "It was not a compound fracture, just a simple one.", 1500), null);
  assert.equal(multiplierFor([KEEPS], own, "", 1500), null);
});

// ---------- Harbourline-shaped schedule, GBP ----------
test("stated case: Grace's compound fracture is 2% of GBP 20,000 doubled, GBP 800, within the GBP 1,500 maximum", () => {
  const a = ask(fractureSchedule(), "Grace Okafor", /Fracture/, "It was a compound fracture.", TURNS);
  assert.deepEqual(a.amounts, ["£800"]);
  assert.match(a.basis, /2% of Grace Okafor's sum insured of £20,000 .* is £400, paid at double .*compound fracture.*: £800, within its maximum of £1,500/);
});
test("case not stated: Grace's fracture stays GBP 400 and Daniel's stays up to GBP 1,500", () => {
  assert.deepEqual(ask(fractureSchedule(), "Grace Okafor", /Fracture/, TURNS[1], [TURNS[0]]).amounts, ["£400"]);
  assert.deepEqual(ask(fractureSchedule(), "Daniel Okafor", /Fracture/, TURNS[0]).amounts, ["Up to £1,500"]);
});
test("a negated case is not stated", () => {
  assert.deepEqual(ask(fractureSchedule(), "Grace Okafor", /Fracture/, "It was not a compound fracture.", TURNS).amounts, ["£400"]);
});
test("the maximum the condition keeps is respected: 5% of GBP 80,000 doubled is up to GBP 1,500; 5% of GBP 20,000 doubled too", () => {
  assert.deepEqual(ask(fractureSchedule(KEEPS, 5), "Daniel Okafor", /Fracture/, "Daniel has a compound fracture of the leg.").amounts, ["Up to £1,500"]);
  const a = ask(fractureSchedule(KEEPS, 5), "Grace Okafor", /Fracture/, "Grace has a compound fracture of the leg.");
  assert.deepEqual(a.amounts, ["Up to £1,500"]);
  assert.match(a.basis, /is £1,000, paid at double .* is £2,000, more than the most it pays, so up to £1,500/);
});
test("a condition silent on the maximum: doubled below it is shown, doubled above it gives no amount and says one was left out", () => {
  const silent = "Note (a): a compound fracture is paid at double the Section 3 amount.";
  assert.deepEqual(ask(fractureSchedule(silent), "Grace Okafor", /Fracture/, "It was a compound fracture.", TURNS).amounts, ["£800"]);
  const a = ask(fractureSchedule(silent, 5), "Grace Okafor", /Fracture/, "It was a compound fracture.", TURNS);
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
});
test("control: a 'doubled' condition about something else is not triggered by unrelated words", () => {
  const other = "Note (a): the benefit is doubled if the accident happens on public transport.";
  for (const q of ["Grace broke her arm falling down the stairs at home.", "Grace broke her arm in a public park.", "It was a compound fracture."])
    assert.deepEqual(ask(fractureSchedule(other), "Grace Okafor", /Fracture/, q).amounts, ["£400"], q);
  assert.deepEqual(ask(fractureSchedule(other), "Grace Okafor", /Fracture/, "Grace broke her arm when the bus braked; she was on public transport.").amounts, ["£800"]);
});
test("control: a row with no such condition never changes when the case is said", () => {
  assert.deepEqual(ask(fractureSchedule(), "Grace Okafor", /Burns/, "Grace has a compound fracture and burns.").amounts, ["£2,000"]);
});

// ---------- Printed amount, MYR ----------
const AHMAD: Person = { name: "Ahmad Bin Ali", relationship: "self", line: "Ahmad Bin Ali\tPolicyholder\tRM 150,000", sum: 150000 };
function printedSchedule() {
  const line = "5\tBurns\tRM 1,000 per accident (note b)", note = "Note (b): third-degree burns are paid at double the Section 5 amount.";
  return schedule([AHMAD], [line, note], [ben({ section: "5", benefit: "Burns", pays: "amount", value: 1000, quote: line, conditions: [note] })], "Keluarga Accident Plan");
}
test("a printed amount whose multiple cannot be worked out by the checks shows no amount in the stated case, unsure is none", () => {
  const a = ask(printedSchedule(), "Ahmad Bin Ali", /Burns/, "Ahmad has third-degree burns on his hand.");
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
  assert.deepEqual(ask(printedSchedule(), "Ahmad Bin Ali", /Burns/, "Ahmad burnt his hand on the stove.").amounts, ["RM1,000"]);
});

console.log(`multiplier-test: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);
