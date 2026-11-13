/** A bare "$" never names SGD (DC rule): it takes the currency its own document establishes only when that currency is
 * written with "$"; otherwise the figure is kept and says its currency is unknown. Any currency, any insurer. */
import assert from "node:assert/strict";
import { currencyOfAmount, formatMoney } from "@/lib/format/currency";
import { describeBenefitFormula } from "@/lib/policies/benefit-catalog";
import { describeCondition, type CoverCondition } from "@/lib/insurance/cover-conditions";

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
t("a stated code or sign is read as itself", () => {
  for (const [printed, want] of [["SGD", "SGD"], ["S$", "SGD"], ["US$", "USD"], ["RM", "MYR"], ["€", "EUR"], ["THB", "THB"]]) assert.equal(currencyOfAmount(printed, null), want, printed);
});
t("a bare $ takes the document's currency only when that currency is written with $", () => {
  for (const doc of ["SGD", "USD", "AUD", "HKD", "NZD", "CAD"]) assert.equal(currencyOfAmount("$", doc), doc, doc);
  for (const doc of ["EUR", "GBP", "MYR", "JPY", "THB", null, "", "$"]) assert.equal(currencyOfAmount("$", doc), null, String(doc));
});
t("a bare $ with nothing established is no currency, never SGD", () => {
  assert.equal(currencyOfAmount("$"), null);
  assert.equal(currencyOfAmount(""), null);
  assert.equal(currencyOfAmount(null), null);
});
t("a bare-$ benefit keeps its figure and says its currency is not stated", () => {
  const text = describeBenefitFormula({ formulaKind: "fixed", formulaValue: 5000, currency: "$", factKey: null, offsetDays: null, maximumDays: null });
  assert.match(text, /5,000/);
  assert.match(text, /currency not stated/);
  assert.doesNotMatch(text, /S\$|SGD/);
  assert.match(describeBenefitFormula({ formulaKind: "fixed", formulaValue: 5000, currency: "S$", factKey: null, offsetDays: null, maximumDays: null }), /S\$5,000/);
});
t("formatMoney with no currency keeps the figure and says so", () => {
  assert.match(formatMoney(1500, null), /1,500 \(currency unknown\)/);
  assert.match(formatMoney(1500, "$"), /1,500 \(currency unknown\)/);
});
t("a bare $ takes the currency its own quoted clause prints first (Critic #465 F2)", () => {
  assert.equal(currencyOfAmount("$", "USD", "SGD"), "SGD");
  assert.equal(currencyOfAmount("$", null, "SGD"), "SGD");
  assert.equal(currencyOfAmount("$", "EUR", null), null);
});
t("a cap's wording keeps the currency its quote prints (Critic #465 F1)", () => {
  const cap = { kind: "aggregate_cap", amount: 10000, amountBasis: "fixed", quote: "The total amount payable shall not exceed S$10,000 for all claims.", productName: null } as unknown as CoverCondition;
  const text = describeCondition(cap);
  assert.match(text, /S\$10,000/, text);
  assert.doesNotMatch(text, /currency unknown/);
});
console.log(`bare-dollar: ${passed} passed`);
