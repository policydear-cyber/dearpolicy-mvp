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
import { dayRuleFromWording } from "@/lib/claims/day-count";
import type { CalcOutcome } from "../calc/engine";
import { moneyFiguresIn, sentencesOf } from "@/lib/chat/answer-verification";
import { printedPeriodsOf } from "@/lib/chat/assertions";
import { evidenceKey, toFigureBinding, type EvidenceRef } from "../evidence";
import type { ComputeOk, TableValueOperand } from "../compute";
import type { ToolContext } from "../tools";
import type { RagLoopState } from "./types";
import { CAUSE_KEYS, confirmed, contentWords, EVENT_KEY, factConcept, numbersIn } from "./facts";
import { checkCitedStatement, instructionLines, internalIdsIn, payoutOrDecision, stripInternalIds, unsafeNextStep, withoutInstructions, PAYOUT as PAYOUT_WORDS } from "./statements";

export type ComputeCall = { operation: string; operands: Record<string, unknown>[] };
export type ComposedSentence = { text: string; evidenceIds: string[]; estimate: boolean; factKeys: string[]; kind?: "printed" | "conditional_illustration" | "indicative_estimate" | "requirement";
  /** Agent P: the position of the model's sentence this came from (final_answer order). */
  at?: number;
  /** Agent P: for a requirement, the fact concepts it asks the household for (admission, discharge, bill, ...). */
  asks?: string[];
  /** Agent P: the condition clause appended to a printed benefit whose conditions are not established. */
  condition?: string;
  /** Round 7: the table-value ids the sentence cites, and the benefit as the model named it (a passage figure's label). */
  valueIds?: string[]; benefit?: string | null };
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
/** Agent P: what the household is told when NOTHING of the answer could be kept and no requirement or caveat applies
 * (accurate for every verification failure: the answer could not be confirmed from their documents). Never shown
 * beside kept sentences. */
export const DROPPED_NOTE = "I couldn’t confirm an answer to that from your documents.";
/** Agent P: user-facing caveats (facts about insurance, never commentary on what was removed). The payout / decision /
 * sum caveats are shown whenever the model tried to state such a thing, because the household may have asked it. */
export const PAYOUT_NOTE = "Only the insurer decides whether an amount is paid, owed or claimable, after it reviews the claim.";
export const DECISION_NOTE = "Only the insurer makes a decision on the claim, after reviewing it and its evidence.";
export const SUM_NOTE = "Printed limits added together aren’t an amount the insurer would pay.";
/** Agent P: shown only when nothing else can be said (accurate to the rejection reason). */
export const INSTRUCTION_NOTE = "Some text in your document reads as an instruction rather than policy wording, so I haven’t treated it as part of your policy.";
export const CALC_NOTE = "I couldn’t check that figure against the policy’s own calculation, so I haven’t given one.";
export const INCOMPLETE_NOTE = "This may not be everything your documents say about it.";
/** Round 7: what still remains once the household has told us a fact a benefit's condition turns on -- their report is
 * not a reviewed record, the insurer checks the documents and decides -- and the practical next step. Medical wording
 * when the condition is medical (a doctor's diagnosis or certification, an X-ray / MRI / scan). Figure-free; never a
 * decision, a payment or an entitlement. */
export const REPORTED_MEDICAL_NOTE = "What you’ve told me is your own account, not a reviewed medical record: the insurer will check it against the documents it asks for (such as the doctor’s report and the test or scan results) and decides the claim after reviewing them.";
export const REPORTED_NOTE = "What you’ve told me is your own account: the insurer will check it against the documents it asks for and decides the claim after reviewing them.";
export const REPORTED_MEDICAL_STEP = "When you make the claim, include the doctor’s report and the test or scan results that show the policy’s condition is met, with the insurer’s claim form.";
export const REPORTED_STEP = "When you make the claim, include the documents that show the policy’s condition is met, with the insurer’s claim form.";
const MEDICAL_CONDITION = /\b(?:medical practitioner|doctor|physician|specialist|x-?rays?|mri|scans?|ultrasound|diagnos\w*|certif\w*|medical report)\b/i;
export function reportedFactFollowUp(conditionTexts: string[]): { note: string; step: string } {
  const medical = conditionTexts.some((t) => MEDICAL_CONDITION.test(t));
  return medical ? { note: REPORTED_MEDICAL_NOTE, step: REPORTED_MEDICAL_STEP } : { note: REPORTED_NOTE, step: REPORTED_STEP };
}
/** Round 7: the household's own words for a fact, said back as theirs (\"You told me ...\") -- null when nothing is left. */
export function sayBack(words: string): string | null {
  let w = String(words ?? "").replace(/\s+/g, " ").trim().replace(/^(?:yes|yeah|yep|yup|no|nope)\b[,.!]?\s*/i, "").replace(/[.!;,\s]+$/, "");
  if (!w) return null;
  if (/^(?:i|i['’]m|i['’]ve|we|we['’]re|my|our|me|us)\b/i.test(w)) return `You told me: “${w}”.`;
  if (/^(?:The|A|An|He|She|They|It|This|That|There|Her|His|Their|Both|Yes|No)\b/.test(w)) w = w[0].toLowerCase() + w.slice(1);
  return `You told me ${w}.`;
}

/** Internal markers (trace / categorisation only; never shown to the household). */
export const UNSUPPORTED_NOTE = "unsupported";
export const STEP_NOTE = "step";
export const UNRESOLVED_NOTE = "unresolved";
export const MISSING_FACT_NOTE = "missing_fact";
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
  const binding = toFigureBinding({ ...o.evidence, subjectId: o.evidence.subjectId ?? subjectId }, wordedBenefit(o.benefit, evidenceTextOf(o.evidence), o.evidence.table?.cell?.text), value, o.currency);
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

/** Round 7 (A3): words that claim cover, a payment or an amount the policy sets (these always need evidence). */
const COVER_CLAIM = /\b(?:covers?|covered|coverage|insures?|insured for|pays?|paid|payable|pay-?outs?|benefits?|limits?|capped|maximum|max\b|excluded|exclusions?|eligib\w*|entitle\w*|claimable|deductible|co-?insurance|sum assured|premiums?|reimburs\w*|waiting period|approved|guarantee\w*|refund\w*)\b/i;
/** A sentence explaining that something cannot be worked out yet, or what is needed and why. */
const EXPLAINS_NEED = /\b(?:can(?:no|['’])t|cannot|unable to|not able to|couldn['’]t|could not)\s+(?:yet\s+)?(?:determine|work out|calculate|tell|confirm|say|estimate|count|know)\b|\b(?:I|we)\s+(?:still\s+|also\s+|first\s+)?need\b|\bto work (?:it|this|that|the \w+) out\b|\bdepends on\b|\bwithout (?:the|your|his|her|their|those|these)\b|\bbefore I can\b/i;
/** Round 7 (A3): an uncited sentence that explains why a fact is needed, mentioning only the household's own numbers
 * (\"I can't determine the amount from 'exactly 3 days' alone because ... counts from the admission and discharge
 * times\"): no money figure, no number the household did not give, and no cover / payment / amount claim. */
function explainsNeedOnly(text: string, ctx: Ctx): boolean {
  if (!EXPLAINS_NEED.test(text) || moneyFiguresIn(text).length || COVER_CLAIM.test(text) || payoutOrDecision(text)) return false;
  const said = (ctx.userTexts?.length ? ctx.userTexts : [ctx.userText]).join("\n");
  const saidNums = new Set(numbersIn(said));
  return numbersIn(text).every((n) => saidNums.has(n));
}

/** Round 7 (A3): a table row's benefit as printed: its row label, or -- when that label is only an item code ("A",
 * "B", "5") -- the longest worded cell of the row (the benefit's name), so a figure is bound to the benefit the
 * sentence names. */
export function wordedBenefit(label: string, rowText: string, cellText?: string | null): string {
  if ((String(label ?? "").match(/[A-Za-z]{3,}/g) ?? []).length >= 1 && String(label).trim().length > 3) return String(label).trim();
  const line = rowText.split("\n").find((l) => (cellText && l.includes(cellText)) || (l.split(/\t+| {2,}/)[0] ?? "").trim() === String(label ?? "").trim()) ?? rowText;
  const worded = line.split(/\t+| {2,}/).map((c) => c.trim()).filter((c) => c !== cellText && (c.match(/[A-Za-z]{3,}/g) ?? []).length >= 2 && !/[$€£¥]\s?\d|\b(?:SGD|USD)\s?\d/.test(c)).sort((a, b) => b.length - a.length);
  return worded[0] ?? String(label ?? "").trim();
}
/**
 * Round 7 (A3): everything an evidence entry carries for reading its figures and wording -- the passage, the exact
 * supporting span, the context it needs (the table's header row, a continued header, a footnote; the whole row for a
 * selected cell, as lib/rag2/evidence.ts provides it), the row label and the selected cell. Shared EvidenceRef shape.
 */
export function evidenceTextOf(ref: EvidenceRef): string {
  const parts = [ref.passage?.text, ref.support?.text, ...(ref.context ?? []).map((c) => c.text), ref.table?.rowLabel, ref.table?.cell?.text];
  return [...new Set(parts.filter((x): x is string => typeof x === "string" && !!x.trim()))].join("\n");
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
  // Agent P: every drop is categorised (for an accurate, user-facing outcome) and placed (for meaning checks).
  const drops: DropInfo[] = [];
  let cur = -1, curEstimate = false;
  const staleNotes = new Set([...(ctx.stale?.values() ?? [])]);
  const drop = (sentence: string, reason: string, householdNote?: string) => {
    out.dropped.push({ sentence, reason });
    const cat: DropCat = cur < 0 ? "step" : householdNote === PAYOUT_NOTE || /\bpayout\b/.test(reason) ? "payout" : householdNote === DECISION_NOTE || /\bdecision\b/.test(reason) ? "decision"
      : householdNote === INSTRUCTION_NOTE ? "instruction" : householdNote === SUM_NOTE ? "sum" : householdNote === UNRESOLVED_NOTE ? "unresolved" : householdNote === MISSING_FACT_NOTE ? "missing"
      : householdNote && staleNotes.has(householdNote) ? "stale" : /(?:calculation|computation)[’']s result|arithmetic/.test(reason) ? "calc" : "verify";
    const need = cat === "missing" ? (/uses (?:the household[’']s )?(.+?)(?: = | \(“)/.exec(reason)?.[1] ?? null) : null;
    drops.push({ at: cur, cat, sentence, estimate: curEstimate || /\bestimat\w*\b/i.test(sentence), need, note: cat === "stale" ? householdNote ?? null : null });
  };
  const conditioned: { at: number; words: string[] }[] = [];
  const people = peopleFromLabels(ctx.names ?? []);
  const sentencesIn = args.sentences ?? [];
  for (let i = 0; i < sentencesIn.length; i++) {
    for (const x of out.sentences) x.at ??= cur;
    cur = i;
    const s = sentencesIn[i];
    // Agent P: names as the household uses them; never "Full Name (Short)'s", never a full name twice in a sentence.
    // Round 6 (A3): ids the model wrote into the sentence ("[e9, e6]") are never shown; the ones a tool returned are
    // kept as the sentence's citations (the household sees them as its page links), checked like any other.
    const inline = stripInternalIds(String(s.text ?? "").replace(/\s+/g, " ").trim());
    let text = tidyNames(inline.text, people);
    if (!text) continue;
    let evIds = [...new Set([...((s.evidence_ids as string[]) ?? []).filter(Boolean), ...inline.ids.filter((id) => /^e\d/.test(id) && ctx.state.evidence[id])])];
    const valIds = [...new Set([...((s.value_ids as string[]) ?? []).filter(Boolean), ...inline.ids.filter((id) => /^v\d/.test(id) && ctx.tools.values.has(id))])];
    const inlineResult = inline.ids.find((id) => /^r\d/.test(id) && (ctx.tools.results.has(id) || calcOutcomes(ctx.tools).has(id))) ?? null;
    const resultId = typeof s.result_id === "string" && s.result_id ? s.result_id : inlineResult;
    curEstimate = !!resultId;
    const leak = internalIdsIn(text);
    if (leak.length) { drop(text, `shows an internal id (${leak.slice(0, 3).join(", ")})`); continue; }
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
      // Round 7 (A3): a sentence that only refers to the household's own stated facts, or explains why a fact is
      // still needed, makes no cover or amount claim and needs no document citation.
      if (explainsNeedOnly(text, ctx)) { out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] }); continue; }
      if (figures.length || /\d/.test(text) || COVERISH.test(text)) { drop(text, "states cover or a figure without citing evidence"); continue; }
      out.sentences.push({ text, evidenceIds: [], estimate: false, factKeys: [] });
      continue;
    }
    // Agent F (D7): a cited sentence without a figure must say what its evidence says (polarity, policy, person,
    // benefit); "medically confirmed" / "approved" were refused above.
    if (!figures.length && !result && evIds.length && COVERISH.test(text)) {
      const why = checkCitedStatement(text, evIds.map((id) => ({ policyId: ctx.state.evidence[id].policyId, subjectId: ctx.state.evidence[id].subjectId ?? null, text: [ctx.state.evidence[id].table?.rowLabel ?? "", ctx.state.evidence[id].label ?? "", evidenceTextOf(ctx.state.evidence[id])].filter(Boolean).join("\n") })), { people: ctx.people ?? [], policyNames: ctx.policyNames ?? new Map(), subjectId });
      if (why) { drop(text, "not supported by its evidence: " + why, UNSUPPORTED_NOTE); continue; }
    }
    // Agent F (D3): a sum of printed limits is only ever said as the limits added together -- never as a total
    // anyone can claim, get or be paid.
    if (result && result.operation === "sum" && result.kind === "printed_limit" && (!/\blimits?\b/i.test(text) || /\b(?:claim\w*|receiv\w*|gets?|paid|payable|reimburs\w*|owe\w*|entitle\w*)\b/i.test(text))) { drop(text, "presents a sum of printed limits as an amount that can be claimed", SUM_NOTE); continue; }
    // Agent P (task 6): a printed benefit whose recorded conditions are not established is said as conditional.
    if (figures.length && !result) {
      const benefits = [...values.map((v) => ({ label: v!.operand.benefit, policyId: v!.operand.evidence.policyId })), ...evIds.map((id) => ctx.state.evidence[id]).filter((e) => e.table?.rowLabel).map((e) => ({ label: e.table!.rowLabel, policyId: e.policyId }))];
      const cond = conditionalFraming(text, benefits, ctx);
      if (cond) { text = cond.text; evIds = [...new Set([...evIds, ...cond.evidenceIds])]; conditioned.push({ at: i, words: cond.words }); }
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
      let b: FigureBinding | null = op && subjectId ? toFigureBinding({ ...op.evidence, subjectId: op.evidence.subjectId ?? subjectId }, wordedBenefit(op.benefit, evidenceTextOf(op.evidence), op.evidence.table?.cell?.text), f.value, f.currency) : null;
      // Round 7 (A3): the passages a figure may be printed in are the cited evidence AND the evidence of the table
      // values the sentence cites -- each read with its row context (the whole row, its headers), so a figure printed
      // beside the selected cell (an endorsement's earlier "Existing" amount) is found.
      const refsForFigure: EvidenceRef[] = [...evIds.map((id) => ctx.state.evidence[id] as EvidenceRef), ...values.map((v) => v!.operand.evidence)];
      if (!b && subjectId) for (const ref of refsForFigure) {
        // Agent F (D1): the benefit a passage figure is bound to is the passage's OWN label -- its table row, the
        // label a tool gave it, or (for a clause) the model's label only when the line printing the figure says it.
        // A line that is an instruction inside the document is never evidence for a figure.
        const benefit = (ref.table?.rowLabel ? wordedBenefit(ref.table.rowLabel, evidenceTextOf(ref), ref.table.cell?.text) : "") || (ref as { label?: string | null }).label || passageLabel(evidenceTextOf(ref), f.value, typeof s.benefit === "string" ? s.benefit : "");
        const policyText = withoutInstructions(evidenceTextOf(ref));
        const inCell = !!ref.table?.cell && numbersIn(ref.table.cell.text).some((n) => same(n, f.value));
        // A figure printed elsewhere in the row than the selected cell is bound to the row, not to that cell's column.
        b = benefit && numbersIn(policyText).some((n) => same(n, f.value)) ? toFigureBinding({ ...ref, ...(ref.table && !inCell ? { table: null } : {}), subjectId: ref.subjectId ?? subjectId }, benefit, f.value, f.currency) : null;
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
    out.sentences.push({ text, evidenceIds: ids, estimate: result?.kind === "indicative_estimate", factKeys, ...(valIds.length ? { valueIds: valIds } : {}), ...(typeof s.benefit === "string" && s.benefit.trim() ? { benefit: s.benefit.trim() } : {}), ...(conditioned.some((c) => c.at === i) ? { condition: conditioned.find((c) => c.at === i)!.words.join(" ") } : {}) });
  }
  for (const x of out.sentences) x.at ??= cur;
  cur = -1;
  for (const step of Array.isArray(args.nextSteps) ? args.nextSteps : []) {
    const t = stripInternalIds(String(step ?? "")).text;
    if (!t) continue;
    if (moneyFiguresIn(t).length) { drop(t, "a next step may not state a figure"); continue; }
    if (internalIdsIn(t).length) { drop(t, "a next step may not show an internal id", STEP_NOTE); continue; }
    // Agent F (D8): a next step never states or promises cover, money or a decision.
    const bad = unsafeNextStep(t);
    if (bad) { drop(t, bad, STEP_NOTE); continue; }
    out.nextSteps.push(t);
  }
  settleAnswer(out, drops, conditioned, ctx);
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
/** Integration (S7): an estimate sentence that states the household's own bill figure says it is theirs ("the S$1,500
 * bill you mentioned") -- the composer words it; the gate is not relaxed. Only the household's money operands are
 * attributed, and only where the sentence does not already attribute them. */
const SAID_BACK = /\byou(?:['’]ve| have)? (?:asked about|mentioned|said|told (?:me|us)|wrote|reported|gave|quoted|entered|typed|noted|stated|put)\b|\baccording to you\b|\byour (?:own )?(?:figures?|bill|amount)\b/i;
export function attributeHouseholdFigures(text: string, c: Pick<CalcOutcome, "record">): string {
  if (SAID_BACK.test(text)) return text;
  const own = (c.record?.operands ?? []).filter((o) => o.source === "household" && o.unit === "money" && typeof o.value === "number");
  let t = text;
  for (const f of moneyFiguresIn(text)) {
    if (!own.some((o) => same(o.value as number, f.value))) continue;
    const raw = f.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = new RegExp(String.raw`\b(?:an?|the|your)\s+` + raw + String.raw`\s+(bill|invoice|claim|amount)\b`, "i");
    const after = new RegExp(String.raw`\b(?:an?|the|your)\s+(bill|invoice|amount)\s+of\s+` + raw + String.raw`\b`, "i");
    if (before.test(t)) t = t.replace(before, (_m, n: string) => `the ${f.raw} ${n} you mentioned`);
    else if (after.test(t)) t = t.replace(after, (_m, n: string) => `the ${f.raw} ${n} you mentioned`);
    else t = t.replace(f.raw, `${f.raw} (the figure you mentioned)`);
  }
  return t;
}
/** Integration (r6): the estimate sentence (the one stating the result) carries the record's assumption. */
export function withAssumption(text: string, assumption: string, amount: number, currency: string): string {
  const plain = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  if (plain(text).includes(plain(assumption))) return text;
  const f = moneyFiguresIn(text).find((x) => same(x.value, amount) && x.currency === currency);
  const parts = sentencesOf(text);
  const i = f ? parts.findIndex((p) => p.includes(f.raw)) : -1;
  if (i < 0) return text;
  parts[i] = parts[i].replace(/[.!]?\s*$/, `, ${assumption}.`);
  return parts.join(" ");
}
function composeCalcSentence(text0: string, c: CalcOutcome & { purpose?: string }, evIds: string[], valueOps: TableValueOperand[], subjectId: string | null, ctx: Ctx, out: Composed, drop: (s: string, r: string, note?: string) => void): void {
  let text = text0;
  const pd = payoutOrDecision(text);
  if (pd) { drop(text, pd === "payout" ? "calls a calculated benefit a payout (paid / owed / reimbursed / claimable)" : "states a claim decision only the insurer can make", pd === "payout" ? PAYOUT_NOTE : DECISION_NOTE); return; }
  const sid = subjectId ?? c.subjectId;
  if (sid !== c.subjectId) { drop(text, "the sentence is about another person than the calculation"); return; }
  const partOf = (raw: string) => sentencesOf(text).find((p) => p.includes(raw)) ?? text;
  const evidenceIds = () => [...new Set([...evIds, ...c.evidence.map((e) => evidenceIdOf(ctx.state, e)), ...recordRuleEvidence(c, ctx)])];
  if (c.kind === "indicative_estimate" || c.kind === "conditional_illustration") {
    if (!c.record || c.amount == null || !c.currency) { drop(text, "the calculation has no result"); return; }
    if (PAYOUT.test(text)) { drop(text, "calls a calculated benefit a payout"); return; }
    let factKeys: string[] = [];
    if (c.kind === "indicative_estimate") {
      if (!/\bindicative estimate\b/i.test(text)) text = "Indicative estimate: " + text;
      const hh = calcFactKeys(c, ctx); if (hh.problem) { drop(text, hh.problem, MISSING_FACT_NOTE); return; }
      factKeys = hh.keys;
    } else if (!ILLUSTRATION_IF.test(text)) { drop(text, "an illustration must state its what-if (“if …”)"); return; }
    if (c.kind === "indicative_estimate") text = attributeHouseholdFigures(text, c);
    // Integration (r6): an estimate that assumes earlier use of a capped allowance leaves what this stay needs states
    // that assumption in its own sentence (the save-time gate rejects it otherwise).
    if (c.kind === "indicative_estimate" && c.record.assumption?.trim()) text = withAssumption(text, c.record.assumption.trim(), c.amount, c.currency);
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
  requirementOf(c, ctx, out, evIds);
}

/**
 * Round 6c (A3): the passages a calculation's own rules rest on, cited with the sentence that states its result -- the
 * wording of the benefit that states the day-count / duration rule the record applied (\"Hospital cash is payable for
 * each complete period of 24 hours ...\"), and every document passage a record condition quotes. Only passages a tool
 * returned this conversation, of the calculation's own document, about its own benefit (the benefit is what the
 * sentence is about, before its \"is payable\" / \"pays\").
 */
function recordRuleEvidence(c: CalcOutcome, ctx: Ctx): string[] {
  const out: string[] = [];
  const rec = c.record as (CalcOutcome["record"] & { unitTerms?: { durationRule?: { rule?: string } | null } }) | null;
  const rule = rec?.unitTerms?.durationRule?.rule ?? (rec?.steps ?? []).map((st) => (st as { rule?: string }).rule).find(Boolean) ?? null;
  const keyWords = contentWords(String(c.benefit ?? "").replace(/\([^)]*\)/g, " ")).filter((w) => !BENEFIT_GENERIC.has(w));
  const quoted = (c.conditions ?? []).filter((x) => x.basis === "document" && x.passage?.text && x.passage.policyId === c.policyId).map((x) => x.passage!.text.replace(/\s+/g, " ").trim());
  for (const e of Object.values(ctx.state.evidence)) {
    if (e.policyId !== c.policyId || ctx.stale?.has(e.id) || e.table) continue;
    const text = withoutInstructions(e.passage.text).replace(/\s+/g, " ").trim();
    let hit = quoted.some((q) => q.length >= 12 && (text.includes(q) || q.includes(text)));
    if (!hit && rule && keyWords.length) for (const sentence of text.split(/(?<=[.;])\s+/)) {
      const subject = sentence.split(/\b(?:is|are) (?:payable|paid)\b|\bpays?\b/i)[0] ?? "";
      if (subject === sentence) continue;
      const have = new Set(contentWords(subject));
      if (keyWords.every((w) => have.has(w)) && dayRuleFromWording(sentence)?.rule === rule) { hit = true; break; }
    }
    if (hit) out.push(e.id);
  }
  return out;
}
/** Agent F (D24): an unresolved calculation's specific requirement (figure-free), said once. */
function requirementOf(c: CalcOutcome, ctx: Ctx, out: Composed, evIds: string[]): void {
  if ((c.kind !== "unresolved" && c.kind !== "not_payable") || !c.unresolvedText) return;
  const text = tidyNames(c.unresolvedText, peopleFromLabels(ctx.names ?? []));
  if (out.sentences.some((x) => x.text === text)) return;
  const ids = [...new Set([...evIds, ...c.evidence.map((e) => evidenceIdOf(ctx.state, e))])];
  out.evidenceIds.push(...ids.filter((x) => !out.evidenceIds.includes(x)));
  out.sentences.push({ text, evidenceIds: ids, estimate: false, factKeys: [], kind: "requirement", asks: c.kind === "unresolved" ? requirementConcepts(c) : [] });
}

// ------------------------------------------------------------------------------- Agent P: presenting the answer
type DropCat = "payout" | "decision" | "instruction" | "sum" | "unresolved" | "missing" | "stale" | "calc" | "verify" | "step";
type DropInfo = { at: number; cat: DropCat; sentence: string; estimate: boolean; need?: string | null; note?: string | null };

/** A household member as a sentence may name them: the full (display) name and the short name the household uses. */
export type NamedPerson = { full: string; short: string | null };
/** "Ethan Tan Jun Kai (Ethan)" -> { full: "Ethan Tan Jun Kai", short: "Ethan" }; "Rohan Nair" -> { full, short: null }. */
export function peopleFromLabels(labels: string[]): NamedPerson[] {
  return labels.map((l) => { const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(l.trim()); return m ? { full: m[1].trim(), short: m[2].trim() } : { full: l.trim(), short: null }; }).filter((p) => p.full.length >= 2);
}
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Agent P (task 2): names as the household uses them. "Full Name (Short)" becomes the short name (so never
 * "Full Name (Short)'s"); within one sentence a full name is said once -- a later possessive mention becomes "the"
 * ("I still need Rohan Nair's admission" -> "I still need the admission"), a later plain mention the short name. */
export function tidyNames(text: string, people: NamedPerson[]): string {
  let t = text;
  for (const p of people) if (p.short && p.short !== p.full) t = t.replace(new RegExp(esc(p.full) + String.raw`\s*\(\s*` + esc(p.short) + String.raw`\s*\)`, "g"), p.short);
  return t.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((sentence) => {
    let x = sentence;
    for (const p of people) {
      if (p.full === p.short || p.full.split(/\s+/).length < 2) continue;
      let n = 0;
      x = x.replace(new RegExp(String.raw`\b` + esc(p.full) + String.raw`(['’]s\b)?`, "g"), (m: string, poss?: string) => { n++; return n === 1 ? m : poss ? "the" : p.short ?? m; });
    }
    return x;
  }).join(" ");
}

/** The fact concepts a sentence asks the household for, when it is a request for information (null otherwise). */
const ASKING = /\?\s*$|\bI(?:['’]d| would| will|['’]ll)? (?:still |also |first )?need\b|\b(?:please|could you|can you|would you) (?:tell|let me know|give|send|share|confirm)\b|\blet me know\b|\btell me\b/i;
const CONCEPT_WORDS: [string, RegExp][] = [
  ["admission", /\badmi(?:t|ssion|tted|tting)\w*/i],
  ["discharge", /\bdischarg\w*/i],
  ["bill", /\b(?:bills?|invoices?|receipts?)\b|\bhow much (?:was|did) (?:it|the \w+) cost\b/i],
  ["cause", /\bhow (?:it|this|that|the \w+(?: \w+)?) happened\b|\b(?:accident|illness|sickness)\b/i],
  ["stay_length", /\bhow many (?:nights|days)\b|\bhow long\b|\blength of (?:the )?stay\b/i],
  ["hospital", /\bwhich hospital\b|\bhospital(?:['’]s)? name\b/i],
];
export function askedConcepts(text: string): string[] | null {
  if (!ASKING.test(text) || moneyFiguresIn(text).length) return null;
  const c = CONCEPT_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
  return c.length ? c : null;
}
/** Agent P (task 1): the fact keys an unresolved calculation still needs from the household, as fact concepts
 * (admission_datetime -> admission, bill_amount -> bill, an open condition -> its own key). */
export function requirementConcepts(c: Pick<CalcOutcome, "requirements" | "conditions" | "calculator">): string[] {
  const keys: string[] = [];
  for (const r of c.requirements) {
    if (/\badmi(?:ssion|tted)\b/i.test(r)) keys.push("admission_datetime");
    if (/\bdischarg/i.test(r)) keys.push("discharge_datetime");
    if (/\bbill\b|\bcurrency\b/i.test(r)) keys.push("bill_amount");
  }
  for (const x of c.conditions) if (x.status === "unresolved" && x.needs && x.kind !== "minimum_stay") keys.push(x.id);
  return [...new Set(keys.map((k) => factConcept(k).concept))];
}

/** Agent P (task 6): the policy's condition for paying a printed benefit, from the passages read in this conversation. */
const BENEFIT_GENERIC = new Set(["benefit", "daily", "per", "each", "max", "maximum", "limit", "amount", "sum", "cover", "plan", "insured", "payable", "total", "year", "day", "days", "complete", "hour", "hours", "policy", "child", "adult", "the"].map((w) => contentWords(w)[0] ?? w));
const CONDITION = /\b(?:only if|if|provided(?: that)?|subject to|as long as|on condition that)\b|\b(?:must|has to|have to|needs? to|shall)\s+be\b|\b(?:confirmed|certified|diagnosed|verified|supported)\s+by\b/i;
/** Wording that limits cover by what caused the event (accident-only cover, an illness exclusion). */
const CAUSE_WORDING = /\baccident(?:al|ally|s)?\b|\b(?:illness|sickness|disease|degenerative)\b/i;
/** The cause is what the wording turns on: caused by / solely / directly / due to / arising from / resulting from. */
const CAUSE_LIMIT = /\b(?:caused|solely|directly|due to|arising (?:from|out of)|resulting from|as a result of|attributable to)\b/i;
/** A policy-level statement of what the document covers ("This policy covers ...", "The plan does not cover ..."). */
const COVER_SCOPE = /\b(?:this|the) (?:policy|plan|certificate|cover|insurance)\b[^.]{0,60}\b(?:covers?|insures?)\b|\bis not covered\b|\bare not covered\b/i;
/**
 * Round 6c (A3): every unestablished material condition the selected benefit's own passages (read this conversation,
 * same document) impose on it, appended to a sentence that states the benefit's printed figure:
 *  - the benefit's own conditions (\"payable once per fracture confirmed by X-ray and certified by ...\"), unless the
 *    sentence already carries them or reviewed medical evidence on the claim establishes them;
 *  - while the claim records an event but not how it happened, the document's cause condition: a cover-scope or
 *    benefit sentence that limits cover by cause (accident-only cover, an illness exclusion).
 * Null when there is nothing to add.
 */
export function conditionalFraming(text: string, benefits: { label: string; policyId: string }[], ctx: Pick<Ctx, "state" | "stale"> & Partial<Pick<Ctx, "policyNames">>): { text: string; evidenceId: string; evidenceIds: string[]; words: string[] } | null {
  if (!benefits.length || /\bnot\b|\bexclu/i.test(text)) return null;
  const claim = ctx.state.claim;
  const facts = Object.values(claim?.facts ?? {});
  const keys = Object.keys(claim?.facts ?? {});
  const causeUnknown = !!claim && keys.some((k) => EVENT_KEY.test(k)) && !keys.some((k) => CAUSE_KEYS.has(k) && confirmed(claim.facts[k]));
  const own = new Set(contentWords(text));
  // Whether the sentence itself already says the cause condition -- not counting a product's name or a benefit's
  // printed label that merely contains the word ("Family Accident Guard", "Accidental dental treatment").
  const names = [...(ctx.policyNames?.values() ?? []), ...Object.values(ctx.state.docNames ?? {}), ...benefits.map((b) => b.label)].filter(Boolean).sort((a, b) => b.length - a.length);
  let plain = text;
  for (const n of names) plain = plain.split(n).join(" ");
  const saysCause = CAUSE_WORDING.test(plain);
  const alreadyConditional = /\b(?:if|provided|subject to|as long as|only when|on condition|unless)\b/i.test(text);
  const clauses: string[] = [], ids: string[] = [], causeQuotes: string[] = [];
  const seen = new Set<string>();
  for (const b of benefits) {
    const label = b.label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    const keyWords = contentWords(label).filter((w) => !BENEFIT_GENERIC.has(w));
    if (!keyWords.length) continue;
    const noun = /\b([A-Za-z-]+)\s+benefit\b/i.exec(label)?.[1]?.toLowerCase() ?? null;
    for (const e of Object.values(ctx.state.evidence)) {
      if (e.policyId !== b.policyId || ctx.stale?.has(e.id) || e.table) continue;
      for (const line of withoutInstructions(e.passage.text).split(/(?<=[.;])\s+|\n+/)) {
        const sentence = line.replace(/\s+/g, " ").trim();
        if (!sentence || seen.has(sentence) || moneyFiguresIn(sentence).length) continue;
        const have = new Set(contentWords(sentence));
        const aboutBenefit = keyWords.every((w) => have.has(w));
        // The cause condition, while how it happened is not known.
        if (causeUnknown && CAUSE_WORDING.test(sentence) && CAUSE_LIMIT.test(sentence) && (aboutBenefit || COVER_SCOPE.test(sentence))) {
          seen.add(sentence);
          if (!saysCause) { causeQuotes.push(sentence.replace(/[;:\s]+$/, "")); ids.push(evidenceIdOf(ctx.state, e)); }
          continue;
        }
        // The benefit's own condition: a sentence the model already wrote as conditional keeps its own wording.
        if (alreadyConditional || !aboutBenefit || !CONDITION.test(sentence) || /\bnot (?:covered|payable)\b|\bexclu/i.test(sentence)) continue;
        seen.add(sentence);
        const words = contentWords(sentence).filter((w) => !keyWords.includes(w));
        // Established only by reviewed medical evidence recorded for the claim -- never by the household's report.
        if (facts.some((f) => f.source === "medical_evidence" && contentWords(f.words).filter((w) => words.includes(w)).length >= 2)) continue;
        // The sentence already carries the condition.
        if (words.length && words.filter((w) => own.has(w)).length / words.length >= 0.6) continue;
        const body = sentence.replace(/[.;:\s]+$/, "");
        let clause: string | null = null;
        const part = /\b(?:confirmed|certified|diagnosed|verified|supported)\s+by\b.*$/i.exec(body)?.[0];
        const must = /\b(?:must|has to|have to|needs? to|shall)\s+be\s+(.+)$/i.exec(body)?.[1];
        const iff = /\b(?:only if|if|provided(?: that)?|as long as|on condition that)\s+(.+)$/i.exec(body)?.[1];
        const subj = /\bsubject to\s+(.+)$/i.exec(body)?.[1];
        if (part && noun) clause = `payable if the ${noun} is ${part}`;
        else if (must && noun) clause = `payable only if the ${noun} is ${must}`;
        else if (iff) clause = `payable only if ${iff}`;
        else if (subj) clause = `subject to ${subj}`;
        if (!clause || clause.length > 200) clause = `payable only if the policy’s conditions for it are met (“${body}”)`;
        clauses.push(clause); ids.push(evidenceIdOf(ctx.state, e));
      }
    }
  }
  if (causeQuotes.length) clauses.push(`${clauses.length ? "and " : ""}only for what the policy covers, which depends on how it happened: “${causeQuotes.map((q) => q.replace(/[.\s]+$/, "")).join(". ")}.”`);
  if (!clauses.length) return null;
  const framed = text.replace(/[.!\s]+$/, "") + ", " + clauses.join(", ") + (clauses.at(-1)!.endsWith("”") ? "" : ".");
  return { text: framed, evidenceId: ids[0], evidenceIds: [...new Set(ids)], words: contentWords(clauses.join(" ")) };
}

const QUALIFIER_START = /^(?:however|but|except|unless|only (?:if|when|after|for)|(?:this|that|it) (?:does not|doesn['’]t|only|is only|excludes|won['’]t)|not\b|note that|although|though|provided|subject to|(?:this|that|the) limit)\b/i;
const DEPENDENT_START = /^(?:this|that|these|those|it|its|they|their|however|but|so|therefore|also|in addition|then|after that|as a result|because of (?:this|that)|which|otherwise|together|in total|altogether)\b/i;
const INTRO = /:\s*$|\b(?:here (?:is|are)|the following|as follows|below)\b/i;
/**
 * Agent P (task 3): the answer as the household sees it, once sentences have been checked. Never commentary on what
 * was removed or why. A kept sentence whose meaning depended on a removed one is withdrawn too (a removed qualifier of
 * the sentence before it, a sentence that refers back to a removed one, an estimate's label left without its
 * estimate, a list introduction whose list lost an item); a model sentence asking for what an unresolved
 * calculation's requirement already asks (same fact concepts) is not repeated; a separate sentence repeating a
 * condition now carried by its benefit's sentence is not repeated. Notes are user-facing caveats; when nothing at all
 * can be kept, one accurate explanation of why.
 */
function settleAnswer(out: Composed, drops: DropInfo[], conditioned: { at: number; words: string[] }[], ctx: Ctx): void {
  const removed = drops.filter((d) => d.at >= 0).map((d) => ({ at: d.at, estimate: d.estimate }));
  const withdrawn: ComposedSentence[] = [];
  let changed = true, incomplete = false;
  const content = () => out.sentences.filter((x) => x.kind !== "requirement" && !withdrawn.includes(x));
  while (changed) {
    changed = false;
    for (const k of content()) {
      const at = k.at ?? -1;
      const startsDependent = DEPENDENT_START.test(k.text) && removed.some((r) => r.at === at - 1) && !out.sentences.some((x) => x !== k && x.at === at - 1 && !withdrawn.includes(x));
      const qualifierLost = drops.some((d) => d.at === at + 1 && QUALIFIER_START.test(d.sentence)) || withdrawn.some((w) => (w.at ?? -9) === at + 1 && QUALIFIER_START.test(w.text));
      const labelLeft = !k.estimate && k.kind !== "indicative_estimate" && /\bestimat\w*\b/i.test(k.text) && removed.some((r) => r.estimate) && !out.sentences.some((x) => x.estimate && !withdrawn.includes(x));
      // A list introduction whose list lost an item, or that now introduces nothing at all.
      const intro = INTRO.test(k.text) && !moneyFiguresIn(k.text).length && (removed.some((r) => r.at > at) || (removed.length > 0 && !content().some((x) => (x.at ?? -1) > at)));
      if (startsDependent || qualifierLost || labelLeft || intro) {
        withdrawn.push(k); removed.push({ at, estimate: k.estimate }); changed = true;
        if (intro && content().some((x) => (x.at ?? -1) > at)) incomplete = true;
        out.dropped.push({ sentence: k.text, reason: intro ? "introduces a list that lost an item" : labelLeft ? "refers to an estimate that was removed" : qualifierLost ? "its qualification was removed" : "refers to a sentence that was removed" });
      }
    }
  }
  // A model sentence asking for what a requirement already asks.
  const asked = new Set(out.sentences.filter((x) => x.kind === "requirement").flatMap((x) => x.asks ?? []));
  for (const k of content()) {
    const c = askedConcepts(k.text);
    if (c && c.every((x) => asked.has(x))) { withdrawn.push(k); out.dropped.push({ sentence: k.text, reason: "repeats the missing-information requirement" }); }
  }
  // A separate sentence repeating a condition its benefit's sentence now carries.
  for (const c of conditioned) for (const k of content()) {
    if (k.at === c.at || moneyFiguresIn(k.text).length) continue;
    const w = contentWords(k.text);
    const have = new Set(c.words);
    if (w.length && w.filter((x) => have.has(x)).length / w.length >= 0.85) { withdrawn.push(k); out.dropped.push({ sentence: k.text, reason: "repeats the condition stated with the benefit" }); }
  }
  if (withdrawn.length) {
    const gone = (sentence: string) => withdrawn.some((w) => w.text.includes(sentence) || sentence.includes(w.text));
    out.sentences = out.sentences.filter((x) => !withdrawn.includes(x));
    out.figureBindings = out.figureBindings.filter((b) => !gone(b.sentence));
    out.computations = out.computations.filter((r) => !gone(r.sentence));
    const keptCalc = out.calculations.filter((r) => !gone(r.sentence));
    const lostIds = new Set(out.calculations.filter((r) => !keptCalc.includes(r)).map((r) => r.id));
    out.calculations = keptCalc;
    out.calcs = out.calcs.filter((c) => !lostIds.has(c.calcId));
    out.evidenceIds = out.evidenceIds.filter((id) => out.sentences.some((x) => x.evidenceIds.includes(id)));
  }
  // Notes: caveats the household needs (never "I left out ..."), or one accurate explanation when nothing is left.
  const notes: string[] = [];
  const add = (n: string | null | undefined) => { if (n && !notes.includes(n)) notes.push(n); };
  for (const d of drops) if (d.cat === "stale") add(d.note); // user-facing at the source (loop.ts revalidateEvidence)
  if (drops.some((d) => d.cat === "decision")) add(DECISION_NOTE);
  if (drops.some((d) => d.cat === "payout")) add(PAYOUT_NOTE);
  if (drops.some((d) => d.cat === "sum")) add(SUM_NOTE);
  if (incomplete && out.sentences.length) add(INCOMPLETE_NOTE);
  if (!out.sentences.length && !notes.length && drops.length) {
    const has = (c: DropCat) => drops.some((d) => d.cat === c);
    const need = drops.find((d) => d.cat === "missing")?.need;
    if (has("missing")) add(`I can’t work out an estimate yet: it would rely on ${need ? (/^(?:the|your|a|an)\b/i.test(need) ? need : "the " + need) : "a detail"} you haven’t given me (or have since corrected).`);
    else if (has("calc")) add(CALC_NOTE);
    else if (has("instruction")) add(INSTRUCTION_NOTE);
    else add(DROPPED_NOTE);
  }
  out.notes = notes.map((n) => tidyNames(n, peopleFromLabels(ctx.names ?? [])));
}
