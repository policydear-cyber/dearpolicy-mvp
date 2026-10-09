/**
 * A1 (r6): the unit terms of a calculation -- the printed rate, its unit, the payable-duration rule and each cap with
 * its reset period (lib/rag2/value-terms.ts) -- read from the rate's own evidence with page spans, carried on the
 * CalculationRecord (`unitTerms`) and re-checked against the record (checkUnitTerms): each term must re-read from its
 * span, the rate must be per day / night / complete 24-hour period, every cap must be applied by a step, and a cap
 * whose earlier use counts (it resets over a year, a policy year, a disability...) must have that earlier use settled
 * by the household, or the result must be a conditional illustration that states the assumption. Pure.
 */
import type { CalculationRecord } from "@/types";
import type { EvidenceRef } from "../evidence";
import { capSpansStays, PER_DAY_UNITS, readValueTerms, resetOf, type CapReset, type CountCap, type MoneyCap, type TermSource, type TermSpan, type ValueTerms } from "../value-terms";

/** A span of the calculation's document (page offsets when known). */
export type RecordSpan = { policyId: string; page: number | null; start: number; end: number; text: string; source: string };
export type PriorUse = "not_counted" | "household_none" | "household_figure" | "assumed_none";
export type RecordCap = { operandId: string; kind: "count" | "money"; max: number; currency: string | null; unit: string | null; reset: CapReset; span: RecordSpan;
  /** How earlier use within the reset period was settled: not_counted (the cap does not span stays), household_none /
   * household_figure (the household's words; a figure is a household operand), assumed_none (a what-if: stated). */
  priorUse: PriorUse; priorOperandId?: string | null };
export type UnitTerms = {
  rate: { unit: string | null; span: RecordSpan | null };
  durationRule: { rule: string; span: RecordSpan } | null;
  caps: RecordCap[];
};
export type RecordWithUnitTerms = Omit<CalculationRecord, "sentence"> & { unitTerms?: UnitTerms };

/** The texts one table value's evidence prints, with page offsets where they can be located: the value cell, the row
 * label, the column header (no offset: it is printed on the header line). A passage-only value reads its passage. */
export function termSourcesOf(e: EvidenceRef): TermSource[] {
  const p = e.passage, page = p.onPage;
  const at = (text: string, hint?: number | null) => {
    if (!text) return null;
    if (hint != null && p.text.slice(hint - p.start, hint - p.start + text.length) === text) return hint;
    const i = p.text.indexOf(text); return i >= 0 ? p.start + i : null;
  };
  if (!e.table) return [{ source: "passage", text: p.text, page, offset: p.start }];
  const out: TermSource[] = [];
  const cell = e.table.cell;
  if (cell?.text) out.push({ source: "cell", text: cell.text, page, offset: at(cell.text, cell.start) });
  const label = e.table.rowLabel ?? "";
  if (label) out.push({ source: "label", text: label, page, offset: at(label) });
  if (e.table.columnHeader) out.push({ source: "header", text: e.table.columnHeader, page: null, offset: null });
  return out;
}
export function valueTermsOf(e: EvidenceRef): ValueTerms { return readValueTerms(termSourcesOf(e)); }
export const recordSpan = (policyId: string, s: TermSpan): RecordSpan => ({ policyId, page: s.page, start: s.start, end: s.end, text: s.text, source: s.source });

/** The reset period a label names for the value it prints ("Maximum days per policy year" -> policy_year). */
export function resetNamedIn(text: string): CapReset {
  const m = /\b(?:per|each|every|in\s+(?:any|a|one|each))\s+((?:policy|insurance|calendar|benefit)\s+year|year|annum|admission|confinement|hospitali[sz]ation|stay|disability|illness|injury|accident|event|occurrence|lifetime|claim)\b/i.exec(text ?? "")
    ?? /\b(annual|yearly|lifetime)\b/i.exec(text ?? "");
  return m ? resetOf(m[1]) : null;
}
export const PERIOD_UNITS = /^(?:(?:complete(?:d)?\s+)?(?:24[- ]hour\s+)?(?:days?|nights?|periods?))$/i;
export function isPeriodCap(c: CountCap | MoneyCap): c is CountCap { return c.kind === "count" && (c.unit == null || PERIOD_UNITS.test(c.unit)); }

/** Re-checks a record's unit terms; null when they stand. `pageText` (policyId, page) gives the stored page when the
 * caller has it (the save-time gate), so each span is also checked to be verbatim on its page. */
export function checkUnitTerms(r: RecordWithUnitTerms, pageText?: (policyId: string, page: number) => string | null | undefined): string | null {
  if (r.calculator !== "hospital_cash") return null;
  const u = r.unitTerms;
  if (!u) return "the calculation does not carry the rate's unit terms";
  const spans: RecordSpan[] = [...(u.rate.span ? [u.rate.span] : []), ...(u.durationRule ? [u.durationRule.span] : []), ...u.caps.map((c) => c.span)];
  for (const s of spans) {
    if (s.policyId !== r.policyId) return "a unit term is read from another document than the calculation's";
    if (pageText && s.page != null) { const t = pageText(s.policyId, s.page); if (t != null && t.slice(s.start, s.end) !== s.text) return `a unit term's span is not on its page: “${s.text}”`; }
  }
  // The rate's unit re-reads from its span, and is one a daily calculator multiplies.
  if (u.rate.span) {
    const again = readValueTerms([{ source: u.rate.span.source, text: u.rate.span.text }]).rateUnit?.unit ?? null;
    if (again !== u.rate.unit) return `the rate's unit does not re-read from “${u.rate.span.text}”`;
  }
  if (u.rate.unit && !PER_DAY_UNITS.includes(u.rate.unit as never)) return `the rate is printed per ${u.rate.unit.replace("_", " ")}, not per day`;
  if (u.durationRule) {
    const again = readValueTerms([{ source: "rule", text: u.durationRule.span.text }]).durationRule?.rule;
    if (again !== u.durationRule.rule) return `the duration rule does not re-read from “${u.durationRule.span.text}”`;
    const dc = r.steps.find((s) => s.op === "day_count");
    if (dc && dc.op === "day_count" && dc.rule !== u.durationRule.rule) return "the day count uses another rule than the rate's own wording states";
  }
  for (const c of u.caps) {
    if (c.span.source === "row" || c.span.source === "wording") {
      // A printed "Maximum days ..." row (or a wording sentence): its figure is printed in it, and its reset is the one it names.
      const nums = (c.span.text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      if (!nums.includes(c.max)) return `the cap ${c.max} is not printed in “${c.span.text}”`;
      if (c.span.source === "row" && c.reset !== resetNamedIn(c.span.text)) return `the cap's period is not the one “${c.span.text}” names`;
    } else {
      const reread = readValueTerms([{ source: c.span.source, text: c.span.text }]).caps;
      const same = reread.find((x) => x.kind === c.kind && (x.kind === "count" ? x.max === c.max : x.cents === Math.round(c.max * 100)) && x.reset === c.reset);
      if (!same) return `the cap does not re-read from “${c.span.text}”`;
    }
    const o = r.operands.find((x) => x.id === c.operandId);
    if (!o || o.source !== "document" || o.value !== c.max || (c.kind === "count" ? o.unit !== "count" : o.unit !== "money" || o.currency !== c.currency)) return `the cap “${c.span.text}” is not an operand of the calculation`;
    const used = r.steps.some((s) => (s.op === "min_count" || s.op === "min" || s.op === "multiply" || s.op === "deductible") && s.inputs.includes(c.operandId));
    if (!used) return `the cap “${c.span.text}” is not applied`;
    if (capSpansStays(c.reset)) {
      const cond = r.conditions.find((x) => x.id === (c.kind === "count" ? "c_cap_prior_use" : "c_money_cap_prior_use"));
      if (!cond) return `earlier use of the cap “${c.span.text}” is not addressed`;
      if (c.priorUse === "not_counted") return `the cap “${c.span.text}” resets per ${c.reset}: earlier use counts`;
      if (c.priorUse === "assumed_none") { if (r.kind !== "conditional_illustration" || !/earlier use/i.test(r.assumption ?? "")) return `the calculation assumes no earlier use of “${c.span.text}” without saying so`; }
      else if (cond.status === "unresolved" || cond.basis !== "household" || !cond.householdWords?.trim()) return `earlier use of the cap “${c.span.text}” is not settled by the household`;
      if (c.priorUse === "household_figure" && !r.operands.some((x) => x.id === c.priorOperandId && x.source === "household")) return `the earlier use of “${c.span.text}” is not the household's figure`;
    }
  }
  return null;
}
