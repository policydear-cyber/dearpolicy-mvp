/**
 * A table cell read as a benefit of its own ("273,411", "nd", "(a)", "2027", "only", "and Merdeka") names nothing: it
 * must not be shown on the Benefits page, or kept as a rule chat can cite (rows stay stored, so a wrong call is undone by a code fix). Real benefit names, however
 * they are numbered, abbreviated or punctuated, are kept. Made-up names in the shapes read documents print. No
 * database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const NAMELESS = [
  "", "  ", "273,411", "52,157", "2027", "2030", "3rd", "nd", "th", "(a)", "(b)", "(iv)", "N/A", "N/A N/A", "S$5,000", "50%", "-",
  "only", "and Merdeka", "or", "percent (20%) of the surface of the Life", "of the Life Assured", "up to S$100",
  "Cash payouts provide 2026 you flexibility to", "Benefits payable in respect of", "Cover for the",
  "SGD 5,000", "USD 300.00", "MYR 448.23", "GBP 150", "RM 20", "Nil", "NIL", "Not applicable", "TBA",
  "dan Merdeka", "atau", "untuk setiap hari", "As charged", "As Charged.", "sahaja",
];
const NAMED = [
  "Death Benefit", "Critical Illness Benefit", "Hospital Cash Benefit*", "Day surgery", "Hip", "ICU", "Class C",
  "Drug Treatment and Prophylaxis for Haemophilia A", "Drug Treatment for X-Linked", "Table 2 A/B/C", "Table 7 A/B/C (more complex procedures)",
  "Proton beam therapy – Category 1", "Psychiatric (up to 60 days per policy year)", "12. Loss of or Permanent Total Loss of use of fingers (a) Three Right Phalanges",
  "2. Permanent Total Loss of (b) Whole eye", "Second Degree Burns · Head - Equals to or greater than 10%", "Shortening of leg by at least 5cm",
  "(a) Angioplasty and Other Invasive Treatment for :", "(b) Other than “Angioplasty and Other Invasive :", "Community Hospital/Short-stay ward/",
  "Cover for sports equipment in the event of damage or theft, including", "If you need to return home earlier than planned",
  "Total and Permanent Disablement2due to Accident", "TOTAL DISABILITY ACC - MAX 2213S", "eShield Benefit", "2nd Medical Opinion", "24-hour Assistance",
  "Overall limit^", "Not covered", "Repatriation of mortal remains", "Loss of use of one hand and one foot", "Kidney dialysis",
  // Other scripts, short forms, and joining words that are part of a hyphenated word (Critic R347, TE #186).
  "危疾保障", "身故", "死亡保険金", "입원", "ประกัน", "Décès", "CI", "TI", "PA", "GP", "ER", "CT", "DB", "OT", "TB", "A&E", "TI/CI", "CI 1",
  "in-hospital doctor's visit", "up-front cash", "per day hospital cash", "in-patient treatment", "on-call doctor", "Room & Board",
  // One Han character is a word (Critic R352): "癌" is cancer.
  "癌", "癌 S$50,000",
];

test("a name that names nothing is not a benefit; every real benefit name is kept", async () => {
  const { namesNoBenefit } = await import("@/lib/policies/benefit-catalog");
  for (const name of NAMELESS) assert.equal(namesNoBenefit(name), true, JSON.stringify(name));
  for (const name of NAMED) assert.equal(namesNoBenefit(name), false, JSON.stringify(name));
});

test("stored rules with such names are left out of what the Benefits page and chat use", async () => {
  const { repairStoredRules } = await import("@/lib/policies/benefit-catalog");
  const row = (id: string, benefitName: string, formulaValue: number | null) => ({
    id, policyId: "p1", productName: "Example Shield", benefitName, traits: ["other"] as never[], formulaKind: (formulaValue == null ? "none" : "fixed") as never,
    formulaValue, currency: "SGD", factKey: null, offsetDays: null, maximumDays: null, sourcePage: 4, quote: benefitName + (formulaValue ? " $" + formulaValue : ""),
    conditions: [], requirements: [] as never[], needsReview: false, basisInferred: false, needsConfirmation: false, reviewedAt: null,
  });
  const kept = repairStoredRules([row("1", "2027", 717), row("2", "only", 100), row("3", "Kidney dialysis", 1000), row("4", "nd", null), row("5", "and Merdeka", 448.23)]);
  assert.deepEqual(kept.map((b) => b.benefitName), ["Kidney dialysis"]);
});

test("a plan's empty cell read as the name of its row names nothing; the same words with any other quote are kept", async () => {
  const { namesNoBenefit } = await import("@/lib/policies/benefit-catalog");
  const { namesOnlyAPlanCell } = await import("@/lib/insurance/scale-limit");
  for (const [name, quote] of [["Not covered", "Not covered S$500 S$1,000"], ["Not covered", "Not covered\tS$500\tS$1,000"], ["N/A", "N/A RM 300 RM 500"],
    ["Not applicable", "Not applicable £1,000 £1,500"], ["Nil", "Nil S$100 per day S$200 per day"], ["Not covered.", "Not covered S$500 S$1,000"],
    ["Tidak dilindungi", "Tidak dilindungi RM300 RM500"], ["Excluded", "Excluded S$500"]]) {
    assert.equal(namesOnlyAPlanCell(name, quote), true, quote);
    assert.equal(namesNoBenefit(name, quote), true, quote);
  }
  // A heading over what a policy does not pay, a sentence, a row with its own words, a single cell, or no quote: kept.
  for (const [name, quote] of [["Not covered", "Not covered: pre-existing conditions, cosmetic surgery"], ["Not covered", "Not covered S$500 S$1,000 if you travel against advice"],
    ["Not covered", "Mobility aids Not covered S$500 S$1,000"], ["Not covered", "Not covered"], ["Not covered", null], ["Not covered", "S$500 S$1,000"],
    ["Overall limit^", "Overall limit^ S$300 S$800 S$1,500"], ["Mobility aids", "Not covered S$500 S$1,000"]] as [string, string | null][]) {
    assert.equal(namesOnlyAPlanCell(name, quote), false, String(quote));
    if (quote != null) assert.equal(namesNoBenefit(name, quote), false, quote);
  }
  assert.equal(namesNoBenefit("Not covered"), false, "with no quote the name is kept, as before");
});
