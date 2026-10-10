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
  /** A timestamp that is not a real calendar date / time of day / UTC offset (2026-02-30, 24:00, +25:00). */
  | "INVALID_DATE"
  /** Two stated admission (or discharge) day exceptions that say different things. */
  | "CONFLICTING_DAY_EXCEPTION"
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

/** Days in a month of the proleptic Gregorian calendar (leap years: divisible by 4, except centuries not divisible by 400). */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
/** A real calendar date "YYYY-MM-DD" (2026-02-30 and 2026-13-01 are not; 2028-02-29 is). */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}
const ISO_FULL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):?(\d{2}))$/;
/** Why an ISO 8601 timestamp with an offset is not a real instant (null when it is): the calendar date must exist, the
 * time be 00:00:00-23:59:59 and the offset within -12:00..+14:00 with minutes 00-59. JavaScript's Date would otherwise
 * roll 2026-02-30 over to 2 March. */
export function isoInstantProblem(value: string): string | null {
  const m = ISO_FULL.exec(value ?? "");
  if (!m) return OFFSET_RE.test(value ?? "") ? `“${value}” is not a date and time` : `“${value}” has no UTC offset`;
  if (!isCalendarDate(m[1])) return `${m[1]} is not a calendar date`;
  const hh = Number(m[2]), mm = Number(m[3]), ss = m[4] == null ? 0 : Number(m[4]);
  if (hh > 23 || mm > 59 || ss > 59) return `${m[2]}:${m[3]}${m[4] ? ":" + m[4] : ""} is not a time of day`;
  if (m[5] !== "Z") {
    const oh = Number(m[7]), om = Number(m[8]), off = (m[6] === "-" ? -1 : 1) * (oh * 60 + om);
    if (om > 59 || off < -12 * 60 || off > 14 * 60) return `${m[5]} is not a UTC offset`;
  }
  return null;
}
function parseIsoWithOffset(value: string): Date | null {
  if (!OFFSET_RE.test(value)) return null;
  if (isoInstantProblem(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** The blocked result for a timestamp that is missing its offset, or is not a real instant. */
function badInstant(which: string, value: string): DayCountBlocked {
  if (!OFFSET_RE.test(value)) return { status: "blocked", reasonCode: "MISSING_TIMEZONE_OFFSET", message: `The ${which} date/time has no explicit timezone offset.` };
  return { status: "blocked", reasonCode: "INVALID_DATE", message: `The ${which} date/time is not valid: ${isoInstantProblem(value) ?? value}.` };
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
  if (!admission) return badInstant("admission", input.admissionISO);
  const discharge = parseIsoWithOffset(input.dischargeISO);
  if (!discharge) return badInstant("discharge", input.dischargeISO);
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
      if (!icuStart) return badInstant("ICU admission", period.admissionISO);
      if (!icuEnd) return badInstant("ICU discharge", period.dischargeISO);
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
/** completed_24h_remainder: each complete 24 hours is a day, and a remaining part of at least `remainderHours` counts as one
 * more day ("Any remaining period of 12 hours or more counts as one further day"). */
export type PolicyDayRule = "first_full_day" | "completed_24h" | "completed_24h_remainder" | "per_night" | "calendar_day_inclusive";

const RULE_WORDING: [PolicyDayRule, RegExp][] = [
  ["first_full_day", /\bfirst\s+(?:full|complete|whole)\s+(?:calendar\s+)?day\b|\b(?:each|every|per)\s+(?:full|complete|whole)\s+(?:calendar\s+)?day\b/i],
  ["completed_24h", /\b(?:each|every|per)\s+(?:complete(?:d)?\s+|full\s+|continuous\s+)?(?:period\s+of\s+)?(?:24|twenty[- ]four)(?:[- ]hours?|\s+(?:consecutive|continuous)\s+hours?)\b|\bcomplete(?:d)?\s+(?:period\s+of\s+)?(?:24|twenty[- ]four)(?:[- ]hours?|\s+(?:consecutive|continuous)\s+hours?)\b/i],
  ["per_night", /\b(?:each|every|per)\s+night\b|\bnights?\s+(?:spent|stayed)\s+in\s+hospital\b|\bper\s+overnight\b/i],
  ["calendar_day_inclusive", /\b(?:each|every|per)\s+(?:calendar\s+)?day\s+or\s+part\s+(?:of\s+a\s+day|thereof)\b|\bpart\s+of\s+a\s+day\s+(?:counts|is\s+counted)\s+as\s+a\s+(?:full\s+)?day\b/i],
];
/** A remaining part of a day that counts as one more day ("Any remaining period of 12 hours or more counts as one further
 * day", "plus one more day if the remainder is 12 hours or more"): the hours. */
const REMAINDER_WORDING: RegExp[] = [
  /\b(?:remaining|remainder|balance|residual)(?:\s+(?:period|part|portion|time))?(?:\s+of)?\s+(\d{1,2})\s+(?:consecutive\s+)?hours?\s+or\s+(?:more|longer)\s+(?:counts?|is\s+counted|shall\s+count|will\s+count|is\s+treated|shall\s+be\s+counted)\s+as\s+(?:one\s+|a\s+|an\s+)?(?:further|additional|another|extra|more|full)?\s*(?:full\s+)?day\b/i,
  /\b(?:plus\s+)?(?:one\s+more|a\s+further|an\s+additional|another|one\s+further|one\s+additional)\s+day\s+(?:if|where|when)\s+the\s+(?:remainder|remaining\s+(?:period|part|time)|balance)\s+is\s+(\d{1,2})\s+hours?\s+or\s+(?:more|longer)\b/i,
];
export type DayRuleWording = { rule: PolicyDayRule; words: string; remainderHours?: number };
/** The day-count rule `text` states, with the matched words; null when it states none (or states two different ones).
 * A remainder clause refines a complete-24-hours rule stated in the same text (completed_24h_remainder); a remainder
 * clause without a 24-hour period is not a rule on its own. */
export function dayRuleFromWording(text: string): DayRuleWording | null {
  const found: DayRuleWording[] = RULE_WORDING.map(([rule, re]) => { const m = re.exec(text ?? ""); return m ? { rule, words: m[0] } : null; }).filter((x): x is { rule: PolicyDayRule; words: string } => !!x);
  const rem = REMAINDER_WORDING.map((re) => re.exec(text ?? "")).filter((m): m is RegExpExecArray => !!m);
  const hours = new Set(rem.map((m) => Number(m[1])));
  if (rem.length && found.some((f) => f.rule === "completed_24h")) {
    if (hours.size !== 1) return null;
    const h = [...hours][0];
    if (!(h > 0 && h < 24)) return null;
    const rest = found.filter((f) => f.rule !== "completed_24h");
    if (rest.length) return null;
    return { rule: "completed_24h_remainder", words: (text ?? "").trim(), remainderHours: h };
  }
  const rules = new Set(found.map((f) => f.rule));
  return rules.size === 1 ? found[0] : null;
}
/** A remainder clause on its own (no 24-hour period in the same text): the hours, else null (terms.ts joins it to the
 * complete-24-hours sentence before it). */
export function remainderHoursIn(text: string): number | null {
  const m = REMAINDER_WORDING.map((re) => re.exec(text ?? "")).find(Boolean);
  return m ? Number(m[1]) : null;
}
/** Integration (D30): an exception the wording states for the admission or discharge day of a calendar-day rule, e.g.
 * "The day of admission counts as a full day only if admission is before 12:00 noon" -> admission, before, 720 min.
 * `minutes` is the local time of day (the hospital's recorded offset). `when` keeps the wording's own comparison:
 * "before" / "earlier than" exclude the stated time; "on or before" / "by" / "not later than" include it; "after" /
 * "later than" exclude it; "on or after" / "at or after" / "not earlier than" include it. */
export type DayEdgeWhen = "before" | "on_or_before" | "after" | "on_or_after";
export type DayEdgeException = { edge: "admission" | "discharge"; when: DayEdgeWhen; minutes: number };
export const DAY_EDGE_WHEN: readonly DayEdgeWhen[] = ["before", "on_or_before", "after", "on_or_after"];
const TIME_RE = String.raw`(?:(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?|noon|midday|hrs|hours)?|(noon|midday|midnight))`;
const EDGE_DAY = /\b(?:(?:the\s+)?day\s+of\s+(admission|discharge)|(admission|discharge)\s+day)\b/i;
const FULL_DAY = /\b(?:counts?|counted|is\s+treated|treated|is\s+regarded|regarded|is\s+considered|considered|will\s+count)\s+as\s+(?:a\s+)?(?:full|whole|complete)\s+day\b/i;
/** The comparison words, longest first ("on or before" before "before"). */
const WHEN_WORDS: [RegExp, DayEdgeWhen][] = [
  [/(?:on|at)\s+or\s+before|not\s+later\s+than|no\s+later\s+than|at\s+the\s+latest\s+by|by/, "on_or_before"],
  [/(?:on|at)\s+or\s+after|not\s+earlier\s+than|no\s+earlier\s+than/, "on_or_after"],
  [/before|earlier\s+than|prior\s+to/, "before"],
  [/after|later\s+than/, "after"],
];
const WHEN_TIME = new RegExp(String.raw`\b(` + WHEN_WORDS.map(([re]) => re.source).join("|") + String.raw`)\s+(?:(?:the|a)\s+)?` + TIME_RE, "i");
function whenOf(words: string): DayEdgeWhen {
  const w = words.toLowerCase().replace(/\s+/g, " ").trim();
  for (const [re, when] of WHEN_WORDS) if (new RegExp(`^(?:${re.source})$`).test(w)) return when;
  return "before";
}
function minutesOf(m: RegExpExecArray, at: number): number | null {
  const word = (m[at + 3] ?? m[at + 2] ?? "").toLowerCase().replace(/\./g, "");
  if (m[at + 3]) return m[at + 3].toLowerCase() === "midnight" ? 0 : 720;
  if (m[at] == null) return null;
  let h = Number(m[at]); const min = m[at + 1] ? Number(m[at + 1]) : 0;
  if (h > 24 || min > 59) return null;
  if (word === "noon" || word === "midday") { if (h !== 12) return null; }
  else if (word === "pm" && h < 12) h += 12;
  else if (word === "am" && h === 12) h = 0;
  if (h * 60 + min > 1440) return null;
  return h * 60 + min;
}
/** The admission / discharge day exceptions a passage states (each sentence read on its own); none when it states none.
 * The same exception stated twice is returned once. */
export function dayEdgeExceptionsFromWording(text: string): DayEdgeException[] {
  const out: DayEdgeException[] = [];
  for (const sentence of (text ?? "").split(/(?<=\.)\s+|\n+/)) {
    const d = EDGE_DAY.exec(sentence), full = FULL_DAY.test(sentence), w = WHEN_TIME.exec(sentence);
    if (!d || !full || !w) continue;
    if (/\bnot\s+(?:be\s+)?(?:count|counted|treated|regarded|considered)\b/i.test(sentence)) continue;
    const minutes = minutesOf(w, 2); if (minutes == null) continue;
    const e: DayEdgeException = { edge: (d[1] ?? d[2]).toLowerCase() as "admission" | "discharge", when: whenOf(w[1]), minutes };
    if (!out.some((x) => sameDayEdge(x, e))) out.push(e);
  }
  return out;
}
/** Two exceptions that say the same thing (same day, same comparison, same time). */
export function sameDayEdge(a: DayEdgeException, b: DayEdgeException): boolean {
  return a.edge === b.edge && a.when === b.when && a.minutes === b.minutes;
}
/** Exceptions with the duplicates removed, or the conflict: the same day given two different exceptions (never resolved
 * here by picking one -- the caller resolves it from document scope / version, or withholds the count). */
export function distinctDayEdges(edges: DayEdgeException[]): { edges: DayEdgeException[] } | { conflict: DayEdgeException[] } | { invalid: unknown } {
  const out: DayEdgeException[] = [];
  for (const e of edges) {
    if (!e || (e.edge !== "admission" && e.edge !== "discharge") || !DAY_EDGE_WHEN.includes(e.when) || !Number.isInteger(e.minutes) || e.minutes < 0 || e.minutes > 1440) return { invalid: e };
    if (!out.some((x) => sameDayEdge(x, e))) out.push(e);
  }
  for (const edge of ["admission", "discharge"] as const) { const same = out.filter((x) => x.edge === edge); if (same.length > 1) return { conflict: same }; }
  return { edges: out };
}
/** Whether a local time of day (seconds since local midnight) meets an exception's comparison with its stated time. */
export function meetsDayEdge(e: DayEdgeException, localSeconds: number): boolean {
  const at = e.minutes * 60;
  switch (e.when) {
    case "before": return localSeconds < at;
    case "on_or_before": return localSeconds <= at;
    case "after": return localSeconds > at;
    case "on_or_after": return localSeconds >= at;
  }
}
/** Seconds since local midnight, at the offset the timestamp was recorded in (null when it has no valid time). */
const localSeconds = (iso: string | null) => { const m = ISO_FULL.exec(iso ?? ""); return m ? Number(m[2]) * 3600 + Number(m[3]) * 60 + (m[4] ? Number(m[4]) : 0) : null; };
/** Whether a rule needs the admission and discharge TIMES (not only the dates). */
export function dayRuleNeedsTimes(rule: PolicyDayRule): boolean {
  return rule === "first_full_day" || rule === "completed_24h" || rule === "completed_24h_remainder";
}
const atLocalMidnight = (iso: string | null) => localSeconds(iso) === 0 && !/\.\d*[1-9]/.test(iso ?? "");
/** Payable days under a policy's rule, through computeHospitalDays (waiting days are applied by the hospital-cash
 * calculator's own offset, so 0 here). Calendar dates are the hospital's local dates (the recorded offset). */
export function payableDaysUnderRule(rule: PolicyDayRule, admissionISO: string | null, dischargeISO: string | null, edges: DayEdgeException[] = [], opts: { remainderHours?: number | null } = {}): DayCountResult {
  if (rule === "completed_24h_remainder") return completedWithRemainder(admissionISO, dischargeISO, opts.remainderHours ?? null);
  const r0 = payableDaysUnderRuleBase(rule, admissionISO, dischargeISO);
  if (r0.status !== "calculated" || rule !== "first_full_day" || !edges.length) return r0;
  // Stated exceptions for the admission / discharge day (first-full-day wording only, where those days are otherwise
  // never counted). The same exception stated twice counts once; two different exceptions for one day are a conflict.
  const d = distinctDayEdges(edges);
  if ("invalid" in d) return { status: "blocked", reasonCode: "MISSING_EDGE_INCLUSION", message: `an admission / discharge day exception is not one the wording can state: ${JSON.stringify(d.invalid)}` };
  if ("conflict" in d) return { status: "blocked", reasonCode: "CONFLICTING_DAY_EXCEPTION", message: `the wording states different exceptions for the day of ${d.conflict[0]?.edge ?? "admission or discharge"}, and which one applies is not established` };
  // A same-day stay has no separate edge days.
  const sameDay = (admissionISO ?? "").slice(0, 10) === (dischargeISO ?? "").slice(0, 10);
  if (sameDay) return r0;
  let extra = 0;
  for (const e of d.edges) {
    const t = localSeconds(e.edge === "admission" ? admissionISO : dischargeISO);
    if (t == null) return { status: "blocked", reasonCode: "MISSING_EDGE_INCLUSION", message: `the ${e.edge} time is needed: the wording counts the day of ${e.edge} as a full day only ${e.when.replace(/_/g, " ")} a stated time` };
    // An admission at local midnight on an earlier date than the discharge already makes that day a complete day.
    if (e.edge === "admission" && atLocalMidnight(admissionISO)) continue;
    if (meetsDayEdge(e, t)) extra++;
  }
  return extra ? { ...r0, grossNights: r0.grossNights + extra, wardNights: r0.wardNights + extra } : r0;
}
/** Each complete 24 hours from admission is a day; the remaining part counts as one more day when it is at least
 * `remainderHours` (a stay shorter than that counts no day). Both instants need their UTC offset. */
function completedWithRemainder(admissionISO: string | null, dischargeISO: string | null, remainderHours: number | null): DayCountResult {
  if (remainderHours == null || !(remainderHours > 0 && remainderHours < 24)) return { status: "blocked", reasonCode: "MISSING_DAY_COUNT_RULE", message: "the wording's remainder (the hours that count as one more day) is not stated" };
  if (!admissionISO) return { status: "blocked", reasonCode: "MISSING_ADMISSION_DATE", message: "the admission date and time are needed" };
  if (!dischargeISO) return { status: "blocked", reasonCode: "STAY_ONGOING", message: "the discharge date and time are needed" };
  const a = parseIsoWithOffset(admissionISO), d = parseIsoWithOffset(dischargeISO);
  if (!a) return badInstant("admission", admissionISO);
  if (!d) return badInstant("discharge", dischargeISO);
  const ms = d.getTime() - a.getTime();
  if (ms < 0) return { status: "blocked", reasonCode: "INVALID_DATE_RANGE", message: "the discharge is before the admission" };
  // Whole seconds (a remainder one second short of the stated hours does not count).
  const seconds = Math.floor(ms / 1000);
  const full = Math.floor(seconds / 86_400), rest = seconds - full * 86_400;
  const days = full + (rest >= remainderHours * 3600 ? 1 : 0);
  return { status: "calculated", grossNights: days, wardNights: days, icuNights: 0 };
}
/** The local calendar date (YYYY-MM-DD, as a day number) of a valid timestamp at the offset it was recorded in. */
const localDayNumber = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d) / MS_PER_DAY; };
/** first_full_day: the local calendar days lying wholly inside the stay -- from a local midnight at or after admission
 * to the next local midnight at or before discharge. A stay that never contains a whole day counts 0, whatever time it
 * starts (00:00 -> 01:00 the same day is 0; 00:00 to 00:00 the next day is 1). */
function wholeLocalDays(admissionISO: string, dischargeISO: string): number {
  const first = localDayNumber(admissionISO) + (atLocalMidnight(admissionISO) ? 0 : 1);
  const endMidnight = localDayNumber(dischargeISO); // the last local midnight at or before discharge
  return Math.max(0, endMidnight - first);
}
function payableDaysUnderRuleBase(rule: Exclude<PolicyDayRule, "completed_24h_remainder">, admissionISO: string | null, dischargeISO: string | null): DayCountResult {
  const map: Record<Exclude<PolicyDayRule, "completed_24h_remainder">, { rule: DayCountRule; edge: DayCountEdgeInclusion }> = {
    first_full_day: { rule: "calendar_day", edge: { admissionDayIncluded: false, dischargeDayIncluded: false } },
    completed_24h: { rule: "completed_24h_period", edge: { admissionDayIncluded: false, dischargeDayIncluded: false } },
    per_night: { rule: "calendar_day", edge: { admissionDayIncluded: true, dischargeDayIncluded: false } },
    calendar_day_inclusive: { rule: "calendar_day", edge: { admissionDayIncluded: true, dischargeDayIncluded: true } },
  };
  const m = map[rule];
  // A date without a time is enough only for a rule that counts calendar dates (each night, day or part of a day):
  // it is read as that local date (noon UTC keeps the date whatever the offset). The other rules need the times.
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
  if (rule === "per_night" || rule === "calendar_day_inclusive") {
    for (const [which, v] of [["admission", admissionISO], ["discharge", dischargeISO]] as const) if (v && DATE_ONLY.test(v) && !isCalendarDate(v)) return { status: "blocked", reasonCode: "INVALID_DATE", message: `The ${which} date is not valid: ${v} is not a calendar date.` };
    if (admissionISO && DATE_ONLY.test(admissionISO)) admissionISO += "T12:00Z";
    if (dischargeISO && DATE_ONLY.test(dischargeISO)) dischargeISO += "T12:00Z";
  }
  const r = computeHospitalDays({ admissionISO, dischargeISO, rule: m.rule, edgeInclusion: m.edge, icuPeriods: [], icuMode: null, waitingDays: 0, calendarBasis: "recorded_offset" });
  if (r.status !== "calculated" || rule !== "first_full_day") return r;
  const n = wholeLocalDays(admissionISO!, dischargeISO!);
  return { ...r, grossNights: n, wardNights: n };
}
