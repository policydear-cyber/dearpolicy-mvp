/** A row named for an injury is an accident row: "Death due to Injury" pays only for a death an accident caused, so it is
 * never counted toward a death from illness (TE #343). "Injury or illness" names either cause, and a negated injury
 * ("Death other than by injury") is not one. Made-up names; no database, no model.
 *   npm run -s ledger:injury-cause-test */
import assert from "node:assert/strict";
import { causeForBenefit, eventForBenefitName } from "@/lib/ledger/events";

let passed = 0; const failures: string[] = [];
function t(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }
for (const n of ["Death due to Injury", "Death due to Injuries", "Injury Death Benefit", "Kematian akibat Kemalangan / Death due to Injury"]) {
  t(`"${n}" is accidental death`, () => assert.equal(eventForBenefitName(n).event, "accidental_death"));
  t(`"${n}" needs an accident`, () => assert.equal(causeForBenefit(n), "accident"));
}
t(`"Total and Permanent Disability due to Injury" is accidental disablement`, () => assert.equal(eventForBenefitName("Total and Permanent Disability due to Injury").event, "accidental_disablement"));
for (const n of ["Death due to Injury or Illness", "Death due to illness or injury", "Death other than by injury", "Death Benefit"]) {
  t(`"${n}" is any death`, () => assert.equal(eventForBenefitName(n).event, "death"));
  t(`"${n}" is not restricted to an accident`, () => assert.notEqual(causeForBenefit(n), "accident"));
}
t(`"Accidental Death" is still accidental death`, () => assert.equal(eventForBenefitName("Accidental Death").event, "accidental_death"));
console.log(`injury cause: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
