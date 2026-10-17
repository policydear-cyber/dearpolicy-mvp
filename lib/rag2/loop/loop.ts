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
import { STEM_SYN as TOPIC_SYN, sharedTopic, topicStems } from "./topic";
import { moneyFiguresIn, verifyAnswerFigures } from "@/lib/chat/answer-verification";
import type { ChatAnswer } from "@/types";
import { evidenceAt, refineEvidence, supportSpan, contextFor, type EvidenceRef } from "../evidence";
import type { TableValueOperand } from "../compute";
import type { SelectedValue } from "../tables";
import { loadDocs, loadPages, pageMap, policyFamily } from "../store";
import { householdBenefits, selectedFromBenefit } from "../benefits";
import type { PolicyCoverage } from "../policies";
import { calcOutcomes, figureFromEvidence } from "../calc/tool";
import { choosePercentRow, percentTables } from "../calc/pct-rows";
import { partsIn } from "../calc/case-terms";
import { paragraphs } from "../headings";
import { inventorySentences, type Inventory, type InventoryDoc } from "../inventory";
import type { CalcOutcome } from "../calc/engine";
import { createToolContext, RAG_TOOLS, recordsFor, runTool, validateArgs, type ToolContext } from "../tools";
import { loopLimits } from "@/lib/ai/usage";
import { CAUSE_KEYS, checkFact, confirmed, contentWords, EVENT_KEY, factConcept, householdOperandProblem, isoParts, knownFactFor, MECHANISM, normalizeKey, numbersIn, quotedFrom, sameFactValue } from "./facts";
import { calcRef, CLAIMED_AMOUNT_KEY, syncLoopClaimState } from "../calc/claim-record";
import { compoundQuestion, firstClauseOnly, relevantEvidence, resolverOf, statedInMessage } from "./questions";
import { internalIdsIn } from "./statements";
import { LoopUsageMeter, type MeterStop } from "./usage-meter";
import { ASK_USER, FINAL_ANSWER, LOOP_ACTIONS, normalizeCitationKeys, NOTE_FACTS, TERMINAL } from "./actions";
import { RENDERED, renderStatements } from "./statement-render";
import { applicabilityOf } from "../applicability";
import { composeFinal, rosterHeading, DATE_ABSENCE_REASON, DROPPED_NOTE, keepLimitationWithFigure, evidenceIdOf, evidenceTextOf, reportedFactFollowUp, REPORTED_MEDICAL_NOTE, REPORTED_NOTE, sayBack, type ComputeCall, type Composed } from "./compose";
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
      composed?: Composed | null;
      /** V1.2: figure-free lines said after the statements (what is still unresolved), from the grounded fallback. */
      trailing?: string[] }
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

/** V1.2: the household corrects a recorded fact -- they say so, or a count / amount / date / yes-no changes. A further
 * free-text detail with no such cue ("Transverse fracture." after "broke his leg") is an added detail. */
const CORRECTION_CUE = /\b(?:actually|sorry|apologies|i meant|i mean\b|meant to say|correction|correct that|my mistake|mistaken|mistake|wrong|instead|rather than|not (?:his|her|their|the|a|an|my|our|that|this|it|in|on)\b|it (?:was|is)n['’]t|wasn['’]t|isn['’]t)|^\s*no\b[,.!]?/i;
const SCALAR_FACT = (v: string) => /^-?\d+(?:[.,]\d+)?(?:\s+[A-Z]{3})?$/.test(v.trim()) || /^(?:yes|no|true|false|y|n)$/i.test(v.trim()) || /^\d{4}-\d{2}-\d{2}/.test(v.trim());
export function isCorrection(oldValue: string, newValue: string, message: string, words: string): boolean {
  if (CORRECTION_CUE.test(message) || CORRECTION_CUE.test(words)) return true;
  return SCALAR_FACT(oldValue) || SCALAR_FACT(newValue);
}

/** V1.2: the concise canonical sentence for a verified calculation record (conditional status from the record's kind,
 * never from the model's wording). Only the result is a money figure; percentages and words come from the record. */
export function canonicalCalcSentence(k: CalcOutcome): string {
  const amt = `${k.currency === "SGD" ? "S$" : (k.currency ?? "") + " "}${(k.amount ?? 0).toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const pcts = k.printed.filter((p) => p.unit === "percent").map((p) => p.value);
  const share = k.conditions.find((c) => c.id === "c_case");
  const caseText = share ? /^(.*?):\s*(\d+(?:\.\d+)?)%/.exec(share.text) : null;
  // The household's words are quoted only when they are one sentence (a quote is never split across sentences).
  const said = k.record?.assumption?.trim().replace(/[.!\s]+$/, "");
  const words = said && !/[.!?]\s/.test(said) ? said : null;
  const open = [...new Set(k.conditions.filter((c) => c.status === "unresolved" && c.id !== "c_case" && c.kind !== "day_count_rule")
    .map((c) => (c.kind === "definition" ? "the insurer must still accept it under the policy's own definition after its medical review" : c.text.replace(/[.\s]+$/, ""))))];
  // A stay: the duration counted from the household's own admission / discharge words, the printed rate, the amount,
  // and -- separately -- what the amount assumes about the limit's earlier use (not something the household said).
  if (k.kind === "indicative_estimate" && k.calculator === "hospital_cash" && k.record) {
    const rate = k.printed.find((p) => p.unit === "money");
    const hh = k.record.operands.filter((o) => o.source === "household" && (o.role === "admission" || o.role === "discharge")).map((o) => (o as { attribution?: string }).attribution).filter((w): w is string => !!w);
    const n = rate && rate.value > 0 && k.amount != null ? Math.round(k.amount / rate.value) : null;
    const rateTxt = rate ? `${rate.currency === "SGD" ? "S$" : (rate.currency ?? "") + " "}${rate.value.toLocaleString("en-SG")}` : null;
    const assumes = k.record.assumption?.trim().replace(/[.\s]+$/, "") || null;
    const counted = n != null && rateTxt ? `the stay counts as ${n} payable period${n === 1 ? "" : "s"} at ${rateTxt}, so ` : "";
    return `Indicative estimate: from the admission and discharge you gave${hh.length === 2 ? ` (“${hh[0].replace(/[.\s]+$/, "")}”; “${hh[1].replace(/[.\s]+$/, "")}”)` : ""}, ${counted}${k.benefit} works out at ${amt}${assumes ? `, ${assumes}` : ""}; it is not an approved payment${open.length ? `, and ${open.join("; ")}` : ""}.`;
  }
  if (k.kind === "indicative_estimate") return `Indicative estimate: based on what you told me${words ? ` (“${words}”)` : ""}, ${k.benefit} works out at ${amt}; it is not an approved payment${open.length ? `, and ${open.join("; ")}` : ""}.`;
  const limitOp = k.record?.operands.find((o) => o.id === "benefit_limit");
  const baseText = limitOp ? `the ${limitOp.label} of ${limitOp.currency === "SGD" ? "S$" : (limitOp.currency ?? "") + " "}${Number(limitOp.value).toLocaleString("en-SG")}` : "the Sum Insured";
  const what = `“${k.benefit}”${pcts[0] != null ? ` (${pcts[0]}% of ${baseText})` : ""}${caseText ? ` applies as ${caseText[1]} (${caseText[2]}% of that percentage)` : " applies"}`;
  return `If ${what}${words ? `, on what you told me (“${words}”)` : said ? ", on the facts you reported" : ""}, the indicative illustration is ${amt}; it is not an approved payment${open.length ? `, and ${open.join("; ")}` : ""}.`;
}

/** Reliable chat (contract B): which calculation contract the model is offered. "benefits" (the default and the only
 * one a production build accepts): the model selects a benefit and evaluate_benefit assembles the operands on the
 * server; `calculate` is offered only for a household bill against printed limits. "legacy-operands": the earlier
 * operand-assembly calculate (lump_sum / hospital_cash with value ids), kept only for the older scripted suites while
 * they are ported -- never in production. */
export function chatContract(env: Record<string, string | undefined> = process.env): "benefits" | "legacy-operands" {
  return env.DEARPOLICY_CHAT_CONTRACT === "legacy-operands" && env.NODE_ENV !== "production" ? "legacy-operands" : "benefits";
}
const BILL_ONLY = new Set(["calculator", "purpose", "subject_id", "policy_id", "benefit", "bill", "sub_limit_value_ids", "limit_value_ids", "passage_limits", "deductible_value_id", "co_insurance_value_id", "co_insurance_cap_value_id", "settled"]);
function billOnlyCalculate(t: { name: string; description: string; parameters: LoopToolSpec["parameters"] }): LoopToolSpec {
  const props = Object.fromEntries(Object.entries((t.parameters as { properties: Record<string, unknown> }).properties).filter(([k]) => BILL_ONLY.has(k)));
  props.calculator = { type: "string", enum: ["bill_reimbursement"] };
  return { name: t.name, description: "Work out a household's bill against the printed sub-limits / limits, deductible, co-insurance and co-insurance cap of one document (calculator bill_reimbursement), for one household member. A benefit that pays a percentage of a base or a daily rate is worked out with evaluate_benefit instead.", parameters: { ...(t.parameters as object), properties: props } as LoopToolSpec["parameters"] };
}
export function loopToolSpecs(env: Record<string, string | undefined> = process.env): LoopToolSpec[] {
  const legacy = chatContract(env) === "legacy-operands";
  return [...RAG_TOOLS.filter((t) => legacy ? t.name !== "evaluate_benefit" : true).map((t) => (t.name === "calculate" && !legacy ? billOnlyCalculate(t) : { name: t.name, description: t.description, parameters: t.parameters })), ...LOOP_ACTIONS];
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
  // (Actual-library findings: "If an Insured Person sustains bodily injury as a result of an Accident, which" was quoted
  // -- the first line of a wrapped sentence. The passage is read as its sentences, wrapped lines joined.)
  const all = paragraphs(e.passage.text).flatMap((p) => p.split(/(?<=[.;])\s+(?=[A-Z])/)).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  // Round 6 (A3): a heading ("Section 2 - What is covered") never says why a fact matters: prefer wording lines.
  const wording = all.filter((l) => /[.;:]$/.test(l) || l.split(" ").length > 8);
  const lines = wording.length ? wording : all;
  const score = (l: string) => (l.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => want.has(w.replace(/e?s$/, ""))).length;
  const best = [...lines].sort((a, b) => score(b) - score(a))[0] ?? "";
  return "“" + best + "”";
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
export const ANYONE = /^(?:(?:one|any|either|each|all|both|neither|none|some|whichever)(?: one)? of (?:us|you|them|the family|the kids|the children|my family|our family|our kids|our children)|anyone|anybody|someone|somebody|everyone|everybody|whoever|we|us|our|ours|the family|family|(?:my|our|the)(?: whole| entire)? (?:family|household)|(?:everyone|everybody|all of us) in (?:the|my|our) (?:family|household)|the household|any family member|a family member|family members|any of the kids|any of the children)$/i;
/** Lookups that read a policy's passages / rows. */
const LOOKUPS = new Set(["search_passages", "select_table_value", "read_page"]);
/** A table column whose values apply to a kind of person, a tier or a plan (the answer can differ by person). */
const PER_PERSON = new Set(["person_class", "tier", "plan"]);
/** Evidence that makes how an event happened matter: wording that distinguishes accidents (and so illness / other
 * causes) -- an accident-only benefit, an accidental definition, an illness exclusion. */
const CAUSE_WORDING = /\baccident(?:al|ally|s)?\b|\b(?:illness|sickness|disease)\b/i;
/** Tools that establish what a person's policies say: never run for a person until who is meant is settled. */
// (Actual-library findings: person_benefits and evaluate_benefit too -- with resolve_person called in the same step, an
// ambiguous mention stops the lookups that follow it)
const SUBJECT_TOOLS = new Set(["policies_for", "select_table_value", "search_passages", "person_benefits", "evaluate_benefit"]);

/** An inventory question: what / which policies, documents, files or plans the household (or a person) has. */
export const INVENTORY_QUESTION = /^(?![^]*\b(?:need|needed|required|requires?|submit|provide|bring|send|attach)\b)[^]*(?:\b(?:what|which|list|show|tell me|give me)\b[^?.!]*\b(?:policies|documents|uploads|files|plans|(?:every|all|each|any) (?:of (?:the|our|my) )?(?:polic(?:y|ies)|documents?|files?|uploads?))\b|\b(?:polic(?:y|ies)|documents?|files?)\b[^?.!]*\b(?:on file|uploaded|do (?:we|i) have|does \w+ have)\b|\b(?:our|my|the household'?s?) (?:document )?library\b|\bwhat plans? does\b)/i;

/** Reliable chat (recorded failure 4): the documents are asked about only to choose which ones to CLAIM under / which
 * apply or pay ("which of my uploaded policies should I claim under for Adrian's accident?") -- an event question about
 * benefits, not a request for the library list. A separate inventory clause ("..., and which documents do we have for
 * him?") is still an inventory side question. */
const EVENT_WORDS = /\b(?:died|dies|death|passed away|accident\w*|injur\w*|hospital\w*|warded|admitted|fractur\w*|broke|broken|surgery|operation|diagnos\w*|illness|sick|cancer|claim\w*)\b/i;
export const CLAIM_SELECTION_QUESTION = /\b(?:which|what)\b[^?.!,;]*\b(?:polic(?:y|ies)|documents?|plans?|covers?|insurances?)\b[^?.!,;]*\b(?:claim\w*|apply|applies|cover|covers|pay|pays|payable|use)\b/i;

export async function runLoop(input: LoopInput): Promise<LoopOutput> {
  const env = input.env ?? process.env;
  const limits = loopLimits(env);
  const state: RagLoopState = structuredClone(input.state);
  state.turn += 1;
  state.speakerId = state.speakerId ?? input.speakerId ?? null;
  if (!state.subjectId && input.initialSubjectId) state.subjectId = input.initialSubjectId;
  const householdIds = new Set(input.people.map((p) => p.id));
  const ctx = createToolContext({ accountId: input.accountId, speakerId: state.speakerId, lastSubjectId: state.subjectId, asOf: input.asOf ?? null });
  ctx.topicText = [...state.history.map((h) => h.user), input.message].join(" ");
  ctx.conversation.recentSubjectIds = [...state.recentSubjectIds];
  ctx.seq = state.seq;
  const computeCalls = new Map<string, ComputeCall>();
  // Agent F (D6): evidence remembered from earlier turns is re-checked every turn: a document deleted, replaced by a
  // newer version, or not this household's supplies nothing any more (the composer refuses sentences citing it).
  const { stale, policyNames, docFacts } = await revalidateEvidence(input.accountId, state);
  // V1.1 (grounded negatives): the full stored text of every readable document of this household, so a sentence that
  // says something is NOT in a document (or in the library) is checked against the whole document, never a passage.
  const libraryText = await loadLibraryText(input.accountId).catch(() => undefined);
  const libraryPages = await loadLibraryPages(input.accountId).catch(() => undefined);
  // V1.4: each member's documented benefits with explicit identities (lib/rag2/benefits.ts): which product / benefit a
  // printed figure is, and which insurers a statement about a member may name.
  const benefitView = await householdBenefits(input.accountId).catch(() => null);
  // Round 7: table values issued in earlier turns stay citable (value ids are unique across the conversation) while
  // their document is still current; a benefit already stated, cited and bound stays available to explain again.
  for (const [id, v] of Object.entries(state.values ?? {})) {
    const eid = v?.operand?.evidence ? evidenceIdOf(state, v.operand.evidence, "select_table_value") : null;
    if (eid && !stale.has(eid)) ctx.values.set(id, v as Parameters<typeof ctx.values.set>[1]);
  }
  if (state.established) state.established = state.established.filter((e) => e.evidenceIds.every((id) => state.evidence[id] && !stale.has(id)) && e.valueIds.every((id) => ctx.values.has(id)));
  /** Integration (agent C's request 3): what the latest calculate result for each person still needs from the
   * household (fact key, why, the evidence ids that make it matter), in the order it should be asked. */
  /** V1.2: the household facts each benefit's calculation still needs, per person AND per benefit (one benefit's open
   * requirement never hides another's). */
  const calcMissingBy = new Map<string, Map<string, { key: string; why: string; evidenceIds: string[] }[]>>();
  const calcMissing = { get: (subject: string) => [...(calcMissingBy.get(subject)?.values() ?? [])].flat(), benefitOf: (subject: string, key: string) => [...(calcMissingBy.get(subject)?.entries() ?? [])].find(([, items]) => items.some((m) => m.key === key)) ?? null };
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
  const tools = loopToolSpecs(env);
  let reply: LoopReply | null = null;
  const t0 = Date.now();
  const toolMs: Record<string, { n: number; ms: number }> = {};
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
    if (pendingBefore.purpose === "speaker") { state.speakerId = id; state.speakerConfirmed = true; ctx.conversation.speakerId = id; }
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
  /** PR #54 follow-up: an illustration worked out earlier for a benefit whose own definition the household's (corrected)
   * report now contradicts ("it was actually an open fracture" after a Simple Fracture illustration) is withdrawn --
   * on the claim and in what the model is shown -- and the answer says so once. */
  const withdrawInapplicable = (subj: string, benefitId: string, why: string) => {
    const rec = ctx.benefitRecords?.get(benefitId);
    const claim = state.claim?.subjectId === subj ? state.claim : state.otherClaims?.[subj];
    if (!rec || !claim) return;
    const gone = Object.entries(claim.calcs ?? {}).filter(([, r]) => !r.withdrawn && r.policyId === rec.policy.id && r.benefit.toLowerCase() === rec.benefit.toLowerCase());
    if (!gone.length) return;
    for (const [, r] of gone) r.withdrawn = { cause: "fact", key: "applicability", reason: `${rec.benefit} no longer fits what the household reported (${why})`, turn: state.turn };
    const sentences = claim.derived.filter((d) => d.sentence.includes(rec.benefit)).map((d) => d.sentence);
    claim.derived = claim.derived.filter((d) => !sentences.includes(d.sentence));
    if (sentences.length) scrubWithdrawn(sentences);
    const app = rec.definitions.length ? applicabilityOf(rec.benefit, rec.definitions, householdReports(subj, claim.facts)) : null;
    const prior = app && app.status !== "unconstrained" ? app.attribute.values.map((v) => v.id).find((v) => v !== app.reported.value) ?? null : null;
    const existing = corrections.find((c) => c.key !== "person" && c.withdrawn.length === 0 && app && app.status !== "unconstrained" && normalizeKey(c.key) === app.attribute.factKey);
    if (existing) existing.withdrawn.push(...(sentences.length ? sentences : [rec.benefit]));
    else if (!corrections.some((c) => c.key !== "person" && c.withdrawn.some((w) => w.includes(rec.benefit))))
      corrections.push({ key: app && app.status !== "unconstrained" ? app.attribute.factKey : "applicability", from: prior ? app!.status !== "unconstrained" ? app!.attribute.said(prior) : prior : "earlier", to: app && app.status !== "unconstrained" && app.reported.value ? app.attribute.said(app.reported.value) : "changed", withdrawn: sentences.length ? sentences : [rec.benefit] });
  };
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
    // V1.1: the household correcting WHO it is about ("it was Cai, not Bea") moves the claim, and the question asked
    // about the first person is withdrawn with it (it was asked because of that person's documents).
    const correcting = PERSON_CORRECTION.test(input.message);
    const hold = speakerAside || (!correcting && state.pending?.kind === "fact" && state.pending.subjectId && state.pending.subjectId !== subject);
    if (hold) { (state.otherClaims ??= {})[subject] = parked; return parked; }
    if (correcting && state.pending?.kind === "fact" && state.pending.subjectId && state.pending.subjectId !== subject) state.pending = null;
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
  /** Reliable chat: benefits this turn found the household's reported case is not one of (per person). */
  const unlistedNow = new Map<string, { benefit: string; labels: string[] }>();
  /** rc-live-3: per person, the benefit whose case evaluate_benefit could not settle this turn (missing / ambiguous). */
  const caseOpenNow = new Map<string, string>();
  /** Actual-library findings (16 Oct): what an evaluation still needs, created by the SERVER when it evaluates a benefit
   * (needs_facts / case_conflict) -- identified, scoped to one person and one benefit, with the state key the answer is
   * recorded under and the evidence that makes it matter. The model selects one (requirement_id) and phrases the question;
   * it never reconstructs this metadata. Open for this turn only: a requirement of an earlier turn is stale. */
  type Requirement = { id: string; subjectId: string; benefitId: string; benefit: string; factKey: string; question: string; options: string[]; optionLabels?: Map<string, string>; evidenceIds: string[]; isCase: boolean;
    /** PR #54 follow-up: who can resolve it -- the household (a fact they report or can observe) or the insurer (an
     * assessment or approval: stated as a condition, never asked). */
    resolvedBy: "household" | "insurer" };
  const requirements = new Map<string, Requirement>();
  /** PR #54 follow-up: benefits whose own definition the household's report contradicts (per person|benefit, why). */
  const notApplicable = new Map<string, string>();
  let reqSeq = 0;
  let budgetWarned = false;
  /** Round 7 (A3): tool calls already made this turn (name + arguments): an identical repeat is not run again. */
  const madeCalls = new Set<string>();
  /** What the composer checks a sentence against (final_answer, and what ask_user says before its question). */
  const composeCtx = () => ({ state, tools: ctx, computeCalls, householdIds, userText: input.message, userTexts, names: input.people.map((p) => p.name), stale, policyNames, docFacts, libraryText, libraryPages, benefits: benefitView, people: input.people.map((p) => ({ id: p.id, names: personNames(p.name) })) });
  /** PR #54 follow-up: what the household reported about one person, oldest first -- the facts recorded for them (with
   * their keys) and, for what no fact records, the sentences of their own messages that name no other member (a
   * question or a what-if is not a report). Each says whether its message corrected something. */
  const householdReports = (subj: string, facts: Record<string, import("./types").LoopFact>): import("../applicability").Reported[] => {
    const out: import("../applicability").Reported[] = Object.entries(facts).filter(([, f]) => f && (f.source ?? "user_reported") === "user_reported")
      .map(([key, f]) => ({ key, words: `${f.words} ${typeof f.value === "string" ? f.value : ""}`.trim(), turn: f.turn, cue: !!f.cue }));
    const others = input.people.filter((p) => p.id !== subj).flatMap((p) => personNames(p.name)).filter((n) => !input.people.find((x) => x.id === subj && personNames(x.name).includes(n)));
    const named = (t: string) => others.some((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t));
    userTexts.forEach((m, i) => {
      if (named(m)) return;
      const turn = state.turn - (userTexts.length - 1 - i);
      for (const sent of m.split(/(?<=[.!?])\s+/)) if (sent.trim() && !/\?\s*$/.test(sent) && !/\b(?:if|what if|suppose|supposing|would|were it)\b/i.test(sent)) out.push({ key: null, words: sent.trim(), turn, cue: CORRECTION_CUE.test(m) });
    });
    return out.sort((a, b) => a.turn - b.turn);
  };
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
  /** V1.2: calculation results a reply of this turn tried to state (result_id / result_ids), dropped or not. */
  const attemptedResults = new Set<string>();
  /** V1.2: of those, the ones whose sentence was refused for its substance (not only its wording). */
  const substantiveDrops = new Set<string>();
  // (Calling it a payout is a substantive misstatement of what the figure is, not wording: never restored.)
  const WORDING_DROP = /^an illustration must state its what-if|^shows an internal id/;
  /** V1.2: printed money figures a composed reply of this turn bound to its source, per person (cents). */
  const boundAmounts = new Map<string, Set<number>>();
  const noteDrops = (sentencesIn: Record<string, unknown>[], c: Composed) => {
    for (const b of c.figureBindings) if (b.subjectId && typeof b.value === "number") { const m = boundAmounts.get(b.subjectId) ?? new Set<number>(); m.add(Math.round(b.value * 100)); boundAmounts.set(b.subjectId, m); }
    for (const d of c.dropped) {
      // Wording only when the sentence itself presents the figure as conditional ("the conditional illustration is ...")
      // and merely lacks the canonical "if"; a figure stated as fact ("his stay comes to S$330") is not restated.
      if (WORDING_DROP.test(d.reason) && /\b(?:illustrat\w*|conditional\w*|what[- ]if|hypothetical\w*|indicative)\b/i.test(d.sentence)) continue;
      const src = sentencesIn.find((x) => String(x?.text ?? "").replace(/\s+/g, " ").trim() === d.sentence.replace(/\s+/g, " ").trim());
      for (const id of [src?.result_id, ...(Array.isArray(src?.result_ids) ? src!.result_ids as unknown[] : [])]) if (typeof id === "string") substantiveDrops.add(id);
    }
  };
  /** V1.2: the turn's one completion nudge (a new fact left unaddressed) has been given. */
  let completionNudged = false;
  /** V1.2: the one refusal of a question that addresses the person typing about someone else's injury. */
  let secondPersonWarned = false;
  let bindSeq = 0;
  /** V1.3: the household's document inventory, when the household_documents tool ran this turn. */
  let inventoryNow: Inventory | null = null;
  /** V1.3: facts refused this turn because the date or time does not exist: asking for them again is the next step. */
  const invalidNow = new Set<string>();
  /** V1.2: calculations completed this turn from an earlier unresolved one, once the household gave its missing facts. */
  const completedCalcs: CalcOutcome[] = [];
  /** V1.2: what a claim turn's reply leaves out of what the household just told it -- a hospital stay or a bill they
   * reported that no sentence addresses, and a percentage of the sum insured stated (or just asked about) without the
   * person's own sum insured. Lines for the turn's one repair; empty when nothing is missing. */
  /** V1.2: the text states one of the person's own printed amounts read this conversation (a sum insured). */
  const statesOwnAmount = (text: string, subject: string) => moneyFiguresIn(text).some((f) => boundAmounts.get(subject)?.has(Math.round(f.value * 100)) || [...ctx.values.values()].some((v) => v.subjectId === subject && v.operand.valueKind === "money" && v.operand.cents != null && Math.abs(f.value * 100 - v.operand.cents) < 1));
  const completionLines = (texts: string[], question: string | null, subject: string | null | undefined, extraEvidence: string[] = []): string[] => {
    if (!subject) return [];
    const now = recordedNow.filter((r) => r.subject === subject);
    if (!now.length) return [];
    const said = [...texts.filter((t) => !/^\s*you (?:told me|said|mentioned)\b/i.test(t)), question ?? ""].join(" ");
    const lines: string[] = [];
    const ADDRESSES = { stay: /\b(?:hospital\w*|warded|ward|in-?patient|confine\w*|admi\w*|discharg\w*|nights?|stay)\b/i, bill: /\b(?:bill\w*|expenses?|reimburs\w*|costs?|charges?|invoice)\b/i };
    // With this turn's facts, the ones reported earlier in this claim that no reply has addressed yet.
    const claimFacts = state.claim?.subjectId === subject ? state.claim.facts : state.otherClaims?.[subject]?.facts ?? {};
    const earlier = Object.entries(claimFacts).filter(([k]) => !now.some((r) => r.key === k)).map(([key, f]) => ({ key, words: f.words, subject }))
      .filter((f) => { const c = factConcept(f.key).concept; const re = c === "bill" ? ADDRESSES.bill : ADDRESSES.stay; return (c === "bill" || c === "stay_length" || c === "admission" || c === "discharge" || c === "hospital") && !state.history.some((h) => re.test(h.assistant.replace(/You told me[^.]*\./g, ""))); });
    const facts = [...now, ...earlier];
    for (const f of facts) {
      const c = factConcept(f.key).concept;
      const kind = c === "stay_length" || c === "admission" || c === "discharge" || c === "hospital" ? "stay" : c === "bill" ? "bill" : null;
      if (!kind || ADDRESSES[kind].test(said)) continue;
      lines.push(`the household also told you \"${f.words}\" (${f.key}) and the reply does not address it: look up the benefit it bears on (search_passages${kind === "stay" ? ", e.g. hospital income / hospital cash" : ", e.g. medical expenses"}) and state its printed rate or limit and its rule, cited, or say plainly what is still needed (${kind === "stay" ? "e.g. the admission and discharge dates and times; nights are not payable days" : "e.g. the bill amount"})`);
    }
    const ctxText = [said, ...extraEvidence.map((id) => state.evidence[id]?.passage.text ?? "")].join(" ");
    if (/%\s*of (?:the )?sum (?:insured|assured)|percentage shown|\bof the sum (?:insured|assured)\b/i.test(ctxText) && !statesOwnAmount(said, subject)) {
      const who = input.people.find((p) => p.id === subject)?.name ?? "the person";
      // (Actual-library findings: on the active route the repair names the current contract -- evaluate_benefit, whose
      // server reads the person's own sum insured -- never the retired model-facing lump_sum operands.)
      lines.push(chatContract(env) === "benefits"
        ? `the benefit is a percentage of the Sum Insured but no amount is given: call evaluate_benefit with its benefit_id (from person_benefits) and the case in the household's words -- the server reads ${who}'s own sum insured and says the date it is printed as of -- and state its result_id as a statement of kind calculation; if a case is still open, ask_user with the requirement_id it returns`
        : `the benefit is a percentage of the Sum Insured but no amount is given: read ${who}'s own sum insured from their certificate or schedule (policies_for, then select_table_value; say the date it is printed as of) and give calculate lump_sum illustrations for the rows that could apply (with proportion for a share the wording prints), each with its condition -- never approved, never current cover`);
    }
    return lines;
  };
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
    // V1.2: with them, the subject's other printed figures already stated (e.g. the certificate's sum insured that a
    // schedule percentage is of), so a re-explanation connects the clause to its amount instead of repeating it.
    const figures = usable.filter((e) => e.valueIds.length && !related.includes(e));
    const chosen = related.length ? [...figures.slice(-2), ...related.slice(-2)] : usable.filter((e) => e.turn === pending.turn).slice(-3);
    return chosen.slice(-4);
  };
  const cited = (c: Composed) => c.sentences.some((s) => s.evidenceIds.length > 0);
  const squashW = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  /** Whether every one of the household's words is already quoted by the answer (an echo would only repeat them). */
  const quotesAnswer = (c: Composed, words: string[]) => { const all = squashW(c.sentences.map((s) => s.text).join(" ")); return words.length > 0 && words.every((w) => !!squashW(w) && all.includes(squashW(w))); };
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
        const more = completionLines(composed.sentences.map((x) => x.text), null, ans.subject, ans.pending.evidenceIds ?? []);
        if (more.length) completionNudged = true;
        return { composed, repair: `the household answered your question (\"${ans.pending.question}\")${why}. Do not only say back what they told you. Answer with final_answer (or ask_user, when one detail the household can give still changes the result): (1) what they told you, as \"You told me ...\" -- their report, never reviewed medical evidence, an approval or a payment; (2) the benefit explained again with its citation, as established earlier in this conversation: ${est.map((e) => `\"${e.text}\" evidence_ids=[${e.evidenceIds.join(", ")}] value_ids=[${e.valueIds.join(", ")}]${e.benefit ? ` benefit=\"${e.benefit}\"` : ""}`).join("; ")}; (3) what their answer changes and what is still open${more.length ? `; also: ${more.join("; ")}` : ""}. Keep any remark about the insurer's review or claim paperwork to one short line, and only if it was not said earlier.` };
      }
      // The model repeated it: the answer is composed from what the conversation already established (and checked by
      // the same composer and save-time gate as any sentence the model writes).
      const fallback = composeFinal({ sentences: [...echoes, ...est.map((e) => ({ text: e.text, evidence_ids: e.evidenceIds, value_ids: e.valueIds, ...(e.benefit ? { benefit: e.benefit } : {}), ...(e.subjectId ? { subject_id: e.subjectId } : {}) }))], nextSteps, subjectId: subjectId ?? ans.subject }, composeCtx());
      if (cited(fallback)) out = fallback;
    } else if (cited(out) && !attributed(out) && echoes.length && !quotesAnswer(out, ans.facts.map((f) => f.words))) {
      // (Actual-library findings: not when the answer already quotes their words -- a calculation's "as you described")
      const again = composeFinal({ sentences: [...echoes, ...sentencesIn], nextSteps, subjectId }, composeCtx());
      if (cited(again)) out = again;
    }
    // V1.2: the note that their report is not reviewed evidence, and the paperwork step, are said once per conversation.
    const toldBefore = (t: string) => state.history.some((h) => h.assistant.includes(t));
    if (cited(out) && !toldBefore(REPORTED_NOTE) && !toldBefore(REPORTED_MEDICAL_NOTE)) {
      // V1.4: medical or not is decided by the condition the answered question was about (its "why" and the lines of
      // its own evidence that state that condition) -- not by every passage the answer cites (a Term Life summary that
      // also mentions a Terminal Illness diagnosis made s50-live-2's death answer ask for a doctor's report).
      const whyWords = new Set((String(ans.pending.why ?? "").toLowerCase().match(/[a-z]{4,}/g) ?? []));
      const conditionLines = (ans.pending.evidenceIds ?? []).flatMap((id) => (state.evidence[id]?.passage.text ?? "").split(/\n+|(?<=[.;])\s+/)).filter((l) => (l.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => whyWords.has(w)).length >= 3);
      const f = reportedFactFollowUp([String(ans.pending.why ?? ""), ...conditionLines]);
      if (![...out.sentences.map((s) => s.text), ...out.notes].some((t) => /\binsurer\b/i.test(t))) out.notes = [...out.notes, f.note];
      if (!out.nextSteps.length) out.nextSteps = [f.step];
    }
    return { composed: out, repair: null };
  };
  /** Composer drop reasons that are about wording only (the figure itself was not refused). */
  const FORM_DROP = /^shows an internal id|^calls (?:a calculated benefit|an amount) a payout|^an illustration must state its what-if/;
  const UNPRINTED_DROP = /is printed in none of the evidence the sentence cites$|does not name the benefit as the line printing it words it/;
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
    if (!completionNudged) { const more = completionLines([...c.sentences.map((s) => s.text), ...c.dropped.map((d) => d.sentence)], null, subject, pendingBefore?.kind === "fact" ? pendingBefore.evidenceIds ?? [] : []); if (more.length) { completionNudged = true; return more.map((m) => m.charAt(0).toUpperCase() + m.slice(1) + "."); } }
    const need = stillMissing(subject);
    if (need.length) return [`the calculation still needs ${need[0].key} from the household (${need[0].why}), and the answer does not ask for it: end the turn with ask_user kind=fact for exactly that (fact_key ${need[0].key}${need[0].evidenceIds.length ? `, citing ${[...new Set(need[0].evidenceIds)].slice(0, 3).join(", ")}` : ""}), giving what is already established as statements.`];
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
    if (texts.length) try { problems = await verifyAnswerFigures(draft, { accountId: input.accountId, userText: input.message, report: true, priorUserTexts: state.history.map((h) => h.user) }); } catch { return null; }
    const squash = (x: string) => x.replace(/\s+/g, " ").trim().toLowerCase();
    const lines = problems.flatMap((p) => {
      const b = squash(p.sentence);
      const own = c.sentences.find((s) => { const a = squash(s.text); return !!b && (a.includes(b) || b.includes(a)); });
      if (!own) return [];
      gateRejected.add(own.text);
      // V1.2: a calculation in a sentence the gate refused is refused for its substance: never restored by the fallback.
      for (const rec of c.calculations) if (rec.sentence && own.text.includes(rec.sentence)) for (const k of c.calcs) if (k.benefit === rec.benefit && k.amount === rec.result.value) substantiveDrops.add(k.calcId);
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
  /** PR #54 (rc-live-8): for each model statement the composer omitted whole, the one benefit record offered this turn
   * that it is about -- its benefit_id, else the benefit it names (its benefit field or its text) in a document it
   * cites -- as a benefit_terms statement to render; none when that is not exactly one record, when the answer already
   * states that record's terms, or when the record's amounts conflict. */
  const retainedTerms = (sentences: Record<string, unknown>[], dropped: { sentence: string; reason: string }[], subject: string): Record<string, unknown>[] => {
    const norm = (t: unknown) => String(t ?? "").toLowerCase().replace(/[“”"’']/g, "").replace(/\s+/g, " ").trim();
    const lost = dropped.filter((x) => !/said as printed instead$/.test(x.reason)).map((x) => norm(x.sentence)).filter((x) => x.length > 20);
    const records = [...(ctx.benefitRecords?.values() ?? [])];
    const stated = new Set(sentences.filter((x) => x?.kind === "benefit_terms").map((x) => String(x.benefit_id ?? "")));
    const out: Record<string, unknown>[] = [];
    for (const s of sentences) {
      if (!s || typeof s !== "object" || s.kind === "benefit_terms" || s.kind === "calculation" || RENDERED.has(s)) continue;
      const t = norm(s.text);
      if (!t || !lost.some((x) => t.includes(x) || x.includes(t))) continue;
      const who = typeof s.subject_id === "string" ? s.subject_id : subject;
      const cited = new Set((Array.isArray(s.evidence_ids) ? s.evidence_ids : []).map((id) => state.evidence[String(id)]?.policyId).filter(Boolean));
      const mine = records.filter((r) => r.memberId === who && r.status !== "conflicting" && r.kind !== "percentage_schedule");
      let c = typeof s.benefit_id === "string" ? mine.filter((r) => r.id === s.benefit_id) : [];
      if (!c.length) c = mine.filter((r) => r.benefit.length >= 8 && (norm(s.benefit) === norm(r.benefit) || t.includes(norm(r.benefit))) && cited.has(r.policy.id));
      if (c.length !== 1 || stated.has(c[0].id)) continue;
      stated.add(c[0].id);
      out.push({ kind: "benefit_terms", benefit_id: c[0].id, subject_id: who, evidence_ids: [] });
    }
    return out;
  };
  const action = (call: ToolCall): { result: Record<string, unknown>; terminal?: LoopReply } => {
    const a = { ...call.arguments };
    if (call.name === "final_answer" || call.name === "ask_user") for (const x of ((a.sentences ?? a.statements) as Record<string, unknown>[] | undefined) ?? []) {
      for (const id of [x?.result_id, ...(Array.isArray(x?.result_ids) ? x.result_ids : [])]) if (typeof id === "string" && id) attemptedResults.add(id);
    }
    if (call.name === NOTE_FACTS.name && Array.isArray(a.facts)) a.facts = (a.facts as Record<string, unknown>[]).map((f) => ({ ...f, value: f?.value == null ? f?.value : String(f.value) }));
    const spec = [NOTE_FACTS, ASK_USER, FINAL_ANSWER].find((s) => s.name === call.name)!;
    // V1.4: ids written as object keys instead of in their citation field are moved there (unambiguous only).
    const moved = call.name === "note_facts" ? [] : normalizeCitationKeys(a.sentences ?? a.statements);
    if (moved.length) (trace.adjusted ??= []).push(`${call.name}: ${moved.join("; ")}`);
    const bad = validateArgs(spec.parameters, a);
    if (bad) return { result: { ok: false, error: bad } };
    if (call.name === "note_facts") {
      const subject = (a.subject_id as string) ?? state.claim?.subjectId ?? state.subjectId;
      if (!subject || !householdIds.has(subject)) return { result: { ok: false, error: "subject_id must be a household member (resolve the person first)" } };
      if (unsettled.has(subject)) return { result: { ok: false, error: "who is meant is not settled yet: ask which person the household means before recording facts about one of them" } };
      const claim = claimFor(subject);
      const recorded: string[] = [], refused: { key: string; error: string }[] = [], unconfirmed: string[] = [], corrected: { key: string; from: unknown; to: unknown; withdrawn: string[] }[] = [], asSaid: string[] = [], added: { key: string; detail_of: string }[] = [];
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
          } else { refused.push({ key, error: chk.error }); if (/is not a (?:calendar date|time of day)/.test(chk.error)) invalidNow.add(key); }
          continue;
        }
        const value = f.currency ? `${String(f.value)} ${f.currency.toUpperCase()}` : String(f.value);
        const words = docText != null ? (f.words?.trim() || state.evidence[docIds[0]].passage.text.slice(0, 160)) : String(f.words);
        const entry = { value, words, turn: state.turn, source: chk.source, basis: chk.basis, ...(docIds.length ? { evidenceIds: docIds } : {}), ...(CORRECTION_CUE.test(input.message) ? { cue: true } : {}) };
        // Agent G: the same fact recorded earlier under another key (admission_date / admitted_at, bill / bill_amount,
        // claim_amount / amount_claimed) with another value is a correction of it, not a second fact.
        const oldKey = claim.facts[key] ? key : sameFactKey(claim, key, value);
        const old = oldKey ? claim.facts[oldKey] : undefined;
        // V1.2: a further detail about something already recorded ("transverse fracture" after "broke his leg") is
        // new information, not a correction: it is kept beside the first report under its own key, and nothing worked
        // out from that report is withdrawn. A value is corrected only when the household says so ("actually",
        // "sorry", "not ...", "I meant") or when a count, amount, date or yes/no changes.
        // V1.3: the same value again in another representation (the same date-time with its time zone added) is not a
        // change: the more precise representation is kept, nothing is withdrawn and no correction is shown.
        if (old && String(old.value) !== value && sameFactValue(old.value, value)) {
          if (value.length > String(old.value).length) claim.facts[oldKey!] = { ...old, value };
          recorded.push(oldKey!); recordedNow.push({ key: oldKey!, words: entry.words, subject });
          const answersSame = (p: LoopPending | null | undefined) => p?.kind === "fact" && (p.subjectId ?? subject) === subject && p.factKey === oldKey;
          if (answersSame(state.pending)) state.pending = null;
          continue;
        }
        if (old && String(old.value) !== value && !isCorrection(String(old.value), value, input.message, String(f.words ?? ""))) {
          let detailKey = `${key}_detail`;
          for (let n = 2; claim.facts[detailKey] && String(claim.facts[detailKey].value) !== value; n++) detailKey = `${key}_detail_${n}`;
          if (!claim.facts[detailKey]) claim.facts[detailKey] = entry;
          recorded.push(detailKey); added.push({ key: detailKey, detail_of: oldKey ?? key });
          recordedNow.push({ key: detailKey, words: entry.words, subject });
          if (chk.basis === "paraphrased") unconfirmed.push(detailKey);
          const answersDetail = (p: LoopPending | null | undefined) => p?.kind === "fact" && (p.subjectId ?? subject) === subject && (p.factKey === key || p.factKey === detailKey);
          if (answersDetail(state.pending)) state.pending = null;
          if (answersDetail(state.parkedPending)) state.parkedPending = null;
          continue;
        }
        if (old && String(old.value) !== value) {
          const hit = (ks: string[]) => ks.includes(key) || (!!oldKey && ks.includes(oldKey));
          const withdrawn = claim.derived.filter((d) => hit(d.factKeys)).map((d) => d.sentence);
          claim.derived = claim.derived.filter((d) => !hit(d.factKeys));
          // Every calculation worked out from the old value is withdrawn (and marked so on the claim record).
          // (rc-live-2 RCT2b: a calculation shown in a turn that ended with a question has no "derived" sentence, so the
          // withdrawal was recorded but not said; every calculation withdrawn here now counts for the note)
          const calcsWithdrawn: string[] = [];
          for (const [cid, r] of Object.entries(claim.calcs ?? {})) if (!r.withdrawn && hit(r.factKeys)) { r.withdrawn = { cause: "fact", key, reason: `${key.replace(/_/g, " ")} was corrected (from ${String(old.value)} to ${value})`, turn: state.turn }; calcsWithdrawn.push(cid); }
          if (oldKey && oldKey !== key) delete claim.facts[oldKey];
          claim.facts[key] = { ...entry, previous: [...(old.previous ?? []), { value: old.value, words: old.words, turn: old.turn, source: old.source, basis: old.basis }] };
          corrected.push({ key, from: old.value, to: value, withdrawn: [...withdrawn, ...calcsWithdrawn.filter(() => !withdrawn.length)] });
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
      return { result: { ok: true, recorded, ...(unconfirmed.length ? { unconfirmed, note: "unconfirmed facts are the household's report in your words, not confirmed values: they cannot be used in a calculation; ask to confirm if one matters" } : {}), ...(refused.length ? { refused } : {}), ...(asSaid.length ? { recorded_as_said: asSaid } : {}), ...(added.length ? { added_details: added, note_added: "each added detail is new information kept beside the earlier report (not a correction): say what it changes, if anything" } : {}), corrected, facts: claim.facts } };
    }
    if (call.name === "ask_user") {
      let question = String(a.question ?? "").trim();
      if ((question.match(/\?/g) ?? []).length !== 1 || !question.endsWith("?")) return { result: { ok: false, error: "ask exactly one question, ending with a question mark" } };
      // V1.2: "what were the times, and had any benefit been paid?" asks its first clause now; the second is its own
      // question for a later turn.
      const one = firstClauseOnly(question);
      if (one) { (trace.adjusted ??= []).push(`asked one clause: "${one}" (not "${question.slice(one.length - 1).trim()}")`); question = one; }
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
        noteDrops(spoken, composed);
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
      // Actual-library findings: the requirement the server created when it evaluated the benefit -- named by the model
      // (requirement_id), or, when the model gave no fact_key, the one requirement open this turn for that person. A
      // requirement this turn did not create, or one for another person or fact, is refused.
      let req: Requirement | null = null;
      const reqId = typeof a.requirement_id === "string" ? a.requirement_id.trim() : "";
      const openList = () => [...requirements.values()].map((r) => `${r.id} (${r.benefit}, for ${input.people.find((p) => p.id === r.subjectId)?.name ?? r.subjectId}: ${r.question})`).join("; ");
      if (reqId) {
        req = requirements.get(reqId) ?? null;
        // PR #54 follow-up: nothing is open this turn -- the benefit the question would have been about was found not to
        // fit what the household reported -- so there is no question to ask: what the ask states (composed and checked
        // like any answer) is the answer.
        if (!req && !requirements.size && notApplicable.size && Array.isArray(a.statements) && (a.statements as unknown[]).length) {
          const fin = action({ id: call.id, name: "final_answer", arguments: { sentences: a.statements, subject_id: a.subject_id ?? null, ...(a.next_steps ? { next_steps: a.next_steps } : {}) } });
          if (fin.terminal) { (trace.adjusted ??= []).push(`ask_user (${reqId}): no requirement is open (${[...notApplicable.values()].length} benefit(s) do not fit the report) -- answered with its statements instead of asking`); return fin; }
        }
        if (!req) return { result: { ok: false, error: `requirement_id ${reqId} is not open this turn${requirements.size ? `; open: ${openList()}` : " (no evaluation this turn left one: call evaluate_benefit for the benefit first)"}` } };
        if (typeof a.subject_id === "string" && a.subject_id.trim() && a.subject_id !== req.subjectId) return { result: { ok: false, error: `requirement ${req.id} is for ${input.people.find((p) => p.id === req!.subjectId)?.name ?? "another person"}, not subject_id ${a.subject_id}` } };
        if (typeof a.fact_key === "string" && a.fact_key.trim() && normalizeKey(a.fact_key) !== req.factKey && !(req.isCase && /case|bone|fractur|site|part|injur/i.test(a.fact_key))) return { result: { ok: false, error: `requirement ${req.id} records its answer as ${req.factKey}, not ${a.fact_key}: pass requirement_id alone` } };
      } else if (!normalizeKey(a.fact_key)) {
        const subj0 = typeof a.subject_id === "string" && a.subject_id.trim() ? a.subject_id : null;
        const open = [...requirements.values()].filter((r) => !subj0 || r.subjectId === subj0);
        const fits = (r: Requirement) => relevantEvidence(question, r.factKey.replace(/_/g, " ") + " " + r.benefit, [r.question, ...r.options.map((o) => r.optionLabels?.get(o) ?? ""), ...r.evidenceIds.map((id) => state.evidence[id]?.passage.text ?? "")], input.people.map((p) => p.name));
        if (open.length === 1 && fits(open[0])) { req = open[0]; (trace.adjusted ??= []).push(`ask_user without fact_key: bound to requirement ${req.id} (${req.benefit}), the one open requirement this turn`); }
        else return { result: { ok: false, error: open.length ? `a fact question names what it asks: pass requirement_id (open: ${openList()})` : "a fact question needs the fact_key its answer is recorded under" } };
      }
      // PR #54 follow-up: who resolves it. A requirement the insurer resolves is stated as a condition, never asked. A
      // server requirement asks a household fact by construction: worded as an assessment of the policy terms (or
      // naming none of its options), its own question is asked instead. A free question asking for an assessment of the
      // terms is the insurer's -- refused, with what is supported kept.
      if (req && req.resolvedBy === "insurer") { noteFailure("ask_user"); return { result: { ok: false, error: `requirement ${req.id} is for the insurer to resolve (${req.question}): state it as a condition of the benefit, do not ask the household; end with final_answer` } }; }
      if (req) {
        const labels = req.options.map((o) => req!.optionLabels?.get(o) ?? "").filter(Boolean);
        const names = (l: string) => (l.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !["the", "and", "was", "not", "other", "fracture", "listed", "case"].includes(w));
        const offers = !labels.length || labels.some((l) => names(l).some((w) => question.toLowerCase().includes(w)));
        if (resolverOf(question) === "insurer" || !offers) { (trace.adjusted ??= []).push(`asked requirement ${req.id}'s own question ("${req.question}") instead of "${question}"`); question = req.question; }
      } else if (resolverOf(question, String(a.fact_key ?? "")) === "insurer") {
        noteFailure("ask_user");
        return { result: { ok: false, error: "that asks for the insurer's assessment of the policy terms (whether something meets a definition, qualifies, or is accepted or approved) -- not a fact the household can give. State it as a condition with what the documents support (statements, or final_answer); ask the household only for what they reported or can observe." } };
      }
      let key = req ? req.factKey : normalizeKey(a.fact_key);
      if (!key) return { result: { ok: false, error: "a fact question needs the fact_key its answer is recorded under" } };
      // Reliable chat (rc-live-1, RCW3): when the household's reported part is not one of a benefit's listed cases, a
      // question asking them to choose one of those cases is irrelevant -- the answer is that the document lists no such case.
      {
        const un = unlistedNow.get(String(a.subject_id ?? state.claim?.subjectId ?? state.subjectId ?? ""));
        const q = `${String(a.question ?? "")} ${Array.isArray(a.options) ? (a.options as unknown[]).map(String).join(" ") : ""}`.toLowerCase();
        const named = un ? un.labels.filter((l) => { const w = (l.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((x) => !["the", "and", "full", "break", "other", "fracture"].includes(x)); return w.length && w.some((x) => q.includes(x)); }) : [];
        if (un && (named.length >= 2 || /\b(?:which|what)\b[^?]*\b(?:listed )?(?:fracture )?cases?\b/.test(q))) {
          noteFailure("ask_user");
          return { result: { ok: false, error: `the household reported a case ${un.benefit} does not list; do not ask them to choose one of its listed cases. Say the document lists no such case (benefit_terms with its listed cases) and suggest asking the insurer; end with final_answer.` } };
        }
      }
      // Reliable chat (rc-live-1, RCT1a / RCT1b turn 3: "Has the insurer made a reviewed medical decision that Jun's
      // diagnosis meets the policy's definition ...?"): what the insurer has decided or reviewed is not a fact the
      // household can give; it is the insurer's step, said once as a next step.
      if (/insurer/i.test(key) || /\b(?:has|have|did)\s+the\s+insurer\b|\binsurer(?:['’]s)?\s+(?:decision|review|reviewed|approv\w*|assessment|confirmation)\b|\breviewed medical (?:decision|record)\b/i.test(String(a.question ?? ""))) {
        noteFailure("ask_user");
        return { result: { ok: false, error: "what the insurer has decided, reviewed or confirmed is not a fact the household can give: do not ask it. Say the insurer's review once (a next step, e.g. contact:<policy_id>) and end with final_answer." } };
      }
      const subject = req ? req.subjectId : (a.subject_id as string) ?? state.claim?.subjectId ?? state.subjectId;
      const claim = subject ? (state.claim?.subjectId === subject ? state.claim : state.otherClaims?.[subject]) : null;
      // Agent F (D15): the same fact under another key (admitted_at / admission_time, how_it_happened / cause) is known.
      const known = claim ? knownFactFor(key, claim.facts) : null;
      if (known) return { result: { ok: false, error: `${key} is already recorded${known.key !== key ? ` (as ${known.key})` : ""} (${String(known.fact.value)}, "${known.fact.words}"); do not ask again` } };
      // Integration (round 3): a fact the household's current message already gives is recorded, never asked for.
      // A question for the TIME is not answered by a date alone ("admitted on Saturday" -> "what time on Saturday?").
      const wantsTime = /time/i.test(key) || /\bwhat time\b/i.test(question);
      const said = statedInMessage(key, input.message);
      if (said && !invalidNow.has(key) && (!wantsTime || CLOCK_TIME.test(said))) return { result: { ok: false, error: `the household's message already gives ${key} ("${said}"): record it with note_facts instead of asking` } };
      // The calculation's own missing inputs drive the next question: ask exactly those, one at a time, in order.
      const stillNeeded = (subject ? calcMissing.get(subject) ?? [] : []).filter((m) => !(claim && knownFactFor(m.key, claim.facts)));
      const sameFact = (a: string, b: string) => a === b || (!factConcept(a).concept.startsWith("key:") && factConcept(a).concept === factConcept(b).concept);
      const calcItem = stillNeeded.find((m) => sameFact(m.key, key)) ?? null;
      let because = req ? req.evidenceIds.filter((id) => state.evidence[id] && !stale.has(id)) : ((a.because_evidence_ids as string[]) ?? []).filter((id) => state.evidence[id] && !stale.has(id));
      // V1.2: the household's reply gave another detail, not the answer to the question pending, and the model asks
      // that same question again: when a question asked EARLIER is still unanswered and is about the detail they just
      // gave (shares its words), that question is the one the documents still need -- asked instead, saying why the
      // detail does not settle it. The pending question stays open for a later turn.
      let redirectPreface: string | null = null;
      const newFacts = recordedNow.filter((x) => x.subject === subject && !sameFact(x.key, key));
      if (subject && pendingBefore?.kind === "fact" && pendingBefore.factKey === key && newFacts.length && !(claim && knownFactFor(key, claim.facts))) {
        const stem = (t: string) => (contentWords(t.replace(/_/g, " ")) as string[]).map((w) => w.slice(0, 6));
        const told = new Set(newFacts.flatMap((x) => [...stem(x.words), ...stem(x.key)]));
        const earlier = state.turns.flatMap((t) => t.toolCalls.filter((c) => c.ok && c.name === "ask_user" && !c.args?.by).map((c) => c.args)).reverse()
          .find((x) => String(x.fact_key ?? "") !== key && String(x.subject_id ?? subject) === subject && !(claim && knownFactFor(String(x.fact_key), claim.facts)) && stem(`${String(x.question ?? "")} ${String(x.fact_key ?? "")}`).some((w) => told.has(w)));
        const eb = ((earlier?.because_evidence_ids as string[]) ?? []).filter((id) => state.evidence[id] && !stale.has(id));
        if (earlier && eb.length) {
          const words = newFacts.map((x) => x.words.trim()).join(" ");
          const distinct = (contentWords(words) as string[]).filter((w) => !stem(String(earlier.question ?? "")).includes(w.slice(0, 6)));
          const lib = [...(libraryText?.values() ?? [])].join("\n").toLowerCase();
          const unused = distinct.length && libraryText && distinct.every((w) => !lib.includes(w.toLowerCase()));
          redirectPreface = unused ? `Your documents don't mention “${distinct.join(" ")}”, so “${words.replace(/[.\s]+$/, "")}” doesn't decide which of their amounts applies.` : `“${words.replace(/[.\s]+$/, "")}” doesn't answer what the documents' amounts depend on yet.`;
          (trace.adjusted ??= []).push(`asked the earlier unanswered question (${String(earlier.fact_key)}) instead of repeating "${question}": the reply gave ${newFacts.map((x) => x.key).join(", ")}`);
          question = firstClauseOnly(String(earlier.question)) ?? String(earlier.question);
          key = normalizeKey(String(earlier.fact_key));
          because = eb;
        }
      }
      if (!because.length && calcItem) because = calcItem.evidenceIds.filter((id) => state.evidence[id]);
      if (!because.length) return { result: { ok: false, error: "cite the evidence (because_evidence_ids) of the benefit or clause that makes this fact matter" } };
      const cause = !CAUSE_KEYS.has(key) ? causeOpen(subject) : null;
      if (cause) return { result: { ok: false, error: `how it happened is not known, and the documents' wording depends on the cause (accident or otherwise): ask how it happened first (fact_key how_it_happened, citing ${cause.slice(0, 3).join(", ")})` } };
      // V1.2: requirements are per benefit -- asking another benefit's (or the schedule's) open detail is allowed; within
      // ONE benefit's calculation its inputs are asked in order.
      const ownList = subject ? [...(calcMissingBy.get(subject)?.values() ?? [])].map((l) => l.filter((m) => !(claim && knownFactFor(m.key, claim.facts)))).find((l) => l.some((m) => sameFact(m.key, key))) ?? null : null;
      // A calculator input no open calculation needs (a bill for a daily-rate benefit) is not asked: the first input
      // an open calculation still needs is.
      if (!ownList && subject && /^(?:bill_amount|admission_(?:datetime|date|time)|discharge_(?:datetime|date|time)|prior_use\w*)$/.test(key)) {
        const first = [...(calcMissingBy.get(subject)?.values() ?? [])].map((l) => l.filter((m) => !(claim && knownFactFor(m.key, claim.facts)))).find((l) => l.length);
        if (first) return { result: { ok: false, error: `that calculation still needs ${first[0].key} first (${first[0].why}): ask for that, one question at a time (fact_key ${first[0].key}, citing ${first[0].evidenceIds.slice(0, 3).join(", ") || "the calculation's evidence"})` } };
      }
      if (ownList && ownList.length && !CAUSE_KEYS.has(key) && !sameFact(ownList[0].key, key)) return { result: { ok: false, error: `that calculation still needs ${ownList![0].key} first (${ownList![0].why}): ask for that, one question at a time (fact_key ${ownList![0].key}, citing ${ownList![0].evidenceIds.slice(0, 3).join(", ") || "the calculation's evidence"})` } };
      // Agent F (D15): the cited "why" must be about the fact asked, not any passage that happens to be in the state.
      if (!calcItem && !req && !relevantEvidence(question, key, because.map((id) => [state.evidence[id].table?.rowLabel ?? "", state.evidence[id].label ?? "", state.evidence[id].passage.text].join("\n")), input.people.map((p) => p.name))) return { result: { ok: false, error: `the cited evidence (${because.join(", ")}) does not make ${key} matter: cite the benefit or clause whose wording depends on it, or do not ask` } };
      const why = because.map((id) => `${whyLine(state.evidence[id], question + " " + key + (CAUSE_KEYS.has(key) ? " accident accidental" : ""))} (page ${state.evidence[id].passage.onPage})`).join("; ");
      trace.evidenceChosen.push(...because.filter((id) => !trace.evidenceChosen.includes(id)));
      askBecause = because;
      // V1.2: the household speaks about this person in the third person ("Desmond broke his leg"): the question names
      // them, never "your leg" / "your admission" (that would be about the person typing).
      const subjName = input.people.find((p) => p.id === subject)?.name ?? "";
      const short = /\(([^)]+)\)\s*$/.exec(subjName)?.[1] ?? subjName.split(/\s+/)[0] ?? "";
      const thirdPerson = !!short && userTexts.some((t) => new RegExp(`\\b${short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(t)) && !userTexts.some((t) => /\b(?:I|my|me)\b/.test(t));
      if (thirdPerson && /\byour\b/i.test(question)) { const was = question; question = question.replace(/\byour\b/gi, `${short}'s`); (trace.adjusted ??= []).push(`named ${short}: "${was}" -> "${question}"`); }
      if (thirdPerson && !secondPersonWarned && /\b(?:were|did|have|had|are|do) you (?:break|fall|stay|get|been|go|have|hurt)\b/i.test(question)) { secondPersonWarned = true; return { result: { ok: false, error: `the household is telling you about ${short} (third person): ask about ${short} by name, not "you" (that would be the person typing)` } }; }
      if (!completionNudged && !CAUSE_KEYS.has(key)) {
        const more = completionLines((composed?.sentences ?? []).map((x) => x.text), question, subject);
        if (more.length) { completionNudged = true; return { result: { ok: false, error: `before asking: ${more.join("; ")}. Then call ask_user again: those statements first, then the one question that most changes the result.` } }; }
      }
      const caseOf = req ? (req.isCase ? req.benefitId : undefined) : subject ? caseOpenNow.get(subject) : undefined;
      // (a requirement's options are shown to the household as its listed cases' own words, never internal ids)
      const opts = req?.options.length ? req.options.map((o) => req!.optionLabels?.get(o) ?? o) : Array.isArray(a.options) && a.options.length ? (a.options as string[]).map(String) : [];
      const pending: LoopPending = { kind: "fact", question, factKey: key, subjectId: subject ?? null, why, evidenceIds: because, ...(opts.length ? { options: opts } : {}), ...(caseOf ? { caseOf } : {}), ...(req ? { requirementId: req.id, benefitId: req.benefitId } : {}), turn: state.turn };
      return { result: { ok: true }, terminal: { kind: "ask", pending, preface: redirectPreface, composed } };
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
    noteDrops(sentencesIn, first);
    if (!first.sentences.length && !first.dropped.length) return { result: { ok: false, error: "final_answer needs at least one sentence" } };
    const fw = forward(first, sentencesIn, a.next_steps, (a.subject_id as string) ?? null);
    if (fw.repair) return { result: { ok: false, error: fw.repair } };
    const composed = fw.composed;
    return { result: { ok: true }, terminal: { kind: "final", composed } };
  };

  /** V1.2: calculation inputs selected by evidence id (rate_evidence_id, proportion.evidence_id,
   * passage_limits[].evidence_id) are read from the retrieved record the server holds -- its exact line, page and
   * figure (figureFromEvidence) -- never from the model's transcription. The record must be one a tool returned in this
   * conversation, still current (same document version), retrieved for this person, and printed by the calculation's
   * own document; the tool then validates the quote on that page as for any quoted input. */
  const tableRest = new Map<string, EvidenceRef>();
  /** V1.5: the stored page a proportion's passage is printed on (for the table-row reconstruction, pct-rows.ts). */
  const proportionPages = new Map<string, string>();
  const readTableRest = async (call: ToolCall) => {
    const id = (call.arguments.proportion as Record<string, unknown> | undefined)?.evidence_id;
    const e = typeof id === "string" ? state.evidence[id] : undefined;
    if (e && !proportionPages.has(e.id)) {
      const pg = (await pageMap(input.accountId, e.policyId).catch(() => new Map<number, string>())).get(e.passage.onPage);
      if (pg != null && pg.slice(e.passage.start, e.passage.end) === e.passage.text) proportionPages.set(e.id, pg);
    }
    if (!e || tableRest.has(e.id)) return;
    const ROW = /\S(?:\t+| {3,})\S/;
    const last = e.passage.text.split(/\n/).filter((l) => l.trim()).at(-1) ?? "";
    if (!ROW.test(last)) return;
    const page = (await pageMap(input.accountId, e.policyId).catch(() => new Map<number, string>())).get(e.passage.onPage) ?? "";
    if (page.slice(e.passage.start, e.passage.end) !== e.passage.text) return;
    const after = page.slice(e.passage.end).split(/\n/);
    const rows: string[] = [];
    for (const l of after.slice(after[0]?.trim() ? 0 : 1)) { if (!ROW.test(l)) break; rows.push(l); }
    if (!rows.length) return;
    const text = e.passage.text + "\n" + rows.join("\n");
    tableRest.set(e.id, { ...e, passage: { ...e.passage, text, end: e.passage.start + text.length } } as EvidenceRef);
  };
  /** V1.5: the row of the reconstructed percentage table (pct-rows.ts) that the condition names, on the proportion
   * passage's own page and table; otherwise an actionable refusal naming each row of that table with a value id. */
  const rowFromPage = (e: EvidenceEntry, appliesWhen: string, condition: string, benefit: string, subject: string | null): { quote: string; percent: number; label: string } | string => {
    const page = proportionPages.get(e.id);
    if (page == null) return "Its page could not be re-read.";
    const tables = percentTables(page).filter((t) => t.start < e.passage.end && t.end > e.passage.start);
    if (!tables.length) return "No percentage table is printed in or right after that passage.";
    const choice = choosePercentRow(tables, benefit, `${appliesWhen} ${condition}`);
    if ("row" in choice && !("unresolved" in choice)) return { quote: choice.row.text, percent: choice.row.percents[0], label: choice.row.label };
    // (A conflicting or incomplete row is never offered as a choice: only a tie, or no row named, lists the rows.)
    const listed = ("ambiguous" in choice ? choice.ambiguous : "none" in choice ? choice.none : []).filter((x) => x.row.percents.length === 1);
    const ids = subject ? listed.map((x) => {
      const id = "v" + ++ctx.seq;
      const evidence = evidenceAt({ policyId: e.policyId, documentHash: e.documentHash ?? null, page: e.passage.onPage, pageText: page, start: x.row.start, end: x.row.end, subjectId: subject });
      const operand = { kind: "table_value", benefit: x.row.label, valueKind: "percent", cents: null, ppm: Math.round(x.row.percents[0] * 10_000), count: null, currency: null, period: null, evidence } as TableValueOperand;
      ctx.values.set(id, { selected: { status: "ok", benefit: x.row.label, rowLabel: x.row.label, valueKind: "percent", ppm: operand.ppm, cents: null, currency: null, period: null, evidence, related: [] } as unknown as SelectedValue, subjectId: subject, operand });
      return `${id} = “${x.row.label}” ${x.row.percents[0]}% (${x.table.header.replace(/\s{2,}/g, " ")}${x.table.name ? `, ${x.table.name}` : ""})`;
    }) : [];
    const why = "unresolved" in choice ? `${choice.unresolved}, so it is not used.` : "ambiguous" in choice ? `The condition names more than one row (${choice.ambiguous.map((x) => `“${x.row.label}”`).join(", ")}), so none is chosen.` : "The condition names no row of that table.";
    return `${why}${ids.length ? ` Rows of that table, page ${e.passage.onPage}: ${ids.join("; ")}. If one of them is the case, call calculate again with that id as percent_value_id and without proportion.` : ""}`;
  };
  const resolveEvidenceInputs = (call: ToolCall): string | null => {
    const a: Record<string, unknown> = { ...call.arguments };
    const subject = typeof a.subject_id === "string" ? a.subject_id : null, docId = String(a.policy_id ?? "");
    const pick = (id: unknown, what: string): EvidenceEntry | string => {
      const e = typeof id === "string" ? state.evidence[id] : undefined;
      if (!e) return `${what}: unknown evidence id ${String(id)} (use an evidence_id a tool returned in this conversation)`;
      if (stale.has(e.id)) return `${what}: ${e.id} cannot be used -- ${stale.get(e.id)}`;
      if (e.subjectId && subject && e.subjectId !== subject) return `${what}: ${e.id} was retrieved for another person`;
      if (e.policyId !== docId) return `${what}: ${e.id} is printed in another document (${policyNames.get(e.policyId) ?? state.docNames?.[e.policyId] ?? e.policyId}), not the calculation's policy_id`;
      return e;
    };
    let changed = false;
    if (a.rate_evidence_id != null) {
      const e = pick(a.rate_evidence_id, "rate_evidence_id"); if (typeof e === "string") return e;
      const f = figureFromEvidence(e, { kind: "amount", words: String(a.benefit ?? "") }); if (typeof f === "string") return `rate_evidence_id: ${f}`;
      a.rate_passage = { page: f.page, quote: f.quote, amount: f.amount, currency: f.currency }; delete a.rate_evidence_id; changed = true;
    }
    const pr = a.proportion as Record<string, unknown> | undefined;
    if (pr && pr.evidence_id != null) {
      const e = pick(pr.evidence_id, "proportion.evidence_id"); if (typeof e === "string") return e;
      const want = { kind: "percent" as const, words: String(pr.applies_when ?? ""), percent: typeof pr.percent === "number" ? pr.percent : null, also: typeof a.condition === "string" ? a.condition : null };
      let f = figureFromEvidence(e, want);
      // V1.3: a passage cut off inside a table is read with the rest of that table on the same page (its following
      // rows, up to the first line that is not a row) -- the same stored page, so the row's page and quote still hold.
      const more = tableRest.get(e.id);
      if (typeof f === "string" && more) { const g = figureFromEvidence(more, want); if (typeof g !== "string") f = g; }
      // V1.5 (s52-live-1): the passage stopped above the row the condition names, or the row is wrapped over two lines.
      // The percentage table on the passage's own stored page is reconstructed (heading, header naming the base,
      // continuation lines, exact span) and the ONE row the condition's words name is used. A tie, no row named, a
      // row printing no single percentage or printed twice differently stays refused -- with the rows' value ids, so
      // the next call can name one (percent_value_id) instead of ending the turn.
      if (typeof f === "string") {
        const row = rowFromPage(e, String(pr.applies_when ?? ""), typeof a.condition === "string" ? a.condition : "", String(a.benefit ?? ""), subject);
        if (typeof row === "string") return `proportion.evidence_id: ${f}. ${row}`;
        if (typeof pr.percent === "number" && Math.abs(pr.percent - row.percent) > 1e-9) return `proportion.evidence_id: the row “${row.label}” prints ${row.percent}%, not ${pr.percent}%`;
        f = { page: e.passage.onPage, quote: row.quote, percent: row.percent };
      }
      a.proportion = { page: f.page, quote: f.quote, percent: f.percent, applies_when: pr.applies_when }; changed = true;
    }
    if (Array.isArray(a.passage_limits) && (a.passage_limits as Record<string, unknown>[]).some((x) => x?.evidence_id != null)) {
      const out: Record<string, unknown>[] = [];
      for (const x of a.passage_limits as Record<string, unknown>[]) {
        if (x?.evidence_id == null) { out.push(x); continue; }
        const e = pick(x.evidence_id, "passage_limits.evidence_id"); if (typeof e === "string") return e;
        const f = figureFromEvidence(e, { kind: "amount", words: String(x.label ?? ""), amount: typeof x.amount === "number" ? x.amount : null }); if (typeof f === "string") return `passage_limits.evidence_id: ${f}`;
        out.push({ page: f.page, quote: f.quote, amount: f.amount, currency: f.currency, label: x.label, applies: x.applies });
      }
      a.passage_limits = out; changed = true;
    }
    if (changed) call.arguments = a;
    return null;
  };
  /** V1.3: a figure a sentence states from a cited roster passage (a certificate's person row under a product
   * heading), with no table value for it, is resolved through the existing select_table_value for that person and the
   * heading the figure is printed under -- the tool's own person, version and date checks -- so the figure is bound to
   * its verified identity instead of to the model's wording of the benefit. At most four lookups a reply. */
  const bindCitedFigures = async (call: ToolCall) => {
    const list = (call.name === "final_answer" ? call.arguments.sentences : call.arguments.statements) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(list) || !libraryText) return;
    const env2 = loopToolEnv(env);
    let lookups = 0;
    for (const s of list) {
      const figs = moneyFiguresIn(String(s?.text ?? ""));
      if (!figs.length || !Array.isArray(s.evidence_ids)) continue;
      const who = typeof s.subject_id === "string" && householdIds.has(s.subject_id) ? s.subject_id : typeof call.arguments.subject_id === "string" && householdIds.has(call.arguments.subject_id) ? call.arguments.subject_id : state.subjectId;
      if (!who) continue;
      const bound = new Set(((s.value_ids as string[]) ?? []).map((id) => ctx.values.get(id)?.operand.cents).filter((x): x is number => x != null));
      for (const f of figs) {
        if (bound.has(Math.round(f.value * 100)) || lookups >= 4) continue;
        // The household's own figure said back as NOT the documented one ("S$200,000, not S$400,000") is theirs, not a
        // documented figure of this sentence: never bound here (the save-time check attributes it).
        const said = String(s.text ?? "");
        const at = said.indexOf(f.raw);
        if (at >= 0 && /\b(?:not|n['’]t|rather than|instead of|than)\s*$/i.test(said.slice(Math.max(0, at - 16), at).trim() + " ") && userTexts.some((u) => moneyFiguresIn(u).some((m) => Math.abs(m.value - f.value) < 0.005))) continue;
        // V1.4: the figure's identity comes from the shared benefit view -- this person's OWN documented rows (a
        // certificate roster under a product heading) in the documents the sentence cites, matched by amount and
        // currency. Exactly one benefit: bound to it; none, or several with that amount: not bound here.
        const cited = new Set((s.evidence_ids as string[]).map((id) => (state.evidence[id] && !stale.has(id) ? state.evidence[id].policyId : null)).filter((x): x is string => !!x));
        const rows = (benefitView?.byMember.get(who)?.benefits ?? []).filter((b) => b.applicability === "person_row" && !b.conflicts?.length && cited.has(b.policy.id) && b.printed.kind === "money" && Math.abs(b.printed.amount - f.value) < 0.005 && b.printed.currency === f.currency);
        const labels = [...new Set(rows.map((b) => `${b.policy.id}|${b.benefit.label}`))];
        for (const one of labels.length === 1 ? [rows[0]] : []) {
          const e = { policyId: one.policy.id };
          const heading = one.benefit.label;
          lookups++;
          const args = { policy_id: e.policyId, benefit: heading.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(), subject_id: who, want: "amount" };
          // The value is kept under the composer's own key (never the model-visible v1, v2 ... sequence, which is left
          // exactly as it was), so this lookup changes no id the model sees.
          const seqBefore = ctx.seq;
          const r = await runTool(ctx, "select_table_value", args, env2);
          let d = (r.ok ? r.data : null) as { status?: string; valueId?: string; valueKind?: string; value?: number; currency?: string } | null;
          let key: string | null = null;
          if (d?.valueId && ctx.values.has(d.valueId)) { key = `vb${state.turn}_${++bindSeq}`; ctx.values.set(key, ctx.values.get(d.valueId)!); ctx.values.delete(d.valueId); }
          else {
            // V1.4: a roster the table parser does not read (one cell per line) -- the view's reconstructed row itself.
            const sel = selectedFromBenefit(one, input.people.find((p) => p.id === who)?.name ?? "");
            if (sel) { key = `vb${state.turn}_${++bindSeq}`; ctx.values.set(key, { selected: sel, subjectId: who, operand: { kind: "table_value", benefit: sel.rowLabel, valueKind: "money", cents: sel.cents, ppm: null, count: null, currency: sel.currency, period: sel.period, evidence: sel.evidence } }); d = { status: "ok", valueKind: "money", value: sel.value, currency: sel.currency ?? undefined }; }
          }
          ctx.seq = seqBefore;
          record("select_table_value", { ...args, by: "composition (figure identity)" }, r.ok, [], r.ok ? undefined : r.error, d ? JSON.stringify({ status: d.status, value: d.value, key }) : undefined);
          if (key && d?.status === "ok" && d.valueKind === "money" && Math.abs(Number(d.value) - f.value) < 0.005 && d.currency === f.currency) { s.value_ids = [...((s.value_ids as string[]) ?? []), key]; bound.add(Math.round(f.value * 100)); break; }
        }
      }
    }
  };
  /** A tool call refused by the loop before it runs (null: run it). */
  const preflight = (call: ToolCall): string | null => {
    // V1.2: a reported event's illustration states the household's OWN words as its assumption (the save-time gate
    // requires a verbatim quote; a what-if is checked against the question asked instead). A paraphrase is replaced by their message of this turn when its facts were recorded from it; otherwise
    // the call is refused with that reason -- never stored as if the household had said it.
    // Reliable chat (contract B): a percentage or daily-rate benefit is evaluated on the server from its benefit id; the
    // model no longer assembles its operands (value ids, percentages, shares, quotes). The refusal names the benefits.
    if (call.name === "calculate" && chatContract(env) === "benefits" && ["lump_sum", "hospital_cash"].includes(String(call.arguments.calculator))) {
      const subject = typeof call.arguments.subject_id === "string" ? call.arguments.subject_id : null;
      const want = String(call.arguments.benefit ?? "").toLowerCase();
      const recs = [...(ctx.benefitRecords?.values() ?? [])].filter((r) => (!subject || r.memberId === subject) && (r.kind === "percentage_schedule" || /day|night|hospital/i.test(r.benefit) || (!!want && (r.benefit.toLowerCase().includes(want) || want.includes(r.benefit.toLowerCase())))));
      noteFailure(call.name);
      return `calculate does not take ${String(call.arguments.calculator)} any more: a benefit paying a percentage of a base or a daily rate is worked out on the server. Call evaluate_benefit with the benefit's benefit_id and only what the household reported (the case in their words or a listed option_id; a stay's admission / discharge) -- never amounts, percentages, value ids or quotes.${recs.length ? ` This person's matching benefits: ${recs.slice(0, 6).map((r) => `${r.id} = ${r.benefit}${r.policy.product ? ` (${r.policy.product})` : ""}`).join("; ")}.` : " Call person_benefits for this person to get the benefit ids."}`;
    }
    if ((call.name === "calculate" || call.name === "evaluate_benefit") && call.arguments.purpose !== "what_if" && typeof call.arguments.assumption_words === "string" && call.arguments.assumption_words.trim() && !quotedFrom(call.arguments.assumption_words, userTexts)) {
      if (!recordedNow.length) return "assumption_words must quote the household's own words verbatim (from their messages)";
      call.arguments = { ...call.arguments, assumption_words: input.message.replace(/\s+/g, " ").trim() };
    }
    // Reliable chat (rc-live-1, RCW1b: case "closed fracture of his leg", the model's paraphrase, became the illustration's
    // stated assumption and the save-time gate rightly refused it as not the household's what-if): an evaluation's
    // assumption is always the household's own words -- the recorded words of the facts it rests on, else its case words
    // when they quote the household, else this message as they wrote it.
    if (call.name === "evaluate_benefit") {
      const subj = String(call.arguments.subject_id ?? "");
      const facts = (state.claim?.subjectId === subj ? state.claim.facts : state.otherClaims?.[subj]?.facts) ?? {};
      const bid0 = String(call.arguments.benefit_id ?? "");
      // Actual-library findings (hip or tibia, then "it was his hip"): the household's answer to the open case question
      // of this benefit settles the case -- the uncertain report it answers no longer competes with it. (Only an answer
      // naming a part; anything else leaves every report in play.)
      const answering = pendingBefore?.kind === "fact" && (pendingBefore.subjectId ?? subj) === subj && !!bid0 && (pendingBefore.caseOf === bid0 || (!!pendingBefore.options?.length && pendingBefore.options.every((o) => String(o).startsWith(bid0))));
      const answerWords = answering ? recordedNow.filter((r) => r.subject === subj).map((r) => r.words).filter((w) => partsIn(w).length) : [];
      (ctx.reported ??= new Map()).set(subj, answerWords.length ? answerWords : Object.values(facts).filter((f) => f && (f.source ?? "user_reported") === "user_reported").map((f) => `${f.words} ${typeof f.value === "string" ? f.value : ""}`.trim()));
      (ctx.reportedFacts ??= new Map()).set(subj, householdReports(subj, facts));
    }
    if (call.name === "evaluate_benefit" && !(typeof call.arguments.assumption_words === "string" && call.arguments.assumption_words.trim())) {
      const subj = String(call.arguments.subject_id ?? "");
      const facts = (state.claim?.subjectId === subj ? state.claim.facts : state.otherClaims?.[subj]?.facts) ?? {};
      const keys = Array.isArray(call.arguments.fact_keys) ? (call.arguments.fact_keys as unknown[]).map(String) : [];
      const fromFacts = keys.map((k) => facts[k]?.words).find((w): w is string => typeof w === "string" && !!w.trim() && quotedFrom(w, userTexts));
      const caseWords = typeof call.arguments.case === "string" && call.arguments.case.trim() && quotedFrom(call.arguments.case, userTexts) ? call.arguments.case : null;
      call.arguments = { ...call.arguments, assumption_words: fromFacts ?? caseWords ?? input.message.replace(/\s+/g, " ").trim() };
    }
    if (call.name === "calculate") { const bad = resolveEvidenceInputs(call); if (bad) return bad; }
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
    // V1.5 (live verification, 14 Oct): only figures RELEVANT to what the household asked -- their label, product and
    // printed conditions (and the wording of the same product, e.g. a Term Life summary's Death Benefit) share a topic
    // word with the conversation. A verified figure about something else (Living Care Plus for a death or a fracture
    // question) is never shown just because it was read; most relevant first, then the latest read.
    const said = topicStems(userTexts.join(" "));
    const relevance = (policyId: string, label: string, subject: string) => {
      const parts = [label, policyNames.get(policyId) ?? ""];
      const lw = [...topicStems(label)];
      for (const b of benefitView?.byMember.get(subject)?.benefits ?? []) {
        if (b.policy.id === policyId && b.benefit.label.toLowerCase() === label.toLowerCase()) parts.push(...b.conditions);
        if (b.applicability === "shared_wording" && lw.length && lw.every((w) => topicStems(b.policy.product ?? "").has(w))) parts.push(b.benefit.label, ...b.conditions);
      }
      return sharedTopic(said, topicStems(parts.join(" "))).length;
    };
    const read = [...ctx.values.entries()].filter(([, v]) => v.operand.valueKind === "money" && v.operand.cents != null && !stale.has(evidenceIdOf(state, v.operand.evidence)))
      .map(([id, v], i) => ({ id, v, i, score: relevance(v.operand.evidence.policyId, v.operand.benefit, v.subjectId) }))
      .filter((x) => x.score > 0).sort((a, b) => a.score - b.score || a.i - b.i).map((x) => [x.id, x.v] as const);
    const seenRows = new Set<string>();
    const sentences: Record<string, unknown>[] = [];
    for (const [valueId, v] of [...read].reverse()) {
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
    // Nothing relevant read this turn: what the conversation already established about the question (stated, cited
    // and bound in an earlier turn), re-checked by the same composer and gate.
    if (!sentences.length) for (const e of (state.established ?? []).filter((x) => !state.subjectId || x.subjectId === state.subjectId).slice(-3)) {
      if (sharedTopic(said, topicStems(`${e.text} ${e.benefit ?? ""}`)).length) sentences.push({ text: e.text, evidence_ids: e.evidenceIds, value_ids: e.valueIds, ...(e.benefit ? { benefit: e.benefit } : {}), ...(e.subjectId ? { subject_id: e.subjectId } : {}) });
    }
    if (!sentences.length) return null;
    const composed = composeFinal({ sentences, subjectId: state.subjectId }, composeCtx());
    if (!composed.sentences.length) return null;
    const unresolved = [...calcOutcomes(ctx).values()].reverse().find((c) => c.kind === "unresolved" && (c.requirements?.length || c.unresolvedText));
    const missing = unresolved?.requirements?.length ? `Still needed before an amount can be worked out: ${unresolved.requirements.join("; ")}.` : "I didn’t get as far as working out an amount for what you described, so I haven’t given one.";
    composed.notes = [...(composed.notes ?? []), `I stopped before finishing because this question reached its model-use limit. ${missing}`];
    return composed;
  };

  /** V1.2: the model had the turn's one repair (or nudge) and its reply still leaves the household's facts
   * unaddressed -- a bare say-back, a hospital stay or bill nobody looked at, a percentage with no amount. The reply is
   * completed from what this conversation has ALREADY verified (statements established earlier, passages and table
   * values the tools returned), each composed and checked like any sentence; what was never looked up is named as
   * such (never invented); and the grounded question is asked. No extra model call, no retry. */
  /** V1.2: the ONE bounded lookup the grounded fallback may make when a reply states a percentage of the Sum Insured
   * without the person's own amount (an unresolved evidence requirement, whatever the benefit): the same tools the
   * model has -- policies_for, then select_table_value on the documents of the SAME policy as the wording that prints
   * the percentage (at most 3), each value kept only if it is printed under that wording's own product. Household,
   * lifecycle, person, version and date checks are the tools' own (and the composer's and the gate's after them). Never
   * a model call. One match: that value. Several: ambiguous (never the first). None: unavailable, with why. */
  const lookupSumInsured = async (subject: string): Promise<{ kind: "one"; valueId: string } | { kind: "many"; names: string[]; evidenceIds: string[] } | { kind: "none"; why: string } | null> => {
    const cited = [...new Set([...trace.toolCalls.flatMap((t) => t.evidenceIds ?? []), ...(pendingBefore?.kind === "fact" ? pendingBefore.evidenceIds ?? [] : [])])];
    // The document printing the percentages: a passage cited this turn that says so (with its table header / context),
    // or a percentage value read this turn for this person.
    const PCT_OF_SUM = /%\s*of (?:the )?sum (?:insured|assured)|percentage shown/i;
    const fromEvidence = cited.map((id) => state.evidence[id]).filter((e): e is EvidenceEntry => !!e && !stale.has(e.id) && (PCT_OF_SUM.test(evidenceTextOf(e)) || PCT_OF_SUM.test(e.table?.columnHeader ?? ""))).map((e) => e.policyId);
    const fromValues = [...ctx.values.values()].filter((v) => v.subjectId === subject && v.operand.valueKind === "percent" && !stale.has(evidenceIdOf(state, v.operand.evidence)) && (PCT_OF_SUM.test(evidenceTextOf(v.operand.evidence)) || PCT_OF_SUM.test(v.operand.evidence.table?.columnHeader ?? ""))).map((v) => v.operand.evidence.policyId);
    const wordingIds = [...new Set([...fromEvidence, ...fromValues])];
    if (wordingIds.length !== 1) return wordingIds.length ? { kind: "none", why: "more than one policy document prints the percentages, so it is not clear whose sum insured they apply to" } : null;
    const docs = await loadDocs(input.accountId).catch(() => null);
    const wording = docs?.find((d) => d.id === wordingIds[0]);
    if (!docs || !wording) return null;
    const env2 = loopToolEnv(env);
    const pf = await runTool(ctx, "policies_for", { subject_id: subject }, env2);
    const pfIds: string[] = []; resultForModel(pf as { ok: boolean; data?: unknown; error?: string; evidence: unknown }, state, "policies_for", pfIds, new Set());
    record("policies_for", { subject_id: subject, by: "grounded fallback (sum insured)" }, pf.ok, pfIds, pf.ok ? undefined : pf.error);
    if (!pf.ok) return { kind: "none", why: "the list of documents that insure them could not be read" };
    const family = new Set(policyFamily(docs, wording).map((d) => d.id));
    const candidates = ((pf.data as { covering?: PolicyCoverage[] }).covering ?? []).filter((c) => c.policyId !== wording.id && family.has(c.policyId)).slice(0, 3);
    const productWords = (t: string) => (t.toLowerCase().replace(/\([^)]*\)/g, " ").match(/[a-z]{3,}/g) ?? []).filter((w) => !["group", "policy", "the", "and", "for", "sum", "assured", "insured", "benefit", "amount", "cover", "wording", "schedule", "certificate", "plan", "scheme", "public", "service"].includes(w));
    const own = new Set(productWords(`${wording.productName ?? ""} ${wording.policyType ?? ""}`));
    const found: { valueId: string; policyId: string; evidenceId: string }[] = [];
    for (const c of candidates) {
      const args = { policy_id: c.policyId, benefit: wording.policyType || wording.productName || "sum insured", subject_id: subject, want: "amount" };
      const r = await runTool(ctx, "select_table_value", args, env2);
      const ids2: string[] = []; resultForModel(r as { ok: boolean; data?: unknown; error?: string; evidence: unknown }, state, "select_table_value", ids2, new Set());
      const d = (r.ok ? r.data : null) as { status?: string; valueId?: string; valueKind?: string; benefit?: string; rowLabel?: string } | null;
      record("select_table_value", { ...args, by: "grounded fallback (sum insured)" }, r.ok, ids2, r.ok ? undefined : r.error, d ? JSON.stringify({ status: d.status, valueId: d.valueId, row: d.rowLabel }) : undefined);
      const under = productWords(String(d?.benefit ?? d?.rowLabel ?? ""));
      if (d?.status === "ok" && d.valueKind === "money" && d.valueId && under.length && under.every((w) => own.has(w))) found.push({ valueId: d.valueId, policyId: c.policyId, evidenceId: ids2[0] ?? "" });
    }
    if (found.length === 1) return { kind: "one", valueId: found[0].valueId };
    if (found.length > 1) return { kind: "many", names: found.map((f) => policyNames.get(f.policyId) ?? state.docNames?.[f.policyId] ?? "a document"), evidenceIds: found.map((f) => f.evidenceId).filter(Boolean) };
    return { kind: "none", why: candidates.length ? `the ${candidates.map((c) => c.productName ?? "document").join(" and ")} that insure them under this policy do not print an amount for them under ${wording.productName ?? "this product"}` : `none of their readable documents of this policy lists a sum insured under ${wording.productName ?? "this product"}` };
  };
  let lookupAsk: Extract<LoopPending, { kind: "fact" }> | null = null;
  const groundedFallback = async (r: LoopReply | null): Promise<LoopReply | null> => {
    if (!r || (r.kind !== "final" && r.kind !== "ask")) return r;
    const repaired = gateRepaired || finalRepaired || completionNudged;
    const c0 = r.composed ?? null;
    const subject = (c0?.subjectId ?? (r.kind === "ask" && r.pending.kind === "fact" ? r.pending.subjectId : null) ?? state.claim?.subjectId ?? state.subjectId) || null;
    if (!subject || !recordedNow.some((x) => x.subject === subject)) return r;
    // Without a repair, the fallback only shows a calculation completed this turn that the reply does not show: one
    // completed when the household's facts arrived (completedCalcs), or the turn's ONLY resolved calculation for this
    // person when the reply shows none.
    const shown0 = new Set((c0?.calcs ?? []).map((k) => k.calcId));
    const ok0 = (k: CalcOutcome) => (k.kind === "conditional_illustration" || k.kind === "indicative_estimate") && k.subjectId === subject && !!k.record && k.amount != null && !shown0.has(k.calcId);
    const fresh = completedCalcs.filter(ok0);
    const turnResolved = [...calcOutcomes(ctx).values()].filter(ok0);
    const single = !shown0.size && !attemptedResults.size && turnResolved.length === 1 ? turnResolved : [];
    if (!repaired && !fresh.length && !single.length) return r;
    const texts = (c0?.sentences ?? []).map((x) => x.text);
    const question = r.kind === "ask" ? r.pending.question : null;
    const missing = repaired ? completionLines(texts, question, subject, pendingBefore?.kind === "fact" ? pendingBefore.evidenceIds ?? [] : []) : [];
    const bare = repaired && r.kind === "final" && !(c0?.sentences ?? []).some((x) => x.evidenceIds.length);
    // A resolved calculation of THIS turn for this person that the reply tried to state but that is not shown (left out
    // for its wording, or the repair went unanswered) -- or, when the reply states no calculation at all, the turn's ONLY
    // resolved one. Never one withdrawn by a correction, made for someone else, or tried and superseded in exploration.
    const shownCalc = new Set((c0?.calcs ?? []).map((k) => k.calcId));
    const resolved = (k: CalcOutcome | undefined): k is CalcOutcome => !!k && (k.kind === "conditional_illustration" || k.kind === "indicative_estimate") && k.subjectId === subject && !!k.record && k.amount != null
      && !(state.claim?.calcs?.[k.calcId]?.withdrawn) && k.evidence.every((e) => !stale.has(evidenceIdOf(state, e)));
    // Eligible: a result the reply cited whose sentence was left out ONLY for its wording (or whose reply was never
    // composed because the repair went unanswered) -- never one refused for its substance (e.g. an illustration given
    // as the amount for an actual stay). Or, when the reply cites no calculation at all, the turn's ONLY resolved one.
    let lostCalcs = repaired ? [...attemptedResults].filter((id) => !substantiveDrops.has(id)).map((id) => calcOutcomes(ctx).get(id)).filter(resolved).filter((k) => !shownCalc.has(k.calcId)) : [];
    if (!lostCalcs.length && !shownCalc.size && !attemptedResults.size) { const all = [...calcOutcomes(ctx).values()].filter(resolved); if (all.length === 1) lostCalcs = all; }
    lostCalcs = [...lostCalcs, ...fresh.filter(resolved)];
    lostCalcs = [...new Map(lostCalcs.map((k) => [k.calcId, k])).values()];
    // The household's reply to the yes / no question just asked, when it visibly answers neither way (no yes / no, and
    // no word of the question beyond the fact asked about): that question is still open.
    const replyWords = [...new Set(recordedNow.filter((x) => x.subject === subject).map((x) => x.words.trim()))].join(" ");
    const unsettled = repaired && r.kind === "final" && !state.pending && pendingBefore?.kind === "fact" && /^\s*(?:was|is|did|does|has|have|were|are|can|could)\b/i.test(pendingBefore.question)
      && !/\b(?:yes|yeah|yep|no|nope|not|n['’]t|none|neither)\b/i.test(replyWords)
      && !contentWords(replyWords).some((w) => contentWords(pendingBefore.question).includes(w) && !contentWords(pendingBefore.factKey.replace(/_/g, " ")).includes(w));
    if (!missing.length && !bare && !unsettled && !lostCalcs.length) return r;
    trace.incomplete = [...(lostCalcs.length ? [`a verified calculation the reply did not show (${lostCalcs.map((k) => k.benefit).join(", ")}) was stated from its own record`] : []), ...(bare ? ["the reply only said back what the household told it"] : []), ...(unsettled ? ["the household's reply did not visibly answer the question asked"] : []), ...missing.map((m) => m.split(":")[0])];
    const who = input.people.find((p) => p.id === subject)?.name ?? "";
    const short = /\(([^)]+)\)\s*$/.exec(who)?.[1] ?? who.split(/\s+/)[0] ?? "they";
    const live = (id: string) => !!state.evidence[id] && !stale.has(id);
    const sentences: Record<string, unknown>[] = [];
    const notes: string[] = [];
    // (Actual-library findings: never an echo of words the answer already quotes, and -- structured-answers release -- none of a fact
    // a SHOWN calculation rests on: that statement says the resolved case itself, so the fact is visibly used)
    const quoted = squashW(texts.join(" "));
    const sayBacks = r.kind === "final" && !texts.some((t) => /^\s*you (?:told me|said)\b/i.test(t)) ? recordedNow.filter((x) => x.subject === subject && !quoted.includes(squashW(x.words)) && !(c0?.calcs ?? []).some((k) => (k.dependsOn ?? []).includes(x.key))).map((x) => sayBack(x.words)).filter((x): x is string => !!x) : [];
    sentences.push(...[...new Set(sayBacks)].map((text) => ({ text })));
    // Each lost calculation, in canonical wording built only from its verified record: the benefit as printed, its
    // printed percentages, the case and the household's own words it assumes, then what is still unresolved. Composed
    // and checked like any sentence citing that result (subject, policy, versions, operands, arithmetic), then gated.
    for (const k of lostCalcs) sentences.push({ text: canonicalCalcSentence(k), result_id: k.calcId, subject_id: subject });
    // Only a lost calculation to restore: nothing else is added (what the reply said stands as it is).
    const onlyCalcs = !missing.length && !bare && !unsettled;
    // What the conversation already established for this person (cited, bound), newest last.
    // Only what bears on what is missing (the sum insured; a hospital stay), or everything when the reply only said back;
    // one statement per figure, never a figure the reply already states.
    const wantSum = missing.some((m) => /sum insured/i.test(m)), wantStay = missing.some((m) => /hospital/i.test(m));
    const figs = new Set(moneyFiguresIn(texts.join(" ")).map((f) => Math.round(f.value * 100)));
    const est = onlyCalcs ? [] : (state.established ?? []).filter((e) => (e.subjectId ?? subject) === subject && e.evidenceIds.every(live) && e.valueIds.every((id) => ctx.values.has(id)) && !texts.includes(e.text))
      .filter((e) => bare || unsettled || (wantSum && /sum (?:insured|assured)/i.test(e.text)) || (wantStay && /hospital|confine/i.test(e.text)))
      .filter((e) => { const f = moneyFiguresIn(e.text).map((x) => Math.round(x.value * 100)); if (f.length && f.every((x) => figs.has(x))) return false; f.forEach((x) => figs.add(x)); return true; }).slice(-3);
    sentences.push(...est.map((e) => ({ text: e.text, evidence_ids: e.evidenceIds, value_ids: e.valueIds, ...(e.benefit ? { benefit: e.benefit } : {}), subject_id: subject })));
    const saidNow = [...texts, ...est.map((e) => e.text)].join(" ");
    // The person's own printed amounts read this conversation (a certificate's sum insured) that nothing says yet.
    const amounts = [...ctx.values.entries()].filter(([, v]) => v.subjectId === subject && v.operand.valueKind === "money" && v.operand.cents != null && live(evidenceIdOf(state, v.operand.evidence)) && !moneyFiguresIn(saidNow).some((f) => Math.abs(f.value * 100 - v.operand.cents!) < 1));
    const ctxText = [saidNow, question ?? "", ...(pendingBefore?.kind === "fact" ? pendingBefore.evidenceIds ?? [] : []).map((id) => state.evidence[id]?.passage.text ?? "")].join(" ");
    const percentOfSum = /%\s*of (?:the )?sum (?:insured|assured)|percentage shown|\bof the sum (?:insured|assured)\b/i.test(ctxText);
    if (!onlyCalcs && percentOfSum && !statesOwnAmount(saidNow, subject)) {
      const pick = amounts.find(([, v]) => /sum (?:insured|assured)|personal accident|accident/i.test(`${v.operand.benefit} ${v.selected.benefit ?? ""}`)) ?? null;
      if (pick) {
        const [valueId, v] = pick; const e = v.operand.evidence;
        const product = policyNames.get(e.policyId) ?? state.docNames?.[e.policyId] ?? "Your document";
        const asOf = e.table?.asOf ? ` as of ${new Date(e.table.asOf + "T00:00:00Z").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : "";
        sentences.push({ text: `${product} lists ${short}'s ${v.operand.benefit} as ${(e.table?.cell?.text ?? "").replace(/\s+/g, " ").trim() || `${v.operand.currency} ${(v.operand.cents! / 100).toLocaleString("en-SG")}`}${asOf}; the schedule's percentages are of that sum insured.`, value_ids: [valueId], subject_id: subject });
      } else {
        // The certificate amount was not read: the one bounded lookup, instead of saying it was not read.
        const look = await lookupSumInsured(subject);
        if (look?.kind === "one") {
          const v = ctx.values.get(look.valueId)!; const e = v.operand.evidence;
          const product = policyNames.get(e.policyId) ?? state.docNames?.[e.policyId] ?? "Your document";
          const asOf = e.table?.asOf ? ` as of ${new Date(e.table.asOf + "T00:00:00Z").toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : "";
          sentences.push({ text: `${product} lists ${short}'s ${v.operand.benefit} sum insured as ${(e.table?.cell?.text ?? "").replace(/\s+/g, " ").trim() || `${v.operand.currency} ${(v.operand.cents! / 100).toLocaleString("en-SG")}`}${asOf} (the amount on that date, not confirmation of current cover); the schedule's percentages are of that sum insured.`, value_ids: [look.valueId], subject_id: subject });
        } else if (look?.kind === "many") {
          notes.push(`${short} is listed with a sum insured for this product on more than one current document (${look.names.join(" and ")}), so I haven't picked one for the percentages.`);
          if (r.kind === "final" && look.evidenceIds.length) lookupAsk = { kind: "fact", question: `Which of these is ${short}'s current certificate: ${look.names.join(" or ")}?`, factKey: "current_certificate", subjectId: subject, why: "the percentages are of the sum insured on the current certificate", evidenceIds: look.evidenceIds, turn: state.turn };
        } else if (look?.kind === "none") notes.push(`I couldn't find ${short}'s own sum insured for this: ${look.why}, so no amount can be worked out from the percentages.`);
        else notes.push(`I couldn't tell which document's sum insured the schedule's percentages apply to, so no amount is shown.`);
      }
    }
    // A reported stay or bill: the passage already retrieved that prints its benefit, quoted; else named as not looked up.
    const ADDR = { stay: /\b(?:hospital\w*|in-?patient|confine\w*|warded)\b/i, bill: /\b(?:medical expenses?|bills?|reimburs\w*)\b/i };
    for (const m of missing) {
      const kind = /hospital income \/ hospital cash/.test(m) ? "stay" : /medical expenses/.test(m) ? "bill" : null;
      if (!kind) continue;
      if (kind === "stay" && lostCalcs.some((k) => k.calculator === "hospital_cash")) continue; // the stay's own calculation is shown
      const words = /told you "([^"]+)"/.exec(m)?.[1] ?? "";
      let found: { id: string; line: string; product: string } | null = null;
      for (const [id, e] of Object.entries(state.evidence)) {
        if (!live(id) || (e.subjectId && e.subjectId !== subject)) continue;
        const line = e.passage.text.split(/\n+/).map((l) => l.trim()).find((l) => ADDR[kind].test(l) && moneyFiguresIn(l).length && /^[A-Za-z][A-Za-z ()'’/-]{2,60}:\s/.test(l));
        if (line) { found = { id, line: line.length > 260 ? line.slice(0, line.indexOf(".", 120) + 1 || 260) : line, product: policyNames.get(e.policyId) ?? state.docNames?.[e.policyId] ?? "your policy" }; break; }
      }
      if (found) sentences.push({ text: `For the stay you mentioned, the ${found.product} says: “${found.line.replace(/[.\s]+$/, "")}”.`, evidence_ids: [found.id], subject_id: subject });
      else notes.push(`I haven't yet looked up what your documents pay for ${kind === "stay" ? "the hospital stay" : "the bill"} you mentioned${words ? ` (“${words}”)` : ""}, so that is still open.`);
    }
    const composed = sentences.length ? composeFinal({ sentences, subjectId: subject }, composeCtx()) : null;
    const merged: Composed | null = c0 && composed ? { ...c0, sentences: [...c0.sentences, ...composed.sentences.filter((x) => !c0.sentences.some((y) => y.text === x.text))], figureBindings: [...c0.figureBindings, ...composed.figureBindings], computations: [...c0.computations, ...composed.computations], calculations: [...c0.calculations, ...composed.calculations], calcs: [...c0.calcs, ...composed.calcs], evidenceIds: [...new Set([...c0.evidenceIds, ...composed.evidenceIds])], dropped: [...c0.dropped, ...composed.dropped], notes: c0.notes.filter((n) => !/your own account|claim form/i.test(n)) } : (composed ?? c0);
    // The grounded question: the one already open; else what the calculation still needs; else -- when the household's
    // reply to the question just asked does not visibly answer it -- that question again.
    if (r.kind === "ask") return { ...r, composed: merged, trailing: [...(r.trailing ?? []), ...notes] };
    let ask: Extract<LoopPending, { kind: "fact" }> | null = state.pending?.kind === "fact" ? state.pending : lookupAsk ?? (merged ? followUpFor(merged) : null);
    if (!ask && unsettled && pendingBefore?.kind === "fact") {
      ask = { ...pendingBefore, turn: state.turn };
      notes.push(`I couldn't tell from your reply (“${replyWords.trim()}”) whether that answers my last question, so I'm asking it again.`);
    }
    if (ask) return { kind: "ask", pending: ask, preface: null, composed: merged, trailing: notes };
    if (merged) merged.notes = [...merged.notes, ...notes];
    return merged ? { kind: "final", composed: merged } : r;
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
    if (!m.ok) { stop = m.stop; if (m.stop.kind === "model_error") { record("model", {}, false, [], m.stop.detail); } break; }
    const out = m.out;
    trace.steps++; trace.modelId = out.modelId || trace.modelId;
    messages.push({ role: "assistant", content: out.text, toolCalls: out.toolCalls });
    if (!out.toolCalls.length) { messages.push({ role: "user", content: "Use the tools. End the turn only with ask_user or final_answer." }); continue; }
    for (const call of out.toolCalls) {
      if (reply) { messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: "the turn already ended" }) }); continue; }
      if (LOOP_ACTIONS.some((s) => s.name === call.name)) {
        // Reliable chat (contract C): statements of kind calculation / benefit_terms and contact next steps are written
        // by the server from the saved calculation or the resolved record; an id this turn did not produce is sent back.
        if (call.name === "final_answer" || call.name === "ask_user") {
          // PR #54 follow-up: the terms of a benefit whose own definition the household's report contradicts are left out
          // (it does not apply to what they described); the rest of the answer is unchanged.
          const field = call.name === "final_answer" ? "sentences" : "statements";
          const given = call.arguments[field] as Record<string, unknown>[] | undefined;
          if (Array.isArray(given) && notApplicable.size) {
            const keep = given.filter((x) => !(x?.kind === "benefit_terms" && [...notApplicable.keys()].some((k) => k.endsWith(`|${String(x.benefit_id ?? "")}`))));
            if (keep.length !== given.length) { (trace.adjusted ??= []).push(`${call.name}: left out the terms of ${given.length - keep.length} benefit(s) whose definition does not fit what the household reported`); call.arguments = { ...call.arguments, [field]: keep }; }
          }
          const list = (call.name === "final_answer" ? call.arguments.sentences : call.arguments.statements) as Record<string, unknown>[] | undefined;
          const problems = await renderStatements(call.arguments, list, { ctx, state, evidenceId: (ref) => evidenceIdOf(state, ref, "statement"), nameOf: (id) => input.people.find((p) => p.id === id)?.name ?? null });
          if (problems.length) { noteFailure(call.name); record(call.name, call.arguments, false, [], problems.join("; ")); messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: problems.join("; ") }) }); continue; }
        }
        if (call.name === "final_answer" || call.name === "ask_user") await bindCitedFigures(call);
        let r = action(call);
        // PR #54 (rc-live-8): a model statement about a benefit the server offered this turn that fails its check is
        // omitted whole; the benefit's own validated terms are kept, written by the same renderer from its record
        // (benefit_terms) -- never the model's failed words, and never a benefit the statement did not name.
        if (r.terminal?.kind === "final" && call.name === "final_answer" && Array.isArray(call.arguments.sentences)) {
          const sentences = call.arguments.sentences as Record<string, unknown>[];
          const extra = retainedTerms(sentences, r.terminal.composed.dropped, String(call.arguments.subject_id ?? state.subjectId ?? ""));
          if (extra.length) {
            const again = { ...call, arguments: { ...call.arguments, sentences: [...sentences, ...extra] } };
            const p2 = await renderStatements(again.arguments, extra, { ctx, state, evidenceId: (ref) => evidenceIdOf(state, ref, "statement"), nameOf: (id) => input.people.find((p) => p.id === id)?.name ?? null });
            if (!p2.length) {
              await bindCitedFigures(again);
              const r2 = action(again);
              if (r2.terminal?.kind === "final") { r = r2; call.arguments = again.arguments; (trace.adjusted ??= []).push(`final_answer: kept the validated terms of ${extra.map((x) => String(x.benefit)).join(", ")} for a statement about it that failed its check`); }
            }
          }
        }
        if (r.terminal?.kind === "final" && !gateRepaired) {
          const repair = await gateRepair(r.terminal.composed);
          if (repair) { gateRepaired = true; beforeRepair = r.terminal; meter.grantRepairCall(); r = { result: { ok: false, error: repair } }; }
        } else if (r.terminal?.kind === "final" && gateRepaired) limitDateDrops(r.terminal.composed, call);
        record(call.name, call.arguments, r.result.ok !== false, [], r.result.ok === false ? String(r.result.error) : undefined);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(r.result) });
        if (r.terminal && TERMINAL.has(call.name)) reply = r.terminal;
        continue;
      }
      if (call.name === "calculate") await readTableRest(call);
      const refusal = preflight(call);
      if (refusal) { record(call.name, call.arguments, false, [], refusal); messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify({ ok: false, error: refusal }) }); continue; }
      const toolT0 = Date.now();
      const res = await runTool(ctx, call.name, call.arguments, loopToolEnv(env));
      { const tm = (toolMs[call.name] ??= { n: 0, ms: 0 }); tm.n++; tm.ms += Date.now() - toolT0; }
      await refine(res.evidence, typeof call.arguments.query === "string" ? call.arguments.query : typeof call.arguments.benefit === "string" ? call.arguments.benefit : null);
      const ids: string[] = [];
      const shown = resultForModel(res as { ok: boolean; data?: unknown; error?: string; evidence: unknown }, state, call.name, ids, shownThisTurn);
      if (!res.ok) noteFailure(call.name);
      if (res.ok && call.name === "calculate" && typeof call.arguments.subject_id === "string") {
        const miss = ((shown as { data?: { missing?: { key: string; ask: string; why: string; evidence?: { evidence_id?: string }[] }[] } }).data?.missing ?? []).filter((m) => m.ask === "household");
        const byBenefit = calcMissingBy.get(call.arguments.subject_id) ?? new Map(); calcMissingBy.set(call.arguments.subject_id, byBenefit);
        const benefitKey = String(call.arguments.benefit ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        byBenefit.set(benefitKey, miss.map((m) => ({ key: normalizeKey(m.key), why: m.why, evidenceIds: (m.evidence ?? []).map((e) => e.evidence_id ?? "").filter(Boolean) })));
        // An unresolved calculation waiting only for household facts is kept (its validated arguments), so the turn
        // those facts arrive can complete it with the same tool -- whatever else is still being clarified.
        const kind = (res.data as { kind?: string }).kind;
        const openKey = `${call.arguments.subject_id}|${String(call.arguments.calculator)}|${benefitKey}`;
        if (kind === "unresolved" && miss.length) (state.openCalcs ??= {})[openKey] = { args: call.arguments, missing: miss.map((m) => normalizeKey(m.key)), turn: state.turn };
        else if (kind === "indicative_estimate" || kind === "conditional_illustration") { if (state.openCalcs) delete state.openCalcs[openKey]; }
      }
      // Reliable chat: what an evaluation's case rests on -- the facts the model names (fact_keys), else the facts the
      // household gave for this person this turn -- so a correction withdraws exactly the results built on it.
      if (res.ok && call.name === "evaluate_benefit" && (res.data as { status?: string }).status === "unlisted_case") {
        const d = res.data as { listed_cases?: string; benefit?: string };
        unlistedNow.set(String(call.arguments.subject_id ?? ""), { benefit: d.benefit ?? "", labels: String(d.listed_cases ?? "").split("; ").map((x) => x.replace(/\s+\d+(?:\.\d+)?%$/, "").trim()).filter(Boolean) });
      }
      if (res.ok && call.name === "evaluate_benefit") {
        const rid = (res.data as { result_id?: string }).result_id; const k = rid ? calcOutcomes(ctx).get(rid) : undefined;
        const subj = String(call.arguments.subject_id ?? "");
        const facts = (state.claim?.subjectId === subj ? state.claim.facts : state.otherClaims?.[subj]?.facts) ?? {};
        const named = Array.isArray(call.arguments.fact_keys) ? (call.arguments.fact_keys as unknown[]).map(String).filter((x) => facts[x]) : [];
        if (k) k.dependsOn = named.length ? named : [...new Set(recordedNow.filter((r) => r.subject === subj && facts[r.key]).map((r) => r.key))];
        // PR #54 follow-up: the facts the benefit's definition was checked against are what the result rests on too
        const appKeys = (((res.data as { applicability?: { fact_keys?: string[] } }).applicability?.fact_keys) ?? []).filter((x) => facts[x]);
        if (k && appKeys.length) k.dependsOn = [...new Set([...(k.dependsOn ?? []), ...appKeys])];
        // rc-live-3 RCT2a: the open "which case?" question is answered once the server has settled the case from the
        // household's words (a result for one listed case, or the case is not listed) -- whatever key the model noted
        // the answer under ("fracture_bone_detail" for a question asked as "fracture_bone"). It is never put back.
        const status = (res.data as { status?: string }).status;
        const bid = String(call.arguments.benefit_id ?? "");
        const reason = (res.data as { reason?: string }).reason;
        if (bid && ((status === "needs_facts" && (reason === "missing" || reason === "ambiguous")) || status === "case_conflict")) caseOpenNow.set(subj, bid);
        const settles = !!bid && (!!rid || status === "unlisted_case" || status === "not_applicable");
        if (bid && subj && status === "not_applicable") { notApplicable.set(`${subj}|${bid}`, (res.data as { why?: string }).why ?? ""); withdrawInapplicable(subj, bid, String((res.data as { why?: string }).why ?? "")); }
        if (settles && caseOpenNow.get(subj) === bid) caseOpenNow.delete(subj);
        if (settles) for (const [k2, r2] of requirements) if (r2.subjectId === subj && r2.benefitId === bid) requirements.delete(k2);
        // (latency: the benefit stays addressable by its id in later turns -- re-resolved and re-checked on every call)
        { const rec = ctx.benefitRecords?.get(bid); if (rec && subj) state.evaluated = [...(state.evaluated ?? []).filter((e) => !(e.id === bid && e.subjectId === subj)), { id: bid, benefit: rec.benefit, product: rec.policy.product, subjectId: subj }].slice(-6); }
        if (bid && subj && (status === "needs_facts" || status === "case_conflict")) {
          const dd = res.data as { benefit?: string; ask?: string; need?: string; options?: { option_id: string; case: string }[]; matching_cases?: string[] };
          const isCase = reason === "missing" || reason === "ambiguous" || status === "case_conflict";
          const isApp = reason === "applicability";
          const optionList = isCase || isApp ? (dd.options ?? []) : [];
          const factKey = isApp ? normalizeKey(String((res.data as { fact_key?: string }).fact_key ?? "")) || `detail_${bid}` : isCase ? `listed_case_${bid}` : /admission/i.test(dd.need ?? "") ? "admission_datetime" : /discharge/i.test(dd.need ?? "") ? "discharge_datetime" : normalizeKey(dd.need ?? "") || `detail_${bid}`;
          const question = dd.ask ?? (status === "case_conflict" && dd.matching_cases?.length ? `Which of these is it: ${dd.matching_cases.join(" or ")}?` : `What does ${dd.benefit ?? "this benefit"} still need: ${dd.need ?? "the missing detail"}?`);
          const reqIdNew = `q${state.turn}_${++reqSeq}`;
          // (every requirement the server creates here asks for something the household reports or can observe -- which
          // listed case, the detail a definition turns on, a stay's dates -- never an insurer's assessment)
          const reqNew: Requirement = { id: reqIdNew, subjectId: subj, benefitId: bid, benefit: dd.benefit ?? bid, factKey, question, options: optionList.map((o) => o.option_id), evidenceIds: [...ids], isCase, optionLabels: new Map(optionList.map((o) => [o.option_id, o.case])), resolvedBy: "household" };
          for (const [k2, r2] of requirements) if (r2.subjectId === subj && r2.benefitId === bid) requirements.delete(k2);
          requirements.set(reqIdNew, reqNew);
          const sd = (shown as { data?: Record<string, unknown> }).data;
          if (sd && typeof sd === "object") { sd.requirement_id = reqIdNew; sd.resolved_by = reqNew.resolvedBy; sd.requirement_note = "To ask the household for this, call ask_user with requirement_id and your question (the server supplies the person, the fact and the evidence). Give the benefit's printed terms first (benefit_terms)."; }
        }
        const asksCase = (p: LoopPending | null | undefined) => p?.kind === "fact" && (p.subjectId ?? subj) === subj && (p.caseOf === bid || p.benefitId === bid || (!!p.options?.length && p.options.every((o) => String(o).startsWith(bid))));
        if (settles && asksCase(state.pending)) { state.pending = null; (trace.adjusted ??= []).push(`the open case question was answered (${bid})`); }
        if (settles && asksCase(state.parkedPending)) state.parkedPending = null;
      }
      if (res.ok && call.name === "compute") { const rid = (res.data as { resultId?: string }).resultId; if (rid) computeCalls.set(rid, { operation: String(call.arguments.operation), operands: (call.arguments.operands as Record<string, unknown>[]) ?? [] }); }
      if (res.ok && call.name === "household_documents") inventoryNow = res.data as Inventory;
      if (call.name === "resolve_person") lastMention = String(call.arguments.mention ?? "");
      if (res.ok && call.name === "resolve_person") {
        const r = res.data as { status: string; person?: { id: string }; via?: string; options?: { id: string; relationLabel?: string }[] };
        const selfMention = SELF_MENTION.test(String(call.arguments.mention ?? "").trim());
        if (r.status === "ok" && r.person) {
          const id = r.person.id;
          if (pendingBefore?.kind === "person" && pendingBefore.purpose === "speaker" && pendingBefore.options.some((o) => o.id === id) && !state.speakerId) {
            // The household said who is typing: that is the speaker, not who the conversation is about.
            state.speakerId = id; state.speakerConfirmed = true; ctx.conversation.speakerId = id;
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
  { const modelMs = (meter.calls ?? []).reduce((a, c) => a + (c.latencyMs ?? 0), 0), tools = Object.values(toolMs).reduce((a, c) => a + c.ms, 0); trace.timings = { modelMs, toolMs, resolve: { n: ctx.timing?.resolveCount ?? 0, ms: ctx.timing?.resolveMs ?? 0 }, otherMs: Math.max(0, trace.latencyMs - modelMs - tools) }; }
  state.seq = ctx.seq;

  // V1.2: a calculation left unresolved only for household facts (kept per benefit, with its validated arguments) is
  // completed the turn those facts are recorded -- whatever else is still being clarified -- with the same tool and its
  // own checks. Only facts the household gave (their words); never a model call; at most two per turn.
  if (state.openCalcs && reply) {
    const FILL: Record<string, (f: { value: unknown; words: string }) => [string, Record<string, unknown>] | null> = {
      admission_datetime: (f) => (/^\d{4}-\d{2}-\d{2}/.test(String(f.value)) ? ["admission", { at: String(f.value), words: f.words }] : null),
      discharge_datetime: (f) => (/^\d{4}-\d{2}-\d{2}/.test(String(f.value)) ? ["discharge", { at: String(f.value), words: f.words }] : null),
    };
    let reruns = 0;
    for (const [key, open] of Object.entries(state.openCalcs)) {
      const subject = String(open.args.subject_id ?? "");
      if (reruns >= 2 || open.turn === state.turn || !recordedNow.some((x) => x.subject === subject)) continue;
      const facts = (state.claim?.subjectId === subject ? state.claim.facts : state.otherClaims?.[subject]?.facts) ?? {};
      const fills = open.missing.filter((k) => FILL[k]);
      if (!fills.length) continue;
      const args: Record<string, unknown> = { ...open.args };
      let ready = true;
      for (const k of fills) { const known = knownFactFor(k, facts as Parameters<typeof knownFactFor>[1]); const v = known ? FILL[k]({ value: known.fact.value, words: String((known.fact as { words?: string }).words ?? "") }) : null; if (!v || !v[1].words) { ready = false; break; } args[v[0]] = v[1]; }
      if (!ready) continue;
      reruns++;
      const res = await runTool(ctx, "calculate", args, loopToolEnv(env));
      const ids2: string[] = []; resultForModel(res as { ok: boolean; data?: unknown; error?: string; evidence: unknown }, state, "calculate", ids2, new Set());
      const d = res.ok ? (res.data as { calc_id?: string; kind?: string; amount?: number }) : null;
      record("calculate", { ...args, by: "grounded fallback (open calculation)" }, res.ok, ids2, res.ok ? undefined : res.error, d ? JSON.stringify({ kind: d.kind, amount: d.amount, calc: d.calc_id }) : undefined);
      const k = d?.calc_id ? calcOutcomes(ctx).get(d.calc_id) : undefined;
      if (k && (k.kind === "indicative_estimate" || k.kind === "conditional_illustration")) { completedCalcs.push(k); delete state.openCalcs[key]; }
    }
    state.seq = ctx.seq;
  }
  /** V1.3: an inventory answer lists every document the structured lookup returned, grouped by person, with its
   * insurer, product and role and whether it could be read -- from that lookup, never from what a sentence managed
   * to keep. A reply that already names every document stands; otherwise its figure-free sentences that name no
   * document are kept and the inventory is stated from the lookup (no amount is added). */
  const withInventory = (r: LoopReply | null): LoopReply | null => {
    if (!inventoryNow || !r || r.kind !== "final" || !r.composed) return r;
    // V1.4: only an inventory QUESTION ("what policies does my family have?") is answered as an inventory. A model that
    // looks the documents up while answering something else (a death claim) keeps its own verified, bound answer: the
    // inventory rule removes every sentence with a figure and every binding, so applying it to any turn that called
    // household_documents silently dropped verified amounts (s50-live-1 turn 1).
    // Reliable chat (recorded failure 4): "which of my uploaded policies should I claim under for Adrian's accident?" is
    // an EVENT question about which benefits may apply, not a request for the library list -- calling the document
    // lookup on the way never turns the answer into an inventory.
    if (!INVENTORY_QUESTION.test(input.message) || CLAIM_SELECTION_QUESTION.test(input.message)) return r;
    const inv = inventoryNow;
    const docs = [...inv.people.flatMap((p) => p.documents), ...inv.unlinked];
    const said = r.composed.sentences.map((x) => x.text).join(" ").toLowerCase();
    // (An empty name names nothing: an unreadable upload has no product name, only its file name and status.)
    const has = (t: string | null | undefined) => !!t && t.trim().length > 0 && said.includes(t.toLowerCase());
    const named = (d: InventoryDoc) => (d.readable === "ready" ? has(d.name) || has(d.filename) : has(d.filename));
    // V1.5 (s52-live-1): an inventory answer that lists the library answers the question -- the generic "couldn't confirm
    // an answer" note (added because some model sentences were taken out) is not shown under it.
    const answered = (notes: string[]) => notes.filter((n) => n !== DROPPED_NOTE);
    if (docs.every(named) && inv.people.every((p) => said.includes(p.short.toLowerCase()))) return { ...r, composed: { ...r.composed, notes: answered(r.composed.notes), libraryNames: docs.flatMap((d) => [d.name, d.filename]).filter(Boolean) } };
    // V1.5 (live verification, 14 Oct): a reply that names every readable document but leaves out a file that could not
    // be read keeps what it says and gains that file's status line from the lookup -- the household asked for it, and a
    // status fact needs no page citation (it is the library's own record).
    const statusMissing = docs.filter((d) => d.readable !== "ready" && !named(d));
    if (statusMissing.length && docs.filter((d) => d.readable === "ready").every(named) && inv.people.every((p) => said.includes(p.short.toLowerCase()))) {
      const owner = (d: InventoryDoc) => inv.people.find((p) => p.documents.includes(d))?.short ?? null;
      const lines = statusMissing.map((d) => ({ text: `${d.filename}: its contents could not be read (${d.reason ?? "it could not be read"}), so nothing in it can be used${owner(d) ? `; it is linked to ${owner(d)}` : "; it is not linked to anyone in the household"}.`, evidenceIds: [] as string[], estimate: false, factKeys: [] as string[] }));
      return { ...r, composed: { ...r.composed, notes: answered(r.composed.notes), sentences: [...r.composed.sentences, ...lines], libraryNames: docs.flatMap((d) => [d.name, d.filename]).filter(Boolean) } };
    }
    // V1.4: a sentence whose every figure is verified and bound (person, product, source) is kept with its bindings --
    // an inventory request asked alongside a claim question does not erase the claim's documented amounts.
    const bindingsOf = (text: string) => r.composed.figureBindings.filter((b) => !!b.sentence && (text.includes(b.sentence) || b.sentence.includes(text)));
    const boundFigures = (x: { text: string; estimate?: boolean }) => !x.estimate && moneyFiguresIn(x.text).length > 0 && bindingsOf(x.text).length >= moneyFiguresIn(x.text).length;
    const keep = r.composed.sentences.filter((x) => boundFigures(x) || (!moneyFiguresIn(x.text).length && !docs.some((d) => x.text.toLowerCase().includes(d.name.toLowerCase())) && !inv.people.some((p) => new RegExp(`\\b${p.short.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(x.text))));
    const keptBindings = keep.filter(boundFigures).flatMap((x) => bindingsOf(x.text));
    const lines = inventorySentences(inv).map((l) => ({ text: l.text, evidenceIds: l.evidence.map((e) => evidenceIdOf(state, e, "household_documents")), estimate: false, factKeys: [] as string[] }));
    trace.incomplete = [...(trace.incomplete ?? []), "the inventory was stated from the household's document lookup"];
    const composed: Composed = { ...r.composed, notes: answered(r.composed.notes), libraryNames: docs.flatMap((d) => [d.name, d.filename]).filter(Boolean), sentences: [...keep, ...lines], figureBindings: keptBindings, computations: [], calculations: [], calcs: [], evidenceIds: [...new Set([...keep.flatMap((x) => x.evidenceIds), ...lines.flatMap((x) => x.evidenceIds)])] };
    return { ...r, composed };
  };
  /** V1.4: the ONE question a printed condition needs, when the reply ends without a question. A benefit of the subject's
   * own linked documents (lib/rag2/benefits.ts) whose printed condition counts a time window from an event ("within 365
   * days of that Accident"), relevant to what the household reported (its words share the event and the benefit), and
   * the event's date not given: the household is asked for that date, citing the condition. Chosen from the documents'
   * own requirements -- never a scripted question; nothing is asked when no printed condition needs a missing fact. */
  const conditionQuestion = (r: LoopReply | null): LoopReply | null => {
    if (!r || r.kind !== "final" || state.pending || !benefitView) return r;
    const subject = r.composed.subjectId ?? state.claim?.subjectId ?? state.subjectId ?? null;
    if (!subject) return r;
    const STEM_SYN = TOPIC_SYN;
    const stems = topicStems;
    const said = stems(userTexts.join(" "));
    const DATE_GIVEN = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:yesterday|today|last (?:night|week|month))\b/i;
    const WINDOW = /within\s+(\d+)\s+(?:calendar\s+)?(days?|months?|years?)\s+(?:of|from|after)\s+(?:the\s+|that\s+|an?\s+)?(?:(?:date|day)\s+of\s+(?:the\s+|that\s+|an?\s+)?|occurrence\s+of\s+(?:the\s+|that\s+)?)?(accident|injury|onset|diagnosis|event)/i;
    for (const b of benefitView.byMember.get(subject)?.benefits ?? []) {
      const cond = b.conditions.find((c) => WINDOW.test(c));
      if (!cond) continue;
      const anchor = WINDOW.exec(cond)![3].toLowerCase();
      const own = stems(`${b.benefit.label} ${cond}`);
      const shared = [...own].filter((w) => said.has(w));
      const anchorStem = STEM_SYN.find(([re]) => re.test(anchor))?.[1] ?? anchor;
      if (!shared.includes(anchorStem) || shared.length < 2) continue;
      const known = Object.keys(state.claim?.facts ?? {}).some((k) => new RegExp(`${anchorStem}.*(?:date|time)|(?:date|time).*${anchorStem}|event_date|incident_date`, "i").test(k)) || userTexts.some((u) => DATE_GIVEN.test(u));
      if (known) return r;
      // PR #54 (after rc-live-8): a hypothetical event ("If Daniel died in an accident ...", "Suppose ...") has no date
      // the household could give -- asking for one is a question they cannot answer; the printed terms are the answer.
      const HYPOTHETICAL = /^\s*(?:if|suppose|supposing|what if|in (?:the )?case|were|should)\b/i;
      if (HYPOTHETICAL.test(input.message) || Object.values(state.claim?.facts ?? {}).some((f) => f?.turn === state.turn && HYPOTHETICAL.test(String((f as { words?: string }).words ?? "")))) return r;
      const id = evidenceIdOf(state, b.source.evidence, "person_benefits");
      const doc = b.policy.product ?? "your document";
      const clause = (/\b(?:if|provided|when)\b.*$/i.exec(cond)?.[0] ?? cond).replace(/[.\s]+$/, "");
      const pending: Extract<LoopPending, { kind: "fact" }> = { kind: "fact", question: `On what date did the ${anchor} happen?`, factKey: `${anchorStem}_date`, subjectId: subject, why: `${doc} pays its ${b.benefit.label} only ${clause}`, evidenceIds: [id], turn: state.turn };
      (trace.adjusted ??= []).push(`asked the date a printed condition counts from (${b.benefit.label}: "${cond}")`);
      return { kind: "ask", pending, preface: null, composed: r.composed };
    }
    return r;
  };
  let reasked: LoopPending | null = null;
  // Reliable chat (contract C, library_status): an inventory question is answered from the household's own document
  // lookup even when the model did not call it -- the list never depends on which model sentences survived the checks.
  // (Only for a plain inventory question -- no event, no figures -- and only when some of the model's own sentences were
  // taken out: a reply that stood on its own is left as the model wrote it.)
  const ended = (reply ?? beforeRepair) as LoopReply | null;
  if (!inventoryNow && INVENTORY_QUESTION.test(input.message) && !CLAIM_SELECTION_QUESTION.test(input.message) && !EVENT_WORDS.test(input.message) && !/\d/.test(input.message) && ended?.kind === "final" && (ended.composed?.dropped.length ?? 0) > 0) {
    const res = await runTool(ctx, "household_documents", {}, loopToolEnv(env)).catch(() => null);
    if (res?.ok) { inventoryNow = res.data as Inventory; record("household_documents", { by: "server" }, true, []); }
  }
  let done = conditionQuestion(withInventory(await groundedFallback((reply ?? beforeRepair) as LoopReply | null)));
  // Actual-library findings: further model use is blocked (the turn's budget) while an evaluation's requirement is open:
  // the household gets the verified terms of that benefit and the outstanding question -- written by the server from the
  // requirement, never the generic limit text or a figure about something else.
  if (!done && BUDGET_STOPS.has(stop?.kind ?? "turn_calls") && [...requirements.values()].some((x) => x.resolvedBy === "household")) {
    const r = [...requirements.values()].filter((x) => x.resolvedBy === "household").at(-1)!;
    const st: Record<string, unknown>[] = [{ kind: "benefit_terms", benefit_id: r.benefitId, subject_id: r.subjectId, text: "-" }];
    const problems = await renderStatements({}, st, { ctx, state, evidenceId: (ref) => evidenceIdOf(state, ref, "statement"), nameOf: (id) => input.people.find((p) => p.id === id)?.name ?? null });
    const composed = !problems.length ? composeFinal({ sentences: st, subjectId: r.subjectId }, composeCtx()) : null;
    const because = r.evidenceIds.filter((id) => state.evidence[id] && !stale.has(id));
    if (because.length) {
      const why = because.map((id) => `${whyLine(state.evidence[id], r.question + " " + r.factKey)} (page ${state.evidence[id].passage.onPage})`).join("; ");
      done = { kind: "ask", pending: { kind: "fact", question: r.question, factKey: r.factKey, subjectId: r.subjectId, why, evidenceIds: because, ...(r.options.length ? { options: r.options.map((o) => r.optionLabels?.get(o) ?? o) } : {}), ...(r.isCase ? { caseOf: r.benefitId } : {}), requirementId: r.id, benefitId: r.benefitId, turn: state.turn }, preface: null, composed: composed?.sentences.length ? composed : null };
      (trace.adjusted ??= []).push(`model use blocked (${stop?.kind ?? "turn_calls"}): asked requirement ${r.id} from the server`);
      trace.limit = { kind: stop?.kind ?? "turn_calls", detail: stop?.detail ?? "the turn ended without an answer" };
    }
  }
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
    if (state.claim) for (const s of c.sentences) if ((s.estimate || s.kind === "conditional_illustration") && s.factKeys.length) state.claim.derived.push({ sentence: s.text, factKeys: s.factKeys, turn: state.turn, evidenceIds: s.evidenceIds });
    // Agent G: each calculation of the claim, with the facts and evidence it rests on (what a correction or a deleted
    // source withdraws, here and on the claim record).
    if (state.claim?.subjectId) for (const k of c.calcs) if (k.subjectId === state.claim.subjectId) (state.claim.calcs ??= {})[k.calcId] = calcRef(k, state.claim, (k.evidence ?? []).map((e) => evidenceIdOf(state, e, "calculate")), state.turn);
    // An interruption: the claim question still open is put back to the household after the side answer.
    if (state.pending?.kind === "person") state.pending = null;
    // V1.1: a correction of who the claim is about withdraws the question asked about the first person.
    if (state.pending?.kind === "fact" && state.pending.subjectId && corrections.some((k) => k.key === "person") && state.claim?.subjectId && state.pending.subjectId !== state.claim.subjectId) state.pending = null;
    if (state.parkedPending?.kind === "fact" && state.parkedPending.subjectId && corrections.some((k) => k.key === "person") && state.claim?.subjectId && state.parkedPending.subjectId !== state.claim.subjectId) state.parkedPending = null;
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
  // PR #54 follow-up: every earlier illustration of this conversation is re-checked against its benefit's definition with
  // what the household has now reported (a correction may have changed it under any key): one that no longer fits is
  // withdrawn. (Only on a turn that recorded something.)
  if (recordedNow.length) for (const claim of [state.claim, ...Object.values(state.otherClaims ?? {})]) {
    if (!claim?.subjectId) continue;
    const live = Object.values(claim.calcs ?? {}).filter((r) => !r.withdrawn && r.turn < state.turn);
    if (!live.length) continue;
    const recs = await recordsFor(ctx, claim.subjectId).catch(() => [] as Awaited<ReturnType<typeof recordsFor>>);
    for (const r of live) {
      const rec = recs.find((x) => x.policy.id === r.policyId && x.benefit.toLowerCase() === r.benefit.toLowerCase() && x.definitions.length);
      if (!rec) continue;
      const app = applicabilityOf(rec.benefit, rec.definitions, householdReports(claim.subjectId, claim.facts));
      if (app.status === "inconsistent") { (ctx.benefitRecords ??= new Map()).set(rec.id, rec); withdrawInapplicable(claim.subjectId, rec.id, app.why); }
    }
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
/** Every readable document's stored pages, joined in page order (household-scoped; readable documents only). */
/** V1.5: each readable document's stored pages and file hash (compose cites a document's own currency statement). */
export async function loadLibraryPages(accountId: string): Promise<Map<string, { hash: string | null; pages: { page: number; text: string }[] }>> {
  const docs = await loadDocs(accountId);
  const pages = await loadPages(accountId, docs.map((d) => d.id));
  return new Map(docs.map((d) => [d.id, { hash: d.fileHash ?? null, pages: pages.filter((p) => p.policyId === d.id).sort((a, b) => a.page - b.page).map((p) => ({ page: p.page, text: p.text })) }]));
}
export async function loadLibraryText(accountId: string): Promise<Map<string, string>> {
  const docs = await loadDocs(accountId);
  const pages = await loadPages(accountId, docs.map((d) => d.id));
  return new Map(docs.map((d) => [d.id, pages.filter((p) => p.policyId === d.id).sort((a, b) => a.page - b.page).map((p) => p.text).join("\n")]));
}
export async function revalidateEvidence(accountId: string, state: RagLoopState): Promise<{ stale: Map<string, string>; policyNames: Map<string, string>; docFacts: Map<string, string> }> {
  const stale = new Map<string, string>();
  const docs = await loadDocs(accountId).catch(() => null);
  const policyNames = new Map((docs ?? []).map((d) => [d.id, d.productName ?? d.insurer ?? "Policy document"]));
  // V1.1 (evidence contract): what a document states on its face -- product, insurer, policy and group numbers, and
  // that an endorsement amends its policy -- is part of what a sentence citing it may say.
  const docFacts = new Map((docs ?? []).map((d) => [d.id, [d.productName, d.insurer, d.policyNumber, d.groupPolicyNumber, d.documentRole === "endorsement" ? "endorsement amends amended amendment" : null].filter(Boolean).join(" ")]));
  const entries = Object.values(state.evidence);
  if (!entries.length) return { stale, policyNames, docFacts };
  if (!docs) { for (const e of entries) stale.set(e.id, "I couldn’t confirm that the documents an earlier answer relied on are still current, so I can’t rely on what they said."); return { stale, policyNames, docFacts }; }
  const live = new Map(docs.map((d) => [d.id, d]));
  // The names of documents read earlier are remembered from when they were readable (never re-read once deleted).
  const names = (state.docNames ??= {});
  for (const e of entries) { const d = live.get(e.policyId); if (d?.productName) names[e.policyId] = d.productName; }
  for (const e of entries) {
    const d = live.get(e.policyId);
    if (!d) { const n = names[e.policyId]; stale.set(e.id, `${n ? `The ${n} document` : "A document"} an earlier answer relied on has since been deleted or replaced by a newer version, so I can no longer use what it said.`); continue; }
    if (e.documentHash && d.fileHash && e.documentHash !== d.fileHash) stale.set(e.id, `The ${d.productName ?? "policy"} document has changed since I read it, so I can no longer use what the earlier version said.`);
  }
  return { stale, policyNames, docFacts };
}
