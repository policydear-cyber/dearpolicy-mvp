/**
 * A model-read row with no rule is stored only when its passage prints an amount, or when the page names the benefit as
 * a heading of its own (then it is said to print no amount, never "tell DearPolicy what this pays"). A feature line, a
 * price or a clause is never a benefit row (MINDEF re-read, 4 Nov). Made-up English booklets. No database, no model.
 */
import assert from "node:assert/strict";
import { modelRowWithoutRule, printsAmount, statesAPrice } from "../../lib/policies/model-row-shape";
import { describeBenefitFormula } from "../../lib/policies/benefit-catalog";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failed++; console.log("not ok - " + name + "\n  " + (error instanceof Error ? error.message : String(error))); }
}

const summary = [
  "Harbourline Group Term Cover",
  "Key Features",
  "•\tBe insured up to a maximum coverage of S$500,000 at S$0.95 per day",
  "•\tReceive daily hospital cash benefit",
  "•\tReimbursement of ambulance cost",
  "•\tPay the same premium rate up to age 65",
].join("\n");
const wording = [
  "Income Cover (continued)",
  "•\tPremium Waiver",
  "We will waive premiums falling due while a benefit is payable under this policy.",
  "2.\tCompassionate Allowance:",
  "A compassionate allowance is payable on the death of the Insured Person.",
  "Linked Claims",
  "In the three (3) months after payments end, payments may resume without a new deferred period.",
  "The Insured Person must survive for 14 days before a claim can be admitted.",
].join("\n");
const table = ["Outpatient Care", "Benefits Limits Per Visit\t(S$)", "Clinic Visit\t40", "Specialist Visit\tAs charged"].join("\n");

const CASES: [string, string, string, "keep" | "named" | "drop"][] = [
  // descriptive feature lines and prices on a summary page
  ["Daily Hospital Cash Benefit", "Receive daily hospital cash benefit", summary, "drop"],
  ["Ambulance Cost Reimbursement", "Reimbursement of ambulance cost", summary, "drop"],
  ["Term Life Cover", "Be insured up to a maximum coverage of S$500,000 at S$0.95 per day", summary, "drop"],
  ["Monthly Premium", "Pay a monthly premium of S$12.50 for this cover", summary, "drop"],
  // a clause about a claim, not a benefit
  ["Survival Period", "The Insured Person must survive for 14 days before a claim can be admitted.", wording, "drop"],
  ["Linked Claims", "In the three (3) months after payments end, payments may resume without a new deferred period.", wording, "named"],
  // a named cover with no printed amount: kept, said to print no amount
  ["Premium Waiver", "We will waive premiums falling due while a benefit is payable under this policy.", wording, "named"],
  ["Compassionate Allowance", "A compassionate allowance is payable on the death of the Insured Person.", wording, "named"],
  // a passage that prints an amount the reader could not turn into a rule: as today
  ["Hospital Cash", "Hospital cash at S$100 per day from the fourth day", summary, "keep"],
  ["Escalation", "The benefit increases by 3% each year", wording, "keep"],
  ["Clinic Visit", "Clinic Visit 40", table, "keep"],
  ["Specialist Visit", "Specialist Visit As charged", table, "keep"],
  ["Income Benefit", "One twelfth of the Sum Insured is paid each month", wording, "keep"],
  ["Large Claims", "If the sum payable is above S$150,000, we pay S$150,000 first and the balance in instalments", wording, "keep"],
];
for (const [name, quote, page, want] of CASES)
  check(`${name}: ${want}`, () => assert.equal(modelRowWithoutRule(name, quote, page), want));

check("a count is not an amount", () => {
  for (const q of ["must survive for 30 days", "within six (6) months", "up to age 65", "after 90 days"]) assert.equal(printsAmount(q), false, q);
});
check("amounts in any printed form count", () => {
  for (const q of ["up to RM 5,000", "50% of the Sum Insured", "€200 per night", "one third of the benefit", "1/30 of the benefit", "As charged", "Clinic 40"])
    assert.equal(printsAmount(q), true, q);
});
check("waiving or refunding a premium is not a price", () => {
  assert.equal(statesAPrice("We waive the premium of S$20 a month while you are disabled"), false);
  assert.equal(statesAPrice("Cover of S$200,000 at only S$0.40 a day"), true);
});
check("a named cover with no amount is shown as named, never as asking what it pays", () => {
  const pays = describeBenefitFormula({ formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null,
    quote: "We will waive premiums falling due while a benefit is payable under this policy.", benefitName: "Premium Waiver" });
  assert.equal(pays, "Named in the policy, with no amount printed for it");
});
check("a row whose passage prints an amount it could not read still asks", () => {
  const pays = describeBenefitFormula({ formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null,
    quote: "S$5,000 per child (up to 2 children)", benefitName: "Child Education Fund" });
  assert.match(pays, /tell DearPolicy what this pays/);
});
console.log(`model row shape: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
