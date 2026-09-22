/**
 * Regression suite for the deterministic claim-composition engine
 * (lib/claims/composition/engine.ts and its supporting modules), stacked
 * on the evidence-resolution fix and calculator work in PR #7/#8/#9.
 *
 * DearPolicy must never obtain a claim total by asking a model to add
 * benefit amounts -- composeClaim() is the ONLY place that selects,
 * composes, caps and totals more than one calculated benefit, and every
 * test below exercises that real function (or its pure building blocks),
 * never a re-implementation or a mock of it.
 *
 * Scope note: a handful of the ~29 named scenarios from the composition
 * spec are about EVIDENCE selection rather than composition math, and are
 * already covered by scripts/claim-evidence-regressions.ts's
 * resolveDeathEvidence() tests (byte-identical wording resolving
 * deterministically; ambiguous evidence failing closed at the document
 * level; policy A's evidence never feeding policy B's rule). This suite
 * does not duplicate those -- it covers the composition engine itself:
 * how already-resolved, already-calculated benefits are selected,
 * combined, capped, deduplicated across policy versions, and totalled.
 *
 * Three parts:
 *  1. Pure-function tests (no database) -- the composition engine, its
 *     wording-signal/cap detectors, its policy-version/duplicate
 *     resolver, and its runtime validator, called directly with
 *     hand-built fixtures.
 *  2. Five named end-to-end fixtures, each a single larger composeClaim()
 *     scenario mirroring a real household situation.
 *  3. Database-backed tests for the immutable audit-snapshot store
 *     (lib/claims/composition/store.ts), against a disposable PGlite
 *     instance, the same pattern scripts/claim-evidence-regressions.ts and
 *     scripts/system-database-regressions.ts already use.
 *
 * A known, documented limitation this suite deliberately does NOT paper
 * over: aggregate-cap deduction currently applies caps in the order their
 * wording is found in the document (policy/lifetime caps before the
 * shared event cap, which is always applied last and therefore correctly
 * narrower-first only for that one ordering), and every V1 benefit starts
 * with the same priority (0), so a shortfall between two same-scope caps
 * is allocated in composed-array order rather than an explicit per-benefit
 * priority. Tests below assert the ACTUAL, current behaviour rather than
 * an aspirational one -- see the composition engine's own PR description
 * for this called out as a known limitation.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";

import { composeClaim, COMPOSITION_ENGINE_VERSION, type ComposeClaimArgs } from "@/lib/claims/composition/engine";
import { findCompositionSignals, findAggregateCapSignals } from "@/lib/claims/composition/relationships";
import { resolvePolicyVersions } from "@/lib/claims/composition/duplicates";
import { validateComposedBenefit, type ComposedBenefit } from "@/lib/claims/composition/types";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";

let cases = 0;
function test(name: string, fn: () => void) {
  try { fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}
async function testAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); cases++; } catch (error) { throw new Error(name, { cause: error }); }
}

// ---------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------

function makeCoverage(overrides: Partial<OwnedCoverage> & { id: string; policyId: string }): OwnedCoverage {
  return {
    familyMemberId: "fam-1", category: "Death", amount: null, currency: "SGD", productName: "Group Term Life",
    sourcePage: null, evidenceText: null, insurer: "Singlife", policyName: "Group Term Life", policyNumber: overrides.policyId.toUpperCase(),
    groupPolicyNumber: "G007500", documentRole: "certificate", effectiveDate: null, renewalOrExpiryDate: null,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<ClaimAssessmentItem> & { id: string; coverageId: string; calculatedAmount: number; currency: string }): ClaimAssessmentItem {
  return {
    title: overrides.id, status: "potentially_applicable", amountText: null, reason: "", conditions: [], evidenceTerms: [],
    productName: null, calculationId: `db:${overrides.id}:${overrides.coverageId}`, monetaryDecision: { status: "allowed" },
    ...overrides,
  };
}

function baseFacts(overrides: Partial<ClaimFacts> = {}): ClaimFacts {
  return { ...EMPTY_CLAIM_FACTS, eventType: "death", deathDate: "2024-06-01", ...overrides };
}

function compose(overrides: Partial<ComposeClaimArgs> = {}) {
  return composeClaim({
    claimEventId: "claim-1", familyMemberId: "fam-1", facts: baseFacts(), coverages: [], assessments: [], wordingPages: [],
    now: new Date("2024-06-15T00:00:00Z"),
    ...overrides,
  });
}

function wordingPages(policyId: string, text: string, pageNumber = 1) {
  return [{ policy_id: policyId, page_number: pageNumber, text }];
}

function includedIn(result: ReturnType<typeof composeClaim>, calculationId: string) {
  return result.policies.flatMap((p) => p.benefits).find((b) => b.calculationId === calculationId);
}
function anyIncluded(result: ReturnType<typeof composeClaim>) {
  return result.policies.flatMap((p) => p.benefits).filter((b) => b.status === "included");
}

// ---------------------------------------------------------------------
// 1. Pure-function tests
// ---------------------------------------------------------------------

function runPureTests() {
  // --- Independent policies / duplicates / versions -------------------

  test("two independent policies (different insurer, different policy number) are both included and added together", () => {
    const coverages = [
      makeCoverage({ id: "cov-a", policyId: "P1", insurer: "Singlife", policyNumber: "POL-A" }),
      makeCoverage({ id: "cov-b", policyId: "P2", insurer: "Aviva", policyNumber: "POL-B" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-b", calculatedAmount: 50000, currency: "SGD" }),
    ];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.length, 1);
    assert.equal(result.totalsByCurrency[0].includedAmount, 150000);
    assert.equal(anyIncluded(result).length, 2);
  });

  test("a duplicate upload of the same policy (same insurer + policy number, no dates to disambiguate) is never counted twice", () => {
    const coverages = [
      makeCoverage({ id: "cov-a", policyId: "P1", insurer: "Singlife", policyNumber: "POL-DUP" }),
      makeCoverage({ id: "cov-b", policyId: "P2", insurer: "Singlife", policyNumber: "POL-DUP" }),
    ];
    const decisions = resolvePolicyVersions(coverages, "2024-06-01");
    const p1Decision = decisions.get("P1");
    assert.equal(p1Decision?.status, "ambiguous");
    assert.equal(decisions.get("P2")?.status, "ambiguous");
    if (p1Decision?.status === "ambiguous") assert.equal(p1Decision.reasonCode, "DUPLICATE_POLICY_OR_VERSION");

    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-b", calculatedAmount: 100000, currency: "SGD" }),
    ];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.length, 0, "an ambiguous duplicate must never contribute to any total");
    assert.ok(result.excludedBenefits.every((b) => b.blockedReasonCodes.includes("DUPLICATE_POLICY_OR_VERSION")));
  });

  test("a renewed policy version not in force at the event date is excluded, and the current version is not double counted", () => {
    const coverages = [
      makeCoverage({ id: "cov-old", policyId: "P-OLD", insurer: "Singlife", policyNumber: "POL-RENEW", effectiveDate: "2022-01-01", renewalOrExpiryDate: "2023-12-31" }),
      makeCoverage({ id: "cov-new", policyId: "P-NEW", insurer: "Singlife", policyNumber: "POL-RENEW", effectiveDate: "2024-01-01", renewalOrExpiryDate: "2024-12-31" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-old", calculatedAmount: 80000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-new", calculatedAmount: 100000, currency: "SGD" }),
    ];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 100000, "only the renewal version in force at the event date counts");
    const excludedOld = result.excludedBenefits.find((b) => b.policyId === "P-OLD");
    assert.ok(excludedOld);
    assert.ok(excludedOld!.blockedReasonCodes.includes("POLICY_NOT_IN_FORCE_AT_EVENT"));
  });

  test("two genuinely overlapping 'current' versions of one policy are ambiguous, not guessed between", () => {
    const coverages = [
      makeCoverage({ id: "cov-x", policyId: "P-X", insurer: "Singlife", policyNumber: "POL-CONFLICT", effectiveDate: "2023-01-01", renewalOrExpiryDate: "2025-01-01" }),
      makeCoverage({ id: "cov-y", policyId: "P-Y", insurer: "Singlife", policyNumber: "POL-CONFLICT", effectiveDate: "2023-06-01", renewalOrExpiryDate: "2025-06-01" }),
    ];
    const decisions = resolvePolicyVersions(coverages, "2024-06-01");
    const pxDecision = decisions.get("P-X");
    assert.equal(pxDecision?.status, "ambiguous");
    assert.equal(decisions.get("P-Y")?.status, "ambiguous");
    if (pxDecision?.status === "ambiguous") assert.equal(pxDecision.reasonCode, "AMBIGUOUS_POLICY_VERSION");
  });

  test("composition never invents extra benefits from extra wording pages -- one assessment always yields exactly one included benefit", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
    // Two wording pages for the same policy (as a certificate + a master
    // wording upload would produce) -- composeClaim only ever reads pages
    // for composition-RELATIONSHIP and cap signals, never to manufacture
    // additional benefits, so the included count must still be exactly 1.
    const pages = [
      { policy_id: "P1", page_number: 1, text: "Certificate schedule page." },
      { policy_id: "P1", page_number: 2, text: "Master wording page, identical benefit description." },
    ];
    const result = compose({ coverages, assessments, wordingPages: pages });
    assert.equal(anyIncluded(result).length, 1);
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 100000);
  });

  // --- Group vs individual ownership -----------------------------------

  test("a coverage without a proven personal ownership document role is blocked as unverified group membership", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1", documentRole: "product_summary" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.length, 0);
    assert.ok(result.excludedBenefits[0]?.blockedReasonCodes.includes("GROUP_MEMBERSHIP_UNVERIFIED"));
  });

  test("a coverage with a genuine personal certificate/schedule/endorsement is included", () => {
    for (const role of ["certificate", "schedule", "endorsement", "policy_document"]) {
      const coverages = [makeCoverage({ id: "cov-a", policyId: "P1", documentRole: role })];
      const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
      const result = compose({ coverages, assessments });
      assert.equal(anyIncluded(result).length, 1, `documentRole=${role} should be treated as verified ownership`);
    }
  });

  // --- Wording relationships never cross policies -----------------------

  test("a composition-relationship signal in one policy's wording never affects another policy's benefits", () => {
    const coverages = [
      makeCoverage({ id: "cov-a1", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-A" }),
      makeCoverage({ id: "cov-a2", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-A" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 100000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-a2", calculatedAmount: 100000, currency: "SGD" }),
    ];
    // Policy A's own wording says nothing about alternatives; the "in lieu
    // of" language exists only on policy B's pages, which composeClaim
    // must never read when composing policy A's benefits.
    const pages = [
      { policy_id: "P-A", page_number: 1, text: "Both benefits are payable in full under this certificate." },
      { policy_id: "P-B", page_number: 1, text: "The accidental death benefit is payable in lieu of the death benefit." },
    ];
    const result = compose({ coverages, assessments, wordingPages: pages });
    const included = anyIncluded(result);
    assert.equal(included.length, 2, "policy A's two benefits must both stay additive, unaffected by policy B's wording");
    assert.ok(included.every((b) => b.compositionType === "independent_additive"));
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 200000);
  });

  test("the alternative-benefit wording detector finds an explicit 'in lieu of' clause with its page citation", () => {
    const pages = wordingPages("P1", "The accidental death benefit is payable in lieu of the death benefit under this policy.");
    const signals = findCompositionSignals(pages);
    assert.ok(signals.some((s) => s.compositionType === "alternative_highest" && /in lieu of/i.test(s.quote)));
  });

  test("alternative wording selects the higher evidenced benefit and excludes the other, tagging both with the same group", () => {
    const coverages = [
      makeCoverage({ id: "cov-a1", policyId: "P1" }),
      makeCoverage({ id: "cov-a2", policyId: "P1" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 50000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-a2", calculatedAmount: 80000, currency: "SGD" }),
    ];
    const pages = wordingPages("P1", "The accidental death benefit under this Section is payable in lieu of the Death benefit above.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    const included = anyIncluded(result);
    assert.equal(included.length, 1);
    assert.equal(included[0].benefitCode, "gpa-accidental-death", "the higher evidenced amount is selected");
    assert.equal(included[0].compositionType, "alternative_highest");
    const excluded = result.excludedBenefits.find((b) => b.benefitCode === "gtl-death");
    assert.ok(excluded);
    assert.ok(excluded!.blockedReasonCodes.includes("ALTERNATIVE_NOT_SELECTED"));
    assert.equal(excluded!.compositionGroupId, included[0].compositionGroupId);
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 80000, "only the selected alternative is totalled, never both");
  });

  test("alternative wording is never invented when only one of the two benefits is present -- the sole benefit stays independent", () => {
    const coverages = [makeCoverage({ id: "cov-a1", policyId: "P1" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 50000, currency: "SGD" })];
    const pages = wordingPages("P1", "The accidental death benefit is payable in lieu of the death benefit.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    const included = anyIncluded(result);
    assert.equal(included.length, 1);
    assert.equal(included[0].compositionType, "independent_additive");
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 50000);
  });

  test("accelerated-benefit wording reduces the base benefit by exactly the accelerated amount and records the deduction", () => {
    const coverages = [
      makeCoverage({ id: "cov-a1", policyId: "P1" }),
      makeCoverage({ id: "cov-a2", policyId: "P1" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 100000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-a2", calculatedAmount: 30000, currency: "SGD" }),
    ];
    const pages = wordingPages("P1", "This early payout accelerates the death benefit and will reduce the death benefit payable under this policy accordingly.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    const included = anyIncluded(result);
    assert.equal(included.length, 2);
    const base = included.find((b) => b.benefitCode === "gtl-death")!;
    const other = included.find((b) => b.benefitCode === "gpa-accidental-death")!;
    assert.equal(base.payableAmount, 70000, "the base benefit is reduced by the accelerated amount");
    assert.equal(other.payableAmount, 30000, "the accelerated benefit itself is paid in full");
    assert.equal(base.deductionReferences.length, 1);
    assert.equal(base.deductionReferences[0].reason, "accelerated_from_base");
    assert.equal(base.deductionReferences[0].amount, 30000);
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 100000, "the total never exceeds the base sum insured");
  });

  test("additional-benefit wording adds a rider on top of the base benefit only when the wording explicitly says so", () => {
    const coverages = [
      makeCoverage({ id: "cov-a1", policyId: "P1" }),
      makeCoverage({ id: "cov-a2", policyId: "P1" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 100000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-a2", calculatedAmount: 20000, currency: "SGD" }),
    ];
    const pages = wordingPages("P1", "This accidental death benefit is payable in addition to any other benefit under this policy.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    const included = anyIncluded(result);
    assert.equal(included.length, 2);
    assert.equal(included.find((b) => b.benefitCode === "gpa-accidental-death")!.compositionType, "additional_to_base");
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 120000);
  });

  // --- Aggregate caps ----------------------------------------------------

  test("no cap is ever fabricated when the wording gives no explicit maximum", () => {
    const pages = wordingPages("P1", "This benefit is payable in full, subject to the terms of the policy.");
    assert.deepEqual(findAggregateCapSignals(pages), []);
  });

  test("a policy aggregate cap reduces the excess when the wording gives an explicit maximum", () => {
    const coverages = [
      makeCoverage({ id: "cov-a1", policyId: "P1" }),
      makeCoverage({ id: "cov-a2", policyId: "P1" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 70000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-a2", calculatedAmount: 50000, currency: "SGD" }),
    ];
    const pages = wordingPages("P1", "The aggregate maximum of S$100,000 applies to all benefits payable under this policy.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 100000, "the combined total is capped, never exceeded");
    const included = anyIncluded(result);
    assert.ok(included.some((b) => b.capReferences.some((c) => c.applied)), "at least one benefit records the applied cap deduction");
  });

  test("a shared event-scope cap applies across every policy in the same claim, after each policy's own cap", () => {
    const coverages = [
      makeCoverage({ id: "cov-a", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-A" }),
      makeCoverage({ id: "cov-b", policyId: "P-B", insurer: "Aviva", policyNumber: "POL-B" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 50000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-b", calculatedAmount: 50000, currency: "SGD" }),
    ];
    const pages = [
      { policy_id: "P-A", page_number: 1, text: "The aggregate maximum of S$70,000 per event applies across all policies for this event." },
      { policy_id: "P-B", page_number: 1, text: "No specific cap wording here." },
    ];
    const result = compose({ coverages, assessments, wordingPages: pages });
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 70000, "the shared event cap limits the combined cross-policy total");
  });

  test("multiple caps apply in sequence -- a policy's own (narrower) cap first, then any remaining excess against the shared event cap", () => {
    const coverages = [
      makeCoverage({ id: "cov-a1", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-A" }),
      makeCoverage({ id: "cov-a2", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-A" }),
      makeCoverage({ id: "cov-b", policyId: "P-B", insurer: "Aviva", policyNumber: "POL-B" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a1", calculatedAmount: 60000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-a2", calculatedAmount: 40000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-b", calculatedAmount: 50000, currency: "SGD" }),
    ];
    const pages = [
      // Policy A's own cap (80,000) is narrower than its raw 100,000 total and applies first.
      { policy_id: "P-A", page_number: 1, text: "The aggregate maximum of S$80,000 applies to all benefits payable under this policy." },
      // The shared event cap (100,000) then limits the combined post-policy-cap total across both policies.
      { policy_id: "P-B", page_number: 1, text: "The aggregate maximum of S$100,000 per event applies across all policies for this event." },
    ];
    const result = compose({ coverages, assessments, wordingPages: pages });
    // Raw total 150,000 -> policy A capped to 80,000 (60k+40k-20k excess) -> combined 80,000+50,000=130,000 -> event cap reduces to 100,000.
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 100000);
  });

  test("a lifetime cap is deducted against an explicit, user-reported prior-paid amount, never assumed", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 90000, currency: "SGD" })];
    const pages = wordingPages("P1", "The lifetime maximum of S$150,000 applies to this benefit.");
    const facts = baseFacts({ priorPaidAmounts: { P1: { amount: 100000, currency: "SGD", recordedAt: "2023-01-01T00:00:00Z" } } });
    const result = compose({ coverages, assessments, wordingPages: pages, facts });
    // Remaining lifetime capacity = 150,000 - 100,000 = 50,000, so the 90,000 claim is capped to 50,000.
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 50000);
  });

  test("a lifetime cap with no prior-paid amount on file blocks the benefit closed and asks, rather than assuming the full amount is available", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 90000, currency: "SGD" })];
    const pages = wordingPages("P1", "The lifetime maximum of S$150,000 applies to this benefit.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    assert.equal(result.totalsByCurrency.length, 0, "nothing is ever totalled against an unknown lifetime cap");
    assert.ok(result.excludedBenefits[0]?.blockedReasonCodes.includes("MISSING_PRIOR_PAID_AMOUNT"));
    assert.ok(result.outstandingQuestions.some((q) => /already been paid/i.test(q)));
  });

  // --- Point-in-time validity --------------------------------------------

  test("a policy version that does not cover the claim-event date is excluded, never counted toward the total", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1", effectiveDate: "2025-01-01", renewalOrExpiryDate: "2026-01-01" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
    const result = compose({ coverages, assessments }); // event date (facts default) is 2024-06-01, before this cover starts
    assert.equal(result.totalsByCurrency.length, 0);
    assert.ok(result.excludedBenefits[0]?.blockedReasonCodes.includes("POLICY_NOT_IN_FORCE_AT_EVENT"));
  });

  // --- Currency separation -------------------------------------------------

  test("currencies are never combined into a single total -- each currency gets its own separate total", () => {
    const coverages = [
      makeCoverage({ id: "cov-a", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-A" }),
      makeCoverage({ id: "cov-b", policyId: "P-B", insurer: "Aviva", policyNumber: "POL-B" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-b", calculatedAmount: 40000, currency: "USD" }),
    ];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.length, 2);
    assert.equal(result.totalsByCurrency.find((t) => t.currency === "SGD")?.includedAmount, 100000);
    assert.equal(result.totalsByCurrency.find((t) => t.currency === "USD")?.includedAmount, 40000);
  });

  // --- Blocked / excluded benefits are never silently $0-included --------

  test("a benefit whose underlying calculation the monetary gate did not allow is excluded, never silently included", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD", monetaryDecision: { status: "blocked", reasonCode: "TEST", message: "test" } })];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.length, 0);
    assert.ok(result.excludedBenefits[0]?.blockedReasonCodes.includes("SOURCE_CALCULATION_NOT_ALLOWED"));
  });

  test("a blocked benefit is never a hidden $0 entry in the total -- it is truly absent, not a printed zero", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1", documentRole: "product_summary" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.find((t) => t.currency === "SGD"), undefined, "no SGD total entry at all, not one that reads $0");
    assert.equal(result.excludedBenefits[0]?.payableAmount, 0);
    assert.notEqual(result.excludedBenefits[0]?.status, "included");
  });

  // --- Runtime validation: chat/model output can never invent a composition type ---

  test("validateComposedBenefit forces an unrecognised composition type closed, never trusting a claimed 'included' status", () => {
    const raw = {
      policyId: "P1", contractId: "P1", coverageId: "cov-a", familyMemberId: "fam-1", claimEventId: "claim-1",
      benefitCode: "gtl-death", benefitCategory: "Death", calculationId: "db:x", currency: "SGD",
      rawAmount: 100000, payableAmount: 100000, compositionType: "totally_made_up_by_chat", compositionGroupId: null,
      priority: 0, status: "included",
    };
    const validated = validateComposedBenefit(raw);
    assert.equal(validated.valid, true);
    if (validated.valid) {
      assert.equal(validated.benefit.compositionType, "unknown");
      assert.equal(validated.benefit.status, "blocked", "an unknown composition type can never remain included");
      assert.ok(validated.benefit.blockedReasonCodes.includes("UNKNOWN_COMPOSITION"));
      assert.equal(validated.benefit.payableAmount, 0);
    }
  });

  test("validateComposedBenefit passes a well-formed, known composition type through unchanged", () => {
    const raw: ComposedBenefit = {
      policyId: "P1", contractId: "P1", coverageId: "cov-a", familyMemberId: "fam-1", claimEventId: "claim-1",
      benefitCode: "gtl-death", benefitCategory: "Death", calculationId: "db:x", currency: "SGD",
      rawAmount: 100000, payableAmount: 100000, compositionType: "independent_additive", compositionGroupId: null,
      priority: 0, capReferences: [], deductionReferences: [], evidenceReferences: [], status: "included", blockedReasonCodes: [],
    };
    const validated = validateComposedBenefit(raw);
    assert.equal(validated.valid, true);
    if (validated.valid) assert.deepEqual(validated.benefit, raw);
  });

  test("validateComposedBenefit rejects a structurally malformed value outright", () => {
    assert.equal(validateComposedBenefit(null).valid, false);
    assert.equal(validateComposedBenefit({}).valid, false);
    const missingCurrency = validateComposedBenefit({ policyId: "P1", contractId: "P1", coverageId: "c", familyMemberId: "f", claimEventId: "e", benefitCode: "b", benefitCategory: "c", calculationId: "x", currency: "not-a-code", rawAmount: 1, priority: 0 });
    assert.equal(missingCurrency.valid, false);
  });

  // --- Calculation identity ------------------------------------------------

  test("the calculation identity changes when a material input changes (the payable amount)", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const a = compose({ coverages, assessments: [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })] });
    const b = compose({ coverages, assessments: [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 150000, currency: "SGD" })] });
    assert.notEqual(a.calculationId, b.calculationId);
  });

  test("the calculation identity stays stable across a presentation-only change (a policy's display label)", () => {
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
    const a = compose({ coverages: [makeCoverage({ id: "cov-a", policyId: "P1", policyName: "Group Term Life" })], assessments });
    const b = compose({ coverages: [makeCoverage({ id: "cov-a", policyId: "P1", policyName: "Renamed Display Label" })], assessments });
    assert.equal(a.calculationId, b.calculationId, "a display-only label change must never mint a new calculation identity");
    assert.notEqual(a.policies[0]?.policyLabel, b.policies[0]?.policyLabel, "the label itself DID change, just not the identity");
  });

  test("every calculation carries the engine version it was computed with", () => {
    const result = compose({ coverages: [makeCoverage({ id: "cov-a", policyId: "P1" })], assessments: [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 1000, currency: "SGD" })] });
    assert.equal(result.engineVersion, COMPOSITION_ENGINE_VERSION);
  });

  test("composeClaim is deterministic: identical inputs from a fact-finding preview turn and a final turn produce an identical calculation identity", () => {
    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })];
    const now = new Date("2024-06-15T00:00:00Z");
    const preview = composeClaim({ claimEventId: "claim-1", familyMemberId: "fam-1", facts: baseFacts(), coverages, assessments, wordingPages: [], now });
    const final = composeClaim({ claimEventId: "claim-1", familyMemberId: "fam-1", facts: baseFacts(), coverages, assessments, wordingPages: [], now });
    assert.equal(preview.calculationId, final.calculationId);
    assert.deepEqual(preview.totalsByCurrency, final.totalsByCurrency);
  });
}

// ---------------------------------------------------------------------
// 2. Five named end-to-end fixtures
// ---------------------------------------------------------------------

function runEndToEndFixtures() {
  test("end-to-end: an ordinary death benefit plus an accidental-death rider under one policy, no special wording, both additive", () => {
    const coverages = [
      makeCoverage({ id: "cov-life", policyId: "P1", insurer: "Singlife", policyNumber: "POL-1", productName: "Group Term Life" }),
      makeCoverage({ id: "cov-pa", policyId: "P1", insurer: "Singlife", policyNumber: "POL-1", productName: "Group Personal Accident" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-life", calculatedAmount: 200000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-pa", calculatedAmount: 200000, currency: "SGD" }),
    ];
    const pages = wordingPages("P1", "Both the Group Term Life death benefit and the Group Personal Accident accidental death benefit are payable under their own respective Sections.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    assert.equal(anyIncluded(result).length, 2);
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 400000);
    assert.ok(anyIncluded(result).every((b) => b.compositionType === "independent_additive"));
  });

  test("end-to-end: a separate personal accident policy alongside the life policy -- independent policies, both additive", () => {
    const coverages = [
      makeCoverage({ id: "cov-life", policyId: "P-LIFE", insurer: "Singlife", policyNumber: "POL-LIFE" }),
      makeCoverage({ id: "cov-pa", policyId: "P-PA", insurer: "Aviva", policyNumber: "POL-PA" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-life", calculatedAmount: 250000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-pa", calculatedAmount: 100000, currency: "SGD" }),
    ];
    const result = compose({ coverages, assessments });
    assert.equal(result.policies.length, 2);
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 350000);
  });

  test("end-to-end: employer group cover requires a verified personal ownership document before it is counted at all", () => {
    const coverages = [
      // The family only has a generic product summary for this employer
      // group plan -- no personal certificate or schedule proving they
      // are actually a covered member -- so it must be blocked, not
      // silently trusted because it names their employer's group number.
      makeCoverage({ id: "cov-group", policyId: "P-GROUP", insurer: "Singlife", policyNumber: "G007500", documentRole: "product_summary" }),
    ];
    const assessments = [makeAssessment({ id: "gtl-death", coverageId: "cov-group", calculatedAmount: 120000, currency: "SGD" })];
    const result = compose({ coverages, assessments });
    assert.equal(result.totalsByCurrency.length, 0);
    assert.ok(result.excludedBenefits[0]?.blockedReasonCodes.includes("GROUP_MEMBERSHIP_UNVERIFIED"));
  });

  test("end-to-end: an accelerated critical-illness-style benefit reduces the base death benefit by the accelerated amount", () => {
    const coverages = [
      makeCoverage({ id: "cov-life", policyId: "P1", productName: "Group Term Life" }),
      makeCoverage({ id: "cov-ci", policyId: "P1", productName: "Living Care Plus" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-life", calculatedAmount: 300000, currency: "SGD" }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: "cov-ci", calculatedAmount: 100000, currency: "SGD" }),
    ];
    const pages = wordingPages("P1", "An early payout under this rider accelerates the death benefit; the amount paid will reduce the death benefit payable under the base policy.");
    const result = compose({ coverages, assessments, wordingPages: pages });
    const base = includedIn(result, "db:gtl-death:cov-life");
    assert.ok(base);
    assert.equal(base!.payableAmount, 200000);
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 300000, "the accelerated payout never adds on top of the full base sum insured");
  });

  test("end-to-end: two policies with byte-identical wording but distinct policy identities are both counted independently, never merged as duplicates", () => {
    const sharedWordingText = "Group Term Life: Death Benefit. 100% of the Sum Insured is payable on death.";
    const coverages = [
      makeCoverage({ id: "cov-a", policyId: "P-A", insurer: "Singlife", policyNumber: "POL-DESMOND" }),
      makeCoverage({ id: "cov-b", policyId: "P-B", insurer: "Singlife", policyNumber: "POL-CHARMAINE" }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 150000, currency: "SGD" }),
      makeAssessment({ id: "gtl-death", coverageId: "cov-b", calculatedAmount: 150000, currency: "SGD" }),
    ];
    const pages = [
      { policy_id: "P-A", page_number: 1, text: sharedWordingText },
      { policy_id: "P-B", page_number: 1, text: sharedWordingText },
    ];
    const result = compose({ coverages, assessments, wordingPages: pages });
    assert.equal(result.policies.length, 2, "distinct policy numbers must never be clustered as one contract just because the wording matches");
    assert.equal(result.totalsByCurrency[0]?.includedAmount, 300000);
    assert.equal(anyIncluded(result).length, 2);
  });
}

// ---------------------------------------------------------------------
// 3. Database-backed tests (PGlite) -- the immutable audit-snapshot store
// ---------------------------------------------------------------------

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));

  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail; let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; }); await previous; return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (!params.length && text.includes(";")) {
      const results = await db.exec(text); const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => { const release = await acquire(); try { return await execute(text, params); } finally { release(); } }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  try {
    const { ensureClaimCompositionSchema, recordCompositionSnapshot, getLatestCompositionSnapshot, listCompositionSnapshots } = await import("@/lib/claims/composition/store");
    await ensureClaimCompositionSchema();

    const account = "10000000-0000-4000-8000-000000000001";
    const member = "20000000-0000-4000-8000-000000000001";
    const claim = "30000000-0000-4000-8000-000000000001";
    const otherClaim = "30000000-0000-4000-8000-000000000002";

    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Test')`, [account]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Test Member','Test','self')`, [member, account]);
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','death'),($4,$2,$3,'fact_finding','death')`, [claim, account, member, otherClaim]);

    const coverages = [makeCoverage({ id: "cov-a", policyId: "P1" })];
    const facts = baseFacts();
    const result1 = compose({ coverages, assessments: [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 100000, currency: "SGD" })] });

    await testAsync("recordCompositionSnapshot persists a new immutable audit snapshot", async () => {
      await recordCompositionSnapshot({ accountId: account, familyMemberId: member, claimSessionId: claim, facts, coverages, result: result1 });
      const latest = await getLatestCompositionSnapshot(account, claim);
      assert.ok(latest);
      assert.equal(latest!.calculation_id, result1.calculationId);
      assert.equal(latest!.engine_version, result1.engineVersion);
    });

    await testAsync("recording the identical calculation again is idempotent -- never a duplicate audit row", async () => {
      await recordCompositionSnapshot({ accountId: account, familyMemberId: member, claimSessionId: claim, facts, coverages, result: result1 });
      const all = await listCompositionSnapshots(account, claim);
      assert.equal(all.length, 1, "the same calculationId must never create a second row");
    });

    await testAsync("a genuinely new calculation (a material input changed) gets its own snapshot row", async () => {
      const result2 = compose({ coverages, assessments: [makeAssessment({ id: "gtl-death", coverageId: "cov-a", calculatedAmount: 150000, currency: "SGD" })] });
      assert.notEqual(result2.calculationId, result1.calculationId);
      await recordCompositionSnapshot({ accountId: account, familyMemberId: member, claimSessionId: claim, facts, coverages, result: result2 });
      const all = await listCompositionSnapshots(account, claim);
      assert.equal(all.length, 2);
      const latest = await getLatestCompositionSnapshot(account, claim);
      assert.equal(latest!.calculation_id, result2.calculationId, "the latest snapshot reflects the most recently recorded calculation");
    });

    await testAsync("a snapshot is scoped to its own claim session and never leaks into another claim's audit trail", async () => {
      const forOther = await listCompositionSnapshots(account, otherClaim);
      assert.equal(forOther.length, 0);
    });

    await testAsync("ensureClaimCompositionSchema is idempotent -- calling it again does not error or duplicate the table", async () => {
      await ensureClaimCompositionSchema();
      await ensureClaimCompositionSchema();
      const all = await listCompositionSnapshots(account, claim);
      assert.equal(all.length, 2, "schema re-application must never disturb existing audit rows");
    });
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
}

export async function runClaimCompositionRegressions() {
  runPureTests();
  runEndToEndFixtures();
  await runDatabaseTests();
  console.log(`DearPolicy claim-composition engine regressions passed (${cases} cases).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runClaimCompositionRegressions().catch((error) => { console.error(error); process.exitCode = 1; });
}
