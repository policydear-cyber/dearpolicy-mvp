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
import { moneyFiguresIn } from "@/lib/chat/answer-verification";
import { refineEvidence, supportSpan, contextFor, type EvidenceRef } from "../evidence";
import { loadDocs, loadPages } from "../store";
import { calcOutcomes } from "../calc/tool";
import { createToolContext, RAG_TOOLS, runTool, validateArgs, type ToolContext } from "../tools";
import { loopLimits } from "@/lib/ai/usage";
import { CAUSE_KEYS, checkFact, confirmed, EVENT_KEY, factConcept, householdOperandProblem, knownFactFor, MECHANISM, normalizeKey, quotedFrom } from "./facts";
import { compoundQuestion, relevantEvidence } from "./questions";
import { LoopUsageMeter, type MeterStop } from "./usage-meter";
import { ASK_USER, FINAL_ANSWER, LOOP_ACTIONS, NOTE_FACTS, TERMINAL } from "./actions";
import { composeFinal, evidenceIdOf, type ComputeCall, type Composed } from "./compose";
import { loopToolEnv } from "./flag";
import { LOOP_PROMPT_VERSION, stateNote, SYSTEM_PROMPT } from "./prompt";
import type { LoopClaim, LoopMessage, LoopModel, LoopPending, LoopToolSpec, RagLoopState, ToolCall, TraceToolCall, TraceTurn } from "./types";

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
  | { kind: "ask"; pending: LoopPending; preface: string | null }
  | { kind: "fallback"; text: string };
export type LoopCorrection = { key: string; from: unknown; to: unknown; withdrawn: string[];
  /** Agent F: the facts the withdrawn estimates were worked out from (said back without their figures). */
  about?: string[] };
export type LoopOutput = { state: RagLoopState; reply: LoopReply; trace: TraceTurn; tools: ToolContext; corrections: LoopCorrection[]; reasked: LoopPending | null };

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
const STATEMENT = /\b(?:cover\w*|pays?|payable|limits?|excluded|eligib\w*|benefits?)\b/i;

export function loopToolSpecs(): LoopToolSpec[] {
  return [...RAG_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })), ...LOOP_ACTIONS];
}

const isRef = (v: any): v is EvidenceRef => !!v && typeof v === "object" && typeof v.policyId === "string" && !!v.passage && typeof v.passage.text === "string" && !!v.page;
/** What a tool result looks like to the model: every EvidenceRef replaced by its evidence id and a short excerpt. */
function forModel(value: unknown, state: RagLoopState, via: string, ids: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => forModel(v, state, via, ids));
  if (isRef(value)) {
    const id = evidenceIdOf(state, value, via);
    if (!ids.includes(id)) ids.push(id);
    return { evidence_id: id, policy_id: value.policyId, page: value.passage.onPage, ...(value.table ? { row: value.table.rowLabel, column: value.table.columnHeader } : {}), excerpt: value.passage.text.length > 400 ? value.passage.text.slice(0, 400) + "…" : value.passage.text };
  }
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = forModel(v, state, via, ids);
    return o;
  }
  return value;
}

/** The line of a cited passage that says why a question matters: a table row's label, else the passage line sharing
 * the most words with the question (quoted verbatim, whitespace collapsed). */
function whyLine(e: EvidenceRef, about: string): string {
  if (e.table?.rowLabel) return e.table.rowLabel;
  const want = new Set((about.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/e?s$/, "")));
  const lines = e.passage.text.split(/\n+/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const score = (l: string) => (l.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => want.has(w.replace(/e?s$/, ""))).length;
  const best = [...lines].sort((a, b) => score(b) - score(a))[0] ?? "";
  return "“" + (best.length > 160 ? best.slice(0, 157) + "…" : best) + "”";
}

const brief = (r: unknown): string => { const s = JSON.stringify(r) ?? ""; return s.length > 160 ? s.slice(0, 160) + "…" : s; };

const SELF_MENTION = /^(?:i|me|my|myself|mine|my own|self)$/i;
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
  /** Integration (agent C's request 3): what the latest calculate result for each person still needs from the
   * household (fact key, why, the evidence ids that make it matter), in the order it should be asked. */
  const calcMissing = new Map<string, { key: string; why: string; evidenceIds: string[] }[]>();
  const trace: TraceTurn = { turn: state.turn, userMessage: input.message, modelId: input.model.id, modelKind: input.model.kind, steps: 0, usage: { input: 0, output: 0 }, latencyMs: 0, toolCalls: [], evidenceChosen: [], outcome: "budget_exhausted", dropped: [], gate: [], calls: [], limit: null };
  const corrections: LoopOutput["corrections"] = [];
  const pendingBefore = state.pending;
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
  /** Agent F (D9 / S6a): the household corrected WHO the claim is about ("it was Chloe, not Ethan"): estimates worked
   * out for the first person are withdrawn, and the reply says which one and why. */
  const personCorrection = (to: string) => {
    const from = state.claim;
    if (!from?.subjectId || from.subjectId === to || !PERSON_CORRECTION.test(input.message)) return;
    const withdrawn = from.derived.map((d) => d.sentence);
    const about = [...new Set(from.derived.flatMap((d) => d.factKeys))];
    from.derived = [];
    if (corrections.some((c) => c.key === "person" && c.to === nameOf(to))) return;
    corrections.push({ key: "person", from: nameOf(from.subjectId), to: nameOf(to), withdrawn, about });
    if (withdrawn.length) scrubWithdrawn(withdrawn);
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
    if (state.claim?.subjectId && state.claim.subjectId !== id) personCorrection(id);
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
        const old = claim.facts[key];
        if (old && String(old.value) !== value) {
          const withdrawn = claim.derived.filter((d) => d.factKeys.includes(key)).map((d) => d.sentence);
          claim.derived = claim.derived.filter((d) => !d.factKeys.includes(key));
          claim.facts[key] = { ...entry, previous: [...(old.previous ?? []), { value: old.value, words: old.words, turn: old.turn, source: old.source, basis: old.basis }] };
          corrected.push({ key, from: old.value, to: value, withdrawn });
          if (withdrawn.length) scrubWithdrawn(withdrawn);
        } else if (!old || (old.basis === "paraphrased" && chk.basis === "stated")) claim.facts[key] = old ? { ...entry, previous: old.previous } : entry;
        recorded.push(key);
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
      const preface = typeof a.preface === "string" && a.preface.trim() ? a.preface.trim() : null;
      if (preface && (/\d/.test(preface) || STATEMENT.test(preface) || moneyFiguresIn(preface).length)) return { result: { ok: false, error: "the preface may not state figures or cover; put facts in final_answer with evidence" } };
      if (a.kind === "person") {
        const options = ((a.options as string[]) ?? []).filter((id) => householdIds.has(id));
        if (options.length < 2) return { result: { ok: false, error: "a person question offers two or more household members (the candidates resolve_person returned)" } };
        if (pendingBefore?.kind === "person" && pendingBefore.turn === state.turn - 1) return { result: { ok: false, error: "you already asked who is meant; resolve the person from the household's reply" } };
        const purpose = lastAmbiguous?.self && options.every((id) => lastAmbiguous!.labels.has(id)) ? "speaker" as const : "subject" as const;
        const label = (id: string) => { const p = input.people.find((x) => x.id === id)!; const rel = candidateLabels.get(id); return rel && purpose === "subject" ? `${p.name} (your ${rel})` : p.name; };
        const pending: LoopPending = { kind: "person", question, mention: typeof a.mention === "string" ? a.mention : null, options: options.map((id) => ({ id, label: label(id) })), turn: state.turn, purpose };
        return { result: { ok: true }, terminal: { kind: "ask", pending, preface } };
      }
      const key = normalizeKey(a.fact_key);
      if (!key) return { result: { ok: false, error: "a fact question needs the fact_key its answer is recorded under" } };
      const subject = (a.subject_id as string) ?? state.claim?.subjectId ?? state.subjectId;
      const claim = subject ? (state.claim?.subjectId === subject ? state.claim : state.otherClaims?.[subject]) : null;
      // Agent F (D15): the same fact under another key (admitted_at / admission_time, how_it_happened / cause) is known.
      const known = claim ? knownFactFor(key, claim.facts) : null;
      if (known) return { result: { ok: false, error: `${key} is already recorded${known.key !== key ? ` (as ${known.key})` : ""} (${String(known.fact.value)}, "${known.fact.words}"); do not ask again` } };
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
      const why = because.map((id) => `${whyLine(state.evidence[id], question + " " + key)} (page ${state.evidence[id].passage.onPage})`).join("; ");
      trace.evidenceChosen.push(...because.filter((id) => !trace.evidenceChosen.includes(id)));
      const pending: LoopPending = { kind: "fact", question, factKey: key, subjectId: subject ?? null, why, ...(Array.isArray(a.options) && a.options.length ? { options: (a.options as string[]).map(String) } : {}), turn: state.turn };
      return { result: { ok: true }, terminal: { kind: "ask", pending, preface } };
    }
    // final_answer
    const answerSubject = (a.subject_id as string) ?? state.subjectId;
    const estimates = ((a.sentences as Record<string, unknown>[]) ?? []).some((x) => typeof x.result_id === "string" && (ctx.results.get(x.result_id)?.kind === "indicative_estimate" || calcOutcomes(ctx).get(x.result_id)?.kind === "indicative_estimate"));
    const cause = estimates ? causeOpen(answerSubject) : null;
    if (cause) return { result: { ok: false, error: `an estimate for this event depends on how it happened (the documents distinguish accidents), which is not known: ask how it happened first (fact_key how_it_happened, citing ${cause.slice(0, 3).join(", ")})` } };
    const composed = composeFinal({ sentences: a.sentences as Record<string, unknown>[], nextSteps: a.next_steps, subjectId: (a.subject_id as string) ?? null }, { state, tools: ctx, computeCalls, householdIds, userText: input.message, userTexts, names: input.people.map((p) => p.name), stale, policyNames, people: input.people.map((p) => ({ id: p.id, names: personNames(p.name) })) });
    if (!composed.sentences.length && !composed.dropped.length) return { result: { ok: false, error: "final_answer needs at least one sentence" } };
    return { result: { ok: true }, terminal: { kind: "final", composed } };
  };

  /** A tool call refused by the loop before it runs (null: run it). */
  const preflight = (call: ToolCall): string | null => {
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

  for (let step = 0; !reply; step++) {
    const m = await meter.next({ messages, tools, maxOutputTokens: limits.maxOutputTokens });
    if (!m.ok) { stop = m.stop; if (m.stop.kind === "model_error") record("model", {}, false, [], m.stop.detail); break; }
    const out = m.out;
    trace.steps++; trace.modelId = out.modelId || trace.modelId;
    messages.push({ role: "assistant", content: out.text, toolCalls: out.toolCalls });
    if (!out.toolCalls.length) { messages.push({ role: "user", content: "Use the tools. End the turn only with ask_user or final_answer." }); continue; }
    for (const call of out.toolCalls) {
      if (reply) { messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: "the turn already ended" }) }); continue; }
      if (LOOP_ACTIONS.some((s) => s.name === call.name)) {
        const r = action(call);
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
      const shown = res.ok ? { ok: true, data: forModel(res.data, state, call.name, ids), evidence: forModel(res.evidence, state, call.name, ids) } : { ok: false, error: res.error, evidence: forModel(res.evidence, state, call.name, ids) };
      if (res.ok && call.name === "calculate" && typeof call.arguments.subject_id === "string") {
        const miss = ((shown as { data?: { missing?: { key: string; ask: string; why: string; evidence?: { evidence_id?: string }[] }[] } }).data?.missing ?? []).filter((m) => m.ask === "household");
        calcMissing.set(call.arguments.subject_id, miss.map((m) => ({ key: normalizeKey(m.key), why: m.why, evidenceIds: (m.evidence ?? []).map((e) => e.evidence_id ?? "").filter(Boolean) })));
      }
      if (res.ok && call.name === "compute") { const rid = (res.data as { resultId?: string }).resultId; if (rid) computeCalls.set(rid, { operation: String(call.arguments.operation), operands: (call.arguments.operands as Record<string, unknown>[]) ?? [] }); }
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
  const done = reply as LoopReply | null;
  let final: LoopReply;
  if (!done) {
    const kind = stop?.kind ?? "turn_calls";
    final = { kind: "fallback", text: LIMIT_TEXT[kind] };
    trace.limit = { kind, detail: stop?.detail ?? "the turn ended without an answer" };
    trace.outcome = kind === "model_error" ? "error" : kind === "turn_calls" || kind === "turn_tokens_used" ? "budget_exhausted" : kind === "timeout" || kind === "turn_time" || kind === "cancelled" ? "timeout" : "limit_reached";
  }
  else if (done.kind === "ask") {
    final = done;
    // A person question (who is meant / who is typing) asked while a claim question is open: the claim question is
    // set aside, not lost, and put back once the person is settled.
    if (done.pending.kind === "person" && state.pending?.kind === "fact") state.parkedPending = state.pending;
    if (done.pending.kind === "fact") state.parkedPending = null;
    state.pending = done.pending; trace.outcome = "ask_user";
  }
  else if (done.kind === "final") {
    final = done;
    const c = done.composed;
    trace.outcome = "final_answer";
    trace.dropped = c.dropped;
    trace.evidenceChosen.push(...c.evidenceIds.filter((id) => !trace.evidenceChosen.includes(id)));
    // Precision: each cited passage narrowed to the sentence / row the answer's sentence rests on (internal; the page
    // stays the household-facing link).
    // A span found at search time (for the query) is replaced by the one for the sentence actually said.
    for (const sent of c.sentences) for (const id of sent.evidenceIds) await narrow(id, sent.text);
    if (c.subjectId) setSubject(c.subjectId, c.subjectId === state.speakerId);
    // Derived statements are remembered with the facts they used, so a correction can withdraw them.
    if (state.claim) for (const s of c.sentences) if (s.estimate && s.factKeys.length) state.claim.derived.push({ sentence: s.text, factKeys: s.factKeys, turn: state.turn });
    // An interruption: the claim question still open is put back to the household after the side answer.
    if (state.pending?.kind === "person") state.pending = null;
    if (!state.pending && state.parkedPending) { state.pending = state.parkedPending; state.parkedPending = null; }
    if (state.pending?.kind === "fact") { reasked = state.pending; trace.reasked = state.pending.question; }
  } else final = done;
  // The passage a question cites (why it matters): narrowed to the sentence that makes the fact matter -- for how an
  // event happened, the sentence about accidents; otherwise the one closest to the question.
  if (final.kind === "ask" && final.pending.kind === "fact") {
    const p = final.pending;
    for (const id of trace.evidenceChosen) await narrow(id, CAUSE_KEYS.has(p.factKey) ? "accident accidental" : p.question + " " + p.factKey.replace(/_/g, " "));
  }
  if (corrections.length) trace.corrections = corrections.map(({ key, from, to }) => ({ key, from, to }));
  // Agent F (D6): remember the names of the documents this turn's evidence came from (readable now).
  for (const e of Object.values(state.evidence)) { const n = policyNames.get(e.policyId); if (n) (state.docNames ??= {})[e.policyId] = n; }
  return { state, reply: final, trace, tools: ctx, corrections, reasked };
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
  if (!docs) { for (const e of entries) stale.set(e.id, "I couldn’t confirm that the documents an earlier answer relied on are still current, so I left out what they said."); return { stale, policyNames }; }
  const live = new Map(docs.map((d) => [d.id, d]));
  // The names of documents read earlier are remembered from when they were readable (never re-read once deleted).
  const names = (state.docNames ??= {});
  for (const e of entries) { const d = live.get(e.policyId); if (d?.productName) names[e.policyId] = d.productName; }
  for (const e of entries) {
    const d = live.get(e.policyId);
    if (!d) { const n = names[e.policyId]; stale.set(e.id, `${n ? `The ${n} document` : "A document"} an earlier answer relied on has since been deleted or replaced by a newer version, so I left out what it said.`); continue; }
    if (e.documentHash && d.fileHash && e.documentHash !== d.fileHash) stale.set(e.id, `The ${d.productName ?? "policy"} document has changed since I read it, so I left out what the earlier version said.`);
  }
  return { stale, policyNames };
}
