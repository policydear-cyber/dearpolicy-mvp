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
  /** Additive: which calendar a calendar_day count uses. "utc" (the default, unchanged) counts UTC calendar dates;
   * "recorded_offset" counts the calendar dates at the offset each timestamp was recorded in (the hospital's local
   * dates -- a Singapore admission at 01:00 +08:00 is on that local date, not the previous UTC date). */
  calendarBasis?: "utc" | "recorded_offset";
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
/** Minutes east of UTC an ISO timestamp was recorded at ("Z" = 0). */
export function recordedOffsetMinutes(iso: string): number | null {
  const m = OFFSET_RE.exec(iso);
  if (!m) return null;
  if (m[1] === "Z") return 0;
  const t = m[1].replace(":", "");
  const sign = t[0] === "-" ? -1 : 1;
  return sign * (Number(t.slice(1, 3)) * 60 + Number(t.slice(3, 5)));
}
/** The calendar date (as a UTC-midnight ms value) of an instant at a fixed offset. */
function calendarDateAt(ms: number, offsetMinutes: number): number {
  return utcCalendarDate(new Date(ms + offsetMinutes * 60_000));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Nights between two instants under one rule, ignoring edge inclusion --
 * edge inclusion is applied once, to the OUTER admission/discharge range,
 * by the caller (computeHospitalDays), not re-applied per ICU sub-period,
 * so a multi-period stay never double-counts a shared boundary night. */
function rawNights(rule: DayCountRule, startMs: number, endMs: number, offsets: [number, number] | null = null): number {
  if (rule === "completed_24h_period") {
    return Math.floor((endMs - startMs) / MS_PER_DAY);
  }
  if (offsets) return Math.round((calendarDateAt(endMs, offsets[1]) - calendarDateAt(startMs, offsets[0])) / MS_PER_DAY);
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
  const local = input.calendarBasis === "recorded_offset";
  const offsetsOf = (a: string, b: string): [number, number] | null => (local ? [recordedOffsetMinutes(a) ?? 0, recordedOffsetMinutes(b) ?? 0] : null);
  let grossNights = rawNights(input.rule, admission.getTime(), discharge.getTime(), offsetsOf(input.admissionISO, input.dischargeISO));
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
      icuNights += Math.max(0, rawNights(input.rule, icuStart.getTime(), icuEnd.getTime(), offsetsOf(period.admissionISO, period.dischargeISO)));
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

// ---------------------------------------------------------------------------------------------------------------
// Additive: the day-count rule a policy's OWN wording states, and the payable-day count under it.
// ---------------------------------------------------------------------------------------------------------------

/** How a per-day benefit counts its days, as policy wording states it:
 *  first_full_day         "payable from the first full day of admission" -- whole local calendar days inside the stay;
 *  completed_24h          "for each complete period of 24 hours" -- completed 24-hour periods from admission;
 *  per_night              "for each night" -- local midnights spent in hospital;
 *  calendar_day_inclusive "each day or part of a day" -- every local calendar date of the stay, both ends included. */
export type PolicyDayRule = "first_full_day" | "completed_24h" | "per_night" | "calendar_day_inclusive";

const RULE_WORDING: [PolicyDayRule, RegExp][] = [
  ["first_full_day", /\bfirst\s+(?:full|complete|whole)\s+(?:calendar\s+)?day\b|\b(?:each|every|per)\s+(?:full|complete|whole)\s+(?:calendar\s+)?day\b/i],
  ["completed_24h", /\b(?:each|every|per)\s+(?:complete(?:d)?\s+|full\s+|continuous\s+)?(?:period\s+of\s+)?(?:24|twenty[- ]four)[- ]hours?\b|\bcomplete(?:d)?\s+(?:period\s+of\s+)?(?:24|twenty[- ]four)[- ]hours?\b/i],
  ["per_night", /\b(?:each|every|per)\s+night\b|\bnights?\s+(?:spent|stayed)\s+in\s+hospital\b|\bper\s+overnight\b/i],
  ["calendar_day_inclusive", /\b(?:each|every|per)\s+(?:calendar\s+)?day\s+or\s+part\s+(?:of\s+a\s+day|thereof)\b|\bpart\s+of\s+a\s+day\s+(?:counts|is\s+counted)\s+as\s+a\s+(?:full\s+)?day\b/i],
];
/** The day-count rule `text` states, with the matched words; null when it states none (or states two different ones). */
export function dayRuleFromWording(text: string): { rule: PolicyDayRule; words: string } | null {
  const found = RULE_WORDING.map(([rule, re]) => { const m = re.exec(text ?? ""); return m ? { rule, words: m[0] } : null; }).filter((x): x is { rule: PolicyDayRule; words: string } => !!x);
  const rules = new Set(found.map((f) => f.rule));
  return rules.size === 1 ? found[0] : null;
}
/** Whether a rule needs the admission and discharge TIMES (not only the dates). */
export function dayRuleNeedsTimes(rule: PolicyDayRule): boolean {
  return rule === "first_full_day" || rule === "completed_24h";
}
const LOCAL_MIDNIGHT = /T00:00(?::00(?:\.0+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
/** Payable days under a policy's rule, through computeHospitalDays (waiting days are applied by the hospital-cash
 * calculator's own offset, so 0 here). Calendar dates are the hospital's local dates (the recorded offset). */
export function payableDaysUnderRule(rule: PolicyDayRule, admissionISO: string | null, dischargeISO: string | null): DayCountResult {
  const map: Record<PolicyDayRule, { rule: DayCountRule; edge: DayCountEdgeInclusion }> = {
    first_full_day: { rule: "calendar_day", edge: { admissionDayIncluded: false, dischargeDayIncluded: false } },
    completed_24h: { rule: "completed_24h_period", edge: { admissionDayIncluded: false, dischargeDayIncluded: false } },
    per_night: { rule: "calendar_day", edge: { admissionDayIncluded: true, dischargeDayIncluded: false } },
    calendar_day_inclusive: { rule: "calendar_day", edge: { admissionDayIncluded: true, dischargeDayIncluded: true } },
  };
  const m = map[rule];
  const r = computeHospitalDays({ admissionISO, dischargeISO, rule: m.rule, edgeInclusion: m.edge, icuPeriods: [], icuMode: null, waitingDays: 0, calendarBasis: "recorded_offset" });
  if (r.status !== "calculated" || rule !== "first_full_day") return r;
  // A stay that begins exactly at local midnight makes the admission day itself a full day.
  if (admissionISO && LOCAL_MIDNIGHT.test(admissionISO)) return { ...r, grossNights: r.grossNights + 1, wardNights: r.wardNights + 1 };
  return r;
}
