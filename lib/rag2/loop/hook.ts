/**
 * Conversational RAG (Prompt 2): where the chat entry point hands a turn to the loop when DEARPOLICY_RAG_LOOP is on
 * (lib/chat/workflow.ts loads this module only then). prepareLoopChat() opens or continues the conversation without
 * the existing pipeline's own person routing (the loop resolves people itself, with resolve_person); runLoopChat()
 * runs the loop, turns its reply into a ChatAnswer and saves it through the chat's saveTurn -- so the existing
 * output guard and save-time figure gate (lib/chat/answer-verification.ts) check it like every other answer.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { getConversation, historyToken, openConversation, ChatConflict } from "@/lib/chat/store";
import { enforceLiveChatMonetaryBoundary } from "@/lib/chat/monetary-boundary";
import { verifyAnswerFigures } from "@/lib/chat/answer-verification";
import type { ChatContext, ChatRequest } from "@/lib/chat/workflow";
import type { ChatResult, ConversationState } from "@/lib/chat/types";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer, ChatCitation, ChatQuestion } from "@/types";
import { DROPPED_NOTE } from "./compose";
import { FALLBACK_TEXT, runLoop, type LoopPerson } from "./loop";
import { loopModel } from "./model";
import { emptyLoopState, type RagLoopState, type TraceTurn } from "./types";

export type LoopConversationState = ConversationState & { ragLoop?: RagLoopState };
type Save = (args: { conversation: ChatContext["conversation"]; token: ChatContext["token"]; state: ConversationState; message: string; answer: ChatAnswer; jobId?: string }) => Promise<void>;

export const ESTIMATE_NOTICE = "Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.";
export const RESUME_NOTE = "When you’re ready, here is the question I was on.";

export async function prepareLoopChat(request: ChatRequest): Promise<ChatContext> {
  const family = (await query<ClaimPerson>(`SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`, [request.accountId])).rows;
  if (!family.length) throw new ChatConflict("Add a family member first. On the Household page, add yourself (and anyone else your policies cover), then ask again.");
  if (request.familyMemberId && !family.some((p) => p.id === request.familyMemberId)) throw new Error("Family profile not found.");
  const previousId = request.conversationId ?? request.claimSessionId;
  const previous = previousId ? await getConversation(request.accountId, previousId) : null;
  if (previousId && !previous) throw new ChatConflict("This chat was deleted or is unavailable. Start a new chat.");
  if (previous && request.conversationRevision != null && previous.revision !== request.conversationRevision) throw new ChatConflict("This chat changed. Reopen it before sending another message.");
  const conversation = previous ?? (await openConversation({ accountId: request.accountId, memberId: request.familyMemberId ?? null, title: request.question }));
  const token = await historyToken(request.accountId, conversation.family_member_id);
  return { request: { ...request, submittedQuestion: request.submittedQuestion ?? request.question }, family, people: family, conversation, token, holdings: [] };
}

const label = (p: ClaimPerson) => (p.preferred_name && p.preferred_name !== p.display_name ? `${p.display_name} (${p.preferred_name})` : p.display_name);
const words = (key: string) => key.replace(/_/g, " ");
const show = (v: unknown) => String(v).replace(/_/g, " ");

async function citationsFor(accountId: string, state: RagLoopState, ids: string[]): Promise<ChatCitation[]> {
  const refs = ids.map((id) => state.evidence[id]).filter(Boolean);
  if (!refs.length) return [];
  const rows = (await query<{ id: string; product_name: string | null; insurer: string | null; document_role: string | null }>(`SELECT id::text AS id, product_name, insurer, document_role FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`, [accountId, [...new Set(refs.map((r) => r.policyId))]]).catch(() => ({ rows: [] as { id: string; product_name: string | null; insurer: string | null; document_role: string | null }[] }))).rows;
  const out: ChatCitation[] = [];
  for (const r of refs) {
    if (out.some((c) => c.policyId === r.policyId && c.pageStart === r.page.start && c.pageEnd === r.page.end && c.excerpt === r.passage.text)) continue;
    const p = rows.find((x) => x.id === r.policyId);
    out.push({ chunkId: "rag2:" + r.id, policyId: r.policyId, policyName: p?.product_name ?? "Policy document", insurer: p?.insurer ?? undefined, pageStart: r.page.start, pageEnd: r.page.end, documentRole: p?.document_role ?? null, excerpt: r.passage.text });
  }
  return out;
}

function blank(): ChatAnswer {
  return { mode: "answer", summary: "", details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] };
}

/** One chat turn through the loop, saved through the chat's own saveTurn (and so its output guard and figure gate). */
export async function runLoopChat(context: ChatContext, opts: { save: Save; check?: () => Promise<void>; jobId?: string }): Promise<ChatResult> {
  const { request, conversation } = context;
  const message = request.submittedQuestion ?? request.question;
  const prior = conversation.state as LoopConversationState;
  const people: LoopPerson[] = context.family.map((p) => ({ id: p.id, name: label(p), relationship: p.relationship }));
  const selves = context.family.filter((p) => /^self$/i.test(p.relationship ?? ""));
  const speakerId = selves.length === 1 ? selves[0].id : request.familyMemberId ?? null;
  const out = await runLoop({ accountId: request.accountId, message, state: prior.ragLoop ?? emptyLoopState(), people, speakerId, model: loopModel() });
  const { state, reply, trace } = out;
  const answer = blank();
  const notes: string[] = [];
  for (const c of out.corrections) {
    notes.push(`Updated: ${words(c.key)} is now ${show(c.to)} (you first said ${show(c.from)}).`);
    if (c.withdrawn.length) notes.push("The earlier estimate worked out from it no longer applies.");
  }
  if (reply.kind === "ask") {
    const p = reply.pending;
    const q: ChatQuestion = p.kind === "person"
      ? { id: "rag_person", text: p.question, type: "choice", options: p.options.map((o) => o.label), why: "The answer depends on who this is about." }
      : { id: "rag_fact_" + p.factKey, text: p.question, type: p.options?.length ? "choice" : "text", ...(p.options?.length ? { options: p.options } : {}), why: "This changes what your policy pays under: " + p.why };
    answer.mode = p.kind === "fact" ? "fact_finding" : "answer";
    answer.summary = [...notes, reply.preface, p.question].filter(Boolean).join(" ");
    answer.questions = [q];
    if (p.kind === "person") answer.personCandidates = p.options.map((o) => ({ id: o.id, label: o.label }));
    answer.citations = await citationsFor(request.accountId, state, trace.evidenceChosen);
  } else if (reply.kind === "final") {
    const c = reply.composed;
    const texts = c.sentences.map((s) => s.text);
    // A correction is said first (what changed, and what no longer applies), then the answer.
    const lead = notes.length ? [notes.join(" "), ...texts] : texts;
    answer.summary = lead[0] ?? (c.dropped.length ? DROPPED_NOTE : FALLBACK_TEXT);
    answer.details = lead.slice(1);
    if (c.sentences.some((s) => s.estimate)) answer.disclaimer = ESTIMATE_NOTICE;
    if (c.dropped.length && texts.length) answer.details.push(DROPPED_NOTE);
    answer.nextSteps = c.nextSteps;
    answer.figureBindings = c.figureBindings;
    answer.computations = c.computations;
    answer.citations = await citationsFor(request.accountId, state, c.evidenceIds);
    if (out.reasked?.kind === "fact") {
      answer.details.push(RESUME_NOTE);
      answer.questions = [{ id: "rag_fact_" + out.reasked.factKey, text: out.reasked.question, type: out.reasked.options?.length ? "choice" : "text", ...(out.reasked.options?.length ? { options: out.reasked.options } : {}), why: "This changes what your policy pays under: " + out.reasked.why }];
    }
  } else {
    answer.summary = [...notes, reply.text].join(" ");
  }
  if (state.subjectId) answer.resolvedFamilyMemberId = state.subjectId;
  answer.conversationId = conversation.id;
  answer.conversationRevision = conversation.revision + 1;
  enforceLiveChatMonetaryBoundary(answer, { claimContext: false });
  // The save-time gate, applied here first so the turn's record shows its outcome; saveTurn runs it again.
  const problems = await verifyAnswerFigures(answer, { accountId: request.accountId, userText: message });
  trace.gate = problems.map((p) => ({ where: p.where, figure: p.figure, reason: p.reason }));
  const visible = [answer.summary, ...answer.details, ...answer.questions.map((q) => q.text)].join(" ");
  state.history = [...state.history, { user: message, assistant: visible }].slice(-8);
  state.turns = [...state.turns, trace].slice(-12) as TraceTurn[];
  const next: LoopConversationState = { ...prior, intent: "policy_question", ragLoop: state };
  delete next.pending;
  await opts.check?.();
  await opts.save({ conversation, token: context.token, state: next, message, answer, jobId: opts.jobId });
  return { answer, retrieved: [] };
}
