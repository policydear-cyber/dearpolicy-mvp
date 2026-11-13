/** Scripted tests: a row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid
 * at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident") is applied only when the household's
 * own words state that case plainly for this person, and never past the printed maximum (lib/benefit-table/multiplier.ts).
 * Harbourline test, 13 Nov: "It was a compound fracture." still showed the single 2% of Grace's sum (GBP 400) beside prose
 * saying it is doubled. Three outcomes, main's card by default (PR #472 gate, H1-H6 each a case below):
 * - apply: the current message (or an earlier one naming this person) states the case plainly; the note is plain and this
 *   row's: the share times the multiple, within the printed maximum, with the condition in the working;
 * - unsure: the case is named but not plainly for this person (another member, a negation, contrast, question or "if"), or the
 *   note is not plain ("up to double", "not doubled"), or the amount cannot be worked out with it: no amount, the note said
 *   as a condition, and the household hears an amount was left out;
 * - as before: the case never named, named only earlier about another member, a note for another section, a note keyed on
 *   who the person is (age, children, "both"), an intensive-care note where an intensive-care row exists.
 * No model, database or network.
 *   npm run benefit-table:multiplier-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import { caseWords, multipleIn } from "@/lib/benefit-table/multiplier";
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
/** The model's reply naming one row, through the row step, the chat's checks and the label check, as the app's turn does.
 * `earlier` is the household's earlier messages in the order they were sent; the app passes them latest first.
 * `checksHear` replaces what the checks are given as the household's words (to test that they decide again). */
function ask(h: ReturnType<typeof schedule>, person: string, benefit: RegExp, question: string, earlier: string[] = [], checksHear?: string[]) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit) && r.figure.kind !== "none");
  assert.ok(row, `no row for ${person} ${benefit}`);
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" } }] };
  const before = [...earlier].reverse();
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-13T04:00:00Z"), question, before);
  const { answer, report } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, checksHear ?? [question, ...before], new Set(fromRows.report.labels), fromRows.report.figures ?? []);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const cards = kept.filter((s) => s.amount && s.personName === person);
  return { amounts: cards.map((s) => s.amount!.text), basis: cards[0]?.basis ?? "", leftOut: fromRows.report.dropped.length > 0 || report.dropped.some((d) => d.kind === "amount"),
    points: kept.filter((s) => !s.amount).map((s) => s.text) };
}

const GRACE: Person = { name: "Grace Okafor", relationship: "spouse", line: "Grace Okafor\tSpouse\tGBP 20,000", sum: 20000 };
const DANIEL: Person = { name: "Daniel Okafor", relationship: "self", line: "Daniel Okafor\tPolicyholder\tGBP 80,000", sum: 80000 };
const FRACTURE = "3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)";
const KEEPS = "Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident.";
const BURNS = "4\tBurns\t10% of the Sum Insured";
function fractureSchedule(note = KEEPS, pct = 2, people = [DANIEL, GRACE], burnsNote: string | null = null) {
  const line = FRACTURE.replace("2%", `${pct}%`);
  return schedule(people, [line, note, BURNS], [
    ben({ section: "3", benefit: "Fracture of arm, wrist or leg", pays: "percent", value: pct, percentOf: "sum_insured", quote: line, cap: 1500, capQuote: "maximum GBP 1,500 per accident",
      conditions: [note] }),
    ben({ section: "4", benefit: "Burns", pays: "percent", value: 10, percentOf: "sum_insured", quote: BURNS, conditions: burnsNote ? [burnsNote] : [] }),
  ]);
}
const TURNS = ["Daniel broke his arm playing football. What can we claim?", "Actually it was Grace, not Daniel."];
const G = (note: string, q: string, earlier: string[] = [], pct = 2) => ask(fractureSchedule(note, pct), "Grace Okafor", /Fracture/, q, earlier);

// ---------- Reading the note ----------
test("the multiple is read from the words of the amount only", () => {
  const cases: [string, number | null][] = [
    [KEEPS, 2], ["The benefit is doubled while travelling on public transport.", 2], ["A fracture of the skull is paid at treble the amount.", 3],
    ["For a fracture of the skull or spine, three times the Section 3 amount is paid.", 3], ["Burns to the face: 150% of the Section 4 amount.", 1.5],
    ["A hairline fracture is paid at half the amount.", 0.5], ["A private room or a double room in hospital.", null], ["2% of the Sum Insured per fracture", null],
    ["100% of the benefit is paid.", null], ["This benefit cannot be claimed twice for the same injury or for the same benefit.", null], ["Paid once, or two times in a policy year.", null],
    ["The fracture must be confirmed by X-ray.", null]];
  for (const [text, want] of cases) { const m = multipleIn(text); assert.equal(m && m !== "unsure" ? m.times : m, want, text); }
});
test("H4: 'up to double', 'at most twice' and 'not doubled' are not plain multiples", () => {
  for (const t of ["a compound fracture is paid up to double the Section 3 amount, still subject to the GBP 1,500 maximum.", "a compound fracture is paid at most twice the amount.",
    "the Section 3 amount is not doubled for a compound fracture.", "the amount is doubled for a compound fracture, except a fracture of a finger."]) {
    const m = multipleIn(t);
    assert.ok(m && m !== "unsure" && !m.plain, t);
  }
  const m = multipleIn(KEEPS);
  assert.ok(m && m !== "unsure" && m.plain);
});
test("H3: the case keeps its digits and a note keyed on who the person is, or a count, is a trait", () => {
  const own = "Fracture of arm, wrist or leg\n" + FRACTURE;
  assert.deepEqual(caseWords((multipleIn(KEEPS) as { rest: string }).rest, own), [["compound"]]);
  for (const t of ["the Section 3 amount is paid at half for an insured person aged 70 or over.", "the Section 3 amount is doubled for insured children.",
    "payable twice if both arms are fractured.", "doubled for an adult insured person.", "doubled for a fracture of 2 bones."])
    assert.equal(caseWords((multipleIn(t) as { rest: string }).rest, own), "trait", t);
});

// ---------- Apply ----------
test("stated case: Grace's compound fracture is 2% of GBP 20,000 doubled, GBP 800, within the GBP 1,500 maximum", () => {
  const a = G(KEEPS, "It was a compound fracture.", TURNS);
  assert.deepEqual(a.amounts, ["£800"]);
  assert.match(a.basis, /2% of Grace Okafor's sum insured of £20,000 .* is £400, paid at double .*compound fracture.*: £800, within its maximum of £1,500/);
});
test("a case stated for this person in an earlier message of the claim is carried", () => {
  assert.deepEqual(G(KEEPS, "How much can we claim for it?", ["Grace broke her arm, it is a compound fracture."]).amounts, ["£800"]);
});
test("case not stated: Grace's fracture stays GBP 400 and Daniel's stays up to GBP 1,500", () => {
  assert.deepEqual(G(KEEPS, TURNS[1], [TURNS[0]]).amounts, ["£400"]);
  assert.deepEqual(ask(fractureSchedule(), "Daniel Okafor", /Fracture/, TURNS[0]).amounts, ["Up to £1,500"]);
});
test("the maximum the condition keeps is respected: 5% of GBP 80,000 doubled is up to GBP 1,500; 5% of GBP 20,000 doubled too", () => {
  assert.deepEqual(ask(fractureSchedule(KEEPS, 5), "Daniel Okafor", /Fracture/, "Daniel has a compound fracture of the leg.").amounts, ["Up to £1,500"]);
  const a = G(KEEPS, "Grace has a compound fracture of the leg.", [], 5);
  assert.deepEqual(a.amounts, ["Up to £1,500"]);
  assert.match(a.basis, /is £1,000, paid at double .* is £2,000, more than the most it pays, so up to £1,500/);
});
test("a condition silent on the maximum: doubled below it is shown, doubled above it gives no amount and says one was left out", () => {
  const silent = "Note (a): a compound fracture is paid at double the Section 3 amount.";
  assert.deepEqual(G(silent, "It was a compound fracture.", TURNS).amounts, ["£800"]);
  const a = G(silent, "It was a compound fracture.", TURNS, 5);
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
});
test("control: a 'doubled' condition about something else is not triggered by unrelated or partial words", () => {
  const other = "Note (a): the benefit is doubled if the accident happens on public transport.";
  for (const q of ["Grace broke her arm falling down the stairs at home.", "Grace broke her arm in a public park.", "It was a compound fracture."])
    assert.deepEqual(G(other, q).amounts, ["£400"], q);
  assert.deepEqual(G(other, "Grace broke her arm when the bus braked; she was on public transport.").amounts, ["£800"]);
});
test("control: a row with no such condition never changes when the case is said", () => {
  assert.deepEqual(ask(fractureSchedule(), "Grace Okafor", /Burns/, "Grace has a compound fracture and burns.").amounts, ["£2,000"]);
});
test("the checks decide again from the household's words: a server figure for a case they did not hear gives no amount", () => {
  const a = ask(fractureSchedule(), "Grace Okafor", /Fracture/, "It was a compound fracture.", TURNS, ["How much can we claim?"]);
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
});

// ---------- H1: whose case, which message ----------
test("H1: a case named earlier about another member leaves the card as before", () => {
  assert.deepEqual(G(KEEPS, "Now Grace broke her wrist, how much?", ["Daniel had a compound fracture last year, already claimed."]).amounts, ["£400"]);
  const finger = "Note (a): the amount is halved for a fracture of a finger or toe.";
  assert.deepEqual(G(finger, "Grace broke her wrist.", ["Daniel hurt his finger last week."]).amounts, ["£400"]);
});
test("H1: a case named in the current message about another member is unsure: no amount, the note said, an amount left out", () => {
  const a = G(KEEPS, "Daniel had a compound fracture last year. Now Grace has a simple fracture of the wrist.");
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
  assert.ok(a.points.some((p) => /compound fracture is paid at double/.test(p)), JSON.stringify(a.points));
});
test("H1: a case named earlier by no one in particular is unsure, never applied", () => {
  const abroad = "Note (a): the amount is doubled if the accident occurs abroad.";
  const a = G(abroad, "Grace broke her arm at home.", ["We live abroad in Spain."]);
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
});

// ---------- H2: negation, contrast, hypotheticals ----------
test("H2: a negated, contrasted or hypothetical case is unsure: never the doubled amount", () => {
  for (const q of ["It was not a compound fracture.", "The doctor ruled out a compound fracture.", "They checked whether it was compound but it is a simple fracture.",
    "Would it pay more if it turned out to be a compound fracture? We don't know yet."]) {
    const a = G(KEEPS, q, TURNS);
    assert.deepEqual(a.amounts, [], q);
    assert.ok(a.leftOut, q);
  }
});

// ---------- H3: traits ----------
test("H3: notes keyed on age, children or a count never apply: the card is what it is when the household says nothing of it", () => {
  for (const [note, q] of [["Note (a): the Section 3 amount is paid at half for an insured person aged 70 or over.", "Grace fell over and broke her wrist."],
    ["Note (a): the Section 3 amount is doubled for insured children.", "Grace broke her arm while playing with the children."],
    ["Note (a): payable twice if both arms are fractured.", "Grace fractured her arm; both children are fine."]] as const)
    assert.deepEqual(G(note, q).amounts, G(note, "Grace broke her arm.").amounts, q);
  // The age and count notes do not stop the card on their own: it is GBP 400 as on main. (A row whose note names children is
  // refused by the checks' kind-of-life rule whatever the household says, as on main.)
  assert.deepEqual(G("Note (a): the Section 3 amount is paid at half for an insured person aged 70 or over.", "Grace fell over and broke her wrist.").amounts, ["£400"]);
  assert.deepEqual(G("Note (a): payable twice if both arms are fractured.", "Grace fractured her arm; both children are fine.").amounts, ["£400"]);
});

// ---------- H4: the note's own wording ----------
test("H4: 'up to double' or 'not doubled' with the case named gives no amount, never an exact doubled one", () => {
  for (const note of ["Note (a): a compound fracture is paid up to double the Section 3 amount, still subject to the GBP 1,500 maximum per accident.",
    "Note (a): the Section 3 amount is not doubled for a compound fracture."]) {
    const a = G(note, "It was a compound fracture.", TURNS);
    assert.deepEqual(a.amounts, [], note);
    assert.ok(a.leftOut, note);
  }
});

// ---------- H5: another section's note ----------
test("H5: a note for Section 3 copied onto the Burns row (Section 4) leaves Burns as before", () => {
  const note = "Note (a): a compound fracture is paid at double the Section 3 amount.";
  const h = fractureSchedule(note, 2, [DANIEL, GRACE], note);
  assert.deepEqual(ask(h, "Grace Okafor", /Burns/, "Grace has a compound fracture and burns to her hand.").amounts, ["£2,000"]);
  assert.deepEqual(ask(h, "Grace Okafor", /Fracture/, "Grace has a compound fracture and burns to her hand.").amounts, ["£800"]);
});

// ---------- H6: printed and daily amounts ----------
const AHMAD: Person = { name: "Ahmad Bin Ali", relationship: "self", line: "Ahmad Bin Ali\tPolicyholder\tRM 150,000", sum: 150000 };
const SITI: Person = { name: "Siti Binti Omar", relationship: "spouse", line: "Siti Binti Omar\tSpouse\tRM 100,000", sum: 100000 };
function printedSchedule() {
  const line = "5\tBurns\tRM 1,000 per accident (note b)", note = "Note (b): third-degree burns are paid at double the Section 5 amount.";
  return schedule([AHMAD], [line, note], [ben({ section: "5", benefit: "Burns", pays: "amount", value: 1000, quote: line, conditions: [note] })], "Keluarga Accident Plan");
}
test("a printed amount whose multiple cannot be worked out shows no amount in the stated case; as before otherwise", () => {
  const a = ask(printedSchedule(), "Ahmad Bin Ali", /Burns/, "Ahmad has third-degree burns on his hand.");
  assert.deepEqual(a.amounts, []);
  assert.ok(a.leftOut);
  assert.deepEqual(ask(printedSchedule(), "Ahmad Bin Ali", /Burns/, "Ahmad burnt his hand on the stove.").amounts, ["RM1,000"]);
});
test("H6: a daily amount is never dropped for a note keyed on age", () => {
  const line = "6\tHospital income\tRM 100 per day in hospital", note = "Note (c): paid at half for an insured person aged 70 or over.";
  const h = schedule([SITI], [line, note], [ben({ section: "6", benefit: "Hospital income", pays: "per_day", value: 100, quote: line, conditions: [note] })], "Keluarga Accident Plan");
  assert.ok(ask(h, "Siti Binti Omar", /Hospital income/, "Siti fell over and was in hospital 3 days.").amounts.includes("RM100"));
});
test("H6: the ward rate stays beside its intensive-care row when the stay was in intensive care", () => {
  const people: Person[] = [{ name: "Siti Tan", relationship: "self", line: "Siti Tan\tPolicyholder\tSGD 100,000", sum: 100000 }];
  const line = "2\tHospital income\tS$200 per day (the daily amount is doubled if hospitalised in intensive care, capped at S$400 per day)";
  const h = schedule(people, [line], [ben({ section: "2", benefit: "Hospital income", pays: "per_day", value: 200, quote: line,
    conditions: ["the daily amount is doubled if hospitalised in intensive care, capped at S$400 per day"] })], "Hospital Cash Plan");
  assert.ok(h.rows.some((r) => /intensive care/i.test(r.benefit)), "an intensive-care row");
  const a = ask(h, "Siti Tan", /^Hospital income$/, "Siti was hospitalised in intensive care for 3 days. What is the daily amount?");
  assert.ok(a.amounts.includes("S$200"), JSON.stringify(a.amounts));
});

console.log(`multiplier-test: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);
