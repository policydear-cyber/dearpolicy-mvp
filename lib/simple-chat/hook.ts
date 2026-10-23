/**
 * Where the chat hands a turn to the simple chat when DEARPOLICY_SIMPLE_CHAT is on (lib/chat/workflow.ts loads this
 * module only then). One turn: read the signed-in household's library, ask the model once, check the answer against
 * the stored pages (lib/simple-chat/verify.ts), and save it.
 *
 * It saves through lib/chat/store.ts saveTurn directly: the output guard and the conversation's revision check still
 * run there, and the live monetary boundary is applied here and again on reopen. The workflow's own save-time figure
 * gate is not used: it checks figures against figure bindings this path does not produce (it would leave out every
 * amount); verify.ts checks each amount against the stored page it is quoted from instead.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { assertUnderSpendCap, recordUsage } from "@/lib/ai/ledger";
import { enforceLiveChatMonetaryBoundary } from "@/lib/chat/monetary-boundary";
import { getConversation, historyToken, openConversation, saveTurn, ChatConflict } from "@/lib/chat/store";
import type { ChatContext, ChatRequest } from "@/lib/chat/workflow";
import type { ChatResult, ConversationState } from "@/lib/chat/types";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer } from "@/types";
import { simpleChatModel } from "./flag";
import { loadHousehold, renderLibrary, spouseMeant, type Household } from "./library";
import { ledgerUsage, modelFromChoice, type SimpleModel, type Turn } from "./model";
import { answerAsText, NO_ANSWER, NOTHING_SHOWN, readModelAnswer, verifyAnswer, type VerifyReport } from "./verify";
import type { BenefitTable } from "@/lib/benefit-table/assemble";
import { amountsFromRows, printedDay, chatRows, dropAgreeingDayRules, dropAmountPointers, dropPeopleShutOut, keepLabelledAmounts, noteLeftOutAmounts, noteNarrowedPages, pagesToSend, renderTable, type RowReport } from "@/lib/benefit-table/chat";

export type SimpleChatState = ConversationState & { simpleChat?: { turns: { model: string; usage: ReturnType<typeof ledgerUsage>; ms: number; timing?: { loadMs: number; modelMs: number; checkMs: number }; report: VerifyReport }[] } };
type Save = typeof saveTurn;
export type SimpleDeps = { model?: SimpleModel; household?: (accountId: string) => Promise<Household>; history?: (accountId: string, conversationId: string) => Promise<Turn[]>; save?: Save; ledger?: boolean; today?: () => Date;
  /** The household's benefit table, when it is switched on (lib/benefit-table): its rows are the chat's only amounts. */
  table?: (accountId: string) => Promise<BenefitTable | null> };

/** The signed-in household's benefit table when DEARPOLICY_BENEFIT_TABLE is live, otherwise null. */
async function liveTable(accountId: string): Promise<BenefitTable | null> {
  const { appDb, benefitTableLive } = await import("@/lib/benefit-table/app");
  if (!(await benefitTableLive(accountId))) return null;
  const { tableFor } = await import("@/lib/benefit-table/service");
  return (await tableFor(appDb, accountId)).table;
}

/** Opens or continues the conversation; who the question is about is left to the model and the checks. */
export async function prepareSimpleChat(request: ChatRequest): Promise<ChatContext> {
  const family = (await query<ClaimPerson>(`SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`, [request.accountId])).rows;
  if (!family.length) throw new ChatConflict("Add a family member first. On the Household page, add yourself (and anyone else your policies cover), then ask again.");
  if (request.familyMemberId && !family.some((p) => p.id === request.familyMemberId)) throw new Error("Family profile not found.");
  const previousId = request.conversationId ?? request.claimSessionId;
  const previous = previousId ? await getConversation(request.accountId, previousId) : null;
  if (previousId && !previous) throw new ChatConflict("This chat was deleted or is unavailable. Start a new chat.");
  if (previous && request.conversationRevision != null && previous.revision !== request.conversationRevision) throw new ChatConflict("This chat changed. Reopen it before sending another message.");
  const conversation = previous ?? (await openConversation({ accountId: request.accountId, memberId: request.familyMemberId ?? null, title: request.question }));
  const token = await historyToken(request.accountId, conversation.family_member_id);
  return { request: { ...request, submittedQuestion: request.submittedQuestion ?? request.question }, family, people: family, conversation, token, holdings: [], chatPath: "simple" };
}

/** The conversation so far, as the household saw it (this household's rows only). */
export async function conversationTurns(accountId: string, conversationId: string): Promise<Turn[]> {
  const rows = (await query<{ role: string; content: string; answer_json: unknown }>(
    `SELECT role,content,answer_json FROM (SELECT role,content,answer_json,created_at,message_order FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 ORDER BY created_at DESC,message_order DESC LIMIT 12) m ORDER BY created_at,message_order`,
    [accountId, conversationId])).rows;
  return rows.map((r) => {
    const a = r.answer_json as (ChatAnswer & Parameters<typeof answerAsText>[0]) | null;
    return { role: r.role === "user" ? "user" as const : "assistant" as const, text: r.role !== "user" && a && typeof a.summary === "string" ? answerAsText({ ...a, nextSteps: a.nextSteps ?? [], questions: a.questions ?? [] }) : String(r.content ?? "") };
  });
}

/** Who the chat was opened for, said to the model so "my" and "his" read the same way the household meant them. */
/** Today's date in Singapore, so a waiting period or a policy's start can be set against an event the household describes now. */
const dated = (d: Date) => `(Today is ${new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10)}.) `; // Singapore time (UTC+8)
function chatFor(context: ChatContext): string {
  const p = context.family.find((f) => f.id === context.conversation.family_member_id);
  return p ? `(This chat is about ${p.display_name}${p.relationship ? `, ${p.relationship}` : ""}.) ` : "";
}

/** Each date range a document prints ("29/09/2026 to 04/10/2026"), with whether it has ended, is running or has not
 * started by today's date in Singapore: worked out here, so the answer never calls an ended trip "not started" (live run
 * 23 Oct, S048). At most three ranges a document. */
export function periodsNote(household: Household, now: Date): string {
  const today = Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000);
  const said: string[] = [];
  for (const d of household.documents) {
    const seen = new Set<string>();
    for (const p of d.pages) for (const m of p.text.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:to|until|-|–|—)\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/gi)) {
      const from = printedDay(m[1]), to = printedDay(m[2]);
      if (from == null || to == null || to <= from || seen.has(`${m[1]}|${m[2]}`) || seen.size >= 3) continue;
      seen.add(`${m[1]}|${m[2]}`);
      said.push(`${d.productName ?? d.name} prints ${m[1]} to ${m[2]}: ${to < today ? "ended before today" : from > today ? "not started yet" : "running today"}`);
    }
  }
  return said.length ? `(Dates printed: ${said.join("; ")}.) ` : "";
}

/** The days the household's message names ("on 29 september", "29/09"), as dates with how far each is from today, so a
 * deadline counted from the event is worked out by the server's calendar, not the model's (live run 23 Oct, S060: "he has
 * already been outside the 30-day claim window ... since 29/10/2026 is not yet here"). A day with no year is this year's;
 * when that is still to come, last year's is said too. */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
export function datesSaidNote(message: string, now: Date): string {
  const today = Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000);
  const year = new Date(today * 86_400_000).getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  const said: string[] = [], seen = new Set<number>();
  const away = (day: number) => { const gap = today - day; return gap === 0 ? "today" : `${Math.abs(gap)} day${Math.abs(gap) === 1 ? "" : "s"} ${gap > 0 ? "before" : "after"} today`; };
  const add = (words: string, d: number, mo: number, y: number | null) => {
    const day = printedDay(`${pad(d)}/${pad(mo)}/${y ?? year}`);
    if (day == null || seen.has(day) || seen.size >= 3) return;
    seen.add(day);
    const last = y == null && day > today ? printedDay(`${pad(d)}/${pad(mo)}/${year - 1}`) : null;
    // A day still to come this year may be last year's: both are said, never a guess between them.
    said.push(`"${words}" is ${pad(d)}/${pad(mo)}/${y ?? year}, ${away(day)}${last != null ? `, or ${pad(d)}/${pad(mo)}/${year - 1}, ${away(last)}, if last year's` : ""}`);
  };
  const of = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
  for (const m of message.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:\\s+(\\d{4}))?(?![a-z])`, "gi")))
    add(m[0], Number(m[1]), of(m[2]), m[3] ? Number(m[3]) : null);
  // Month first, but never "may 3" ("it may 3 ...").
  for (const m of message.matchAll(new RegExp(`\\b(?!may\\b)${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi")))
    add(m[0], Number(m[2]), of(m[1]), m[3] ? Number(m[3]) : null);
  for (const m of message.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g))
    add(m[0], Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
  return said.length ? `(Days the household named: ${said.join("; ")}.) ` : "";
}

/** A bottom line that introduces points below it ("here is each adult's list", "the amounts are below:"). */
// Only words that point at what comes next: "below" ending its sentence, not "below the knee" or "below the limit" (TE N3,
// N4, N5).
const INTRODUCES = /:\s*$|\bas\s+follows\b|\bbelow\s*(?:[.:]|$)|(?:^|[.!?]\s+)(?:here(?:'s|’s|\s+is|\s+are)|these\s+are\s+(?!not\b))/i;

/** Who "my husband" or "my wife" is, when the documents settle it (lib/simple-chat/library spouseMeant). The latest
 * mention counts: the message, then earlier turns newest first (TE S4). */
function spouseNote(household: Household, said: string[]): string {
  const meant = spouseMeant(household, said);
  return meant ? `("${meant.word}" is ${meant.member}: the documents print "${meant.printed}".) ` : "";
}

export async function runSimpleChat(context: ChatContext, opts: { check?: () => Promise<void>; jobId?: string } = {}, deps: SimpleDeps = {}): Promise<ChatResult> {
  const { request, conversation } = context;
  const message = request.submittedQuestion ?? request.question;
  const model = deps.model ?? modelFromChoice(simpleChatModel());
  const ledger = deps.ledger ?? !deps.model;
  const loadStarted = Date.now();
  // The spend check, the library, the conversation and the benefit table are read side by side: a person is waiting.
  const [, household, history, table] = await Promise.all([
    ledger ? assertUnderSpendCap(request.accountId) : null,
    (deps.household ?? loadHousehold)(request.accountId),
    (deps.history ?? conversationTurns)(request.accountId, conversation.id),
    (deps.table ?? liveTable)(request.accountId),
  ]);
  if (household.accountId !== request.accountId) throw new Error("The library read is for another household; refusing to answer");
  const rows = table ? chatRows(table, household) : null;
  const now = (deps.today ?? (() => new Date()))();
  const started = Date.now();
  const loadMs = started - loadStarted;
  let reply: Awaited<ReturnType<SimpleModel["call"]>> | null = null;
  try {
    // With the table, only the pages its rows come from, and those documents' pages that print a waiting period or an
    // exclusion, are sent with it (about half the cost per question).
    reply = await model.call({ library: renderLibrary(household, rows ? pagesToSend(rows, household) : undefined) + (rows ? renderTable(rows) : ""), withRows: !!rows, history, question: dated(now) + periodsNote(household, now) + datesSaidNote(message, now) + chatFor(context) + spouseNote(household, [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()]) + message });
  } finally {
    if (ledger) await recordUsage({ accountId: request.accountId, role: "chat", choice: model.choice, ...(reply ? ledgerUsage(reply.usage) : { input: 0, output: 0, cached: 0 }), durationMs: Date.now() - started, ok: !!reply });
  }
  const modelEnded = Date.now();
  // With the benefit table, every amount is rewritten from the row it names (or dropped) before the usual checks.
  const fromRows: { json: unknown; report: RowReport | null } = rows ? amountsFromRows(reply.json, rows, household, now, message) : { json: reply.json, report: null };
  const parsed = readModelAnswer(fromRows.json);
  const asked = [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()];
  const { answer, report } = parsed ? verifyAnswer(household, parsed, asked, new Set(fromRows.report?.labels ?? [])) : verifyAnswer(household, { bottomLine: NO_ANSWER, statements: [], nextSteps: [], question: null });
  if (fromRows.report && answer.statements) {
    const { kept, refused } = keepLabelledAmounts(answer.statements, fromRows.report);
    answer.statements = kept;
    fromRows.report.dropped.push(...refused.map((st) => ({ why: "the amount lost its label to the checks", text: st.text })));
    // A sentence that shuts a person out of a cover their own cards or rows show is left out (live run 22 Oct, C5).
    report.sentencesLeftOut.push(...dropPeopleShutOut(answer, rows!, household, fromRows.report.labels));
    report.sentencesLeftOut.push(...dropAmountPointers(answer, fromRows.report.labels));
    report.sentencesLeftOut.push(...dropAgreeingDayRules(answer, fromRows.report));
    answer.statements = noteLeftOutAmounts(answer.statements, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
    answer.statements = noteNarrowedPages(answer.statements, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
  }
  // Points were given, none survived the checks, and the bottom line introduces them: the answer says so, never a bare
  // introduction to nothing. A bottom line that answers on its own stands alone (live run 23 Oct, E2).
  if (parsed?.statements.length && !(answer.statements ?? []).length && INTRODUCES.test(answer.bottomLine ?? answer.summary ?? "")) answer.statements = [{ id: "nothing-shown", kind: "uncertainty", text: NOTHING_SHOWN, fullText: NOTHING_SHOWN, conditions: [] }];
  answer.conversationId = conversation.id;
  answer.conversationRevision = conversation.revision + 1;
  enforceLiveChatMonetaryBoundary(answer, { claimContext: false });
  const prior = conversation.state as SimpleChatState;
  // Where the time went (kept with the turn, no household text): reading the library and table, the model, the checks.
  const timing = { loadMs, modelMs: modelEnded - started, checkMs: Date.now() - modelEnded };
  const turns = [...(prior.simpleChat?.turns ?? []), { model: reply.model, usage: ledgerUsage(reply.usage), ms: Date.now() - started, timing, report: fromRows.report ? { ...report, dropped: [...fromRows.report.dropped.map((d) => ({ kind: "amount", ...d })), ...report.dropped] } : report }].slice(-12);
  const next: SimpleChatState = { ...prior, intent: "policy_question", simpleChat: { turns } };
  delete next.pending;
  await opts.check?.();
  await (deps.save ?? saveTurn)({ conversation, token: context.token, state: next, message, answer, jobId: opts.jobId });
  return { answer, retrieved: [] };
}
