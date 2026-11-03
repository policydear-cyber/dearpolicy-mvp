/**
 * A figure a contract prints twice, in words and then in brackets ("one hundred percent (100%) of the Sum Assured",
 * "one (1) lump sum", "Twenty-Five Thousand Singapore Dollars (SGD 25,000)"), is read once, so the share it states keeps
 * its figure. Only when the words spell exactly the bracketed figure, both sides are a share or neither is, and a named
 * currency is the bracket's own. Made-up policies from several markets; no database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const base = { policyId: "policy-1", productName: "Made-up Cover", traits: [], formulaKind: "none", formulaValue: null, currency: null, factKey: null,
  offsetDays: null, maximumDays: null, conditions: [] as string[], requirements: [], needsReview: false, basisInferred: false, sourcePage: 22, tier: null, reviewedAt: null };
const coverage = (amount: number, currency: string) => ({ id: "cov-1", policyId: "policy-1", familyMemberId: "fam-1", category: "Critical Illness", amount, currency,
  productName: "Made-up Cover", sourcePage: 1, evidenceText: "Made-up Cover, sum assured", insurer: "Kestrel Assurance", policyName: "Made-up Cover",
  policyNumber: "C-001", groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true, policyDocumentVersion: "sha256:v1" });

test("words then the same figure in brackets are one figure", async () => {
  const { figureOnce } = await import("@/lib/policies/benefit-catalog");
  assert.equal(figureOnce("We will pay one hundred percent (100%) of the Sum Assured in one (1) lump sum."), "We will pay 100% of the Sum Assured in one lump sum.");
  assert.equal(figureOnce("one hundred and fifty per cent (150%)"), "150%");
  assert.equal(figureOnce("the Sum Assured and one (1) lump sum"), "the Sum Assured and one lump sum", "a joining \"and\" is not part of the number");
  assert.equal(figureOnce("Twenty-Five Thousand Singapore Dollars (SGD 25,000)"), "SGD 25,000");
  assert.equal(figureOnce("Ten Thousand Ringgit Malaysia (RM10,000)"), "RM 10,000");
  assert.equal(figureOnce("Twenty Thousand Pounds (£20,000)"), "£ 20,000");
  assert.equal(figureOnce("One Million and Fifty Thousand Singapore Dollars (S$1,050,000)"), "S$ 1,050,000");
  // Anything that does not match exactly is left as printed.
  for (const q of ["twenty percent (25%)", "fifty percent (50)", "fifty (50%)", "Twenty-Five Thousand Singapore Dollars (RM 25,000)", "Twenty-Five Thousand Dollars (SGD 25,000)",
    "Twenty-Five Thousand Singapore Dollars (SGD 25,000.50)", "one (2) lump sum", "Twenty-Five Thousand (SGD 25,000)"]) assert.equal(figureOnce(q), q, q);
});

test("a share written in words and figures keeps its figure, on stored and freshly read rows", async () => {
  const { shareBound, validateCatalogFormula, repairStoredRules, assessCatalogBenefit } = await import("@/lib/policies/benefit-catalog");
  const pay = (benefitName: string, quote: string, share: number, amount: number, currency: string) => {
    const [b] = repairStoredRules([{ ...base, id: "x", benefitName, quote, formulaKind: "sum_insured", formulaValue: share }] as never);
    return (assessCatalogBenefit({ benefit: b as never, coverage: coverage(amount, currency) as never, ownerName: "Ana", facts: {} as never, events: ["critical_illness"] as never }) as { item?: { calculatedAmount?: number } }).item?.calculatedAmount ?? null;
  };
  const ci = "if the Life Assured is diagnosed with any one (1) of the Early, Intermediate or Severe Stage Critical Illnesses listed in Clause 4, We will pay one hundred percent (100%) of the Sum Assured of this Basic Benefit in one (1) lump sum.";
  assert.equal(validateCatalogFormula({ kind: "sum_insured", value: 1, currency: "SGD", quote: ci, factKey: null, offsetDays: null, maximumDays: null, benefitName: "Critical Illness Benefit" }).formulaKind, "sum_insured");
  assert.equal(pay("Critical Illness Benefit", ci, 1, 300_000, "SGD"), 300_000);
  const tumour = "We will pay an additional twenty percent (20%) of the Sum Assured of this Basic Benefit, subject to a maximum amount of Twenty-Five Thousand Singapore Dollars (SGD 25,000)";
  assert.deepEqual(shareBound(tumour, "Benign and Borderline Malignant Tumour Benefit"), { kind: "cap", amount: 25_000, currency: "SGD" });
  assert.equal(pay("Benign and Borderline Malignant Tumour Benefit", tumour, 0.2, 300_000, "SGD"), 25_000);
  assert.equal(pay("Benign and Borderline Malignant Tumour Benefit", tumour, 0.2, 100_000, "SGD"), 20_000);
  // A row stored with no rule is read from its own sentence (ruleFromQuote), with the same checks.
  const unread = (benefitName: string, quote: string) => (repairStoredRules([{ ...base, id: "y", benefitName, quote }] as never)[0] as { formulaKind: string; formulaValue: number | null });
  assert.deepEqual([unread("Critical Illness Benefit", ci).formulaKind, unread("Critical Illness Benefit", ci).formulaValue], ["sum_insured", 1]);
  assert.deepEqual([unread("Benign and Borderline Malignant Tumour Benefit", tumour).formulaKind, unread("Benign and Borderline Malignant Tumour Benefit", tumour).formulaValue], ["sum_insured", 0.2]);
  assert.equal(unread("Death Benefit", "If the Life Assured dies while the Policy is in force, We will pay the Death Benefit in one (1) lump sum, less any amounts owing to Us.").formulaKind, "none");
  // Other markets.
  assert.equal(pay("Angioplasty Benefit", "We pay ten percent (10%) of the Sum Insured, up to a maximum of Ten Thousand Ringgit Malaysia (RM10,000).", 0.1, 500_000, "MYR"), 10_000);
  assert.equal(pay("Accidental Death Rider", "We will pay one hundred and fifty per cent (150%) of the Sum Assured of this rider in one (1) lump sum.", 1.5, 200_000, "GBP"), 300_000);
  assert.equal(pay("Early Critical Illness Rider", "We will pay fifty percent (50%) of the Sum Assured of this Supplementary Benefit.", 0.5, 200_000, "SGD"), 100_000);
  assert.equal(pay("Critical Illness Benefit", "We will pay fifty percent (50%) of the Sum Assured of this Plan.", 0.5, 200_000, "SGD"), 100_000);
  // Withheld: a mismatch, a cap in another currency, another cover's sum, a changer, a second figure.
  for (const [name, quote] of [
    ["Critical Illness Benefit", "We will pay twenty percent (25%) of the Sum Assured."],
    ["Critical Illness Benefit", "We will pay one hundred percent (100%) of the Sum Assured of the Basic Benefit."],
    ["Critical Illness Benefit", "We will pay one hundred percent (100%) of the Sum Assured, less any amounts owing to Us."],
    ["Critical Illness Benefit", "We will pay fifty percent (50%) of the Sum Assured for one (1) child."],
    ["Benign Tumour Benefit", "We will pay twenty percent (20%) of the Sum Assured, subject to a maximum amount of Twenty-Five Thousand Singapore Dollars (RM 25,000)"],
    ["Critical Illness Benefit", "We will pay one hundred percent (100%) of the Sum Assured in two (2) instalments."],
    ["Critical Illness Benefit", "We will pay one hundred percent (100%) of the Sum Assured, and a further ten percent (10%) after one (1) year."],
    // On a rider, "this Plan" may be the basic plan, whose sum is another (TE pr300 P1).
    ["Early Critical Illness Rider", "We will pay fifty percent (50%) of the Sum Assured of this Plan."],
    ["Early Critical Illness Rider", "We will pay fifty percent (50%) of the Sum Assured of this Basic Benefit."],
    ["Early Critical Illness Rider", "We will pay fifty percent (50%) of the Sum Assured of this Policy."],
  ] as const) assert.equal(validateCatalogFormula({ kind: "sum_insured", value: Number(quote.match(/\((\d+)%\)/)![1]) / 100, currency: "SGD", quote, factKey: null, offsetDays: null, maximumDays: null, benefitName: name }).formulaKind, "none", quote);
});
