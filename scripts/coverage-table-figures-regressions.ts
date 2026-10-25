/** Scripted tests for the Home tiles' and Coverage page's figures (lib/coverage/table-figures.ts): which benefit-table
 * rows answer a category, the text a tile shows, and when a reference wording describes an owned product. Made-up
 * households in three markets only; no scheme, product or insurer is special.
 *   npm run coverage:table-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { categoryOfBenefit, categoryRows, tableDisplay, wordingDescribes } from "@/lib/coverage/table-figures";
import type { SummaryRow } from "@/lib/benefit-table/headline";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

const row = (benefit: string, o: Partial<SummaryRow> = {}): SummaryRow => ({ benefit, section: null, pays: "amount",
  figure: { kind: "printed", amount: 1000, currency: "SGD", unit: "lump_sum" }, qualifier: null, fromDay: null, maxDays: null, conditions: [], ...o });

test("benefit names in three markets go to their category", () => {
  assert.equal(categoryOfBenefit("Daily Hospital Cash Benefit"), "Hospital Cash");
  assert.equal(categoryOfBenefit("Hospital Income"), "Hospital Cash");
  assert.equal(categoryOfBenefit("Elaun Hospital Harian / Daily Hospital Allowance"), "Hospital Cash");
  assert.equal(categoryOfBenefit("Total and Permanent Disability"), "Total Permanent Disability");
  assert.equal(categoryOfBenefit("TPD Benefit"), "Total Permanent Disability");
  assert.equal(categoryOfBenefit("Early Stage Critical Illness"), "Early Critical Illness");
  assert.equal(categoryOfBenefit("Critical Illness Cover"), "Critical Illness");
  assert.equal(categoryOfBenefit("Dread Disease"), "Critical Illness");
  assert.equal(categoryOfBenefit("Accidental Death"), "Personal Accident");
  assert.equal(categoryOfBenefit("Death Benefit"), "Death");
  assert.equal(categoryOfBenefit("Income Protection"), "Disability Income");
  assert.equal(categoryOfBenefit("Outpatient GP Visit"), "Outpatient");
  assert.equal(categoryOfBenefit("Room and Board"), "Hospitalisation");
  assert.equal(categoryOfBenefit("Funeral expenses"), null);
});

test("an illness the name excludes is not a cause it pays; injury is accident; an accident uplift keeps the Death tile (TE P144-6, Critic R227)", () => {
  for (const b of ["Accidental Death (death from illness or disease is not covered)", "Death due to Injury", "Accidental Death - not payable for sickness",
    "Accidental TPD (sickness excluded)", "TPD due to Injury", "Kematian akibat Kemalangan / Death due to Injury"]) assert.equal(categoryOfBenefit(b), "Personal Accident", b);
  assert.equal(categoryOfBenefit("Death from any cause, including accident"), "Death");
  assert.equal(categoryOfBenefit("Death benefit; doubled for accidental death"), "Death");
  assert.equal(categoryOfBenefit("TPD (illness or accident)"), "Total Permanent Disability");
  assert.equal(categoryOfBenefit("Death (excluding suicide in the first year)"), "Death");
  // Critic R229: an uplift word counts only on a plain death benefit; an excluded accident is not an accident benefit.
  assert.equal(categoryOfBenefit("Double Indemnity Accidental Death Benefit"), "Personal Accident");
  assert.equal(categoryOfBenefit("Accidental Death (double for public transport)"), "Personal Accident");
  assert.equal(categoryOfBenefit("Additional Accidental Death Benefit"), "Personal Accident");
  assert.equal(categoryOfBenefit("Death from causes other than accident"), "Death");
  assert.equal(categoryOfBenefit("Death (including death due to injury)"), "Death");
  assert.equal(categoryOfBenefit("Accidental Death Benefit (including injury on public transport)"), "Personal Accident");
});

test("accident only is the default; any cause needs a phrase that says so (TE P144-6 round 3)", () => {
  for (const b of ["Accidental Death, no cover for illness", "Accidental Death (illness exclusion applies)", "Accidental Death - sickness not included",
    "Accidental Death (sickness: nil)", "Death (not payable unless caused by accident)", "Death benefit - not paid except for accidental causes",
    "Death benefit (accidental death only, including injury at work)", "Death Benefit - Accidental, double indemnity",
    "Death benefit (accidental death only), doubled on public transport", "Death Benefit (Accident only) - twice the sum insured"])
    assert.equal(categoryOfBenefit(b), "Personal Accident", b);
  for (const b of ["Death other than by accident", "Death from causes other than accident", "Death due to sickness or accident", "Death (non-accidental)"]) assert.equal(categoryOfBenefit(b), "Death", b);
});

test("a death or disability paid only on an accident is personal accident, never the Death or TPD tile (TE P142-1)", () => {
  for (const n of ["Death due to Accident", "Death by Accident", "Accidental Death Benefit", "TPD due to accident", "Accidental Total and Permanent Disability", "Accidental Dismemberment"])
    assert.equal(categoryOfBenefit(n), "Personal Accident", n);
  assert.equal(categoryOfBenefit("Death from any cause, including accident"), "Death");
  assert.equal(categoryOfBenefit("Death due to illness or accident"), "Death");
  assert.equal(categoryOfBenefit("Total and Permanent Disability (illness or accident)"), "Total Permanent Disability");
});

test("a fund or surrender value and a premium never give a tile's figure (Critic R225)", () => {
  const rows = [row("Death Benefit fund value", { pays: "value", figure: { kind: "value", amount: 12000, currency: "GBP", asOf: null } }),
    row("Premium waiver on death"), row("Death benefit premium", { figure: { kind: "printed", amount: 120, currency: "GBP", unit: "lump_sum" } })];
  assert.deepEqual(categoryRows("Death", rows).map((r) => r.benefit), ["Premium waiver on death"]);
});

test("a per-day hospital cash row shows its rate, first day and most days, as printed", () => {
  const rows = [row("Daily Hospital Cash", { figure: { kind: "printed", amount: 80, currency: "MYR", unit: "per_day" }, fromDay: 4, maxDays: 60 })];
  assert.equal(tableDisplay(categoryRows("Hospital Cash", rows)), "MYR 80 a day · from day 4 · up to 60 days");
});

test("rows that print different figures show no single figure", () => {
  const rows = [row("Death Benefit", { figure: { kind: "printed", amount: 200000, currency: "GBP", unit: "lump_sum" } }),
    row("Death Benefit", { figure: { kind: "printed", amount: 150000, currency: "GBP", unit: "lump_sum" } })];
  assert.equal(categoryRows("Death", rows).length, 2);
  assert.equal(tableDisplay(categoryRows("Death", rows)), null);
});

test("a projection, a not-covered row and a row with no amount never give a figure", () => {
  const rows = [row("Death Benefit", { figure: { kind: "projected", amount: 90000, currency: "SGD", basis: "non_guaranteed", asOf: null } }),
    row("Critical Illness", { pays: "not_covered", figure: { kind: "none", why: "not covered" } }),
    row("Total and Permanent Disability", { figure: { kind: "none", why: "see the schedule" } })];
  assert.deepEqual(categoryRows("Death", rows), []);
  assert.deepEqual(categoryRows("Critical Illness", rows), []);
  assert.equal(tableDisplay(categoryRows("Total Permanent Disability", rows)), null);
});

test("a percentage row shows the amount worked out from the printed base", () => {
  const rows = [row("Total and Permanent Disability", { figure: { kind: "worked_out", amount: 400000, currency: "SGD", how: "100% of S$400,000", capped: false }, percent: 100, base: 400000 })];
  assert.equal(tableDisplay(categoryRows("Total Permanent Disability", rows)), "S$400,000");
});

const owned = (productName: string | null, groupPolicyNumber: string | null = null, insurer: string | null = null) => ({ productName, groupPolicyNumber, insurer });
test("a wording describes an owned product only when product, group number and insurer agree", () => {
  assert.equal(wordingDescribes(owned("Group Term Life", "GX-1001", "Harbour Assurance"), owned("Group Term Life Insurance", "GX1001", "harbour assurance")), true);
  assert.equal(wordingDescribes(owned("GTL", "GX-1001"), owned("Group Term Life", "GX-1001")), true);
  assert.equal(wordingDescribes(owned("Critical Care", null, "Lion Mutual"), owned("Critical Care Plus", null, "Lion Mutual")), false);
  assert.equal(wordingDescribes(owned("Group Term Life", "GX-1001"), owned("Group Term Life", "GX-2002")), false);
  assert.equal(wordingDescribes(owned("Term Protect", null, "Lion Mutual"), owned("Term Protect", null, "Thames Life")), false);
  assert.equal(wordingDescribes(owned("Term Protect", null, "Lion Mutual Ltd"), owned("Term Protect", null, "Lion Mutual Limited")), true);
  // Same group number, no product name on the wording: the scheme's wording.
  assert.equal(wordingDescribes(owned("Group Term Life", "GX-1001"), owned(null, "GX-1001")), true);
  // Nothing to match on: a wording never adds cover on its own.
  assert.equal(wordingDescribes(owned(null), owned(null)), false);
  assert.equal(wordingDescribes(owned("Group Term Life"), owned(null, "GX-1001")), false);
});

test("no scheme, product or fixed amount is written into the Home and Coverage code", () => {
  for (const f of ["app/api/dashboard/route.ts", "app/api/coverage/route.ts", "lib/coverage/answer.ts", "lib/coverage/table-figures.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /G\d{6}/, `${f} names a group scheme`);
    assert.doesNotMatch(src, /S\$\d/, `${f} writes an amount`);
    assert.doesNotMatch(src, /living care|outpatient medicare/i, `${f} names a product`);
    assert.doesNotMatch(src, /productFromCategory/, `${f} guesses a product from a category`);
  }
});

console.log(`coverage table figures: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL", f); process.exit(1); }
