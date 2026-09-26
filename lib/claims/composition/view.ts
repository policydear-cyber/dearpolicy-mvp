import { formatMoney } from "@/lib/format/currency";
import type { ComposedBenefit, ClaimCompositionResult } from "./types";
import type { ClaimCompositionView, CompositionBenefitView, CompositionPolicyView } from "@/types";

/** Human-readable labels for every ComposedBenefitBlockReasonCode, shown
 * next to (never instead of) the stable reason code -- the code is what
 * downstream logic and support tooling key off, this is what a person
 * reads. Kept in sync with lib/claims/composition/types.ts's
 * ComposedBenefitBlockReasonCode union; an unrecognised code (e.g. from a
 * newer engine version read by an older UI build) still displays
 * something plain rather than crashing or showing nothing. */
const BLOCK_REASON_LABELS: Record<string, string> = {
  UNKNOWN_COMPOSITION: "DearPolicy does not yet recognise how this benefit combines with others, so it is excluded from any total rather than guessed.",
  ALTERNATIVE_NOT_SELECTED: "Policy wording pays only the higher of these alternative benefits; this one was not the higher amount.",
  AMBIGUOUS_ALTERNATIVE_SELECTION: "More than one alternative benefit could apply and DearPolicy cannot determine which one deterministically.",
  DUPLICATE_POLICY_OR_VERSION: "This looks like a duplicate or an earlier version of another policy on file, so it is not counted separately.",
  AMBIGUOUS_POLICY_VERSION: "Two or more versions of this policy could apply on the event date and DearPolicy cannot determine which one deterministically.",
  GROUP_MEMBERSHIP_UNVERIFIED: "Membership in this group cover has not been verified against a personal certificate or schedule.",
  POLICY_NOT_IN_FORCE_AT_EVENT: "This policy's own effective/expiry dates do not cover the claim event date.",
  CURRENCY_MISMATCH: "This benefit is in a different currency and is shown separately rather than combined into another total.",
  CAP_EXCEEDED_FULLY: "An aggregate cap on this policy or event has already been fully used by other benefits.",
  MISSING_PRIOR_PAID_AMOUNT: "The policy wording sets a lifetime maximum, but DearPolicy does not have a reported amount already paid, so this benefit is not calculated.",
  MISSING_EVIDENCE: "DearPolicy does not have the personal coverage evidence needed to calculate this benefit.",
  SOURCE_CALCULATION_NOT_ALLOWED: "This benefit's underlying calculation was not allowed to proceed by DearPolicy's monetary safety checks.",
};

function benefitView(benefit: ComposedBenefit): CompositionBenefitView {
  return {
    benefitCode: benefit.benefitCode,
    benefitCategory: benefit.benefitCategory,
    calculationId: benefit.calculationId,
    currency: benefit.currency,
    rawAmount: benefit.rawAmount,
    payableAmount: benefit.payableAmount,
    // A blocked/excluded/unselected benefit's payableAmount is 0 by
    // construction; rendering that as "S$0" would read as "you get nothing"
    // rather than "not calculated / not counted". Only included benefits get text.
    payableAmountText: benefit.status === "included" ? formatMoney(benefit.payableAmount, benefit.currency) : null,
    compositionType: benefit.compositionType,
    compositionGroupId: benefit.compositionGroupId,
    status: benefit.status,
    blockedReasonCodes: benefit.blockedReasonCodes,
    blockedReasons: benefit.blockedReasonCodes.map((code) => BLOCK_REASON_LABELS[code] ?? "This benefit was excluded from the total."),
    capReferences: benefit.capReferences.map((c) => ({
      scope: c.scope, amount: c.amount, amountText: formatMoney(c.amount, c.currency), currency: c.currency,
      applied: c.applied, amountDeducted: c.amountDeducted, amountDeductedText: formatMoney(c.amountDeducted, c.currency),
      label: "label" in c.evidenceRef ? (c.evidenceRef.label ?? "Aggregate cap") : "Aggregate cap (user-reported prior payment)",
    })),
    deductionReferences: benefit.deductionReferences.map((d) => ({ reason: d.reason, amount: d.amount, amountText: formatMoney(d.amount, benefit.currency) })),
    evidenceReferences: benefit.evidenceReferences,
  };
}

function policyView(section: ClaimCompositionResult["policies"][number]): CompositionPolicyView {
  return {
    policyId: section.policyId,
    policyLabel: section.policyLabel,
    benefits: section.benefits.map(benefitView),
    subtotalsByCurrency: section.subtotalsByCurrency.map((s) => ({ currency: s.currency, amountText: formatMoney(s.includedAmount, s.currency) })),
  };
}

/** Converts a composeClaim() engine result (lib/claims/composition/
 * engine.ts) into the serialisable, display-ready shape the chat UI
 * renders (types/index.ts's ClaimCompositionView). Every amount is
 * formatted here once, server-side, with lib/format/currency.ts's
 * formatMoney() -- the client never re-derives or re-sums a figure from
 * this view; it only displays what is already here. */
export function toClaimCompositionView(result: ClaimCompositionResult): ClaimCompositionView {
  return {
    engineVersion: result.engineVersion,
    calculationId: result.calculationId,
    calculatedAt: result.calculatedAt,
    policies: result.policies.map(policyView),
    alternativeGroups: result.alternativeGroups.map((g) => ({
      compositionGroupId: g.compositionGroupId, benefits: g.benefits.map(benefitView), selectedBenefitCalculationId: g.selectedBenefitCalculationId,
    })),
    totalsByCurrency: result.totalsByCurrency.map((t) => ({ currency: t.currency, amountText: formatMoney(t.includedAmount, t.currency) })),
    excludedBenefits: result.excludedBenefits.map(benefitView),
    outstandingQuestions: result.outstandingQuestions,
    disclaimer: result.disclaimer,
  };
}
