/** A travel summary's "label : value" form lines are not a benefit table, and a cover named only by its plan is named
 * with its product (FWD re-read, 5 Nov):
 *  - the riders block of a summary ("Home cover : N/A", "Cancel for any reason : N/A", ...) was read by the table parser
 *    as a plan table: two labels joined into one benefit ("Cancel for any reason Sports equipment protector") under
 *    columns ": See table below" and "Home cover", shown twice as "The amount on page 1 could not be read";
 *  - one cell that says a benefit does not apply ("N/A", ": Nil", "Not applicable") is a benefit not covered, never an
 *    amount that could not be read; a row is dropped only when every cell says so, and a term's "Nil" stays its term;
 *  - a column named by a form value (": See table below") is no plan column, and its row is kept;
 *  - Home read "Not included: Business (no fixed sum, see Coverage)": a cover whose name is its plan's is named with its
 *    product ("Travel insurance, Business plan").
 * Made-up English documents; no model, no database, no network.
 *   npm run -s coverage:summary-form-rows-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

import { benefitRowsFromText } from "@/lib/documents/layout";
import { formRowMisread, formTier, rowKind } from "@/lib/policies/catalog-builder";
import { planCoverName } from "@/lib/coverage/table-figures";

let pass = 0, fail = 0;
function t(id: string, ok: boolean, detail: unknown) {
  if (ok) { pass++; console.log("ok " + id); return; }
  fail++; console.log(`FAIL ${id}: ${JSON.stringify(detail)}`);
}

// A made-up single-trip summary laid out as two-column "label : value" pairs, as a PDF text layer gives it.
const SUMMARIES = [
  "Riders\nPre-existing medical conditions\t: See table below\tHome cover\t: N/A\nCancel for any reason Sports equipment protector\t: N/A : N/A\tPet care (S$50 per six-hour period of delay) : N/A\nAbout you",
  "Optional covers\nWinter sports\t: Included\tRental car excess\t: N/A\nGolf cover Gadget cover\t: Nil : Nil\tCruise cover (US$100 per day at sea) : Not applicable\nYour details",
  "Add-ons\nAdventure activities\t: See schedule\tTrip interruption\t: Not covered\nBusiness equipment Hijack cover\t: - : -\tKennel fees (£20 per night) : N/A\nPolicyholder",
];
for (const [i, text] of SUMMARIES.entries()) {
  const rows = benefitRowsFromText(text);
  const kept = rows.filter((r) => !formRowMisread(r.value, r));
  t(`F${i + 1}b two labels joined into one name are never stored`, !kept.some((r) => /cancel for any reason sports|golf cover gadget|business equipment hijack/i.test(r.label)), kept);
}
t("F4 a column named by a form value (': See table below') is no plan column, and its row is kept", formTier(": See table below") === null && formTier("Gold") === "Gold" && !formRowMisread("S$5,000"), null);
t("F5 two 'does not apply' cells are two labels' cells", formRowMisread(": N/A : N/A") && formRowMisread("Nil\tNil"), null);
t("F6 another pair's value after the label's own 'N/A' cells is not this row's amount", formRowMisread("Pet care (S$50 per six-hour period of delay) : N/A",
  { label: "Cancel for any reason", line: "Cancel for any reason\t: N/A : N/A\tPet care (S$50 per six-hour period of delay) : N/A" }), null);
t("F6b a label's own figure beside it keeps the row", !formRowMisread("S$5,000\tN/A", { label: "Medical", line: "Medical\tS$5,000\tN/A" })
  && !formRowMisread("N/A\tS$5,000", { label: "Medical", line: "Medical\tN/A\tS$5,000" }), null);
t("F6c a plan row whose first plan cell says N/A or a dash keeps its next plan's figure (Critic #371)",
  !formRowMisread("S$300", { label: "Daily room and board", line: "Daily room and board\tN/A\tS$300\tS$500" })
  && !formRowMisread("S$300", { label: "Daily room and board", line: "Daily room and board  -  S$300  S$500" }), null);
for (const line of ["Daily room and board\tN/A\tS$300\tS$500", "Daily room and board  -  S$300  S$500"]) {
  const rows = benefitRowsFromText("Benefit\tPlan A\tPlan B\tPlan C\n" + line);
  t(`F6d ${JSON.stringify(line)}: every row with a figure is kept`, rows.filter((r) => /\d/.test(r.value)).every((r) => !formRowMisread(r.value, r)), rows);
}
// Never dropped: a value with any figure (in brackets too) or any worded cell (Critic and TE, #371).
for (const value of ["S$1,000", ": S$250,000", "(S$100 per day) : N/A", "Covered (up to S$500) : N/A", "As charged : N/A", "S$100 per day : N/A",
  "S$5,000\tN/A", "N/A\tS$5,000", "S$5,000 : Nil", "Up to S$500 : N/A for children", "N/A", "S$100 for every 6 hours", ": S$500,000 : S$1,000,000", "100,000 : -"])
  t(`F7 kept: ${JSON.stringify(value)}`, !formRowMisread(value), null);
for (const v of ["N/A", ": N/A", "Not applicable", "Nil", "n.a.", "Excluded", "-"]) t(`F8 "${v}" alone is not covered`, rowKind("Golf equipment", v) === "not_covered", rowKind("Golf equipment", v));
for (const v of ["S$500", "Up to S$500", "As charged", "Unlimited"]) t(`F9 "${v}" keeps its kind`, rowKind("Baggage", v) !== "not_covered", rowKind("Baggage", v));
// A term's "Nil" is no such term, never "not covered": the label decides first, as on main.
for (const [label, value, want] of [["Deductible", "Nil", "deductible"], ["Deductible", ": Nil", "deductible"], ["Co-payment", "-", "co_payment"], ["Co-payment", "Nil", "co_payment"],
  ["Co-insurance", "Nil", "co_insurance"], ["Co-insurance", "-", "co_insurance"], ["Co-payment cap", "Nil", "co_payment_cap"], ["Policy year limit", "Not applicable", "policy_year_limit"],
  ["Excess", "Nil", "benefit"]] as const)
  t(`F10 ${label} | ${value} is ${want}`, rowKind(label, value) === want, rowKind(label, value));

// A cover named only by its plan.
const names: [string | null, string | null, string | null, string | null][] = [
  ["Business", "Business", "Travel insurance summary", "Travel insurance, Business plan"],
  ["Business", "Business", "Business Single Trip", "Business Single Trip"],
  ["Classic Plan", "Classic", "Harbourline Travel Protect", "Harbourline Travel Protect, Classic plan"],
  ["Gold", "Gold", null, "Gold plan"],
  ["Gold", "Gold Plan", "Policy schedule", "Gold Plan"],
  ["Accidental death", "Business", "Wayfarer Travel Shield", null],
  ["Business", null, "Wayfarer Travel Shield", null],
];
for (const [cover, plan, product, want] of names) t(`N ${cover} / ${plan} / ${product}`, planCoverName(cover, plan, product) === want, planCoverName(cover, plan, product));

console.log(`summary form rows: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
