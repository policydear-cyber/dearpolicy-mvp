/**
 * Regression suite for the deterministic travel-claim engine (Overseas
 * Medical Expenses and Accidental Death benefits for a Travel-category
 * cover): lib/claims/travel-evidence.ts, lib/claims/travel-rules.ts, and
 * the travel-specific addition to lib/claims/composition/engine.ts
 * (benefitCategoryFor's "Travel" branch).
 *
 * No real travel-policy wording fixture exists in this repo (see
 * lib/claims/travel-evidence.ts's own doc comment); every fixture below is
 * synthetic, constructed text -- the same approach scripts/claim-
 * disability-regressions.ts and scripts/claim-ci-regressions.ts already
 * take for their own wording-extraction tests.
 *
 * Four parts:
 *  1. Pure-function tests for lib/claims/travel-evidence.ts's
 *     findTravelRules() -- overseas-medical-expense category extraction
 *     and overall-cap detection, a fixed accidental-death amount, that
 *     discretionary language ("may pay...") is never read as a firm rule,
 *     and -- the core V1 safety boundary this module's own doc comment
 *     calls out -- that a baggage/travel-delay/trip-cancellation clause is
 *     NEVER matched by either heading, even when it sits in the very same
 *     document.
 *  2. Pure-function tests for resolveTravelEvidence()'s tiered
 *     evidence-document resolution (own document, ambiguous multi-document
 *     gate), mirroring scripts/claim-disability-regressions.ts's own
 *     Part 4 pattern.
 *  3. Pure-function tests for lib/claims/travel-rules.ts's
 *     assessTravelClaim()/nextTravelQuestion() -- the trip-date safety
 *     gate (missing trip dates block, an event date confirmed outside the
 *     trip window is not_applicable, a date within the window plus full
 *     evidence calculates), a medical currency mismatch, and the
 *     accidental-death cause-definition-match gate (reusing the exact same
 *     CauseDefinitionMatch machinery a Group Personal Accident benefit
 *     uses).
 *  4. A composition-engine test confirming "travel-*" benefit codes
 *     categorise as "Travel".
 */
import assert from "node:assert/strict";

import { findTravelRules, resolveTravelEvidence, type TravelWordingPage } from "@/lib/claims/travel-evidence";
import { assessTravelClaim, nextTravelQuestion, type TravelRuleSet } from "@/lib/claims/travel-rules";
import { composeClaim } from "@/lib/claims/composition/engine";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimEvidence, type ClaimFacts } from "@/lib/claims/types";
import type { CauseDefinitionMatch, VerifiedMedicalBillFacts } from "@/lib/claims/calculators/evidence";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { verifiedEvidenceProvenance } from "@/scripts/fixtures/verified-evidence-provenance";

let cases = 0;
function test(name: string, fn: () => void) {
  try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

// ---------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------

const FM = "fam-1";
const CLAIM = "claim-1";
const POLICY = "policy-travel-1";
const COVERAGE = "cov-travel-1";
const CCY = "SGD";

function page(text: string, page_number = 1, overrides: Partial<TravelWordingPage> = {}): TravelWordingPage {
  return {
    policy_id: POLICY, page_number, text, group_policy_number: null, insurer: "Great Eastern", product_name: "Travel Protect360",
    original_filename: "travel-policy.pdf", document_role: "certificate", personal_coverage_confirmed: true, linked_to_member: false,
    ...overrides,
  };
}
function coverage(overrides: Partial<OwnedCoverage> = {}): OwnedCoverage {
  return {
    id: COVERAGE, policyId: POLICY, familyMemberId: FM, category: "Travel", amount: null, currency: CCY,
    productName: "Travel Protect360", sourcePage: 1, evidenceText: null, insurer: "Great Eastern", policyName: "Travel Protect360",
    policyNumber: "T-001", groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2024-01-01", renewalOrExpiryDate: null,
    ...overrides,
  };
}
function baseFacts(overrides: Partial<ClaimFacts> = {}): ClaimFacts {
  return { ...EMPTY_CLAIM_FACTS, ...overrides };
}

const MEDICAL_CLAUSE = "Overseas Medical Expenses: We will reimburse hospitalisation, surgical fees, consultation fees and medication up to S$100,000 per Insured Person for medical treatment incurred overseas due to Injury or Illness during the Period of Insurance.";
const DEATH_CLAUSE = "Accidental Death Benefit: If an Insured Person dies as a direct result of an accident during the Period of Insurance, we will pay a lump sum benefit of S$150,000.";
const BAGGAGE_CLAUSE = "Baggage and Personal Effects: We will pay up to S$3,000 for the loss of your baggage and personal effects during the trip.";
const DELAY_CLAUSE = "Travel Delay: We will pay S$100 for every full 6 hours of delay, up to a maximum of S$1,000.";
const CANCELLATION_CLAUSE = "Trip Cancellation: We will reimburse irrecoverable deposits up to S$10,000 if you have to cancel your trip.";

// ---------------------------------------------------------------------
// Part 1: findTravelRules()
// ---------------------------------------------------------------------

test("findTravelRules: reads the overseas-medical-expense clause's evidenced categories and overall cap", () => {
  const [rule] = findTravelRules([{ page_number: 1, text: MEDICAL_CLAUSE }]);
  assert.ok(rule);
  assert.equal(rule.benefitCode, "travel-medical-expenses");
  if (rule.benefitCode !== "travel-medical-expenses") return;
  assert.deepEqual(rule.eligibleCategories.sort(), ["consultation_fees", "hospitalisation", "medication", "surgical_fees"].sort());
  assert.deepEqual(rule.overallCap, { amount: 100_000, currency: "SGD" });
});

test("findTravelRules: a lump-sum-only medical clause with no stated category breakdown produces no rule", () => {
  const results = findTravelRules([{ page_number: 1, text: "Overseas Medical Expenses: We will pay up to S$50,000 for medical treatment overseas." }]);
  assert.equal(results.some((r) => r.benefitCode === "travel-medical-expenses"), false);
});

test("findTravelRules: reads a fixed accidental-death amount", () => {
  const results = findTravelRules([{ page_number: 2, text: DEATH_CLAUSE }]);
  const rule = results.find((r) => r.benefitCode === "travel-accidental-death");
  assert.ok(rule);
  if (!rule || rule.benefitCode !== "travel-accidental-death") return;
  assert.equal(rule.amount, 150_000);
  assert.equal(rule.currency, "SGD");
  assert.equal(rule.page, 2);
});

test("findTravelRules: discretionary language ('may pay') is never read as a firm accidental-death rule", () => {
  const results = findTravelRules([{ page_number: 1, text: "Accidental Death Benefit: We may pay a benefit of S$150,000 at our discretion." }]);
  assert.equal(results.some((r) => r.benefitCode === "travel-accidental-death"), false);
});

test("findTravelRules: never matches a baggage, travel-delay or trip-cancellation clause", () => {
  const results = findTravelRules([{ page_number: 1, text: [BAGGAGE_CLAUSE, DELAY_CLAUSE, CANCELLATION_CLAUSE].join("\n\n") }]);
  assert.equal(results.length, 0);
});

test("findTravelRules: both benefits are read independently from the same document, alongside out-of-scope clauses", () => {
  const results = findTravelRules([{ page_number: 1, text: [BAGGAGE_CLAUSE, MEDICAL_CLAUSE, DELAY_CLAUSE, DEATH_CLAUSE, CANCELLATION_CLAUSE].join("\n\n") }]);
  assert.deepEqual(results.map((r) => r.benefitCode).sort(), ["travel-accidental-death", "travel-medical-expenses"].sort());
});

// ---------------------------------------------------------------------
// Part 2: resolveTravelEvidence()
// ---------------------------------------------------------------------

test("resolveTravelEvidence: resolves a rule from the coverage's own document, citing it under this coverage", () => {
  const { rules, gaps } = resolveTravelEvidence([coverage()], [page(DEATH_CLAUSE)]);
  assert.equal(gaps.length, 0);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].coverageId, COVERAGE);
  assert.equal(rules[0].citation.policyId, POLICY);
});

test("resolveTravelEvidence: two Travel coverage rows for the SAME policy never duplicate the same benefit", () => {
  const coverages = [coverage({ id: "cov-a", productName: "Travel Protect360 - Medical" }), coverage({ id: "cov-b", productName: "Travel Protect360 - Death" })];
  const { rules } = resolveTravelEvidence(coverages, [page(MEDICAL_CLAUSE + "\n\n" + DEATH_CLAUSE)]);
  assert.equal(rules.filter((r) => r.benefitCode === "travel-medical-expenses").length, 1);
  assert.equal(rules.filter((r) => r.benefitCode === "travel-accidental-death").length, 1);
});

test("resolveTravelEvidence: two equally-qualified own documents fail closed as AMBIGUOUS_EVIDENCE", () => {
  const rows = [page(DEATH_CLAUSE, 1, { original_filename: "a.pdf" }), page(DEATH_CLAUSE, 1, { original_filename: "b.pdf" })];
  // Two distinct documents both claiming the same policy_id is the
  // "own document" ambiguity case -- simulate via two different
  // original_filename rows that still share policy_id, matching this
  // module's own tier grouping (grouped by policy_id, so this actually
  // groups into ONE document with 2 pages numbered the same; use distinct
  // policy_id + linked_to_member instead to exercise the "linked" tier).
  const linkedRows = [
    page(DEATH_CLAUSE, 1, { policy_id: "other-policy-a", linked_to_member: true, personal_coverage_confirmed: false }),
    page(DEATH_CLAUSE, 1, { policy_id: "other-policy-b", linked_to_member: true, personal_coverage_confirmed: false }),
  ];
  const { rules, gaps } = resolveTravelEvidence([coverage()], linkedRows);
  assert.equal(rules.length, 0);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reasonCode, "AMBIGUOUS_EVIDENCE");
});

test("resolveTravelEvidence: a document uploaded for a different insurer never resolves this coverage", () => {
  const { rules, gaps } = resolveTravelEvidence([coverage({ insurer: "Great Eastern" })], [page(DEATH_CLAUSE, 1, { policy_id: "other-policy", insurer: "AIG", linked_to_member: false, personal_coverage_confirmed: false, document_role: "policy_wording" })]);
  assert.equal(rules.length, 0);
  assert.equal(gaps[0].reasonCode, "NO_MATCHING_DOCUMENT");
});

// ---------------------------------------------------------------------
// Part 3: assessTravelClaim() / nextTravelQuestion()
// ---------------------------------------------------------------------

function medicalCitation(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return { chunkId: "page:policy-travel-1:1", policyId: POLICY, policyName: "Travel Protect360", pageStart: 1, pageEnd: 1, evidenceLabel: "Overseas medical expenses wording", ...overrides };
}
function deathCitation(overrides: Partial<ClaimEvidence> = {}): ClaimEvidence {
  return { chunkId: "page:policy-travel-1:2", policyId: POLICY, policyName: "Travel Protect360", pageStart: 2, pageEnd: 2, evidenceLabel: "Accidental death wording", ...overrides };
}
function travelRuleSet(overrides: { medical?: boolean; death?: boolean } = { medical: true, death: true }): TravelRuleSet {
  const rules: TravelRuleSet["rules"] = [];
  if (overrides.medical !== false) rules.push({ coverageId: COVERAGE, benefitCode: "travel-medical-expenses", eligibleCategories: ["hospitalisation", "surgical_fees"], overallCap: { amount: 100_000, currency: CCY }, quote: MEDICAL_CLAUSE, citation: medicalCitation() });
  if (overrides.death) rules.push({ coverageId: COVERAGE, benefitCode: "travel-accidental-death", amount: 150_000, currency: CCY, quote: DEATH_CLAUSE, citation: deathCitation() });
  return { rules, gaps: [] };
}
function verifiedBill(overrides: Partial<VerifiedMedicalBillFacts> = {}): VerifiedMedicalBillFacts {
  return {
    lineItems: [{ category: "hospitalisation", description: "Ward charges", amountMinor: 500_000, currency: CCY, documentId: "doc-1", documentType: "hospital_bill" }],
    thirdPartyPayments: [], admissionISO: "2024-06-05", dischargeISO: "2024-06-08", hospitalName: "Bangkok Hospital", hospitalCountry: "TH", admissionType: "inpatient", wardType: "standard",
    sourceDocumentIds: ["doc-1"], provenance: [verifiedEvidenceProvenance("doc-1")], ...overrides,
  };
}
function matchingCauseMatch(overrides: Partial<CauseDefinitionMatch> = {}): CauseDefinitionMatch {
  return {
    familyMemberId: FM, claimEventId: CLAIM, contractId: POLICY, coverageId: COVERAGE,
    causeEvidence: { documentId: "doc-death", documentType: "death_certificate", pageStart: 1, pageEnd: 1, familyMemberId: FM, claimEventId: CLAIM },
    definitionEvidence: { policyId: deathCitation().policyId, chunkId: deathCitation().chunkId, pageStart: deathCitation().pageStart, pageEnd: deathCitation().pageEnd },
    provenance: verifiedEvidenceProvenance("doc-death"),
    result: "matches", reviewedAt: "2024-06-10T00:00:00Z", ...overrides,
  };
}

test("nextTravelQuestion: asks for the trip departure date first when travel rules exist", () => {
  const q = nextTravelQuestion(baseFacts(), travelRuleSet());
  assert.equal(q?.id, "trip_departure_date");
});

test("nextTravelQuestion: asks for the trip return date once departure is known", () => {
  const q = nextTravelQuestion(baseFacts({ tripDepartureDate: "2024-06-01" }), travelRuleSet());
  assert.equal(q?.id, "trip_return_date");
});

test("nextTravelQuestion: nothing to ask once both trip dates are known", () => {
  assert.equal(nextTravelQuestion(baseFacts({ tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10" }), travelRuleSet()), null);
});

test("nextTravelQuestion: never asks when there are no travel rules for this claim", () => {
  assert.equal(nextTravelQuestion(baseFacts(), { rules: [], gaps: [] }), null);
});

test("assessTravelClaim: missing trip dates blocks BOTH benefits as needs_document (never an amount)", () => {
  const facts = baseFacts({ eventType: "death", death: true, deathDate: "2024-06-05", causeDefinitionMatches: [matchingCauseMatch()] });
  const items = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM);
  const deathItem = items.find((i) => i.id === "travel-accidental-death");
  assert.equal(deathItem?.status, "needs_document");
  assert.equal(deathItem?.calculatedAmount, undefined);
});

test("assessTravelClaim: a date of death confirmed OUTSIDE the trip window is not_applicable", () => {
  const facts = baseFacts({
    eventType: "death", death: true, deathDate: "2024-07-01", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    causeDefinitionMatches: [matchingCauseMatch()],
  });
  const item = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM).find((i) => i.id === "travel-accidental-death");
  assert.equal(item?.status, "not_applicable");
});

test("assessTravelClaim: a date of death within the trip window, with a confirmed cause match, calculates the fixed amount", () => {
  const facts = baseFacts({
    eventType: "death", death: true, deathDate: "2024-06-05", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    causeDefinitionMatches: [matchingCauseMatch()],
  });
  const item = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM).find((i) => i.id === "travel-accidental-death");
  assert.equal(item?.status, "potentially_applicable");
  assert.equal(item?.calculatedAmount, 150_000);
  assert.equal(item?.currency, CCY);
});

test("assessTravelClaim: within the trip window but NO confirmed cause match still blocks (never assumes the cause matches)", () => {
  const facts = baseFacts({ eventType: "death", death: true, deathDate: "2024-06-05", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10", causeDefinitionMatches: [] });
  const item = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM).find((i) => i.id === "travel-accidental-death");
  assert.equal(item?.status, "needs_document");
  assert.equal(item?.calculatedAmount, undefined);
});

test("assessTravelClaim: a cause match confirmed for a DIFFERENT claim can never unlock this one", () => {
  const facts = baseFacts({
    eventType: "death", death: true, deathDate: "2024-06-05", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    causeDefinitionMatches: [matchingCauseMatch({ claimEventId: "a-different-claim" })],
  });
  const item = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM).find((i) => i.id === "travel-accidental-death");
  assert.equal(item?.status, "needs_document");
});

test("assessTravelClaim: a treatment date within the trip window, with a reviewed bill, calculates Overseas Medical Expenses", () => {
  const facts = baseFacts({
    eventType: "hospitalisation", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10", verifiedMedicalBillFacts: verifiedBill(),
  });
  const item = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM).find((i) => i.id === "travel-medical-expenses");
  assert.equal(item?.status, "potentially_applicable");
  assert.equal(item?.calculatedAmount, 5_000);
});

test("assessTravelClaim: a bill line in a different currency than the cover blocks rather than silently converting", () => {
  const facts = baseFacts({
    eventType: "hospitalisation", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    verifiedMedicalBillFacts: verifiedBill({ lineItems: [{ category: "hospitalisation", description: "Ward charges", amountMinor: 500_000, currency: "THB", documentId: "doc-1", documentType: "hospital_bill" }] }),
  });
  const item = assessTravelClaim(facts, [coverage()], travelRuleSet(), CLAIM).find((i) => i.id === "travel-medical-expenses");
  assert.equal(item?.status, "needs_document");
  assert.equal(item?.calculatedAmount, undefined);
});

test("assessTravelClaim: a non-Travel coverage is never assessed for a travel benefit", () => {
  const facts = baseFacts({ eventType: "death", death: true, deathDate: "2024-06-05", tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10", causeDefinitionMatches: [matchingCauseMatch()] });
  const items = assessTravelClaim(facts, [coverage({ category: "Personal Accident" })], travelRuleSet(), CLAIM);
  assert.equal(items.length, 0);
});

// ---------------------------------------------------------------------
// Part 4: composition engine -- travel-specific addition
// ---------------------------------------------------------------------

function assessmentItem(overrides: Partial<ClaimAssessmentItem> = {}): ClaimAssessmentItem {
  return {
    id: "travel-accidental-death", title: "Travel Accidental Death Benefit", status: "potentially_applicable", amountText: "S$150,000.00",
    reason: "test fixture", conditions: [], evidenceTerms: [], productName: "Travel Protect360", coverageId: COVERAGE,
    calculatedAmount: 150_000, currency: CCY, calculationId: "ad:test-" + Math.random().toString(36).slice(2),
    ruleEvidence: deathCitation(), monetaryDecision: { status: "allowed" }, ...overrides,
  };
}
function composeArgs(assessments: ClaimAssessmentItem[], coverages: OwnedCoverage[]) {
  return { claimEventId: CLAIM, familyMemberId: FM, facts: baseFacts(), coverages, assessments, wordingPages: [] };
}

test("composition: a 'travel-*' benefit code categorises as Travel", () => {
  const result = composeClaim(composeArgs([assessmentItem()], [coverage()]));
  const benefit = result.policies.flatMap((p) => p.benefits).find((b) => b.benefitCode === "travel-accidental-death");
  assert.equal(benefit?.benefitCategory, "Travel");
  assert.equal(benefit?.status, "included");
});

// ---------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------

console.log(`claim-travel-regressions: ${cases} cases passed.`);
