/**
 * A share of the sum insured with one printed cap ("10% of Sum Insured, up to S$25,000") is paid up to that cap, for any
 * currency and cap wording, when the cap is in the cover's own currency and nothing else in the passage bounds the share.
 * Anything less sure gives no figure. Made-up policies from several markets; no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const base = { policyId: "policy-1", productName: "Made-up Cover", traits: [], formulaKind: "none", formulaValue: null, currency: null, factKey: null,
  offsetDays: null, maximumDays: null, conditions: [] as string[], requirements: [], needsReview: false, basisInferred: false, sourcePage: 3, tier: null, reviewedAt: null };
const coverage = (amount: number, currency: string) => ({ id: "cov-1", policyId: "policy-1", familyMemberId: "fam-1", category: "Critical Illness", amount, currency,
  productName: "Made-up Cover", sourcePage: 1, evidenceText: "Made-up Cover, sum insured", insurer: "Kestrel Assurance", policyName: "Made-up Cover",
  policyNumber: "C-001", groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true, policyDocumentVersion: "sha256:v1" });

test("one printed cap in the cover's currency: the lower of the share and the cap, on stored and freshly read rows", async () => {
  const { repairStoredRules, assessCatalogBenefit } = await import("@/lib/policies/benefit-catalog");
  const pay = (quote: string, sumInsured: number, currency: string, stored: boolean) => {
    const share = Number(quote.match(/(\d+)%/)![1]) / 100;
    const [b] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote, ...(stored ? { formulaKind: "sum_insured", formulaValue: share } : {}) }] as never);
    const a = assessCatalogBenefit({ benefit: b as never, coverage: coverage(sumInsured, currency) as never, ownerName: "Ana", facts: {} as never, events: ["critical_illness"] as never }) as { item?: { calculatedAmount?: number | null } };
    return a.item?.calculatedAmount ?? null;
  };
  for (const [quote, sumInsured, currency, expected] of [
    ["Angioplasty: 10% of Sum Insured, up to S$25,000", 1_000_000, "SGD", 25_000],
    ["Angioplasty: 10% of Sum Insured, up to S$25,000", 100_000, "SGD", 10_000],
    ["10% of the sum assured, subject to a maximum of SGD 25,000 per life assured", 1_000_000, "SGD", 25_000],
    ["10% of the sum insured or RM5,000, whichever is lower", 1_000_000, "MYR", 5_000],
    ["10% of the sum insured, subject to a maximum of £10k per life", 500_000, "GBP", 10_000],
    ["Angioplasty: 10% of the Sum Insured, limited to US$20,000 per claim", 400_000, "USD", 20_000],
    ["10% of the coverage amount, capped at HK$50,000", 2_000_000, "HKD", 50_000],
    ["The benefit is 25% of the sum insured, but no more than A$15,000 per claim", 100_000, "AUD", 15_000],
    ["We will pay 10% of the sum insured under this policy, maximum S$25,000 per insured person", 1_000_000, "SGD", 25_000],
    ["An additional 20% of the Sum Assured will be payable, subject to a maximum amount of S$25,000 (or equivalent currency) per life per condition.", 1_000_000, "SGD", 25_000],
    ["we will, subject to the provisions of this Policy, pay 20% of the Insured Amount under this Supplementary Agreement, subject to a limit of S$25,000", 1_000_000, "SGD", 25_000],
    ["10% of the sum insured, no more than €8,000", 200_000, "EUR", 8_000],
  ] as const) {
    assert.equal(pay(quote, sumInsured, currency, true), expected, "stored: " + quote);
    assert.equal(pay(quote, sumInsured, currency, false), expected, "read: " + quote);
  }
  const [noted] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote: "10% of Sum Insured, up to S$25,000", formulaKind: "sum_insured", formulaValue: 0.1 }] as never);
  assert.ok(noted.conditions.includes("Paid up to S$25,000, the cap this passage prints."), JSON.stringify(noted.conditions));
});

test("anything less sure than one cap in the cover's currency gives no figure, never the full share", async () => {
  const { repairStoredRules, assessCatalogBenefit } = await import("@/lib/policies/benefit-catalog");
  for (const [quote, currency] of [
    ["10% of the sum insured, up to US$25,000", "SGD"], // cap in another currency
    ["10% of the sum insured, up to 25,000", "SGD"], // no currency printed
    ["10% of the sum insured, up to $25,000", "SGD"], // a dollar of no stated country
    ["10% of the sum insured, up to S$25,000 per day", "SGD"], // a daily cap is not a lump-sum cap
    ["10% of the sum insured, up to S$25,000 or S$5,000 for children", "SGD"], // two figures
    ["10% of the sum insured, after an excess of S$500", "SGD"], // not a cap
    ["10% of the sum insured, up to S$25,000 less any amount paid before", "SGD"], // another bound
    ["10% of the sum insured, up to the limit in the Schedule", "SGD"], // a cap with no figure
    ["10% of the sum insured, up to S$25,000 or the amount in the table, whichever is lower", "SGD"],
    // Critic R416 and TE pr211: a cap for some claims only, an aggregate, a second share, another sentence's cap, a change.
    ["10% of the sum insured, up to S$25,000 for adults; for children 50% of that", "SGD"],
    ["10% of the sum insured, up to S$25,000 in total for all early stage claims", "SGD"],
    ["10% of the sum insured, up to S$25,000 per lifetime across all policies with us", "SGD"],
    ["10% of the sum insured, maximum S$25,000 in total", "SGD"],
    ["10% of the sum insured, up to S$25,000; the benefit is 20% of Sum Insured if diagnosed before age 18", "SGD"],
    ["10% of Sum Insured. Ambulance fees up to S$500.", "SGD"],
    ["10% of the sum insured, up to S$25,000, plus 5% for each year in force", "SGD"],
    ["10% of the sum insured (maximum S$25,000), doubled if the event happens overseas", "SGD"],
    ["10% of the sum insured, up to S$25,000, increased by 10% each year", "SGD"],
    ["10% of the sum insured, up to S$5,000 for a child under 18", "SGD"],
    ["10% of the sum insured, up to S$5,000 if aged 70 or above", "SGD"],
    ["10% of the sum insured, up to S$25,000 if the accident happens overseas", "SGD"],
    ["10% of the sum insured, up to S$25,000 in the first policy year", "SGD"],
    ["10% of the sum insured, up to S$25,000 under Plan A", "SGD"],
    ["10% of the sum insured; dental treatment under this benefit is limited to S$500", "SGD"],
    ["10% of the sum insured, with cosmetic surgery up to S$2,000", "SGD"],
    ["10% of the sum insured, up to S$25,000; for each child the benefit is halved", "SGD"],
    ["Keyhole surgery: 10% of the Sum Insured, limited to S$20,000 per claim", "SGD"], // another benefit's label
  ] as const) {
    for (const stored of [true, false]) {
      const [b] = repairStoredRules([{ ...base, id: "x", benefitName: "Angioplasty", quote, ...(stored ? { formulaKind: "sum_insured", formulaValue: 0.1 } : {}) }] as never);
      const a = assessCatalogBenefit({ benefit: b as never, coverage: coverage(1_000_000, currency) as never, ownerName: "Ana", facts: {} as never, events: ["critical_illness"] as never }) as { item?: { calculatedAmount?: number | null } };
      assert.equal(a.item?.calculatedAmount ?? null, null, (stored ? "stored: " : "read: ") + quote);
    }
  }
});
