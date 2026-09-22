/**
 * Pure, deterministic critical-illness benefit calculator.
 *
 * This is the only place a critical-illness monetary amount may be
 * computed. It follows exactly the same shape as
 * lib/claims/calculators/death-benefit.ts and accidental-death.ts: every
 * input is already-verified and structured (never LLM prose), every branch
 * fails closed, and nothing here decides that a diagnosis occurred, that it
 * meets a policy's definition, or that any waiting/survival period has
 * passed -- the caller supplies those as already-confirmed facts. What is
 * specific to critical illness, and stricter than an ordinary death
 * benefit, is that a benefit pays only for a condition NAMED in the
 * policy's own schedule of defined conditions, and only once reviewed
 * medical evidence has been explicitly matched against that exact
 * definition (see ./evidence.ts's CIDefinitionMatch) -- a chat message
 * alone ("I have cancer", "the doctor said it's early stage") can never
 * unlock an amount, however it is phrased.
 *
 * Supported formulas: a fixed monetary amount; a percentage or multiple of
 * the verified sum insured; a fixed percentage by illness stage; any of
 * those capped at an explicitly evidenced ceiling ("the lesser of the
 * calculated amount and the evidenced cap"). "Remaining-benefit calculation
 * for an accelerated benefit" and cross-benefit multi-pay/aggregate-cap
 * handling are deliberately NOT computed here: this calculator only ever
 * produces the RAW amount one single benefit is worth on its own -- exactly
 * like calculateDeathBenefit() does for a death benefit that might also be
 * accelerated or capped by another benefit. Reducing one benefit because
 * another was already paid (an accelerated early-stage payment, a
 * multi-pay tranche, a lifetime aggregate cap) is a CROSS-benefit decision,
 * and the only place that ever combines more than one calculated benefit is
 * lib/claims/composition/engine.ts's composeClaim() -- see its own doc
 * comment. This calculator's job stops at "what is this one benefit worth,
 * on its own, assuming it is included."
 *
 * All arithmetic runs on integer minor currency units (cents) internally so
 * repeated or large calculations never drift from floating-point rounding.
 */

import { createHash } from "node:crypto";
import { validateMedicalEvidence, validateOwnershipEvidence, validatePolicyEvidence, type CIDefinitionMatch, type ValidPolicyEvidenceRef } from "./evidence";

export { stableId } from "./death-benefit";

export type CIEvidenceRef = {
  chunkId?: string;
  policyId?: string;
  pageStart?: number;
  pageEnd?: number;
  label?: string;
  coverageId?: string;
  familyMemberId?: string;
};

export type CIOwnershipRef = { contractId: string; coverageId?: string; label?: string };

/** A fixed benefit amount, independent of the sum insured. */
export type CIFixedFormula = { kind: "fixed"; amount: number; evidence: CIEvidenceRef };
/** A fraction of the verified sum insured -- 1 = 100%, 0.25 = 25%, 2 = a
 * double (200%) multiple. Percentages and multiples are the same
 * arithmetic, exactly as in calculateDeathBenefit(). */
export type CISumInsuredFormula = { kind: "sum_insured_fraction"; fraction: number; evidence: CIEvidenceRef };
/** A fixed percentage keyed to the illness's evidenced stage (e.g. Early
 * Stage 25%, Intermediate Stage 50%, Major/Advanced Stage 100%). `stage`
 * must equal, case-insensitively, the stage the CIDefinitionMatch's
 * definition evidence was reviewed against -- see the stage check below. */
export type CIStageFormula = { kind: "stage_percentage"; stage: string; fraction: number; evidence: CIEvidenceRef };
export type CIFormula = CIFixedFormula | CISumInsuredFormula | CIStageFormula;

export type CICap = { amount: number; evidence: CIEvidenceRef } | null;

/** Multi-pay tranche context. Required only when the benefit's own wording
 * defines more than one payable tranche for the same or related
 * conditions; absent (undefined) for an ordinary single-pay benefit. */
export type CIMultiPayInfo = {
  /** 1-based index of the tranche being claimed now. */
  tranche: number;
  totalTranches: number;
  /** Whether every EARLIER tranche's status has been verified -- either
   * confirmed unpaid (this really is the first applicable tranche) or
   * confirmed paid with a known amount recorded in the caller's own
   * prior-paid-amount tracking (lib/claims/composition/engine.ts's
   * lifetime-cap mechanism, fed by ClaimFacts.priorPaidAmounts). An
   * unverified assumption about earlier tranches -- including a family's
   * own unconfirmed recollection -- must never be passed as `true`. */
  priorTranchesVerified: boolean;
};

export type CIWaitingPeriod = {
  /** Whole days from the cover's effective date (or reinstatement date,
   * whichever the wording specifies) during which this benefit does not
   * respond. */
  days: number;
  /** The date the period runs from -- effective date or reinstatement
   * date, as the wording specifies. Required whenever `days` is supplied. */
  fromDate: string | null;
  evidence: CIEvidenceRef;
};

export type CISurvivalPeriod = {
  /** Whole days the insured must survive from the diagnosis/event date. */
  days: number;
  evidence: CIEvidenceRef;
};

/** A circumstance the POLICY itself carves out -- same shape and rationale
 * as AccidentalDeathExclusion. Sensitive matters (pre-existing condition,
 * non-disclosure, self-inflicted injury, substance use, congenital
 * condition) are represented here like any other exclusion: `applies` is
 * `null` (blocks) unless reviewed evidence has explicitly established it
 * one way or the other -- this calculator never infers one from weak
 * evidence or chat phrasing, and neither may its caller. */
export type CIExclusion = { key: string; evidence: CIEvidenceRef; applies: boolean | null };

export type CIInput = {
  ownership: CIOwnershipRef | null;
  familyMember: { id: string; confirmed: boolean } | null;
  claimEventId: string | null;
  /** The exact calculator-facing benefit code this calculation is for --
   * must equal the CIDefinitionMatch's own `benefitCode` field. */
  benefitCode: string;
  /** The exact illness/condition name being calculated for -- must equal
   * the CIDefinitionMatch's own `illnessName` field. */
  illnessName: string | null;
  /** ISO date of diagnosis. Required -- a critical-illness benefit is
   * anchored to the diagnosis date, not a vaguer "event date". */
  diagnosisDate: string | null;
  policyEffectiveDate?: string | null;
  reinstatementDate?: string | null;
  sumInsured: number | null;
  currency: string | null;
  formula: CIFormula | null;
  cap?: CICap;
  ruleEvidence: CIEvidenceRef | null;
  ownershipEvidence: CIEvidenceRef | null;
  /** Where the policy defines THIS illness/benefit -- distinct from
   * ruleEvidence exactly as in accidental-death.ts (one clause states the
   * formula, another -- or the same one -- defines what counts). */
  definitionEvidence: CIEvidenceRef | null;
  /** The one applicable, already-reviewed match between medical evidence
   * and this policy's own definition of this exact benefit/illness, or
   * `null` when none has been reviewed yet. Every field is independently
   * re-validated against this calculation's own context below -- a match
   * for a different family member, claim, contract, coverage, benefit or
   * illness can never unlock this one. */
  definitionMatch: CIDefinitionMatch | null;
  /** The illness stage/severity the reviewed medical evidence actually
   * established, when the formula is stage-based. Required, and must equal
   * `formula.stage` (case-insensitively), whenever formula.kind is
   * "stage_percentage". Never taken from a chat-reported stage alone. */
  evidencedStage?: string | null;
  waitingPeriod?: CIWaitingPeriod | null;
  survivalPeriod?: CISurvivalPeriod | null;
  multiPay?: CIMultiPayInfo | null;
  exclusions?: CIExclusion[];
  unresolvedConditions?: string[];
};

export type CIBlockReasonCode =
  | "MISSING_OWNERSHIP_MAPPING" | "MISSING_FAMILY_MEMBER" | "FAMILY_MEMBER_NOT_CONFIRMED"
  | "MISSING_DIAGNOSIS_DATE" | "MISSING_SUM_INSURED" | "INVALID_SUM_INSURED" | "IMPLAUSIBLE_SUM_INSURED"
  | "MISSING_FORMULA" | "INVALID_FORMULA_FRACTION" | "IMPLAUSIBLE_FORMULA_FRACTION" | "INVALID_FIXED_AMOUNT"
  | "INVALID_CAP" | "INVALID_CURRENCY" | "MALFORMED_RULE_EVIDENCE" | "MALFORMED_OWNERSHIP_EVIDENCE"
  | "MALFORMED_POLICY_DEFINITION_EVIDENCE" | "MALFORMED_MEDICAL_EVIDENCE" | "UNRESOLVED_CONDITION"
  | "DEFINITION_MATCH_MISSING" | "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH" | "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH"
  | "DEFINITION_MATCH_CONTRACT_MISMATCH" | "DEFINITION_MATCH_COVERAGE_MISMATCH" | "DEFINITION_MATCH_BENEFIT_MISMATCH"
  | "DEFINITION_MATCH_ILLNESS_MISMATCH" | "DEFINITION_MATCH_DEFINITION_VERSION_MISMATCH" | "DEFINITION_MATCH_NOT_CONFIRMED"
  | "STAGE_NOT_EVIDENCED" | "STAGE_MISMATCH" | "WAITING_PERIOD_NOT_ESTABLISHED" | "WAITING_PERIOD_NOT_MET"
  | "SURVIVAL_PERIOD_NOT_ESTABLISHED" | "SURVIVAL_PERIOD_NOT_MET" | "MULTI_PAY_PRIOR_TRANCHE_UNVERIFIED"
  | "INVALID_MULTI_PAY_TRANCHE" | "UNRESOLVED_EXCLUSION" | "INVALID_EXCLUSION_EVIDENCE";

export type CIBlocked = { status: "blocked"; reasonCode: CIBlockReasonCode; message: string };
export type CINotApplicable = { status: "not_applicable"; potentialAmount: null; reason: string };
export type CICalculated = {
  status: "calculated";
  potentialAmount: number;
  currency: string;
  formulaBasis: string;
  ruleEvidence: CIEvidenceRef;
  ownershipEvidence: CIEvidenceRef;
  definitionEvidence: CIEvidenceRef;
  ownership: CIOwnershipRef;
  capApplied: boolean;
  calculationId: string;
};
export type CIResult = CICalculated | CINotApplicable | CIBlocked;

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
function normalizeStage(value: string) { return value.trim().toLowerCase().replace(/\s+/g, " "); }

function stableIdHash(parts: (string | number | boolean | null | undefined)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function calculateCriticalIllness(input: CIInput): CIResult {
  if (!input.ownership || !input.ownership.contractId) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_MAPPING", message: "This benefit is not explicitly mapped to an owned policy contract." };
  }
  if (!input.familyMember) {
    return { status: "blocked", reasonCode: "MISSING_FAMILY_MEMBER", message: "The insured family member for this cover has not been identified." };
  }
  if (!input.familyMember.confirmed) {
    return { status: "blocked", reasonCode: "FAMILY_MEMBER_NOT_CONFIRMED", message: "Which family member this cover and this diagnosis belong to still needs confirming." };
  }
  if (!validIsoDate(input.diagnosisDate)) {
    return { status: "blocked", reasonCode: "MISSING_DIAGNOSIS_DATE", message: "The diagnosis date is missing or not a valid date." };
  }
  if (typeof input.currency !== "string" || !ISO_CURRENCY.test(input.currency)) {
    return { status: "blocked", reasonCode: "INVALID_CURRENCY", message: "This benefit does not have a verified ISO currency." };
  }
  if (!input.formula) {
    return { status: "blocked", reasonCode: "MISSING_FORMULA", message: "No verified payout formula is available for this benefit." };
  }
  const ruleEvidenceCheck = validatePolicyEvidence(input.ruleEvidence, "MALFORMED_RULE_EVIDENCE");
  if (!ruleEvidenceCheck.valid) return { status: "blocked", reasonCode: ruleEvidenceCheck.reasonCode as "MALFORMED_RULE_EVIDENCE", message: ruleEvidenceCheck.message };
  const ownershipEvidenceCheck = validateOwnershipEvidence(input.ownershipEvidence);
  if (!ownershipEvidenceCheck.valid) return { status: "blocked", reasonCode: ownershipEvidenceCheck.reasonCode as "MALFORMED_OWNERSHIP_EVIDENCE", message: ownershipEvidenceCheck.message };
  const definitionCheck = validatePolicyEvidence(input.definitionEvidence, "MALFORMED_POLICY_DEFINITION_EVIDENCE");
  if (!definitionCheck.valid) return { status: "blocked", reasonCode: definitionCheck.reasonCode as "MALFORMED_POLICY_DEFINITION_EVIDENCE", message: definitionCheck.message };
  const definitionEvidence = definitionCheck.evidence;

  // --- The definition-match gate. This runs before any arithmetic, and
  // independently re-validates every field -- a caller's own "this looked
  // like the right match" filtering is never trusted alone. See
  // calculateAccidentalDeath() for the identical pattern. ---
  const match = input.definitionMatch;
  if (!match) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_MISSING", message: "No reviewed medical evidence has been matched against this policy's own critical-illness definition yet." };
  }
  const expectedFamilyMemberId = input.familyMember.id;
  const expectedContractId = input.ownership.contractId;
  const expectedCoverageId = input.ownership.coverageId;
  if (!match.familyMemberId || match.familyMemberId !== expectedFamilyMemberId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_FAMILY_MEMBER_MISMATCH", message: "The reviewed medical-evidence match belongs to a different family member than the one insured under this cover." };
  }
  if (!match.claimEventId || match.claimEventId !== input.claimEventId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_CLAIM_EVENT_MISMATCH", message: "The reviewed medical-evidence match belongs to a different claim than the one being assessed." };
  }
  if (!match.contractId || match.contractId !== expectedContractId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_CONTRACT_MISMATCH", message: "A match confirmed for a different policy can never unlock this policy's critical-illness benefit." };
  }
  if (match.coverageId != null && match.coverageId !== expectedCoverageId) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_COVERAGE_MISMATCH", message: "The reviewed match belongs to a different cover under this policy." };
  }
  if (!match.benefitCode || match.benefitCode !== input.benefitCode) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_BENEFIT_MISMATCH", message: "A match confirmed for a different benefit can never unlock this benefit -- for example a match reviewed against an early-stage table can never unlock the major benefit." };
  }
  if (!match.illnessName || !input.illnessName || normalizeStage(match.illnessName) !== normalizeStage(input.illnessName)) {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_ILLNESS_MISMATCH", message: "A match confirmed for a different named condition can never unlock this benefit." };
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
    return { status: "not_applicable", potentialAmount: null, reason: "The reviewed medical evidence does not meet this policy's own definition of this critical-illness benefit." };
  }
  if (match.result !== "matches") {
    return { status: "blocked", reasonCode: "DEFINITION_MATCH_NOT_CONFIRMED", message: "The reviewed medical evidence has not been explicitly confirmed to match this policy's own critical-illness definition -- it is currently: " + match.result.replace(/_/g, " ") + "." };
  }

  // --- Stage formula: the evidenced stage must equal the formula's stage. ---
  if (input.formula.kind === "stage_percentage") {
    if (!input.evidencedStage) {
      return { status: "blocked", reasonCode: "STAGE_NOT_EVIDENCED", message: "The illness stage has not been established from reviewed medical evidence, so a stage-based benefit cannot be calculated." };
    }
    if (normalizeStage(input.evidencedStage) !== normalizeStage(input.formula.stage)) {
      return { status: "blocked", reasonCode: "STAGE_MISMATCH", message: "The evidenced stage does not match the stage this formula pays for." };
    }
  }

  if (input.unresolvedConditions?.length) {
    return { status: "blocked", reasonCode: "UNRESOLVED_CONDITION", message: "A required policy condition is still unresolved: " + input.unresolvedConditions[0] };
  }

  // --- Waiting period: measured from the cover's effective/reinstatement
  // date. "30 days" here is never interchangeable with a survival period
  // measured from the diagnosis date -- they run from different anchors and
  // are validated completely separately. ---
  if (input.waitingPeriod) {
    const from = input.waitingPeriod.fromDate ?? input.reinstatementDate ?? input.policyEffectiveDate ?? null;
    if (!validIsoDate(from)) {
      return { status: "blocked", reasonCode: "WAITING_PERIOD_NOT_ESTABLISHED", message: "The date this benefit's waiting period runs from is missing, so DearPolicy cannot confirm the waiting period has passed." };
    }
    const elapsed = daysBetween(from, input.diagnosisDate);
    if (elapsed < input.waitingPeriod.days) {
      return { status: "not_applicable", potentialAmount: null, reason: `The diagnosis date falls within this benefit's ${input.waitingPeriod.days}-day waiting period from ${from}.` };
    }
  }

  // --- Survival period: measured from the diagnosis date. This pure
  // function has no wall-clock "today" of its own, so it cannot itself
  // decide "has enough time now elapsed" -- that comparison (today vs.
  // diagnosisDate + survivalPeriod.days) is made by the caller
  // (lib/claims/ci-rules.ts) BEFORE it ever passes a `survivalPeriod` in
  // at all: this calculator is only ever invoked once the survival period
  // is confirmed to have passed, and `survivalPeriod` here exists purely
  // so the evidenced period is captured in the calculation identity below
  // -- if the evidenced period later changes, the identity changes too.
  if (input.survivalPeriod && !input.diagnosisDate) {
    return { status: "blocked", reasonCode: "SURVIVAL_PERIOD_NOT_ESTABLISHED", message: "The diagnosis date is required to confirm the survival period." };
  }

  // --- Multi-pay: every earlier tranche's status must be verified. ---
  if (input.multiPay) {
    if (!Number.isInteger(input.multiPay.tranche) || input.multiPay.tranche < 1 || !Number.isInteger(input.multiPay.totalTranches) || input.multiPay.totalTranches < input.multiPay.tranche) {
      return { status: "blocked", reasonCode: "INVALID_MULTI_PAY_TRANCHE", message: "The multi-pay tranche information is invalid." };
    }
    if (input.multiPay.tranche > 1 && !input.multiPay.priorTranchesVerified) {
      return { status: "blocked", reasonCode: "MULTI_PAY_PRIOR_TRANCHE_UNVERIFIED", message: "This is not the first payable tranche under this multi-pay benefit, and DearPolicy has not verified the status of the earlier tranche(s), so it cannot calculate this one." };
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
    const diagnosis = Date.parse(input.diagnosisDate);
    const effective = Date.parse(input.policyEffectiveDate);
    if (Number.isFinite(effective) && diagnosis < effective) {
      return { status: "not_applicable", potentialAmount: null, reason: "The diagnosis date precedes this cover's effective date." };
    }
  }

  let potentialAmountMinor: number;
  let formulaBasis: string;

  if (input.formula.kind === "fixed") {
    const amount = input.formula.amount;
    if (!isFiniteNumber(amount) || amount <= 0) return { status: "blocked", reasonCode: "INVALID_FIXED_AMOUNT", message: "The fixed benefit amount is missing, zero or negative." };
    if (amount > MAX_PLAUSIBLE_AMOUNT) return { status: "blocked", reasonCode: "IMPLAUSIBLE_SUM_INSURED", message: "The fixed benefit amount exceeds a plausible amount and needs a reviewed, corrected value before it can be used." };
    potentialAmountMinor = toMinorUnits(amount);
    formulaBasis = "Fixed critical-illness benefit";
  } else {
    if (input.sumInsured == null) return { status: "blocked", reasonCode: "MISSING_SUM_INSURED", message: "The verified sum insured is missing." };
    if (!isFiniteNumber(input.sumInsured) || input.sumInsured <= 0) return { status: "blocked", reasonCode: "INVALID_SUM_INSURED", message: "The verified sum insured is missing, zero or negative." };
    if (input.sumInsured > MAX_PLAUSIBLE_AMOUNT) return { status: "blocked", reasonCode: "IMPLAUSIBLE_SUM_INSURED", message: "The sum insured exceeds a plausible amount and needs a reviewed, corrected value before it can be used." };
    const fraction = input.formula.fraction;
    if (!isFiniteNumber(fraction) || fraction <= 0) return { status: "blocked", reasonCode: "INVALID_FORMULA_FRACTION", message: "The quoted percentage or multiple of the sum insured is missing, malformed or not a positive number." };
    if (fraction > MAX_PLAUSIBLE_FRACTION) return { status: "blocked", reasonCode: "IMPLAUSIBLE_FORMULA_FRACTION", message: "The quoted percentage or multiple of the sum insured is implausibly large and needs review before it can be used." };
    const sumInsuredMinor = toMinorUnits(input.sumInsured);
    potentialAmountMinor = Math.round(sumInsuredMinor * fraction);
    formulaBasis = input.formula.kind === "stage_percentage"
      ? `${Math.round(fraction * 10000) / 100}% of the verified sum insured for the ${input.formula.stage} stage`
      : `${Math.round(fraction * 10000) / 100}% of the verified sum insured`;
  }

  let capApplied = false;
  if (input.cap && capEvidence) {
    const capMinor = toMinorUnits(input.cap.amount);
    if (potentialAmountMinor > capMinor) { potentialAmountMinor = capMinor; capApplied = true; formulaBasis += ", capped at the evidenced maximum"; }
  }

  const ruleEvidence = ruleEvidenceCheck.evidence;
  const ownershipEvidence = ownershipEvidenceCheck.evidence;
  const calculationId = "ci:" + stableIdHash([
    input.familyMember.id, input.claimEventId ?? null, input.benefitCode, input.illnessName,
    input.ownership.contractId, input.ownership.coverageId ?? null,
    ruleEvidence.policyId, ruleEvidence.chunkId, ruleEvidence.pageStart, ruleEvidence.pageEnd,
    definitionEvidence.policyId, definitionEvidence.chunkId, definitionEvidence.pageStart, definitionEvidence.pageEnd,
    medicalEvidence.documentId, medicalEvidence.documentType, medicalEvidence.pageStart ?? null, medicalEvidence.pageEnd ?? null,
    medicalEvidence.sourceLocation ?? null,
    input.formula.kind, input.formula.kind === "fixed" ? input.formula.amount : input.formula.fraction,
    input.formula.kind === "stage_percentage" ? input.formula.stage : null,
    capEvidence ? input.cap!.amount : null, capEvidence ? capEvidence.chunkId : null,
    input.diagnosisDate, input.currency, input.sumInsured ?? null,
    input.multiPay ? input.multiPay.tranche : null, input.multiPay ? input.multiPay.totalTranches : null,
    input.waitingPeriod ? input.waitingPeriod.days : null, input.survivalPeriod ? input.survivalPeriod.days : null,
  ]);

  return {
    status: "calculated", potentialAmount: potentialAmountMinor / 100, currency: input.currency, formulaBasis,
    ruleEvidence: input.ruleEvidence!, ownershipEvidence: input.ownershipEvidence!, definitionEvidence: input.definitionEvidence!,
    ownership: input.ownership, capApplied, calculationId,
  };
}
