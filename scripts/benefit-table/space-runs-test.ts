/** A figure counts as printed only as its whole printed token: a piece of a space-grouped run ("S$ 1 500"), of an
 * apostrophe-grouped figure ("12'000") or of a dot-grouped one ("Rp 250.000") never counts on its own, and a run whose
 * digits cannot be told apart prints nothing (a wrong amount otherwise: "S$ 1 500" made 500 look printed). Figures grouped
 * with commas, and columns of such figures, read as before. Made-up lines only; no model, no network. */
import assert from "node:assert/strict";
import { checkReading, dateOnPage, numbersIn, printsNumber } from "../../lib/benefit-table/check";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n" + (e as Error).message); }
}

// Unclear runs print nothing at all.
const nothing = ["Death benefit S$ 120 000", "Room S$ 1 500 per day", "Hospital cash £ 2 500", "S$ 150 250 350",
  "S$ 1 500.00", "Cover US$ 2 500 000", "CHF 12'000", "Benefit 12'500.50", "Limit 1 250 000", "3,00", "Fee 150,00", "S$ 1 500", "S$ 1 500",
  // Still unclear: each could be one space-grouped figure.
  "100 200 300", "50 100", "1 600,000", "S$ 1 500 000", "Plan A Plan B Plan C\n250 300 400",
  // A lakh grouping printed with a space, and plain figures before a spaced percent sign (TE #339).
  "Room ₹ 1 50,000", "Room 1 50,000", "Rs 12 50,000", "Co-insurance 10 20 %", "10 20%"];
for (const line of nothing) check(`"${line}" prints no figure`, () => assert.deepEqual(numbersIn(line), [], JSON.stringify(numbersIn(line))));

// Whole figures grouped with commas, and columns of them, still read.
const whole: [string, number[]][] = [
  ["S$600,000", [600000]], ["S$1,500 2,000 2,500", [1500, 2000, 2500]], ["RM 250.00 300.00", [250, 300]], ["Ward 4 1,200.00", [4, 1200]],
  ["Death S$600,000\tTPD S$600,000", [600000, 600000]], ["1.5 million", [1500000]], ["Rp 250.000", [250000]], ["Rp 500.000.000", [500000000]],
  ["Room and board S$300 per day, up to 120 days", [300, 120]], ["Section 3 120 000", [3, 120, 0]], ["RM 1,000 500 000", [1000]],
  // Separate figures a space apart stay separate: a figure carries on the one before only as an exact 3-digit group after
  // 1 to 3 plain digits, and never as a count or a date (Critic and TE on #339).
  ["Accidental death 600000 1000000", [600000, 1000000]], ["2025 600,000", [2025, 600000]], ["15 48,437 101.10%", [15, 48437, 101.1]],
  ["S$250 120 days", [250, 120]], ["RM 150 30 days", [150, 30]], ["S$50 10 visits", [50, 10]], ["£50 1 day excess", [50, 1]],
  ["S$200 01 Jan 2024 31 Dec 2024", [200, 1, 2024, 31, 2024]], ["S$200 01/01/2024", [200, 1, 1, 2024]], ["15 48,437", [15, 48437]], ["Co-pay 10%", [10]],
];
for (const [line, want] of whole) check(`"${line}" reads ${JSON.stringify(want)}`, () => assert.deepEqual(numbersIn(line), want));

// Adversarial: no group of a space-grouped figure is ever "printed" on its own, whatever sits around it.
const signs = ["S$", "S$ ", "US$", "RM ", "£", "HK$ ", "A$ ", "", "SGD ", "USD "];
const joiners = [" ", " ", " "];
const tails = ["", " per day", " per claim", " a year", ".", ", subject to the limit", " (overall)"];
let lines = 0;
for (const sign of signs) for (const j of joiners) for (const tail of tails) for (const groups of [["1", "500"], ["12", "500"], ["120", "000"], ["2", "500", "000"], ["150", "250", "350"]]) {
  const line = "Benefit " + sign + groups.join(j) + tail;
  lines++;
  const got = numbersIn(line);
  for (const g of groups) if (Number(g) !== 0 && got.includes(Number(g))) { fail++; console.log(`FAIL - piece ${g} of "${JSON.stringify(line)}" printed: ${JSON.stringify(got)}`); }
  if (got.includes(Number(groups.join("")))) { fail++; console.log(`FAIL - "${JSON.stringify(line)}" read whole as ${groups.join("")}`); }
}
pass++; console.log(`ok - ${lines} adversarial lines: no piece and no joined figure printed`);

check("printsNumber: 500 is not printed by 'S$ 1 500', and S$1,500 is", () => {
  assert.equal(printsNumber("Room S$ 1 500 per day", 500), false);
  assert.equal(printsNumber("Room S$ 1 500 per day", 1500), false);
  assert.equal(printsNumber("Room S$1,500 per day", 1500), true);
});
check("a date's parts still read when spaced: 31 12 2025", () => assert.equal(dateOnPage("2025-12-31", "Issued 31 12 2025"), "2025-12-31"));

// Whole readings: a table cell before a figure is its own cell. A year, age or count cell parted from the figure by a tab
// ("60\t143,309", "1\t75%") never joins it as one space-grouped run, so the row keeps its figure (live #339 regression:
// cash-value and factor rows were dropped). Made-up English schedules only.
{
  const PERSON = "Alex Tan", PRODUCT = "Harbour Steady Saver";
  const row = (o: Record<string, unknown>) => ({ section: "SCHEDULE", column: null, pays: "value", value: null, period: null, basis: null, asOf: null, percentOf: null, baseAmount: null, baseQuote: null,
    cap: null, capQuote: null, fromDay: null, maxDays: null, conditions: [], page: 1, ...o });
  const read = (text: string, benefits: Record<string, unknown>[]) => checkReading({ id: "bbbbbbbb-0000-0000-0000-000000000001", name: "saver.pdf", readable: true, pages: [{ page: 1, text }] }, {
    document: { kind: "personal_proof", product: PRODUCT, insurer: null, namedPeople: [PERSON], plan: null, periodFrom: null, periodTo: null },
    covers: [{ person: PERSON, product: PRODUCT, cover: "Endowment", plan: null, riderOf: null, policyNumber: null, sumInsured: null, premium: null, premiumFrequency: null, asOf: null, startDate: null, endDate: null, page: 1, quote: `Life assured\t${PERSON}` }],
    benefits: benefits.map(row) } as never);
  const header = `BENEFIT ILLUSTRATION\n${PRODUCT}\nLife assured\t${PERSON}\n`;
  const keeps: [string, string, string, number, string][] = [
    ["policy year cell before a guaranteed value", "End of policy year\tGuaranteed cash value\n60\t143,309", "60\t143,309", 143309, "value"],
    ["age cell before a value", "Age\tTotal cash value at 4.75%\n65\t212,450", "65\t212,450", 212450, "value"],
    ["year cell before two values", "Year\tAt 3.25%\tAt 4.75%\n40\t88,120\t101,930", "40\t88,120\t101,930", 101930, "value"],
    ["count cell before an amount", "Visits\tLimit\n5\t1,250", "5\t1,250", 1250, "amount"],
    ["year cell before a percent", "Policy year\tFactor\n1\t75%", "1\t75%", 75, "percent"],
    ["year cell before a spaced percent", "Policy year\tFactor\n2\t50 %", "2\t50 %", 50, "percent"],
    ["tab and spaces before a value", "Year\tValue\n30 \t 96,400", "30 \t 96,400", 96400, "value"],
  ];
  for (const [name, table, quote, value, pays] of keeps) {
    const got = read(header + table, [{ benefit: "Cash value", pays, value, quote }]);
    check(`kept: ${name}`, () => assert.equal(got.benefits[0]?.value, value, JSON.stringify(got.dropped)));
  }
  // A real space-grouped figure inside one cell still prints nothing, table or not.
  const refuses: [string, string, string, number, string][] = [
    ["space-grouped figure in one cell", "Year\tValue\n60\t143 309", "60\t143 309", 143309, "value"],
    ["a piece of a space-grouped figure", "Year\tValue\n60\t143 309", "60\t143 309", 309, "value"],
    ["space-grouped amount after a label", "Benefit\tLimit\nRoom\tS$ 1 500", "Room\tS$ 1 500", 500, "amount"],
    ["space-joined percent run in one cell", "Year\tFactor\n1\t10 20 %", "1\t10 20 %", 20, "percent"],
    ["a figure the row does not print", "Year\tValue\n60\t143,309", "60\t143,309", 160143, "value"],
  ];
  for (const [name, table, quote, value, pays] of refuses) {
    const got = read(header + table, [{ benefit: "Cash value", pays, value, quote }]);
    check(`refused: ${name}`, () => assert.ok(!got.benefits.some((b) => b.value === value), JSON.stringify(got.benefits.map((b) => b.value))));
  }
  // Without a tab, a year before a figure is still one unclear run (unchanged).
  check("no tab: '60 143,309' still reads as one run", () => assert.equal(printsNumber("60 143,309", 143309), false));
}

console.log(`space-runs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
