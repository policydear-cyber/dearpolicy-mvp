/**
 * Pure, deterministic day-count arithmetic for hospital/ICU per-diem
 * benefits. This is the ONLY place DearPolicy turns a pair of admission/
 * discharge timestamps into a payable-day count -- lib/claims/calculators/
 * hospital-cash.ts still owns the final rate x days arithmetic and its own
 * fail-closed validation; this module only resolves "how many days" under
 * an EVIDENCED policy day-count rule, never a default guess.
 *
 * All timestamps are ISO 8601 strings with an explicit offset (or "Z").
 * DearPolicy never assumes a timezone: a timestamp with no offset is
 * rejected (blocked upstream), not silently treated as UTC or local time.
 * Calendar-day counting always uses the UTC calendar date, so two
 * evidenced admission/discharge instants at the exact same day-count rule
 * always produce the same day count no matter which timezone offset the
 * hospital happened to record them in.
 */

export const DAY_COUNT_RULES = [
  "calendar_day",
  "completed_24h_period",
] as const;
export type DayCountRule = (typeof DAY_COUNT_RULES)[number];

export type DayCountEdgeInclusion = {
  /** Whether the admission day itself counts as a payable day. */
  admissionDayIncluded: boolean;
  /** Whether the discharge day itself counts as a payable day. */
  dischargeDayIncluded: boolean;
};

/** One continuous ICU period within the same admission. `dischargeISO` is
 * null only when the ICU period is itself still ongoing (which forces the
 * whole calculation to block upstream, exactly like an ongoing hospital
 * stay -- see hospital-cash.ts's STAY_ONGOING branch). */
export type IcuPeriod = { admissionISO: string; dischargeISO: string | null };

export type DayCountInput = {
  admissionISO: string | null;
  /** null while the stay is still ongoing. */
  dischargeISO: string | null;
  rule: DayCountRule | null;
  edgeInclusion: DayCountEdgeInclusion | null;
  /** Every ICU period within this admission, evidenced from the reviewed
   * discharge summary/doctor memo. Empty array (not null) when the stay
   * had no ICU component. */
  icuPeriods: IcuPeriod[];
  /** "replacing": an ICU day is never also counted as an ordinary ward day
   * (the two totals are mutually exclusive, evidenced policy wording).
   * "adding": an ICU day counts once toward the ICU total AND once toward
   * the ordinary ward total (two separate benefits both pay for it).
   * null blocks whenever icuPeriods is non-empty -- DearPolicy never
   * guesses which regime applies. */
  icuMode: "replacing" | "adding" | null;
  /** Waiting/deferred days before EITHER benefit starts paying, evidenced
   * from policy wording. Zero is a valid, explicit answer. */
  waitingDays: number | null;
};

export type DayCountBlockReasonCode =
  | "MISSING_ADMISSION_DATE"
  | "STAY_ONGOING"
  | "INVALID_DATE_RANGE"
  | "MISSING_TIMEZONE_OFFSET"
  | "MISSING_DAY_COUNT_RULE"
  | "MISSING_EDGE_INCLUSION"
  | "MISSING_ICU_MODE"
  | "INVALID_ICU_PERIOD"
  | "MISSING_WAITING_DAYS";

export type DayCountBlocked = { status: "blocked"; reasonCode: DayCountBlockReasonCode; message: string };
export type DayCountResult = {
  status: "calculated";
  /** Total nights counted at the hospital, per the evidenced rule, BEFORE
   * waiting days and BEFORE the ICU replace/add adjustment below. */
  grossNights: number;
  /** Ordinary-ward payable nights: ICU nights subtracted out when
   * icuMode === "replacing"; unchanged when "adding" or when there was no
   * ICU period at all. Waiting days already subtracted. */
  wardNights: number;
  /** ICU payable nights (0 when there was no ICU period). Waiting days are
   * only subtracted from wardNights, never twice -- an ICU stay that
   * itself starts within the waiting window is unaffected here, since
   * hospital-cash.ts's own offsetDays handling on the ward side is what
   * already accounts for the waiting period against the admission as a
   * whole. */
  icuNights: number;
} | DayCountBlocked;

const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;

function parseIsoWithOffset(value: string): Date | null {
  if (!OFFSET_RE.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function utcCalendarDate(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Nights between two instants under one rule, ignoring edge inclusion --
 * edge inclusion is applied once, to the OUTER admission/discharge range,
 * by the caller (computeHospitalDays), not re-applied per ICU sub-period,
 * so a multi-period stay never double-counts a shared boundary night. */
function rawNights(rule: DayCountRule, startMs: number, endMs: number): number {
  if (rule === "completed_24h_period") {
    return Math.floor((endMs - startMs) / MS_PER_DAY);
  }
  // calendar_day: count distinct UTC calendar dates spanned, minus one
  // (a same-day admission and discharge spans 1 calendar date -> 0 nights
  // unless the rule's edge inclusion says otherwise).
  const startDate = utcCalendarDate(new Date(startMs));
  const endDate = utcCalendarDate(new Date(endMs));
  return Math.round((endDate - startDate) / MS_PER_DAY);
}

export function computeHospitalDays(input: DayCountInput): DayCountResult {
  if (!input.admissionISO) return { status: "blocked", reasonCode: "MISSING_ADMISSION_DATE", message: "The admission date/time is missing." };
  if (input.dischargeISO === null) return { status: "blocked", reasonCode: "STAY_ONGOING", message: "The hospital stay is still ongoing. A day count needs a completed stay." };
  const admission = parseIsoWithOffset(input.admissionISO);
  if (!admission) return { status: "blocked", reasonCode: "MISSING_TIMEZONE_OFFSET", message: "The admission date/time has no explicit timezone offset." };
  const discharge = parseIsoWithOffset(input.dischargeISO);
  if (!discharge) return { status: "blocked", reasonCode: "MISSING_TIMEZONE_OFFSET", message: "The discharge date/time has no explicit timezone offset." };
  if (discharge.getTime() < admission.getTime()) return { status: "blocked", reasonCode: "INVALID_DATE_RANGE", message: "The discharge date/time is before the admission date/time." };
  if (!input.rule) return { status: "blocked", reasonCode: "MISSING_DAY_COUNT_RULE", message: "The policy's day-count rule (calendar day vs. completed 24-hour period) has not been evidenced." };
  if (!input.edgeInclusion) return { status: "blocked", reasonCode: "MISSING_EDGE_INCLUSION", message: "Whether the admission/discharge day itself is payable has not been evidenced." };
  if (!isNonNegativeInteger(input.waitingDays)) return { status: "blocked", reasonCode: "MISSING_WAITING_DAYS", message: "The waiting period (in days) has not been evidenced." };

  // calendar_day's rawNights() (endDate - startDate, in UTC calendar
  // dates) already equals the "exactly one edge day included" count -- the
  // conventional default (the patient occupies the bed through the night
  // of admission but not the night after discharge, or vice versa; both
  // give the same total). Both edges included adds the excluded date back
  // in; neither included removes the remaining one. completed_24h_period
  // has no edge-inclusion concept at all (a period is a period), so
  // edgeInclusion is validated as present above but only ever consulted
  // for calendar_day.
  let grossNights = rawNights(input.rule, admission.getTime(), discharge.getTime());
  if (input.rule === "calendar_day") {
    const bothIncluded = input.edgeInclusion.admissionDayIncluded && input.edgeInclusion.dischargeDayIncluded;
    const neitherIncluded = !input.edgeInclusion.admissionDayIncluded && !input.edgeInclusion.dischargeDayIncluded;
    if (bothIncluded) grossNights += 1;
    else if (neitherIncluded) grossNights = Math.max(0, grossNights - 1);
  }
  grossNights = Math.max(0, grossNights);

  let icuNights = 0;
  if (input.icuPeriods.length > 0) {
    if (!input.icuMode) return { status: "blocked", reasonCode: "MISSING_ICU_MODE", message: "Whether ICU days replace or add to ordinary hospital days has not been evidenced." };
    for (const period of input.icuPeriods) {
      if (period.dischargeISO === null) return { status: "blocked", reasonCode: "STAY_ONGOING", message: "An ICU period within this admission is still ongoing." };
      const icuStart = parseIsoWithOffset(period.admissionISO);
      const icuEnd = parseIsoWithOffset(period.dischargeISO);
      if (!icuStart || !icuEnd) return { status: "blocked", reasonCode: "MISSING_TIMEZONE_OFFSET", message: "An ICU period's date/time has no explicit timezone offset." };
      if (icuEnd.getTime() < icuStart.getTime() || icuStart.getTime() < admission.getTime() || icuEnd.getTime() > discharge.getTime()) {
        return { status: "blocked", reasonCode: "INVALID_ICU_PERIOD", message: "An ICU period falls outside the reported admission/discharge range." };
      }
      icuNights += Math.max(0, rawNights(input.rule, icuStart.getTime(), icuEnd.getTime()));
    }
  }

  const waitingDays = input.waitingDays;
  const wardGross = input.icuMode === "replacing" ? Math.max(0, grossNights - icuNights) : grossNights;
  const wardNights = Math.max(0, wardGross - waitingDays);

  return { status: "calculated", grossNights, wardNights, icuNights };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}
