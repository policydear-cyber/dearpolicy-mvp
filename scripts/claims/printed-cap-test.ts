/**
 * A stored "cap" cuts an answer's figure only where its own sentence prints it as a cap of that figure. Shapes from read
 * documents: a minimum ("the amount withdrawn is at least S$1,000") stored as a S$1,000 cap cut a S$100,000 death
 * benefit; a count ("a maximum of 6 claims") cut a benefit to S$6; "Up to S$500 per incident" was stored as S$500,000;
 * a plan's "subject to a limit of S$25,000" (for one of its benefits) cut the plan's main payout. Made-up policies, no
 * database, no network, no model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClaimItem } from "@/types";
import type { CoverCondition } from "@/lib/insurance/cover-conditions";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_API_KEY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

const cond = (o: Partial<CoverCondition> & { kind: CoverCondition["kind"]; quote: string }): CoverCondition =>
  ({ id: "c", policyId: "p", productName: null, cause: null, appliesToEvents: [], conditionNames: [], days: null, amount: null, amountBasis: "fixed",
    scope: null, carveOut: null, sourcePage: 1, needsReview: false, ...o }) as CoverCondition;
const item = (title: string, coverLabel: string, amount: number, currency = "SGD"): ClaimItem =>
  ({ title, coverLabel, calculatedAmount: amount, coverAmount: amount, currency, status: "likely_applicable", amountText: String(amount),
    calculationKind: "sum_insured", aggregation: "additive", estimateBasis: "confirmed", payingEvent: "death", contractId: "k", reason: "", conditions: [] }) as unknown as ClaimItem;

test("printedCap: a figure the sentence prints as a cap, in any market's money", async () => {
  const { printedCap } = await import("@/lib/insurance/cover-conditions");
  const cap = (amount: number | null, quote: string, amountBasis: CoverCondition["amountBasis"] = "fixed") => printedCap({ amount, quote, amountBasis });
  assert.equal(cap(25000, "subject to a maximum amount of S$25,000 (or equivalent currency) per life."), 25000);
  assert.equal(cap(1000000, "The most we will pay for TI claims on the same life is S$1.0 million."), 1000000);
  assert.equal(cap(5000, "Simple Fracture Benefit Limit: S$5,000"), 5000);
  assert.equal(cap(20000, "Had kemalangan sehingga RM20,000 bagi setiap tuntutan, up to RM20,000"), 20000);
  assert.equal(cap(2500, "We will not pay more than £2,500 for any one claim."), 2500);
  assert.equal(cap(350000, "we will not pay more than S$350,000 in the aggregate"), 350000);
  assert.equal(cap(0.0075, "the sub-limit of 0.75% of the Aggregate Sum Insured per policy year", "sum_insured_fraction"), 0.0075);
  // Not caps of the stored figure.
  assert.equal(cap(1000, "the amount withdrawn is at least S$1,000"), null, "a minimum");
  assert.equal(cap(6, "Each condition can only be paid once and a maximum of 6 claims is allowed under this benefit;"), null, "a count");
  assert.equal(cap(500000, "Up to S$500 per incident"), null, "a figure the sentence does not print");
  assert.equal(cap(2, "S$5,000 per child (up to 2 children)"), null, "a count of children");
  assert.equal(cap(300000, "Coverage is stated in the policy"), null, "no cap word, no figure");
  assert.equal(cap(2, "up to 200% of the Insured Amount", "sum_insured_fraction"), 2);
  assert.equal(cap(0.5, "up to 20% of the Sum Assured", "sum_insured_fraction"), null);
});

test("a minimum, a count or an unprinted figure never cuts a payout; a plan-wide limit is a caveat", async () => {
  const { applyCoverConditions, describeCondition } = await import("@/lib/insurance/cover-conditions");
  const conditions = [
    cond({ kind: "sub_limit", productName: "Example Lifetime Protector", amount: 1000, quote: "the amount withdrawn is at least S$1,000" }),
    cond({ kind: "aggregate_cap", productName: "Bonus Benefit", amount: 6, quote: "a maximum of 6 claims is allowed under this benefit" }),
    cond({ kind: "sub_limit", productName: "Example Critical Cover", amount: 25000, quote: "subject to a limit of S$25,000" }),
  ];
  const items = [item("Death Benefit", "Example Lifetime Protector", 100000), item("Bonus Benefit", "Example CI Plan", 20000), item("Ada · Critical Illness", "Example Critical Cover", 100000)];
  const result = applyCoverConditions({ items, conditions, facts: {} as never });
  assert.deepEqual(items.map((i) => i.calculatedAmount), [100000, 20000, 100000]);
  assert.ok(result.qualifiers.some((q) => /limits a benefit under Example Critical Cover to S\$25,000/.test(q)), JSON.stringify(result.qualifiers));
  assert.equal(describeCondition(conditions[0]), "Example Lifetime Protector: the amount withdrawn is at least S$1,000");
  assert.equal(describeCondition(conditions[1]), "Bonus Benefit: pays no more than a stated maximum in total");
});

test("a printed cap of the benefit itself still cuts it, and a printed plan total still holds", async () => {
  const { applyCoverConditions } = await import("@/lib/insurance/cover-conditions");
  const icu = [item("Ada · Intensive Care Benefit", "Intensive Care Benefit", 40000)];
  applyCoverConditions({ items: icu, facts: {} as never, conditions: [
    cond({ kind: "sub_limit", productName: "Intensive Care Benefit", amount: 25000, quote: "subject to a maximum amount of S$25,000 per life." })] });
  assert.equal(icu[0].calculatedAmount, 25000);
  const plan = [item("Ada · Special Benefit", "Example CI Plan", 40000), item("Ada · Critical Illness", "Example CI Plan", 300000)];
  applyCoverConditions({ items: plan, facts: {} as never, conditions: [
    cond({ kind: "aggregate_cap", productName: "Example CI Plan", amount: 320000, quote: "The most we will pay under this plan is S$320,000." })] });
  assert.equal((plan[0].calculatedAmount ?? 0) + (plan[1].calculatedAmount ?? 0), 320000);
});
