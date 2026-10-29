/**
 * A stored "cap" cuts an answer's figure only where its own sentence prints it as a cap of that figure. Shapes from read
 * documents: a minimum ("the amount withdrawn is at least S$1,000") stored as a S$1,000 cap cut a S$100,000 death
 * benefit; a count ("a maximum of 6 claims") cut a benefit to S$6; "Up to S$500 per incident" was stored as S$500,000;
 * a plan's "subject to a limit of S$25,000" (for one of its benefits) cut the plan's main payout. A limit that cannot be
 * placed never leaves the full figure showing either: the figure above it is not shown (Critic R349, TE #188). Made-up policies, no
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

test("a minimum or a count never cuts a payout; a plan-wide limit hides the figure above it", async () => {
  const { applyCoverConditions, describeCondition } = await import("@/lib/insurance/cover-conditions");
  const conditions = [
    cond({ kind: "sub_limit", productName: "Example Lifetime Protector", amount: 1000, quote: "the amount withdrawn is at least S$1,000" }),
    cond({ kind: "aggregate_cap", productName: "Bonus Benefit", amount: 6, quote: "a maximum of 6 claims is allowed under this benefit" }),
    cond({ kind: "sub_limit", productName: "Example Critical Cover", amount: 25000, quote: "subject to a limit of S$25,000" }),
  ];
  const items = [item("Death Benefit", "Example Lifetime Protector", 100000), item("Bonus Benefit", "Example CI Plan", 20000), item("Ada · Critical Illness", "Example Critical Cover", 100000)];
  const result = applyCoverConditions({ items, conditions, facts: {} as never });
  assert.deepEqual(items.map((i) => i.calculatedAmount), [100000, 20000, undefined]);
  assert.equal(items[2].amountText, null, "a limit the sentence does not tie to this benefit hides its figure, never shows S$100,000");
  assert.ok(result.qualifiers.some((q) => /limit of S\$25,000 under Example Critical Cover that may apply/.test(q)), JSON.stringify(result.qualifiers));
  assert.equal(describeCondition(conditions[0]), "Example Lifetime Protector: the amount withdrawn is at least S$1,000");
  assert.equal(describeCondition(conditions[1]), "Bonus Benefit: a maximum of 6 claims is allowed under this benefit");
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

test("caps in every market's wording, and the words that make a figure something else", async () => {
  const { capReading } = await import("@/lib/insurance/cover-conditions");
  const read = (amount: number, quote: string, amountBasis: CoverCondition["amountBasis"] = "fixed") => capReading({ amount, quote, amountBasis }).kind;
  for (const [amount, quote, basis] of [
    [50000, "Maximum per policy year 50,000"], [5000, "Benefit limit: 5,000 per disability"], [5000, "Pays the actual cost or S$5,000, whichever is lower"],
    [5000, "The lower of S$5,000 or the actual expenses"], [5000, "Restricted to S$5,000"], [10000, "Had maksimum RM10,000"],
    [20000, "tidak melebihi RM 20,000"], [10000, "最高赔偿 S$10,000"], [100000, "Up to ¥100,000 per year"], [50000, "Up to ₹50,000"],
    [2500, "We won't pay more than £2,500"], [2500, "Claims cannot exceed £2,500"], [50000, "Had keseluruhan pelan RM50,000"],
    [0.5, "up to fifty percent of the Sum Assured", "sum_insured_fraction"], [0.5, "limited to half of the Sum Assured", "sum_insured_fraction"],
    [0.2, "maksimum 20% daripada Jumlah Diinsuranskan", "sum_insured_fraction"],
    // The cap phrase nearest the figure decides, whatever came earlier in the sentence (Critic R353).
    [5000, "50% of the sum insured or S$5,000, whichever is lower"], [150000, "after the deductible and co-insurance, up to S$150,000 per policy year"],
    [100000, "minimum S$1,000, maximum S$100,000"], [50000, "Maximum sum insured for this benefit is S$50,000"],
    [500000, "Maximum Sum Assured for Accidental Death: S$500,000"], [5000, "maximum over a policy year S$5,000"],
    [5000, "After the excess, we pay up to S$5,000"], [3000, "Premium waiver benefit up to S$3,000"],
    // Other cap wordings (TE #188 M1).
    [2500, "The most we'll pay is £2,500"], [2500, "Limit of cover £2,500"], [3000, "the maximum payable is €3,000"],
    [50000, "Had keseluruhan pelan ini ialah RM50,000"], [25000, "Sub-limit for outpatient cancer treatment: S$25,000"],
  ] as [number, string, CoverCondition["amountBasis"]?][]) assert.equal(read(amount, quote, basis), "cap", quote);
  for (const [amount, quote] of [
    [1000, "subject to a minimum withdrawal amount of S$1,000"], [1000, "minimum S$1,000, maximum S$100,000"], [1000, "Claims exceeding S$1,000 require receipts"],
    [2000, "For bills exceeding S$2,000 we pay 80%"], [100, "subject to an excess of £100"], [50000, "Sum Assured S$50,000, subject to the terms"],
    [200, "Co-payment of S$200 up to the limit"], [3000, "premium S$3,000 up to age 65"], [1000, "a minimum claim of S$1,000; benefits up to S$50,000"],
    [1000, "at least S$1,000 and at most S$5,000"],
    // Thresholds and ages (TE #188 H3).
    [1000, "if the bill is more than S$1,000"], [1000, "must be more than £1,000"], [5000, "unless the loss is more than S$5,000"],
    [1000, "Claims under S$1,000 are not paid"], [65, "up to age 65"], [70, "maximum entry age of 70"], [500, "for bills below S$500"],
  ] as [number, string][]) assert.equal(read(amount, quote), "not_cap", quote);
  // A day rate times a day count is not printed as the stored total.
  assert.equal(read(15000, "S$500 per day, up to 30 days"), "unsure");
});

test("an unsure cap or an unsure plan total hides the figures above it", async () => {
  const { applyCoverConditions, conditionEffect } = await import("@/lib/insurance/cover-conditions");
  // Named in its own sentence, under no cover: it cuts. Stored with no quote: the figure above it is hidden.
  const cash = [item("Ada · Hospital Cash", "Example Shield", 20000), item("Ada · Hospital Cash", "Example Shield", 20000)];
  applyCoverConditions({ items: [cash[0]], facts: {} as never, conditions: [cond({ kind: "sub_limit", amount: 5000, quote: "Hospital Cash is limited to S$5,000 per policy year." })] });
  assert.equal(cash[0].calculatedAmount, 5000);
  applyCoverConditions({ items: [cash[1]], facts: {} as never, conditions: [cond({ kind: "sub_limit", amount: 5000, quote: "" })] });
  assert.equal(cash[1].calculatedAmount, undefined);
  // "Death" is not "Death Benefit Plus", and the item's plan name is not the benefit.
  const death = [item("Ada · Example Protector — Death", "", 100000)];
  applyCoverConditions({ items: death, facts: {} as never, conditions: [cond({ kind: "sub_limit", productName: "Death Benefit Plus", amount: 25000, quote: "Double Cover: subject to a limit of S$25,000" })] });
  assert.equal(death[0].calculatedAmount, undefined);
  // A plan total as a share of the sum insured is that share of the one sum insured, never S$0.50.
  const plan = [item("Ada · Special Benefit", "Example CI Plan", 100000), item("Ada · Critical Illness", "Example CI Plan", 100000)];
  applyCoverConditions({ items: plan, facts: {} as never, conditions: [
    cond({ kind: "aggregate_cap", productName: "Example CI Plan", amount: 1.5, amountBasis: "sum_insured_fraction", quote: "up to 150% of the Sum Assured in total" })] });
  assert.equal((plan[0].calculatedAmount ?? 0) + (plan[1].calculatedAmount ?? 0), 150000);
  // A limit whose sentence names another benefit is no limit on this one; one that names a cover's part, or nothing,
  // hides the figure; an acronym names the benefit (TE #188 H1, M2).
  const own = [item("Ada · Death Benefit", "Example Protector", 500000), item("Ada · TPD", "Example Protector", 500000), item("Ada · Intensive Care Unit (ICU) Benefit", "Example Shield", 100000)];
  applyCoverConditions({ items: own, facts: {} as never, conditions: [
    cond({ kind: "sub_limit", productName: "Example Protector", amount: 5000, quote: "Funeral expenses benefit is limited to S$5,000" }),
    cond({ kind: "sub_limit", amount: 500, quote: "Ambulance fees up to S$500 per incident" }),
    cond({ kind: "sub_limit", productName: "Example Shield", amount: 25000, quote: "ICU Benefit: up to S$25,000" })] });
  assert.deepEqual(own.map((i) => i.calculatedAmount), [500000, 500000, 25000]);
  // An unplaced limit for one kind of benefit hides only that kind (TE #188 H2).
  const term = [item("Ada · Death", "Example Term", 300000), item("Ada · Hospital Cash", "Example Term", 200000)];
  applyCoverConditions({ items: term, facts: {} as never, conditions: [cond({ kind: "aggregate_cap", amount: 150000, quote: "The annual limit for hospital benefits is shown in the Schedule." })] });
  assert.deepEqual(term.map((i) => i.calculatedAmount), [300000, undefined]);
  // A minimum stored as a cap is stated beside the amount, not "changes the amount".
  assert.equal(conditionEffect(cond({ kind: "sub_limit", amount: 1000, quote: "subject to a minimum of S$1,000" })), "stated beside the amount");
});
