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
    cond({ kind: "sub_limit", productName: "Example Protector", amount: 500, quote: "Ambulance fees up to S$500 per incident" }),
    cond({ kind: "sub_limit", productName: "Example Shield", amount: 25000, quote: "ICU Benefit: up to S$25,000" })] });
  assert.deepEqual(own.map((i) => i.calculatedAmount), [500000, 500000, 25000]);
  // An unplaced limit for one kind of benefit hides only that kind (TE #188 H2).
  const term = [item("Ada · Death", "Example Term", 300000), item("Ada · Hospital Cash", "Example Term", 200000)];
  applyCoverConditions({ items: term, facts: {} as never, conditions: [cond({ kind: "aggregate_cap", amount: 150000, quote: "The annual limit for hospital benefits is shown in the Schedule." })] });
  assert.deepEqual(term.map((i) => i.calculatedAmount), [300000, undefined]);
  // A minimum stored as a cap is stated beside the amount, not "changes the amount".
  assert.equal(conditionEffect(cond({ kind: "sub_limit", amount: 1000, quote: "subject to a minimum of S$1,000" })), "stated beside the amount");
});

test("a limit clears a benefit only when its sentence names a benefit of another kind; anything else hides the figure", async () => {
  const { applyCoverConditions } = await import("@/lib/insurance/cover-conditions");
  const one = (title: string, amount: number, quote: string, cap: number, productName: string | null = null) => {
    const it = [item("Ada · " + title, "Example Plan", amount)];
    applyCoverConditions({ items: it, facts: {} as never, conditions: [cond({ kind: "sub_limit", productName, amount: cap, quote })] });
    return it[0].calculatedAmount;
  };
  // Synonyms, plurals, acronyms and wider scopes never clear a cap: it cuts or the figure is hidden (Critic R358 H1, TE #188 F1).
  for (const [title, quote] of [
    ["Hospitalisation", "Hospital stay is limited to S$5,000 per policy year"], ["Hospitalisation", "Hospital stays are limited to S$5,000"],
    ["ICU Benefit", "Intensive care is limited to S$5,000"], ["Intensive Care Unit Benefit", "ICU stays: up to S$5,000"],
    ["Daily Hospital Cash", "Hospital income is limited to S$5,000"], ["Medical Expenses", "Medical reimbursement is limited to S$5,000"],
    ["Accidental Medical Reimbursement", "Medical expenses are limited to S$5,000"], ["Outpatient Cancer Treatment", "Cancer drug treatment is limited to S$5,000"],
    ["Hospitalisation", "Room and board is limited to S$5,000 per day"], ["Hospitalisation", "Pre-hospital treatment is limited to S$5,000"],
    ["Hospital cash", "Daily hospital income (including ICU) is limited to S$5,000"], ["Total Permanent Disability", "TPD benefit is limited to S$5,000"],
    ["Critical Illness", "CI claims are capped at S$5,000"], ["Accidental death", "Death due to accident: maximum S$5,000"],
    ["Elaun tunai hospital", "Had maksimum elaun hospital harian RM 5,000"], ["Outpatient cancer treatment", "Outpatient cancer treatments are limited to S$5,000 per year."],
    ["Hospital cash", "Notwithstanding the above, benefits under this section are limited to S$5,000."],
    ["Hospital cash", "Except for the death benefit, all benefits are capped at S$5,000."],
    ["Death", "Except for the death benefit, all benefits are capped at S$5,000."],
    ["Hospital cash", "Limit per claim under Section 2: S$5,000"], ["Example Plan", "Maximum benefit payable under this policy is S$5,000."],
    // A broad medical benefit holds its parts, and an umbrella holds its members (Critic R362 H1, TE #188 r4 F1).
    ["Accidental Medical Reimbursement", "Hospital charges are limited to S$5,000"], ["Medical Expenses", "Hospitalisation is limited to S$5,000"],
    ["Medical Expenses", "Outpatient treatment is limited to S$5,000"], ["Medical Expenses", "Clinic visits are limited to S$5,000"],
    ["Medical Expenses", "Surgery is limited to S$5,000"], ["Medical Expenses", "ICU charges are limited to S$5,000"],
    ["Overseas Medical Expenses", "In-patient treatment is limited to S$5,000"], ["Overseas Medical Expenses", "Ambulance charges are limited to S$5,000"],
    ["Accidental Medical Reimbursement", "Dental treatment is limited to S$5,000"], ["Hospitalisation", "Medical expenses are limited to S$5,000"],
    ["Outpatient", "Medical bills are limited to S$5,000"], ["Hospitalisation", "Maternity complications are limited to S$5,000"],
    ["Hospital cash", "ICU cash benefit is limited to S$5,000"], ["Dental", "Outpatient benefits are limited to S$5,000"],
    ["Ambulance", "Medical expenses are limited to S$5,000 per trip"], ["Surgery", "Overseas medical expenses are limited to S$5,000"],
  ] as [string, string][]) {
    const got = one(title, 8000, quote, 5000);
    assert.ok(got === 5000 || got === undefined, `${title}: ${quote} -> ${got}`);
  }
  // A limit for another kind of benefit leaves this one as it is.
  assert.equal(one("Hospital cash", 8000, "Room and board benefit is limited to S$5,000.", 5000), 8000);
  assert.equal(one("Hospital cash", 8000, "Hospital room and board is limited to S$5,000.", 5000), 8000);
  assert.equal(one("Death", 500000, "Dental treatment is limited to S$500 per year.", 500), 500000);
  assert.equal(one("Death Benefit", 500000, "Funeral expenses benefit is limited to S$5,000", 5000), 500000);
  assert.equal(one("Critical Illness", 500000, "Death benefit is limited to S$5,000", 5000), 500000);
  assert.equal(one("Death", 500000, "TPD benefit is limited to S$5,000", 5000), 500000);
  assert.equal(one("Death", 500000, "Physiotherapy is limited to S$1,000 per year", 1000), 500000);
  assert.equal(one("Total Permanent Disability", 500000, "Psychiatric treatment is limited to S$1,000", 1000), 500000);
  assert.equal(one("Critical Illness", 500000, "TCM treatment is limited to S$1,000", 1000), 500000);
  assert.equal(one("Kematian", 500000, "Manfaat pengebumian terhad kepada RM5,000", 5000), 500000);
  // A cancer drug limit is a medical bill's limit: it may cap an inpatient bill, never a death or CI lump sum (TE #188 W16).
  assert.notEqual(one("Inpatient hospital treatment", 30000, "Cancer drug treatment is limited to S$3,000 per month", 3000), 30000);
  assert.equal(one("Critical Illness", 500000, "Cancer drug treatment is limited to S$3,000 per month", 3000), 500000);
  // Counts are never money caps (TE #188 F3).
  assert.equal(one("Physiotherapy", 1200, "Maximum number of visits per year: 10", 10, "Physiotherapy"), 1200);
  assert.equal(one("Travel medical", 5000, "Maximum period of cover (days): 90", 90, "Travel medical"), 5000);
  assert.notEqual(one("Hospital cash", 3000, "Maximum hospital stay: 30", 30, "Hospital cash"), 30);
});

test("a narrower kind's limit, or a limit for children only, never cuts a wider benefit or an adult's", async () => {
  const { applyCoverConditions } = await import("@/lib/insurance/cover-conditions");
  const one = (title: string, amount: number, quote: string, cap: number, productName: string | null = null) => {
    const it = [item("Ada · " + title, productName ?? "Example Plan", amount)];
    applyCoverConditions({ items: it, facts: {} as never, conditions: [cond({ kind: "sub_limit", productName, amount: cap, quote })] });
    return it[0].calculatedAmount;
  };
  // The benefit's name inside a narrower kind's sentence: the figure is hidden, never cut to the narrower limit.
  for (const [title, quote] of [
    ["Critical Illness", "Early Critical Illness benefit is limited to S$50,000"], ["Critical Illness", "Intermediate stage critical illness: up to S$50,000"],
    ["Death benefit", "Accidental death benefit is limited to S$50,000"], ["Hospitalisation", "Surgery under the Hospitalisation benefit is limited to S$50,000"],
    ["Death benefit", "Death benefit for children under age 5 is limited to S$50,000"], ["Death", "Death of a child below the age of 10: maximum S$50,000"],
    ["Death benefit", "For insured persons aged under 16, the death benefit is limited to S$50,000"], ["Death benefit", "Juvenile death benefit: up to S$50,000"],
    // Ages and people in any wording, before or after the figure (Critic R367 M1, TE #195 F2).
    ["Death benefit", "If death occurs before the insured attains age 16, the death benefit is limited to S$50,000"],
    ["Death benefit", "Death benefit for insured persons aged 70 and above is limited to S$50,000"], ["Death benefit", "Death benefit after age 65: up to S$50,000"],
    ["Death benefit", "Death benefit is limited to S$50,000 for children under 5"], ["Death benefit", "Death benefit for a stillborn baby is limited to S$50,000"],
    ["Death benefit", "Death benefit for insured persons under 18 is limited to S$50,000"], ["Death", "Death below 16 years of age: up to S$50,000"],
    ["Death benefit", "Death benefit before the insured's 17th birthday is limited to S$50,000"], ["Death benefit", "Death benefit caused by an accident is limited to S$50,000"],
    ["Death benefit", "Death benefit for insured persons aged between 1 and 17 is limited to S$50,000"], ["Death benefit", "Death benefit for persons 70 and older is limited to S$50,000"],
    ["Death benefit", "Death benefit for an insured aged five or younger is limited to S$50,000"], ["Death benefit", "Death benefit for teenagers is limited to S$50,000"],
    // Default-safe: any age wording outside a whole-cover frame narrows (TE #195 r3 Y1, Y2, Y8).
    ["Death benefit", "Death benefit for an insured aged 6 months to 5 years is limited to S$50,000"], ["Death benefit", "Death benefit between ages 1 and 17 is limited to S$50,000"],
    ["Death benefit", "Death benefit for an insured younger than 18 is limited to S$50,000"],
    // Only a frame tied to the cover's own end, at an adult age, is whole-cover; bare until/before/from frames narrow (Critic R373 M1, TE #195 r4 J1/J2).
    ["Total and permanent disability", "TPD benefit is limited to S$50,000 before age 65."], ["Death benefit", "Death benefit is limited to S$50,000; cover starts from age 1."],
    ["Death benefit", "Until the insured attains age 16, the death benefit is limited to S$50,000"], ["Death benefit", "Till the life assured reaches age 17, death benefit is limited to S$50,000"],
    ["Death benefit", "Death benefit for insured persons up to age 16 is limited to S$50,000"], ["Death benefit", "Death benefit is limited to S$50,000 to age 16, then S$500,000"],
    ["Death benefit", "The death benefit is limited to S$50,000 if death occurs before age 16"], ["Death benefit", "Reduced death benefit starts from age 70: limited to S$50,000"],
    ["Death benefit", "Death benefit before age 5 is limited to S$50,000."], ["Death benefit", "Death benefit is limited to S$50,000 up to age 5 and S$500,000 thereafter."],
    ["Death benefit", "Death benefit until the insured turns 6 is limited to S$50,000."], ["Death benefit", "Death benefit for insured persons aged 18 to 25 is limited to S$50,000."],
    ["Death benefit", "The death benefit is limited to £50,000 until the 4th birthday."],
    // An end frame whose subject may be the limit, not the cover, narrows (TE #195 r5 K1).
    ["Death benefit", "The death benefit is limited to S$50,000 and this limit ends at age 18."], ["Death benefit", "Death benefit is limited to S$50,000, payable up to age 99."],
    ["Death benefit", "Death benefit is limited to S$50,000, payable until the insured attains age 85."], ["Death benefit", "Death benefit: the reduced amount ends at age 21 and is limited to S$50,000."],
    ["Total and permanent disability", "TPD benefit is limited to S$50,000 and ends when the insured reaches age 70."],
    // An elderly band, or a cover-end frame in a sequence or condition, narrows (Critic R375 M1/M2).
    ["Accidental death", "Accidental death benefit is limited to S$50,000 for insured persons aged 18 to 70."],
    ["Death benefit", "Death benefit for insured persons aged 65 to 99 is limited to S$50,000"], ["Death benefit", "Death benefit for lives assured aged 70 to 100 is limited to S$50,000"],
    ["Death benefit", "Death benefit is limited to S$50,000 for those aged 66-99"], ["Death benefit", "Entry age 60 to 70: death benefit is limited to S$50,000"],
    ["Death benefit", "Death benefit is payable up to age 65 in full; thereafter it is limited to S$50,000"],
    ["Death benefit", "Death benefit continues to age 70 and is then limited to S$50,000"],
    ["Death benefit", "If the policy continues until the insured turns 70, the death benefit is limited to S$50,000"],
    ["Death benefit", "Death benefit for insured persons aged 18 to 60 is limited to S$50,000"],
    ["Death benefit", "The policy continues to age 70; thereafter the death benefit is limited to S$50,000"],
    ["Death benefit", "Cover is renewable to age 85, after which the death benefit is limited to S$50,000"],
    ["Death benefit", "Where the policy runs to age 80, the death benefit is limited to S$50,000"],
    // A cover-end frame before the limit's figure may open the span the limit applies in (Critic R378 M1).
    ["Death benefit", "The policy continues to age 70. Subsequently the death benefit is limited to S$50,000"],
    ["Death benefit", "Cover runs to age 85, with the death benefit limited to S$50,000 later on"],
    ["Death benefit", "The policy continues to age 70. From that point the death benefit is limited to S$50,000"],
    // Anchored to the limit's own amount, joined by a stop, comma or "and" only (Critic R380 M1/L1).
    ["Death benefit", "The sum assured is S$900,000 and the policy continues to age 70. Subsequently the death benefit is limited to S$50,000"],
    ["Death benefit", "Minimum premium S$100 applies; cover runs to age 85, with the death benefit limited to S$50,000 later on"],
    ["Death benefit", "(The policy continues to age 70.) Subsequently the death benefit is limited to S$50,000"],
    ["Death benefit", "Death benefit (cover runs to age 85; reduced in later years) is limited to S$50,000"],
    ["Death benefit", "Death benefit is limited to S$50,000 in the final years, as the policy continues to age 85"],
    // Any noun before a comparator and an age (Critic R381 M1).
    ["Death benefit", "Death benefit for lives over 70 is limited to S$50,000"], ["Death benefit", "Death benefit for policyholders over 70 is limited to S$50,000"],
    ["Death benefit", "Death benefit for anyone over 70 is limited to S$50,000"], ["Death benefit", "Death benefit is limited to S$50,000 for customers above 70"],
    ["Death benefit", "Death benefit is limited to S$50,000, the policy is renewable to age 85 for lives over 70"],
    // A limit on one part of a benefit that pays for several (Critic R367 M2).
    ["Death or TPD", "TPD benefit is limited to S$50,000"], ["Hospitalisation and Surgery", "Surgery is limited to S$50,000"],
    ["Accidental Death and Disablement", "Accidental death is limited to S$50,000"],
  ] as [string, string][]) {
    assert.equal(one(title, 500000, quote, 50000), undefined, `${title}: ${quote}`);
    assert.equal(one(title, 500000, quote, 50000, title), undefined, `${title} (stored under it): ${quote}`);
  }
  // The narrower benefit itself, or one named for children, is still cut by its own limit.
  assert.equal(one("Early Critical Illness", 100000, "Early Critical Illness benefit is limited to S$50,000", 50000), 50000);
  assert.equal(one("Accidental death benefit", 100000, "Accidental death benefit is limited to S$50,000", 50000), 50000);
  assert.equal(one("Child death benefit", 100000, "Death benefit for children under age 5 is limited to S$50,000", 50000), 50000);
  assert.equal(one("Critical Illness", 500000, "Critical illness benefit is limited to S$300,000", 300000), 300000);
  // A kind named after the subject is a cause or a part, not a narrower limit (TE #195 F1).
  assert.equal(one("Death benefit", 3000000, "Death benefit, whether by illness or accidental death, is limited to S$2,000,000", 2000000), 2000000);
  assert.equal(one("Hospitalisation", 80000, "Hospitalisation benefit including surgery is limited to S$50,000", 50000), 50000);
  assert.equal(one("Hospital cash", 300, "Hospital cash is payable for each day in hospital up to S$200 per day", 200, "Hospital cash"), 200);
  assert.equal(one("Death benefit", 3000000, "Death benefit, which includes the funeral expenses benefit, is limited to £2,000,000", 2000000), 2000000);
  // An age or a plan name that ends or names the cover for everyone narrows nothing: the limit still cuts (TE #195 G1).
  for (const [title, quote] of [
    ["Critical illness", "Critical illness benefit is limited to S$50,000 and cover ends at age 85."],
    ["Death benefit", "Death benefit is limited to S$50,000, paid over 10 years."], ["Death benefit", "Death benefit is limited to S$50,000 for policies in force under 2 years."],
    ["Death benefit", "Death benefit is limited to S$50,000; the policy expires on the 85th birthday."], ["Death benefit", "Death benefit is limited to S$50,000 (the policy expires on the 85th birthday)."], ["Hospitalisation", "Hospitalisation benefit is limited to S$50,000 for hospital stays over 30 days."],
    ["Hospitalisation", "Hospitalisation benefit is limited to S$50,000 for bills over 1000."], ["Hospitalisation", "Hospitalisation benefit is limited to S$50,000 above 3 operations a year."], 
    ["Death benefit", "Death benefit under the Senior Protect plan is limited to S$50,000."],
    ["Death benefit", "Death benefit is limited to S$50,000; cover ends when the insured reaches age 70."],
    ["Death benefit", "Death benefit is limited to S$50,000; cover ends when the insured turns 75."],
    ["Death benefit", "Death benefit is limited to S$50,000; the policy is renewable up to age 99."], ["Death benefit", "Death benefit is limited to S$50,000. The plan matures at age 70."],
    ["Death benefit", "Entry age 18 to 65. Death benefit is limited to S$50,000."],
  ] as [string, string][])
    assert.equal(one(title, 500000, quote, 50000), 50000, `${title}: ${quote}`);
  // A child or minor-surgery limit of another kind still leaves a life benefit as it is.
  assert.equal(one("Death", 500000, "Minor surgery is limited to S$500", 500), 500000);
  assert.equal(one("Death", 500000, "Hospital cash for children is limited to S$100 a day", 100), 500000);
});

test("an unplaced plan total hides every benefit it may cover", async () => {
  const { applyCoverConditions } = await import("@/lib/insurance/cover-conditions");
  const run = (quote: string) => {
    const it = [item("Ada · Room and board", "Example Shield", 100000), item("Ada · Surgical fees", "Example Shield", 100000), item("Ada · Death", "Example Shield", 300000)];
    applyCoverConditions({ items: it, facts: {} as never, conditions: [cond({ kind: "aggregate_cap", amount: 150000, quote })] });
    return it.map((i) => i.calculatedAmount);
  };
  // TE #188 F4: a hospital limit hides the hospital rows and leaves the death benefit; one for all benefits, or one that
  // names no kind, hides all of them.
  assert.deepEqual(run("The overall annual limit for inpatient benefits is shown in the Schedule"), [undefined, undefined, 300000]);
  assert.deepEqual(run("The limit described in Section 3 applies to all benefits"), [undefined, undefined, undefined]);
  assert.deepEqual(run("An annual limit applies, as shown in the Schedule"), [undefined, undefined, undefined]);
});
