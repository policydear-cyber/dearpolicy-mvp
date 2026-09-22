import assert from "node:assert/strict";
import { extractClaimFacts } from "@/lib/claims/facts";
import { assessClaim, nextClaimQuestion } from "@/lib/claims/rules";
import type { DeathRuleEvidence } from "@/lib/claims/death-evidence";
import type { OwnedCoverage } from "@/lib/coverage/facts";

/** Contextual regressions for the V1 death-benefit and accidental-death
 * calculators, covering the scenarios the task explicitly asked for. These
 * exercise the full deterministic pipeline (fact extraction -> question
 * planning -> calculator routing), not just the pure calculator functions
 * already covered by death-benefit-calculator-regressions.ts. */
export async function runDeathBenefitContextualRegressions() {
  let cases = 0;
  const test = (name: string, fn: () => void) => { try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); } };
  const context = { now: new Date("2026-09-14T12:00:00Z"), timeZone: "Asia/Singapore", allowAi: false };
  const coverage = (overrides: Partial<OwnedCoverage>): OwnedCoverage => ({ id: "gtl", policyId: "certificate", familyMemberId: "charmaine", category: "Death", amount: 1_000_000, currency: "SGD", productName: "Group Term Life", sourcePage: 1, evidenceText: "personal certificate", insurer: "Singlife", policyName: "MINDEF & MHA", policyNumber: "personal", groupPolicyNumber: "G007500", documentRole: "certificate", effectiveDate: "2022-10-06", renewalOrExpiryDate: null, ...overrides });
  const coverages = [coverage({}), coverage({ id: "gpa", category: "Personal Accident", productName: "Group Personal Accident", amount: 600_000 })];
  const citation = { chunkId: "page:wording:2", policyId: "wording", policyName: "Benefit summary", pageStart: 2, pageEnd: 2, personalEvidence: false };
  const deathRules: DeathRuleEvidence[] = [
    { coverageId: "gtl", benefit: "gtl-death", quote: "Death 100% of Sum Insured", citation, formula: { kind: "sum_insured_fraction", fraction: 1 } },
    { coverageId: "gpa", benefit: "gpa-accidental-death", quote: "Death due to Accident 100% of Sum Insured", citation, formula: { kind: "sum_insured_fraction", fraction: 1 } },
  ];

  // 1. Cancer death with ordinary death cover: ordinary is payable, the
  // accidental rider is never even considered because the reported cause
  // itself rules it out.
  const cancer = await extractClaimFacts({ text: "Charmaine died from stage 4 cancer yesterday", ...context });
  test("Cancer death pays only the ordinary death benefit", () => {
    assert.equal(cancer.accidentalDeath, false);
    const result = assessClaim(cancer, coverages, deathRules);
    assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
    // A cause of death that is definitively not an accident rules the
    // accidental-death benefit out of the assessment entirely.
    assert.equal(result.find(i => i.id === "gpa-accidental-death"), undefined);
  });

  // 2. Car-crash death with the accidental cover unresolved: the ordinary
  // benefit is payable, the accidental benefit stays visible with no amount
  // until an official document is confirmed, and DearPolicy asks for it.
  const carCrash = await extractClaimFacts({ text: "Charmaine died in a car crash yesterday", ...context });
  test("Car-crash death does not by itself authorise the accidental-death amount", () => {
    assert.equal(carCrash.accidentalDeath, true);
    assert.equal(carCrash.causeOfDeathDocumented, null);
    assert.equal(nextClaimQuestion(carCrash, coverages)?.id, "cause_of_death_document");
    const result = assessClaim(carCrash, coverages, deathRules);
    assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
    const accidental = result.find(i => i.id === "gpa-accidental-death");
    assert.equal(accidental?.status, "needs_document"); assert.equal(accidental?.amountText, null); assert.equal(accidental?.calculatedAmount, undefined);
    assert.match(accidental?.reason ?? "", /official cause-of-death document/i);
  });

  // 3. Accidental cover confirmed by sufficient structured evidence: once the
  // document is confirmed, both benefits become payable and are additive.
  test("Accidental cover confirmed by structured evidence pays both benefits, once each", () => {
    const confirmed = { ...carCrash, causeOfDeathDocumented: true };
    assert.equal(nextClaimQuestion(confirmed, coverages), null);
    const result = assessClaim(confirmed, coverages, deathRules);
    assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
    assert.equal(result.find(i => i.id === "gpa-accidental-death")?.calculatedAmount, 600_000);
    const total = result.reduce((sum, i) => sum + (i.calculatedAmount ?? 0), 0);
    assert.equal(total, 1_600_000);
    // Allowed amounts enter the total exactly once each.
    assert.equal(result.filter(i => i.calculatedAmount != null).length, 2);
  });

  // 4. Homicide is never automatically treated as confirmed accidental death.
  const murdered = await extractClaimFacts({ text: "Charmaine was murdered yesterday", ...context });
  test("A reported homicide never auto-confirms accidental death", () => {
    assert.equal(murdered.death, true); assert.equal(murdered.accidentalDeath, null);
    // DearPolicy asks what caused the death -- it never labels a homicide
    // "accidental" on the user's behalf.
    assert.equal(nextClaimQuestion(murdered, coverages)?.id, "cause_of_death");
    const result = assessClaim(murdered, coverages, deathRules);
    assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
    // The accidental-death benefit stays visible (the cause is still
    // genuinely unresolved) but with no amount and no assumption either way.
    const accidental = result.find(i => i.id === "gpa-accidental-death");
    assert.equal(accidental?.status, "needs_document"); assert.equal(accidental?.amountText, null); assert.equal(accidental?.calculatedAmount, undefined);
  });

  // 5. Unknown cause stays unresolved and is never assumed either way.
  const causeQuestion = { id: "cause_of_death" as const, text: "Cause?", type: "choice" as const, why: "test" };
  const unknown = await extractClaimFacts({ text: "Not sure", current: { ...murdered, accidentalDeath: null }, pendingQuestion: causeQuestion, ...context });
  test("An unknown cause of death is never assumed to be accidental or natural", () => {
    assert.equal(unknown.accidentalDeath, null);
    // Having already said "not sure" once, DearPolicy does not keep asking.
    assert.equal(nextClaimQuestion(unknown, coverages), null);
    const result = assessClaim(unknown, coverages, deathRules);
    // The accidental-death benefit stays visible with no amount, never
    // silently dropped and never paid on a guess.
    const accidental = result.find(i => i.id === "gpa-accidental-death");
    assert.equal(accidental?.status, "needs_document"); assert.equal(accidental?.amountText, null);
    assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
  });

  // 6. Natural causes (heart attack) exclude the accidental-death benefit
  // outright rather than leaving it pending.
  const natural = await extractClaimFacts({ text: "Charmaine died of a heart attack yesterday", ...context });
  test("Natural causes rule out the accidental-death benefit rather than deferring it", () => {
    assert.equal(natural.accidentalDeath, false);
    assert.equal(assessClaim(natural, coverages, deathRules).find(i => i.id === "gpa-accidental-death"), undefined);
  });

  // 7. Ordinary and accidental death benefits are additive when both are
  // confirmed (already exercised above; re-asserted here against the
  // dedicated evidence-confirmed fixture for traceability to the task list).
  test("Ordinary and accidental death benefits are additive, not alternatives, under this scheme", () => {
    const confirmed = { ...carCrash, causeOfDeathDocumented: true };
    const result = assessClaim(confirmed, coverages, deathRules);
    assert.equal(result.length, 2);
    assert.equal(result.reduce((sum, i) => sum + (i.calculatedAmount ?? 0), 0), 1_600_000);
  });

  // 8. Duplicate clauses extracted from multiple documents for the same
  // coverage and benefit are counted once, not once per duplicate.
  test("A duplicate clause extracted twice for the same benefit is counted once", () => {
    const duplicateRules: DeathRuleEvidence[] = [
      ...deathRules,
      { coverageId: "gtl", benefit: "gtl-death", quote: "Death 100% of Sum Insured (benefit summary, second copy)", citation: { ...citation, chunkId: "page:wording:9", pageStart: 9, pageEnd: 9 }, formula: { kind: "sum_insured_fraction", fraction: 1 } },
    ];
    const confirmed = { ...carCrash, causeOfDeathDocumented: true };
    const result = assessClaim(confirmed, coverages, duplicateRules);
    assert.equal(result.filter(i => i.id === "gtl-death").length, 1);
    assert.equal(result.find(i => i.id === "gtl-death")?.calculatedAmount, 1_000_000);
    assert.equal(result.reduce((sum, i) => sum + (i.calculatedAmount ?? 0), 0), 1_600_000);
  });

  // 9. Missing wording produces no amount, never a fabricated one.
  test("Missing benefit wording produces no amount for either benefit", () => {
    const confirmed = { ...carCrash, causeOfDeathDocumented: true };
    assert.equal(assessClaim(confirmed, coverages, []).some(i => i.amountText != null), false);
  });

  // 10. An incomplete review is never reported as "not covered" -- it stays
  // visibly pending (needs_document) rather than collapsing to not_applicable.
  test("An unresolved accidental-death review is needs_document, never not_applicable", () => {
    const result = assessClaim(carCrash, coverages, deathRules);
    const accidental = result.find(i => i.id === "gpa-accidental-death");
    assert.notEqual(accidental?.status, "not_applicable");
    assert.equal(accidental?.status, "needs_document");
  });

  // 11. Blocked amounts never enter the household total.
  test("A blocked accidental-death amount never enters the combined total", () => {
    const result = assessClaim(carCrash, coverages, deathRules);
    const total = result.reduce((sum, i) => sum + (i.calculatedAmount ?? 0), 0);
    assert.equal(total, 1_000_000);
  });

  console.log(`DearPolicy death-benefit contextual regressions passed (${cases} scenarios).`);
}
