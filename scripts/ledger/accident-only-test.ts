/**
 * A row is accident-only only when its cause is an accident or an injury alone (closed rule, TE and Critic #343). Any word
 * that opens another cause or a second clause keeps it any cause, so an accident-only sum is never counted toward a death
 * from illness. The core cases are the reviewers' own any-cause death rows. Made-up names; no database, no model.
 *   npm run -s ledger:accident-only-test
 */
import assert from "node:assert/strict";
import { causeForBenefit, eventForBenefitName } from "@/lib/ledger/events";

let passed = 0; const failures: string[] = [];
function t(name: string, fn: () => void) { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

const ACCIDENT_ONLY = [
  "Death due to Injury", "Death due to injuries", "Death from bodily injury", "Injury death benefit", "Death caused by an injury",
  "Death resulting from Injury within 365 days", "Death due to an injury", "Accidental Death due to Injury", "Accidental Death",
  "Accidental Death Benefit", "Death due to Accident", "Personal Accident Death Benefit", "Death following an injury",
  // the English part of a bilingual name decides (English only, 4 Nov 2026)
  "Kematian akibat Kemalangan / Death due to Injury", "Death due to Injury / Kematian akibat Kemalangan",
];
const ANY_CAUSE = [
  // TE #343 blind gate
  "Death due to Injury or Illness", "Death due to injury or sickness", "Death (injury or disease)", "Death due to illness or injury",
  "Death other than by injury", "Death not caused by injury", "Death benefit", "Death due to any cause", "Injury and Sickness Death Benefit",
  "Death, including death from injury", "Death (excluding self-inflicted injury)", "Death; self-inflicted injury is excluded",
  "Death (including death due to injury)", "Death or injury to any person covered by this policy",
  "Death or bodily injury to any person covered under this policy",
  // Critic #343 probes
  "Death Benefit; payable immediately for death caused by injury, after 90 days otherwise",
  "Death Benefit (no waiting period for death following an injury)", "Death from injury, illness or disease",
  "Death due to injury, sickness", "Death due to Injury and Illness", "Death resulting from injury and natural causes",
  "Death due to injury/illness", "Death due to injury or natural causes", "Death (any cause, from injury too)",
  // accident named beside another cause
  "Death due to accident or illness", "Accident and Sickness Death Benefit", "Death by accident or natural causes", "Non-accidental death",
  "Death due to self-inflicted injury",
];
for (const n of ACCIDENT_ONLY) {
  t(`"${n}" is accidental death`, () => assert.equal(eventForBenefitName(n).event, "accidental_death"));
  t(`"${n}" needs an accident`, () => assert.equal(causeForBenefit(n), "accident"));
}
for (const n of ANY_CAUSE) {
  t(`"${n}" is not restricted to an accident`, () => assert.notEqual(causeForBenefit(n), "accident"));
  t(`"${n}" is not accidental death`, () => assert.notEqual(eventForBenefitName(n).event, "accidental_death"));
}
t(`"Total and Permanent Disability due to Injury" is accidental disablement`, () => assert.equal(eventForBenefitName("Total and Permanent Disability due to Injury").event, "accidental_disablement"));
t(`"Total and Permanent Disability due to Injury or Illness" is any-cause TPD`, () => assert.equal(eventForBenefitName("Total and Permanent Disability due to Injury or Illness").event, "tpd"));
t(`"Injury overseas with a hospital stay" is not accident-only`, () => assert.notEqual(causeForBenefit("Injury overseas with a hospital stay"), "accident"));
t(`"No Claim Bonus Accidental Death" is still accidental death`, () => assert.equal(eventForBenefitName("No Claim Bonus Accidental Death").event, "accidental_death"));
t(`"Death due to Injury (accident only)" is accidental death`, () => assert.equal(eventForBenefitName("Death due to Injury (accident only)").event, "accidental_death"));
t(`"Death due to Injury (see clause 4)" is not accident-only`, () => assert.notEqual(eventForBenefitName("Death due to Injury (see clause 4)").event, "accidental_death"));
console.log(`accident only: ${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error("  FAIL " + f); process.exit(1); }
