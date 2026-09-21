import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimAssessmentItem, ClaimFacts } from "./types";

export type MonetaryBlockReason =
  | "STATUS_NOT_ELIGIBLE"
  | "NO_DETERMINISTIC_AMOUNT"
  | "INVALID_CURRENCY"
  | "UNRESOLVED_COVERAGE_MAPPING"
  | "MISSING_RULE_EVIDENCE"
  | "MISSING_EVENT_DATE";

export type MonetaryDecision =
  | { status: "allowed" }
  | { status: "blocked"; reasonCode: MonetaryBlockReason; message: string };

function relevantEventDate(facts: ClaimFacts) {
  if (facts.eventType === "death") return facts.deathDate ?? facts.eventDate;
  if (facts.eventType === "diagnosis") return facts.diagnosisDate ?? facts.eventDate;
  return facts.eventDate;
}

/**
 * One fail-closed boundary for every claim amount.
 *
 * The language model and claim heuristics may identify potentially relevant
 * benefits, but they cannot make money user-visible. Only a deterministic
 * result tied to a verified owned coverage and explicit rule evidence passes.
 */
export function evaluateMonetaryEligibility(args: {
  item: ClaimAssessmentItem;
  facts: ClaimFacts;
  coverages: OwnedCoverage[];
}): MonetaryDecision {
  const { item, facts, coverages } = args;

  if (!["likely_applicable", "potentially_applicable"].includes(item.status)) {
    return {
      status: "blocked",
      reasonCode: "STATUS_NOT_ELIGIBLE",
      message: "The benefit is not yet eligible for a monetary estimate.",
    };
  }

  if (
    item.calculatedAmount == null ||
    !Number.isFinite(item.calculatedAmount) ||
    item.calculatedAmount < 0
  ) {
    return {
      status: "blocked",
      reasonCode: "NO_DETERMINISTIC_AMOUNT",
      message: "The amount was not produced by a supported deterministic calculation.",
    };
  }

  if (!item.currency || !/^[A-Z]{3}$/.test(item.currency)) {
    return {
      status: "blocked",
      reasonCode: "INVALID_CURRENCY",
      message: "The calculation does not have a verified currency.",
    };
  }

  const coverage = item.coverageId
    ? coverages.find((candidate) => candidate.id === item.coverageId)
    : null;
  if (!coverage || coverage.familyMemberId !== coverages[0]?.familyMemberId) {
    return {
      status: "blocked",
      reasonCode: "UNRESOLVED_COVERAGE_MAPPING",
      message: "The benefit is not explicitly mapped to this family member's verified cover.",
    };
  }

  if (!item.ruleEvidence?.policyId || !item.ruleEvidence.chunkId) {
    return {
      status: "blocked",
      reasonCode: "MISSING_RULE_EVIDENCE",
      message: "The calculation rule is not backed by explicit policy evidence.",
    };
  }

  const eventDate = relevantEventDate(facts);
  const dateFact = facts.eventType === "death"
    ? ["death_date", "event_date"]
    : facts.eventType === "diagnosis"
      ? ["diagnosis_date", "event_date"]
      : ["event_date"];
  if (!eventDate || dateFact.some((fact) => facts.uncertainFacts.includes(fact))) {
    return {
      status: "blocked",
      reasonCode: "MISSING_EVENT_DATE",
      message: "The event date must be confirmed before checking which policy version applies.",
    };
  }

  return { status: "allowed" };
}

/**
 * Removes unsafe monetary output while preserving the benefit and the exact
 * reason it needs review. This function is intentionally idempotent.
 */
export function enforceMonetarySafety(
  items: ClaimAssessmentItem[],
  facts: ClaimFacts,
  coverages: OwnedCoverage[],
): ClaimAssessmentItem[] {
  return items.map((item) => {
    const hasMonetaryOutput =
      item.amountText != null || item.calculatedAmount != null || item.currency != null;
    if (!hasMonetaryOutput) return item;

    const decision = evaluateMonetaryEligibility({ item, facts, coverages });
    if (decision.status === "allowed") {
      return { ...item, monetaryDecision: decision };
    }

    return {
      ...item,
      status: ["likely_applicable", "potentially_applicable"].includes(item.status)
        ? "needs_document"
        : item.status,
      amountText: null,
      calculatedAmount: undefined,
      currency: undefined,
      monetaryDecision: decision,
      reason: `${item.reason} DearPolicy has withheld the amount: ${decision.message}`,
      conditions: [...new Set([...item.conditions, decision.message])],
    };
  });
}
