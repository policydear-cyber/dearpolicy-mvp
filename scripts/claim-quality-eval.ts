/**
 * Golden-dataset quality evaluation for the deterministic, evidence-gated
 * claim engine -- the cross-product analogue of scripts/real-household-
 * replay.ts, but for the NEW per-benefit pipeline built across this
 * session's stacked PRs (lib/claims/rules.ts + ci-rules.ts + medical-
 * rules.ts + disability-rules.ts + travel-rules.ts) rather than the older
 * generic benefit-catalog path real-household-replay.ts exercises.
 *
 * Every other claims:*-test suite in this repository proves ONE module in
 * isolation, calling its own assess*()/next*Question() functions directly
 * with fixtures built just for it. That is necessary but not sufficient:
 * it has never proven that lib/claims/rules.ts's assessClaim()/
 * nextClaimQuestion() -- the ONE place a real turn actually calls --
 * assembles several products correctly for the SAME family member and the
 * SAME claim event. A household that owns Group Term Life, Group Personal
 * Accident, Living Care, a Hospitalisation plan, a Disability Income plan
 * and Travel cover all at once is the normal case, not an edge case, and
 * nothing else in this repository runs a single claim event through all of
 * them together and checks the assembled result.
 *
 * So this is a golden dataset of realistic multi-product scenarios --
 * "many product types" as the PR names it -- run through the real
 * top-level functions, never a module's internals directly, and scored
 * against four dimensions:
 *   - correctness: with complete, evidenced facts, every benefit that
 *     should calculate does, with the exact right amount.
 *   - fail-closed: with an evidenced benefit but incomplete facts, every
 *     benefit stays needs_document/not_applicable -- never a guessed
 *     amount -- and the missing piece is never silently skipped.
 *   - question-routing: nextClaimQuestion() asks the right NEXT question
 *     across five interacting gates (death-cause, CI, disability, medical,
 *     travel) in the same household, never skipping one or asking a
 *     already-answered one.
 *   - cross-product isolation: a benefit's own gate (an evidence match
 *     scoped to a different claim, a currency mismatch, a trip-date gate)
 *     never blocks or unlocks a DIFFERENT product's benefit in the same
 *     assessment.
 *
 * A 100% pass rate is required -- these are exact, already-specified
 * business rules, not a fuzzy extraction metric like scripts/extraction-
 * eval.ts's recall score. Failing scenarios print their full expected vs.
 * actual diff so a real regression is diagnosable from the CI log alone.
 */
import { assessClaim, nextClaimQuestion } from "@/lib/claims/rules";
import { EMPTY_CLAIM_FACTS, type ClaimAssessmentItem, type ClaimEvidence, type ClaimFacts } from "@/lib/claims/types";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { DeathEvidenceGap, DeathRuleEvidence } from "@/lib/claims/death-evidence";
import type { CIEvidenceGap, CIRuleEvidence } from "@/lib/claims/ci-evidence";
import type { MedicalRuleEvidence } from "@/lib/claims/medical-rules";
import type { DisabilityRuleEvidence } from "@/lib/claims/disability-evidence";
import type { DisabilityRuleSet } from "@/lib/claims/disability-rules";
import { TOTAL_PERMANENT_DISABILITY_MATCH_KEY } from "@/lib/claims/calculators/disability-benefit";
import type { TravelRuleSet } from "@/lib/claims/travel-rules";
import type { CauseDefinitionMatch, CIDefinitionMatch, DisabilityDefinitionMatch, VerifiedMedicalBillFacts } from "@/lib/claims/calculators/evidence";
import { verifiedEvidenceProvenance } from "@/scripts/fixtures/verified-evidence-provenance";
import { definitionWordingHash } from "@/lib/claims/evidence/decision-selection";

// ---------------------------------------------------------------------
// The household: one family member owning six covers across five
// products, mirroring a normal DearPolicy account -- not a fixture built
// to make one product look good in isolation.
// ---------------------------------------------------------------------

const FM = "fam-quality-1";
const CLAIM = "claim-quality-1";
const LIFE_POLICY = "policy-life"; // GTL + GPA share one contract, like the real MINDEF/MHA scheme this codebase already fixtures elsewhere.
const CI_POLICY = "policy-ci";
const HOSP_POLICY = "policy-hosp";
const DI_POLICY = "policy-di";
const TRAVEL_POLICY = "policy-travel";
const CCY = "SGD";
const ILLNESS = "Systemic Lupus Erythematosus"; // deliberately outside the legacy living-care regex (cancer/heart attack/stroke/kidney), so only the NEW ci-* pipeline is exercised.

function baseCoverage(overrides: Partial<OwnedCoverage>): OwnedCoverage {
  return {
    id: "x", policyId: "p", familyMemberId: FM, category: "Death", amount: null, currency: CCY, productName: null,
    sourcePage: 1, evidenceText: null, insurer: "Great Eastern", policyName: "Household Plan", policyNumber: "P-1",
    groupPolicyNumber: null, documentRole: "certificate", effectiveDate: "2020-01-01", renewalOrExpiryDate: null, currencyVerified: true,
    ...overrides,
  };
}

const gtl = baseCoverage({ id: "cov-gtl", policyId: LIFE_POLICY, category: "Death", productName: "Group Term Life", amount: 500_000, groupPolicyNumber: "G007500" });
const gpa = baseCoverage({ id: "cov-gpa", policyId: LIFE_POLICY, category: "Personal Accident", productName: "Group Personal Accident", amount: 300_000, groupPolicyNumber: "G007500" });
const ci = baseCoverage({ id: "cov-ci", policyId: CI_POLICY, category: "Critical Illness", productName: "Living Care", amount: 200_000, effectiveDate: "2019-01-01" });
const hosp = baseCoverage({ id: "cov-hosp", policyId: HOSP_POLICY, category: "Hospitalisation", productName: "Hospitalisation Plan", amount: null, effectiveDate: "2019-01-01" });
const di = baseCoverage({ id: "cov-di", policyId: DI_POLICY, category: "Disability Income", productName: "Disability Income Plan", amount: null, effectiveDate: "2019-01-01" });
// The travel certificate states its currency (see lib/claims/currency-evidence.ts).
const travel = baseCoverage({ id: "cov-travel", policyId: TRAVEL_POLICY, category: "Travel", productName: "Travel Protect360", amount: null, effectiveDate: "2024-01-01", currencyVerified: true, policyDocumentVersion: "sha256:travel-protect360-v1" });
const HOUSEHOLD: OwnedCoverage[] = [gtl, gpa, ci, hosp, di, travel];

function citation(policyId: string, page: number, label: string): ClaimEvidence {
  return { chunkId: `page:${policyId}:${page}`, policyId, policyName: "Household Plan", pageStart: page, pageEnd: page, evidenceLabel: label };
}

// ---- Death: GTL + GPA accidental death, evidence-gated ----
const DEATH_RULES: DeathRuleEvidence[] = [
  { coverageId: gtl.id, benefit: "gtl-death", quote: "100% of Sum Insured on death.", citation: citation(LIFE_POLICY, 4, "GTL death wording"), formula: { kind: "sum_insured_fraction", fraction: 1 } },
  { coverageId: gpa.id, benefit: "gpa-accidental-death", quote: "100% of Sum Insured on accidental death.", citation: citation(LIFE_POLICY, 9, "GPA accidental death wording"), formula: { kind: "sum_insured_fraction", fraction: 1 } },
];
const DEATH_GAPS: DeathEvidenceGap[] = [];

// ---- Critical illness: Living Care major-illness, evidence-gated ----
const CI_RULES: CIRuleEvidence[] = [
  { coverageId: ci.id, benefitCode: "ci-major", illnessName: ILLNESS, quote: `Major Cancer and other severe critical illnesses including ${ILLNESS}: 100% of Sum Insured.`, citation: citation(CI_POLICY, 19, "Living Care major-illness wording"), formula: { kind: "sum_insured_fraction", fraction: 1 } },
];
const CI_GAPS: CIEvidenceGap[] = [];

// ---- Disability: TPD lump sum on the SAME GPA cover ----
const TPD_RULE: DisabilityRuleEvidence = { coverageId: gpa.id, benefitCode: "tpd-lump-sum", matchKey: TOTAL_PERMANENT_DISABILITY_MATCH_KEY, label: "Total & Permanent Disability", quote: "150% of Sum Insured for qualifying TPD.", formula: { kind: "sum_insured_fraction", fraction: 1.5 }, citation: citation(LIFE_POLICY, 11, "GPA TPD wording") };
const DISABILITY_RULES: DisabilityRuleSet = { rules: [TPD_RULE], gaps: [] };

// ---- Medical: Hospitalisation Plan inpatient reimbursement ----
const MEDICAL_RULES: MedicalRuleEvidence = {
  cashRules: [],
  reimbursementRules: [{ coverageId: hosp.id, benefitCode: "med-inpatient", eligibleCategories: ["surgical_fees"], categoryLimits: [], quote: "Inpatient medical benefits as charged.", citation: citation(HOSP_POLICY, 6, "Inpatient reimbursement wording") }],
  planProvisions: [],
  gaps: [],
};

// ---- Travel: Overseas Medical Expenses + Accidental Death ----
const TRAVEL_RULES: TravelRuleSet = {
  rules: [
    { coverageId: travel.id, benefitCode: "travel-medical-expenses", eligibleCategories: ["surgical_fees", "hospitalisation"], overallCap: null, quote: "Overseas Medical Expenses: as charged.", citation: citation(TRAVEL_POLICY, 2, "Travel medical wording") },
    { coverageId: travel.id, benefitCode: "travel-accidental-death", amount: 150_000, currency: CCY, quote: "Accidental Death Benefit: S$150,000.", citation: citation(TRAVEL_POLICY, 3, "Travel accidental death wording") },
  ],
  gaps: [],
};
const EMPTY_TRAVEL: TravelRuleSet = { rules: [], gaps: [] };

function bill(overrides: Partial<VerifiedMedicalBillFacts> = {}): VerifiedMedicalBillFacts {
  return {
    lineItems: [{ category: "surgical_fees", description: "Appendectomy", amountMinor: 800_000, currency: CCY, documentId: "doc-bill-1", documentType: "hospital_bill" }],
    thirdPartyPayments: [], admissionISO: "2024-06-03T08:00:00+08:00", dischargeISO: "2024-06-06T10:00:00+08:00",
    hospitalName: "Test Hospital", hospitalCountry: "SG", admissionType: "inpatient", wardType: "standard",
    sourceDocumentIds: ["doc-bill-1"], provenance: [verifiedEvidenceProvenance("doc-bill-1")], ...overrides,
  };
}
function causeMatch(overrides: Partial<CauseDefinitionMatch> = {}): CauseDefinitionMatch {
  return {
    familyMemberId: FM, claimEventId: CLAIM, contractId: LIFE_POLICY, coverageId: gpa.id,
    causeEvidence: { documentId: "doc-death", documentType: "death_certificate", pageStart: 1, pageEnd: 1, familyMemberId: FM, claimEventId: CLAIM },
    definitionEvidence: { policyId: LIFE_POLICY, chunkId: citation(LIFE_POLICY, 9, "x").chunkId, pageStart: 9, pageEnd: 9, wordingHash: definitionWordingHash("100% of Sum Insured on accidental death.") },
    provenance: verifiedEvidenceProvenance("doc-death"),
    result: "matches", reviewedAt: "2024-06-10T00:00:00Z", ...overrides,
  };
}
function travelDeathMatch(overrides: Partial<CauseDefinitionMatch> = {}): CauseDefinitionMatch {
  return { ...causeMatch(), contractId: TRAVEL_POLICY, coverageId: travel.id, definitionEvidence: { policyId: TRAVEL_POLICY, chunkId: citation(TRAVEL_POLICY, 3, "x").chunkId, pageStart: 3, pageEnd: 3, wordingHash: definitionWordingHash("Accidental Death Benefit: S$150,000.") }, ...overrides };
}
function ciMatch(overrides: Partial<CIDefinitionMatch> = {}): CIDefinitionMatch {
  return {
    familyMemberId: FM, claimEventId: CLAIM, contractId: CI_POLICY, coverageId: ci.id, benefitCode: "ci-major", illnessName: ILLNESS,
    medicalEvidence: { documentId: "doc-medical", documentType: "medical_report", familyMemberId: FM, claimEventId: CLAIM, pageStart: 2, pageEnd: 2 },
    definitionEvidence: { policyId: CI_POLICY, chunkId: citation(CI_POLICY, 19, "x").chunkId, pageStart: 19, pageEnd: 19, wordingHash: definitionWordingHash(`Major Cancer and other severe critical illnesses including ${ILLNESS}: 100% of Sum Insured.`) },
    provenance: verifiedEvidenceProvenance("doc-medical"),
    result: "matches", reviewedAt: "2024-01-01T00:00:00.000Z", ...overrides,
  };
}
function tpdMatch(overrides: Partial<DisabilityDefinitionMatch> = {}): DisabilityDefinitionMatch {
  return {
    familyMemberId: FM, claimEventId: CLAIM, contractId: LIFE_POLICY, coverageId: gpa.id, benefitCode: "tpd-lump-sum", matchKey: TOTAL_PERMANENT_DISABILITY_MATCH_KEY,
    medicalEvidence: { documentId: "doc-tpd", documentType: "specialist_memo", familyMemberId: FM, claimEventId: CLAIM, pageStart: 3, pageEnd: 3 },
    definitionEvidence: { policyId: LIFE_POLICY, chunkId: citation(LIFE_POLICY, 11, "x").chunkId, pageStart: 11, pageEnd: 11, wordingHash: definitionWordingHash("150% of Sum Insured for qualifying TPD.") },
    provenance: verifiedEvidenceProvenance("doc-tpd"),
    result: "matches", reviewedAt: "2024-01-01T00:00:00.000Z", ...overrides,
  };
}
function facts(overrides: Partial<ClaimFacts>): ClaimFacts { return { ...EMPTY_CLAIM_FACTS, ...overrides }; }

// ---------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------

type ItemExpectation = { id: string; status: ClaimAssessmentItem["status"]; calculatedAmount?: number };
type Dimension = "correctness" | "fail-closed" | "question-routing" | "cross-product-isolation";
type Scenario = {
  name: string; dimension: Dimension; facts: ClaimFacts;
  deathRules?: DeathRuleEvidence[]; deathGaps?: DeathEvidenceGap[]; ciRules?: CIRuleEvidence[]; ciGaps?: CIEvidenceGap[];
  medicalRules?: MedicalRuleEvidence; disabilityRules?: DisabilityRuleSet; travelRules?: TravelRuleSet;
  expectQuestion?: string | null; expectItems: ItemExpectation[];
  /** Item ids that must NOT appear at all -- for proving a product that
   * has no evidence yet contributes nothing, rather than an empty/blocked
   * placeholder. */
  expectAbsentIds?: string[];
};

const scenarios: Scenario[] = [
  // ---- Death: GTL + GPA + Travel accidental death, all evidenced ----
  {
    name: "death: GTL, GPA and Travel accidental-death all calculate together, and the household is ready",
    dimension: "correctness",
    facts: facts({
      eventType: "death", death: true, deathDate: "2024-06-05", accidentalDeath: true,
      causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true,
      causeDefinitionMatches: [causeMatch(), travelDeathMatch()],
      tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    }),
    deathRules: DEATH_RULES, deathGaps: DEATH_GAPS, travelRules: TRAVEL_RULES,
    expectQuestion: null,
    expectItems: [
      { id: "gtl-death", status: "potentially_applicable", calculatedAmount: 500_000 },
      { id: "gpa-accidental-death", status: "potentially_applicable", calculatedAmount: 300_000 },
      { id: "travel-accidental-death", status: "potentially_applicable", calculatedAmount: 150_000 },
    ],
  },
  {
    name: "death: missing trip dates asks for them, and blocks ONLY the travel benefit -- GTL/GPA still calculate",
    dimension: "fail-closed",
    facts: facts({
      eventType: "death", death: true, deathDate: "2024-06-05", accidentalDeath: true,
      causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true,
      causeDefinitionMatches: [causeMatch(), travelDeathMatch()],
    }),
    deathRules: DEATH_RULES, deathGaps: DEATH_GAPS, travelRules: TRAVEL_RULES,
    expectQuestion: "trip_departure_date",
    expectItems: [
      { id: "gtl-death", status: "potentially_applicable", calculatedAmount: 500_000 },
      { id: "gpa-accidental-death", status: "potentially_applicable", calculatedAmount: 300_000 },
      { id: "travel-accidental-death", status: "needs_document" },
    ],
  },
  {
    name: "death: a cause match scoped to a DIFFERENT claim never unlocks GPA or Travel, but never blocks GTL (which needs no cause match at all)",
    dimension: "cross-product-isolation",
    facts: facts({
      eventType: "death", death: true, deathDate: "2024-06-05", accidentalDeath: true,
      causeOfDeathDocumentAvailable: true, causeOfDeathEvidenceReviewed: true,
      causeDefinitionMatches: [causeMatch({ claimEventId: "a-different-claim" }), travelDeathMatch({ claimEventId: "a-different-claim" })],
      tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    }),
    deathRules: DEATH_RULES, deathGaps: DEATH_GAPS, travelRules: TRAVEL_RULES,
    // Nothing further to ask (every chat-reportable fact is already
    // known) -- the family is never asked to explain why an amount is
    // missing; the missing amount itself, and its reason text, is the
    // only signal. Fail-closed must never depend on there being an
    // outstanding question to hide behind.
    expectQuestion: null,
    expectItems: [
      { id: "gtl-death", status: "potentially_applicable", calculatedAmount: 500_000 },
      { id: "gpa-accidental-death", status: "needs_document" },
      { id: "travel-accidental-death", status: "needs_document" },
    ],
  },

  // ---- Critical illness ----
  {
    name: "diagnosis: Living Care calculates once reviewed medical evidence matches, and the household is ready",
    dimension: "correctness",
    facts: facts({ eventType: "diagnosis", diagnosis: ILLNESS, diagnosisDate: "2024-03-01", hospitalised: false, medicalEvidenceDocumentAvailable: true, ciDefinitionMatches: [ciMatch()] }),
    ciRules: CI_RULES, ciGaps: CI_GAPS,
    expectQuestion: null,
    expectItems: [{ id: "ci-major-systemic-lupus-erythematosus", status: "potentially_applicable", calculatedAmount: 200_000 }],
  },
  {
    name: "diagnosis: no medical evidence reviewed yet asks for it, and shows no amount",
    dimension: "fail-closed",
    facts: facts({ eventType: "diagnosis", diagnosis: ILLNESS, diagnosisDate: "2024-03-01", hospitalised: false }),
    ciRules: CI_RULES, ciGaps: CI_GAPS,
    expectQuestion: "medical_evidence_document",
    expectItems: [{ id: "ci-major-systemic-lupus-erythematosus", status: "needs_document" }],
  },

  // ---- Disability ----
  {
    name: "disability: TPD (150% of Sum Insured) and Premium Waiver both confirm once the medical assessment matches, and the household is ready",
    dimension: "correctness",
    facts: facts({ eventType: "disability", eventDate: "2024-04-01", permanentImpairment: true, diagnosis: "traumatic brain injury", disabilityAssessmentDocumentAvailable: true, disabilityAssessmentEvidenceReviewed: true, disabilityDefinitionMatches: [tpdMatch()] }),
    disabilityRules: DISABILITY_RULES,
    expectQuestion: null,
    expectItems: [
      { id: "tpd-lump-sum", status: "potentially_applicable", calculatedAmount: 450_000 },
      { id: "premium-waiver", status: "likely_applicable" },
    ],
  },
  {
    name: "disability: no medical assessment reported yet asks for it, and shows no TPD amount",
    dimension: "fail-closed",
    facts: facts({ eventType: "disability", eventDate: "2024-04-01", permanentImpairment: true, diagnosis: "traumatic brain injury" }),
    disabilityRules: DISABILITY_RULES,
    expectQuestion: "disability_assessment_document",
    expectItems: [{ id: "tpd-lump-sum", status: "needs_document" }],
  },

  // ---- Hospitalisation: medical reimbursement + travel medical, together ----
  {
    name: "hospitalisation: the Hospitalisation Plan AND Travel both reimburse the same reviewed bill as two separate covers, and the household is ready",
    dimension: "correctness",
    facts: facts({
      eventType: "hospitalisation", eventDate: "2024-06-03", diagnosis: "appendicitis", hospitalNights: 3, hospitalBill: 8_000, outOfPocket: 8_000,
      verifiedMedicalBillFacts: bill(), medicalBillDocumentAvailable: true, medicalBillEvidenceReviewed: true, panelStatusReported: "panel",
      tripDepartureDate: "2024-06-01", tripReturnDate: "2024-06-10",
    }),
    medicalRules: MEDICAL_RULES, travelRules: TRAVEL_RULES,
    expectQuestion: null,
    expectItems: [
      { id: "med-inpatient", status: "potentially_applicable", calculatedAmount: 8_000 },
      { id: "travel-medical-expenses", status: "potentially_applicable", calculatedAmount: 8_000 },
      // The legacy hardcoded G007500 hospital-cash item is a documented
      // pre-existing quirk (see lib/claims/rules.ts's own comment): it
      // keys off ANY G007500 cover the household owns (the GTL cover
      // here), not off the coverage that was actually hospitalised, and
      // it does not clear its own 10-day waiting period at 3 nights.
      { id: "gtl-hospital-cash", status: "not_applicable" },
    ],
  },
  {
    name: "hospitalisation: no reviewed bill and no trip dates asks for the admission date first, and shows no amount on either cover",
    dimension: "question-routing",
    facts: facts({ eventType: "hospitalisation", eventDate: "2024-06-03", diagnosis: "appendicitis" }),
    medicalRules: MEDICAL_RULES, travelRules: TRAVEL_RULES,
    expectQuestion: "admission_date",
    expectItems: [
      { id: "med-inpatient", status: "needs_document" },
      { id: "travel-medical-expenses", status: "needs_document" },
    ],
  },
  {
    name: "hospitalisation: a household member whose Travel wording has not been read yet still gets the Hospitalisation Plan assessed normally, and Travel contributes nothing at all",
    dimension: "cross-product-isolation",
    facts: facts({
      eventType: "hospitalisation", eventDate: "2024-06-03", diagnosis: "appendicitis", hospitalNights: 3, hospitalBill: 8_000, outOfPocket: 8_000,
      verifiedMedicalBillFacts: bill(), medicalBillDocumentAvailable: true, medicalBillEvidenceReviewed: true, panelStatusReported: "panel",
    }),
    medicalRules: MEDICAL_RULES, travelRules: EMPTY_TRAVEL,
    expectQuestion: null,
    expectItems: [{ id: "med-inpatient", status: "potentially_applicable", calculatedAmount: 8_000 }],
    expectAbsentIds: ["travel-medical-expenses"],
  },
];

// ---------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------

function diff(expected: unknown, actual: unknown) { return `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`; }

let passed = 0;
const failures: string[] = [];
const byDimension = new Map<Dimension, { passed: number; total: number }>();

for (const s of scenarios) {
  const bucket = byDimension.get(s.dimension) ?? { passed: 0, total: 0 };
  bucket.total++;
  byDimension.set(s.dimension, bucket);

  const problems: string[] = [];
  if (s.expectQuestion !== undefined) {
    const q = nextClaimQuestion(s.facts, HOUSEHOLD, s.deathRules ?? [], s.ciRules ?? [], s.medicalRules, s.disabilityRules, s.travelRules ?? EMPTY_TRAVEL);
    const actualId = q?.id ?? null;
    if (actualId !== s.expectQuestion) problems.push(`nextClaimQuestion: ${diff(s.expectQuestion, actualId)}`);
  }
  const items = assessClaim(s.facts, HOUSEHOLD, s.deathRules ?? [], s.deathGaps ?? [], CLAIM, s.ciRules ?? [], s.ciGaps ?? [], s.medicalRules, s.disabilityRules, s.travelRules ?? EMPTY_TRAVEL);
  for (const want of s.expectItems) {
    const got = items.find((i) => i.id === want.id);
    if (!got) { problems.push(`item "${want.id}": expected to be present, was missing entirely`); continue; }
    if (got.status !== want.status) problems.push(`item "${want.id}".status: ${diff(want.status, got.status)}`);
    if (want.calculatedAmount !== undefined && got.calculatedAmount !== want.calculatedAmount) problems.push(`item "${want.id}".calculatedAmount: ${diff(want.calculatedAmount, got.calculatedAmount)}`);
    if (want.calculatedAmount === undefined && got.calculatedAmount !== undefined) problems.push(`item "${want.id}".calculatedAmount: expected no amount (fail-closed), got ${got.calculatedAmount}`);
  }
  for (const absentId of s.expectAbsentIds ?? []) {
    if (items.some((i) => i.id === absentId)) problems.push(`item "${absentId}": expected to be entirely absent, but it was present`);
  }

  if (problems.length === 0) { passed++; bucket.passed++; console.log(`PASS  [${s.dimension}] ${s.name}`); }
  else { failures.push(s.name); console.log(`FAIL  [${s.dimension}] ${s.name}`); for (const p of problems) console.log(`      ${p}`); }
}

console.log(`\nclaim-quality-eval: ${passed}/${scenarios.length} scenarios passed.`);
for (const [dimension, { passed: p, total }] of byDimension) console.log(`  ${dimension}: ${p}/${total}`);

if (failures.length > 0) {
  console.log(`\n${failures.length} scenario(s) failed -- a golden household this repository already depends on no longer assembles correctly across products.`);
  process.exitCode = 1;
}
