/**
 * A benefit paid every month says "a month" only when its own printed name or row says so; any other period, a premium
 * or a term alone gives no period, so a period is never invented (coordinator, 4 Nov). Made-up English rows.
 * No database, no model.
 */
import assert from "node:assert/strict";
import { paidMonthly } from "../../lib/policies/paid-monthly";
import { describeBenefitFormula } from "../../lib/policies/benefit-catalog";

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (error) { failed++; console.log("not ok - " + name + "\n  " + (error instanceof Error ? error.message : String(error))); }
}
const base = { currency: null, factKey: null, offsetDays: null, maximumDays: null };
const share = (benefitName: string, quote: string, value = 1 / 12) => describeBenefitFormula({ ...base, formulaKind: "sum_insured", formulaValue: value, benefitName, quote });
const fixed = (benefitName: string, quote: string, value: number) => describeBenefitFormula({ ...base, formulaKind: "fixed", formulaValue: value, currency: "SGD", benefitName, quote });

const MONTHLY: [string, string][] = [
  ["Monthly Disability Income", "Monthly Disability Income One twelfth of Sum Insured"],
  ["Income Benefit", "Income Benefit S$2,000 per month"],
  ["Income Benefit", "Income Benefit S$2,000 a month for up to 24 months"],
  ["Carer Allowance", "Carer Allowance $1,500/month"],
  ["Disability Income", "Disability Income one twelfth of the Sum Insured each month"],
  ["Long Term Care Benefit", "Long Term Care Benefit S$600 every month"],
];
const NOT_MONTHLY: [string, string][] = [
  ["Disability Benefit", "Disability Benefit One twelfth of Sum Insured"],
  ["Hospital Cash", "Hospital Cash S$100 per day"],
  ["Income Benefit", "Income Benefit S$24,000 per year, paid monthly"],
  ["Monthly premium", "Monthly premium S$45"],
  ["Death Benefit", "Death Benefit S$100,000"],
  ["Deferred Period", "Payable after a deferred period of 6 months"],
  ["Income Benefit", "Income Benefit S$2,000 for 12 months"],
  ["Monthly Income", "Monthly Income paid as a lump sum of S$20,000"],
  ["Recovery Benefit", "Recovery Benefit S$500 per month or S$100 per day, whichever is lower"],
];
for (const [name, quote] of MONTHLY) check(`monthly: ${quote}`, () => assert.equal(paidMonthly(name, quote), true));
for (const [name, quote] of NOT_MONTHLY) check(`no period: ${quote}`, () => assert.equal(paidMonthly(name, quote), false));

check("a share paid every month says so", () =>
  assert.equal(share("Monthly Disability Income", "Monthly Disability Income One twelfth of Sum Insured"), "8.3% of the sum insured on your schedule, paid each month"));
check("a share whose row names no period stays as it was", () =>
  assert.equal(share("Disability Benefit", "Disability Benefit One twelfth of Sum Insured"), "8.3% of the sum insured on your schedule"));
check("a fixed amount paid every month says a month", () =>
  assert.equal(fixed("Income Benefit", "Income Benefit S$2,000 per month", 2000), "S$2,000 a month"));
check("a fixed amount with no period stays one amount", () =>
  assert.equal(fixed("Death Benefit", "Death Benefit S$100,000", 100000), "S$100,000"));
check("a yearly figure paid in monthly instalments is not called monthly", () =>
  assert.equal(fixed("Income Benefit", "Income Benefit S$24,000 per year, paid monthly", 24000), "S$24,000"));
console.log(`paid monthly: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
