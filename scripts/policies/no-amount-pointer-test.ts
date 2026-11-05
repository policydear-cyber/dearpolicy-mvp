/** Benefits (app/schedule/page.tsx): a row whose passage prints no amount points to Coverage for the sum the schedule
 * prints, so "no amount is printed beside it here" next to a figure on Coverage never reads as a contradiction. It adds
 * no figure. The wording it matches is the catalog's own (describeBenefitFormula). Made-up passages. Pure: no database,
 * no network, no model.
 *   node --import tsx scripts/policies/no-amount-pointer-test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describeBenefitFormula } from "@/lib/policies/benefit-catalog";
import { pointsToScheduleSum, SCHEDULE_SUM_POINTER } from "@/lib/policies/no-amount-pointer";
import { unreadAmountLine } from "@/lib/policies/unread-amount-line";

for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$|PROXY/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const none = { formulaKind: "none" as const, formulaValue: null, currency: null, factKey: null, offsetDays: null, maximumDays: null };
type Extra = Partial<{ formulaKind: string; attention: string | null; needsConfirmation: boolean; planColumns: boolean; benefitName: string; quote: string | null }>;
const row = (extra: Extra = {}) => ({ formulaKind: "none", attention: null, needsConfirmation: false, benefitName: "Critical Illness II", quote: "Critical Illness II is included in this plan.", ...extra });
const named = "Named in the policy; no amount is printed beside it here";

test("a sum-insured benefit's no-amount lines, from both writers, get the pointer", () => {
  const ci = describeBenefitFormula({ ...none, quote: "Critical Illness II is included in this plan.", benefitName: "Critical Illness II" });
  const elsewhere = describeBenefitFormula({ ...none, quote: "We pay the amount shown in the schedule on page 5.", benefitName: "Accidental Death Benefit" });
  assert.equal(pointsToScheduleSum(row(), ci), true, ci);
  assert.equal(pointsToScheduleSum(row({ benefitName: "Accidental Death Benefit", quote: "We pay the amount shown in the schedule on page 5." }), elsewhere), true, elsewhere);
  const words = unreadAmountLine(2, "Critical Illness II is included in this plan.", "Critical Illness II");
  assert.match(words, /with no amount in it/);
  assert.equal(pointsToScheduleSum(row({ attention: "unreadable" }), words), true, words);
  for (const benefitName of ["Death Benefit", "Terminal Illness", "Total and Permanent Disability", "TPD Benefit", "Dread Disease Cover"])
    assert.equal(pointsToScheduleSum(row({ benefitName, quote: `${benefitName} is payable under this policy.` }), named), true, benefitName);
});
test("a benefit whose own passage names the insured amount gets it, whatever it is called", () => {
  assert.equal(pointsToScheduleSum(row({ benefitName: "Main Benefit", quote: "We pay the Sum Assured shown in the Policy Schedule." }), named), true);
  assert.equal(pointsToScheduleSum(row({ benefitName: "Basic Cover", quote: "the Coverage Amount stated in your certificate" }), named), true);
});
test("the whole-sum line gets it", () => {
  const whole = "The passage on page 4 pays the whole sum insured, which this document does not print for you. Your amount is on your own policy schedule or certificate.";
  assert.equal(pointsToScheduleSum(row({ attention: "unreadable", benefitName: "Main Benefit", quote: "100% of the benefit amount" }), whole), true);
});
test("a waiver, named or in words, never gets it (Critic M1, TE EXTRA 1)", () => {
  const waiver = describeBenefitFormula({ ...none, quote: "Future premiums are waived on diagnosis of a critical illness.", benefitName: "Waiver of Premium" });
  assert.equal(pointsToScheduleSum(row({ benefitName: "Waiver of Premium", quote: "Future premiums are waived on diagnosis of a critical illness." }), waiver), false, waiver);
  assert.equal(pointsToScheduleSum(row({ benefitName: "Premium Waiver", quote: "We will waive premiums falling due while a benefit is payable under this policy." }), named), false);
  assert.equal(pointsToScheduleSum(row({ benefitName: "Payor Benefit", quote: "Premiums are waived if the payor dies." }), named), false, "names death but waives premiums");
  assert.equal(pointsToScheduleSum(row({ benefitName: "Waiver of Premium on Death or TPD", quote: "We waive the remaining premiums." }), named), false, "a waiver named after a sum-insured event");
  assert.equal(pointsToScheduleSum(row({ benefitName: "Critical Illness Waiver", quote: "We stop collecting premiums on diagnosis." }), named), false);
});
test("a benefit whose amount is not the sum insured never gets it (Critic M1, TE product question)", () => {
  for (const [benefitName, quote] of [["Emergency Medical Evacuation", "We arrange emergency medical evacuation."], ["24-hour Helpline", "Call our 24-hour helpline."],
    ["Hospital Cash", "A daily cash benefit is paid for each day in hospital."], ["Funeral Expenses", "Funeral costs are reimbursed after the death of the life insured."], ["Repatriation", "We arrange repatriation of mortal remains."], ["Death Funeral Grant", "A grant towards funeral costs is paid on death."], ["Accidental Death Burial Expenses", "Burial expenses are reimbursed."]]) {
    const line = unreadAmountLine(3, quote, benefitName);
    assert.equal(pointsToScheduleSum(row({ attention: "unreadable", benefitName, quote }), line), false, `${benefitName}: ${line}`);
    assert.equal(pointsToScheduleSum(row({ benefitName, quote }), named), false, benefitName);
  }
});
test("lines that already say where the amount comes from, or ask the household, get none", () => {
  for (const line of ["The passage on page 3 waives future premiums. This benefit pays no amount itself.",
    "The passage on page 3 pays this in advance from the death benefit, so its amount follows the death benefit, within any limit the policy sets.",
    "The passage on page 3 stops before the maximum it pays up to, so no amount is used for it. The maximum is printed further down page 3.",
    "The amount on page 3 could not be read.", "As stated in the document."])
    assert.equal(pointsToScheduleSum(row({ attention: "unreadable", benefitName: "Death Benefit" }), line), false, line);
});
test("a row with an amount, a plan table, or one awaiting a check gets none", () => {
  assert.equal(pointsToScheduleSum(row({ formulaKind: "fixed" }), describeBenefitFormula({ ...none, formulaKind: "fixed", formulaValue: 5000, currency: "MYR", quote: "RM 5,000" })), false);
  assert.equal(pointsToScheduleSum(row({ formulaKind: "sum_insured" }), "50% of the sum insured on your schedule"), false);
  assert.equal(pointsToScheduleSum(row({ attention: "confirm" }), named), false);
  assert.equal(pointsToScheduleSum(row({ needsConfirmation: true }), named), false);
  assert.equal(pointsToScheduleSum(row({ planColumns: true }), named), false);
});
test("the pointer adds no figure", () => {
  assert.doesNotMatch(SCHEDULE_SUM_POINTER, /\d/);
});
test("Benefits shows it under the row's own line, linking to Coverage", () => {
  const page = readFileSync("app/schedule/page.tsx", "utf8");
  assert.match(page, /\{pointsToScheduleSum\(benefit,line\.text\)&&<small className="pays-basis" data-testid="schedule-sum-pointer">\{SCHEDULE_SUM_POINTER\} <Link className="text-link" href="\/ledger">See Coverage →<\/Link><\/small>\}/);
});
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`no-amount-pointer: ${passed} passed, fetches 0`);
