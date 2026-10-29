/** Scripted tests for the Home tiles' and Coverage page's figures (lib/coverage/table-figures.ts): which benefit-table
 * rows answer a category, the text a tile shows, and when a reference wording describes an owned product. Made-up
 * households in three markets only; no scheme, product or insurer is special.
 *   npm run coverage:table-test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { categoryOfBenefit, categoryRows, confirmedTotalComplete, lumpSumParts, tableDisplay, tileRows, wordingDescribes, type ConfirmedLine } from "@/lib/coverage/table-figures";
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

test("cover for what the person owes others is never their own accident, death or hospital cover", () => {
  for (const b of ["If you are liable for accidental death, injury or damage to other people, items or property", "Personal Liability",
    "Legal liability to third parties for accidental bodily injury or death", "Death or injury to a third party", "Third party property damage",
    "Liabiliti Peribadi / Personal Liability", "Public liability (accidental death or injury to others)"]) assert.equal(categoryOfBenefit(b), null, b);
  assert.equal(categoryOfBenefit("Accidental death", "Section 6 - Personal Liability"), null);
  // Not liability: the person's own cover, whoever caused it.
  assert.equal(categoryOfBenefit("Accidental death due to assault by a third party"), "Personal Accident");
  assert.equal(categoryOfBenefit("Accidental Death"), "Personal Accident");
  assert.equal(categoryOfBenefit("Hospital cash for injury caused by a third party"), "Hospital Cash");
  assert.deepEqual(categoryRows("Personal Accident", [row("Accidental Death"), row("If you are liable for accidental death, injury or damage to other people")]).map((r) => r.benefit), ["Accidental Death"]);
});

test("the insurer's own limits of liability are no liability cover: the person's own cover under them keeps its category (Critic R355, TE pr192 F1)", () => {
  const own: [string, string | null, string][] = [
    ["Accidental death", "Maximum Liability per Insured Person", "Personal Accident"],
    ["Accidental death", "Schedule of Benefits and Limits of Liability", "Personal Accident"],
    ["Death", "Our liability", "Death"],
    ["Daily hospital cash", "Limit of Liability (S$)", "Hospital Cash"],
    ["Total and Permanent Disability", "Benefits and liabilities", "Total Permanent Disability"],
    ["Accidental death - maximum liability", null, "Personal Accident"],
    ["Death Benefit (limit of liability S$200,000)", null, "Death"],
    ["Accidental Death - maximum liability RM 100,000", null, "Personal Accident"],
    ["Daily Hospital Cash (our liability is limited to 30 days)", null, "Hospital Cash"],
    ["Accidental Death (we are not liable for death from illness)", null, "Personal Accident"],
    ["Accidental death", "Jadual Manfaat dan Had Liabiliti", "Personal Accident"],
    ["Accidental death", "Benefits and maximum liability (£)", "Personal Accident"],
    ["Accidental death (excluding damage to third party property)", null, "Personal Accident"],
    ["Accidental death", "Third party claims administrator: Example TPA", "Personal Accident"],
    ["Death caused by a third party", null, "Death"],
    // TE pr192 r2 G1.
    ["Death Benefit of the Public Officers Group Insurance Scheme", null, "Death"],
    ["Daily Hospital Cash - ward of the public hospital", null, "Hospital Cash"],
    ["Accidental death from assault by a third party or medical misadventure", null, "Personal Accident"],
    ["Accidental death - injury to others is excluded", null, "Personal Accident"],
    ["Accidental death [excluding injury to others]", null, "Personal Accident"],
    ["Accidental death, not payable if you are liable to others", null, "Personal Accident"],
    ["Death of any person covered under this policy", null, "Death"],
    // "Any person" outside a liability frame is the insured (Critic R360 M1, TE pr192 r3 note 1).
    ["Death of any person in your family", null, "Death"], ["Death of any person who is a Life Assured", null, "Death"],
    ["Death of any person aged 18 to 65", null, "Death"], ["Accidental death of any person travelling with you", null, "Personal Accident"],
    ["Death of any person to whom this certificate applies", null, "Death"], ["Accidental death of any person on the plan", null, "Personal Accident"],
    ["Total and permanent disability of any person under 65", null, "Total Permanent Disability"], ["Death benefit of any person aged 18 to 70", null, "Death"],
  ];
  for (const [b, section, want] of own) assert.equal(categoryOfBenefit(b, section), want, b + " / " + section);
});

test("liability worded many ways is never the person's own cover (TE pr192 F3)", () => {
  for (const b of ["Death of a third party", "Daily hospital allowance for injured third parties", "Total and permanent disability of a third party",
    "Bodily injury or death of a third party", "Third party death or bodily injury", "Claims against you for death or injury of others",
    "Third party hospital expenses", "Liability to others", "Injury caused to others", "Tanggungan Pihak Ketiga - kematian", "第三者责任 - 身故",
    "Responsabilité civile - décès", "Haftpflicht Tod", "Death of or bodily injury to any person", "Liability to pay compensation for accidental death of any person",
    "Death of someone else", "Bodily injury you cause to other people", "Death of a visitor to your home", "Liabiliti terhadap pihak ketiga",
    "Tanggung jawab hukum", "Trách nhiệm dân sự",
    "If you are legally liable for the accidental death of, or injury to, another person", "Accidental death of any other person caused by you",
    "Third party daily hospital cash", "Death of a person other than the insured", "Injury to any person other than you"]) assert.equal(categoryOfBenefit(b), null, b);
  assert.equal(categoryOfBenefit("Death", "Third Party Cover"), null);
  for (const section of ["Section 4: Liability", "Your liability", "Liabilities"]) assert.equal(categoryOfBenefit("Death", section), null, section);
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
  const scheme = { coverKey: "gtl", product: "Group Insurance Scheme", cover: "Group Term Life" };
  const trip = { coverKey: "trip", product: "Travel insurance", cover: "Single Trip" };
  const household: SummaryRow[] = [
    daily("Daily Hospital Cash Benefit", ["continuous hospital stay"], { section: "Group Term Life", ...scheme }),
    daily("D. Daily Hospital Cash Benefit", ["no benefit for self-inflicted injury or pregnancy", "insured in hospital as an inpatient"], { section: "BENEFIT 1: GROUP TERM LIFE", ...scheme }),
    daily("Hospital Cash Benefit", [], { section: "Group Term Life", ...scheme }),
    row("Total and Permanent Disability Benefit (TPD)", { pays: "percent", section: "Group Term Life", ...scheme,
      figure: { kind: "worked_out", amount: sum, currency: cur, how: "100% of the sum insured", capped: false }, percent: 100, base: sum }),
    row(`Total and permanent disability: lump sum where sum payable is above ${cur} 200,000`, { section: "Group Term Life", ...scheme,
      figure: { kind: "printed", amount: 200000, currency: cur, unit: "lump_sum" } }),
    row("Daily hospital cash while overseas", { pays: "up_to", section: "Protecting you and your health", ...trip,
      figure: { kind: "printed", amount: travelCap, currency: cur, unit: "up_to" } }),
    row("Total and permanent disability", { pays: "percent", section: "Personal accident", ...trip,
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
  assert.equal(tableDisplay([keyed("a", perDay(30, "SGD", { conditions: max6 })), keyed("a", perDay(30, null, { conditions: [...max6, "no benefit for self-inflicted injury"] }))]),
    "S$30 a day · from day 11 · up to 30 days · Max 6 claims per policy year");
  // Two stated rows with the same limit and different other wording: the limit is still shown (Critic R239).
  assert.equal(tableDisplay([keyed("a", perDay(30, "SGD", { conditions: max6 })), keyed("b", perDay(30, "SGD", { conditions: ["as an inpatient", ...max6] }))]),
    "S$30 a day · from day 11 · up to 30 days · Max 6 claims per policy year");
  for (const c of ["once per life", "limited to the first admission", "per confinement", "only in Singapore", "up to S$500 a year"])
    assert.equal(tableDisplay([keyed("a", perDay(30, "SGD")), keyed("a", perDay(30, "SGD", { conditions: [c] }))]), null, c);
});

test("every condition is a limit unless it is plainly eligibility wording that changes no amount (TE P147-4, P147-5)", () => {
  const pair = (c: string) => tableDisplay([keyed("a", perDay(30, "SGD")), keyed("a", perDay(30, "SGD", { conditions: [c] }))]);
  // Eligibility only: the figure shows.
  for (const c of ["inpatient only", "continuous stay", "No benefit is payable for self-inflicted injury or pregnancy", "excluding pre-existing conditions",
    "excluding pregnancy", "Not payable if caused by war or riot", "Excludes self-inflicted injury", "insured in hospital as an inpatient",
    "No Benefit shall be payable for hospitalisation directly or indirectly due to self-inflicted injuries (including due to suicide/ attempted suicide) and/or pregnancy/ maternity reason.",
    "while this policy is in force", "admitted on the advice of a doctor", "subject to the policy terms", "must be medically necessary"])
    assert.equal(pair(c), "S$30 a day · from day 11 · up to 30 days", c);
  // Anything that may change the amount, or that the rules cannot place: no figure.
  for (const c of ["reduced by half after age sixty-five", "less any amount already paid under the critical illness benefit",
    "the higher of this amount or the account value", "the lower of this amount or five times annual salary", "until the policy anniversary at age seventy",
    "Max 6 claims per policy year", "payable once per life", "only one claim per admission", "inpatient only, capped at the ward rate",
    "no benefit after the first sixty days", "paid to the policyowner's estate", "minus any outstanding loan",
    // Critic R241: exclusion or not-payable wording that changes the amount is a limit.
    "Excluding amounts paid under the early critical illness benefit", "Not payable in excess of the actual charges incurred",
    "The portion exceeding reasonable charges is not covered", "Excluding any amount reimbursed by other insurers",
    "Not payable to the extent covered by another policy", "Payable net of any government subsidy", "Payable as a proportion of the sum insured",
    "Payable at the ward-class rate", "Not payable where another benefit under this policy has been paid", "Excludes any bonus",
    // Critic R242: every word of a cause must be a cause word.
    "Excluding outstanding loans and interest", "Excluding unpaid premiums", "Excluding the copayment", "Excluding coinsurance",
    "Excluding the balance", "Excluding the shortfall", "Excluding fifty dollars of each claim", "Excluding the surrender value",
    "No benefit for subsequent claims", "except for juveniles: fifty percent", "not payable for a second disability", "excluding juveniles, who get one-quarter"])
    assert.equal(pair(c), null, c);
});

test("only a fact about a row's own cover leaves it out: a clause or waiver of the same cover, a whole travel cover (TE round 5)", () => {
  const on = (coverKey: string, benefit: string, amount: number, o: Partial<SummaryRow> & { product?: string; cover?: string } = {}) =>
    ({ ...row(benefit, { pays: "per_day", figure: { kind: "printed", amount, currency: "SGD", unit: "per_day" } }), coverKey, product: coverKey, ...o });
  // A threshold clause of the same cover is left out; another cover's row never is, whatever its name says.
  for (const b of ["TPD: lump sum where the sum payable is above S$200,000", "TPD paid in instalments if the amount exceeds MYR 100,000", "Benefit for claims of £5,000 or less"]) {
    assert.equal(tileRows([on("a", b, 1), on("a", "Total and Permanent Disability", 2)]).length, 1, b);
    assert.equal(tileRows([on("b", b, 1), on("a", "Total and Permanent Disability", 2)]).length, 2, b);
  }
  // A guaranteed minimum is the benefit, never a clause.
  for (const b of ["Death benefit of at least S$300,000", "TPD benefit: not less than S$300,000", "TPD, no less than MYR 300,000"])
    assert.equal(tileRows([on("a", b, 1), on("a", "Total and Permanent Disability", 2)]).length, 2, b);
  // Trip wording on a standing cover is compared like any other row.
  for (const b of ["Daily hospital cash while overseas", "Daily Hospital Cash, including while overseas", "Daily hospital cash while overseas or at home", "Hospital cash during the trip",
    "Hospital cash in Singapore and overseas", "Hospital cash when you travel", "Hospital cash whilst on holiday abroad"])
    assert.equal(tile("Hospital Cash", [on("a", b, 80), on("b", "Hospital Cash Benefit", 40)]), null, b);
  // A whole travel cover is left out beside a standing one; alone, its own rows are the tile's rows.
  const travel = on("t", "Daily hospital cash while overseas", 80, { product: "Travel Guard", cover: "Annual Multi-Trip" });
  assert.equal(tile("Hospital Cash", [travel, on("b", "Hospital Cash Benefit", 40)]), "S$40 a day");
  assert.equal(tile("Hospital Cash", [travel]), "S$80 a day");
  // Critic R244: a travel-named cover whose row also pays at home, a journey "plan" or "guard", a corporate product: standing.
  for (const b of ["Hospital cash in Singapore and overseas", "Hospital cash, including while overseas", "Hospital cash while overseas or at home", "Hospital cash also while abroad"])
    assert.equal(tile("Hospital Cash", [{ ...travel, benefit: b }, on("b", "Hospital Cash Benefit", 40)]), null, b);
  for (const [product, cover] of [["Life Journey Plan", "Life Journey Plan"], ["Family Guard", "Family Guard"], ["Acme Corporate Travel Insurance", "Corporate Medical"]])
    assert.equal(tile("Hospital Cash", [{ ...travel, product, cover }, on("b", "Hospital Cash Benefit", 40)]), null, product);
  // A travel-named cover with a home row as well is standing cover: no figure beside another cover's rate (TE P147-6 round 2).
  assert.equal(tile("Hospital Cash", [travel, { ...travel, benefit: "Hospital Cash Benefit" }, on("b", "Hospital Cash Benefit", 40)]), null);
  // Two signals are needed: a travel name and a row that pays only abroad. An employer's or product's travel-like word,
  // or a travel name whose rows here pay at home too, keeps the cover in (TE P147-6, Critic R243).
  for (const [market, cur] of [["SG", "SGD"], ["MY", "MYR"], ["UK", "GBP"]] as const)
    for (const [product, cover] of [["Holiday Inn Group Insurance", "Group Term Life"], ["Sunrise Travel & Tours Staff Insurance", "Group Hospital Income"],
      ["Trip.com Group Employee Benefits", "Group Hospital Cash"], ["Life Journey Protector", "Life Journey Protector"], ["Premium Holiday Saver", "Premium Holiday Saver"],
      ["Journey Critical Illness Plan", "Journey Critical Illness Plan"], ["Holiday Inn Group Insurance", "Group Travel Insurance cover for staff"]]) {
      const standing = { ...on("e", "Hospital cash in hospital or overseas", 80, { product, cover }), figure: { kind: "printed" as const, amount: 80, currency: cur, unit: "per_day" as const } };
      const other = { ...on("b", "Hospital Cash Benefit", 40), figure: { kind: "printed" as const, amount: 40, currency: cur, unit: "per_day" as const } };
      const travelNamed = /Travel Insurance/.test(cover);
      // "in hospital or overseas" also pays at home: standing, whatever the names say.
      assert.equal(tile("Hospital Cash", [standing, other]), null, `${market} ${product} / ${cover}`);
      assert.equal(tile("Hospital Cash", [{ ...standing, benefit: "Daily hospital cash while overseas" }, other]) == null, !travelNamed, `${market} ${product} / ${cover}: abroad only`);
      assert.equal(tile("Hospital Cash", [{ ...standing, benefit: "Hospital Cash Benefit" }, other]), null, `${market} ${product} / ${cover}: no abroad row`);
    }
  // A cover whose rows here are all waivers pays nothing for the category.
  const waiver = on("w", "Waiver of premium on disability", 0, { pays: "words", figure: { kind: "none", why: "no figure" } });
  assert.equal(tileRows([waiver, on("b", "Hospital Cash Benefit", 40)]).length, 1);
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

// A confirmed total stands only when it is the whole cover the person's benefit table gives (live 27f35c1: a personal
// policy's confirmed TPD line beside a scheme TPD only the scheme's summary prints gave the personal sum alone).
for (const [m, cur, sum, own] of [["SG", "SGD", 800000, 90000], ["MY", "MYR", 500000, 60000], ["UK", "GBP", 250000, 40000]] as const) {
  const cover = (coverKey: string, documentId: string, benefit: string, o: Partial<SummaryRow> = {}) =>
    ({ ...row(benefit, o), coverKey, source: { documentId } });
  const lump = (amount: number, currency: string | null = cur) => ({ figure: { kind: "printed" as const, amount, currency, unit: "lump_sum" as const } });
  const seePage = { figure: { kind: "none" as const, why: "no figure printed" } };
  const line = (amount: number | null, ...documentIds: string[]): ConfirmedLine => ({ amount, currency: cur, documentIds });
  test(`${m}: a scheme cover only its summary prints makes a personal confirmed sum a part sum`, () => {
    assert.equal(confirmedTotalComplete([cover("scheme", "summary", "Total and Permanent Disability Benefit", lump(sum)),
      cover("own", "personal", "Total and Permanent Disability Benefit", seePage)], [line(own, "personal")]), false);
  });
  test(`${m}: a scheme summary's cover counts as the certificate's line only through the cover's own document`, () => {
    const rows = [cover("scheme", "summary", "Death Benefit", lump(sum)), cover("own", "personal", "Death Benefit", seePage)];
    const lines = [line(sum, "cert-a", "cert-b"), line(own, "personal")];
    assert.equal(confirmedTotalComplete(rows, lines, [{ coverKey: "scheme", name: "Scheme", documentId: "cert-a", sumInsured: sum }]), true);
    // An equal amount alone never joins them (TE P148-1): no total.
    assert.equal(confirmedTotalComplete(rows, lines), false);
  });
  test(`${m}: an amount that happens to equal another policy's confirmed line is not that line`, () => {
    assert.equal(confirmedTotalComplete([cover("own", "personal", "TPD Benefit", lump(own)), cover("other", "second", "TPD Benefit", lump(own))],
      [line(own, "personal")]), false);
  });
  test(`${m}: no printed figure, of any kind, joins a cover to a confirmed line`, () => {
    const lines = [line(sum, "cert-a")];
    for (const figure of [lump(sum, null), { figure: { kind: "printed" as const, amount: sum, currency: cur, unit: "per_day" as const } }, lump(sum)])
      assert.equal(confirmedTotalComplete([cover("scheme", "summary", "TPD Benefit", figure)], lines), false);
  });
  test(`${m}: a rider with its own sum on a confirmed policy's document is not counted by that line`, () => {
    assert.equal(confirmedTotalComplete([cover("base", "personal", "TPD Benefit", lump(own)), cover("rider", "personal", "Rider TPD Benefit", lump(own / 2))],
      [line(own, "personal")]), false);
  });
  test(`${m}: a confirmed line with no amount leaves the total a part sum`, () => {
    assert.equal(confirmedTotalComplete([cover("own", "personal", "TPD Benefit", seePage)], [line(own, "personal"), line(null, "second")]), false);
  });
  test(`${m}: every cover counted, or a cover that pays nothing, keeps the total`, () => {
    assert.equal(confirmedTotalComplete([cover("own", "personal", "TPD Benefit", seePage), cover("none", "third", "TPD", { pays: "not_covered", ...seePage })],
      [line(own, "personal")]), true);
    assert.equal(confirmedTotalComplete([], [line(own, "personal")]), true);
  });
  test(`${m}: each line counts for one cover through its own document, never three covers for two lines`, () => {
    const lines = [line(sum, "cert-a"), line(sum, "cert-c")];
    const two = [cover("s1", "cert-a", "Death Benefit", lump(sum)), cover("s2", "cert-c", "Death Benefit", lump(sum))];
    assert.equal(confirmedTotalComplete(two, lines), true);
    assert.equal(confirmedTotalComplete([...two, cover("s3", "cert-a", "Death Benefit", lump(sum))], lines), false);
  });
}

// Lump-sum tiles give every policy's sum and add them up (DC 27 Oct). Equal amounts never join two covers (Critic R246).
for (const [m, cur, sum, own] of [["SG", "SGD", 800000, 90000], ["MY", "MYR", 500000, 60000], ["UK", "GBP", 250000, 40000]] as const) {
  const cover = (coverKey: string, documentId: string, benefit: string, o: Partial<SummaryRow> = {}) =>
    ({ ...row(benefit, o), coverKey, source: { documentId } });
  const lump = (amount: number, currency: string | null = cur) => ({ figure: { kind: "printed" as const, amount, currency, unit: "lump_sum" as const } });
  const seePage = { figure: { kind: "none" as const, why: "no figure printed" } };
  const line = (name: string, amount: number | null, ...documentIds: string[]) => ({ name, amount, currency: cur, documentIds });
  const held = (coverKey: string, documentId: string, sumInsured: number | null) => ({ coverKey, name: coverKey, documentId, sumInsured });
  test(`${m}: a scheme sum only its summary prints is added to a personal schedule line`, () => {
    const r = lumpSumParts([cover("scheme", "summary", "TPD Benefit", lump(sum)), cover("rider", "personal", "TPD Benefit", seePage)],
      [line("Rider", own, "personal")], [held("scheme", "certificate", sum), held("rider", "personal", own)]);
    assert.equal(r.total, sum + own);
    assert.deepEqual(r.parts.map((p) => p.amount), [own, sum]);
  });
  test(`${m}: a scheme cover whose own document is the confirmed certificate is counted once`, () => {
    const r = lumpSumParts([cover("scheme", "summary", "Death Benefit", lump(sum))], [line("Scheme", sum, "certificate")], [held("scheme", "certificate", sum)]);
    assert.equal(r.total, sum);
    assert.equal(r.parts.length, 1);
  });
  test(`${m}: an equal amount is never taken as the same cover or as another; with nothing to tell them apart, no total (R246 A, E; TE P148-2)`, () => {
    const a = lumpSumParts([cover("scheme", "summary", "TPD Benefit", lump(sum))], [line("Term", sum, "term")], [held("scheme", "scheme-cert", sum)]);
    assert.equal(a.total, null);
    assert.deepEqual(a.parts.map((p) => p.amount), [sum, sum]);
    const e = lumpSumParts([cover("scheme", "summary", "TPD Benefit", lump(own))], [line("A", own, "a"), line("B", own, "b")], [held("scheme", "scheme-cert", own)]);
    assert.equal(e.total, null);
    assert.equal(e.parts.length, 3);
    // A different sum beside a line with no cover here is plainly another policy: added.
    assert.equal(lumpSumParts([cover("scheme", "summary", "TPD Benefit", lump(sum))], [line("Term", own, "term")], [held("scheme", "scheme-cert", sum)]).total, sum + own);
  });
  test(`${m}: a certificate holding two covers gives its line to the one with its sum, in any order (R247 Q2)`, () => {
    const base = cover("life", "summary", "Death Benefit", lump(sum)), topUp = cover("topup", "summary", "Death Benefit (top-up)", lump(own));
    const h = [held("life", "certificate", sum), held("topup", "certificate", own)];
    assert.equal(lumpSumParts([base, topUp], [line("Life", sum, "certificate")], h).total, sum + own);
    assert.equal(lumpSumParts([topUp, base], [line("Life", sum, "certificate")], h).total, sum + own);
    // Neither cover has the line's sum, or both do: which is the line's cannot be told, so no total.
    assert.equal(lumpSumParts([base, topUp], [line("Life", sum + own, "certificate")], h).total, null);
    assert.equal(lumpSumParts([base, cover("life2", "summary", "Death", lump(sum))], [line("Life", sum, "certificate")],
      [held("life", "certificate", sum), held("life2", "certificate", sum)]).total, null);
  });
  test(`${m}: a personal accident cover printing several sums is its certificate line's by its sum insured`, () => {
    const pa = [cover("pa", "summary", "Death due to Accident", lump(sum)), cover("pa", "summary", "Permanent Disablement due to Accident", lump(sum * 1.5)),
      cover("pa", "summary", "Compassionate allowance", { figure: { kind: "printed", amount: own / 10, currency: cur, unit: "up_to" } })];
    const r = lumpSumParts(pa, [line("Group Personal Accident", sum, "certificate")], [held("pa", "certificate", sum)]);
    assert.equal(r.total, sum);
    assert.equal(r.parts.length, 1);
  });
  test(`${m}: one cover read under two names with the same sum is not added twice (R247 Q3)`, () => {
    const r = lumpSumParts([cover("gtl", "summary-1", "Death", lump(sum)), cover("group term life", "summary-2", "Death", lump(sum))], [],
      [{ ...held("gtl", "s1", sum), name: "GTL" }, { ...held("group term life", "s2", sum), name: "Group Term Life (Policy No. 12)" }]);
    assert.equal(r.total, null);
  });
  test(`${m}: a "100% of sum assured" row with no figure is its own schedule line's cover (R246 D)`, () => {
    const r = lumpSumParts([cover("plan", "wording", "TPD: 100% of sum assured", seePage)], [line("Plan", own, "schedule")], [held("plan", "schedule", own)]);
    assert.equal(r.total, own);
  });
  test(`${m}: a policy whose sum is not read is named with no amount, and there is no total`, () => {
    const r = lumpSumParts([cover("scheme", "summary", "Death Benefit", lump(sum)), cover("term", "term-doc", "Death benefit: higher of 101% of the cash value", seePage)],
      [line("Scheme", sum, "certificate")], [held("scheme", "certificate", sum), held("term", "term-doc", null)]);
    assert.equal(r.total, null);
    assert.deepEqual(r.parts.map((p) => [p.name, p.amount]), [["Scheme", sum], ["term", null]]);
  });
  test(`${m}: an up-to cap, a bare sign, another currency, two figures or a figure that is not the sum insured give no amount`, () => {
    const lines = [line("Scheme", sum, "certificate")];
    const one = (rows: ReturnType<typeof cover>[], h = [held("x", "x-doc", null)]) => lumpSumParts(rows, lines, h);
    assert.equal(one([cover("x", "x-doc", "Limits of compensation", { figure: { kind: "printed", amount: sum, currency: cur, unit: "up_to" } })]).total, null);
    assert.equal(one([cover("x", "x-doc", "TPD Benefit", lump(own, null))]).total, null);
    assert.equal(one([cover("x", "x-doc", "TPD Benefit", lump(own, cur === "GBP" ? "SGD" : "GBP"))]).total, null);
    assert.equal(one([cover("x", "x-doc", "TPD Benefit", lump(own)), cover("x", "x-doc", "TPD Benefit (after 65)", lump(own / 2))]).total, null);
    assert.equal(one([cover("x", "x-doc", "TPD Benefit", lump(own))], [held("x", "x-doc", own * 2)]).total, null);
    assert.equal(one([cover("x", "x-doc", "TPD Benefit", lump(own, { SGD: "S$", MYR: "RM", GBP: "£" }[cur]))], [held("x", "x-doc", own)]).total, sum + own);
  });
  test(`${m}: a cover whose rows print no amount gives its own sum insured only when its currency is stated`, () => {
    const rows = [{ ...cover("term", "term-doc", "Death Benefit: 100% of the sum insured", seePage), percentOf: "sum_insured" }];
    assert.equal(lumpSumParts(rows, [line("Scheme", sum, "certificate")], [{ ...held("term", "term-doc", own), currency: cur }]).total, sum + own);
    assert.equal(lumpSumParts(rows, [line("Scheme", sum, "certificate")], [held("term", "term-doc", own)]).total, null);
    assert.equal(lumpSumParts([...rows, cover("term", "term-doc", "Death Benefit cap", { figure: { kind: "printed", amount: sum, currency: cur, unit: "up_to" } })],
      [line("Scheme", sum, "certificate")], [{ ...held("term", "term-doc", own), currency: cur }]).total, null);
  });
  test(`${m}: a sum insured the benefit is not worked out from (a notional sum, a death benefit of the higher of premiums or cash value) gives no amount`, () => {
    const rows = [{ ...cover("ilp", "ilp-doc", "Death benefit: higher of 101% of the cash-in value", seePage), percentOf: "other" }];
    const r = lumpSumParts(rows, [line("Scheme", sum, "certificate")], [{ ...held("ilp", "ilp-doc", own), currency: cur }]);
    assert.equal(r.total, null);
    assert.equal(r.parts[1].amount, null);
  });
  test(`${m}: a sum equal to the cover's sum insured counts even with a survival or waiting period`, () => {
    const ci = { ...cover("ci", "ci-doc", "Critical Illness Benefit", { figure: { kind: "worked_out", amount: own, currency: cur, how: "100% of sum insured" },
      conditions: ["The Life Assured survives at least 7 days after the date of diagnosis", "The waiting period in Section 3.2."] }), percentOf: "sum_insured" };
    assert.equal(lumpSumParts([ci], [line("Scheme CI", sum, "certificate")], [held("ci", "ci-doc", own)]).total, sum + own);
    // Not the sum insured: a limit-bound figure stays unknown.
    const half = { ...ci, figure: { kind: "worked_out" as const, amount: own / 2, currency: cur, how: "50%" }, conditions: ["reduced by half after age sixty-five"] };
    assert.equal(lumpSumParts([half], [line("Scheme CI", sum, "certificate")], [held("ci", "ci-doc", own)]).total, null);
  });
  test(`${m}: a cover name drops a policy number printed into it; a cover paid out of a death benefit says so`, () => {
    const r = lumpSumParts([{ ...cover("gtl", "summary", "TPD", lump(sum)), cover: "GROUP TERM LIFE(POLICY NO.12345)" },
      { ...cover("acc", "plan-doc", "Total and Permanent Disability Benefit", seePage), section: "Total Disability Accelerator" }],
      [line("Total Disability Rider", own, "plan-doc")], [held("acc", "plan-doc", own)], "Total Permanent Disability");
    assert.deepEqual(r.parts.map((p) => [p.name, !!p.accelerates]), [["Total Disability Rider", true], ["GROUP TERM LIFE", false]]);
    assert.equal(r.total, sum + own);
  });
  test(`${m}: a schedule line whose own name places it in another category gives no amount there (R247 Q1b)`, () => {
    const r = lumpSumParts([], [line("Group Term Life", sum, "c"), line("Accidental Death Benefit", own, "c2")], [], "Death");
    assert.equal(r.total, null);
    assert.equal(r.parts[1].amount, null);
    assert.equal(lumpSumParts([], [line("Group Term Life", sum, "c"), line("Whole Life Plan", own, "c2")], [], "Death").total, sum + own);
  });
  test(`${m}: a sum insured counted through a row with a payout condition is marked; a survival or waiting period is not (Critic R249)`, () => {
    const withConds = (conditions: string[]) => lumpSumParts([{ ...cover("p", "p-doc", "Death Benefit", { figure: { kind: "worked_out", amount: own, currency: cur, how: "100%" },
      conditions }), percentOf: "sum_insured" } as Parameters<typeof lumpSumParts>[0][number]], [], [{ ...held("p", "p-doc", own), currency: cur }], "Death").parts[0];
    for (const c of ["reduced by half after age sixty-five", "less any amount already paid under this policy", "subject to a co-payment of 10%",
      "only if death occurs after age 65, otherwise a return of premiums", "payable in five yearly instalments"]) {
      const p = withConds([c]);
      assert.equal(p.amount, own, c);
      assert.equal(p.conditional, true, c);
    }
    for (const c of ["The Life Assured survives at least 7 days after the date of diagnosis or the date of surgical procedure performed for a Critical Illness covered under this benefit; and",
      "The waiting period in Section 3.2.", "This benefit is subject to the waiting period as stated in Clause 8."]) {
      assert.equal(withConds([c]).conditional, undefined, c);
    }
  });
  test(`${m}: the condition marker reads every row of a cover, on the table and the schedule-line path (Critic R250)`, () => {
    const half = "reduced by half after age sixty-five";
    // A confirmed schedule line matched to a cover with a limit row.
    const viaLine = lumpSumParts([cover("p", "p-doc", "Death Benefit", { ...lump(own), conditions: [half] })], [line("Life Plan", own, "p-doc")],
      [{ ...held("p", "p-doc", own), currency: cur }], "Death");
    assert.equal(viaLine.parts.length, 1);
    assert.equal(viaLine.parts[0].amount, own);
    assert.equal(viaLine.parts[0].conditional, true);
    // A second row equal to the sum insured carries the limit.
    const second = lumpSumParts([cover("p", "p-doc", "Death Benefit", lump(own)), cover("p", "p-doc", "Death Benefit (Terminal Illness)", { ...lump(own), conditions: [half] })],
      [], [{ ...held("p", "p-doc", own), currency: cur }], "Death").parts[0];
    assert.equal(second.amount, own);
    assert.equal(second.conditional, true);
    // A plain death row beside a "return of premiums before 65" row.
    const beside = lumpSumParts([cover("p", "p-doc", "Death Benefit", lump(own)),
      cover("p", "p-doc", "Death Benefit before age 65", { ...seePage, conditions: ["only a return of premiums paid if death occurs before age 65"] })],
      [], [{ ...held("p", "p-doc", own), currency: cur }], "Death").parts[0];
    assert.equal(beside.amount, own);
    assert.equal(beside.conditional, true);
    // The event the benefit is paid on is not a condition; anything past it is.
    const trig = (c: string) => lumpSumParts([cover("p", "p-doc", "Death Benefit", { ...lump(own), conditions: [c] })], [], [held("p", "p-doc", own)], "Death").parts[0].conditional;
    assert.equal(trig("If the Life Assured dies while the Policy is in force and We receive satisfactory proof of claim"), undefined);
    assert.equal(trig("If the Insured sustains TPD while this Supplementary Agreement is in force"), undefined);
    assert.equal(trig("If the life insured dies before the maturity date and this policy is in force and has not been converted into RPUI"), true);
    assert.equal(trig("If the Life Assured dies while the Policy is in force, half of the sum insured"), true);
    // No limit anywhere, or timing only: no mark.
    assert.equal(lumpSumParts([cover("p", "p-doc", "Death Benefit", lump(own))], [line("Life Plan", own, "p-doc")], [held("p", "p-doc", own)], "Death").parts[0].conditional, undefined);
    assert.equal(lumpSumParts([cover("p", "p-doc", "Critical Illness Benefit", { ...lump(own), conditions: ["The Life Assured survives at least 7 days after the date of diagnosis"] })],
      [line("CI Plan", own, "p-doc")], [held("p", "p-doc", own)], "Critical Illness").parts[0].conditional, undefined);
  });
  test(`${m}: a number in survival wording is timing only as days, months or a clause number (TE P149b)`, () => {
    const mark = (c: string) => lumpSumParts([cover("p", "p-doc", "Critical Illness Benefit", { ...lump(own), conditions: [c] })], [], [held("p", "p-doc", own)], "Critical Illness").parts[0].conditional;
    assert.equal(mark("Survival period: the life assured survives 0.5 of the benefit"), true);
    assert.equal(mark("The waiting period of 90 days from the date of the policy."), undefined);
    assert.equal(mark("This benefit is subject to the waiting period as stated in Clause 8."), undefined);
    assert.equal(mark("The waiting period of 3 months."), undefined);
  });
  test(`${m}: a schedule line with no amount leaves no total`, () => {
    assert.equal(lumpSumParts([], [line("A", own, "a"), line("B", null, "b")]).total, null);
    assert.equal(lumpSumParts([], [line("A", own, "a"), line("B", sum, "b")]).total, own + sum);
  });
}

console.log(`coverage table figures: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("FAIL", f); process.exit(1); }
