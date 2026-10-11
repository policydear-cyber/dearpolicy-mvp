/**
 * Agent K: the benefit calculators the conversation loop's `calculate` tool runs. They do not do their own arithmetic:
 *  - hospital cash  -> lib/claims/day-count.ts (payable days under the policy's OWN day-count rule) and
 *                      lib/claims/calculators/hospital-cash.ts calculateHospitalCash (min(day cap, days - waiting) x rate);
 *  - bills          -> lib/claims/calculators/medical-reimbursement.ts calculateMedicalReimbursement (sub-limits,
 *                      deductible / co-insurance through the shared deduction core, caps; unresolved deduction order blocks);
 *  - lump sums      -> sum insured x printed percentage, capped (illustration only: the claim workflow's reviewed
 *                      definition match -- lib/claims/calculators/critical-illness.ts et al. -- is never waived).
 * Each produces a CalculationRecord (types/index.ts) that lib/claims/calc-record.ts re-runs before it is issued, and
 * which the save-time gate re-runs again. Result kinds stay distinct: a printed figure (cited), a conditional
 * illustration (only for a what-if the household asked), an indicative estimate (every condition established; never a
 * payout; never in a total), or "unresolved" -- the supported printed figure plus the specific missing information.
 */
import { createHash } from "node:crypto";
import type { CalcCondition, CalcOperand, CalcStep, CalculationRecord, FigureBinding } from "@/types";
import { calculateHospitalCash } from "@/lib/claims/calculators/hospital-cash";
import { calculateMedicalReimbursement, type DeductionStep } from "@/lib/claims/calculators/medical-reimbursement";
import { dayRuleNeedsTimes, isCalendarDate, isoInstantProblem, payableDaysUnderRule, type PolicyDayRule } from "@/lib/claims/day-count";
import { recomputeCalculation } from "@/lib/claims/calc-record";
import { applyDeductionCore, divHalfUp } from "@/lib/claims/calculators/deductions";
import { toFigureBinding, type EvidenceRef } from "../evidence";
import type { TableValueOperand } from "../compute";
import type { BenefitTerms } from "./terms";
import { capSpansStays, PER_DAY_UNITS, readValueTerms, resetWords, type CountCap, type MoneyCap } from "../value-terms";
import { checkUnitTerms, isPeriodCap, recordSpan, resetNamedIn, valueTermsOf, type RecordCap, type RecordWithUnitTerms, type UnitTerms } from "./unit-terms";

export type HouseholdInput = { value: number | string; currency?: string | null; words: string; kind: "household" | "assumption" };
export type DocValue = { operand: TableValueOperand; valueId?: string | null };
export type CalcOutcome = {
  calcId: string;
  kind: "conditional_illustration" | "indicative_estimate" | "unresolved" | "not_payable";
  calculator: CalculationRecord["calculator"];
  subjectId: string; policyId: string; benefit: string; documentHash: string | null;
  /** The printed figures this outcome rests on (cited; always safe to state as printed). */
  printed: { label: string; value: number; unit: "money" | "percent" | "count"; currency: string | null; evidence: EvidenceRef; binding: FigureBinding | null; valueId?: string | null }[];
  conditions: CalcCondition[];
  /** What is still needed, in the household's terms (empty for an estimate / illustration). */
  requirements: string[];
  amount: number | null; currency: string | null;
  record: Omit<CalculationRecord, "sentence"> | null;
  steps: string[];
  unresolvedText: string;
  /** Why the benefit pays nothing for these facts (not_payable), stated from the wording. */
  reason?: string | null;
  evidence: EvidenceRef[];
  evidenceRequirements: string[];
};
export type Refusal = { refused: string };

const money = (cents: number, cur: string) => `${cur === "SGD" ? "S$" : cur + " "}${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const idOf = (parts: unknown[]) => "k" + createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 10);
const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
const passageOf = (e: EvidenceRef) => ({ policyId: e.policyId, pageStart: e.page.start, pageEnd: e.page.end, text: e.passage.text });

function docOperand(id: string, role: Extract<CalcOperand, { source: "document" }>["role"], v: DocValue, subjectId: string): Extract<CalcOperand, { source: "document" }> | string {
  const o = v.operand;
  const value = o.valueKind === "money" ? (o.cents ?? NaN) / 100 : o.valueKind === "percent" ? (o.ppm ?? NaN) / 10_000 : (o.count ?? NaN);
  if (!Number.isFinite(value)) return `the value for ${o.benefit} is not a printed ${o.valueKind}`;
  const binding = toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, o.benefit, value, o.currency ?? "");
  if (!binding) return `the passage for ${o.benefit} does not print its value for this person`;
  return { id, source: "document", role, label: o.benefit, unit: o.valueKind, value, currency: o.valueKind === "money" ? (o.currency ?? null) : null, period: o.period ?? null, row: o.evidence.table?.rowLabel ?? o.evidence.passage.text, column: o.evidence.table ? (o.evidence.table.columnLeaf || o.evidence.table.columnHeader || null) : null, binding };
}
function printedOf(v: DocValue, subjectId: string): CalcOutcome["printed"][number] {
  const o = v.operand;
  const value = o.valueKind === "money" ? (o.cents ?? 0) / 100 : o.valueKind === "percent" ? (o.ppm ?? 0) / 10_000 : (o.count ?? 0);
  return { label: o.benefit, value, unit: o.valueKind, currency: o.currency ?? null, evidence: o.evidence, binding: toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, o.benefit, value, o.currency ?? ""), valueId: v.valueId ?? null };
}
function householdOperand(id: string, role: Extract<CalcOperand, { source: "household" }>["role"], label: string, unit: "money" | "count" | "datetime" | "date", h: HouseholdInput): CalcOperand {
  return h.kind === "assumption"
    ? { id, source: "assumption", role, label, unit, value: h.value, currency: h.currency ?? null, attribution: h.words.trim() }
    : { id, source: "household", role, label, unit, value: h.value, currency: h.currency ?? null, attribution: h.words.trim() };
}
const settledStatus = (c: CalcCondition[]) => c.every((x) => x.status !== "unresolved");

/** Applies the household's settlement of a condition (their own words), never a document fact. */
function applySettled(conds: CalcCondition[], settled: { id: string; status: "established" | "not_applicable"; words: string }[]) {
  for (const s of settled) {
    const c = conds.find((x) => x.id === s.id);
    if (!c || c.basis === "document" || c.kind === "day_count_rule" || c.kind === "deduction_order" || c.kind === "definition" || !s.words?.trim()) continue;
    c.status = s.status; c.basis = "household"; c.householdWords = s.words.trim(); c.needs = null;
  }
}

function finish(o: Omit<CalcOutcome, "calcId" | "unresolvedText"> & { who: string; product: string }): CalcOutcome | Refusal {
  const calcId = idOf([o.calculator, o.policyId, o.benefit, o.subjectId, o.record?.operands, o.record?.steps, o.conditions.map((c) => [c.id, c.status])]);
  const need = o.requirements.length ? o.requirements.join("; and ") : "information the documents do not give";
  // Integration (D29): only an unresolved calculation says something is missing. A resolved one (an estimate or an
  // illustration) whose sentence fails verification says so -- never "I still need information".
  const unresolvedText = o.kind === "not_payable" ? `${o.product} ${o.benefit.toLowerCase()} does not apply to these facts: ${o.reason ?? "see the policy wording"}.`
    : o.kind === "unresolved" ? `To work out ${o.who}’s ${o.benefit.toLowerCase()} under ${o.product}, I still need ${need}.`
    : `I worked out ${o.who}’s ${o.benefit.toLowerCase()} under ${o.product}, but I couldn’t confirm the figure against your documents.`;
  if (o.record) {
    const rec = recomputeCalculation(o.record);
    if (!rec.ok) return { refused: "internal: the calculation record does not re-run: " + rec.error };
    const unitProblem = checkUnitTerms(o.record as RecordWithUnitTerms);
    if (unitProblem) return { refused: "internal: the calculation's unit terms do not re-check: " + unitProblem };
    o.record.id = calcId; o.record.unresolvedText = unresolvedText;
  }
  const { who: _w, product: _p, ...rest } = o; void _w; void _p;
  return { ...rest, calcId, unresolvedText };
}

// ---------------------------------------------------------------------------------------------------- hospital cash
export function hospitalCash(a: {
  subjectId: string; who: string; benefit: string; terms: BenefitTerms; rate: DocValue; dayCap?: DocValue | null;
  admission?: HouseholdInput | null; discharge?: HouseholdInput | null; ongoing?: boolean | null;
  settled?: { id: string; status: "established" | "not_applicable"; words: string }[]; whatIf: boolean;
  /** A1: what the household said about earlier use of a cap that resets over a year / policy year / disability: a
   * number of periods already paid, or an amount already paid (in the rate's currency), with their words. */
  priorUse?: { periods?: number | null; amount?: number | null; currency?: string | null; words: string } | null;
}): CalcOutcome | Refusal {
  const t = a.terms, product = t.productName ?? "this policy";
  const r = a.rate.operand;
  if (r.valueKind !== "money" || r.cents == null || !r.currency) return { refused: "the hospital cash rate must be a printed amount (a value_id from select_table_value)" };
  // V1: the rate may be an endorsement's revised rate for this policy (its amendment names the policy's own document).
  const fromEndorsement = r.evidence.policyId !== t.policyId && r.evidence.amends?.policyId === t.policyId;
  if (r.evidence.policyId !== t.policyId && !fromEndorsement) return { refused: "the rate is from another document than the one calculated for" };
  // A1: the rate's own unit terms (value-terms.ts) -- its unit, duration rule and caps, each with its span. A period
  // that belongs to a cap clause ("max 90 per year") is the cap's reset period, never the rate's unit.
  const rt = valueTermsOf(r.evidence);
  const rateUnit = rt.rateUnit?.unit ?? null;
  if (rateUnit && !PER_DAY_UNITS.includes(rateUnit)) return { refused: `the rate is printed per ${rateUnit.replace("_", " ")}, not per day` };
  if (!rateUnit && r.period && !["day", "night"].includes(r.period)) return { refused: `the rate is printed per ${r.period.replace("_", " ")}, not per day` };
  const unitTerms: UnitTerms = { rate: { unit: rateUnit, span: rt.rateUnit ? recordSpan(r.evidence.policyId, rt.rateUnit.span) : null }, durationRule: rt.durationRule ? { rule: rt.durationRule.rule, span: recordSpan(r.evidence.policyId, rt.durationRule.span) } : null, caps: [], ...(fromEndorsement ? { amendingDocumentIds: [r.evidence.policyId] } : {}) };
  const rateOp = docOperand("rate", "rate", a.rate, a.subjectId); if (typeof rateOp === "string") return { refused: rateOp };
  const printed = [printedOf(a.rate, a.subjectId)];
  const conds: CalcCondition[] = [];
  const reqs: string[] = [];
  // Day-count rule: from the wording only.
  if (t.dayRule) conds.push({ id: "c_day_rule", kind: "day_count_rule", text: `Days are counted as the wording states: “${t.dayRule.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.dayRule.evidence) });
  else {
    const why = t.dayRuleConflict.length ? `the document states two different ways of counting hospital days (pages ${[...new Set(t.dayRuleConflict.map((e) => e.passage.onPage))].join(", ")})` : `the stored ${product} wording does not say how hospital days are counted`;
    conds.push({ id: "c_day_rule", kind: "day_count_rule", text: why, status: "unresolved", basis: "none", needs: `how ${product} counts hospital days (${why}; only the insurer can confirm it)` });
    reqs.push(`how ${product} counts hospital days, which the stored wording does not state (only the insurer can confirm it)`);
  }
  // Waiting (excess) period.
  if (t.waitingDays) conds.push({ id: "c_waiting", kind: "waiting_period", text: `No benefit for the first ${t.waitingDays.value} day(s): “${t.waitingDays.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.waitingDays.evidence) });
  else conds.push({ id: "c_waiting", kind: "waiting_period", text: "No excess / waiting period is printed for this benefit.", status: "not_applicable", basis: "absent" });
  // Day cap: a printed count (value), a cap clause of the rate's own row ("max 90 per year"), or the wording.
  let capOp: Extract<CalcOperand, { source: "document" }> | null = null;
  let capTerm: RecordCap | null = null;
  const rowCap = rt.caps.find(isPeriodCap) as CountCap | undefined;
  if (a.dayCap) {
    const c = docOperand("day_cap", "day_cap", a.dayCap, a.subjectId); if (typeof c === "string") return { refused: c };
    if (c.unit !== "count") return { refused: "the day cap must be a printed number of days" };
    capOp = c; printed.push(printedOf(a.dayCap, a.subjectId));
    const e = a.dayCap.operand.evidence;
    capTerm = { operandId: "day_cap", kind: "count", max: c.value, currency: null, unit: "days", reset: resetNamedIn(e.table?.rowLabel ?? e.passage.text), span: { policyId: t.policyId, page: e.passage.onPage, start: e.passage.start, end: e.passage.end, text: e.passage.text, source: "row" }, priorUse: "not_counted" };
    conds.push({ id: "c_day_cap", kind: "day_cap", text: `At most ${c.value} days (${c.row}).`, status: "established", basis: "document", passage: passageOf(e) });
  } else if (rowCap) {
    // A1: the cap clause printed in the rate's own row ("each complete 24 hours, max 90 per year"): bound to the cell
    // that prints it (the label cell: one figure for every column the row covers).
    const e = rowCap.span.source === "label" ? narrowToLabel(r.evidence, rowCap.span.text) : r.evidence;
    const binding: FigureBinding | null = toFigureBinding({ ...e, subjectId: e.subjectId ?? a.subjectId }, a.benefit, rowCap.max, "");
    if (!binding) return { refused: `the maximum “${rowCap.span.text}” could not be bound to the passage that prints it` };
    capOp = { id: "day_cap", source: "document", role: "day_cap", label: `${a.benefit} maximum ${rowCap.unit ?? unitNoun(rateUnit)}`, unit: "count", value: rowCap.max, currency: null, period: rowCap.reset, row: r.evidence.table?.rowLabel ?? e.passage.text, column: binding.column ?? null, binding };
    capTerm = { operandId: "day_cap", kind: "count", max: rowCap.max, currency: null, unit: rowCap.unit, reset: rowCap.reset, span: recordSpan(r.evidence.policyId, rowCap.span), priorUse: "not_counted" };
    conds.push({ id: "c_day_cap", kind: "day_cap", text: `At most ${rowCap.max} ${rowCap.unit ?? unitNoun(rateUnit)}${rowCap.reset ? ` per ${resetWords(rowCap.reset)}` : " (the wording does not say over what period)"}: “${rowCap.span.text}”`, status: "established", basis: "document", passage: passageOf(e) });
  } else if (t.dayCap) {
    // Agent F: a day cap printed in the benefit's own row label ("Daily hospital cash (max 90 days per year)  S$200
    // S$120") applies to every column: it is bound to the label cell that prints it (one figure for everyone the row
    // covers), not to the whole row, whose value cells print only the rates.
    const e0 = t.dayCap.evidence;
    // Integration (r7): the label is the first cell that is not an item code ("B", "4.", "(a)") -- a row may start with one.
    const cells0 = e0.passage.text.split(/\t|\s{3,}/).map((c) => c.trim());
    const labelCell = cells0.find((c) => !ITEM_CODE.test(c)) ?? "";
    const inLabel = cells0.length >= 3 && new RegExp("(?<![\\d.,])" + t.dayCap.value + "(?![\\d.,])").test(labelCell);
    const e = inLabel ? { ...e0, passage: { ...e0.passage, text: labelCell, start: e0.passage.start + e0.passage.text.indexOf(labelCell), end: e0.passage.start + e0.passage.text.indexOf(labelCell) + labelCell.length }, table: null, support: null, context: null } : e0;
    const binding: FigureBinding | null = toFigureBinding({ ...e, subjectId: e.subjectId ?? a.subjectId }, a.benefit, t.dayCap.value, "");
    // A1: the cap's own reset period, read from the clause that prints it.
    const clause = readValueTerms([{ source: "passage", text: e0.passage.text, page: e0.passage.onPage, offset: e0.passage.start }]).caps.find((x) => x.kind === "count" && x.max === t.dayCap!.value) as CountCap | undefined;
    if (binding) {
      capOp = { id: "day_cap", source: "document", role: "day_cap", label: `${a.benefit} maximum days`, unit: "count", value: t.dayCap.value, currency: null, period: clause?.reset ?? null, row: e.table?.rowLabel ?? e.passage.text, column: binding.column ?? null, binding };
      capTerm = clause ? { operandId: "day_cap", kind: "count", max: clause.max, currency: null, unit: clause.unit, reset: clause.reset, span: recordSpan(t.policyId, clause.span), priorUse: "not_counted" }
        : { operandId: "day_cap", kind: "count", max: t.dayCap.value, currency: null, unit: "days", reset: null, span: { policyId: t.policyId, page: e0.passage.onPage, start: e0.passage.start, end: e0.passage.end, text: e0.passage.text, source: "wording" }, priorUse: "not_counted" };
    }
    conds.push({ id: "c_day_cap", kind: "day_cap", text: `At most ${t.dayCap.value} days: “${e.passage.text}”`, status: "established", basis: "document", passage: passageOf(e) });
  } else conds.push({ id: "c_day_cap", kind: "day_cap", text: "No maximum number of days is printed for this benefit.", status: "not_applicable", basis: "absent" });
  // A1: a monetary maximum printed with the rate ("S$100 per day, maximum S$3,000 per year"), with its own period.
  let moneyCapOp: Extract<CalcOperand, { source: "document" }> | null = null;
  let moneyCapTerm: RecordCap | null = null;
  const rowMoneyCap = rt.caps.find((x) => x.kind === "money") as MoneyCap | undefined;
  if (rowMoneyCap) {
    if (rowMoneyCap.currency !== r.currency) return { refused: `mixed currencies (${r.currency} rate, ${rowMoneyCap.currency} maximum) are never combined` };
    const e = rowMoneyCap.span.source === "label" ? narrowToLabel(r.evidence, rowMoneyCap.span.text) : r.evidence;
    const binding: FigureBinding | null = toFigureBinding({ ...e, subjectId: e.subjectId ?? a.subjectId }, a.benefit, rowMoneyCap.cents / 100, rowMoneyCap.currency);
    if (!binding) return { refused: `the maximum “${rowMoneyCap.span.text}” could not be bound to the passage that prints it` };
    moneyCapOp = { id: "money_cap", source: "document", role: "cap", label: `${a.benefit} maximum`, unit: "money", value: rowMoneyCap.cents / 100, currency: rowMoneyCap.currency, period: rowMoneyCap.reset, row: r.evidence.table?.rowLabel ?? e.passage.text, column: binding.column ?? null, binding };
    moneyCapTerm = { operandId: "money_cap", kind: "money", max: rowMoneyCap.cents / 100, currency: rowMoneyCap.currency, unit: null, reset: rowMoneyCap.reset, span: recordSpan(r.evidence.policyId, rowMoneyCap.span), priorUse: "not_counted" };
    conds.push({ id: "c_money_cap", kind: "day_cap", text: `At most ${money(rowMoneyCap.cents, rowMoneyCap.currency)}${rowMoneyCap.reset ? ` per ${resetWords(rowMoneyCap.reset)}` : " (the wording does not say over what period)"}: “${rowMoneyCap.span.text}”`, status: "established", basis: "document", passage: passageOf(e) });
  }
  // A1: a cap that resets over a year / policy year / disability counts earlier use in that period: the household
  // settles it (in their words, or a figure), a what-if states its assumption, or the calculation stays unresolved.
  const priorFor = (term: RecordCap | null, op: Extract<CalcOperand, { source: "document" }> | null, id: string) => {
    if (!term || !op || !capSpansStays(term.reset)) return;
    const limit = term.kind === "count" ? `${term.max} ${term.unit ?? unitNoun(rateUnit)}` : money(Math.round(term.max * 100), term.currency!);
    conds.push({ id, kind: "day_cap", text: `The limit of ${limit} applies per ${resetWords(term.reset)}: ${term.kind === "count" ? "periods" : "amounts"} of ${a.benefit.toLowerCase()} already paid this ${resetWords(term.reset)} count against it (“${term.span.text}”).`, status: "unresolved", basis: "none", passage: { policyId: t.policyId, pageStart: op.binding.pageStart, pageEnd: op.binding.pageEnd, text: op.binding.passage },
      needs: term.kind === "count" ? `how many ${term.unit ?? unitNoun(rateUnit)} of ${a.benefit.toLowerCase()} ${a.who} has already been paid for this ${resetWords(term.reset)} (the limit is ${limit} per ${resetWords(term.reset)}), or that there were none` : `how much ${a.benefit.toLowerCase()} ${a.who} has already been paid this ${resetWords(term.reset)} (the limit is ${limit} per ${resetWords(term.reset)}), or that there was none` });
  };
  priorFor(capTerm, capOp, "c_cap_prior_use");
  priorFor(moneyCapTerm, moneyCapOp, "c_money_cap_prior_use");
  // Minimum stay.
  if (t.minimumStayHours) conds.push({ id: "c_min_stay", kind: "minimum_stay", text: `The stay must last at least ${t.minimumStayHours.value} hours: “${t.minimumStayHours.evidence.passage.text}”`, status: "unresolved", basis: "document", passage: passageOf(t.minimumStayHours.evidence), needs: `${a.who}’s admission and discharge times (the stay must last at least ${t.minimumStayHours.value} hours)` });
  // Benefit-specific exclusions: the household settles them in their own words, or they stay open.
  t.exclusions.forEach((x, i) => conds.push({ id: "c_excl_" + (i + 1), kind: "exclusion", text: `Exclusion: “${x.evidence.passage.text}”`, status: "unresolved", basis: "none", passage: passageOf(x.evidence), needs: `whether this applies to ${a.who}’s stay: “${x.evidence.passage.text}”` }));
  applySettled(conds, a.settled ?? []);
  // A1: earlier use given as a figure, in the household's words (the figure must be in them).
  let priorPeriods: number | null = null, priorMinor: number | null = null;
  const pu = a.priorUse, puWords = pu?.words?.trim() ?? "";
  const inWords = (n: number) => (puWords.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).some((x) => Math.abs(x - n) < 1e-9);
  const settleByFigure = (id: string) => { const c = conds.find((x) => x.id === id); if (c) { c.status = "established"; c.basis = "household"; c.householdWords = puWords; c.needs = null; } };
  if (pu && puWords) {
    if (pu.periods != null && conds.some((c) => c.id === "c_cap_prior_use")) {
      if (!Number.isInteger(pu.periods) || pu.periods < 0) return { refused: "prior_use.periods must be a whole number" };
      if (pu.periods > 0 && !inWords(pu.periods)) return { refused: "prior_use: the number of periods is not in the household's words" };
      priorPeriods = pu.periods; settleByFigure("c_cap_prior_use");
    }
    if (pu.amount != null && conds.some((c) => c.id === "c_money_cap_prior_use")) {
      if (!Number.isFinite(pu.amount) || pu.amount < 0) return { refused: "prior_use.amount must be an amount" };
      if ((pu.currency ?? r.currency).toUpperCase() !== r.currency) return { refused: `prior_use: the amount is not in ${r.currency} (DearPolicy never converts currencies)` };
      if (pu.amount > 0 && !inWords(pu.amount)) return { refused: "prior_use: the amount is not in the household's words" };
      priorMinor = Math.round(pu.amount * 100); settleByFigure("c_money_cap_prior_use");
    }
  }
  const PRIOR_IDS = ["c_cap_prior_use", "c_money_cap_prior_use"];

  // Inputs the rule needs.
  const rule = t.dayRule?.value ?? null;
  const needTimes = (rule ? dayRuleNeedsTimes(rule) : false) || !!t.minimumStayHours;
  // Round 8e: a date or time that does not exist (2026-02-30, 24:00) is not an input -- it is never rolled over.
  const realValue = (v: string) => (ISO_DT.test(v) ? !isoInstantProblem(v) : ISO_D.test(v) && isCalendarDate(v));
  const okInput = (h: HouseholdInput | null | undefined) => !!h && typeof h.value === "string" && (ISO_DT.test(h.value) || (!needTimes && ISO_D.test(h.value))) && realValue(h.value) && !!h.words?.trim();
  const unreal = [a.admission, a.discharge].find((h) => !!h && typeof h.value === "string" && (ISO_DT.test(h.value) || ISO_D.test(h.value)) && !realValue(h.value));
  if (unreal) reqs.push(`${a.who}’s ${unreal === a.admission ? "admission" : "discharge"} date${needTimes ? " and time" : ""} again: ${String(unreal.value).slice(0, 10)} ${isCalendarDate(String(unreal.value).slice(0, 10)) ? "has a time of day or UTC offset that does not exist" : "is not a calendar date"} (“${unreal.words}”)`);
  // Round 8e: different admission / discharge day exceptions in the wording, with no scope or effective date saying which
  // applies: the count is withheld and the conflict named.
  if (rule === "first_full_day" && t.dayEdgeConflict?.length) for (const c of t.dayEdgeConflict) {
    const pages = [...new Set(c.passages.map((p) => p.passage.onPage))].join(", ");
    const why = `the wording states different exceptions for the day of ${c.edge} (page${c.passages.length > 1 ? "s" : ""} ${pages}: ${c.passages.map((p) => `“${p.passage.text}”`).join(" / ")}), and which one applies is not established`;
    conds.push({ id: `c_day_edge_conflict_${c.edge}`, kind: "day_count_rule", text: why, status: "unresolved", basis: "none", needs: `how ${product} counts the day of ${c.edge} (${why}; only the insurer can confirm it)` });
    reqs.push(`how ${product} counts the day of ${c.edge}: ${why} (only the insurer can confirm it)`);
  }
  if (a.ongoing) reqs.push(`${a.who}’s discharge date${needTimes ? " and time" : ""} (the stay is still ongoing; the benefit is worked out on the completed stay)`);
  else if (!okInput(a.admission) || !okInput(a.discharge)) reqs.push(`${a.who}’s admission and discharge dates${needTimes ? " and times (with the hospital’s time zone)" : ""}`);
  // Round 8f: under "each day or part of a day", the same instant for admission and discharge establishes no time in
  // hospital (usually the times were not recorded): the actual times are asked for -- one day is never awarded for it.
  const sameInstant = rule === "calendar_day_inclusive" && okInput(a.admission) && okInput(a.discharge) && ISO_DT.test(String(a.admission!.value)) && ISO_DT.test(String(a.discharge!.value)) && Date.parse(String(a.admission!.value)) === Date.parse(String(a.discharge!.value));
  if (sameInstant) reqs.push(`${a.who}’s actual admission and discharge times: both are given as the same moment (“${a.admission!.words}”; “${a.discharge!.words}”), so how long the stay lasted is not known`);
  const minStay = conds.find((c) => c.id === "c_min_stay");
  if (minStay && !sameInstant && okInput(a.admission) && okInput(a.discharge) && ISO_DT.test(String(a.admission!.value)) && ISO_DT.test(String(a.discharge!.value))) {
    const hours = (Date.parse(String(a.discharge!.value)) - Date.parse(String(a.admission!.value))) / 3_600_000;
    if (hours >= t.minimumStayHours!.value) { minStay.status = "established"; minStay.basis = "derived"; minStay.needs = null; }
    else return finish({ kind: "not_payable", calculator: "hospital_cash", subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, conditions: conds, requirements: [], amount: null, currency: r.currency, record: null, steps: [], reason: `the stay lasted ${Math.floor(hours)} hours and the wording requires at least ${t.minimumStayHours!.value}`, evidence: [r.evidence, t.minimumStayHours!.evidence], evidenceRequirements: [], who: a.who, product });
  }
  // (A what-if may assume no earlier use of a cap -- stated as its assumption; anything else needs the household.)
  // Integration (r6): unknown earlier use of a cap never blocks the estimate -- a what-if assumes none (an illustration);
  // otherwise the estimate states that the stay's own units are assumed still available (made explicit below).
  for (const c of conds) if (c.status === "unresolved" && c.needs && c.kind !== "day_count_rule" && c.kind !== "minimum_stay" && !PRIOR_IDS.includes(c.id)) reqs.push(c.needs);
  const evidence = [r.evidence, ...(t.dayRule ? [t.dayRule.evidence] : []), ...(t.dayRule?.value === "first_full_day" ? t.dayEdges.map((d) => d.evidence) : []), ...(t.waitingDays ? [t.waitingDays.evidence] : []), ...(a.dayCap ? [a.dayCap.operand.evidence] : !rowCap && t.dayCap ? [t.dayCap.evidence] : [])];
  const evidenceRequirements = [`the hospital’s discharge summary or bill showing ${a.who}’s admission and discharge dates and times`, `the ${product} claim form`];
  const base = { calculator: "hospital_cash" as const, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, evidence, evidenceRequirements, who: a.who, product };
  const unresolvedNow = reqs.length > 0 || !rule || (!a.whatIf && !settledStatus(conds.filter((c) => !PRIOR_IDS.includes(c.id))));
  if (unresolvedNow) return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [...new Set(reqs)], amount: null, currency: r.currency, record: null, steps: [] });

  // Payable days under the wording's rule, then the hospital-cash calculator.
  // Integration (D30): the wording's own exceptions for the admission / discharge day (first-full-day rule only).
  const edges = rule === "first_full_day" ? t.dayEdges : [];
  edges.forEach((d, i) => conds.push({ id: "c_day_edge_" + (i + 1), kind: "day_count_rule", text: `The day of ${d.value.edge} is counted as the wording states: “${d.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(d.evidence) }));
  const remainderHours = rule === "completed_24h_remainder" ? t.dayRule?.remainderHours ?? null : null;
  const days = payableDaysUnderRule(rule!, String(a.admission!.value), String(a.discharge!.value), edges.map((d) => d.value), { remainderHours });
  if (days.status !== "calculated") return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [`${a.who}’s admission and discharge dates and times (${days.message})`], amount: null, currency: r.currency, record: null, steps: [] });
  const waiting = t.waitingDays?.value ?? 0;
  const hc = calculateHospitalCash({ dailyRate: r.cents / 100, currency: r.currency, hospitalStayOngoing: false, hospitalNights: days.grossNights, offsetDays: waiting, maximumDays: capOp ? Number(capOp.value) : days.grossNights,
    ownership: { contractId: t.policyId, label: product }, ruleEvidence: { policyId: t.policyId, pageStart: r.evidence.page.start, pageEnd: r.evidence.page.end, label: a.benefit }, ownershipEvidence: { policyId: t.policyId, pageStart: r.evidence.page.start, pageEnd: r.evidence.page.end, label: "insured person's column" }, unresolvedConditions: [] });
  if (hc.status === "blocked") return { refused: "the hospital cash calculator blocked: " + hc.message };
  const ops: CalcOperand[] = [rateOp, householdOperand("admission", "admission", "admission", ISO_DT.test(String(a.admission!.value)) ? "datetime" : "date", a.admission!), householdOperand("discharge", "discharge", "discharge", ISO_DT.test(String(a.discharge!.value)) ? "datetime" : "date", a.discharge!)];
  const steps: CalcStep[] = [{ id: "s_days", op: "day_count", rule: rule!, inputs: ["admission", "discharge"], out: days.grossNights, ...(edges.length ? { edges: edges.map((d) => d.value) } : {}), ...(remainderHours != null ? { remainderHours } : {}) }];
  let last = "s_days";
  if (waiting > 0) { steps.push({ id: "s_after_wait", op: "days_after_waiting", inputs: [last], waitingDays: waiting, out: Math.max(0, days.grossNights - waiting) }); last = "s_after_wait"; }
  if (capOp) { ops.push(capOp); steps.push({ id: "s_capped", op: "min_count", inputs: [last, capOp.id], out: hc.payableDays }); last = "s_capped"; }
  if (hc.status === "not_applicable") return finish({ ...base, kind: "not_payable", conditions: conds, requirements: [], amount: null, currency: r.currency, record: null, steps: [], reason: `no day of the stay counts under the wording (“${t.dayRule!.evidence.passage.text}”${waiting ? `, after the first ${waiting} day(s)` : ""})` });
  let cents = Math.round(hc.potentialAmount * 100);
  steps.push({ id: "s_amount", op: "multiply", inputs: ["rate", last], out: cents });
  let lastMoney = "s_amount";
  const capLines: string[] = [], assumed: string[] = [], available: string[] = [];
  /** Integration (r6): earlier use not known (and not a what-if): the estimate assumes what this stay needs is still
   * available, says so, and the prior-use condition is settled by that stated assumption. */
  const assumeAvailable = (cond: CalcCondition, text: string) => { available.push(text); cond.status = "established"; cond.basis = "assumption"; cond.needs = null; cond.householdWords = null; };
  const notPayable = (reason: string) => finish({ ...base, kind: "not_payable", conditions: conds, requirements: [], amount: null, currency: r.currency ?? null, record: null, steps: [], reason });
  // A1: earlier use of a cap that resets over a longer period than the stay.
  if (capTerm && capOp) {
    unitTerms.caps.push(capTerm);
    if (capSpansStays(capTerm.reset)) {
      const cond = conds.find((c) => c.id === "c_cap_prior_use")!;
      const unit = capTerm.unit ?? unitNoun(rateUnit);
      if (cond.status === "unresolved" && a.whatIf) { capTerm.priorUse = "assumed_none"; assumed.push(`assuming no earlier use of the ${capTerm.max}-${unit.replace(/s$/, "")} limit this ${resetWords(capTerm.reset)}`); }
      else if (cond.status === "unresolved") {
        // The stay's payable units (already capped at the limit when the stay alone exceeds it) are assumed available.
        const n = hc.payableDays;
        capTerm.priorUse = "assumed_available";
        assumeAvailable(cond, n >= Number(capOp.value) ? `assuming none of the ${capOp.value} ${unit} has been used this ${resetWords(capTerm.reset)}`
          : `assuming at least ${n} of the ${capOp.value} ${n === 1 ? unit.replace(/s$/, "") : unit} ${n === 1 ? "is" : "are"} still available this ${resetWords(capTerm.reset)}`);
      }
      else if (priorPeriods != null && priorPeriods > 0) {
        if (priorPeriods >= Number(capOp.value)) return notPayable(`the ${capOp.value} ${unit} for this ${resetWords(capTerm.reset)} are already used (“${puWords}”; the wording: “${capTerm.span.text}”)`);
        capTerm.priorUse = "household_figure"; capTerm.priorOperandId = "prior_periods";
        ops.push(householdOperand("prior_periods", "count", `${unit} already paid this ${resetWords(capTerm.reset)}`, "count", { value: priorPeriods, words: puWords, kind: "household" }));
        const capMoney = r.cents * Number(capOp.value), priorMoney = r.cents * priorPeriods, left = Math.max(0, capMoney - priorMoney);
        steps.push({ id: "s_cap_value", op: "multiply", inputs: ["rate", "day_cap"], out: capMoney }, { id: "s_prior_value", op: "multiply", inputs: ["rate", "prior_periods"], out: priorMoney }, { id: "s_cap_left", op: "deductible", inputs: ["s_cap_value", "s_prior_value"], out: left });
        const out = Math.min(cents, left);
        steps.push({ id: "s_within_cap", op: "min", inputs: [lastMoney, "s_cap_left"], out }); lastMoney = "s_within_cap"; cents = out;
        capLines.push(`${capOp.value} ${unit} per ${resetWords(capTerm.reset)}, ${priorPeriods} already paid (your words): ${Number(capOp.value) - priorPeriods} left, at most ${money(left, r.currency)}: ${money(cents, r.currency)}`);
      } else capTerm.priorUse = "household_none";
    }
  }
  if (moneyCapTerm && moneyCapOp) {
    unitTerms.caps.push(moneyCapTerm);
    ops.push(moneyCapOp); printed.push({ label: moneyCapOp.label, value: moneyCapOp.value, unit: "money", currency: moneyCapOp.currency, evidence: r.evidence, binding: moneyCapOp.binding, valueId: null });
    let capId = "money_cap", left = Math.round(moneyCapTerm.max * 100);
    if (capSpansStays(moneyCapTerm.reset)) {
      const cond = conds.find((c) => c.id === "c_money_cap_prior_use")!;
      if (cond.status === "unresolved" && a.whatIf) { moneyCapTerm.priorUse = "assumed_none"; assumed.push(`assuming no earlier use of the ${money(left, r.currency)} limit this ${resetWords(moneyCapTerm.reset)}`); }
      else if (cond.status === "unresolved") { moneyCapTerm.priorUse = "assumed_available"; assumeAvailable(cond, `assuming at least ${money(Math.min(cents, left), r.currency)} of the ${money(left, r.currency)} limit is still available this ${resetWords(moneyCapTerm.reset)}`); }
      else if (priorMinor != null && priorMinor > 0) {
        if (priorMinor >= left) return notPayable(`the ${money(left, r.currency)} for this ${resetWords(moneyCapTerm.reset)} is already used (“${puWords}”; the wording: “${moneyCapTerm.span.text}”)`);
        moneyCapTerm.priorUse = "household_figure"; moneyCapTerm.priorOperandId = "prior_paid";
        ops.push(householdOperand("prior_paid", "amount", `${a.benefit} already paid this ${resetWords(moneyCapTerm.reset)}`, "money", { value: priorMinor / 100, currency: r.currency, words: puWords, kind: "household" }));
        left = left - priorMinor;
        steps.push({ id: "s_money_cap_left", op: "deductible", inputs: ["money_cap", "prior_paid"], out: left }); capId = "s_money_cap_left";
      } else moneyCapTerm.priorUse = "household_none";
    }
    const out = Math.min(cents, left);
    steps.push({ id: "s_money_capped", op: "min", inputs: [lastMoney, capId], out }); lastMoney = "s_money_capped";
    capLines.push(`up to ${money(left, r.currency)}${capId !== "money_cap" ? " left" : ""} (“${moneyCapTerm.span.text}”): ${money(out, r.currency)}`);
    cents = out;
  }
  const kind = ops.some((o) => o.source === "assumption") || assumed.length ? "conditional_illustration" : "indicative_estimate";
  if (kind === "conditional_illustration" && !a.whatIf) return { refused: "an assumed figure is used only for a what-if the household asked (purpose what_if)" };
  if (kind === "indicative_estimate" && !settledStatus(conds)) return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [...new Set(reqs)], amount: null, currency: r.currency, record: null, steps: [] });
  const assumption = kind === "conditional_illustration" ? [...[a.admission!, a.discharge!].filter((h) => h.kind === "assumption").map((h) => h.words.trim()), ...assumed].join("; ") : available.length ? available.join(" and ") : null;
  const record: RecordWithUnitTerms = { id: "", calculator: "hospital_cash", kind, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, operands: ops, steps, result: { value: cents / 100, currency: r.currency }, currency: r.currency, rounding: { mode: "half_up", precision: 2, source: "default" }, conditions: conds, evidenceRequirements, assumption, unresolvedText: "", unitTerms };
  const lines = [`payable days under “${t.dayRule!.words}”: ${days.grossNights}`, ...(waiting ? [`after the first ${waiting} day(s): ${Math.max(0, days.grossNights - waiting)}`] : []), ...(capOp ? [`capped at ${capOp.value} days: ${hc.payableDays}`] : []), `${money(r.cents, r.currency)} × ${hc.payableDays} = ${money(Math.round(hc.potentialAmount * 100), r.currency)}`, ...capLines, ...assumed.map((x) => x.replace(/^assuming/, "Assuming"))];
  return finish({ ...base, kind, conditions: conds, requirements: [], amount: cents / 100, currency: r.currency, record, steps: lines });
}

/** An item-code cell of a table row ("B", "12", "4.2", "(a)", "iii."): never the benefit's label. */
const ITEM_CODE = /^\(?(?:[A-Z]{1,2}|[ivx]{1,4}|\d{1,3}(?:\.\d{1,2})?)[.)]?$/i;
/** The noun for a rate unit's periods ("complete 24-hour periods", "days", "nights"). */
function unitNoun(u: string | null): string {
  return u === "complete_24h" ? "complete 24-hour periods" : u === "night" ? "nights" : "days";
}
/** A passage narrowed to the label cell of a table row that prints `text` (one figure for every column of the row). */
function narrowToLabel(e0: EvidenceRef, text: string): EvidenceRef {
  // Integration (r7): the label is the first cell that is not an item code (a row may start with one: "B").
  const labelCell = e0.passage.text.split(/\t|\s{3,}/).map((c) => c.trim()).find((c) => !ITEM_CODE.test(c)) ?? "";
  const i = labelCell ? e0.passage.text.indexOf(labelCell) : -1;
  if (i < 0 || !labelCell.includes(text)) return e0;
  return { ...e0, passage: { ...e0.passage, text: labelCell, start: e0.passage.start + i, end: e0.passage.start + i + labelCell.length }, table: null, support: null, context: null };
}

// --------------------------------------------------------------------------------------------- bill reimbursement
export function billReimbursement(a: {
  subjectId: string; who: string; benefit: string; terms: BenefitTerms; bill: HouseholdInput | null;
  subLimits: DocValue[]; limits: DocValue[]; deductible?: DocValue | null; coInsurance?: DocValue | null; coInsuranceCap?: DocValue | null;
  settled?: { id: string; status: "established" | "not_applicable"; words: string }[]; whatIf: boolean;
}): CalcOutcome | Refusal {
  const t = a.terms, product = t.productName ?? "this policy";
  const all = [...a.subLimits, ...a.limits, ...(a.deductible ? [a.deductible] : []), ...(a.coInsuranceCap ? [a.coInsuranceCap] : [])];
  if (!a.subLimits.length && !a.limits.length && !a.deductible && !a.coInsurance) return { refused: "a bill calculation needs at least one printed limit, deductible or co-insurance" };
  for (const v of [...all, ...(a.coInsurance ? [a.coInsurance] : [])]) if (v.operand.evidence.policyId !== t.policyId) return { refused: `${v.operand.benefit} is from another document than the one calculated for` };
  for (const v of all) if (v.operand.valueKind !== "money" || v.operand.cents == null || !v.operand.currency) return { refused: `${v.operand.benefit} is not a printed amount` };
  if (a.coInsurance && (a.coInsurance.operand.valueKind !== "percent" || a.coInsurance.operand.ppm == null)) return { refused: "the co-insurance must be a printed percentage" };
  const currencies = new Set(all.map((v) => v.operand.currency));
  const printed = [...all, ...(a.coInsurance ? [a.coInsurance] : [])].map((v) => printedOf(v, a.subjectId));
  const conds: CalcCondition[] = [];
  const reqs: string[] = [];
  const cur = [...currencies][0] ?? (a.bill?.currency ?? "SGD");
  if (currencies.size > 1) return { refused: `mixed currencies (${[...currencies].join(", ")}) are never combined` };
  if (a.bill && a.bill.currency && a.bill.currency !== cur) {
    conds.push({ id: "c_currency", kind: "currency", text: `The bill is in ${a.bill.currency}; the policy’s figures are in ${cur}. DearPolicy never converts currencies.`, status: "unresolved", basis: "none", needs: `the bill amount in ${cur} (the bill you gave is in ${a.bill.currency}; the insurer converts it)` });
  }
  if (a.deductible && a.coInsurance) {
    if (t.deductionOrder) conds.push({ id: "c_order", kind: "deduction_order", text: `Order of deductions: “${t.deductionOrder.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.deductionOrder.evidence) });
    else conds.push({ id: "c_order", kind: "deduction_order", text: "The stored wording does not say whether the deductible or the co-insurance is applied first, which changes the result.", status: "unresolved", basis: "none", needs: `whether ${product} applies the deductible or the co-insurance first (the stored wording does not say; only the insurer can confirm it)` });
  }
  t.exclusions.forEach((x, i) => conds.push({ id: "c_excl_" + (i + 1), kind: "exclusion", text: `Exclusion: “${x.evidence.passage.text}”`, status: "unresolved", basis: "none", passage: passageOf(x.evidence), needs: `whether this applies to ${a.who}’s bill: “${x.evidence.passage.text}”` }));
  // Integration (D28): the order of the excess / deductible and the limit follows the wording. Stated -> applied as
  // stated; silent or contradictory -> unresolved, but only when the order changes the result for this bill.
  let limitFirst = false;
  const dedMinor = a.deductible?.operand.cents ?? null, limMinor = a.limits.length ? Math.min(...a.limits.map((v) => v.operand.cents!)) : null;
  if (dedMinor != null && limMinor != null && !a.coInsurance) {
    const b = a.bill && typeof a.bill.value === "number" ? Math.round(a.bill.value * 100) : null;
    const subCap0 = a.subLimits.length ? Math.min(...a.subLimits.map((v) => v.operand.cents!)) : null;
    const base0 = b == null ? null : subCap0 != null ? Math.min(b, subCap0) : b;
    const matters = base0 == null || Math.max(0, Math.min(base0, limMinor) - dedMinor) !== Math.min(Math.max(0, base0 - dedMinor), limMinor);
    if (t.limitOrder && !t.limitOrderConflict.length) {
      limitFirst = t.limitOrder.value === "limit_first";
      conds.push({ id: "c_limit_order", kind: "deduction_order", text: `Order of the ${a.deductible!.operand.benefit.toLowerCase()} and the limit: “${t.limitOrder.evidence.passage.text}”`, status: "established", basis: "document", passage: passageOf(t.limitOrder.evidence) });
    } else if (matters) {
      conds.push({ id: "c_limit_order", kind: "deduction_order", text: t.limitOrderConflict.length ? "The stored wording states the order of the excess and the limit in two different ways, which changes the result." : "The stored wording does not say whether the excess is deducted before or after the limit is applied, which changes the result.", status: "unresolved", basis: "none", needs: `whether ${product} deducts the ${a.deductible!.operand.benefit.toLowerCase()} before or after applying the limit (the stored wording ${t.limitOrderConflict.length ? "is contradictory" : "does not say"}; only the insurer can confirm it)` });
    }
  }
  applySettled(conds, a.settled ?? []);
  const billOk = !!a.bill && typeof a.bill.value === "number" && Number.isFinite(a.bill.value) && a.bill.value >= 0 && !!a.bill.currency && !!a.bill.words?.trim();
  if (!billOk) reqs.push(`the amount of ${a.who}’s bill, with its currency`);
  for (const c of conds) if (c.status === "unresolved" && c.needs) reqs.push(c.needs);
  const evidence = printed.map((p) => p.evidence).concat(t.deductionOrder ? [t.deductionOrder.evidence] : []).concat(limitFirst || conds.some((c) => c.id === "c_limit_order" && c.status === "established") ? [t.limitOrder!.evidence] : []);
  const evidenceRequirements = [`the itemised hospital or clinic bill (the insurer reviews the bill itself; the amount you gave is not a reviewed bill)`, `the ${product} claim form`];
  const base = { calculator: "bill_reimbursement" as const, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, evidence, evidenceRequirements, who: a.who, product };
  const unresolved = () => finish({ ...base, kind: "unresolved", conditions: conds, requirements: [...new Set(reqs)], amount: null, currency: cur, record: null, steps: [] });
  if (reqs.length || conds.some((c) => c.status === "unresolved" && (c.kind === "deduction_order" || c.kind === "currency"))) return unresolved();
  if (!a.whatIf && !settledStatus(conds)) return unresolved();

  // The claims calculator does the arithmetic (one engine): the household's bill as one eligible line.
  const billMinor = Math.round(Number(a.bill!.value) * 100);
  const minor = (v: DocValue) => v.operand.cents!;
  const subCap0 = a.subLimits.length ? Math.min(...a.subLimits.map(minor)) : null;
  // Limit applied before the deductions (as the wording states): it acts as a cap on the eligible bill.
  const limCap = a.limits.length ? Math.min(...a.limits.map(minor)) : null;
  const subCap = limitFirst && limCap != null ? (subCap0 != null ? Math.min(subCap0, limCap) : limCap) : subCap0;
  const deductionSteps: DeductionStep[] = [];
  const ref = (v: DocValue) => ({ policyId: t.policyId, pageStart: v.operand.evidence.page.start, pageEnd: v.operand.evidence.page.end, label: v.operand.benefit });
  const dedStep = a.deductible ? { kind: "deductible" as const, amountMinor: minor(a.deductible), evidence: ref(a.deductible) } : null;
  const coStep = a.coInsurance ? { kind: "co_insurance" as const, percent: a.coInsurance.operand.ppm! / 10_000, evidence: ref(a.coInsurance) } : null;
  const coFirst = t.deductionOrder?.value === "co_insurance_first";
  for (const s of coFirst ? [coStep, dedStep] : [dedStep, coStep]) if (s) deductionSteps.push(s);
  const anyRef = ref(all[0] ?? a.coInsurance!);
  const mr = calculateMedicalReimbursement({ currency: cur, eligibleCategories: ["household_reported_bill"], billedItems: [{ category: "household_reported_bill", description: a.bill!.words, amountMinor: billMinor }],
    categoryLimits: subCap != null ? [{ category: "household_reported_bill", capMinor: subCap, evidence: anyRef }] : [], wardProration: null,
    // No panel restriction is part of this calculation (the wording read prints none for it): the panel step leaves the amount unchanged.
    panelRestriction: { panelStatus: "panel", nonPanelFactor: null, evidence: anyRef },
    deductionSteps, deductionOrderEvidenced: deductionSteps.length <= 1 || !!t.deductionOrder,
    perAdmissionCap: a.limits.length && !limitFirst ? { amountMinor: Math.min(...a.limits.map(minor)), evidence: anyRef } : null,
    thirdPartyCoordination: null, thirdPartyPayments: [], remainingLimits: [], ownership: { contractId: t.policyId, label: product }, ruleEvidence: anyRef, ownershipEvidence: anyRef, unresolvedConditions: [] });
  if (mr.status === "blocked") { reqs.push(mr.message); return unresolved(); }
  // A co-insurance cap is applied by the shared deduction core (the claims calculator has no cap on the share).
  const ops: CalcOperand[] = [householdOperand("bill", "bill", "bill", "money", { ...a.bill!, currency: a.bill!.currency ?? cur })];
  const steps: CalcStep[] = [];
  let last = "bill", running = billMinor;
  const lines: string[] = [`the bill you gave: ${money(billMinor, cur)}`];
  const addDoc = (id: string, role: Extract<CalcOperand, { source: "document" }>["role"], v: DocValue) => { const o = docOperand(id, role, v, a.subjectId); if (typeof o === "string") throw new Error(o); ops.push(o); return o; };
  try {
    if (a.subLimits.length) { const ids = a.subLimits.map((v, i) => addDoc("sub" + (i + 1), "limit", v).id); running = Math.min(running, subCap0!); steps.push({ id: "s_sub", op: "min", inputs: [last, ...ids], out: running }); last = "s_sub"; lines.push(`up to the sub-limit${ids.length > 1 ? "s" : ""}: ${money(running, cur)}`); }
    const applyDed = () => { if (!a.deductible) return; const d = addDoc("deductible", "deductible", a.deductible); running = Math.max(0, running - minor(a.deductible)); steps.push({ id: "s_ded", op: "deductible", inputs: [last, d.id], out: running }); last = "s_ded"; lines.push(`less the deductible ${money(minor(a.deductible), cur)}: ${money(running, cur)}`); };
    const applyCo = () => {
      if (!a.coInsurance) return; const p = addDoc("co_insurance", "co_insurance", a.coInsurance); const capO = a.coInsuranceCap ? addDoc("co_cap", "co_insurance_cap", a.coInsuranceCap) : null;
      const before = running;
      const share = applyDeductionCore(before, { kind: "co_insurance", ppm: a.coInsurance.operand.ppm! }).householdShareMinor;
      const out = applyDeductionCore(before, { kind: "co_insurance", ppm: a.coInsurance.operand.ppm!, capMinor: capO ? minor(a.coInsuranceCap!) : null });
      const cappedShare = out.householdShareMinor;
      running = out.afterMinor;
      steps.push({ id: "s_co", op: "co_insurance", inputs: capO ? [last, p.id, capO.id] : [last, p.id], out: running }); last = "s_co";
      lines.push(`less your ${a.coInsurance.operand.ppm! / 10_000}% co-insurance share ${money(cappedShare, cur)}${capO && cappedShare < share ? ` (capped at ${money(minor(a.coInsuranceCap!), cur)})` : ""}: ${money(running, cur)}`);
    };
    const applyLim = () => { if (!a.limits.length) return;  const ids = a.limits.map((v, i) => addDoc("lim" + (i + 1), "limit", v).id); running = Math.min(running, ...a.limits.map(minor)); steps.push({ id: "s_lim", op: "min", inputs: [last, ...ids], out: running }); last = "s_lim"; lines.push(`up to the limit${ids.length > 1 ? "s" : ""}: ${money(running, cur)}`); };
    if (limitFirst) applyLim();
    if (coFirst) { applyCo(); applyDed(); } else { applyDed(); applyCo(); }
    if (!limitFirst) applyLim();
  } catch (e) { return { refused: e instanceof Error ? e.message : String(e) }; }
  // One engine: without a co-insurance cap, the steps must reproduce the claims calculator exactly.
  const mrMinor = mr.status === "calculated" ? Math.round(mr.potentialAmount * 100) : 0;
  if (!a.coInsuranceCap && mrMinor !== running) return { refused: `internal: the bill steps (${running}) do not reproduce the claims calculator (${mrMinor})` };
  if (!steps.length) return { refused: "nothing to calculate" };
  if (running === 0) return finish({ ...base, kind: "not_payable", conditions: conds, requirements: [], amount: null, currency: cur, record: null, steps: lines, reason: a.deductible && billMinor <= minor(a.deductible) ? `the bill you gave (${money(billMinor, cur)}) does not exceed the deductible` : "nothing is left after the deductions" });
  const kind = a.bill!.kind === "assumption" ? "conditional_illustration" : "indicative_estimate";
  if (kind === "conditional_illustration" && !a.whatIf) return { refused: "an assumed figure is used only for a what-if the household asked (purpose what_if)" };
  const record: Omit<CalculationRecord, "sentence"> = { id: "", calculator: "bill_reimbursement", kind, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, operands: ops, steps, result: { value: running / 100, currency: cur }, currency: cur, rounding: { mode: "half_up", precision: 2, source: "default" }, conditions: conds, evidenceRequirements, assumption: kind === "conditional_illustration" ? a.bill!.words.trim() : null, unresolvedText: "" };
  return finish({ ...base, kind, conditions: conds, requirements: [], amount: running / 100, currency: cur, record, steps: lines });
}

// ------------------------------------------------------------------------------------------------------ lump sums
export function lumpSum(a: { subjectId: string; who: string; benefit: string; terms: BenefitTerms; sumInsured: DocValue; percent?: DocValue | null; cap?: DocValue | null; condition: string; whatIf: boolean; assumptionWords?: string | null }): CalcOutcome | Refusal {
  const t = a.terms, product = t.productName ?? "this policy";
  const s = a.sumInsured.operand;
  if (s.valueKind !== "money" || s.cents == null || !s.currency) return { refused: "the sum insured must be a printed amount" };
  if (a.percent && (a.percent.operand.valueKind !== "percent" || a.percent.operand.ppm == null)) return { refused: "the percentage must be a printed percentage" };
  if (a.cap && (a.cap.operand.valueKind !== "money" || a.cap.operand.currency !== s.currency)) return { refused: "the cap must be a printed amount in the same currency" };
  const printed = [a.sumInsured, ...(a.percent ? [a.percent] : []), ...(a.cap ? [a.cap] : [])].map((v) => printedOf(v, a.subjectId));
  // The claim workflow requires a reviewed decision that the medical evidence meets the policy's own definition
  // (CIDefinitionMatch / DisabilityDefinitionMatch / cause-of-death match, by an authorised reviewer). Never waived here.
  const conds: CalcCondition[] = [{ id: "c_definition", kind: "definition", text: `${a.condition} must meet ${product}’s own definition, confirmed by a reviewed medical decision.`, status: "unresolved", basis: "none", needs: `a reviewed decision that ${a.who}’s diagnosis meets ${product}’s definition of ${a.condition} (the insurer’s medical assessment)` }];
  const evidenceRequirements = ["the specialist’s diagnosis report", "the insurer’s claim form and medical assessment"];
  const base = { calculator: "lump_sum" as const, subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, printed, evidence: printed.map((p) => p.evidence), evidenceRequirements, who: a.who, product };
  // V1.1: a lump sum is only ever a conditional illustration (the definition is the insurer's to confirm) -- for a
  // what-if, or for an event the household reported, with their own words as the stated assumption.
  if (!a.percent || !a.assumptionWords?.trim()) return finish({ ...base, kind: "unresolved", conditions: conds, requirements: [conds[0].needs!], amount: null, currency: s.currency, record: null, steps: [] });
  const ops: CalcOperand[] = [];
  const sum = docOperand("sum_insured", "sum_insured", a.sumInsured, a.subjectId), pct = docOperand("percent", "percent", a.percent, a.subjectId);
  if (typeof sum === "string") return { refused: sum }; if (typeof pct === "string") return { refused: pct };
  ops.push(sum, pct);
  const part = Number(divHalfUp(BigInt(s.cents) * BigInt(a.percent.operand.ppm!), 1_000_000n));
  const steps: CalcStep[] = [{ id: "s_part", op: "percent_of", inputs: ["sum_insured", "percent"], out: part }];
  let out = part;
  if (a.cap) { const c = docOperand("cap", "cap", a.cap, a.subjectId); if (typeof c === "string") return { refused: c }; ops.push(c); out = Math.min(part, a.cap.operand.cents!); steps.push({ id: "s_cap", op: "min", inputs: ["s_part", "cap"], out }); }
  const record: Omit<CalculationRecord, "sentence"> = { id: "", calculator: "lump_sum", kind: "conditional_illustration", subjectId: a.subjectId, policyId: t.policyId, benefit: a.benefit, documentHash: t.documentHash, operands: ops, steps, result: { value: out / 100, currency: s.currency }, currency: s.currency, rounding: { mode: "half_up", precision: 2, source: "default" }, conditions: conds, evidenceRequirements, assumption: a.assumptionWords.trim(), unresolvedText: "" };
  return finish({ ...base, kind: "conditional_illustration", conditions: conds, requirements: [conds[0].needs!], amount: out / 100, currency: s.currency, record, steps: [`${a.percent.operand.ppm! / 10_000}% of ${money(s.cents, s.currency)} = ${money(part, s.currency)}`, ...(a.cap ? [`capped at ${money(a.cap.operand.cents!, s.currency)}: ${money(out, s.currency)}`] : [])] });
}

export type { PolicyDayRule };
