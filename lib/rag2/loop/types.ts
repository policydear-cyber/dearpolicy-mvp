/**
 * Conversational RAG (Prompt 2): the loop's own types -- the model interface (OpenAI-style tool calls), the
 * conversation state the loop keeps between turns (stored inside the chat's ConversationState under `ragLoop`), and
 * the per-turn trace (tool calls, evidence chosen, model id, token usage, latency).
 */
import type { EvidenceRef } from "../evidence";
import type { JsonSchema } from "../tools";

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type LoopMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type LoopToolSpec = { name: string; description: string; parameters: JsonSchema };
export type ModelUsage = { input: number; output: number };
export type ModelTurnInput = { messages: LoopMessage[]; tools: LoopToolSpec[]; maxOutputTokens: number };
export type ModelTurnOutput = { toolCalls: ToolCall[]; text: string | null; usage: ModelUsage; modelId: string; latencyMs: number };
/** A model that takes the conversation so far and the tool list, and replies with tool calls (and optional text,
 * which is never shown: the visible answer is composed only from final_answer / ask_user). */
export interface LoopModel { readonly id: string; readonly kind: "hosted" | "scripted"; next(input: ModelTurnInput): Promise<ModelTurnOutput> }

/** A fact the household gave about the event (claim facts), in their own words. */
export type LoopFact = { value: string | number | boolean; words: string; turn: number; previous?: { value: string | number | boolean; words: string; turn: number }[] };
/** A statement derived from claim facts in an earlier answer (an indicative estimate), kept so a correction can
 * withdraw it. */
export type LoopDerived = { sentence: string; factKeys: string[]; turn: number };
export type LoopPending =
  | { kind: "person"; question: string; mention: string | null; options: { id: string; label: string }[]; turn: number }
  | { kind: "fact"; question: string; factKey: string; subjectId: string | null; why: string; options?: string[]; turn: number };
export type EvidenceEntry = EvidenceRef & { id: string; via: string; label?: string | null };
export type TraceToolCall = { name: string; args: Record<string, unknown>; ok: boolean; error?: string; evidenceIds: string[]; summary?: string };
export type TraceTurn = {
  turn: number; userMessage: string; modelId: string; modelKind: "hosted" | "scripted"; steps: number;
  usage: ModelUsage; latencyMs: number; toolCalls: TraceToolCall[];
  /** The evidence the visible answer rests on (ids into RagLoopState.evidence). */
  evidenceChosen: string[];
  outcome: "final_answer" | "ask_user" | "budget_exhausted" | "error";
  /** Sentences the composer dropped before the save-time gate, and why. */
  dropped: { sentence: string; reason: string }[];
  /** What the save-time gate reported for the composed answer (run in report mode before saving; the gate itself then
   * runs again inside saveTurn and repairs the saved answer). */
  gate: { where: string; figure: string; reason: string }[];
  /** Pending question re-asked after a side question (interruption). */
  reasked?: string | null;
  corrections?: { key: string; from: unknown; to: unknown }[];
};
export type RagLoopState = {
  v: 1; turn: number; seq: number;
  subjectId: string | null; recentSubjectIds: string[];
  pending: LoopPending | null;
  claim: { subjectId: string | null; facts: Record<string, LoopFact>; derived: LoopDerived[] } | null;
  evidence: Record<string, EvidenceEntry>;
  history: { user: string; assistant: string }[];
  turns: TraceTurn[];
};

export function emptyLoopState(): RagLoopState {
  return { v: 1, turn: 0, seq: 0, subjectId: null, recentSubjectIds: [], pending: null, claim: null, evidence: {}, history: [], turns: [] };
}
