/** A travel summary's "label : value" form lines are not a benefit table, and a cover named only by its plan is named
 * with its product (FWD re-read, 5 Nov):
 *  - the riders block of a summary ("Home cover : N/A", "Cancel for any reason : N/A", ...) was read by the table parser
 *    as a plan table: two labels joined into one benefit ("Cancel for any reason Sports equipment protector") under
 *    columns ": See table below" and "Home cover", shown twice as "The amount on page 1 could not be read";
 *  - one cell that says a benefit does not apply ("N/A", ": Nil", "Not applicable") is a benefit not covered, never an
 *    amount that could not be read; a figure beside it keeps the row as before;
 *  - Home read "Not included: Business (no fixed sum, see Coverage)": a cover whose name is its plan's is named with its
 *    product ("Travel insurance, Business plan").
 * Made-up English documents; no model, no database, no network.
 *   npm run -s coverage:summary-form-rows-test */
for (const k of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|_KEY$/i.test(k)) delete process.env[k];
globalThis.fetch = (async () => { throw new Error("no network"); }) as typeof fetch;

import { benefitRowsFromText } from "@/lib/documents/layout";
import { formRowMisread, rowKind } from "@/lib/policies/catalog-builder";
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
  const kept = rows.filter((r) => !formRowMisread(r.value, r.tier ?? null));
  t(`F${i + 1} no row of a summary's form lines is stored as a benefit with an unreadable amount`, kept.every((r) => rowKind(r.label, r.value, r.tier ?? null) !== "benefit" || /\d/.test(r.value.replace(/\([^()]*\)/g, ""))),
    { rows, kept });
  t(`F${i + 1}b two labels joined into one name are never stored`, !kept.some((r) => /cancel for any reason sports|golf cover gadget|business equipment hijack/i.test(r.label)), kept);
}
t("F4 a column named by a form value (': See table below') is not a plan column", formRowMisread("S$5,000", ": See table below"), null);
t("F5 two 'does not apply' cells are two labels' cells", formRowMisread(": N/A : N/A", null) && formRowMisread("Nil\tNil", "Gold"), null);
t("F6 another label's 'N/A' after a bracketed rate is not this row's amount", formRowMisread("Pet care (S$50 per six-hour period of delay) : N/A", "Home cover"), null);
// Unchanged: a figure in a cell, or one cell that says it does not apply.
for (const [value, tier] of [["S$5,000", "Classic"], ["S$5,000\tN/A", null], ["Up to S$500 : N/A for children", null], ["N/A", "Classic"], ["S$200 per day", null]] as const)
  t(`F7 kept: ${JSON.stringify(value)} under ${tier}`, !formRowMisread(value, tier), null);
for (const v of ["N/A", ": N/A", "Not applicable", "Nil", "n.a.", "Excluded", "-"]) t(`F8 "${v}" alone is not covered`, rowKind("Golf equipment", v) === "not_covered", rowKind("Golf equipment", v));
for (const v of ["S$500", "Up to S$500", "As charged", "Unlimited"]) t(`F9 "${v}" keeps its kind`, rowKind("Baggage", v) !== "not_covered", rowKind("Baggage", v));

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
