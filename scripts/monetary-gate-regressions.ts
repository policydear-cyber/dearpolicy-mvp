import assert from "node:assert/strict";
import { enforceMonetarySafety, evaluateMonetaryEligibility } from "@/lib/claims/monetary-gate";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";

const coverage: OwnedCoverage = {
  id: "coverage-1",
  policyId: "policy-1",
  familyMemberId: "member-1",
  category: "Death",
  amount: 300_000,
  currency: "SGD",
  productName: "Term Life",
  sourcePage: 2,
  evidenceText: "Death cover SGD 300,000",
  insurer: "Synthetic Insurer",
  policyName: "Synthetic Term Life",
  policyNumber: "SYN-001",
  groupPolicyNumber: null,
  documentRole: "certificate",
  effectiveDate: "2025-01-01",
  renewalOrExpiryDate: "2035-01-01",
};

const facts: ClaimFacts = {
  ...EMPTY_CLAIM_FACTS,
  eventType: "death",
  eventDate: "2026-01-01",
  death: true,
  deathDate: "2026-01-01",
};

const supported: ClaimAssessmentItem = {
  id: "death",
  title: "Death benefit",
  status: "potentially_applicable",
  amountText: "S$300,000",
  calculatedAmount: 300_000,
  currency: "SGD",
  coverageId: coverage.id,
  ruleEvidence: {
    chunkId: "page:wording-1:3",
    policyId: "wording-1",
    policyName: "Synthetic wording",
    pageStart: 3,
    pageEnd: 3,
  },
  reason: "100% of verified sum insured.",
  conditions: [],
  evidenceTerms: [],
  productName: "Term Life",
};

export function runMonetaryGateRegressions() {
  assert.deepEqual(
    evaluateMonetaryEligibility({ item: supported, facts, coverages: [coverage] }),
    { status: "allowed" },
  );

  const [allowed] = enforceMonetarySafety([supported], facts, [coverage]);
  assert.equal(allowed.amountText, "S$300,000");
  assert.equal(allowed.calculatedAmount, 300_000);
  assert.deepEqual(allowed.monetaryDecision, { status: "allowed" });

  const formattedOnly: ClaimAssessmentItem = {
    ...supported,
    id: "heuristic",
    amountText: "S$1,250",
    calculatedAmount: undefined,
  };
  const [blockedHeuristic] = enforceMonetarySafety([formattedOnly], facts, [coverage]);
  assert.equal(blockedHeuristic.amountText, null);
  assert.equal(blockedHeuristic.calculatedAmount, undefined);
  assert.equal(blockedHeuristic.status, "needs_document");
  assert.equal(blockedHeuristic.monetaryDecision?.status, "blocked");
  if (blockedHeuristic.monetaryDecision?.status === "blocked") {
    assert.equal(blockedHeuristic.monetaryDecision.reasonCode, "NO_DETERMINISTIC_AMOUNT");
  }

  const [blockedReview] = enforceMonetarySafety(
    [{ ...supported, status: "needs_document" }],
    facts,
    [coverage],
  );
  assert.equal(blockedReview.amountText, null);
  if (blockedReview.monetaryDecision?.status === "blocked") {
    assert.equal(blockedReview.monetaryDecision.reasonCode, "STATUS_NOT_ELIGIBLE");
  }

  const [blockedMapping] = enforceMonetarySafety(
    [{ ...supported, coverageId: "foreign-or-inferred-coverage" }],
    facts,
    [coverage],
  );
  assert.equal(blockedMapping.amountText, null);
  if (blockedMapping.monetaryDecision?.status === "blocked") {
    assert.equal(blockedMapping.monetaryDecision.reasonCode, "UNRESOLVED_COVERAGE_MAPPING");
  }

  const [blockedEvidence] = enforceMonetarySafety(
    [{ ...supported, ruleEvidence: undefined }],
    facts,
    [coverage],
  );
  assert.equal(blockedEvidence.amountText, null);
  if (blockedEvidence.monetaryDecision?.status === "blocked") {
    assert.equal(blockedEvidence.monetaryDecision.reasonCode, "MISSING_RULE_EVIDENCE");
  }

  const uncertainFacts: ClaimFacts = {
    ...facts,
    deathDate: null,
    eventDate: null,
    uncertainFacts: ["death_date"],
  };
  const [blockedDate] = enforceMonetarySafety([supported], uncertainFacts, [coverage]);
  assert.equal(blockedDate.amountText, null);
  if (blockedDate.monetaryDecision?.status === "blocked") {
    assert.equal(blockedDate.monetaryDecision.reasonCode, "MISSING_EVENT_DATE");
  }

  const [blockedAgain] = enforceMonetarySafety([blockedDate], uncertainFacts, [coverage]);
  assert.equal(blockedAgain.amountText, null);
  assert.equal(
    blockedAgain.conditions.filter((condition) =>
      condition.includes("event date must be confirmed"),
    ).length,
    1,
  );

  console.log("DearPolicy monetary eligibility gate regressions passed.");
}
