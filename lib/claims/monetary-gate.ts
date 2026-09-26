import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimItem } from "@/types";
import type { ClaimAssessmentItem, ClaimFacts } from "./types";
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { evaluateAggregateEvidenceAuthority, type EvidenceAuthorityReasonCode } from "./evidence-authority";
import { statedCurrency } from "./currency-evidence";

export type MonetaryBlockReason =
  | "STATUS_NOT_ELIGIBLE"
  | "NO_DETERMINISTIC_AMOUNT"
  | "INVALID_CURRENCY"
  | "UNRESOLVED_COVERAGE_MAPPING"
  | "MISSING_RULE_EVIDENCE"
  | "MISSING_EVENT_DATE"
  | EvidenceAuthorityReasonCode;

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

  // Cross-product currency choke point (lib/claims/currency-evidence.ts). A
  // figure's currency must come from policy evidence: the cover's own
  // verified currency, or -- for a benefit whose amount the wording quotes --
  // the currency written in that quoted clause. A stored or defaulted currency
  // is never enough, and a figure is never relabelled into another currency.
  const coverageCurrency = coverage.currencyVerified === true ? (coverage.currency ?? "").trim().toUpperCase() : null;
  const currencyFromWording = item.currencyEvidence?.benefitCurrency === item.currency
    || item.evidenceTerms.some((term) => statedCurrency(term) === item.currency);
  if (coverageCurrency ? item.currency !== coverageCurrency : !currencyFromWording) {
    return {
      status: "blocked",
      reasonCode: "INVALID_CURRENCY",
      message: "The calculation's currency is not verified from the policy evidence.",
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

  // Checkpoint (Wave 2, D4/D8/D9): defense-in-depth re-check of whatever
  // AI-derived evidence produced this item's amount, independent of
  // whatever check the calculator that built it already performed (see
  // lib/claims/evidence-authority.ts and that field's own doc comment on
  // ClaimAssessmentItem in lib/claims/types.ts). Absent evidenceProvenance
  // is NOT itself a block here -- plenty of allowed items (e.g. a plain
  // death benefit resting only on policy-wording rule evidence) never
  // carry governed AI-derived evidence at all, and validateCompatibility()/
  // checkStaleness() have nothing to say about them. When evidenceProvenance
  // IS present, though, every entry must independently authorize.
  if (item.evidenceProvenance && item.evidenceProvenance.length > 0) {
    const authority = evaluateAggregateEvidenceAuthority(item.evidenceProvenance);
    if (!authority.authorized) {
      return { status: "blocked", reasonCode: authority.reasonCode, message: authority.message };
    }
  }

  return { status: "allowed" };
}

/** Checkpoint 14b: production telemetry for the ONE chokepoint every
 * calculator's output (accidental-death.ts, critical-illness.ts,
 * death-benefit.ts, disability-benefit.ts, disability-income.ts,
 * hospital-cash.ts, medical-reimbursement.ts, evidence.ts) passes
 * through before a monetary figure is allowed to become user-visible.
 * Fire-and-forget (never awaited by its caller) and failure-isolated --
 * recordEvent() itself guarantees telemetry can never fail or slow down
 * a real claim assessment. Never constructs a raw payload by hand: only
 * structural fields (counts, reason codes, pseudonymized refs) ever
 * reach recordEvent(), which still runs everything through redactDeep()
 * regardless. */
function recordMonetaryGateEvent(args: {
  name: string;
  correlationId?: string;
  householdId?: string;
  resourceId?: string;
  blockedReasonCodes: string[];
  totalItems: number;
}) {
  const blockedCount = args.blockedReasonCodes.length;
  void recordEvent({
    name: args.name,
    correlationId: resolveCorrelationId(args.correlationId),
    status: blockedCount > 0 ? "failure" : "success",
    errorCategory: blockedCount > 0 ? "calculation" : null,
    householdRef: args.householdId ? pseudonymizeId(args.householdId) : null,
    resourceRef: args.resourceId ? pseudonymizeId(args.resourceId) : null,
    monetaryGateReason: blockedCount > 0 ? args.blockedReasonCodes[0] : null,
    extra: { totalItems: args.totalItems, blockedCount, blockedReasonCodes: args.blockedReasonCodes },
  });
}

/**
 * Removes unsafe monetary output while preserving the benefit and the exact
 * reason it needs review. This function is intentionally idempotent.
 */
export function enforceMonetarySafety(
  items: ClaimAssessmentItem[],
  facts: ClaimFacts,
  coverages: OwnedCoverage[],
  context: { correlationId?: string; householdId?: string; resourceId?: string } = {},
): ClaimAssessmentItem[] {
  const blockedReasonCodes: string[] = [];
  let totalGated = 0;
  const result = items.map((item) => {
    const hasMonetaryOutput =
      item.amountText != null || item.calculatedAmount != null || item.currency != null;
    if (!hasMonetaryOutput) return item;
    totalGated++;

    const decision = evaluateMonetaryEligibility({ item, facts, coverages });
    if (decision.status === "allowed") {
      return { ...item, monetaryDecision: decision };
    }
    blockedReasonCodes.push(decision.reasonCode);

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
  if (totalGated > 0) {
    recordMonetaryGateEvent({ name: "claims.calculator.monetary_gate", ...context, blockedReasonCodes, totalItems: totalGated });
  }
  return result;
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

export function enforceChatMonetarySafety(
  items: ClaimItem[],
  context: { correlationId?: string; householdId?: string; resourceId?: string } = {},
): ClaimItem[] {
  const blockedReasonCodes: string[] = [];
  let totalGated = 0;
  const result = items.map((item) => {
    // This gate polices a COMPUTED claim figure -- one this code actually
    // calculated and is asserting as a potential payout. Several call sites
    // set `amountText` to plain descriptive prose with no `calculatedAmount`
    // at all: the benefit's own stated rule when no personal fact is known
    // yet (describeBenefitFormula), a verified cover amount shown because
    // the payout formula could not be confirmed (the ownershipOnly branch of
    // assessmentFromBenefit), or "the actual cost, up to S$500" for a
    // what-if (describePays). None of those claim to be a calculated
    // amount, so gating them on "was a deterministic calculation performed"
    // strips already-qualified informational text that was never subject to
    // this invariant in the first place.
    const hasMonetaryOutput = item.calculatedAmount != null;
    if (!hasMonetaryOutput) return item;
    totalGated++;
    const decision = evaluateChatMonetaryEligibility(item);
    if (decision.status === "allowed") return item;
    blockedReasonCodes.push(decision.reasonCode);
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
  if (totalGated > 0) {
    recordMonetaryGateEvent({ name: "chat.calculator.monetary_gate", ...context, blockedReasonCodes, totalItems: totalGated });
  }
  return result;
}
