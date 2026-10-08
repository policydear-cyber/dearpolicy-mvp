/**
 * Conversational RAG (Prompt 2): the loop's own types -- the model interface (OpenAI-style tool calls), the
 * conversation state the loop keeps between turns (stored inside the chat's ConversationState under `ragLoop`), and
 * the per-turn trace (tool calls, evidence chosen, model id, token usage, latency).
 */
import type { EvidenceRef } from "../evidence";
import type { JsonSchema } from "../tools";
import type { ModelChoice } from "@/lib/ai/providers";

export type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
export type LoopMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };
export type LoopToolSpec = { name: string; description: string; parameters: JsonSchema };
export type ModelUsage = { input: number; output: number };
export type ModelTurnInput = { messages: LoopMessage[]; tools: LoopToolSpec[]; maxOutputTokens: number;
  /** Aborted when the call's time is up or the turn is cancelled (lib/rag2/loop/usage-meter.ts). */
  signal?: AbortSignal };
export type ModelTurnOutput = { toolCalls: ToolCall[]; text: string | null; usage: ModelUsage; modelId: string; latencyMs: number;
  /** The model id the provider itself reported for this call (null when it reported none). */
  resolvedModel?: string | null };
/** A model that takes the conversation so far and the tool list, and replies with tool calls (and optional text,
 * which is never shown: the visible answer is composed only from final_answer / ask_user). */
export interface LoopModel { readonly id: string; readonly kind: "hosted" | "scripted";
  /** The provider and model requested (hosted models): what usage and spend are booked against. */
  readonly choice?: ModelChoice;
  next(input: ModelTurnInput): Promise<ModelTurnOutput> }

/** A fact about the event (claim facts) with its provenance (lib/rag2/loop/facts.ts): `source` -- the household's own
 * words (user_reported), a document passage (document) or reviewed medical evidence; `basis` -- "stated" (the value is
 * in those words) or "paraphrased" (the model's wording of them: a report, unconfirmed, never a calculation input).
 * Facts saved before provenance existed have neither field and count as user_reported / stated. */
export type LoopFact = { value: string | number | boolean; words: string; turn: number; source?: "user_reported" | "document" | "medical_evidence"; basis?: "stated" | "paraphrased"; evidenceIds?: string[];
  previous?: { value: string | number | boolean; words: string; turn: number; source?: LoopFact["source"]; basis?: LoopFact["basis"] }[] };
export type LoopClaim = { subjectId: string | null; facts: Record<string, LoopFact>; derived: LoopDerived[] };
/** A statement derived from claim facts in an earlier answer (an indicative estimate), kept so a correction can
 * withdraw it. */
export type LoopDerived = { sentence: string; factKeys: string[]; turn: number };
export type LoopPending =
  | { kind: "person"; question: string; mention: string | null; options: { id: string; label: string }[]; turn: number;
      /** "speaker": who is typing (a shared household login); "subject": who the question is about (default). */
      purpose?: "speaker" | "subject" }
  | { kind: "fact"; question: string; factKey: string; subjectId: string | null; why: string; options?: string[]; turn: number };
export type EvidenceEntry = EvidenceRef & { id: string; via: string; label?: string | null };
export type TraceToolCall = { name: string; args: Record<string, unknown>; ok: boolean; error?: string; evidenceIds: string[]; summary?: string };
export type TraceTurn = {
  turn: number; userMessage: string; modelId: string; modelKind: "hosted" | "scripted"; steps: number;
  usage: ModelUsage; latencyMs: number; toolCalls: TraceToolCall[];
  /** The evidence the visible answer rests on (ids into RagLoopState.evidence). */
  evidenceChosen: string[];
  outcome: "final_answer" | "ask_user" | "budget_exhausted" | "limit_reached" | "timeout" | "error";
  /** Every model call this turn (attempts, including failed and retried ones), as metered (usage-meter.ts). */
  calls?: { attempt: number; ok: boolean; input: number; output: number; costUsd: number | null; latencyMs: number; error?: string; retry?: boolean }[];
  /** Which limit stopped the turn, when one did. */
  limit?: { kind: string; detail: string } | null;
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
  /** The household member typing ("me", "my", "I"), once known: the only member recorded as self, or who they said
   * they are in a shared household login. Never changed by who a question is about. */
  speakerId?: string | null;
  /** The active subject: who the conversation (and its claim) is about -- e.g. the child in a claim. A side question
   * about the speaker does not change it. */
  subjectId: string | null; recentSubjectIds: string[];
  pending: LoopPending | null;
  /** A claim question set aside while a person question (e.g. who is typing) is asked; put back after the answer. */
  parkedPending?: LoopPending | null;
  /** The active claim (its subject's facts and what was derived from them). */
  claim: LoopClaim | null;
  /** Claims about other members, kept (not overwritten) while the active claim is pending. */
  otherClaims?: Record<string, LoopClaim>;
  evidence: Record<string, EvidenceEntry>;
  history: { user: string; assistant: string }[];
  turns: TraceTurn[];
};

export function emptyLoopState(): RagLoopState {
  return { v: 1, turn: 0, seq: 0, speakerId: null, subjectId: null, recentSubjectIds: [], pending: null, claim: null, evidence: {}, history: [], turns: [] };
}
