/**
 * Assembles a travel policy's Overseas Medical Expenses and Accidental
 * Death benefits -- the travel analogue of lib/claims/medical-rules.ts and
 * the accidental-death half of lib/claims/rules.ts.
 *
 * Like those modules, this one is deliberately synchronous: the caller
 * (lib/claims/orchestrator.ts) loads the async evidence
 * (lib/claims/travel-evidence.ts's loadTravelEvidence()) once per turn and
 * passes the result in, so the assessment logic itself stays trivially
 * testable with plain objects (see scripts/claim-travel-regressions.ts).
 *
 * Nothing here computes an amount itself -- every potential amount comes
 * from the EXISTING, already-proven lib/claims/calculators/medical-
 * reimbursement.ts and lib/claims/calculators/accidental-death.ts, reused
 * completely unchanged (see lib/claims/travel-evidence.ts's own doc
 * comment for why no new calculator was needed for travel).
 *
 * SAFETY BOUNDARY -- the trip-date gate. DearPolicy must never assume a
 * health or death event occurred during a covered trip without a
 * CONFIRMED trip-date fact (`ClaimFacts.tripDepartureDate`/
 * `tripReturnDate`, both chat-reported -- see lib/claims/facts.ts). Both
 * benefits below independently check this before doing anything else:
 * missing trip dates always produce `needs_document` (never an amount, and
 * never silently skipped), and an event date confirmed to fall OUTSIDE the
 * trip window always produces `not_applicable`. This is the travel
 * equivalent of disability-rules.ts's "never decide permanence" boundary
 * and rules.ts's "never decide the accidental-death cause" boundary.
 *
 * V1 scope, documented here and in the PR, not hidden: travel benefits are
 * only assessed for a "hospitalisation" event (Overseas Medical Expenses)
 * or a "death" event (Accidental Death) -- see
 * lib/claims/orchestrator.ts's own comments on where travelEvidence is
 * loaded. An "accident" or "diagnosis" event with travel cover on file
 * does not yet surface a travel benefit; this is a real V1 gap, not a
 * silent one. Baggage, travel-delay and trip-cancellation benefits are out
 * of scope entirely -- lib/claims/travel-evidence.ts cannot even read
 * their wording, let alone calculate an amount for them.
 */
import { formatMoney } from "@/lib/format/currency";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimEvidence, ClaimFacts, ClaimQuestion } from "./types";
import type { TravelDeathRule, TravelEvidenceGap, TravelMedicalRule, TravelRuleEvidence } from "./travel-evidence";
import { calculateMedicalReimbursement, type BilledExpenseItem, type MedicalReimbursementEvidenceRef } from "./calculators/medical-reimbursement";
import { calculateAccidentalDeath, type DeathBenefitEvidenceRef } from "./calculators/accidental-death";
import type { CauseDefinitionMatch } from "./calculators/evidence";
import { selectApplicableDecision } from "./evidence/decision-selection";
import { evaluateAggregateEvidenceAuthority } from "./evidence-authority";

export type TravelRuleSet = { rules: TravelRuleEvidence[]; gaps: TravelEvidenceGap[] };
const EMPTY_TRAVEL_RULES: TravelRuleSet = { rules: [], gaps: [] };

function amountText(amount: number | null, currency = "SGD") { return amount == null ? null : formatMoney(amount, currency); }
function toRef(c: ClaimEvidence): MedicalReimbursementEvidenceRef & DeathBenefitEvidenceRef {
  return { chunkId: c.chunkId, policyId: c.policyId, pageStart: c.pageStart, pageEnd: c.pageEnd, label: c.evidenceLabel };
}
function ownershipRef(coverage: OwnedCoverage) {
  return { contractId: coverage.policyId, coverageId: coverage.id, label: coverage.productName ?? undefined };
}
function ownershipEvidenceRef(coverage: OwnedCoverage) {
  return { chunkId: `coverage:${coverage.id}`, policyId: coverage.policyId, coverageId: coverage.id, familyMemberId: coverage.familyMemberId, label: coverage.productName ?? undefined };
}

/** The one applicable, already-reviewed match between the official
 * cause-of-death evidence and THIS SPECIFIC travel cover's own
 * accidental-death definition. Mirrors lib/claims/rules.ts's own
 * (unexported) applicableCauseDefinitionMatch() exactly -- see that
 * function's doc comment; it is not repeated here. Reuses the SAME
 * `ClaimFacts.causeDefinitionMatches` list and the SAME underlying
 * `claim_cause_definition_matches` table as a Group Personal Accident
 * accidental-death benefit, since `CauseDefinitionMatch` is scoped by
 * contractId/coverageId, never by product. */
function applicableCauseDefinitionMatch(facts: ClaimFacts, coverage: OwnedCoverage, sessionId: string | null, currentDefinition: unknown): CauseDefinitionMatch | null {
  if (sessionId == null) return null;
  return selectApplicableDecision(facts.causeDefinitionMatches.filter(m =>
    m.contractId === coverage.policyId &&
    m.familyMemberId === coverage.familyMemberId &&
    m.claimEventId === sessionId &&
    (m.coverageId == null || m.coverageId === coverage.id),
  ), currentDefinition);
}

/** null = cannot yet tell (a date is missing/unparseable); true/false =
 * definitively within/outside the confirmed trip window. Both endpoints
 * are inclusive -- a treatment or death on the departure or return date
 * itself is still within the trip. */
function withinTrip(facts: ClaimFacts, eventDateIso: string | null): boolean | null {
  if (!facts.tripDepartureDate || !facts.tripReturnDate || !eventDateIso) return null;
  const event = Date.parse(eventDateIso), start = Date.parse(facts.tripDepartureDate), end = Date.parse(facts.tripReturnDate);
  if (!Number.isFinite(event) || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return event >= start && event <= end;
}

function assessTravelMedicalBenefit(rule: TravelMedicalRule, coverage: OwnedCoverage, facts: ClaimFacts): ClaimAssessmentItem {
  const base = {
    id: "travel-medical-expenses", title: "Overseas Medical Expenses", productName: coverage.productName, coverageId: coverage.id,
    evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined, aggregation: "reimbursement" as const,
  };

  if (!facts.tripDepartureDate || !facts.tripReturnDate) {
    return { ...base, status: "needs_document", amountText: null, reason: "Overseas Medical Expenses may apply, but DearPolicy has not verified this trip's departure and return dates, so it cannot confirm the treatment happened during a covered trip.", conditions: ["Confirm the trip's departure and return dates."] };
  }
  const verified = facts.verifiedMedicalBillFacts;
  const eventDateIso = verified?.admissionISO ?? facts.admissionDate ?? facts.eventDate ?? null;
  const within = withinTrip(facts, eventDateIso);
  if (within === false) {
    return { ...base, status: "not_applicable", amountText: null, reason: "The reported/verified date of treatment falls outside the confirmed trip dates, so this Overseas Medical Expenses benefit does not apply.", conditions: [] };
  }
  if (within === null) {
    return { ...base, status: "needs_document", amountText: null, reason: "Overseas Medical Expenses may apply, but DearPolicy has not verified the date of treatment against the confirmed trip dates.", conditions: ["Confirm the date of treatment (or admission date), so DearPolicy can check it falls within the covered trip."] };
  }
  if (!verified || verified.lineItems.length === 0) {
    return { ...base, status: "needs_document", amountText: null, reason: "Overseas Medical Expenses may apply, but DearPolicy has not yet reviewed an itemised bill for this claim.", conditions: ["Upload the itemised medical bill so DearPolicy can check it against this benefit's evidenced eligible expense categories."] };
  }
  // Checkpoint (Wave 2, D4/D8/D9): identical gate to lib/claims/medical-rules.ts's
  // assessReimbursementBenefit() -- Overseas Medical Expenses always rests
  // on verified, AI-extracted bill evidence, so this applies unconditionally
  // once `verified` has usable line items. See lib/claims/evidence-authority.ts.
  const travelReimbursementAuthority = evaluateAggregateEvidenceAuthority(verified.provenance);
  if (!travelReimbursementAuthority.authorized) {
    return { ...base, status: "needs_document", amountText: null, reason: `Overseas Medical Expenses may apply. DearPolicy has not included an amount: ${travelReimbursementAuthority.message}`, conditions: [travelReimbursementAuthority.message] };
  }
  const claimCurrency = /^[A-Z]{3}$/.test(coverage.currency ?? "") ? (coverage.currency as string) : (verified.lineItems[0]?.currency ?? null);
  if (!claimCurrency) {
    return { ...base, status: "needs_document", amountText: null, reason: "Overseas Medical Expenses may apply, but this cover has no verified currency to calculate in.", conditions: ["Confirm the currency of this cover against the policy schedule."] };
  }
  const eligibleSet = new Set(rule.eligibleCategories);
  const mismatchedCurrency = verified.lineItems.filter((li) => eligibleSet.has(li.category) && li.currency !== claimCurrency);
  if (mismatchedCurrency.length > 0) {
    return { ...base, status: "needs_document", amountText: null, reason: `Some reviewed itemised bill lines are in a different currency than this cover's verified currency (${claimCurrency}). DearPolicy does not convert currency automatically.`, conditions: ["Confirm the correct currency for each bill line, or provide a bill in this cover's verified currency."] };
  }
  let overallCap: { amountMinor: number; evidence: MedicalReimbursementEvidenceRef } | null = null;
  if (rule.overallCap) {
    if (rule.overallCap.currency !== claimCurrency) {
      return { ...base, status: "needs_document", amountText: null, reason: "The clause's own overall cap is quoted in a different currency than this cover's verified currency, so DearPolicy cannot compute a figure from it.", conditions: ["Confirm the currency of the quoted benefit against the policy wording."] };
    }
    overallCap = { amountMinor: Math.round(rule.overallCap.amount * 100), evidence: toRef(rule.citation) };
  }

  const billedItems: BilledExpenseItem[] = verified.lineItems.map((li) => ({ category: li.category, description: li.description ?? li.category, amountMinor: li.amountMinor }));
  const thirdPartyPaid = verified.thirdPartyPayments.filter((p) => p.currency === claimCurrency);
  const thirdPartyCoordination = thirdPartyPaid.length > 0 ? { required: true, evidence: toRef(rule.citation) } : null;

  const calc = calculateMedicalReimbursement({
    currency: claimCurrency, eligibleCategories: rule.eligibleCategories, billedItems, categoryLimits: [], wardProration: null,
    // Travel policies have no panel/network concept for an overseas
    // provider -- always "panel" with no reduction factor, which
    // trivially satisfies calculateMedicalReimbursement()'s panel-status
    // gate without applying any restriction. See this module's own doc
    // comment on why no travel-specific calculator input was needed here.
    panelRestriction: { panelStatus: "panel", nonPanelFactor: null, evidence: toRef(rule.citation) },
    deductionSteps: [], deductionOrderEvidenced: true, perAdmissionCap: overallCap, thirdPartyCoordination,
    thirdPartyPayments: thirdPartyCoordination ? thirdPartyPaid.map((p) => ({ source: p.source, amountMinor: p.amountMinor })) : null,
    remainingLimits: [], ownership: ownershipRef(coverage), ruleEvidence: toRef(rule.citation), ownershipEvidence: ownershipEvidenceRef(coverage),
  });

  if (calc.status === "blocked") {
    return { ...base, status: "needs_document", amountText: null, reason: `Overseas Medical Expenses may apply. DearPolicy has not included an amount: ${calc.message}`, conditions: [calc.message] };
  }
  if (calc.status === "not_applicable") {
    return { ...base, status: "not_applicable", amountText: null, reason: `Overseas Medical Expenses: ${calc.formula}`, conditions: [] };
  }
  return {
    ...base, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
    calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
    reason: `Overseas Medical Expenses: eligible reviewed expense ${amountText(calc.eligibleBilledExpense, claimCurrency)}, after this benefit's evidenced categories and cap, ${amountText(calc.potentialAmount, calc.currency)} is potentially payable.`,
    conditions: ["The treatment must satisfy this benefit's own conditions and exclusions, and must have occurred during the covered trip."],
  };
}

function assessTravelDeathBenefit(rule: TravelDeathRule, coverage: OwnedCoverage, facts: ClaimFacts, sessionId: string | null): ClaimAssessmentItem {
  const base = {
    id: "travel-accidental-death", title: "Travel Accidental Death Benefit", productName: coverage.productName, coverageId: coverage.id,
    evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined,
  };
  const deathDate = facts.deathDate ?? facts.eventDate;
  if (!facts.tripDepartureDate || !facts.tripReturnDate) {
    return { ...base, status: "needs_document", amountText: null, reason: "A travel accidental death benefit may apply, but DearPolicy has not verified this trip's departure and return dates, so it cannot confirm the death occurred during a covered trip.", conditions: ["Confirm the trip's departure and return dates."] };
  }
  const within = withinTrip(facts, deathDate);
  if (within === false) {
    return { ...base, status: "not_applicable", amountText: null, reason: "The reported date of death falls outside the confirmed trip dates, so this travel accidental death benefit does not apply.", conditions: [] };
  }
  if (within === null) {
    return { ...base, status: "needs_document", amountText: null, reason: "A travel accidental death benefit may apply, but DearPolicy has not verified the date of death against the confirmed trip dates.", conditions: ["Confirm the date of death, so DearPolicy can check it falls within the covered trip."] };
  }

  const evidenceRef = toRef(rule.citation);
  const calc = calculateAccidentalDeath({
    ownership: ownershipRef(coverage), familyMember: { id: coverage.familyMemberId, confirmed: true }, claimEventId: sessionId,
    deathConfirmed: facts.death === true, dateOfDeath: deathDate, policyEffectiveDate: coverage.effectiveDate,
    sumInsured: null, currency: rule.currency, formula: { kind: "fixed", amount: rule.amount, evidence: evidenceRef },
    ruleEvidence: evidenceRef, ownershipEvidence: ownershipEvidenceRef(coverage), accidentalDeathDefinitionEvidence: evidenceRef,
    causeDefinitionMatch: applicableCauseDefinitionMatch(facts, coverage, sessionId, evidenceRef),
  });

  if (calc.status === "blocked") {
    const isCauseGap = calc.reasonCode === "MALFORMED_POLICY_DEFINITION_EVIDENCE" || calc.reasonCode === "MALFORMED_CAUSE_EVIDENCE"
      || (typeof calc.reasonCode === "string" && calc.reasonCode.startsWith("CAUSE_MATCH_"));
    const causeGapReason = facts.causeOfDeathEvidenceReviewed === true
      ? "A travel accidental death benefit may apply. DearPolicy has reviewed the cause-of-death document, but it does not yet match this policy's own accidental-death definition, so no amount is included."
      : facts.causeOfDeathDocumentAvailable === true
        ? "A travel accidental death benefit may apply, but DearPolicy has not included an amount because the cause-of-death document has not yet been reviewed against this policy's own accidental-death definition."
        : "A travel accidental death benefit may apply, but DearPolicy has not included an amount because the policy's accident definition still needs to be checked against an official cause-of-death document, police report or coroner's report.";
    return { ...base, status: "needs_document", amountText: null, reason: isCauseGap ? causeGapReason : `DearPolicy has not included an amount: ${calc.message}`, conditions: isCauseGap ? ["Check the death certificate, police report or coroner's report against the policy's accidental-death definition."] : [calc.message] };
  }
  if (calc.status === "not_applicable") {
    return { ...base, status: "not_applicable", amountText: null, reason: calc.reason, conditions: [] };
  }
  return {
    ...base, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
    calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
    reason: `The matching accidental-death clause pays ${calc.formulaBasis}.`,
    conditions: ["The cover must have been in force on the date of death, and the policy's conditions and exclusions must be met.", "The death certificate and accident/medical report must establish death directly caused by the accident, during the covered trip; accident exclusions and any time limits still need checking."],
  };
}

export function assessTravelClaim(facts: ClaimFacts, coverages: OwnedCoverage[], travelRules: TravelRuleSet = EMPTY_TRAVEL_RULES, sessionId: string | null = null): ClaimAssessmentItem[] {
  const items: ClaimAssessmentItem[] = [];
  const byCoverage = new Map<string, TravelRuleEvidence[]>();
  for (const rule of travelRules.rules) byCoverage.set(rule.coverageId, [...(byCoverage.get(rule.coverageId) ?? []), rule]);

  for (const coverage of coverages) {
    if (coverage.category !== "Travel") continue;
    const rules = byCoverage.get(coverage.id);
    if (!rules?.length) continue;
    const medicalRule = rules.find((r): r is TravelMedicalRule => r.benefitCode === "travel-medical-expenses") ?? null;
    if (medicalRule) items.push(assessTravelMedicalBenefit(medicalRule, coverage, facts));
    const deathRule = rules.find((r): r is TravelDeathRule => r.benefitCode === "travel-accidental-death") ?? null;
    if (deathRule) items.push(assessTravelDeathBenefit(deathRule, coverage, facts, sessionId));
  }
  return items;
}

export function nextTravelQuestion(facts: ClaimFacts, travelRules: TravelRuleSet = EMPTY_TRAVEL_RULES): ClaimQuestion | null {
  if (travelRules.rules.length === 0) return null;
  if (!facts.tripDepartureDate && !facts.uncertainFacts.includes("trip_departure_date")) {
    return { id: "trip_departure_date", text: "What date did this trip start?", type: "date", why: "Your travel benefits only respond to events that happened during a covered trip." };
  }
  if (!facts.tripReturnDate && !facts.uncertainFacts.includes("trip_return_date")) {
    return { id: "trip_return_date", text: "What date was this trip due to end (or when did it actually end)?", type: "date", why: "Your travel benefits only respond to events that happened during a covered trip." };
  }
  return null;
}
