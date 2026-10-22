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
import { loadHousehold, renderLibrary, type Household } from "./library";
import { ledgerUsage, modelFromChoice, type SimpleModel, type Turn } from "./model";
import { answerAsText, NO_ANSWER, readModelAnswer, verifyAnswer, type VerifyReport } from "./verify";
import type { BenefitTable } from "@/lib/benefit-table/assemble";
import { amountsFromRows, chatRows, keepLabelledAmounts, noteLeftOutAmounts, noteNarrowedPages, pagesToSend, renderTable, type RowReport } from "@/lib/benefit-table/chat";

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
  const started = Date.now();
  const loadMs = started - loadStarted;
  let reply: Awaited<ReturnType<SimpleModel["call"]>> | null = null;
  try {
    // With the table, only the pages its rows come from, and those documents' pages that print a waiting period or an
    // exclusion, are sent with it (about half the cost per question).
    reply = await model.call({ library: renderLibrary(household, rows ? pagesToSend(rows, household) : undefined) + (rows ? renderTable(rows) : ""), withRows: !!rows, history, question: dated((deps.today ?? (() => new Date()))()) + chatFor(context) + message });
  } finally {
    if (ledger) await recordUsage({ accountId: request.accountId, role: "chat", choice: model.choice, ...(reply ? ledgerUsage(reply.usage) : { input: 0, output: 0, cached: 0 }), durationMs: Date.now() - started, ok: !!reply });
  }
  const modelEnded = Date.now();
  // With the benefit table, every amount is rewritten from the row it names (or dropped) before the usual checks.
  const fromRows: { json: unknown; report: RowReport | null } = rows ? amountsFromRows(reply.json, rows, household) : { json: reply.json, report: null };
  const parsed = readModelAnswer(fromRows.json);
  const asked = [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()];
  const { answer, report } = parsed ? verifyAnswer(household, parsed, asked, new Set(fromRows.report?.labels ?? [])) : verifyAnswer(household, { bottomLine: NO_ANSWER, statements: [], nextSteps: [], question: null });
  if (fromRows.report && answer.statements) {
    const { kept, refused } = keepLabelledAmounts(answer.statements, fromRows.report);
    answer.statements = kept;
    fromRows.report.dropped.push(...refused.map((st) => ({ why: "the amount lost its label to the checks", text: st.text })));
    answer.statements = noteLeftOutAmounts(answer.statements, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
    answer.statements = noteNarrowedPages(answer.statements, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
  }
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
