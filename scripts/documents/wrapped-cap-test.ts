/** A cap printed on the line below, in the name's column, finishes the row above and is never a benefit of its own with
 * the cap as its amount (TE #342: "Hearing loss in both | 50% of the Sum Insured" / "Ears, up to | RM 100,000" gave a
 * benefit "Ears, up to" worth RM 100,000; "Hospital cash | RM 100 per day" / "Maximum 30 days per year | RM 3,000" gave
 * one worth RM 3,000). A share of the sum insured with a cap after it is never shown as the share uncapped. A name that
 * only starts with a cap word ("Maximum lifetime limit") is still its own row. Made-up English schedules; no database.
 *   npm run -s documents:wrapped-cap-test */
import assert from "node:assert/strict";
import { benefitRowsFromText } from "@/lib/documents/layout";
import { parseBenefitValue } from "@/lib/policies/benefit-rows";
import { repairStoredRules, type CatalogBenefit } from "@/lib/policies/benefit-catalog";

/** Stored as read, then bounded on read: true only if the row would be shown as the share with no cap and no hold. */
function shownUncapped(name: string, value: string) {
  const parsed = parseBenefitValue(value);
  if (!parsed || parsed.kind !== "sum_insured") return false;
  const [read] = repairStoredRules([{ id: "b1", policyId: "p1", productName: null, benefitName: name, traits: [], formulaKind: "sum_insured",
    formulaValue: parsed.value, currency: null, factKey: null, offsetDays: null, maximumDays: null, sourcePage: 1, quote: name + " " + value,
    conditions: [], requirements: [], needsReview: false } as CatalogBenefit]);
  return read.formulaKind === "sum_insured" && !read.conditions.some((c) => /^Paid up to /.test(c));
}
let passed = 0; const failures: string[] = [];
function test(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
const rows = (text: string) => benefitRowsFromText(text).map((r) => [r.label, r.value] as const);
const labels = (text: string) => rows(text).map(([l]) => l);

for (const c of ["RM", "S$", "£", "HK$", "A$", "NZ$", "US$"]) {
  test(`${c}: "Ears, up to" finishes the hearing-loss row`, () => {
    const got = rows(`POLICY SCHEDULE\n\nHearing loss in both\t50% of the Sum Insured\nEars, up to\t${c} 100,000\nDeath\t${c} 200,000`);
    assert.deepEqual(got, [["Hearing loss in both Ears", `50% of the Sum Insured up to ${c} 100,000`], ["Death", `${c} 200,000`]]);
    assert.notEqual(shownUncapped(got[0][0], got[0][1]), true);
  });
  test(`${c}: "Maximum 30 days per year" finishes the hospital-cash row`, () => {
    const got = rows(`POLICY SCHEDULE\n\nHospital cash\t${c} 100 per day\nMaximum 30 days per year\t${c} 3,000\nDeath\t${c} 200,000`);
    assert.deepEqual(got.map(([l]) => l), ["Hospital cash", "Death"]);
    assert.equal(parseBenefitValue(got[0][1])?.kind, "daily");
  });
  test(`${c}: "Up to 120 days" finishes the room row`, () => {
    assert.deepEqual(labels(`POLICY SCHEDULE\n\nRoom and board\t${c} 300 per day\nUp to 120 days\t${c} 36,000\nDeath\t${c} 200,000`), ["Room and board", "Death"]);
  });
  test(`${c}: "Maximum lifetime limit" is a row of its own`, () => {
    assert.deepEqual(labels(`POLICY SCHEDULE\n\nRoom and board\t${c} 300 per day\nMaximum lifetime limit\t${c} 1,000,000\nDeath\t${c} 200,000`),
      ["Room and board", "Maximum lifetime limit", "Death"]);
  });
}
test("a share of the sum insured with a cap after it is not the share uncapped", () => {
  for (const v of ["50% of the Sum Insured up to RM 100,000", "50% of the Sum Insured, up to S$50,000", "25% of the sum insured, maximum £20,000",
    "100% of the Sum Insured, subject to the overall limit"]) assert.equal(shownUncapped("Hearing loss", v), false, v);
  for (const v of ["100% of the Sum Insured", "50% of sum insured", "25% of the sum insured (one ear)"]) assert.equal(parseBenefitValue(v)?.kind, "sum_insured", v);
});
console.log(`wrapped cap: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
