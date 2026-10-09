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
import { DECISION_NOTE, DROPPED_NOTE, PAYOUT_NOTE, SUM_NOTE } from "./compose";
import { syncCalcClaimRecord, syncLoopClaimState } from "../calc/claim-record";
import { ANYONE, FALLBACK_TEXT, runLoop, type LoopPerson } from "./loop";
import { loopModel } from "./model";
import { emptyLoopState, type RagLoopState, type TraceTurn } from "./types";

export type LoopConversationState = ConversationState & { ragLoop?: RagLoopState };
type Save = (args: { conversation: ChatContext["conversation"]; token: ChatContext["token"]; state: ConversationState; message: string; answer: ChatAnswer; jobId?: string }) => Promise<void>;

export const ESTIMATE_NOTICE = "Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.";
export const RESUME_NOTE = "When you’re ready, here is the question I was on.";
/** The composer's caveats an asking turn says before its question (never "nothing could be confirmed"). */
const ASK_NOTES = new Set([PAYOUT_NOTE, DECISION_NOTE, SUM_NOTE]);

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

/** Agent P (task 4): the person asked about is not one of the household's members (wording never says whether they
 * exist anywhere else). */
export function unknownPersonText(mentions: string[]): string {
  const who = mentions.map((m) => `“${m.replace(/[“”"]/g, "")}”`).join(" or ");
  return `I couldn’t identify ${who} among the family members linked to your account. Which family member do you mean? If they aren’t added yet, you can add them on the Household page.`;
}
const label = (p: ClaimPerson) => (p.preferred_name && p.preferred_name !== p.display_name ? `${p.display_name} (${p.preferred_name})` : p.display_name);
const words = (key: string) => key.replace(/_/g, " ");
const show = (v: unknown) => String(v).replace(/_/g, " ");

/** The supporting span with what it needs (header first, then the span, then any footnote); the passage when no
 * single sentence / row has been identified. */
export function preciseExcerpt(r: RagLoopState["evidence"][string]): string {
  if (!r.support) return r.passage.text;
  const ctx = r.context ?? [];
  return [...ctx.filter((c) => c.role !== "footnote").map((c) => c.text), r.support.text, ...ctx.filter((c) => c.role === "footnote").map((c) => c.text)].join("\n");
}

async function citationsFor(accountId: string, state: RagLoopState, ids: string[]): Promise<ChatCitation[]> {
  const refs = ids.map((id) => state.evidence[id]).filter(Boolean);
  if (!refs.length) return [];
  const rows = (await query<{ id: string; product_name: string | null; insurer: string | null; document_role: string | null }>(`SELECT id::text AS id, product_name, insurer, document_role FROM policies WHERE account_id=$1 AND id::text=ANY($2::text[]) AND ${activePredicate()}`, [accountId, [...new Set(refs.map((r) => r.policyId))]]).catch(() => ({ rows: [] as { id: string; product_name: string | null; insurer: string | null; document_role: string | null }[] }))).rows;
  const out: ChatCitation[] = [];
  for (const r of refs) {
    if (out.some((c) => c.policyId === r.policyId && c.pageStart === r.page.start && c.pageEnd === r.page.end && c.excerpt === preciseExcerpt(r))) continue;
    const p = rows.find((x) => x.id === r.policyId);
    // The page is the household-facing link; the excerpt is the exact supporting sentence / row, with the table header,
    // continued header or footnote it needs to be read correctly (lib/rag2/evidence.ts refineEvidence).
    out.push({ chunkId: "rag2:" + r.id, policyId: r.policyId, policyName: p?.product_name ?? "Policy document", insurer: p?.insurer ?? undefined, pageStart: r.page.start, pageEnd: r.page.end, documentRole: p?.document_role ?? null, excerpt: preciseExcerpt(r) });
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
  // The speaker ("me", "my") is the member typing: the only member recorded as self, or -- in a shared household
  // login -- whoever the household says they are (kept in the loop state). A member-scoped chat names who the chat is
  // ABOUT (the initial active subject), never who is typing.
  const selves = context.family.filter((p) => /^self$/i.test(p.relationship ?? ""));
  const speakerId = selves.length === 1 ? selves[0].id : null;
  const out = await runLoop({ accountId: request.accountId, message, state: prior.ragLoop ?? emptyLoopState(), people, speakerId, initialSubjectId: request.familyMemberId ?? null, model: loopModel(), personChoiceId: request.personChoiceId ?? null });
  const { state, reply, trace } = out;
  // Integration (round 3): a correction or a deleted / superseded source updates this conversation's EXISTING claim
  // record (agent G); syncLoopClaimState only reads and updates claim_sessions rows -- it never creates a claim, so an
  // ordinary question is unaffected -- and runs only on a turn that changed something.
  if (state.claim?.subjectId && (out.corrections.length || out.invalidated?.length)) await syncLoopClaimState({ accountId: request.accountId, state, conversationId: conversation.id }).catch(() => null);
  const answer = blank();
  const notes: string[] = [];
  const named = context.family.map((p) => ({ label: label(p), short: p.preferred_name && p.preferred_name !== p.display_name ? p.preferred_name : p.display_name }));
  const short = (l: string) => named.find((n) => n.label === l)?.short ?? l;
  // Agent P (task 4): who resolve_person could not find among this household's members this turn (and whether
  // anyone was resolved). Self-references ("me") are the speaker question, not an unknown person.
  const resolves = trace.toolCalls.filter((t) => t.name === "resolve_person" && t.ok);
  const unknownPeople = [...new Set(resolves.filter((t) => /"status":"unknown"/.test(t.summary ?? "")).map((t) => String(t.args.mention ?? "").trim()).filter((m) => m && !/^(?:i|me|my|myself|mine|self)$/i.test(m) && !ANYONE.test(m)))];
  const resolvedSomeone = resolves.some((t) => /"status":"(?:ok|ambiguous)"/.test(t.summary ?? "")) || reply.kind === "ask";
  for (const c of out.corrections) {
    if (c.key === "person") {
      // Agent F (S6a): who the claim is about was corrected -- say so, and say which estimate no longer applies and
      // why (described by what it was worked out from, never by repeating its figure).
      // Agent P (task 2): the names the household uses ("Ethan", never "Ethan Tan Jun Kai (Ethan)'s").
      const from = short(show(c.from)), to = short(show(c.to));
      notes.push(`Updated: this is about ${to}, not ${from}.`);
      if (c.withdrawn.length) notes.push(`The earlier ${c.withdrawn.length > 1 ? "estimates" : "estimate"} I worked out for ${from}${c.about?.length ? ` from the ${c.about.map(words).join(" and ")}` : ""} no longer ${c.withdrawn.length > 1 ? "apply" : "applies"}, because ${c.withdrawn.length > 1 ? "they were" : "it was"} worked out for ${from}'s policy, not ${to}'s.`);
      continue;
    }
    notes.push(`Updated: ${words(c.key)} is now ${show(c.to)} (you said ${show(c.from)} at first).`);
    if (c.withdrawn.length) notes.push("The earlier estimate worked out from it no longer applies.");
  }
  // Integration (round 3): what a deleted / replaced document alone supported no longer applies -- said once, plainly.
  const lost = out.invalidated ?? [];
  if (lost.some((x) => x.kind !== "fact")) notes.push("An earlier estimate no longer applies because the document it relied on was deleted or replaced.");
  else if (lost.length) notes.push("Something I noted earlier from a document no longer applies because that document was deleted or replaced.");
  if (reply.kind === "ask") {
    const p = reply.pending;
    const q: ChatQuestion = p.kind === "person"
      ? { id: "rag_person", text: p.question, type: "choice", options: p.options.map((o) => o.label), why: "The answer depends on who this is about." }
      : { id: "rag_fact_" + p.factKey, text: p.question, type: p.options?.length ? "choice" : "text", ...(p.options?.length ? { options: p.options } : {}), why: "This changes what your policy pays under: " + p.why };
    answer.mode = p.kind === "fact" ? "fact_finding" : "answer";
    // Round 6 (A3): the question is presented once -- by its card (answer.questions). The message body carries only
    // what is said before it: corrections, then the composed preface / statements (e.g. the identified benefit,
    // conditionally, cited), bound and gated like any answer.
    const c = reply.composed ?? null;
    const said = c ? [...c.sentences.map((s) => s.text), ...(c.notes ?? []).filter((n) => ASK_NOTES.has(n))] : [];
    // A turn that says nothing before its question leads with one short line (what the output guard would supply) --
    // never the question itself, which its card shows.
    const lead = p.kind === "person" ? (p.purpose === "speaker" ? "I need to know who is asking first." : "I need to know who this is about first.") : "I need one more detail first.";
    answer.summary = [...notes, ...(reply.preface ? [reply.preface] : []), ...said].join(" ") || lead;
    answer.questions = [q];
    if (p.kind === "person") answer.personCandidates = p.options.map((o) => ({ id: o.id, label: o.label }));
    if (c) {
      answer.figureBindings = c.figureBindings;
      answer.computations = c.computations;
      if (c.calculations.length) answer.calculations = c.calculations;
      if (c.sentences.some((s) => s.estimate)) answer.disclaimer = ESTIMATE_NOTICE;
    }
    answer.citations = await citationsFor(request.accountId, state, [...new Set([...(c?.evidenceIds ?? []), ...trace.evidenceChosen])]);
  } else if (unknownPeople.length && !resolvedSomeone) {
    // Agent P (task 4): the person asked about is not among this household's members. Said plainly, with nothing
    // about anyone outside the household (never whether such a person exists elsewhere), and nothing composed from
    // tools run for someone else is shown.
    answer.summary = [...notes, unknownPersonText(unknownPeople)].join(" ");
  } else if (reply.kind === "final") {
    const c = reply.composed;
    const texts = c.sentences.map((s) => s.text);
    // A correction is said first (what changed, and what no longer applies), then the answer.
    const lead = notes.length ? [notes.join(" "), ...texts] : texts;
    // Agent P (task 3): the composer's notes are user-facing caveats (or, when nothing could be kept, one accurate
    // explanation) -- never commentary on what was removed.
    const body = [...lead, ...(c.notes ?? []), ...(unknownPeople.length ? [unknownPersonText(unknownPeople)] : [])];
    answer.summary = body[0] ?? (c.dropped.length ? DROPPED_NOTE : FALLBACK_TEXT);
    answer.details = body.slice(1);
    if (c.sentences.some((s) => s.estimate)) answer.disclaimer = ESTIMATE_NOTICE;
    answer.nextSteps = c.nextSteps;
    answer.figureBindings = c.figureBindings;
    answer.computations = c.computations;
    // Agent K: verified benefit calculations, and the claim record only when the household is pursuing a claim.
    if (c.calculations.length) answer.calculations = c.calculations;
    if (c.calcs.length) { const rec = await syncCalcClaimRecord({ accountId: request.accountId, conversationId: conversation.id, state, calcs: c.calcs, existingId: (prior as { claimSessionId?: string | null }).claimSessionId ?? null }); if (rec) answer.claimSessionId = rec.id; }
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
