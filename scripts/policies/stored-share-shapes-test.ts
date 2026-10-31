/**
 * Replay of the stored "share of the sum insured" rows, by shape, through today's read-back code (repairStoredRules).
 * Fails when a row that showed an amount stops showing one. On 16be49a, 40 stored burns-table rows ("Equals to or greater
 * than 15% but less than 25% 30%") became "could not be read", because "greater" was taken for a cap on the amount.
 * The shapes are the policy-wording passages stored on 31 Oct (no person's details), plus made-up variants in other
 * wordings. Only a passage that prints a cap is withheld. No database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const base = { policyId: "policy-1", productName: "Made-up Cover", traits: [], formulaKind: "sum_insured", currency: null, factKey: null,
  offsetDays: null, maximumDays: null, requirements: [], needsReview: false, sourcePage: 7, tier: null, reviewedAt: null };
const row = (benefitName: string, value: number, quote: string, basisInferred = false) =>
  ({ ...base, id: benefitName, benefitName, formulaValue: value, quote, basisInferred, conditions: [] as string[] });

// [name, share, quote] as stored: each keeps its share.
const KEPT: [string, number, string][] = [
  ["Third Degree Burns · Body - Equals to or greater than 15% but less than 20%", 0.75, "- Equals to or greater than 15% but less than 20% 75%"],
  ["Third Degree Burns · Body - Equals to or greater than 20%", 1, "- Equals to or greater than 20% 100%"],
  ["Second Degree Burns · Body - Equals to or greater than 25% but less than 40%", 0.4, "- Equals to or greater than 25% but less than 40% 40%"],
  ["Second Degree Burns · Body - Equals to or greater than 40%", 0.5, "- Equals to or greater than 40% 50%"],
  ["Third Degree Burns · Head - Equals to or greater than 5% but less than 8%", 0.75, "- Equals to or greater than 5% but less than 8% 75%"],
  ["Third Degree Burns · Head - Equals to or greater than 8%", 1, "- Equals to or greater than 8% 100%"],
  ["Third Degree Burns · Body - Equals to or greater than 10% but less than 15%", 0.5, "Body - Equals to or greater than 10% but less than 15% 50%"],
  ["Second Degree Burns · Body - Equals to or greater than 15% but less than 25%", 0.3, "Body - Equals to or greater than 15% but less than 25% 30%"],
  ["Second Degree Burns · Head - Equals to or greater than 10%", 1, "Head - Equals to or greater than 10% 100%"],
  ["Third Degree Burns · Head - Equals to or greater than 2% but less than 5%", 0.5, "Head - Equals to or greater than 2% but less than 5% 50%"],
  ["8. Loss of or Permanent Total Loss of use of four fingers and thumb (a) Both Hands", 1, "(a) Both Hands 100%"],
  ["13. Loss of one phalanx of (b) Left index finger", 0.075, "(b) Left index finger 7.5%"],
  ["2. Permanent Total Loss of (c) Sight in one eye, except perception of light", 0.5, "(c) Sight in one eye, except perception of light 50%"],
  ["Death", 1, "• Death 100% of Sum Insured"],
  ["Total and Permanent Disablement2due to Accident", 1.5, "• Total and Permanent Disablement2due to Accident 150% of Sum Insured"],
  ["1. Loss of or Permanent Total Loss of use of at least one limb", 1, "1. Loss of or Permanent Total Loss of use of at least one limb 100%"],
  ["Critical Illness Benefit", 1, "100% of the Sum Assured will be payable in one lump sum."],
  ["4. Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist", 1, "4. Loss of arm (at shoulder, between shoulder and elbow, at elbow, between elbow and wrist) 100%"],
  ["18. Loss of any toe other than great toe", 0.03, "18. Loss of any toe other than great toe 3%"],
  ["Disability Benefit", 1 / 12, "Disability Benefit One twelfth of Sum Insured"],
  ["Shortening of leg by at least 5cm", 0.1, "Shortening of leg by at least 5cm 10%"],
  ["Neck, Skull or Spine (Full Break)", 1, "Neck, Skull or Spine (Full Break) 100%"],
  ["Hip", 0.75, "Hip 75%"],
  // Made-up thresholds of the event in other wordings and markets.
  ["Burns, more than 30% of body surface", 1, "Burns covering greater than 30% of the body surface 100%"],
  ["Hearing loss", 0.5, "Hearing loss of higher than 80 decibels in one ear 50%"],
  ["Luka bakar", 0.5, "Luka bakar: lower than 20% of body surface but at least 10% 50%"],
  ["Scarring", 0.25, "Facial scarring greater than 5 cm in length: 25% of the Sum Insured"],
  ["Burns", 0.5, "Burns Greater Than 5%, Less Than 8% of the body 50%"],
  ["Burns", 1, "Burns covering more than 30% of the body surface: 100% of the Sum Insured"],
  ["Coma", 0.5, "Coma lasting longer than 96 hours 50% of the Sum Insured"],
  ["Fall", 0.2, "Injury from a fall higher than 3 metres 20%"],
  ["ICU", 0.1, "Stay in intensive care of more than 5 days 10% of the Sum Insured"],
  ["Child", 0.5, "If the insured's age is lower than 18: 50% of the Sum Insured"],
  ["Weight", 0.1, "Weight loss of more than 10 kg 10% of the Sum Insured"],
  ["Burns", 0.25, "Burns greater than or equal to 20% of body surface: 25% of Sum Insured"],
  ["ICU", 0.1, "Intensive care for greater than 7 consecutive days: 10% of Sum Assured"],
  // A word that only looks like a negation keeps the threshold free.
  ["Burns", 0.5, "Burns, nothing paid below this; greater than 20% of the body surface 50%"],
  ["Note", 0.3, "Third degree burns, not less than 30 days in hospital, more than 20% of body 30%"],
];
// Passages that print a cap: withheld (or, once read, capped), never the full share.
const CAPPED: [string, number, string][] = [
  ["Special Benefit", 0.2, "an additional 20% of the Sum Assured will be payable, subject to a maximum amount of S$25,000 (or equivalent currency) per life per condition."],
  ["Intensive Care Benefit", 0.2, "an additional 20% of the Sum Assured will be payable, subject to a maximum amount of S$25,000 (or equivalent currency) per life."],
  ["Special Benefit", 0.2, "Pays a Special Benefit of an additional 20% of the Sum Assured upon diagnosis of any one of the 27 conditions covered, up to S$25,000 (or equivalent currency) per life per condition."],
  ["Advance Payment", 1, "Singlife will make an advance payment of 100% of the Sum Assured, up to a maximum of S$400,000 in the event that an Insured Person is diagnosed with any disease which is probable to lead to death within the next 12 months"],
  ["Special Condition Benefit", 0.2, "we will, subject to the provisions of this Policy, pay 20% of the Insured Amount under this Supplementary Agreement, subject to a limit of S$25,000"],
  // Made-up: a share bounded by another share or by "if lower", in words only.
  ["Partial disability", 0.5, "50% of the Sum Insured, but not greater than the amount in the Benefit Table"],
  ["Early stage", 0.25, "25% of the Sum Insured, no greater than 10% of the total Sum Insured of all policies"],
  ["Angioplasty", 0.1, "10% of the Sum Insured or the amount shown below, if lower"],
  ["Angioplasty", 0.1, "10% of the Sum Insured or RM 20,000, whichever is greater"],
  // A comparative that compares the payout with an amount, however it is negated (Critic R421, TE pr215 C1-C9).
  ...["but never greater than the amount in force", "but the payout cannot be higher than the outstanding loan", "or the outstanding loan if smaller than that",
    "reduced where this is greater than the hospital bill", "and it isn't greater than the overall benefit", "but at no time higher than the amount shown",
    "so long as this is lower than the remaining sum insured", "or the actual charges if lower than that", "but shall not in any event be greater than the amount shown",
    "but this may not be greater than the amount shown", "not larger than the amount shown", "no higher than the amount shown"]
    .map((tail): [string, number, string] => ["Benefit", 0.1, "10% of Sum Insured, " + tail]),
  ["Benefit", 0.25, "25% of the Sum Insured, which shall not be greater than 10% of the Sum Insured of all policies combined"],
  ["Benefit", 0.5, "50% of the Sum Insured, but never greater than 20% of the Sum Insured for all claims together"],
  ["Benefit", 0.05, "5% of the Sum Insured per finger, which cannot be higher than 20% of the Sum Insured in total"],
  ["Benefit", 0.1, "10% of the Sum Insured or 50% of the bill, if smaller than that"],
  ["Benefit", 0.2, "20% of the Sum Insured, provided this is not to be greater than the base plan's death benefit"],
  ["Benefit", 0.25, "25% of the Sum Insured but must be lower than the amount of the main claim"],
  ["Benefit", 0.1, "10% of the Sum Insured, but not more than 5% of the total benefits greater than 5% of the premium"],
  // A negated comparative caps the payout even before a measure of the event (TE pr215 C11, C18, C19; Critic R425).
  ["Hospital", 0.01, "1% of the Sum Insured for each day in hospital, but not greater than 60 days in total"],
  ["Hospital", 0.01, "1% of the Sum Insured for each day in hospital, for not more than 60 days"],
  ["Disability", 0.02, "2% of the Sum Insured a week, for no more than 26 weeks"],
  ["Major burns", 0.5, "Major burns: 50% of Sum Insured, but not higher than 25% for children"],
  ["Major burns", 0.5, "Major burns: 50% of Sum Insured, but no more than 25% if under 18"],
  ["Major burns", 0.5, "Major burns: 50% of Sum Insured, never higher than 25%"],
  ["Benefit", 0.1, "10% of Sum Insured, but not higher than 25%"],
  ["Benefit", 0.1, "10% of Sum Insured, which isn't more than 20% in total"],
  ["Benefit", 0.1, "10% of Sum Insured, which shall not be more than 20% in total"],
  ["Benefit", 0.02, "2% of the Sum Insured a month, paid for a period not longer than 24 months"],
];

test("every stored share without a printed cap keeps its amount; one with a cap is never paid in full", async () => {
  const { repairStoredRules, CAPPED_SHARE_NOTE } = await import("@/lib/policies/benefit-catalog");
  for (const [name, value, quote] of KEPT) for (const inferred of [false, true]) {
    const out = repairStoredRules([row(name, value, quote, inferred)] as never)[0];
    assert.ok(out, "row kept: " + quote);
    assert.equal(out.formulaKind, "sum_insured", "still an amount: " + quote);
    assert.ok(Math.abs((out.formulaValue ?? 0) - value) < 1e-9, "same share: " + quote);
    assert.ok(!out.conditions.includes(CAPPED_SHARE_NOTE), quote);
  }
  for (const [name, value, quote] of CAPPED) {
    const out = repairStoredRules([row(name, value, quote)] as never)[0];
    assert.ok(out.formulaKind === "none" ? out.conditions.includes(CAPPED_SHARE_NOTE) : out.formulaValue !== value, "never the full share: " + quote);
  }
});
