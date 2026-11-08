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
import { maskIdentityNumbers } from "@/lib/chat/identity-numbers";
import { getConversation, historyToken, openConversation, saveTurn, ChatConflict } from "@/lib/chat/store";
import type { ChatContext, ChatRequest } from "@/lib/chat/workflow";
import type { ChatResult, ConversationState } from "@/lib/chat/types";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer } from "@/types";
import { simpleChatModel } from "./flag";
import { appHelp } from "./app-help";
import { loadHousehold, renderLibrary, spouseMeant, type Household } from "./library";
import { LIBRARY_CACHE_WRITE_RATE, ledgerUsage, modelFromChoice, type SimpleModel, type Turn } from "./model";
import { answerAsText, NO_ANSWER, NOTHING_SHOWN, readModelAnswer, sentences as sentencesOf, verifyAnswer, type VerifyReport } from "./verify";
import type { BenefitTable } from "@/lib/benefit-table/assemble";
import { amountsFromRows, asksForNobody, printedDay, chatRows, dropAgreeingDayRules, dropConditionsOnCards, dropAmountPointers, dropPeopleShutOut, keepLabelledAmounts, noteLeftOutAmounts, noteNarrowedPages, pagesToSend, renderTable, type RowReport } from "@/lib/benefit-table/chat";

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
  if (!family.length) throw new ChatConflict("Add a family member first. Under Account settings > People, add yourself (and anyone else your policies cover), then ask again.");
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

/** Each date range a document prints ("29/09/2026 to 04/10/2026"), as printed. Every policy on file is treated as in
 * force (DC, 31 Oct: "ignore all expiry dates"), so no range is called ended, running or not started. At most three
 * ranges a document. */
export function periodsNote(household: Household, _now: Date): string {
  const said: string[] = [];
  for (const d of household.documents) {
    const seen = new Set<string>();
    for (const p of d.pages) for (const m of p.text.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:to|until|-|–|—)\s*(\d{1,2}\/\d{1,2}\/\d{4})\b/gi)) {
      const from = printedDay(m[1]), to = printedDay(m[2]);
      if (from == null || to == null || to <= from || seen.has(`${m[1]}|${m[2]}`) || seen.size >= 3) continue;
      seen.add(`${m[1]}|${m[2]}`);
      said.push(`${d.productName ?? d.name} prints ${m[1]} to ${m[2]}`);
    }
  }
  return said.length ? `(Dates printed, treated as in force: ${said.join("; ")}.) ` : "";
}

/** The days the household's message names ("on 29 september", "29/09"), as dates with how far each is from today, so a
 * deadline counted from the event is worked out by the server's calendar, not the model's (live run 23 Oct, S060: "he has
 * already been outside the 30-day claim window ... since 29/10/2026 is not yet here"). A day with no year is this year's;
 * when that is still to come, last year's is said too. */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
/** The claim windows the household's documents print: a number of days a claim or notice must be given within ("written
 * notice of a claim within one hundred and twenty (120) days of the event", "no later than 30 days of an incident"). */
export function claimWindows(household: Household): number[] {
  const found = new Set<number>();
  for (const d of household.documents) for (const p of d.pages) {
    const text = p.text.replace(/\s+/g, " ");
    for (const m of text.matchAll(/\b(?:within|no\s+later\s+than)\s+(?:[a-z-]+\s+){0,5}\(?(\d{1,3})\)?\s+days?\s+(?:of|from|after)\b/gi)) {
      // Only the window's own sentence: "Cover starts on the day of admission. Notice of a claim must be given within 30 days"
      // is a claim window (TE pr113 R10).
      const n = Number(m[1]), before = text.slice(Math.max(0, m.index! - 90), m.index!).split(/[.!?]\s+/).pop()!;
      // Not a waiting period ("no claim is payable for an illness that starts within 30 days of the cover start date") or a
      // free look ("if no claim has been made, you may cancel within 14 days") (TE pr113 W2, W3).
      const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 40);
      if (n >= 7 && n <= 365 && /\b(?:claims?|notice|notify|inform\s+us|tell\s+us)\b/i.test(before)
        && !/\b(?:assault|authority|reported\s+to|premium|grace|waiting|cancel\w*|refund\w*|free[\s-]look|cooling)\b|\bno\s+claims?\s+(?:has|have)\s+been\s+made\b|\breturn\s+(?:the|this|your)\s+policy\b/i.test(before)
        // An illness that "starts within 30 days" is a waiting period; a claim "given within 30 days" is a window (TE pr113 R9).
        && !/\b(?:starts?|started|commenc\w*|begins?|occurs?|arises?|manifest\w*|diagnosed)\s*$/i.test(before)
        && !/^\s*(?:(?:the\s+)?(?:cover|policy|commencement|start|issue)\b|receiv\w*\s+(?:it|(?:the|this|your)\s+policy)\b)/i.test(after)) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b).slice(0, 4);
}
const NUMBER_DAYS: Record<string, number> = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };
export function datesSaidNote(message: string, now: Date, windows: number[] = []): string {
  const today = Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000);
  const year = new Date(today * 86_400_000).getUTCFullYear();
  const pad = (n: number) => String(n).padStart(2, "0");
  const said: string[] = [], seen = new Set<number>();
  const away = (day: number) => { const gap = today - day; return gap === 0 ? "today" : `${Math.abs(gap)} day${Math.abs(gap) === 1 ? "" : "s"} ${gap > 0 ? "before" : "after"} today`; };
  const dated = (day: number) => { const d = new Date(day * 86_400_000); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
  // The last day of each claim window the documents print, counted from that day, by the server's calendar (overnight run 23
  // Oct, N111: "the 30-day claim window has already passed" with 7 days left; K1: 120 days from "yesterday" one day late).
  const windowsFrom = (day: number) => windows.length && day <= today ? ` (${windows.map((w) => `${w} days after it is ${dated(day + w)}, ${away(day + w)}`).join("; ")})` : "";
  const addDay = (words: string, day: number) => {
    if (seen.has(day) || seen.size >= 3) return;
    seen.add(day);
    said.push(`"${words}" is ${dated(day)}, ${away(day)}${windowsFrom(day)}`);
  };
  const add = (words: string, d: number, mo: number, y: number | null) => {
    const day = printedDay(`${pad(d)}/${pad(mo)}/${y ?? year}`);
    if (day == null || seen.has(day) || seen.size >= 3) return;
    seen.add(day);
    const last = y == null && day > today ? printedDay(`${pad(d)}/${pad(mo)}/${year - 1}`) : null;
    // A day still to come this year may be last year's: both are said, never a guess between them.
    said.push(`"${words}" is ${pad(d)}/${pad(mo)}/${y ?? year}, ${away(day)}${windowsFrom(day)}${last != null ? `, or ${pad(d)}/${pad(mo)}/${year - 1}, ${away(last)}${windowsFrom(last)}, if last year's` : ""}`);
  };
  // Days said by how long ago they were: "yesterday", "the day before yesterday", "3 days ago", "last night".
  for (const m of message.matchAll(/\b(?:the\s+)?day\s+before\s+yesterday\b|\byesterday\b|\blast\s+night\b|\b(\d{1,2}|a|one|two|three|four|five|six|seven|ten)\s+days?\s+ago\b/gi)) {
    const ago = /before\s+yesterday/i.test(m[0]) ? 2 : /yesterday|last\s+night/i.test(m[0]) ? 1 : /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_DAYS[m[1].toLowerCase()];
    addDay(m[0], today - ago);
  }
  const of = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
  for (const m of message.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?:\\s+(\\d{4}))?(?![a-z])`, "gi")))
    add(m[0], Number(m[1]), of(m[2]), m[3] ? Number(m[3]) : null);
  // Month first, but never "may 3" ("it may 3 ...").
  for (const m of message.matchAll(new RegExp(`\\b(?!may\\b)${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi")))
    add(m[0], Number(m[2]), of(m[1]), m[3] ? Number(m[3]) : null);
  // "24/7" and "3/4" are not dates: a slash date has its year, or a word before it that leads a date (Critic R162).
  for (const m of message.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b|\b(?:on|since|from|by|dated|until|till)\s+(\d{1,2})\/(\d{1,2})(?![\/\d])/gi))
    add(m[0], Number(m[1] ?? m[4]), Number(m[2] ?? m[5]), m[3] ? Number(m[3]) : null);
  return said.length ? `(Days the household named: ${said.join("; ")}.) ` : "";
}

/** An identity number is masked in every word of the answer, whatever was asked (overnight run 23 Oct, N291, N292); saveTurn
 * masks again for every chat path (lib/chat/identity-numbers.ts). */
export { maskIdentityNumbers };

/** Words that say a claim's deadline has passed, or that a claim would be late. */
const LATE = /\b(?:has|have|had)\s+(?:already\s+)?(?:passed|expired|closed|lapsed|run\s+out)\b|\b(?:may\s+)?already\s+(?:be\s+)?(?:past|over|outside|beyond)\b|\b(?:would|will)\s+(?:also\s+)?be\s+(?:too\s+)?late\b|\btoo\s+late\b|\bout\s+of\s+time\b/i;
const DEADLINE_WORDS = /\b(?:claims?|deadline|window|notice|notify|time\s+limit|days?)\b/i;
const OTHER_PERIOD = /\b(?:waiting|free[-\s]?look|cooling|survival|grace|policy\s+(?:period|year)|trip|cover(?:age)?\s+period)\b/i;
const DEADLINE_SAID = /\b(?:by|within|before|until|ends?|deadline|last\s+day|claim|notice)\b/i;
const CLAIM_SAID = /\b(?:claims?|notice|notify|deadline|last\s+day)\b/i;
const WHOSE_NOT = /^(?:the|your|their|his|her|its|this|that|any|each|every|one|day|days|month|months|claim|notice|and|but|for|of|to|own|whose)$/;
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
/** A clause saying a claim's deadline has passed, or a claim would be late, when the answer itself gives that deadline as
 * still open: a last day on or after today in a sentence about a deadline, or a date and a number of days in the clause's
 * own sentence that end on or after today (overnight run 23 Oct, N111, N118, N108, N264: "the 30-day claim window has
 * already passed" over "claim by 31/10/2026, 7 days from today"). The clause goes, with a "so ..." clause that follows from
 * it; a clause that stands alone goes with its sentence. A deadline the answer gives as passed, with no open date, stays. */
export function dropLateClaims(answer: { summary: string; bottomLine?: string | null; statements?: { text: string; fullText?: string }[]; nextSteps: string[] }, now: Date, labels: readonly string[] = []): string[] {
  const today = Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000);
  const dayOf = (m: RegExpMatchArray) => printedDay(`${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`);
  const all = [answer.bottomLine ?? answer.summary, ...(answer.statements ?? []).map((s) => s.text), ...answer.nextSteps].filter(Boolean).join(" ");
  // Only a date given as a claim's last day: "your cover runs until 31/12/2026" opens no claim window (Critic R169-5).
  const opens = sentencesOf(all).filter((x) => DEADLINE_SAID.test(x) && CLAIM_SAID.test(x) && !OTHER_PERIOD.test(x) && !LATE.test(x) && [...x.matchAll(SLASH_DATE)].some((m) => { const d = dayOf(m); return d != null && d >= today; }));
  // "The baggage claim deadline has already passed" is not answered by "submit the medical claim by 30/10/2026": a clause
  // that names whose claim it is needs an open date for that one (TE pr113 D4).
  const openSaid = (c: string) => {
    // "The baggage claim deadline", or "the claim deadline for baggage" (TE pr113 R7).
    const whose = [...c.matchAll(/\b([a-z]{3,})\s+(?:claims?|deadline|window|notice)\b|\b(?:claims?|deadline|window|notice)\s+(?:deadline\s+|window\s+)?for\s+(?:the\s+|your\s+|a\s+|an\s+)?([a-z]{3,})/gi)]
      .map((m) => (m[1] ?? m[2]).toLowerCase()).find((w) => !WHOSE_NOT.test(w));
    return whose ? opens.some((x) => new RegExp(String.raw`\b${whose}\b`, "i").test(x)) : opens.length > 0;
  };
  const openIn = (sentence: string) => {
    const windows = [...sentence.matchAll(/\b(\d{1,3})[\s-]*days?\b/gi)].map((m) => Number(m[1]));
    return [...sentence.matchAll(SLASH_DATE)].some((m) => { const d = dayOf(m); return d != null && windows.some((w) => d + w >= today); });
  };
  const late = (c: string, sentence: string) => LATE.test(c) && (DEADLINE_WORDS.test(c) || DEADLINE_WORDS.test(sentence)) && !OTHER_PERIOD.test(c);
  const left: string[] = [];
  const cut = (text: string) => sentencesOf(text).map((x) => {
    const parts = x.split(/(?:,|;)\s+(?=(?:and|but|so|while|although|though)\b)|;\s+/);
    if (!parts.some((c) => late(c, x) && (openSaid(c) || openIn(x)))) return x;
    left.push(x);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (late(parts[i], x) && (openSaid(parts[i]) || openIn(x))) { while (i + 1 < parts.length && /^so\b/i.test(parts[i + 1])) i++; continue; }
      kept.push(parts[i]);
    }
    if (!kept.length || /^(?:and|but|so|while|although|though)\b/i.test(kept[0]) && kept.length === 1) return null;
    const joined = kept.join(", ").replace(/[\s,;:]+$/, "");
    const said = joined.charAt(0).toUpperCase() + joined.slice(1);
    return /[.!?]$/.test(said) ? said : `${said}.`;
  }).filter((x): x is string => !!x).join(" ").trim();
  const bottom = answer.bottomLine ?? answer.summary;
  if (bottom) { const b = cut(bottom) || bottom; answer.summary = b; if (answer.bottomLine != null) answer.bottomLine = b; }
  for (const s of [...(answer.statements ?? [])]) {
    if (labels.includes(s.text)) continue;
    const t = cut(s.text);
    if (t === s.text) continue;
    if (!t) answer.statements!.splice(answer.statements!.indexOf(s), 1);
    else { s.text = t; s.fullText = t; }
  }
  answer.nextSteps = answer.nextSteps.map(cut).filter(Boolean);
  return left;
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
  // A question about DearPolicy itself gets its fixed answer, with no model call (lib/simple-chat/app-help).
  const help = appHelp(message, household.documents.flatMap((d) => [d.insurer ?? "", d.productName ?? ""]));
  if (help) reply = { json: help.answer, stopReason: null, model: `app-help:${help.id}`, usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } };
  else try {
    // With the table, only the pages its rows come from, and those documents' pages that print a waiting period or an
    // exclusion, are sent with it (about half the cost per question).
    reply = await model.call({ library: renderLibrary(household, rows ? pagesToSend(rows, household) : undefined) + (rows ? renderTable(rows) : ""), withRows: !!rows, history, question: dated(now) + periodsNote(household, now) + datesSaidNote(message, now, claimWindows(household)) + chatFor(context) + spouseNote(household, [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()]) + message });
  } finally {
    if (ledger) await recordUsage({ accountId: request.accountId, role: "chat", choice: model.choice, ...(reply ? ledgerUsage(reply.usage, LIBRARY_CACHE_WRITE_RATE) : { input: 0, output: 0, cached: 0 }), durationMs: Date.now() - started, ok: !!reply });
  }
  const modelEnded = Date.now();
  // With the benefit table, every amount is rewritten from the row it names (or dropped) before the usual checks.
  const fromRows: { json: unknown; report: RowReport | null } = rows && !help ? amountsFromRows(reply.json, rows, household, now, message, history.filter((t) => t.role === "user").map((t) => t.text).reverse(),
    !context.conversation.family_member_id && asksForNobody([message, ...history.filter((t) => t.role === "user").map((t) => t.text)], household, rows)) : { json: reply.json, report: null };
  const parsed = readModelAnswer(fromRows.json);
  const asked = [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()];
  const { answer, report } = parsed ? verifyAnswer(household, parsed, asked, new Set(fromRows.report?.labels ?? [])) : verifyAnswer(household, { bottomLine: NO_ANSWER, statements: [], nextSteps: [], question: null });
  if (fromRows.report && answer.statements) {
    const { kept, refused } = keepLabelledAmounts(answer.statements, fromRows.report);
    // A condition point whose words its card already shows is said once, on the card.
    answer.statements = dropConditionsOnCards(kept, fromRows.report);
    fromRows.report.dropped.push(...refused.map((st) => ({ why: "the amount lost its label to the checks", text: st.text })));
    // A sentence that shuts a person out of a cover their own cards or rows show is left out (live run 22 Oct, C5).
    report.sentencesLeftOut.push(...dropPeopleShutOut(answer, rows!, household, fromRows.report.labels));
    report.sentencesLeftOut.push(...dropAmountPointers(answer, fromRows.report.labels, fromRows.report.dropped.some((d) => !d.notFit)));
    report.sentencesLeftOut.push(...dropAgreeingDayRules(answer, fromRows.report));
    answer.statements = noteLeftOutAmounts(answer.statements, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
    answer.statements = noteNarrowedPages(answer.statements, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
  }
  // Points were given, none survived the checks, and the bottom line introduces them: the answer says so, never a bare
  // introduction to nothing. A bottom line that answers on its own stands alone (live run 23 Oct, E2).
  if (parsed?.statements.length && !(answer.statements ?? []).length && INTRODUCES.test(answer.bottomLine ?? answer.summary ?? "")) answer.statements = [{ id: "nothing-shown", kind: "uncertainty", text: NOTHING_SHOWN, fullText: NOTHING_SHOWN, conditions: [] }];
  answer.conversationId = conversation.id;
  answer.conversationRevision = conversation.revision + 1;
  enforceLiveChatMonetaryBoundary(answer, { claimContext: false });
  report.sentencesLeftOut.push(...dropLateClaims(answer, now, fromRows.report?.labels ?? []));
  maskIdentityNumbers(answer);
  // What the server left out is kept with the turn: an identity number in it is masked too.
  maskIdentityNumbers(report);
  if (fromRows.report) maskIdentityNumbers(fromRows.report);
  const prior = conversation.state as SimpleChatState;
  // Where the time went (kept with the turn, no household text): reading the library and table, the model, the checks.
  const timing = { loadMs, modelMs: modelEnded - started, checkMs: Date.now() - modelEnded };
  const turns = [...(prior.simpleChat?.turns ?? []), { model: reply.model, usage: ledgerUsage(reply.usage, LIBRARY_CACHE_WRITE_RATE), ms: Date.now() - started, timing, report: fromRows.report ? { ...report, dropped: [...fromRows.report.dropped.map((d) => ({ kind: "amount", ...d })), ...report.dropped] } : report }].slice(-12);
  const next: SimpleChatState = { ...prior, intent: "policy_question", simpleChat: { turns } };
  delete next.pending;
  await opts.check?.();
  await (deps.save ?? saveTurn)({ conversation, token: context.token, state: next, message, answer, jobId: opts.jobId });
  return { answer, retrieved: [] };
}
