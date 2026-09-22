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
 * session's decision packet) or arrived from a caller, so every runtime
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
  | "SOURCE_CALCULATION_NOT_ALLOWED";

/** A reference to an aggregate cap that was evaluated against this benefit,
 * whether or not it ended up binding. `scope` says what the cap applies
 * across; `evidenceRef` cites the wording (or, for a lifetime cap, the
 * user-supplied prior-paid-amount fact) that established the cap amount. */
export type CapReference = {
  scope: "coverage" | "benefit_group" | "policy" | "event" | "lifetime";
  amount: number;
  currency: string;
  evidenceRef: { policyId: string; chunkId: string; pageStart: number; pageEnd: number; label?: string } | { source: "user_reported_prior_paid"; recordedAt: string };
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
      capReferences, deductionReferences, evidenceReferences, status, blockedReasonCodes: reasons,
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
