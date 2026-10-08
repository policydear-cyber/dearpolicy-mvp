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
import type { EvidenceRef } from "../evidence";
import { createToolContext, RAG_TOOLS, runTool, validateArgs, type ToolContext } from "../tools";
import { ASK_USER, FINAL_ANSWER, LOOP_ACTIONS, NOTE_FACTS, TERMINAL } from "./actions";
import { composeFinal, evidenceIdOf, type ComputeCall, type Composed } from "./compose";
import { loopBudget, loopToolEnv } from "./flag";
import { stateNote, SYSTEM_PROMPT } from "./prompt";
import type { LoopMessage, LoopModel, LoopPending, LoopToolSpec, RagLoopState, ToolCall, TraceToolCall, TraceTurn } from "./types";

export type LoopPerson = { id: string; name: string; relationship: string };
export type LoopInput = { accountId: string; message: string; state: RagLoopState; people: LoopPerson[]; speakerId: string | null; model: LoopModel; env?: NodeJS.ProcessEnv; asOf?: string | null };
export type LoopReply =
  | { kind: "final"; composed: Composed }
  | { kind: "ask"; pending: LoopPending; preface: string | null }
  | { kind: "fallback"; text: string };
export type LoopOutput = { state: RagLoopState; reply: LoopReply; trace: TraceTurn; tools: ToolContext; corrections: { key: string; from: unknown; to: unknown; withdrawn: string[] }[]; reasked: LoopPending | null };

export const FALLBACK_TEXT = "I couldn’t finish looking that up just now. Please ask again, or ask about one policy or one person at a time.";
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

export async function runLoop(input: LoopInput): Promise<LoopOutput> {
  const env = input.env ?? process.env;
  const budget = loopBudget(env);
  const state: RagLoopState = structuredClone(input.state);
  state.turn += 1;
  const householdIds = new Set(input.people.map((p) => p.id));
  const ctx = createToolContext({ accountId: input.accountId, speakerId: input.speakerId, lastSubjectId: state.subjectId, asOf: input.asOf ?? null });
  ctx.conversation.recentSubjectIds = [...state.recentSubjectIds];
  ctx.seq = state.seq;
  const computeCalls = new Map<string, ComputeCall>();
  const trace: TraceTurn = { turn: state.turn, userMessage: input.message, modelId: input.model.id, modelKind: input.model.kind, steps: 0, usage: { input: 0, output: 0 }, latencyMs: 0, toolCalls: [], evidenceChosen: [], outcome: "budget_exhausted", dropped: [], gate: [] };
  const corrections: LoopOutput["corrections"] = [];
  const pendingBefore = state.pending;
  const messages: LoopMessage[] = [{ role: "system", content: SYSTEM_PROMPT + "\n\n" + stateNote(state, input.people, input.speakerId) }];
  for (const h of state.history.slice(-6)) { messages.push({ role: "user", content: h.user }); messages.push({ role: "assistant", content: h.assistant }); }
  messages.push({ role: "user", content: input.message });
  const tools = loopToolSpecs();
  let reply: LoopReply | null = null;
  const t0 = Date.now();

  const record = (name: string, args: Record<string, unknown>, ok: boolean, evidenceIds: string[], error?: string, summary?: string): TraceToolCall => { const t: TraceToolCall = { name, args, ok, evidenceIds, ...(error ? { error } : {}), ...(summary ? { summary } : {}) }; trace.toolCalls.push(t); return t; };

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
      if (!state.claim || state.claim.subjectId !== subject) state.claim = { subjectId: subject, facts: {}, derived: [] };
      const recorded: string[] = [], corrected: { key: string; from: unknown; to: unknown; withdrawn: string[] }[] = [];
      for (const f of a.facts as { key: string; value: string; words: string; currency?: string }[]) {
        const key = String(f.key).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        if (!key || f.value == null || !String(f.words ?? "").trim()) continue;
        const value = f.currency ? `${String(f.value)} ${f.currency.toUpperCase()}` : String(f.value);
        const old = state.claim.facts[key];
        if (old && String(old.value) !== value) {
          const withdrawn = state.claim.derived.filter((d) => d.factKeys.includes(key)).map((d) => d.sentence);
          state.claim.derived = state.claim.derived.filter((d) => !d.factKeys.includes(key));
          state.claim.facts[key] = { value, words: f.words, turn: state.turn, previous: [...(old.previous ?? []), { value: old.value, words: old.words, turn: old.turn }] };
          corrected.push({ key, from: old.value, to: value, withdrawn });
        } else if (!old) state.claim.facts[key] = { value, words: f.words, turn: state.turn };
        recorded.push(key);
        if (state.pending?.kind === "fact" && state.pending.factKey === key) state.pending = null;
      }
      corrections.push(...corrected);
      return { result: { ok: true, recorded, corrected, facts: state.claim.facts } };
    }
    if (call.name === "ask_user") {
      const question = String(a.question ?? "").trim();
      if ((question.match(/\?/g) ?? []).length !== 1 || !question.endsWith("?")) return { result: { ok: false, error: "ask exactly one question, ending with a question mark" } };
      if (moneyFiguresIn(question).length) return { result: { ok: false, error: "a question never states a figure" } };
      const preface = typeof a.preface === "string" && a.preface.trim() ? a.preface.trim() : null;
      if (preface && (/\d/.test(preface) || STATEMENT.test(preface) || moneyFiguresIn(preface).length)) return { result: { ok: false, error: "the preface may not state figures or cover; put facts in final_answer with evidence" } };
      if (a.kind === "person") {
        const options = ((a.options as string[]) ?? []).filter((id) => householdIds.has(id));
        if (options.length < 2) return { result: { ok: false, error: "a person question offers two or more household members (the candidates resolve_person returned)" } };
        if (pendingBefore?.kind === "person" && pendingBefore.turn === state.turn - 1) return { result: { ok: false, error: "you already asked who is meant; resolve the person from the household's reply" } };
        const pending: LoopPending = { kind: "person", question, mention: typeof a.mention === "string" ? a.mention : null, options: options.map((id) => ({ id, label: input.people.find((p) => p.id === id)!.name })), turn: state.turn };
        return { result: { ok: true }, terminal: { kind: "ask", pending, preface } };
      }
      const key = String(a.fact_key ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      if (!key) return { result: { ok: false, error: "a fact question needs the fact_key its answer is recorded under" } };
      const subject = (a.subject_id as string) ?? state.claim?.subjectId ?? state.subjectId;
      const known = state.claim && state.claim.subjectId === subject ? state.claim.facts[key] : undefined;
      if (known) return { result: { ok: false, error: `${key} is already recorded (${String(known.value)}, "${known.words}"); do not ask again` } };
      const because = ((a.because_evidence_ids as string[]) ?? []).filter((id) => state.evidence[id]);
      if (!because.length) return { result: { ok: false, error: "cite the evidence (because_evidence_ids) of the benefit or clause that makes this fact matter" } };
      const why = because.map((id) => `${whyLine(state.evidence[id], question + " " + key)} (page ${state.evidence[id].passage.onPage})`).join("; ");
      trace.evidenceChosen.push(...because.filter((id) => !trace.evidenceChosen.includes(id)));
      const pending: LoopPending = { kind: "fact", question, factKey: key, subjectId: subject ?? null, why, ...(Array.isArray(a.options) && a.options.length ? { options: (a.options as string[]).map(String) } : {}), turn: state.turn };
      return { result: { ok: true }, terminal: { kind: "ask", pending, preface } };
    }
    // final_answer
    const composed = composeFinal({ sentences: a.sentences as Record<string, unknown>[], nextSteps: a.next_steps, subjectId: (a.subject_id as string) ?? null }, { state, tools: ctx, computeCalls, householdIds, userText: input.message });
    if (!composed.sentences.length && !composed.dropped.length) return { result: { ok: false, error: "final_answer needs at least one sentence" } };
    return { result: { ok: true }, terminal: { kind: "final", composed } };
  };

  for (let step = 0; step < budget.maxSteps && !reply; step++) {
    if (trace.usage.input + trace.usage.output >= budget.maxTokens) break;
    let out;
    try { out = await input.model.next({ messages, tools, maxOutputTokens: budget.maxOutputTokens }); }
    catch (error) { trace.outcome = "error"; record("model", {}, false, [], error instanceof Error ? error.message : String(error)); break; }
    trace.steps++; trace.usage.input += out.usage.input; trace.usage.output += out.usage.output; trace.modelId = out.modelId || trace.modelId;
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
      const res = await runTool(ctx, call.name, call.arguments, loopToolEnv(env));
      const ids: string[] = [];
      const shown = res.ok ? { ok: true, data: forModel(res.data, state, call.name, ids), evidence: forModel(res.evidence, state, call.name, ids) } : { ok: false, error: res.error, evidence: forModel(res.evidence, state, call.name, ids) };
      if (res.ok && call.name === "compute") { const rid = (res.data as { resultId?: string }).resultId; if (rid) computeCalls.set(rid, { operation: String(call.arguments.operation), operands: (call.arguments.operands as Record<string, unknown>[]) ?? [] }); }
      if (res.ok && call.name === "resolve_person") {
        const r = res.data as { status: string; person?: { id: string } };
        if (r.status === "ok" && r.person) { state.subjectId = r.person.id; state.recentSubjectIds = [r.person.id, ...state.recentSubjectIds.filter((x) => x !== r.person!.id)].slice(0, 5); if (state.pending?.kind === "person") state.pending = null; }
      }
      const d = res.ok ? (res.data as Record<string, unknown>) : null;
      record(call.name, call.arguments, res.ok, ids, res.ok ? undefined : res.error, d ? brief({ status: d.status, valueId: d.valueId, resultId: d.resultId, value: d.value, amount: d.amount, kind: d.kind, column: d.columnHeader, row: d.rowLabel, hits: Array.isArray(d.hits) ? d.hits.length : undefined }) : undefined);
      messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(shown) });
    }
  }
  trace.latencyMs = Date.now() - t0;
  state.seq = ctx.seq;

  let reasked: LoopPending | null = null;
  const done = reply as LoopReply | null;
  let final: LoopReply;
  if (!done) { final = { kind: "fallback", text: FALLBACK_TEXT }; if (trace.outcome !== "error") trace.outcome = "budget_exhausted"; }
  else if (done.kind === "ask") { final = done; state.pending = done.pending; trace.outcome = "ask_user"; }
  else if (done.kind === "final") {
    final = done;
    const c = done.composed;
    trace.outcome = "final_answer";
    trace.dropped = c.dropped;
    trace.evidenceChosen.push(...c.evidenceIds.filter((id) => !trace.evidenceChosen.includes(id)));
    if (c.subjectId) state.subjectId = c.subjectId;
    // Derived statements are remembered with the facts they used, so a correction can withdraw them.
    if (state.claim) for (const s of c.sentences) if (s.estimate && s.factKeys.length) state.claim.derived.push({ sentence: s.text, factKeys: s.factKeys, turn: state.turn });
    // An interruption: the claim question still open is put back to the household after the side answer.
    if (state.pending?.kind === "fact") { reasked = state.pending; trace.reasked = state.pending.question; }
    else if (state.pending?.kind === "person") state.pending = null;
  } else final = done;
  if (corrections.length) trace.corrections = corrections.map(({ key, from, to }) => ({ key, from, to }));
  return { state, reply: final, trace, tools: ctx, corrections, reasked };
}
