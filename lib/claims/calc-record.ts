/**
 * Re-running a CalculationRecord (types/index.ts) step by step, deterministically, with the SAME arithmetic the claim
 * calculators use: lib/claims/day-count.ts for payable days under the policy's own day-count rule, the hospital-cash
 * formula of lib/claims/calculators/hospital-cash.ts (min(day cap, max(0, days - waiting days)) x daily rate), and
 * the deduction core of lib/claims/calculators/deductions.ts (deductible, co-insurance with optional cap, caps).
 *
 * Used twice: by the conversation calculation tool when it builds a record (a record that does not re-run is never issued) and by the
 * save-time gate (lib/chat/answer-verification.ts), which trusts nothing in the record but re-runs it. Pure.
 */
import type { CalculationRecord, CalcOperand, CalcStep } from "@/types";
import { payableDaysUnderRule } from "./day-count";
import { applyDeductionCore, capCore, divHalfUp } from "./calculators/deductions";

export type CalcValue = { unit: "money" | "count" | "percent" | "datetime" | "date"; n: number; s?: string; currency?: string | null };
export type RecomputeResult = { ok: true; values: Map<string, CalcValue>; resultMinor: number } | { ok: false; error: string };

const toMinor = (v: number) => Math.round(v * 100);
export function operandValue(o: CalcOperand): CalcValue | string {
  if (o.unit === "money") {
    if (typeof o.value !== "number" || !Number.isFinite(o.value) || o.value < 0) return `operand ${o.id} is not an amount`;
    if (!o.currency || !/^[A-Z]{3}$/.test(o.currency)) return `operand ${o.id} has no currency`;
    return { unit: "money", n: toMinor(o.value), currency: o.currency };
  }
  if (o.unit === "count") {
    if (typeof o.value !== "number" || !Number.isInteger(o.value) || o.value < 0) return `operand ${o.id} is not a whole number`;
    return { unit: "count", n: o.value };
  }
  if (o.unit === "percent") {
    if (typeof o.value !== "number" || !(o.value >= 0 && o.value <= 100)) return `operand ${o.id} is not a percentage`;
    return { unit: "percent", n: Math.round(o.value * 10_000) };
  }
  if (typeof o.value !== "string" || !o.value) return `operand ${o.id} is not a ${o.unit}`;
  return { unit: o.unit, n: 0, s: o.value };
}

function divRound(n: bigint, d: bigint, mode: CalculationRecord["rounding"]["mode"]): bigint {
  const q = n / d, r = n % d;
  if (r === 0n) return q;
  if (mode === "up") return q + 1n;
  if (mode === "down") return q;
  if (mode === "half_even") return r * 2n > d || (r * 2n === d && q % 2n === 1n) ? q + 1n : q;
  return r * 2n >= d ? q + 1n : q;
}

/** Re-runs every step; the error names the first step that does not reproduce. */
export function recomputeCalculation(r: Pick<CalculationRecord, "operands" | "steps" | "result" | "currency" | "rounding">): RecomputeResult {
  if (!r || !Array.isArray(r.operands) || !Array.isArray(r.steps) || !r.steps.length) return { ok: false, error: "the calculation has no steps" };
  if (!r.currency || !/^[A-Z]{3}$/.test(r.currency) || r.result?.currency !== r.currency) return { ok: false, error: "the calculation does not state one currency" };
  const values = new Map<string, CalcValue>();
  for (const o of r.operands) {
    if (!o || typeof o.id !== "string" || values.has(o.id)) return { ok: false, error: "an operand has no id of its own" };
    const v = operandValue(o);
    if (typeof v === "string") return { ok: false, error: v };
    if (v.unit === "money" && v.currency !== r.currency) return { ok: false, error: `mixed currencies: ${o.label} is in ${v.currency}, the calculation in ${r.currency}` };
    values.set(o.id, v);
  }
  const get = (id: string, unit: CalcValue["unit"] | CalcValue["unit"][]): CalcValue | string => {
    const v = values.get(id);
    if (!v) return `step input ${id} is not an operand or an earlier step`;
    const units = Array.isArray(unit) ? unit : [unit];
    return units.includes(v.unit) ? v : `step input ${id} is a ${v.unit}, not a ${units.join(" or ")}`;
  };
  let last: CalcValue | null = null;
  for (const s of r.steps as CalcStep[]) {
    if (!s || typeof s.id !== "string" || values.has(s.id) || !Array.isArray(s.inputs)) return { ok: false, error: "a step has no id of its own" };
    let out: CalcValue;
    switch (s.op) {
      case "day_count": {
        const a = get(s.inputs[0], ["datetime", "date"]), b = get(s.inputs[1], ["datetime", "date"]);
        if (typeof a === "string") return { ok: false, error: a }; if (typeof b === "string") return { ok: false, error: b };
        if (s.rule === "completed_24h_remainder" && !(typeof s.remainderHours === "number" && s.remainderHours > 0 && s.remainderHours < 24)) return { ok: false, error: "the day count's remainder hours are not stated" };
        const d = payableDaysUnderRule(s.rule, a.s ?? null, b.s ?? null, Array.isArray(s.edges) ? s.edges : [], { remainderHours: s.remainderHours ?? null });
        if (d.status !== "calculated") return { ok: false, error: `the day count cannot be worked out: ${d.message}` };
        out = { unit: "count", n: d.grossNights }; break;
      }
      case "days_after_waiting": {
        const a = get(s.inputs[0], "count"); if (typeof a === "string") return { ok: false, error: a };
        if (!Number.isInteger(s.waitingDays) || s.waitingDays < 0) return { ok: false, error: "the waiting days are not a whole number" };
        out = { unit: "count", n: Math.max(0, a.n - s.waitingDays) }; break;
      }
      case "min_count": {
        const xs = s.inputs.map((id) => get(id, "count"));
        const bad = xs.find((x) => typeof x === "string"); if (bad) return { ok: false, error: bad as string };
        if (xs.length < 2) return { ok: false, error: "a smallest-of needs two or more inputs" };
        out = { unit: "count", n: Math.min(...(xs as CalcValue[]).map((x) => x.n)) }; break;
      }
      case "multiply": {
        const a = get(s.inputs[0], "money"), b = get(s.inputs[1], "count");
        if (typeof a === "string") return { ok: false, error: a }; if (typeof b === "string") return { ok: false, error: b };
        out = { unit: "money", n: a.n * b.n, currency: a.currency }; break;
      }
      case "min": {
        const xs = s.inputs.map((id) => get(id, "money"));
        const bad = xs.find((x) => typeof x === "string"); if (bad) return { ok: false, error: bad as string };
        if (xs.length < 2) return { ok: false, error: "a smallest-of needs two or more inputs" };
        const [first, ...caps] = xs as CalcValue[];
        out = { unit: "money", n: capCore(first.n, caps.map((c) => c.n)).afterMinor, currency: first.currency }; break;
      }
      case "deductible": {
        const a = get(s.inputs[0], "money"), d = get(s.inputs[1], "money");
        if (typeof a === "string") return { ok: false, error: a }; if (typeof d === "string") return { ok: false, error: d };
        out = { unit: "money", n: applyDeductionCore(a.n, { kind: "deductible", amountMinor: d.n }).afterMinor, currency: a.currency }; break;
      }
      case "co_insurance": {
        const a = get(s.inputs[0], "money"), p = get(s.inputs[1], "percent"), c = s.inputs[2] ? get(s.inputs[2], "money") : null;
        if (typeof a === "string") return { ok: false, error: a }; if (typeof p === "string") return { ok: false, error: p }; if (typeof c === "string") return { ok: false, error: c };
        out = { unit: "money", n: applyDeductionCore(a.n, { kind: "co_insurance", ppm: p.n, capMinor: c ? c.n : null }).afterMinor, currency: a.currency }; break;
      }
      case "percent_of": {
        const a = get(s.inputs[0], "money"), p = get(s.inputs[1], "percent");
        if (typeof a === "string") return { ok: false, error: a }; if (typeof p === "string") return { ok: false, error: p };
        out = { unit: "money", n: Number(divHalfUp(BigInt(a.n) * BigInt(p.n), 1_000_000n)), currency: a.currency }; break;
      }
      default: return { ok: false, error: "a step’s operation is not one the calculation contract knows" };
    }
    if (!Number.isFinite(s.out) || s.out !== out.n) return { ok: false, error: `step ${s.id} (${s.op}) states ${s.out}, but re-running it gives ${out.n}` };
    values.set(s.id, out); last = out;
  }
  if (!last || last.unit !== "money") return { ok: false, error: "the last step is not an amount" };
  const mode = r.rounding?.mode, precision = r.rounding?.precision;
  if (!mode || !["half_up", "half_even", "down", "up"].includes(mode) || ![0, 1, 2].includes(precision as number)) return { ok: false, error: "the calculation does not state its rounding" };
  const step = precision === 2 ? 1n : precision === 1 ? 10n : 100n;
  const resultMinor = Number(divRound(BigInt(last.n), step, mode) * step);
  if (toMinor(r.result.value) !== resultMinor) return { ok: false, error: "the stated result is not the re-run one with the stated rounding" };
  return { ok: true, values, resultMinor };
}
