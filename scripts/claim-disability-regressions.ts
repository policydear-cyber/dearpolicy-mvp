/**
 * Regression suite for the deterministic disability-claim engine (Total &
 * Permanent Disability, permanent-partial-disability/dismemberment paid
 * from a schedule of injuries, disability income, and the non-monetary
 * premium-waiver status): lib/claims/calculators/disability-benefit.ts,
 * lib/claims/calculators/disability-income.ts, lib/claims/disability-
 * evidence.ts, lib/claims/disability-rules.ts, and the disability-specific
 * additions to lib/claims/composition/engine.ts (benefitCategoryFor's
 * "Disability" branch and the same-policy TPD/schedule blocking pass).
 *
 * Six parts, following the same pattern as scripts/claim-medical-
 * regressions.ts and scripts/claim-ci-regressions.ts:
 *  1. Pure-function tests for calculateDisabilityBenefit() with
 *     benefitKind "tpd" -- every fail-closed branch, including the
 *     definition-match gate that is this PR's core safety boundary
 *     ("never autonomously decide permanent disability": no amount
 *     without an already-confirmed DisabilityDefinitionMatch scoped to
 *     the fixed TOTAL_PERMANENT_DISABILITY_MATCH_KEY sentinel).
 *  2. Pure-function tests for calculateDisabilityBenefit() with
 *     benefitKind "schedule" -- this PR's OTHER core safety boundary
 *     ("strict injury-schedule matching"): a match confirmed for one
 *     exact schedule row can never unlock a different row, even when both
 *     rows exist under the very same policy and claim, and there is no
 *     fuzzy/substring comparison anywhere in the calculator between an
 *     injury description and a schedule row.
 *  3. Pure-function tests for calculateDisabilityIncome() -- the
 *     deferred-period/benefit-period-remaining arithmetic and its own
 *     definition-match gate.
 *  4. Pure-function tests for lib/claims/disability-evidence.ts's
 *     findDisabilityRules() -- TPD percentage extraction, multi-row
 *     schedule-of-injuries extraction with stable row codes, a flat
 *     monthly disability-income amount, and that discretionary language
 *     ("may pay up to...") is never read as a firm rule.
 *  5. Pure-function tests for lib/claims/disability-rules.ts's
 *     assessDisabilityClaim()/nextDisabilityQuestion() -- evidence gating,
 *     the single combined schedule-review fallback item (never one item
 *     per unreviewed row), and the premium-waiver status item.
 *  6. Composition-engine tests confirming the disability-specific
 *     additions: "tpd-*"/"ppd-*"/"di-*"/"premium-waiver" benefit codes
 *     categorise as "Disability", and a same-policy TPD + schedule group
 *     with no evidenced relationship is blocked
 *     (DISABILITY_COMPOSITION_NOT_EVIDENCED) rather than silently added,
 *     while a standalone disability benefit still composes normally.
 */
import assert from "node:assert/strict";

import {
  calculateDisabilityBenefit, TOTAL_PERMANENT_DISABILITY_MATCH_KEY, type DisabilityBenefitInput, type DisabilityDefinitionMatch as _Unused,
} from "@/lib/claims/calculators/disability-benefit";
import { calculateDisabilityIncome, DISABILITY_INCOME_MATCH_KEY, type DisabilityIncomeInput } from "@/lib/claims/calculators/disability-income";
import { findDisabilityRules, resolveDisabilityEvidence, type DisabilityWordingPage } from "@/lib/claims/disability-evidence";
import { assessDisabilityClaim, nextDisabilityQuestion, type DisabilityRuleSet } from "@/lib/claims/disability-rules";
import type { DisabilityRuleEvidence } from "@/lib/claims/disability-evidence";
import { composeClaim } from "@/lib/claims/composition/engine";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimEvidence, type ClaimFacts } from "@/lib/claims/types";
import type { DisabilityDefinitionMatch } from "@/lib/claims/calculators/evidence";
import type { OwnedCoverage } from "@/lib/coverage/facts";

let cases = 0;
function test(name: string, fn: () => void) {
  try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

// ---------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------

const FM = "fam-1";
const CLAIM = "claim-1";
const POLICY = "policy-1";
const POLICY_B = "policy-2";
const COVERAGE = "cov-1";
const CCY = "SGD";
const LEG_LOSS_CODE = "loss_of_one_limb";
const ARM_FRACTURE_CODE = "fractured_arm_with_non_union";

function citation(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return { chunkId: "page:policy-1:20", policyId: POLICY, policyName: "GPA Wording", pageStart: 20, pageEnd: 20, evidenceLabel: "TPD wording", ...overrides };
}
function ref(overrides: Record<string, unknown> = {}) {
  return { chunkId: "page:policy-1:20", policyId: POLICY, pageStart: 20, pageEnd: 20, ...overrides };
}
function ownershipEvidence(): { policyId: string; chunkId: string; coverageId: string; familyMemberId: string } {
  return { policyId: POLICY, chunkId: `coverage:${COVERAGE}`, coverageId: COVERAGE, familyMemberId: FM };
}
function coverage(overrides: Partial<OwnedCoverage> = {}): OwnedCoverage {
  return {
    id: COVERAGE, policyId: POLICY, familyMemberId: FM, category: "Personal Accident", amount: 100_000, currency: CCY,
    productName: "Group Personal Accident", sourcePage: 1, evidenceText: null, insurer: "Great Eastern", policyName: "GPA Plan",
    policyNumber: "P-001", groupPolicyNumber: "G007500", documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null,
    ...overrides,
  };
}
function baseFacts(overrides: Partial<ClaimFacts> = {}): ClaimFacts {
  return { ...EMPTY_CLAIM_FACTS, eventType: "disability", ...overrides };
}
function tpdMatch(overrides: Partial<DisabilityDefinitionMatch> = {}): DisabilityDefinitionMatch {
  return {
    familyMemberId: FM, claimEventId: CLAIM, contractId: POLICY, coverageId: COVERAGE, benefitCode: "tpd-lump-sum",
    matchKey: TOTAL_PERMANENT_DISABILITY_MATCH_KEY,
    medicalEvidence: { documentId: "doc-1", documentType: "specialist_memo", familyMemberId: FM, claimEventId: CLAIM, pageStart: 3, pageEnd: 3 },
    definitionEvidence: { policyId: POLICY, chunkId: "page:policy-1:20", pageStart: 20, pageEnd: 20 },
    result: "matches", reviewedAt: "2024-01-01T00:00:00.000Z", ...overrides,
  };
}
function scheduleMatch(overrides: Partial<DisabilityDefinitionMatch> = {}): DisabilityDefinitionMatch {
  return { ...tpdMatch(), benefitCode: "ppd-schedule", matchKey: LEG_LOSS_CODE, ...overrides };
}
function tpdInput(overrides: Partial<DisabilityBenefitInput> = {}): DisabilityBenefitInput {
  return {
    benefitKind: "tpd", ownership: { contractId: POLICY, coverageId: COVERAGE }, familyMember: { id: FM, confirmed: true },
    claimEventId: CLAIM, benefitCode: "tpd-lump-sum", scheduleRowCode: null, disabilityDate: "2024-02-01",
    policyEffectiveDate: "2020-01-01", sumInsured: 100_000, currency: CCY,
    formula: { kind: "sum_insured_fraction", fraction: 1.5, evidence: ref() },
    ruleEvidence: ref(), ownershipEvidence: ownershipEvidence(), definitionEvidence: ref(),
    definitionMatch: tpdMatch(), ...overrides,
  };
}
function scheduleInput(overrides: Partial<DisabilityBenefitInput> = {}): DisabilityBenefitInput {
  return {
    ...tpdInput(), benefitKind: "schedule", benefitCode: "ppd-schedule", scheduleRowCode: LEG_LOSS_CODE,
    formula: { kind: "schedule_percentage", scheduleRowCode: LEG_LOSS_CODE, fraction: 1, evidence: ref() },
    definitionMatch: scheduleMatch(), ...overrides,
  };
}
function incomeInput(overrides: Partial<DisabilityIncomeInput> = {}): DisabilityIncomeInput {
  return {
    monthlyBenefitAmount: 2000, currency: CCY, ownership: { contractId: POLICY, coverageId: COVERAGE },
    familyMember: { id: FM, confirmed: true }, claimEventId: CLAIM, benefitCode: "di-monthly",
    deferredPeriodMonths: 1, maximumBenefitMonths: 12, monthsAlreadyPaid: 0, completedMonthsClaimed: 3,
    ownershipEvidence: ownershipEvidence(), ruleEvidence: ref(), definitionEvidence: ref(),
    definitionMatch: { ...tpdMatch(), benefitCode: "di-monthly", matchKey: DISABILITY_INCOME_MATCH_KEY }, ...overrides,
  };
}

// ---------------------------------------------------------------------
// Part 1: calculateDisabilityBenefit -- benefitKind "tpd"
// ---------------------------------------------------------------------

test("tpd: missing ownership blocks", () => {
  const r = calculateDisabilityBenefit(tpdInput({ ownership: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_OWNERSHIP_MAPPING");
});

test("tpd: unconfirmed family member blocks", () => {
  const r = calculateDisabilityBenefit(tpdInput({ familyMember: { id: FM, confirmed: false } }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "FAMILY_MEMBER_NOT_CONFIRMED");
});

test("tpd: missing disability date blocks", () => {
  const r = calculateDisabilityBenefit(tpdInput({ disabilityDate: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_DISABILITY_DATE");
});

test("tpd: a schedule formula can never be used for a tpd calculation", () => {
  const r = calculateDisabilityBenefit(tpdInput({ formula: { kind: "schedule_percentage", scheduleRowCode: LEG_LOSS_CODE, fraction: 1, evidence: ref() } }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "BENEFIT_KIND_FORMULA_MISMATCH");
});

test("tpd: a schedule row code supplied for a tpd calculation is rejected", () => {
  const r = calculateDisabilityBenefit(tpdInput({ scheduleRowCode: LEG_LOSS_CODE }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "UNEXPECTED_SCHEDULE_ROW_CODE");
});

test("tpd: no definition match at all always blocks -- DearPolicy never decides permanence itself", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_MISSING");
});

test("tpd: a match reviewed for a different family member never unlocks this one", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: tpdMatch({ familyMemberId: "someone-else" }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH");
});

test("tpd: a match reviewed for a different policy never unlocks this one", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: tpdMatch({ contractId: POLICY_B }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_CONTRACT_MISMATCH");
});

test("tpd: a match reviewed against a DIFFERENT schedule row's match key never unlocks TPD (safety boundary 1)", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: tpdMatch({ matchKey: LEG_LOSS_CODE }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_KEY_MISMATCH");
});

test("tpd: a match whose definition evidence is a different page than this calculation's own definition never unlocks it", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: tpdMatch({ definitionEvidence: { policyId: POLICY, chunkId: "page:policy-1:20", pageStart: 45, pageEnd: 45 } }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH");
});

test("tpd: does_not_match is not_applicable, never blocked, never an amount", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: tpdMatch({ result: "does_not_match" }) }));
  assert.equal(r.status, "not_applicable");
});

test("tpd: needs_medical_review is blocked, not a silent not_applicable", () => {
  const r = calculateDisabilityBenefit(tpdInput({ definitionMatch: tpdMatch({ result: "needs_medical_review" }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_NOT_CONFIRMED");
});

test("tpd: a confirmed match calculates 150% of sum insured", () => {
  const r = calculateDisabilityBenefit(tpdInput());
  assert.equal(r.status, "calculated");
  if (r.status === "calculated") { assert.equal(r.potentialAmount, 150_000); assert.equal(r.currency, CCY); assert.ok(r.calculationId.startsWith("tpd:")); }
});

test("tpd: a fixed formula pays the fixed amount", () => {
  const r = calculateDisabilityBenefit(tpdInput({ formula: { kind: "fixed", amount: 75_000, evidence: ref() } }));
  assert.equal(r.status, "calculated");
  if (r.status === "calculated") assert.equal(r.potentialAmount, 75_000);
});

test("tpd: a cap lower than the computed amount is applied", () => {
  const r = calculateDisabilityBenefit(tpdInput({ cap: { amount: 120_000, evidence: ref() } }));
  assert.equal(r.status, "calculated");
  if (r.status === "calculated") { assert.equal(r.potentialAmount, 120_000); assert.equal(r.capApplied, true); }
});

test("tpd: within the waiting period is not_applicable", () => {
  const r = calculateDisabilityBenefit(tpdInput({ waitingPeriod: { days: 90, fromDate: "2024-01-15", evidence: ref() }, disabilityDate: "2024-02-01" }));
  assert.equal(r.status, "not_applicable");
});

test("tpd: an unresolved exclusion blocks", () => {
  const r = calculateDisabilityBenefit(tpdInput({ exclusions: [{ key: "self_inflicted_injury", evidence: ref(), applies: null }] }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "UNRESOLVED_EXCLUSION");
});

test("tpd: a confirmed-applicable exclusion is not_applicable", () => {
  const r = calculateDisabilityBenefit(tpdInput({ exclusions: [{ key: "pre_existing_condition", evidence: ref(), applies: true }] }));
  assert.equal(r.status, "not_applicable");
});

test("tpd: calculationId is stable for identical inputs and changes when the amount-affecting input changes", () => {
  const a = calculateDisabilityBenefit(tpdInput());
  const b = calculateDisabilityBenefit(tpdInput());
  const c = calculateDisabilityBenefit(tpdInput({ formula: { kind: "sum_insured_fraction", fraction: 2, evidence: ref() } }));
  assert.equal(a.status, "calculated"); assert.equal(b.status, "calculated"); assert.equal(c.status, "calculated");
  if (a.status === "calculated" && b.status === "calculated" && c.status === "calculated") {
    assert.equal(a.calculationId, b.calculationId);
    assert.notEqual(a.calculationId, c.calculationId);
  }
});

// ---------------------------------------------------------------------
// Part 2: calculateDisabilityBenefit -- benefitKind "schedule" (strict
// injury-schedule matching, this PR's other core safety boundary)
// ---------------------------------------------------------------------

test("schedule: a fixed/sum-insured-fraction formula can never be used for a schedule calculation", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ formula: { kind: "fixed", amount: 1000, evidence: ref() } }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "BENEFIT_KIND_FORMULA_MISMATCH");
});

test("schedule: a missing scheduleRowCode blocks", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ scheduleRowCode: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "MISSING_SCHEDULE_ROW_CODE");
});

test("schedule: the formula's own row code must agree with the calculation's row code", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ formula: { kind: "schedule_percentage", scheduleRowCode: ARM_FRACTURE_CODE, fraction: 0.2, evidence: ref() } }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "SCHEDULE_ROW_MISMATCH");
});

test("schedule: a match confirmed for a DIFFERENT schedule row can never unlock this one (strict matching, never fuzzy)", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ definitionMatch: scheduleMatch({ matchKey: ARM_FRACTURE_CODE }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_KEY_MISMATCH");
});

test("schedule: a match confirmed for the TPD match key can never unlock a schedule row", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ definitionMatch: scheduleMatch({ matchKey: TOTAL_PERMANENT_DISABILITY_MATCH_KEY }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_KEY_MISMATCH");
});

test("schedule: matching casing/whitespace of the exact same row code still unlocks (trim/case-fold only, never fuzzy)", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ scheduleRowCode: "  Loss_Of_One_Limb  " as string, formula: { kind: "schedule_percentage", scheduleRowCode: "loss_of_one_limb", fraction: 1, evidence: ref() } }));
  assert.equal(r.status, "calculated");
});

test("schedule: a confirmed match for the correct row calculates the exact evidenced percentage", () => {
  const r = calculateDisabilityBenefit(scheduleInput({ formula: { kind: "schedule_percentage", scheduleRowCode: LEG_LOSS_CODE, fraction: 0.2, evidence: ref() } }));
  assert.equal(r.status, "calculated");
  if (r.status === "calculated") { assert.equal(r.potentialAmount, 20_000); assert.ok(r.calculationId.startsWith("ppd:")); }
});

// ---------------------------------------------------------------------
// Part 3: calculateDisabilityIncome
// ---------------------------------------------------------------------

test("income: invalid monthly amount blocks", () => {
  const r = calculateDisabilityIncome(incomeInput({ monthlyBenefitAmount: 0 }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_MONTHLY_AMOUNT");
});

test("income: months-already-paid must be explicitly verified, never defaulted", () => {
  const r = calculateDisabilityIncome(incomeInput({ monthsAlreadyPaid: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_MONTHS_ALREADY_PAID");
});

test("income: completed-months-claimed must be verified, never a chat estimate", () => {
  const r = calculateDisabilityIncome(incomeInput({ completedMonthsClaimed: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "INVALID_COMPLETED_MONTHS");
});

test("income: no definition match blocks -- DearPolicy never decides ongoing incapacity itself", () => {
  const r = calculateDisabilityIncome(incomeInput({ definitionMatch: null }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_MISSING");
});

test("income: a match confirmed for the TPD key can never unlock disability income", () => {
  const r = calculateDisabilityIncome(incomeInput({ definitionMatch: tpdMatch({ benefitCode: "di-monthly" }) }));
  assert.equal(r.status, "blocked");
  if (r.status === "blocked") assert.equal(r.reasonCode, "DEFINITION_MATCH_KEY_MISMATCH");
});

test("income: does_not_match is not_applicable", () => {
  const r = calculateDisabilityIncome(incomeInput({ definitionMatch: { ...tpdMatch(), benefitCode: "di-monthly", matchKey: DISABILITY_INCOME_MATCH_KEY, result: "does_not_match" } }));
  assert.equal(r.status, "not_applicable");
});

test("income: payableMonths = min(max - alreadyPaid, claimed - deferred)", () => {
  const r = calculateDisabilityIncome(incomeInput({ deferredPeriodMonths: 1, completedMonthsClaimed: 4, monthsAlreadyPaid: 0, maximumBenefitMonths: 12 }));
  assert.equal(r.status, "calculated");
  if (r.status === "calculated") { assert.equal(r.payableMonths, 3); assert.equal(r.potentialAmount, 6000); }
});

test("income: still within the deferred period is not_applicable, never a $0 calculated result", () => {
  const r = calculateDisabilityIncome(incomeInput({ deferredPeriodMonths: 3, completedMonthsClaimed: 2 }));
  assert.equal(r.status, "not_applicable");
  if (r.status === "not_applicable") assert.equal(r.payableMonths, 0);
});

test("income: an already-exhausted benefit period is not_applicable", () => {
  const r = calculateDisabilityIncome(incomeInput({ maximumBenefitMonths: 6, monthsAlreadyPaid: 6 }));
  assert.equal(r.status, "not_applicable");
});

test("income: prior months paid reduce the remaining payable months", () => {
  const r = calculateDisabilityIncome(incomeInput({ maximumBenefitMonths: 6, monthsAlreadyPaid: 5, deferredPeriodMonths: 0, completedMonthsClaimed: 4 }));
  assert.equal(r.status, "calculated");
  if (r.status === "calculated") assert.equal(r.payableMonths, 1);
});

// ---------------------------------------------------------------------
// Part 4: lib/claims/disability-evidence.ts -- wording extraction
// ---------------------------------------------------------------------

function wordingPage(text: string, overrides: Partial<DisabilityWordingPage> = {}): DisabilityWordingPage {
  return { policy_id: POLICY, page_number: 20, text, group_policy_number: "G007500", insurer: "Great Eastern", product_name: "GPA Plan", original_filename: "gpa.pdf", document_role: "policy_wording", personal_coverage_confirmed: false, linked_to_member: true, ...overrides };
}

test("evidence: extracts a TPD percentage-of-sum-insured clause", () => {
  const rules = findDisabilityRules([wordingPage("Total and Permanent Disability: 150% of Sum Insured will be paid if the Insured Person suffers Total and Permanent Disability within 365 days of the Accident.")]);
  const tpd = rules.find((r) => r.benefitCode === "tpd-lump-sum");
  assert.ok(tpd);
  assert.equal(tpd!.formula.kind, "sum_insured_fraction");
  if (tpd!.formula.kind === "sum_insured_fraction") assert.equal(tpd!.formula.fraction, 1.5);
  assert.equal(tpd!.matchKey, TOTAL_PERMANENT_DISABILITY_MATCH_KEY);
});

test("evidence: discretionary TPD wording is never read as a firm rule", () => {
  const rules = findDisabilityRules([wordingPage("Total and Permanent Disability: the Company may pay up to 150% of Sum Insured at its discretion.")]);
  assert.equal(rules.some((r) => r.benefitCode === "tpd-lump-sum"), false);
});

test("evidence: extracts multiple named schedule-of-injuries rows with stable, distinct codes", () => {
  const text = "Schedule of Compensation\nLoss of one limb - 100%\nFractured arm with established non-union - 20%\nShortening of leg by at least 5cm - 10%\n";
  const rules = findDisabilityRules([wordingPage(text)]);
  const rows = rules.filter((r) => r.benefitCode === "ppd-schedule");
  assert.equal(rows.length, 3);
  const codes = new Set(rows.map((r) => r.matchKey));
  assert.equal(codes.size, 3);
  const lossRow = rows.find((r) => /loss of one limb/i.test(r.label));
  assert.ok(lossRow);
  if (lossRow!.formula.kind === "schedule_percentage") assert.equal(lossRow!.formula.fraction, 1);
});

test("evidence: re-reading unchanged wording produces the exact same schedule-row codes (stable across turns)", () => {
  const text = "Schedule of Compensation\nLoss of one limb - 100%\n";
  const a = findDisabilityRules([wordingPage(text)]);
  const b = findDisabilityRules([wordingPage(text)]);
  assert.equal(a.find((r) => r.benefitCode === "ppd-schedule")?.matchKey, b.find((r) => r.benefitCode === "ppd-schedule")?.matchKey);
});

test("evidence: extracts a flat monthly disability-income amount plus deferred/maximum periods", () => {
  const text = "Disability Income Benefit: a monthly benefit of S$2,000 is payable after a deferred period of 30 days, payable for up to 12 months.";
  const rules = findDisabilityRules([wordingPage(text)]);
  const income = rules.find((r) => r.benefitCode === "di-monthly");
  assert.ok(income);
  assert.equal(income!.formula.kind, "fixed");
  if (income!.formula.kind === "fixed") assert.equal(income!.formula.amount, 2000);
  assert.equal(income!.deferredPeriodMonths, 1);
  assert.equal(income!.maximumBenefitMonths, 12);
});

test("evidence: resolveDisabilityEvidence scopes rules to the confirmed coverage's own document", () => {
  const pages = [wordingPage("Total and Permanent Disability: 150% of Sum Insured will be paid.")];
  const { rules, gaps } = resolveDisabilityEvidence([coverage()], pages);
  assert.ok(rules.some((r) => r.coverageId === COVERAGE));
  assert.equal(gaps.length, 0);
});

test("evidence: no matching document produces a gap, never a guessed rule", () => {
  const { rules, gaps } = resolveDisabilityEvidence([coverage()], []);
  assert.equal(rules.length, 0);
  assert.equal(gaps[0]?.reasonCode, "NO_MATCHING_DOCUMENT");
});

// ---------------------------------------------------------------------
// Part 5: lib/claims/disability-rules.ts
// ---------------------------------------------------------------------

function disabilityRule(overrides: Partial<DisabilityRuleEvidence> = {}): DisabilityRuleEvidence {
  return {
    coverageId: COVERAGE, benefitCode: "tpd-lump-sum", matchKey: TOTAL_PERMANENT_DISABILITY_MATCH_KEY, label: "Total & Permanent Disability",
    quote: "150% of Sum Insured", formula: { kind: "sum_insured_fraction", fraction: 1.5 }, citation: citation(), ...overrides,
  };
}

test("assess: no disability wording at all produces no items", () => {
  const items = assessDisabilityClaim(baseFacts(), [coverage()], { rules: [], gaps: [] }, CLAIM);
  assert.equal(items.length, 0);
});

test("assess: a TPD rule with no reviewed match is needs_document, with no amount", () => {
  const items = assessDisabilityClaim(baseFacts(), [coverage()], { rules: [disabilityRule()], gaps: [] }, CLAIM);
  const tpd = items.find((i) => i.id === "tpd-lump-sum");
  assert.ok(tpd);
  assert.equal(tpd!.status, "needs_document");
  assert.equal(tpd!.amountText, null);
  assert.equal(tpd!.calculatedAmount, undefined);
});

test("assess: a TPD rule with a confirmed match produces a real potential amount", () => {
  const facts = baseFacts({ eventDate: "2024-02-01", disabilityDefinitionMatches: [tpdMatch()] });
  const items = assessDisabilityClaim(facts, [coverage()], { rules: [disabilityRule()], gaps: [] }, CLAIM);
  const tpd = items.find((i) => i.id === "tpd-lump-sum");
  assert.equal(tpd?.status, "potentially_applicable");
  assert.equal(tpd?.calculatedAmount, 150_000);
});

test("assess: multiple unreviewed schedule rows collapse into ONE combined review item, never one per row", () => {
  const rules: DisabilityRuleEvidence[] = [
    disabilityRule({ benefitCode: "ppd-schedule", matchKey: LEG_LOSS_CODE, label: "Loss of one limb", formula: { kind: "schedule_percentage", scheduleRowCode: LEG_LOSS_CODE, fraction: 1 } }),
    disabilityRule({ benefitCode: "ppd-schedule", matchKey: ARM_FRACTURE_CODE, label: "Fractured arm with non-union", formula: { kind: "schedule_percentage", scheduleRowCode: ARM_FRACTURE_CODE, fraction: 0.2 } }),
  ];
  const items = assessDisabilityClaim(baseFacts(), [coverage()], { rules, gaps: [] }, CLAIM);
  const scheduleItems = items.filter((i) => i.id.startsWith("ppd-schedule"));
  assert.equal(scheduleItems.length, 1);
  assert.equal(scheduleItems[0].id, "ppd-schedule-review");
  assert.equal(scheduleItems[0].status, "needs_document");
});

test("assess: once one schedule row is reviewed, only that row's own item is shown (with its own real amount)", () => {
  const rules: DisabilityRuleEvidence[] = [
    disabilityRule({ benefitCode: "ppd-schedule", matchKey: LEG_LOSS_CODE, label: "Loss of one limb", formula: { kind: "schedule_percentage", scheduleRowCode: LEG_LOSS_CODE, fraction: 1 } }),
    disabilityRule({ benefitCode: "ppd-schedule", matchKey: ARM_FRACTURE_CODE, label: "Fractured arm with non-union", formula: { kind: "schedule_percentage", scheduleRowCode: ARM_FRACTURE_CODE, fraction: 0.2 } }),
  ];
  const facts = baseFacts({ eventDate: "2024-02-01", disabilityDefinitionMatches: [scheduleMatch()] });
  const items = assessDisabilityClaim(facts, [coverage()], { rules, gaps: [] }, CLAIM);
  const scheduleItems = items.filter((i) => i.id.startsWith("ppd-schedule"));
  assert.equal(scheduleItems.length, 1);
  assert.equal(scheduleItems[0].id, `ppd-schedule-${LEG_LOSS_CODE}`);
  assert.equal(scheduleItems[0].calculatedAmount, 100_000);
});

test("assess: premium waiver shows likely_applicable, non-monetary, once TPD is confirmed matching", () => {
  const facts = baseFacts({ disabilityDefinitionMatches: [tpdMatch()] });
  const items = assessDisabilityClaim(facts, [coverage()], { rules: [disabilityRule()], gaps: [] }, CLAIM);
  const waiver = items.find((i) => i.id === "premium-waiver");
  assert.equal(waiver?.status, "likely_applicable");
  assert.equal(waiver?.amountText, null);
  assert.equal(waiver?.calculatedAmount, undefined);
});

test("assess: premium waiver is needs_document, not likely_applicable, before any TPD review", () => {
  const items = assessDisabilityClaim(baseFacts(), [coverage()], { rules: [disabilityRule()], gaps: [] }, CLAIM);
  const waiver = items.find((i) => i.id === "premium-waiver");
  assert.equal(waiver?.status, "needs_document");
});

test("assess: premium waiver disappears once TPD is confirmed NOT to match", () => {
  const facts = baseFacts({ disabilityDefinitionMatches: [tpdMatch({ result: "does_not_match" })] });
  const items = assessDisabilityClaim(facts, [coverage()], { rules: [disabilityRule()], gaps: [] }, CLAIM);
  assert.equal(items.some((i) => i.id === "premium-waiver"), false);
});

test("nextDisabilityQuestion: no rules -> no question", () => {
  assert.equal(nextDisabilityQuestion(baseFacts(), { rules: [], gaps: [] }), null);
});

test("nextDisabilityQuestion: rules present, availability unknown -> asks for availability", () => {
  const q = nextDisabilityQuestion(baseFacts(), { rules: [disabilityRule()], gaps: [] });
  assert.equal(q?.id, "disability_assessment_document");
});

test("nextDisabilityQuestion: available but not yet reviewed -> asks for upload", () => {
  const facts = baseFacts({ disabilityAssessmentDocumentAvailable: true });
  const q = nextDisabilityQuestion(facts, { rules: [disabilityRule()], gaps: [] });
  assert.equal(q?.id, "disability_assessment_document_upload");
});

test("nextDisabilityQuestion: reviewed -> no further question from this module", () => {
  const facts = baseFacts({ disabilityAssessmentDocumentAvailable: true, disabilityAssessmentEvidenceReviewed: true });
  assert.equal(nextDisabilityQuestion(facts, { rules: [disabilityRule()], gaps: [] }), null);
});

// ---------------------------------------------------------------------
// Part 6: composition engine -- disability-specific additions
// ---------------------------------------------------------------------

function assessmentItem(overrides: Partial<ClaimAssessmentItem> = {}): ClaimAssessmentItem {
  return {
    id: "tpd-lump-sum", title: "Total & Permanent Disability", status: "potentially_applicable", amountText: "S$150,000.00",
    reason: "test fixture", conditions: [], evidenceTerms: [], productName: "Group Personal Accident", coverageId: COVERAGE,
    calculatedAmount: 150_000, currency: CCY, calculationId: "tpd:test-" + Math.random().toString(36).slice(2),
    ruleEvidence: citation(), monetaryDecision: { status: "allowed" }, ...overrides,
  };
}
function composeArgs(assessments: ClaimAssessmentItem[], coverages: OwnedCoverage[]) {
  return { claimEventId: CLAIM, familyMemberId: FM, facts: baseFacts(), coverages, assessments, wordingPages: [] };
}

test("composition: a 'tpd-*' benefit code categorises as Disability", () => {
  const result = composeClaim(composeArgs([assessmentItem()], [coverage()]));
  const benefit = result.policies.flatMap((p) => p.benefits).find((b) => b.benefitCode === "tpd-lump-sum");
  assert.equal(benefit?.benefitCategory, "Disability");
});

test("composition: a same-policy TPD + schedule group with no evidenced relationship is blocked, never silently added", () => {
  const tpd = assessmentItem({ id: "tpd-lump-sum", calculationId: "tpd:a" });
  const schedule = assessmentItem({ id: `ppd-schedule-${LEG_LOSS_CODE}`, calculatedAmount: 100_000, calculationId: "ppd:a" });
  const result = composeClaim(composeArgs([tpd, schedule], [coverage()]));
  const benefits = result.policies.flatMap((p) => p.benefits);
  for (const b of benefits) {
    assert.equal(b.status, "blocked");
    assert.ok(b.blockedReasonCodes.includes("DISABILITY_COMPOSITION_NOT_EVIDENCED"));
  }
  assert.equal(result.totalsByCurrency.find((t) => t.currency === CCY)?.includedAmount ?? 0, 0);
});

test("composition: a standalone TPD benefit (no competing schedule benefit under the same policy) composes normally", () => {
  const result = composeClaim(composeArgs([assessmentItem()], [coverage()]));
  const benefit = result.policies.flatMap((p) => p.benefits).find((b) => b.benefitCode === "tpd-lump-sum");
  assert.equal(benefit?.status, "included");
  assert.equal(result.totalsByCurrency.find((t) => t.currency === CCY)?.includedAmount, 150_000);
});

test("composition: a non-monetary premium-waiver item (no calculatedAmount) is never composed into a total", () => {
  const waiver: ClaimAssessmentItem = { id: "premium-waiver", title: "Premium Waiver", status: "likely_applicable", amountText: null, reason: "test", conditions: [], evidenceTerms: [], productName: "Group Personal Accident", coverageId: COVERAGE, ruleEvidence: citation() };
  const result = composeClaim(composeArgs([assessmentItem(), waiver], [coverage()]));
  // Non-monetary items are filtered out before composition entirely (no
  // calculatedAmount/currency/coverageId triple) -- only the real TPD
  // amount should ever appear.
  assert.equal(result.policies.flatMap((p) => p.benefits).length, 1);
});

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------

console.log(`claim-disability-regressions: ${cases} cases passed.`);
