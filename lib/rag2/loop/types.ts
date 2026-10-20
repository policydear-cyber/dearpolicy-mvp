/**
 * Conversational RAG (Prompt 2): the loop's own types -- the model interface (OpenAI-style tool calls), the
 * conversation state the loop keeps between turns (stored inside the chat's ConversationState under `ragLoop`), and
 * the per-turn trace (tool calls, evidence chosen, model id, token usage, latency).
 */
import type { EvidenceRef } from "../evidence";
import type { JsonSchema } from "../tools";
import type { ModelChoice } from "@/lib/ai/providers";
import type { TableValueOperand } from "../compute";

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
  resolvedModel?: string | null;
  /** The provider's own id for this call (OpenAI / Anthropic response `id`), recorded as model_executions.provider_request_id. */
  providerRequestId?: string | null };
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
  /** PR #54 follow-up: the household's message recording it corrected something ("actually", "sorry", "not ..."). */
  cue?: boolean;
  /** fx-live-1 (K4b): the household's description of the event, copied to the person it was corrected to (the subject id it came from).
   * It is not something they said about THIS person: a later report for this person replaces it without being a "correction". */
  carriedFrom?: string;
  previous?: { value: string | number | boolean; words: string; turn: number; source?: LoopFact["source"]; basis?: LoopFact["basis"] }[] };
export type LoopClaim = { subjectId: string | null; facts: Record<string, LoopFact>; derived: LoopDerived[];
  /** Agent G: the calculations worked out for this claim (by calc id), with the facts and evidence each rests on, so a
   * correction or a deleted source withdraws exactly the ones that depended on it -- in the loop and on the claim
   * record (lib/rag2/calc/claim-record.ts syncLoopClaimState). */
  calcs?: Record<string, LoopCalcRef>;
  /** Agent G: facts that were only supported by a document that has since been deleted or superseded. */
  invalidated?: { key: string; value: string | number | boolean; words: string; reason: string; turn: number }[];
  /** PR #57 follow-up (critic H1): household reports taken off this person by a correction of who the event happened to, kept (never
   * deleted) with the person they moved to, so a later correction back to this person restores them. */
  reassigned?: { key: string; fact: LoopFact; to: string; turn: number }[] };
/** A statement derived from claim facts in an earlier answer (an indicative estimate), kept so a correction can
 * withdraw it. */
export type LoopDerived = { sentence: string; factKeys: string[]; turn: number;
  /** Agent G: the evidence the statement cites (a deleted source withdraws it unless another live source prints the same). */
  evidenceIds?: string[] };
/** Agent G: one calculation of a claim and what it rests on. */
export type LoopCalcRef = { calcId: string; kind: string; policyId: string; benefit: string; factKeys: string[]; evidenceIds: string[]; turn: number;
  withdrawn?: { cause: "person" | "fact" | "source"; reason: string; key?: string | null; turn: number } | null };
export type LoopPending =
  | { kind: "person"; question: string; mention: string | null; options: { id: string; label: string }[]; turn: number;
      /** "speaker": who is typing (a shared household login); "subject": who the question is about (default). */
      purpose?: "speaker" | "subject" }
  | { kind: "fact"; question: string; factKey: string; subjectId: string | null; why: string; options?: string[]; turn: number;
      /** Round 7: the evidence ids that made the fact matter (the benefit / clause the question is about). */
      evidenceIds?: string[];
      /** rc-live-3: the benefit whose listed case this question asks for (asked after evaluate_benefit could not settle
       * the case); answered once the server settles that benefit's case from the household's words. */
      caseOf?: string;
      /** Actual-library findings: the server requirement this question asks (its id this turn) and the benefit it is for. */
      requirementId?: string; benefitId?: string };
/** Round 7: a cited, bound statement of a printed benefit the conversation has already made (with the evidence and
 * table-value ids it rests on), so a later turn -- the household answering the question about it -- can explain it
 * again with the same citation and binding. */
export type EstablishedStatement = { text: string; evidenceIds: string[]; valueIds: string[]; benefit: string | null; subjectId: string | null; turn: number };
/** Round 7: a table value issued by select_table_value, kept across turns (value ids stay citable later). */
export type PersistedValue = { operand: TableValueOperand; selected: unknown; subjectId: string };
export type EvidenceEntry = EvidenceRef & { id: string; via: string; label?: string | null };
export type TraceToolCall = { name: string; args: Record<string, unknown>; ok: boolean; error?: string; evidenceIds: string[]; summary?: string };
export type TraceTurn = {
  turn: number; userMessage: string; modelId: string; modelKind: "hosted" | "scripted"; steps: number;
  usage: ModelUsage; latencyMs: number; toolCalls: TraceToolCall[];
  /** Where the loop's time went: model calls, each tool (calls, ms), benefit-record resolution (it is also inside the tool times), the rest. */
  /** Phase times of the turn in ms (loop, gate report, rescue, figure gate, check) measured BEFORE the save that persists this record. The save's own duration is not in it (it cannot be: it is measured after the record is written). */
  phases?: Record<string, number>;
  timings?: { modelMs: number; toolMs: Record<string, { n: number; ms: number }>; resolve: { n: number; ms: number }; otherMs: number; /** the turn store's reads (lib/rag2/store.ts): SQL statements issued and reads served from the turn */ store?: Record<string, number> };
  /** The evidence the visible answer rests on (ids into RagLoopState.evidence). */
  evidenceChosen: string[];
  outcome: "final_answer" | "ask_user" | "budget_exhausted" | "limit_reached" | "timeout" | "error";
  /** V1.2: what the model's reply left unaddressed after its one repair (the reply was completed by the grounded fallback). */
  incomplete?: string[];
  /** V1.2: how the model's question was adjusted before it was shown (one clause, the person named, an unanswered earlier question). */
  adjusted?: string[];
  /** PR #55 (SBb): what became of each percentage schedule the lookup returned for the reply's person -- explained, evaluated, excluded (with the reason) or unresolved (with the uncertainty). */
  schedules?: { benefitId: string; benefit: string; disposition: "explained" | "evaluated" | "excluded" | "unresolved"; reason: string }[];
  /** Every model call this turn (attempts, including failed and retried ones), as metered (usage-meter.ts). */
  calls?: { attempt: number; ok: boolean; input: number; output: number; costUsd: number | null; latencyMs: number; error?: string; retry?: boolean }[];
  /** Which limit stopped the turn, when one did. */
  limit?: { kind: string; detail: string } | null;
  /** Sentences the composer dropped before the save-time gate, and why. */
  dropped: { sentence: string; reason: string }[];
  /** What the save-time gate reported for the composed answer (run in report mode before saving; the gate itself then
   * runs again inside saveTurn and repairs the saved answer). */
  gate: { where: string; figure: string; reason: string }[];
  /** Round 8 (F1): the composed sentences the save-time gate was given (before it left any out). */
  composed?: string[];
  /** Pending question re-asked after a side question (interruption). */
  reasked?: string | null;
  corrections?: { key: string; from: unknown; to: unknown }[];
  /** What the answer showed: who it was about and its next steps, as composed and checked (a later "what do i do now" repeats them). */
  shown?: { subjectId: string | null; nextSteps: string[] };
};
export type RagLoopState = {
  v: 1; turn: number; seq: number;
  /** The household member typing ("me", "my", "I"), once known: the only member recorded as self, or who they said
   * they are in a shared household login. Never changed by who a question is about. */
  speakerId?: string | null;
  /** V1.4: true only when the household itself said who is typing (it answered the "who is asking" question). The
   * member recorded as self is a default for "I / me / my", never proof of who is typing: the sign-in establishes the
   * account, not the member. */
  speakerConfirmed?: boolean;
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
  /** Agent F (D6): product names of the documents evidence was read from, remembered while they were readable (so a
   * later turn can say which document is no longer available without reading a deleted record). */
  docNames?: Record<string, string>;
  /** Agent G: who the claim was moved from when the household corrected the person (newest last). */
  claimMoves?: { from: string; to: string; turn: number }[];
  /** Agent G: the claim record (claim_sessions) this conversation's claim is written to, once one exists. */
  claimRecord?: { id: string; memberId: string } | null;
  history: { user: string; assistant: string }[];
  turns: TraceTurn[];
  /** Round 7: table values issued in earlier turns (value id -> value), still citable while their document is current. */
  values?: Record<string, PersistedValue>;
  /** Round 7: benefits already stated, cited and bound in this conversation (newest last). */
  established?: EstablishedStatement[];
  /** Actual-library findings (latency): the benefits evaluated in this conversation, so a later turn evaluates the same
   * benefit again by its id (re-resolved and re-checked by the server) without listing every benefit again. */
  evaluated?: { id: string; benefit: string; product: string | null; subjectId: string }[];
  /** PR #55 (SBb): the percentage schedules a benefit lookup returned for a person (newest last), so a later turn of the same event still knows which relevant schedules were discovered. */
  discovered?: { id: string; benefit: string; subjectId: string }[];
  /** Calculations left unresolved for missing household facts, per subject|calculator|benefit, re-run when the facts arrive. */
  openCalcs?: Record<string, { args: Record<string, unknown>; missing: string[]; turn: number }>;
};

export function emptyLoopState(): RagLoopState {
  return { v: 1, turn: 0, seq: 0, speakerId: null, subjectId: null, recentSubjectIds: [], pending: null, claim: null, evidence: {}, history: [], turns: [] };
}
