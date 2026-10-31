/**
 * A share of the sum insured whose passage also prints an amount ("10% of Sum Insured, up to S$25,000") is not used: the
 * amount may cap the share, and the full share overstated the benefit. Made-up rows; no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const base = { policyId: "policy-1", productName: "Made-up Critical Cover", traits: [], formulaKind: "none", formulaValue: null, currency: null, factKey: null,
  offsetDays: null, maximumDays: null, conditions: [] as string[], requirements: [], needsReview: false, basisInferred: false, sourcePage: 3, tier: null, reviewedAt: null };
const row = (quote: string, o: Record<string, unknown> = {}) => ({ ...base, id: "x", benefitName: "Angioplasty", quote, ...o });
const coverage = { id: "cov-1", policyId: "policy-1", familyMemberId: "fam-1", category: "Critical Illness", amount: 1_000_000, currency: "SGD",
  productName: "Made-up Critical Cover", sourcePage: 1, evidenceText: "Made-up Critical Cover, sum insured", insurer: "Kestrel Assurance", policyName: "Made-up Critical Cover",
  policyNumber: "C-001", groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true, policyDocumentVersion: "sha256:v1" };

const CAPPED = ["Angioplasty: 10% of Sum Insured, up to S$25,000", "10% of the sum insured, subject to a maximum of SGD 25,000", "10% of the sum insured, not exceeding RM25,000",
  "10% of the sum insured, no more than 25,000 in total", "10% of the sum insured, to a total of twenty-five thousand", "10% of the sum insured, capped at 25,000 dollars",
  "10% of the sum insured, maximum US$ 25,000", "10% of the sum insured or €25,000, whichever is lower", "10% of the sum insured (limit 25000)",
  // Other ways to print an amount or a bound (TE pr210).
  "10% of the sum insured, payable to 25 000", "10% of the sum insured, payable to 25.000", "10% of the sum insured, payable to 25k",
  "10% of the sum insured, at five hundred dollars", "10% of the sum insured, twenty-five hundred dollars", "10% of the sum insured, CHF 25'000",
  "10% of the sum insured, 900 per day", "10% of the sum insured, up to the maximum shown in the Schedule",
  "10% of the sum insured, up to the limit in the Benefit Table", "10% of the sum insured, capped at 1/40 of the Sum Insured",
  // Critic R414.
  "10% of Sum Insured, up to S$ 25 000", "10% of Sum Insured, up to $ 500", "10% of Sum Insured, up to five hundred dollars", "10% of Sum Insured, maximum 500 per claim",
  "10% of Sum Insured, subject to the limit shown in the Policy Schedule", "10% of Sum Insured, up to the Maximum Benefit Limit",
  "10% of Sum Insured or the amount in the table below, whichever is lower", "10% of Sum Insured or the amount in the table below if lower",
  "10% daripada Jumlah Diinsuranskan, tidak melebihi jumlah dalam Jadual"];

test("a share whose passage prints an amount gives no rule, read or stored; a share alone still stands", async () => {
  const { repairStoredRules, validateCatalogFormula, assessCatalogBenefit, CAPPED_SHARE_NOTE } = await import("@/lib/policies/benefit-catalog");
  const v = (quote: string) => validateCatalogFormula({ kind: "sum_insured", value: 0.1, currency: null, quote, factKey: null, offsetDays: null, maximumDays: null }).formulaKind;
  for (const q of CAPPED) {
    assert.equal(v(q), "none", q);
    assert.equal(repairStoredRules([row(q)] as never)[0].formulaKind, "none", "read from quote: " + q);
    const stored = repairStoredRules([row(q, { formulaKind: "sum_insured", formulaValue: 0.1 })] as never)[0];
    assert.equal(stored.formulaKind, "none", "stored: " + q);
    assert.ok(stored.conditions.includes(CAPPED_SHARE_NOTE), q);
    const claim = assessCatalogBenefit({ benefit: stored as never, coverage: coverage as never, ownerName: "Ana Wong", facts: {} as never, events: ["critical_illness"] as never });
    assert.notEqual(JSON.stringify(claim).includes("S$100,000"), true, q);
  }
  // A share with no amount beside it stands; a person-confirmed share is kept as confirmed.
  for (const q of ["Angioplasty: 10% of the sum insured", "Receive 150% of your coverage amount if Total and Permanent Disability is due to an accident",
    "10% of the sum insured, payable within 30 days of diagnosis", "10% of the sum insured if diagnosed under age 65",
    "10% of the sum insured. We won't pay for a pre-existing condition."]) {
    const value = q.includes("150%") ? 1.5 : 0.1;
    assert.equal(validateCatalogFormula({ kind: "sum_insured", value, currency: null, quote: q, factKey: null, offsetDays: null, maximumDays: null }).formulaKind, "sum_insured", q);
    assert.equal(repairStoredRules([row(q, { formulaKind: "sum_insured", formulaValue: value })] as never)[0].formulaKind, "sum_insured", q);
  }
  const confirmed = repairStoredRules([row(CAPPED[0], { formulaKind: "sum_insured", formulaValue: 0.1, reviewedAt: "2026-10-01" })] as never)[0];
  assert.equal(confirmed.formulaKind, "sum_insured");
});
