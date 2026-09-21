import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimItem } from "@/types";
import type { ClaimItem } from "@/types";
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
  if (!coverage) {
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


const unresolvedCondition = (condition: string) =>
  condition.startsWith("Still needed:") ||
  condition.includes("could not check whether this benefit responds") ||
  condition.includes("has not been double-checked") ||
  condition.startsWith("Not yet verified") ||
  condition.startsWith("Assumes the standard");

/**
 * Safety boundary for the contextual chat workflow.
 *
 * Chat extraction may propose a calculation, but only application code can
 * make the amount visible. A live amount needs a deterministic calculation,
 * an owned contract mapping, a confirmed evidence basis and no unresolved
 * material fact. Cards that fail remain useful, but lose their dollar figure.
 */
export function evaluateChatMonetaryEligibility(item: ClaimItem): MonetaryDecision {
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
    item.calculatedAmount < 0 ||
    !item.calculationId ||
    !item.calculationKind
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
  if (!item.contractId || !item.coverKey) {
    return {
      status: "blocked",
      reasonCode: "UNRESOLVED_COVERAGE_MAPPING",
      message: "The benefit is not explicitly mapped to an owned policy contract.",
    };
  }
  if (item.estimateBasis !== "confirmed") {
    return {
      status: "blocked",
      reasonCode: "MISSING_RULE_EVIDENCE",
      message: "The payout rule or personal cover amount has not been fully verified.",
    };
  }
  if (item.conditions.some(unresolvedCondition)) {
    return {
      status: "blocked",
      reasonCode: "MISSING_RULE_EVIDENCE",
      message: "A material fact or policy condition is still unresolved.",
    };
  }
  return { status: "allowed" };
}

export function enforceChatMonetarySafety(items: ClaimItem[]): ClaimItem[] {
  return items.map((item) => {
    const hasMonetaryOutput =
      item.amountText != null || item.calculatedAmount != null || item.currency != null;
    if (!hasMonetaryOutput) return item;
    const decision = evaluateChatMonetaryEligibility(item);
    if (decision.status === "allowed") return item;
    return {
      ...item,
      status: ["likely_applicable", "potentially_applicable"].includes(item.status)
        ? "needs_document"
        : item.status,
      amountText: null,
      amountLabel: undefined,
      calculatedAmount: undefined,
      currency: undefined,
      aggregation: undefined,
      reason: item.reason.includes("DearPolicy has withheld the amount:")
        ? item.reason
        : `${item.reason} DearPolicy has withheld the amount: ${decision.message}`,
      conditions: [...new Set([...item.conditions, decision.message])],
    };
  });
}
