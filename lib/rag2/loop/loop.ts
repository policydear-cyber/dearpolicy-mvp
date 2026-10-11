/**
 * Conversational RAG (Prompt 2): ONE model-driven conversation loop.
 *
 *   system prompt + conversation state  ->  model turn (tool calls)  ->  tools run deterministically  ->  repeat
 *
 * until the model ends the turn with ask_user (one question) or final_answer (sentences citing evidence), within a
 * bounded step / token budget. The model decides which tools to call and what to ask; this code only retrieves,
 * selects, computes and verifies (the lib/rag2 tools), keeps the conversation state (who the conversation is about,
 * the pending question, the claim facts and what was derived from them, the evidence used), and refuses actions that
 * break the conversation rules (a second question, a fact already known, a question no evidence makes relevant).
 * The visible reply is composed only from the model's final_answer / ask_user (compose.ts).
 */
import { moneyFiguresIn, verifyAnswerFigures } from "@/lib/chat/answer-verification";
import type { ChatAnswer } from "@/types";
import { refineEvidence, supportSpan, contextFor, type EvidenceRef } from "../evidence";
import { loadDocs, loadPages } from "../store";
import { calcOutcomes } from "../calc/tool";
import { createToolContext, RAG_TOOLS, runTool, validateArgs, type ToolContext } from "../tools";
import { loopLimits } from "@/lib/ai/usage";
import { CAUSE_KEYS, checkFact, confirmed, EVENT_KEY, factConcept, householdOperandProblem, isoParts, knownFactFor, MECHANISM, normalizeKey, numbersIn, quotedFrom } from "./facts";
import { calcRef, CLAIMED_AMOUNT_KEY, syncLoopClaimState } from "../calc/claim-record";
import { compoundQuestion, relevantEvidence, statedInMessage } from "./questions";
import { internalIdsIn } from "./statements";
import { LoopUsageMeter, type MeterStop } from "./usage-meter";
import { ASK_USER, FINAL_ANSWER, LOOP_ACTIONS, NOTE_FACTS, TERMINAL } from "./actions";
import { composeFinal, DATE_ABSENCE_REASON, DROPPED_NOTE, keepLimitationWithFigure, evidenceIdOf, reportedFactFollowUp, sayBack, type ComputeCall, type Composed } from "./compose";
import { loopToolEnv } from "./flag";
import { LOOP_PROMPT_VERSION, stateNote, SYSTEM_PROMPT } from "./prompt";
import type { EstablishedStatement, EvidenceEntry, LoopClaim, LoopMessage, LoopModel, LoopPending, LoopToolSpec, RagLoopState, ToolCall, TraceToolCall, TraceTurn } from "./types";

export type LoopPerson = { id: string; name: string; relationship: string };
export type LoopInput = { accountId: string; message: string; state: RagLoopState; people: LoopPerson[];
  /** Who is typing, when the request itself knows (the only member recorded as self). A speaker the household named
   * earlier in the conversation (state.speakerId) takes precedence. Null in a shared login: the loop asks when needed. */
  speakerId: string | null;
  /** Who the chat was opened about (a member-scoped chat): the initial active subject -- never the speaker. */
  initialSubjectId?: string | null;
  model: LoopModel; env?: NodeJS.ProcessEnv; asOf?: string | null;
  /** Cancels the turn: an in-flight model call is aborted and no further call is made. */
  signal?: AbortSignal | null;
  /** Agent F (D12): the member the household tapped in answer to the pending person question (chat page choice). */
  personChoiceId?: string | null };
export type LoopReply =
  | { kind: "final"; composed: Composed }
  | { kind: "ask"; pending: LoopPending; preface: string | null;
      /** Round 6 (A3): what the turn says before its question (the preface and statements), composed and checked like
       * a final_answer (null when it says nothing). The question itself is presented once, as the question card. */
      composed?: Composed | null }
  | { kind: "fallback"; text: string };
export type LoopCorrection = { key: string; from: unknown; to: unknown; withdrawn: string[];
  /** Agent F: the facts the withdrawn estimates were worked out from (said back without their figures). */
  about?: string[] };
/** Agent G: what a deleted / superseded source took with it (only what it alone supported). */
/** A clock time in the household's words (9.30pm, 21:30, 9 am, noon, midnight). */
const CLOCK_TIME = /\b\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}[:.]\d{2}\b|\bnoon\b|\bmidnight\b/i;
export type SourceInvalidation = { kind: "fact" | "estimate" | "calculation"; subjectId: string | null; key?: string; sentence?: string; calcId?: string; reason: string };
export type LoopOutput = { state: RagLoopState; reply: LoopReply; trace: TraceTurn; tools: ToolContext; corrections: LoopCorrection[]; reasked: LoopPending | null;
  /** Round 9: `reasked` is a NEW follow-up question this answer ends with (not a question put back after a side answer). */
  followUp?: boolean;
  /** Agent G: conclusions withdrawn this turn because the only source supporting them was deleted or superseded. */
  invalidated?: SourceInvalidation[] };

/** Agent F (D23): the turn used every lookup step it is allowed: said as what happened (a limit), not "ask again". */
export const FALLBACK_TEXT = "I couldn’t finish: looking this up needed more steps than the limit set for a single question, so I stopped before answering. Asking about one policy or one person at a time usually stays within it.";
/** Honest replies when a usage limit or a timeout stops the turn (nothing is answered from a half-finished turn). */
export const LIMIT_TEXT: Record<MeterStop["kind"], string> = {
  turn_calls: FALLBACK_TEXT,
  turn_tokens: "I couldn’t finish: this question reached the limit set for model use on a single question, so I stopped before answering. Please ask about one policy or one person at a time.",
  turn_tokens_used: "I couldn’t finish: this question reached the limit set for model use on a single question, so I stopped before answering. Please ask about one policy or one person at a time.",
  turn_usd: "I couldn’t finish: this question reached the limit set for model use on a single question, so I stopped before answering. Please ask about one policy or one person at a time.",
  turn_time: "I couldn’t finish: the time set aside for this answer ran out, so I stopped before answering. Please ask again.",
  timeout: "I couldn’t finish: the model took too long to reply, so I stopped the request before answering. Please ask again in a moment.",
  cancelled: "I stopped before answering because the request was cancelled.",
  household_allowance: "I couldn’t look that up: this household has used its monthly allowance for assistant answers. Your documents and their pages are still available; assistant answers resume next month.",
  household_spend_cap: "I couldn’t look that up: this household has reached DearPolicy’s monthly model-use limit. Your documents and their pages are still available; assistant answers resume next month.",
  run_budget: "I couldn’t look that up: the model-use budget set for this test run is used up, so no model was called.",
  model_error: "I couldn’t finish: the assistant model returned an error, so I stopped before answering rather than guess. Nothing was saved from this attempt; please try again in a moment.",
};
/** Agent F: the household says the person was wrong ("sorry, it was Chloe, not Ethan", "I mixed them up"). */
const PERSON_CORRECTION = { test: (m: string) => /\b(?:mixed (?:them|it|those|the two) up|mix-?up|i meant|i mean\b|meant to say|not (?:him|her)\b|wrong (?:child|person|kid|son|daughter)|correction|actually it was|it was (?:\w+ ){0,3}not\b|rather than)\b/i.test(m) || /\bnot [A-Z][a-z]+\b/.test(m) };

export function loopToolSpecs(): LoopToolSpec[] {
  return [...RAG_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), ...LOOP_ACTIONS];
}

const isRef = (v: any): v is EvidenceRef => !!v && typeof v === "object" && typeof v.policyId === "string" && !!v.passage && typeof v.passage.text === "string" && !!v.page;
/** What a tool result looks like to the model: every EvidenceRef replaced by its evidence id and a short excerpt. */
function forModel(value: unknown, state: RagLoopState, via: string, ids: string[], shown?: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => forModel(v, state, via, ids, shown));
  if (isRef(value)) {
    const id = evidenceIdOf(state, value, via);
    if (!ids.includes(id)) ids.push(id);
    // Round 7 (A3): a passage the model has already been shown this turn is referred to, not repeated in full.
    if (shown?.has(id)) return { evidence_id: id, page: value.passage.onPage, ...(value.table ? { row: value.table.rowLabel, column: value.table.columnHeader } : {}), excerpt: "(shown above)" };
    shown?.add(id);
    return { evidence_id: id, policy_id: value.policyId, page: value.passage.onPage, ...(value.table ? { row: value.table.rowLabel, column: value.table.columnHeader } : {}), excerpt: value.passage.text.length > 400 ? value.passage.text.slice(0, 400) + "…" : value.passage.text };
  }
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = forModel(v, state, via, ids, shown);
    // Round 9 (tokens): a hit's own `text` is not sent again beside its evidence excerpt when it is the same passage.
    const ex = (o.evidence as { excerpt?: unknown } | undefined)?.excerpt;
    // (When the excerpt was cut short, the excerpt carries the hit's full text instead -- said once, nothing lost.)
    if (typeof o.text === "string" && typeof ex === "string" && ex !== "(shown above)" && sameStart(o.text, ex)) {
      if (/…$/.test(ex) && o.text.length > ex.length - 1) (o.evidence as { excerpt: string }).excerpt = o.text;
      delete o.text;
    }
    return o;
  }
  return value;
}
const sameStart = (a: string, b: string) => { const x = a.replace(/\s+/g, " ").trim(), y = b.replace(/…$/, "").replace(/\s+/g, " ").trim(); return x.slice(0, 160) === y.slice(0, 160); };
/** Round 7 (A3): a tool result as the model sees it -- its data, then only the evidence its data did not already
 * list (never the same passage twice in one result), each passage in full only the first time this turn. */
function resultForModel(res: { ok: boolean; data?: unknown; error?: string; evidence: unknown }, state: RagLoopState, via: string, ids: string[], shown: Set<string>): Record<string, unknown> {
  const data = res.ok ? forModel(res.data, state, via, ids, shown) : undefined;
  // The evidence list repeats what the data already showed only as references (id, page, row), never in full.
  const evidence = forModel(Array.isArray(res.evidence) ? res.evidence : [], state, via, ids, shown) as unknown[];
  return res.ok ? { ok: true, data, evidence } : { ok: false, error: res.error, evidence };
}

/** The line of a cited passage that says why a question matters: a table row's label, else the passage line sharing
 * the most words with the question (quoted verbatim, whitespace collapsed). */
function whyLine(e: EvidenceRef, about: string): string {
  if (e.table?.rowLabel) return e.table.rowLabel;
  const want = new Set((about.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/e?s$/, "")));
  const all = e.passage.text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Round 6 (A3): a heading ("Section 2 - What is covered") never says why a fact matters: prefer wording lines.
  const wording = all.filter((l) => /[.;:]$/.test(l) || l.split(" ").length > 8);
  const lines = wording.length ? wording : all;
  const score = (l: string) => (l.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => want.has(w.replace(/e?s$/, ""))).length;
  const best = [...lines].sort((a, b) => score(b) - score(a))[0] ?? "";
  return "“" + (best.length > 160 ? best.slice(0, 157) + "…" : best) + "”";
}

const brief = (r: unknown): string => { const s = JSON.stringify(r) ?? ""; return s.length > 160 ? s.slice(0, 160) + "…" : s; };

const SELF_MENTION = /^(?:i|me|my|myself|mine|my own|self)$/i;
/** Round 7 (A3): told once to a turn running short of budget or whose tools keep failing. */
/** Round 8 (A3): the household's reply typed into a question card: the chat page sends "<question>: <answer>" (the
 * question without its question mark). Null when the message is not that reply to the pending fact question. */
export function inlineAnswer(pending: LoopPending | null | undefined, message: string): { pending: Extract<LoopPending, { kind: "fact" }>; answer: string } | null {
  if (pending?.kind !== "fact") return null;
  const sq = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase().replace(/[’']/g, "'");
  const q = sq(pending.question.replace(/\?\s*$/, "")), m = sq(message);
  if (!m.startsWith(q)) return null;
  const rest = message.replace(/\s+/g, " ").trim().slice(q.length).replace(/^\s*\??\s*[:\-–—]\s*/, "").trim();
  return rest.length >= 1 ? { pending, answer: rest } : null;
}
export const BUDGET_NOTICE = "This question's model-use budget is running low or a tool keeps failing: do not retry failing tools or search again. End the turn now with final_answer -- the printed figures you already have, cited -- and say what is still missing; or ask_user for the one missing fact.";
/** The stops a turn's own budget causes (a partial answer is given); provider errors, cancellations and household
 * allowances keep their own honest text. */
const BUDGET_STOPS = new Set(["turn_tokens", "turn_tokens_used", "turn_calls", "turn_usd", "turn_time"]);
/** A table row's benefit as the household reads it: the operand's label, or -- when that is only an item number
 * ("B") -- the longest worded cell of the row printing `cell`. */
function rowLabelOf(benefit: string, passage: string, cell: string): string {
  if ((benefit.match(/[A-Za-z]{3,}/g) ?? []).length >= 2) return benefit.trim();
  const line = passage.split("\n").find((l) => l.includes(cell)) ?? passage;
  const worded = line.split(/\t+| {2,}/).map((c) => c.trim()).filter((c) => c !== cell && (c.match(/[A-Za-z]{3,}/g) ?? []).length >= 2 && !/[$€£¥]\s?\d/.test(c)).sort((a, b) => b.length - a.length);
  return worded[0] ?? benefit.trim();
}
/** Round 6c: a mention that means anyone in the household (a quantifier or the household as a whole), not one person. */
export const ANYONE = /^(?:(?:one|any|either|each|all|both|neither|none|some|whichever)(?: one)? of (?:us|you|them|the family|the kids|the children|my family|our family|our kids|our children)|anyone|anybody|someone|somebody|everyone|everybody|whoever|we|us|our|ours|the family|family|the household|any family member|a family member|family members|any of the kids|any of the children)$/i;
/** Lookups that read a policy's passages / rows. */
const LOOKUPS = new Set(["search_passages", "select_table_value", "read_page"]);
/** A table column whose values apply to a kind of person, a tier or a plan (the answer can differ by person). */
const PER_PERSON = new Set(["person_class", "tier", "plan"]);
/** Evidence that makes how an event happened matter: wording that distinguishes accidents (and so illness / other
 * causes) -- an accident-only benefit, an accidental definition, an illness exclusion. */
const CAUSE_WORDING = /\baccident(?:al|ally|s)?\b|\b(?:illness|sickness|disease)\b/i;
/** Tools that establish what a person's policies say: never run for a person until who is meant is settled. */
const SUBJECT_TOOLS = new Set(["policies_for", "select_table_value", "search_passages"]);

export async function runLoop(input: LoopInput): Promise<LoopOutput> {
  const env = input.env ?? process.env;
  const limits = loopLimits(env);
  const state: RagLoopState = structuredClone(input.state);
  state.turn += 1;
  state.speakerId = state.speakerId ?? input.speakerId ?? null;
  if (!state.subjectId && input.initialSubjectId) state.subjectId = input.initialSubjectId;
  const householdIds = new Set(input.people.map((p) => p.id));
  const ctx = createToolContext({ accountId: input.accountId, speakerId: state.speakerId, lastSubjectId: state.subjectId, asOf: input.asOf ?? null });
  ctx.conversation.recentSubjectIds = [...state.recentSubjectIds];
  ctx.seq = state.seq;
  const computeCalls = new Map<string, ComputeCall>();
  // Agent F (D6): evidence remembered from earlier turns is re-checked every turn: a document deleted, replaced by a
  // newer version, or not this household's supplies nothing any more (the composer refuses sentences citing it).
  const { stale, policyNames } = await revalidateEvidence(input.accountId, state);
  // Round 7: table values issued in earlier turns stay citable (value ids are unique across the conversation) while
  // their document is still current; a benefit already stated, cited and bound stays available to explain again.
  for (const [id, v] of Object.entries(state.values ?? {})) {
    const eid = v?.operand?.evidence ? evidenceIdOf(state, v.operand.evidence, "select_table_value") : null;
    if (eid && !stale.has(eid)) ctx.values.set(id, v as Parameters<typeof ctx.values.set>[1]);
  }
  if (state.established) state.established = state.established.filter((e) => e.evidenceIds.every((id) => state.evidence[id] && !stale.has(id)) && e.valueIds.every((id) => ctx.values.has(id)));
  /** Integration (agent C's request 3): what the latest calculate result for each person still needs from the
   * household (fact key, why, the evidence ids that make it matter), in the order it should be asked. */
  const calcMissing = new Map<string, { key: string; why: string; evidenceIds: string[] }[]>();
  const trace: TraceTurn = { turn: state.turn, userMessage: input.message, modelId: input.model.id, modelKind: input.model.kind, steps: 0, usage: { input: 0, output: 0 }, latencyMs: 0, toolCalls: [], evidenceChosen: [], outcome: "budget_exhausted", dropped: [], gate: [], calls: [], limit: null };
  const corrections: LoopOutput["corrections"] = [];
  const pendingBefore = state.pending;
  // Round 8 (A3): an answer typed into the question card ("<question>: <answer>") answers THAT question. It is
  // recorded under the asked fact as the household's own report and the question is resolved in the saved state --
  // before the model runs, so it is never asked again (the model still explains the conditional benefit).
  const inline = inlineAnswer(pendingBefore, input.message);
  if (inline) {
    const subject = inline.pending.subjectId ?? state.claim?.subjectId ?? state.subjectId;
    const claim = subject ? (state.claim?.subjectId === subject ? state.claim : (state.otherClaims?.[subject] ?? (!state.claim ? (state.claim = { subjectId: subject, facts: {}, derived: [] }) : null))) : null;
    if (claim && !claim.facts[inline.pending.factKey]) claim.facts[inline.pending.factKey] = { value: inline.answer, words: inline.answer, turn: state.turn, source: "user_reported", basis: "stated" };
    state.pending = null;
  }
  const userTexts = [...state.history.map((h) => h.user), input.message];
  const messages: LoopMessage[] = [{ role: "system", content: SYSTEM_PROMPT + "\n\n" + stateNote(state, input.people, state.speakerId) }];
  for (const h of state.history.slice(-6)) { messages.push({ role: "user", content: h.user }); messages.push({ role: "assistant", content: h.assistant }); }
  messages.push({ role: "user", content: input.message });
  const tools = loopToolSpecs();
  let reply: LoopReply | null = null;
  const t0 = Date.now();
  const meter = new LoopUsageMeter({ model: input.model, accountId: input.accountId, limits, startedAt: t0, promptVersion: LOOP_PROMPT_VERSION, signal: input.signal ?? null });
  let stop: MeterStop | null = null;

  // Who is meant, while unsettled: candidates resolve_person offered (this turn, or the person question pending from
  // the last turn) -- nothing about their cover is looked up until the household says which one.
  let unsettled = new Set<string>(pendingBefore?.kind === "person" ? pendingBefore.options.map((o) => o.id) : []);
  let lastAmbiguous: { self: boolean; labels: Map<string, string> } | null = null;
  // Agent F (D12): a tapped choice answers the pending person question deterministically (who is typing, or who is
  // meant), before the model is called; the model is told who was chosen.
  if (pendingBefore?.kind === "person" && input.personChoiceId && pendingBefore.options.some((o) => o.id === input.personChoiceId)) {
    const id = input.personChoiceId;
    if (pendingBefore.purpose === "speaker") { state.speakerId = id; ctx.conversation.speakerId = id; }
    else { state.subjectId = id; state.recentSubjectIds = [id, ...state.recentSubjectIds.filter((x) => x !== id)].slice(0, 5); ctx.conversation.lastSubjectId = id; }
    unsettled = new Set();
    state.pending = null;
    (messages[0] as { content: string }).content += `\n- The household answered the person question with ${input.people.find((p) => p.id === id)?.name ?? id} id=${id} for the question "${pendingBefore.question}"${pendingBefore.purpose === "speaker" ? ": that is who is typing" : ""}.`;
  }
  const candidateLabels = new Map<string, string>();

  const nameOf = (id: string | null | undefined) => input.people.find((p) => p.id === id)?.name ?? "another person";
  /** Agent F (D16): a withdrawn estimate is taken out of the history the model is shown (this turn and later ones). */
  const scrubWithdrawn = (sentences: string[]) => {
    const swap = (t: string) => sentences.reduce((acc, w) => (w && acc.includes(w) ? acc.split(w).join("(an earlier estimate, since withdrawn)") : acc), t);
    state.history = state.history.map((h) => ({ ...h, assistant: swap(h.assistant) }));
    for (const m of messages) if ((m.role === "assistant" || m.role === "system") && typeof m.content === "string") m.content = swap(m.content);
  };
  // Agent G (deleted / superseded sources): only what such a source ALONE supported is withdrawn -- a fact or a
  // conclusion also printed by another live document stays (re-pointed to it); the household's own facts never depend
  // on a document and always stay.
  const invalidated = invalidateStaleSupport(state, stale);
  {
    const gone = invalidated.filter((x) => x.kind === "estimate" && x.sentence).map((x) => x.sentence!);
    if (gone.length) scrubWithdrawn(gone);
  }
  /** Agent F (D9 / S6a): the household corrected WHO the claim is about ("it was Chloe, not Ethan"): estimates worked
   * out for the first person are withdrawn, and the reply says which one and why. */
  const personCorrection = (to: string) => {
    const from = state.claim;
    if (!from?.subjectId || from.subjectId === to || !PERSON_CORRECTION.test(input.message)) return;
    const withdrawn = from.derived.map((d) => d.sentence);
    const about = [...new Set(from.derived.flatMap((d) => d.factKeys))];
    from.derived = [];
    // Agent G: every calculation worked out for the person first named is withdrawn, and the claim (and its record)
    // moves to the corrected person.
    for (const r of Object.values(from.calcs ?? {})) if (!r.withdrawn) r.withdrawn = { cause: "person", reason: `the claim is about ${nameOf(to)}, not ${nameOf(from.subjectId)}`, turn: state.turn };
    if (!(state.claimMoves ?? []).some((m) => m.from === from.subjectId && m.to === to && m.turn === state.turn)) (state.claimMoves ??= []).push({ from: from.subjectId, to, turn: state.turn });
    if (corrections.some((c) => c.key === "person" && c.to === nameOf(to))) return;
    corrections.push({ key: "person", from: nameOf(from.subjectId), to: nameOf(to), withdrawn, about });
    if (withdrawn.length) scrubWithdrawn(withdrawn);
  };
  /** Agent G: the household corrected who the claim is about: the corrected person's claim becomes the active one and
   * takes the event as the household described it (their own reported facts; nothing a document or a calculation
   * produced for the person first named). The first person's claim is kept aside, its calculations withdrawn. */
  const moveClaimTo = (to: string) => {
    const from = state.claim;
    if (!from?.subjectId || from.subjectId === to) return;
    (state.otherClaims ??= {})[from.subjectId] = from;
    const next: LoopClaim = state.otherClaims[to] ?? { subjectId: to, facts: {}, derived: [] };
    delete state.otherClaims[to];
    for (const [k, f] of Object.entries(from.facts)) if ((f.source ?? "user_reported") === "user_reported" && !next.facts[k]) next.facts[k] = structuredClone(f);
    state.claim = next;
  };
  /** The claim kept for `subject` (created if new). The active claim moves to it unless a question about another
   * member's claim is pending -- a side remark about someone else never displaces that claim. */
  const claimFor = (subject: string): LoopClaim => {
    if (state.claim?.subjectId === subject) return state.claim;
    const parked = state.otherClaims?.[subject] ?? { subjectId: subject, facts: {}, derived: [] };
    // Agent F (D9): a fact about the speaker ("I'm on the private hospital plan") never displaces another member's
    // open claim -- it is kept beside it.
    const speakerAside = subject === state.speakerId && !!state.claim?.subjectId && state.claim.subjectId !== subject && Object.keys(state.claim.facts).length > 0 && !PERSON_CORRECTION.test(input.message);
    const hold = speakerAside || (state.pending?.kind === "fact" && state.pending.subjectId && state.pending.subjectId !== subject);
    if (hold) { (state.otherClaims ??= {})[subject] = parked; return parked; }
    if (state.claim?.subjectId) { personCorrection(subject); (state.otherClaims ??= {})[state.claim.subjectId] = state.claim; }
    if (state.otherClaims) delete state.otherClaims[subject];
    state.claim = parked;
    return parked;
  };
  /** Moves the active subject -- except to the speaker while another member's claim is open or pending (a side
   * question about "me" never changes who the claim is about). */
  const setSubject = (id: string, viaSelf: boolean) => {
    const otherClaimOpen = (state.claim?.subjectId && state.claim.subjectId !== id) || (state.pending?.kind === "fact" && state.pending.subjectId && state.pending.subjectId !== id);
    if (viaSelf && otherClaimOpen) return;
    if (state.claim?.subjectId && state.claim.subjectId !== id) { personCorrection(id); if (PERSON_CORRECTION.test(input.message)) moveClaimTo(id); }
    state.subjectId = id;
    state.recentSubjectIds = [id, ...state.recentSubjectIds.filter((x) => x !== id)].slice(0, 5);
  };
  /** Evidence (seen this conversation) whose wording makes the cause of an event matter. */
  const causeEvidence = () => Object.values(state.evidence).filter((e) => CAUSE_WORDING.test(e.passage.text) || CAUSE_WORDING.test(e.table?.rowLabel ?? "")).map((e) => e.id);
  /** True when the subject's claim records an event (an injury, a condition) but not how it happened, and the
   * documents' wording makes the cause matter. */
  const causeOpen = (subject: string | null | undefined): string[] | null => {
    const claim = subject ? (state.claim?.subjectId === subject ? state.claim : state.otherClaims?.[subject]) : null;
    if (!claim) return null;
    const keys = Object.keys(claim.facts);
    if (!keys.some((k) => EVENT_KEY.test(k)) || keys.some((k) => CAUSE_KEYS.has(k) && confirmed(claim.facts[k]))) return null;
    const ev = causeEvidence();
    return ev.length ? ev : null;
  };

  const record = (name: string, args: Record<string, unknown>, ok: boolean, evidenceIds: string[], error?: string, summary?: string): TraceToolCall => { const t: TraceToolCall = { name, args, ok, evidenceIds, ...(error ? { error } : {}), ...(summary ? { summary } : {}) }; trace.toolCalls.push(t); return t; };

  // Page text for evidence precision (loaded once per document per turn).
  const pageCache = new Map<string, Map<number, string>>();
  const pagesOf = async (policyId: string) => {
    if (!pageCache.has(policyId)) pageCache.set(policyId, new Map((await loadPages(input.accountId, [policyId]).catch(() => [])).map((p) => [p.page, p.text])));
    return pageCache.get(policyId)!;
  };
  /** Sets an evidence entry's support to the sentence / row that supports `about` (keeps the old one when none fits). */
  const narrow = async (id: string, about: string) => {
    const e = state.evidence[id];
    if (!e) return;
    const pages = await pagesOf(e.policyId);
    const text = pages.get(e.passage.onPage);
    const sp = text ? supportSpan(e, text, about) : null;
    if (sp) { e.support = sp; const cx = contextFor(sp, pages); e.context = cx.length ? cx : null; }
  };
  const refine = async (refs: EvidenceRef[], about?: string | null) => { for (const r of refs) if (r && !r.support) refineEvidence(r, await pagesOf(r.policyId), about ?? null); };

  /** Round 7 (A3): passages shown to the model in full this turn (a repeat is referred to, not resent). */
  const shownThisTurn = new Set<string>();
  /** Round 7 (A3): failed runs of each tool this turn; a tool that failed twice is not run again. */
  const failures = new Map<string, number>();
  const noteFailure = (name: string) => failures.set(name, (failures.get(name) ?? 0) + 1);
  let budgetWarned = false;
  /** Round 7 (A3): tool calls already made this turn (name + arguments): an identical repeat is not run again. */
  const madeCalls = new Set<string>();
  /** What the composer checks a sentence against (final_answer, and what ask_user says before its question). */
  const composeCtx = () => ({ state, tools: ctx, computeCalls, householdIds, userText: input.message, userTexts, names: input.people.map((p) => p.name), stale, policyNames, people: input.people.map((p) => ({ id: p.id, names: personNames(p.name) })) });
  /** Round 6 (A3): ask_user's statements were refused once this turn (a second attempt shows what can be kept). */
  let askRefused = false;
  /** The evidence the asked question cites (why it matters). */
  let askBecause: string[] = [];
  /** The mention the latest resolve_person call of this turn was asked about. */
  let lastMention: string | null = null;
  /** Round 7: facts the household's message gave, recorded this turn (their words, who about). */
  const recordedNow: { key: string; words: string; subject: string }[] = [];
  if (inline) { const subject = inline.pending.subjectId ?? state.claim?.subjectId ?? state.subjectId; if (subject) recordedNow.push({ key: inline.pending.factKey, words: inline.answer, subject }); }
  /** Round 7: the one bounded repair of a final_answer that left the household's answer with nothing citable. */
  let finalRepaired = false;
  /** Round 7: the household answered the claim question pending from the last turn (facts recorded for its subject). */
  const answeredRequest = (): { pending: Extract<LoopPending, { kind: "fact" }>; facts: { key: string; words: string }[]; subject: string } | null => {
    if (pendingBefore?.kind !== "fact") return null;
    const subject = pendingBefore.subjectId ?? state.claim?.subjectId ?? state.subjectId;
    const facts = recordedNow.filter((r) => !subject || r.subject === subject);
    return subject && facts.length ? { pending: pendingBefore, facts, subject } : null;
  };
  /** Round 7: the benefit statements this conversation already made about what the pending question was for (sharing
   * its evidence, else made when it was asked), still citable now. */
  const establishedFor = (pending: Extract<LoopPending, { kind: "fact" }>, subject: string): EstablishedStatement[] => {
    const usable = (state.established ?? []).filter((e) => (e.subjectId ?? subject) === subject && e.evidenceIds.every((id) => state.evidence[id] && !stale.has(id)) && e.valueIds.every((id) => ctx.values.has(id)));
    const because = new Set(pending.evidenceIds ?? []);
    const related = usable.filter((e) => e.evidenceIds.some((id) => because.has(id)));
    return (related.length ? related : usable.filter((e) => e.turn === pending.turn)).slice(-2);
  };
  const cited = (c: Composed) => c.sentences.some((s) => s.evidenceIds.length > 0);
  /** Round 7: the turn a requested fact was given in moves the claim forward: their words said back as theirs, the
   * benefit explained again (cited, bound), what still remains (the insurer's review of the documents) and a next step. */
  const forward = (composed: Composed, sentencesIn: Record<string, unknown>[], nextSteps: unknown, subjectId: string | null): { composed: Composed; repair: string | null } => {
    const ans = answeredRequest();
    if (!ans) return { composed, repair: null };
    const est = establishedFor(ans.pending, ans.subject);
    const echoes = ans.facts.map((f) => sayBack(f.words)).filter((x): x is string => !!x).map((text) => ({ text }));
    const attributed = (c: Composed) => c.sentences.some((s) => /\byou(?:['’]ve| have)? (?:said|told (?:me|us)|mentioned|let me know)\b/i.test(s.text));
    let out = composed;
    if (!cited(out) && est.length) {
      if (!finalRepaired) {
        finalRepaired = true;
        const why = composed.dropped.length ? ` (not shown: ${composed.dropped.map((d) => `"${d.sentence.slice(0, 80)}" -- ${d.reason}`).join("; ")})` : "";
        return { composed, repair: `the household answered your question ("${ans.pending.question}")${why}. Do not only say back what they told you. Answer with final_answer: (1) what they told you, as "You told me ..." -- their report, never reviewed medical evidence, an approval or a payment; (2) the benefit explained again with its citation, as established earlier in this conversation: ${est.map((e) => `"${e.text}" evidence_ids=[${e.evidenceIds.join(", ")}] value_ids=[${e.valueIds.join(", ")}]${e.benefit ? ` benefit="${e.benefit}"` : ""}`).join("; ")}; (3) what still remains (the insurer checks the documents it asks for and decides the claim); (4) the next step.` };
      }
      // The model repeated it: the answer is composed from what the conversation already established (and checked by
      // the same composer and save-time gate as any sentence the model writes).
      const fallback = composeFinal({ sentences: [...echoes, ...est.map((e) => ({ text: e.text, evidence_ids: e.evidenceIds, value_ids: e.valueIds, ...(e.benefit ? { benefit: e.benefit } : {}), ...(e.subjectId ? { subject_id: e.subjectId } : {}) }))], nextSteps, subjectId: subjectId ?? ans.subject }, composeCtx());
      if (cited(fallback)) out = fallback;
    } else if (cited(out) && !attributed(out) && echoes.length) {
      const again = composeFinal({ sentences: [...echoes, ...sentencesIn], nextSteps, subjectId }, composeCtx());
      if (cited(again)) out = again;
    }
    if (cited(out)) {
      const f = reportedFactFollowUp([...out.sentences.flatMap((s) => s.evidenceIds), ...(ans.pending.evidenceIds ?? [])].map((id) => state.evidence[id]?.passage.text ?? "").concat(ans.pending.why));
      if (![...out.sentences.map((s) => s.text), ...out.notes].some((t) => /\binsurer\b/i.test(t))) out.notes = [...out.notes, f.note];
      if (!out.nextSteps.length) out.nextSteps = [f.step];
    }
    return { composed: out, repair: null };
  };
  /** Composer drop reasons that are about wording only (the figure itself was not refused). */
  const FORM_DROP = /^shows an internal id|^calls (?:a calculated benefit|an amount) a payout/;
  const UNPRINTED_DROP = /is printed in none of the evidence the sentence cites$/;
  /** Round 9: a final answer that leaves the household at a dead end -- it says the answer depends on something not known
   * yet, or the calculation it ran still needs a household fact -- without asking for it. Deterministic (no extra model
   * call); folded into the turn's ONE bounded repair, so the model may restate it as ask_user with the same statements. */
  const DEPENDS = /\b(?:depends? on|depending on|need(?:s|ed)? to know|would need|will need|still need|can(?:no|'|’)t (?:say|tell|confirm|work (?:it|this|that) out) (?:yet|until|without)|once (?:you|i) (?:know|have)|if you can tell me|not (?:yet )?known)\b/i;
  const stillMissing = (subject: string | null | undefined) => {
    if (!subject) return [];
    const claim = state.claim?.subjectId === subject ? state.claim : state.otherClaims?.[subject];
    return (calcMissing.get(subject) ?? []).filter((m) => !(claim && knownFactFor(m.key, claim.facts)));
  };
  const usefulnessLines = (c: Composed): string[] => {
    const subject = c.subjectId ?? state.subjectId;
    const need = stillMissing(subject);
    if (need.length) return [`calculate still needs ${need[0].key} from the household (${need[0].why}), and the answer does not ask for it: end the turn with ask_user kind=fact for exactly that (fact_key ${need[0].key}${need[0].evidenceIds.length ? `, citing ${[...new Set(need[0].evidenceIds)].slice(0, 3).join(", ")}` : ""}), giving what is already established as statements.`];
    const open = [...c.sentences.map((s) => s.text), ...c.dropped.map((d) => d.sentence)].find((t) => DEPENDS.test(t));
    if (open) return [`"${open}" -- the answer says it depends on something not known yet, but asks nothing. If the household can tell you, end the turn with ask_user kind=fact: the supported sentences as statements, then that ONE question, citing the clause that makes it matter. If only the insurer can confirm it, say so plainly in a sentence that cites that clause.`];
    return [];
  };
  /** After the one repair (or when the model did not answer it): a final answer whose calculation still needs a
   * household fact ends with that ONE question, worded from the calculation's own requirement -- the answer itself
   * (and its claim record) unchanged. */
  const followUpFor = (c: Composed): Extract<LoopPending, { kind: "fact" }> | null => {
    const subject = c.subjectId ?? state.subjectId ?? null;
    const need = stillMissing(subject)[0];
    if (!need) return null;
    const why = need.why.replace(/[.\s]+$/, "");
    const label = input.people.find((p) => p.id === subject)?.name ?? "";
    const who = /\(([^)]+)\)\s*$/.exec(label)?.[1] ?? label.split(/\s+/)[0] ?? "they";
    // The calculator's own input keys have a plain question; any other requirement is asked in its own words.
    const KEYED: Record<string, string> = { admission_datetime: `When was ${who} admitted to hospital (date and time)?`, discharge_datetime: `When was ${who} discharged from hospital (date and time)?`, bill_amount: "How much was the bill, and in which currency?" };
    // When the answer already states the requirement ("I still need ... admission and discharge dates and times"), the
    // question points back to it instead of repeating it.
    const concept = factConcept(need.key).concept;
    const stated = c.sentences.some((s) => s.kind === "requirement" && (s.asks ?? []).includes(concept));
    const back = concept === "admission" || concept === "discharge" ? "Can you tell me those dates and times?" : concept === "bill" ? "Can you tell me the bill amount and its currency?" : "Can you tell me that?";
    return { kind: "fact", question: stated ? back : KEYED[need.key] ?? `To work this out I still need ${why.charAt(0).toLowerCase() + why.slice(1)}. Can you tell me?`, factKey: need.key, subjectId: subject, why, evidenceIds: need.evidenceIds.filter((id) => state.evidence[id]), turn: state.turn };
  };
  let followUp = false;
  /** Round 8 (F1): the one bounded repair of a final_answer the save-time gate would reject a figure sentence of. */
  let gateRepaired = false;
  /** The answer as first composed: kept if the model does not answer the repair (error, limit) -- the hook's gate then
   * leaves out what it rejects, as it would have without the repair. */
  let beforeRepair: LoopReply | null = null;
  /** Sentences the gate rejected this turn (never remembered as established statements). */
  const gateRejected = new Set<string>();
  /** Round 8 (F1): the composed answer is run through the save-time gate (report mode) before the turn ends. A rejected
   * figure sentence is sent back ONCE with the gate's actual reason and the evidence the sentence cites, so the model can
   * restate it as its evidence prints it; the second answer is final (hook.ts drops what the gate still rejects and
   * names the benefit and document). Never a rewrite by us: nothing is added to what the model wrote. */
  const gateRepair = async (c: Composed): Promise<string | null> => {
    // The same paragraphs the hook shows (a removal limitation kept with the figure it qualifies).
    const texts = keepLimitationWithFigure([...c.sentences.map((s) => s.text), ...(c.notes ?? [])]);
    const dateDrops = c.dropped.some((d) => d.reason.startsWith(DATE_ABSENCE_REASON));
    // Round 8b: a figure sentence the composer left out only for its WORDING (an id shown in it, a calculated amount
    // called a payout) is part of the same one repair -- the model restates it; nothing is rewritten by us.
    const formDrops = c.dropped.filter((d) => FORM_DROP.test(d.reason) && /\d/.test(d.sentence));
    // Round 8d: a figure sentence left out because a figure is printed in none of its cited evidence (e.g. a difference
    // the model worked out itself) is part of the same one repair -- printed figures only, or a compute result.
    const unprinted = c.dropped.filter((d) => UNPRINTED_DROP.test(d.reason) && /\d/.test(d.sentence));
    const useful = usefulnessLines(c);
    if (!dateDrops && !formDrops.length && !unprinted.length && !texts.length && !useful.length) return null;
    const draft = { mode: "answer", summary: texts[0] ?? "", details: texts.slice(1), claimItems: [], nextSteps: c.nextSteps, confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], figureBindings: c.figureBindings, computations: c.computations, ...(c.calculations.length ? { calculations: c.calculations } : {}) } as unknown as ChatAnswer;
    let problems: Awaited<ReturnType<typeof verifyAnswerFigures>> = [];
    if (texts.length) try { problems = await verifyAnswerFigures(draft, { accountId: input.accountId, userText: input.message, report: true }); } catch { return null; }
    const squash = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
    const lines = problems.flatMap((p) => {
      const b = squash(p.sentence);
      const own = c.sentences.find((s) => { const a = squash(s.text); return !!b && (a.includes(b) || b.includes(a)); });
      if (!own) return [];
      gateRejected.add(own.text);
      const ids = [...own.evidenceIds, ...(own.valueIds ?? []).map((v) => "value " + v)];
      return [`"${own.text}" -- ${p.figure ? p.figure + ": " : ""}${p.reason}${ids.length ? ` (it cites ${ids.join(", ")})` : ""}`];
    });
    for (const d of c.dropped) if (d.reason.startsWith(DATE_ABSENCE_REASON)) lines.push(`"${d.sentence}" -- ${d.reason}`);
    for (const d of unprinted) lines.push(`"${d.sentence}" -- left out: ${d.reason}; state only figures the cited evidence prints (a difference or total only as a cited compute result, else leave it out)`);
    for (const d of formDrops) lines.push(`"${d.sentence}" -- left out: ${d.reason}; restate it without ids in the text (put them in evidence_ids / value_ids / result_id) and without calling an amount paid, owed or a payout`);
    if (!lines.length) return useful.length ? `${useful.join(" ")} Keep every supported sentence as it was and add no claim the evidence does not print.` : null;
    return `${useful.length ? useful.join(" ") + " Also: " : ""}the save-time check would not show ${lines.length > 1 ? "these sentences" : "this sentence"}: ${[...new Set(lines)].join("; ")}. Call final_answer again with the same sentences, rewriting only ${lines.length > 1 ? "these" : "this one"} so that what the check says is missing or wrong is fixed: if it names a limitation that is not stated, keep the figure and state exactly that limitation in the same sentence (never a limitation the check did not name); state each figure exactly as its cited evidence prints it, and an earlier value only as the earlier value (e.g. "previously X, and Y from <date>"); or leave the sentence out. Keep every other sentence as it was and add no claim the evidence does not print.`;
  };
  /** Round 8 (F1): after the one repair, a sentence still left out for claiming a printed date is absent is named
   * precisely -- the benefit and the document -- instead of the generic note. */
  const limitDateDrops = (c: Composed, call: ToolCall) => {
    const given = ((call.arguments.sentences as Record<string, unknown>[]) ?? []);
    const lines = c.dropped.filter((d) => d.reason.startsWith(DATE_ABSENCE_REASON)).map((d) => {
      const src = given.find((g) => String(g?.text ?? "").replace(/\s+/g, " ").trim() === d.sentence.replace(/\s+/g, " ").trim());
      const ids = ((src?.evidence_ids as string[]) ?? []).filter((id) => state.evidence[id]);
      const docs = [...new Set(ids.map((id) => { const e = state.evidence[id]; return policyNames.get(e.policyId) ?? state.docNames?.[e.policyId] ?? null; }).filter((x): x is string => !!x))];
      const date = /prints “([^”]+)”/.exec(d.reason)?.[1];
      const what = typeof src?.benefit === "string" && src.benefit.trim() ? `“${src.benefit.trim()}”` : "this benefit";
      return `I’ve left out what I had on ${what}${docs.length ? ` in ${docs.join(" and ")}` : ""}, because I couldn’t state it consistently with that document${date ? `, which prints the date “${date}”` : ""}.`;
    });
    if (!lines.length) return;
    c.notes = [...c.notes.filter((n) => n !== DROPPED_NOTE), ...lines.filter((l) => !c.notes.includes(l))];
  };
  /** Loop actions (note_facts / ask_user / final_answer): checked against the conversation rules. */
  const action = (call: ToolCall): { result: Record<string, unknown>; terminal?: LoopReply } => {
    const a = { ...call.arguments };
    if (call.name === NOTE_FACTS.name && Array.isArray(a.facts)) a.facts = (a.facts as Record<string, unknown>[]).map((f) => ({ ...f, value: f?.value == null ? f?.value : String(f.value) }));
    const spec = [NOTE_FACTS, ASK_USER, FINAL_ANSWER].find((s) => s.name === call.name)!;
    const bad = validateArgs(spec.parameters, a);
    if (bad) return { result: { ok: false, error: bad } };
    if (call.name === "note_facts") {
      const subject = (a.subject_id as string) ?? state.claim?.subjectId ?? state.subjectId;
      if (!subject || !householdIds.has(subject)) return { result: { ok: false, error: "subject_id must be a household member (resolve the person first)" } };
      if (unsettled.has(subject)) return { result: { ok: false, error: "who is meant is not settled yet: ask which person the household means before recording facts about one of them" } };
      const claim = claimFor(subject);
      const recorded: string[] = [], refused: { key: string; error: string }[] = [], unconfirmed: string[] = [], corrected: { key: string; from: unknown; to: unknown; withdrawn: string[] }[] = [], asSaid: string[] = [];
      for (const f of a.facts as { key: string; value: string; words?: string; currency?: string; evidence_ids?: string[] }[]) {
        const key = normalizeKey(f.key);
        if (!key || f.value == null) continue;
        const docIds = (f.evidence_ids ?? []).filter((id) => state.evidence[id] && !stale.has(id));
        if ((f.evidence_ids ?? []).length && !docIds.length) { refused.push({ key, error: "cites evidence no tool returned" }); continue; }
        const docText = docIds.length ? docIds.map((id) => state.evidence[id].passage.text).join("\n") : null;
        const chk = checkFact({ key, value: String(f.value), words: String(f.words ?? "") }, userTexts, docText);
        if (!chk.ok) {
          // Agent F (D13): a classification the household did not state (cause=accident) is refused -- but when their
          // quoted words say HOW it happened ("he fell off the monkey bars"), those words are what they told us:
          // recorded verbatim as how_it_happened (never as the classification), unless that is already recorded.
          const words = String(f.words ?? "").trim();
          if (!docText && CAUSE_KEYS.has(key) && key !== "how_it_happened" && !claim.facts.how_it_happened && !(a.facts as { key: string }[]).some((x) => normalizeKey(x.key) === "how_it_happened") && MECHANISM.test(words) && quotedFrom(words, userTexts)) {
            claim.facts.how_it_happened = { value: words, words, turn: state.turn, source: "user_reported", basis: "stated" };
            asSaid.push("how_it_happened");
            const answers = (p: LoopPending | null | undefined) => p?.kind === "fact" && (p.subjectId ?? subject) === subject && CAUSE_KEYS.has(normalizeKey(p.factKey));
            if (answers(state.pending)) state.pending = null;
            if (answers(state.parkedPending)) state.parkedPending = null;
            refused.push({ key, error: chk.error + ` (their words "${words}" were recorded as how_it_happened)` });
          } else refused.push({ key, error: chk.error });
          continue;
        }
        const value = f.currency ? `${String(f.value)} ${f.currency.toUpperCase()}` : String(f.value);
        const words = docText != null ? (f.words?.trim() || state.evidence[docIds[0]].passage.text.slice(0, 160)) : String(f.words);
        const entry = { value, words, turn: state.turn, source: chk.source, basis: chk.basis, ...(docIds.length ? { evidenceIds: docIds } : {}) };
        // Agent G: the same fact recorded earlier under another key (admission_date / admitted_at, bill / bill_amount,
        // claim_amount / amount_claimed) with another value is a correction of it, not a second fact.
        const oldKey = claim.facts[key] ? key : sameFactKey(claim, key, value);
        const old = oldKey ? claim.facts[oldKey] : undefined;
        if (old && String(old.value) !== value) {
          const hit = (ks: string[]) => ks.includes(key) || (!!oldKey && ks.includes(oldKey));
          const withdrawn = claim.derived.filter((d) => hit(d.factKeys)).map((d) => d.sentence);
          claim.derived = claim.derived.filter((d) => !hit(d.factKeys));
          // Every calculation worked out from the old value is withdrawn (and marked so on the claim record).
          for (const r of Object.values(claim.calcs ?? {})) if (!r.withdrawn && hit(r.factKeys)) r.withdrawn = { cause: "fact", key, reason: `${key.replace(/_/g, " ")} was corrected (from ${String(old.value)} to ${value})`, turn: state.turn };
          if (oldKey && oldKey !== key) delete claim.facts[oldKey];
          claim.facts[key] = { ...entry, previous: [...(old.previous ?? []), { value: old.value, words: old.words, turn: old.turn, source: old.source, basis: old.basis }] };
          corrected.push({ key, from: old.value, to: value, withdrawn });
          if (withdrawn.length) scrubWithdrawn(withdrawn);
        } else if (!old || (old.basis === "paraphrased" && chk.basis === "stated")) claim.facts[key] = old ? { ...entry, previous: old.previous } : entry;
        recorded.push(key);
        recordedNow.push({ key, words: entry.words, subject });
        if (chk.basis === "paraphrased") unconfirmed.push(key);
        // The pending question is answered by this fact (under its own key, or another key for the same fact).
        const answers = (p: LoopPending | null | undefined) => p?.kind === "fact" && (p.subjectId ?? subject) === subject && (p.factKey === key || !!knownFactFor(p.factKey, { [key]: claim.facts[key] }));
        if (answers(state.pending)) state.pending = null;
        if (answers(state.parkedPending)) state.parkedPending = null;
      }
      corrections.push(...corrected);
      if (!recorded.length && refused.length) return { result: { ok: false, error: refused.map((r) => `${r.key}: ${r.error}`).join("; "), refused } };
      return { result: { ok: true, recorded, ...(unconfirmed.length ? { unconfirmed, note: "unconfirmed facts are the household's report in your words, not confirmed values: they cannot be used in a calculation; ask to confirm if one matters" } : {}), ...(refused.length ? { refused } : {}), ...(asSaid.length ? { recorded_as_said: asSaid } : {}), corrected, facts: claim.facts } };
    }
    if (call.name === "ask_user") {
      const question = String(a.question ?? "").trim();
      if ((question.match(/\?/g) ?? []).length !== 1 || !question.endsWith("?")) return { result: { ok: false, error: "ask exactly one question, ending with a question mark" } };
      const compound = compoundQuestion(question);
      if (compound) return { result: { ok: false, error: compound } };
      if (moneyFiguresIn(question).length) return { result: { ok: false, error: "a question never states a figure" } };
      if (internalIdsIn(question).length) return { result: { ok: false, error: "a question never shows an internal id or tool name" } };
      const preface = typeof a.preface === "string" && a.preface.trim() ? a.preface.trim() : null;
      // Round 6 (A3): what is said before the question (preface, statements) is verified, not banned -- composed by the
      // same composer as final_answer (and so, when saved, checked by the same gate). Anything it would not show is
      // refused once with the composer's reason, so the model can cite it, say it conditionally, or leave it out.
      const spoken = [...(preface ? [{ text: preface }] : []), ...(Array.isArray(a.statements) ? (a.statements as Record<string, unknown>[]) : [])];
      if (spoken.some((x) => /\?/.test(String(x?.text ?? "")))) return { result: { ok: false, error: "statements and the preface state; they never ask. Ask exactly one question, in question" } };
      if (spoken.length && a.kind === "person" && Array.isArray(a.statements) && a.statements.length) return { result: { ok: false, error: "a person question is asked on its own (no statements)" } };
      let composed: Composed | null = null;
      if (spoken.length) {
        composed = composeFinal({ sentences: spoken, subjectId: (a.subject_id as string) ?? null }, composeCtx());
        if (composed.dropped.length && !askRefused) {
          askRefused = true;
          return { result: { ok: false, error: "not shown before the question: " + composed.dropped.map((d) => `"${d.sentence.slice(0, 80)}" (${d.reason})`).join("; ") + ". State only what the cited evidence prints (a benefit with its conditions, cited with evidence_ids / value_ids), or leave it out." } };
        }
        if (!composed.sentences.length) composed = null;
      }
      if (a.kind === "person") {
        // Round 6c (A3): ask who only when the answer depends on the person. A mention that means anyone in the
        // household ("one of us", "anyone", "we") is answered for the policy and the people it covers; and once
        // the policy's relevant passages / rows have been read this turn and none of them varies by person (no
        // person, tier or plan column; no per-person cover lookup), the answer is the same whoever it is.
        const mention = String(a.mention ?? lastMention ?? "").trim();
        if (ANYONE.test(mention)) return { result: { ok: false, error: `"${mention}" means whoever it happens to: answer for the policy and the people it covers (each covered person's own column where the rows differ by person); do not ask who` } };
        const turnEv = trace.toolCalls.filter((t) => t.ok && LOOKUPS.has(t.name)).flatMap((t) => t.evidenceIds);
        const perPerson = trace.toolCalls.some((t) => t.ok && t.name === "policies_for") || turnEv.some((id) => PER_PERSON.has(state.evidence[id]?.table?.appliesTo?.kind ?? ""));
        if (!(lastAmbiguous?.self) && turnEv.length && !perPerson) return { result: { ok: false, error: "the passages and rows read for this question do not vary by person (no person, tier or plan column): answer it for the policy and the people it covers; do not ask who" } };
        const options = ((a.options as string[]) ?? []).filter((id) => householdIds.has(id));
        if (options.length < 2) return { result: { ok: false, error: "a person question offers two or more household members (the candidates resolve_person returned)" } };
        if (pendingBefore?.kind === "person" && pendingBefore.turn === state.turn - 1) return { result: { ok: false, error: "you already asked who is meant; resolve the person from the household's reply" } };
        const purpose = lastAmbiguous?.self && options.every((id) => lastAmbiguous!.labels.has(id)) ? "speaker" as const : "subject" as const;
        const label = (id: string) => { const p = input.people.find((x) => x.id === id)!; const rel = candidateLabels.get(id); return rel && purpose === "subject" ? `${p.name} (your ${rel})` : p.name; };
        const pending: LoopPending = { kind: "person", question, mention: typeof a.mention === "string" ? a.mention : null, options: options.map((id) => ({ id, label: label(id) })), turn: state.turn, purpose };
        return { result: { ok: true }, terminal: { kind: "ask", pending, preface: null, composed } };
      }
      const key = normalizeKey(a.fact_key);
      if (!key) return { result: { ok: false, error: "a fact question needs the fact_key its answer is recorded under" } };
      const subject = (a.subject_id as string) ?? state.claim?.subjectId ?? state.subjectId;
      const claim = subject ? (state.claim?.subjectId === subject ? state.claim : state.otherClaims?.[subject]) : null;
      // Agent F (D15): the same fact under another key (admitted_at / admission_time, how_it_happened / cause) is known.
      const known = claim ? knownFactFor(key, claim.facts) : null;
      if (known) return { result: { ok: false, error: `${key} is already recorded${known.key !== key ? ` (as ${known.key})` : ""} (${String(known.fact.value)}, "${known.fact.words}"); do not ask again` } };
      // Integration (round 3): a fact the household's current message already gives is recorded, never asked for.
      // A question for the TIME is not answered by a date alone ("admitted on Saturday" -> "what time on Saturday?").
      const wantsTime = /time/i.test(key) || /\bwhat time\b/i.test(question);
      const said = statedInMessage(key, input.message);
      if (said && (!wantsTime || CLOCK_TIME.test(said))) return { result: { ok: false, error: `the household's message already gives ${key} ("${said}"): record it with note_facts instead of asking` } };
      // The calculation's own missing inputs drive the next question: ask exactly those, one at a time, in order.
      const stillNeeded = (subject ? calcMissing.get(subject) ?? [] : []).filter((m) => !(claim && knownFactFor(m.key, claim.facts)));
      const sameFact = (a: string, b: string) => a === b || (!factConcept(a).concept.startsWith("key:") && factConcept(a).concept === factConcept(b).concept);
      const calcItem = stillNeeded.find((m) => sameFact(m.key, key)) ?? null;
      let because = ((a.because_evidence_ids as string[]) ?? []).filter((id) => state.evidence[id] && !stale.has(id));
      if (!because.length && calcItem) because = calcItem.evidenceIds.filter((id) => state.evidence[id]);
      if (!because.length) return { result: { ok: false, error: "cite the evidence (because_evidence_ids) of the benefit or clause that makes this fact matter" } };
      const cause = !CAUSE_KEYS.has(key) ? causeOpen(subject) : null;
      if (cause) return { result: { ok: false, error: `how it happened is not known, and the documents' wording depends on the cause (accident or otherwise): ask how it happened first (fact_key how_it_happened, citing ${cause.slice(0, 3).join(", ")})` } };
      if (stillNeeded.length && !CAUSE_KEYS.has(key) && !sameFact(stillNeeded[0].key, key)) return { result: { ok: false, error: `the calculation still needs ${stillNeeded[0].key} (${stillNeeded[0].why}): ask for exactly that next, one question at a time (fact_key ${stillNeeded[0].key}, citing ${stillNeeded[0].evidenceIds.slice(0, 3).join(", ") || "the calculation's evidence"})` } };
      // Agent F (D15): the cited "why" must be about the fact asked, not any passage that happens to be in the state.
      if (!calcItem && !relevantEvidence(question, key, because.map((id) => [state.evidence[id].table?.rowLabel ?? "", state.evidence[id].label ?? "", state.evidence[id].passage.text].join("\n")), input.people.map((p) => p.name))) return { result: { ok: false, error: `the cited evidence (${because.join(", ")}) does not make ${key} matter: cite the benefit or clause whose wording depends on it, or do not ask` } };
      const why = because.map((id) => `${whyLine(state.evidence[id], question + " " + key + (CAUSE_KEYS.has(key) ? " accident accidental" : ""))} (page ${state.evidence[id].passage.onPage})`).join("; ");
      trace.evidenceChosen.push(...because.filter((id) => !trace.evidenceChosen.includes(id)));
      askBecause = because;
      const pending: LoopPending = { kind: "fact", question, factKey: key, subjectId: subject ?? null, why, evidenceIds: because, ...(Array.isArray(a.options) && a.options.length ? { options: (a.options as string[]).map(String) } : {}), turn: state.turn };
      return { result: { ok: true }, terminal: { kind: "ask", pending, preface: null, composed } };
    }
    // final_answer
    const answerSubject = (a.subject_id as string) ?? state.subjectId;
    const estimates = ((a.sentences as Record<string, unknown>[]) ?? []).some((x) => typeof x.result_id === "string" && (ctx.results.get(x.result_id)?.kind === "indicative_estimate" || calcOutcomes(ctx).get(x.result_id)?.kind === "indicative_estimate"));
    const cause = estimates ? causeOpen(answerSubject) : null;
    if (cause) return { result: { ok: false, error: `an estimate for this event depends on how it happened (the documents distinguish accidents), which is not known: ask how it happened first (fact_key how_it_happened, citing ${cause.slice(0, 3).join(", ")})` } };
    // Agent G: a sentence citing a deleted / superseded passage AND (or only) a live document printing the same passage
    // rests on the live one; a sentence with no live equivalent is left to the composer, which refuses it.
    const sentencesIn = ((a.sentences as Record<string, unknown>[]) ?? []).map((x) => {
      const ids = Array.isArray(x?.evidence_ids) ? (x.evidence_ids as string[]) : null;
      if (!ids || !ids.some((id) => stale.has(id))) return x;
      const mapped = ids.map((id) => (stale.has(id) ? liveEquivalent(state, stale, id) ?? id : id));
      return { ...x, evidence_ids: [...new Set(mapped)] };
    });
    const first = composeFinal({ sentences: sentencesIn, nextSteps: a.next_steps, subjectId: (a.subject_id as string) ?? null }, composeCtx());
    if (!first.sentences.length && !first.dropped.length) return { result: { ok: false, error: "final_answer needs at least one sentence" } };
    const fw = forward(first, sentencesIn, a.next_steps, (a.subject_id as string) ?? null);
    if (fw.repair) return { result: { ok: false, error: fw.repair } };
    const composed = fw.composed;
    return { result: { ok: true }, terminal: { kind: "final", composed } };
  };

  /** A tool call refused by the loop before it runs (null: run it). */
  const preflight = (call: ToolCall): string | null => {
    const sig = call.name + " " + JSON.stringify(call.arguments);
    if (madeCalls.has(sig) && !LOOP_ACTIONS.some((x) => x.name === call.name)) { noteFailure(call.name); return `not run again: the same ${call.name} call was already made for this question (its result is above). Use that result, or end the turn with final_answer and say what is still missing.`; }
    madeCalls.add(sig);
    if ((failures.get(call.name) ?? 0) >= 2) return `not run again: ${call.name} has already failed twice for this question. End the turn now with final_answer -- the printed figures you already have, cited -- and say what is still missing (or ask_user for the one missing fact).`;
    const subject = typeof call.arguments.subject_id === "string" ? call.arguments.subject_id : null;
    if (SUBJECT_TOOLS.has(call.name) && subject && unsettled.has(subject)) return "who is meant is not settled yet: ask the household which person they mean (ask_user kind=person with the candidates) before looking up anyone's cover";
    if (call.name === "compute") {
      const facts = { ...(state.otherClaims ? Object.assign({}, ...Object.values(state.otherClaims).map((c) => c.facts)) : {}), ...(state.claim?.facts ?? {}) };
      for (const o of (call.arguments.operands as Record<string, unknown>[] | undefined) ?? []) {
        if (o && typeof o === "object" && o.household && typeof o.household === "object") { const p = householdOperandProblem(o.household as Record<string, unknown>, facts); if (p) return p; }
      }
    }
    return null;
  };

  /** Round 7 (A3): the partial answer of a turn stopped by its budget (null when nothing printed was read). */
  const partialAnswer = (): Composed | null => {
    const read = [...ctx.values.entries()].filter(([, v]) => v.operand.valueKind === "money" && v.operand.cents != null && !stale.has(evidenceIdOf(state, v.operand.evidence)));
    const seenRows = new Set<string>();
    const sentences: Record<string, unknown>[] = [];
    for (const [valueId, v] of read.reverse()) {
      const e = v.operand.evidence, t = e.table;
      const rowKey = `${e.policyId}|${t?.rowLabel ?? v.operand.benefit}|${t?.columnHeader ?? ""}`;
      if (seenRows.has(rowKey) || sentences.length >= 3) continue;
      seenRows.add(rowKey);
      const cell = (t?.cell?.text ?? "").replace(/\s+/g, " ").trim();
      if (!cell || !/\d/.test(cell)) continue;
      const label = rowLabelOf(v.operand.benefit, e.passage.text, cell);
      const product = policyNames.get(e.policyId) ?? state.docNames?.[e.policyId] ?? "Your policy";
      sentences.unshift({ text: `${product} prints “${label}” as ${cell}${t?.columnHeader ? ` in its ${t.columnHeader} column` : ""}.`, value_ids: [valueId], subject_id: v.subjectId });
    }
    if (!sentences.length) return null;
    const composed = composeFinal({ sentences, subjectId: state.subjectId }, composeCtx());
    if (!composed.sentences.length) return null;
    const unresolved = [...calcOutcomes(ctx).values()].reverse().find((c) => c.kind === "unresolved" && (c.requirements?.length || c.unresolvedText));
    const missing = unresolved?.requirements?.length ? `Still needed before an amount can be worked out: ${unresolved.requirements.join("; ")}.` : "I didn’t get as far as working out an amount for what you described, so I haven’t given one.";
    composed.notes = [...(composed.notes ?? []), `I stopped before finishing because this question reached its model-use limit. ${missing}`];
    return composed;
  };

  for (let step = 0; !reply; step++) {
    // Round 7 (A3): a turn running short of its budget, or whose tools keep failing, is told once to stop retrying
    // and answer with what is already supported (the notice rides on the latest tool result).
    const used = meter.usage.input + meter.usage.output;
    if (!budgetWarned && step > 0 && (used > limits.maxTokensPerTurn * 0.5 || [...failures.values()].some((n) => n >= 2))) {
      const last = [...messages].reverse().find((x) => x.role === "tool") as { content: string } | undefined;
      if (last) { budgetWarned = true; try { last.content = JSON.stringify({ ...JSON.parse(last.content), notice: BUDGET_NOTICE }); } catch { last.content += "\n" + BUDGET_NOTICE; } }
    }
    const m = await meter.next({ messages, tools, maxOutputTokens: limits.maxOutputTokens });
    if (!m.ok) { stop = m.stop; if (m.stop.kind === "model_error") record("model", {}, false, [], m.stop.detail); break; }
    const out = m.out;
    trace.steps++; trace.modelId = out.modelId || trace.modelId;
    messages.push({ role: "assistant", content: out.text, toolCalls: out.toolCalls });
    if (!out.toolCalls.length) { messages.push({ role: "user", content: "Use the tools. End the turn only with ask_user or final_answer." }); continue; }
    for (const call of out.toolCalls) {
      if (reply) { messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: "the turn already ended" }) }); continue; }
      if (LOOP_ACTIONS.some((s) => s.name === call.name)) {
        let r = action(call);
        if (r.terminal?.kind === "final" && !gateRepaired) {
          const repair = await gateRepair(r.terminal.composed);
          if (repair) { gateRepaired = true; beforeRepair = r.terminal; meter.grantRepairCall(); r = { result: { ok: false, error: repair } }; }
        } else if (r.terminal?.kind === "final" && gateRepaired) limitDateDrops(r.terminal.composed, call);
        record(call.name, call.arguments, r.result.ok !== false, [], r.result.ok === false ? String(r.result.error) : undefined);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(r.result) });
        if (r.terminal && TERMINAL.has(call.name)) reply = r.terminal;
        continue;
      }
      const refusal = preflight(call);
      if (refusal) { record(call.name, call.arguments, false, [], refusal); messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: refusal }) }); continue; }
      const res = await runTool(ctx, call.name, call.arguments, loopToolEnv(env));
      await refine(res.evidence, typeof call.arguments.query === "string" ? call.arguments.query : typeof call.arguments.benefit === "string" ? call.arguments.benefit : null);
      const ids: string[] = [];
      const shown = resultForModel(res as { ok: boolean; data?: unknown; error?: string; evidence: unknown }, state, call.name, ids, shownThisTurn);
      if (!res.ok) noteFailure(call.name);
      if (res.ok && call.name === "calculate" && typeof call.arguments.subject_id === "string") {
        const miss = ((shown as { data?: { missing?: { key: string; ask: string; why: string; evidence?: { evidence_id?: string }[] }[] } }).data?.missing ?? []).filter((m) => m.ask === "household");
        calcMissing.set(call.arguments.subject_id, miss.map((m) => ({ key: normalizeKey(m.key), why: m.why, evidenceIds: (m.evidence ?? []).map((e) => e.evidence_id ?? "").filter(Boolean) })));
      }
      if (res.ok && call.name === "compute") { const rid = (res.data as { resultId?: string }).resultId; if (rid) computeCalls.set(rid, { operation: String(call.arguments.operation), operands: (call.arguments.operands as Record<string, unknown>[]) ?? [] }); }
      if (call.name === "resolve_person") lastMention = String(call.arguments.mention ?? "");
      if (res.ok && call.name === "resolve_person") {
        const r = res.data as { status: string; person?: { id: string }; via?: string; options?: { id: string; relationLabel?: string }[] };
        const selfMention = SELF_MENTION.test(String(call.arguments.mention ?? "").trim());
        if (r.status === "ok" && r.person) {
          const id = r.person.id;
          if (pendingBefore?.kind === "person" && pendingBefore.purpose === "speaker" && pendingBefore.options.some((o) => o.id === id) && !state.speakerId) {
            // The household said who is typing: that is the speaker, not who the conversation is about.
            state.speakerId = id; ctx.conversation.speakerId = id;
          } else setSubject(id, r.via === "self");
          unsettled = new Set();
          if (state.pending?.kind === "person") state.pending = null;
        } else if (r.status === "ambiguous" && r.options?.length && ANYONE.test(String(call.arguments.mention ?? "").trim())) {
          // Anyone in the household: nobody needs to be settled before the policy is read.
          (res.data as Record<string, unknown>).note = "this mention means anyone in the household: answer for the policy and the people it covers; do not ask who";
        } else if (r.status === "ambiguous" && r.options?.length) {
          unsettled = new Set(r.options.map((o) => o.id));
          lastAmbiguous = { self: selfMention, labels: new Map(r.options.map((o) => [o.id, o.relationLabel ?? ""])) };
          for (const o of r.options) if (o.relationLabel) candidateLabels.set(o.id, o.relationLabel);
        }
      }
      const d = res.ok ? (res.data as Record<string, unknown>) : null;
      record(call.name, call.arguments, res.ok, ids, res.ok ? undefined : res.error, d ? brief({ status: d.status, valueId: d.valueId, resultId: d.resultId, value: d.value, amount: d.amount, kind: d.kind, column: d.columnHeader, row: d.rowLabel, hits: Array.isArray(d.hits) ? d.hits.length : undefined }) : undefined);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(shown) });
    }
  }
  trace.latencyMs = Date.now() - t0;
  trace.usage = { ...meter.usage };
  trace.calls = meter.calls;
  state.seq = ctx.seq;

  let reasked: LoopPending | null = null;
  const done = (reply ?? beforeRepair) as LoopReply | null;
  /** Round 7: each printed benefit this turn stated, cited and bound, kept with its ids (newest last). */
  const remember = (c: Composed) => {
    for (const s of c.sentences) {
      if (s.estimate || s.kind === "requirement" || !s.evidenceIds.length || gateRejected.has(s.text)) continue;
      const b = c.figureBindings.find((x) => !!x.sentence && (s.text.includes(x.sentence) || x.sentence.includes(s.text)));
      if (!b) continue;
      const subjectId = b.subjectId ?? c.subjectId ?? null;
      const entry: EstablishedStatement = { text: s.text, evidenceIds: [...s.evidenceIds], valueIds: (s.valueIds ?? []).filter((id) => ctx.values.has(id)), benefit: s.benefit ?? b.benefit ?? null, subjectId, turn: state.turn };
      state.established = [...(state.established ?? []).filter((e) => !(e.text === entry.text && e.subjectId === entry.subjectId)), entry].slice(-6);
    }
  };
  let final: LoopReply;
  if (!done) {
    const kind = stop?.kind ?? "turn_calls";
    // Round 7 (A3): a turn stopped by its own budget answers with what it had already established -- the printed
    // figures it read (bound and gated like any answer) and what is still missing -- never only the limit text.
    const partial = BUDGET_STOPS.has(kind) ? partialAnswer() : null;
    final = partial ? { kind: "final", composed: partial } : { kind: "fallback", text: LIMIT_TEXT[kind] };
    if (partial) { trace.dropped = partial.dropped; trace.evidenceChosen.push(...partial.evidenceIds.filter((id) => !trace.evidenceChosen.includes(id))); }
    trace.limit = { kind, detail: stop?.detail ?? "the turn ended without an answer" };
    trace.outcome = kind === "model_error" ? "error" : kind === "turn_calls" || kind === "turn_tokens_used" ? "budget_exhausted" : kind === "timeout" || kind === "turn_time" || kind === "cancelled" ? "timeout" : "limit_reached";
  }
  else if (done.kind === "ask") {
    final = done;
    const c = done.composed;
    if (c) {
      remember(c);
      trace.dropped = c.dropped;
      trace.evidenceChosen.push(...c.evidenceIds.filter((id) => !trace.evidenceChosen.includes(id)));
      for (const sent of c.sentences) for (const id of sent.evidenceIds) await narrow(id, sent.text);
      if (state.claim?.subjectId) for (const k of c.calcs) if (k.subjectId === state.claim.subjectId) (state.claim.calcs ??= {})[k.calcId] = calcRef(k, state.claim, (k.evidence ?? []).map((e) => evidenceIdOf(state, e, "calculate")), state.turn);
    }
    // A person question (who is meant / who is typing) asked while a claim question is open: the claim question is
    // set aside, not lost, and put back once the person is settled.
    if (done.pending.kind === "person" && state.pending?.kind === "fact") state.parkedPending = state.pending;
    if (done.pending.kind === "fact") state.parkedPending = null;
    state.pending = done.pending; trace.outcome = "ask_user";
  }
  else if (done.kind === "final") {
    final = done;
    const c = done.composed;
    remember(c);
    trace.outcome = "final_answer";
    trace.dropped = c.dropped;
    trace.evidenceChosen.push(...c.evidenceIds.filter((id) => !trace.evidenceChosen.includes(id)));
    // Precision: each cited passage narrowed to the sentence / row the answer's sentence rests on (internal; the page
    // stays the household-facing link).
    // A span found at search time (for the query) is replaced by the one for the sentence actually said.
    for (const sent of c.sentences) for (const id of sent.evidenceIds) await narrow(id, sent.text);
    if (c.subjectId) setSubject(c.subjectId, c.subjectId === state.speakerId);
    // Derived statements are remembered with the facts they used, so a correction can withdraw them.
    if (state.claim) for (const s of c.sentences) if (s.estimate && s.factKeys.length) state.claim.derived.push({ sentence: s.text, factKeys: s.factKeys, turn: state.turn, evidenceIds: s.evidenceIds });
    // Agent G: each calculation of the claim, with the facts and evidence it rests on (what a correction or a deleted
    // source withdraws, here and on the claim record).
    if (state.claim?.subjectId) for (const k of c.calcs) if (k.subjectId === state.claim.subjectId) (state.claim.calcs ??= {})[k.calcId] = calcRef(k, state.claim, (k.evidence ?? []).map((e) => evidenceIdOf(state, e, "calculate")), state.turn);
    // An interruption: the claim question still open is put back to the household after the side answer.
    if (state.pending?.kind === "person") state.pending = null;
    if (!state.pending && state.parkedPending) { state.pending = state.parkedPending; state.parkedPending = null; }
    // Round 9: no question open, and the calculation this answer ran still needs a household fact: the answer ends by
    // asking for it (one question), instead of leaving the household at "I still need ...".
    if (!state.pending) { const f = followUpFor(c); if (f) { state.pending = f; followUp = true; } }
    if (state.pending?.kind === "fact") { reasked = state.pending; trace.reasked = state.pending.question; }
  } else final = done;
  // The passage a question cites (why it matters): narrowed to the sentence that makes the fact matter -- for how an
  // event happened, the sentence about accidents; otherwise the one closest to the question.
  if (final.kind === "ask" && final.pending.kind === "fact") {
    const p = final.pending;
    for (const id of askBecause.length ? askBecause : trace.evidenceChosen) await narrow(id, CAUSE_KEYS.has(p.factKey) ? "accident accidental" : p.question + " " + p.factKey.replace(/_/g, " "));
  }
  if (corrections.length) trace.corrections = corrections.map(({ key, from, to }) => ({ key, from, to }));
  // Round 7: the table values issued so far stay citable on later turns (the most recent ones).
  if (ctx.values.size) state.values = Object.fromEntries([...ctx.values.entries()].slice(-24).map(([id, v]) => [id, { operand: v.operand, selected: v.selected, subjectId: v.subjectId }]));
  // Agent F (D6): remember the names of the documents this turn's evidence came from (readable now).
  for (const e of Object.values(state.evidence)) { const n = policyNames.get(e.policyId); if (n) (state.docNames ??= {})[e.policyId] = n; }
  // Agent G: a correction or a withdrawn source reaches the PERSISTED claim too (only a record this conversation already
  // has; never creates one).
  if (state.claimRecord && (corrections.length || invalidated.length)) await syncLoopClaimState({ accountId: input.accountId, state }).catch(() => null);
  return { state, reply: final, trace, tools: ctx, corrections, reasked, followUp, invalidated };
}

const squashText = (t: string) => t.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
/** Agent G: a live evidence entry printing the same passage (same row and column for a table) for the same person as
 * the stale entry `id` -- e.g. an enrolment copy of a deleted schedule. Null when none. */
export function liveEquivalent(state: RagLoopState, stale: Map<string, string>, id: string): string | null {
  const e = state.evidence[id];
  if (!e) return null;
  const text = (x: EvidenceEntry) => squashText(x.support?.text ?? x.passage.text);
  const want = text(e);
  if (want.length < 8) return null;
  for (const x of Object.values(state.evidence)) {
    if (x.id === id || stale.has(x.id) || x.policyId === e.policyId) continue;
    if ((x.subjectId ?? null) !== (e.subjectId ?? null) && x.subjectId && e.subjectId) continue;
    if (e.table && (!x.table || squashText(x.table.rowLabel) !== squashText(e.table.rowLabel) || squashText(x.table.columnHeader) !== squashText(e.table.columnHeader) || squashText(x.table.cell?.text ?? "") !== squashText(e.table.cell?.text ?? ""))) continue;
    if (text(x) === want || squashText(x.passage.text).includes(want)) return x.id;
  }
  return null;
}
/** Agent G: withdraws what deleted / superseded evidence alone supported, across the active and parked claims: a
 * document-sourced fact (re-pointed to a live equivalent, else removed and listed as invalidated), an earlier estimate
 * and a calculation citing it. Facts the household reported are never touched. */
export function invalidateStaleSupport(state: RagLoopState, stale: Map<string, string>): SourceInvalidation[] {
  const out: SourceInvalidation[] = [];
  if (!stale.size) return out;
  const keep = (ids: string[]) => { const mapped = ids.map((id) => (stale.has(id) ? liveEquivalent(state, stale, id) : id)); return mapped.every((x) => !!x) ? [...new Set(mapped as string[])] : null; };
  for (const claim of [state.claim, ...Object.values(state.otherClaims ?? {})]) {
    if (!claim) continue;
    const gone: string[] = [];
    for (const [key, f] of Object.entries(claim.facts)) {
      const ids = f.evidenceIds ?? [];
      if (!ids.length || !ids.some((id) => stale.has(id))) continue;
      const live = ids.filter((id) => !stale.has(id));
      const moved = ids.filter((id) => stale.has(id)).map((id) => liveEquivalent(state, stale, id)).filter((x): x is string => !!x);
      const now = [...new Set([...live, ...moved])];
      if (now.length) { f.evidenceIds = now; continue; }
      const reason = stale.get(ids.find((id) => stale.has(id))!)!;
      delete claim.facts[key];
      (claim.invalidated ??= []).push({ key, value: f.value, words: f.words, reason, turn: state.turn });
      out.push({ kind: "fact", subjectId: claim.subjectId, key, reason });
      gone.push(key);
    }
    claim.derived = claim.derived.filter((d) => {
      const ids = d.evidenceIds ?? [];
      const byFact = d.factKeys.some((k) => gone.includes(k));
      const kept = ids.some((id) => stale.has(id)) ? keep(ids) : ids;
      if (!byFact && kept) { d.evidenceIds = kept; return true; }
      out.push({ kind: "estimate", subjectId: claim.subjectId, sentence: d.sentence, reason: byFact ? "it was worked out from a fact only a deleted or replaced document supported" : stale.get(ids.find((id) => stale.has(id))!)! });
      return false;
    });
    for (const r of Object.values(claim.calcs ?? {})) {
      if (r.withdrawn) continue;
      const byFact = r.factKeys.some((k) => gone.includes(k));
      const kept = r.evidenceIds.some((id) => stale.has(id)) ? keep(r.evidenceIds) : r.evidenceIds;
      if (!byFact && kept) { r.evidenceIds = kept; continue; }
      const reason = byFact ? "it was worked out from a fact only a deleted or replaced document supported" : stale.get(r.evidenceIds.find((id) => stale.has(id))!)!;
      r.withdrawn = { cause: "source", reason, turn: state.turn };
      out.push({ kind: "calculation", subjectId: claim.subjectId, calcId: r.calcId, reason });
    }
  }
  return out;
}

/** Agent G: the key an earlier value of the same fact is recorded under (another key for the same admission / discharge
 * date-time, bill, or claimed amount) when the new value differs from it; null otherwise. */
function sameFactKey(claim: LoopClaim, key: string, value: string): string | null {
  const c = factConcept(key).concept;
  const claimed = CLAIMED_AMOUNT_KEY.test(key);
  for (const [k, f] of Object.entries(claim.facts)) {
    if (k === key) continue;
    if (c === "admission" || c === "discharge") {
      if (factConcept(k).concept !== c) continue;
      const a = isoParts(String(f.value)), b = isoParts(value);
      if (a && b && (a.hh == null) === (b.hh == null) && String(f.value) !== value) return k;
    } else if ((c === "bill" && factConcept(k).concept === "bill" && !CLAIMED_AMOUNT_KEY.test(k)) || (claimed && CLAIMED_AMOUNT_KEY.test(k))) {
      const a = numbersIn(String(f.value)), b = numbersIn(value);
      if (a.length && b.length && a[0] !== b[0]) return k;
    }
  }
  return null;
}

/** Agent F: the names a sentence may use for a member ("Ethan Tan Jun Kai (Ethan)" -> full name, "Ethan"). */
export function personNames(label: string): string[] {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(label);
  const full = (m ? m[1] : label).trim(), pref = m ? m[2].trim() : null;
  const first = full.split(/\s+/)[0] ?? full;
  return [...new Set([full, ...(pref ? [pref] : []), first].filter((n) => n && n.length >= 2))];
}

/**
 * Agent F (D6): which remembered evidence ids can no longer be used, and why (household-facing, figure-free): the
 * document was deleted, replaced by a newer version (or its file changed since it was read), or is not one of this
 * household's readable documents. Also returns the readable documents' product names (for statement checks).
 */
export async function revalidateEvidence(accountId: string, state: RagLoopState): Promise<{ stale: Map<string, string>; policyNames: Map<string, string> }> {
  const stale = new Map<string, string>();
  const docs = await loadDocs(accountId).catch(() => null);
  const policyNames = new Map((docs ?? []).map((d) => [d.id, d.productName ?? d.insurer ?? "Policy document"]));
  const entries = Object.values(state.evidence);
  if (!entries.length) return { stale, policyNames };
  if (!docs) { for (const e of entries) stale.set(e.id, "I couldn’t confirm that the documents an earlier answer relied on are still current, so I can’t rely on what they said."); return { stale, policyNames }; }
  const live = new Map(docs.map((d) => [d.id, d]));
  // The names of documents read earlier are remembered from when they were readable (never re-read once deleted).
  const names = (state.docNames ??= {});
  for (const e of entries) { const d = live.get(e.policyId); if (d?.productName) names[e.policyId] = d.productName; }
  for (const e of entries) {
    const d = live.get(e.policyId);
    if (!d) { const n = names[e.policyId]; stale.set(e.id, `${n ? `The ${n} document` : "A document"} an earlier answer relied on has since been deleted or replaced by a newer version, so I can no longer use what it said.`); continue; }
    if (e.documentHash && d.fileHash && e.documentHash !== d.fileHash) stale.set(e.id, `The ${d.productName ?? "policy"} document has changed since I read it, so I can no longer use what the earlier version said.`);
  }
  return { stale, policyNames };
}
