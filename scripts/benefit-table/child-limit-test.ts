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
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { amountsFromRows, chatRows, keepLabelledAmounts } from "@/lib/benefit-table/chat";
import type { Household } from "@/lib/simple-chat/library";
import { readModelAnswer, verifyAnswer, type ServerFigure } from "@/lib/simple-chat/verify";
import { childColumn, childLimitIn, personStatus, printedLife } from "@/lib/benefit-table/child-limit";
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
function schedule(people: Person[], tableLines: string[], benefits: Record<string, unknown>[], o: { product?: string; header?: string; period?: string | null; familyDob?: Record<string, string> } = {}) {
  const product = o.product ?? "Family Personal Accident";
  const page1 = `Example Assurance plc\n${product.toUpperCase()} - SCHEDULE${o.period === null ? "" : `\nPeriod of insurance: ${o.period ?? "1 March 2026 to 28 February 2027"}`}\n${o.header ?? "Insured person\tRelationship\tDate of birth\tSum Insured"}\n${people.map((p) => p.line).join("\n")}`;
  const page2 = `TABLE OF BENEFITS\nSection\tBenefit\tAmount payable\n${tableLines.join("\n")}`;
  const d: Household["documents"][number] = { policyId: DOC, name: `${product}.pdf`, insurer: "Example Assurance plc", productName: product, policyNumber: null, documentType: null,
    documentRole: "personal_schedule", effectiveDate: null, expiryDate: null, uploadedAt: "2026-10-01", uploadedFor: null, linkedPeople: people.map((p) => p.name), supersededAt: null,
    processingStatus: "ready", pages: [page1, page2].map((text, i) => ({ page: i + 1, text })) };
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
  assert.deepEqual(printedLife(["Insured: Tom Lee (date of birth: 3 May 2015)"], 0).birth, "3 May 2015");
  // A start date column is not a date of birth.
  assert.deepEqual(printedLife(["Name\tCover start\tSum", "Tom Lee\t01/03/2015\tGBP 5,000"], 1), { birth: null, relationship: null });
  // Two dates on the line beside a label: not settled.
  assert.equal(printedLife(["Tom Lee DOB: 03/05/2015, joined 01/03/2020"], 0).birth, null);
  const day = printedDay("13/11/2026")!;
  assert.equal(personStatus({ birth: "09/04/2017", relationship: null }, { belowAge: 18 }, [day]), "child");
  assert.equal(personStatus({ birth: "14/06/1984", relationship: null }, { belowAge: 18 }, [day]), "not_child");
  assert.equal(personStatus({ birth: null, relationship: "Child" }, { belowAge: 18 }, [day]), null, "an age needs a date of birth");
  assert.equal(personStatus({ birth: null, relationship: "Child" }, { belowAge: null }, [day]), "child");
  assert.equal(personStatus({ birth: null, relationship: "Spouse" }, { belowAge: null }, [day]), "not_child");
  assert.equal(personStatus({ birth: null, relationship: "Nominee" }, { belowAge: null }, [day]), null);
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
