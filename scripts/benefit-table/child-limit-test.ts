/** Scripted tests: a child's share printed inside a percentage row's own amount cell ("100% of the Sum Insured. For an
 * insured child under 18, limited to 25% of the Sum Insured."). Acceptance run TE-ACC-20261113 R2, H1-B: asking about a
 * child under 18 on a family accident schedule gave no amount. The child's share is worked out only for a person whose own
 * line of the schedule proves they are that child (a printed date of birth on every day that matters, or with no age in the
 * condition, the printed relationship), the row's own share only for one it proves is not, and no amount otherwise, with
 * the printed condition quoted. Only plain shapes are read (lib/benefit-table/child-limit.ts); anything else is as before.
 * Made-up households only. No model, database or network.
 *   npm run benefit-table:child-limit-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, foldChildColumns, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer, type ServerFigure } from "@/lib/simple-chat/verify";
import { childColumn, childLimitIn, childLimitNotes, childShareAllowed, childWordsElsewhere, personStatus, printedLife } from "@/lib/benefit-table/child-limit";
import { printedDay } from "@/lib/benefit-table/dates";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const NOW = new Date("2026-11-13T04:00:00Z");

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

type Person = { name: string; relationship: string; line: string; sum: number };
const ACC = "55555555-5555-4555-8555-555555555555";
const DOC = "eeeeeeee-0000-4000-8000-000000000081";
const ben = (o: Record<string, unknown>) => ({ section: null, column: null, pays: "amount", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
  cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 2, ...o });
function schedule(people: Person[], tableLines: string[], benefits: Record<string, unknown>[], o: { product?: string; header?: string; period?: string | null; familyDob?: Record<string, string>; page3?: string } = {}) {
  const product = o.product ?? "Family Personal Accident";
  const page1 = `Example Assurance plc\n${product.toUpperCase()} - SCHEDULE${o.period === null ? "" : `\nPeriod of insurance: ${o.period ?? "1 March 2026 to 28 February 2027"}`}\n${o.header ?? "Insured person\tRelationship\tDate of birth\tSum Insured"}\n${people.map((p) => p.line).join("\n")}`;
  const page2 = `TABLE OF BENEFITS\nSection\tBenefit\tAmount payable\n${tableLines.join("\n")}`;
  const d: Household["documents"][number] = { policyId: DOC, name: `${product}.pdf`, insurer: "Example Assurance plc", productName: product, policyNumber: null, documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: people.map((p) => p.name), supersededAt: null,
    processingStatus: "ready", pages: [page1, page2, ...(o.page3 ? [o.page3] : [])].map((text, i) => ({ page: i + 1, text })) };
  const house: Household = { accountId: ACC, members: people.map((p) => ({ name: p.name, relationship: p.relationship })), documents: [d] };
  const family: FamilyMember[] = people.map((p, i) => ({ id: `m${i}`, display_name: p.name, relationship: p.relationship, date_of_birth: o.familyDob?.[p.name] ?? null }));
  const src: SourceDoc = { id: d.policyId, name: d.name, readable: true, pages: d.pages };
  const reading = checkReading(src, { document: { kind: "personal_proof", product, insurer: d.insurer, namedPeople: people.map((p) => p.name), plan: null,
      periodFrom: o.period === null ? null : (o.period ?? "1 March 2026 to 28 February 2027").split(" to ")[0], periodTo: o.period === null ? null : (o.period ?? "1 March 2026 to 28 February 2027").split(" to ")[1] },
    covers: people.map((p) => ({ person: p.name, product, cover: product, plan: null, riderOf: null, policyNumber: null, premium: null, premiumFrequency: null, asOf: null,
      startDate: null, endDate: null, page: 1, sumInsured: p.sum, quote: p.line })), benefits });
  const key = coverKeyOf({ product, cover: product, plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: key, why: "the schedule's table of benefits" }));
  const table = assembleTable([reading], family, links, [], NOW);
  return { house, rows: chatRows(table, house), reading, table };
}
function ask(h: ReturnType<typeof schedule>, person: string, benefit: RegExp, question: string, tamper?: (f: ServerFigure) => ServerFigure) {
  const row = h.rows.find((r) => r.person === person && benefit.test(r.benefit));
  assert.ok(row, `no row for ${person} ${benefit}`);
  const raw = { bottomLine: "The amounts are below.", nextSteps: [], question: null, statements: [{ kind: "amount", text: row.benefit, person, document: null, quote: null, amount: null, percentOf: null,
    conditions: [], alternativeGroup: null, perDay: null, ofBill: null, row: row.id, rowBenefit: row.benefit, eventFit: "any_event", waiting: null, period: { from: "", to: "", eventOn: "" }, multiplierNote: "" }] };
  const fromRows = amountsFromRows(raw, h.rows, h.house, NOW, question, [], false);
  const figures = (fromRows.report.figures ?? []).map((f) => tamper ? tamper(f) : f);
  const { answer, report } = verifyAnswer(h.house, readModelAnswer(fromRows.json)!, [question], new Set(fromRows.report.labels), figures);
  const { kept } = keepLabelledAmounts(answer.statements ?? [], fromRows.report);
  const cards = kept.filter((s) => s.amount && s.personName === person);
  const all = kept.filter((s) => s.amount);
  return { row, amounts: cards.map((s) => s.amount!.text), basis: cards[0]?.basis ?? "", leftOut: fromRows.report.dropped.length > 0 || report.dropped.some((d) => d.kind === "amount"),
    others: all.filter((s) => s.personName !== person).map((s) => s.amount!.text), points: kept.filter((s) => !s.amount).map((s) => s.text) };
}
const P = (name: string, rel: string, dob: string, sum: string, value: number, cells?: string[]): Person =>
  ({ name, relationship: /child|son|daughter/i.test(rel) ? "child" : rel === "Policyholder" ? "self" : "spouse", line: (cells ?? [name, rel, dob, sum]).join("\t"), sum: value });
const NGOZI = P("Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 100,000", 100000);
const DANIEL = P("Daniel Okafor", "Spouse", "02/11/1982", "GBP 80,000", 80000);
const GRACE = P("Grace Okafor", "Child", "09/04/2017", "GBP 20,000", 20000);
const CELL = "100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured.";
const CLAUSE = "For an insured child under 18, limited to 25% of the Sum Insured.";
const PTD = "2\tPermanent total disablement\t100% of the Sum Insured";
/** A family schedule whose table's death row prints `cell` (read as `value`% of the sum insured, with the child's sentence
 * as a condition when `asCondition`), and a plain disablement row. */
function family(people: Person[], cell = CELL, o: Parameters<typeof schedule>[3] & { ptdQuote?: string; value?: number; condition?: string | null; quote?: string } = {}) {
  const line = `1\tAccidental death\t${cell}`;
  return schedule(people, [line, PTD], [
    ben({ section: "1", benefit: "Accidental death", pays: "percent", value: o.value ?? 100, percentOf: "sum_insured", quote: o.quote ?? cell,
      conditions: o.condition === null ? [] : [o.condition ?? CLAUSE] }),
    ben({ section: "2", benefit: "Permanent total disablement", pays: "percent", value: 100, percentOf: "sum_insured", quote: o.ptdQuote ?? PTD }),
  ], o);
}
const death = (h: ReturnType<typeof schedule>, who: Person) => ask(h, who.name, /death/, `If ${who.name.split(" ")[0]} died in an accident, how much would the policy pay?`);

// ---------- Reading the cell: an allow-list of plain shapes ----------
test("the shapes read: wording, share, base and age", () => {
  const cases: [string, number, [number, number | null] | null][] = [
    [CELL, 100, [25, 18]],
    ["100% of the sum assured. If the insured person is a child under the age of 16, the benefit is reduced to 50% of the sum assured.", 100, [50, 16]],
    ["100% of Sum Insured. Children under 21: 30%.", 100, [30, 21]],
    ["50% of the Sum Insured. Limited to 10% of the Sum Insured for an insured child aged 17 or under.", 50, [10, 18]],
    ["100% of the Sum Insured. For a dependent child, limited to 20 per cent of the Sum Insured.", 100, [20, null]],
    ["100% of the Sum Insured; for insured children (below 18 years of age) limited to 25% of the Sum Insured", 100, [25, 18]],
    ["100% of the Sum Insured. Where the insured is a minor younger than 16 years, the amount payable is restricted to 40% of the Sum Insured.", 100, [40, 16]],
    ["200% of the Sum Insured. For an insured child under 18, 50% of the Sum Insured.", 200, [50, 18]],
    // Not read: another person's sum, another benefit, not covered, a co-pay or an excess, an age said as "up to", an
    // adults' line, "of the benefit" on a row whose own share is not 100%, two kinds of life, a money cap, "up to", a
    // share above the row's own, another base, a negation.
    ["100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured of the Policyholder.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, the medical expenses benefit is limited to 25%.", 100, null],
    ["100% of the Sum Insured. Children are not covered.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, a co-payment of 25% applies.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, an excess of 25% applies.", 100, null],
    ["100% of the Sum Insured. For an insured child up to age 17, limited to 25% of the Sum Insured.", 100, null],
    ["100% of the Sum Insured. For insured persons aged 70 and over, limited to 50% of the Sum Insured.", 100, null],
    ["100% of the Sum Insured. For adults, limited to 50% of the Sum Insured.", 100, null],
    ["50% of the Sum Insured. For an insured child under 18, limited to 25% of the benefit.", 50, null],
    ["100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured. For insured persons aged 70 or over, limited to 50%.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured, maximum GBP 5,000.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, up to 25% of the Sum Insured.", 100, null],
    ["10% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured.", 10, null],
    ["100% of the Sum Insured. For an insured child under 18, limited to 25% of the annual premium.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured unless hospitalised.", 100, null],
    ["100% of the Sum Insured. For an insured child under 18, this is not limited to 25% of the Sum Insured.", 100, null],
    ["100% of the Sum Insured. For an insured child, 25% is paid to the parent.", 100, null],
    ["100% of the Sum Insured.", 100, null],
  ];
  for (const [cell, own, want] of cases) {
    const got = childLimitIn(cell, own);
    assert.deepEqual(got ? [got.percent, got.belowAge] : null, want, cell);
  }
});
test("whom it is for: the person's own line, under the table's columns or after a label", () => {
  const lines = ["Insured person\tRelationship\tDate of birth\tSum Insured", NGOZI.line, GRACE.line, "Tom Lee\tSon\t\tGBP 5,000"];
  assert.deepEqual(printedLife(lines, 1), { birth: "14/06/1984", relationship: "Policyholder" });
  assert.deepEqual(printedLife(lines, 2), { birth: "09/04/2017", relationship: "Child" });
  // A row whose cells do not line up with the header is not read by column.
  assert.deepEqual(printedLife(["Name\tDate of birth\tSum", "Tom Lee\tGBP 5,000"], 1), { birth: null, relationship: null });
  assert.deepEqual(printedLife(["Insured: Tom Lee (date of birth: 3 May 2015)"], 0, "Tom Lee").birth, "3 May 2015");
  // The label route only right after the person's own name, on a line naming no one else (gate H3).
  assert.equal(printedLife(["Insured: Tom Lee (date of birth: 3 May 2015)"], 0).birth, null);
  assert.equal(printedLife(["Grace Okafor, child of Ngozi Okafor (Policyholder date of birth: 14/06/1984)\tGBP 20,000"], 0, "Grace Okafor", ["Ngozi Okafor"]).birth, null);
  assert.equal(printedLife(["Insured child: Grace Okafor - Parent: Ngozi Okafor, born 14/06/1984 - Sum Insured GBP 20,000"], 0, "Grace Okafor", ["Ngozi Okafor"]).birth, null);
  assert.equal(printedLife(["Insured child: Grace Okafor - Parent: Ngozi Okafor, born 14/06/1984"], 0, "Grace Okafor", []).birth, null, "the label not after her name");
  // A start date column is not a date of birth.
  assert.deepEqual(printedLife(["Name\tCover start\tSum", "Tom Lee\t01/03/2015\tGBP 5,000"], 1), { birth: null, relationship: null });
  // Two dates on the line beside a label: not settled.
  assert.equal(printedLife(["Tom Lee DOB: 03/05/2015, joined 01/03/2020"], 0, "Tom Lee").birth, null);
  // Another table's header above is never reached past the person's own table's header (gate H2).
  const two = ["Proposer\tOccupation\tDate of birth\tNationality", "Ngozi Okafor\tTeacher\t14/06/1984\tBritish",
    "Insured person\tRelationship\tCover start\tDate of birth\tSum Insured", "Ngozi Okafor\tPolicyholder\t01/03/2026\t14/06/1984\tGBP 100,000",
    "Daniel Okafor\tSpouse\t01/03/2026\tGBP 80,000", "Grace Okafor\tChild\t01/03/2026\t09/04/2017\tGBP 20,000"];
  assert.deepEqual(printedLife(two, 4), { birth: null, relationship: null });
  // A row of another shape between the person's line and the header ends the search too (gate R3-H1: the table's own rows
  // have the person's line's cell count).
  assert.deepEqual(printedLife(two, 5), { birth: null, relationship: null });
  assert.deepEqual(printedLife(two, 3), { birth: "14/06/1984", relationship: "Policyholder" });
  // A header that prints digits is still the header, and nothing above it is looked at (gate R3-H1).
  for (const head of ["Insured person\tRelationship\tCover start\tDate of birth\tSum Insured (GBP 000)", "Insured person\tRelationship\tCover start 2026\tDate of birth\tSum Insured"]) {
    const t = [...two.slice(0, 2), head, ...two.slice(3)];
    assert.deepEqual(printedLife(t, 4), { birth: null, relationship: null }, head);
    assert.deepEqual(printedLife(t, 3), { birth: "14/06/1984", relationship: "Policyholder" }, head);
  }
  const noDob = ["Proposer\tOccupation\tDate of birth\tNationality", "Ngozi Okafor\tTeacher\t14/06/1984\tBritish",
    "Insured person (age 0-75)\tRelationship\tCover start\tSum Insured", "Ngozi Okafor\tPolicyholder\t01/03/2026\tGBP 100,000", "Grace Okafor\tChild\t01/03/2026\tGBP 20,000"];
  assert.deepEqual(printedLife(noDob, 3), { birth: null, relationship: "Policyholder" });
  assert.deepEqual(printedLife(noDob, 4), { birth: null, relationship: "Child" });
  // The label date ends its cell, or is followed only by ")", "," or ";" (gate R3-H3).
  assert.equal(printedLife(["Grace Okafor (DOB 14/06/1984 of policyholder)\tGBP 20,000"], 0, "Grace Okafor").birth, null);
  assert.equal(printedLife(["Grace Okafor, born 14/06/1984 (mother's date)\tGBP 20,000"], 0, "Grace Okafor").birth, null);
  assert.equal(printedLife(["Grace Okafor (DOB 09/04/2017)\tGBP 20,000"], 0, "Grace Okafor").birth, "09/04/2017");
  // Gate R4-H4: after the date only an optional ")" and the end of the cell; anything more is not settled as theirs.
  assert.equal(printedLife(["Grace Okafor, date of birth 09/04/2017, child of N. Okafor\tGBP 20,000"], 0, "Grace Okafor").birth, null);
  // A blank line or a heading line ends the search.
  assert.deepEqual(printedLife(["Name\tDate of birth\tSum", "", "Tom Lee\t03/05/2015\tGBP 5,000"], 2), { birth: null, relationship: null });
  const day = printedDay("13/11/2026")!;
  assert.equal(personStatus({ birth: "09/04/2017", relationship: null }, { belowAge: 18 }, [day]), "child");
  assert.equal(personStatus({ birth: "14/06/1984", relationship: null }, { belowAge: 18 }, [day]), "not_child");
  assert.equal(personStatus({ birth: null, relationship: "Child" }, { belowAge: 18 }, [day]), null, "an age needs a date of birth");
  assert.equal(personStatus({ birth: null, relationship: "Child" }, { belowAge: null }, [day]), "child");
  assert.equal(personStatus({ birth: null, relationship: "Spouse" }, { belowAge: null }, [day]), "not_child");
  assert.equal(personStatus({ birth: null, relationship: "Nominee" }, { belowAge: null }, [day]), null);
  // Only child, son or daughter; never step, grand or in-law forms (gate H1).
  for (const r of ["Stepchild", "Step-son", "Grandchild", "Son-in-law", "Adult child", "Child (over 18)", "Dependant", "Ward"])
    assert.equal(personStatus({ birth: null, relationship: r }, { belowAge: null }, [day]), null, r);
  // Relationship and date of birth on the same line must agree (gate H1).
  for (const r of ["Daughter", "Child", "Son"]) assert.equal(personStatus({ birth: "01/01/1990", relationship: r }, { belowAge: null }, [day]), null, r);
  for (const r of ["Self", "Insured", "Principal insured", "Policyholder"]) assert.equal(personStatus({ birth: "01/01/2016", relationship: r }, { belowAge: null }, [day]), null, r);
  assert.equal(personStatus({ birth: "02/11/2012", relationship: "Spouse" }, { belowAge: 18 }, [day]), null);
  assert.equal(personStatus({ birth: "01/01/2016", relationship: "Daughter" }, { belowAge: null }, [day]), "child");
  assert.equal(personStatus({ birth: "01/01/1980", relationship: "Spouse" }, { belowAge: 18 }, [day]), "not_child");
  // Turning 18 inside the days that matter: not settled.
  assert.equal(personStatus({ birth: "01/12/2008", relationship: null }, { belowAge: 18 }, [day, printedDay("28 February 2027")!]), null);
  // Day-first and month-first readings that disagree: not settled; that agree: settled.
  assert.equal(personStatus({ birth: "12/11/2008", relationship: null }, { belowAge: 18 }, [day]), null);
  assert.equal(personStatus({ birth: "02/11/1982", relationship: null }, { belowAge: 18 }, [day]), "not_child");
});

// ---------- The cards ----------
test("H1-B: Grace (born 2017, a child under 18) gets £5,000 (25% of £20,000) with the printed condition; adults get 100%", () => {
  const h = family([NGOZI, DANIEL, GRACE]);
  const g = death(h, GRACE);
  assert.deepEqual(g.amounts, ["£5,000"]);
  assert.ok(!g.leftOut);
  assert.match(g.basis, /^25% of Grace Okafor's sum insured of £20,000 \(.*page 1\)\. The policy \(page 2\) says: "For an insured child under 18, limited to 25% of the Sum Insured", and Grace Okafor's date of birth on page 1 is 09\/04\/2017/);
  const n = death(h, NGOZI);
  assert.deepEqual(n.amounts, ["£100,000"]);
  assert.match(n.basis, /pays 25% for an insured child under 18, which Ngozi Okafor is not: Ngozi Okafor's date of birth on page 1 is 14\/06\/1984/);
  assert.deepEqual(death(h, DANIEL).amounts, ["£80,000"]);
  // The plain row beside it is as before.
  const d = ask(h, GRACE.name, /disablement/, "What if Grace were permanently disabled?");
  assert.deepEqual(d.amounts, ["£20,000"], JSON.stringify([d.row.benefit, d.row.figure, d.basis]));
});
test("another row whose quote is found first in the child's cell never takes its child share", () => {
  const h = family([NGOZI, GRACE], CELL, { ptdQuote: "100% of the Sum Insured" });
  const row = h.rows.find((r) => r.person === GRACE.name && /disablement/.test(r.benefit))!;
  assert.equal(row.childLimit, undefined);
  assert.notDeepEqual(ask(h, GRACE.name, /disablement/, "What if Grace were permanently disabled?").amounts, ["£5,000"]);
});
test("the reader quoting only the row's own share, with the child's sentence as a condition, gives the same", () => {
  const h = family([NGOZI, GRACE], CELL, { quote: "100% of the Sum Insured" });
  assert.deepEqual(death(h, GRACE).amounts, ["£5,000"]);
  assert.deepEqual(death(h, NGOZI).amounts, ["£100,000"]);
});
test("other currencies, shares and ages: MYR, 'Children under 16: 50%'; SGD, 'reduced to 30% ... younger than 21'", () => {
  const a = P("Aisyah Rahman", "Policyholder", "1985-02-03", "MYR 200,000", 200000), b = P("Hana Rahman", "Daughter", "2012-07-30", "MYR 40,000", 40000);
  const h = family([a, b], "100% of Sum Insured. Children under 16: 50%.", { condition: null });
  assert.deepEqual(death(h, b).amounts, ["RM20,000"]);
  assert.deepEqual(death(h, a).amounts, ["RM200,000"]);
  const c = P("Tan Wei Ming", "Policyholder", "3 March 1980", "SGD 150,000", 150000), d = P("Tan Jia Hui", "Son", "5 May 2010", "SGD 50,000", 50000);
  const k = family([c, d], "100% of the Sum Insured. Where the insured is a minor younger than 21 years, the amount payable is restricted to 30% of the Sum Insured.", { condition: null });
  assert.deepEqual(death(k, d).amounts, ["S$15,000"]);
  assert.deepEqual(death(k, c).amounts, ["S$150,000"]);
});
test("no age in the condition: the printed relationship decides ('Child' 20%, 'Spouse' 100%)", () => {
  const cell = "100% of the Sum Insured. For a dependent child, limited to 20% of the Sum Insured.";
  const h = family([NGOZI, DANIEL, GRACE], cell, { condition: null });
  assert.deepEqual(death(h, GRACE).amounts, ["£4,000"]);
  assert.match(death(h, GRACE).basis, /page 1 prints Grace Okafor as "Child"/);
  assert.deepEqual(death(h, DANIEL).amounts, ["£80,000"]);
});
test("not proven: no amount for anyone unproven, and the printed condition is quoted", () => {
  // An age in the condition but no date of birth printed (relationship only).
  const noDob = (p: Person) => ({ ...p, line: p.line.split("\t").filter((_, i) => i !== 2).join("\t") });
  const h = family([noDob(NGOZI), noDob(GRACE)], CELL, { header: "Insured person\tRelationship\tSum Insured" });
  for (const p of [NGOZI, GRACE]) {
    const a = death(h, p.name === NGOZI.name ? noDob(NGOZI) : noDob(GRACE));
    assert.deepEqual(a.amounts, [], p.name);
    assert.deepEqual(a.others, []);
    assert.ok(a.points.some((t) => t.includes('the policy says: "For an insured child under 18, limited to 25% of the Sum Insured"') && t.includes("does not print a date of birth")), a.points.join(" | "));
  }
  // A date of birth the household entered on the Family page is not the schedule's: still no amount.
  const fam = family([noDob(NGOZI), noDob(GRACE)], CELL, { header: "Insured person\tRelationship\tSum Insured", familyDob: { "Grace Okafor": "2017-04-09", "Ngozi Okafor": "1984-06-14" } });
  assert.deepEqual(death(fam, noDob(GRACE)).amounts, []);
  assert.deepEqual(death(fam, noDob(NGOZI)).amounts, []);
  // No relationship column, no age in the condition.
  const noRel = family([P("Ngozi Okafor", "", "", "GBP 100,000", 100000, ["Ngozi Okafor", "GBP 100,000"]), P("Grace Okafor", "", "", "GBP 20,000", 20000, ["Grace Okafor", "GBP 20,000"])],
    "100% of the Sum Insured. For a dependent child, limited to 20% of the Sum Insured.", { header: "Insured person\tSum Insured", condition: null });
  assert.deepEqual(death(noRel, GRACE).amounts, []);
});
test("a person turning 18 inside the period of insurance, or a date read two ways that disagree: no amount", () => {
  const sam = P("Sam Okafor", "Child", "01/12/2008", "GBP 20,000", 20000);
  assert.deepEqual(death(family([NGOZI, sam]), sam).amounts, []);
  const ola = P("Ola Okafor", "Child", "12/11/2008", "GBP 20,000", 20000);
  assert.deepEqual(death(family([NGOZI, ola], CELL, { period: null }), ola).amounts, []);
  // With no period printed, today settles it for one born long before.
  assert.deepEqual(death(family([NGOZI, GRACE], CELL, { period: null }), GRACE).amounts, ["£5,000"]);
});
test("one person's date of birth is never read for another", () => {
  const graceNoDob = { ...GRACE, line: "Grace Okafor\tChild\t\tGBP 20,000" };
  const h = family([NGOZI, graceNoDob]);
  assert.deepEqual(death(h, graceNoDob).amounts, []);
  assert.deepEqual(death(h, NGOZI).amounts, ["£100,000"]);
});
test("a bare '$' is no currency: no amount, as before", () => {
  const a = P("Ana Cruz", "Policyholder", "01/01/1980", "$ 100,000", 100000), b = P("Leo Cruz", "Child", "01/01/2015", "$ 20,000", 20000);
  const h = family([a, b]);
  assert.deepEqual(death(h, b).amounts, []);
  assert.deepEqual(death(h, a).amounts, []);
});
test("cells not read keep main's behaviour: no amount for anyone, and never a child's share", () => {
  for (const cell of ["100% of the Sum Insured. For an insured child under 18, limited to 25% of the Sum Insured, maximum GBP 5,000.",
    "100% of the Sum Insured. For an insured child under 18, the medical expenses benefit is limited to 25%.",
    "100% of the Sum Insured. For an insured child up to age 17, limited to 25% of the Sum Insured.",
    "100% of the Sum Insured. For an insured child under 18, a co-payment of 25% applies."]) {
    const h = family([NGOZI, GRACE], cell, { condition: null });
    for (const p of [NGOZI, GRACE]) {
      const a = death(h, p);
      assert.deepEqual(a.amounts, [], `${p.name}: ${cell}`);
      assert.equal(h.rows.find((r) => r.person === p.name && /death/.test(r.benefit))?.childLimit, undefined);
    }
  }
});
test("the chat's checks read the share and the date of birth again: a figure changed on its way is refused", () => {
  const h = family([NGOZI, GRACE]);
  const flip = (f: ServerFigure): ServerFigure => f.child ? { ...f, percent: f.child.own, value: 20000, child: { ...f.child, status: "not_child" } } : f;
  assert.deepEqual(ask(h, GRACE.name, /death/, "If Grace died?", flip).amounts, []);
  const toChild = (f: ServerFigure): ServerFigure => f.child ? { ...f, percent: 25, value: 25000, child: { ...f.child, status: "child" } } : f;
  assert.deepEqual(ask(h, NGOZI.name, /death/, "If Ngozi died?", toChild).amounts, []);
  const age = (f: ServerFigure): ServerFigure => f.child ? { ...f, child: { ...f.child, belowAge: 5 } } : f;
  assert.deepEqual(ask(h, GRACE.name, /death/, "If Grace died?", age).amounts, []);
});

// ---------- Gate round 1-2 repros: a wrong amount where main shows none, now none ----------
test("gate H1: a printed relationship and date of birth that disagree give no amount", () => {
  const cell = "100% of the Sum Insured. For an insured child, limited to 25% of the Sum Insured.";
  for (const rel of ["Daughter", "Stepchild", "Step-son", "Grandchild"]) {
    const kemi = P("Kemi Okafor", rel, "01/01/1990", "GBP 20,000", 20000);
    assert.deepEqual(death(family([NGOZI, kemi], cell, { condition: null }), kemi).amounts, [], rel);
  }
  for (const rel of ["Self", "Insured", "Principal insured", "Policyholder"]) {
    const kemi = P("Kemi Okafor", rel, "01/01/2016", "GBP 20,000", 20000);
    assert.deepEqual(death(family([NGOZI, kemi], cell, { condition: null }), kemi).amounts, [], rel);
  }
  const dan = P("Daniel Okafor", "Spouse", "02/11/2012", "GBP 80,000", 80000);
  assert.deepEqual(death(family([NGOZI, dan, GRACE]), dan).amounts, []);
  // The point says what does not agree.
  const kemi = P("Kemi Okafor", "Daughter", "01/01/1990", "GBP 20,000", 20000);
  assert.ok(death(family([NGOZI, kemi], cell, { condition: null }), kemi).points.some((t) => /prints a relationship \("Daughter"\) and a date of birth \(01\/01\/1990\) that do not agree/.test(t)));
});
test("gate H2: another table's 'Date of birth' header above is never used for a line of a different shape", () => {
  const people = [P("Ngozi Okafor", "Policyholder", "", "", 100000, ["Ngozi Okafor", "Policyholder", "01/03/2026", "14/06/1984", "GBP 100,000"]),
    P("Daniel Okafor", "Spouse", "", "", 80000, ["Daniel Okafor", "Spouse", "01/03/2026", "GBP 80,000"]),
    P("Grace Okafor", "Child", "", "", 20000, ["Grace Okafor", "Child", "01/03/2026", "09/04/2017", "GBP 20,000"])];
  const h = family(people, CELL, { header: "Proposer\tOccupation\tDate of birth\tNationality\nNgozi Okafor\tTeacher\t14/06/1984\tBritish\nInsured person\tRelationship\tCover start\tDate of birth\tSum Insured" });
  assert.deepEqual(death(h, people[1]).amounts, []);
  // Grace's line is below Daniel's line of another shape: her table's header is not reached, so no amount.
  assert.deepEqual(death(h, people[2]).amounts, []);
  // Gate R9-H1: a people column outside the closed list ("Cover start") gives no child share for anyone, and the row falls
  // back to main (no amount for anyone, as main).
  assert.deepEqual(death(h, people[0]).amounts, []);
  // Gate R3-H1: the people table's header prints digits; another table's header above is never used.
  for (const head of ["Insured person\tRelationship\tCover start\tDate of birth\tSum Insured (GBP 000)", "Insured person\tRelationship\tCover start 2026\tDate of birth\tSum Insured"]) {
    const k = family(people, CELL, { header: `Proposer\tOccupation\tDate of birth\tNationality\nNgozi Okafor\tTeacher\t14/06/1984\tBritish\n${head}` });
    assert.deepEqual(death(k, people[1]).amounts, [], head);
  }
  // Gate R3-H1: a 4-column people table with no date of birth under a proposer table: no child share for anyone.
  const four = [P("Ngozi Okafor", "Policyholder", "", "", 100000, ["Ngozi Okafor", "Policyholder", "01/03/2026", "GBP 100,000"]),
    P("Grace Okafor", "Child", "", "", 20000, ["Grace Okafor", "Child", "01/03/2026", "GBP 20,000"])];
  const f = family(four, CELL, { header: "Proposer\tOccupation\tDate of birth\tNationality\nNgozi Okafor\tTeacher\t14/06/1984\tBritish\nInsured person (age 0-75)\tRelationship\tCover start\tSum Insured" });
  for (const p of four) assert.deepEqual(death(f, p).amounts, [], p.name);
});
test("gate H3: a date-of-birth label on the child's line that is another person's gives no amount", () => {
  for (const line of ["Grace Okafor, child of Ngozi Okafor (Policyholder date of birth: 14/06/1984)\tGBP 20,000",
    "Insured child: Grace Okafor - Parent: Ngozi Okafor, born 14/06/1984 - Sum Insured GBP 20,000"]) {
    const g = { ...GRACE, line };
    const h = family([NGOZI, g], CELL, { header: "Insured persons" });
    assert.deepEqual(death(h, g).amounts, [], line);
  }
});
test("gate H4: a row whose quote is found in a longer-named row's line never takes its child share", () => {
  for (const [name, other] of [["Death", "Accidental death"], ["Burns", "Burns (third degree)"]]) {
    const h = schedule([NGOZI, GRACE], [`1\t${other}\t${CELL}`, `2\t${name}\t100% of the Sum Insured`], [
      ben({ section: "1", benefit: other, pays: "percent", value: 100, percentOf: "sum_insured", quote: CELL }),
      ben({ section: "2", benefit: name, pays: "percent", value: 100, percentOf: "sum_insured", quote: "100% of the Sum Insured" })]);
    const row = h.rows.find((r) => r.person === GRACE.name && r.benefit === name)!;
    assert.equal(row.childLimit, undefined, name);
    assert.notDeepEqual(ask(h, GRACE.name, new RegExp(`^${name}$`), `What does ${name} pay for Grace?`).amounts, ["£5,000"], name);
    // Gate R7-H1: the other line names the same benefit word with a figure, so the longer row's own share is not given either.
    assert.deepEqual(ask(h, GRACE.name, new RegExp(`^${other.replace(/[()]/g, "\\$&")}$`), "And the other?").amounts, [], other);
  }
});
test("gate R3-H2: the same label printed twice on a page never takes the child share; the line's section number must be the row's", () => {
  const h = schedule([NGOZI, GRACE], [`1\tDeath\t${CELL}`, "2\tDeath\t100% of the Sum Insured"], [
    ben({ section: "1", benefit: "Death", pays: "percent", value: 100, percentOf: "sum_insured", quote: CELL }),
    ben({ section: "2", benefit: "Death", pays: "percent", value: 100, percentOf: "sum_insured", quote: "100% of the Sum Insured" })]);
  for (const r of h.rows.filter((x) => x.person === GRACE.name)) {
    assert.equal(r.childLimit, undefined, r.section ?? "");
    assert.ok(!(r.figure.kind === "worked_out" && r.figure.amount === 5000), JSON.stringify(r.figure));
  }
  // A line whose section number is not the row's own.
  const k = schedule([NGOZI, GRACE], [`3\tAccidental death\t${CELL}`], [ben({ section: "1", benefit: "Accidental death", pays: "percent", value: 100, percentOf: "sum_insured", quote: CELL })]);
  assert.equal(k.rows.find((x) => x.person === GRACE.name)!.childLimit, undefined);
});
test("gate R4-H2: a label carrying a footnote mark gets no child share; its note is never read", () => {
  for (const [label, note] of [["Accidental death*", "* Not payable for an insured child under 10."],
    ["Accidental death (a)", "Note (a): for an insured child the death benefit is limited to GBP 3,000."], ["Accidental death†", null]] as const) {
    const h = schedule([NGOZI, GRACE], [`1\t${label}\t${CELL}`, ...(note ? [note] : [])], [ben({ section: "1", benefit: "Accidental death", pays: "percent", value: 100, percentOf: "sum_insured", quote: CELL })]);
    assert.equal(h.rows.find((x) => x.person === GRACE.name)!.childLimit, undefined, label);
    assert.deepEqual(ask(h, GRACE.name, /death/, "If Grace died?").amounts, [], label);
  }
});
test("gate R4-H3: a page note about a child's benefit elsewhere on the page gives no child share", () => {
  for (const [cell, note] of [[CELL, "Note: for an insured child the death benefit is limited to GBP 3,000."],
    [CELL, "Children under 16 are covered for death benefit up to GBP 3,000 only."],
    // The older main bug: the row's own cell with a mark and the child's limit only in a note below.
    ["100% of the Sum Insured*", "* For an insured child under 18, limited to 25% of the Sum Insured."]] as const) {
    const h = schedule([NGOZI, DANIEL, GRACE], [`1\tAccidental death\t${cell}`, PTD, note], [
      ben({ section: "1", benefit: "Accidental death", pays: "percent", value: 100, percentOf: "sum_insured", quote: cell, conditions: cell === CELL ? [CLAUSE] : [] }),
      ben({ section: "2", benefit: "Permanent total disablement", pays: "percent", value: 100, percentOf: "sum_insured", quote: PTD })]);
    assert.equal(h.rows.find((x) => x.person === GRACE.name && /death/i.test(x.benefit))!.childLimit, undefined, note);
    assert.ok(!death(h, GRACE).amounts.length, note);
    // The row's own share with no child's sentence in its cell: the adults, whose own lines prove they are not children,
    // keep it (with the child's sentence read in the cell, the row keeps main's behaviour: no amount for anyone).
    if (cell !== CELL) {
      assert.deepEqual(death(h, NGOZI).amounts, ["£100,000"], note);
      assert.deepEqual(death(h, DANIEL).amounts, ["£80,000"], note);
    }
  }
});
test("gate R4-H1: a header cell mixing words and a figure is a header, never a row: the walk stops there", () => {
  const four = [P("Ngozi Okafor", "Policyholder", "", "", 100000, ["Ngozi Okafor", "Policyholder", "01/03/2026", "GBP 100,000"]),
    P("Daniel Okafor", "Spouse", "", "", 80000, ["Daniel Okafor", "Spouse", "01/03/2026", "GBP 80,000"]),
    P("Grace Okafor", "Child", "", "", 20000, ["Grace Okafor", "Child", "01/03/2026", "GBP 20,000"])];
  for (const head of ["Insured person\tRelationship\tCover start\tSum Insured (max GBP 250,000)", "Insured person\tRelationship\tCover start (from 01/03/2026)\tSum Insured",
    "Insured person\tRelationship\tCover start\tSum Insured, up to £1m"]) {
    const h = family(four, CELL, { header: `Proposer\tOccupation\tDate of birth\tNationality\nNgozi Okafor\tTeacher\t14/06/1984\tBritish\n${head}` });
    for (const p of four) assert.deepEqual(death(h, p).amounts, [], `${head} ${p.name}`);
  }
  // A date-of-birth cell that repeats another date of the line (the cover start) is not read.
  const lines = ["Insured person\tRelationship\tCover start\tDate of birth\tSum Insured", "Grace Okafor\tChild\t01/03/2026\t01/03/2026\tGBP 20,000"];
  assert.equal(printedLife(lines, 1, "Grace Okafor").birth, null);
  assert.equal(printedLife([lines[0], "Grace Okafor\tChild\t01/03/2026\t09/04/2017\tGBP 20,000"], 1, "Grace Okafor").birth, "09/04/2017");
});
test("gate R4-H4: a date-of-birth label followed by more words is not the person's", () => {
  for (const line of ["Grace Okafor, born 14/06/1984; policyholder's date", "Grace Okafor (DOB 14/06/1984), mother's date", "Grace Okafor, date of birth 14/06/1984, see parent"]) {
    assert.equal(printedLife([`${line}\tGBP 20,000`], 0, "Grace Okafor").birth, null, line);
    const g = { ...GRACE, line: `${line}\tGBP 20,000` };
    assert.deepEqual(death(family([NGOZI, g], CELL, { header: "Insured persons" }), g).amounts, [], line);
  }
  assert.equal(printedLife(["Grace Okafor (DOB 09/04/2017)\tGBP 20,000"], 0, "Grace Okafor").birth, "09/04/2017");
  assert.equal(printedLife(["Grace Okafor, born 09/04/2017"], 0, "Grace Okafor").birth, "09/04/2017");
});
// ---------- Gate round 5: a child-limit sentence anywhere in the document ----------
const ALL3 = [NGOZI, DANIEL, GRACE];
const AD_LINE = `1\tAccidental death\t${CELL}`;
/** The H1-B table (or a plain one) with more lines under it and an optional page 3: each person's AD and PTD figures. */
function r5(more: string[], o: { plain?: boolean; page3?: string; people?: Person[] } = {}) {
  const people = o.people ?? ALL3;
  const h = schedule(people, [o.plain ? "1\tAccidental death\t100% of the Sum Insured" : AD_LINE, PTD, ...more], [
    ben({ section: "1", benefit: "Accidental death", pays: "percent", value: 100, percentOf: "sum_insured", quote: o.plain ? "100% of the Sum Insured" : CELL, conditions: o.plain ? [] : [CLAUSE] }),
    ben({ section: "2", benefit: "Permanent total disablement", pays: "percent", value: 100, percentOf: "sum_insured", quote: PTD })], { page3: o.page3 });
  const fig = (p: Person, re: RegExp) => { const r = h.table.people.find((x) => x.name === p.name)!.rows.find((y) => re.test(y.benefit))!; return r.figure.kind === "worked_out" ? r.figure.amount : null; };
  return { h, ad: (p: Person) => fig(p, /Accidental/), ptd: (p: Person) => fig(p, /disable/), chat: (p: Person) => death(h, p).amounts };
}
test("gate R5-H1: a child-limit sentence on another page, naming a person, in a row of the same table, or in other words: no child share", () => {
  const cases: [string, string[], string | undefined][] = [
    ["page 3 note", [], "GENERAL CONDITIONS\nFor an insured child the death benefit is limited to GBP 3,000."],
    ["page 3 section note", [], "NOTES TO THE TABLE OF BENEFITS\nSection 1: for insured children under 10 nothing is payable."],
    ["note naming the child", ["Note: Grace Okafor, as an insured child, is limited to GBP 3,000 for death."], undefined],
    ["note naming the parent", ["Note: children of Ngozi Okafor are covered for death up to GBP 3,000 only."], undefined],
    ["same-table row", ["3\tChildren's limit\tFor every insured child, Sections 1 and 2 are limited to GBP 3,000."], undefined],
    ["same-table row, no number", ["Children's limit\tSections 1 and 2 are limited to GBP 3,000 for each insured child."], undefined],
    ["another row's child sentence", ["3\tFracture\t5% of the Sum Insured. Not payable for an insured child under 10."], undefined],
    ...["U18 lives: the death benefit is limited to GBP 3,000.", "Persons who have not reached age 18: death benefit limited to GBP 3,000.",
      "Young persons (aged 0-17): death benefit limited to GBP 3,000.", "Under-18s: death benefit limited to GBP 3,000."].map((w): [string, string[], undefined] => [w, [w], undefined]),
  ];
  for (const [name, more, page3] of cases) {
    const k = r5(more, { page3 });
    assert.equal(k.ad(GRACE), null, name);
    assert.deepEqual(k.chat(GRACE), [], name);
  }
  // A plain table under each wording: the child's own share is withheld, the adults keep theirs.
  for (const w of ["Persons under-18s are covered at 10% of the Sum Insured.", "Insured persons who have not reached age 18: 10% of the Sum Insured.",
    "Young persons (aged 0-17): 10% of the Sum Insured.", "For insured persons aged less than 18, Section 1 is limited to 10%.", "Students: Section 1 limited to 10% of the Sum Insured.",
    "U18 lives: 10% of the Sum Insured for death.", "Persons up to age 17 are paid 10%.", "3\tInsured children\tSections 1 and 2: 10% of the Sum Insured for each insured child."]) {
    const k = r5([w], { plain: true });
    assert.equal(k.ad(GRACE), null, w);
    assert.equal(k.ptd(GRACE), null, w);
    assert.deepEqual(k.chat(GRACE), [], w);
    assert.equal(k.ad(NGOZI), 100000, w);
    assert.deepEqual(k.chat(DANIEL), ["£80,000"], w);
  }
  // The child-limit sentence shapes, one by one.
  const notes = (t: string) => childLimitNotes([{ page: 1, text: t }], null);
  assert.deepEqual(notes("Section 1: for insured children under 10 nothing is payable."), { found: true, age: 10 });
  assert.deepEqual(notes("Young persons (aged 0-17): 10% of the Sum Insured."), { found: true, age: 18 });
  assert.deepEqual(notes("Insured children under 21: 50% of the Sum Insured."), { found: true, age: 21 });
  assert.deepEqual(notes("Note: for an insured child the death benefit is\nlimited to GBP 3,000."), { found: true, age: null });
  // Another row's own cell with an allow-listed child share is that row's own rule.
  assert.deepEqual(notes(`2\tPermanent total disablement\t${CELL}`), { found: false, age: null });
  // Not a child's limit: no child or age phrase as the subject, or no age word beside the number.
  for (const t of ["Benefit is paid only for stays under 3 nights; maximum 30 days.", "Exclusions: hairline fractures under 2 cm.",
    "Claims may be made by a son or daughter on behalf of an insured person, up to GBP 500.", "No benefit is payable for injury while minding children for reward."])
    assert.deepEqual(notes(t), { found: false, age: null }, t);
  // A people table's relationship cell is who a person is, never a limit (claim-journeys P5: "Dependent child").
  // Only on the people table (a line naming an insured person); a limits table's "Child" row is a limit (gate R6-H1).
  assert.deepEqual(childLimitNotes([{ page: 1, text: "Noah Kelly\tDependent child\t11/10/2015\tAUD 80,000" }], null, ["Noah Kelly"]), { found: false, age: null });
  assert.deepEqual(notes("Child\tGBP 3,000"), { found: true, age: null });
});
test("gate R5-H2: wording that is not a child's limit never withholds a child's figures", () => {
  for (const w of ["Hospital cash is paid for stays under 30 days.", "Exclusions: hairline fractures under 2 cm.", "Claims may be made by a son or daughter on behalf of an insured person.",
    "No benefit is payable for injury while minding children for reward.", "Exclusions: childbirth and pregnancy.", "Claims must be notified within 30 days."]) {
    const k = r5([w], { plain: true });
    assert.equal(k.ad(GRACE), 20000, w);
    assert.equal(k.ptd(GRACE), 20000, w);
    assert.deepEqual(k.chat(GRACE), ["£20,000"], w);
  }
});
test("gate R5-M1, R5-L1: a printed date of birth at or over the note's age proves an adult; the note's own age is used", () => {
  const note = "Insured children under 21: 50% of the Sum Insured.";
  const dan = (rel: string, dob: string) => P("Daniel Okafor", rel, dob, "GBP 80,000", 80000);
  for (const [rel, dob, want] of [["Main life", "02/11/1982", 80000], ["", "02/11/1982", 80000], ["Partner", "02/11/1982", 80000],
    ["Spouse", "01/06/2006", null], ["Policyholder", "01/06/2006", null], ["Spouse", "", null], ["Daughter", "02/11/1982", null]] as [string, string, number | null][]) {
    const d = dan(rel, dob);
    const k = r5([note], { plain: true, people: [NGOZI, d, GRACE] });
    assert.equal(k.ad(d), want, `${rel} ${dob}`);
    assert.deepEqual(k.chat(d), want ? [`£${want.toLocaleString("en-GB")}`] : [], `${rel} ${dob}`);
  }
  // A note with no age: 18, and an adult relationship with no date of birth still proves it.
  const spouse = P("Daniel Okafor", "Spouse", "", "GBP 80,000", 80000);
  const k = r5(["Note: for an insured child the death benefit is limited to GBP 3,000."], { plain: true, people: [NGOZI, spouse, GRACE] });
  assert.equal(k.ad(spouse), 80000);
  assert.equal(k.ad(GRACE), null);
});
// ---------- Gate round 6: giving a child's share needs a document with no other child or age words ----------
test("gate R6-H1: any other child or age wording in the document, however laid out, gives the child no share", () => {
  const cases: [string, string[], string | undefined][] = [
    ["split over a page break", ["Note: for an insured child the death"], "benefit is limited to GBP 3,000."],
    ["split by a tab footer", ["Note: for an insured child the death", "Page 2 of 3\tHPA-55120-K", "benefit is limited to GBP 3,000."], undefined],
    ["split by a blank line", ["Note: for an insured child the death", "", "benefit is limited to GBP 3,000."], undefined],
    ["heading then rule", ["CHILDREN", "The death benefit is limited to GBP 3,000 for each life in this section."], undefined],
    ...["Children: death benefit limited to GBP 3,000.", "Child - death benefit GBP 3,000 maximum.", "Sons and daughters of the policyholder: death benefit limited to GBP 3,000.",
      "Insured persons aged 17 and younger: death benefit limited to GBP 3,000.", "Insured persons aged between 0 and 17: death benefit limited to GBP 3,000.",
      "This applies to an insured child. The death benefit is then GBP 3,000.", "For an insured child (e.g. Grace) the death benefit is limited to GBP 3,000.",
      "Note: persons under 18 are limited to GBP 3,000 for death."].map((w): [string, string[], undefined] => [w, [w], undefined]),
    ["limits table by life", ["Life\tDeath benefit limit", "Adult\t100% of the Sum Insured", "Child\tGBP 3,000"], undefined],
    ["limits table, Insured child", ["Insured life\tDeath limit", "Insured child\tGBP 3,000 maximum"], undefined],
    ["limits table, Children", ["Life\tDeath benefit limit", "Children\tGBP 3,000"], undefined],
    ["Child up to", ["Child\tup to 10% of the Sum Insured"], undefined],
    ["another row's own child share", ["3\tFracture\t5% of the Sum Insured. For an insured child under 18, limited to 2% of the Sum Insured."], undefined],
    ["a Notes row shaped like an own cell (R6-L1)", ["9\tNotes\t100% of the Sum Insured. For an insured child under 18, limited to 10% of the Sum Insured."], undefined],
  ];
  for (const [name, more, page3] of cases) {
    const k = r5(more, { page3 });
    assert.equal(k.ad(GRACE), null, name);
    assert.deepEqual(k.chat(GRACE), [], name);
    assert.equal(k.h.table.people.find((p) => p.name === GRACE.name)!.rows.find((r) => /Accidental/.test(r.benefit))!.childLimit, undefined, name);
  }
  // The decision itself: only the row's own cell and the people table's relationship cells are left out.
  const page = (more: string) => [{ page: 1, text: `Insured person\tRelationship\nGrace Okafor\tChild\n1\tAccidental death\t${CELL}${more}` }];
  const own = (p: { text: string }[]) => ({ page: 1, from: p[0].text.indexOf("1\tAccidental"), to: p[0].text.length });
  const p0 = page("");
  assert.equal(childWordsElsewhere(p0, own(p0), ["Grace Okafor"]), false);
  for (const w of ["\nChild\tGBP 3,000", "\nCover ends at age 70.", "\nStudents are covered.", "\nPersons aged 18-21: 75%."]) {
    const p = [{ page: 1, text: `${p0[0].text}${w}` }];
    assert.equal(childWordsElsewhere(p, { page: 1, from: own(p0).from, to: own(p0).to }, ["Grace Okafor"]), true, w);
  }
  // Not an age: days, nights, cm.
  for (const w of ["\nHospital cash for stays under 30 days.", "\nFractures under 2 cm are not covered.", "\nClaims within 30 days."]) {
    const p = [{ page: 1, text: `${p0[0].text}${w}` }];
    assert.equal(childWordsElsewhere(p, { page: 1, from: own(p0).from, to: own(p0).to }, ["Grace Okafor"]), false, w);
  }
});
test("gate R6-H2: wording about premiums, payments, child care or school fees never withholds a child's plain figures", () => {
  for (const w of ["The death benefit is paid to the children of the insured person only if no spouse survives.", "Student discount: 10% off the premium.",
    "A parent staying with an insured child in hospital receives GBP 20 per day.", "Premiums for minors are payable by a parent only.",
    "Lump sums are paid to the policyholder; for a minor, payment is made to a parent or guardian only.", "Cover for persons under 70 years of age only."]) {
    const k = r5([w], { plain: true });
    assert.equal(k.ad(GRACE), 20000, w);
    assert.equal(k.ptd(GRACE), 20000, w);
    assert.deepEqual(k.chat(GRACE), ["£20,000"], w);
  }
  // A line right under the last row continues it on main, so its PTD is withheld as on main; the death row stays.
  for (const w of ["Child care benefit: up to GBP 50 per day for child care while the insured is in hospital.", "School fees benefit: up to GBP 1,000 per year for each dependent child of the insured."]) {
    const k = r5([w], { plain: true });
    assert.equal(k.ad(GRACE), 20000, w);
    assert.deepEqual(k.chat(GRACE), ["£20,000"], w);
  }
  // The splitter keeps abbreviations inside their sentence.
  assert.deepEqual(childLimitNotes([{ page: 1, text: "For an insured child (e.g. a son) the death benefit is limited to GBP 3,000." }], null), { found: true, age: null });
});
// ---------- Gate round 7: whatever its words, a sentence naming the row's benefit with a figure denies the child's share ----------
test("gate R7-H1: a limit on the child in any words, a people line's limit, or another language: no child share", () => {
  const notes = ["Offspring of the policyholder: death benefit limited to GBP 3,000.", "Youths: death benefit limited to GBP 3,000.", "Teenagers: death benefit limited to GBP 3,000.",
    "Teens are covered for death up to GBP 3,000 only.", "Pupils: death benefit limited to GBP 3,000.", "Babies and toddlers: death benefit limited to GBP 3,000.",
    "Boys and girls insured under this policy: death benefit GBP 3,000 maximum.", "Stepchildren and grandchildren: death benefit limited to GBP 3,000.",
    "For persons insured as dependants, Section 1 is limited to GBP 3,000.", "Persons aged under eighteen: death benefit limited to GBP 3,000.",
    "Insured persons who are not yet eighteen: death benefit limited to GBP 3,000.", "Insured persons born after 1 March 2008: death benefit limited to GBP 3,000.",
    "Lives with a date of birth after 01/03/2008: death benefit limited to GBP 3,000.", "Insured persons in full-time education: death benefit limited to GBP 3,000.",
    "Juniors: death benefit limited to GBP 3,000.", "Adolescents: death benefit limited to GBP 3,000.", "Anak (kanak-kanak): manfaat kematian terhad kepada GBP 3,000.",
    "Enfants : capital décès limité à 3 000 GBP.", "Benefit payable to a child is limited to GBP 3,000.", "Benefit payable on the death of an insured child is limited to GBP 3,000.",
    "Death of the youngest insured life: limited to GBP 3,000.", "Lives not yet of age: death benefit limited to GBP 3,000.", "Non-adult lives: death benefit limited to GBP 3,000.",
    "Persons who have not attained majority: death benefit limited to GBP 3,000.",
    // Vocabulary-free: the benefit named with a figure (no child word at all), or its section number.
    "Special lives: the death benefit is GBP 3,000.", "Section 1 is payable at GBP 3,000 for lives listed in the endorsement.",
  ];
  for (const n of notes) {
    const k = r5([n]);
    assert.equal(k.ad(GRACE), null, n);
    assert.deepEqual(k.chat(GRACE), [], n);
  }
  for (const [name, more, page3] of [["J1 a repeated header inside the note", ["Note: for an insured", "Section\tBenefit\tAmount payable", "child the death benefit is limited to GBP 3,000."], undefined],
    ["J2 a note in a cell after the row", ["\tNote: the death benefit for an insured child is limited to GBP 3,000."], undefined],
    ["J3 an abbreviated child on page 3", [], "Limits\tAmount\nIns. child\tGBP 3,000"], ["J4 'Ch. under 18'", ["Ch. under 18: death benefit limited to GBP 3,000."], undefined],
    ["P1 a limit inside a people line", [], "Grace Okafor\tChild\tdeath benefit limited to GBP 3,000"],
    ["P2 a people line 'Child (death GBP 3,000 max)'", [], "Grace Okafor\tChild (death GBP 3,000 max)"]] as [string, string[], string | undefined][]) {
    const k = r5(more, { page3 });
    assert.equal(k.ad(GRACE), null, name);
    assert.deepEqual(k.chat(GRACE), [], name);
  }
  // The control: nothing else, the share is given.
  assert.equal(r5([]).ad(GRACE), 5000);
  // The rule itself.
  const p0 = [{ page: 1, text: `Insured person\tRelationship\nGrace Okafor\tChild\n1\tAccidental death\t${CELL}\n2\tPermanent total disablement\t100% of the Sum Insured` }];
  const own = { page: 1, from: p0[0].text.indexOf("1\tAccidental"), to: p0[0].text.indexOf("\n2\t") };
  const row = { benefit: "Accidental death", section: "1" };
  assert.equal(childWordsElsewhere(p0, own, ["Grace Okafor"], row), false);
  for (const [w, want] of [["\nNote (a): Section 3 is paid at double, still subject to the GBP 1,500 maximum.", false], ["\nSec. 1: GBP 3,000 for listed lives.", true],
    ["\nDeath benefit: see endorsement.", false], ["\nAccidental injuries are paid at 50%.", true], ["\nAccidental death benefit for lives over 70: 50%.", true], ["\nRégime spécial.", true], ["\nBagi anak dan isteri.", true]] as [string, boolean][]) {
    const p = [{ page: 1, text: `${p0[0].text}${w}` }];
    assert.equal(childWordsElsewhere(p, own, ["Grace Okafor"], row), want, w);
  }
  // A person's name with letters outside A-Z is not another language.
  const zoe = [{ page: 1, text: p0[0].text.replace(/Grace Okafor/g, "Zoë Okafor") }];
  assert.equal(childWordsElsewhere(zoe, { page: 1, from: zoe[0].text.indexOf("1\tAccidental"), to: zoe[0].text.indexOf("\n2\t") }, ["Zoë Okafor"], row), false);
});
test("gate R7 LOW: a payee sentence that also limits with a figure counts for plain rows", () => {
  for (const w of ["Benefit payable to a child is limited to GBP 3,000.", "Payment on behalf of a minor is limited to GBP 3,000."]) {
    const k = r5([w], { plain: true });
    assert.equal(k.ad(GRACE), null, w);
    assert.equal(k.ad(NGOZI), 100000, w);
  }
  // Without a limit and a figure it still does not.
  assert.equal(r5(["The death benefit is paid to the children of the insured person only if no spouse survives."], { plain: true }).ad(GRACE), 20000);
});
// ---------- Gate round 8: decision (1) as an allow-list over everything that carries a figure or a limiting word ----------
function r8(extra: string[], o: { page3?: string; header?: string; label?: string; section?: string | null; printedSection?: string } = {}) {
  const sec = o.printedSection ?? "1";
  const h = schedule(ALL3, [`${sec}\tAccidental death\t${CELL}`, PTD, ...extra], [
    ben({ section: o.section === undefined ? sec : o.section, benefit: o.label ?? "Accidental death", pays: "percent", value: 100, percentOf: "sum_insured", quote: CELL, conditions: [CLAUSE] }),
    ben({ section: "2", benefit: "Permanent total disablement", pays: "percent", value: 100, percentOf: "sum_insured", quote: PTD })], { page3: o.page3, header: o.header });
  const lab = new RegExp((o.label ?? "Accidental death").split(" ")[0], "i");
  const row = h.table.people.find((x) => x.name === GRACE.name)!.rows.find((y) => lab.test(y.benefit));
  let chat: string[] = [];
  try { chat = ask(h, GRACE.name, lab, "If Grace died?").amounts; } catch { chat = []; }
  return { amount: row && row.figure.kind === "worked_out" ? row.figure.amount : null, chat };
}
test("gate R8-H1: any figure or limiting word not accounted for gives the child no share", () => {
  const FAM = "family members other than the policyholder and spouse";
  const cases: [string, string[], Parameters<typeof r8>[1]][] = [
    ...["Insured persons before their 18th birthday: loss of life benefit limited to GBP 3,000.", "Category B lives: payment on loss of life limited to GBP 3,000.",
      "For the third and each further insured person, the fatality benefit is GBP 3,000.", "If a life listed after the policyholder and spouse dies, we pay no more than GBP 3,000.",
      "Other family members: maximum GBP 3,000 if killed in an accident.", `${FAM} are covered for a fatal injury up to GBP 3,000.`,
      "Lives insured at the family rate: loss-of-life benefit GBP 3,000."].map((n): [string, string[], {}] => [n, [n], {}]),
    ["Item 1", [`Item 1 is limited to GBP 3,000 for each insured person other than the policyholder and spouse.`], {}],
    ["Benefit 1", [`Benefit 1 is limited to GBP 3,000 for each insured person other than the policyholder and spouse.`], {}],
    ["Cover 1", [`Cover 1: GBP 3,000 maximum for ${FAM}.`], {}],
    ["Section A", [`Section A is limited to GBP 3,000 for ${FAM}.`], { printedSection: "A" }],
    ["Section 1.1", [`Section 1.1 is limited to GBP 3,000 for ${FAM}.`], { printedSection: "1.1" }],
    ["Section I", [`Section I is limited to GBP 3,000 for ${FAM}.`], { printedSection: "I" }],
    ["Section 1(a)", [`Section 1(a) is limited to GBP 3,000 for ${FAM}.`], { printedSection: "1(a)" }],
    ["S1", [`S1 is limited to GBP 3,000 for ${FAM}.`], {}],
    ["Sections 2 and 1", [`Sections 2 and 1 are limited to GBP 3,000 for ${FAM}.`], {}],
    ["three thousand pounds", [`${FAM}: death benefit limited to three thousand pounds.`], {}],
    ["one tenth", [`${FAM}: death benefit limited to one tenth of the Sum Insured.`], {}],
    ["3,000 pounds", [`${FAM}: death benefit limited to 3,000 pounds.`], {}],
    ["halved", [`${FAM}: the death benefit is halved.`], {}],
    ["GBP3000", [`${FAM}: death benefit GBP3000 maximum.`], {}],
    ["header row note", ["Section\tBenefit\tAmount payable (lives other than the policyholder and spouse: max GBP 3,000 on loss of life)"], {}],
    ["own cell wraps to a cap line", ["\t\tsubject to a maximum of GBP 3,000 for family members."], {}],
    ["people header note", [], { header: "Insured person\tRelationship\tDate of birth\tSum Insured (family members: loss of life max GBP 3,000)" }],
    ["caption on page 3", [], { page3: "[Figure 2: Family members - loss of life benefit GBP 3,000]" }],
    ["people-line cell, synonym", [], { page3: "Grace Okafor\tDependent life\tloss of life benefit limited to GBP 3,000" }],
    ["people-line cell, Death", [], { page3: "Grace Okafor\tFamily member\tDeath benefit GBP 3,000 max" }],
    ["label Loss of life", [`${FAM}: Accidental death benefit limited to GBP 3,000.`], { label: "Loss of life" }],
    ["label AD, no section", [`${FAM}: death benefit limited to GBP 3,000.`], { label: "AD", section: null }],
    ["no section, note Section 1", [`Section 1 is limited to GBP 3,000 for ${FAM}.`], { section: null }],
    ["dying", [`${FAM} dying in an accident: GBP 3,000.`], {}],
    ...["Kanak-kanak: pampasan maut maksimum GBP 3,000.", "Mga anak: benepisyo sa kamatayan GBP 3,000.", "Figli: capitale morte limitato a GBP 3.000.",
      "Kinderen: overlijdensuitkering beperkt tot GBP 3.000.", "Tanggungan: pampasan maut had GBP 3,000."].map((n): [string, string[], {}] => [n, [n], {}]),
    ["an unrelated figure (fall back)", ["Accidental medical expenses up to GBP 2,500."], {}],
  ];
  for (const [name, extra, o] of cases) {
    const k = r8(extra, o);
    assert.equal(k.amount, null, name);
    assert.deepEqual(k.chat, [], name);
  }
  // Accounted for: the people table, a premium line, another read row's own line, a note naming another row, days and dates.
  assert.equal(r8([]).amount, 5000);
  for (const ok of [["Annual premium: GBP 312.00, payable by monthly direct debit of GBP 26.00."], ["Note (a): Section 2 is paid at double, subject to the GBP 1,500", "maximum per accident."],
    ["How to claim: notify us within 30 days of the accident on 0800 000 0000 (claims line)."], ["Date of issue: 20 February 2026 (renewal schedule; replaces the schedule dated 18 February", "2025)"],
    ["Policy number: HPA-55120-K\tPeriod of insurance: 1 March 2026 to 28 February 2027"], ["Page 2 of 3"]]) {
    const k = r8(ok);
    assert.equal(k.amount, 5000, ok.join(" / "));
    assert.deepEqual(k.chat, ["£5,000"], ok.join(" / "));
  }
  // A note naming another row and this one is not accounted for.
  assert.equal(r8(["Note: Section 2 and Section 1 are limited to GBP 3,000 for family members."]).amount, null);
  // The rule on the real layout: rows 2-6, a note naming Section 3, the premium line.
  const page = "Insured person\tRelationship\tDate of birth\tSum Insured\nNgozi Okafor\tPolicyholder\t14/06/1984\tGBP 100,000\nGrace Okafor\tChild\t09/04/2017\tGBP 20,000\nAnnual premium: GBP 312.00, payable by monthly direct debit of GBP 26.00.\n"
    + `1\tAccidental death\t${CELL}\n2\tPermanent total disablement\t100% of the Sum Insured\n3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)\n`
    + "Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500\nmaximum per accident.";
  const own = { page: 1, from: page.indexOf("1\tAccidental"), to: page.indexOf("\n2\tPermanent") };
  const sums = [{ person: "Ngozi Okafor", sum: 100000 }, { person: "Grace Okafor", sum: 20000 }];
  const rows = [{ benefit: "Accidental death", section: "1" }, { benefit: "Permanent total disablement", section: "2" }, { benefit: "Fracture of arm, wrist or leg", section: "3" }];
  assert.equal(childShareAllowed([{ page: 1, text: page }], own, ["Ngozi Okafor", "Grace Okafor"], rows[0], rows, sums), true);
  // A people line's sum insured that is not the one read for that person (gate R10-L1).
  assert.equal(childShareAllowed([{ page: 1, text: page }], own, ["Ngozi Okafor", "Grace Okafor"], rows[0], rows, [sums[0], { person: "Grace Okafor", sum: 3000 }]), false);
  assert.equal(childShareAllowed([{ page: 1, text: page }], own, ["Ngozi Okafor", "Grace Okafor"], rows[0], rows, [sums[0]]), false);
  // Without the fracture row in the reading, its line and its note are not accounted for.
  assert.equal(childShareAllowed([{ page: 1, text: page }], own, ["Ngozi Okafor", "Grace Okafor"], rows[0], rows.slice(0, 2), sums), false);
});
// ---------- Gate round 9: exact accounting classes, exclusions, and figures only stripped in context ----------
function r9(extra: string[], o: { header?: string; people?: Person[]; ptdLine?: string; page3?: string } = {}) {
  const people = o.people ?? ALL3;
  const h = schedule(people, [`1\tAccidental death\t${CELL}`, o.ptdLine ?? PTD, ...extra], [
    ben({ section: "1", benefit: "Accidental death", pays: "percent", value: 100, percentOf: "sum_insured", quote: CELL, conditions: [CLAUSE] }),
    ben({ section: "2", benefit: "Permanent total disablement", pays: "percent", value: 100, percentOf: "sum_insured", quote: "100% of the Sum Insured" })], { header: o.header, page3: o.page3 });
  const row = h.table.people.find((x) => x.name === GRACE.name)!.rows.find((y) => /Accidental/.test(y.benefit));
  let chat: string[] = [];
  try { chat = ask(h, GRACE.name, /Accidental/, "If Grace died?").amounts; } catch { chat = []; }
  return { amount: row && row.figure.kind === "worked_out" ? row.figure.amount : null, chat };
}
test("gate R9-H1: what the allow-list accepts is exact; exclusions and figures in any shape deny the child's share", () => {
  const H5 = (col: string) => `Insured person\tRelationship\tDate of birth\tSum Insured\t${col}`;
  const fam = (a: string, b: string, c: string) => [
    P("Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 100,000", 100000, ["Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 100,000", a]),
    P("Daniel Okafor", "Spouse", "02/11/1982", "GBP 80,000", 80000, ["Daniel Okafor", "Spouse", "02/11/1982", "GBP 80,000", b]),
    P("Grace Okafor", "Child", "09/04/2017", "GBP 20,000", 20000, ["Grace Okafor", "Child", "09/04/2017", "GBP 20,000", c])];
  const each = "for each further insured person";
  const cases: [string, string[], Parameters<typeof r9>[1]][] = [
    ["P1 a per-person 'Loss of life' column", [], { header: H5("Loss of life"), people: fam("GBP 100,000", "GBP 80,000", "GBP 3,000") }],
    ["P2 an 'Accidental death' column", [], { header: H5("Accidental death"), people: fam("GBP 100,000", "GBP 80,000", "GBP 3,000") }],
    ["P3 a 'Section 1 amount' column", [], { header: H5("Section 1 amount"), people: fam("GBP 100,000", "GBP 80,000", "GBP 3,000") }],
    ["P4 'Not covered'", [], { header: H5("Fatal injury cover"), people: fam("Covered", "Covered", "Not covered") }],
    ["P5 'Loss of life excluded'", [], { header: H5("Notes"), people: fam("-", "-", "Loss of life excluded") }],
    ["P6 'No fatality cover'", [], { header: H5("Notes"), people: fam("-", "-", "No fatality cover") }],
    ["P7 'max GBP 3k'", [], { header: H5("Notes"), people: fam("-", "-", "max GBP 3k") }],
    ["P8 'GBP 3,000 on loss of life'", [], { header: H5("Notes"), people: fam("-", "-", "GBP 3,000 on loss of life") }],
    ["R1 premium + up to", ["Premium: GBP 312 a year; each further insured person is covered up to GBP 3,000."], {}],
    ["R2 premium + only", ["Annual premium GBP 312, which buys GBP 3,000 of cover only for each further insured person."], {}],
    ["R3 premium + loss of life", ["Premium for each further insured person: GBP 40, for GBP 3,000 on loss of life."], {}],
    ["R4 premium + subject to", ["Instalment premium GBP 26, subject to GBP 3,000 cover for each further insured person."], {}],
    ["O1 PTD line names Section 1", [], { ptdLine: "2\tPermanent total disablement\t100% of the Sum Insured; Section 1 and this section limited to GBP 3,000 for each further person" }],
    ["O2 PTD line 'the benefit above'", [], { ptdLine: "2\tPermanent total disablement\t100% of the Sum Insured; this and the benefit above limited to GBP 3,000 for each further person" }],
    ["O3 PTD line 'items one and two'", [], { ptdLine: "2\tPermanent total disablement\t100% of the Sum Insured; items one and two limited to GBP 3,000 for each further person" }],
    ["O4 PTD line 'both sections'", [], { ptdLine: "2\tPermanent total disablement\t100% of the Sum Insured; both sections limited to GBP 3,000 for each further person" }],
    ["N1 all other sections", [`Note: Section 2 and all other sections are limited to GBP 3,000 ${each}.`], {}],
    ["N2 every other benefit", [`Permanent total disablement and every other benefit is limited to GBP 3,000 ${each}.`], {}],
    ["N3 Sections 1 to 6", [`Sections 1 to 6 are limited to GBP 3,000 ${each}.`], {}],
    ["N4 Sections 0-6", [`Sections 0-6 are limited to GBP 3,000 ${each}.`], {}],
    ["N5 the preceding section", [`Section 2 and the preceding section are limited to GBP 3,000 ${each}.`], {}],
    ...["benefit 3k", "benefit £3k", "benefit GBP3000", "benefit 3 000", "benefit GBP 10 000 000", "benefit 3.00 units", "benefit GBP-3000", "benefit equal to 30 days' Hospital cash"]
      .map((w): [string, string[], {}] => [w, [`Each further insured person: ${w}.`], {}]),
    ...["is covered for one-fourth of the Sum Insured", "is covered at one-eighth of the Sum Insured", "is covered at 1/8 of the Sum Insured", "born in March 2010 is covered at one-eighth of the Sum Insured"]
      .map((w): [string, string[], {}] => [w, [`Each further insured person ${w}.`], {}]),
    ["F11 does not apply", ["Accidental death cover does not apply to family members other than the spouse."], {}],
    ["F12 excluded", ["Loss of life is excluded for any further insured person."], {}],
    ["F13 no benefit is payable", ["No benefit is payable on the death of a further insured person."], {}],
    ["F14 a Nil row", ["\tFurther insured persons\tNil"], {}],
  ];
  for (const [name, extra, o] of cases) {
    const k = r9(extra, o);
    assert.equal(k.amount, null, name);
    assert.deepEqual(k.chat, [], name);
  }
  assert.equal(r9([]).amount, 5000);
  // Kept as accounted for: a telephone number beside "line", a time, a policy number, a general exclusion of causes, an
  // ordinal in another row's own line.
  for (const ok of [["How to claim: notify us within 30 days of the accident on 0800 000 0000 (claims line)."], ["Call us on 0800 000 0000 between 9am and 5pm."],
    ["Policy number: HPA-55120-K"], ["Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury."]]) {
    const k = r9(ok);
    assert.equal(k.amount, 5000, ok.join(" / "));
  }
  // Not accounted for: an exclusion of a group of people, a number beside a currency in a telephone's shape.
  assert.equal(r9(["Exclusions: any insured person over 70."]).amount, null);
  assert.equal(r9(["Call us on GBP 0800 000 000."]).amount, null);
});
test("gate R10: exclusions are an allow-list of causes; codes, times, dates and day counts are figures outside their own narrow context; a people line's sum insured is the one read", () => {
  const H5 = (col: string) => `Insured person\tRelationship\tDate of birth\tSum Insured\t${col}`;
  const fam = (a: string, b: string, c: string) => [
    P("Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 100,000", 100000, ["Ngozi Okafor", "Policyholder", "14/06/1984", "GBP 100,000", a]),
    P("Daniel Okafor", "Spouse", "02/11/1982", "GBP 80,000", 80000, ["Daniel Okafor", "Spouse", "02/11/1982", "GBP 80,000", b]),
    P("Grace Okafor", "Child", "09/04/2017", "GBP 20,000", 20000, ["Grace Okafor", "Child", "09/04/2017", "GBP 20,000", c])];
  const denied: [string, string[], Parameters<typeof r9>[1]][] = [
    ...["death before age 18", "death of a dependant", "school sports", "any accident before the eighteenth birthday", "injury sustained before adulthood",
      "injury during infancy or adolescence", "accidents to those still in school", "injury to a ward of the proposer's household", "injury sustained by a ward",
      "accidents before the end of compulsory schooling", "injury while in minority", "injury in youth", "injury before majority", "pre-adult injuries",
      "injury to schoolchildren", "injury sustained while in the care of a guardian", "accidents of the second generation", "grandchildren and stepchildren",
      "injury to the policyholder's issue", "injury to issue of the marriage", "war; injury before adulthood", "suicide, or injury to a ward"]
      .map((w): [string, string[], {}] => [`X ${w}`, [`Exclusions: ${w}.`], {}]),
    ["N1 plan code", ["Each further insured person is insured under plan C3000."], {}],
    ["N2 scheme code", ["Further insured persons join scheme FAM-3K."], {}],
    ["N3 call", ["Further insured persons: for death cover call 0300 3000 000."], {}],
    ["N4 line", ["Further insured persons are covered under line 0 3000 0000."], {}],
    ["N5 3 pm", ["Further insured persons are paid at 3 pm rates."], {}],
    ["N6 ratio 1:40", ["Further insured persons: ratio 1:40."], {}],
    ["N7 certificate no.", ["Further insured persons hold certificate no. FAM-3000 cover."], {}],
    ["N8 member ref", ["Further insured persons: member ref L-3000."], {}],
    ["N9 3 days", ["Further insured persons: 3 days."], {}],
    ["N10 03.03.3000", ["Further insured persons: 03.03.3000."], {}],
    ["N11 a time with no time word", ["Ratio 1:40 applies."], {}],
    ["N12 a date that is no date", ["Schedule ref 31.02.2026 applies."], {}],
    ["H1 'Premium or benefit limit'", [], { header: H5("Premium or benefit limit"), people: fam("GBP 100,000", "GBP 80,000", "GBP 3,000") }],
    ["H2 'Premium waived / death cap'", [], { header: H5("Premium waived / death cap"), people: fam("GBP 100,000", "GBP 80,000", "GBP 3,000") }],
    ["H3 'Maximum contribution'", [], { header: H5("Maximum contribution"), people: fam("GBP 100,000", "GBP 80,000", "GBP 3,000") }],
    ["H4 Premium 'GBP 3,000 max'", [], { header: H5("Premium"), people: fam("GBP 200", "GBP 100", "GBP 3,000 max") }],
    ["H5 Gender 'F (no cover)'", [], { header: H5("Gender"), people: fam("F", "M", "F (no cover)") }],
    ["H6 Gender 'Not insured'", [], { header: H5("Gender"), people: fam("F", "M", "Not insured") }],
    ["H8 'Age next birthday' '9 reduced'", [], { header: H5("Age next birthday"), people: fam("43", "44", "9 reduced") }],
    ["H9 a people line with no header", [], { page3: "Grace Okafor\tChild\t09/04/2017\tGBP 3,000" }],
    ["H10 a second people table printing another sum insured", [], { page3: "Insured person\tRelationship\tDate of birth\tSum Insured\nGrace Okafor\tChild\t09/04/2017\tGBP 3,000" }],
  ];
  for (const [name, extra, o] of denied) {
    const k = r9(extra, o);
    assert.equal(k.amount, null, name);
    assert.deepEqual(k.chat, [], name);
  }
  // Still accounted for: causes, a policy number, a time with am/pm or after "at", a real date beside a date word, a
  // second people table printing the same sums insured.
  for (const [ok, o] of [[["Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury."], {}],
    [["General exclusions - war; nuclear risks; injury while under the influence of alcohol."], {}], [["Exclusions: flying except as a fare-paying passenger; HIV."], {}],
    [["Policy number: HPA-55120-K"], {}], [["Claims line open from 9am to 5pm, last call at 16:30."], {}], [["Endorsement dated 03.03.2026."], {}],
    [[], { page3: "Insured person\tRelationship\tDate of birth\tSum Insured\nGrace Okafor\tChild\t09/04/2017\tGBP 20,000" }]] as [string[], Parameters<typeof r9>[1]][]) {
    const k = r9(ok, o);
    assert.equal(k.amount, 5000, ok.join(" / ") || "second people table");
    assert.deepEqual(k.chat, ["£5,000"], ok.join(" / ") || "second people table");
  }
});
test("gate L1: a printed date of birth that crosses the age inside the period is said as such, not as 'not printed'", () => {
  const sam = P("Sam Okafor", "Child", "01/12/2008", "GBP 20,000", 20000);
  const a = death(family([NGOZI, sam]), sam);
  assert.deepEqual(a.amounts, []);
  assert.ok(a.points.some((t) => /prints a date of birth \(01\/12\/2008\) that does not settle whether they are under 18 on every day/.test(t)), a.points.join(" | "));
  assert.ok(!a.points.some((t) => /does not print a date of birth/.test(t)));
});

// ---------- The real reader's shape (TE-ACC-20261114-R3): the child's sentence also read as a row of its own ----------
/** A family PA schedule laid out as the app's PDF reader prints one (pages as extracted), with made-up people and insurer,
 * and a reading in the shape the reader (prompt 2026-11-13.1) gave: the death row quoting its whole line with the child's
 * sentence as a condition, plus a second "Accidental death" row under column `childCol` paying `childPct`%. */
const BELLO = { a: "Amaka Bello", b: "Tunde Bello", c: "Zara Bello" };
function realShape(o: { childCol?: string | null; childPct?: number; childQuote?: string; childBenefit?: string; childSection?: string; extra?: Record<string, unknown>[];
  cell?: string; noParent?: boolean } = {}) {
  const cell = o.cell ?? CELL;
  const page1 = ["Northgate Assurance plc", "FAMILY PERSONAL ACCIDENT POLICY - SCHEDULE", "Policy number: NGA-0001-X\tPeriod of insurance: 1 March 2026 to 28 February 2027\tCurrency",
    "of this policy: Pounds sterling (GBP)", "Date of issue: 20 February 2026", "Insured person\tRelationship\tDate of birth\tSum Insured",
    `${BELLO.a}\tPolicyholder\t14/06/1984\tGBP 100,000`, `${BELLO.b}\tSpouse\t02/11/1982\tGBP 80,000`, `${BELLO.c}\tChild\t09/04/2017\tGBP 20,000`,
    "Annual premium: GBP 312.00, payable by monthly direct debit of GBP 26.00."].join("\n");
  const rows = [`1\tAccidental death\t${cell}`, "2\tPermanent total disablement\t100% of the Sum Insured",
    "3\tFracture of arm, wrist or leg\t2% of the Sum Insured per fracture, maximum GBP 1,500 per accident (note a)", "4\tFracture of skull, spine or pelvis\t5% of the Sum Insured per accident",
    "5\tHospital cash\tGBP 50 per day in hospital, payable from the third consecutive day, up to 30 days per accident", "6\tMedical expenses\tUp to GBP 2,500 per accident, after an excess of GBP 100 per claim"];
  const page2 = ["TABLE OF BENEFITS (all amounts in GBP)", "Section\tBenefit\tAmount payable", ...rows,
    "Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500", "maximum per accident.",
    "Exclusions: injury while taking part in motor racing or professional sport; self-inflicted injury.",
    "How to claim: notify Northgate Assurance within 30 days of the accident on 0800 000 0000", "(claims line) and send the completed claim form with the original hospital discharge summary."].join("\n");
  const product = "FAMILY PERSONAL ACCIDENT POLICY";
  const people = [[BELLO.a, "self", "Policyholder\t14/06/1984\tGBP 100,000", 100000], [BELLO.b, "spouse", "Spouse\t02/11/1982\tGBP 80,000", 80000], [BELLO.c, "child", "Child\t09/04/2017\tGBP 20,000", 20000]] as const;
  const d: Household["documents"][number] = { policyId: DOC, name: "Northgate-Family-PA-Schedule.pdf", insurer: "Northgate Assurance plc", productName: product, policyNumber: "NGA-0001-X", documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: people.map((p) => p[0]), supersededAt: null,
    processingStatus: "ready", pages: [page1, page2].map((text, i) => ({ page: i + 1, text })) };
  const house: Household = { accountId: ACC, members: people.map((p) => ({ name: p[0], relationship: p[1] })), documents: [d] };
  const family: FamilyMember[] = people.map((p, i) => ({ id: `m${i}`, display_name: p[0], relationship: p[1], date_of_birth: null }));
  const r = (x: Record<string, unknown>) => ({ cap: null, page: 2, basis: null, column: null, period: null, capQuote: null, baseQuote: null, baseAmount: null, percentOf: null, conditions: [], ...x });
  const childSentence = /For an insured child[^.]*\./.exec(cell)?.[0] ?? "";
  const benefits = [
    ...(o.noParent ? [] : [r({ pays: "percent", quote: rows[0], value: 100, benefit: "Accidental death", forWhom: "some_insured", section: "1", percentOf: "sum_insured", conditions: childSentence ? [childSentence] : [] })]),
    ...(o.childCol === null ? [] : [r({ pays: "percent", quote: o.childQuote ?? childSentence, value: o.childPct ?? 25, column: o.childCol ?? "Insured child under 18", benefit: o.childBenefit ?? "Accidental death",
      forWhom: "some_insured", section: o.childSection ?? "1", percentOf: "sum_insured" })]),
    r({ pays: "percent", quote: rows[1], value: 100, benefit: "Permanent total disablement", forWhom: "each_named_insured", section: "2", percentOf: "sum_insured" }),
    r({ cap: 1500, pays: "percent", quote: rows[2], value: 2, benefit: "Fracture of arm, wrist or leg", forWhom: "some_insured", section: "3", capQuote: "maximum GBP 1,500 per accident", percentOf: "sum_insured",
      conditions: ["note (a)", "Note (a): a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum per accident."] }),
    r({ pays: "percent", quote: rows[3], value: 5, benefit: "Fracture of skull, spine or pelvis", forWhom: "each_named_insured", section: "4", percentOf: "sum_insured" }),
    r({ pays: "per_day", quote: rows[4], value: 50, benefit: "Hospital cash", forWhom: "each_named_insured", fromDay: 3, maxDays: 30, section: "5",
      conditions: ["payable from the third consecutive day", "up to 30 days per accident"] }),
    r({ pays: "up_to", quote: rows[5], value: 2500, benefit: "Medical expenses", forWhom: "each_named_insured", section: "6", conditions: ["after an excess of GBP 100 per claim"] }),
    ...(o.extra ?? []).map(r),
  ];
  const src: SourceDoc = { id: d.policyId, name: d.name, readable: true, pages: d.pages };
  const reading = checkReading(src, { document: { kind: "personal_proof", plan: null, insurer: d.insurer, product, periodTo: "28 February 2027", periodFrom: "1 March 2026", namedPeople: people.map((p) => p[0]) },
    covers: people.map((p) => ({ asOf: "20 February 2026", page: 1, plan: null, cover: "Personal accident", quote: `${p[0]}\t${p[2]}`, person: p[0], endDate: "28 February 2027", product,
      startDate: "1 March 2026", sumInsured: p[3], policyNumber: "NGA-0001-X" })), benefits });
  const key = coverKeyOf({ product, cover: "Personal accident", plan: null, riderOf: null });
  const links = [...new Set(reading.benefits.map((b) => sectionKeyOf(DOC, b)))].map((section) => ({ section, cover: key, why: "the schedule's table of benefits" }));
  const table = assembleTable([reading], family, links, [], NOW);
  return { house, rows: chatRows(table, house), reading, table };
}
/** Each person's figure for a benefit, as the table shows it ("none" when it shows none, "-" when the row is not theirs). */
const figs = (h: ReturnType<typeof realShape>, benefit: RegExp) => Object.values(BELLO).map((n) => {
  const rs = h.table.people.find((p) => p.name === n)?.rows.filter((x) => benefit.test(x.benefit)) ?? [];
  return rs.length ? rs.map((x) => x.figure.kind === "none" ? "none" : `${x.figure.amount}${x.column ? ` [${x.column}]` : ""}`).join(",") : "-";
});
test("the real reader's shape: the child's row is folded into its parent; death 100,000 / 80,000 / 5,000; hospital cash and medical for everyone", () => {
  const h = realShape();
  assert.ok(!h.reading.benefits.some((b) => b.column), "no column row left");
  assert.deepEqual(figs(h, /Accidental death/), ["100000", "80000", "5000"]);
  assert.deepEqual(figs(h, /Hospital cash/), ["50", "50", "50"]);
  assert.deepEqual(figs(h, /Medical expenses/), ["2500", "2500", "2500"]);
  const z = { name: BELLO.c } as Person;
  assert.deepEqual(death(h as never, z).amounts, ["£5,000"]);
  assert.deepEqual(death(h as never, { name: BELLO.a } as Person).amounts, ["£100,000"]);
});
test("the child column allow-list", () => {
  for (const [c, want] of [["Insured child under 18", 18], ["Children (below 16)", 16], ["Dependent child", null], ["Minors aged 17 or under", 18], ["For an insured child under 21", 21]] as const)
    assert.deepEqual(childColumn(c), { belowAge: want }, c);
  for (const c of ["Plan A", "Plan B", "Adult", "Aged 65 and over", "Insured persons aged 70 or over", "Child plan", "Family", "Child under 18 (Plan A)", "Spouse", "Per insured person", ""])
    assert.equal(childColumn(c), undefined, c);
});
test("not folded, as before: plan or age-band columns, a child row with no parent, a child row whose figure or age differs from the page", () => {
  // Plan tier and age band columns stay columns: the document's plain table is blocked as on main.
  for (const extra of [{ pays: "up_to", quote: "Up to GBP 2,500 per accident", value: 2500, column: "Plan A", benefit: "Medical expenses", section: "6", forWhom: "some_insured" },
    { pays: "percent", quote: "100% of the Sum Insured", value: 100, column: "Aged 65 and over", benefit: "Permanent total disablement", section: "2", percentOf: "sum_insured", forWhom: "some_insured" }]) {
    const h = realShape({ extra: [extra] });
    assert.ok(h.reading.benefits.some((b) => b.column === extra.column), extra.column);
    assert.ok(figs(h, /Hospital cash/).every((f) => f === "-" || f === "none"), `${extra.column}: ${figs(h, /Hospital cash/)}`);
  }
  // A child column row for a benefit with no parent row: kept, and the plain table stays blocked.
  const orphan = realShape({ childBenefit: "Loss of limbs", childSection: "7" });
  assert.ok(orphan.reading.benefits.some((b) => b.column === "Insured child under 18"));
  assert.ok(figs(orphan, /Hospital cash/).every((f) => f === "-" || f === "none"));
  // The child row's figure, or its age, differs from the printed sentence: kept, and the parent loses its child share
  // (no death amount for anyone; never 25% or 30% by guess).
  // (The page's own 25% is printed: a child row read at a percentage the page does not print is dropped by the figure
  // check, and the parent's printed sentence decides as above.)
  for (const o of [{ childPct: 100, childQuote: "100% of the Sum Insured" }, { childCol: "Insured child under 16" }]) {
    const h = realShape(o);
    assert.ok(h.reading.benefits.some((b) => b.column), `${JSON.stringify(o)} ${JSON.stringify(h.reading.dropped)}`);
    const f = figs(h, /Accidental death/);
    assert.ok(f.every((x) => x.split(",").every((y) => y === "none" || y.includes("["))), `${JSON.stringify(o)}: ${f}`);
  }
  assert.deepEqual(figs(realShape({ childPct: 30 }), /Accidental death/), ["100000", "80000", "5000"]);
  // A disagreeing row's parent says why, never "a maximum ... not captured" (gate R2-L1).
  const why = realShape({ childCol: "Insured child under 16" }).table.people[0].rows.find((x) => x.benefit === "Accidental death" && !x.column)!.figure;
  assert.ok(why.kind === "none" && /read two ways/.test(why.why) && !/maximum/.test(why.why), JSON.stringify(why));
});
test("the fold decides on all of a parent's child rows together, in any order, and never changes the parent it read (gate R2-L2, L3)", () => {
  const agree = { pays: "percent", quote: "For an insured child under 18, limited to 25% of the Sum Insured.", value: 25, column: "Insured child under 18", benefit: "Accidental death", section: "1", percentOf: "sum_insured" };
  const disagree = { ...agree, column: "Dependent child" };
  for (const order of [[agree, disagree], [disagree, agree]]) {
    const h = realShape({ childCol: null, extra: order });
    assert.equal(h.reading.benefits.filter((b) => b.column).length, 2);
    assert.ok(figs(h, /Accidental death/).every((f) => f.split(",").every((y) => y === "none" || y.includes("["))));
  }
  const both = realShape({ childCol: null, extra: [agree, { ...agree }] });
  assert.equal(both.reading.benefits.filter((b) => b.column).length, 0);
  assert.deepEqual(figs(both, /Accidental death/), ["100000", "80000", "5000"]);
  // The parent object the fold was handed keeps its child share.
  const parent = { ...both.reading.benefits.find((b) => b.benefit === "Accidental death")! };
  const child = { ...parent, column: "Dependent child", childLimit: undefined, source: { ...parent.source, excerpt: "For an insured child under 18, limited to 25% of the Sum Insured." }, value: 25 };
  const out = foldChildColumns([parent, child], []);
  assert.ok(parent.childLimit && !parent.childLimitConflict);
  assert.ok(out[0] !== parent && out[0].childLimitConflict && !out[0].childLimit);
  // A child row whose quote is another cell of the page (the next row's "5% of the Sum Insured per accident" read at 5%):
  // kept, and the parent loses its child share.
  const elsewhere = realShape({ childPct: 5, childQuote: "5% of the Sum Insured per accident" });
  assert.ok(elsewhere.reading.benefits.some((b) => b.column));
  assert.ok(!figs(elsewhere, /Accidental death/).some((f) => /^(?:5000|100000|80000)$/.test(f)));
  // No child row at all (as R2's reading): unchanged from the first commit.
  assert.deepEqual(figs(realShape({ childCol: null }), /Accidental death/), ["100000", "80000", "5000"]);
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`FAIL ${f}`);
if (failures.length) process.exit(1);
