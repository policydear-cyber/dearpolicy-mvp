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
import { FIGURE_LEFT_OUT_NOTE, sentencesOf, verifyAnswerFigures, type FigureProblem } from "@/lib/chat/answer-verification";
import type { ChatContext, ChatRequest } from "@/lib/chat/workflow";
import type { ChatResult, ConversationState } from "@/lib/chat/types";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer, ChatCitation, ChatQuestion } from "@/types";
import { DECISION_NOTE, DROPPED_NOTE, keepLimitationWithFigure, LATER_DATE_NOTE, PAYOUT_NOTE, SUM_NOTE, type Composed } from "./compose";
import { syncCalcClaimRecord, syncLoopClaimState } from "../calc/claim-record";
import { ANYONE, FALLBACK_TEXT, runLoop, type LoopPerson } from "./loop";
import { loopModel } from "./model";
import { turnStoreStats, withTurnStore } from "../store";
import { emptyLoopState, type RagLoopState, type TraceTurn } from "./types";

export type LoopConversationState = ConversationState & { ragLoop?: RagLoopState };
type Save = (args: { conversation: ChatContext["conversation"]; token: ChatContext["token"]; state: ConversationState; message: string; answer: ChatAnswer; jobId?: string }) => Promise<void>;

export const ESTIMATE_NOTICE = "Indicative estimates are worked out from your documents and what you have told me; they are not a payout, and the insurer decides what it pays.";
export const RESUME_NOTE = "When you’re ready, here is the question I was on.";
/** The composer's caveats an asking turn says before its question (never "nothing could be confirmed"). */
// (PR #54: a dated listing said before a question keeps its later-date limit, as it does in a final answer)
const ASK_NOTES = new Set([PAYOUT_NOTE, DECISION_NOTE, SUM_NOTE, LATER_DATE_NOTE]);

// ------------------------------------------------------------------ Round 7 (A3): when the gate rejects a figure
const squashT = (t: string) => (t ?? "").replace(/\s+/g, " ").trim();
/** The benefit a binding is for, as a household would read it: its label, or (when the label is only an item number
 * such as "A") the row's longest worded cell. */
export function benefitLabelOf(b: { benefit: string; passage: string }): string {
  if ((b.benefit.match(/[A-Za-z]{3,}/g) ?? []).length >= 2) return b.benefit.trim();
  const cells = (b.passage.split("\n").find((l) => /\d/.test(l)) ?? b.passage).split(/\t+| {2,}/).map((c) => c.trim());
  const worded = cells.filter((c) => (c.match(/[A-Za-z]{3,}/g) ?? []).length >= 2 && !/[$€£¥]\s?\d|\b(?:SGD|USD)\b/.test(c)).sort((x, y) => y.length - x.length);
  return worded[0] ?? b.benefit.trim();
}
/** Gate reasons that make the sentence itself wrong (about the wrong person, a version not on file). */
const WRONG_SUBJECT = /\babout someone\b|\bnot for\b|\bversion\b|\bsuperseded\b|\bdeleted\b|\bwrong (?:person|member|column)\b/i;
const sameSentence = (a: string, b: string) => { const x = squashT(a), y = squashT(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
/**
 * Round 8 (A3): the save-time gate's rejections are final at this point (the loop has already given the model its one
 * repair). A rejected sentence is left out WHOLE -- never rewritten without its figure ("a set amount" claims what the
 * evidence does not say) -- and the household is told precisely what was left out: the benefit and the document (and
 * page) whose figure could not be confirmed. Independent sentences stay as they are.
 */
/** Round 9: the gate's reason, said to the household in plain words (the reason itself stays in the turn's trace). */
function plainReason(reason: string, who: string | null): string {
  const r = reason.toLowerCase();
  if (/as of \d{4}-\d{2}-\d{2}/.test(r)) return "that document gives it as of an earlier date, and I couldn’t state it that way";
  if (/another (?:insured )?person|someone the cited figure|not for the person|row'?s name|not bound to a (?:household member|person)|column|tier|class/.test(r)) return `I couldn’t match it to ${who ? who + "’s" : "the person’s"} own entry in that document`;
  if (/currency/.test(r)) return "the currency didn’t match what the document prints";
  if (/version|superseded|amend|endorsement|in force|effective/.test(r)) return "I couldn’t tell which version of the document applies on the date you’re asking about";
  if (/not printed|not on the cited|is not one of|not stored|absent|passage/.test(r)) return "I couldn’t find that amount printed in the document";
  return "I couldn’t confirm it against the document";
}
/** A benefit label as the household reads it (a certificate's "GROUP PERSONAL ACCIDENT(POLICY NO. 1)" -> "Group
 * Personal Accident"); no internal row text. */
function plainBenefit(label: string): string {
  const s = label.split(" — ")[0].replace(/\(\s*(?:group\s+)?policy\s*no\.?[^)]*\)/gi, " ").replace(/\s+/g, " ").trim();
  return s === s.toUpperCase() && /[A-Z]{3}/.test(s) ? s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()) : s;
}
function rescueRejected(answer: ChatAnswer, problems: FigureProblem[], state: RagLoopState, composed: Composed | null, whoOf: (id: string | null | undefined) => string | null = () => null): void {
  // (V1.5: a figure is matched outside the library names an inventory line quotes -- a file named "Claim S$5,000.pdf"
  // is not the rejected figure S$5,000.)
  const names = [...(answer.libraryNames ?? [])].sort((a, b) => b.length - a.length);
  const unnamed = (s: string) => names.reduce((t, n) => t.split(n).join(" "), s);
  const rejected = (s: string) => problems.some((p) => { const a = squashT(s), b = squashT(p.sentence); return (b && (a.includes(b) || b.includes(a))) || (!!p.figure && unnamed(s).includes(p.figure)); });
  const lostSentences: string[] = [];
  const keep = (field: string): string => sentencesOf(field).filter((s) => { if (!rejected(s)) return true; lostSentences.push(s); return false; }).join(" ");
  answer.summary = keep(answer.summary);
  answer.details = answer.details.map(keep).filter((d) => d.trim());
  const gone = (sentence: string) => lostSentences.some((l) => sameSentence(l, sentence));
  const lostBindings = (composed?.figureBindings ?? answer.figureBindings ?? []).filter((b) => gone(b.sentence));
  answer.figureBindings = (answer.figureBindings ?? []).filter((b) => !gone(b.sentence));
  answer.computations = (answer.computations ?? []).filter((r) => !gone(r.sentence));
  if (answer.calculations) answer.calculations = answer.calculations.filter((r) => !gone(r.sentence));
  // Round 9: what was left out is said plainly and specifically -- the benefit, the document and why, in the household's
  // terms -- never the gate's own wording, row text or internal labels (those stay in the turn's trace).
  const lines: string[] = [];
  for (const b of lostBindings) {
    const doc = answer.citations.find((c) => c.policyId === b.policyId)?.policyName ?? state.docNames?.[b.policyId] ?? "your policy document";
    const p = problems.find((x) => sameSentence(x.sentence, b.sentence) || (!!x.figure && b.sentence.includes(x.figure.replace(/[.,]$/, ""))));
    const line = `I haven’t stated the amount for ${plainBenefit(benefitLabelOf(b))} in ${doc} (page ${b.pageStart}), because ${plainReason(p?.reason ?? "", whoOf(b.subjectId))}.`;
    if (!lines.includes(line)) lines.push(line);
  }
  // Round 8 (F1): a what-if left out is said as such (it was not a figure "against the cited page").
  const lostWhatIfs = (composed?.calculations ?? []).filter((r) => r.kind === "conditional_illustration" && gone(r.sentence));
  const whatIfLines = [...new Set(lostWhatIfs.map((r) => {
    const doc = answer.citations.find((c) => c.policyId === r.policyId)?.policyName ?? state.docNames?.[r.policyId] ?? "your policy document";
    return r.calculator === "hospital_cash"
      ? `I haven’t given a what-if amount for “${r.benefit}” in ${doc}, because I couldn’t check its assumed stay against what you told me.`
      : `I haven’t given a what-if amount for “${r.benefit}” in ${doc}, because I couldn’t confirm the figures it uses against your documents.`;
  }))];
  const said = [answer.summary, ...answer.details].filter((x) => x.trim() && x !== RESUME_NOTE);
  const requirements = (composed?.sentences ?? []).filter((x) => x.kind === "requirement" && !said.includes(x.text)).map((x) => x.text);
  const figuresLost = lines.length || problems.some((p) => !lostWhatIfs.some((r) => sameSentence(r.sentence, p.sentence) || (!!p.figure && r.sentence.includes(p.figure))));
  const limitation = [...(lines.length ? lines : figuresLost ? [FIGURE_LEFT_OUT_NOTE] : []), ...whatIfLines, ...(said.length ? [] : requirements)];
  if (!answer.summary.trim()) { const body = [...answer.details, ...limitation]; answer.summary = body[0]; answer.details = body.slice(1); }
  else answer.details = [...answer.details, ...limitation.filter((l) => !answer.details.includes(l))];
}

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
export function runLoopChat(context: ChatContext, opts: { save: Save; check?: () => Promise<void>; jobId?: string }): Promise<ChatResult> {
  // Death-journey release: one turn store for the whole turn -- the loop, the answer's citations, the figure gate and the save.
  return withTurnStore(context.request.accountId, () => runLoopChatTurn(context, opts));
}
async function runLoopChatTurn(context: ChatContext, opts: { save: Save; check?: () => Promise<void>; jobId?: string }): Promise<ChatResult> {
  const { request, conversation } = context;
  const message = request.submittedQuestion ?? request.question;
  const prior = conversation.state as LoopConversationState;
  const people: LoopPerson[] = context.family.map((p) => ({ id: p.id, name: label(p), relationship: p.relationship }));
  // The speaker ("me", "my") is the member typing: the only member recorded as self, or -- in a shared household
  // login -- whoever the household says they are (kept in the loop state). A member-scoped chat names who the chat is
  // ABOUT (the initial active subject), never who is typing.
  const selves = context.family.filter((p) => /^self$/i.test(p.relationship ?? ""));
  const speakerId = selves.length === 1 ? selves[0].id : null;
  const tPhase0 = Date.now();
  const out = await runLoop({ accountId: request.accountId, message, state: prior.ragLoop ?? emptyLoopState(), people, speakerId, initialSubjectId: request.familyMemberId ?? null, model: loopModel(), now: new Date().toISOString(), personChoiceId: request.personChoiceId ?? null });
  const { state, reply, trace } = out;
  const phases: Record<string, number> = { loopMs: Date.now() - tPhase0 };
  let tPhase = Date.now();
  const lap = (name: string) => { const n = Date.now(); phases[name] = (phases[name] ?? 0) + (n - tPhase); tPhase = n; };
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
    // V1.2: a fact question asked with nothing before it says briefly why the detail changes the answer -- the clause it
    // turns on, in the wording's own words (figure-free; a clause printing an amount is described, not quoted).
    const why = p.kind === "fact" ? String(p.why ?? "").split(/;\s*/)[0].replace(/\s*\(page \d+\)\s*$/, "").replace(/\s+/g, " ").trim() : "";
    // (a clause is quoted whole or not at all: a cut sentence can lose its condition, exception or "not")
    const whyText = why && why.length <= 240 && !/[$€£¥]\s?\d|\b(?:SGD|USD)\s?\d|\d/.test(why) ? `the policy wording turns on it: “${why}”` : "it changes which of the policy's benefits or amounts applies";
    const lead = p.kind === "person" ? (p.purpose === "speaker" ? "I need to know who is asking first." : "I need to know who this is about first.") : `I'm asking because ${whyText}.`;
    answer.summary = [...notes, ...(reply.preface ? [reply.preface] : []), ...said, ...(reply.trailing ?? [])].join(" ") || lead;
    answer.questions = [q];
    if (p.kind === "person") answer.personCandidates = p.options.map((o) => ({ id: o.id, label: o.label }));
    if (c) {
      answer.figureBindings = c.figureBindings;
      answer.computations = c.computations;
      if (c.calculations.length) answer.calculations = c.calculations;
      if (c.sentences.some((s) => s.estimate)) answer.disclaimer = ESTIMATE_NOTICE;
      // dj-live-3: the supported practical steps are part of the reply a clarifying question rides on (the page shows them ahead of the question).
      answer.nextSteps = c.nextSteps;
      if (c.absenceChecks?.length) { answer.absenceChecks = c.absenceChecks; answer.libraryNames = [...new Set([...(answer.libraryNames ?? []), ...c.absenceChecks.flatMap((x) => x.documents.map((d) => d.name))])]; }
    }
    answer.citations = await citationsFor(request.accountId, state, [...new Set([...(c?.evidenceIds ?? []), ...trace.evidenceChosen])]);
  } else if (unknownPeople.length && !resolvedSomeone) {
    // Agent P (task 4): the person asked about is not among this household's members. Said plainly, with nothing
    // about anyone outside the household (never whether such a person exists elsewhere), and nothing composed from
    // tools run for someone else is shown.
    answer.summary = [...notes, unknownPersonText(unknownPeople)].join(" ");
  } else if (reply.kind === "final") {
    const c = reply.composed;
    // Actual-library findings: the useful result leads -- a verified calculation first, then the printed terms and
    // conditions, then the rest (each statement is a whole unit, so their order changes no meaning).
    const rank = (s: { kind?: string }) => (s.kind === "conditional_illustration" || s.kind === "indicative_estimate" ? 0 : s.kind === "requirement" ? 2 : 1);
    const sorted = c.sentences.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
    // Production fracture conversation (19 Oct 2026): when the documents print TWO different terms for the same event (conditional
    // illustrations from different documents) and one sentence says they are alternatives, the answer's first lines carry all of them, the
    // framing first -- never one alternative alone, which reads as THE answer. The framing sentence is the one whose citations are
    // on the same pages as at least two of the illustrations (so no wording is matched).
    const pageKeys = (ids: string[]) => new Set(ids.map((id) => state.evidence[id]).filter(Boolean).map((e) => `${e.policyId}:${e.page.start}`));
    const illus = sorted.filter((x) => x.kind === "conditional_illustration" || x.kind === "indicative_estimate");
    const frame = illus.length >= 2 && new Set(illus.flatMap((x) => [...pageKeys(x.evidenceIds)].map((k) => k.split(":")[0]))).size >= 2
      ? sorted.find((x) => !illus.includes(x) && illus.filter((i) => { const mine = pageKeys(x.evidenceIds), theirs = pageKeys(i.evidenceIds); return [...mine].some((k) => theirs.has(k)); }).length >= 2) ?? null
      : null;
    const texts = frame ? [frame, ...illus, ...sorted.filter((x) => x !== frame && !illus.includes(x))].map((x) => x.text) : sorted.map((x) => x.text);
    // A correction is said first (what changed, and what no longer applies), then the answer.
    const lead = notes.length ? [notes.join(" "), ...texts] : texts;
    // Agent P (task 3): the composer's notes are user-facing caveats (or, when nothing could be kept, one accurate
    // explanation) -- never commentary on what was removed.
    const body = keepLimitationWithFigure([...lead, ...(c.notes ?? []), ...(unknownPeople.length ? [unknownPersonText(unknownPeople)] : [])]);
    answer.summary = body[0] ?? (c.dropped.length ? DROPPED_NOTE : FALLBACK_TEXT);
    answer.details = body.slice(1);
    if (c.sentences.some((s) => s.estimate)) answer.disclaimer = ESTIMATE_NOTICE;
    answer.nextSteps = c.nextSteps;
    answer.figureBindings = c.figureBindings;
    answer.computations = c.computations;
    if (c.libraryNames?.length) answer.libraryNames = c.libraryNames;
    if (c.absenceChecks?.length) { answer.absenceChecks = c.absenceChecks; answer.libraryNames = [...new Set([...(answer.libraryNames ?? []), ...c.absenceChecks.flatMap((x) => x.documents.map((d) => d.name))])]; }
    // Agent K: verified benefit calculations, and the claim record only when the household is pursuing a claim.
    if (c.calculations.length) answer.calculations = c.calculations;
    if (c.calcs.length) { const rec = await syncCalcClaimRecord({ accountId: request.accountId, conversationId: conversation.id, state, calcs: c.calcs, existingId: (prior as { claimSessionId?: string | null }).claimSessionId ?? null }); if (rec) answer.claimSessionId = rec.id; }
    answer.citations = await citationsFor(request.accountId, state, c.evidenceIds);
    if (out.reasked?.kind === "fact") {
      if (!out.followUp) answer.details.push(RESUME_NOTE);
      answer.questions = [{ id: "rag_fact_" + out.reasked.factKey, text: out.reasked.question, type: out.reasked.options?.length ? "choice" : "text", ...(out.reasked.options?.length ? { options: out.reasked.options } : {}), why: "This changes what your policy pays under: " + out.reasked.why }];
    }
  } else {
    answer.summary = [...notes, reply.text].join(" ");
  }
  if (state.subjectId) answer.resolvedFamilyMemberId = state.subjectId;
  answer.conversationId = conversation.id;
  answer.conversationRevision = conversation.revision + 1;
  enforceLiveChatMonetaryBoundary(answer, { claimContext: false });
  // (the context this answer is written under: a reopened answer is read under it again when it still validates)
  answer.renderContext = { origin: "rag_loop", claimContext: false };
  // The save-time gate, applied here first (in report mode) so the turn's record shows its outcome; its rejections
  // are authoritative. Round 7 (A3): a rejected figure sentence is replaced by its figure-free part (when that part
  // still says something its evidence supports) or left out -- and a reply left with nothing says specifically what
  // could not be confirmed, never only the generic note. saveTurn runs the gate again on what remains.
  const shownComposed = reply.kind === "final" || reply.kind === "ask" ? reply.composed ?? null : null;
  if (shownComposed) trace.composed = shownComposed.sentences.map((s) => s.text);
  const priorUserTexts = state.history.map((h) => h.user);
  lap("composeMs");
  const problems = await verifyAnswerFigures(structuredClone(answer), { accountId: request.accountId, userText: message, report: true, priorUserTexts });
  lap("gateReportMs");
  trace.gate = problems.map((p) => ({ where: p.where, figure: p.figure, reason: p.reason }));
  const whoOf = (id: string | null | undefined) => { const p = context.family.find((f) => f.id === id); return p ? (p.preferred_name || p.display_name) : null; };
  if (problems.length) rescueRejected(answer, problems, state, reply.kind === "final" || reply.kind === "ask" ? reply.composed ?? null : null, whoOf);
  lap("rescueMs");
  await verifyAnswerFigures(answer, { accountId: request.accountId, userText: message, priorUserTexts });
  lap("gateMs");
  // Critic R17: what this turn showed (every branch, after the gate), so "what do I do now" repeats only the steps just shown.
  const shownSubject = reply.kind === "final" || reply.kind === "ask" ? reply.composed?.subjectId ?? state.subjectId ?? null : state.subjectId ?? null;
  trace.shown = { subjectId: shownSubject, nextSteps: out.corrections.length || lost.length ? [] : [...answer.nextSteps] };
  const visible = [answer.summary, ...answer.details, ...answer.questions.map((q) => q.text)].join(" ");
  state.history = [...state.history, { user: message, assistant: visible }].slice(-8);
  state.turns = [...state.turns, trace].slice(-12) as TraceTurn[];
  const next: LoopConversationState = { ...prior, intent: "policy_question", ragLoop: state };
  delete next.pending;
  await opts.check?.();
  lap("checkMs");
  // MEASUREMENT BOUNDARY: the trace is persisted BY the save below, so `trace.phases` holds only what was measured before it
  // (loop, gate/rescue/verification, check). The duration of the save itself cannot be inside the record it writes and is not
  // recorded here -- it is observed from outside (request wall time minus loopMs, or the browser's send -> visible time).
  trace.phases = { ...phases, ...(turnStoreStats() ? { storeSql: turnStoreStats()!.docsSql + turnStoreStats()!.linksSql + turnStoreStats()!.pagesSql + turnStoreStats()!.membersSql } : {}) };
  await opts.save({ conversation, token: context.token, state: next, message, answer, jobId: opts.jobId });
  return { answer, retrieved: [] };
}
