/**
 * Conversational RAG (Prompt 2): turns the model's final_answer into the visible answer's sentences with their
 * per-sentence FigureBindings (lib/rag2/evidence.ts toFigureBinding) and ComputationRecords (from compute), ready for
 * the existing save-time gate (lib/chat/answer-verification.ts verifyAnswerFigures, run inside saveTurn).
 *
 * Deterministic, and conservative: a sentence is kept only when everything it states can be tied to evidence a tool
 * returned this conversation. A sentence citing evidence no tool returned, a figure printed in none of its cited
 * evidence, an estimate not from a compute result (or from a household figure that is no longer the recorded one) is
 * dropped here -- with an honest note -- before the gate ever sees it. Nothing is added: no figure is ever written by
 * this code, only bound.
 */
import type { BoundFigure, CalculationRecord, ComputationOperand, ComputationRecord, FigureBinding, FigurePeriod } from "@/types";
import { calcOutcomes } from "../calc/tool";
import type { CalcOutcome } from "../calc/engine";
import { moneyFiguresIn, sentencesOf } from "@/lib/chat/answer-verification";
import { printedPeriodsOf } from "@/lib/chat/assertions";
import { evidenceKey, toFigureBinding, type EvidenceRef } from "../evidence";
import type { ComputeOk, TableValueOperand } from "../compute";
import type { ToolContext } from "../tools";
import type { RagLoopState } from "./types";

export type ComputeCall = { operation: string; operands: Record<string, unknown>[] };
export type ComposedSentence = { text: string; evidenceIds: string[]; estimate: boolean; factKeys: string[]; kind?: "printed" | "conditional_illustration" | "indicative_estimate" | "requirement" };
export type Composed = {
  sentences: ComposedSentence[]; nextSteps: string[];
  figureBindings: BoundFigure[]; computations: ComputationRecord[];
  /** Agent K: benefit calculations bound to the sentences that state them (re-run by the save-time gate). */
  calculations: CalculationRecord[];
  /** Agent K: the calculate outcomes the answer used (for the claim record, only in a claim scenario). */
  calcs: (CalcOutcome & { purpose?: string })[];
  dropped: { sentence: string; reason: string }[];
  evidenceIds: string[]; subjectId: string | null;
};
export const DROPPED_NOTE = "Part of what I was going to say couldn’t be tied to a passage of your documents, so I left it out.";

/** Statements that need evidence even without a figure. */
const COVERISH = /\b(?:cover\w*|insur\w*|pays?|payable|benefits?|limits?|capped|maximum|excluded|exclusions?|not covered|eligib\w*|claim\w*|deductible|co-?insurance|sum assured|premiums?|waiting period|days?|nights?)\b/i;
const PAYOUT = /\bpay-?outs?\b|\bwill (?:be )?pa(?:y|id)\b|\byou(?:’|')?ll (?:get|receive)\b|\byou will (?:get|receive)\b/i;
const FIG_PERIOD: Record<string, FigurePeriod> = { day: "day", night: "day", week: "week", month: "month", quarter: "quarter", half_year: "half_year", year: "year", policy_year: "year", event: "event", lifetime: "lifetime" };
const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** The id under which `ref` was registered in the loop's evidence table (registered on the fly if it was not). */
export function evidenceIdOf(state: RagLoopState, ref: EvidenceRef, via = "compose"): string {
  const key = evidenceKey(ref);
  for (const e of Object.values(state.evidence)) if (evidenceKey(e) === key) return e.id;
  const id = "e" + (Object.keys(state.evidence).length + 1);
  state.evidence[id] = { ...ref, id, via };
  return id;
}

function gateOperand(o: TableValueOperand, subjectId: string): ComputationOperand | null {
  if (o.valueKind !== "money" || o.cents == null || !o.currency) return null;
  const value = o.cents / 100;
  const binding = toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, o.benefit, value, o.currency);
  if (!binding) return null;
  const printed = printedPeriodsOf(value, o.currency, o.evidence.passage.text).find((p) => p != null) ?? null;
  return { value, currency: o.currency, period: printed ? (FIG_PERIOD[printed] ?? (printed as FigurePeriod)) : (o.period ? FIG_PERIOD[o.period] ?? null : null), role: "benefit", binding };
}

type Ctx = { state: RagLoopState; tools: ToolContext; computeCalls: Map<string, ComputeCall>; householdIds: Set<string>; userText: string };

/** A gate record for an indicative per-day / multiple estimate: a printed per-period amount times a whole count the
 * household gave (after any printed day cap). The gate recomputes it and checks the sentence states the count. */
function estimateRecord(result: ComputeOk, call: ComputeCall | undefined, ctx: Ctx, subjectId: string): { record: Omit<ComputationRecord, "sentence">; operand: ComputationOperand } | null {
  if (!call || (call.operation !== "per_day" && call.operation !== "product")) return null;
  const [moneyArg, countArg, capArg] = call.operands;
  const money = typeof moneyArg?.value_id === "string" ? ctx.tools.values.get(moneyArg.value_id)?.operand : null;
  if (!money) return null;
  const countOf = (a: Record<string, unknown> | undefined): number | null => {
    if (!a) return null;
    if (typeof a.value_id === "string") { const v = ctx.tools.values.get(a.value_id)?.operand; return v?.valueKind === "count" ? v.count ?? null : null; }
    const h = a.household as Record<string, unknown> | undefined;
    return h && typeof h.count === "number" ? h.count : null;
  };
  const n = countOf(countArg); if (n == null) return null;
  const cap = capArg ? countOf(capArg) : null; if (capArg && cap == null) return null;
  const used = cap != null ? Math.min(n, cap) : n;
  if (!(used >= 2 && used <= 100)) return null;
  const op = gateOperand(money, subjectId); if (!op) return null;
  if (!same(op.value * used, result.amount)) return null;
  return { operand: op, record: { result: { value: result.amount, currency: result.currency }, operation: "product", operands: [op], factor: used, period: op.period, currency: result.currency, rounding: { mode: "half_up", precision: 2 }, scope: "person" } };
}

/** Which recorded claim facts a computation's household figures are, or why one is not (missing / since corrected). */
function householdInputs(result: ComputeOk, ctx: Ctx): { keys: string[]; problem: string | null } {
  const facts = ctx.state.claim?.facts ?? {};
  const keys: string[] = [];
  for (const h of result.householdFigures) {
    const want = h.count != null ? String(h.count) : h.cents != null ? String(h.cents / 100) : h.ppm != null ? String(h.ppm / 10000) : null;
    const hit = Object.entries(facts).find(([, f]) => want != null && Number(String(f.value).replace(/[^\d.]/g, "")) === Number(want));
    if (!hit) return { keys, problem: `the estimate uses ${h.label} = ${want}, which is not a fact the household has given (or it has since been corrected)` };
    keys.push(hit[0]);
  }
  return { keys, problem: null };
}

export function composeFinal(args: { sentences: Record<string, unknown>[]; nextSteps?: unknown; subjectId?: string | null }, ctx: Ctx): Composed {
  const out: Composed = { sentences: [], nextSteps: [], figureBindings: [], computations: [], calculations: [], calcs: [], dropped: [], evidenceIds: [], subjectId: args.subjectId && ctx.householdIds.has(args.subjectId) ? args.subjectId : ctx.state.subjectId };
  const drop = (sentence: string, reason: string) => out.dropped.push({ sentence, reason });
  for (const s of args.sentences ?? []) {
    let text = String(s.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const evIds = ((s.evidence_ids as string[]) ?? []).filter(Boolean);
    const valIds = ((s.value_ids as string[]) ?? []).filter(Boolean);
    const resultId = typeof s.result_id === "string" && s.result_id ? s.result_id : null;
    const subjectId = typeof s.subject_id === "string" && ctx.householdIds.has(s.subject_id) ? s.subject_id : out.subjectId;
    const unknownEv = evIds.filter((id) => !ctx.state.evidence[id]);
    if (unknownEv.length) { drop(text, `cites evidence no tool returned (${unknownEv.join(", ")})`); continue; }
    const values = valIds.map((id) => ctx.tools.values.get(id));
    if (values.some((v) => !v)) { drop(text, "cites a table value that was not read in this turn"); continue; }
    const calc = resultId ? calcOutcomes(ctx.tools).get(resultId) ?? null : null;
    if (calc) { composeCalcSentence(text, calc, evIds, values.map((v) => v!.operand), subjectId, ctx, out, drop); continue; }
    const result = resultId ? ctx.tools.results.get(resultId) ?? null : null;
    if (resultId && !result) { drop(text, "cites a computation that was not made in this turn"); continue; }
    const figures = moneyFiguresIn(text);
    if (!evIds.length && !values.length && !result) {
      if (figures.length || /\d/.test(text) || COVERISH.test(text)) { drop(text, "states cover or a figure without citing evidence"); continue; }
      out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] });
      continue;
    }
    const refs: EvidenceRef[] = [...evIds.map((id) => ctx.state.evidence[id]), ...values.map((v) => v!.operand.evidence), ...(result?.evidence ?? [])];
    const bindings: BoundFigure[] = [], records: ComputationRecord[] = [];
    let factKeys: string[] = [];
    let covered = new Set<number>();
    const partOf = (raw: string) => sentencesOf(text).find((p) => p.includes(raw)) ?? text;
    if (result) {
      if (result.kind === "indicative_estimate") {
        if (PAYOUT.test(text)) { drop(text, "calls an estimate a payout"); continue; }
        if (!/\bindicative estimate\b/i.test(text)) { text = "Indicative estimate: " + text; }
        const hh = householdInputs(result, ctx);
        if (hh.problem) { drop(text, hh.problem); continue; }
        factKeys = hh.keys;
      }
      const fig = moneyFiguresIn(text).findIndex((f) => same(f.value, result.amount) && f.currency === result.currency);
      if (fig < 0) { drop(text, "does not state the computation's result"); continue; }
      const f = moneyFiguresIn(text)[fig];
      const sentence = partOf(f.raw);
      if (result.record) records.push({ ...result.record, sentence });
      else {
        const est = estimateRecord(result, ctx.computeCalls.get(resultId!), ctx, subjectId ?? "");
        if (est) records.push({ ...est.record, sentence });
        else {
          // The result is one of its own printed operands (a cap that applies): bind it to that printed figure.
          const printed = [...ctx.tools.values.values()].map((v) => v.operand).find((o) => o.valueKind === "money" && o.cents === result.cents && o.currency === result.currency && result.evidence.some((e) => evidenceKey(e) === evidenceKey(o.evidence)));
          const b = printed && subjectId ? toFigureBinding({ ...printed.evidence, subjectId: printed.evidence.subjectId ?? subjectId }, printed.benefit, result.amount, result.currency) : null;
          if (!b) { drop(text, "the estimate's arithmetic is not one the save-time gate can check"); continue; }
          bindings.push({ ...b, sentence, value: result.amount, currency: result.currency });
        }
      }
      covered = new Set([fig]);
    }
    const figs = moneyFiguresIn(text);
    let failed: string | null = null;
    figs.forEach((f, i) => {
      if (failed || covered.has(i)) return;
      const sentence = partOf(f.raw);
      // A printed table value the sentence (or its computation) cites.
      const ops: TableValueOperand[] = [...values.map((v) => v!.operand), ...(result ? [...ctx.tools.values.values()].map((v) => v.operand).filter((o) => result.evidence.some((e) => evidenceKey(e) === evidenceKey(o.evidence))) : [])];
      const op = ops.find((o) => o.valueKind === "money" && o.cents != null && same(o.cents / 100, f.value) && o.currency === f.currency);
      let b: FigureBinding | null = op && subjectId ? toFigureBinding({ ...op.evidence, subjectId: op.evidence.subjectId ?? subjectId }, op.benefit, f.value, f.currency) : null;
      if (!b && subjectId) for (const id of evIds) {
        const ref = ctx.state.evidence[id];
        const benefit = (typeof s.benefit === "string" && s.benefit.trim()) || ref.table?.rowLabel || ref.label || "";
        b = benefit ? toFigureBinding({ ...ref, subjectId: ref.subjectId ?? subjectId }, benefit, f.value, f.currency) : null;
        if (b) break;
      }
      if (b) { bindings.push({ ...b, sentence, value: f.value, currency: f.currency }); return; }
      // The household's own figure, said back to them: the gate decides (attribution, never as cover or a total).
      if (moneyFiguresIn(ctx.userText).some((u) => same(u.value, f.value) && u.currency === f.currency)) return;
      failed = `${f.raw} is printed in none of the evidence the sentence cites`;
    });
    if (failed) { drop(text, failed); continue; }
    out.figureBindings.push(...bindings); out.computations.push(...records);
    const ids = [...new Set([...evIds, ...refs.map((r) => evidenceIdOf(ctx.state, r))])];
    out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
    out.sentences.push({ text, evidenceIds: ids, estimate: result?.kind === "indicative_estimate", factKeys });
  }
  for (const step of Array.isArray(args.nextSteps) ? args.nextSteps : []) {
    const t = String(step ?? "").trim();
    if (t && !moneyFiguresIn(t).length) out.nextSteps.push(t);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- Agent K: calculations
const ILLUSTRATION_IF = /\bif\b/i;
/** Which recorded claim facts a calculation's household inputs are (by value, or by the household's words). */
function calcFactKeys(c: CalcOutcome, ctx: Ctx): { keys: string[]; problem: string | null } {
  const facts = ctx.state.claim?.facts ?? {};
  const keys: string[] = [];
  for (const o of c.record?.operands ?? []) {
    if (o.source !== "household") continue;
    const sq = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
    const hit = Object.entries(facts).find(([, f]) => (typeof o.value === "number" && Number(String(f.value).replace(/[^\d.]/g, "")) === o.value) || sq(f.words).includes(sq(o.attribution)) || sq(o.attribution).includes(sq(f.words)) || String(f.value) === String(o.value));
    if (!hit) return { keys, problem: `the calculation uses the household’s ${o.label} (“${o.attribution}”), which is not a fact they have given (or it has since been corrected)` };
    keys.push(hit[0]);
  }
  return { keys, problem: null };
}
function composeCalcSentence(text0: string, c: CalcOutcome & { purpose?: string }, evIds: string[], valueOps: TableValueOperand[], subjectId: string | null, ctx: Ctx, out: Composed, drop: (s: string, r: string) => void): void {
  let text = text0;
  const sid = subjectId ?? c.subjectId;
  if (sid !== c.subjectId) { drop(text, "the sentence is about another person than the calculation"); return; }
  const partOf = (raw: string) => sentencesOf(text).find((p) => p.includes(raw)) ?? text;
  const evidenceIds = () => [...new Set([...evIds, ...c.evidence.map((e) => evidenceIdOf(ctx.state, e))])];
  if (c.kind === "indicative_estimate" || c.kind === "conditional_illustration") {
    if (!c.record || c.amount == null || !c.currency) { drop(text, "the calculation has no result"); return; }
    if (PAYOUT.test(text)) { drop(text, "calls a calculated benefit a payout"); return; }
    let factKeys: string[] = [];
    if (c.kind === "indicative_estimate") {
      if (!/\bindicative estimate\b/i.test(text)) text = "Indicative estimate: " + text;
      const hh = calcFactKeys(c, ctx); if (hh.problem) { drop(text, hh.problem); return; }
      factKeys = hh.keys;
    } else if (!ILLUSTRATION_IF.test(text)) { drop(text, "an illustration must state its what-if (“if …”)"); return; }
    const fig = moneyFiguresIn(text).find((f) => same(f.value, c.amount!) && f.currency === c.currency);
    if (!fig) { drop(text, "does not state the calculation’s result"); return; }
    out.calculations.push({ ...c.record, sentence: partOf(fig.raw) });
    out.calcs.push(c);
    const ids = evidenceIds();
    out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
    out.sentences.push({ text, evidenceIds: ids, estimate: c.kind === "indicative_estimate", factKeys, kind: c.kind });
    return;
  }
  // unresolved / not_payable: the printed figures may be stated (each bound to its own printed value), then the
  // specific missing information -- never an estimate.
  const printed = [...c.printed, ...valueOps.map((o) => ({ label: o.benefit, value: (o.cents ?? 0) / 100, unit: o.valueKind, currency: o.currency ?? null, evidence: o.evidence, binding: toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? c.subjectId }, o.benefit, (o.cents ?? 0) / 100, o.currency ?? "") }))];
  const bindings: BoundFigure[] = [];
  for (const f of moneyFiguresIn(text)) {
    const p = printed.find((x) => x.unit === "money" && x.currency === f.currency && same(x.value, f.value) && x.binding);
    if (!p) { drop(text, `${f.raw} is not a printed figure of this benefit (no estimate is possible yet: ${c.requirements.join("; ") || c.reason || "unresolved"})`); return; }
    bindings.push({ ...p.binding!, sentence: partOf(f.raw), value: f.value, currency: f.currency });
  }
  if (/\bindicative estimate\b|\bestimate\b/i.test(text)) { drop(text, "states an estimate where the calculation is unresolved"); return; }
  out.figureBindings.push(...bindings);
  out.calcs.push(c);
  const ids = evidenceIds();
  out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
  out.sentences.push({ text, evidenceIds: ids, estimate: false, factKeys: [], kind: "printed" });
  if (!out.sentences.some((x) => x.text === c.unresolvedText)) out.sentences.push({ text: c.unresolvedText, evidenceIds: ids, estimate: false, factKeys: [], kind: "requirement" });
}
