import { createHash } from "node:crypto";
import { applyDeductionCore, percentToPpm } from "./deductions";

/**
 * Pure, deterministic medical-reimbursement benefit calculator: surgical,
 * inpatient, pre-/post-hospitalisation, and emergency/specialist outpatient
 * reimbursement benefits all share this one pipeline (they differ only in
 * which evidenced expense categories and limits apply -- see
 * lib/claims/medical-evidence.ts for how those are read per benefit code).
 *
 * This is the ONLY place a medical-reimbursement potential amount may be
 * computed. Exactly like lib/claims/calculators/hospital-cash.ts and
 * critical-illness.ts, it accepts only already-verified, structured inputs
 * -- never LLM prose -- and fails closed: a missing or unverifiable input
 * blocks the result rather than defaulting to a guess in either direction.
 * The estimate can never exceed the verified eligible billed expense,
 * because every step below only ever subtracts from (or leaves unchanged)
 * a running total that started at that expense -- nothing is ever added.
 *
 * Step order matters (deductible-then-co-insurance vs. the reverse can
 * produce different amounts) and DearPolicy never assumes a default order:
 * when more than one deduction step applies and the wording does not
 * itself establish their sequence, this blocks with both competing
 * amounts shown rather than picking one silently.
 */

export type MedicalReimbursementEvidenceRef = { chunkId?: string; policyId?: string; pageStart?: number; pageEnd?: number; label?: string };
export type MedicalReimbursementOwnershipRef = { contractId: string; coverageId?: string; label?: string };

export type BilledExpenseItem = { category: string; description: string; amountMinor: number };
export type CategoryLimit = { category: string; capMinor: number; evidence: MedicalReimbursementEvidenceRef };
export type WardProration = { factor: number; evidence: MedicalReimbursementEvidenceRef } | null;
export type PanelRestriction = { panelStatus: "panel" | "non_panel"; nonPanelFactor: number | null; evidence: MedicalReimbursementEvidenceRef } | null;
export type DeductionStep =
  | { kind: "deductible"; amountMinor: number; evidence: MedicalReimbursementEvidenceRef }
  | { kind: "co_insurance"; percent: number; evidence: MedicalReimbursementEvidenceRef }
  | { kind: "co_pay"; amountMinor: number; evidence: MedicalReimbursementEvidenceRef };
export type ThirdPartyCoordination = { required: boolean; evidence: MedicalReimbursementEvidenceRef } | null;
export type ThirdPartyPayment = { source: string; amountMinor: number };
export type RemainingLimit = { scope: "per_admission" | "annual" | "lifetime"; remainingMinor: number };

export type MedicalReimbursementInput = {
  /** ISO 4217 currency code -- every billedItems entry and every minor-unit
   * figure below is assumed already converted to this one currency by the
   * caller; this calculator never converts currency itself. */
  currency: string | null;
  /** Evidenced list of expense categories this specific benefit covers
   * (e.g. ["surgical_fees", "anaesthetist_fees"]). Absent/empty blocks --
   * DearPolicy never assumes a category is covered. */
  eligibleCategories: string[] | null;
  /** The reviewed, evidence-backed itemised bill. Absent blocks. Never the
   * family's own chat-reported total -- see lib/claims/medical-evidence.ts. */
  billedItems: BilledExpenseItem[] | null;
  /** Per-category schedule caps, evidenced. A category with no entry here
   * is uncapped by schedule (still subject to every other step below). */
  categoryLimits: CategoryLimit[];
  wardProration: WardProration;
  panelRestriction: PanelRestriction;
  /** Every deductible/co-insurance/co-pay step that evidenced wording
   * establishes for this benefit. Order in this array is the order
   * APPLIED only when `deductionOrderEvidenced` is true. */
  deductionSteps: DeductionStep[];
  /** True only when the exact sequence of `deductionSteps` is itself
   * established by evidenced wording (or there is at most one step, where
   * order is moot). False with >1 step blocks with competing amounts. */
  deductionOrderEvidenced: boolean;
  perAdmissionCap: { amountMinor: number; evidence: MedicalReimbursementEvidenceRef } | null;
  thirdPartyCoordination: ThirdPartyCoordination;
  /** null = not yet asked/confirmed (blocks when coordination is
   * required); [] = asked and confirmed no third-party payment. */
  thirdPartyPayments: ThirdPartyPayment[] | null;
  remainingLimits: RemainingLimit[];
  ownership: MedicalReimbursementOwnershipRef | null;
  ruleEvidence: MedicalReimbursementEvidenceRef | null;
  ownershipEvidence: MedicalReimbursementEvidenceRef | null;
  unresolvedConditions?: string[];
};

export type MedicalReimbursementBlockReasonCode =
  | "MISSING_CURRENCY"
  | "MISSING_ELIGIBLE_CATEGORIES"
  | "MISSING_BILLED_ITEMS"
  | "NO_ELIGIBLE_EXPENSE"
  | "MISSING_PANEL_STATUS"
  | "NON_PANEL_NOT_COVERED"
  | "UNRESOLVED_DEDUCTION_ORDER"
  | "MISSING_THIRD_PARTY_PAYMENT_STATUS"
  | "MISSING_OWNERSHIP_MAPPING"
  | "MISSING_RULE_EVIDENCE"
  | "MISSING_OWNERSHIP_EVIDENCE"
  | "UNRESOLVED_CONDITION";

export type MedicalReimbursementBlocked = {
  status: "blocked";
  reasonCode: MedicalReimbursementBlockReasonCode;
  message: string;
  /** Populated only for UNRESOLVED_DEDUCTION_ORDER -- the amount under
   * each order DearPolicy could not choose between, so a person or the
   * insurer can resolve it rather than DearPolicy silently picking one. */
  competingAmounts?: { description: string; amount: number }[];
};

type MedicalReimbursementComputedFields = {
  currency: string;
  eligibleBilledExpense: number;
  afterCategoryLimits: number;
  afterWardProration: number;
  afterPanelRestriction: number;
  afterDeductions: number;
  afterPerAdmissionCap: number;
  afterThirdPartyCoordination: number;
  formula: string;
  ruleEvidence: MedicalReimbursementEvidenceRef;
  ownershipEvidence: MedicalReimbursementEvidenceRef;
  ownership: MedicalReimbursementOwnershipRef;
  calculationId: string;
};
export type MedicalReimbursementCalculated = MedicalReimbursementComputedFields & { status: "calculated"; potentialAmount: number };
export type MedicalReimbursementNotApplicable = MedicalReimbursementComputedFields & { status: "not_applicable"; potentialAmount: null };
export type MedicalReimbursementResult = MedicalReimbursementCalculated | MedicalReimbursementNotApplicable | MedicalReimbursementBlocked;

const ISO_CURRENCY = /^[A-Z]{3}$/;
function isNonNegativeInteger(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0; }

/** Applies one deduction step to a running minor-unit amount. Percent-based
 * co-insurance is always computed against the CURRENT running amount at
 * the point it is applied (never the original eligible expense), which is
 * exactly why step order changes the result. */
function applyDeduction(amountMinor: number, step: DeductionStep): number {
  // co_insurance: `percent` is the POLICYHOLDER's share (what is deducted
  // from the benefit), e.g. 20 means the insurer pays 80%. The arithmetic is
  // the shared integer core (./deductions.ts), also used by lib/rag2/calc.
  if (step.kind === "co_insurance") return applyDeductionCore(amountMinor, { kind: "co_insurance", ppm: percentToPpm(step.percent) }).afterMinor;
  return applyDeductionCore(amountMinor, { kind: step.kind, amountMinor: step.amountMinor }).afterMinor;
}

export function calculateMedicalReimbursement(input: MedicalReimbursementInput): MedicalReimbursementResult {
  if (typeof input.currency !== "string" || !ISO_CURRENCY.test(input.currency)) {
    return { status: "blocked", reasonCode: "MISSING_CURRENCY", message: "This benefit does not have a verified ISO currency." };
  }
  if (!input.eligibleCategories || input.eligibleCategories.length === 0) {
    return { status: "blocked", reasonCode: "MISSING_ELIGIBLE_CATEGORIES", message: "The expense categories this benefit covers have not been evidenced." };
  }
  if (!input.billedItems) {
    return { status: "blocked", reasonCode: "MISSING_BILLED_ITEMS", message: "There is no reviewed, itemised bill to calculate from." };
  }
  if (!input.ownership || !input.ownership.contractId) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_MAPPING", message: "This benefit is not explicitly mapped to an owned policy contract." };
  }
  if (!input.ruleEvidence) {
    return { status: "blocked", reasonCode: "MISSING_RULE_EVIDENCE", message: "The benefit's covered categories/limits have no evidence reference." };
  }
  if (!input.ownershipEvidence) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_EVIDENCE", message: "Ownership of this policy has no evidence reference." };
  }
  if (input.unresolvedConditions?.length) {
    return { status: "blocked", reasonCode: "UNRESOLVED_CONDITION", message: "A required policy condition is still unresolved: " + input.unresolvedConditions[0] };
  }

  const eligibleSet = new Set(input.eligibleCategories);
  const eligibleItems = input.billedItems.filter((item) => eligibleSet.has(item.category));
  const eligibleBilledExpenseMinor = eligibleItems.reduce((sum, item) => sum + Math.max(0, item.amountMinor), 0);
  if (eligibleBilledExpenseMinor === 0) {
    return {
      status: "not_applicable", potentialAmount: null,
      currency: input.currency, eligibleBilledExpense: 0, afterCategoryLimits: 0, afterWardProration: 0, afterPanelRestriction: 0,
      afterDeductions: 0, afterPerAdmissionCap: 0, afterThirdPartyCoordination: 0,
      formula: "No billed item falls under this benefit's evidenced eligible categories.",
      ruleEvidence: input.ruleEvidence, ownershipEvidence: input.ownershipEvidence, ownership: input.ownership,
      calculationId: "mr:" + createHash("sha256").update(JSON.stringify([input.currency, input.eligibleCategories, input.billedItems])).digest("hex"),
    };
  }

  // Category limits: applied PER CATEGORY, on that category's own subtotal,
  // before the categories are summed together -- a cap on "room and board"
  // can never be consumed by a large "surgical fees" line.
  const limitByCategory = new Map(input.categoryLimits.map((l) => [l.category, l.capMinor]));
  const byCategory = new Map<string, number>();
  for (const item of eligibleItems) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + Math.max(0, item.amountMinor));
  let afterCategoryLimitsMinor = 0;
  for (const [category, subtotal] of byCategory) {
    const cap = limitByCategory.get(category);
    afterCategoryLimitsMinor += cap == null ? subtotal : Math.min(subtotal, cap);
  }

  let running = afterCategoryLimitsMinor;
  const afterWardProrationMinor = input.wardProration ? Math.round(running * input.wardProration.factor) : running;
  running = afterWardProrationMinor;

  if (!input.panelRestriction) {
    return { status: "blocked", reasonCode: "MISSING_PANEL_STATUS", message: "Whether the treating hospital/doctor is on the insurer's panel has not been evidenced." };
  }
  if (input.panelRestriction.panelStatus === "non_panel" && input.panelRestriction.nonPanelFactor == null) {
    return { status: "blocked", reasonCode: "NON_PANEL_NOT_COVERED", message: "This benefit's wording does not establish a reduced non-panel amount, and the treating provider is non-panel." };
  }
  const afterPanelRestrictionMinor = input.panelRestriction.panelStatus === "non_panel" ? Math.round(running * (input.panelRestriction.nonPanelFactor as number)) : running;
  running = afterPanelRestrictionMinor;

  if (input.deductionSteps.length > 1 && !input.deductionOrderEvidenced) {
    const forward = input.deductionSteps.reduce((amt, step) => applyDeduction(amt, step), running);
    const reverse = [...input.deductionSteps].reverse().reduce((amt, step) => applyDeduction(amt, step), running);
    return {
      status: "blocked", reasonCode: "UNRESOLVED_DEDUCTION_ORDER",
      message: "More than one deduction (deductible/co-insurance/co-pay) applies and the policy wording does not establish which is applied first, which changes the result.",
      competingAmounts: [
        { description: "Applied in the order listed", amount: forward / 100 },
        { description: "Applied in the reverse order", amount: reverse / 100 },
      ],
    };
  }
  const afterDeductionsMinor = input.deductionSteps.reduce((amt, step) => applyDeduction(amt, step), running);
  running = afterDeductionsMinor;

  const afterPerAdmissionCapMinor = input.perAdmissionCap ? Math.min(running, input.perAdmissionCap.amountMinor) : running;
  running = afterPerAdmissionCapMinor;

  if (input.thirdPartyCoordination?.required && input.thirdPartyPayments === null) {
    return { status: "blocked", reasonCode: "MISSING_THIRD_PARTY_PAYMENT_STATUS", message: "This benefit's wording requires coordinating with any other insurer's payment, and whether another insurer has paid has not been confirmed." };
  }
  const thirdPartyTotalMinor = input.thirdPartyCoordination?.required ? (input.thirdPartyPayments ?? []).reduce((sum, p) => sum + Math.max(0, p.amountMinor), 0) : 0;
  const afterThirdPartyCoordinationMinor = Math.max(0, running - thirdPartyTotalMinor);
  running = afterThirdPartyCoordinationMinor;

  for (const limit of input.remainingLimits) running = Math.min(running, Math.max(0, limit.remainingMinor));

  const common: MedicalReimbursementComputedFields = {
    currency: input.currency,
    eligibleBilledExpense: eligibleBilledExpenseMinor / 100,
    afterCategoryLimits: afterCategoryLimitsMinor / 100,
    afterWardProration: afterWardProrationMinor / 100,
    afterPanelRestriction: afterPanelRestrictionMinor / 100,
    afterDeductions: afterDeductionsMinor / 100,
    afterPerAdmissionCap: afterPerAdmissionCapMinor / 100,
    afterThirdPartyCoordination: afterThirdPartyCoordinationMinor / 100,
    formula: `eligibleExpense(${(eligibleBilledExpenseMinor / 100).toFixed(2)}) -> categoryLimits(${(afterCategoryLimitsMinor / 100).toFixed(2)}) -> wardProration(${(afterWardProrationMinor / 100).toFixed(2)}) -> panel(${(afterPanelRestrictionMinor / 100).toFixed(2)}) -> deductions(${(afterDeductionsMinor / 100).toFixed(2)}) -> perAdmissionCap(${(afterPerAdmissionCapMinor / 100).toFixed(2)}) -> thirdParty(${(afterThirdPartyCoordinationMinor / 100).toFixed(2)}) -> finalAfterRemainingLimits(${(running / 100).toFixed(2)}) ${input.currency}`,
    ruleEvidence: input.ruleEvidence,
    ownershipEvidence: input.ownershipEvidence,
    ownership: input.ownership,
    calculationId: "mr:" + createHash("sha256").update(JSON.stringify([
      input.currency, input.eligibleCategories, input.billedItems, input.categoryLimits, input.wardProration,
      input.panelRestriction, input.deductionSteps, input.deductionOrderEvidenced, input.perAdmissionCap,
      input.thirdPartyCoordination, input.thirdPartyPayments, input.remainingLimits, input.ownership, input.ruleEvidence, input.ownershipEvidence,
    ])).digest("hex"),
  };

  if (running === 0) return { status: "not_applicable", potentialAmount: null, ...common };
  return { status: "calculated", potentialAmount: running / 100, ...common };
}
