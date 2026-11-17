/** Scripted tests: a fracture row that pays for one kind of fracture ("(Other Fracture)", "Simple Fracture ...") is given no
 * amount when the person's documents pay another kind differently and the household has not said which kind it was; the
 * answer names the row's kind and asks which kind it was (live walk 17 Nov: "broke his arm" led with S$120,000 for an
 * "Other Fracture" while the simple-fracture row paid far less). Made-up households only. No model, database or network.
 *   npm run benefit-table:fracture-kind-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import { kindsSaid, rowFractureKind } from "@/lib/benefit-table/fracture-kind";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer } from "@/lib/simple-chat/verify";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const NOW = new Date("2026-11-17T04:00:00Z");
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const ACC = "55555555-5555-4555-8555-555555555555";
const DOC = "eeeeeeee-0000-4000-8000-000000000091";
const NAME = "Rowan Hartley";
const ben = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });

function household(lines: string[], benefits: Record<string, unknown>[]) {
  const product = "Group Personal Accident";
  const page1 = `Kestrel Assurance Ltd\n${product.toUpperCase()} - CERTIFICATE\nInsured person\tSum Insured\n${NAME}\tS$600,000`;
  const page2 = `TABLE OF BENEFITS\nBenefit\tAmount payable\n${lines.join("\n")}`;
  const d: Household["documents"][number] = { policyId: DOC, name: `${product}.pdf`, insurer: "Kestrel Assurance Ltd", productName: product, policyNumber: null, documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: [NAME], supersededAt: null,
    processingStatus: "ready", pages: [page1, page2].map((text, i) => ({ page: i + 1, text })) };
  const house: Household = { accountId: ACC, members: [{ name: NAME, relationship: "self" }], documents: [d] };
  const family: FamilyMember[] = [{ id: "m0", display_name: NAME, relationship: "self" }];
  const src: SourceDoc = { id: d.policyId, name: d.name, readable: true, pages: d.pages };
  const reading = checkReading(src, { document: { kind: "personal_proof", product, insurer: d.insurer, namedPeople: [NAME], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: NAME, product, cover: product, plan: null, riderOf: null, policyNumber: null, premium: null, premiumFrequency: null, asOf: null,
      startDate: null, endDate: null, page: 1, sumInsured: 600000, quote: `${NAME}\tS$600,000` }], benefits });
  const key = coverKeyOf({ product, cover: product, plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: key, why: "the certificate's table of benefits" }));
  const table = assembleTable([reading], family, links, [], NOW);
  return { house, rows: chatRows(table, house) };
}
const OTHER = "Arm, Elbow, Wrist or Ribs (Other Fracture)\t20% of the Sum Insured";
const SIMPLE = "Simple Fracture: Arm, Elbow, Wrist or Ribs\tS$1,250";
const both = () => household([OTHER, SIMPLE], [
  ben({ section: "Simple Fracture or Other Fracture", benefit: "Arm, Elbow, Wrist or Ribs (Other Fracture)", pays: "percent", value: 20, percentOf: "sum_insured", quote: OTHER }),
  ben({ section: "Simple Fracture", benefit: "Arm, Elbow, Wrist or Ribs", pays: "amount", value: 1250, currency: "SGD", quote: SIMPLE }),
]);
function answer(h: ReturnType<typeof household>, question: string, rowsAsked: RegExp[], modelQuestion: string | null = null) {
  const statements = rowsAsked.map((re) => {
    const row = h.rows.find((r) => re.test([r.section, r.benefit].filter(Boolean).join(": ")));
    assert.ok(row, `no row ${re}: ${h.rows.map((r) => r.benefit).join(" | ")}`);
    return { kind: "amount", text: row.benefit, person: NAME, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null,
      row: row.id, rowBenefit: row.benefit, eventFit: "on_list", waiting: null, period: { from: "", to: "", eventOn: "" }, multiplierNote: "" };
  });
  const raw = { bottomLine: `${NAME}'s broken arm is covered by the fracture benefit.`, nextSteps: [], question: modelQuestion, statements };
  const fromRows = amountsFromRows(raw, h.rows, h.house, NOW, question, [], false);
  const { answer: a } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(a.statements ?? [], fromRows.report);
  return { amounts: kept.filter((s) => s.amount).map((s) => s.amount!.text), points: kept.filter((s) => !s.amount).map((s) => s.text), question: a.questions?.map((q) => q.text).join(" ") ?? "", report: fromRows.report };
}

test("rowFractureKind: a closing kind bracket, or one kind in the name; two kinds with no bracket is none", () => {
  assert.equal(rowFractureKind("Simple Fracture or Other Fracture: Arm, Elbow, Wrist or Ribs (Other Fracture)"), "other");
  assert.equal(rowFractureKind("Simple Fracture due to Accident: Arm, Elbow, Wrist or Ribs"), "simple");
  assert.equal(rowFractureKind("Simple or Compound Fracture: Wrist (Compound)"), "compound");
  assert.equal(rowFractureKind("Simple Fracture or Other Fracture: Arm"), null);
  assert.equal(rowFractureKind("Fracture of the Hip"), null);
  assert.equal(rowFractureKind("Hospital cash (Other)"), null);
  assert.equal(rowFractureKind("Accidental Fracture (Other)"), null);
});
test("kindsSaid: only a kind said of the fracture itself", () => {
  assert.deepEqual([...kindsSaid("He had a simple fracture of the wrist")], ["simple"]);
  assert.deepEqual([...kindsSaid("it was a compound break")], ["compound"]);
  assert.deepEqual([...kindsSaid("the fracture was simple")], ["simple"]);
  assert.deepEqual([...kindsSaid("He broke his arm. Any other benefits?")], []);
});
test("live walk 17 Nov shape: no kind said, two kinds printed: both amounts as alternatives, smaller first, each named, one question", () => {
  for (const asked of [[/Other Fracture/, /^Simple Fracture: /], [/Other Fracture/]]) {
    const a = answer(both(), "Rowan broke his arm in an accident. What can he claim?", asked);
    assert.deepEqual(a.amounts, ["S$1,250", "S$120,000"], String(asked));
    assert.ok(a.points.some((t) => /this amount is for what the policy calls "Other Fracture"/.test(t)), a.points.join(" | "));
    assert.ok(a.points.some((t) => /this amount is for what the policy calls "Simple Fracture"/.test(t)), a.points.join(" | "));
    assert.match(a.question, /Which kind of fracture did Rowan Hartley have: "Simple Fracture" or "Other Fracture"\?/);
  }
});
test("the kind said: every kind still shown, the said kind first and named so, no question (Critic #518 round 2)", () => {
  const simple = answer(both(), "Rowan had a simple fracture of his arm. What can he claim?", [/Other Fracture/, /^Simple Fracture: /]);
  assert.deepEqual(simple.amounts, ["S$1,250", "S$120,000"]);
  assert.ok(simple.points.some((t) => /"Simple Fracture", the kind you described/.test(t)), simple.points.join(" | "));
  assert.doesNotMatch(simple.question, /Which kind/);
  const other = answer(both(), "Rowan had an other fracture of his arm. What can he claim?", [/Other Fracture/]);
  assert.deepEqual(other.amounts, ["S$120,000", "S$1,250"]);
  // Misread kinds cost nothing: both amounts stay.
  for (const q of ["The X-ray doesn't look like a simple fracture.", "The doctor ruled out a simple fracture.", "Last year he had a simple fracture of his leg."])
    assert.equal(answer(both(), `Rowan broke his arm. ${q}`, [/Other Fracture/]).amounts.length, 2, q);
});
test("a kind the documents do not print says nothing: both as alternatives", () => {
  const a = answer(both(), "Rowan had a compound fracture of his arm. What can he claim?", [/Other Fracture/]);
  assert.deepEqual(a.amounts, ["S$1,250", "S$120,000"]);
});
test("Critic #518 H1: same-label cards keep their own kind's point, smaller first", () => {
  const h = household(["Simple Fracture: Arm\tS$1,000", "Other Fracture: Arm\tS$5,000"], [
    ben({ section: "Simple Fracture", benefit: "Arm", pays: "amount", value: 1000, currency: "SGD", quote: "Simple Fracture: Arm\tS$1,000" }),
    ben({ section: "Other Fracture", benefit: "Arm", pays: "amount", value: 5000, currency: "SGD", quote: "Other Fracture: Arm\tS$5,000" })]);
  const a = answer(h, "Rowan broke his arm. What can he claim?", [/^Other Fracture: /]);
  assert.deepEqual(a.amounts, ["S$1,000", "S$5,000"]);
  const kinds = a.points.filter((t) => /this amount is for/.test(t)).map((t) => /"(\w+) Fracture"/.exec(t)![1]);
  assert.deepEqual(kinds, ["Simple", "Other"]);
});
test("Critic #518 H2, H3: a denied or unsure kind is not said", () => {
  for (const q of ["It was not a simple fracture.", "It was not just a simple break.", "I don't know if it was a simple fracture or not.",
    "Not sure whether it was a simple fracture.", "Was it a simple fracture or an other fracture?"]) {
    assert.deepEqual([...kindsSaid(q)], [], q);
    assert.deepEqual(answer(both(), `Rowan broke his arm. ${q}`, [/Other Fracture/]).amounts, ["S$1,250", "S$120,000"], q);
  }
});
test("Critic #518 M1, M2: kinds and alternatives are per bones", () => {
  const h = household([OTHER, SIMPLE, "Compound Fracture: Skull\tS$50,000"], [
    ben({ section: "Simple Fracture or Other Fracture", benefit: "Arm, Elbow, Wrist or Ribs (Other Fracture)", pays: "percent", value: 20, percentOf: "sum_insured", quote: OTHER }),
    ben({ section: "Simple Fracture", benefit: "Arm, Elbow, Wrist or Ribs", pays: "amount", value: 1250, currency: "SGD", quote: SIMPLE }),
    ben({ section: "Compound Fracture", benefit: "Skull", pays: "amount", value: 50000, currency: "SGD", quote: "Compound Fracture: Skull\tS$50,000" })]);
  const a = answer(h, "Rowan broke his arm and fractured his skull. What can he claim?", [/Other Fracture/, /Skull/]);
  assert.ok(a.amounts.includes("S$50,000"), a.amounts.join(" "));
  assert.doesNotMatch(a.question, /Compound/);
  assert.match(a.question, /"Simple Fracture" or "Other Fracture"/);
});
test("one kind printed only: the amount as before", () => {
  const h = household([OTHER.replace("(Other Fracture)", "")], [ben({ section: "Fracture", benefit: "Arm, Elbow, Wrist or Ribs", pays: "percent", value: 20, percentOf: "sum_insured", quote: OTHER.replace("(Other Fracture)", "") })]);
  assert.deepEqual(answer(h, "Rowan broke his arm. What can he claim?", [/Arm/]).amounts, ["S$120,000"]);
});
test("the model's own question is kept", () => {
  const a = answer(both(), "Rowan broke his arm in an accident. What can he claim?", [/Other Fracture/], "Was Rowan admitted to hospital?");
  assert.match(a.question, /admitted/);
});

console.log(`fracture-kind: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length) process.exit(1);
