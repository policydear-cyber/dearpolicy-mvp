/**
 * Regression suite for the deterministic critical-illness claim engine
 * (lib/claims/calculators/critical-illness.ts, lib/claims/ci-rules.ts, and
 * the composition-engine tightening in lib/claims/composition/engine.ts),
 * stacked on the evidence-pipeline and composition-engine work in
 * PR #9/#10.
 *
 * Four parts:
 *  1. Pure-function tests for calculateCriticalIllness() -- the one place
 *     a critical-illness amount is ever computed. Every fail-closed branch
 *     (missing/mismatched definition match, unresolved stage, unmet
 *     waiting period, unverified multi-pay tranche, unresolved exclusion,
 *     a reprocessed document invalidating a stale match) is exercised
 *     directly against the real function.
 *  2. Pure-function tests for lib/claims/ci-rules.ts's assessCriticalIllness()
 *     and nextCIQuestion() -- confirming a match for one illness can never
 *     unlock a different illness's benefit, an unresolved coverage still
 *     surfaces an honest gap row, and fact-finding asks for reviewed
 *     evidence rather than a self-reported stage.
 *  3. Composition-engine tests confirming the required tightening: an
 *     unresolved same-policy group containing more than one
 *     critical-illness benefit is now BLOCKED rather than defaulted to
 *     additive, while the pre-existing death/personal-accident behaviour
 *     (and an evidenced "additional" CI relationship) is unchanged.
 *  4. Database-backed tests for the CI schema/store layer
 *     (lib/claims/evidence/ci-schema.ts, ci-matches.ts's
 *     recordCIDefinitionMatch scoping), against a disposable PGlite
 *     instance -- confirming a match is superseded only within its own
 *     exact (benefit code, illness name) scope, and never leaks across
 *     claim sessions.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";

import { calculateCriticalIllness, type CIEvidenceRef, type CIInput } from "@/lib/claims/calculators/critical-illness";
import type { CIDefinitionMatch } from "@/lib/claims/calculators/evidence";
import { assessCriticalIllness, nextCIQuestion } from "@/lib/claims/ci-rules";
import type { CIEvidenceGap, CIRuleEvidence } from "@/lib/claims/ci-evidence";
import { composeClaim } from "@/lib/claims/composition/engine";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import { verifiedEvidenceProvenance } from "./fixtures/verified-evidence-provenance";

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

const FM = "fam-1";
const CLAIM = "claim-1";
const POLICY = "policy-1";
const COVERAGE = "cov-1";
const CCY = "SGD";

function citation(overrides: Partial<CIEvidenceRef> = {}): CIEvidenceRef {
  return { policyId: POLICY, chunkId: "page:policy-1:10", pageStart: 10, pageEnd: 10, label: "Major Cancer wording", ...overrides };
}
function ownershipEvidence(): CIEvidenceRef {
  return { policyId: POLICY, chunkId: `coverage:${COVERAGE}`, coverageId: COVERAGE, familyMemberId: FM };
}
function medicalEvidence(overrides: Record<string, unknown> = {}) {
  return { documentId: "doc-1", documentType: "medical_report", familyMemberId: FM, claimEventId: CLAIM, pageStart: 2, pageEnd: 2, ...overrides };
}
function ciMatch(overrides: Partial<CIDefinitionMatch> = {}): CIDefinitionMatch {
  return {
    familyMemberId: FM, claimEventId: CLAIM, contractId: POLICY, coverageId: COVERAGE,
    benefitCode: "ci-major", illnessName: "Major Cancer",
    medicalEvidence: medicalEvidence(), definitionEvidence: citation(),
    result: "matches", reviewedAt: "2024-01-01T00:00:00.000Z",
    provenance: verifiedEvidenceProvenance("doc-1"),
    ...overrides,
  };
}
function baseCIInput(overrides: Partial<CIInput> = {}): CIInput {
  return {
    ownership: { contractId: POLICY, coverageId: COVERAGE },
    familyMember: { id: FM, confirmed: true },
    claimEventId: CLAIM,
    benefitCode: "ci-major",
    illnessName: "Major Cancer",
    diagnosisDate: "2024-06-01",
    policyEffectiveDate: "2020-01-01",
    sumInsured: 100_000,
    currency: CCY,
    formula: { kind: "fixed", amount: 50_000, evidence: citation() },
    ruleEvidence: citation(),
    ownershipEvidence: ownershipEvidence(),
    definitionEvidence: citation(),
    definitionMatch: ciMatch(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------
// 1. calculateCriticalIllness()
// ---------------------------------------------------------------------

function runCalculatorTests() {
  test("blocked when no reviewed definition match has been recorded at all", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: null }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "DEFINITION_MATCH_MISSING");
  });

  test("not_applicable when the reviewed match explicitly does not satisfy the policy definition", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ result: "does_not_match" }) }));
    assert.equal(result.status, "not_applicable");
  });

  test("blocked when the match was reviewed against a different benefit code -- an early-stage match can never unlock the major benefit", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ benefitCode: "ci-early" }) }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "DEFINITION_MATCH_BENEFIT_MISMATCH");
  });

  test("blocked when the match was reviewed against a different illness name under the very same benefit code", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ illnessName: "Different Cancer" }) }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "DEFINITION_MATCH_ILLNESS_MISMATCH");
  });

  test("blocked when the match belongs to a different family member", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ familyMemberId: "other-fam" }) }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH");
  });

  test("blocked when the match belongs to a different claim event", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ claimEventId: "other-claim" }) }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH");
  });

  test("blocked when the match's own definition evidence no longer matches the current wording citation -- a reprocessed document invalidates the match automatically", () => {
    const stale = citation({ chunkId: "page:policy-1:99", pageStart: 99, pageEnd: 99 });
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ definitionEvidence: stale }) }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH");
  });

  test("blocked when the match's own medical evidence is malformed", () => {
    const result = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ medicalEvidence: {} }) }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "MALFORMED_MEDICAL_EVIDENCE");
  });

  test("calculates a fixed-amount benefit and produces a stable calculationId across repeated calls", () => {
    const input = baseCIInput();
    const r1 = calculateCriticalIllness(input);
    const r2 = calculateCriticalIllness(input);
    assert.equal(r1.status, "calculated");
    assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") {
      assert.equal(r1.potentialAmount, 50_000);
      assert.equal(r1.currency, "SGD");
      assert.equal(r1.calculationId, r2.calculationId, "identical inputs must produce an identical calculation identity");
      assert.ok(r1.calculationId.startsWith("ci:"));
    }
  });

  test("calculates a percentage-of-sum-insured benefit correctly", () => {
    const result = calculateCriticalIllness(baseCIInput({ formula: { kind: "sum_insured_fraction", fraction: 0.5, evidence: citation() } }));
    assert.equal(result.status, "calculated");
    if (result.status === "calculated") assert.equal(result.potentialAmount, 50_000);
  });

  test("applies an evidenced cap when the raw calculated amount exceeds it -- the lesser of the two is always what is shown", () => {
    const result = calculateCriticalIllness(baseCIInput({
      formula: { kind: "sum_insured_fraction", fraction: 1, evidence: citation() },
      cap: { amount: 30_000, evidence: citation() },
    }));
    assert.equal(result.status, "calculated");
    if (result.status === "calculated") { assert.equal(result.potentialAmount, 30_000); assert.equal(result.capApplied, true); }
  });

  test("blocked when a stage-based formula has no evidenced stage at all", () => {
    const result = calculateCriticalIllness(baseCIInput({
      benefitCode: "ci-early", illnessName: "Early Stage Critical Illness",
      formula: { kind: "stage_percentage", stage: "Early", fraction: 0.25, evidence: citation() },
      definitionMatch: ciMatch({ benefitCode: "ci-early", illnessName: "Early Stage Critical Illness" }),
    }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "STAGE_NOT_EVIDENCED");
  });

  test("blocked when the evidenced stage does not equal the stage this formula pays for", () => {
    const result = calculateCriticalIllness(baseCIInput({
      benefitCode: "ci-early", illnessName: "Early Stage Critical Illness",
      formula: { kind: "stage_percentage", stage: "Early", fraction: 0.25, evidence: citation() },
      evidencedStage: "Intermediate",
      definitionMatch: ciMatch({ benefitCode: "ci-early", illnessName: "Early Stage Critical Illness" }),
    }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "STAGE_MISMATCH");
  });

  test("calculates a stage-based benefit once the evidenced stage matches the formula's own stage", () => {
    const result = calculateCriticalIllness(baseCIInput({
      benefitCode: "ci-early", illnessName: "Early Stage Critical Illness",
      formula: { kind: "stage_percentage", stage: "Early", fraction: 0.25, evidence: citation() },
      evidencedStage: "early",
      definitionMatch: ciMatch({ benefitCode: "ci-early", illnessName: "Early Stage Critical Illness" }),
    }));
    assert.equal(result.status, "calculated");
    if (result.status === "calculated") assert.equal(result.potentialAmount, 25_000);
  });

  test("not_applicable when the diagnosis date falls within the evidenced waiting period", () => {
    const result = calculateCriticalIllness(baseCIInput({
      diagnosisDate: "2024-06-01",
      waitingPeriod: { days: 90, fromDate: "2024-05-20", evidence: citation() },
    }));
    assert.equal(result.status, "not_applicable");
  });

  test("calculates once the diagnosis date falls after the evidenced waiting period has elapsed", () => {
    const result = calculateCriticalIllness(baseCIInput({
      diagnosisDate: "2024-06-01",
      waitingPeriod: { days: 90, fromDate: "2024-01-01", evidence: citation() },
    }));
    assert.equal(result.status, "calculated");
  });

  test("blocked when this is not the first multi-pay tranche and earlier tranches have not been verified", () => {
    const result = calculateCriticalIllness(baseCIInput({ multiPay: { tranche: 2, totalTranches: 3, priorTranchesVerified: false } }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "MULTI_PAY_PRIOR_TRANCHE_UNVERIFIED");
  });

  test("calculates a later multi-pay tranche once every earlier tranche is verified", () => {
    const result = calculateCriticalIllness(baseCIInput({ multiPay: { tranche: 2, totalTranches: 3, priorTranchesVerified: true } }));
    assert.equal(result.status, "calculated");
  });

  test("blocked when a policy exclusion's applicability is still unresolved -- never inferred from weak evidence", () => {
    const result = calculateCriticalIllness(baseCIInput({ exclusions: [{ key: "pre_existing_condition", evidence: citation(), applies: null }] }));
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reasonCode, "UNRESOLVED_EXCLUSION");
  });

  test("not_applicable when a policy exclusion is confirmed by reviewed evidence to apply", () => {
    const result = calculateCriticalIllness(baseCIInput({ exclusions: [{ key: "pre_existing_condition", evidence: citation(), applies: true }] }));
    assert.equal(result.status, "not_applicable");
  });

  test("not_applicable when the diagnosis date precedes this cover's own effective date", () => {
    const result = calculateCriticalIllness(baseCIInput({ policyEffectiveDate: "2025-01-01", diagnosisDate: "2024-06-01" }));
    assert.equal(result.status, "not_applicable");
  });

  test("calculationId changes when the reviewed medical evidence document changes -- a material evidence change always invalidates the prior identity", () => {
    const r1 = calculateCriticalIllness(baseCIInput());
    const r2 = calculateCriticalIllness(baseCIInput({ definitionMatch: ciMatch({ medicalEvidence: medicalEvidence({ documentId: "doc-2" }) }) }));
    assert.equal(r1.status, "calculated"); assert.equal(r2.status, "calculated");
    if (r1.status === "calculated" && r2.status === "calculated") assert.notEqual(r1.calculationId, r2.calculationId);
  });
}

// ---------------------------------------------------------------------
// 2. lib/claims/ci-rules.ts
// ---------------------------------------------------------------------

function makeCoverage(overrides: Partial<OwnedCoverage> & { id: string; policyId: string }): OwnedCoverage {
  return {
    familyMemberId: FM, category: "Critical Illness", amount: 50_000, currency: CCY, productName: "Living Care",
    sourcePage: null, evidenceText: null, insurer: "Singlife", policyName: "Living Care", policyNumber: overrides.policyId.toUpperCase(),
    groupPolicyNumber: "G007500", documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null,
    ...overrides,
  };
}
function makeCIRule(overrides: Partial<CIRuleEvidence> = {}): CIRuleEvidence {
  return {
    coverageId: COVERAGE, benefitCode: "ci-major", illnessName: "Major Cancer",
    quote: "100% of Sum Insured shall be paid for Major Cancer.", formula: { kind: "fixed", amount: 50_000, currency: CCY },
    citation: { policyId: POLICY, policyName: "Living Care", chunkId: "page:policy-1:10", pageStart: 10, pageEnd: 10, evidenceLabel: "Major Cancer wording" },
    ...overrides,
  };
}
function baseCIFacts(overrides: Partial<ClaimFacts> = {}): ClaimFacts {
  return { ...EMPTY_CLAIM_FACTS, eventType: "diagnosis", diagnosis: "cancer", diagnosisDate: "2024-06-01", ...overrides };
}

function runCiRulesTests() {
  const coverages = [makeCoverage({ id: COVERAGE, policyId: POLICY })];

  test("assessCriticalIllness returns nothing at all for a non-diagnosis event, even with resolved CI wording", () => {
    const items = assessCriticalIllness(baseCIFacts({ eventType: "death" }), coverages, [makeCIRule()], [], CLAIM);
    assert.equal(items.length, 0);
  });

  test("produces a needs_document item with no amount when no reviewed definition match exists yet", () => {
    const items = assessCriticalIllness(baseCIFacts(), coverages, [makeCIRule()], [], CLAIM);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "needs_document");
    assert.equal(items[0].amountText, null);
    assert.ok(items[0].reason.includes("Potential policy-based estimate"));
  });

  test("produces a not_applicable item when the reviewed match says the evidence does not match the definition", () => {
    const facts = baseCIFacts({ ciDefinitionMatches: [ciMatch({ result: "does_not_match" })] });
    const items = assessCriticalIllness(facts, coverages, [makeCIRule()], [], CLAIM);
    assert.equal(items[0].status, "not_applicable");
  });

  test("produces a potentially_applicable item with the correctly calculated amount once matched", () => {
    const facts = baseCIFacts({ ciDefinitionMatches: [ciMatch()] });
    const items = assessCriticalIllness(facts, coverages, [makeCIRule()], [], CLAIM);
    assert.equal(items[0].status, "potentially_applicable");
    assert.equal(items[0].calculatedAmount, 50_000);
    assert.ok(items[0].amountText);
    assert.ok(items[0].reason.includes("This is not a diagnosis, claim approval, or guarantee of payment."));
  });

  test("a match confirmed for one illness can never unlock a different illness's benefit under the same coverage", () => {
    const rules = [makeCIRule(), makeCIRule({ benefitCode: "ci-early", illnessName: "Early Stage Critical Illness", formula: { kind: "stage_percentage", stage: "Early", fraction: 0.25 } })];
    const facts = baseCIFacts({ ciDefinitionMatches: [ciMatch()] }); // matches only "Major Cancer" / ci-major
    const items = assessCriticalIllness(facts, coverages, rules, [], CLAIM);
    const major = items.find((i) => i.id.startsWith("ci-major"));
    const early = items.find((i) => i.id.startsWith("ci-early"));
    assert.equal(major?.status, "potentially_applicable");
    assert.equal(early?.status, "needs_document", "the Major Cancer match must never be treated as covering the Early Stage benefit too");
  });

  test("a coverage DearPolicy could not resolve any critical-illness wording for at all still surfaces an honest needs_document gap row", () => {
    const gaps: CIEvidenceGap[] = [{ coverageId: COVERAGE, reason: "No matching wording was found.", nextStep: "Upload the wording.", reasonCode: "NO_MATCHING_DOCUMENT" }];
    const items = assessCriticalIllness(baseCIFacts(), coverages, [], gaps, CLAIM);
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "needs_document");
    assert.equal(items[0].amountText, null);
  });

  test("nextCIQuestion asks whether medical evidence exists before anything else", () => {
    const q = nextCIQuestion(baseCIFacts(), [makeCIRule()]);
    assert.equal(q?.id, "medical_evidence_document");
  });

  test("nextCIQuestion asks for the document itself, never a self-reported interpretation, once availability is confirmed", () => {
    const q = nextCIQuestion(baseCIFacts({ medicalEvidenceDocumentAvailable: true }), [makeCIRule()]);
    assert.equal(q?.id, "medical_evidence_document_upload");
  });

  test("nextCIQuestion asks for the evidenced stage only once medical evidence is in hand and a stage-based rule exists", () => {
    const facts = baseCIFacts({ medicalEvidenceDocumentAvailable: true, ciDefinitionMatches: [ciMatch()] });
    const q = nextCIQuestion(facts, [makeCIRule({ benefitCode: "ci-early", illnessName: "Early Stage Critical Illness", formula: { kind: "stage_percentage", stage: "Early", fraction: 0.25 } })]);
    assert.equal(q?.id, "diagnosis_stage");
  });

  test("nextCIQuestion returns null once every CI-specific fact it asks about is already established", () => {
    const facts = baseCIFacts({ medicalEvidenceDocumentAvailable: true, ciDefinitionMatches: [ciMatch()], diagnosisStage: "Early" });
    const stageRule = makeCIRule({ benefitCode: "ci-early", illnessName: "Early Stage Critical Illness", formula: { kind: "stage_percentage", stage: "Early", fraction: 0.25 } });
    const q = nextCIQuestion(facts, [stageRule]);
    assert.equal(q, null);
  });

  test("nextCIQuestion never fires for a diagnosis event with no resolved critical-illness wording at all", () => {
    const q = nextCIQuestion(baseCIFacts(), []);
    assert.equal(q, null);
  });
}

// ---------------------------------------------------------------------
// 3. Composition-engine tightening
// ---------------------------------------------------------------------

function makeCompositionCoverage(overrides: Partial<OwnedCoverage> & { id: string; policyId: string }): OwnedCoverage {
  return {
    familyMemberId: FM, category: "Death", amount: null, currency: CCY, productName: "Group Term Life",
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

function runCompositionTighteningTests() {
  test("an unresolved same-policy pair of critical-illness benefits is BLOCKED rather than defaulted to additive", () => {
    const coverages = [
      makeCompositionCoverage({ id: COVERAGE, policyId: POLICY, productName: "Living Care" }),
      makeCompositionCoverage({ id: `${COVERAGE}-plus`, policyId: POLICY, productName: "Living Care Plus" }),
    ];
    const assessments = [
      makeAssessment({ id: "ci-major-major-cancer", coverageId: COVERAGE, calculatedAmount: 50_000, currency: CCY }),
      makeAssessment({ id: "ci-early-early-stage-critical-illness", coverageId: `${COVERAGE}-plus`, calculatedAmount: 12_500, currency: CCY }),
    ];
    const result = composeClaim({ claimEventId: CLAIM, familyMemberId: FM, facts: baseCIFacts(), coverages, assessments, wordingPages: [] });
    const benefits = result.policies.flatMap((p) => p.benefits);
    assert.equal(benefits.length, 2);
    for (const b of benefits) {
      assert.equal(b.status, "blocked");
      assert.ok(b.blockedReasonCodes.includes("CI_COMPOSITION_NOT_EVIDENCED"));
    }
    assert.equal(result.totalsByCurrency.length, 0, "an unresolved CI pair must never contribute to any currency total");
  });

  test("an unresolved same-policy Group Term Life + Personal Accident pair is unchanged: still defaults to additive", () => {
    const coverages = [
      makeCompositionCoverage({ id: COVERAGE, policyId: POLICY }),
      makeCompositionCoverage({ id: `${COVERAGE}-gpa`, policyId: POLICY }),
    ];
    const assessments = [
      makeAssessment({ id: "gtl-death", coverageId: COVERAGE, calculatedAmount: 100_000, currency: CCY }),
      makeAssessment({ id: "gpa-accidental-death", coverageId: `${COVERAGE}-gpa`, calculatedAmount: 50_000, currency: CCY }),
    ];
    const result = composeClaim({ claimEventId: CLAIM, familyMemberId: FM, facts: { ...EMPTY_CLAIM_FACTS, eventType: "death", deathDate: "2024-06-01" }, coverages, assessments, wordingPages: [] });
    const benefits = result.policies.flatMap((p) => p.benefits);
    assert.ok(benefits.every((b) => b.status === "included"), "pre-existing death-benefit composition behaviour must not regress");
    assert.equal(result.totalsByCurrency.find((t) => t.currency === CCY)?.includedAmount, 150_000);
  });

  test("an evidenced additional-benefit wording signal still composes a same-policy CI pair as additional rather than blocking it", () => {
    const coverages = [
      makeCompositionCoverage({ id: COVERAGE, policyId: POLICY, productName: "Living Care" }),
      makeCompositionCoverage({ id: `${COVERAGE}-plus`, policyId: POLICY, productName: "Living Care Plus" }),
    ];
    const assessments = [
      makeAssessment({ id: "ci-major-major-cancer", coverageId: COVERAGE, calculatedAmount: 50_000, currency: CCY }),
      makeAssessment({ id: "ci-early-early-stage-critical-illness", coverageId: `${COVERAGE}-plus`, calculatedAmount: 12_500, currency: CCY }),
    ];
    const wordingPages = [{ policy_id: POLICY, page_number: 5, text: "The Early Stage Critical Illness benefit is payable in addition to any other benefit under this policy." }];
    const result = composeClaim({ claimEventId: CLAIM, familyMemberId: FM, facts: baseCIFacts(), coverages, assessments, wordingPages });
    const benefits = result.policies.flatMap((p) => p.benefits);
    assert.ok(benefits.every((b) => b.status === "included"), "an explicit additional-benefit wording signal must still resolve, not block");
    assert.equal(result.totalsByCurrency.find((t) => t.currency === CCY)?.includedAmount, 62_500);
    const early = benefits.find((b) => b.benefitCode.startsWith("ci-early"));
    assert.equal(early?.compositionType, "additional_to_base");
    assert.equal(early?.benefitCategory, "Early Critical Illness");
    const major = benefits.find((b) => b.benefitCode.startsWith("ci-major"));
    assert.equal(major?.benefitCategory, "Critical Illness");
  });
}

// ---------------------------------------------------------------------
// 4. Database-backed tests (PGlite)
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
    const { ensureCriticalIllnessSchema } = await import("@/lib/claims/evidence/ci-schema");
    await ensureCriticalIllnessSchema();
    const { createEvidenceDocument, recordCIDefinitionMatch, loadActiveCIDefinitionMatches } = await import("@/lib/claims/evidence/store");

    const account = "10000000-0000-4000-8000-000000000001";
    const desmond = "20000000-0000-4000-8000-000000000001";
    const claimA = "30000000-0000-4000-8000-000000000001";
    const claimB = "30000000-0000-4000-8000-000000000002";
    const policyA = "40000000-0000-4000-8000-0000000000a1";

    await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Test')`, [account]);
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Tan Yi Chuen Desmond','Desmond','self')`, [desmond, account]);
    await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','diagnosis'),($4,$2,$3,'fact_finding','diagnosis')`, [claimA, account, desmond, claimB]);
    await pool.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,group_policy_number,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,document_authority)
       VALUES($1,$2,$3,'Singlife','Living Care','G007500','certificate',true,'ready','cert.pdf','k',90)`,
      [policyA, account, desmond],
    );

    await testAsync("ensureCriticalIllnessSchema is idempotent and creates the claim_ci_definition_matches table", async () => {
      await ensureCriticalIllnessSchema();
      await ensureCriticalIllnessSchema();
      const r = await pool.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='claim_ci_definition_matches') AS exists`);
      assert.equal(r.rows[0].exists, true);
    });

    let docId = "";
    await testAsync("createEvidenceDocument accepts a medical evidence document type -- the widened CHECK constraint", async () => {
      const { document } = await createEvidenceDocument({
        accountId: account, familyMemberId: desmond, claimSessionId: claimA,
        documentType: "medical_report", originalFilename: "report.pdf", storageKey: "k1",
        mimeType: "application/pdf", byteSize: 1024, fileHash: "hash-1",
      });
      docId = document.id;
      assert.equal(document.document_type, "medical_report");
    });

    await testAsync("recordCIDefinitionMatch scopes superseding to the exact (benefit code, illness name) pair -- a Major Cancer match never supersedes an Early Stage match under the same claim", async () => {
      await recordCIDefinitionMatch({
        accountId: account, familyMemberId: desmond, claimSessionId: claimA, contractId: policyA, coverageId: null,
        evidenceDocumentId: docId, benefitCode: "ci-major", illnessName: "Major Cancer",
        medicalEvidence: medicalEvidence(), definitionEvidence: citation(),
        result: "matches", reviewedBy: "Household reviewer", reason: null,
      });
      await recordCIDefinitionMatch({
        accountId: account, familyMemberId: desmond, claimSessionId: claimA, contractId: policyA, coverageId: null,
        evidenceDocumentId: docId, benefitCode: "ci-early", illnessName: "Early Stage Critical Illness",
        medicalEvidence: medicalEvidence(), definitionEvidence: citation(),
        result: "needs_medical_review", reviewedBy: "Household reviewer", reason: null,
      });
      const active = await loadActiveCIDefinitionMatches(account, desmond, claimA);
      assert.equal(active.length, 2, "two distinct (benefit, illness) scopes must both remain active, not supersede one another");
    });

    await testAsync("a corrected review for the SAME (benefit code, illness name) scope supersedes the prior one, leaving exactly one active match for it", async () => {
      await recordCIDefinitionMatch({
        accountId: account, familyMemberId: desmond, claimSessionId: claimA, contractId: policyA, coverageId: null,
        evidenceDocumentId: docId, benefitCode: "ci-major", illnessName: "Major Cancer",
        medicalEvidence: medicalEvidence(), definitionEvidence: citation(),
        result: "does_not_match", reviewedBy: "Household reviewer", reason: "Corrected after re-review.",
      });
      const active = await loadActiveCIDefinitionMatches(account, desmond, claimA);
      const majorMatches = active.filter((m) => m.benefit_code === "ci-major" && m.illness_name === "Major Cancer");
      assert.equal(majorMatches.length, 1);
      assert.equal(majorMatches[0].result, "does_not_match");
    });

    await testAsync("a CI definition match never leaks into a different claim session", async () => {
      const forOtherClaim = await loadActiveCIDefinitionMatches(account, desmond, claimB);
      assert.equal(forOtherClaim.length, 0);
    });
  } finally {
    pool.query = originalQuery; pool.connect = originalConnect;
    await db.close();
  }
}

export async function runClaimCIRegressions() {
  runCalculatorTests();
  runCiRulesTests();
  runCompositionTighteningTests();
  await runDatabaseTests();
  console.log(`DearPolicy critical-illness engine regressions passed (${cases} cases).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runClaimCIRegressions().catch((error) => { console.error(error); process.exitCode = 1; });
}
