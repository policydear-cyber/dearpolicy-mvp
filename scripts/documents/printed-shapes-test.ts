/**
 * Summary-booklet shapes the table reader missed (MINDEF re-read, 4 Nov). Each one is a general layout, shown on a
 * made-up English booklet:
 *  1. A premium-rate table hid every row under it to the foot of the page, so a benefit schedule printed below the
 *     premium rates ("• Disability Benefit Schedule") was never read. It now ends at the next bulleted section.
 *  2. A share printed in words ("One twelfth of Sum Insured") is an amount cell, on a closed list of fractions.
 *  3. An amount that stops on "or" ("15% of Sum Insured or") goes on in the line below when that line is only the rest
 *     of it ("up to S$50,000, whichever is lesser"), so the row is the whole choice, read back with its cap.
 *  4. A raised ordinal ending printed on its own line ("th") is never part of the name above it.
 *  5. A finished name never takes the next row's name and cell ("Terminal age | Seventy (70)").
 * No database, no network, no model.
 */
import assert from "node:assert/strict";
import { benefitRowsFromText } from "../../lib/documents/layout";
import { parseBenefitValue } from "../../lib/policies/benefit-rows";
import { describeBenefitFormula, repairStoredRules } from "../../lib/policies/benefit-catalog";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;


let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log("ok - " + name); }
  catch (error) { failed++; console.log("not ok - " + name + "\n  " + (error instanceof Error ? error.message : String(error))); }
}
const rows = (text: string) => benefitRowsFromText(text).map((r) => ({ label: r.label, value: r.value, line: r.line }));
const find = (text: string, label: string) => rows(text).find((r) => r.label.replace(/^[•\s]+/, "") === label);
/** What the Benefits page shows for a row the reader stored with no rule (read back from its quote). */
function shown(label: string, quote: string) {
  const [row] = repairStoredRules([{ id: "r1", policyId: "p1", productName: "Made-up Cover", benefitName: label, traits: [],
    formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null, requirements: [],
    needsReview: true, sourcePage: 4, tier: null, reviewedAt: null, quote, basisInferred: false, conditions: [], rowKind: "benefit" } as never]);
  return row ? describeBenefitFormula(row as never) : null;
}

// 1 + 2 + 5: a premium table, a note, then the benefit schedule under a bullet.
const income = [
  "Income Shield (continued)",
  "•\tThe monthly premium rate for every S$10,000 Sum Insured is shown below.",
  "Age Next Birthday (ANB)\tMonthly premium rates",
  "as of 1 April each year\tper S$10,000 of Sum Insured (S$)",
  "Under 26\t3.10",
  "26 to 30\t4.25",
  "31 to 35\t5.40",
  "Note: The monthly premium rates exclude prevailing tax.",
  "•\tIncome Benefit Schedule",
  "Income Benefit\tOne twelfth of Sum Insured",
  "Terminal age\tSixty-five (65)",
  "Deferred Period\tPeriod of 3 months from the first day of",
  "any continuous period of Disability",
].join("\n");
check("a schedule under a premium table is read once the next bulleted section starts", () => {
  const row = find(income, "Income Benefit");
  assert.ok(row, JSON.stringify(rows(income)));
  assert.equal(row!.value, "One twelfth of Sum Insured");
});
check("the premium table's own rows are still never benefits", () => {
  for (const label of ["Under 26", "26 to 30", "31 to 35"]) assert.equal(find(income, label), undefined, label);
});
check("a finished name never takes the next row's name and cell", () => {
  assert.equal(find(income, "Income Benefit")!.label, "Income Benefit");
});
check("a premium table with no section after it hides its rows to the foot of the page", () => {
  const text = ["Premium rate table", "Age band\tRate", "Under 26\t3.10", "26 to 30\t4.25", "Accidental death\t100% of Sum Insured"].join("\n");
  assert.equal(rows(text).length, 0, JSON.stringify(rows(text)));
});
check("a schedule heading ends a premium table, with a bullet of any glyph or none", () => {
  for (const heading of ["▪\tHospital Benefits", "Schedule of Benefits", "●\tAccident Benefit Schedule"]) {
    const text = ["Schedule of premiums", "Age band\tRate", "Under 26\t3.10", heading, "Accidental death\t100% of Sum Insured"].join("\n");
    assert.equal(find(text, "Accidental death")?.value, "100% of Sum Insured", heading);
  }
});
check("a line that only looks like a heading never ends a premium table", () => {
  for (const heading of ["▪\tCover", "•\tImportant notes", "Notes", "•\tHospital Benefits payable by you", "Benefit premiums", "•\tCover for 5 years", "•\tBenefits"+"\tS$100"]) {
    const text = ["Schedule of premiums", "Age band\tRate", "Under 26\t3.10", heading, "Age 30\tS$1.20"].join("\n");
    assert.deepEqual(rows(text).filter((r) => /^Age 30/.test(r.label)), [], heading);
  }
});

// Critic and TE #347: a bullet that is not a benefit heading never ends a premium table.
const PREMIUM_BULLETS: [string, string[]][] = [
  ["bulleted premium rows", ["Schedule of Premiums", "•\tAge 18 to 30\tS$250", "•\tAge 31 to 40\tS$310", "\u25aa\tAge 41 to 50\tS$480"]],
  ["bulleted rider prices", ["Premium Table", "Basic plan\tS$1,200", "•\tWaiver of premium rider\tS$85", "•\tHospital cash rider\tS$140"]],
  ["a bulleted note inside the table", ["Premium Rates (per S$1,000 sum insured)", "•\tRates are guaranteed for 5 years", "Age 30\tS$1.20", "Age 40\tS$2.10"]],
  ["a bulleted rate heading", ["Schedule of Premiums", "•\tRates per S$1,000 sum assured", "Age 25\tS$1.20", "Age 35\tS$2.40"]],
  ["a bulleted premium heading with a benefit word", ["Premium rate table", "•\tPremium for the Hospital Benefit", "Age 25\tS$1.20"]],
];
for (const [what, lines] of PREMIUM_BULLETS)
  check(`a premium table keeps its rows out with ${what}`, () => assert.deepEqual(rows(lines.join("\n")), []));
check("a benefit heading under a bulleted premium heading still starts the schedule", () => {
  const text = ["Schedule of Premiums", "•\tRates per S$1,000 sum assured", "Age 25\tS$1.20", "•\tBenefit Schedule", "Accidental death\t100% of Sum Insured"].join("\n");
  assert.deepEqual(rows(text).map((r) => r.value), ["100% of Sum Insured"]);
});

const WORDED: [string, number | null][] = [
  ["One twelfth of Sum Insured", 1 / 12], ["One half of the Sum Assured", 0.5], ["Two thirds of Sum Insured", 2 / 3],
  ["one quarter of the insured amount", 0.25], ["One twenty-fourth of Sum Insured", 1 / 24],
  ["One seventh of Sum Insured", null], ["One twelfth of Sum Insured, up to S$5,000", null],
  ["One twelfth of Sum Insured per month", null], ["One twelfth", null], ["Twelve of Sum Insured", null],
];
for (const [cell, share] of WORDED) {
  check(`worded share "${cell}" -> ${share ?? "no rule"}`, () => {
    const read = parseBenefitValue(cell);
    if (share == null) assert.ok(read == null || read.kind !== "sum_insured", JSON.stringify(read));
    else { assert.equal(read?.kind, "sum_insured"); assert.ok(Math.abs(read!.value - share) < 1e-9, JSON.stringify(read)); }
  });
}
check("a fraction not on the list is never an amount cell", () => {
  assert.equal(find("Monthly Benefit\tOne seventh of Sum Insured", "Monthly Benefit"), undefined);
});
check("the worded share row is not read when the cell carries anything else", () => {
  assert.equal(parseBenefitValue("One twelfth of Sum Insured, up to S$5,000"), null);
  assert.equal(parseBenefitValue("One twelfth of Sum Insured per month"), null);
});

// 3: a choice cut after "or".
const accident = [
  "Accident Benefits (continued)",
  "•\tComa Benefit\t20% of Sum Insured or",
  "up to S$40,000, whichever is lesser",
  "•\tFlood or earthquake death\t20% of Sum Insured",
  "or up to S$40,000, whichever is lesser",
  "•\tBurns Benefit\t10% of Sum Insured and",
  "Hospital Cash\tS$80 per day",
  "•\tRecovery Benefit\t5% of Sum Insured or",
  "subject to the insurer's approval",
].join("\n");
check("an amount cut after \"or\" takes the rest of the choice from the line below", () => {
  const row = find(accident, "Coma Benefit");
  assert.equal(row?.value, "20% of Sum Insured or up to S$40,000, whichever is lesser");
  assert.ok(row!.line.includes("whichever is lesser"), row!.line);
});
check("the continued line is not a row of its own", () => {
  assert.ok(!rows(accident).some((r) => /^up to/i.test(r.label)), JSON.stringify(rows(accident)));
});
check("the whole choice is read back as the share with its cap, never the bare share", () => {
  const row = find(accident, "Coma Benefit")!;
  assert.equal(parseBenefitValue(row.value), null);
  assert.equal(shown("Coma Benefit", row.line.replace(/\t/g, " ")), "20% of the sum insured on your schedule, up to S$40,000");
});
check("the half-choice alone still shows no figure", () => {
  assert.ok(!/\d/.test(shown("Coma Benefit", "• Coma Benefit 20% of Sum Insured or") ?? ""));
});
check("a name and amount row of its own below an amount cut after \"and\" stays its own row", () => {
  assert.equal(find(accident, "Burns Benefit")?.value, "10% of Sum Insured and");
  assert.equal(find(accident, "Hospital Cash")?.value, "S$80 per day");
});
check("a line below with no amount never finishes the choice", () => {
  const row = rows(accident).find((r) => r.label.includes("Recovery Benefit"));
  assert.equal(row?.value, "5% of Sum Insured or");
});
check("an amount cut after a joining word already joined on its own is unchanged", () => {
  assert.equal(find(accident, "Flood or earthquake death")?.value, "20% of Sum Insured or up to S$40,000, whichever is lesser");
});

// 4: a raised "th" between rows.
const life = [
  "Insurance Benefits",
  "•\tDeath\t100% of Sum Insured",
  "•\tEarly Payment Benefit\t100% Sum Insured (up to S$300,000)",
  "th",
  "•\tHospital Cash Benefit\tS$40 per day from the 8\tday onwards.",
].join("\n");
check("a raised ordinal ending on its own line is never part of the name above", () => {
  assert.equal(find(life, "Early Payment Benefit")?.value, "100% Sum Insured (up to S$300,000)");
});
check("so the row's name is in its own quote and its capped share is read back", () => {
  const row = find(life, "Early Payment Benefit")!;
  assert.equal(shown("• Early Payment Benefit", row.line.replace(/\t/g, " ")), "100% of the sum insured on your schedule, up to S$300,000");
});
check("a wrapped name that continues in lower case is still joined", () => {
  const text = ["4. Loss of arm (at shoulder, between shoulder and elbow,\t100%", "at elbow, between elbow and wrist)"].join("\n");
  assert.equal(rows(text)[0]?.label, "4. Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist)");
});

console.log(`printed shapes: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
