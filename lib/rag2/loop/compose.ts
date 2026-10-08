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
import { confirmed, contentWords, numbersIn } from "./facts";
import { checkCitedStatement, instructionLines, payoutOrDecision, unsafeNextStep, withoutInstructions, PAYOUT as PAYOUT_WORDS } from "./statements";

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
  /** Agent F (D24): what the household is told about what was left out and why (specific, figure-free). */
  notes: string[];
  evidenceIds: string[]; subjectId: string | null;
};
export const DROPPED_NOTE = "Part of what I was going to say couldn’t be tied to a passage of your documents, so I left it out.";
/** Agent F (D24): specific, figure-free notes for what was left out. */
export const PAYOUT_NOTE = "I left out a sentence that described an amount as paid, owed or claimable: only the insurer decides what it pays.";
export const DECISION_NOTE = "I left out a sentence that stated a decision on the claim: only the insurer decides a claim, after reviewing it and its evidence.";
export const INSTRUCTION_NOTE = "I left out text from your document that reads as an instruction rather than policy wording, so it isn’t used as evidence.";
export const UNSUPPORTED_NOTE = "I left out a statement that the passage it relied on doesn’t actually support.";
export const SUM_NOTE = "I left out a total: adding printed limits together doesn’t give an amount the insurer would pay.";
export const STEP_NOTE = "I left out a suggested step that stated cover or a payment without evidence.";
export const UNRESOLVED_NOTE = "I left out an estimate because the information it needs isn’t known yet.";
export const MISSING_FACT_NOTE = "I left out an estimate because it relied on something you haven’t told me (or have since corrected), so it can’t be worked out yet.";
/** True when two texts share a content word (stemmed). */
const sharesWords = (a: string, b: string) => { const x = new Set(contentWords(a)); return contentWords(b).some((w) => x.has(w)); };
/** A clause's own label for a figure: the model's label only when the line that prints the figure carries it. */
function passageLabel(passage: string, value: number, wanted: string): string {
  const want = contentWords(wanted);
  if (!want.length) return "";
  const lines = withoutInstructions(passage).split(/\n+/).filter((l) => numbersIn(l).some((n) => same(n, value)));
  return lines.some((l) => { const have = new Set(contentWords(l)); return want.every((w) => have.has(w)); }) ? wanted.trim() : "";
}

/** Statements that need evidence even without a figure. */
const COVERISH = /\b(?:cover\w*|insur\w*|pays?|payable|benefits?|limits?|capped|maximum|excluded|exclusions?|not covered|eligib\w*|claim\w*|deductible|co-?insurance|sum assured|premiums?|waiting period|days?|nights?)\b/i;
/** Agent F (D2): the full payout wording (statements.ts) -- will reimburse, gets back, can claim, owes you, ... */
const PAYOUT = PAYOUT_WORDS;
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

type Ctx = {
  state: RagLoopState; tools: ToolContext; computeCalls: Map<string, ComputeCall>; householdIds: Set<string>; userText: string;
  /** Every household message of this conversation (earlier user turns + this one); defaults to [userText]. */
  userTexts?: string[];
  /** Household members' names (a sentence saying back what the household said may name the person). */
  names?: string[];
  /** Agent F (D6): evidence ids that can no longer be used (document deleted, replaced, or not this household's),
   * with the household-facing reason. Re-checked every turn by the loop. */
  stale?: Map<string, string>;
  /** Agent F (D7): household members (id + the names a sentence may use) and readable documents (id -> product). */
  people?: { id: string; names: string[] }[];
  policyNames?: Map<string, string>;
};

const sq = (t: string) => t.toLowerCase().normalize("NFKC").replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().replace(/^["']+|["'.,!?;:]+$/g, "").trim();
/** The household's words for a figure match a recorded fact's quoted words (one contains the other). */
const wordsMatch = (attribution: string, factWords: string) => { const a = sq(attribution), w = sq(factWords); return a.length >= 2 && w.length >= 2 && (w.includes(a) || a.includes(w)); };

/** Integration (agent C's request 2): a sentence that only says back what the household told us -- it begins with an
 * attribution ("You said / told me / mentioned ..."), every number and content word in it comes from the household's
 * own messages (names of household members and relation words aside), and it states no cover, benefit, limit, payment
 * or approval. Such a sentence needs no document citation and is never a cover statement. */
const ATTRIBUTED_START = /^(?:you(?:['’]ve| have)? (?:said|told (?:me|us)|mentioned|wrote|reported|let me know)|as you (?:said|mentioned|told me))\b[\s,:]*(?:that\s+)?/i;
const NEVER_SAID_BACK = /\b(?:cover\w*|insur\w*|pays?|paid|payable|pay-?outs?|benefits?|limits?|capped|maximum|excluded|exclusions?|eligib\w*|claimable|entitle\w*|reimburs\w*|deductible|co-?insurance|sum assured|premiums?|approv\w*|confirm\w*|guarantee\w*|qualif\w*|accept\w*|will (?:get|receive))\b/i;
const RELATION_WORDS = new Set(["son", "daughter", "child", "children", "kid", "wife", "husband", "spouse", "partner", "mother", "father", "mum", "mom", "dad", "stepson", "stepdaughter", "brother", "sister", "told", "said", "mentioned", "you", "your", "she", "her", "him", "his", "they", "them"].map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
function saidBackOnly(text: string, ctx: Ctx): boolean {
  const m = text.match(ATTRIBUTED_START); if (!m) return false;
  if (sentencesOf(text).length !== 1) return false;
  const rest = text.slice(m[0].length);
  if (!rest.trim() || NEVER_SAID_BACK.test(rest) || PAYOUT.test(rest)) return false;
  const said = (ctx.userTexts?.length ? ctx.userTexts : [ctx.userText]).join("\n");
  const saidNums = new Set(numbersIn(said));
  if (!numbersIn(rest).every((n) => saidNums.has(n))) return false;
  if (moneyFiguresIn(rest).some((f) => !moneyFiguresIn(said).some((u) => same(u.value, f.value) && u.currency === f.currency))) return false;
  const saidWords = new Set(contentWords(said));
  const nameWords = new Set((ctx.names ?? []).flatMap((n) => contentWords(n)));
  return contentWords(rest).every((w) => saidWords.has(w) || nameWords.has(w) || RELATION_WORDS.has(w));
}

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

/** Which recorded claim facts a computation's household figures are, or why one is not (missing / since corrected).
 * Integration (agent C's request 1): only a confirmed fact (stated by the household, not a paraphrase) whose value is
 * the figure AND whose quoted words the figure's attribution comes from -- never any fact that happens to share the
 * number. (The loop already refuses such a compute call before it runs; this is defence in depth.) */
function householdInputs(result: ComputeOk, ctx: Ctx): { keys: string[]; problem: string | null } {
  const facts = ctx.state.claim?.facts ?? {};
  const keys: string[] = [];
  for (const h of result.householdFigures) {
    const want = h.count != null ? h.count : h.cents != null ? h.cents / 100 : h.ppm != null ? h.ppm / 10000 : null;
    const hit = want == null ? undefined : Object.entries(facts).find(([, f]) => confirmed(f) && numbersIn(String(f.value)).some((n) => same(n, want)) && wordsMatch(h.attribution ?? "", f.words));
    if (!hit) return { keys, problem: `the estimate uses ${h.label} = ${want}, which is not a fact the household has given (or it has since been corrected, or the words it is attributed to are not the ones recorded for it)` };
    keys.push(hit[0]);
  }
  return { keys, problem: null };
}

export function composeFinal(args: { sentences: Record<string, unknown>[]; nextSteps?: unknown; subjectId?: string | null }, ctx: Ctx): Composed {
  const out: Composed = { sentences: [], nextSteps: [], figureBindings: [], computations: [], calculations: [], calcs: [], dropped: [], notes: [], evidenceIds: [], subjectId: args.subjectId && ctx.householdIds.has(args.subjectId) ? args.subjectId : ctx.state.subjectId };
  const note = (n: string) => { if (!out.notes.includes(n)) out.notes.push(n); };
  const drop = (sentence: string, reason: string, householdNote?: string) => { out.dropped.push({ sentence, reason }); if (householdNote) note(householdNote); };
  for (const s of args.sentences ?? []) {
    let text = String(s.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const evIds = ((s.evidence_ids as string[]) ?? []).filter(Boolean);
    const valIds = ((s.value_ids as string[]) ?? []).filter(Boolean);
    const resultId = typeof s.result_id === "string" && s.result_id ? s.result_id : null;
    const subjectId = typeof s.subject_id === "string" && ctx.householdIds.has(s.subject_id) ? s.subject_id : out.subjectId;
    const unknownEv = evIds.filter((id) => !ctx.state.evidence[id]);
    if (unknownEv.length) { drop(text, `cites evidence no tool returned (${unknownEv.join(", ")})`); continue; }
    // Agent F (D6): evidence remembered from an earlier turn is usable only while its document is still this
    // household's current, active version -- with or without a figure in the sentence.
    const staleEv = evIds.filter((id) => ctx.stale?.has(id));
    if (staleEv.length) { drop(text, `cites evidence from a document that is no longer available (${staleEv.join(", ")})`, ctx.stale!.get(staleEv[0])); continue; }
    // Agent F (D2 / D7): money presented as paid / owed / claimable, or a claim decision, is never stated.
    const pd = payoutOrDecision(text);
    if (pd) { drop(text, pd === "payout" ? "calls an amount a payout (paid, owed, reimbursed, received or claimable)" : "states a claim decision (approved / confirmed / fully covered) only the insurer can make", pd === "payout" ? PAYOUT_NOTE : DECISION_NOTE); continue; }
    // Agent F (D1): a sentence resting on an instruction inside a document (not policy wording) is never stated.
    const injected = evIds.filter((id) => instructionLines(ctx.state.evidence[id].passage.text).length && !withoutInstructions(ctx.state.evidence[id].passage.text).split(/\n+/).some((l) => sharesWords(l, text)));
    if (injected.length) { drop(text, "cites text inside a document that is an instruction, not policy wording", INSTRUCTION_NOTE); continue; }
    const values = valIds.map((id) => ctx.tools.values.get(id));
    if (values.some((v) => !v)) { drop(text, "cites a table value that was not read in this turn"); continue; }
    const calc = resultId ? calcOutcomes(ctx.tools).get(resultId) ?? null : null;
    if (calc) { composeCalcSentence(text, calc, evIds, values.map((v) => v!.operand), subjectId, ctx, out, drop); continue; }
    const result = resultId ? ctx.tools.results.get(resultId) ?? null : null;
    if (resultId && !result) { drop(text, "cites a computation that was not made in this turn"); continue; }
    const figures = moneyFiguresIn(text);
    if (!evIds.length && !values.length && !result) {
      if (saidBackOnly(text, ctx)) { out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] }); continue; }
      if (figures.length || /\d/.test(text) || COVERISH.test(text)) { drop(text, "states cover or a figure without citing evidence"); continue; }
      out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] });
      continue;
    }
    // Agent F (D7): a cited sentence without a figure must say what its evidence says (polarity, policy, person,
    // benefit); "medically confirmed" / "approved" were refused above.
    if (!figures.length && !result && evIds.length && COVERISH.test(text)) {
      const why = checkCitedStatement(text, evIds.map((id) => ({ policyId: ctx.state.evidence[id].policyId, subjectId: ctx.state.evidence[id].subjectId ?? null, text: [ctx.state.evidence[id].table?.rowLabel ?? "", ctx.state.evidence[id].label ?? "", ctx.state.evidence[id].passage.text].filter(Boolean).join("\n") })), { people: ctx.people ?? [], policyNames: ctx.policyNames ?? new Map(), subjectId });
      if (why) { drop(text, "not supported by its evidence: " + why, UNSUPPORTED_NOTE); continue; }
    }
    // Agent F (D3): a sum of printed limits is only ever said as the limits added together -- never as a total
    // anyone can claim, get or be paid.
    if (result && result.operation === "sum" && result.kind === "printed_limit" && (!/\blimits?\b/i.test(text) || /\b(?:claim\w*|receiv\w*|gets?|paid|payable|reimburs\w*|owe\w*|entitle\w*)\b/i.test(text))) { drop(text, "presents a sum of printed limits as an amount that can be claimed", SUM_NOTE); continue; }
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
        if (hh.problem) { drop(text, hh.problem, MISSING_FACT_NOTE); continue; }
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
        // Agent F (D1): the benefit a passage figure is bound to is the passage's OWN label -- its table row, the
        // label a tool gave it, or (for a clause) the model's label only when the line printing the figure says it.
        // A line that is an instruction inside the document is never evidence for a figure.
        const benefit = ref.table?.rowLabel || ref.label || passageLabel(ref.passage.text, f.value, typeof s.benefit === "string" ? s.benefit : "");
        const policyText = withoutInstructions(ref.passage.text);
        b = benefit && numbersIn(policyText).some((n) => same(n, f.value)) ? toFigureBinding({ ...ref, subjectId: ref.subjectId ?? subjectId }, benefit, f.value, f.currency) : null;
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
    if (!t) continue;
    if (moneyFiguresIn(t).length) { drop(t, "a next step may not state a figure"); continue; }
    // Agent F (D8): a next step never states or promises cover, money or a decision.
    const bad = unsafeNextStep(t);
    if (bad) { drop(t, bad, STEP_NOTE); continue; }
    out.nextSteps.push(t);
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
    // Integration (agent C's request 1): a confirmed fact, the household's words for this input matching the words
    // recorded for it, and -- for a number -- the same value.
    const hit = Object.entries(facts).find(([, f]) => confirmed(f) && wordsMatch(o.attribution, f.words) && (typeof o.value !== "number" || numbersIn(String(f.value)).some((n) => same(n, o.value as number)) || String(f.value) === String(o.value)));
    if (!hit) return { keys, problem: `the calculation uses the household’s ${o.label} (“${o.attribution}”), which is not a fact the household has given (or it has since been corrected)` };
    keys.push(hit[0]);
  }
  return { keys, problem: null };
}
function composeCalcSentence(text0: string, c: CalcOutcome & { purpose?: string }, evIds: string[], valueOps: TableValueOperand[], subjectId: string | null, ctx: Ctx, out: Composed, drop: (s: string, r: string, note?: string) => void): void {
  let text = text0;
  const pd = payoutOrDecision(text);
  if (pd) { drop(text, pd === "payout" ? "calls a calculated benefit a payout (paid / owed / reimbursed / claimable)" : "states a claim decision only the insurer can make", pd === "payout" ? PAYOUT_NOTE : DECISION_NOTE); return; }
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
      const hh = calcFactKeys(c, ctx); if (hh.problem) { drop(text, hh.problem, MISSING_FACT_NOTE); return; }
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
    if (!p) {
      drop(text, `${f.raw} is not a printed figure of this benefit (no estimate is possible yet: ${c.requirements.join("; ") || c.reason || "unresolved"})`, UNRESOLVED_NOTE);
      // Agent F (D24): the household is told exactly what is still needed (the calculator's own requirement).
      requirementOf(c, ctx, out, evIds);
      return;
    }
    bindings.push({ ...p.binding!, sentence: partOf(f.raw), value: f.value, currency: f.currency });
  }
  if (/\bindicative estimate\b|\bestimate\b/i.test(text)) { drop(text, "states an estimate where the calculation is unresolved", UNRESOLVED_NOTE); requirementOf(c, ctx, out, evIds); return; }
  out.figureBindings.push(...bindings);
  out.calcs.push(c);
  const ids = evidenceIds();
  out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
  out.sentences.push({ text, evidenceIds: ids, estimate: false, factKeys: [], kind: "printed" });
  if (!out.sentences.some((x) => x.text === c.unresolvedText)) out.sentences.push({ text: c.unresolvedText, evidenceIds: ids, estimate: false, factKeys: [], kind: "requirement" });
}
/** Agent F (D24): an unresolved calculation's specific requirement (figure-free), said once. */
function requirementOf(c: CalcOutcome, ctx: Ctx, out: Composed, evIds: string[]): void {
  if ((c.kind !== "unresolved" && c.kind !== "not_payable") || !c.unresolvedText || out.sentences.some((x) => x.text === c.unresolvedText)) return;
  const ids = [...new Set([...evIds, ...c.evidence.map((e) => evidenceIdOf(ctx.state, e))])];
  out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
  out.sentences.push({ text: c.unresolvedText, evidenceIds: ids, estimate: false, factKeys: [], kind: "requirement" });
}
