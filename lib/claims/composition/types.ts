/**
 * Runtime-validated composition metadata for a single calculated benefit,
 * plus the deterministic claim-composition result structure it feeds.
 *
 * Nothing here ever computes a total by asking a model to add numbers.
 * Every field on `ComposedBenefit` is either copied verbatim from an
 * already-validated calculator result (lib/claims/calculators/*.ts, which
 * are themselves pure, fail-closed, evidence-gated functions) or derived by
 * the deterministic engine in ./engine.ts from evidenced wording citations.
 * As with lib/claims/calculators/evidence.ts, every value here may have
 * round-tripped through JSON storage (the audit snapshot, the claim
 * session's own decision packet) or arrived from a caller, so every runtime
 * validator below independently re-checks structure rather than trusting
 * TypeScript's compile-time types.
 */

export const COMPOSITION_TYPES = [
  "independent_additive",
  "alternative_highest",
  "alternative_selected",
  "accelerated_from_base",
  "additional_to_base",
  "shared_policy_cap",
  "shared_event_cap",
  "informational_only",
  "unknown",
] as const;
export type CompositionType = (typeof COMPOSITION_TYPES)[number];

export const COMPOSED_BENEFIT_STATUSES = ["included", "excluded", "blocked", "needs_document", "needs_review"] as const;
export type ComposedBenefitStatus = (typeof COMPOSED_BENEFIT_STATUSES)[number];

export type ComposedBenefitBlockReasonCode =
  | "UNKNOWN_COMPOSITION"
  | "ALTERNATIVE_NOT_SELECTED"
  | "AMBIGUOUS_ALTERNATIVE_SELECTION"
  | "DUPLICATE_POLICY_OR_VERSION"
  | "AMBIGUOUS_POLICY_VERSION"
  | "GROUP_MEMBERSHIP_UNVERIFIED"
  | "POLICY_NOT_IN_FORCE_AT_EVENT"
  | "CURRENCY_MISMATCH"
  | "CAP_EXCEEDED_FULLY"
  | "MISSING_PRIOR_PAID_AMOUNT"
  | "MISSING_EVIDENCE"
  | "SOURCE_CALCULATION_NOT_ALLOWED"
  /** A same-policy group contains more than one critical-illness benefit
   * (e.g. a major-CI benefit alongside an early/intermediate-stage
   * benefit) and DearPolicy found no explicit wording evidence for how
   * they relate (alternative / accelerated / additional) -- see
   * lib/claims/composition/engine.ts's same-policy grouping loop. Unlike
   * an ordinary death-benefit pairing, an unresolved CI relationship is
   * never defaulted to additive: a policy can define dozens of distinct
   * CI benefit rows that are frequently NOT independently payable
   * together, so assuming additive without evidence would risk silently
   * double-counting. */
  | "CI_COMPOSITION_NOT_EVIDENCED"
  /** More than one policy's independently-INCLUDED benefit is a
   * reimbursement-type medical-claim benefit (`aggregation ===
   * "reimbursement"`) for the SAME claim event -- e.g. a base plan and a
   * rider, an integrated plan and an employer plan, or two genuinely
   * separate reimbursement policies. Two reimbursement benefits can both
   * legitimately respond to the SAME underlying bill, which is exactly the
   * double-payment risk the medical-claims spec calls out. This V1 slice
   * has no evidenced coordination-of-benefits-clause detector (see
   * lib/claims/composition/engine.ts's own comment at the blocking pass),
   * so rather than invent an allocation between insurers or silently add
   * both, every such benefit is blocked and an unresolved combined total
   * is surfaced as an outstanding question instead. */
  | "REIMBURSEMENT_COORDINATION_NOT_EVIDENCED"
  /** A same-policy group contains more than one disability benefit --
   * typically a Total & Permanent Disability lump sum alongside a
   * permanent-partial-disability/dismemberment amount from the same
   * policy's own schedule of injuries -- and DearPolicy found no explicit
   * wording evidence for how they relate (alternative / accelerated /
   * additional). These two are frequently mutually exclusive for the SAME
   * disability under a policy's own wording (see
   * lib/claims/calculators/disability-benefit.ts's own module doc
   * comment), so exactly like an unresolved critical-illness relationship,
   * an unresolved disability relationship is never defaulted to additive --
   * assuming additive without evidence would risk double-counting one
   * disability under both the schedule and TPD. */
  | "DISABILITY_COMPOSITION_NOT_EVIDENCED";

/** A reference to an aggregate cap that was evaluated against this benefit,
 * whether or not it ended up binding. `scope` says what the cap applies
 * across; `evidenceRef` cites the wording (or, for a lifetime cap, the
 * user-supplied prior-paid-amount fact) that established the cap amount.
 *
 * `evidenceRef.wordingDigest` and `evidenceRef.quote` (present whenever the
 * cap came from wording, i.e. every case except the user-reported prior-
 * paid-amount variant) are what let a stored audit snapshot (see
 * lib/claims/composition/store.ts) reproduce the EXACT historical cap
 * decision even if the source document is later re-uploaded, re-OCR'd,
 * re-chunked, or re-paginated -- `chunkId`/`pageStart`/`pageEnd` alone are
 * MUTABLE pointers into a document that can be reprocessed at any time, so
 * they cannot, by themselves, prove what wording actually produced a
 * historical `amount`/`applied`/`amountDeducted` decision. `quote` is the
 * exact matched clause (already bounded to a single regex match, at most a
 * couple hundred characters -- see relationships.ts's CAP_PATTERN) rather
 * than the whole page, and `wordingDigest` is a one-way sha256 of that same
 * bounded quote: together they are enough to verify/reproduce the decision
 * without ever persisting an unbounded amount of the underlying policy
 * document's raw text. Optional so a `ComposedBenefit` stored by an older
 * engine version (before this field existed) still validates. */
export type CapReference = {
  scope: "coverage" | "benefit_group" | "policy" | "event" | "lifetime";
  amount: number;
  currency: string;
  evidenceRef: { policyId: string; chunkId: string; pageStart: number; pageEnd: number; label?: string; wordingDigest?: string; quote?: string } | { source: "user_reported_prior_paid"; recordedAt: string };
  applied: boolean;
  amountDeducted: number;
};

export type DeductionReference = {
  reason: "accelerated_from_base" | "aggregate_cap" | "alternative_not_selected";
  amount: number;
  relatedBenefitCalculationId?: string;
  capReference?: CapReference;
};

export type EvidenceReference = { policyId: string; chunkId: string; pageStart: number; pageEnd: number; label?: string };

export type ComposedBenefit = {
  policyId: string;
  /** This schema has no separate "contract" concept from a policy document
   * (see lib/claims/death-evidence.ts's precedence-fix comment) -- kept as
   * its own field, always equal to `policyId` today, so a future schema
   * change (a contract spanning several policy-document versions) does not
   * require renaming every downstream consumer. */
  contractId: string;
  coverageId: string;
  familyMemberId: string;
  claimEventId: string;
  benefitCode: string;
  benefitCategory: string;
  calculationId: string;
  currency: string;
  rawAmount: number;
  payableAmount: number;
  compositionType: CompositionType;
  compositionGroupId: string | null;
  priority: number;
  capReferences: CapReference[];
  deductionReferences: DeductionReference[];
  evidenceReferences: EvidenceReference[];
  /** Carried straight through from the source ClaimAssessmentItem's own
   * `aggregation` (lib/claims/types.ts) -- "reimbursement" for a
   * reimbursement-type medical-claim benefit (see lib/claims/medical-rules.ts),
   * undefined/"additive" for a lump-sum benefit like a death or CI payout.
   * Used only by the cross-policy reimbursement-coordination blocking pass
   * in ./engine.ts; never used to compute an amount itself. */
  aggregation?: "additive" | "reimbursement";
  status: ComposedBenefitStatus;
  blockedReasonCodes: ComposedBenefitBlockReasonCode[];
};

export type ComposedBenefitInput = Omit<ComposedBenefit, "payableAmount" | "status" | "blockedReasonCodes" | "capReferences" | "deductionReferences"> & {
  capReferences?: CapReference[];
  deductionReferences?: DeductionReference[];
};

function isFiniteNumber(v: unknown): v is number { return typeof v === "number" && Number.isFinite(v); }
function nonEmptyString(v: unknown): v is string { return typeof v === "string" && v.trim().length > 0; }
const ISO_CURRENCY = /^[A-Z]{3}$/;

export type ComposedBenefitValidation = { valid: true; benefit: ComposedBenefit } | { valid: false; reasonCode: "MALFORMED_COMPOSED_BENEFIT"; message: string };

/** Structural, fail-closed validation for a `ComposedBenefit` that may have
 * round-tripped through JSON (the audit snapshot, a stored decision
 * packet). An unrecognised `compositionType` is normalised to `"unknown"`
 * and the benefit is force-excluded rather than rejected outright, so a
 * schema-forward engine version's output can still be displayed (excluded,
 * never silently additive) by an older reader. */
export function validateComposedBenefit(value: unknown): ComposedBenefitValidation {
  if (typeof value !== "object" || value === null) return { valid: false, reasonCode: "MALFORMED_COMPOSED_BENEFIT", message: "Composed benefit must be an object." };
  const v = value as Record<string, unknown>;
  for (const key of ["policyId", "contractId", "coverageId", "familyMemberId", "claimEventId", "benefitCode", "benefitCategory", "calculationId", "currency"]) {
    if (!nonEmptyString(v[key])) return { valid: false, reasonCode: "MALFORMED_COMPOSED_BENEFIT", message: `Missing or empty required field: ${key}.` };
  }
  if (!ISO_CURRENCY.test(v.currency as string)) return { valid: false, reasonCode: "MALFORMED_COMPOSED_BENEFIT", message: "Currency must be a 3-letter ISO code." };
  if (!isFiniteNumber(v.rawAmount) || (v.rawAmount as number) < 0) return { valid: false, reasonCode: "MALFORMED_COMPOSED_BENEFIT", message: "rawAmount must be a non-negative finite number." };
  if (!isFiniteNumber(v.priority)) return { valid: false, reasonCode: "MALFORMED_COMPOSED_BENEFIT", message: "priority must be a finite number." };
  const compositionType: CompositionType = COMPOSITION_TYPES.includes(v.compositionType as CompositionType) ? (v.compositionType as CompositionType) : "unknown";
  const compositionGroupId = v.compositionGroupId == null ? null : (nonEmptyString(v.compositionGroupId) ? (v.compositionGroupId as string) : null);
  const capReferences = Array.isArray(v.capReferences) ? (v.capReferences as CapReference[]) : [];
  const deductionReferences = Array.isArray(v.deductionReferences) ? (v.deductionReferences as DeductionReference[]) : [];
  const evidenceReferences = Array.isArray(v.evidenceReferences) ? (v.evidenceReferences as EvidenceReference[]) : [];
  const requestedStatus = COMPOSED_BENEFIT_STATUSES.includes(v.status as ComposedBenefitStatus) ? (v.status as ComposedBenefitStatus) : "blocked";
  const blockedReasonCodes = Array.isArray(v.blockedReasonCodes) ? (v.blockedReasonCodes as ComposedBenefitBlockReasonCode[]) : [];
  // Fail closed: an unknown/unsupported composition type is never allowed
  // to remain "included" no matter what the stored status claims.
  const status: ComposedBenefitStatus = compositionType === "unknown" && requestedStatus === "included" ? "blocked" : requestedStatus;
  const reasons = compositionType === "unknown" && !blockedReasonCodes.includes("UNKNOWN_COMPOSITION") ? [...blockedReasonCodes, "UNKNOWN_COMPOSITION" as const] : blockedReasonCodes;
  const payableAmount = status === "included" && isFiniteNumber(v.payableAmount) && (v.payableAmount as number) >= 0 ? (v.payableAmount as number) : 0;
  return {
    valid: true,
    benefit: {
      policyId: v.policyId as string, contractId: v.contractId as string, coverageId: v.coverageId as string,
      familyMemberId: v.familyMemberId as string, claimEventId: v.claimEventId as string, benefitCode: v.benefitCode as string,
      benefitCategory: v.benefitCategory as string, calculationId: v.calculationId as string, currency: v.currency as string,
      rawAmount: v.rawAmount as number, payableAmount, compositionType, compositionGroupId, priority: v.priority as number,
      capReferences, deductionReferences, evidenceReferences,
      ...(v.aggregation === "reimbursement" || v.aggregation === "additive" ? { aggregation: v.aggregation } : {}),
      status, blockedReasonCodes: reasons,
    },
  };
}

/** Per-currency, per-policy claim composition result. Never a single
 * unlabelled total, and never a status coerced into "$0" -- see
 * ./engine.ts's composeClaim() for how this is built. */
export type PolicySection = {
  policyId: string;
  policyLabel: string;
  benefits: ComposedBenefit[];
  subtotalsByCurrency: { currency: string; includedAmount: number }[];
};

export type CurrencyTotal = { currency: string; includedAmount: number };

export type ClaimCompositionResult = {
  claimEventId: string;
  familyMemberId: string;
  engineVersion: string;
  calculationId: string;
  calculatedAt: string;
  policies: PolicySection[];
  alternativeGroups: { compositionGroupId: string; benefits: ComposedBenefit[]; selectedBenefitCalculationId: string | null }[];
  totalsByCurrency: CurrencyTotal[];
  excludedBenefits: ComposedBenefit[];
  outstandingQuestions: string[];
  disclaimer: string;
};
