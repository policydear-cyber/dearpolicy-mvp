import { createHash } from "node:crypto";
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimFacts } from "../types";
import { findAggregateCapSignals, findCompositionSignals, type AggregateCapSignal } from "./relationships";
import { resolvePolicyVersions } from "./duplicates";
import {
  type ClaimCompositionResult, type ComposedBenefit, type ComposedBenefitBlockReasonCode,
  type ComposedBenefitInput, type CompositionType, type CurrencyTotal, type DeductionReference, type PolicySection,
  validateComposedBenefit,
} from "./types";

export const COMPOSITION_ENGINE_VERSION = "1.0.0";

type WordingPages = { policy_id: string; page_number: number; text: string }[];

export type ComposeClaimArgs = {
  claimEventId: string;
  familyMemberId: string;
  facts: ClaimFacts;
  coverages: OwnedCoverage[];
  /** Post-monetary-gate assessment items -- only ones with
   * `monetaryDecision.status === "allowed"` and a `calculationId` are ever
   * treated as candidates. Everything else already carries its own
   * blocked/needs_document reason from lib/claims/monetary-gate.ts and
   * lib/claims/rules.ts and is passed through untouched into
   * `excludedBenefits` so the UI can still show why. */
  assessments: ClaimAssessmentItem[];
  /** Wording pages already loaded for this family member's death-benefit
   * evidence resolution (lib/claims/death-evidence.ts's loadDeathEvidence),
   * reused here so composition relationships and caps are read from the
   * exact same evidenced source, never a second unverified fetch. */
  wordingPages: WordingPages;
  now?: Date;
};

function stableId(parts: (string | number | boolean | null | undefined)[]) {
  return "comp:" + createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function benefitCategoryFor(benefitCode: string) {
  return benefitCode === "gpa-accidental-death" ? "Personal Accident" : "Death";
}

function groupCitationPages(wordingPages: WordingPages, policyId: string) {
  return wordingPages.filter((p) => p.policy_id === policyId).map((p) => ({ page_number: p.page_number, text: p.text }));
}

function blockedBenefit(input: ComposedBenefitInput, reasonCodes: ComposedBenefitBlockReasonCode[]): ComposedBenefit {
  return { ...input, capReferences: input.capReferences ?? [], deductionReferences: input.deductionReferences ?? [], payableAmount: 0, status: "blocked", blockedReasonCodes: reasonCodes };
}
function includedBenefit(input: ComposedBenefitInput, payableAmount: number): ComposedBenefit {
  return { ...input, capReferences: input.capReferences ?? [], deductionReferences: input.deductionReferences ?? [], payableAmount: Math.max(0, payableAmount), status: "included", blockedReasonCodes: [] };
}
const OWNERSHIP_DOCUMENT_ROLES = new Set(["certificate", "schedule", "endorsement", "policy_document"]);

/**
 * Deterministically selects, composes, caps and totals a family member's
 * calculated benefits for one claim event. This is the ONLY place in
 * DearPolicy that turns more than one calculated benefit amount into a
 * total -- it never asks a model to add numbers, and every composition
 * decision it makes traces back to either a calculator's own fail-closed
 * result or an evidenced wording citation (lib/claims/composition/
 * relationships.ts). An input this function cannot account for is always
 * excluded from the total, never guessed into it.
 *
 * V1 scope (documented in the PR, not hidden here): only the two benefit
 * codes lib/claims/rules.ts currently wires through a deterministic
 * calculator (`gtl-death`, `gpa-accidental-death`) ever reach this
 * function; composition relationships are only detected WITHIN one
 * policy's own wording (see relationships.ts); aggregate-cap allocation
 * reduces the lowest-priority benefit(s) first rather than a
 * per-benefit-tiered scheme a real claims adjuster might apply -- always
 * safe (never overstates a total) but not necessarily how an insurer would
 * split a shortfall between two benefits.
 */
export function composeClaim(args: ComposeClaimArgs): ClaimCompositionResult {
  const { claimEventId, familyMemberId, facts, coverages, assessments, wordingPages, now = new Date() } = args;
  const coverageById = new Map(coverages.map((c) => [c.id, c]));
  const eventDate = facts.eventType === "death" ? (facts.deathDate ?? facts.eventDate) : facts.eventType === "diagnosis" ? facts.diagnosisDate : facts.eventDate;
  const versionDecisions = resolvePolicyVersions(coverages, eventDate);

  const excludedFromAssessment: ComposedBenefit[] = [];
  const candidates: ComposedBenefit[] = [];

  for (const item of assessments) {
    if (item.calculatedAmount == null || !item.currency || !item.coverageId) continue; // not a monetary claim at all -- nothing to compose
    const coverage = coverageById.get(item.coverageId);
    const base: ComposedBenefitInput = {
      policyId: coverage?.policyId ?? "unknown", contractId: coverage?.policyId ?? "unknown", coverageId: item.coverageId,
      familyMemberId, claimEventId, benefitCode: item.id, benefitCategory: benefitCategoryFor(item.id),
      calculationId: item.calculationId ?? stableId([item.id, item.coverageId, claimEventId, item.calculatedAmount, item.currency]),
      currency: item.currency, rawAmount: item.calculatedAmount, compositionType: "independent_additive", compositionGroupId: null, priority: 0,
      evidenceReferences: item.ruleEvidence ? [{ policyId: item.ruleEvidence.policyId, chunkId: item.ruleEvidence.chunkId, pageStart: item.ruleEvidence.pageStart, pageEnd: item.ruleEvidence.pageEnd, label: item.ruleEvidence.evidenceLabel }] : [],
    };
    if (item.monetaryDecision?.status !== "allowed" || !item.calculationId) {
      excludedFromAssessment.push(blockedBenefit(base, ["SOURCE_CALCULATION_NOT_ALLOWED"]));
      continue;
    }
    if (!coverage) { excludedFromAssessment.push(blockedBenefit(base, ["MISSING_EVIDENCE"])); continue; }
    if (!OWNERSHIP_DOCUMENT_ROLES.has(coverage.documentRole ?? "")) {
      excludedFromAssessment.push(blockedBenefit(base, ["GROUP_MEMBERSHIP_UNVERIFIED"]));
      continue;
    }
    candidates.push(includedBenefit(base, item.calculatedAmount));
  }

  // Point-in-time validity + duplicate/version handling: resolve which
  // policy version (if any) is unambiguously the one in force on the
  // claim-event date, before any two benefits are ever added together.
  const versionFiltered: ComposedBenefit[] = [];
  for (const benefit of candidates) {
    const decision = versionDecisions.get(benefit.policyId);
    if (!decision || decision.status === "in_force") { versionFiltered.push(benefit); continue; }
    if (decision.status === "not_in_force") { excludedFromAssessment.push({ ...benefit, status: "excluded", payableAmount: 0, blockedReasonCodes: ["POLICY_NOT_IN_FORCE_AT_EVENT"] }); continue; }
    excludedFromAssessment.push({ ...benefit, status: "blocked", payableAmount: 0, blockedReasonCodes: [decision.reasonCode] });
  }

  // Group same-policy benefits and apply evidenced relationship signals
  // (alternative / accelerated / additional). Cross-policy benefits default
  // to independent_additive with no further grouping in V1.
  const byPolicy = new Map<string, ComposedBenefit[]>();
  for (const b of versionFiltered) byPolicy.set(b.policyId, [...(byPolicy.get(b.policyId) ?? []), b]);

  const composed: ComposedBenefit[] = [];
  const outstandingQuestions: string[] = [];
  let groupCounter = 0;

  for (const [policyId, benefits] of byPolicy) {
    if (benefits.length < 2) { composed.push(...benefits); continue; }
    const pages = groupCitationPages(wordingPages, policyId);
    const signals = findCompositionSignals(pages);
    const base = benefits.find((b) => b.benefitCode === "gtl-death");
    const other = benefits.find((b) => b.benefitCode !== "gtl-death");
    const alternative = signals.find((s) => s.compositionType === "alternative_highest");
    const accelerated = signals.find((s) => s.compositionType === "accelerated_from_base");
    const additional = signals.find((s) => s.compositionType === "additional_to_base");

    if (alternative && base && other) {
      groupCounter++;
      const groupId = stableId(["alt", policyId, claimEventId, groupCounter]);
      const citation = { policyId, chunkId: `page:${policyId}:${alternative.page}`, pageStart: alternative.page, pageEnd: alternative.pageEnd, label: "Alternative-benefit wording" };
      const selected = base.rawAmount >= other.rawAmount ? base : other;
      const notSelected = selected === base ? other : base;
      composed.push({ ...selected, compositionType: "alternative_highest", compositionGroupId: groupId, evidenceReferences: [...selected.evidenceReferences, citation] });
      composed.push({ ...notSelected, compositionType: "alternative_highest", compositionGroupId: groupId, status: "excluded", payableAmount: 0, blockedReasonCodes: ["ALTERNATIVE_NOT_SELECTED"], evidenceReferences: [...notSelected.evidenceReferences, citation] });
      continue;
    }
    if (accelerated && base && other) {
      const citation = { policyId, chunkId: `page:${policyId}:${accelerated.page}`, pageStart: accelerated.page, pageEnd: accelerated.pageEnd, label: "Accelerated-benefit wording" };
      const reducedBase = Math.max(0, base.rawAmount - other.rawAmount);
      const deduction: DeductionReference = { reason: "accelerated_from_base", amount: base.rawAmount - reducedBase, relatedBenefitCalculationId: other.calculationId };
      composed.push({ ...base, payableAmount: reducedBase, deductionReferences: [...base.deductionReferences, deduction], evidenceReferences: [...base.evidenceReferences, citation] });
      composed.push({ ...other, compositionType: "accelerated_from_base", evidenceReferences: [...other.evidenceReferences, citation] });
      continue;
    }
    if (additional && base && other) {
      const citation = { policyId, chunkId: `page:${policyId}:${additional.page}`, pageStart: additional.page, pageEnd: additional.pageEnd, label: "Additional-benefit wording" };
      composed.push(base);
      composed.push({ ...other, compositionType: "additional_to_base", evidenceReferences: [...other.evidenceReferences, citation] });
      continue;
    }
    // No evidenced relationship at all: independently eligible benefits
    // under one policy default to additive (e.g. a base death benefit and
    // a genuinely separate accidental-death rider).
    composed.push(...benefits);
  }

  // Aggregate caps: policy-scope and event-scope, applied deterministically
  // by reducing the lowest-priority included benefit(s) first. A lifetime
  // cap is only ever applied against an explicit, user-reported prior-paid
  // amount; when wording establishes a lifetime cap but no prior-paid
  // amount fact is on file, the affected benefit is blocked rather than
  // guessed, and a question is queued.
  for (const policyId of byPolicy.keys()) {
    const pages = groupCitationPages(wordingPages, policyId);
    const caps = findAggregateCapSignals(pages);
    for (const cap of caps) applyPolicyOrLifetimeCap(cap, policyId, composed, facts, outstandingQuestions);
  }
  applyEventScopeCaps(wordingPages, byPolicy, composed);

  const excludedBenefits = [...excludedFromAssessment, ...composed.filter((b) => b.status !== "included")];
  const included = composed.filter((b) => b.status === "included");

  const policySections: PolicySection[] = [...byPolicy.keys()].map((policyId) => {
    const benefits = composed.filter((b) => b.policyId === policyId);
    const currencies = [...new Set(benefits.map((b) => b.currency))];
    return {
      policyId,
      policyLabel: coverages.find((c) => c.policyId === policyId)?.policyName ?? coverages.find((c) => c.policyId === policyId)?.productName ?? "Policy",
      benefits,
      subtotalsByCurrency: currencies.map((currency) => ({ currency, includedAmount: benefits.filter((b) => b.status === "included" && b.currency === currency).reduce((sum, b) => sum + b.payableAmount, 0) })),
    };
  });
  // Excluded-from-assessment benefits belong to a policy too (even though
  // they never reached the per-policy grouping map above) -- fold their
  // policy sections in so nothing calculated silently disappears from the
  // per-policy breakdown.
  for (const b of excludedFromAssessment) {
    if (!policySections.some((s) => s.policyId === b.policyId)) {
      policySections.push({ policyId: b.policyId, policyLabel: coverages.find((c) => c.policyId === b.policyId)?.policyName ?? coverages.find((c) => c.policyId === b.policyId)?.productName ?? "Policy", benefits: [b], subtotalsByCurrency: [] });
    } else {
      const section = policySections.find((s) => s.policyId === b.policyId)!;
      if (!section.benefits.some((x) => x.calculationId === b.calculationId)) section.benefits.push(b);
    }
  }

  const currenciesInPlay = [...new Set(included.map((b) => b.currency))];
  const totalsByCurrency: CurrencyTotal[] = currenciesInPlay.map((currency) => ({ currency, includedAmount: included.filter((b) => b.currency === currency).reduce((sum, b) => sum + b.payableAmount, 0) }));

  const alternativeGroupIds = [...new Set(composed.filter((b) => b.compositionType === "alternative_highest" && b.compositionGroupId).map((b) => b.compositionGroupId!))];
  const alternativeGroups = alternativeGroupIds.map((groupId) => {
    const benefits = composed.filter((b) => b.compositionGroupId === groupId);
    const selected = benefits.find((b) => b.status === "included");
    return { compositionGroupId: groupId, benefits, selectedBenefitCalculationId: selected?.calculationId ?? null };
  });

  const allBenefitsForId = [...policySections.flatMap((s) => s.benefits)].sort((a, b) => a.calculationId.localeCompare(b.calculationId));
  const calculationId = stableId([
    COMPOSITION_ENGINE_VERSION, claimEventId, familyMemberId,
    ...allBenefitsForId.map((b) => [
      b.calculationId, b.compositionType, b.compositionGroupId, b.status, b.payableAmount, b.currency,
      ...b.blockedReasonCodes.slice().sort(), ...b.capReferences.map((c) => [c.scope, c.amount, c.currency, c.applied, c.amountDeducted]),
    ]),
  ]);

  return {
    claimEventId, familyMemberId, engineVersion: COMPOSITION_ENGINE_VERSION, calculationId, calculatedAt: now.toISOString(),
    policies: policySections, alternativeGroups, totalsByCurrency, excludedBenefits,
    outstandingQuestions: [...new Set(outstandingQuestions)],
    disclaimer: "This is a potential, policy-based estimate, not a guarantee of payment. It is based on the documents and facts currently available and remains subject to the insurer's assessment.",
  };
}

function applyPolicyOrLifetimeCap(cap: AggregateCapSignal, policyId: string, composed: ComposedBenefit[], facts: ClaimFacts, outstandingQuestions: string[]) {
  if (cap.scope === "event") return; // handled separately, across all policies
  const inPolicy = composed.filter((b) => b.policyId === policyId && b.status === "included" && b.currency === cap.currency);
  if (inPolicy.length === 0) return;
  const evidenceRef = { policyId, chunkId: `page:${policyId}:${cap.page}`, pageStart: cap.page, pageEnd: cap.pageEnd, label: cap.scope === "lifetime" ? "Lifetime aggregate cap wording" : "Aggregate cap wording" };

  let effectiveCapAmount = cap.amount;
  if (cap.scope === "lifetime") {
    const priorPaid = facts.priorPaidAmounts?.[policyId];
    if (!priorPaid || priorPaid.currency !== cap.currency) {
      // Wording establishes a lifetime cap, but DearPolicy has no
      // user-reported prior-paid amount to know remaining capacity --
      // never guess it is fully available. Block every candidate benefit
      // in this currency for this policy and ask, rather than silently
      // treating the whole lifetime cap as unused.
      for (const b of inPolicy) {
        b.status = "blocked"; b.payableAmount = 0;
        if (!b.blockedReasonCodes.includes("MISSING_PRIOR_PAID_AMOUNT")) b.blockedReasonCodes.push("MISSING_PRIOR_PAID_AMOUNT");
        b.capReferences.push({ scope: "lifetime", amount: cap.amount, currency: cap.currency, evidenceRef, applied: false, amountDeducted: 0 });
      }
      outstandingQuestions.push("Has any amount already been paid under this cover's lifetime benefit maximum? If so, how much, and when?");
      return;
    }
    effectiveCapAmount = Math.max(0, cap.amount - priorPaid.amount);
  }

  const total = inPolicy.reduce((sum, b) => sum + b.payableAmount, 0);
  if (total <= effectiveCapAmount) {
    for (const b of inPolicy) b.capReferences.push({ scope: cap.scope, amount: effectiveCapAmount, currency: cap.currency, evidenceRef, applied: false, amountDeducted: 0 });
    return;
  }
  let excess = total - effectiveCapAmount;
  const ordered = [...inPolicy].sort((a, b) => a.priority - b.priority);
  for (const b of ordered) {
    if (excess <= 0) { b.capReferences.push({ scope: cap.scope, amount: effectiveCapAmount, currency: cap.currency, evidenceRef, applied: false, amountDeducted: 0 }); continue; }
    const deducted = Math.min(b.payableAmount, excess);
    b.payableAmount -= deducted;
    excess -= deducted;
    b.capReferences.push({ scope: cap.scope, amount: effectiveCapAmount, currency: cap.currency, evidenceRef, applied: deducted > 0, amountDeducted: deducted });
    if (deducted > 0) b.deductionReferences.push({ reason: "aggregate_cap", amount: deducted, capReference: b.capReferences.at(-1) });
  }
}

function applyEventScopeCaps(wordingPages: WordingPages, byPolicy: Map<string, ComposedBenefit[]>, composed: ComposedBenefit[]) {
  const eventCaps: { cap: AggregateCapSignal; policyId: string }[] = [];
  for (const policyId of byPolicy.keys()) {
    const pages = groupCitationPages(wordingPages, policyId);
    for (const cap of findAggregateCapSignals(pages)) if (cap.scope === "event") eventCaps.push({ cap, policyId });
  }
  for (const { cap, policyId } of eventCaps) {
    const included = composed.filter((b) => b.status === "included" && b.currency === cap.currency);
    if (included.length === 0) continue;
    const total = included.reduce((sum, b) => sum + b.payableAmount, 0);
    const evidenceRef = { policyId, chunkId: `page:${policyId}:${cap.page}`, pageStart: cap.page, pageEnd: cap.pageEnd, label: "Shared event-cap wording" };
    if (total <= cap.amount) { for (const b of included) b.capReferences.push({ scope: "event", amount: cap.amount, currency: cap.currency, evidenceRef, applied: false, amountDeducted: 0 }); continue; }
    let excess = total - cap.amount;
    const ordered = [...included].sort((a, b) => a.priority - b.priority);
    for (const b of ordered) {
      if (excess <= 0) { b.capReferences.push({ scope: "event", amount: cap.amount, currency: cap.currency, evidenceRef, applied: false, amountDeducted: 0 }); continue; }
      const deducted = Math.min(b.payableAmount, excess);
      b.payableAmount -= deducted;
      excess -= deducted;
      b.capReferences.push({ scope: "event", amount: cap.amount, currency: cap.currency, evidenceRef, applied: deducted > 0, amountDeducted: deducted });
      if (deducted > 0) b.deductionReferences.push({ reason: "aggregate_cap", amount: deducted, capReference: b.capReferences.at(-1) });
    }
  }
}

export { validateComposedBenefit };
export type { ComposedBenefit, ClaimCompositionResult, CompositionType };
