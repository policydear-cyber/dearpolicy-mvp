/** Scripted tests: a row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid
 * at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident"). Harbourline test, 13 Nov: "It was a
 * compound fracture." still showed the single 2% of Grace's sum (GBP 400) beside prose saying it is doubled.
 * The model names the note in an amount statement's "multiplierNote" (here its reply is scripted). The card keeps the row's
 * single amount and adds the multiple as a condition in the note's own printed words, with its figure within the printed
 * maximum ('Note (a) on page 2 says: "...". If that applies, this pays GBP 800 (double)'); the chat's checks
 * read the note again. The line is true whoever the case is, so the household's words are never read for it (PR #472 round
 * 7: seven rounds of a hand-written reader of who and when kept leaking). Only the note's structure is checked: one of the
 * row's own conditions, one plain multiple (no negation, "up to", other section, other row's case, trait). The gate's
 * who/when cases with the note set wrongly never show a flat GBP 800; no note named gives main's card, word for word.
 * No model, database or network.
 *   npm run benefit-table:multiplier-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts, renderTable } from "@/lib/benefit-table/chat";
import { caseWords, multipleIn, sameNote } from "@/lib/benefit-table/multiplier";
import type { Household } from "@/lib/simple-chat/library";
import { TABLE_ANSWER_SCHEMA } from "@/lib/simple-chat/prompt";
import { readModelAnswer, verifyAnswer, type ServerFigure } from "@/lib/simple-chat/verify";

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
/** The scripted model's reply naming one row (with `note` as its "multiplierNote"; undefined leaves the field out, as an old
 * answer), through the row step, the chat's checks and the label check, as the app's turn does. `earlier` is the
 * household's earlier messages in the order sent; the app passes them latest first. `tamper` changes the server figures
 * before the checks see them (to test that they read the note again). `forNobody`: the chat asks for no one in particular. */
function ask(h: ReturnType<typeof schedule>, person: string, benefit: RegExp, question: string, note?: string, earlier: string[] = [],
  o: { tamper?: (f: ServerFigure) => ServerFigure; forNobody?: boolean } = {}) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit) && r.figure.kind !== "none");
  assert.ok(row, `no row for ${person} ${benefit}`);
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" },
    ...(note !== undefined ? { multiplierNote: note } : {}) }] };
  const before = [...earlier].reverse();
  const fromRows = amountsFromRows(raw, h.rows, h.house, new Date("2026-11-13T04:00:00Z"), question, before, !!o.forNobody);
  const figures = (fromRows.report.figures ?? []).map((f) => o.tamper ? o.tamper(f) : f);
  const { answer, report } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question, ...before], new Set(fromRows.report.labels), figures);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const all = kept.filter((s) => s.amount);
  const cards = all.filter((s) => s.personName === person);
  return { amounts: cards.map((s) => s.amount!.text), basis: cards[0]?.basis ?? "", leftOut: fromRows.report.dropped.length > 0 || report.dropped.some((d) => d.kind === "amount"),
    others: all.filter((s) => s.personName !== person).map((s) => ({ person: s.personName, amount: s.amount!.text, basis: s.basis ?? "" })),
    points: kept.filter((s) => !s.amount).map((s) => s.text), kept };
}

const GRACE: Person = { name: "Grace Okafor", relationship: "spouse", line: "Grace Okafor\tSpouse\tGBP 20,000", sum: 20000 };
const DANIEL: Person = { name: "Daniel Okafor", relationship: "self", line: "Daniel Okafor\tPolicyholder\tGBP 80,000", sum: 80000 };
const AMARA: Person = { name: "Amara Okafor", relationship: "child", line: "Amara Okafor\tChild\tGBP 10,000", sum: 10000 };
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
/** Grace's fracture card for the household's question, with the scripted model naming `named` (or no note). */
const G = (note: string, q: string, named?: string, earlier: string[] = [], pct = 2, people = [DANIEL, GRACE]) => ask(fractureSchedule(note, pct, people), "Grace Okafor", /Fracture/, q, named, earlier);
/** The conditional line the card adds for a named note: 'Note (a) on page 2 says: "<note>". If that applies, this pays £800
 * (double)' (the note's own label, else "The policy (page 2) says"). */
const IF = / on page 2 says: "| \(page 2\) says: "/;
const ifLine = (note: string, rest: string) => {
  const label = /^(Note(?: \([a-z]\))?): /.exec(note);
  return `. ${label ? `${label[1]} on page 2 says` : "The policy (page 2) says"}: "${note.slice(label ? label[0].length : 0).trim().replace(/[.;]+$/, "")}". If that applies, ${rest}`;
};

const ABROAD = "Note (a): the amount is doubled if the accident occurs abroad.", FINGER = "Note (a): the amount is halved for a fracture of a finger or toe.";
const AGE = "Note (a): the Section 3 amount is paid at half for an insured person aged 70 or over.", BOTH = "Note (a): payable twice if both arms are fractured.";
const WORK = "Note (a): the amount is doubled if the accident happens at work.", PENSION = "Note (a): the amount is halved for pensioners.";
const KIDS = "Note (a): the Section 3 amount is doubled for insured children.";
const UPTO = "Note (a): a compound fracture is paid up to double the Section 3 amount, still subject to the GBP 1,500 maximum per accident.";
const NOTDBL = "Note (a): the Section 3 amount is not doubled for a compound fracture.";
const PT = "Note (a): the Section 3 amount is doubled while travelling on public transport.";

// ---------- The prompt and schema ----------
test("the table schema asks for multiplierNote as a plain string and the table's instruction explains it", () => {
  const items = TABLE_ANSWER_SCHEMA.properties.statements.items as unknown as { required: readonly string[]; properties: Record<string, { type?: unknown }> };
  assert.ok(items.required.includes("multiplierNote"));
  assert.equal(items.properties.multiplierNote.type, "string");
  const text = renderTable(fractureSchedule().rows);
  const rule = text.split("\n").find((l) => l.startsWith("On an amount statement, set \"multiplierNote\" to \"\" unless one of the row's own conditions pays a multiple"));
  assert.ok(rule, "the instruction");
  assert.match(rule!, /keeps the row's single amount/);
  assert.match(rule!, /never write that multiplied amount yourself/);
  // Its example is made up: never a household's own person or note.
  assert.doesNotMatch(rule!, /Grace|Daniel|compound|Section 3/);
  assert.match(text, /compound fracture is paid at double/, "the row's own note is in the table");
});
test("the prompt's own example: the single amount, and the multiple as its printed condition", () => {
  const TOMAS: Person = { name: "Tomas Rey", relationship: "self", line: "Tomas Rey\tPolicyholder\tEUR 50,000", sum: 50000 };
  const line = "1\tLoss of sight\t10% of the Sum Insured", note = "Note: loss of sight in both eyes is paid at twice the amount";
  const h = schedule([TOMAS], [line, note], [ben({ section: "1", benefit: "Loss of sight", pays: "percent", value: 10, percentOf: "sum_insured", quote: line, conditions: [note] })]);
  const a = ask(h, "Tomas Rey", /Loss of sight/, "Tomas lost the sight in both eyes in the accident.", note);
  assert.deepEqual(a.amounts, ["€5,000"]);
  assert.ok(a.basis.endsWith(ifLine(note, "this pays €10,000 (double)")), a.basis);
  assert.deepEqual(ask(h, "Tomas Rey", /Loss of sight/, "Tomas lost the sight in both eyes in the accident.", "").amounts, ["€5,000"]);
});

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
test("'up to double', 'at most twice' and 'not doubled' are not plain multiples", () => {
  for (const t of ["a compound fracture is paid up to double the Section 3 amount, still subject to the GBP 1,500 maximum.", "a compound fracture is paid at most twice the amount.",
    "the Section 3 amount is not doubled for a compound fracture.", "the amount is doubled for a compound fracture, except a fracture of a finger."]) {
    const m = multipleIn(t);
    assert.ok(m && m !== "unsure" && !m.plain, t);
  }
  const m = multipleIn(KEEPS);
  assert.ok(m && m !== "unsure" && m.plain);
});
test("the note's case words leave out the row's own words, sections and money", () => {
  assert.deepEqual(caseWords((multipleIn(KEEPS) as { rest: string }).rest, "Fracture of arm, wrist or leg\n" + FRACTURE), [["compound"]]);
});
test("the model's copy of a note matches the printed one without its mark, case, spacing or end stop", () => {
  assert.ok(sameNote("a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident", KEEPS));
  assert.ok(sameNote("NOTE (A): A compound  fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident.", KEEPS));
  assert.ok(!sameNote("a compound fracture is paid at double", KEEPS));
  assert.ok(!sameNote("", KEEPS));
});

// ---------- Note named: the single amount, and the multiple as a condition in the note's words ----------
test("note named on Grace's card: GBP 400, and 'if that applies, this pays GBP 800 (double)'", () => {
  const a = G(KEEPS, "It was a compound fracture.", KEEPS, TURNS);
  assert.deepEqual(a.amounts, ["£400"]);
  assert.ok(!a.leftOut);
  assert.match(a.basis, /^2% of Grace Okafor's sum insured of £20,000 \(.*, page 1\), within its maximum of £1,500\. Note \(a\) on page 2 says: "a compound fracture/);
  assert.ok(a.basis.endsWith(ifLine(KEEPS, "this pays £800 (double)")), a.basis);
  // The condition is the row's own printed words, never the household's.
  assert.doesNotMatch(a.basis, /It was a compound fracture|Actually/);
  // The model's copy without the note mark is the same note.
  assert.ok(IF.test(G(KEEPS, "It was a compound fracture.", KEEPS.replace("Note (a): ", ""), TURNS).basis));
});
test("a multiple above the maximum shows the maximum: 5% of GBP 20,000 doubled is up to GBP 1,500; a capped card stays capped", () => {
  const a = G(KEEPS, "Grace has a compound fracture of the leg.", KEEPS, [], 5);
  assert.deepEqual(a.amounts, ["£1,000"]);
  assert.ok(a.basis.endsWith(ifLine(KEEPS, "this pays £1,500 (double would be £2,000, more than the £1,500 maximum)")), a.basis);
  const d = ask(fractureSchedule(KEEPS, 5), "Daniel Okafor", /Fracture/, "Daniel has a compound fracture of the leg.", KEEPS);
  assert.deepEqual(d.amounts, ["Up to £1,500"]);
  assert.ok(d.basis.endsWith(ifLine(KEEPS, "this pays £1,500 (double would be £8,000, more than the £1,500 maximum)")), d.basis);
});
test("a note silent on the maximum: doubled within it is said; doubled above it is not (whether the maximum doubles is not printed)", () => {
  const silent = "Note (a): a compound fracture is paid at double the Section 3 amount.";
  const a = G(silent, "It was a compound fracture.", silent, TURNS);
  assert.deepEqual(a.amounts, ["£400"]);
  assert.ok(a.basis.endsWith(ifLine(silent, "this pays £800 (double)")), a.basis);
  const b = G(silent, "It was a compound fracture.", silent, TURNS, 5);
  assert.deepEqual(b.amounts, ["£1,000"]);
  assert.doesNotMatch(b.basis, IF);
});
test("no conditional line for a note that is not the row's, an 'up to' or negated one, or another section's: main's card", () => {
  const main = G(KEEPS, "It was a compound fracture.", "", TURNS);
  for (const wrong of ["a compound fracture is paid at double the amount", "Note (b): burns to the face are paid at double the Section 4 amount."]) {
    const a = G(KEEPS, "It was a compound fracture.", wrong, TURNS);
    assert.deepEqual(a.amounts, ["£400"], wrong);
    assert.equal(a.basis, main.basis, wrong);
  }
  for (const note of [UPTO, NOTDBL]) {
    const a = G(note, "It was a compound fracture.", note, TURNS);
    assert.deepEqual(a.amounts, ["£400"], note);
    assert.doesNotMatch(a.basis, IF, note);
  }
  const other = "Note (a): a compound fracture is paid at double the Section 3 amount.";
  const h = fractureSchedule(other, 2, [DANIEL, GRACE], other);
  const burns = ask(h, "Grace Okafor", /Burns/, "Grace has a compound fracture and burns to her hand.", other);
  assert.deepEqual(burns.amounts, ["£2,000"]);
  assert.doesNotMatch(burns.basis, IF);
  assert.ok(IF.test(ask(h, "Grace Okafor", /Fracture/, "Grace has a compound fracture and burns to her hand.", other).basis));
});
test("the note's shape: only a multiple of this row's own amount, a case, the maximum kept and 'per accident' get a line (round 8)", () => {
  const lined: [string, string][] = [
    ["Note (a): a compound fracture is paid at double the Section 3 amount, subject to the same limit.", "this pays £800 (double)"],
    ["Note (a): a compound fracture is paid at double the amount per fracture.", "this pays £800 (double)"],
    [FINGER, "this pays half: £200"],
    ["A compound fracture is paid at double the fracture benefit.", "this pays £800 (double)"],
  ];
  for (const [note, rest] of lined) {
    const a = G(note, "Grace has a compound fracture.", note);
    assert.deepEqual(a.amounts, ["£400"], note);
    assert.ok(a.basis.endsWith(ifLine(note, rest)), `${note}: ${a.basis}`);
  }
  for (const note of [
    "Note (a): a compound fracture is paid at double the Sum Insured.",                                                  // HIGH: another base
    "Note (a): a compound fracture is paid at double the amount, less any amount already paid for that fracture.",        // a deduction
    "Note (a): a compound fracture is paid at double the Section 3 amount, up to GBP 3,000 per accident.",                // its own cap
    "Note (a): a compound fracture is paid at double the Section 3 amount after 30 days in hospital, net of other claims.",
    "Note (a): a compound fracture is paid at double the burns amount.",                                                   // another row's amount
    "Note (a): a compound fracture is paid at double the Section 3 amount, provided it is reported within 7 days.",       // a further condition
    "Note (a): the sum insured is doubled for a compound fracture.",
  ]) {
    // Main's card, word for word (none for a note printing its own cap, as on main).
    const a = G(note, "Grace has a compound fracture.", note), main = G(note, "Grace has a compound fracture.", "");
    assert.equal(JSON.stringify(a.kept), JSON.stringify(main.kept), note);
    assert.doesNotMatch(a.basis, IF, note);
  }
  // A percentage note printed under a percentage row: the row's line then holds two percentages, so main's checks give no
  // card, and the note named changes nothing.
  const p150 = "Note (a): a compound fracture is paid at 150% of the Section 3 amount.";
  assert.equal(JSON.stringify(G(p150, "Grace has a compound fracture.", p150).kept), JSON.stringify(G(p150, "Grace has a compound fracture.", "").kept));
  // A row with no maximum, and a note with no label.
  const face = "burns to the face are paid at double the Section 4 amount.";
  // (printed on the page under the table, as the fracture row's line; the Burns row carries it)
  const b = ask(fractureSchedule(face, 2, [DANIEL, GRACE], face), "Grace Okafor", /Burns/, "Grace has burns to the face.", face);
  assert.deepEqual(b.amounts, ["£2,000"]);
  assert.ok(b.basis.endsWith(ifLine(face, "this pays £4,000 (double)")), b.basis);
});
test("round 9: the whole note is an allow-list (front included): a base, deduction or limit anywhere gives no line, main's card", () => {
  const refused = [
    "Note (a): a compound fracture is paid at double the Sum Insured.",
    "Note (a): a compound fracture is paid at double the amount, less any amount already paid for that fracture.",
    "Note (a): where the benefit is first reduced for age, a compound fracture is paid at double the amount.",
    "Note (a): after any earlier payment for the same accident, a compound fracture is paid at double the amount.",
    "Note (a): out of the remaining limit, a compound fracture is paid at double the amount.",
    "Note (a): a compound fracture is paid at double the amount of the remaining limit.",
    "Note (a): after the excess, a compound fracture is paid at double the amount.",
    "Note (a): subject to the excess, a compound fracture is paid at double the amount.",
    "Note (a): from the balance left after other claims, a compound fracture is paid at double the amount.",
    "Note (a): pro rata to the days in hospital, a compound fracture is paid at double the amount.",
    "Note (a): with a 20% co-payment, a compound fracture is paid at double the amount.",
    "Note (a): the daily hospital allowance is doubled for a compound fracture.",
    "Note (a): the death benefit is doubled for a compound fracture.",
    "Note (a): the lump sum is doubled for a compound fracture.",
    "Note (a): once only, a compound fracture is paid at double the amount.",
    "Note (a): for the first claim only, a compound fracture is paid at double the amount, the second at the normal amount.",
    "Note (a): a compound fracture is paid at double the amount instead of the burns benefit.",
    "Note (a): a compound fracture is paid at double the amount, shared between all injured persons.",
    "Note (a): a compound fracture is paid at double the amount, split equally between both arms.",
    "Note (a): a compound fracture is paid at double the amount in total for all fractures.",
    "Note (a): a compound fracture is paid at double the annual amount.",
    "Note (a): a compound fracture is paid at twice the child rate.",
    "Note (a): each further fracture in the same accident is paid at half the Section 3 amount.",
    "Note (a): the amount is doubled for any compound fracture.",
    "Note (a): the amount is doubled if a compound fracture happens after an earlier claim.",
    "Note (a): a compound open displaced fracture of the upper left arm bone is paid at double the amount.",
  ];
  for (const note of refused) for (const pct of [2, 5]) for (const [who, q] of [["Grace Okafor", "Grace has a compound fracture."], ["Daniel Okafor", "Daniel has a compound fracture."]]) {
    const h = fractureSchedule(note, pct);
    const a = ask(h, who, /Fracture/, q, note), main = ask(h, who, /Fracture/, q, "");
    assert.equal(JSON.stringify(a.kept), JSON.stringify(main.kept), `${note} ${pct}% ${who}`);
    assert.doesNotMatch(a.basis, IF, `${note} ${pct}% ${who}`);
  }
  const lined: [string, string][] = [
    [KEEPS, "this pays £800 (double)"], ["Note (a): a compound fracture is paid at double the Section 3 amount, subject to the same limit.", "this pays £800 (double)"],
    ["Note (a): a compound fracture is paid at double the Section 3 amount.", "this pays £800 (double)"], [FINGER, "this pays half: £200"],
    [WORK, "this pays £800 (double)"], [BOTH, "this pays £800 (double)"], ["Note (a): the Section 3 amount is doubled while travelling on public transport.", "this pays £800 (double)"],
    ["Note (a): fracture of arm, wrist or leg is doubled if the accident occurs abroad.", "this pays £800 (double)"],
  ];
  for (const [note, rest] of lined) {
    const a = G(note, "Grace has a compound fracture.", note);
    assert.deepEqual(a.amounts, ["£400"], note);
    assert.ok(a.basis.endsWith(ifLine(note, rest)), `${note}: ${a.basis}`);
  }
});
test("round 9: half of a share already above the maximum gets no line (of the share or of what is paid is not said)", () => {
  // Daniel: 2% of GBP 80,000 is GBP 1,600, above the GBP 1,500 maximum: his card is up to GBP 1,500.
  const a = ask(fractureSchedule(FINGER, 2), "Daniel Okafor", /Fracture/, "Daniel broke a finger.", FINGER);
  assert.deepEqual(a.amounts, ["Up to £1,500"]);
  assert.doesNotMatch(a.basis, IF);
  // Grace's share is below it: half is said.
  assert.ok(G(FINGER, "Grace broke a finger.", FINGER).basis.endsWith(ifLine(FINGER, "this pays half: £200")));
});
test("W4: a note with no section number copied onto Burns names the fracture row's case: no line on Burns; the fracture row has it", () => {
  const note = "Note (a): a compound fracture is paid at double the amount.";
  const h = fractureSchedule(note, 2, [DANIEL, GRACE], note);
  const b = ask(h, "Grace Okafor", /Burns/, "Grace has a compound fracture and burns.", note);
  assert.deepEqual(b.amounts, ["£2,000"]);
  assert.doesNotMatch(b.basis, IF);
  assert.ok(IF.test(ask(h, "Grace Okafor", /Fracture/, "Grace has a compound fracture and burns.", note).basis));
});
test("trait notes (age, children) never get a line: main's card, word for word", () => {
  for (const note of [AGE, KIDS]) {
    const q = "Grace broke her arm playing with the children; she is 72.";
    const a = G(note, q, note), main = G(note, q, "");
    assert.equal(JSON.stringify(a.kept), JSON.stringify(main.kept), note);
    assert.doesNotMatch(a.basis, IF, note);
  }
});
test("a printed amount a multiple cannot be worked out on stays as printed, with no line", () => {
  const AHMAD: Person = { name: "Ahmad Bin Ali", relationship: "self", line: "Ahmad Bin Ali\tPolicyholder\tRM 150,000", sum: 150000 };
  const line = "5\tBurns\tRM 1,000 per accident (note b)", note = "Note (b): third-degree burns are paid at double the Section 5 amount.";
  const h = schedule([AHMAD], [line, note], [ben({ section: "5", benefit: "Burns", pays: "amount", value: 1000, quote: line, conditions: [note] })], "Keluarga Accident Plan");
  assert.deepEqual(ask(h, "Ahmad Bin Ali", /Burns/, "Ahmad has third-degree burns on his hand.", note).amounts, ["RM1,000"]);
  assert.deepEqual(ask(h, "Ahmad Bin Ali", /Burns/, "Ahmad has third-degree burns on his hand.", "").amounts, ["RM1,000"]);
});
test("the checks read the note again: a figure whose note, page or multiple was changed gets no line, and its card stays", () => {
  const tampers: ((f: ServerFigure) => ServerFigure)[] = [
    (f) => ({ ...f, times: f.times && { ...f.times, times: 3 } }),
    (f) => ({ ...f, times: f.times && { ...f.times, page: 1 } }),
    (f) => ({ ...f, times: f.times && { ...f.times, quote: "a compound fracture is paid at treble the Section 3 amount" } }),
    (f) => ({ ...f, times: f.times && { ...f.times, quote: UPTO } }),
  ];
  for (const tamper of tampers) {
    const a = ask(fractureSchedule(), "Grace Okafor", /Fracture/, "It was a compound fracture.", KEEPS, TURNS, { tamper });
    assert.deepEqual(a.amounts, ["£400"]);
    assert.doesNotMatch(a.basis, IF);
  }
});

// ---------- Field absent or empty: main's card ----------
test("field absent (an old answer) or empty: main's card, word for word; Daniel's stays up to GBP 1,500", () => {
  const absent = G(KEEPS, "It was a compound fracture.", undefined, TURNS), empty = G(KEEPS, "It was a compound fracture.", "", TURNS);
  assert.deepEqual(absent.amounts, ["£400"]);
  assert.doesNotMatch(absent.basis, IF);
  assert.equal(JSON.stringify(absent.kept), JSON.stringify(empty.kept));
  assert.deepEqual(ask(fractureSchedule(), "Daniel Okafor", /Fracture/, TURNS[0]).amounts, ["Up to £1,500"]);
});
test("a row without such a note never changes", () => {
  assert.deepEqual(ask(fractureSchedule(), "Grace Okafor", /Burns/, "Grace has a compound fracture and burns.", "").amounts, ["£2,000"]);
});
test("an intensive-care note leaves the ward rate beside its intensive-care row", () => {
  const people: Person[] = [{ name: "Siti Tan", relationship: "self", line: "Siti Tan\tPolicyholder\tSGD 100,000", sum: 100000 }];
  const line = "2\tHospital income\tS$200 per day (the daily amount is doubled if hospitalised in intensive care, capped at S$400 per day)";
  const h = schedule(people, [line], [ben({ section: "2", benefit: "Hospital income", pays: "per_day", value: 200, quote: line,
    conditions: ["the daily amount is doubled if hospitalised in intensive care, capped at S$400 per day"] })], "Hospital Cash Plan");
  assert.ok(h.rows.some((r) => /intensive care/i.test(r.benefit)), "an intensive-care row");
  assert.ok(ask(h, "Siti Tan", /^Hospital income$/, "Siti was hospitalised in intensive care for 3 days. What is the daily amount?", "").amounts.includes("S$200"));
});
test("a daily amount with an age note and no note named is as before", () => {
  const SITI: Person = { name: "Siti Binti Omar", relationship: "spouse", line: "Siti Binti Omar\tSpouse\tRM 100,000", sum: 100000 };
  const line = "6\tHospital income\tRM 100 per day in hospital", note = "Note (c): paid at half for an insured person aged 70 or over.";
  const h = schedule([SITI], [line, note], [ben({ section: "6", benefit: "Hospital income", pays: "per_day", value: 100, quote: line, conditions: [note] })], "Keluarga Accident Plan");
  assert.ok(ask(h, "Siti Binti Omar", /Hospital income/, "Siti fell over and was in hospital 3 days.", "").amounts.includes("RM100"));
});
test("a note the table escapes or joins with ';' can still be copied", () => {
  const angled = "Note (a): fractures <compound> are paid at double the Section 3 amount.";
  assert.ok(IF.test(G(angled, "It was a compound fracture.", "Note (a): fractures &lt;compound&gt; are paid at double the Section 3 amount.", TURNS).basis));
  const joined = "Note (a): a compound fracture is paid at double the Section 3 amount; still subject to the GBP 1,500 maximum per accident.";
  assert.ok(IF.test(G(joined, "It was a compound fracture.", "a compound fracture is paid at double the Section 3 amount", TURNS).basis));
});

// ---------- Whoever the case is: the gate's who/when cases (rounds 1-7) never show a flat GBP 800 ----------
// The model may set the note on Grace's card wrongly in every one of these; the card is Grace's own single amount, and the
// multiple is only ever said as its printed condition.
type Case = [label: string, note: string, q: string, earlier?: string[], o?: { people?: Person[]; row?: RegExp; burns?: string; pct?: number }];
const T2 = ["Grace broke her arm."];
const GATE: Case[] = [
  ["W5", KEEPS, "Grace broke her wrist; the doctor ruled out a compound fracture."], ["W6", KEEPS, "Grace broke her wrist.", ["Daniel had a compound fracture last year."]],
  ["W7", KEEPS, "Our policy says a compound fracture is paid at double. Grace broke her wrist."], ["W8", KIDS, "Grace broke her arm playing with the children."],
  ["W9", AGE, "Grace broke her arm; her mum, aged 70 or over, was with her."], ["W12", KEEPS, "Grace broke her wrist."],
  ["A", KEEPS, "Now Grace broke her wrist, how much can we claim?", ["Daniel had a compound fracture last year, already claimed."]],
  ["A2", KEEPS, "Daniel had a compound fracture last year. Now Grace has a simple fracture of the wrist. How much for Grace?"],
  ["B", KEEPS, "Grace broke her wrist. Would it pay more if it turned out to be a compound fracture? We don't know yet."],
  ["C2", KEEPS, "They checked whether it was compound but it is a simple fracture."], ["E", AGE, "Grace fell over and broke her wrist."],
  ["F", UPTO, "It was a compound fracture.", T2], ["G", NOTDBL, "It was a compound fracture.", T2], ["P", ABROAD, "Grace broke her arm at home.", ["We live abroad in Spain."]],
  ["finger", FINGER, "Grace broke her wrist.", ["Daniel hurt his finger last week."]], ["twice-both", BOTH, "Grace fractured her arm; both children are fine."],
  ["R2 he", KEEPS, "Grace broke her wrist. Daniel was hurt too. He has a compound fracture."], ["R2 I", KEEPS, "I have a compound fracture and Grace broke her wrist. What can we claim for her?"],
  ["R2 husband", KEEPS, "Grace broke her wrist in the crash. My husband has a compound fracture."], ["R2 2023", KEEPS, "Grace broke her wrist today. How much?", ["Grace had a compound fracture in 2023, it healed."]],
  ["R2 last year", KEEPS, "Last year Grace had a compound fracture. Today she broke her wrist again. How much?"], ["R2 pensioners", PENSION, "Grace broke her arm; her mum is a pensioner and was with her."],
  ["R2 way to work", WORK, "Grace broke her wrist on her way to work."],
  ["X1", KEEPS, "He has a compound fracture.", ["Daniel broke his arm."]], ["X3", KEEPS, "It was a compound fracture.", ["Daniel broke his arm playing football."]],
  ["X4", KEEPS, "She has a compound fracture.", ["Amara broke her leg at the park."], { people: [DANIEL, GRACE, AMARA] }],
  ["X7", KEEPS, "A compound fracture.", ["Grace broke her wrist.", "And Daniel? What did he break?"]], ["X8", KEEPS, "The hospital confirmed a compound fracture.", ["Grace is fine.", "Daniel fell off his bike."]],
  ["Y1", KEEPS, "Daniel, not Grace, has a compound fracture."], ["Y2", KEEPS, "Grace is fine, Daniel has a compound fracture."], ["Y3", KEEPS, "As for Daniel: compound fracture.", T2],
  ["Y4", KEEPS, "Grace's doctor said the policy pays double for compound fractures."], ["Y4c", KEEPS, "Grace read online that compound fractures get more from insurers."],
  ["Y5b", BOTH, "Both of Grace's arms are fine and nothing is fractured."], ["Y5c", BOTH, "Grace fractured her leg and both arms are bruised."],
  ["Y6", KEEPS, "Her colleague fell at work. He has a compound fracture."], ["Y6d", KEEPS, "The other driver has a compound fracture."],
  ["Y7", KEEPS, "My colleague has a compound fracture.", [], { people: [GRACE] }], ["Y7c", KEEPS, "The cyclist who hit Grace has a compound fracture.", [], { people: [GRACE] }],
  ["Y8", PT, "Grace fractured her wrist at home and was travelling on public transport to the hospital."], ["Y10", KEEPS, "Daniel - compound fracture; Grace - sprain."],
  ["Z1", KEEPS, "My nephew has a compound fracture.", [], { people: [GRACE] }], ["Z3b", KEEPS, "A pupil at her school has a compound fracture.", T2],
  ["Z3e", KEEPS, "The dog has a compound fracture.", ["Grace broke her arm walking the dog."]], ["Z4", KEEPS, "Grace broke her arm. Her coach was hurt too. He has a compound fracture."],
  ["Z4c", KEEPS, "Grace drove Daniel to A&E. He has a compound fracture."], ["Z5b", KEEPS, "Grace sat next to Daniel. He has a compound fracture."],
  ["Z6", KEEPS, "Grace's boyfriend has a compound fracture."], ["Z7", KEEPS, "The leaflet says a compound fracture heals slowly.", T2],
  ["Z7b", KEEPS, "Compound fractures are serious.", T2], ["Z7e", KEEPS, "A compound fracture is the worst kind.", T2], ["Z8b", KEEPS, "He has a compound fracture.", [], { people: [GRACE] }],
  ["T1", KEEPS, "Grace was in a crash with a bus driver. He has a compound fracture."], ["T1g", KEEPS, "Grace says the bus driver has a compound fracture."],
  ["T2", KEEPS, "Grace fell with mum. She has a compound fracture."], ["T2e", KEEPS, "Grace drove mates home from rugby. It is a compound fracture."],
  ["T4d", KEEPS, "My sister Grace has a compound fracture."], ["T5e", KEEPS, "Okafor has a compound fracture."], ["T6", KEEPS, "Yes, dad. It's a compound fracture.", T2],
  ["T6f", KEEPS, "Grace broke her arm, tom his leg; it is a compound fracture."], ["T7b", KEEPS, "Grace hurt her arm. The van driver, it's a compound fracture."],
  ["W3 other section on Burns", "Note (a): a compound fracture is paid at double the Section 3 amount.", "Grace has a compound fracture and burns.", [], { row: /Burns/, burns: "Note (a): a compound fracture is paid at double the Section 3 amount." }],
];
test("W/X/Y/Z/T: with the note set on Grace's card, her card is her single amount, never a flat GBP 800; the multiple only as its condition", () => {
  for (const [label, note, q, earlier = [], o = {}] of GATE) {
    const h = fractureSchedule(note, o.pct ?? 2, o.people ?? [DANIEL, GRACE], o.burns ?? null);
    const a = ask(h, "Grace Okafor", o.row ?? /Fracture/, q, note, earlier);
    // The same card as with no note named (main's), never another figure: £400 (£2,000 on Burns), or none where main has
    // none (a row conditioned on children, W8).
    const main = ask(h, "Grace Okafor", o.row ?? /Fracture/, q, "", earlier);
    assert.deepEqual(a.amounts, main.amounts, label);
    assert.ok(main.amounts.every((x) => x === (o.row ? "£2,000" : "£400")), `${label}: ${main.amounts}`);
    assert.ok(!a.kept.some((s) => s.amount?.text === "£800"), `${label}: a flat £800`);
    // The line is said for exactly the notes whose structure checks (a plain multiple of the row's own case, within the
    // maximum), whatever the household's words.
    const lined = [KEEPS, ABROAD, FINGER, BOTH, WORK, PT].includes(note) && !o.row;
    assert.equal(IF.test(a.basis), lined, `${label}: ${a.basis}`);
    if (lined) assert.ok(a.basis.includes(ifLine(note, "")), `${label}: the note's own words`);
    // Never the household's words in the line.
    assert.ok(!a.basis.includes(q), label);
  }
});
test("the note set on the wrong person's card: still that person's single amount, with only the conditional line", () => {
  // W1: Daniel's card, 1% of GBP 80,000 is GBP 800; doubled is GBP 1,600, above the maximum: up to GBP 1,500, said as the condition.
  const a = ask(fractureSchedule(KEEPS, 1), "Daniel Okafor", /Fracture/, "Grace has a compound fracture. Daniel broke his wrist too.", KEEPS);
  assert.deepEqual(a.amounts, ["£800"]);
  assert.ok(a.basis.endsWith(ifLine(KEEPS, "this pays £1,500 (double would be £1,600, more than the £1,500 maximum)")), a.basis);
  // Grace's card with Daniel's case.
  const g = G(KEEPS, "Grace broke her wrist. Daniel has a compound fracture.", KEEPS);
  assert.deepEqual(g.amounts, ["£400"]);
  assert.ok(g.basis.endsWith(ifLine(KEEPS, "this pays £800 (double)")));
});
test("W10/X6: a card spread to another member for a chat about no one never carries the named card's line", () => {
  const a = ask(fractureSchedule(KEEPS, 1), "Grace Okafor", /Fracture/, "What does a compound fracture pay?", KEEPS, [], { forNobody: true });
  assert.deepEqual(a.amounts, ["£200"]);
  assert.ok(IF.test(a.basis));
  const daniel = a.others.find((x) => x.person === "Daniel Okafor");
  assert.ok(daniel, JSON.stringify(a.others));
  assert.equal(daniel!.amount, "£800");
  assert.doesNotMatch(daniel!.basis, IF);
});
test("L1-L21: plain statements of the case for Grace show GBP 400 and the conditional GBP 800 line", () => {
  const cases: [string, string, string[]][] = [
    [KEEPS, "It was a compound fracture.", TURNS], [KEEPS, "She has a compound fracture.", T2], [KEEPS, "Grace's fracture is compound.", []],
    [KEEPS, "Grace has a compound fracture of the wrist.", []], [KEEPS, "The doctor said Grace has a compound fracture.", []], [KEEPS, "My wife Grace has a compound fracture.", []],
    [KEEPS, "Grace had a compound fracture yesterday.", []], [KEEPS, "Grace broke her arm yesterday and it is a compound fracture.", []], [KEEPS, "Grace broke her arm. It's a compound fracture.", []],
    [KEEPS, "It's a compound fracture, not a simple one.", T2], [KEEPS, "How much can we claim?", ["Grace broke her arm.", "It was a compound fracture."]],
    [KEEPS, "How much for that?", ["Grace has a compound fracture."]], [KEEPS, "The X-ray shows Grace has a compound fracture.", []],
    [KEEPS, "Grace broke her arm in a fall, a compound fracture.", []], [KEEPS, "Grace has a compound fracture, how much do we get?", []],
    [KEEPS, "Grace has a compound fracture. How much do we get?", []], [KEEPS, "Yes, it was compound.", T2], [KEEPS, "It was a compound fracture. Daniel is fine.", T2],
    [KEEPS, "Grace broke her leg; it's a compound fracture.", []], [WORK, "Grace was hurt at work and broke her wrist.", []], [BOTH, "Grace fractured both arms.", []],
  ];
  for (const [note, q, earlier] of cases) {
    const a = G(note, q, note, earlier);
    assert.deepEqual(a.amounts, ["£400"], q);
    assert.ok(a.basis.endsWith(ifLine(note, "this pays £800 (double)")), `${q}: ${a.basis}`);
  }
});

console.log(`multiplier-test: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exit(1);
