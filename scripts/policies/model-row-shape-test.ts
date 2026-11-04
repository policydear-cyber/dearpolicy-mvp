/**
 * A model-read row with no rule is dropped only on positive evidence that it is not a benefit: a price, a claim clause or a
 * marketing feature line (MINDEF re-read, 4 Nov). Everything else is kept (Critic #348 H1: for a lost cover, keep is the
 * safe side). A kept row whose passage prints no amount is said to print none beside it, never "tell DearPolicy what this
 * pays". Made-up English booklets. No database, no model.
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
  ["Daily Hospital Cash", "Receive daily hospital cash benefit", summary, "drop"],
  // A benefit named "... Benefit" is never a feature line, whatever its passage says: kept (Critic #348 H1b).
  ["Daily Hospital Cash Benefit", "Receive daily hospital cash benefit", summary, "named"],
  ["Ambulance Cost Reimbursement", "Reimbursement of ambulance cost", summary, "named"],
  ["Term Life Cover", "Be insured up to a maximum coverage of S$500,000 at S$0.95 per day", summary, "drop"],
  ["Monthly Premium", "Pay a monthly premium of S$12.50 for this cover", summary, "drop"],
  // a clause about a claim, not a benefit
  ["Survival Period", "The Insured Person must survive for 14 days before a claim can be admitted.", wording, "drop"],
  ["Linked Claims", "In the three (3) months after payments end, payments may resume without a new deferred period.", wording, "named"],
  ["Not covered", "No benefit is payable for a disability caused by war.", wording, "drop"],
  ["Rider premium", "The rider premium is S$4.20 a month", summary, "drop"],
  ["Annual premium", "Annual premium S$420", summary, "drop"],
  ["Low price", "Cover of S$200,000 at only S$0.40 a day", summary, "drop"],
  ["Plan Choice", "Choose cover from S$50,000 to S$500,000", summary, "drop"],
  ["Illness List", "• Enjoy cover for 37 critical illnesses", summary, "drop"],
  // Critic #348 H1: real covers with no figure are kept, whatever their shape on the page.
  ["Premium Waiver Benefit", "This policy includes a Premium Waiver Benefit on diagnosis of a critical illness.", "Your Plan", "named"],
  ["Premium Waiver", "• Premium Waiver on critical illness", "Riders", "named"],
  ["Payor Benefit", "2. Payor Benefit (Rider)", "Riders", "named"],
  ["Premium Waiver", "Premium Waiver Included", table, "named"],
  ["Emergency Evacuation", "Emergency Evacuation Covered", table, "named"],
  ["Repatriation", "Repatriation ✓", table, "named"],
  ["Emergency Medical Evacuation", "Emergency Medical Evacuation Unlimited", table, "named"],
  ["Ward Charges", "Ward Charges Full cover", table, "named"],
  ["Total and Permanent Disability", "TOTAL AND PERMANENT DISABILITY", "SECTION 3", "named"],
  ["Accidental Death Benefit", "We pay the amount shown in the schedule on page 5.", "Benefits", "named"],
  ["Hospital Income", "Hospital Income up to S$36,500 at S$100 per day", summary, "keep"],
  ["Maternity", "Maternity cover after a 10-month waiting period", wording, "named"],
  // Critic #348 H1b: "cost", "get", a premium the insurer pays and a note with a figure are all benefits.
  ["Ambulance Cost Reimbursement", "Ambulance Cost Reimbursement: actual cost up to S$500 per trip, S$1,000 by air", summary, "keep"],
  ["Funeral Costs", "Funeral costs up to S$5,000", summary, "keep"],
  ["Repatriation", "Repatriation of mortal remains: reasonable costs up to S$50,000", summary, "keep"],
  ["Medical Expenses", "Medical expenses, including the cost of treatment, up to S$5,000 per accident", summary, "keep"],
  ["Replacement Passport", "Costs of a replacement passport S$200", summary, "keep"],
  ["Get Well Benefit", "Get Well Benefit S$500 on discharge", summary, "keep"],
  ["Get Well Benefit", "Get Well Benefit", summary, "named"],
  ["Death Benefit", "Death Benefit S$100,000; the benefit is not payable if death is by suicide within one year", wording, "keep"],
  ["Critical Illness Benefit", "Critical Illness Benefit S$200,000 lump sum; a specialist must confirm the diagnosis before a claim is made", wording, "keep"],
  ["Premium Waiver", "Premium Waiver: future premiums of S$1,200 a year are paid for you", wording, "keep"],
  ["Payor Benefit", "Payor Benefit: we pay the premiums of S$800 a year if the payor dies", wording, "keep"],
  ["Payor Benefit", "On the payor's death we will pay the premiums of S$800 a year", wording, "keep"],
  // Critic #348 M1 and TE #348: a hospital cash benefit prints a cover-and-rate shape, "paid by us" is a benefit verb, and a
  // negated survival requirement is a benefit's wording.
  ["Hospital Cash Cover", "Hospital Cash Cover: up to S$36,500 at S$100 per day", summary, "keep"],
  ["Daily Hospital Income", "Covered up to S$18,250 at S$50 per day of hospitalisation", summary, "keep"],
  ["Hospital Income", "Hospital income coverage of S$100 per day, up to S$10,000 at S$100 per day", summary, "keep"],
  ["Payor Rider", "Payor Rider: premiums of S$600 are paid by us on the payor's death", wording, "keep"],
  ["Death Benefit", "The death benefit is payable if the life assured dies; the life assured need not survive any period", wording, "named"],
  ["Cover Price", "Protection from S$0.30 a day", summary, "drop"],
  ["Survival", "A survival period of 14 days applies", wording, "drop"],
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
  assert.equal(statesAPrice("Hospital Income up to S$36,500 at S$100 per day"), false);
  assert.equal(statesAPrice("Pay a premium of S$20 a month"), true);
  assert.equal(statesAPrice("Funeral costs up to S$5,000"), false);
});
check("a named cover with no amount is shown as named, never as asking what it pays", () => {
  const pays = describeBenefitFormula({ formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null,
    quote: "We will waive premiums falling due while a benefit is payable under this policy.", benefitName: "Premium Waiver" });
  assert.equal(pays, "Named in the policy; no amount is printed beside it here");
});
check("a passage that points to a schedule elsewhere never says the policy prints no amount", () => {
  const pays = describeBenefitFormula({ formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null,
    quote: "We pay the amount shown in the schedule on page 5.", benefitName: "Accidental Death Benefit" });
  assert.equal(pays, "No amount printed beside it here; check the schedule");
});
check("a row whose passage prints an amount it could not read still asks", () => {
  const pays = describeBenefitFormula({ formulaKind: "none", formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null,
    quote: "S$5,000 per child (up to 2 children)", benefitName: "Child Education Fund" });
  assert.match(pays, /tell DearPolicy what this pays/);
});
console.log(`model row shape: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
