/** Any ISO 4217 code can be stated for an amount a person reads from their own document; a bare "$" or an unknown code
 * states none, and nothing is ever chosen for them (coordinator 13 Nov: THB or JPY could not be entered). */
import assert from "node:assert/strict";
import { COMMON_CURRENCIES, typedCurrency } from "@/components/currency-picker";
import { reviewedBenefitFormula } from "@/lib/policies/benefit-catalog";

let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };
const save = (currency: string | null) => reviewedBenefitFormula({ kind: "fixed", value: 100, currency, factKey: null, offsetDays: null, maximumDays: null });
t("typed codes: any real ISO 4217 code, any case", () => {
  for (const [typed, want] of [["THB", "THB"], ["jpy", "JPY"], [" kwd ", "KWD"], ["vnd", "VND"], ["CHF", "CHF"]]) assert.equal(typedCurrency(typed), want, typed);
});
t("typed codes: a sign, a bare $, a partial or an unknown code is none", () => {
  for (const typed of ["$", "S$", "RM", "TH", "XYZ", "TPD", "SGDX", ""]) assert.equal(typedCurrency(typed), "", typed);
});
t("the common list is convenience only, all real codes, no duplicates", () => {
  assert.equal(new Set(COMMON_CURRENCIES).size, COMMON_CURRENCIES.length);
  for (const c of COMMON_CURRENCIES) assert.equal(typedCurrency(c), c);
});
t("server: any ISO code is saved as stated", () => {
  for (const c of ["THB", "JPY", "KWD", "ZAR", "SGD"]) { const r = save(c); assert.ok(r.ok && r.formula.currency === c, c); }
});
t("server: a bare $, an unknown code or nothing is refused, never taken as SGD", () => {
  for (const c of ["$", "XYZ", null, ""]) { const r = save(c); assert.equal(r.ok, false, String(c)); }
});
console.log(`any-currency: ${passed} passed`);
