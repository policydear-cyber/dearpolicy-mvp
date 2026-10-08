/**
 * Conversational RAG: deterministic calculations in integer cents.
 *
 * Inputs are only (a) values read from a table through selectTableValue (each with its EvidenceRef) or (b) figures the
 * household itself gave, explicitly attributed (`attribution` quotes their words). Arithmetic is integer cents (BigInt
 * where a product could exceed 2^53); percentages are parts-per-million. Rounding is the policy's own rule when one is
 * supplied with its evidence, else half-up to the cent -- and the result says which. Mixed currencies are refused.
 *
 * Every result is labelled: "printed_limit" (only printed limits combined -- e.g. a per-day limit x its printed day
 * cap) or "indicative_estimate" (anything involving the household's own figures, a deductible or co-insurance). It is
 * never called a payout. An estimate never enters a total. Each result carries its steps and, where the existing
 * save-time gate can recompute it (sums, differences and whole-number multiples of cited printed figures), a
 * ComputationRecord (types/index.ts) whose operands are bound to their passages.
 */
import { printedPeriodsOf } from "@/lib/chat/assertions";
import type { ComputationOperand, ComputationRecord, FigurePeriod } from "@/types";
import { toFigureBinding, type EvidenceRef } from "./evidence";
import { applyDeductionCore } from "@/lib/claims/calculators/deductions";
import type { Period } from "./tables";

export type TableValueOperand = {
  kind: "table_value"; benefit: string; valueKind: "money" | "percent" | "count";
  cents?: number | null; ppm?: number | null; count?: number | null; currency?: string | null; period?: Period;
  evidence: EvidenceRef; role?: "benefit" | "premium";
};
export type HouseholdFigure = {
  kind: "household_figure"; label: string;
  /** The household's own words the figure comes from (required: an unattributed figure is refused). */
  attribution: string;
  cents?: number | null; count?: number | null; ppm?: number | null; currency?: string | null;
};
export type Operand = TableValueOperand | HouseholdFigure | ComputeOk;
export type RoundingRule = { mode: "half_up" | "half_even" | "down" | "up"; precision: 0 | 1 | 2; source: "policy" | "default"; statement: string; evidence?: EvidenceRef | null };
export type ComputeKind = "printed_limit" | "indicative_estimate";
export type ComputeOk = {
  status: "ok"; kind: ComputeKind; operation: string; label: string;
  cents: number; currency: string; amount: number; steps: string[]; rounding: RoundingRule;
  evidence: EvidenceRef[]; householdFigures: HouseholdFigure[];
  /** For the save-time gate; null when the gate cannot recompute this kind of result (recordNote says why). */
  record: Omit<ComputationRecord, "sentence"> | null; recordNote: string | null;
};
export type ComputeResult = ComputeOk | { status: "refused"; reason: string };

export const DEFAULT_ROUNDING: RoundingRule = { mode: "half_up", precision: 2, source: "default", statement: "Rounded half-up to the cent (no rounding rule is printed in the policy)." };
const refuse = (reason: string): ComputeResult => ({ status: "refused", reason });
const isOk = (o: Operand): o is ComputeOk => (o as ComputeOk).status === "ok";
export const money = (cents: number, currency: string) => `${currency === "SGD" ? "S$" : currency === "USD" ? "US$" : currency + " "}${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Divides a BigInt by 10^k with the rounding rule (to an integer). */
function divRound(n: bigint, d: bigint, mode: RoundingRule["mode"]): bigint {
  const neg = n < 0n; const a = neg ? -n : n;
  const q = a / d, r = a % d;
  let up = false;
  if (r !== 0n) {
    if (mode === "up") up = true;
    else if (mode === "half_up") up = r * 2n >= d;
    else if (mode === "half_even") up = r * 2n > d || (r * 2n === d && q % 2n === 1n);
  }
  const v = up ? q + 1n : q;
  return neg ? -v : v;
}
/** Rounds whole cents to the rule's precision (precision 2 = cents: unchanged). */
function roundCents(cents: bigint, rule: RoundingRule): bigint {
  if (rule.precision >= 2) return cents;
  const step = rule.precision === 1 ? 10n : 100n;
  return divRound(cents, step, rule.mode) * step;
}

type MoneyIn = { cents: number; currency: string; estimate: boolean; household: HouseholdFigure[]; evidence: EvidenceRef[]; describe: string; operand: TableValueOperand | null };
function moneyOf(o: Operand, what: string): MoneyIn | string {
  if (isOk(o)) return { cents: o.cents, currency: o.currency, estimate: o.kind === "indicative_estimate", household: o.householdFigures, evidence: o.evidence, describe: `${o.label} ${money(o.cents, o.currency)}`, operand: null };
  if (o.kind === "household_figure") {
    if (!o.attribution?.trim()) return `the household figure for ${what} is not attributed to the household's own words`;
    if (o.cents == null || !Number.isInteger(o.cents) || !o.currency) return `the household figure for ${what} is not an amount with a currency`;
    return { cents: o.cents, currency: o.currency.toUpperCase(), estimate: true, household: [o], evidence: [], describe: `${o.label} ${money(o.cents, o.currency)} (your figure: “${o.attribution.trim()}”)`, operand: null };
  }
  if (!o.evidence) return `the value for ${what} has no evidence`;
  if (o.valueKind !== "money" || o.cents == null || !Number.isInteger(o.cents) || !o.currency) return `the value for ${what} is not a printed amount`;
  return { cents: o.cents, currency: o.currency, estimate: false, household: [], evidence: [o.evidence], describe: `${o.benefit} ${money(o.cents, o.currency)} (page ${o.evidence.passage.onPage})`, operand: o };
}
function countOf(o: Operand, what: string): { count: number; estimate: boolean; household: HouseholdFigure[]; evidence: EvidenceRef[]; describe: string } | string {
  if (isOk(o)) return `${what} must be a count, not a computed amount`;
  if (o.kind === "household_figure") {
    if (!o.attribution?.trim()) return `the household figure for ${what} is not attributed to the household's own words`;
    if (o.count == null || !Number.isInteger(o.count) || o.count < 0) return `the household figure for ${what} is not a whole number`;
    return { count: o.count, estimate: true, household: [o], evidence: [], describe: `${o.count} (your figure: “${o.attribution.trim()}”)` };
  }
  if (o.valueKind !== "count" || o.count == null || !Number.isInteger(o.count)) return `the value for ${what} is not a printed count`;
  return { count: o.count, estimate: false, household: [], evidence: [o.evidence], describe: `${o.count} (${o.benefit}, page ${o.evidence.passage.onPage})` };
}
function ppmOf(o: Operand, what: string): { ppm: number; estimate: boolean; household: HouseholdFigure[]; evidence: EvidenceRef[]; describe: string } | string {
  if (isOk(o)) return `${what} must be a percentage, not a computed amount`;
  if (o.kind === "household_figure") {
    if (!o.attribution?.trim()) return `the household figure for ${what} is not attributed to the household's own words`;
    if (o.ppm == null || !Number.isInteger(o.ppm) || o.ppm < 0 || o.ppm > 1_000_000) return `the household figure for ${what} is not a percentage`;
    return { ppm: o.ppm, estimate: true, household: [o], evidence: [], describe: `${o.ppm / 10000}% (your figure)` };
  }
  if (o.valueKind !== "percent" || o.ppm == null || !Number.isInteger(o.ppm) || o.ppm < 0 || o.ppm > 1_000_000) return `the value for ${what} is not a printed percentage`;
  return { ppm: o.ppm, estimate: false, household: [], evidence: [o.evidence], describe: `${o.ppm / 10000}% (${o.benefit}, page ${o.evidence.passage.onPage})` };
}

const FIG_PERIOD: Record<string, FigurePeriod> = { day: "day", week: "week", month: "month", quarter: "quarter", half_year: "half_year", year: "year", event: "event", lifetime: "lifetime" };
/** A gate operand for a cited printed amount, its period read the way the gate reads it from the passage. */
function gateOperand(o: TableValueOperand): ComputationOperand | null {
  const value = (o.cents ?? 0) / 100, currency = o.currency ?? "";
  const binding = toFigureBinding(o.evidence, o.benefit, value, currency);
  if (!binding) return null;
  const printed = printedPeriodsOf(value, currency, o.evidence.passage.text).find((p) => p != null) ?? null;
  return { value, currency, period: printed ? (FIG_PERIOD[printed] ?? (printed as FigurePeriod)) : null, role: o.role ?? "benefit", binding };
}
function recordFor(op: "sum" | "difference" | "product", ins: MoneyIn[], resultCents: number, currency: string, factor?: number): { record: ComputeOk["record"]; note: string | null } {
  if (ins.some((i) => !i.operand)) return { record: null, note: "the save-time gate recomputes only cited printed figures; this result combines the household's own figures or other results, so it is stated as an indicative estimate without a figure binding" };
  const ops = ins.map((i) => gateOperand(i.operand!));
  if (ops.some((o) => !o)) return { record: null, note: "an operand's passage does not print its value, or names no person" };
  const periods = new Set(ops.map((o) => o!.period));
  if (periods.size > 1) return { record: null, note: "the operands are printed per different periods" };
  return { record: { result: { value: resultCents / 100, currency }, operation: op, operands: ops as ComputationOperand[], factor, period: ops[0]!.period, currency, rounding: { mode: "half_up", precision: 2 }, scope: new Set(ops.map((o) => o!.binding!.subjectId)).size > 1 ? "household" : "person" }, note: null };
}
function ok(kind: ComputeKind, operation: string, label: string, cents: bigint, currency: string, steps: string[], rounding: RoundingRule, ev: EvidenceRef[], hh: HouseholdFigure[], rec: { record: ComputeOk["record"]; note: string | null }): ComputeOk {
  const c = Number(cents);
  return { status: "ok", kind, operation, label, cents: c, currency, amount: c / 100, steps: [...steps, rounding.statement], rounding, evidence: ev, householdFigures: hh, record: kind === "printed_limit" ? rec.record : null, recordNote: kind === "printed_limit" ? rec.note : rec.note ?? "an indicative estimate is never bound as a printed figure" };
}
const sameCurrency = (xs: { currency: string }[]) => new Set(xs.map((x) => x.currency)).size === 1;

/** Sum of amounts (printed limits, or household figures). An estimate never enters a total. */
export function sum(operands: Operand[], label = "Total", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  if (operands.length < 2) return refuse("a sum needs two or more amounts");
  const ins: MoneyIn[] = [];
  for (const [i, o] of operands.entries()) { if (isOk(o) && o.kind === "indicative_estimate") return refuse("an indicative estimate never enters a total"); const m = moneyOf(o, `amount ${i + 1}`); if (typeof m === "string") return refuse(m); ins.push(m); }
  if (!sameCurrency(ins)) return refuse(`mixed currencies (${[...new Set(ins.map((i) => i.currency))].join(", ")}) are never added together`);
  const total = ins.reduce((s, i) => s + BigInt(i.cents), 0n);
  const est = ins.some((i) => i.estimate);
  return ok(est ? "indicative_estimate" : "printed_limit", "sum", label, roundCents(total, rounding), ins[0].currency, [`${ins.map((i) => i.describe).join(" + ")} = ${money(Number(total), ins[0].currency)}`], rounding, ins.flatMap((i) => i.evidence), ins.flatMap((i) => i.household), recordFor("sum", ins, Number(total), ins[0].currency));
}

/** a - b. */
export function difference(a: Operand, b: Operand, label = "Difference", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const x = moneyOf(a, "the first amount"), y = moneyOf(b, "the second amount");
  if (typeof x === "string") return refuse(x); if (typeof y === "string") return refuse(y);
  if ((isOk(a) && a.kind === "indicative_estimate") || (isOk(b) && b.kind === "indicative_estimate")) return refuse("an indicative estimate never enters a total or difference");
  if (x.currency !== y.currency) return refuse(`mixed currencies (${x.currency}, ${y.currency}) are never subtracted`);
  const d = BigInt(x.cents) - BigInt(y.cents);
  return ok(x.estimate || y.estimate ? "indicative_estimate" : "printed_limit", "difference", label, roundCents(d, rounding), x.currency, [`${x.describe} − ${y.describe} = ${money(Number(d), x.currency)}`], rounding, [...x.evidence, ...y.evidence], [...x.household, ...y.household], recordFor("difference", [x, y], Number(d), x.currency));
}

/** A household-reported number of days or nights is never a payable-day count: per-day benefits count days by the
 * policy's own rule (first full day, complete 24 hours, each night...) from the admission and discharge -- the
 * `calculate` tool (lib/rag2/calc) does that through the claim calculators. */
export const HOUSEHOLD_DAYS_REFUSED = "a number of days or nights the household gives is not a payable-day count: use the calculate tool (calculator hospital_cash) with the admission and discharge, which applies the policy's own day-count rule";
const perDayRate = (x: MoneyIn) => !!x.operand && (x.operand.period === "day" || x.operand.period === "night" || /\bper (?:day|night)\b|\bdaily\b/i.test(x.operand.benefit));

/** amount x count (a whole number). */
export function product(a: Operand, count: Operand, label = "Product", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const x = moneyOf(a, "the amount"); if (typeof x === "string") return refuse(x);
  const n = countOf(count, "the count"); if (typeof n === "string") return refuse(n);
  if (n.estimate && perDayRate(x)) return refuse(HOUSEHOLD_DAYS_REFUSED);
  const p = BigInt(x.cents) * BigInt(n.count);
  const est = x.estimate || n.estimate;
  const rec = !est && n.count >= 2 && n.count <= 100 ? recordFor("product", [x], Number(p), x.currency, n.count) : { record: null, note: est ? null : "the gate recomputes multiples of 2 to 100 only" };
  return ok(est ? "indicative_estimate" : "printed_limit", "product", label, roundCents(p, rounding), x.currency, [`${x.describe} × ${n.describe} = ${money(Number(p), x.currency)}`], rounding, [...x.evidence, ...n.evidence], [...x.household, ...n.household], rec);
}

/** The smaller of an amount and a cap ("pays up to the limit"). */
export function minCap(a: Operand, cap: Operand, label = "Capped amount", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const x = moneyOf(a, "the amount"), c = moneyOf(cap, "the cap");
  if (typeof x === "string") return refuse(x); if (typeof c === "string") return refuse(c);
  if (x.currency !== c.currency) return refuse(`mixed currencies (${x.currency}, ${c.currency}) cannot be compared`);
  const v = x.cents <= c.cents ? x.cents : c.cents;
  return ok(x.estimate || c.estimate ? "indicative_estimate" : "printed_limit", "min_cap", label, roundCents(BigInt(v), rounding), x.currency, [`the smaller of ${x.describe} and the cap ${c.describe} = ${money(v, x.currency)}`], rounding, [...x.evidence, ...c.evidence], [...x.household, ...c.household], { record: null, note: "the gate has no min/cap operation" });
}

/** pct of an amount (pct in parts per million), rounded by the rule. */
export function percentage(base: Operand, pct: Operand, label = "Percentage", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const x = moneyOf(base, "the base amount"); if (typeof x === "string") return refuse(x);
  const p = ppmOf(pct, "the percentage"); if (typeof p === "string") return refuse(p);
  const raw = BigInt(x.cents) * BigInt(p.ppm);
  const cents = divRound(raw, 1_000_000n, rounding.mode);
  const exact = raw % 1_000_000n === 0n;
  return ok(x.estimate || p.estimate ? "indicative_estimate" : "printed_limit", "percentage", label, roundCents(cents, rounding), x.currency, [`${p.describe} of ${x.describe} = ${money(Number(cents), x.currency)}${exact ? "" : " (rounded)"}`], rounding, [...x.evidence, ...p.evidence], [...x.household, ...p.household], { record: null, note: "the gate has no percentage operation" });
}

/** A per-day rate x days, with a day cap (a printed maximum number of days) applied first. */
export function perDay(rate: Operand, days: Operand, dayCap: Operand | null = null, label = "Daily benefit", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const r = moneyOf(rate, "the daily rate"); if (typeof r === "string") return refuse(r);
  if (r.operand && r.operand.period && r.operand.period !== "day" && r.operand.period !== "night") return refuse(`the rate is printed per ${r.operand.period}, not per day`);
  const d = countOf(days, "the number of days"); if (typeof d === "string") return refuse(d);
  if (d.estimate) return refuse(HOUSEHOLD_DAYS_REFUSED);
  const cap = dayCap ? countOf(dayCap, "the day cap") : null; if (typeof cap === "string") return refuse(cap);
  const used = cap ? Math.min(d.count, cap.count) : d.count;
  const p = BigInt(r.cents) * BigInt(used);
  const steps = [cap ? `days counted: the smaller of ${d.describe} and the cap ${cap.describe} = ${used}` : `days counted: ${d.describe}`, `${r.describe} × ${used} days = ${money(Number(p), r.currency)}`];
  const est = r.estimate || d.estimate || !!cap?.estimate;
  const rec = !est && used >= 2 && used <= 100 && !cap ? recordFor("product", [r], Number(p), r.currency, used) : { record: null, note: est ? null : cap ? "the gate cannot recompute a day cap" : "the gate recomputes multiples of 2 to 100 only" };
  return ok(est ? "indicative_estimate" : "printed_limit", "per_day", label, roundCents(p, rounding), r.currency, steps, rounding, [...r.evidence, ...d.evidence, ...(cap?.evidence ?? [])], [...r.household, ...d.household, ...(cap?.household ?? [])], rec);
}

/** What is left of an amount after a deductible (never below zero). Always an indicative estimate. */
export function deductible(amount: Operand, ded: Operand, label = "After deductible", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const x = moneyOf(amount, "the amount"), y = moneyOf(ded, "the deductible");
  if (typeof x === "string") return refuse(x); if (typeof y === "string") return refuse(y);
  if (x.currency !== y.currency) return refuse(`mixed currencies (${x.currency}, ${y.currency}) are never subtracted`);
  const v = applyDeductionCore(x.cents, { kind: "deductible", amountMinor: y.cents }).afterMinor;
  return ok("indicative_estimate", "deductible", label, roundCents(BigInt(v), rounding), x.currency, [`${x.describe} − deductible ${y.describe} = ${money(v, x.currency)}${x.cents <= y.cents ? " (the deductible is not exceeded)" : ""}`], rounding, [...x.evidence, ...y.evidence], [...x.household, ...y.household], { record: null, note: null });
}

/** Co-insurance: the household's share (rate of the amount), capped at `cap` when given; returns the part the policy
 * would bear. Always an indicative estimate. */
export function coInsurance(amount: Operand, rate: Operand, cap: Operand | null = null, label = "After co-insurance", rounding: RoundingRule = DEFAULT_ROUNDING): ComputeResult {
  const x = moneyOf(amount, "the amount"); if (typeof x === "string") return refuse(x);
  const p = ppmOf(rate, "the co-insurance rate"); if (typeof p === "string") return refuse(p);
  const c = cap ? moneyOf(cap, "the co-insurance cap") : null; if (typeof c === "string") return refuse(c);
  if (c && c.currency !== x.currency) return refuse(`mixed currencies (${x.currency}, ${c.currency}) cannot be compared`);
  // The shared deduction core (lib/claims/calculators/deductions.ts) -- the same arithmetic as the claim calculator.
  const uncapped = applyDeductionCore(x.cents, { kind: "co_insurance", ppm: p.ppm });
  const core = applyDeductionCore(x.cents, { kind: "co_insurance", ppm: p.ppm, capMinor: c ? c.cents : null });
  const steps = [`co-insurance share: ${p.describe} of ${x.describe} = ${money(uncapped.householdShareMinor, x.currency)}`];
  if (core.capApplied && c) steps.push(`capped at ${c.describe}`);
  const share = BigInt(core.householdShareMinor);
  const borne = BigInt(core.afterMinor);
  steps.push(`${money(x.cents, x.currency)} − ${money(Number(share), x.currency)} = ${money(Number(borne), x.currency)}`);
  return ok("indicative_estimate", "co_insurance", label, roundCents(borne, rounding), x.currency, steps, rounding, [...x.evidence, ...p.evidence, ...(c?.evidence ?? [])], [...x.household, ...p.household, ...(c?.household ?? [])], { record: null, note: null });
}

/** A household figure, explicitly attributed ("you said the bill was S$2,400"). */
export function householdFigure(label: string, attribution: string, v: { amount?: number; currency?: string; count?: number; percent?: number }): HouseholdFigure {
  return { kind: "household_figure", label, attribution, cents: v.amount != null ? Math.round(v.amount * 100) : null, currency: v.currency ?? null, count: v.count ?? null, ppm: v.percent != null ? Math.round(v.percent * 10000) : null };
}
