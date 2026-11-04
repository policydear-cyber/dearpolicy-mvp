/** A figure counts as printed only as its whole printed token: a piece of a space-grouped run ("S$ 1 500"), of an
 * apostrophe-grouped figure ("12'000") or of a dot-grouped one ("Rp 250.000") never counts on its own, and a run whose
 * digits cannot be told apart prints nothing (a wrong amount otherwise: "S$ 1 500" made 500 look printed). Figures grouped
 * with commas, and columns of such figures, read as before. Made-up lines only; no model, no network. */
import assert from "node:assert/strict";
import { dateOnPage, numbersIn, printsNumber } from "../../lib/benefit-table/check";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n" + (e as Error).message); }
}

// Unclear runs print nothing at all.
const nothing = ["Death benefit S$ 120 000", "Room S$ 1 500 per day", "Hospital cash £ 2 500", "S$ 150 250 350",
  "S$ 1 500.00", "Cover US$ 2 500 000", "CHF 12'000", "Benefit 12'500.50", "Limit 1 250 000", "3,00", "Fee 150,00", "S$ 1 500", "S$ 1 500"];
for (const line of nothing) check(`"${line}" prints no figure`, () => assert.deepEqual(numbersIn(line), [], JSON.stringify(numbersIn(line))));

// Whole figures grouped with commas, and columns of them, still read.
const whole: [string, number[]][] = [
  ["S$600,000", [600000]], ["S$1,500 2,000 2,500", [1500, 2000, 2500]], ["RM 250.00 300.00", [250, 300]], ["Ward 4 1,200.00", [4, 1200]],
  ["Death S$600,000\tTPD S$600,000", [600000, 600000]], ["1.5 million", [1500000]], ["Rp 250.000", [250000]], ["Rp 500.000.000", [500000000]],
  ["Room and board S$300 per day, up to 120 days", [300, 120]], ["Section 3 120 000", [3, 120, 0]], ["RM 1,000 500 000", [1000]],
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

console.log(`space-runs: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
