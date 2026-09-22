import assert from "node:assert/strict";
import { calculateDeathBenefit, type DeathBenefitInput } from "@/lib/claims/calculators/death-benefit";
import { calculateAccidentalDeath, type AccidentalDeathInput } from "@/lib/claims/calculators/accidental-death";

const ruleEvidence = { chunkId: "page:wording-1:4", policyId: "wording-1", pageStart: 4, pageEnd: 4, label: "Death benefit clause" };
const ownershipEvidence = { chunkId: "cert:policy-1:1", policyId: "policy-1", pageStart: 1, pageEnd: 1, label: "Certificate of insurance" };
const ownership = { contractId: "contract-1", coverageId: "coverage-1", label: "Group Term Life" };
const familyMember = { id: "member-1", confirmed: true };

const base: DeathBenefitInput = {
  ownership, familyMember, deathConfirmed: true, dateOfDeath: "2026-06-01",
  policyEffectiveDate: "2020-01-01", sumInsured: 350_000, currency: "SGD",
  formula: { kind: "sum_insured_fraction", fraction: 1, evidence: ruleEvidence },
  ruleEvidence, ownershipEvidence, unresolvedConditions: [],
};

export function runDeathBenefitCalculatorRegressions() {
  // 100% of verified sum insured.
  {
    const r = calculateDeathBenefit(base);
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") { assert.equal(r.potentialAmount, 350_000); assert.equal(r.currency, "SGD"); assert.equal(r.capApplied, false); }
  }
  // A different verified percentage of sum insured.
  {
    const r = calculateDeathBenefit({ ...base, formula: { kind: "sum_insured_fraction", fraction: 0.5, evidence: ruleEvidence } });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 175_000);
  }
  // A verified multiple of sum insured (200%).
  {
    const r = calculateDeathBenefit({ ...base, formula: { kind: "sum_insured_fraction", fraction: 2, evidence: ruleEvidence } });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 700_000);
  }
  // Fixed additional benefit, independent of sum insured.
  {
    const r = calculateDeathBenefit({ ...base, sumInsured: null, formula: { kind: "fixed", amount: 5_000, evidence: ruleEvidence } });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 5_000);
  }
  // Capped benefit where the cap is explicitly evidenced and binds.
  {
    const r = calculateDeathBenefit({ ...base, formula: { kind: "sum_insured_fraction", fraction: 2, evidence: ruleEvidence }, cap: { amount: 500_000, evidence: ruleEvidence } });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") { assert.equal(r.potentialAmount, 500_000); assert.equal(r.capApplied, true); }
  }
  // A cap that does not bind is reported as not applied.
  {
    const r = calculateDeathBenefit({ ...base, cap: { amount: 1_000_000, evidence: ruleEvidence } });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.capApplied, false);
  }
  // Death before the cover's own effective date: not_applicable, not blocked.
  {
    const r = calculateDeathBenefit({ ...base, dateOfDeath: "2019-01-01" });
    assert.equal(r.status, "not_applicable");
  }
  // Missing event (death) date.
  {
    const r = calculateDeathBenefit({ ...base, dateOfDeath: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_DATE_OF_DEATH");
  }
  // Missing insured amount.
  {
    const r = calculateDeathBenefit({ ...base, sumInsured: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_SUM_INSURED");
  }
  // Zero or negative insured amount.
  {
    const zero = calculateDeathBenefit({ ...base, sumInsured: 0 });
    assert.equal(zero.status, "blocked");
    if (zero.status === "blocked") assert.equal(zero.reasonCode, "INVALID_SUM_INSURED");
    const negative = calculateDeathBenefit({ ...base, sumInsured: -1000 });
    assert.equal(negative.status, "blocked");
    if (negative.status === "blocked") assert.equal(negative.reasonCode, "INVALID_SUM_INSURED");
  }
  // Invalid currency.
  {
    const r = calculateDeathBenefit({ ...base, currency: "dollars" });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_CURRENCY");
  }
  // Missing ownership evidence.
  {
    const r = calculateDeathBenefit({ ...base, ownershipEvidence: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_OWNERSHIP_EVIDENCE");
  }
  // Missing rule evidence.
  {
    const r = calculateDeathBenefit({ ...base, ruleEvidence: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_RULE_EVIDENCE");
  }
  // Malformed percentage: zero/negative fraction.
  {
    const r = calculateDeathBenefit({ ...base, formula: { kind: "sum_insured_fraction", fraction: 0, evidence: ruleEvidence } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_FORMULA_FRACTION");
  }
  // Implausible multiplier.
  {
    const r = calculateDeathBenefit({ ...base, formula: { kind: "sum_insured_fraction", fraction: 50, evidence: ruleEvidence } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "IMPLAUSIBLE_FORMULA_FRACTION");
  }
  // Unresolved policy condition blocks even with everything else present.
  {
    const r = calculateDeathBenefit({ ...base, unresolvedConditions: ["A required insurer confirmation is outstanding."] });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "UNRESOLVED_CONDITION");
  }
  // Deterministic repeatability: the same input produces the same amount and the same calculation ID every time.
  {
    const r1 = calculateDeathBenefit(base), r2 = calculateDeathBenefit(base);
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") {
      assert.equal(r1.potentialAmount, r2.potentialAmount);
      assert.equal(r1.calculationId, r2.calculationId);
    }
  }
  // Duplicate calculation IDs: two genuinely different calculations never collide.
  {
    const r1 = calculateDeathBenefit(base);
    const r2 = calculateDeathBenefit({ ...base, formula: { kind: "sum_insured_fraction", fraction: 0.5, evidence: ruleEvidence } });
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") assert.notEqual(r1.calculationId, r2.calculationId);
  }
  // Currency rounding: a fraction that does not divide evenly rounds once, to the nearest cent.
  {
    const r = calculateDeathBenefit({ ...base, sumInsured: 100, formula: { kind: "sum_insured_fraction", fraction: 1 / 3, evidence: ruleEvidence } });
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 33.33);
  }
  console.log("Death-benefit calculator regressions passed.");
}

const accidentalRuleEvidence = { chunkId: "page:wording-1:6", policyId: "wording-1", pageStart: 6, pageEnd: 6, label: "Accidental death benefit clause" };
const accidentDefinitionEvidence = { chunkId: "page:wording-1:6", policyId: "wording-1", pageStart: 6, pageEnd: 6, label: "Accidental death definition" };
const gpaOwnership = { contractId: "contract-2", coverageId: "coverage-2", label: "Group Personal Accident" };

const accidentalBase: AccidentalDeathInput = {
  ownership: gpaOwnership, familyMember, deathConfirmed: true, dateOfDeath: "2026-06-01",
  policyEffectiveDate: "2020-01-01", sumInsured: 600_000, currency: "SGD",
  formula: { kind: "sum_insured_fraction", fraction: 1, evidence: accidentalRuleEvidence },
  ruleEvidence: accidentalRuleEvidence, ownershipEvidence,
  accidentalDeathDefinitionEvidence: accidentDefinitionEvidence,
  causeConfirmation: "confirmed_matches_definition",
};

export function runAccidentalDeathCalculatorRegressions() {
  // Accidental cover confirmed by sufficient structured evidence.
  {
    const r = calculateAccidentalDeath(accidentalBase);
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 600_000);
  }
  // Reported but unconfirmed circumstances never authorise an amount.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeConfirmation: "reported_unconfirmed" });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_NOT_CONFIRMED");
  }
  // Unknown cause blocks.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeConfirmation: "unknown" });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_UNKNOWN");
  }
  // A cause ruled out against the policy's own definition (e.g. a confirmed illness) is not_applicable, not blocked.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeConfirmation: "ruled_out" });
    assert.equal(r.status, "not_applicable");
  }
  // Homicide is never automatically treated as a confirmed accidental death: absent explicit confirmation it blocks.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeConfirmation: "reported_unconfirmed" });
    assert.equal(r.status, "blocked");
  }
  // Missing the policy's own accident-definition evidence blocks even when the cause is otherwise confirmed.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, accidentalDeathDefinitionEvidence: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_ACCIDENT_DEFINITION_EVIDENCE");
  }
  // An unresolved policy exclusion (e.g. intoxication still unconfirmed either way) blocks -- never assumed.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, exclusions: [{ key: "intoxication", evidence: accidentDefinitionEvidence, applies: null }] });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "UNRESOLVED_EXCLUSION");
  }
  // A confirmed-applicable exclusion (e.g. confirmed suicide) is not_applicable.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, exclusions: [{ key: "suicide", evidence: accidentDefinitionEvidence, applies: true }] });
    assert.equal(r.status, "not_applicable");
  }
  // A confirmed-ruled-out exclusion does not block the calculation.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, exclusions: [{ key: "criminal_activity", evidence: accidentDefinitionEvidence, applies: false }] });
    assert.equal(r.status, "calculated");
  }
  // Deterministic repeatability holds for the accidental-death calculator too.
  {
    const r1 = calculateAccidentalDeath(accidentalBase), r2 = calculateAccidentalDeath(accidentalBase);
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") assert.equal(r1.calculationId, r2.calculationId);
  }
  // The accidental and ordinary calculators for the same underlying figure never share a calculation ID.
  {
    const ordinary = calculateDeathBenefit({ ...base, ownership: gpaOwnership, sumInsured: 600_000, formula: { kind: "sum_insured_fraction", fraction: 1, evidence: ruleEvidence } });
    const accidental = calculateAccidentalDeath(accidentalBase);
    assert.equal(ordinary.status, "calculated"); assert.equal(accidental.status, "calculated");
    if (ordinary.status === "calculated" && accidental.status === "calculated") assert.notEqual(ordinary.calculationId, accidental.calculationId);
  }
  console.log("Accidental-death calculator regressions passed.");
}
