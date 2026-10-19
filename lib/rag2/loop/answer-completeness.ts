/**
 * Answer completeness (dj-live-3, 19 Oct 2026): two pure rules the conversation loop applies to BOTH of its ways of ending a
 * turn (final_answer and ask_user).
 *
 * 1. Would asking for an event's exact DATE help answer the current request?
 *    Two separate things are kept apart:
 *      (a) whether ANOTHER date question helps now: it does when no date was given, when a cited clause counts a period from the
 *          event ("within 365 days of the Accident") or limits cover in time ("cover ends ..."), or when a date the documents
 *          print is not before the start of the household's window;
 *      (b) whether cover on the event date is ESTABLISHED: that is never decided here. A dated certificate is evidence of its
 *          dated value only; the answer keeps "cover on the date of death is not established" whatever the date turns out to be.
 *    When (a) is "no", the clarification is DEFERRED, not declared irrelevant: the answer gives what the documents say now, says
 *    it has not asked for the day, and keeps (b) open. Nothing here bans a date question.
 *    The household's words are kept as they said them ("last week") together with the message's date; they are never turned
 *    into one exact day. A window is derived ONLY to compare with printed dates, by this convention (tested at its boundaries):
 *    calendar days of the household's time zone (HOUSEHOLD_TZ, Asia/Singapore: the product's documents are Singapore policies;
 *    the zone is a documented default, not read from the request); "last week" = 13 days before through 1 day before the
 *    message's local date, the widest span of the two readings (the previous calendar week, the past seven days), so it is a
 *    conservative bound and never shown as a date; "yesterday" = 1 day before; "N days ago" = N days before, +/-1 day
 *    ("N weeks ago": +/-3 days); "last month" = the previous calendar month through yesterday.
 *
 * 2. When the household asks what to do, the supported practical step (contact the insurer of the person's own policy
 *    document) is part of the reply, ahead of any remaining question. That step is a suggestion to ask the insurer; what a
 *    document prints about claims stays in the cited statements. No deadline, form or contact detail is ever added here.
 */

export type DateRange = { from: string; to: string; words: string; exact: boolean };

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = (d: Date) => d.toISOString().slice(0, 10);
/** The calendar zone a household's relative words are read in (a documented default; see the header). */
export const HOUSEHOLD_TZ = "Asia/Singapore";
/** The message's calendar day in `tz`, as a UTC-midnight Date so day arithmetic is plain. */
export function localDay(now: Date, tz: string = HOUSEHOLD_TZ): Date {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
}
const day = (now: Date, offset: number, tz: string = HOUSEHOLD_TZ) => { const l = localDay(now, tz); return iso(new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + offset))); };
/** "19 October 2026" -- the message's own date, as said back to the household. */
export function messageDateText(now: Date, tz: string = HOUSEHOLD_TZ): string { const l = localDay(now, tz); return `${l.getUTCDate()} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][l.getUTCMonth()]} ${l.getUTCFullYear()}`; }
const monthWord = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const valid = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? iso(t) : null; };

/** The date range a phrase of the household's names, relative to `now` (a day-first reading for numeric dates, as the documents print them). */
export function eventDateRange(text: string, now: Date, tz: string = HOUSEHOLD_TZ): DateRange | null {
  const t = text.replace(/[’‘]/g, "'");
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) { const v = valid(+m[1], +m[2] - 1, +m[3]); if (v) return { from: v, to: v, words: m[0], exact: true }; }
  if ((m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${monthWord}[a-z]*\.?(?:,?\s+(\d{4}))?\b`, "i").exec(t))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; const y = m[3] ? +m[3] : localDay(now, tz).getUTCFullYear();
    const v = valid(y, mo, +m[1]); if (v) return { from: v, to: v, words: m[0], exact: true };
  }
  if ((m = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(t))) { const v = valid(+m[3], +m[2] - 1, +m[1]); if (v) return { from: v, to: v, words: m[0], exact: true }; }
  if (/\byesterday\b/i.test(t)) return { from: day(now, -1, tz), to: day(now, -1, tz), words: "yesterday", exact: false };
  if (/\blast night\b/i.test(t)) return { from: day(now, -1, tz), to: day(now, 0, tz), words: "last night", exact: false };
  if (/\btoday\b|\bthis morning\b/i.test(t)) return { from: day(now, 0, tz), to: day(now, 0, tz), words: "today", exact: false };
  // "last week": the previous calendar week or the past seven days -- the union of both readings, never one exact day.
  if (/\blast week\b/i.test(t)) return { from: day(now, -13, tz), to: day(now, -1, tz), words: "last week", exact: false };
  if ((m = /\b(\d{1,2}|a|one|two|three|four|five|six)\s+(day|week)s?\s+ago\b/i.exec(t))) {
    const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 } as Record<string, number>)[m[1].toLowerCase()] ?? +m[1];
    const days = /week/i.test(m[2]) ? n * 7 : n; const slack = /week/i.test(m[2]) ? 3 : 1;
    return { from: day(now, -days - slack, tz), to: day(now, -days + slack, tz), words: m[0], exact: false };
  }
  if (/\blast month\b/i.test(t)) { const l = localDay(now, tz); const first = new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() - 1, 1)); return { from: iso(first), to: day(now, -1, tz), words: "last month", exact: false }; }
  return null;
}

/** The date a household gives for an event, read in the clause around the event's own word ("passed away last week after ..."). */
export function dateNearEvent(texts: string[], eventWords: RegExp, now: Date, tz: string = HOUSEHOLD_TZ): DateRange | null {
  for (const text of [...texts].reverse()) {
    for (const m of text.matchAll(new RegExp(eventWords.source, "gi"))) {
      const at = m.index ?? 0;
      let after = text.slice(at, at + 90); const end = after.search(/[.;!?](?:\s|$)/); if (end > 0) after = after.slice(0, end);
      let before = text.slice(Math.max(0, at - 60), at); const cut = before.search(/[.;!?]\s[^.;!?]*$/); if (cut >= 0) before = before.slice(cut + 1);
      const r = eventDateRange(after, now, tz) ?? eventDateRange(before, now, tz);
      if (r) return r;
    }
  }
  return null;
}

/** A clause that counts a period from the event or limits cover in time: its dates are decisive whatever the household said. */
export const PERIOD_CLAUSE = /\bwithin\s+\d+\s*(?:calendar\s+)?(?:days?|weeks?|months?|years?|hours?)\b|\b\d+\s*(?:days?|months?|years?)\s+(?:of|from|after|before)\b|\bcover\s+(?:for\s+[^.]{0,40}\s+)?(?:ends|starts|begins|ceases|commences)\b|\bperiod of (?:insurance|cover)\b|\bin force\b|\bceases?\s+(?:on|at|when)\b|\bexpir\w+\b|\bage\s+(?:limit|\d+)\b|\bwaiting period\b|\bwithin\s+(?:a|the)\s+(?:period|time)\b/i;

export type DateVerdict = { needed: boolean; reason: string };

/**
 * Would asking for the exact date help answer the current request (see the header: part (a))?
 *  - the date is not given at all, or a cited clause counts a period / limits cover in time: yes;
 *  - the date is given as a window: yes when a date the documents print is not before the start of that window;
 *  - otherwise the question is DEFERRED (needed=false): nothing the documents print is compared with the date, so the answer
 *    can give what they say now. This never says cover on that date is established, or that the date cannot matter.
 */
export function dateQuestionVerdict(a: { range: DateRange | null; clauses: string[]; printed: string[] }): DateVerdict {
  const r = a.range;
  if (!r) return { needed: true, reason: "the household has not given any date" };
  if (r.exact) return { needed: false, reason: `the household already gave the date (${r.words})` };
  const period = a.clauses.find((c) => PERIOD_CLAUSE.test(c));
  if (period) return { needed: true, reason: "a cited clause counts a period from the event or limits cover in time" };
  const dates = a.printed.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const late = dates.filter((d) => d >= r.from);
  if (late.length) return { needed: true, reason: `a date the documents print (${late[0]}) is not before the start of “${r.words}” (${r.from} to ${r.to})` };
  return { needed: false, reason: `deferred: “${r.words}” (window ${r.from} to ${r.to}, ${HOUSEHOLD_TZ} calendar days) is after ${dates.length ? "every date the documents print (" + [...new Set(dates)].join(", ") + ")" : "any date the documents print (they print none)"} and no cited clause counts a period from the event, so the exact day is not needed to say what the documents say now; cover on that date stays unestablished` };
}

/** What the answer says when it defers the exact-date question: the household's words and the message date kept, no exact day
 * invented, the question not asked NOW (not declared irrelevant), cover on the date of death left open. */
export function deferredDateNote(words: string, now: Date, tz: string = HOUSEHOLD_TZ): string {
  return `You told me the death was \u201c${words}\u201d (your message is dated ${messageDateText(now, tz)}, ${tz === "Asia/Singapore" ? "Singapore time" : tz}); I have not turned that into an exact day. I have not asked for one now: no clause I read counts a period from the death, so it would not change what I can tell you from these documents today. Cover on the date of death is still not established.`;
}

/** "...and what should we do?": the household asks for practical steps. */
export const ASKS_WHAT_TO_DO = /\bwhat\s+(?:should|do|can|must|shall|are)\s+(?:we|i|the family|they|you)\s+(?:now\s+)?(?:do|be doing|need to do|have to do)\b|\bwhat\s+(?:to\s+do|now|next|happens next)\b|\bwhat(?:'s| is)\s+(?:the\s+)?next\s+step\b|\bnext\s+steps?\b|\bhow\s+(?:do|should|can|would)\s+(?:we|i)\s+(?:claim|proceed|go about|start|begin|make a claim)\b|\bwhere\s+(?:do|should)\s+(?:we|i)\s+(?:start|begin)\b|\bwho\s+(?:do|should)\s+(?:we|i)\s+(?:contact|call|speak to|tell|notify)\b|\bwhat\s+(?:do|should)\s+(?:we|i)\s+do\b/i;
export const asksWhatToDo = (message: string) => ASKS_WHAT_TO_DO.test(message.replace(/[’‘]/g, "'"));

/** A next step that already tells the household to contact an insurer (rendered text, or the contact:<policy> marker). */
export const isContactStep = (s: unknown) => typeof s === "string" && (/^\s*contact:\s*\S+\s*$/i.test(s) || /^\s*(?:contact|call|phone|email|write to|get in touch with|speak to)\b/i.test(s));
