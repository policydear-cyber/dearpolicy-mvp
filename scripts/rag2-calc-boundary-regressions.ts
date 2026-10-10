/**
 * Round 8e: day-count boundary defects reproduced independently (npm run rag2:calc-boundary-test).
 *
 * Every expected value below is written by hand from the policy wording and the calendar -- none is produced by the
 * implementation under test -- so a defect shared by the calculator and the save-time recompute (both call
 * lib/claims/day-count.ts) cannot pass by agreeing with itself.
 *  U  the module: zero-duration and sub-day midnight stays; one second before / at / after each boundary; complete
 *     days and valid partial-day exceptions; inclusive / exclusive noon wording; leap days and impossible dates;
 *     repeated and conflicting clauses; amendment precedence; invalid / future dates of birth; the 0-96 hour sweep.
 *  F  the full path on stored synthetic wording: wording -> extracted terms -> calculate -> saved calculation record ->
 *     recompute -> answer verification -> the answer text the household would see.
 *  V  malformed saved records (made by hand) are rejected by the save-time gate.
 * Exit 1 if any check failed.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCOUNT, DOCS, M } from "./fixtures/calc-boundary/household";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
const table: { kase: string; expected: string; actual: string }[] = [];
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log("PASS " + name); }
  catch (error) { const detail = error instanceof Error ? error.message : String(error); results.push({ name, ok: false, detail }); console.log("FAIL " + name + "\n     " + detail.split("\n").slice(0, 8).join("\n     ")); }
}
const expectRow = (kase: string, expected: unknown, actual: unknown) => { table.push({ kase, expected: String(expected), actual: String(actual) }); assert.equal(String(actual), String(expected), kase); };
const doc = (key: string) => DOCS.find((d) => d.key === key)!;
const ON = { DEARPOLICY_RAG_TOOLS: "1", NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv;

async function main() {
  const DC = await import("@/lib/claims/day-count");
  const P = await import("@/lib/claims/person");
  const TR = await import("@/lib/rag2/calc/terms");
  type Rule = import("@/lib/claims/day-count").PolicyDayRule;
  type Edge = import("@/lib/claims/day-count").DayEdgeException;
  const days = (rule: Rule, a: string, b: string, edges: Edge[] = [], opts: { remainderHours?: number } = {}) => { const r = DC.payableDaysUnderRule(rule, a, b, edges, opts); return r.status === "calculated" ? r.grossNights : r.reasonCode; };
  const NOON_BEFORE: Edge = { edge: "admission", when: "before", minutes: 720 };
  const NOON_ON_OR_BEFORE = { edge: "admission", when: "on_or_before", minutes: 720 } as Edge;

  // ------------------------------------------------------------------------------------------------ U: the module
  await check("U1 zero-duration and sub-day stays that start at local midnight count no first full day", () => {
    expectRow("A 00:00 -> 01:00 the same day (+08:00), first full day", 0, days("first_full_day", "2026-10-01T00:00:00+08:00", "2026-10-01T01:00:00+08:00"));
    expectRow("B zero-duration 00:00Z -> 00:00Z, first full day", 0, days("first_full_day", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"));
    expectRow("zero-duration at 09:00, first full day", 0, days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-01T09:00:00+08:00"));
    expectRow("00:00 -> 23:59:59 the same day", 0, days("first_full_day", "2026-10-01T00:00:00+08:00", "2026-10-01T23:59:59+08:00"));
    expectRow("00:00 -> 00:00 the next day: 1 whole day", 1, days("first_full_day", "2026-10-01T00:00:00+08:00", "2026-10-02T00:00:00+08:00"));
    expectRow("00:00:01 -> 00:00 the next day: not a whole day", 0, days("first_full_day", "2026-10-01T00:00:01+08:00", "2026-10-02T00:00:00+08:00"));
    expectRow("00:00 -> 00:00:01 the next day: 1 whole day", 1, days("first_full_day", "2026-10-01T00:00:00+08:00", "2026-10-02T00:00:01+08:00"));
    expectRow("23:59:59 -> 00:00 the next day: 0", 0, days("first_full_day", "2026-10-01T23:59:59+08:00", "2026-10-02T00:00:00+08:00"));
    expectRow("zero-duration, complete 24 hours", 0, days("completed_24h", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"));
    expectRow("zero-duration, each night", 0, days("per_night", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"));
    expectRow("zero-duration with the noon exception: a same-day stay has no edge days", 0, days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-01T09:00:00+08:00", [NOON_BEFORE]));
  });
  await check("U1b round 8f: equal timestamps never award a day under “each day or part of a day” (the times are asked for); valid same-day stays are unchanged", () => {
    expectRow("equal instants, each day or part of a day", "ZERO_LENGTH_STAY", days("calendar_day_inclusive", "2026-10-01T09:00:00+08:00", "2026-10-01T09:00:00+08:00"));
    for (const rule of ["first_full_day", "completed_24h", "per_night"] as Rule[]) expectRow(`equal instants, ${rule} (awards nothing)`, 0, days(rule, "2026-10-01T09:00:00+08:00", "2026-10-01T09:00:00+08:00"));
    expectRow("equal instants written with different offsets (09:00+08:00 = 01:00Z)", "ZERO_LENGTH_STAY", days("calendar_day_inclusive", "2026-10-01T09:00:00+08:00", "2026-10-01T01:00:00Z"));
    expectRow("equal instants, remainder rule (awards nothing)", 0, days("completed_24h_remainder", "2026-10-01T09:00:00+08:00", "2026-10-01T09:00:00+08:00", [], { remainderHours: 12 }));
    expectRow("valid same-day stay 09:00 -> 20:00, each day or part of a day", 1, days("calendar_day_inclusive", "2026-10-01T09:00:00+08:00", "2026-10-01T20:00:00+08:00"));
    expectRow("valid same-day stay 09:00 -> 20:00, each night", 0, days("per_night", "2026-10-01T09:00:00+08:00", "2026-10-01T20:00:00+08:00"));
    expectRow("valid same-day stay 09:00 -> 20:00, first full day", 0, days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-01T20:00:00+08:00"));
    expectRow("one second long, each day or part of a day", 1, days("calendar_day_inclusive", "2026-10-01T09:00:00+08:00", "2026-10-01T09:00:01+08:00"));
    expectRow("date only, same date (times not given), each day or part of a day", 1, days("calendar_day_inclusive", "2026-10-01", "2026-10-01"));
  });
  await check("U1c round 8f: elapsed rules use exact instants whatever the offsets; calendar rules ask for the hospital's time zone when the offsets differ", () => {
    // 1 Oct 01:00 +08:00 is 30 Sep 17:00Z; 3 Oct 09:00 +08:00 is 3 Oct 01:00Z: 56 hours either way.
    expectRow("complete 24h, both +08:00", 2, days("completed_24h", "2026-10-01T01:00:00+08:00", "2026-10-03T09:00:00+08:00"));
    expectRow("complete 24h, the same instants as +08:00 and Z", 2, days("completed_24h", "2026-10-01T01:00:00+08:00", "2026-10-03T01:00:00Z"));
    expectRow("complete 24h, the same instants both Z", 2, days("completed_24h", "2026-09-30T17:00:00Z", "2026-10-03T01:00:00Z"));
    expectRow("remainder 12h, mixed offsets (56 h = 2 days + 8 h)", 2, days("completed_24h_remainder", "2026-10-01T01:00:00+08:00", "2026-10-03T01:00:00Z", [], { remainderHours: 12 }));
    for (const rule of ["first_full_day", "per_night", "calendar_day_inclusive"] as Rule[]) expectRow(`${rule}, +08:00 and Z`, "MIXED_TIMEZONE_OFFSETS", days(rule, "2026-10-01T01:00:00+08:00", "2026-10-03T01:00:00Z"));
    expectRow("each night, both +08:00 (the hospital's local dates): 1, 2 Oct", 2, days("per_night", "2026-10-01T01:00:00+08:00", "2026-10-03T09:00:00+08:00"));
    expectRow("each night, both Z (UTC dates are the stated basis): 30 Sep, 1, 2 Oct", 3, days("per_night", "2026-09-30T17:00:00Z", "2026-10-03T01:00:00Z"));
    expectRow("first full day, both +08:00: 2 Oct", 1, days("first_full_day", "2026-10-01T01:00:00+08:00", "2026-10-03T09:00:00+08:00"));
    expectRow("+0800 and +08:00 are the same offset", 2, days("per_night", "2026-10-01T01:00:00+0800", "2026-10-03T09:00:00+08:00"));
  });
  await check("U2 complete calendar days are still counted (midnight admission, midnight discharge, ordinary stays)", () => {
    expectRow("1 Mar 20:00 -> 4 Mar 11:00: 2 and 3 March", 2, days("first_full_day", "2026-03-01T20:00+08:00", "2026-03-04T11:00+08:00"));
    expectRow("1 Mar 00:00 -> 4 Mar 11:00: 1, 2, 3 March", 3, days("first_full_day", "2026-03-01T00:00+08:00", "2026-03-04T11:00+08:00"));
    expectRow("1 Mar 09:00 -> 4 Mar 00:00: 2, 3 March", 2, days("first_full_day", "2026-03-01T09:00+08:00", "2026-03-04T00:00+08:00"));
    expectRow("1 Mar 00:00 -> 4 Mar 00:00: 1, 2, 3 March", 3, days("first_full_day", "2026-03-01T00:00+08:00", "2026-03-04T00:00+08:00"));
    expectRow("same local day 08:00 -> 20:00", 0, days("first_full_day", "2026-03-02T08:00+08:00", "2026-03-02T20:00+08:00"));
    expectRow("each night, 1 Mar 20:00 -> 4 Mar 11:00", 3, days("per_night", "2026-03-01T20:00+08:00", "2026-03-04T11:00+08:00"));
    expectRow("day or part of a day, same stay", 4, days("calendar_day_inclusive", "2026-03-01T20:00+08:00", "2026-03-04T11:00+08:00"));
  });
  await check("U3 one second before, at and after each boundary", () => {
    const a = "2026-03-01T08:00:00+08:00";
    expectRow("complete 24h: 23:59:59", 0, days("completed_24h", a, "2026-03-02T07:59:59+08:00"));
    expectRow("complete 24h: exactly 24:00:00", 1, days("completed_24h", a, "2026-03-02T08:00:00+08:00"));
    expectRow("complete 24h: 24:00:01", 1, days("completed_24h", a, "2026-03-02T08:00:01+08:00"));
    expectRow("remainder 12h: 1 day + 11:59:59", 1, days("completed_24h_remainder", a, "2026-03-02T19:59:59+08:00", [], { remainderHours: 12 }));
    expectRow("remainder 12h: 1 day + 12:00:00", 2, days("completed_24h_remainder", a, "2026-03-02T20:00:00+08:00", [], { remainderHours: 12 }));
    expectRow("remainder 12h: 11:59:59 alone", 0, days("completed_24h_remainder", a, "2026-03-01T19:59:59+08:00", [], { remainderHours: 12 }));
    const d = "2026-03-04T11:00:00+08:00"; // the first full days are 2 and 3 March; the admission day 1 March counts only if the exception is met
    expectRow("before noon: 11:59:59", 3, days("first_full_day", "2026-03-01T11:59:59+08:00", d, [NOON_BEFORE]));
    expectRow("before noon: 12:00:00 (exclusive)", 2, days("first_full_day", "2026-03-01T12:00:00+08:00", d, [NOON_BEFORE]));
    expectRow("before noon: 12:00:01", 2, days("first_full_day", "2026-03-01T12:00:01+08:00", d, [NOON_BEFORE]));
    expectRow("on or before noon: 11:59:59", 3, days("first_full_day", "2026-03-01T11:59:59+08:00", d, [NOON_ON_OR_BEFORE]));
    expectRow("on or before noon: 12:00:00 (inclusive)", 3, days("first_full_day", "2026-03-01T12:00:00+08:00", d, [NOON_ON_OR_BEFORE]));
    expectRow("on or before noon: 12:00:01", 2, days("first_full_day", "2026-03-01T12:00:01+08:00", d, [NOON_ON_OR_BEFORE]));
    const AFTER3 = { edge: "discharge", when: "after", minutes: 900 } as Edge, ONAFTER3 = { edge: "discharge", when: "on_or_after", minutes: 900 } as Edge;
    const a2 = "2026-03-01T20:00:00+08:00"; // full days 2, 3 March; the discharge day 4 March counts only if the exception is met
    expectRow("discharge after 3pm: 15:00:00 (exclusive)", 2, days("first_full_day", a2, "2026-03-04T15:00:00+08:00", [AFTER3]));
    expectRow("discharge after 3pm: 15:00:01", 3, days("first_full_day", a2, "2026-03-04T15:00:01+08:00", [AFTER3]));
    expectRow("discharge on or after 3pm: 14:59:59", 2, days("first_full_day", a2, "2026-03-04T14:59:59+08:00", [ONAFTER3]));
    expectRow("discharge on or after 3pm: 15:00:00 (inclusive)", 3, days("first_full_day", a2, "2026-03-04T15:00:00+08:00", [ONAFTER3]));
  });
  await check("U4 inclusive and exclusive noon wording is kept as the wording states it", () => {
    const parse = (w: string) => DC.dayEdgeExceptionsFromWording(w).map((e) => `${e.edge} ${e.when} ${e.minutes}`).join("; ");
    expectRow("“by 12 noon”", "admission on_or_before 720", parse("The admission day counts as a full day by 12 noon."));
    expectRow("“on or before 12 noon”", "admission on_or_before 720", parse("The admission day counts as a full day on or before 12 noon."));
    expectRow("“at or before 12:00”", "admission on_or_before 720", parse("The day of admission counts as a full day if admitted at or before 12:00."));
    expectRow("“not later than 12 noon”", "admission on_or_before 720", parse("The day of admission counts as a full day if admitted not later than 12 noon."));
    expectRow("“before 12:00 noon”", "admission before 720", parse("The day of admission counts as a full day only if admission is before 12:00 noon."));
    expectRow("“earlier than 12 noon”", "admission before 720", parse("The day of admission counts as a full day if admitted earlier than 12 noon."));
    expectRow("“after 3pm”", "discharge after 900", parse("The day of discharge counts as a full day if discharge is after 3pm."));
    expectRow("“on or after 3pm”", "discharge on_or_after 900", parse("The day of discharge counts as a full day if discharge is on or after 3pm."));
    expectRow("“later than 3 p.m.”", "discharge after 900", parse("The day of discharge counts as a full day if discharged later than 3 p.m."));
    expectRow("not counted: no exception", "", parse("The day of admission is not counted as a full day."));
    // Defect C: admission at exactly 12:00, discharge 3 October 09:00 (both Z). Full day: 2 October; the admission day
    // 1 October counts under inclusive wording only.
    for (const w of ["The admission day counts as a full day by 12 noon.", "The admission day counts as a full day on or before 12 noon."])
      expectRow(`C “${w}”: 1 + 2 October`, 2, days("first_full_day", "2026-10-01T12:00:00Z", "2026-10-03T09:00:00Z", DC.dayEdgeExceptionsFromWording(w)));
    expectRow("C control “before 12 noon”: 2 October only", 1, days("first_full_day", "2026-10-01T12:00:00Z", "2026-10-03T09:00:00Z", DC.dayEdgeExceptionsFromWording("The admission day counts as a full day before 12 noon.")));
  });
  await check("U5 calendar dates: valid leap days pass; impossible dates, times and offsets are refused before arithmetic", () => {
    expectRow("valid leap day 2028-02-29 09:00 -> 2028-03-02 09:00, first full day (1 March)", 1, days("first_full_day", "2028-02-29T09:00:00+08:00", "2028-03-02T09:00:00+08:00"));
    expectRow("valid leap day, complete 24h (48 h)", 2, days("completed_24h", "2028-02-29T09:00:00+08:00", "2028-03-02T09:00:00+08:00"));
    expectRow("2000-02-29 (400-year leap)", 1, days("completed_24h", "2000-02-29T00:00Z", "2000-03-01T00:00Z"));
    expectRow("D 2026-02-30 09:00 -> 2026-03-03, first full day", "INVALID_DATE", days("first_full_day", "2026-02-30T09:00:00+08:00", "2026-03-03T09:00:00+08:00"));
    expectRow("D 2026-02-30, complete 24h", "INVALID_DATE", days("completed_24h", "2026-02-30T09:00:00+08:00", "2026-03-03T09:00:00+08:00"));
    expectRow("2026-02-29 (not a leap year)", "INVALID_DATE", days("per_night", "2026-02-29T09:00Z", "2026-03-03T09:00Z"));
    expectRow("2100-02-29 (century, not a leap year)", "INVALID_DATE", days("completed_24h", "2100-02-29T09:00Z", "2100-03-03T09:00Z"));
    expectRow("2026-04-31", "INVALID_DATE", days("completed_24h", "2026-04-31T09:00Z", "2026-05-03T09:00Z"));
    expectRow("2026-13-01", "INVALID_DATE", days("completed_24h", "2026-12-30T09:00Z", "2026-13-01T09:00Z"));
    expectRow("2026-00-10", "INVALID_DATE", days("completed_24h", "2026-00-10T09:00Z", "2026-01-11T09:00Z"));
    expectRow("24:00", "INVALID_DATE", days("completed_24h", "2026-10-01T24:00+08:00", "2026-10-03T09:00+08:00"));
    expectRow("23:60", "INVALID_DATE", days("completed_24h", "2026-10-01T23:60+08:00", "2026-10-03T09:00+08:00"));
    expectRow("offset +15:00", "INVALID_DATE", days("completed_24h", "2026-10-01T09:00+15:00", "2026-10-03T09:00+08:00"));
    expectRow("offset +08:60", "INVALID_DATE", days("completed_24h", "2026-10-01T09:00+08:60", "2026-10-03T09:00+08:00"));
    expectRow("date only 2026-02-30, each night", "INVALID_DATE", days("per_night", "2026-02-30", "2026-03-03"));
    expectRow("date only, valid, each night", 2, days("per_night", "2026-03-01", "2026-03-03"));
    expectRow("no offset is still its own reason", "MISSING_TIMEZONE_OFFSET", days("completed_24h", "2026-10-01T09:00", "2026-10-03T09:00+08:00"));
    const old = DC.computeHospitalDays({ admissionISO: "2026-02-30T09:00Z", dischargeISO: "2026-03-03T09:00Z", rule: "completed_24h_period", edgeInclusion: { admissionDayIncluded: false, dischargeDayIncluded: false }, icuPeriods: [], icuMode: null, waitingDays: 0 });
    expectRow("computeHospitalDays refuses it too", "INVALID_DATE", old.status === "blocked" ? old.reasonCode : "calculated");
  });
  await check("U6 the same clause repeated counts once; two different clauses for one day are a conflict, never one picked", () => {
    const ff = "The day of admission counts as a full day only if admission is before 12:00 noon.";
    expectRow("parsed twice in one passage -> one exception", 1, DC.dayEdgeExceptionsFromWording(ff + " " + ff).length);
    expectRow("one exception given twice: 1 Oct 09:00 -> 3 Oct 09:00 is 1 + 2 October", 2, days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-03T09:00:00+08:00", [NOON_BEFORE, { ...NOON_BEFORE }]));
    expectRow("before noon and before 3pm for the admission day", "CONFLICTING_DAY_EXCEPTION", days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-03T09:00:00+08:00", [NOON_BEFORE, { edge: "admission", when: "before", minutes: 900 }]));
    expectRow("before noon and on or before noon (different comparisons)", "CONFLICTING_DAY_EXCEPTION", days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-03T09:00:00+08:00", [NOON_BEFORE, NOON_ON_OR_BEFORE]));
    expectRow("an admission and a discharge exception are not a conflict", 3, days("first_full_day", "2026-10-01T09:00:00+08:00", "2026-10-03T16:00:00+08:00", [NOON_BEFORE, { edge: "discharge", when: "after", minutes: 900 }]));
  });
  await check("U7 scope and amendment precedence decide a conflict only when they establish which clause applies", () => {
    const ev = (t: string) => ({ passage: { text: t, onPage: 1 } }) as unknown as import("@/lib/rag2/evidence").EvidenceRef;
    const term = (when: Edge["when"], minutes: number, t = `${when} ${minutes}`) => ({ value: { edge: "admission" as const, when, minutes }, words: t, evidence: ev(t) });
    const scope = TR.resolveDayEdgeScope([term("before", 720), term("before", 720)]);
    expectRow("same scope, same clause twice", "1 0", `${scope.edges.length} ${scope.conflict.length}`);
    const two = TR.resolveDayEdgeScope([term("before", 720), term("before", 900)]);
    expectRow("same scope, two different clauses", "0 1", `${two.edges.length} ${two.conflict.length}`);
    const base = { dayEdges: [term("before", 720)], dayEdgeConflict: [] };
    const amend = (eff: string | null, minutes: number) => ({ documentId: "e" + minutes, effectiveDate: eff, edges: [term("before", minutes)], conflict: [] });
    const at = (r: ReturnType<typeof TR.applyAmendmentDayEdges>) => r.dayEdgeConflict.length ? "conflict" : r.dayEdges.map((x) => x.value.minutes).join(",");
    expectRow("amendment in force from 1 Jul, stay 3 Aug", "1080", at(TR.applyAmendmentDayEdges(base, [amend("2026-07-01", 1080)], { admission: "2026-08-03", discharge: "2026-08-05" })));
    expectRow("amendment from 1 Jul, stay 3 Jun: the schedule applies", "720", at(TR.applyAmendmentDayEdges(base, [amend("2026-07-01", 1080)], { admission: "2026-06-03", discharge: "2026-06-05" })));
    expectRow("effective on the admission date itself", "1080", at(TR.applyAmendmentDayEdges(base, [amend("2026-07-01", 1080)], { admission: "2026-07-01", discharge: "2026-07-03" })));
    expectRow("two amendments in force: the later one", "960", at(TR.applyAmendmentDayEdges(base, [amend("2026-07-01", 1080), amend("2026-08-01", 960)], { admission: "2026-08-03", discharge: "2026-08-05" })));
    expectRow("two amendments from the same date that differ", "conflict", at(TR.applyAmendmentDayEdges(base, [amend("2026-07-01", 1080), amend("2026-07-01", 960)], { admission: "2026-08-03", discharge: "2026-08-05" })));
    expectRow("an amendment with no stated effective date that differs", "conflict", at(TR.applyAmendmentDayEdges(base, [amend(null, 1080)], { admission: "2026-08-03", discharge: "2026-08-05" })));
    expectRow("an undated amendment that repeats the schedule", "720", at(TR.applyAmendmentDayEdges(base, [amend(null, 720)], { admission: "2026-08-03", discharge: "2026-08-05" })));
    expectRow("stay date unknown, a dated amendment differs", "conflict", at(TR.applyAmendmentDayEdges(base, [amend("2026-07-01", 1080)], { admission: null, discharge: null })));
  });
  await check("U8 an invalid or future date of birth never sets a benefit class (and is not replaced by the relationship)", () => {
    const cls = (dob: string | null, rel: string, asOf: string, category?: string) => { const p = P.personApplicability({ relationship: rel, dateOfBirth: dob }, { asOf, ...(category ? { category } : {}) }); return `${p.cls} ${p.age ?? "-"} ${p.basis}`; };
    expectRow("future date of birth, recorded as a child", "unknown - none", cls("2030-01-15", "child", "2026-10-10"));
    expectRow("born after the stay date", "unknown - none", cls("2027-03-01", "child", "2026-10-08"));
    expectRow("not a calendar date (30 Feb)", "unknown - none", cls("2020-02-30", "child", "2026-10-10"));
    expectRow("the date asked about is not a calendar date", "unknown - none", cls("2019-06-01", "child", "2026-02-30"));
    expectRow("valid: aged 7", "child 7 date_of_birth", cls("2019-06-01", "child", "2026-10-10"));
    expectRow("born on the date asked about: aged 0", "child 0 date_of_birth", cls("2026-10-10", "child", "2026-10-10"));
    expectRow("leap-day birth, the day before the 18th birthday", "child 17 date_of_birth", cls("2020-02-29", "self", "2038-02-28"));
    expectRow("leap-day birth, 1 March of the 18th year", "adult 18 date_of_birth", cls("2020-02-29", "self", "2038-03-01"));
    expectRow("no date of birth: the relationship (unchanged)", "child - relationship", cls(null, "child", "2026-10-10"));
    expectRow("the policy's own category still decides", "child - category", cls("2030-01-15", "child", "2026-10-10", "Child"));
  });
  await check("U9 positive control: complete 24 hours from 0 to 96 hours is floor(hours / 24)", () => {
    const start = Date.parse("2026-03-01T08:00:00+08:00");
    for (let h = 0; h <= 96; h++) {
      const end = new Date(start + h * 3_600_000).toISOString().replace(/\.000Z$/, "Z");
      expectRow(`${h} h`, Math.floor(h / 24), days("completed_24h", "2026-03-01T08:00:00+08:00", end));
    }
  });

  // ------------------------------------------------------------------------------------------- F: the full path
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite/vector");
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  const { pool } = await import("@/lib/db/client");
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of ["schema.sql", "chat-upgrade.sql", "benefit-catalog.sql", "model-usage.sql", "model-provenance.sql", "coverage-ledger.sql", "cover-conditions.sql", "background-jobs.sql", "household-rls.sql", "lifecycle.sql", "v11-ingestion-evidence.sql"])
    await db.exec(await readFile(path.resolve("sql/" + file), "utf8"));
  const execute = async (text: string, params: unknown[] = []) => { if (!params.length && /;\s*\S/.test(text)) { await db.exec(text); return { rows: [], rowCount: 0 }; } const r = await db.query(text, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  pool.query = (async (text: string, params: unknown[] = []) => execute(text, params)) as typeof pool.query;
  pool.connect = (async () => ({ query: execute, release() {} })) as unknown as typeof pool.connect;
  await db.query("INSERT INTO accounts(id,name) VALUES($1,'Household E')", [ACCOUNT]);
  for (const p of Object.values(M)) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship,date_of_birth) VALUES($1,$2,$3,$4,$5,$6)", [p.id, ACCOUNT, p.name, p.pref, p.rel, p.dob]);
  for (const d of DOCS) {
    await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date)
      VALUES($1,$2,$3,$4,$5,$6,'Hospital cash',$7,true,'ready',$8,$8,'scan_clean','active',$9,$10)`, [d.id, ACCOUNT, d.owner, d.insurer, d.product, d.policyNumber, d.role, d.key.toLowerCase() + ".pdf", d.hash, d.effectiveDate]);
    for (const m of d.members) await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES($1,$2,$3,'test',1)", [d.id, m, ACCOUNT]);
    for (const [page, text] of Object.entries(d.pages)) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [ACCOUNT, d.id, Number(page), text]);
  }
  const CR = await import("@/lib/claims/calc-record");
  const R = await import("@/lib/rag2/tools");
  const CT = await import("@/lib/rag2/calc/tool");
  const { verifyAnswerFigures } = await import("@/lib/chat/answer-verification");
  type Out = import("@/lib/rag2/calc/engine").CalcOutcome;
  const ctxFor = () => R.createToolContext({ accountId: ACCOUNT, asOf: "2026-10-08" });
  const sel = async (ctx: ReturnType<typeof ctxFor>, key: string, who: string) => {
    const r = await R.runTool(ctx, "select_table_value", { policy_id: doc(key).id, benefit: "Hospital cash per day", subject_id: who, want: "amount" }, ON);
    assert.ok(r.ok, JSON.stringify(r)); return r.data as { status: string; valueId: string; value: number; reason?: string };
  };
  const at = (iso: string, words: string) => ({ at: iso, words });
  const calc = async (key: string, who: string, adm: [string, string], dis: [string, string]): Promise<Out | { refused: string }> => {
    const ctx = ctxFor(); const v = await sel(ctx, key, who);
    if (v.status !== "ok") return { refused: "select_table_value: " + JSON.stringify(v).slice(0, 400) };
    const r = await R.runTool(ctx, "calculate", { calculator: "hospital_cash", purpose: "question", subject_id: who, policy_id: doc(key).id, benefit: "Hospital cash per day", rate_value_id: v.valueId, admission: at(...adm), discharge: at(...dis) }, ON);
    if (!r.ok) return { refused: (r as { error: string }).error };
    return CT.calcOutcomes(ctx).get((r.data as { calc_id: string }).calc_id)!;
  };
  const answerWith = (sentence: string, c: Out) => ({ mode: "answer", summary: sentence, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], calculations: c.record ? [{ ...c.record, sentence }] : [] } as unknown as import("@/types").ChatAnswer);
  /** The whole path for one stay: the calculation, its record re-run, the gate on the sentence the household would see. */
  const path3 = async (key: string, adm: [string, string], dis: [string, string], who = M.dana.id, whoName = "Dana") => {
    const c = await calc(key, who, adm, dis);
    if ("refused" in c) return { kind: "refused", amount: null as number | null, days: null as number | null, visible: c.refused, gate: "-", recompute: "-", c: null as Out | null };
    const dayStep = c.record?.steps.find((s) => s.op === "day_count");
    const recompute = c.record ? (CR.recomputeCalculation(c.record).ok ? "re-runs" : "fails") : "-";
    let visible = c.kind === "indicative_estimate" ? "" : (c.requirements.join("; ") || ("reason" in c ? String((c as { reason?: string }).reason ?? "") : ""));
    let gate = "-";
    if (c.kind === "indicative_estimate" && c.amount != null) {
      const text = `Indicative estimate: ${whoName}'s hospital cash under ${doc(key).product} comes to S$${c.amount} for the full days of the stay.`;
      const user = `${adm[1]}; ${dis[1]}`;
      const a = answerWith(text, c); const problems = await verifyAnswerFigures(a, { accountId: ACCOUNT, userText: user });
      gate = problems.length ? "rejected: " + problems[0].reason : "kept"; visible = a.summary;
    }
    return { kind: c.kind, amount: c.amount, days: dayStep ? dayStep.out : null, visible, gate, recompute, c };
  };
  const brief = (r: Awaited<ReturnType<typeof path3>>) => `${r.kind} ${r.days ?? "-"} ${r.amount ?? "-"} ${r.gate.startsWith("rejected") ? "rejected" : r.gate}`;

  await check("F1 “by 12 noon” / “on or before 12 noon”: admitted at exactly 12:00 -> the admission day counts (1 + 2 Oct x S$100 = S$200); “before 12 noon” -> 2 Oct only (S$100)", async () => {
    const adm: [string, string] = ["2026-10-01T12:00:00+08:00", "admitted on 1 October at 12 noon"], dis: [string, string] = ["2026-10-03T09:00:00+08:00", "discharged on 3 October at 9am"];
    for (const k of ["BY", "ONB"]) { const r = await path3(k, adm, dis); expectRow(`${k}: kind days amount gate`, "indicative_estimate 2 200 kept", brief(r)); expectRow(`${k}: record`, "re-runs", r.recompute); assert.match(r.visible, /S\$200\b/); }
    const b = await path3("BEFORE", adm, dis); expectRow("BEFORE: kind days amount gate", "indicative_estimate 1 100 kept", brief(b));
    const b2 = await path3("BEFORE", ["2026-10-01T11:59:59+08:00", "admitted on 1 October at 11:59:59 am"], dis); expectRow("BEFORE, 11:59:59", "indicative_estimate 2 200 kept", brief(b2));
  });
  await check("F2 a stay from 00:00 to 01:00 the same day, and a zero-duration stay, give no estimate (no full day)", async () => {
    const r = await path3("BY", ["2026-10-01T00:00:00+08:00", "admitted on 1 October at midnight"], ["2026-10-01T01:00:00+08:00", "discharged on 1 October at 1am"]);
    expectRow("00:00 -> 01:00: kind days amount gate", "not_payable - - -", brief(r));
    assert.doesNotMatch(r.visible, /S\$100\b/);
    const full = await path3("BY", ["2026-10-01T00:00:00+08:00", "admitted on 1 October at midnight"], ["2026-10-02T00:00:00+08:00", "discharged on 2 October at midnight"]);
    expectRow("00:00 -> 00:00 next day: 1 whole day", "indicative_estimate 1 100 kept", brief(full));
  });
  await check("F2b defect B through the whole path: admission and discharge both 2026-10-01T00:00:00Z -> no amount (first full day); under “each day or part of a day” the actual times are asked for", async () => {
    const z = await path3("BY", ["2026-10-01T00:00:00Z", "admitted on 1 October at midnight"], ["2026-10-01T00:00:00Z", "discharged on 1 October at midnight"]);
    expectRow("zero duration at midnight, first full day: kind days amount gate", "not_payable - - -", brief(z));
    const zi = await path3("INC", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-01T09:00:00+08:00", "discharged on 1 October at 9am"]);
    expectRow("equal timestamps, each day or part of a day: kind days amount gate", "unresolved - - -", brief(zi));
    assert.match(zi.visible, /same moment/, zi.visible);
    const si = await path3("INC", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-01T20:00:00+08:00", "discharged on 1 October at 8pm"]);
    expectRow("valid same-day stay, each day or part of a day: 1 day", "indicative_estimate 1 100 kept", brief(si));
    const z9 = await path3("BY", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-01T09:00:00+08:00", "discharged on 1 October at 9am"]);
    expectRow("zero duration at 09:00, first full day: kind days amount gate", "not_payable - - -", brief(z9));
  });
  await check("F2c round 8f through the whole path: mixed offsets under a calendar rule ask for the hospital's time zone; the same stay in one offset is calculated", async () => {
    const mixed = await path3("BY", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-03T01:00:00Z", "discharged on 3 October at 1am UTC"]);
    expectRow("BY, +08:00 and Z: kind days amount gate", "unresolved - - -", brief(mixed));
    assert.match(mixed.visible, /different time zones/, mixed.visible);
    const local = await path3("BY", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-03T09:00:00+08:00", "discharged on 3 October at 9am"]);
    expectRow("BY, both +08:00 (1 Oct by noon + 2 Oct)", "indicative_estimate 2 200 kept", brief(local));
    const elapsed = await path3("R24", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-03T01:00:00Z", "discharged on 3 October at 1am UTC"]);
    // 1 Oct 09:00 +08:00 is 1 Oct 01:00Z, so this is exactly 48 hours: 2 periods.
    expectRow("R24 (complete 24 hours), +08:00 and Z: 48 h = 2 periods", "indicative_estimate 2 200 kept", brief(elapsed));
  });
  await check("F3 30 February is refused before any arithmetic: no estimate, and the household is asked for the date again", async () => {
    const r = await path3("R24", ["2026-02-30T09:00:00+08:00", "admitted on 30 February at 9am"], ["2026-03-03T09:00:00+08:00", "discharged on 3 March at 9am"]);
    expectRow("30 Feb: kind days amount gate", "unresolved - - -", brief(r));
    assert.match(r.visible, /2026-02-30 is not a calendar date/, r.visible);
    const leap = await path3("R24", ["2028-02-29T09:00:00+08:00", "admitted on 29 February 2028 at 9am"], ["2028-03-02T09:00:00+08:00", "discharged on 2 March 2028 at 9am"]);
    expectRow("valid leap day: 48 h = 2 periods x S$100", "indicative_estimate 2 200 kept", brief(leap));
  });
  await check("F4 the same clause printed twice counts the admission day once: 1 Oct 09:00 -> 3 Oct 09:00 = 1 + 2 Oct = S$200 (not S$300)", async () => {
    const r = await path3("DUP", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-03T09:00:00+08:00", "discharged on 3 October at 9am"]);
    expectRow("DUP", "indicative_estimate 2 200 kept", brief(r));
    expectRow("one exception applied", 1, (r.c?.record?.steps.find((s) => s.op === "day_count") as { edges?: unknown[] } | undefined)?.edges?.length ?? 0);
  });
  await check("F5 two different clauses for the admission day: the estimate is withheld and the conflict is named", async () => {
    const r = await path3("CON", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-03T09:00:00+08:00", "discharged on 3 October at 9am"]);
    expectRow("CON: kind days amount gate", "unresolved - - -", brief(r));
    assert.match(r.visible, /different exceptions for the day of admission/, r.visible);
    assert.match(r.visible, /12 noon/); assert.match(r.visible, /3pm/);
  });
  await check("F6 the benefit's own clause takes precedence over the plan-level clause: admitted 14:00 counts under “before 3pm” (S$200)", async () => {
    const r = await path3("SCOPE", ["2026-10-01T14:00:00+08:00", "admitted on 1 October at 2pm"], ["2026-10-03T09:00:00+08:00", "discharged on 3 October at 9am"]);
    expectRow("SCOPE", "indicative_estimate 2 200 kept", brief(r));
  });
  await check("F7 an endorsement from 1 July 2026 (“before 6pm”) supersedes the schedule's “before 12 noon” for stays from that date only", async () => {
    const aug = await path3("AMD", ["2026-08-03T15:00:00+08:00", "admitted on 3 August at 3pm"], ["2026-08-05T10:00:00+08:00", "discharged on 5 August at 10am"]);
    expectRow("AMD, August stay: 3 + 4 Aug", "indicative_estimate 2 200 kept", brief(aug) + (aug.gate.startsWith("rejected") ? " (" + aug.gate + ")" : ""));
    const jun = await path3("AMD", ["2026-06-03T15:00:00+08:00", "admitted on 3 June at 3pm"], ["2026-06-05T10:00:00+08:00", "discharged on 5 June at 10am"]);
    expectRow("AMD, June stay: 4 Jun only", "indicative_estimate 1 100 kept", brief(jun));
    const und = await path3("UND", ["2026-08-03T15:00:00+08:00", "admitted on 3 August at 3pm"], ["2026-08-05T10:00:00+08:00", "discharged on 5 August at 10am"]);
    expectRow("UND (endorsement with no effective date): kind days amount gate", "unresolved - - -", brief(und));
    assert.match(und.visible, /different exceptions for the day of admission/, und.visible);
  });
  await check("F8 a future date of birth does not make Fay a child: the Child column is not used for her; Eli (aged 7) gets S$80", async () => {
    const ctx = ctxFor();
    const fay = await sel(ctx, "AGE", M.fay.id);
    expectRow("Fay: a value read for her", "not ok", fay.status === "ok" ? `ok ${fay.value}` : "not ok");
    const eli = await sel(ctx, "AGE", M.eli.id);
    expectRow("Eli: the Child column", "ok 80", `${eli.status} ${eli.value}`);
  });

  // ---------------------------------------------------------------------------------- V: malformed saved records
  const base = await path3("BEFORE", ["2026-10-01T09:00:00+08:00", "admitted on 1 October at 9am"], ["2026-10-03T09:00:00+08:00", "discharged on 3 October at 9am"]);
  assert.ok(base.c?.record, "a valid record to tamper with");
  const tamper = async (name: string, f: (r: import("@/types").CalculationRecord) => string) => {
    await check(name, async () => {
      const rec = structuredClone(base.c!.record!) as import("@/types").CalculationRecord; const text = f(rec);
      const a = answerWith(text, { ...base.c!, record: rec } as Out);
      const problems = await verifyAnswerFigures(a, { accountId: ACCOUNT, userText: "admitted on 1 October at 9am; discharged on 3 October at 9am; admitted on 1 October at midnight; discharged on 1 October at 1am; admitted on 30 February at 9am; discharged on 3 March at 9am" });
      expectRow(name.split(":")[0], "rejected", problems.length ? "rejected" : "kept");
      assert.doesNotMatch(a.summary, /S\$\d/, "no figure is left: " + a.summary);
    });
  };
  const setDays = (r: import("@/types").CalculationRecord, n: number) => { for (const s of r.steps) if (s.op === "day_count" || s.op === "min_count" || s.op === "days_after_waiting") s.out = n; const last = r.steps[r.steps.length - 1]; last.out = n * 10000; r.result.value = n * 100; return `Indicative estimate: Dana's hospital cash under Brightwater Morning Cash comes to S$${n * 100} for the full days of the stay.`; };
  await tamper("V1 the admission-day exception applied twice (3 days claimed for 1 + 2 Oct)", (r) => { const s = r.steps.find((x) => x.op === "day_count") as { edges?: unknown[] }; s.edges = [...(s.edges ?? []), ...(s.edges ?? [])]; return setDays(r, 3); });
  await tamper("V2 two different admission-day exceptions in one record", (r) => { const s = r.steps.find((x) => x.op === "day_count") as { edges?: Edge[] }; s.edges = [NOON_BEFORE, { edge: "admission", when: "before", minutes: 900 }]; return setDays(r, 2); });
  // V3 / V4: the operands and the household's words agree, and the stated count is what the OLD shared function gave
  // (1 day each), so only a corrected day count can reject them. Independently: 30 February does not exist, and a
  // 00:00 -> 01:00 stay contains no whole day.
  const setStay = (r: import("@/types").CalculationRecord, adm: [string, string], dis: [string, string]) => {
    const a = r.operands.find((x) => x.role === "admission") as { value: string; attribution?: string }, d = r.operands.find((x) => x.role === "discharge") as { value: string; attribution?: string };
    a.value = adm[0]; a.attribution = adm[1]; d.value = dis[0]; d.attribution = dis[1];
  };
  await tamper("V3 an impossible date in a saved record (30 February, 1 day claimed)", (r) => { setStay(r, ["2026-02-30T09:00:00+08:00", "admitted on 30 February at 9am"], ["2026-03-03T09:00:00+08:00", "discharged on 3 March at 9am"]); return setDays(r, 1); });
  await tamper("V4 a 00:00 -> 01:00 stay saved as one full day", (r) => { setStay(r, ["2026-10-01T00:00:00+08:00", "admitted on 1 October at midnight"], ["2026-10-01T01:00:00+08:00", "discharged on 1 October at 1am"]); return setDays(r, 1); });

  console.log("\n| case | expected | actual |\n|---|---|---|");
  for (const t of table) console.log(`| ${t.kase} | ${t.expected} | ${t.actual} |`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\ncalc boundary regressions ${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
