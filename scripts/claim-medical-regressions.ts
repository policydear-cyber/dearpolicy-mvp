/**
 * Regression suite for the deterministic medical-claim engine (hospital
 * cash, ICU cash, and reimbursement-type benefits): lib/claims/day-count.ts,
 * lib/claims/calculators/hospital-cash.ts, lib/claims/calculators/
 * medical-reimbursement.ts, lib/claims/medical-rules.ts, and the
 * medical-specific additions to lib/claims/composition/engine.ts
 * (benefitCategoryFor's "Medical" branch and the cross-policy
 * reimbursement-coordination blocking pass).
 *
 * Five parts, following the same pattern as scripts/claim-ci-regressions.ts:
 *  1. Pure-function tests for computeHospitalDays() -- every fail-closed
 *     branch (missing admission date, ongoing stay, no timezone offset,
 *     invalid range, missing rule/edge-inclusion/waiting-days, an ICU
 *     period outside the admission range) plus calendar-day vs.
 *     completed-24h-period arithmetic, edge inclusion, replacing vs.
 *     adding ICU nights, and a UTC-consistency check across timezone
 *     offsets (same instant, different offset notation).
 *  2. Pure-function tests for calculateHospitalCash() -- the day-cap
 *     formula, the not_applicable-never-$0 rule, and calculation identity.
 *  3. Pure-function tests for calculateMedicalReimbursement() -- category
 *     limits (bill exceeding cap, benefit exceeding bill), ward proration,
 *     panel restriction, the deductible-then-co-insurance vs. reverse-order
 *     block, third-party coordination, remaining (annual/lifetime) limits,
 *     and the invariant that the estimate never exceeds the verified
 *     eligible billed expense.
 *  4. Pure-function tests for lib/claims/medical-rules.ts's
 *     assessMedicalClaim() and nextMedicalQuestion() -- evidence gating,
 *     the ICU-days-not-yet-extracted V1 limitation, the waiting-period
 *     not-applicable wording, currency-mismatch blocking, and the
 *     ward-proration caveat.
 *  5. Composition-engine tests confirming the medical-specific additions:
 *     "med-*" benefit codes categorise as "Medical", and two different
 *     policies each independently reimbursement-eligible for the same
 *     claim event are blocked (REIMBURSEMENT_COORDINATION_NOT_EVIDENCED)
 *     rather than silently added, while hospital cash and a reimbursement
 *     benefit under ONE policy still compose together normally.
 *
 * This suite intentionally does not re-test lib/claims/medical-evidence.ts's
 * own regex wording extraction (findMedicalRules/findPlanProvisions) or
 * add a PGlite-backed test for lib/claims/evidence/medical-bill-evidence.ts
 * -- both reuse already-regression-tested generic machinery (the same
 * tiered evidence-resolution pattern as death-evidence.ts/ci-evidence.ts,
 * and the same generic claim-evidence pipeline as ci-matches.ts), and this
 * PR's own limitations section documents that as a scoping decision, not
 * an oversight.
 */
import assert from "node:assert/strict";

import { computeHospitalDays, type DayCountInput } from "@/lib/claims/day-count";
import { calculateHospitalCash, type HospitalCashInput } from "@/lib/claims/calculators/hospital-cash";
import { calculateMedicalReimbursement, type MedicalReimbursementInput } from "@/lib/claims/calculators/medical-reimbursement";
import { assessMedicalClaim, nextMedicalQuestion, type MedicalRuleEvidence } from "@/lib/claims/medical-rules";
import type { MedicalCashRule, MedicalPlanProvisions, MedicalReimbursementRule } from "@/lib/claims/medical-evidence";
import { composeClaim } from "@/lib/claims/composition/engine";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimEvidence, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { VerifiedMedicalBillFacts } from "@/lib/claims/calculators/evidence";
import { verifiedEvidenceProvenance } from "./fixtures/verified-evidence-provenance";

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
const COVERAGE_B = "cov-2";
const CCY = "SGD";

function citation(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return { chunkId: "page:policy-1:10", policyId: POLICY, policyName: "Hospitalisation Wording", pageStart: 10, pageEnd: 10, evidenceLabel: "Hospitalisation wording", ...overrides };
}

function coverage(overrides: Partial<OwnedCoverage> = {}): OwnedCoverage {
  return {
    id: COVERAGE, policyId: POLICY, familyMemberId: FM, category: "Hospitalisation", amount: null, currency: CCY,
    productName: "Hospitalisation Plan", sourcePage: 1, evidenceText: null, insurer: "Great Eastern", policyName: "Hospitalisation Plan",
    policyNumber: "H-001", groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null,
    ...overrides,
  };
}

function cashRule(overrides: Partial<MedicalCashRule> = {}): MedicalCashRule {
  return {
    coverageId: COVERAGE, benefitCode: "med-hospital-cash", dailyRateMinor: 10_000, currency: CCY, capDays: 30,
    quote: "S$100 per day of hospitalisation, up to 30 days.", citation: citation(), ...overrides,
  };
}

function reimbursementRule(overrides: Partial<MedicalReimbursementRule> = {}): MedicalReimbursementRule {
  return {
    coverageId: COVERAGE, benefitCode: "med-inpatient", eligibleCategories: ["surgical_fees", "hospital_charges"],
    categoryLimits: [], quote: "Inpatient medical benefits as charged, subject to the schedule of benefits.", citation: citation(),
    ...overrides,
  };
}

function planProvisions(overrides: Partial<MedicalPlanProvisions> = {}): MedicalPlanProvisions {
  return {
    coverageId: COVERAGE, deductibleMinor: null, coInsurancePercent: null, nonPanelFactor: null,
    dayCountRule: "calendar_day", edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: false },
    waitingDays: 0, citation: citation(), ...overrides,
  };
}

function verifiedBillFacts(overrides: Partial<VerifiedMedicalBillFacts> = {}): VerifiedMedicalBillFacts {
  const facts: VerifiedMedicalBillFacts = {
    lineItems: [], thirdPartyPayments: [], admissionISO: null, dischargeISO: null,
    hospitalName: null, hospitalCountry: null, admissionType: null, wardType: null, sourceDocumentIds: ["doc-1"],
    ...overrides,
  };
  return { ...facts, provenance: overrides.provenance ?? facts.sourceDocumentIds.map(verifiedEvidenceProvenance) };
}

function baseFacts(overrides: Partial<ClaimFacts> = {}): ClaimFacts {
  return { ...EMPTY_CLAIM_FACTS, eventType: "hospitalisation", ...overrides };
}

// ---------------------------------------------------------------------
// Part 1: lib/claims/day-count.ts
// ---------------------------------------------------------------------

function dayCountInput(overrides: Partial<DayCountInput> = {}): DayCountInput {
  return {
    admissionISO: "2024-06-01T10:00:00+08:00", dischargeISO: "2024-06-04T10:00:00+08:00",
    rule: "calendar_day", edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: false },
    icuPeriods: [], icuMode: null, waitingDays: 0, ...overrides,
  };
}

test("day-count: missing admission date blocks MISSING_ADMISSION_DATE", () => {
  const result = computeHospitalDays(dayCountInput({ admissionISO: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_ADMISSION_DATE");
});

test("day-count: ongoing stay (null discharge) blocks STAY_ONGOING", () => {
  const result = computeHospitalDays(dayCountInput({ dischargeISO: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "STAY_ONGOING");
});

test("day-count: admission date with no timezone offset blocks MISSING_TIMEZONE_OFFSET", () => {
  const result = computeHospitalDays(dayCountInput({ admissionISO: "2024-06-01T10:00:00" }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_TIMEZONE_OFFSET");
});

test("day-count: discharge before admission blocks INVALID_DATE_RANGE", () => {
  const result = computeHospitalDays(dayCountInput({ admissionISO: "2024-06-04T10:00:00+08:00", dischargeISO: "2024-06-01T10:00:00+08:00" }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "INVALID_DATE_RANGE");
});

test("day-count: missing rule blocks MISSING_DAY_COUNT_RULE", () => {
  const result = computeHospitalDays(dayCountInput({ rule: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_DAY_COUNT_RULE");
});

test("day-count: missing edge inclusion blocks MISSING_EDGE_INCLUSION", () => {
  const result = computeHospitalDays(dayCountInput({ edgeInclusion: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_EDGE_INCLUSION");
});

test("day-count: missing waiting days blocks MISSING_WAITING_DAYS", () => {
  const result = computeHospitalDays(dayCountInput({ waitingDays: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_WAITING_DAYS");
});

test("day-count: calendar_day, admission-day-only-included matches raw calendar diff", () => {
  // 2024-06-01 -> 2024-06-04: 3 UTC calendar dates apart.
  const result = computeHospitalDays(dayCountInput());
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.grossNights, 3);
});

test("day-count: calendar_day, both edges included adds one night back", () => {
  const result = computeHospitalDays(dayCountInput({ edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: true } }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.grossNights, 4);
});

test("day-count: calendar_day, neither edge included subtracts one night (floored at 0)", () => {
  const result = computeHospitalDays(dayCountInput({ edgeInclusion: { admissionDayIncluded: false, dischargeDayIncluded: false } }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.grossNights, 2);
});

test("day-count: same-day admission and discharge, neither edge included, produces 0 nights (never negative)", () => {
  const result = computeHospitalDays(dayCountInput({
    admissionISO: "2024-06-01T09:00:00+08:00", dischargeISO: "2024-06-01T18:00:00+08:00",
    edgeInclusion: { admissionDayIncluded: false, dischargeDayIncluded: false },
  }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.grossNights, 0);
});

test("day-count: completed_24h_period floors partial days", () => {
  const result = computeHospitalDays(dayCountInput({
    rule: "completed_24h_period", admissionISO: "2024-06-01T10:00:00+08:00", dischargeISO: "2024-06-04T09:00:00+08:00",
  }));
  assert.equal(result.status, "calculated");
  // 71 hours elapsed -> floor(71/24) = 2 completed periods.
  if (result.status === "calculated") assert.equal(result.grossNights, 2);
});

test("day-count: calendar_day is consistent across equivalent instants in different timezone offsets", () => {
  const a = computeHospitalDays(dayCountInput({ admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-04T00:00:00+08:00" }));
  // Same two instants, re-expressed at UTC (16:00 the day before in UTC).
  const b = computeHospitalDays(dayCountInput({ admissionISO: "2024-05-31T16:00:00Z", dischargeISO: "2024-06-03T16:00:00Z" }));
  assert.equal(a.status, "calculated"); assert.equal(b.status, "calculated");
  if (a.status === "calculated" && b.status === "calculated") assert.equal(a.grossNights, b.grossNights);
});

test("day-count: leap-year span (2024-02-28 to 2024-03-01) counts the leap day correctly", () => {
  const result = computeHospitalDays(dayCountInput({ admissionISO: "2024-02-28T10:00:00+08:00", dischargeISO: "2024-03-01T10:00:00+08:00" }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.grossNights, 2); // Feb 28 -> Feb 29 -> Mar 1
});

test("day-count: ICU periods require icuMode when non-empty", () => {
  const result = computeHospitalDays(dayCountInput({
    icuPeriods: [{ admissionISO: "2024-06-01T10:00:00+08:00", dischargeISO: "2024-06-02T10:00:00+08:00" }], icuMode: null,
  }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_ICU_MODE");
});

test("day-count: ICU period outside the admission/discharge range blocks INVALID_ICU_PERIOD", () => {
  const result = computeHospitalDays(dayCountInput({
    icuPeriods: [{ admissionISO: "2024-05-30T10:00:00+08:00", dischargeISO: "2024-06-02T10:00:00+08:00" }], icuMode: "replacing",
  }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "INVALID_ICU_PERIOD");
});

test("day-count: icuMode 'replacing' removes ICU nights from ward nights, never double-counts", () => {
  const result = computeHospitalDays(dayCountInput({
    admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-06T00:00:00+08:00",
    icuPeriods: [{ admissionISO: "2024-06-02T00:00:00+08:00", dischargeISO: "2024-06-04T00:00:00+08:00" }], icuMode: "replacing",
    edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: false },
  }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") {
    assert.equal(result.icuNights, 2);
    assert.equal(result.grossNights, 5);
    assert.equal(result.wardNights, 3); // 5 gross - 2 ICU
  }
});

test("day-count: icuMode 'adding' leaves ward nights unaffected by ICU nights", () => {
  const result = computeHospitalDays(dayCountInput({
    admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-06T00:00:00+08:00",
    icuPeriods: [{ admissionISO: "2024-06-02T00:00:00+08:00", dischargeISO: "2024-06-04T00:00:00+08:00" }], icuMode: "adding",
    edgeInclusion: { admissionDayIncluded: true, dischargeDayIncluded: false },
  }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") { assert.equal(result.icuNights, 2); assert.equal(result.wardNights, 5); }
});

test("day-count: waiting days are subtracted from ward nights only", () => {
  const result = computeHospitalDays(dayCountInput({ waitingDays: 1 }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.wardNights, 2); // 3 gross - 1 waiting day
});

// ---------------------------------------------------------------------
// Part 2: lib/claims/calculators/hospital-cash.ts
// ---------------------------------------------------------------------

function hospitalCashInput(overrides: Partial<HospitalCashInput> = {}): HospitalCashInput {
  return {
    dailyRate: 100, currency: CCY, hospitalStayOngoing: false, hospitalNights: 5, offsetDays: 0, maximumDays: 30,
    ownership: { contractId: POLICY, coverageId: COVERAGE }, ruleEvidence: { policyId: POLICY, chunkId: "page:policy-1:5", pageStart: 5, pageEnd: 5 },
    ownershipEvidence: { chunkId: `coverage:${COVERAGE}`, policyId: POLICY }, ...overrides,
  };
}

test("hospital-cash: ongoing stay blocks STAY_ONGOING", () => {
  const result = calculateHospitalCash(hospitalCashInput({ hospitalStayOngoing: true }));
  assert.equal(result.status, "blocked");
});

test("hospital-cash: day cap reduces payable days (bill/day count exceeding cap)", () => {
  const result = calculateHospitalCash(hospitalCashInput({ hospitalNights: 45, maximumDays: 30 }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") { assert.equal(result.payableDays, 30); assert.equal(result.potentialAmount, 3000); }
});

test("hospital-cash: payableDays of 0 is not_applicable, never a $0 calculated amount", () => {
  const result = calculateHospitalCash(hospitalCashInput({ hospitalNights: 2, offsetDays: 10 }));
  assert.equal(result.status, "not_applicable");
  assert.equal(result.potentialAmount, null);
});

test("hospital-cash: calculationId is stable for identical input and prefixed 'hc:'", () => {
  const a = calculateHospitalCash(hospitalCashInput());
  const b = calculateHospitalCash(hospitalCashInput());
  assert.equal(a.status, "calculated"); assert.equal(b.status, "calculated");
  if (a.status === "calculated" && b.status === "calculated") {
    assert.ok(a.calculationId.startsWith("hc:"));
    assert.equal(a.calculationId, b.calculationId);
  }
});

test("hospital-cash: calculationId changes when a material input changes", () => {
  const a = calculateHospitalCash(hospitalCashInput());
  const b = calculateHospitalCash(hospitalCashInput({ hospitalNights: 6 }));
  assert.equal(a.status, "calculated"); assert.equal(b.status, "calculated");
  if (a.status === "calculated" && b.status === "calculated") assert.notEqual(a.calculationId, b.calculationId);
});

// ---------------------------------------------------------------------
// Part 3: lib/claims/calculators/medical-reimbursement.ts
// ---------------------------------------------------------------------

function reimbursementInput(overrides: Partial<MedicalReimbursementInput> = {}): MedicalReimbursementInput {
  return {
    currency: CCY, eligibleCategories: ["surgical_fees"], billedItems: [{ category: "surgical_fees", description: "Surgeon's fee", amountMinor: 500_000 }],
    categoryLimits: [], wardProration: null, panelRestriction: { panelStatus: "panel", nonPanelFactor: null, evidence: {} },
    deductionSteps: [], deductionOrderEvidenced: true, perAdmissionCap: null, thirdPartyCoordination: null, thirdPartyPayments: null,
    remainingLimits: [], ownership: { contractId: POLICY, coverageId: COVERAGE }, ruleEvidence: {}, ownershipEvidence: {}, ...overrides,
  };
}

test("medical-reimbursement: missing billed items blocks MISSING_BILLED_ITEMS", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ billedItems: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_BILLED_ITEMS");
});

test("medical-reimbursement: non-itemised bill (empty items) is not_applicable, never blocked or guessed", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ billedItems: [] }));
  assert.equal(result.status, "not_applicable");
  assert.equal(result.potentialAmount, null);
});

test("medical-reimbursement: a category cap smaller than the bill reduces the amount (bill exceeding cap)", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({
    categoryLimits: [{ category: "surgical_fees", capMinor: 200_000, evidence: {} }],
  }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterCategoryLimits, 2000);
});

test("medical-reimbursement: a category cap larger than the bill never inflates the amount (benefit exceeding bill)", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({
    categoryLimits: [{ category: "surgical_fees", capMinor: 999_999_00, evidence: {} }],
  }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterCategoryLimits, 5000); // never exceeds the actual bill
});

test("medical-reimbursement: ward proration factor reduces the running amount", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ wardProration: { factor: 0.5, evidence: {} } }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterWardProration, 2500);
});

test("medical-reimbursement: missing panel status blocks MISSING_PANEL_STATUS", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ panelRestriction: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_PANEL_STATUS");
});

test("medical-reimbursement: non-panel with no evidenced factor blocks NON_PANEL_NOT_COVERED", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ panelRestriction: { panelStatus: "non_panel", nonPanelFactor: null, evidence: {} } }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "NON_PANEL_NOT_COVERED");
});

test("medical-reimbursement: non-panel with an evidenced factor is applied", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ panelRestriction: { panelStatus: "non_panel", nonPanelFactor: 0.7, evidence: {} } }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterPanelRestriction, 3500);
});

test("medical-reimbursement: deductible-then-co-insurance vs. reverse order changes the result, so an unevidenced order blocks", () => {
  const steps: MedicalReimbursementInput["deductionSteps"] = [
    { kind: "deductible", amountMinor: 100_000, evidence: {} },
    { kind: "co_insurance", percent: 20, evidence: {} },
  ];
  const result = calculateMedicalReimbursement(reimbursementInput({ deductionSteps: steps, deductionOrderEvidenced: false }));
  assert.equal(result.status, "blocked");
  const blocked = result as { reasonCode: string; competingAmounts?: { description: string; amount: number }[] };
  assert.equal(blocked.reasonCode, "UNRESOLVED_DEDUCTION_ORDER");
  assert.ok(blocked.competingAmounts && blocked.competingAmounts.length === 2);
  // deductible-first: (5000-1000)*0.8=3200; co-insurance-first: (5000*0.8)-1000=3000 -- genuinely different.
  assert.notEqual(blocked.competingAmounts![0].amount, blocked.competingAmounts![1].amount);
});

test("medical-reimbursement: an evidenced deduction order computes without blocking", () => {
  const steps: MedicalReimbursementInput["deductionSteps"] = [
    { kind: "deductible", amountMinor: 100_000, evidence: {} },
    { kind: "co_insurance", percent: 20, evidence: {} },
  ];
  const result = calculateMedicalReimbursement(reimbursementInput({ deductionSteps: steps, deductionOrderEvidenced: true }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterDeductions, 3200);
});

test("medical-reimbursement: per-admission cap reduces the running amount", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ perAdmissionCap: { amountMinor: 100_000, evidence: {} } }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterPerAdmissionCap, 1000);
});

test("medical-reimbursement: required third-party coordination with unknown payment status blocks", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ thirdPartyCoordination: { required: true, evidence: {} }, thirdPartyPayments: null }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_THIRD_PARTY_PAYMENT_STATUS");
});

test("medical-reimbursement: an evidenced third-party payment is deducted (never double-paid)", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({
    thirdPartyCoordination: { required: true, evidence: {} }, thirdPartyPayments: [{ source: "MediShield Life", amountMinor: 100_000 }],
  }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.afterThirdPartyCoordination, 4000);
});

test("medical-reimbursement: a remaining annual/lifetime limit caps the final amount", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ remainingLimits: [{ scope: "annual", remainingMinor: 50_000 }] }));
  assert.equal(result.status, "calculated");
  if (result.status === "calculated") assert.equal(result.potentialAmount, 500);
});

test("medical-reimbursement: currency mismatch is the caller's responsibility (blocks via MISSING_CURRENCY on invalid code)", () => {
  const result = calculateMedicalReimbursement(reimbursementInput({ currency: "XX" }));
  assert.equal(result.status, "blocked");
  assert.equal((result as { reasonCode: string }).reasonCode, "MISSING_CURRENCY");
});

test("medical-reimbursement: the estimate never exceeds the verified eligible billed expense, across several configurations", () => {
  const configs: Partial<MedicalReimbursementInput>[] = [
    {},
    { wardProration: { factor: 0.9, evidence: {} } },
    { deductionSteps: [{ kind: "co_pay", amountMinor: 1_000, evidence: {} }], deductionOrderEvidenced: true },
    { categoryLimits: [{ category: "surgical_fees", capMinor: 10_000_000, evidence: {} }] },
  ];
  for (const cfg of configs) {
    const result = calculateMedicalReimbursement(reimbursementInput(cfg));
    if (result.status === "calculated") assert.ok(result.potentialAmount <= result.eligibleBilledExpense);
  }
});

test("medical-reimbursement: calculationId changes when the deduction order resolution changes", () => {
  const a = calculateMedicalReimbursement(reimbursementInput({ deductionOrderEvidenced: true }));
  const b = calculateMedicalReimbursement(reimbursementInput({
    deductionSteps: [{ kind: "co_pay", amountMinor: 1, evidence: {} }], deductionOrderEvidenced: true,
  }));
  assert.equal(a.status, "calculated"); assert.equal(b.status, "calculated");
  if (a.status === "calculated" && b.status === "calculated") { assert.ok(a.calculationId.startsWith("mr:")); assert.notEqual(a.calculationId, b.calculationId); }
});

// ---------------------------------------------------------------------
// Part 4: lib/claims/medical-rules.ts
// ---------------------------------------------------------------------

function ruleEvidence(overrides: Partial<MedicalRuleEvidence> = {}): MedicalRuleEvidence {
  return { cashRules: [], reimbursementRules: [], planProvisions: [], gaps: [], ...overrides };
}

test("medical-rules: a cash rule with no plan provisions (day-count rule unverified) needs_document", () => {
  const items = assessMedicalClaim(baseFacts(), [coverage()], ruleEvidence({ cashRules: [cashRule()] }));
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "needs_document");
  assert.equal(items[0].amountText, null);
});

test("medical-rules: ICU cash always resolves to 0 ICU nights in this V1 slice (documented limitation, never guessed)", () => {
  const facts = baseFacts({ verifiedMedicalBillFacts: verifiedBillFacts({ admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-04T00:00:00+08:00" }) });
  const items = assessMedicalClaim(facts, [coverage()], ruleEvidence({
    cashRules: [cashRule({ benefitCode: "med-icu-cash" })], planProvisions: [planProvisions()],
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].status, "needs_document");
  assert.match(items[0].reason, /ICU/);
});

test("medical-rules: a hospital-cash benefit that does not clear its waiting period is not_applicable, never shows $0", () => {
  const facts = baseFacts({ verifiedMedicalBillFacts: verifiedBillFacts({ admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-02T00:00:00+08:00" }) });
  const items = assessMedicalClaim(facts, [coverage()], ruleEvidence({
    cashRules: [cashRule()], planProvisions: [planProvisions({ waitingDays: 10 })],
  }));
  assert.equal(items[0].status, "not_applicable");
  assert.equal(items[0].amountText, null);
  assert.match(items[0].reason, /waiting period/);
});

test("medical-rules: a hospital-cash benefit with verified admission/discharge is 'likely_applicable' with an amount", () => {
  const facts = baseFacts({ verifiedMedicalBillFacts: verifiedBillFacts({ admissionISO: "2024-06-01T00:00:00+08:00", dischargeISO: "2024-06-06T00:00:00+08:00" }) });
  const items = assessMedicalClaim(facts, [coverage()], ruleEvidence({ cashRules: [cashRule()], planProvisions: [planProvisions()] }));
  assert.equal(items[0].status, "likely_applicable");
  assert.ok(items[0].calculatedAmount! > 0);
});

test("medical-rules: a plain chat-reported date (no time/timezone) still blocks day-count rather than guessing an offset", () => {
  const facts = baseFacts({ admissionDate: "2024-06-01", dischargeDate: "2024-06-06" });
  const items = assessMedicalClaim(facts, [coverage()], ruleEvidence({ cashRules: [cashRule()], planProvisions: [planProvisions()] }));
  // A plain date (no time/offset) still blocks day-count -- confirms
  // facts.admissionDate/dischargeDate are never silently given an
  // invented timezone, exactly as lib/claims/medical-rules.ts documents.
  assert.equal(items[0].status, "needs_document");
});

test("medical-rules: a reimbursement benefit with no verified bill needs_document", () => {
  const items = assessMedicalClaim(baseFacts(), [coverage()], ruleEvidence({ reimbursementRules: [reimbursementRule()] }));
  assert.equal(items[0].status, "needs_document");
  assert.equal(items[0].aggregation, "reimbursement");
});

test("medical-rules: a currency mismatch between reviewed bill lines and the cover blocks with needs_document", () => {
  const facts = baseFacts({
    verifiedMedicalBillFacts: verifiedBillFacts({ lineItems: [{ category: "surgical_fees", description: null, amountMinor: 100_000, currency: "USD", documentId: "d1", documentType: "itemised_bill" }] }),
  });
  const items = assessMedicalClaim(facts, [coverage({ currency: "SGD" })], ruleEvidence({ reimbursementRules: [reimbursementRule()] }));
  assert.equal(items[0].status, "needs_document");
  assert.match(items[0].reason, /currency/i);
});

test("medical-rules: a reimbursement benefit covering room_and_board carries a ward-proration caveat", () => {
  const facts = baseFacts({
    verifiedMedicalBillFacts: verifiedBillFacts({ lineItems: [{ category: "room_and_board", description: null, amountMinor: 100_000, currency: CCY, documentId: "d1", documentType: "itemised_bill" }] }),
    panelStatusReported: "panel",
  });
  const items = assessMedicalClaim(facts, [coverage()], ruleEvidence({
    reimbursementRules: [reimbursementRule({ eligibleCategories: ["room_and_board"] })], planProvisions: [planProvisions()],
  }));
  assert.equal(items[0].status, "potentially_applicable");
  assert.ok(items[0].conditions.some((c) => /ward/i.test(c)));
});

test("medical-rules: a verified third-party payment triggers required coordination and reduces the amount", () => {
  const facts = baseFacts({
    verifiedMedicalBillFacts: verifiedBillFacts({
      lineItems: [{ category: "surgical_fees", description: null, amountMinor: 500_000, currency: CCY, documentId: "d1", documentType: "itemised_bill" }],
      thirdPartyPayments: [{ source: "Employer", amountMinor: 100_000, currency: CCY, documentId: "d2" }],
    }),
    panelStatusReported: "panel",
  });
  const items = assessMedicalClaim(facts, [coverage()], ruleEvidence({ reimbursementRules: [reimbursementRule()], planProvisions: [planProvisions()] }));
  assert.equal(items[0].status, "potentially_applicable");
  assert.equal(items[0].calculatedAmount, 4000);
});

test("medical-rules: an assessment for a coverage that is not owned is silently skipped, never crashes", () => {
  const items = assessMedicalClaim(baseFacts(), [], ruleEvidence({ cashRules: [cashRule()], reimbursementRules: [reimbursementRule()] }));
  assert.deepEqual(items, []);
});

test("medical-rules: nextMedicalQuestion returns null when there are no cash/reimbursement rules at all", () => {
  assert.equal(nextMedicalQuestion(baseFacts(), ruleEvidence()), null);
});

test("medical-rules: nextMedicalQuestion asks for the admission date first", () => {
  const q = nextMedicalQuestion(baseFacts(), ruleEvidence({ cashRules: [cashRule()] }));
  assert.equal(q?.id, "admission_date");
});

test("medical-rules: nextMedicalQuestion asks for the discharge date once admission is known", () => {
  const q = nextMedicalQuestion(baseFacts({ admissionDate: "2024-06-01" }), ruleEvidence({ cashRules: [cashRule()] }));
  assert.equal(q?.id, "discharge_date");
});

test("medical-rules: nextMedicalQuestion asks whether an itemised bill exists for a reimbursement benefit", () => {
  const facts = baseFacts({ admissionDate: "2024-06-01", dischargeDate: "2024-06-04" });
  const q = nextMedicalQuestion(facts, ruleEvidence({ reimbursementRules: [reimbursementRule()] }));
  assert.equal(q?.id, "medical_bill_document");
});

test("medical-rules: nextMedicalQuestion asks for the bill upload once availability is confirmed but not reviewed", () => {
  const facts = baseFacts({ admissionDate: "2024-06-01", dischargeDate: "2024-06-04", medicalBillDocumentAvailable: true });
  const q = nextMedicalQuestion(facts, ruleEvidence({ reimbursementRules: [reimbursementRule()] }));
  assert.equal(q?.id, "medical_bill_document_upload");
});

test("medical-rules: nextMedicalQuestion asks for panel status once the bill is reviewed", () => {
  const facts = baseFacts({ admissionDate: "2024-06-01", dischargeDate: "2024-06-04", medicalBillDocumentAvailable: true, medicalBillEvidenceReviewed: true });
  const q = nextMedicalQuestion(facts, ruleEvidence({ reimbursementRules: [reimbursementRule()] }));
  assert.equal(q?.id, "panel_status");
});

test("medical-rules: nextMedicalQuestion returns null once every material fact is known", () => {
  const facts = baseFacts({ admissionDate: "2024-06-01", dischargeDate: "2024-06-04", medicalBillDocumentAvailable: true, medicalBillEvidenceReviewed: true, panelStatusReported: "panel" });
  assert.equal(nextMedicalQuestion(facts, ruleEvidence({ reimbursementRules: [reimbursementRule()] })), null);
});

// ---------------------------------------------------------------------
// Part 5: composition/engine.ts medical-specific additions
// ---------------------------------------------------------------------

function assessmentItem(overrides: Partial<ClaimAssessmentItem> = {}): ClaimAssessmentItem {
  return {
    id: "med-hospital-cash", title: "Daily Hospital Cash", status: "likely_applicable", amountText: "S$500.00",
    reason: "test fixture", conditions: [], evidenceTerms: [], productName: "Hospitalisation Plan", coverageId: COVERAGE,
    calculatedAmount: 500, currency: CCY, calculationId: "hc:test-" + Math.random().toString(36).slice(2),
    ruleEvidence: citation(), monetaryDecision: { status: "allowed" }, ...overrides,
  };
}

function composeArgs(assessments: ClaimAssessmentItem[], coverages: OwnedCoverage[]) {
  return { claimEventId: CLAIM, familyMemberId: FM, facts: baseFacts(), coverages, assessments, wordingPages: [] };
}

test("composition: a 'med-*' benefit code categorises as Medical", () => {
  const result = composeClaim(composeArgs([assessmentItem()], [coverage()]));
  const benefit = result.policies.flatMap((p) => p.benefits).find((b) => b.benefitCode === "med-hospital-cash");
  assert.equal(benefit?.benefitCategory, "Medical");
});

test("composition: two different policies each independently reimbursement-eligible are blocked (never silently added)", () => {
  const itemA = assessmentItem({ id: "med-inpatient", coverageId: COVERAGE, calculatedAmount: 3000, aggregation: "reimbursement", calculationId: "mr:a" });
  const itemB = assessmentItem({ id: "med-inpatient", coverageId: COVERAGE_B, calculatedAmount: 2000, aggregation: "reimbursement", calculationId: "mr:b", ruleEvidence: citation({ policyId: POLICY_B }) });
  // Distinct insurer/policyNumber so lib/claims/composition/duplicates.ts's
  // identityKey() never clusters these as versions of the same policy --
  // they are genuinely two SEPARATE reimbursement policies.
  const coverages = [coverage(), coverage({ id: COVERAGE_B, policyId: POLICY_B, insurer: "AIA", policyNumber: "A-002" })];
  const result = composeClaim(composeArgs([itemA, itemB], coverages));
  const benefits = result.policies.flatMap((p) => p.benefits).filter((b) => b.benefitCode === "med-inpatient");
  assert.equal(benefits.length, 2);
  for (const b of benefits) {
    assert.equal(b.status, "blocked");
    assert.ok(b.blockedReasonCodes.includes("REIMBURSEMENT_COORDINATION_NOT_EVIDENCED"));
  }
  assert.ok(result.outstandingQuestions.some((q) => /same medical bill/i.test(q)));
  // The blocked reimbursement amounts must never appear in the total.
  assert.equal(result.totalsByCurrency.find((t) => t.currency === CCY)?.includedAmount ?? 0, 0);
});

test("composition: hospital cash and a reimbursement benefit under ONE policy still compose together normally", () => {
  const cash = assessmentItem({ id: "med-hospital-cash", coverageId: COVERAGE, calculatedAmount: 500, calculationId: "hc:one" });
  const reimb = assessmentItem({ id: "med-inpatient", coverageId: COVERAGE, calculatedAmount: 3000, aggregation: "reimbursement", calculationId: "mr:one" });
  const result = composeClaim(composeArgs([cash, reimb], [coverage()]));
  const benefits = result.policies.flatMap((p) => p.benefits);
  assert.ok(benefits.every((b) => b.status === "included"));
  const total = result.totalsByCurrency.find((t) => t.currency === CCY)?.includedAmount ?? 0;
  assert.equal(total, 3500);
});

test("composition: a single reimbursement benefit alone (only one policy involved) is never coordination-blocked", () => {
  const reimb = assessmentItem({ id: "med-inpatient", coverageId: COVERAGE, calculatedAmount: 3000, aggregation: "reimbursement", calculationId: "mr:solo" });
  const result = composeClaim(composeArgs([reimb], [coverage()]));
  const benefit = result.policies.flatMap((p) => p.benefits).find((b) => b.benefitCode === "med-inpatient");
  assert.equal(benefit?.status, "included");
});

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------

console.log(`claim-medical-regressions: ${cases} cases passed.`);
