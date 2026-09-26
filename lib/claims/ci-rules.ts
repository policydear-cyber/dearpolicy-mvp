/**
 * Deterministic critical-illness benefit assessment and fact-finding --
 * the CI analogue of the death/accident logic in lib/claims/rules.ts, kept
 * in its own module and wired in ADDITIVELY (see rules.ts's own imports of
 * assessCriticalIllness/nextCIQuestion) so nothing here can change the
 * behaviour of an existing "living-care"/"living-care-plus" item that
 * scripts/claim-smoke.ts and scripts/claim-answer-eval.ts already assert
 * on by exact id and amount. Every ci-* item this module produces is a new,
 * additional row alongside those legacy informational ones -- a documented
 * V1 limitation, not an oversight (see the stacked PR description).
 *
 * This module never diagnoses, never decides a medical match, and never
 * computes money itself -- it only turns already-resolved policy wording
 * (lib/claims/ci-evidence.ts), already-reviewed CIDefinitionMatch records
 * (ClaimFacts.ciDefinitionMatches, loaded fresh every turn), and
 * already-established chat facts into calls to the one pure calculator,
 * calculateCriticalIllness(), exactly the way rules.ts's assessClaim()
 * does for calculateDeathBenefit()/calculateAccidentalDeath().
 */
import { formatMoney } from "@/lib/format/currency";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimEvidence, ClaimFacts, ClaimQuestion } from "./types";
import type { CIEvidenceGap, CIRuleEvidence } from "./ci-evidence";
import { calculateCriticalIllness, type CIEvidenceRef, type CIFormula, type CIInput } from "./calculators/critical-illness";
import type { CIDefinitionMatch } from "./calculators/evidence";
import { currentDefinition, selectApplicableDecision } from "./evidence/decision-selection";
import { checkNonTravelCurrency } from "./currency-evidence";

function amountText(amount: number | null, currency = "SGD") { return amount == null ? null : formatMoney(amount, currency); }

function toCIEvidenceRef(c: ClaimEvidence): CIEvidenceRef {
  return { chunkId: c.chunkId, policyId: c.policyId, pageStart: c.pageStart, pageEnd: c.pageEnd, label: c.evidenceLabel };
}

function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

/** The one applicable, already-reviewed match between reviewed medical
 * evidence and THIS SPECIFIC policy's own definition of THIS SPECIFIC
 * benefit/illness, or `null` when none has been reviewed yet -- the CI
 * analogue of rules.ts's applicableCauseDefinitionMatch(). A match for a
 * different illness or benefit code, even under the very same policy and
 * claim, is never returned here -- see calculateCriticalIllness()'s own,
 * independent re-check of every one of these same fields. */
function applicableCIDefinitionMatch(facts: ClaimFacts, coverage: OwnedCoverage, rule: CIRuleEvidence, sessionId: string | null): CIDefinitionMatch | null {
  if (sessionId == null) return null;
  return selectApplicableDecision(facts.ciDefinitionMatches.filter((m) =>
    m.contractId === coverage.policyId &&
    m.familyMemberId === coverage.familyMemberId &&
    m.claimEventId === sessionId &&
    (m.coverageId == null || m.coverageId === coverage.id) &&
    m.benefitCode === rule.benefitCode &&
    m.illnessName === rule.illnessName,
  ), currentDefinition(rule.citation, rule.quote));
}

const NEEDS_REVIEW_REASON: Record<string, string> = {
  needs_medical_review: "The uploaded medical evidence still needs specialist/medical review before it can be compared against the policy's definition.",
  needs_policy_review: "The reviewed medical evidence has been checked, but whether it satisfies the policy's own wording is still unclear and needs further review.",
  insufficient_evidence: "There is not yet enough medical evidence to assess this benefit.",
  ambiguous: "The reviewed medical evidence and the policy's wording could not be deterministically compared against each other, so this needs review.",
};

/** Whole days elapsed from an ISO date to now -- used only to decide
 * whether an evidenced survival period has already passed BEFORE this
 * module ever passes a `survivalPeriod` into the pure calculator, exactly
 * as calculateCriticalIllness()'s own doc comment on survivalPeriod
 * requires of its caller. */
function daysElapsedSince(isoDate: string): number | null {
  const then = Date.parse(isoDate);
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/** Builds one ci-* ClaimAssessmentItem for one resolved policy rule. Never
 * called for anything but a "diagnosis" event, and never for a rule whose
 * coverage cannot be found among this family member's confirmed cover. */
function assessOneCIRule(facts: ClaimFacts, coverage: OwnedCoverage, rule: CIRuleEvidence, sessionId: string | null): ClaimAssessmentItem {
  // Starts with the calculator-facing benefit code itself (always
  // "ci-major"/"ci-early"/"ci-intermediate", so always "ci-...") rather
  // than an extra "ci-" prefix on top of it -- this id becomes the
  // composed benefit's own benefitCode in
  // lib/claims/composition/engine.ts, whose isPrimaryBenefitCode()/
  // benefitCategoryFor() helpers key off that exact "ci-" prefix.
  const id = `${rule.benefitCode}-${slug(rule.illnessName)}`;
  const title = `${rule.illnessName} (${coverage.productName ?? "critical illness cover"})`;
  const base = { id, title, productName: coverage.productName, coverageId: coverage.id, evidenceTerms: [rule.illnessName] };
  const ruleEvidence = toCIEvidenceRef(rule.citation);

  const match = applicableCIDefinitionMatch(facts, coverage, rule, sessionId);
  if (!match) {
    return {
      ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null,
      reason: `Potential policy-based estimate: a ${rule.illnessName} benefit may apply under this cover, but DearPolicy has not included an amount because reviewed medical evidence has not yet been matched against this policy's own definition. This is not a diagnosis, claim approval, or guarantee of payment.`,
      conditions: ["Upload the specialist memo, medical report, or other supporting medical evidence for this diagnosis.", "Medical or insurer review is still required."],
    };
  }
  if (match.result === "does_not_match") {
    return { ...base, ruleEvidence: rule.citation, status: "not_applicable", amountText: null, reason: `The reviewed medical evidence does not match this policy's own definition of ${rule.illnessName}.`, conditions: [] };
  }
  if (match.result !== "matches") {
    return {
      ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null,
      reason: `Potential policy-based estimate: a ${rule.illnessName} benefit may apply. ${NEEDS_REVIEW_REASON[match.result] ?? "This benefit still needs review."} Medical or insurer review is still required. This is not a diagnosis, claim approval, or guarantee of payment.`,
      conditions: ["Medical or insurer review is still required."],
    };
  }

  // match.result === "matches" from here on -- the calculator independently
  // re-checks every one of these fields again before it will compute
  // anything, so nothing below is trusted blindly.
  const currencyCheck = checkNonTravelCurrency({ coverage, requireCoverageCurrency: true,
    quoted: [rule.formula.kind === "fixed" ? rule.formula.currency : undefined, rule.cap ? rule.cap.currency : undefined] });
  if (!currencyCheck.ok) {
    return { ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null, reason: currencyCheck.reason, conditions: [currencyCheck.condition] };
  }

  const formula: CIFormula = rule.formula.kind === "fixed"
    ? { kind: "fixed", amount: rule.formula.amount, evidence: ruleEvidence }
    : rule.formula.kind === "sum_insured_fraction"
      ? { kind: "sum_insured_fraction", fraction: rule.formula.fraction, evidence: ruleEvidence }
      : { kind: "stage_percentage", stage: rule.formula.stage, fraction: rule.formula.fraction, evidence: ruleEvidence };

  // The evidenced stage is derived from the rule the reviewer explicitly
  // confirmed a "matches" decision against (see
  // app/api/claims/evidence/[id]/ci-match/route.ts's required benefitCode
  // + illnessName body fields) -- never from a chat-reported stage, per
  // calculateCriticalIllness()'s own requirement.
  const evidencedStage = rule.formula.kind === "stage_percentage" ? rule.formula.stage : undefined;

  const waitingPeriod = rule.waitingPeriod
    ? { days: rule.waitingPeriod.days, fromDate: coverage.effectiveDate ?? null, evidence: { ...ruleEvidence, chunkId: `page:${rule.citation.policyId}:${rule.waitingPeriod.page}`, pageStart: rule.waitingPeriod.page, pageEnd: rule.waitingPeriod.page } }
    : undefined;

  let survivalPeriod: CIInput["survivalPeriod"];
  if (rule.survivalPeriod && facts.diagnosisDate) {
    const elapsed = daysElapsedSince(facts.diagnosisDate);
    if (elapsed == null || elapsed < rule.survivalPeriod.days) {
      return {
        ...base, ruleEvidence: rule.citation, status: "not_applicable", amountText: null,
        reason: `This benefit requires the insured to survive at least ${rule.survivalPeriod.days} days from the diagnosis date. That period has not yet been confirmed to have elapsed.`,
        conditions: [],
      };
    }
    survivalPeriod = { days: rule.survivalPeriod.days, evidence: { ...ruleEvidence, chunkId: `page:${rule.citation.policyId}:${rule.survivalPeriod.page}`, pageStart: rule.survivalPeriod.page, pageEnd: rule.survivalPeriod.page } };
  }

  const ownershipEvidence: CIEvidenceRef = { chunkId: `coverage:${coverage.id}`, policyId: coverage.policyId, coverageId: coverage.id, familyMemberId: coverage.familyMemberId, label: coverage.productName ?? undefined };

  const input: CIInput = {
    ownership: { contractId: coverage.policyId, coverageId: coverage.id, label: coverage.productName ?? undefined },
    familyMember: { id: coverage.familyMemberId, confirmed: true },
    claimEventId: sessionId,
    benefitCode: rule.benefitCode,
    illnessName: rule.illnessName,
    diagnosisDate: facts.diagnosisDate,
    policyEffectiveDate: coverage.effectiveDate,
    sumInsured: coverage.amount,
    currency: coverage.currency,
    formula,
    ...(rule.cap ? { cap: { amount: rule.cap.amount, evidence: ruleEvidence } } : {}),
    ruleEvidence,
    ownershipEvidence,
    definitionEvidence: ruleEvidence,
    definitionMatch: match,
    ...(evidencedStage ? { evidencedStage } : {}),
    ...(waitingPeriod ? { waitingPeriod } : {}),
    ...(survivalPeriod ? { survivalPeriod } : {}),
  };

  const calc = calculateCriticalIllness(input);

  const conditions = ["The diagnosis must satisfy this policy's own defined critical illness, as reviewed against the uploaded medical evidence.", "Medical or insurer review is still required."];
  if (rule.waitingPeriod) conditions.push(`Confirmed against this cover's ${rule.waitingPeriod.days}-day waiting period.`);
  if (rule.survivalPeriod) conditions.push(`This benefit requires survival of ${rule.survivalPeriod.days} days from the diagnosis date, which has been confirmed to have elapsed.`);

  if (calc.status === "blocked") {
    return { ...base, ruleEvidence: rule.citation, status: "needs_document", amountText: null, reason: `Potential policy-based estimate: a ${rule.illnessName} benefit may apply. DearPolicy has not included an amount: ${calc.message}`, conditions: [calc.message] };
  }
  if (calc.status === "not_applicable") {
    return { ...base, ruleEvidence: rule.citation, status: "not_applicable", amountText: null, reason: calc.reason, conditions: [] };
  }
  return {
    ...base, ruleEvidence: rule.citation, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
    calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
    reason: `Potential policy-based estimate: the uploaded evidence appears consistent with this policy's definition of ${rule.illnessName}. The matching clause pays ${calc.formulaBasis}. Medical or insurer review is still required. This is not a diagnosis, claim approval, or guarantee of payment.`,
    conditions,
  };
}

export function assessCriticalIllness(facts: ClaimFacts, coverages: OwnedCoverage[], ciRules: CIRuleEvidence[], ciGaps: CIEvidenceGap[] = [], sessionId: string | null = null): ClaimAssessmentItem[] {
  if (facts.eventType !== "diagnosis") return [];
  const items: ClaimAssessmentItem[] = [];
  for (const rule of ciRules) {
    const coverage = coverages.find((c) => c.id === rule.coverageId);
    if (!coverage) continue;
    items.push(assessOneCIRule(facts, coverage, rule, sessionId));
  }
  // A coverage that DearPolicy could not resolve any wording for at all
  // (see lib/claims/ci-evidence.ts's resolveCIEvidence()) still deserves a
  // visible, honest needs_document row -- exactly like an unresolved GTL/
  // GPA death-benefit coverage already gets from deathGaps in
  // assessClaim() -- rather than silently vanishing from the assessment.
  const coveredCoverageIds = new Set(ciRules.map((r) => r.coverageId));
  for (const gap of ciGaps) {
    if (coveredCoverageIds.has(gap.coverageId)) continue;
    const coverage = coverages.find((c) => c.id === gap.coverageId);
    if (!coverage) continue;
    items.push({
      id: `ci-gap-${gap.coverageId}`, title: `Critical illness benefit (${coverage.productName ?? "cover"})`,
      productName: coverage.productName, coverageId: coverage.id, evidenceTerms: [],
      status: "needs_document", amountText: null,
      reason: `Personal ownership of this critical-illness cover is confirmed. ${gap.reason}`,
      conditions: [gap.nextStep],
    });
  }
  return items;
}

/** One-question-at-a-time CI fact-finding, prioritised by
 * eligibility/amount impact -- called additively from
 * lib/claims/rules.ts's nextClaimQuestion() only once a "diagnosis" event
 * has at least one resolved critical-illness policy rule, so it never
 * fires (and never changes behaviour) for an account with no verified CI
 * wording. Never re-asks a fact already established, and never asks the
 * family to interpret medical terminology that an uploaded report could
 * answer instead -- see the medical_evidence_document_upload question
 * below, which asks for the document itself rather than for a
 * self-diagnosed stage or exact wording. */
export function nextCIQuestion(facts: ClaimFacts, ciRules: CIRuleEvidence[]): ClaimQuestion | null {
  if (facts.eventType !== "diagnosis" || !ciRules.length) return null;

  if (facts.medicalEvidenceDocumentAvailable == null && !facts.uncertainFacts.includes("medical_evidence_document")) {
    return {
      id: "medical_evidence_document",
      text: "Do you have a specialist memo, medical report, pathology/imaging/laboratory report, or discharge/surgical report confirming this diagnosis? You can say “not sure” if you have not checked yet.",
      type: "yes_no", options: ["Yes", "No", "Not sure"],
      why: "A potential critical-illness benefit needs reviewed medical evidence matched against the policy's own definition before DearPolicy can show an amount.",
    };
  }
  if (facts.medicalEvidenceDocumentAvailable === true && !facts.ciDefinitionMatches.length) {
    return {
      id: "medical_evidence_document_upload",
      text: "Please upload the specialist memo, medical report, or other supporting document. DearPolicy will check it against the policy's own critical-illness definition before showing an amount.",
      type: "text",
      why: "Saying the document exists is not the same as DearPolicy having reviewed it. Only reviewed evidence, checked against the policy's own definition, can confirm this benefit.",
    };
  }
  const stageRule = ciRules.find((r) => r.formula.kind === "stage_percentage");
  if (stageRule && !facts.diagnosisStage && !facts.uncertainFacts.includes("diagnosis_stage")) {
    return {
      id: "diagnosis_stage",
      text: "What stage or severity was the diagnosis (for example, early stage, intermediate stage, or major/advanced)? Use the exact term from the medical report if you know it.",
      type: "text",
      why: "Early/intermediate critical-illness benefits pay a different percentage depending on the evidenced stage, and the stage stated in the report -- not a guess -- is what DearPolicy checks against the policy's own definition.",
    };
  }
  return null;
}
