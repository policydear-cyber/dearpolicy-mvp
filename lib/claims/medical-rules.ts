/**
 * Assembles the medical-claim (hospital cash, ICU cash, surgical,
 * inpatient, pre-/post-hospitalisation reimbursement) benefits for a
 * "hospitalisation" claim event -- the medical-claims analogue of
 * lib/claims/ci-rules.ts. Every branch below is additive alongside the
 * existing hardcoded "gtl-hospital-cash" item in lib/claims/rules.ts (see
 * that module's own doc comment); this never replaces it.
 *
 * Like ci-rules.ts, this module is deliberately synchronous: the caller
 * (lib/claims/orchestrator.ts) loads the async evidence
 * (lib/claims/medical-evidence.ts's loadMedicalEvidence(),
 * lib/claims/evidence/medical-bill-evidence.ts's loadVerifiedMedicalBillFacts())
 * once per turn and passes the results in, so the actual assessment logic
 * stays trivially testable with plain objects (see
 * scripts/claim-medical-regressions.ts).
 *
 * Safety boundary (see this PR's own module doc comments throughout
 * lib/claims/calculators/hospital-cash.ts and
 * lib/claims/calculators/medical-reimbursement.ts): nothing here ever
 * computes an amount itself -- every potential amount comes from one of
 * those two pure calculators, which fail closed on any missing or
 * unverifiable input. This module's only job is to translate evidenced
 * wording + verified bill facts into the calculators' own strict input
 * shapes, and to turn their typed results into ClaimAssessmentItems.
 */
import { formatMoney } from "@/lib/format/currency";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimEvidence, ClaimFacts, ClaimQuestion } from "./types";
import type { MedicalCashRule, MedicalEvidenceGap, MedicalPlanProvisions, MedicalReimbursementRule } from "./medical-evidence";
import { computeHospitalDays, type DayCountInput } from "./day-count";
import { calculateHospitalCash, type HospitalCashEvidenceRef } from "./calculators/hospital-cash";
import { calculateMedicalReimbursement, type BilledExpenseItem, type CategoryLimit, type DeductionStep, type MedicalReimbursementEvidenceRef } from "./calculators/medical-reimbursement";
import type { VerifiedMedicalBillFacts } from "./calculators/evidence";
import { evaluateAggregateEvidenceAuthority } from "./evidence-authority";

export type MedicalRuleEvidence = {
  cashRules: MedicalCashRule[];
  reimbursementRules: MedicalReimbursementRule[];
  planProvisions: MedicalPlanProvisions[];
  gaps: MedicalEvidenceGap[];
};

const EMPTY_MEDICAL_RULE_EVIDENCE: MedicalRuleEvidence = { cashRules: [], reimbursementRules: [], planProvisions: [], gaps: [] };

function amountText(amount: number | null, currency = "SGD") { return amount == null ? null : formatMoney(amount, currency); }

function toRef(c: ClaimEvidence): HospitalCashEvidenceRef & MedicalReimbursementEvidenceRef {
  return { chunkId: c.chunkId, policyId: c.policyId, pageStart: c.pageStart, pageEnd: c.pageEnd, label: c.evidenceLabel };
}

const BENEFIT_TITLES: Record<string, string> = {
  "med-hospital-cash": "Daily Hospital Cash",
  "med-icu-cash": "Daily ICU Cash",
  "med-surgical": "Surgical Benefit",
  "med-inpatient": "Inpatient Medical Benefit",
  "med-pre-hospitalisation": "Pre-Hospitalisation Treatment Benefit",
  "med-post-hospitalisation": "Post-Hospitalisation Treatment Benefit",
};
function benefitTitle(code: string) { return BENEFIT_TITLES[code] ?? code; }

/** VERIFIED (reviewer-confirmed) admission/discharge timestamps always win
 * over a chat-REPORTED date -- see lib/claims/evidence/medical-bill-evidence.ts's
 * own doc comment on VerifiedMedicalBillFacts. A plain "YYYY-MM-DD" reported
 * date is passed straight through, never guessed a timezone offset for --
 * lib/claims/day-count.ts's own MISSING_TIMEZONE_OFFSET gate is what
 * decides whether that is usable, exactly as that module is designed to. */
function resolveAdmissionDischarge(facts: ClaimFacts, verified: VerifiedMedicalBillFacts | null) {
  return {
    admissionISO: verified?.admissionISO ?? facts.admissionDate ?? null,
    dischargeISO: verified?.dischargeISO ?? facts.dischargeDate ?? null,
    verifiedSource: verified?.admissionISO != null && verified?.dischargeISO != null,
  };
}

function resolvePanelStatus(facts: ClaimFacts): "panel" | "non_panel" | null {
  return facts.panelStatusReported === "panel" || facts.panelStatusReported === "non_panel" ? facts.panelStatusReported : null;
}

function ownershipRef(coverage: OwnedCoverage) {
  return { contractId: coverage.policyId, coverageId: coverage.id, label: coverage.productName ?? undefined };
}
function ownershipEvidenceRef(coverage: OwnedCoverage) {
  return { chunkId: `coverage:${coverage.id}`, policyId: coverage.policyId, label: coverage.productName ?? undefined };
}

function assessCashBenefit(
  rule: MedicalCashRule, coverage: OwnedCoverage, provisions: MedicalPlanProvisions | null,
  facts: ClaimFacts, verified: VerifiedMedicalBillFacts | null,
): ClaimAssessmentItem {
  const base = {
    id: rule.benefitCode, title: benefitTitle(rule.benefitCode), productName: coverage.productName, coverageId: coverage.id,
    evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined,
  };
  if (!provisions || !provisions.dayCountRule || !provisions.edgeInclusion) {
    return {
      ...base, status: "needs_document", amountText: null,
      reason: `${benefitTitle(rule.benefitCode)} may apply, but DearPolicy has not verified this plan's day-count rule (calendar day vs. completed 24-hour period, and whether the admission/discharge day itself is counted).`,
      conditions: ["Upload the policy wording that states how hospital days are counted, or the discharge summary showing the admission and discharge times."],
    };
  }
  const { admissionISO, dischargeISO, verifiedSource } = resolveAdmissionDischarge(facts, verified);
  // Checkpoint (Wave 2, D4/D8/D9): only the VERIFIED branch is gated here
  // -- a chat-reported (unverified, already lower-confidence
  // "potentially_applicable") day count involves no AI-derived evidence at
  // all, so there is no provenance to check. Once verified matched-document
  // data is what this calculation actually rests on, its provenance must
  // authorize it synchronously, right here, before any day-count or
  // calculator arithmetic runs -- see lib/claims/evidence-authority.ts.
  if (verifiedSource) {
    const authority = evaluateAggregateEvidenceAuthority(verified?.provenance);
    if (!authority.authorized) {
      return {
        ...base, status: "needs_document", amountText: null,
        reason: `${benefitTitle(rule.benefitCode)} may apply. DearPolicy has not included an amount: ${authority.message}`,
        conditions: [authority.message],
      };
    }
  }
  const dayCountInput: DayCountInput = {
    admissionISO, dischargeISO, rule: provisions.dayCountRule, edgeInclusion: provisions.edgeInclusion,
    icuPeriods: [], icuMode: null, waitingDays: provisions.waitingDays,
  };
  const dayResult = computeHospitalDays(dayCountInput);
  if (dayResult.status === "blocked") {
    return {
      ...base, status: "needs_document", amountText: null,
      reason: `${benefitTitle(rule.benefitCode)} may apply. DearPolicy has not included an amount: ${dayResult.message}`,
      conditions: [dayResult.message],
    };
  }
  // ICU-day evidence (which exact minutes/hours of a longer admission were
  // spent in ICU) is not yet extracted in this V1 slice -- see this
  // module's own doc comment in the PR description. icuNights is
  // therefore always 0 today, so med-icu-cash never overpays (it simply
  // cannot yet show a positive amount); it is never silently guessed at
  // from the admission type alone.
  const nights = rule.benefitCode === "med-icu-cash" ? dayResult.icuNights : dayResult.wardNights;
  if (rule.benefitCode === "med-icu-cash" && nights === 0 && dayResult.grossNights > 0) {
    return {
      ...base, status: "needs_document", amountText: null,
      reason: "Daily ICU Cash may apply, but DearPolicy has not yet verified which specific days of this admission were spent in the ICU.",
      conditions: ["Upload the discharge summary or ICU transfer notes showing the ICU admission/discharge times."],
    };
  }
  const calc = calculateHospitalCash({
    dailyRate: rule.dailyRateMinor / 100, currency: rule.currency, hospitalStayOngoing: false, hospitalNights: nights,
    offsetDays: 0, maximumDays: rule.capDays, ownership: ownershipRef(coverage), ruleEvidence: toRef(rule.citation),
    ownershipEvidence: ownershipEvidenceRef(coverage),
  });
  if (calc.status === "blocked") {
    return { ...base, status: "needs_document", amountText: null, reason: `${benefitTitle(rule.benefitCode)} may apply. DearPolicy has not included an amount: ${calc.message}`, conditions: [calc.message] };
  }
  if (calc.status === "not_applicable") {
    return {
      ...base, status: "not_applicable", amountText: null,
      reason: `This benefit pays ${amountText(rule.dailyRateMinor / 100, rule.currency)} per day after a waiting period of ${provisions.waitingDays} day${provisions.waitingDays === 1 ? "" : "s"}. The reported/verified stay produced ${calc.reportedHospitalNights} counted night${calc.reportedHospitalNights === 1 ? "" : "s"}, which does not clear that waiting period, so this benefit does not pay for this admission.`,
      conditions: [],
    };
  }
  return {
    ...base, status: verifiedSource ? "likely_applicable" : "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
    calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
    reason: `${benefitTitle(rule.benefitCode)} pays ${amountText(rule.dailyRateMinor / 100, rule.currency)} per day. ${calc.formula}`,
    conditions: verifiedSource
      ? ["The admission must not fall under an exclusion for this benefit."]
      : ["The admission/discharge dates used here are as reported in chat, not yet confirmed from a reviewed document -- upload the discharge summary or hospital bill to confirm."],
  };
}

const ROOM_AND_BOARD_LIKE = /room|board|ward/;

function assessReimbursementBenefit(
  rule: MedicalReimbursementRule, coverage: OwnedCoverage, provisions: MedicalPlanProvisions | null,
  facts: ClaimFacts, verified: VerifiedMedicalBillFacts | null,
): ClaimAssessmentItem {
  const base = {
    id: rule.benefitCode, title: benefitTitle(rule.benefitCode), productName: coverage.productName, coverageId: coverage.id,
    evidenceTerms: [rule.quote], ruleEvidence: rule.citation, coverLabel: coverage.productName ?? undefined, aggregation: "reimbursement" as const,
  };
  if (!verified || verified.lineItems.length === 0) {
    return {
      ...base, status: "needs_document", amountText: null,
      reason: `${benefitTitle(rule.benefitCode)} may apply, but DearPolicy has not yet reviewed an itemised bill for this claim.`,
      conditions: ["Upload the itemised hospital bill so DearPolicy can check it against this benefit's evidenced eligible expense categories."],
    };
  }
  // Checkpoint (Wave 2, D4/D8/D9): a reimbursement benefit ALWAYS rests on
  // verified, AI-extracted bill evidence -- unlike hospital-cash above,
  // there is no unverified chat-reported fallback path for it, so this
  // gate applies unconditionally once `verified` has usable line items.
  // See lib/claims/evidence-authority.ts.
  const reimbursementAuthority = evaluateAggregateEvidenceAuthority(verified.provenance);
  if (!reimbursementAuthority.authorized) {
    return {
      ...base, status: "needs_document", amountText: null,
      reason: `${benefitTitle(rule.benefitCode)} may apply. DearPolicy has not included an amount: ${reimbursementAuthority.message}`,
      conditions: [reimbursementAuthority.message],
    };
  }
  const claimCurrency = /^[A-Z]{3}$/.test(coverage.currency ?? "") ? (coverage.currency as string) : (verified.lineItems[0]?.currency ?? null);
  if (!claimCurrency) {
    return { ...base, status: "needs_document", amountText: null, reason: `${benefitTitle(rule.benefitCode)} may apply, but this cover has no verified currency to calculate in.`, conditions: ["Confirm the currency of this cover against the personal certificate."] };
  }
  const eligibleSet = new Set(rule.eligibleCategories);
  const mismatchedCurrency = verified.lineItems.filter((li) => eligibleSet.has(li.category) && li.currency !== claimCurrency);
  if (mismatchedCurrency.length > 0) {
    return {
      ...base, status: "needs_document", amountText: null,
      reason: `Some reviewed itemised bill lines are in a different currency than this cover's verified currency (${claimCurrency}). DearPolicy does not convert currency automatically.`,
      conditions: ["Confirm the correct currency for each bill line, or provide a bill in this cover's verified currency."],
    };
  }

  const billedItems: BilledExpenseItem[] = verified.lineItems.map((li) => ({ category: li.category, description: li.description ?? li.category, amountMinor: li.amountMinor }));
  const categoryLimits: CategoryLimit[] = rule.categoryLimits.map((l) => ({ category: l.category, capMinor: l.capMinor, evidence: toRef(rule.citation) }));
  const panelStatus = resolvePanelStatus(facts);
  const panelRestriction = panelStatus ? { panelStatus, nonPanelFactor: provisions?.nonPanelFactor ?? null, evidence: toRef(rule.citation) } : null;
  const deductionSteps: DeductionStep[] = [];
  if (provisions) {
    if (provisions.deductibleMinor != null) deductionSteps.push({ kind: "deductible", amountMinor: provisions.deductibleMinor, evidence: toRef(provisions.citation) });
    if (provisions.coInsurancePercent != null) deductionSteps.push({ kind: "co_insurance", percent: provisions.coInsurancePercent, evidence: toRef(provisions.citation) });
  }
  const thirdPartyPaid = verified.thirdPartyPayments.filter((p) => p.currency === claimCurrency);
  const thirdPartyCoordination = thirdPartyPaid.length > 0 ? { required: true, evidence: toRef(rule.citation) } : null;

  const calc = calculateMedicalReimbursement({
    currency: claimCurrency, eligibleCategories: rule.eligibleCategories, billedItems, categoryLimits,
    wardProration: null, panelRestriction, deductionSteps, deductionOrderEvidenced: deductionSteps.length <= 1,
    perAdmissionCap: null, thirdPartyCoordination, thirdPartyPayments: thirdPartyCoordination ? thirdPartyPaid.map((p) => ({ source: p.source, amountMinor: p.amountMinor })) : null,
    remainingLimits: [], ownership: ownershipRef(coverage), ruleEvidence: toRef(rule.citation), ownershipEvidence: ownershipEvidenceRef(coverage),
  });

  const wardCaveat = eligibleSet.has("room_and_board") || [...eligibleSet].some((c) => ROOM_AND_BOARD_LIKE.test(c))
    ? ["DearPolicy has not verified whether the reported/verified ward exceeds this policy's entitled ward class; a pro-ration reduction may apply that is not reflected in this estimate."]
    : [];

  if (calc.status === "blocked") {
    const extra = calc.reasonCode === "UNRESOLVED_DEDUCTION_ORDER" && calc.competingAmounts
      ? ` Depending on the order applied, this ranges from ${amountText(Math.min(...calc.competingAmounts.map((c) => c.amount)), claimCurrency)} to ${amountText(Math.max(...calc.competingAmounts.map((c) => c.amount)), claimCurrency)}.`
      : "";
    return { ...base, status: "needs_document", amountText: null, reason: `${benefitTitle(rule.benefitCode)} may apply. DearPolicy has not included an amount: ${calc.message}${extra}`, conditions: [calc.message, ...wardCaveat] };
  }
  if (calc.status === "not_applicable") {
    return { ...base, status: "not_applicable", amountText: null, reason: `${benefitTitle(rule.benefitCode)}: ${calc.formula}`, conditions: [] };
  }
  return {
    ...base, status: "potentially_applicable", amountText: amountText(calc.potentialAmount, calc.currency),
    calculatedAmount: calc.potentialAmount, currency: calc.currency, calculationId: calc.calculationId,
    reason: `${benefitTitle(rule.benefitCode)}: eligible reviewed expense ${amountText(calc.eligibleBilledExpense, claimCurrency)}, after benefit limits, pro-ration, panel restriction, deductible/co-insurance and coordination, ${amountText(calc.potentialAmount, calc.currency)} is potentially payable.`,
    conditions: ["The treatment must satisfy this benefit's own conditions and exclusions.", ...wardCaveat],
  };
}

export function assessMedicalClaim(
  facts: ClaimFacts, coverages: OwnedCoverage[], medicalRules: MedicalRuleEvidence = EMPTY_MEDICAL_RULE_EVIDENCE,
): ClaimAssessmentItem[] {
  const items: ClaimAssessmentItem[] = [];
  const provisionsByCoverage = new Map(medicalRules.planProvisions.map((p) => [p.coverageId, p]));
  for (const rule of medicalRules.cashRules) {
    const coverage = coverages.find((c) => c.id === rule.coverageId);
    if (!coverage) continue;
    items.push(assessCashBenefit(rule, coverage, provisionsByCoverage.get(coverage.id) ?? null, facts, facts.verifiedMedicalBillFacts));
  }
  for (const rule of medicalRules.reimbursementRules) {
    const coverage = coverages.find((c) => c.id === rule.coverageId);
    if (!coverage) continue;
    items.push(assessReimbursementBenefit(rule, coverage, provisionsByCoverage.get(coverage.id) ?? null, facts, facts.verifiedMedicalBillFacts));
  }
  return items;
}

export function nextMedicalQuestion(facts: ClaimFacts, medicalRules: MedicalRuleEvidence = EMPTY_MEDICAL_RULE_EVIDENCE): ClaimQuestion | null {
  const hasCash = medicalRules.cashRules.length > 0;
  const hasReimbursement = medicalRules.reimbursementRules.length > 0;
  if (!hasCash && !hasReimbursement) return null;
  const verified = facts.verifiedMedicalBillFacts;
  if (!facts.admissionDate && !verified?.admissionISO && !facts.uncertainFacts.includes("admission_date")) {
    return { id: "admission_date", text: "What date (and if you know it, the time) were you admitted to hospital?", type: "date", why: "The admission date/time is needed to calculate hospital-cash and reimbursement day counts." };
  }
  if (!facts.dischargeDate && !verified?.dischargeISO && !facts.uncertainFacts.includes("discharge_date")) {
    return { id: "discharge_date", text: "What date were you discharged?", type: "date", why: "The discharge date is needed to calculate the length of stay." };
  }
  if (hasReimbursement && facts.medicalBillDocumentAvailable == null && !facts.uncertainFacts.includes("medical_bill_document")) {
    return { id: "medical_bill_document", text: "Do you have an itemised hospital bill? You can say “not sure” if you have not checked yet.", type: "yes_no", options: ["Yes", "No", "Not sure"], why: "Reimbursement-type medical benefits need a reviewed itemised bill before DearPolicy can show an amount." };
  }
  if (hasReimbursement && facts.medicalBillDocumentAvailable === true && facts.medicalBillEvidenceReviewed !== true && !facts.uncertainFacts.includes("medical_bill_document_upload")) {
    return { id: "medical_bill_document_upload", text: "Please upload the itemised hospital bill (and discharge summary, if you have it). DearPolicy will check its stated amounts before showing a reimbursement estimate.", type: "text", why: "Saying the bill exists is not the same as DearPolicy having read it -- only a reviewed bill can confirm an eligible expense." };
  }
  if (hasReimbursement && facts.panelStatusReported == null && !facts.uncertainFacts.includes("panel_status")) {
    return { id: "panel_status", text: "Was the treating hospital/doctor on your insurer's panel? Say “not sure” if you don't know.", type: "choice", options: ["Panel", "Non-panel", "Not sure"], why: "Panel status can change the reimbursement percentage under this plan." };
  }
  return null;
}
