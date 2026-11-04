/** A figure followed by "per <unit>" or "/<unit>" is a fixed sum or a ceiling only when the unit is a closed-list event
 * ("per claim", "each accident"). A period, or wording the reader does not know (another language included), never
 * becomes a lump sum or one total: the row stays as printed, with no figure (real-model run on d687296f, finding 1).
 * Made-up cells only; no model, no network. */
import assert from "node:assert/strict";
import { parseBenefitValue, treatmentSubLimit } from "../../lib/policies/benefit-rows";

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); pass++; console.log("ok - " + name); } catch (e) { fail++; console.log("FAIL - " + name + "\n" + (e as Error).message); }
}

// Unknown units: no amount, whatever the currency.
const unknown = [
  "Rp 750.000 per hari", "Rp 750.000/hari", "RM 200 sehari", "€ 50 par jour", "€50 pro Tag", "S$500 per hour",
  "S$40 per km", "US$100 per session", "£25 per fortnight", "S$500 per claim per day", "HK$300 per diem",
  "Up to Rp 750.000 per hari", "Up to S$100 per day", "Up to S$100 (per day)", "Up to S$1,000, per day",
  "Up to €50, par jour", "Up to RM 50 sehari", "Up to S$500/day", "Up to S$200 for every 6 hours",
  "Maximum US$150 per week", "Not exceeding £80 per night", "Limited to S$1,000 per month", "Up to S$300 each day",
  // The whole trailer is read, not just its first word or first "per" clause (Critic H1 and TE on #338).
  "Up to S$100 in any one day", "Up to S$100 in a day", "Up to S$100 on each day", "Up to S$100 incurred per day",
  "Up to S$100 payable per day", "Up to S$100 for ICU per day", "Up to S$100 towards each day", "Up to S$100 as daily allowance",
  "Up to S$100 during each 24 hours", "Up to S$100 per visit, per day", "Up to S$500 per accident, per day",
  "Up to S$100 per claim (per day)", "Up to S$100 for hospitalisation, daily", "Up to S$100 within 24 hours",
  "Up to S$100 for 30 days", "Up to S$100 per month for 6 months", "Up to S$100 for each session",
  // A unit word that only begins with a period is not that period (Critic M2 on #338).
  "S$100 per weekday", "S$100 per monthly instalment", "S$100 per daycare session", "S$100 per annum",
  // Shorter periods however written, and a second figure (a sub-limit) in the trailer (Critic L2 on #338).
  "Up to S$100 in any one quarter", "Up to S$100 quarterly", "Up to S$100 within 24h", "Up to S$100 in any 24 hrs",
  "Up to S$1,000 per policy year, S$100 per visit", "Up to S$5,000 per accident (S$500 per item)",
  // A bracket that is not a named part's sub-limit still gives no amount (TE r9 on #338).
  "Up to S$3,000 (each visit up to S$300)", "Up to S$3,000 (per visit up to S$100)", "Up to S$3,000 (TCM up to S$300 per day)",
  "Up to S$3,000 (S$300 for TCM)", "Up to S$3,000 (dental up to S$300) and S$50 per x-ray", "Up to S$3,000 per day (dental up to S$300)",
  "Up to S$3,000 per fortnite (dental up to S$300)", "Up to S$3,000 (any one item up to S$500)", "Up to S$3,000 (maximum S$300 per visit)",
  // Critic #338: a bracket for a person, a place, a condition, panel status or an "if" limits the very claim it names.
  "Up to S$100,000 per person (children up to S$25,000)", "Up to S$100,000 (children under age ten up to S$25,000)",
  "Up to S$200,000 (spouse up to S$100,000)", "Up to S$50,000 (dependants limited to S$10,000)", "Up to S$500,000 (juveniles capped at S$50,000)",
  "Up to S$3,000 per accident (overseas up to S$1,000)", "Up to S$5,000 (outside Singapore up to S$2,000)",
  "Up to S$10,000 (pre-existing conditions up to S$1,000)", "Up to S$20,000 (if hospitalised overseas up to S$5,000)",
  "Up to S$1,000 (non-panel clinics up to S$300)", "Up to S$100,000 (death by natural causes up to S$20,000)",
  "Up to S$3,000 (TCM up to S$300) per year", "Up to S$3,000 (dental treatment for children up to S$300)",
];
for (const cell of unknown) check(`"${cell}" gives no amount`, () => assert.equal(parseBenefitValue(cell), null, JSON.stringify(parseBenefitValue(cell))));

// Event units keep their figure, as before.
const fixed: [string, number][] = [
  ["S$500 per claim", 500], ["S$500 each accident", 500], ["S$5,000 per policy year", 5000], ["S$200 per insured person", 200],
  ["US$1,000 per trip", 1000], ["£250 per item", 250], ["RM 2,000 per admission", 2000], ["S$300 per any one claim", 300], ["S$5,000", 5000],
];
for (const [cell, v] of fixed) check(`"${cell}" stays a fixed ${v}`, () => {
  const p = parseBenefitValue(cell);
  assert.equal(p?.kind, "fixed"); assert.equal(p?.value, v);
});
const caps: [string, number][] = [
  ["Up to US$2,000 per accident", 2000], ["Up to S$500 for each claim", 500], ["Up to S$5,000", 5000], ["Up to S$5,000 per policy year", 5000],
  ["Up to S$1,000, subject to the overall limit", 1000], ["Up to S$100 (per claim)", 100], ["Up to S$5,000 in total", 5000],
  ["Up to S$500 for surgery", 500], ["Maximum S$300 per trip", 300], ["Up to S$100.", 100],
  // A ceiling for the year is one total for the year (scripts/fixtures/r5/make.py, r6 chat-quality regressions).
  ["Up to S$300 per year", 300], ["Up to S$300 per annum", 300], ["Up to S$300 in any one year", 300],
  ["Up to S$5,000 in any one claim", 5000], ["Up to S$5,000 per event, per insured person", 5000],
  // A bracketed sub-limit for a named part leaves the ceiling of the whole (TE r9 on #338).
  ["Up to S$3,000 per accident (traditional Chinese medicine up to S$300)", 3000], ["Up to S$3,000 (physiotherapy limited to S$500)", 3000],
  ["Up to US$10,000 per trip (for dental treatment up to US$500)", 10000], ["Maximum S$2,000 per policy year (chiropractic maximum of S$200)", 2000],
  ["Up to S$2,000 per life assured", 2000], ["Up to S$800 per treatment", 800], ["Up to S$500 per child", 500], ["Up to S$4,500 per calendar year", 4500],
];
for (const [cell, v] of caps) check(`"${cell}" stays a ceiling of ${v}`, () => {
  const p = parseBenefitValue(cell);
  assert.equal(p?.kind, "expense_cap"); assert.equal(p?.value, v);
});

// The English per-day rate is still a daily rate.
check(`"RM 600 per day" is a daily rate`, () => { const p = parseBenefitValue("RM 600 per day"); assert.equal(p?.kind, "daily"); assert.equal(p?.value, 600); });
check(`"S$100 a day" is a daily rate`, () => { const p = parseBenefitValue("S$100 a day"); assert.equal(p?.kind, "daily"); assert.equal(p?.value, 100); });
check(`"$4,500 per calendar year" is a yearly amount`, () => { const p = parseBenefitValue("$4,500 per calendar year"); assert.equal(p?.kind, "fixed"); assert.equal(p?.value, 4500); assert.equal(p?.period, "year"); });
check(`"S$300 per year" is a yearly amount`, () => { const p = parseBenefitValue("S$300 per year"); assert.equal(p?.kind, "fixed"); assert.equal(p?.period, "year"); });
check(`"S$30 per day" is a daily rate`, () => { const p = parseBenefitValue("S$30 per day"); assert.equal(p?.kind, "daily"); assert.equal(p?.value, 30); });

check("a treatment sub-limit is read out for the card", () => {
  assert.equal(treatmentSubLimit("Up to S$3,000 per accident (traditional Chinese medicine up to S$300)"), "traditional Chinese medicine up to S$300");
  assert.equal(treatmentSubLimit("Up to S$100,000 per person (children up to S$25,000)"), null);
});

console.log(`per-unit: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
