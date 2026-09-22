import { createHash } from "node:crypto";

/**
 * Pure, deterministic hospital-cash benefit calculator.
 *
 * This is the only place a hospital-cash (or other per-diem) potential
 * amount may be computed. It accepts only already-verified, structured
 * inputs -- never LLM prose -- and either returns a bounded, evidence-backed
 * potential amount or a typed block reason. Every branch fails closed: a
 * missing or unverifiable input blocks the result rather than defaulting to
 * a guess in either direction.
 *
 * Formula: payableDays = min(maximumDays, max(0, hospitalNights - offsetDays))
 *          potentialAmount = payableDays x dailyRate
 *
 * All arithmetic runs on integer minor currency units (cents) internally so
 * that repeated or large calculations never drift from floating-point
 * rounding.
 */

export type HospitalCashEvidenceRef = {
  chunkId?: string;
  policyId?: string;
  pageStart?: number;
  pageEnd?: number;
  label?: string;
};

export type HospitalCashOwnershipRef = {
  /** The owned contract/coverage this benefit is mapped to. */
  contractId: string;
  coverageId?: string;
  label?: string;
};

export type HospitalCashInput = {
  /** Verified per-night rate, in major currency units (e.g. dollars). */
  dailyRate: number | null;
  /** ISO 4217 currency code. */
  currency: string | null;
  /** Whether the hospital stay is still ongoing. A confirmed ongoing stay
   * always blocks, regardless of any nights figure supplied alongside it. */
  hospitalStayOngoing: boolean | null;
  /** Confirmed COMPLETED hospital nights. Must be a non-negative integer. */
  hospitalNights: number | null;
  /** Waiting/offset days before the benefit starts paying. Zero is valid. */
  offsetDays: number | null;
  /** Maximum number of payable days. */
  maximumDays: number | null;
  /** The owned contract/coverage this benefit is mapped to. Absent blocks. */
  ownership: HospitalCashOwnershipRef | null;
  /** Where the payout rule itself (rate, waiting period, day cap) was read
   * and verified. Absent blocks. */
  ruleEvidence: HospitalCashEvidenceRef | null;
  /** Where ownership of the policy was verified. Absent blocks. */
  ownershipEvidence: HospitalCashEvidenceRef | null;
  /** Any policy condition still requiring resolution before this benefit's
   * amount can be shown (e.g. an insurer-only definitional confirmation).
   * A non-empty list blocks. */
  unresolvedConditions?: string[];
};

export type HospitalCashBlockReasonCode =
  | "STAY_ONGOING"
  | "INVALID_HOSPITAL_NIGHTS"
  | "INVALID_DAILY_RATE"
  | "INVALID_OFFSET_DAYS"
  | "MISSING_MAXIMUM_DAYS"
  | "INVALID_CURRENCY"
  | "MISSING_OWNERSHIP_MAPPING"
  | "MISSING_RULE_EVIDENCE"
  | "MISSING_OWNERSHIP_EVIDENCE"
  | "UNRESOLVED_CONDITION";

export type HospitalCashBlocked = {
  status: "blocked";
  reasonCode: HospitalCashBlockReasonCode;
  message: string;
};

type HospitalCashComputedFields = {
  currency: string;
  dailyRate: number;
  reportedHospitalNights: number;
  offsetDays: number;
  maximumPayableDays: number;
  payableDays: number;
  /** Human-readable explanation of the arithmetic actually performed. */
  formula: string;
  ruleEvidence: HospitalCashEvidenceRef;
  ownershipEvidence: HospitalCashEvidenceRef;
  ownership: HospitalCashOwnershipRef;
  /** SHA-256 digest (prefix "hc:") over every material input field --
   * exactly the lib/claims/calculators/critical-illness.ts pattern. A
   * presentation-only change (e.g. relabeling `ownership.label`) never
   * changes this; any change to a figure the arithmetic actually used
   * always does. Optional so every pre-existing caller (lib/chat/
   * policy-analysis.ts, lib/ledger/answer.ts) that destructures only the
   * fields it already knew about keeps compiling unchanged. */
  calculationId: string;
};

export type HospitalCashCalculated = HospitalCashComputedFields & {
  status: "calculated";
  potentialAmount: number;
};

/** payableDays resolved to zero (e.g. the waiting period was never cleared).
 * Never represented as a $0 payout -- the benefit simply does not apply to
 * the reported stay. */
export type HospitalCashNotApplicable = HospitalCashComputedFields & {
  status: "not_applicable";
  potentialAmount: null;
};

export type HospitalCashResult = HospitalCashCalculated | HospitalCashNotApplicable | HospitalCashBlocked;

const ISO_CURRENCY = /^[A-Z]{3}$/;

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

export function calculateHospitalCash(input: HospitalCashInput): HospitalCashResult {
  if (input.hospitalStayOngoing === true) {
    return {
      status: "blocked",
      reasonCode: "STAY_ONGOING",
      message: "The hospital stay is still ongoing. This benefit may apply, but a potential amount needs the completed length of stay.",
    };
  }
  if (!isNonNegativeInteger(input.hospitalNights)) {
    return {
      status: "blocked",
      reasonCode: "INVALID_HOSPITAL_NIGHTS",
      message: "The number of completed hospital nights is missing, negative, or not a whole number.",
    };
  }
  if (typeof input.dailyRate !== "number" || !Number.isFinite(input.dailyRate) || input.dailyRate <= 0) {
    return {
      status: "blocked",
      reasonCode: "INVALID_DAILY_RATE",
      message: "The verified daily rate for this benefit is missing or invalid.",
    };
  }
  if (!isNonNegativeInteger(input.offsetDays)) {
    return {
      status: "blocked",
      reasonCode: "INVALID_OFFSET_DAYS",
      message: "The waiting period (offset days) is missing or invalid.",
    };
  }
  if (!isNonNegativeInteger(input.maximumDays)) {
    return {
      status: "blocked",
      reasonCode: "MISSING_MAXIMUM_DAYS",
      message: "The maximum number of payable days is missing or invalid.",
    };
  }
  if (typeof input.currency !== "string" || !ISO_CURRENCY.test(input.currency)) {
    return {
      status: "blocked",
      reasonCode: "INVALID_CURRENCY",
      message: "This benefit does not have a verified ISO currency.",
    };
  }
  if (!input.ownership || !input.ownership.contractId) {
    return {
      status: "blocked",
      reasonCode: "MISSING_OWNERSHIP_MAPPING",
      message: "This benefit is not explicitly mapped to an owned policy contract.",
    };
  }
  if (!input.ruleEvidence) {
    return {
      status: "blocked",
      reasonCode: "MISSING_RULE_EVIDENCE",
      message: "The payout rule (rate, waiting period, day cap) has no evidence reference.",
    };
  }
  if (!input.ownershipEvidence) {
    return {
      status: "blocked",
      reasonCode: "MISSING_OWNERSHIP_EVIDENCE",
      message: "Ownership of this policy has no evidence reference.",
    };
  }
  if (input.unresolvedConditions?.length) {
    return {
      status: "blocked",
      reasonCode: "UNRESOLVED_CONDITION",
      message: "A required policy condition is still unresolved: " + input.unresolvedConditions[0],
    };
  }

  const hospitalNights = input.hospitalNights;
  const offsetDays = input.offsetDays;
  const maximumDays = input.maximumDays;

  // Integer minor units (cents) throughout, so repeated or large
  // calculations never accumulate floating-point drift.
  const dailyRateMinor = Math.round(input.dailyRate * 100);
  const payableDays = Math.min(maximumDays, Math.max(0, hospitalNights - offsetDays));
  const potentialAmountMinor = payableDays * dailyRateMinor;
  const dailyRate = dailyRateMinor / 100;

  const calculationId = "hc:" + createHash("sha256").update(JSON.stringify([
    input.currency, dailyRateMinor, hospitalNights, offsetDays, maximumDays,
    input.ownership, input.ruleEvidence, input.ownershipEvidence,
  ])).digest("hex");

  const common: HospitalCashComputedFields = {
    currency: input.currency,
    dailyRate,
    reportedHospitalNights: hospitalNights,
    offsetDays,
    maximumPayableDays: maximumDays,
    payableDays,
    formula:
      `payableDays = min(${maximumDays}, max(0, ${hospitalNights} - ${offsetDays})) = ${payableDays}; ` +
      `potentialAmount = ${payableDays} x ${dailyRate.toFixed(2)} ${input.currency} = ${(potentialAmountMinor / 100).toFixed(2)} ${input.currency}`,
    ruleEvidence: input.ruleEvidence,
    ownershipEvidence: input.ownershipEvidence,
    ownership: input.ownership,
    calculationId,
  };

  if (payableDays === 0) {
    return { status: "not_applicable", potentialAmount: null, ...common };
  }

  return { status: "calculated", potentialAmount: potentialAmountMinor / 100, ...common };
}
