/** Scripted tests for the Home tiles' and Coverage page's figures (lib/coverage/table-figures.ts): which benefit-table
 * rows answer a category, the text a tile shows, and when a reference wording describes an owned product. Made-up
 * households in three markets only; no scheme, product or insurer is special.
 *   npm run coverage:table-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { categoryOfBenefit, categoryRows, tableDisplay, tileRows, wordingDescribes } from "@/lib/coverage/table-figures";
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
  for (const b of ["Death other than by accident", "Death from causes other than accident", "Death due to sickness or accident", "Death (non-accidental)",
    "Death due to illness or accident, payable only once", "Death benefit (any cause); accidental death benefit payable only to age 70",
    "Death from natural causes or accident", "Death benefit, accidental or otherwise", "Death benefit (2x for accidental death)", "Death benefit, 200% if accidental"]) assert.equal(categoryOfBenefit(b), "Death", b);
});

test("the head of the name decides: an accident benefit's exclusions never make it any cause (TE round 4)", () => {
  for (const b of ["Accidental Death (excluding injury from war)", "Accidental Death, except for injury from extreme sports",
    "Accidental Death Benefit - excluding accidents on aircraft", "Accidental Death (other than injury caused by war)",
    "Death by Accident (except accidents while intoxicated)", "Accidental TPD (excluding injuries from contact sports)",
    "Accidental Death (not payable for illness or injury caused by war)", "Accidental Death; sickness or injury from riots excluded",
    "Accidental Death excluding injury from war", "Accidental Death other than injury from war", "Accidental death except injury from riots",
    "Accidental Death Benefit excluding injuries sustained while racing", "Accidental Death not payable for illness or injury caused by war",
    "Accidental Death apart from illness or injury at sea", "Accidental Death with no cover for sickness or injury at sea",
    "Accidental Death does not cover illness or injury from war", "Accidental Death save for disease or injury from war"])
    assert.equal(categoryOfBenefit(b), "Personal Accident", b);
  for (const b of ["Death (other than by accident)", "Death from causes other than accident", "Death (any cause)", "Death by accident or by illness",
    "Death due to Illness and/or Accident", "Death - natural or accidental",
    "Non-accidental death", "Accidental and Sickness Death Benefit",
    "Illness or Accident Death Benefit", "Death due to illness or accident, payable only once"]) assert.equal(categoryOfBenefit(b), "Death", b);
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

// Live 31357e4: a scheme printed in two documents, plus a travel policy's wording, cleared both tiles' figures. Each
// household holds a standing scheme (summary and certificate word the conditions differently), a payment-term clause row,
// and a travel wording with a trip-only daily cash and a disability row under its personal accident section.
const tile = (category: string, rows: SummaryRow[]) => tableDisplay(tileRows(categoryRows(category, rows)));
for (const [market, cur, rate, sum, travelCap] of [["SG", "SGD", 30, 1000000, 5000], ["MY", "MYR", 80, 500000, 20000], ["UK", "GBP", 25, 250000, 3000]] as const) {
  const daily = (benefit: string, conditions: string[], o: Partial<SummaryRow> = {}) => row(benefit, { pays: "per_day",
    figure: { kind: "printed", amount: rate, currency: cur, unit: "per_day" }, fromDay: 11, maxDays: 30, conditions, ...o });
  const household = [
    daily("Daily Hospital Cash Benefit", ["continuous hospital stay"], { section: "Group Term Life" }),
    daily("D. Daily Hospital Cash Benefit", ["no benefit for self-inflicted injury or pregnancy", "insured in hospital as an inpatient"], { section: "BENEFIT 1: GROUP TERM LIFE" }),
    daily("Hospital Cash Benefit", [], { section: "Group Term Life" }),
    row("Total and Permanent Disability Benefit (TPD)", { pays: "percent", section: "Group Term Life",
      figure: { kind: "worked_out", amount: sum, currency: cur, how: "100% of the sum insured", capped: false }, percent: 100, base: sum }),
    row(`Total and permanent disability: lump sum where sum payable is above ${cur} 200,000`, { section: "Group Term Life",
      figure: { kind: "printed", amount: 200000, currency: cur, unit: "lump_sum" } }),
    row("Daily hospital cash while overseas", { pays: "up_to", section: "Protecting you and your health",
      figure: { kind: "printed", amount: travelCap, currency: cur, unit: "up_to" } }),
    row("Total and permanent disability", { pays: "percent", section: "Personal accident",
      figure: { kind: "worked_out", amount: 150000, currency: cur, how: "100% of the sum insured", capped: false }, percent: 100, base: 150000 }),
  ];
  test(`${market}: a scheme read from two documents and a travel wording keep the tiles' figures (live 31357e4)`, () => {
    assert.match(tile("Hospital Cash", household) ?? "", new RegExp(`^${cur === "SGD" ? "S\\$" : cur + " "}${rate} a day · from day 11 · up to 30 days$`));
    assert.match(tile("Total Permanent Disability", household) ?? "", new RegExp(`${sum.toLocaleString("en-US")}$`));
    // The travel disability row is accident cover; the Coverage page still lists the trip's daily cash and the clause.
    assert.equal(categoryOfBenefit("Total and permanent disability", "Personal accident"), "Personal Accident");
    assert.equal(categoryRows("Hospital Cash", household).length, 4);
    assert.equal(categoryRows("Total Permanent Disability", household).length, 2);
  });
  test(`${market}: a missing amount stays no amount, never a neighbour's`, () => {
    // Two standing covers with different rates: no single figure.
    assert.equal(tile("Hospital Cash", [...household, daily("Hospital Income", [], { figure: { kind: "printed", amount: rate * 2, currency: cur, unit: "per_day" } })]), null);
    // A standing row that gives no figure: no figure, though another row prints one.
    assert.equal(tile("Total Permanent Disability", [...household, row("Total and Permanent Disability", { pays: "words", figure: { kind: "none", why: "see the policy" } })]), null);
    // A condition with its own number may be a limit: it must agree, so a figure that differs only by it gives none.
    assert.equal(tile("Hospital Cash", [...household, daily("Hospital Cash Benefit", ["stay of more than 10 days"])]), null);
    // Different days are different figures.
    assert.equal(tile("Hospital Cash", [...household, daily("Daily Hospital Cash Benefit", [], { fromDay: 4 })]), null);
    // Travel cover only: its rows are the tile's rows.
    assert.equal(tile("Hospital Cash", household.filter((r) => /overseas/.test(r.benefit))), tableDisplay(categoryRows("Hospital Cash", household.filter((r) => /overseas/.test(r.benefit)))));
  });
}

// Live 31357e4 (read-only prod rows): one cover's certificate prints "$30" with no currency beside its summary's "S$30";
// a travel disability row with no figure sits under "Personal accident"; a waiver of premium prints no figure.
type Keyed = SummaryRow & { coverKey: string };
const keyed = (coverKey: string, r: SummaryRow): Keyed => ({ ...r, coverKey });
const perDay = (amount: number, currency: string | null, o: Partial<SummaryRow> = {}) => row("Daily Hospital Cash Benefit", { pays: "per_day",
  figure: { kind: "printed", amount, currency, unit: "per_day" }, fromDay: 11, maxDays: 30, ...o });
test("a bare sign restating the same cover's figure does not block it; it is never read as a currency (live 31357e4)", () => {
  const scheme = [keyed("gtl", perDay(30, "SGD")), keyed("gtl", perDay(30, null, { conditions: ["no benefit for self-inflicted injury"] }))];
  assert.equal(tableDisplay(scheme), "S$30 a day · from day 11 · up to 30 days");
  // Another cover's bare-sign row is not the same benefit: no figure.
  assert.equal(tableDisplay([scheme[0], keyed("other", perDay(30, null))]), null);
  // A different amount, or different days, on the bare-sign row: no figure.
  assert.equal(tableDisplay([scheme[0], keyed("gtl", perDay(35, null))]), null);
  assert.equal(tableDisplay([scheme[0], keyed("gtl", perDay(30, null, { maxDays: 40 }))]), null);
  // Only bare-sign rows: shown as printed, with the currency not stated, never as S$.
  assert.match(tableDisplay([keyed("gtl", perDay(30, null))]) ?? "", /^\$30 \(currency not stated\) a day/);
  // A row whose currency is printed is never dropped for a bare-sign row.
  assert.equal(tableDisplay([keyed("gtl", perDay(30, "MYR")), keyed("gtl", perDay(30, "SGD"))]), null);
});

test("a limit printed only as a condition must agree across rows; it is never dropped (Critic R238)", () => {
  const max6 = ["Max 6 claims per policy year"];
  // A bare-sign restatement that prints a limit the stated row does not: not a restatement, so no figure.
  assert.equal(tableDisplay([keyed("gtl", perDay(30, "SGD")), keyed("gtl", perDay(30, null, { conditions: max6 }))]), null);
  // Two covers with the same rate, one with a limit: no figure.
  assert.equal(tableDisplay([keyed("a", perDay(30, "SGD")), keyed("b", perDay(30, "SGD", { conditions: max6 }))]), null);
  // The same limit on both: shown with it; a non-limiting wording difference does not block.
  assert.equal(tableDisplay([keyed("a", perDay(30, "SGD", { conditions: max6 })), keyed("a", perDay(30, null, { conditions: [...max6, "not for self-inflicted injury"] }))]),
    "S$30 a day · from day 11 · up to 30 days · Max 6 claims per policy year");
  // Two stated rows with the same limit and different other wording: the limit is still shown (Critic R239).
  assert.equal(tableDisplay([keyed("a", perDay(30, "SGD", { conditions: max6 })), keyed("b", perDay(30, "SGD", { conditions: ["as an inpatient", ...max6] }))]),
    "S$30 a day · from day 11 · up to 30 days · Max 6 claims per policy year");
  for (const c of ["once per life", "limited to the first admission", "per confinement", "only in Singapore", "up to S$500 a year"])
    assert.equal(tableDisplay([keyed("a", perDay(30, "SGD")), keyed("a", perDay(30, "SGD", { conditions: [c] }))]), null, c);
});

test("a waiver of premium and a travel accident row never decide the TPD tile; another cover with no figure still does (live 31357e4)", () => {
  const tpd = keyed("gtl", row("Total and Permanent Disability Benefit (TPD)", { pays: "percent",
    figure: { kind: "worked_out", amount: 1000000, currency: "SGD", how: "100% of the sum insured", capped: false }, percent: 100, base: 1000000 }));
  const travel = keyed("trip", row("Total and permanent disability", { pays: "percent", section: "Personal accident", figure: { kind: "none", why: "base not stated" } }));
  const waiver = keyed("life", row("Waiver of premium on total and permanent disability benefit", { pays: "words", figure: { kind: "none", why: "no figure printed" } }));
  const other = keyed("whole-life", row("Total and Permanent Disability Benefit", { pays: "words", figure: { kind: "none", why: "the higher of two values" } }));
  assert.equal(tile("Total Permanent Disability", [tpd, travel]), "S$1,000,000");
  assert.equal(tile("Total Permanent Disability", [tpd, waiver, waiver]), "S$1,000,000");
  // A second TPD cover whose amount the page does not state: the tile cannot give one total, so it says Covered.
  assert.equal(tile("Total Permanent Disability", [tpd, waiver, other]), null);
  // The waiver stays listed on the Coverage page.
  assert.equal(categoryRows("Total Permanent Disability", [tpd, waiver]).length, 2);
});

test("a death or disability row under an accident section is personal accident; a section that only mentions one is not", () => {
  for (const s of ["Personal accident", "BENEFIT 2: GROUP PERSONAL ACCIDENT", "Accidental Benefits", "Section 3: Accident cover"])
    assert.equal(categoryOfBenefit("Total and permanent disability", s), "Personal Accident", s);
  for (const s of ["Group Term Life", "Death and Accidental Death Benefits", "Accident and Sickness", "Life cover", null])
    assert.equal(categoryOfBenefit("Total and permanent disability", s), "Total Permanent Disability", String(s));
  assert.equal(categoryOfBenefit("Daily Hospital Cash", "Personal accident"), "Hospital Cash");
  // A name that says any cause keeps its category under an accident section (Critic R238).
  assert.equal(categoryOfBenefit("Death benefit (any cause)", "Accident Benefits"), "Death");
  assert.equal(categoryOfBenefit("TPD (illness or accident)", "Personal accident"), "Total Permanent Disability");
  assert.equal(categoryOfBenefit("Death Benefit", "Accident Benefits"), "Personal Accident");
});

test("conditions every row prints alike are shown; differing ones are left to the Coverage page", () => {
  const a = row("Hospital Income", { pays: "per_day", figure: { kind: "printed", amount: 50, currency: "AUD", unit: "per_day" }, conditions: ["after 2 nights"] });
  assert.equal(tableDisplay([a, { ...a }]), "AUD 50 a day · after 2 nights");
  // A wording that limits nothing may differ; a limit ("after 2 nights") must agree.
  assert.equal(tableDisplay([{ ...a, conditions: ["as an inpatient"] }, { ...a, conditions: [] }]), "AUD 50 a day");
  assert.equal(tableDisplay([a, { ...a, conditions: [] }]), null);
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
