import { createHash } from "node:crypto";
import { validateMedicalEvidence, validateOwnershipEvidence, validatePolicyEvidence, type DisabilityDefinitionMatch } from "./evidence";
import { evaluateEvidenceAuthority, type EvidenceAuthorityReasonCode } from "../evidence-authority";

/**
 * Pure, deterministic disability-income (periodic monthly replacement
 * income) benefit calculator.
 *
 * This is the only place a disability-income potential amount may be
 * computed. Unlike lib/claims/calculators/disability-benefit.ts's lump-sum
 * TPD/schedule amounts, this benefit is periodic: it pays a verified
 * monthly rate for each whole month of already-CONFIRMED, ongoing
 * disability, after a deferred (elimination) period, up to a maximum
 * benefit period and net of whatever has already been paid for this same
 * disability.
 *
 * The same "never autonomously decide" boundary that governs
 * disability-benefit.ts governs this calculator too: `completedMonthsClaimed`
 * must be a verified, already-elapsed whole-month count -- never a chat
 * estimate of ongoing inability to work -- and this calculator only ever
 * runs once a DisabilityDefinitionMatch has already confirmed (matchKey
 * "disability_income", result "matches") that reviewed medical evidence
 * meets the policy's own disability-income definition. A chat message
 * alone ("I still can't go back to work") can never unlock an amount.
 *
 * All arithmetic runs on integer minor currency units (cents) internally so
 * repeated or large calculations never drift from floating-point rounding.
 */

/** The fixed, calculator-facing DisabilityDefinitionMatch.matchKey a
 * disability-income calculation requires. */
export const DISABILITY_INCOME_MATCH_KEY = "disability_income";

export type DisabilityIncomeEvidenceRef = {
  chunkId?: string;
  policyId?: string;
  pageStart?: number;
  pageEnd?: number;
  label?: string;
};

export type DisabilityIncomeOwnershipRef = { contractId: string; coverageId?: string; label?: string };

export type DisabilityIncomeInput = {
  /** Verified monthly benefit rate, in major currency units. */
  monthlyBenefitAmount: number | null;
  currency: string | null;
  ownership: DisabilityIncomeOwnershipRef | null;
  familyMember: { id: string; confirmed: boolean } | null;
  claimEventId: string | null;
  benefitCode: string;
  /** Whole months of the deferred (elimination/waiting) period before this
   * benefit starts paying. Zero is valid. */
  deferredPeriodMonths: number | null;
  /** Maximum number of months this benefit can ever pay for one disability. */
  maximumBenefitMonths: number | null;
  /** Whole months ALREADY confirmed paid for this same disability under
   * this same benefit -- never inferred or defaulted; missing is treated
   * as zero only when explicitly supplied as 0, never left undefined for a
   * benefit that may have prior payments. */
  monthsAlreadyPaid: number | null;
  /** Whole months of disability actually elapsed and CONFIRMED (never a
   * chat estimate of ongoing incapacity) that are being claimed this turn. */
  completedMonthsClaimed: number | null;
  ownershipEvidence: DisabilityIncomeEvidenceRef | null;
  ruleEvidence: DisabilityIncomeEvidenceRef | null;
  definitionEvidence: DisabilityIncomeEvidenceRef | null;
  definitionMatch: DisabilityDefinitionMatch | null;
  unresolvedConditions?: string[];
};

export type DisabilityIncomeBlockReasonCode =
  | "INVALID_MONTHLY_AMOUNT" | "INVALID_CURRENCY" | "MISSING_OWNERSHIP_MAPPING" | "MISSING_FAMILY_MEMBER"
  | "FAMILY_MEMBER_NOT_CONFIRMED" | "INVALID_DEFERRED_PERIOD" | "MISSING_MAXIMUM_MONTHS" | "INVALID_MONTHS_ALREADY_PAID"
  | "INVALID_COMPLETED_MONTHS" | "MALFORMED_RULE_EVIDENCE" | "MALFORMED_OWNERSHIP_EVIDENCE"
  | "MALFORMED_POLICY_DEFINITION_EVIDENCE" | "MALFORMED_MEDICAL_EVIDENCE" | "UNRESOLVED_CONDITION"
  | "DEFINITION_MATCH_MISSING" | "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH" | "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH"
  | "DEFINITION_MATCH_CONTRACT_MISMATCH" | "DEFINITION_MATCH_COVERAGE_MISMATCH" | "DEFINITION_MATCH_BENEFIT_MISMATCH"
  | "DEFINITION_MATCH_KEY_MISMATCH" | "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH" | "DEFINITION_MATCH_NOT_CONFIRMED"
  | "BENEFIT_PERIOD_EXHAUSTED"
  | EvidenceAuthorityReasonCode;

export type DisabilityIncomeBlocked = { status: "blocked"; reasonCode: DisabilityIncomeBlockReasonCode; message: string };

type DisabilityIncomeComputedFields = {
  currency: string;
  monthlyBenefitAmount: number;
  deferredPeriodMonths: number;
  maximumBenefitMonths: number;
  monthsAlreadyPaid: number;
  completedMonthsClaimed: number;
  payableMonths: number;
  formula: string;
  ruleEvidence: DisabilityIncomeEvidenceRef;
  ownershipEvidence: DisabilityIncomeEvidenceRef;
  definitionEvidence: DisabilityIncomeEvidenceRef;
  ownership: DisabilityIncomeOwnershipRef;
  calculationId: string;
};
export type DisabilityIncomeCalculated = DisabilityIncomeComputedFields & { status: "calculated"; potentialAmount: number };
/** payableMonths resolved to zero (e.g. still within the deferred period,
 * or the benefit period is already exhausted). Never represented as a $0
 * payout -- the benefit simply does not apply yet, or any further. */
export type DisabilityIncomeNotApplicable = DisabilityIncomeComputedFields & { status: "not_applicable"; potentialAmount: null };
export type DisabilityIncomeResult = DisabilityIncomeCalculated | DisabilityIncomeNotApplicable | DisabilityIncomeBlocked;

const ISO_CURRENCY = /^[A-Z]{3}$/;
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}
function normalizeKey(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

export function calculateDisabilityIncome(input: DisabilityIncomeInput): DisabilityIncomeResult {
  if (typeof input.monthlyBenefitAmount !== "number" || !Number.isFinite(input.monthlyBenefitAmount) || input.monthlyBenefitAmount <= 0) {
    return { status: "blocked", reasonCode: "INVALID_MONTHLY_AMOUNT", message: "The verified monthly benefit amount for this benefit is missing or invalid." };
  }
  if (typeof input.currency !== "string" || !ISO_CURRENCY.test(input.currency)) {
    return { status: "blocked", reasonCode: "INVALID_CURRENCY", message: "This benefit does not have a verified ISO currency." };
  }
  if (!input.ownership || !input.ownership.contractId) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_MAPPING", message: "This benefit is not explicitly mapped to an owned policy contract." };
  }
  if (!input.familyMember) {
    return { status: "blocked", reasonCode: "MISSING_FAMILY_MEMBER", message: "The insured family member for this cover has not been identified." };
  }
  if (!input.familyMember.confirmed) {
    return { status: "blocked", reasonCode: "FAMILY_MEMBER_NOT_CONFIRMED", message: "Which family member this cover and this disability belong to still needs confirming." };
  }
  if (!isNonNegativeInteger(input.deferredPeriodMonths)) {
    return { status: "blocked", reasonCode: "INVALID_DEFERRED_PERIOD", message: "The deferred (elimination) period is missing or invalid." };
  }
  if (!isNonNegativeInteger(input.maximumBenefitMonths) || input.maximumBenefitMonths === 0) {
    return { status: "blocked", reasonCode: "MISSING_MAXIMUM_MONTHS", message: "The maximum benefit period for this benefit is missing or invalid." };
  }
  if (!isNonNegativeInteger(input.monthsAlreadyPaid)) {
    return { status: "blocked", reasonCode: "INVALID_MONTHS_ALREADY_PAID", message: "Whether any months have already been paid under this benefit for this disability is still unconfirmed -- DearPolicy never assumes none have." };
  }
  if (!isNonNegativeInteger(input.completedMonthsClaimed)) {
    return { status: "blocked", reasonCode: "INVALID_COMPLETED_MONTHS", message: "The number of whole months of confirmed, already-elapsed disability is missing, negative, or not a verified whole number." };
  }
  const ruleEvidenceCheck = validatePolicyEvidence(input.ruleEvidence, "MALFORMED_RULE_EVIDENCE");
  if (!ruleEvidenceCheck.valid) return { status: "blocked", reasonCode: "MALFORMED_RULE_EVIDENCE", message: ruleEvidenceCheck.message };
  const ownershipEvidenceCheck = validateOwnershipEvidence(input.ownershipEvidence);
  if (!ownershipEvidenceCheck.valid) return { status: "blocked", reasonCode: "MALFORMED_OWNERSHIP_EVIDENCE", message: ownershipEvidenceCheck.message };
  const definitionCheck = validatePolicyEvidence(input.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) return { status: "blocked", reasonCode: "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: definitionCheck.message };
  const definitionEvidence = definitionCheck.evidence;

  // --- Definition-match gate -- see lib/claims/calculators/disability-benefit.ts's
  // own doc comment for the full rationale; identical pattern, scoped to
  // the fixed matchKey DISABILITY_INCOME_MATCH_KEY instead of a TPD/schedule key. ---
  const match = input.definitionMatch;
  if (!match) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_MISSING", message: "No reviewed medical evidence has been matched against this policy's own disability-income definition yet. DearPolicy never decides ongoing incapacity on its own." };
  }
  const expectedFamilyMemberId = input.familyMember.id;
  const expectedContractId = input.ownership.contractId;
  const expectedCoverageId = input.ownership.coverageId;
  if (!match.familyMemberId || match.familyMemberId !== expectedFamilyMemberId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH", message: "The reviewed match belongs to a different family member than the one insured under this cover." };
  }
  if (!match.claimEventId || match.claimEventId !== input.claimEventId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH", message: "The reviewed match belongs to a different claim than the one being assessed." };
  }
  if (!match.contractId || match.contractId !== expectedContractId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_CONTRACT_MISMATCH", message: "A match confirmed for a different policy can never unlock this policy's disability-income benefit." };
  }
  if (match.coverageId != null && match.coverageId !== expectedCoverageId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_COVERAGE_MISMATCH", message: "The reviewed match belongs to a different cover under this policy." };
  }
  if (!match.benefitCode || match.benefitCode !== input.benefitCode) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_BENEFIT_MISMATCH", message: "A match confirmed for a different benefit can never unlock this benefit." };
  }
  if (!match.matchKey || normalizeKey(match.matchKey) !== normalizeKey(DISABILITY_INCOME_MATCH_KEY)) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_KEY_MISMATCH", message: "The reviewed match was not reviewed against this policy's disability-income definition." };
  }
  const matchDefinitionCheck = validatePolicyEvidence(match.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!matchDefinitionCheck.valid) return { status: "blocked", reasonCode: "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: matchDefinitionCheck.message };
  const matchDefinitionEvidence = matchDefinitionCheck.evidence;
  const sameDefinition = matchDefinitionEvidence.policyId === definitionEvidence.policyId
    && matchDefinitionEvidence.chunkId === definitionEvidence.chunkId
    && matchDefinitionEvidence.pageStart === definitionEvidence.pageStart
    && matchDefinitionEvidence.pageEnd === definitionEvidence.pageEnd;
  if (!sameDefinition) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH", message: "The reviewed match was checked against different policy wording than the definition this calculation is using. It can never unlock this calculation." };
  }
  const medicalEvidenceCheck = validateMedicalEvidence(match.medicalEvidence);
  if (!medicalEvidenceCheck.valid) return { status: "blocked", reasonCode: "MALFORMED_MEDICAL_EVIDENCE", message: medicalEvidenceCheck.message };
  const medicalEvidence = medicalEvidenceCheck.evidence;
  if (medicalEvidence.familyMemberId !== expectedFamilyMemberId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH", message: "The reviewed medical evidence was reviewed for a different family member." };
  }
  if (medicalEvidence.claimEventId !== input.claimEventId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH", message: "The reviewed medical evidence was reviewed for a different claim." };
  }
  if (match.result === "does_not_match") {
    return {
      status: "not_applicable", potentialAmount: null, currency: input.currency, monthlyBenefitAmount: input.monthlyBenefitAmount,
      deferredPeriodMonths: input.deferredPeriodMonths, maximumBenefitMonths: input.maximumBenefitMonths,
      monthsAlreadyPaid: input.monthsAlreadyPaid, completedMonthsClaimed: input.completedMonthsClaimed, payableMonths: 0,
      formula: "The reviewed medical evidence does not meet this policy's own disability-income definition.",
      ruleEvidence: input.ruleEvidence!, ownershipEvidence: input.ownershipEvidence!, definitionEvidence: input.definitionEvidence!,
      ownership: input.ownership, calculationId: "di:not-applicable",
    };
  }
  if (match.result !== "matches") {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_NOT_CONFIRMED", message: "The reviewed medical evidence has not been explicitly confirmed to match this policy's own disability-income definition -- it is currently: " + match.result.replace(/_/g, " ") + "." };
  }

  // Checkpoint (Wave 2, D4/D8/D9): see calculateAccidentalDeath()'s
  // identical gate in accidental-death.ts and lib/claims/evidence-authority.ts
  // for the full rationale. Runs after the match is confirmed structurally
  // correct and scoped to this exact calculation, before any arithmetic.
  const authority = evaluateEvidenceAuthority(match.provenance, { expectedSourceDocumentId: medicalEvidence.documentId });
  if (!authority.authorized) {
    return { status: "blocked", reasonCode: authority.reasonCode, message: authority.message };
  }

  if (input.unresolvedConditions?.length) {
    return { status: "blocked", reasonCode: "UNRESOLVED_CONDITION", message: "A required policy condition is still unresolved: " + input.unresolvedConditions[0] };
  }

  const remainingMonths = Math.max(0, input.maximumBenefitMonths - input.monthsAlreadyPaid);
  const monthsPastDeferral = Math.max(0, input.completedMonthsClaimed - input.deferredPeriodMonths);
  const payableMonths = Math.min(remainingMonths, monthsPastDeferral);

  const monthlyMinor = Math.round(input.monthlyBenefitAmount * 100);
  const potentialAmountMinor = payableMonths * monthlyMinor;

  const calculationId = "di:" + createHash("sha256").update(JSON.stringify([
    input.familyMember.id, input.claimEventId ?? null, input.benefitCode, input.currency, monthlyMinor,
    input.deferredPeriodMonths, input.maximumBenefitMonths, input.monthsAlreadyPaid, input.completedMonthsClaimed,
    input.ownership, input.ruleEvidence, input.ownershipEvidence, input.definitionEvidence,
    medicalEvidence.documentId, medicalEvidence.documentType, medicalEvidence.pageStart ?? null, medicalEvidence.pageEnd ?? null,
  ])).digest("hex");

  const common: DisabilityIncomeComputedFields = {
    currency: input.currency, monthlyBenefitAmount: monthlyMinor / 100, deferredPeriodMonths: input.deferredPeriodMonths,
    maximumBenefitMonths: input.maximumBenefitMonths, monthsAlreadyPaid: input.monthsAlreadyPaid, completedMonthsClaimed: input.completedMonthsClaimed,
    payableMonths,
    formula: `payableMonths = min(${input.maximumBenefitMonths} - ${input.monthsAlreadyPaid}, max(0, ${input.completedMonthsClaimed} - ${input.deferredPeriodMonths})) = ${payableMonths}; `
      + `potentialAmount = ${payableMonths} x ${(monthlyMinor / 100).toFixed(2)} ${input.currency} = ${(potentialAmountMinor / 100).toFixed(2)} ${input.currency}`,
    ruleEvidence: input.ruleEvidence!, ownershipEvidence: input.ownershipEvidence!, definitionEvidence: input.definitionEvidence!,
    ownership: input.ownership, calculationId,
  };

  if (remainingMonths === 0) {
    return { status: "not_applicable", potentialAmount: null, ...common, formula: "This benefit's maximum benefit period has already been exhausted by prior payments for this disability. " + common.formula };
  }
  if (payableMonths === 0) {
    return { status: "not_applicable", potentialAmount: null, ...common };
  }
  return { status: "calculated", potentialAmount: potentialAmountMinor / 100, ...common };
}
