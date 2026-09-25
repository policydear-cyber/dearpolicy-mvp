import { createHash } from "node:crypto";
import { validateMedicalEvidence, validateOwnershipEvidence, validatePolicyEvidence, type DisabilityDefinitionMatch, type ValidPolicyEvidenceRef } from "./evidence";
import { evaluateEvidenceAuthority, type EvidenceAuthorityReasonCode } from "../evidence-authority";

/**
 * Pure, deterministic Total & Permanent Disability (TPD) and permanent
 * partial disability / dismemberment ("schedule of injuries") benefit
 * calculator.
 *
 * This is the only place a TPD or schedule-of-injuries lump-sum amount may
 * be computed. It follows exactly the same shape as
 * lib/claims/calculators/critical-illness.ts: every input is
 * already-verified and structured (never LLM prose), every branch fails
 * closed, and nothing here decides that a disability occurred, that it is
 * PERMANENT, or that a reported injury matches a named schedule row --
 * the caller supplies those only as an already-reviewed, already-confirmed
 * DisabilityDefinitionMatch (see ./evidence.ts). A chat message alone ("the
 * doctor says I'll never walk again", "I lost my arm") can never unlock an
 * amount, however it is phrased or however medically plausible it sounds.
 *
 * TWO SAFETY BOUNDARIES ARE STRUCTURAL, NOT ADVISORY, IN THIS FUNCTION:
 *
 *  1. "Never autonomously decide permanent disability": a TPD amount is
 *     unlocked ONLY by an already-reviewed DisabilityDefinitionMatch whose
 *     `matchKey` equals the fixed sentinel TOTAL_PERMANENT_DISABILITY_MATCH_KEY
 *     and whose `result` is exactly "matches" -- i.e. a human reviewer (or a
 *     deterministic rule standing in for one) has already checked reviewed
 *     medical evidence against this policy's own TPD definition and
 *     confirmed it. This function never inspects a diagnosis, an injury
 *     description, or any other clinical detail to reach that conclusion
 *     itself -- exactly how calculateCriticalIllness() never decides a
 *     diagnosis meets a policy's illness definition on its own.
 *
 *  2. "Strict injury-schedule matching": a permanent-partial-disability /
 *     dismemberment amount from a schedule of injuries is unlocked ONLY
 *     when the caller's own `scheduleRowCode` (the exact schedule row this
 *     calculation is FOR) is byte-for-byte identical (after trim/case-fold)
 *     to both the formula's own `scheduleRowCode` and the definition
 *     match's `matchKey`. There is no fuzzy, partial, substring or
 *     similarity comparison anywhere in this function between an injury
 *     description and a schedule row -- that comparison, if it is ever
 *     needed, belongs entirely to the human/deterministic review step that
 *     produces the DisabilityDefinitionMatch in the first place, never to
 *     this calculator.
 *
 * TPD and a schedule-of-injuries benefit for the SAME disability are
 * frequently mutually exclusive under a policy's own wording (a specific
 * disability is not compensated twice, once under the schedule and again
 * under TPD). This calculator deliberately does NOT decide that -- exactly
 * like calculateCriticalIllness() never combines more than one benefit,
 * the only place that ever resolves a cross-benefit relationship between a
 * TPD amount and a schedule amount is lib/claims/composition/engine.ts's
 * composeClaim(). This calculator's job stops at "what is this one benefit
 * worth, on its own, assuming it is included."
 *
 * All arithmetic runs on integer minor currency units (cents) internally so
 * repeated or large calculations never drift from floating-point rounding.
 */

export { stableId } from "./death-benefit";

/** The fixed, calculator-facing DisabilityDefinitionMatch.matchKey a TPD
 * calculation requires -- see this module's own doc comment, boundary 1. */
export const TOTAL_PERMANENT_DISABILITY_MATCH_KEY = "total_permanent_disability";

export type DisabilityEvidenceRef = {
  chunkId?: string;
  policyId?: string;
  pageStart?: number;
  pageEnd?: number;
  label?: string;
  coverageId?: string;
  familyMemberId?: string;
};

export type DisabilityOwnershipRef = { contractId: string; coverageId?: string; label?: string };

/** A fixed benefit amount, independent of the sum insured. Valid for
 * benefitKind "tpd" only -- see BENEFIT_KIND_FORMULA_MISMATCH below. */
export type DisabilityFixedFormula = { kind: "fixed"; amount: number; evidence: DisabilityEvidenceRef };
/** A fraction of the verified sum insured -- 1 = 100%, 1.5 = 150%. Valid
 * for benefitKind "tpd" only. */
export type DisabilitySumInsuredFormula = { kind: "sum_insured_fraction"; fraction: number; evidence: DisabilityEvidenceRef };
/** A fixed percentage of the sum insured for ONE exact, evidenced schedule
 * row (e.g. "Loss of one limb -- 100%", "Fractured leg with established
 * non-union -- 20%"). `scheduleRowCode` must equal, after trim/case-fold,
 * both the DisabilityBenefitInput's own `scheduleRowCode` and the
 * DisabilityDefinitionMatch's `matchKey` -- see this module's boundary 2.
 * Valid for benefitKind "schedule" only. */
export type DisabilityScheduleFormula = { kind: "schedule_percentage"; scheduleRowCode: string; fraction: number; evidence: DisabilityEvidenceRef };
export type DisabilityFormula = DisabilityFixedFormula | DisabilitySumInsuredFormula | DisabilityScheduleFormula;

export type DisabilityCap = { amount: number; evidence: DisabilityEvidenceRef } | null;

export type DisabilityWaitingPeriod = {
  /** Whole days from the cover's effective date (or reinstatement date,
   * whichever the wording specifies) during which this benefit does not
   * respond. */
  days: number;
  fromDate: string | null;
  evidence: DisabilityEvidenceRef;
};

/** A circumstance the POLICY itself carves out -- same shape and rationale
 * as CIExclusion. `applies` is `null` (blocks) unless reviewed evidence has
 * explicitly established it one way or the other. */
export type DisabilityExclusion = { key: string; evidence: DisabilityEvidenceRef; applies: boolean | null };

export type DisabilityBenefitKind = "tpd" | "schedule";

export type DisabilityBenefitInput = {
  /** "tpd" for a Total & Permanent Disability lump sum; "schedule" for a
   * permanent-partial-disability/dismemberment amount paid from one exact
   * row of the policy's own schedule of injuries. */
  benefitKind: DisabilityBenefitKind;
  ownership: DisabilityOwnershipRef | null;
  familyMember: { id: string; confirmed: boolean } | null;
  claimEventId: string | null;
  /** The exact calculator-facing benefit code this calculation is for --
   * must equal the DisabilityDefinitionMatch's own `benefitCode` field. */
  benefitCode: string;
  /** Required, and used verbatim (trim/case-fold only, never fuzzy), when
   * benefitKind is "schedule" -- the exact schedule row this calculation is
   * FOR. Ignored (must be null) when benefitKind is "tpd". */
  scheduleRowCode: string | null;
  /** ISO date the disability/injury is dated from (the injury date, or the
   * date a treating doctor confirms permanence, per the policy's own
   * wording). Required. */
  disabilityDate: string | null;
  policyEffectiveDate?: string | null;
  reinstatementDate?: string | null;
  sumInsured: number | null;
  currency: string | null;
  formula: DisabilityFormula | null;
  cap?: DisabilityCap;
  ruleEvidence: DisabilityEvidenceRef | null;
  ownershipEvidence: DisabilityEvidenceRef | null;
  /** Where the policy defines THIS benefit (the TPD clause, or the
   * schedule-of-injuries table) -- distinct from ruleEvidence exactly as in
   * critical-illness.ts. */
  definitionEvidence: DisabilityEvidenceRef | null;
  /** The one applicable, already-reviewed match confirming this exact
   * benefit against this exact policy's own definition, or `null` when none
   * has been reviewed yet. See this module's own doc comment, boundaries 1
   * and 2 -- every field is independently re-validated below. */
  definitionMatch: DisabilityDefinitionMatch | null;
  waitingPeriod?: DisabilityWaitingPeriod | null;
  exclusions?: DisabilityExclusion[];
  unresolvedConditions?: string[];
};

export type DisabilityBlockReasonCode =
  | "MISSING_OWNERSHIP_MAPPING" | "MISSING_FAMILY_MEMBER" | "FAMILY_MEMBER_NOT_CONFIRMED"
  | "MISSING_DISABILITY_DATE" | "MISSING_SUM_INSURED" | "INVALID_SUM_INSURED" | "IMPLAUSIBLE_SUM_INSURED"
  | "MISSING_FORMULA" | "BENEFIT_KIND_FORMULA_MISMATCH" | "INVALID_FORMULA_FRACTION" | "IMPLAUSIBLE_FORMULA_FRACTION"
  | "INVALID_FIXED_AMOUNT" | "INVALID_CAP" | "INVALID_CURRENCY" | "MALFORMED_RULE_EVIDENCE" | "MALFORMED_OWNERSHIP_EVIDENCE"
  | "MALFORMED_POLICY_DEFINITION_EVIDENCE" | "MALFORMED_MEDICAL_EVIDENCE" | "UNRESOLVED_CONDITION"
  | "MISSING_SCHEDULE_ROW_CODE" | "UNEXPECTED_SCHEDULE_ROW_CODE" | "SCHEDULE_ROW_MISMATCH"
  | "DEFINITION_MATCH_MISSING" | "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH" | "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH"
  | "DEFINITION_MATCH_CONTRACT_MISMATCH" | "DEFINITION_MATCH_COVERAGE_MISMATCH" | "DEFINITION_MATCH_BENEFIT_MISMATCH"
  | "DEFINITION_MATCH_KEY_MISMATCH" | "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH" | "DEFINITION_MATCH_NOT_CONFIRMED"
  | "WAITING_PERIOD_NOT_ESTABLISHED" | "WAITING_PERIOD_NOT_MET" | "UNRESOLVED_EXCLUSION" | "INVALID_EXCLUSION_EVIDENCE"
  | EvidenceAuthorityReasonCode;

export type DisabilityBlocked = { status: "blocked"; reasonCode: DisabilityBlockReasonCode; message: string };
export type DisabilityNotApplicable = { status: "not_applicable"; potentialAmount: null; reason: string };
export type DisabilityCalculated = {
  status: "calculated";
  potentialAmount: number;
  currency: string;
  formulaBasis: string;
  ruleEvidence: DisabilityEvidenceRef;
  ownershipEvidence: DisabilityEvidenceRef;
  definitionEvidence: DisabilityEvidenceRef;
  ownership: DisabilityOwnershipRef;
  capApplied: boolean;
  calculationId: string;
};
export type DisabilityResult = DisabilityCalculated | DisabilityNotApplicable | DisabilityBlocked;

const ISO_CURRENCY = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PLAUSIBLE_FRACTION = 10;
const MAX_PLAUSIBLE_AMOUNT = 100_000_000;

function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function toMinorUnits(amount: number): number { return Math.round(amount * 100); }
function validIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}
function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}
/** Strict, non-fuzzy identity comparison -- trim + case-fold only, exactly
 * critical-illness.ts's normalizeStage(). Never a substring, token-overlap
 * or similarity comparison: see this module's boundary 2. */
function normalizeKey(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

function stableIdHash(parts: (string | number | boolean | null | undefined)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function calculateDisabilityBenefit(input: DisabilityBenefitInput): DisabilityResult {
  if (!input.ownership || !input.ownership.contractId) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_MAPPING", message: "This benefit is not explicitly mapped to an owned policy contract." };
  }
  if (!input.familyMember) {
    return { status: "blocked", reasonCode: "MISSING_FAMILY_MEMBER", message: "The insured family member for this cover has not been identified." };
  }
  if (!input.familyMember.confirmed) {
    return { status: "blocked", reasonCode: "FAMILY_MEMBER_NOT_CONFIRMED", message: "Which family member this cover and this disability belong to still needs confirming." };
  }
  if (!validIsoDate(input.disabilityDate)) {
    return { status: "blocked", reasonCode: "MISSING_DISABILITY_DATE", message: "The disability date is missing or not a valid date." };
  }
  if (typeof input.currency !== "string" || !ISO_CURRENCY.test(input.currency)) {
    return { status: "blocked", reasonCode: "INVALID_CURRENCY", message: "This benefit does not have a verified ISO currency." };
  }
  if (!input.formula) {
    return { status: "blocked", reasonCode: "MISSING_FORMULA", message: "No verified payout formula is available for this benefit." };
  }
  if (input.benefitKind === "tpd" && input.formula.kind === "schedule_percentage") {
    return { status: "blocked", reasonCode: "BENEFIT_KIND_FORMULA_MISMATCH", message: "A schedule-of-injuries formula cannot be used to calculate a Total & Permanent Disability benefit." };
  }
  if (input.benefitKind === "schedule" && input.formula.kind !== "schedule_percentage") {
    return { status: "blocked", reasonCode: "BENEFIT_KIND_FORMULA_MISMATCH", message: "A permanent-partial-disability/dismemberment benefit can only be calculated from an explicit, evidenced schedule-of-injuries row." };
  }

  // --- Boundary 2 (strict injury-schedule matching), part one: the
  // caller's own scheduleRowCode must be present for "schedule" and absent
  // for "tpd", and must already agree with the formula's own row code. ---
  if (input.benefitKind === "schedule") {
    if (typeof input.scheduleRowCode !== "string" || !input.scheduleRowCode.trim()) {
      return { status: "blocked", reasonCode: "MISSING_SCHEDULE_ROW_CODE", message: "No exact schedule-of-injuries row code was supplied for this calculation." };
    }
    const formulaRowCode = (input.formula as DisabilityScheduleFormula).scheduleRowCode;
    if (typeof formulaRowCode !== "string" || normalizeKey(formulaRowCode) !== normalizeKey(input.scheduleRowCode)) {
      return { status: "blocked", reasonCode: "SCHEDULE_ROW_MISMATCH", message: "The evidenced schedule formula is for a different schedule row than the one this calculation was asked to price." };
    }
  } else if (input.scheduleRowCode != null) {
    return { status: "blocked", reasonCode: "UNEXPECTED_SCHEDULE_ROW_CODE", message: "A schedule row code was supplied for a Total & Permanent Disability calculation, which has no schedule row." };
  }

  const ruleEvidenceCheck = validatePolicyEvidence(input.ruleEvidence, "MALFORMED_RULE_EVIDENCE");
  if (!ruleEvidenceCheck.valid) return { status: "blocked", reasonCode: ruleEvidenceCheck.reasonCode as "MALFORMED_RULE_EVIDENCE", message: ruleEvidenceCheck.message };
  const ownershipEvidenceCheck = validateOwnershipEvidence(input.ownershipEvidence);
  if (!ownershipEvidenceCheck.valid) return { status: "blocked", reasonCode: ownershipEvidenceCheck.reasonCode as "MALFORMED_OWNERSHIP_EVIDENCE", message: ownershipEvidenceCheck.message };
  const definitionCheck = validatePolicyEvidence(input.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) {
    // validatePolicyEvidence was called with the "MALFORMED_POLICY_DEFINITION_EVIDENCE"
    // override above, so every failure branch inside it returns exactly that
    // literal -- narrows the function's general EvidenceBlockReasonCode
    // return type back to this calculator's own DisabilityBlockReasonCode,
    // the same pattern used throughout lib/claims/calculators/*.ts.
    return { status: "blocked", reasonCode: definitionCheck.reasonCode as "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: definitionCheck.message };
  }
  const definitionEvidence = definitionCheck.evidence;

  // --- The definition-match gate. This is where boundaries 1 and 2 are
  // actually enforced -- see this module's own doc comment. It runs before
  // any arithmetic and independently re-validates every field; a caller's
  // own "this looked like the right match" filtering is never trusted
  // alone. Identical pattern to calculateCriticalIllness(). ---
  const match = input.definitionMatch;
  if (!match) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_MISSING", message: input.benefitKind === "tpd"
      ? "No reviewed medical evidence has been matched against this policy's own Total & Permanent Disability definition yet. DearPolicy never decides permanence on its own."
      : "No reviewed medical evidence has been matched against this exact schedule-of-injuries row yet. DearPolicy never matches an injury to a schedule row on its own." };
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
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_CONTRACT_MISMATCH", message: "A match confirmed for a different policy can never unlock this policy's disability benefit." };
  }
  if (match.coverageId != null && match.coverageId !== expectedCoverageId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_COVERAGE_MISMATCH", message: "The reviewed match belongs to a different cover under this policy." };
  }
  if (!match.benefitCode || match.benefitCode !== input.benefitCode) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_BENEFIT_MISMATCH", message: "A match confirmed for a different benefit can never unlock this benefit -- for example a schedule-row match can never unlock a TPD benefit." };
  }
  const expectedMatchKey = input.benefitKind === "tpd" ? TOTAL_PERMANENT_DISABILITY_MATCH_KEY : (input.scheduleRowCode as string);
  if (!match.matchKey || normalizeKey(match.matchKey) !== normalizeKey(expectedMatchKey)) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_KEY_MISMATCH", message: input.benefitKind === "tpd"
      ? "The reviewed match was not reviewed against this policy's Total & Permanent Disability definition."
      : "A match confirmed for a different schedule row can never unlock this exact row -- DearPolicy never fuzzily matches an injury description to a schedule row." };
  }
  const matchDefinitionCheck = validatePolicyEvidence(match.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!matchDefinitionCheck.valid) return { status: "blocked", reasonCode: matchDefinitionCheck.reasonCode as "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: matchDefinitionCheck.message };
  const matchDefinitionEvidence = matchDefinitionCheck.evidence;
  const sameDefinition = matchDefinitionEvidence.policyId === definitionEvidence.policyId
    && matchDefinitionEvidence.chunkId === definitionEvidence.chunkId
    && matchDefinitionEvidence.pageStart === definitionEvidence.pageStart
    && matchDefinitionEvidence.pageEnd === definitionEvidence.pageEnd;
  if (!sameDefinition) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH", message: "The reviewed match was checked against different policy wording than the definition this calculation is using -- for example an earlier or different policy version. It can never unlock this calculation." };
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
    return { status: "not_applicable", potentialAmount: null, reason: input.benefitKind === "tpd"
      ? "The reviewed medical evidence does not meet this policy's own Total & Permanent Disability definition."
      : "The reviewed medical evidence does not meet this exact schedule-of-injuries row's own definition." };
  }
  if (match.result !== "matches") {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_NOT_CONFIRMED", message: "The reviewed medical evidence has not been explicitly confirmed to match this policy's own definition -- it is currently: " + match.result.replace(/_/g, " ") + "." };
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

  // --- Waiting period: measured from the cover's effective/reinstatement
  // date, exactly like critical-illness.ts's. ---
  if (input.waitingPeriod) {
    const from = input.waitingPeriod.fromDate ?? input.reinstatementDate ?? input.policyEffectiveDate ?? null;
    if (!validIsoDate(from)) {
      return { status: "blocked", reasonCode: "WAITING_PERIOD_NOT_ESTABLISHED", message: "The date this benefit's waiting period runs from is missing, so DearPolicy cannot confirm the waiting period has passed." };
    }
    const elapsed = daysBetween(from, input.disabilityDate);
    if (elapsed < input.waitingPeriod.days) {
      return { status: "not_applicable", potentialAmount: null, reason: `The disability date falls within this benefit's ${input.waitingPeriod.days}-day waiting period from ${from}.` };
    }
  }

  for (const exclusion of input.exclusions ?? []) {
    if (!exclusion.evidence) {
      return { status: "blocked", reasonCode: "INVALID_EXCLUSION_EVIDENCE", message: "A policy exclusion was supplied without evidence for its wording." };
    }
    if (exclusion.applies == null) {
      return { status: "blocked", reasonCode: "UNRESOLVED_EXCLUSION", message: "The policy excludes " + exclusion.key.replace(/_/g, " ") + ", and whether that applies here is still unresolved." };
    }
    if (exclusion.applies === true) {
      return { status: "not_applicable", potentialAmount: null, reason: "The policy excludes " + exclusion.key.replace(/_/g, " ") + ", and the facts confirm that applies here." };
    }
  }

  let capEvidence: ValidPolicyEvidenceRef | null = null;
  if (input.cap !== undefined && input.cap !== null) {
    const capEvidenceCheck = validatePolicyEvidence(input.cap.evidence, "MALFORMED_RULE_EVIDENCE");
    if (!capEvidenceCheck.valid) return { status: "blocked", reasonCode: "INVALID_CAP", message: "A cap was supplied without valid evidence for it." };
    if (!isFiniteNumber(input.cap.amount) || input.cap.amount <= 0) return { status: "blocked", reasonCode: "INVALID_CAP", message: "The evidenced cap amount is missing or invalid." };
    capEvidence = capEvidenceCheck.evidence;
  }

  if (input.policyEffectiveDate && ISO_DATE.test(input.policyEffectiveDate)) {
    const disability = Date.parse(input.disabilityDate);
    const effective = Date.parse(input.policyEffectiveDate);
    if (Number.isFinite(effective) && disability < effective) {
      return { status: "not_applicable", potentialAmount: null, reason: "The disability date precedes this cover's effective date." };
    }
  }

  let potentialAmountMinor: number;
  let formulaBasis: string;

  if (input.formula.kind === "fixed") {
    const amount = input.formula.amount;
    if (!isFiniteNumber(amount) || amount <= 0) return { status: "blocked", reasonCode: "INVALID_FIXED_AMOUNT", message: "The fixed benefit amount is missing, zero or negative." };
    if (amount > MAX_PLAUSIBLE_AMOUNT) return { status: "blocked", reasonCode: "IMPLAUSIBLE_SUM_INSURED", message: "The fixed benefit amount exceeds a plausible amount and needs a reviewed, corrected value before it can be used." };
    potentialAmountMinor = toMinorUnits(amount);
    formulaBasis = "Fixed disability benefit";
  } else {
    if (input.sumInsured == null) return { status: "blocked", reasonCode: "MISSING_SUM_INSURED", message: "The verified sum insured is missing." };
    if (!isFiniteNumber(input.sumInsured) || input.sumInsured <= 0) return { status: "blocked", reasonCode: "INVALID_SUM_INSURED", message: "The verified sum insured is missing, zero or negative." };
    if (input.sumInsured > MAX_PLAUSIBLE_AMOUNT) return { status: "blocked", reasonCode: "IMPLAUSIBLE_SUM_INSURED", message: "The sum insured exceeds a plausible amount and needs a reviewed, corrected value before it can be used." };
    const fraction = input.formula.fraction;
    if (!isFiniteNumber(fraction) || fraction <= 0) return { status: "blocked", reasonCode: "INVALID_FORMULA_FRACTION", message: "The quoted percentage or multiple of the sum insured is missing, malformed or not a positive number." };
    if (fraction > MAX_PLAUSIBLE_FRACTION) return { status: "blocked", reasonCode: "IMPLAUSIBLE_FORMULA_FRACTION", message: "The quoted percentage or multiple of the sum insured is implausibly large and needs review before it can be used." };
    const sumInsuredMinor = toMinorUnits(input.sumInsured);
    potentialAmountMinor = Math.round(sumInsuredMinor * fraction);
    formulaBasis = input.formula.kind === "schedule_percentage"
      ? `${Math.round(fraction * 10000) / 100}% of the verified sum insured for the evidenced schedule row "${input.formula.scheduleRowCode}"`
      : `${Math.round(fraction * 10000) / 100}% of the verified sum insured`;
  }

  let capApplied = false;
  if (input.cap && capEvidence) {
    const capMinor = toMinorUnits(input.cap.amount);
    if (potentialAmountMinor > capMinor) { potentialAmountMinor = capMinor; capApplied = true; formulaBasis += ", capped at the evidenced maximum"; }
  }

  const ruleEvidence = ruleEvidenceCheck.evidence;
  const ownershipEvidence = ownershipEvidenceCheck.evidence;
  const calculationId = (input.benefitKind === "tpd" ? "tpd:" : "ppd:") + stableIdHash([
    input.familyMember.id, input.claimEventId ?? null, input.benefitCode, input.benefitKind, input.scheduleRowCode ?? null,
    input.ownership.contractId, input.ownership.coverageId ?? null,
    ruleEvidence.policyId, ruleEvidence.chunkId, ruleEvidence.pageStart, ruleEvidence.pageEnd,
    definitionEvidence.policyId, definitionEvidence.chunkId, definitionEvidence.pageStart, definitionEvidence.pageEnd,
    medicalEvidence.documentId, medicalEvidence.documentType, medicalEvidence.pageStart ?? null, medicalEvidence.pageEnd ?? null,
    medicalEvidence.sourceLocation ?? null,
    input.formula.kind, input.formula.kind === "fixed" ? input.formula.amount : input.formula.fraction,
    capEvidence ? input.cap!.amount : null, capEvidence ? capEvidence.chunkId : null,
    input.disabilityDate, input.currency, input.sumInsured ?? null,
    input.waitingPeriod ? input.waitingPeriod.days : null,
  ]);

  return {
    status: "calculated", potentialAmount: potentialAmountMinor / 100, currency: input.currency, formulaBasis,
    ruleEvidence: input.ruleEvidence!, ownershipEvidence: input.ownershipEvidence!, definitionEvidence: input.definitionEvidence!,
    ownership: input.ownership, capApplied, calculationId,
  };
}
