/**
 * Assembles the disability benefits (Total & Permanent Disability,
 * permanent-partial-disability/dismemberment paid from a schedule of
 * injuries, disability income, and a non-monetary premium-waiver status)
 * for a "disability" claim event -- the disability analogue of
 * lib/claims/ci-rules.ts and lib/claims/medical-rules.ts.
 *
 * Like those two modules, this one is deliberately synchronous: the caller
 * (lib/claims/orchestrator.ts) loads the async evidence
 * (lib/claims/disability-evidence.ts's loadDisabilityEvidence()) once per
 * turn and passes the result in, so the assessment logic itself stays
 * trivially testable with plain objects (see
 * scripts/claim-disability-regressions.ts).
 *
 * SAFETY BOUNDARY -- this is the load-bearing rule of this whole module,
 * not a comment to skim: nothing here, and nothing in
 * lib/claims/calculators/disability-benefit.ts or
 * lib/claims/calculators/disability-income.ts, ever decides on its own
 * that a disability is permanent, or that a reported injury matches a
 * named schedule-of-injuries row. Every monetary amount below is gated on
 * an already-reviewed DisabilityDefinitionMatch (see
 * lib/claims/calculators/evidence.ts) -- a chat answer, an uploaded
 * document's mere presence, or a plausible-sounding description is NEVER
 * enough by itself. Until that match exists and is confirmed, every
 * disability benefit this module can find wording for is shown as
 * `needs_document`, with no amount, exactly like an unresolved
 * cause-of-death or critical-illness benefit.
 *
 * V1 scope, documented here and in the PR, not hidden: premium waiver is
 * represented as a non-monetary confirmed/needs_document status only (it
 * rides on the very same TPD DisabilityDefinitionMatch) -- no premium
 * ledger recalculation or refund is computed. A permanent-partial-
 * disability/dismemberment claim is shown as ONE combined review item
 * until a specific schedule row has an actual reviewed match, rather than
 * one item per unreviewed row in the policy's own schedule (which can list
 * dozens of injuries) -- see assessScheduleBenefits()'s own doc comment.
 */
import { formatMoney } from "@/lib/format/currency";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimEvidence, ClaimFacts, ClaimQuestion } from "./types";
import type { DisabilityEvidenceGap, DisabilityRuleEvidence } from "./disability-evidence";
import { calculateDisabilityBenefit, TOTAL_PERMANENT_DISABILITY_MATCH_KEY, type DisabilityEvidenceRef, type DisabilityFormula as DisabilityBenefitFormula } from "./calculators/disability-benefit";
import { calculateDisabilityIncome, DISABILITY_INCOME_MATCH_KEY, type DisabilityIncomeEvidenceRef } from "./calculators/disability-income";
import type { DisabilityDefinitionMatch } from "./calculators/evidence";
import { currentDefinition, selectApplicableDecision } from "./evidence/decision-selection";

export type DisabilityRuleSet = { rules: DisabilityRuleEvidence[]; gaps: DisabilityEvidenceGap[] };
const EMPTY_DISABILITY_RULES: DisabilityRuleSet = { rules: [], gaps: [] };

function amountText(amount: number | null, currency = "SGD") { return amount == null ? null : formatMoney(amount, currency); }
function toRef(c: ClaimEvidence): DisabilityEvidenceRef & DisabilityIncomeEvidenceRef {
  return { chunkId: c.chunkId, policyId: c.policyId, pageStart: c.pageStart, pageEnd: c.pageEnd, label: c.evidenceLabel };
}
function ownershipRef(coverage: OwnedCoverage) {
  return { contractId: coverage.policyId, coverageId: coverage.id, label: coverage.productName ?? undefined };
}
function ownershipEvidenceRef(coverage: OwnedCoverage) {
  return { chunkId: `coverage:${coverage.id}`, policyId: coverage.policyId, coverageId: coverage.id, familyMemberId: coverage.familyMemberId, label: coverage.productName ?? undefined };
}

/** The one applicable, already-reviewed match for this exact benefit/match
 * key under this coverage's contract -- never taken from chat text or
 * availability signals alone. Mirrors lib/claims/rules.ts's own
 * applicableCauseDefinitionMatch()/ci-rules.ts's applicableCIMatch(). */
function applicableDisabilityMatch(facts: ClaimFacts, coverage: OwnedCoverage, sessionId: string | null, benefitCode: string, matchKey: string, currentDefinition: unknown): DisabilityDefinitionMatch | null {
  if (sessionId == null) return null;
  return selectApplicableDecision(facts.disabilityDefinitionMatches.filter(m =>
    m.contractId === coverage.policyId &&
    m.familyMemberId === coverage.familyMemberId &&
    m.claimEventId === sessionId &&
    m.benefitCode === benefitCode &&
    m.matchKey.trim().toLowerCase() === matchKey.trim().toLowerCase() &&
    (m.coverageId == null || m.coverageId === coverage.id),
  ), currentDefinition);
}

function assessTPDBenefit(rule: DisabilityRuleEvidence, coverage: OwnedCoverage, facts: ClaimFacts, sessionId: string | null): ClaimAssessmentItem {
  const base = {
    id: "tpd-lump-sum", title: "Total & Permanent Disability", productName: coverage.productName, coverageId: coverage.id,
    evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined,
  };
  const match = applicableDisabilityMatch(facts, coverage, sessionId, "tpd-lump-sum", TOTAL_PERMANENT_DISABILITY_MATCH_KEY, currentDefinition(rule.citation, rule.quote));
  // Same currency guard as lib/claims/rules.ts and ci-rules.ts: a fixed
  // amount or cap quoted in another currency than the verified sum insured
  // is never applied to it (it would otherwise be treated as the same
  // currency by the calculator).
  const formulaCurrencyOk = rule.formula.kind !== "fixed" || rule.formula.currency === coverage.currency;
  const capCurrencyOk = !rule.cap || rule.cap.currency === coverage.currency;
  if (match?.result === "matches" && (!formulaCurrencyOk || !capCurrencyOk)) {
    return { ...base, status: "needs_document", amountText: null, reason: "The matching wording quotes an amount in a different currency than this person's verified sum insured, so DearPolicy cannot compute a figure from it.", conditions: ["Confirm the currency of the quoted benefit against the personal certificate."] };
  }
  const calc = calculateDisabilityBenefit({
    benefitKind: "tpd", ownership: ownershipRef(coverage), familyMember: { id: coverage.familyMemberId, confirmed: true },
    claimEventId: sessionId, benefitCode: "tpd-lump-sum", scheduleRowCode: null,
    disabilityDate: facts.eventDate ?? null, policyEffectiveDate: coverage.effectiveDate,
    sumInsured: coverage.amount, currency: coverage.currency,
    formula: rule.formula.kind === "sum_insured_fraction" ? { kind: "sum_insured_fraction", fraction: rule.formula.fraction, evidence: toRef(rule.citation) }
      : rule.formula.kind === "fixed" ? { kind: "fixed", amount: rule.formula.amount, evidence: toRef(rule.citation) } : null,
    ...(rule.cap ? { cap: { amount: rule.cap.amount, evidence: toRef(rule.citation) } } : {}),
    ruleEvidence: toRef(rule.citation), ownershipEvidence: ownershipEvidenceRef(coverage), definitionEvidence: toRef(rule.citation),
    definitionMatch: match,
  });
  if (calc.status === "blocked") {
    const isMatchGap = calc.reasonCode.startsWith("DEFINITION_MATCH_");
    const reason = isMatchGap
      ? (facts.disabilityAssessmentEvidenceReviewed === true
          ? "A Total & Permanent Disability benefit may apply. DearPolicy has reviewed a medical assessment, but it does not yet match this policy's own TPD definition, so no amount is included."
          : facts.disabilityAssessmentDocumentAvailable === true
            ? "A Total & Permanent Disability benefit may apply, but DearPolicy has not included an amount because the medical assessment has not yet been reviewed against this policy's own TPD definition. DearPolicy never decides permanence on its own."
            : "A Total & Permanent Disability benefit may apply, but DearPolicy has not included an amount because a medical assessment establishing permanence still needs to be reviewed against this policy's own TPD definition.")
      : `The personal certificate confirms ownership of this cover. DearPolicy has not included an amount: ${calc.message}`;
    return { ...base, status: "needs_document", amountText: null, reason, conditions: isMatchGap ? ["A medical assessment must be reviewed and matched against the policy's own Total & Permanent Disability definition."] : [calc.message] };
  }
  if (calc.status === "not_applicable") {
    return { ...base, status: "not_applicable", amountText: null, reason: calc.reason, conditions: [] };
  }
  return {
    ...base, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
    calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
    reason: `The reviewed medical assessment matches this policy's own TPD definition. The matching clause pays ${calc.formulaBasis}.`,
    conditions: ["The disability must satisfy every remaining policy condition and exclusion, and the insurer's own assessment still applies."],
  };
}

/** Permanent-partial-disability/dismemberment items, paid from ONE exact
 * schedule-of-injuries row. A policy's schedule can list dozens of named
 * injuries -- showing one assessment item per unreviewed row would
 * overwhelm the family with items that have no evidence behind them at
 * all. So this function shows a full item, with a real (or blocked/
 * not-applicable) amount, ONLY for a row that already has a reviewed
 * DisabilityDefinitionMatch; when none of the schedule's rows has been
 * reviewed yet, it shows exactly ONE combined review item instead of one
 * per row -- exactly the same shape as lib/claims/rules.ts's
 * "medical-reimbursement-review" fallback for an as-yet-unconverted
 * reimbursement plan. */
function assessScheduleBenefits(scheduleRules: DisabilityRuleEvidence[], coverage: OwnedCoverage, facts: ClaimFacts, sessionId: string | null): ClaimAssessmentItem[] {
  if (scheduleRules.length === 0) return [];
  const items: ClaimAssessmentItem[] = [];
  let anyReviewed = false;
  for (const rule of scheduleRules) {
    const match = applicableDisabilityMatch(facts, coverage, sessionId, "ppd-schedule", rule.matchKey, currentDefinition(rule.citation, rule.quote));
    if (!match) continue;
    anyReviewed = true;
    const calc = calculateDisabilityBenefit({
      benefitKind: "schedule", ownership: ownershipRef(coverage), familyMember: { id: coverage.familyMemberId, confirmed: true },
      claimEventId: sessionId, benefitCode: "ppd-schedule", scheduleRowCode: rule.matchKey,
      disabilityDate: facts.eventDate ?? null, policyEffectiveDate: coverage.effectiveDate,
      sumInsured: coverage.amount, currency: coverage.currency,
      formula: rule.formula.kind === "schedule_percentage" ? { kind: "schedule_percentage", scheduleRowCode: rule.formula.scheduleRowCode, fraction: rule.formula.fraction, evidence: toRef(rule.citation) } : null,
      ruleEvidence: toRef(rule.citation), ownershipEvidence: ownershipEvidenceRef(coverage), definitionEvidence: toRef(rule.citation),
      definitionMatch: match,
    });
    const base = {
      id: `ppd-schedule-${rule.matchKey}`, title: `Schedule of Injuries: ${rule.label}`, productName: coverage.productName,
      coverageId: coverage.id, evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined,
      supersededBy: "This benefit is not paid alongside Total & Permanent Disability for the same disability; see lib/claims/composition/engine.ts.",
    };
    if (calc.status === "blocked") {
      items.push({ ...base, status: "needs_document", amountText: null, reason: `A schedule-of-injuries amount for "${rule.label}" may apply. DearPolicy has not included an amount: ${calc.message}`, conditions: [calc.message] });
    } else if (calc.status === "not_applicable") {
      items.push({ ...base, status: "not_applicable", amountText: null, reason: calc.reason, conditions: [] });
    } else {
      items.push({
        ...base, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
        calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
        reason: `The reviewed medical assessment matches this exact schedule row. The clause pays ${calc.formulaBasis}.`,
        conditions: ["The injury must satisfy every remaining policy condition and exclusion, and the insurer's own assessment still applies."],
      });
    }
  }
  if (!anyReviewed) {
    items.push({
      id: "ppd-schedule-review", title: "Schedule of Injuries (permanent partial disability / dismemberment)",
      productName: coverage.productName, coverageId: coverage.id, evidenceTerms: scheduleRules.map((r) => r.quote),
      ruleEvidence: scheduleRules[0].citation, coverLabel: coverage.productName ?? undefined,
      status: "needs_document", amountText: null,
      reason: `The uploaded wording lists ${scheduleRules.length} named schedule-of-injuries row${scheduleRules.length === 1 ? "" : "s"} (e.g. "${scheduleRules[0].label}"). DearPolicy has not included an amount because no reviewed medical assessment has been matched against the exact row this injury falls under -- it never guesses which row an injury description fits.`,
      conditions: ["A medical assessment must be reviewed and matched to the exact schedule row that applies to this injury."],
    });
  }
  return items;
}

function assessDisabilityIncomeBenefit(rule: DisabilityRuleEvidence, coverage: OwnedCoverage, facts: ClaimFacts, sessionId: string | null): ClaimAssessmentItem {
  const base = {
    id: "di-monthly", title: "Disability Income", productName: coverage.productName, coverageId: coverage.id,
    evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined,
  };
  const match = applicableDisabilityMatch(facts, coverage, sessionId, "di-monthly", DISABILITY_INCOME_MATCH_KEY, currentDefinition(rule.citation, rule.quote));
  if (rule.formula.kind !== "fixed") {
    return { ...base, status: "needs_document", amountText: null, reason: "This plan's disability-income formula is not a flat monthly amount, so DearPolicy has not converted it into a deterministic calculator yet.", conditions: ["DearPolicy should check the plan's percentage-of-income formula before estimating this benefit."] };
  }
  // V1 limitation, documented in the PR: DearPolicy has no reviewed-record
  // UI yet for months-already-paid / completed-months-of-disability, so
  // this benefit always stops at needs_document once a definition match
  // exists, rather than guessing either figure from chat. See this
  // module's own doc comment.
  const calc = calculateDisabilityIncome({
    monthlyBenefitAmount: rule.formula.amount, currency: rule.formula.currency,
    ownership: ownershipRef(coverage), familyMember: { id: coverage.familyMemberId, confirmed: true }, claimEventId: sessionId,
    benefitCode: "di-monthly", deferredPeriodMonths: rule.deferredPeriodMonths ?? null, maximumBenefitMonths: rule.maximumBenefitMonths ?? null,
    monthsAlreadyPaid: null, completedMonthsClaimed: null,
    ownershipEvidence: ownershipEvidenceRef(coverage), ruleEvidence: toRef(rule.citation), definitionEvidence: toRef(rule.citation),
    definitionMatch: match,
  });
  if (calc.status === "blocked") {
    const isMatchGap = calc.reasonCode.startsWith("DEFINITION_MATCH_");
    const isMonthsGap = calc.reasonCode === "INVALID_MONTHS_ALREADY_PAID" || calc.reasonCode === "INVALID_COMPLETED_MONTHS";
    const reason = isMatchGap
      ? "A Disability Income benefit may apply, but DearPolicy has not included an amount because no reviewed medical assessment has been matched against this policy's own disability-income definition yet."
      : isMonthsGap
        ? "A Disability Income benefit may apply. DearPolicy has confirmed this policy's definition is met, but it still needs the confirmed number of already-elapsed disability months (and any months already paid) verified before it can show an amount -- DearPolicy never estimates this from a chat answer."
        : `A Disability Income benefit may apply. DearPolicy has not included an amount: ${calc.message}`;
    return { ...base, status: "needs_document", amountText: null, reason, conditions: [calc.message] };
  }
  return { ...base, status: "needs_document", amountText: null, reason: "A Disability Income benefit applies to this cover; a monthly amount will show once the confirmed elapsed-months figures are recorded.", conditions: [] };
}

/** Non-monetary. Premium waiver rides on the very same TPD
 * DisabilityDefinitionMatch (a policy that waives premiums on TPD almost
 * always defines "permanent disability" the same way for both purposes) --
 * see this module's own doc comment for the V1 scope this represents. */
function assessPremiumWaiver(tpdRule: DisabilityRuleEvidence | null, coverage: OwnedCoverage, facts: ClaimFacts, sessionId: string | null): ClaimAssessmentItem | null {
  if (!tpdRule) return null;
  const match = applicableDisabilityMatch(facts, coverage, sessionId, "tpd-lump-sum", TOTAL_PERMANENT_DISABILITY_MATCH_KEY, currentDefinition(tpdRule.citation, tpdRule.quote));
  const base = { id: "premium-waiver", title: "Premium Waiver", productName: coverage.productName, coverageId: coverage.id, evidenceTerms: [], ruleEvidence: tpdRule.citation, coverLabel: coverage.productName ?? undefined };
  if (match?.result === "matches") {
    return { ...base, status: "likely_applicable", amountText: null, reason: "The reviewed medical assessment matches this policy's own Total & Permanent Disability definition, so future premiums for this cover may be waived.", conditions: ["The insurer's own premium-waiver administration still applies -- DearPolicy does not recalculate or apply this to your policy record."] };
  }
  if (match?.result === "does_not_match") return null;
  return { ...base, status: "needs_document", amountText: null, reason: "If Total & Permanent Disability is confirmed for this cover, future premiums may be waived. DearPolicy will show this once the TPD medical assessment has been reviewed and matched.", conditions: ["A medical assessment must be reviewed and matched against the policy's own TPD definition first."] };
}

export function assessDisabilityClaim(facts: ClaimFacts, coverages: OwnedCoverage[], disabilityRules: DisabilityRuleSet = EMPTY_DISABILITY_RULES, sessionId: string | null = null): ClaimAssessmentItem[] {
  const items: ClaimAssessmentItem[] = [];
  const byCoverage = new Map<string, DisabilityRuleEvidence[]>();
  for (const rule of disabilityRules.rules) byCoverage.set(rule.coverageId, [...(byCoverage.get(rule.coverageId) ?? []), rule]);

  for (const coverage of coverages) {
    const rules = byCoverage.get(coverage.id);
    if (!rules?.length) continue;
    const tpdRule = rules.find((r) => r.benefitCode === "tpd-lump-sum") ?? null;
    if (tpdRule) items.push(assessTPDBenefit(tpdRule, coverage, facts, sessionId));
    const scheduleRules = rules.filter((r) => r.benefitCode === "ppd-schedule");
    items.push(...assessScheduleBenefits(scheduleRules, coverage, facts, sessionId));
    const incomeRule = rules.find((r) => r.benefitCode === "di-monthly") ?? null;
    if (incomeRule) items.push(assessDisabilityIncomeBenefit(incomeRule, coverage, facts, sessionId));
    const waiver = assessPremiumWaiver(tpdRule, coverage, facts, sessionId);
    if (waiver) items.push(waiver);
  }
  return items;
}

export function nextDisabilityQuestion(facts: ClaimFacts, disabilityRules: DisabilityRuleSet = EMPTY_DISABILITY_RULES): ClaimQuestion | null {
  if (disabilityRules.rules.length === 0) return null;
  if (facts.disabilityAssessmentDocumentAvailable == null && !facts.uncertainFacts.includes("disability_assessment_document")) {
    return { id: "disability_assessment_document", text: "Do you have a medical specialist's report or assessment establishing whether this disability is permanent? You can say “not sure” if you have not checked yet.", type: "yes_no", options: ["Yes", "No", "Not sure"], why: "A Total & Permanent Disability or schedule-of-injuries benefit needs this assessment checked against the policy's own definition before DearPolicy can show an amount. A reported circumstance alone is not enough." };
  }
  if (facts.disabilityAssessmentDocumentAvailable === true && facts.disabilityAssessmentEvidenceReviewed !== true && !facts.uncertainFacts.includes("disability_assessment_document_upload")) {
    return { id: "disability_assessment_document_upload", text: "Please upload the medical specialist's report or assessment. DearPolicy will check it against the policy's own disability definitions before showing an amount.", type: "text", why: "Saying the assessment exists is not the same as DearPolicy having read it. Only the reviewed document, matched against the policy's own definition, can confirm a disability benefit." };
  }
  return null;
}
