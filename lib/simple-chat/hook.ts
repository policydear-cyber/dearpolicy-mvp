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
import { assertUnderSpendCap, overSpendCap, recordUsage } from "@/lib/ai/ledger";
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
import { OTHER_EXCLUSIONS_ID, membersMentioned, otherExclusionsNote, samePerson } from "./other-exclusions";
import { LIBRARY_CACHE_WRITE_RATE, ledgerUsage, modelFromChoice, type SimpleModel, type Turn } from "./model";
import { aboutLibrary, answerAsText, NO_ANSWER, NOTHING_SHOWN, noteCoverNotCounted, readModelAnswer, sentences as sentencesOf, verifyAnswer, type VerifyReport } from "./verify";
import type { BenefitTable } from "@/lib/benefit-table/assemble";
import { randomUUID } from "node:crypto";
import { SUPERSEDED_NOTICE, supersededAnswerIds } from "@/lib/chat/stale-answers";
import { resolveSubjects, subjectsNote, supersededBy, unknownPersonAnswer, type Subjects } from "./subjects";
import { docLabel, matchMember, membersNamedIn } from "./verify";
import { declutterAnswer } from "./declutter";
import { dropQuoteFragments, tablesFromPrintedRows } from "./printed-table";
import { listFromBottomLine } from "./lead-list";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { contactsHelp, insurerContactsFor } from "./insurer-contacts";
import { amountsFromRows, withheldRows, asksForNobody, namesSomeone, printedDay, chatRows, dropAgreeingDayRules, dropConditionsOnCards, dropAmountPointers, dropPeopleShutOut, dropQuotePointers, keepLabelledAmounts, noteLeftOutAmounts, noteNarrowedPages, pagesToSend, renderTable, type RowReport } from "@/lib/benefit-table/chat";

/** Each turn's `answerId` is its saved answer's (ChatAnswer.answerId), `people` the members its amounts were shown for, and
 * `subjects` the members it was allowed to show figures for (lib/simple-chat/subjects.ts; null: not settled). `superseded`:
 * the ids of earlier answers a later correction of who the chat is about made out of date. */
export type SimpleChatState = ConversationState & { simpleChat?: { turns: { model: string; usage: ReturnType<typeof ledgerUsage>; ms: number; timing?: { loadMs: number; modelMs: number; checkMs: number }; report: VerifyReport;
  answerId?: string; people?: string[]; subjects?: string[] | null;
  /** The second call asking for each person's own figures (asksWhoseOnly), and whether its answer was the one kept. */
  eachPerson?: { model: string; usage: ReturnType<typeof ledgerUsage>; kept: boolean; skipped?: "spend cap" } }[]; superseded?: string[] } };
type Save = typeof saveTurn;
export type SimpleDeps = { model?: SimpleModel; household?: (accountId: string) => Promise<Household>; history?: (accountId: string, conversationId: string) => Promise<Turn[]>; save?: Save; ledger?: boolean; today?: () => Date;
  /** The household's benefit table, when it is switched on (lib/benefit-table): its rows are the chat's only amounts. */
  table?: (accountId: string) => Promise<BenefitTable | null>;
  /** Each document's benefit-table state (policy id to lib/benefit-table/service.ts documentState), read with the table. */
  tableStates?: (accountId: string) => Promise<ReadonlyMap<string, string> | null> };

/** The signed-in household's benefit table when DEARPOLICY_BENEFIT_TABLE is live, otherwise null. */
async function liveTable(accountId: string): Promise<{ table: BenefitTable; states: ReadonlyMap<string, string> } | null> {
  const { appDb, benefitTableLive } = await import("@/lib/benefit-table/app");
  if (!(await benefitTableLive(accountId))) return null;
  const { tableFor, tableStateKey } = await import("@/lib/benefit-table/service");
  const t = await tableFor(appDb, accountId);
  return { table: t.table, states: new Map(t.documents.map((d) => [d.id, tableStateKey(d)])) };
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
export async function conversationTurns(accountId: string, conversationId: string, superseded: ReadonlySet<string> = new Set()): Promise<Turn[]> {
  const rows = (await query<{ role: string; content: string; answer_json: unknown }>(
    `SELECT role,content,answer_json FROM (SELECT role,content,answer_json,created_at,message_order FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 ORDER BY created_at DESC,message_order DESC LIMIT 12) m ORDER BY created_at,message_order`,
    [accountId, conversationId])).rows;
  return turnsFromMessages(rows, superseded);
}
/** The saved messages as the model reads them, oldest first. An answer a later correction made out of date (`superseded`,
 * lib/simple-chat/subjects.ts) is never read to the model again with its figures, which would read them back for the
 * person taken out: the model hears it was replaced, as the household does on reopening. */
export function turnsFromMessages(rows: readonly { role: string; content: string; answer_json: unknown }[], superseded: ReadonlySet<string> = new Set()): Turn[] {
  return rows.map((r) => {
    const a = r.answer_json as (ChatAnswer & Parameters<typeof answerAsText>[0]) | null;
    if (r.role !== "user" && a && typeof a.answerId === "string" && superseded.has(a.answerId)) return { role: "assistant" as const, text: SUPERSEDED_NOTICE };
    return { role: r.role === "user" ? "user" as const : "assistant" as const, text: r.role !== "user" && a && typeof a.summary === "string" ? answerAsText({ ...a, nextSteps: a.nextSteps ?? [], questions: a.questions ?? [] }) : String(r.content ?? ""),
      ...(r.role !== "user" && a && typeof a.answerId === "string" ? { answerId: a.answerId } : {}) };
  });
}

/** An amount from a document the household said it did not renew for that person (Home's Policy dates, "I didn't renew
 * it") is never shown as that person's cover, whatever the model wrote (TE F3: the prompt rule alone let a not-renewed
 * trip's death benefit through). Each such statement is replaced, once per document and person, by the household's own
 * statement. Another person on the same document keeps theirs. Returns the sentences left out. */
export function dropNotRenewedAmounts(answer: { statements?: { id: string; kind: string; text: string; fullText?: string; personName?: string | null; amount?: unknown; source?: { citationIds?: string[] } | null; conditions?: unknown[] }[]; citations?: { chunkId: string; policyId: string }[]; bottomLine?: string | null; summary?: string }, household: Household, chatPerson: string | null = null): string[] {
  const docs = new Map(household.documents.filter((d) => d.notRenewedFor?.length).map((d) => [d.policyId, d]));
  if (!docs.size || !answer.statements?.length) return [];
  const policyOf = new Map((answer.citations ?? []).map((c) => [c.chunkId, c.policyId]));
  const left: string[] = [], said = new Set<string>(), out: typeof answer.statements = [];
  // The statement's person as keepAnswerToSubjects resolves it ("Nora Tan (Nora)" is Nora Tan: Critic MED-7). A name that
  // resolves to no one fails closed: on a document the household answered for, the amount goes.
  const members = new Set(household.members.map((m) => m.name.replace(/\s*\([^)]*\)\s*$/, "").trim()));
  const personOf = (name: string | null | undefined) => !name ? null : members.has(name) ? name : matchMember(household, name);
  for (const st of answer.statements) {
    // A statement naming no one is about the person the chat is for, when it is for someone (TE F3c).
    const named = st.personName?.trim() ? personOf(st.personName) : personOf(chatPerson);
    const unresolved = !!st.personName?.trim() && !named;
    const hit = st.amount ? (st.source?.citationIds ?? []).map((id) => docs.get(policyOf.get(id) ?? "")).find((d) => d && (unresolved || d.notRenewedFor!.some((x) =>
      named ? x.person === named : d.linkedPeople.length > 0 && d.linkedPeople.every((p) => d.notRenewedFor!.some((y) => y.person === p))))) : undefined;
    if (!hit) { out.push(st); continue; }
    left.push(st.text);
    const who = hit.notRenewedFor!.find((x) => !named || x.person === named)!;
    const key = `${hit.policyId}|${who.person}`;
    if (said.has(key)) continue;
    said.add(key);
    const text = `${docLabel(household, hit)} was not renewed after ${who.after} for ${who.person}, as the household told DearPolicy, so it is not current cover.`;
    out.push({ id: `${st.id}-not-renewed`, kind: "fact", text, fullText: text, personName: named ?? who.person, amount: null, source: null, conditions: [] });
  }
  answer.statements = out;
  // The bottom line was written for the amounts the model gave: once one is replaced it can promise an amount "shown
  // below" that is not (TE F3b). It says what is left instead.
  if (left.length) {
    const facts = out.filter((st) => st.id.endsWith("-not-renewed")).map((st) => st.text);
    const line = out.some((st) => st.amount) ? `Here is what your documents say. ${facts.join(" ")}` : facts.join(" ");
    if (answer.bottomLine != null) answer.bottomLine = line;
    if (typeof answer.summary === "string") answer.summary = line;
  }
  return left;
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
    if (d.householdSaid) continue;
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

/** The model's statements kept to the people the turn is about (subjects.people; null: every statement stays). A statement
 * whose person is another member is left out, whatever its kind: after "actually it's Daniel, not Grace" nothing is said
 * for Grace. A statement for no one whose words name only other members goes too. Allow-list: only the people resolved. */
export function keepToSubjects(json: unknown, subjects: Subjects, household: Household): unknown {
  if (!subjects.people || !json || typeof json !== "object" || !Array.isArray((json as { statements?: unknown }).statements)) return json;
  const allowed = new Set(subjects.people);
  const others = (person: string | null) => !!person && !allowed.has(person);
  const statements = ((json as { statements: unknown[] }).statements).filter((x) => {
    if (!x || typeof x !== "object") return true;
    const st = x as { person?: unknown; text?: unknown };
    const person = matchMember(household, typeof st.person === "string" ? st.person : null);
    if (person) return !others(person);
    const named = membersNamedIn(household, typeof st.text === "string" ? st.text : "");
    return !(named.length && named.every((n) => others(n)));
  });
  const bottomLine = (json as { bottomLine?: unknown }).bottomLine;
  return { ...(json as object), statements, ...(typeof bottomLine === "string" ? { bottomLine: onlyAbout(bottomLine, allowed, household) } : {}) };
}
/** The sentences of a text that name no member, or at least one allowed member. */
function onlyAbout(text: string, allowed: ReadonlySet<string>, household: Household): string {
  return sentencesOf(text).filter((s) => { const named = membersNamedIn(household, s); return !named.length || named.some((n) => allowed.has(n)); }).join(" ");
}
/** The checked answer kept to the people the turn is about: a card or point for another member goes, and so do bottom-line
 * sentences naming only other members. Returns what was left out (kept with the turn's report). */
export function keepAnswerToSubjects(answer: { statements?: { personName?: string | null; text: string; amount?: unknown }[]; bottomLine?: string | null; summary?: string }, subjects: Subjects, household: Household): string[] {
  if (!subjects.people) return [];
  const allowed = new Set(subjects.people);
  const out: string[] = [];
  const members = new Set(household.members.map((m) => m.name.replace(/\s*\([^)]*\)\s*$/, "").trim()));
  answer.statements = (answer.statements ?? []).filter((st) => {
    const person = st.personName && members.has(st.personName) ? st.personName : st.personName ? matchMember(household, st.personName) : null;
    const named = person ? [person] : membersNamedIn(household, st.text);
    const keep = !named.length || named.some((n) => allowed.has(n));
    if (!keep) out.push(st.text);
    return keep;
  });
  for (const key of ["bottomLine", "summary"] as const) {
    const text = answer[key];
    if (typeof text !== "string" || !text) continue;
    const kept = onlyAbout(text, allowed, household);
    if (kept !== text) { if (key === "bottomLine") out.push(text); answer[key] = kept || "Here is what your documents say."; }
  }
  return out;
}

/** Who "my husband" or "my wife" is, when the documents settle it (lib/simple-chat/library spouseMeant). The latest
 * mention counts: the message, then earlier turns newest first (TE S4). */
function spouseNote(household: Household, said: string[]): string {
  const meant = spouseMeant(household, said);
  return meant ? `("${meant.word}" is ${meant.member}: the documents print "${meant.printed}".) ` : "";
}

/** The answer when the household has no documents yet: what to do, with no model call and no figures. */
export const NO_DOCUMENTS_ANSWER = {
  bottomLine: "There are no documents in your household yet, so there is nothing to answer from.",
  statements: [],
  nextSteps: ["Upload a policy, schedule or certificate on the Documents page, then ask again."],
  question: null,
};

/** Said after the question when the model is asked again for each person's own figures (asksWhoseOnly). */
export const EACH_PERSON_NOTE = " (The household has not said whose this is, and the chat is for no one in particular. Give each member's own figures that the documents show for this, each in its own amount statement naming that member as its person and quoting that member's own document, never one member's figure under another's name; then ask whose it is.)";
/** Figures the household would see: statements that carry an amount. */
export function shownAmounts(answer: { statements?: { amount?: unknown }[] }): number {
  return (answer.statements ?? []).filter((s) => s.amount).length;
}
/** Words that ask who is meant: "whose", "who", "which of you" (closed list). */
const ASKS_WHO = /\b(?:whose|who|whom|which\s+(?:of\s+(?:you|them|the)\b|person|member|adult|child))/i;
/** Whether a checked answer only asks whose it is: the chat is for no one in particular (no member chosen, no spouse the
 * documents settle), more than one member has a document linked to them (with one, there is only one member's figures to
 * give, and asking again only costs time: EFF-20261115-02, CL3), the message names no member ("I", or no one), and the
 * answer shows no figure but asks who is meant, by "whose"/"who" or by naming two members. General: no name or product is
 * written here. */
export function asksWhoseOnly(answer: { statements?: { amount?: unknown }[]; questions?: { text: string }[] }, message: string, household: Household, personSettled: boolean): boolean {
  if (personSettled || namesSomeone([message], household)) return false;
  // A member's name may carry their preferred name ("Tan Boon Huat (Ben)"); documents are linked by the name before it.
  const linked = (name: string) => household.documents.some((d) => (d.linkedPeople ?? []).includes(name.replace(/\s*\([^)]*\)\s*$/, "")));
  if (household.members.filter((m) => linked(m.name)).length < 2) return false;
  if (shownAmounts(answer) > 0) return false;
  return asksWho(answer, household);
}
/** Whether an answer's question asks who is meant: "whose"/"who", or naming two members. */
function asksWho(answer: { questions?: { text: string }[] }, household: Household): boolean {
  const question = (answer.questions ?? []).map((q) => q.text).join(" ");
  if (!question) return false;
  const named = household.members.filter((m) => namesSomeone([question], { ...household, members: [m] }));
  return ASKS_WHO.test(question) || named.length >= 2;
}

export async function runSimpleChat(context: ChatContext, opts: { check?: () => Promise<void>; jobId?: string } = {}, deps: SimpleDeps = {}): Promise<ChatResult> {
  const { request, conversation } = context;
  const message = request.submittedQuestion ?? request.question;
  const model = deps.model ?? modelFromChoice(simpleChatModel());
  const ledger = deps.ledger ?? !deps.model;
  const loadStarted = Date.now();
  // The spend check, the library, the conversation and the benefit table are read side by side: a person is waiting.
  const [, household, heard, live] = await Promise.all([
    ledger ? assertUnderSpendCap(request.accountId) : null,
    (deps.household ?? loadHousehold)(request.accountId),
    deps.history ? deps.history(request.accountId, conversation.id) : conversationTurns(request.accountId, conversation.id, supersededAnswerIds(conversation.state)),
    deps.table ? Promise.all([deps.table(request.accountId), deps.tableStates?.(request.accountId) ?? null]).then(([table, states]) => table ? { table, states: states ?? new Map<string, string>() } : null) : liveTable(request.accountId),
  ]);
  const table = live?.table ?? null;
  if (household.accountId !== request.accountId) throw new Error("The library read is for another household; refusing to answer");
  const rows = table ? chatRows(table, household) : null;
  const now = (deps.today ?? (() => new Date()))();
  const started = Date.now();
  const loadMs = started - loadStarted;
  let reply: Awaited<ReturnType<SimpleModel["call"]>> | null = null;
  // A question about DearPolicy itself gets its fixed answer, with no model call (lib/simple-chat/app-help).
  const help = appHelp(message, household.documents.flatMap((d) => [d.insurer ?? "", d.productName ?? ""]));
  // Who this turn is about, from the household's own messages: a replacement, an addition, a new question or the same
  // people (lib/simple-chat/subjects.ts). Only these people's figures are shown.
  // The answer just before ended with a question: a reply in a replacement's shape may answer it (subjects.ts, R4-3, N5-1).
  const lastAnswer = [...heard].reverse().find((t) => t.role === "assistant");
  const lastLine = lastAnswer?.text.trim().split("\n").pop() ?? "";
  const askedBefore = /\?\s*$/.test(lastLine) ? lastLine : null;
  const subjects = resolveSubjects(household, [message, ...heard.filter((t) => t.role === "user").map((t) => t.text).reverse()], { askedBefore });
  // The earlier answers this turn's correction replaces are not read back to the model with their figures either.
  const prior = conversation.state as SimpleChatState;
  const replacedNow = subjects.change === "replace" ? supersededBy(subjects.replaced, prior.simpleChat?.turns ?? [], subjects.kept ?? subjects.people ?? []) : [];
  const history = replacedNow.length ? heard.map((t) => (t.role === "assistant" && t.answerId && replacedNow.includes(t.answerId) ? { role: t.role, text: SUPERSEDED_NOTICE } : t)) : heard;
  const said = [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()];
  // With the table, only the pages its rows come from, and those documents' pages that print a waiting period or an
  // exclusion, are sent with it (about half the cost per question).
  const asking = () => ({ library: renderLibrary(household, rows ? pagesToSend(rows, household) : undefined) + (rows ? renderTable(rows) : ""), withRows: !!rows, history, question: dated(now) + periodsNote(household, now) + datesSaidNote(message, now, claimWindows(household)) + chatFor(context) + subjectsNote(subjects) + spouseNote(household, said) + message });
  if (help) reply = { json: help.answer, stopReason: null, model: `app-help:${help.id}`, usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } };
  // A household with no documents has nothing to answer from: its fixed answer costs no model call (TE main journeys 11 Nov).
  else if (!household.documents.length) reply = { json: NO_DOCUMENTS_ANSWER, stopReason: null, model: "no-documents", usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } };
  // Someone the household does not have: asked who they mean, with no figures and no model call.
  else if (subjects.unknown) reply = { json: unknownPersonAnswer(household, subjects.unknown), stopReason: null, model: "unknown-person", usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 } };
  else try {
    reply = await model.call(asking());
  } finally {
    if (ledger) await recordUsage({ accountId: request.accountId, role: "chat", choice: model.choice, ...(reply ? ledgerUsage(reply.usage, LIBRARY_CACHE_WRITE_RATE) : { input: 0, output: 0, cached: 0 }), durationMs: Date.now() - started, ok: !!reply });
  }
  let modelMs = Date.now() - started;
  // The checks every model reply goes through, in order; a reply asked again (asksWhoseOnly) goes through them all too.
  const checkReply = (json: unknown, fixed: boolean) => {
    // The model's statements for anyone the turn is not about are left out before anything is built from them.
    json = keepToSubjects(json, subjects, household);
    // With the benefit table, every amount is rewritten from the row it names (or dropped) before the usual checks.
    const fromRows: { json: unknown; report: RowReport | null } = rows && !fixed ? amountsFromRows(json, rows, household, now, message, history.filter((t) => t.role === "user").map((t) => t.text).reverse(),
      !context.conversation.family_member_id && asksForNobody([message, ...history.filter((t) => t.role === "user").map((t) => t.text)], household, rows), table ? withheldRows(table, household) : []) : { json: json, report: null };
    const parsed = readModelAnswer(fromRows.json);
    const asked = [message, ...history.filter((t) => t.role === "user").map((t) => t.text).reverse()];
    // Each document's benefit-table state, so a point about whether a file was read says what other answers say of it.
    if (live?.states) for (const d of household.documents) d.tableState = live.states.get(d.policyId) ?? null;
    const { answer, report } = parsed ? verifyAnswer(household, parsed, asked, new Set(fromRows.report?.labels ?? []), fromRows.report?.figures ?? []) : verifyAnswer(household, { bottomLine: NO_ANSWER, statements: [], nextSteps: [], question: null });
    if (fromRows.report && answer.statements) {
      const { kept, refused } = keepLabelledAmounts(answer.statements, fromRows.report);
      // A condition point whose words its card already shows is said once, on the card.
      answer.statements = dropConditionsOnCards(kept, fromRows.report);
      fromRows.report.dropped.push(...refused.map((st) => ({ why: "the amount lost its label to the checks", text: st.text })));
      // A sentence that shuts a person out of a cover their own cards or rows show is left out (live run 22 Oct, C5).
      report.sentencesLeftOut.push(...dropPeopleShutOut(answer, rows!, household, fromRows.report.labels));
      report.sentencesLeftOut.push(...dropAmountPointers(answer, fromRows.report.labels, fromRows.report.dropped.some((d) => !d.notFit)));
      report.sentencesLeftOut.push(...dropAgreeingDayRules(answer, fromRows.report));
      // A promise of the policy's words "quoted below" with no quote of that benefit in the answer goes (TE R3 H2-A t2).
      report.sentencesLeftOut.push(...dropQuotePointers(answer, fromRows.report.labels, [...household.members.map((m) => m.name), ...household.documents.flatMap((d) => [d.productName ?? "", d.insurer ?? ""])], rows!.map((r) => r.benefit)));
      answer.statements = noteLeftOutAmounts(answer.statements, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
      answer.statements = noteNarrowedPages(answer.statements, fromRows.report, (id, text) => ({ id, kind: "uncertainty", text, fullText: text, conditions: [] }));
    }
    // And what the checks built (an owner's label, a card) for anyone the turn is not about goes too.
    report.sentencesLeftOut.push(...keepAnswerToSubjects(answer, subjects, household));
    // An amount from a policy the household said it did not renew for that person never stands as their cover.
    report.sentencesLeftOut.push(...dropNotRenewedAmounts(answer as Parameters<typeof dropNotRenewedAmounts>[0], household,
      context.family.find((f) => f.id === context.conversation.family_member_id)?.display_name ?? null));
    // Amounts shown while some of that person's documents gave nothing: never read as the person's whole cover.
    noteCoverNotCounted(answer, household, live?.states ?? null, new Set(fromRows.report?.premiumLabels ?? []), new Set(report.filesListed ?? []));
    // Points were given, none survived the checks, and the bottom line introduces them: the answer says so, never a bare
    // introduction to nothing. A bottom line that answers on its own stands alone (live run 23 Oct, E2).
    if (parsed?.statements.length && !(answer.statements ?? []).length && INTRODUCES.test(answer.bottomLine ?? answer.summary ?? "")) answer.statements = [{ id: "nothing-shown", kind: "uncertainty", text: NOTHING_SHOWN, fullText: NOTHING_SHOWN, conditions: [] }];
    return { fromRows, parsed, answer, report };
  };
  let checked = checkReply(reply.json, !!help);
  // A question that says "I" or names no one, in a chat for nobody, answered with only "whose is it?" and no figure (TE
  // EFF-20261115-01, SG1): the model is asked once more for each person's own figures, each labelled with its person,
  // then whose it is. That reply goes through every check above, and is kept only when a figure survives them and it
  // still asks who is meant; otherwise the first answer stands. A failed second call never fails the turn.
  // Like the first call, the second is made only while the job is still wanted (a cancel or a deleted chat ends the turn
  // before it is paid for: gate #503 ASK-M1) and the household is under its spend cap (checked again, since the first
  // call may have crossed it; an unreadable ledger skips the call: ASK-H1).
  let eachPerson: { model: string; usage: ReturnType<typeof ledgerUsage>; kept: boolean; skipped?: "spend cap" } | null = null;
  // Not for a fixed answer (no documents, someone the household does not have), and not when the turn's people are settled.
  if (reply.model !== "no-documents" && reply.model !== "unknown-person" && !help && asksWhoseOnly(checked.answer, message, household, !!context.conversation.family_member_id || subjects.people !== null || spouseNote(household, said) !== "")) {
    await opts.check?.();
    if (ledger && await overSpendCap(request.accountId).catch(() => true)) eachPerson = { model: "", usage: ledgerUsage({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, LIBRARY_CACHE_WRITE_RATE), kept: false, skipped: "spend cap" };
    else {
      const again = Date.now();
      let second: Awaited<ReturnType<SimpleModel["call"]>> | null = null;
      try {
        const ask = asking();
        second = await model.call({ ...ask, question: ask.question + EACH_PERSON_NOTE });
      } catch {
        second = null;
      } finally {
        if (ledger) await recordUsage({ accountId: request.accountId, role: "chat", choice: model.choice, ...(second ? ledgerUsage(second.usage, LIBRARY_CACHE_WRITE_RATE) : { input: 0, output: 0, cached: 0 }), durationMs: Date.now() - again, ok: !!second });
        modelMs += Date.now() - again;
      }
      if (second) {
        const checkedAgain = checkReply(second.json, false);
        // Kept only with a figure and a question asking who is meant (gate #503 ASK-L1): figures with no such question
        // would read as the answer for the person typing.
        const kept = shownAmounts(checkedAgain.answer) > 0 && asksWho(checkedAgain.answer, household);
        if (kept) checked = checkedAgain;
        eachPerson = { model: second.model, usage: ledgerUsage(second.usage, LIBRARY_CACHE_WRITE_RATE), kept };
      }
    }
  }
  const { fromRows, answer, report } = checked;
  // The answer, not the checks behind it: notes that only narrate a check are taken out (the checks still ran, and what
  // they left out stays in the turn's report).
  // Rows of a printed figures table are shown as a table, not as quoted strings.
  if (answer.statements) answer.statements = tablesFromPrintedRows(answer.statements, household, (d) => docLabel(household, d));
  const fragments = dropQuoteFragments(answer);
  report.sentencesLeftOut.push(...fragments);
  // Every point was a cut-off quote and the bottom line introduces them: the answer says nothing was shown, never a bare
  // introduction to nothing (Critic #546 LOW-3; the same rule as after the checks).
  if (fragments.length && !(answer.statements ?? []).length && INTRODUCES.test(answer.bottomLine ?? answer.summary ?? "")) answer.statements = [{ id: "nothing-shown", kind: "uncertainty", text: NOTHING_SHOWN, fullText: NOTHING_SHOWN, conditions: [] }];
  report.sentencesLeftOut.push(...declutterAnswer(answer));
  // An overview's bottom line that names three or more things becomes its subject and a list (DC, 18 Nov 2026).
  report.sentencesLeftOut.push(...listFromBottomLine(answer, { names: household.members.map((m) => m.name), aboutDocuments: aboutLibrary(message),
    products: household.documents.filter((d) => !d.supersededAt && !NO_COVER_READING_ROLES.includes(d.documentRole ?? "")).map((d) => d.productName ?? "") }));
  // A question about what is not covered, answered for one policy among several: the others that print exclusions are named.
  if (reply.model !== "no-documents" && reply.model !== "unknown-person") {
    const text = [answer.bottomLine, answer.summary, ...(answer.statements ?? []).flatMap((st) => [st.text, st.fullText])].filter((x): x is string => typeof x === "string").join(" ");
    // Whose the answer is: the chat's own person. A message that may name anyone else, or a turn narrowed to people, gets
    // no note: it never guesses whose policies are meant. Nobody named in a whole-family chat means everyone.
    const scoped = context.family.find((f) => f.id === context.conversation.family_member_id)?.display_name ?? null;
    const named = membersMentioned(household, message).filter((n) => !scoped || !samePerson(n, scoped));
    const narrowed = named.length > 0 || !!subjects.people?.length;
    // Only on an answer that says something: never beside a "could not tell".
    const says = (answer.statements ?? []).some((st) => st.kind !== "uncertainty");
    const others = says && !narrowed ? otherExclusionsNote(household, message, text, (d) => docLabel(household, d), scoped ? [scoped] : null) : null;
    if (others) answer.statements = [...(answer.statements ?? []), { id: OTHER_EXCLUSIONS_ID, kind: "uncertainty", text: others, fullText: others, conditions: [] }];
  }
  // How to reach the insurer, as the household's own documents print it, when the answer gives next steps or is about
  // claiming. Read by the server from the stored pages; never the model's words.
  if (reply.model !== "no-documents" && reply.model !== "unknown-person" && contactsHelp(answer, message)) {
    const contacts = insurerContactsFor(household, answer, (d) => docLabel(household, d), message);
    if (contacts.length) answer.insurerContacts = contacts;
  }
  answer.conversationId = conversation.id;
  answer.conversationRevision = conversation.revision + 1;
  enforceLiveChatMonetaryBoundary(answer, { claimContext: false });
  report.sentencesLeftOut.push(...dropLateClaims(answer, now, fromRows.report?.labels ?? []));
  maskIdentityNumbers(answer);
  // What the server left out is kept with the turn: an identity number in it is masked too.
  maskIdentityNumbers(report);
  if (fromRows.report) maskIdentityNumbers(fromRows.report);
  answer.answerId = randomUUID();
  const shownFor = [...new Set((answer.statements ?? []).flatMap((st) => st.amount && st.personName ? [st.personName] : []))];
  // Where the time went (kept with the turn, no household text): reading the library and table, the model, the checks.
  const timing = { loadMs, modelMs, checkMs: Date.now() - started - modelMs };
  const turns = [...(prior.simpleChat?.turns ?? []), { model: reply.model, usage: ledgerUsage(reply.usage, LIBRARY_CACHE_WRITE_RATE), ms: Date.now() - started, timing, ...(eachPerson ? { eachPerson } : {}), answerId: answer.answerId, people: shownFor, subjects: subjects.people, report: fromRows.report ? { ...report, dropped: [...fromRows.report.dropped.map((d) => ({ kind: "amount", ...d })), ...report.dropped] } : report }].slice(-12);
  // A replacement ("actually it's Daniel, not Grace") makes the earlier answers with the replaced person's figures out of
  // date: reopening the chat shows them as replaced by this one (lib/chat/stale-answers.ts).
  const superseded = [...new Set([...(prior.simpleChat?.superseded ?? []), ...replacedNow])].slice(-200);
  const next: SimpleChatState = { ...prior, intent: "policy_question", simpleChat: { turns, ...(superseded.length ? { superseded } : {}) } };
  delete next.pending;
  await opts.check?.();
  await (deps.save ?? saveTurn)({ conversation, token: context.token, state: next, message, answer, jobId: opts.jobId });
  return { answer, retrieved: [] };
}
