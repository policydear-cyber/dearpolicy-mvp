/**
 * Pure, deterministic ordinary-death benefit calculator.
 *
 * This is the only place an ordinary (non-accidental) death-benefit amount
 * may be computed. It accepts only already-verified, structured inputs --
 * never LLM prose -- and either returns a bounded, evidence-backed potential
 * amount or a typed block reason. Every branch fails closed: a missing or
 * unverifiable input blocks the result rather than defaulting to a guess in
 * either direction. It does not decide that a death occurred, or that any
 * policy condition is met -- the caller supplies those as already-confirmed
 * facts; this module only turns a confirmed formula and a confirmed sum
 * insured into a bounded figure.
 *
 * Supported formulas: a percentage of the verified sum insured (100% or any
 * other quoted percentage), a multiple of the verified sum insured (value
 * above 1), a fixed additional benefit, and any of those capped at an
 * explicitly evidenced ceiling.
 *
 * All arithmetic runs on integer minor currency units (cents) internally so
 * that repeated or large calculations never drift from floating-point
 * rounding.
 */

export type DeathBenefitEvidenceRef = {
  chunkId?: string;
  policyId?: string;
  pageStart?: number;
  pageEnd?: number;
  label?: string;
};

export type DeathBenefitOwnershipRef = {
  /** The owned contract/coverage this benefit is mapped to. */
  contractId: string;
  coverageId?: string;
  label?: string;
};

/** A fraction of the verified sum insured: 1 = 100%, 0.5 = 50%, 2 = a double
 * (200%) multiple. Multiples and percentages are the same arithmetic, so one
 * formula shape covers both -- the wording that justified the fraction is
 * what evidence proves, not the shape of the number itself. */
export type DeathBenefitSumInsuredFormula = {
  kind: "sum_insured_fraction";
  /** Must be a finite, plausible, positive fraction. Evidence must quote the
   * exact percentage or multiple this fraction represents. */
  fraction: number;
  evidence: DeathBenefitEvidenceRef;
};

/** A fixed benefit not derived from the sum insured (e.g. a flat additional
 * death benefit, or a funeral grant paid alongside the main sum). */
export type DeathBenefitFixedFormula = {
  kind: "fixed";
  amount: number;
  evidence: DeathBenefitEvidenceRef;
};

export type DeathBenefitFormula = DeathBenefitSumInsuredFormula | DeathBenefitFixedFormula;

export type DeathBenefitCap = {
  amount: number;
  evidence: DeathBenefitEvidenceRef;
} | null;

export type DeathBenefitInput = {
  /** The owned contract/coverage this benefit is mapped to. Absent blocks. */
  ownership: DeathBenefitOwnershipRef | null;
  /** The insured family member this cover and this death both belong to.
   * Absent, or not confirmed, blocks -- a figure must never be attributed
   * to the wrong person. */
  familyMember: { id: string; confirmed: boolean } | null;
  /** Whether the insured's death is itself confirmed (a death certificate
   * or equivalent, not merely reported in passing). Anything other than
   * `true` blocks. */
  deathConfirmed: boolean | null;
  /** ISO date of death. Required. */
  dateOfDeath: string | null;
  /** ISO date the cover became effective, when known. When the death
   * predates it, the result is `not_applicable`, never an error. */
  policyEffectiveDate?: string | null;
  /** Verified sum insured, in major currency units. Required when the
   * formula is a fraction of sum insured. */
  sumInsured: number | null;
  /** ISO 4217 currency code shared by the sum insured, the formula and the
   * cap. A formula/cap quoted in a different currency must be rejected by
   * the caller before this point; this module only checks the code itself
   * is a valid ISO code and internally consistent. */
  currency: string | null;
  /** The payout formula. Absent blocks. */
  formula: DeathBenefitFormula | null;
  /** An explicitly evidenced ceiling on this benefit, if the wording states
   * one. A cap object with no evidence blocks rather than being ignored. */
  cap?: DeathBenefitCap;
  /** Where the payout rule itself was read and verified. Absent blocks. */
  ruleEvidence: DeathBenefitEvidenceRef | null;
  /** Where ownership of the policy was verified. Absent blocks. */
  ownershipEvidence: DeathBenefitEvidenceRef | null;
  /** Any policy condition still requiring resolution before this benefit's
   * amount can be shown (e.g. an insurer-only definitional confirmation,
   * or a claim-notification requirement not yet met). Non-empty blocks. */
  unresolvedConditions?: string[];
};

export type DeathBenefitBlockReasonCode =
  | "MISSING_OWNERSHIP_MAPPING"
  | "MISSING_FAMILY_MEMBER"
  | "FAMILY_MEMBER_NOT_CONFIRMED"
  | "DEATH_NOT_CONFIRMED"
  | "MISSING_DATE_OF_DEATH"
  | "MISSING_SUM_INSURED"
  | "INVALID_SUM_INSURED"
  | "IMPLAUSIBLE_SUM_INSURED"
  | "MISSING_FORMULA"
  | "INVALID_FORMULA_FRACTION"
  | "IMPLAUSIBLE_FORMULA_FRACTION"
  | "INVALID_FIXED_AMOUNT"
  | "INVALID_CAP"
  | "INVALID_CURRENCY"
  | "MISSING_RULE_EVIDENCE"
  | "MISSING_OWNERSHIP_EVIDENCE"
  | "UNRESOLVED_CONDITION";

export type DeathBenefitBlocked = {
  status: "blocked";
  reasonCode: DeathBenefitBlockReasonCode;
  message: string;
};

type DeathBenefitComputedFields = {
  currency: string;
  formulaBasis: string;
  ruleEvidence: DeathBenefitEvidenceRef;
  ownershipEvidence: DeathBenefitEvidenceRef;
  ownership: DeathBenefitOwnershipRef;
  capApplied: boolean;
};

export type DeathBenefitCalculated = DeathBenefitComputedFields & {
  status: "calculated";
  potentialAmount: number;
  calculationId: string;
};

/** The death predates the cover's own effective date. Never represented as a
 * payout -- the cover simply was not in force yet. */
export type DeathBenefitNotApplicable = {
  status: "not_applicable";
  potentialAmount: null;
  reason: string;
};

export type DeathBenefitResult = DeathBenefitCalculated | DeathBenefitNotApplicable | DeathBenefitBlocked;

const ISO_CURRENCY = /^[A-Z]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A fraction above this is not a plausible death-benefit multiple -- an OCR
 * or extraction error, not a real policy term. Real multiples of sum insured
 * rarely if ever exceed a handful of times the base sum. */
const MAX_PLAUSIBLE_FRACTION = 10;
/** A sum insured above this (in major currency units) is treated as an
 * unreviewed OCR or extraction error rather than a real personal figure. */
const MAX_PLAUSIBLE_AMOUNT = 100_000_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Stable across repeated calls with the same input, and distinct whenever
 * any determining input differs -- the property the "duplicate calculation
 * IDs" and "deterministic repeatability" tests check for. No Node crypto
 * dependency: a compact FNV-1a hash of the canonical input is enough for a
 * stable identifier and keeps this module dependency-free like its sibling
 * calculators. */
function stableId(parts: (string | number | boolean | null | undefined)[]): string {
  const text = JSON.stringify(parts);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return "db:" + (hash >>> 0).toString(16).padStart(8, "0") + ":" + text.length;
}

export function calculateDeathBenefit(input: DeathBenefitInput): DeathBenefitResult {
  if (!input.ownership || !input.ownership.contractId) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_MAPPING", message: "This benefit is not explicitly mapped to an owned policy contract." };
  }
  if (!input.familyMember) {
    return { status: "blocked", reasonCode: "MISSING_FAMILY_MEMBER", message: "The insured family member for this cover has not been identified." };
  }
  if (!input.familyMember.confirmed) {
    return { status: "blocked", reasonCode: "FAMILY_MEMBER_NOT_CONFIRMED", message: "Which family member this cover and this death belong to still needs confirming." };
  }
  if (input.deathConfirmed !== true) {
    return { status: "blocked", reasonCode: "DEATH_NOT_CONFIRMED", message: "The death itself is not yet confirmed." };
  }
  if (!input.dateOfDeath || !ISO_DATE.test(input.dateOfDeath) || !Number.isFinite(Date.parse(input.dateOfDeath))) {
    return { status: "blocked", reasonCode: "MISSING_DATE_OF_DEATH", message: "The date of death is missing or not a valid date." };
  }
  if (typeof input.currency !== "string" || !ISO_CURRENCY.test(input.currency)) {
    return { status: "blocked", reasonCode: "INVALID_CURRENCY", message: "This benefit does not have a verified ISO currency." };
  }
  if (!input.formula) {
    return { status: "blocked", reasonCode: "MISSING_FORMULA", message: "No verified payout formula is available for this benefit." };
  }
  if (!input.ruleEvidence) {
    return { status: "blocked", reasonCode: "MISSING_RULE_EVIDENCE", message: "The payout rule has no evidence reference." };
  }
  if (!input.ownershipEvidence) {
    return { status: "blocked", reasonCode: "MISSING_OWNERSHIP_EVIDENCE", message: "Ownership of this policy has no evidence reference." };
  }
  if (input.unresolvedConditions?.length) {
    return { status: "blocked", reasonCode: "UNRESOLVED_CONDITION", message: "A required policy condition is still unresolved: " + input.unresolvedConditions[0] };
  }
  if (input.cap !== undefined && input.cap !== null && !input.cap.evidence) {
    return { status: "blocked", reasonCode: "INVALID_CAP", message: "A cap was supplied without evidence for it." };
  }
  if (input.cap && (!isFiniteNumber(input.cap.amount) || input.cap.amount <= 0)) {
    return { status: "blocked", reasonCode: "INVALID_CAP", message: "The evidenced cap amount is missing or invalid." };
  }

  // Cover-not-in-force is checked before the formula arithmetic: a death
  // before the effective date is a clean not_applicable, not a blocked
  // calculation -- the wording and sum insured may be perfectly fine, the
  // cover was simply not on risk yet.
  if (input.policyEffectiveDate && ISO_DATE.test(input.policyEffectiveDate)) {
    const death = Date.parse(input.dateOfDeath);
    const effective = Date.parse(input.policyEffectiveDate);
    if (Number.isFinite(effective) && death < effective) {
      return { status: "not_applicable", potentialAmount: null, reason: "The date of death precedes this cover's effective date." };
    }
  }

  let potentialAmountMinor: number;
  let formulaBasis: string;

  if (input.formula.kind === "sum_insured_fraction") {
    if (input.sumInsured == null) {
      return { status: "blocked", reasonCode: "MISSING_SUM_INSURED", message: "The verified sum insured is missing." };
    }
    if (!isFiniteNumber(input.sumInsured) || input.sumInsured <= 0) {
      return { status: "blocked", reasonCode: "INVALID_SUM_INSURED", message: "The verified sum insured is missing, zero or negative." };
    }
    if (input.sumInsured > MAX_PLAUSIBLE_AMOUNT) {
      return { status: "blocked", reasonCode: "IMPLAUSIBLE_SUM_INSURED", message: "The sum insured exceeds a plausible amount and needs a reviewed, corrected value before it can be used." };
    }
    const fraction = input.formula.fraction;
    if (!isFiniteNumber(fraction) || fraction <= 0) {
      return { status: "blocked", reasonCode: "INVALID_FORMULA_FRACTION", message: "The quoted percentage or multiple of the sum insured is missing, malformed or not a positive number." };
    }
    if (fraction > MAX_PLAUSIBLE_FRACTION) {
      return { status: "blocked", reasonCode: "IMPLAUSIBLE_FORMULA_FRACTION", message: "The quoted percentage or multiple of the sum insured is implausibly large and needs review before it can be used." };
    }
    const sumInsuredMinor = toMinorUnits(input.sumInsured);
    // Rounded once, on the final minor-unit figure, so a fraction such as
    // 33.33% never accumulates a rounding difference across repeated calls.
    potentialAmountMinor = Math.round(sumInsuredMinor * fraction);
    formulaBasis = (Math.round(fraction * 10000) / 100) + "% of the verified sum insured";
  } else {
    const amount = input.formula.amount;
    if (!isFiniteNumber(amount) || amount <= 0) {
      return { status: "blocked", reasonCode: "INVALID_FIXED_AMOUNT", message: "The fixed benefit amount is missing, zero or negative." };
    }
    if (amount > MAX_PLAUSIBLE_AMOUNT) {
      return { status: "blocked", reasonCode: "IMPLAUSIBLE_SUM_INSURED", message: "The fixed benefit amount exceeds a plausible amount and needs a reviewed, corrected value before it can be used." };
    }
    potentialAmountMinor = toMinorUnits(amount);
    formulaBasis = "Fixed additional death benefit";
  }

  let capApplied = false;
  if (input.cap) {
    const capMinor = toMinorUnits(input.cap.amount);
    if (potentialAmountMinor > capMinor) {
      potentialAmountMinor = capMinor;
      capApplied = true;
      formulaBasis += ", capped at the evidenced maximum";
    }
  }

  const calculationId = stableId([
    input.ownership.contractId, input.ownership.coverageId ?? null,
    input.formula.kind, input.formula.kind === "sum_insured_fraction" ? input.formula.fraction : input.formula.amount,
    input.cap?.amount ?? null, input.currency, input.sumInsured ?? null,
  ]);

  return {
    status: "calculated",
    potentialAmount: potentialAmountMinor / 100,
    currency: input.currency,
    formulaBasis,
    ruleEvidence: input.ruleEvidence,
    ownershipEvidence: input.ownershipEvidence,
    ownership: input.ownership,
    capApplied,
    calculationId,
  };
}
