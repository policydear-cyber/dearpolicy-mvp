/**
 * Answer completeness (dj-live-3, 19 Oct 2026): two pure rules the conversation loop applies to BOTH of its ways of ending a
 * turn (final_answer and ask_user).
 *
 * 1. Does the question about an event's DATE change anything the uploaded wording says?
 *    A date question is relevant when the wording makes the date decisive: a clause counts a period from the event ("within 365
 *    days of the Accident"), limits cover in time ("cover ends ..."), or a date the documents print could fall on either side of
 *    it (an effective date, an "as of" date). The household's own words are kept as the uncertainty they are: "last week" is a
 *    RANGE of days, never turned into one exact day, and it is compared with every printed date. When the range lies wholly
 *    after every date the documents print and no cited clause counts a period from the event, an exact day cannot change what
 *    the wording says, so the answer does not wait for it. Nothing here bans a date question: no range at all (the date is not
 *    given), a clause with a period, or a printed date inside or after the range keeps the question.
 *
 * 2. When the household asks what to do, the supported practical step (contact the insurer of the person's own policy
 *    document) is part of the reply, ahead of any remaining question. That step is a suggestion to ask the insurer; what a
 *    document prints about claims stays in the cited statements. No deadline, form or contact detail is ever added here.
 */

export type DateRange = { from: string; to: string; words: string; exact: boolean };

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (now: Date, offset: number) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset)); return iso(d); };
const monthWord = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const valid = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m && t.getUTCDate() === d ? iso(t) : null; };

/** The date range a phrase of the household's names, relative to `now` (a day-first reading for numeric dates, as the documents print them). */
export function eventDateRange(text: string, now: Date): DateRange | null {
  const t = text.replace(/[’‘]/g, "'");
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) { const v = valid(+m[1], +m[2] - 1, +m[3]); if (v) return { from: v, to: v, words: m[0], exact: true }; }
  if ((m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${monthWord}[a-z]*\.?(?:,?\s+(\d{4}))?\b`, "i").exec(t))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; const y = m[3] ? +m[3] : now.getUTCFullYear();
    const v = valid(y, mo, +m[1]); if (v) return { from: v, to: v, words: m[0], exact: true };
  }
  if ((m = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(t))) { const v = valid(+m[3], +m[2] - 1, +m[1]); if (v) return { from: v, to: v, words: m[0], exact: true }; }
  if (/\byesterday\b/i.test(t)) return { from: day(now, -1), to: day(now, -1), words: "yesterday", exact: false };
  if (/\blast night\b/i.test(t)) return { from: day(now, -1), to: day(now, 0), words: "last night", exact: false };
  if (/\btoday\b|\bthis morning\b/i.test(t)) return { from: day(now, 0), to: day(now, 0), words: "today", exact: false };
  // "last week": the previous calendar week or the past seven days -- the union of both readings, never one exact day.
  if (/\blast week\b/i.test(t)) return { from: day(now, -13), to: day(now, -1), words: "last week", exact: false };
  if ((m = /\b(\d{1,2}|a|one|two|three|four|five|six)\s+(day|week)s?\s+ago\b/i.exec(t))) {
    const n = ({ a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 } as Record<string, number>)[m[1].toLowerCase()] ?? +m[1];
    const days = /week/i.test(m[2]) ? n * 7 : n; const slack = /week/i.test(m[2]) ? 3 : 1;
    return { from: day(now, -days - slack), to: day(now, -days + slack), words: m[0], exact: false };
  }
  if (/\blast month\b/i.test(t)) { const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); return { from: iso(first), to: day(now, -1), words: "last month", exact: false }; }
  return null;
}

/** The date a household gives for an event, read in the clause around the event's own word ("passed away last week after ..."). */
export function dateNearEvent(texts: string[], eventWords: RegExp, now: Date): DateRange | null {
  for (const text of [...texts].reverse()) {
    for (const m of text.matchAll(new RegExp(eventWords.source, "gi"))) {
      const at = m.index ?? 0;
      let after = text.slice(at, at + 90); const end = after.search(/[.;!?](?:\s|$)/); if (end > 0) after = after.slice(0, end);
      let before = text.slice(Math.max(0, at - 60), at); const cut = before.search(/[.;!?]\s[^.;!?]*$/); if (cut >= 0) before = before.slice(cut + 1);
      const r = eventDateRange(after, now) ?? eventDateRange(before, now);
      if (r) return r;
    }
  }
  return null;
}

/** A clause that counts a period from the event or limits cover in time: its dates are decisive whatever the household said. */
export const PERIOD_CLAUSE = /\bwithin\s+\d+\s*(?:calendar\s+)?(?:days?|weeks?|months?|years?|hours?)\b|\b\d+\s*(?:days?|months?|years?)\s+(?:of|from|after|before)\b|\bcover\s+(?:for\s+[^.]{0,40}\s+)?(?:ends|starts|begins|ceases|commences)\b|\bperiod of (?:insurance|cover)\b|\bin force\b|\bceases?\s+(?:on|at|when)\b|\bexpir\w+\b|\bage\s+(?:limit|\d+)\b|\bwaiting period\b|\bwithin\s+(?:a|the)\s+(?:period|time)\b/i;

export type DateVerdict = { needed: boolean; reason: string };

/**
 * Is the exact date needed to read the cited wording?
 *  - the date is not given at all, or a cited clause counts a period / limits cover in time: needed;
 *  - the date is given as a range: needed when a date the documents print could fall on or after the start of that range
 *    (the death may predate it); not needed when every printed date lies before the whole range.
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
  return { needed: false, reason: `“${r.words}” (${r.from} to ${r.to}) lies after ${dates.length ? "every date the documents print (" + dates.join(", ") + ")" : "any date the documents print (they print none)"} and no cited clause counts a period from the event: an exact day would not change what the wording says` };
}

/** "...and what should we do?": the household asks for practical steps. */
export const ASKS_WHAT_TO_DO = /\bwhat\s+(?:should|do|can|must|shall|are)\s+(?:we|i|the family|they|you)\s+(?:now\s+)?(?:do|be doing|need to do|have to do)\b|\bwhat\s+(?:to\s+do|now|next|happens next)\b|\bwhat(?:'s| is)\s+(?:the\s+)?next\s+step\b|\bnext\s+steps?\b|\bhow\s+(?:do|should|can|would)\s+(?:we|i)\s+(?:claim|proceed|go about|start|begin|make a claim)\b|\bwhere\s+(?:do|should)\s+(?:we|i)\s+(?:start|begin)\b|\bwho\s+(?:do|should)\s+(?:we|i)\s+(?:contact|call|speak to|tell|notify)\b|\bwhat\s+(?:do|should)\s+(?:we|i)\s+do\b/i;
export const asksWhatToDo = (message: string) => ASKS_WHAT_TO_DO.test(message.replace(/[’‘]/g, "'"));

/** A next step that already tells the household to contact an insurer (rendered text, or the contact:<policy> marker). */
export const isContactStep = (s: unknown) => typeof s === "string" && (/^\s*contact:\s*\S+\s*$/i.test(s) || /^\s*(?:contact|call|phone|email|write to|get in touch with|speak to)\b/i.test(s));
