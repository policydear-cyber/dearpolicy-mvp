/** A row's figure is printed on the row's own line, and a count is never money (wrapped-quote gate, "Older bugs on main").
 *
 * P1: a quote copied in page order that runs over two rows prints the other row's figure too. "Hospital cash\tS$100 per
 * day\nSurgical fees\tS$5,000" read as Hospital cash 5,000 showed "Hospital cash S$5,000"; "(a) loss of one limb\n(b) loss
 * of sight of one eye\tS$100,000" showed the limb up to S$100,000. A row's figure now counts only on its own lines: the line
 * whose label is the row's, and the lines that carry that row on (lib/benefit-table/own-row.ts). Otherwise the row stays,
 * with no figure.
 * P2: "Angioplasty, up to a maximum of 2 procedures per year\t10% of the Sum Covered" read with cap 2 was worked out as
 * "up to S$2". A cap is money only when printed as a money figure (a bare "$" sets no currency) or bare on a page that
 * declares a currency, and never before a count noun; an amount printed only as a count is no amount.
 * Made-up schedules; no model, database or network.
 *   npm run benefit-table:cross-row-test */
import assert from "node:assert/strict";
import { assembleTable, coverKeyOf, sectionKeyOf, type FamilyMember } from "@/lib/benefit-table/assemble";
import { checkReading, type SourceDoc } from "@/lib/benefit-table/check";
import { ownRowText, printedOnlyAsCount } from "@/lib/benefit-table/own-row";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|GEMINI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const DOC = "eeeeeeee-0000-4000-8000-0000000000x1";
const family: FamilyMember[] = [{ id: "p1", display_name: "Jane Doe" }];
const PRODUCT = "Harbour Shield Plan";
const reading = (benefits: unknown[]) => ({
  document: { kind: "personal_proof", product: PRODUCT, insurer: null, namedPeople: ["Jane Doe"], plan: null, periodFrom: null, periodTo: null },
  covers: [{ person: "Jane Doe", product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null, policyNumber: "HS-1001", sumInsured: 200000, premium: null,
    premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: "Sum Insured\tS$200,000" }],
  benefits,
});
const row = (o: Record<string, unknown>) => ({ section: "Benefits", column: null, pays: "amount", period: null, basis: null, asOf: null, percentOf: null, baseAmount: null,
  baseQuote: null, cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
/** The schedule with `table` under its heading, read with `rows`; the checked rows and the table's figures for Jane. */
function run(table: string, rows: Record<string, unknown>[], head = "TABLE OF BENEFITS") {
  const text = `POLICY SCHEDULE\nLife Assured: Jane Doe\nPolicy No: HS-1001\nSum Insured\tS$200,000\n${head}\n${table}\nSee your policy wording for the full terms.`;
  const doc: SourceDoc = { id: DOC, name: "Harbour schedule.pdf", readable: true, pages: [{ page: 1, text }] };
  const r = checkReading(doc, reading(rows.map(row)));
  const t = assembleTable([r], family, [{ section: sectionKeyOf(DOC, { section: "Benefits", column: null }), cover: coverKeyOf({ product: PRODUCT, cover: PRODUCT, plan: null, riderOf: null }), why: "the plan's table" }]);
  const figures = new Map(t.people[0].rows.map((x) => [x.benefit, x.figure as { kind: string; amount?: number; currency?: string | null }]));
  return { r, figures, b: (name: string) => r.benefits.find((x) => x.benefit === name) };
}
const amountOf = (f: { kind: string; amount?: number } | undefined) => f && f.kind !== "none" ? f.amount ?? null : null;

// ---------- P1: the figure on another row's line ----------
test("gate P1a: Hospital cash quoted with the next row never takes Surgical fees' S$5,000", () => {
  const { r, figures } = run("Hospital cash\tS$100 per day\nSurgical fees\tS$5,000",
    [{ benefit: "Hospital cash", value: 5000, quote: "Hospital cash\tS$100 per day\nSurgical fees\tS$5,000" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), null, "no amount");
  assert.ok(figures.has("Hospital cash"), "the row stays, with no figure");
  assert.ok(r.dropped.some((d) => /another row's line/.test(d.why)));
});
test("gate P1b: (a) loss of one limb never takes (b)'s S$100,000", () => {
  const { figures } = run("Permanent disablement:\n(a) loss of one limb\n(b) loss of sight of one eye\tS$100,000",
    [{ benefit: "Loss of one limb", pays: "up_to", value: 100000, quote: "(a) loss of one limb\n(b) loss of sight of one eye\tS$100,000" }]);
  assert.equal(amountOf(figures.get("Loss of one limb")), null);
});
test("roman items: (i) loss of speech never takes (ii) loss of hearing's figure", () => {
  const { figures } = run("(i) loss of speech\n(ii) loss of hearing in both ears\tS$50,000",
    [{ benefit: "Loss of speech", value: 50000, quote: "(i) loss of speech\n(ii) loss of hearing in both ears\tS$50,000" }]);
  assert.equal(amountOf(figures.get("Loss of speech")), null);
});
test("bullets: Ambulance never takes the next bullet's S$500", () => {
  const { figures } = run("• Ambulance\n• Emergency room treatment\tS$500",
    [{ benefit: "Ambulance", pays: "up_to", value: 500, quote: "• Ambulance\n• Emergency room treatment\tS$500" }]);
  assert.equal(amountOf(figures.get("Ambulance")), null);
});
test("numbered rows: 1. Hospital cash never takes 2. Surgical fees' figure", () => {
  const { figures } = run("1. Hospital cash\tS$100 per day\n2. Surgical fees\tS$5,000",
    [{ benefit: "Hospital cash", value: 5000, quote: "1. Hospital cash\tS$100 per day\n2. Surgical fees\tS$5,000" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), null);
});
test("two rows on one line: Hospital cash never takes the next cell pair's S$5,000", () => {
  const { figures } = run("Hospital cash\tS$100 per day\tSurgical fees\tS$5,000",
    [{ benefit: "Hospital cash", value: 5000, quote: "Hospital cash\tS$100 per day\tSurgical fees\tS$5,000" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), null);
});
test("the quote starts on the row above: Hospital cash never takes Surgical fees' figure", () => {
  const { figures } = run("Surgical fees\tS$5,000\nHospital cash\tS$100 per day",
    [{ benefit: "Hospital cash", value: 5000, quote: "Surgical fees\tS$5,000\nHospital cash\tS$100 per day" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), null);
});
test("an unmarked line naming another loss, with the figure: Loss of one limb gets none", () => {
  const { figures } = run("Loss of one limb\nLoss of sight of one eye\tS$100,000",
    [{ benefit: "Loss of one limb", value: 100000, quote: "Loss of one limb\nLoss of sight of one eye\tS$100,000" }]);
  assert.equal(amountOf(figures.get("Loss of one limb")), null);
});
test("a day count on the next row is not this row's; its own daily figure stays", () => {
  const { b } = run("Hospital cash\tS$100 per day\nICU cash\tS$200 per day, up to 30 days",
    [{ benefit: "Hospital cash", pays: "per_day", value: 100, maxDays: 30, quote: "Hospital cash\tS$100 per day\nICU cash\tS$200 per day, up to 30 days" }]);
  assert.equal(b("Hospital cash")?.value, 100);
  assert.equal(b("Hospital cash")?.maxDays, null);
});
test("a cap on the next row's line is not this row's cap", () => {
  const { figures, b } = run("Angioplasty\t10% of the Sum Insured\nBypass surgery\tup to S$25,000",
    [{ benefit: "Angioplasty", pays: "percent", value: 10, percentOf: "sum_insured", cap: 25000, capQuote: "up to S$25,000", quote: "Angioplasty\t10% of the Sum Insured\nBypass surgery\tup to S$25,000" }]);
  assert.equal(b("Angioplasty")?.cap, null);
  assert.equal(amountOf(figures.get("Angioplasty")), null);
});

// ---------- P1 controls: the row's own figure is kept ----------
test("control: a single-line row keeps its figure", () => {
  const { figures } = run("Hospital cash\tS$100 per day\nSurgical fees\tS$5,000",
    [{ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash\tS$100 per day" }, { benefit: "Surgical fees", value: 5000, quote: "Surgical fees\tS$5,000" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), 100);
  assert.equal(amountOf(figures.get("Surgical fees")), 5000);
});
test("control: a label wrapped in lower case keeps its figure", () => {
  const { figures } = run("Emergency medical evacuation and\nrepatriation\tUSD 1,000,000",
    [{ benefit: "Emergency medical evacuation and repatriation", pays: "up_to", value: 1000000, quote: "Emergency medical evacuation and\nrepatriation\tUSD 1,000,000" }]);
  assert.equal(amountOf(figures.get("Emergency medical evacuation and repatriation")), 1000000);
});
test("control: a label wrapped in upper case, with the figure on its second line, keeps its figure", () => {
  const { figures } = run("Comprehensive Critical\nIllness Benefit\tS$300,000",
    [{ benefit: "Comprehensive Critical Illness Benefit", value: 300000, quote: "Comprehensive Critical\nIllness Benefit\tS$300,000" }]);
  assert.equal(amountOf(figures.get("Comprehensive Critical Illness Benefit")), 300000);
});
test("control: a figure on a line of its own below the label, and a day limit carrying the row on", () => {
  const { figures, b } = run("Hospital cash\nS$100 per day\nup to 30 days per year",
    [{ benefit: "Hospital cash", pays: "per_day", value: 100, maxDays: 30, quote: "Hospital cash\nS$100 per day\nup to 30 days per year" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), 100);
  assert.equal(b("Hospital cash")?.maxDays, 30);
});
test("control: sub-items keep their own figures, on their own lines, under a heading", () => {
  const table = "Permanent disablement:\n(a) loss of one limb\tS$100,000\n(b) loss of sight of one eye\tS$50,000";
  const { figures } = run(table, [
    { benefit: "Loss of one limb", pays: "up_to", value: 100000, quote: "Permanent disablement:\n(a) loss of one limb\tS$100,000" },
    { benefit: "Loss of sight of one eye", pays: "up_to", value: 50000, quote: table },
    { benefit: "Permanent disablement - loss of one limb", pays: "up_to", value: 100000, quote: table },
  ]);
  assert.equal(amountOf(figures.get("Loss of one limb")), 100000);
  assert.equal(amountOf(figures.get("Loss of sight of one eye")), 50000);
  assert.equal(amountOf(figures.get("Permanent disablement - loss of one limb")), 100000);
});
test("control: the heading itself never takes a sub-item's figure", () => {
  const table = "Permanent disablement:\n(a) loss of one limb\tS$100,000\n(b) loss of sight of one eye\tS$50,000";
  const { figures } = run(table, [{ benefit: "Permanent disablement", pays: "up_to", value: 100000, quote: table }]);
  assert.equal(amountOf(figures.get("Permanent disablement")), null);
});
test("control: the quote starts on the row above, and the row's own figure is on its own line", () => {
  const { figures } = run("Surgical fees\tS$5,000\nHospital cash\tS$100 per day",
    [{ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Surgical fees\tS$5,000\nHospital cash\tS$100 per day" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), 100);
});
test("control: a heading above the row, read under another name, keeps the row's figure", () => {
  const { figures } = run("Hospital benefits\nHospital cash\tS$100 per day",
    [{ benefit: "Daily hospital allowance", pays: "per_day", value: 100, quote: "Hospital benefits\nHospital cash\tS$100 per day" }]);
  assert.equal(amountOf(figures.get("Daily hospital allowance")), 100);
});
test("control: the row's own cap on the line that carries it on is worked out", () => {
  const { figures } = run("Angioplasty\t10% of the Sum Insured\nsubject to a maximum of S$15,000",
    [{ benefit: "Angioplasty", pays: "percent", value: 10, percentOf: "sum_insured", cap: 15000, capQuote: "subject to a maximum of S$15,000", quote: "Angioplasty\t10% of the Sum Insured\nsubject to a maximum of S$15,000" }]);
  assert.equal(amountOf(figures.get("Angioplasty")), 15000);
});
test("control: two rows on one line, the row quoted alone keeps its figure", () => {
  const { figures } = run("Surgical fees\tS$5,000\tHospital cash\tS$100 per day",
    [{ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash\tS$100 per day" }, { benefit: "Surgical fees", value: 5000, quote: "Surgical fees\tS$5,000" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), 100);
  assert.equal(amountOf(figures.get("Surgical fees")), 5000);
});
test("control: a figure and its per-day words in cells of one row stay the row's", () => {
  const { figures } = run("Hospital cash\tS$100\tPer Day\tmax 30 days",
    [{ benefit: "Hospital cash", pays: "per_day", value: 100, quote: "Hospital cash\tS$100\tPer Day\tmax 30 days" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), 100);
});
test("ownRowText: one row is the whole quote; two rows give the row's own text", () => {
  const page = "Hospital cash\tS$100 per day\nSurgical fees\tS$5,000";
  assert.deepEqual(ownRowText("Hospital cash\tS$100 per day", 0, 27, "Hospital cash"), { rows: 1, text: "Hospital cash\tS$100 per day" });
  const two = ownRowText(page, 0, page.length, "Hospital cash");
  assert.equal(two.rows, 2);
  assert.equal(two.text, "Hospital cash\tS$100 per day");
  assert.equal(ownRowText(page, 0, page.length, "Accident benefit").text, null, "no row is like it: none");
});

// ---------- P2: a count is never money ----------
const ANGIO = "Angioplasty, up to a maximum of 2 procedures per year\t10% of the Sum Covered per procedure";
test("gate P2: a cap of 2 procedures is never worked out as up to S$2", () => {
  const { figures, b } = run(ANGIO, [{ benefit: "Angioplasty", pays: "percent", value: 10, percentOf: "sum_insured", cap: 2, capQuote: "up to a maximum of 2 procedures", quote: ANGIO }]);
  const { r } = run(ANGIO, [{ benefit: "Angioplasty", pays: "percent", value: 10, percentOf: "sum_insured", cap: 2, capQuote: "up to a maximum of 2 procedures", quote: ANGIO }]);
  assert.equal(b("Angioplasty")?.cap, null);
  assert.equal(amountOf(figures.get("Angioplasty")), null, "no amount: the row's maximum is a count");
  assert.ok(r.dropped.some((d) => /not printed as money/.test(d.why)));
});
test("a declared page currency never makes 2 procedures money", () => {
  const { b, figures } = run(ANGIO, [{ benefit: "Angioplasty", pays: "percent", value: 10, percentOf: "sum_insured", cap: 2, capQuote: "up to a maximum of 2 procedures", quote: ANGIO }], "TABLE OF BENEFITS (S$)");
  assert.equal(b("Angioplasty")?.cap, null);
  assert.notEqual(amountOf(figures.get("Angioplasty")), 2);
});
test("an amount printed only as a count is no amount (up to 2 procedures, 10 sessions)", () => {
  const { figures } = run(`${ANGIO}\nPhysiotherapy\tup to 10 sessions per year`, [
    { benefit: "Angioplasty", pays: "up_to", value: 2, quote: ANGIO },
    { benefit: "Physiotherapy", pays: "up_to", value: 10, quote: "Physiotherapy\tup to 10 sessions per year" },
  ], "TABLE OF BENEFITS (S$)");
  assert.equal(amountOf(figures.get("Angioplasty")), null);
  assert.equal(amountOf(figures.get("Physiotherapy")), null);
  assert.ok(figures.has("Physiotherapy"), "the row stays");
});
test("a bare number cap is money only on a page that declares a currency; a bare $ cap never sets its currency", () => {
  const q = "Physiotherapy\t80% of the Sum Insured, up to 2,000";
  const none = run(q, [{ benefit: "Physiotherapy", pays: "percent", value: 80, percentOf: "sum_insured", cap: 2000, capQuote: "up to 2,000", quote: q }]);
  assert.equal(none.b("Physiotherapy")?.cap, null);
  assert.equal(amountOf(none.figures.get("Physiotherapy")), null);
  const declared = run(q, [{ benefit: "Physiotherapy", pays: "percent", value: 80, percentOf: "sum_insured", cap: 2000, capQuote: "up to 2,000", quote: q }], "TABLE OF BENEFITS (S$)");
  assert.equal(declared.b("Physiotherapy")?.cap, 2000);
  assert.equal(amountOf(declared.figures.get("Physiotherapy")), 2000);
  const d = "Physiotherapy\t80% of the Sum Insured, up to $2,000";
  const dollar = run(d, [{ benefit: "Physiotherapy", pays: "percent", value: 80, percentOf: "sum_insured", cap: 2000, capQuote: "up to $2,000", quote: d }]);
  assert.equal(dollar.b("Physiotherapy")?.cap, 2000, "kept, as on main");
  assert.equal(dollar.b("Physiotherapy")?.capCurrency, undefined, "a bare $ sets no currency");
});
test("control: a cap in S$ beside a count of visits is kept", () => {
  const q = "Physiotherapy\t80% of the Sum Insured, up to S$2,000 per year (max 10 visits)";
  const { b, figures } = run(q, [{ benefit: "Physiotherapy", pays: "percent", value: 80, percentOf: "sum_insured", cap: 2000, capQuote: "up to S$2,000", quote: q }]);
  assert.equal(b("Physiotherapy")?.cap, 2000);
  assert.equal(amountOf(figures.get("Physiotherapy")), 2000);
});
test("control: a cap read from the row's own words in S$ is kept", () => {
  const q = "Fracture\t10% of the Sum Insured (up to S$5,000)";
  const { figures } = run(q, [{ benefit: "Fracture", pays: "percent", value: 10, percentOf: "sum_insured", quote: q }]);
  assert.equal(amountOf(figures.get("Fracture")), 5000);
});
test("control: a daily amount beside a count of days keeps both", () => {
  const q = "Hospital cash\tS$100 per day, up to 30 days";
  const { b, figures } = run(q, [{ benefit: "Hospital cash", pays: "per_day", value: 100, maxDays: 30, quote: q }]);
  assert.equal(amountOf(figures.get("Hospital cash")), 100);
  assert.equal(b("Hospital cash")?.maxDays, 30);
});
test("printedOnlyAsCount: counts are counts, money is money", () => {
  assert.equal(printedOnlyAsCount("up to a maximum of 2 procedures", 2), true);
  for (const noun of ["treatments", "visits", "sessions", "days", "nights", "weeks", "months", "years", "claims", "times", "events", "persons", "children", "items", "pairs"])
    assert.equal(printedOnlyAsCount(`up to 3 ${noun}`, 3), true, noun);
  assert.equal(printedOnlyAsCount("S$100 per day, up to 100 days", 100), false, "printed as money too");
  assert.equal(printedOnlyAsCount("up to S$2,000", 2000), false);
  assert.equal(printedOnlyAsCount("2 procedures", 3), false, "not printed");
});

// ---------- Cross-row gate round 1 (/mnt/project-files/test-engineer/cross-row-gate.md) ----------
test("M0: a cap after the quote, on the row's own cells of a two-row line, is still the row's (TE L22)", () => {
  const { figures } = run("Hip\t75% up to S$50,000\tWrist\t20% up to S$5,000",
    [{ benefit: "Hip", pays: "percent", value: 75, percentOf: "sum_insured", cap: 50000, capQuote: "up to S$50,000", quote: "Hip\t75%" }]);
  assert.equal(amountOf(figures.get("Hip")), 50000);
});
test("M1: a figure printed with a currency is never a count, whatever word follows it", () => {
  const a = run("Hospital income\tS$150\tDays 1-30", [{ benefit: "Hospital income", pays: "per_day", value: 150, quote: "Hospital income\tS$150\tDays 1-30" }]);
  assert.equal(amountOf(a.figures.get("Hospital income")), 150);
  const b = run("Hospital income: S$200 days 1-30, S$100 thereafter", [{ benefit: "Hospital income", pays: "per_day", value: 200, quote: "Hospital income: S$200 days 1-30, S$100 thereafter" }]);
  assert.equal(amountOf(b.figures.get("Hospital income")), 200);
  const c = run("Family benefit\tS$1,000 Children", [{ benefit: "Family benefit", value: 1000, quote: "Family benefit\tS$1,000 Children" }]);
  assert.equal(amountOf(c.figures.get("Family benefit")), 1000);
});
test("M2: a tier line (Days 1-30) carries the row above on", () => {
  const { figures } = run("Hospital income\nDays 1-30\tS$150 per day\nDays 31-90\tS$75 per day",
    [{ benefit: "Hospital income", pays: "per_day", value: 150, quote: "Hospital income\nDays 1-30\tS$150 per day" }]);
  assert.equal(amountOf(figures.get("Hospital income")), 150);
});
test("H3: a figure above the label is never taken when the page prints figures below their labels", () => {
  const p = run("(a) Left Hand\n70%\n(b) Right Hand\n60%", [{ benefit: "Right Hand", pays: "percent", value: 70, percentOf: "sum_insured", quote: "70%\n(b) Right Hand" }]);
  assert.equal(amountOf(p.figures.get("Right Hand")), null);
  assert.notEqual(p.b("Right Hand")?.value, 70);
  const m = run("(a) Left Hand\nS$5,000\n(b) Right Hand\nS$3,000", [{ benefit: "Right Hand", value: 5000, quote: "S$5,000\n(b) Right Hand" }]);
  assert.equal(amountOf(m.figures.get("Right Hand")), null);
});
test("H3 control: a figure extracted just above its label, between labelled rows, is the row's", () => {
  const { b } = run("(a) Both Hands\t100%\n70%\n(b) Right Hand\n(c) Left Hand\t50%", [{ benefit: "Right Hand", pays: "percent", value: 70, percentOf: "sum_insured", quote: "70%\n(b) Right Hand" }]);
  assert.equal(b("Right Hand")?.value, 70);
});
test("H1: a label line with its figure on the next line is another row", () => {
  const a = run("Hospital cash\tS$100 per day\nSurgical fees\n\tS$5,000", [
    { benefit: "Hospital cash", value: 5000, quote: "Hospital cash\tS$100 per day\nSurgical fees\n\tS$5,000" },
    { benefit: "Surgical fees", pays: "per_day", value: 100, quote: "Hospital cash\tS$100 per day\nSurgical fees\n\tS$5,000" }]);
  assert.equal(amountOf(a.figures.get("Hospital cash")), null);
  assert.equal(amountOf(a.figures.get("Surgical fees")), null);
  const b = run("Hospital cash\nS$100 per day\nSurgical fees\nS$5,000", [{ benefit: "Hospital cash", value: 5000, quote: "Hospital cash\nS$100 per day\nSurgical fees\nS$5,000" }]);
  assert.equal(amountOf(b.figures.get("Hospital cash")), null);
});
test("H2: a figure alone on a line after the row's own figure is not the row's", () => {
  const { figures } = run("Hospital cash\tS$100 per day\nS$5,000\tSurgical fees", [{ benefit: "Hospital cash", value: 5000, quote: "Hospital cash\tS$100 per day\nS$5,000\tSurgical fees" }]);
  assert.equal(amountOf(figures.get("Hospital cash")), null);
});
test("H4: a next row's label in lower case, or starting with Per or And, is still another row", () => {
  for (const next of ["surgical fees\tS$5,000", "Per Disability Limit\tS$5,000", "And Ambulance\tS$5,000"]) {
    const q = `Hospital cash\tS$100 per day\n${next}`;
    const { figures } = run(q, [{ benefit: "Hospital cash", value: 5000, quote: q }]);
    assert.equal(amountOf(figures.get("Hospital cash")), null, next);
  }
});
test("H5: a bare number followed by a word off the allow-list is no money (fillings, check-ups, fractures)", () => {
  const { figures } = run("Dental\tup to 12 fillings\nCheck-up\tup to 4 check-ups", [
    { benefit: "Dental", pays: "up_to", value: 12, quote: "Dental\tup to 12 fillings" },
    { benefit: "Check-up", pays: "up_to", value: 4, quote: "Check-up\tup to 4 check-ups" }], "TABLE OF BENEFITS (S$)");
  assert.equal(amountOf(figures.get("Dental")), null);
  assert.equal(amountOf(figures.get("Check-up")), null);
  const q = "Fracture\t10% of Sum Insured, up to 3 fractures";
  const c = run(q, [{ benefit: "Fracture", pays: "percent", value: 10, percentOf: "sum_insured", cap: 3, capQuote: "up to 3 fractures", quote: q }], "TABLE OF BENEFITS (S$)");
  assert.equal(c.b("Fracture")?.cap, null);
  assert.notEqual(amountOf(c.figures.get("Fracture")), 3);
});
test("H6: a section heading's currency overrides the page's for the rows under it", () => {
  const q = "Physiotherapy\t10% of Sum Insured, up to 500 per trip";
  const { b, figures } = run(`OVERSEAS (USD)\n${q}\nOverseas ambulance\tup to 800 per trip`, [
    { benefit: "Physiotherapy", pays: "percent", value: 10, percentOf: "sum_insured", cap: 500, capQuote: "up to 500 per trip", quote: q },
    { benefit: "Overseas ambulance", pays: "up_to", value: 800, quote: "Overseas ambulance\tup to 800 per trip" }], "TABLE OF BENEFITS (S$)");
  assert.notEqual(amountOf(figures.get("Physiotherapy")), 500, "never a S$500 cap");
  assert.equal(b("Physiotherapy")?.capCurrency, "USD", "the cap is read in the section's currency");
  assert.equal(b("Overseas ambulance")?.currency, "USD");
  const home = run(q, [{ benefit: "Physiotherapy", pays: "percent", value: 10, percentOf: "sum_insured", cap: 500, capQuote: "up to 500 per trip", quote: q }], "TABLE OF BENEFITS (S$)");
  assert.equal(amountOf(home.figures.get("Physiotherapy")), 500, "control: under the page's own (S$) it is S$500");
});
test("control: a two-column row whose cells wrap, quoted in page order, keeps its cap on the wrapped line", () => {
  const q = "Angioplasty and other invasive treatment for\t10% of the Sum Covered, up to a maximum of\ncoronary artery\tS$15,000";
  const { b, figures } = run(q, [{ benefit: "Angioplasty and other invasive treatment for coronary artery", pays: "percent", value: 10, percentOf: "sum_insured",
    cap: 15000, capQuote: "up to a maximum of\ncoronary artery\tS$15,000", quote: q }]);
  assert.equal(b("Angioplasty and other invasive treatment for coronary artery")?.cap, 15000);
  assert.equal(amountOf(figures.get("Angioplasty and other invasive treatment for coronary artery")), 15000);
});

if (failures.length) { console.error(failures.join("\n")); console.error(`${passed} passed, ${failures.length} failed`); process.exit(1); }
console.log(`cross-row-test: ${passed} passed`);
