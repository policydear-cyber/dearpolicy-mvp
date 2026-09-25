import assert from "node:assert/strict";
import { calculateDeathBenefit, type DeathBenefitInput } from "@/lib/claims/calculators/death-benefit";
import { calculateAccidentalDeath, type AccidentalDeathInput } from "@/lib/claims/calculators/accidental-death";
import type { CauseDefinitionMatch } from "@/lib/claims/calculators/evidence";

const ruleEvidence = { chunkId: "page:wording-1:4", policyId: "wording-1", pageStart: 4, pageEnd: 4, label: "Death benefit clause" };
const ownershipEvidence = { chunkId: "cert:policy-1:1", policyId: "policy-1", coverageId: "coverage-1", pageStart: 1, pageEnd: 1, label: "Certificate of insurance" };
const ownership = { contractId: "contract-1", coverageId: "coverage-1", label: "Group Term Life" };
const familyMember = { id: "member-1", confirmed: true };

const base: DeathBenefitInput = {
  ownership, familyMember, claimEventId: "claim-1", deathConfirmed: true, dateOfDeath: "2026-06-01",
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
  // A cap supplied with malformed evidence blocks exactly like a missing cap.
  {
    const r = calculateDeathBenefit({ ...base, cap: { amount: 1_000_000, evidence: {} } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_CAP");
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
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_OWNERSHIP_EVIDENCE");
  }
  // An empty object is rejected as ownership evidence -- it merely exists,
  // it proves nothing. A label alone is not evidence either.
  {
    const empty = calculateDeathBenefit({ ...base, ownershipEvidence: {} });
    assert.equal(empty.status, "blocked");
    if (empty.status === "blocked") assert.equal(empty.reasonCode, "MALFORMED_OWNERSHIP_EVIDENCE");
    const labelOnly = calculateDeathBenefit({ ...base, ownershipEvidence: { label: "Certificate of insurance" } });
    assert.equal(labelOnly.status, "blocked");
    if (labelOnly.status === "blocked") assert.equal(labelOnly.reasonCode, "MALFORMED_OWNERSHIP_EVIDENCE");
  }
  // A whitespace-only ID is rejected exactly like a missing one.
  {
    const r = calculateDeathBenefit({ ...base, ownershipEvidence: { ...ownershipEvidence, coverageId: "   " } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_OWNERSHIP_EVIDENCE");
  }
  // Missing rule evidence.
  {
    const r = calculateDeathBenefit({ ...base, ruleEvidence: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_RULE_EVIDENCE");
  }
  // An empty object is rejected as rule evidence.
  {
    const r = calculateDeathBenefit({ ...base, ruleEvidence: {} });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_RULE_EVIDENCE");
  }
  // Zero, negative and reversed page ranges are all rejected as rule evidence.
  {
    const zeroPage = calculateDeathBenefit({ ...base, ruleEvidence: { ...ruleEvidence, pageStart: 0 } });
    assert.equal(zeroPage.status, "blocked");
    if (zeroPage.status === "blocked") assert.equal(zeroPage.reasonCode, "MALFORMED_RULE_EVIDENCE");
    const negativePage = calculateDeathBenefit({ ...base, ruleEvidence: { ...ruleEvidence, pageStart: -1, pageEnd: -1 } });
    assert.equal(negativePage.status, "blocked");
    if (negativePage.status === "blocked") assert.equal(negativePage.reasonCode, "MALFORMED_RULE_EVIDENCE");
    const reversed = calculateDeathBenefit({ ...base, ruleEvidence: { ...ruleEvidence, pageStart: 6, pageEnd: 4 } });
    assert.equal(reversed.status, "blocked");
    if (reversed.status === "blocked") assert.equal(reversed.reasonCode, "MALFORMED_RULE_EVIDENCE");
  }
  // A whitespace-only policy or chunk ID is rejected exactly like a missing one.
  {
    const blankPolicy = calculateDeathBenefit({ ...base, ruleEvidence: { ...ruleEvidence, policyId: "   " } });
    assert.equal(blankPolicy.status, "blocked");
    if (blankPolicy.status === "blocked") assert.equal(blankPolicy.reasonCode, "MALFORMED_RULE_EVIDENCE");
    const blankChunk = calculateDeathBenefit({ ...base, ruleEvidence: { ...ruleEvidence, chunkId: "" } });
    assert.equal(blankChunk.status, "blocked");
    if (blankChunk.status === "blocked") assert.equal(blankChunk.reasonCode, "MALFORMED_RULE_EVIDENCE");
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
  // Changing the claim event alone changes the calculation ID -- a figure
  // computed for one claim must never be mistaken for another.
  {
    const r1 = calculateDeathBenefit(base);
    const r2 = calculateDeathBenefit({ ...base, claimEventId: "claim-2" });
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") assert.notEqual(r1.calculationId, r2.calculationId);
  }
  // Changing the rule evidence reference alone changes the calculation ID.
  {
    const r1 = calculateDeathBenefit(base);
    const r2 = calculateDeathBenefit({ ...base, ruleEvidence: { ...ruleEvidence, pageStart: 9, pageEnd: 9 } });
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
const otherVersionDefinitionEvidence = { chunkId: "page:wording-2:9", policyId: "wording-2", pageStart: 9, pageEnd: 9, label: "Accidental death definition (later wording version)" };
const gpaOwnership = { contractId: "contract-2", coverageId: "coverage-2", label: "Group Personal Accident" };
const gpaOwnershipEvidence = { chunkId: "cert:policy-1:1", policyId: "policy-1", coverageId: "coverage-2", pageStart: 1, pageEnd: 1, label: "Certificate of insurance" };
const causeEvidence = { documentId: "doc-1", documentType: "police_report", pageStart: 2, pageEnd: 2, familyMemberId: "member-1", claimEventId: "claim-1" };

const validMatch: CauseDefinitionMatch = {
  familyMemberId: "member-1", claimEventId: "claim-1", contractId: "contract-2", coverageId: "coverage-2",
  causeEvidence, definitionEvidence: accidentDefinitionEvidence, result: "matches", reviewedAt: "2026-06-02",
  provenance: {
    modelExecutionId: "model-execution-1",
    operation: "claim_evidence_extraction",
    verified: true,
    resolvedModel: "gemini-3.6-flash",
    promptVersion: "claim-evidence-extract-v1",
    schemaVersion: "claim-evidence-extract-v1",
    validatorVersion: "claim-evidence-extract-v1",
    sourceDocumentId: "doc-1",
    sourceDocumentVersion: "sha256:fixture-v1",
  },
};

const accidentalBase: AccidentalDeathInput = {
  ownership: gpaOwnership, familyMember, claimEventId: "claim-1", deathConfirmed: true, dateOfDeath: "2026-06-01",
  policyEffectiveDate: "2020-01-01", sumInsured: 600_000, currency: "SGD",
  formula: { kind: "sum_insured_fraction", fraction: 1, evidence: accidentalRuleEvidence },
  ruleEvidence: accidentalRuleEvidence, ownershipEvidence: gpaOwnershipEvidence,
  accidentalDeathDefinitionEvidence: accidentDefinitionEvidence,
  causeDefinitionMatch: validMatch,
};

export function runAccidentalDeathCalculatorRegressions() {
  // Only a valid, policy-specific, confirmed match unlocks the amount.
  {
    const r = calculateAccidentalDeath(accidentalBase);
    assert.equal(r.status, "calculated");
    if (r.status === "calculated") assert.equal(r.potentialAmount, 600_000);
  }
  // No match at all -- the reported circumstance is never enough by itself.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_MISSING");
  }
  // A reviewed cause explicitly confirmed NOT to meet the definition is
  // not_applicable -- ruled out, not left pending.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, result: "does_not_match" } });
    assert.equal(r.status, "not_applicable");
  }
  // A reviewed match still pending confirmation blocks.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, result: "needs_review" } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_NOT_CONFIRMED");
  }
  // Missing the policy's own accident-definition evidence blocks even when a match is otherwise supplied.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, accidentalDeathDefinitionEvidence: null });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  }
  // An empty object is rejected as accident-definition evidence.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, accidentalDeathDefinitionEvidence: {} });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  }
  // Empty-object cause evidence is rejected.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, causeEvidence: {} } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_CAUSE_EVIDENCE");
  }
  // A whitespace-only document ID is rejected exactly like a missing one.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, causeEvidence: { ...causeEvidence, documentId: "   " } } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_CAUSE_EVIDENCE");
  }
  // A reversed page range on the cause evidence is rejected.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, causeEvidence: { ...causeEvidence, pageStart: 5, pageEnd: 2 } } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "MALFORMED_CAUSE_EVIDENCE");
  }
  // Cause evidence for another family member is rejected, even when the
  // match record's own familyMemberId claims to line up.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, causeEvidence: { ...causeEvidence, familyMemberId: "member-2" } } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_FAMILY_MEMBER_MISMATCH");
  }
  // Cause evidence for another claim event is rejected the same way.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, causeEvidence: { ...causeEvidence, claimEventId: "claim-9" } } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_CLAIM_EVENT_MISMATCH");
  }
  // A match record for another family member is rejected outright.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, familyMemberId: "member-2" } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_FAMILY_MEMBER_MISMATCH");
  }
  // A match record for another claim event is rejected outright.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, claimEventId: "claim-9" } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_CLAIM_EVENT_MISMATCH");
  }
  // A match confirmed for a different policy (Policy A) can never unlock this one (Policy B).
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, contractId: "contract-9" } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_CONTRACT_MISMATCH");
  }
  // A match confirmed for a different cover under the same policy is rejected too.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, coverageId: "coverage-9" } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_COVERAGE_MISMATCH");
  }
  // A match checked against an earlier or different wording version can never unlock the current version.
  {
    const r = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, definitionEvidence: otherVersionDefinitionEvidence } });
    assert.equal(r.status, "blocked");
    if (r.status === "blocked") assert.equal(r.reasonCode, "CAUSE_MATCH_DEFINITION_MISMATCH");
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
  // Changing the cause evidence reference alone changes the calculation ID.
  {
    const r1 = calculateAccidentalDeath(accidentalBase);
    const r2 = calculateAccidentalDeath({ ...accidentalBase, causeDefinitionMatch: { ...validMatch, causeEvidence: { ...causeEvidence, documentId: "doc-2" } } });
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") assert.notEqual(r1.calculationId, r2.calculationId);
  }
  // The accidental and ordinary calculators for the same underlying figure never share a calculation ID.
  {
    const ordinary = calculateDeathBenefit({ ...base, ownership: gpaOwnership, ownershipEvidence: gpaOwnershipEvidence, sumInsured: 600_000, formula: { kind: "sum_insured_fraction", fraction: 1, evidence: ruleEvidence } });
    const accidental = calculateAccidentalDeath(accidentalBase);
    assert.equal(ordinary.status, "calculated"); assert.equal(accidental.status, "calculated");
    if (ordinary.status === "calculated" && accidental.status === "calculated") assert.notEqual(ordinary.calculationId, accidental.calculationId);
  }
  console.log("Accidental-death calculator regressions passed.");
}
