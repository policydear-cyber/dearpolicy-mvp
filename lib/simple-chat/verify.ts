/** The server's checks on the simple chat's answer, before anything is shown. Pure: it reads only the household's
 * library (lib/simple-chat/library.ts) and the model's JSON (lib/simple-chat/prompt.ts).
 *
 * 1. Sources come from the stored pages, never from the model's own page numbers: each quote is found in the stored
 *    page text, and the document and page shown are where it was found (Evidence Reviewer, 20 Oct 2026: the baseline
 *    cited the wrist row as page 12 when it is on page 13).
 * 2. Amounts appear only on cards the server builds: a currency-signed figure printed in the quote, or a percentage the
 *    quote prints of the sum its own table heading prints on that page, or a "% of Sum Insured" row worked out on the
 *    person's own printed sum insured for that same cover (both shown as illustrations). A quote that cannot be found drops
 *    its amount or fact.
 * 3. The model's own sentences carry no money at all (Critic round 39): any sentence of the bottom line, a card's text, a
 *    condition, a next step or the question that states money is left out. So nothing it writes can add amounts together
 *    or give a range (release-set C2), however it is worded.
 * 4. Alternatives are drawn as either/or only when they come from one document for one person; amounts from different
 *    documents are always separate cards.
 * 5. A condition is kept only when its own quoted words are printed in the statement's document (release-set B1: a
 *    condition from one document must not be put on another document's row).
 * 6. At most one question back (release-set B2, B5): only the first question in "question" is kept, and questions written
 *    anywhere else are left out. */
import type { ChatAnswer, ChatCitation, ChatQuestion } from "@/types";
import type { AnswerStatement, StructuredAnswer } from "@/components/answer-cards";
import { moneyFiguresIn, sentencesOf } from "@/lib/chat/answer-verification";
import { documentId, unreadable, type Household, type HouseholdDocument } from "./library";
import type { ModelAnswer, ModelStatement } from "./prompt";

export const LEFT_OUT_AMOUNT = "I left out an amount I couldn’t find printed in your documents.";
export const LEFT_OUT_FACT = "I left out a point I couldn’t find in your documents.";
export const NO_ANSWER = "I couldn’t put together an answer from your documents. Please ask again, or ask about one benefit at a time.";
export const ALTERNATIVES_NOTE = "These are alternatives under one benefit in the same document, not a total.";
export const DISCLAIMER = "Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.";

// ------------------------------------------------------------------ finding a quote in the stored pages
/** Text for matching: case, spacing, quote marks and dashes do not count. `at[i]` is where character i came from. */
function squash(s: string): { text: string; at: number[] } {
  let text = ""; const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (/\s/.test(c)) continue;
    if (/[“”„"]/.test(c)) c = "\"";
    else if (/[‘’‚`´]/.test(c)) c = "'";
    else if (/[‐‑‒–—―−]/.test(c)) c = "-";
    text += c.toLowerCase(); at.push(i);
  }
  return { text, at };
}
const fragmentsOf = (quote: string) => quote.split(/\s*(?:\.{3}|…)\s*/).map((f) => squash(f).text).filter((f) => f.length >= 4);

/** Where a quote was found: the document, the stored page, the stored words, and where on the page they start. */
export type Found = { docIndex: number; page: number; excerpt: string; offset: number };

/** Where the quote is printed: every fragment on one page, in order. The model's document is tried first, then the rest. */
export function locateQuote(household: Household, quote: string, preferred: number | null): Found | null {
  // The library is sent with < and > escaped (library.ts); a quote copied from it is read back unescaped.
  const frags = fragmentsOf(quote.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"));
  if (!frags.length) return null;
  const order = household.documents.map((_, i) => i);
  if (preferred != null && preferred >= 0 && preferred < order.length) order.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : a - b));
  for (const di of order) {
    // Text of a file the app could not read is never sent to the model, so nothing may be quoted from it.
    if (unreadable(household.documents[di])) continue;
    for (const page of household.documents[di].pages) {
      const sq = squash(page.text);
      let from = 0, start = -1, end = -1, ok = true;
      for (const f of frags) {
        const i = sq.text.indexOf(f, from);
        if (i < 0) { ok = false; break; }
        if (start < 0) start = i;
        end = i + f.length; from = end;
      }
      if (!ok) continue;
      const excerpt = page.text.slice(sq.at[start], sq.at[end - 1] + 1).replace(/[ \t]+/g, " ").trim();
      return { docIndex: di, page: page.page, excerpt: excerpt.length > 700 ? excerpt.slice(0, 700) + "…" : excerpt, offset: sq.at[start] };
    }
  }
  return null;
}

// ------------------------------------------------------------------ amounts
const CENT = (n: number) => Math.round(n * 100);
const sameValue = (a: number, b: number) => CENT(a) === CENT(b);
/** Every number printed in a text (money or not), as values. */
const numbersIn = (text: string) => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);

type Currency = { sign: string; resolved: boolean };
const SIGN: Record<string, string> = { SGD: "S$", USD: "US$", MYR: "RM", HKD: "HK$", AUD: "A$", EUR: "€", GBP: "£", JPY: "¥", "$": "$" };
/** The currency of an amount, resolved only when the words it rests on print that currency (a bare "$" never is). */
function currencyOf(amountText: string, evidence: string): Currency {
  const f = moneyFiguresIn(amountText)[0];
  const printed = moneyFiguresIn(evidence).map((x) => x.currency);
  const named = /\bSGD\b|S\$|Singapore dollars?/i.test(evidence) ? "SGD" : null;
  if (f && f.currency !== "$") return { sign: SIGN[f.currency] ?? f.currency, resolved: printed.includes(f.currency) || named === f.currency };
  if (printed.includes("SGD") || (named && !printed.some((c) => c !== "$" && c !== "SGD"))) return { sign: "S$", resolved: true };
  return { sign: "$", resolved: false };
}
const formatMoney = (sign: string, value: number) => sign + value.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });

type Base = { found: Found; cover: string; asOf: string | null };
type Checked = { s: ModelStatement; found: Found | null; amount: { value: number; text: string; currencyResolved: boolean; illustration: boolean } | null; person: string | null; note: string | null; base?: Base | null; conditions?: string[] };

const valueOf = (raw: string) => Number(raw.replace(/^[^\d]+/, "").replace(/,/g, ""));

/** Where the row's own line starts and ends: the line holding the first quoted words. */
function rowLine(pageText: string, offset: number): { start: number; end: number; text: string } {
  const start = pageText.lastIndexOf("\n", offset - 1) + 1;
  const e = pageText.indexOf("\n", offset);
  const end = e < 0 ? pageText.length : e;
  return { start, end, text: pageText.slice(start, end) };
}
/** A limit or condition on a percentage that working it out would drop (R50-2): it is then never multiplied. "Greater
 * than 8%" on a burns row is a row label, not a limit (R52-2); "whichever is the greater" is. */
const CAPPED = /\b(?:up\s+to|maximum|max\.?|whichever\s+is\s+(?:the\s+)?(?:lesser|greater|lower|higher)|capped|limit(?:ed)?|subject\s+to|balance)\b/i;
/** The row's own line and the lines that continue it ("15% of Sum Insured" / "or up to S$50,000, whichever is lesser"),
 * up to the next row, bullet or numbered item (R52-1). */
function rowWithContinuation(pageText: string, offset: number): string {
  const row = rowLine(pageText, offset);
  const rest = pageText.slice(row.end + 1).split("\n");
  const more: string[] = [];
  for (const l of rest.slice(0, 3)) {
    if (!l.trim() || /^\s*(?:[•●▪*#^\-–]|\(?[a-z0-9]{1,3}[.)]\s)/i.test(l) || /\t/.test(l)) break;
    more.push(l);
  }
  return [row.text, ...more].join(" ");
}
/** The sum a percentage row is a percentage of (Critic round 50), read only above the row's own line on its page:
 * - the nearest "% of S$5,000" or "Limit: S$5,000" heading gives that sum;
 * - the nearest table heading "(% of Sum Insured)" (in parentheses, as a column heading prints it) gives "sum_insured";
 * - a heading naming another base ("percentage of Comatose State Sum Insured") gives null: never worked out.
 * The row itself may print "100% of Sum Insured" on a short table line with no limit on it. Prose ("will be 15% of the
 * Sum Insured", "100% of the Sum Insured, up to a maximum amount of $400,000") is never a base. */
function rowBase(pageText: string, rowOffset: number): { value: number; raw: string } | "sum_insured" | null {
  const row = rowLine(pageText, rowOffset);
  const above = pageText.slice(0, row.start);
  type Head = { at: number; base: { value: number; raw: string } | "sum_insured" | null };
  const heads: Head[] = [];
  for (const re of [/%\s*of\s*((?:S\$|SGD|US\$|\$)\s?\d[\d,]*(?:\.\d+)?)/gi, /\blimit\s*:?\s*((?:S\$|SGD|US\$|\$)\s?\d[\d,]*(?:\.\d+)?)/gi])
    for (const m of above.matchAll(re)) heads.push({ at: m.index ?? 0, base: { value: valueOf(m[1]), raw: m[1] } });
  for (const m of above.matchAll(/\(\s*%\s*of\s*(?:the\s*)?sum\s*(?:insured|assured)\s*\)/gi)) heads.push({ at: m.index ?? 0, base: "sum_insured" });
  // "percentage of Comatose State Sum Insured", "% of the Benefit Amount": a base this check cannot know.
  for (const m of above.matchAll(/(?:%|percentage|per\s?cent)\s+of\s+(?!(?:the\s+)?sum\s+(?:insured|assured)\b)(?!(?:S\$|SGD|US\$|\$))([A-Za-z][^\n]{0,60}?)\b(?:sum\s+(?:insured|assured)|amount|limit)\b/gi)) heads.push({ at: m.index ?? 0, base: null });
  const nearest = heads.sort((a, b) => b.at - a.at)[0];
  const whole = rowWithContinuation(pageText, rowOffset);
  if (CAPPED.test(whole)) return null;
  if (/\d\s?%\s*of\s*(?:the\s*)?sum\s*(?:insured|assured)\b/i.test(row.text)) {
    // A table line such as "Death due to Accident	100% of Sum Insured" names its own base; it never takes the table's.
    return /\d\s?%\s*of\s*(?:the\s*)?sum\s*(?:insured|assured)\s*$/i.test(row.text.trim()) && row.text.length <= 90 ? "sum_insured" : null;
  }
  if (!nearest) return null;
  return nearest.base;
}

type AmountCheck = { ok: true; amount: NonNullable<Checked["amount"]>; base?: Base } | { ok: false; why: string; asFact?: boolean };

/** A cover's name as headings print it: "GROUP PERSONAL ACCIDENT(POLICY NO. 1)", "BENEFIT 2: GROUP PERSONAL ACCIDENT",
 * and "Group Personal Accident" all read "personal accident". Null for a contents line or a line too long to be a heading. */
function coverName(line: string): string | null {
  // A contents line ("2. Group Personal Accident	7") names a section that starts later, so it is no heading.
  if (/\t\s*\d+\s*$/.test(line)) return null;
  const t = line.replace(/\(\s*(?:group\s+)?policy\s*no[^)]*\)?/gi, " ").replace(/\s+-\s+.*$/, "").replace(/^\s*(?:benefit\s*\d+\s*[:.-]|\d+\.)\s*/i, "").replace(/\t+\d+\s*$/, "");
  const words = t.toLowerCase().replace(/[^a-z& ]+/g, " ").split(/\s+/).filter((w) => w && !["group", "policy", "insurance", "benefit", "benefits"].includes(w));
  return words.length && words.length <= 5 && t.trim().length <= 60 ? words.join(" ") : null;
}
/** The covers a sum-insured document heads its lines with (all-capital lines, such as a certificate's product headings). */
function headingsOf(pageText: string): { line: number; cover: string }[] {
  return pageText.split("\n").flatMap((l, i) => { const letters = l.replace(/[^A-Za-z]/g, ""); const c = letters.length >= 8 && letters === letters.toUpperCase() ? coverName(l) : null; return c ? [{ line: i, cover: c }] : []; });
}
/** Whether a line is a section heading: "BENEFIT 2: GROUP PERSONAL ACCIDENT", an all-capital title ("OUTPATIENT MEDICARE
 * POLICY", "DISABILITY INCOME"), or a standalone line naming a cover. A scheme title line ("MINDEF & MHA GROUP INSURANCE
 * VOLUNTARY SCHEME") names the whole document, not a section. */
function sectionHeading(line: string, covers: Set<string>): string | null {
  const c = coverName(line);
  if (!c || /\bscheme\b/.test(c)) return null;
  if (covers.has(c)) return c;
  const letters = line.replace(/[^A-Za-z]/g, "");
  return /^\s*benefit\s*\d+\s*[:.-]/i.test(line) || (letters.length >= 8 && letters === letters.toUpperCase()) ? `other:${c}` : null;
}
/** The section a table row sits under (R50-4): the last heading, on this page above the row or on an earlier page. Any
 * heading counts, so a later "OUTPATIENT MEDICARE POLICY" ends the personal accident section. */
function sectionOf(doc: HouseholdDocument, page: number, offset: number, covers: Set<string>): string | null {
  let last: string | null = null;
  for (const p of doc.pages) {
    if (p.page > page) break;
    const text = p.page === page ? p.text.slice(0, offset) : p.text;
    for (const l of text.split("\n")) { const h = sectionHeading(l, covers); if (h) last = h; }
  }
  return last;
}
const AS_OF = /\bas\s+of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i;
/** A "% of Sum Insured" row worked out on one person's own sum insured (release-set B1, B4, B5, D3). The base is accepted
 * only when its quote is printed in the household's documents, on a line that names the person and prints that one amount
 * with its currency, under a cover heading that is the same cover the row's table sits under in its own document (BS p8's
 * fracture rows sit under "BENEFIT 2: GROUP PERSONAL ACCIDENT"; the certificate prints "GROUP PERSONAL ACCIDENT" above
 * the person's S$600,000). Anything less keeps the percentage as a fact, never multiplied. */
function sumInsuredBase(st: ModelStatement, found: Found, household: Household, person: string | null): { ok: true; value: number; raw: string; base: Base } | { ok: false; why: string } {
  const po = st.percentOf!;
  if (!person) return { ok: false, why: "a percentage of the sum insured needs the person it is for" };
  if (!po.baseQuote) return { ok: false, why: "no quoted sum insured" };
  const preferred = po.baseDocument ? Number(/^D(\d+)$/i.exec(po.baseDocument.trim())?.[1] ?? NaN) - 1 : null;
  const bf = locateQuote(household, po.baseQuote, Number.isFinite(preferred) ? preferred : null);
  if (!bf) return { ok: false, why: "the quoted sum insured is not in the stored pages" };
  const want = moneyFiguresIn(po.baseAmount)[0];
  const printed = moneyFiguresIn(bf.excerpt);
  if (!want || printed.length !== 1 || !sameValue(printed[0].value, want.value)) return { ok: false, why: "the quoted line does not print that one sum insured with its currency" };
  const bdoc = household.documents[bf.docIndex];
  const page = bdoc.pages.find((p) => p.page === bf.page)!;
  const lines = page.text.split("\n");
  const who = tokens(person);
  // The quoted line itself must name the person and print the amount (R50-3): another person's line never counts.
  const at = page.text.slice(0, bf.offset).split("\n").length - 1;
  const own = lines[at] ?? "";
  const have = new Set(tokens(own));
  if (!who.every((w) => have.has(w)) || !moneyFiguresIn(own).some((f) => sameValue(f.value, want.value))) return { ok: false, why: "the quoted sum insured is not on a line naming the person" };
  const heads = headingsOf(page.text);
  const head = heads.filter((h) => h.line < at).at(-1);
  if (!head) return { ok: false, why: "no cover heading above the sum insured" };
  const section = sectionOf(household.documents[found.docIndex], found.page, found.offset, new Set(heads.map((h) => h.cover)));
  if (section !== head.cover) return { ok: false, why: "the sum insured is for a different cover than the row's table" };
  const d = AS_OF.exec(lines[at]);
  return { ok: true, value: want.value, raw: printed[0].raw ?? po.baseAmount, base: { found: bf, cover: head.cover, asOf: d ? `${d[3]}-${d[2].padStart(2, "0")}-${d[1].padStart(2, "0")}` : null } };
}
/** The amount a statement may show, or why it may not. An amount is a currency-signed figure printed in the quote, or a
 * percentage the quote prints of the sum its own table heading prints on the same page. A percentage of the sum insured is
 * never multiplied: the documents do not tie a benefit row to one of a person's sums insured, so the percentage is shown as
 * a fact and the sum insured as its own printed amount. */
function checkAmount(st: ModelStatement, found: Found, household: Household, person: string | null): AmountCheck {
  const doc = household.documents[found.docIndex];
  if (st.percentOf && st.percentOf.percent > 0) {
    const pct = st.percentOf.percent;
    const page = doc.pages.find((p) => p.page === found.page)!;
    // The percentage must be printed on the row's own line (the first quoted words), not in a later joined passage.
    if (!new RegExp(`(?<![\\d.])${String(pct).replace(".", "\\.")}\\s?(?:%|per\\s?cent)`, "i").test(rowLine(page.text, found.offset).text)) return { ok: false, why: "the percentage is not on the quoted row" };
    const printed = rowBase(page.text, found.offset);
    if (printed === "sum_insured") {
      const b = sumInsuredBase(st, found, household, person);
      if (!b.ok) return { ok: false, why: b.why, asFact: true };
      const cur = currencyOf(b.raw, b.base.found.excerpt);
      const value = Math.round(b.value * pct) / 100;
      return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: true }, base: b.base };
    }
    const base = moneyFiguresIn(st.percentOf.baseAmount)[0]?.value ?? numbersIn(st.percentOf.baseAmount)[0];
    if (!printed || base == null || !sameValue(printed.value, base)) return { ok: false, why: "the sum is not the one this row's table is a percentage of" };
    const cur = currencyOf(printed.raw, page.text);
    const value = Math.round(base * pct) / 100;
    return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: true } };
  }
  const raw = (st.amount ?? "").trim();
  const figures = moneyFiguresIn(raw);
  const plain = numbersIn(raw);
  // One figure per amount: "S$1,250 to S$2,000" is a range, never an amount.
  if (figures.length > 1 || plain.length > 1) return { ok: false, why: "an amount must be one figure" };
  const value = figures[0]?.value ?? plain[0];
  if (value == null) return { ok: false, why: "no amount given" };
  // Only a figure printed with its currency sign counts: a percentage, a count, a plan number or a code never does.
  if (!moneyFiguresIn(found.excerpt).some((f) => sameValue(f.value, value))) return { ok: false, why: "the amount is not printed with its currency in the quoted words" };
  const cur = currencyOf(raw, found.excerpt);
  return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: false } };
}

// ------------------------------------------------------------------ people
const tokens = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, (m) => " " + m.slice(1, -1) + " ").split(/[^\p{L}]+/u).filter((t) => t.length > 1);
const baseName = (member: string) => member.replace(/\s*\([^)]*\)\s*$/, "").trim();
/** The household member a name means (all its words in the member's name), or null when none or several fit. */
export function matchMember(household: Household, person: string | null): string | null {
  if (!person?.trim()) return null;
  const want = tokens(person);
  if (!want.length) return null;
  const hits = household.members.filter((m) => { const have = new Set(tokens(m.name)); return want.every((w) => have.has(w)); });
  return hits.length === 1 ? baseName(hits[0].name) : null;
}

// ------------------------------------------------------------------ the written answer carries no money
/** Whether a sentence states money: a figure with a currency, a number with "dollars", or a number with thousands
 * separators. Amounts are shown only on the server's cards, so no sentence the model wrote may carry one -- which is
 * what keeps it from adding amounts or giving a range, whatever words it uses. */
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
/** Dates are not amounts: they are taken out before a sentence is read for money. */
const DATES = new RegExp(String.raw`\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}\s+\d{4}\b|\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b|\b${MONTH}\s+\d{4}\b`, "gi");
/** What may follow a number of 100 or more without it being money: a percentage or a length of time. */
const YEAR_BEFORE = new RegExp(String.raw`(?:\b(?:in|since|from|until|by|before|after|of)|\b${MONTH})\s+(?:the\s+)?$`, "i");
const RATE_OR_TIME = /^\s*(?:%|per\s?cent|percent|(?:calendar\s+)?(?:days?|nights?|weeks?|months?|years?|hours?|minutes?)\b)/i;
/** Whether a sentence states money, in any form (Critic round 40): a figure with a currency; "dollars"; a number with k, m,
 * mn, million, thousand, grand or bn after it; the words hundred, thousand, million, billion or grand; or any number of 100
 * or more that is not a percentage, a length of time, a page number, a year or part of a date. Amounts are shown only on the
 * server's cards, so no sentence the model wrote may carry one -- which is what keeps it from adding amounts or giving a
 * range, whatever words it uses. */
export function statesMoney(sentence: string): boolean {
  if (moneyFiguresIn(sentence).length) return true;
  const t = (sentence ?? "").replace(DATES, " ");
  if (/\b(?:dollars?|cents?|SGD|USD)\b/i.test(t) && /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand)\b/i.test(t)) return true;
  if (/\d(?:[\d,.]*\d)?\s*(?:k|m|mn|mil|million|thousand|grand|bn|billion)\b/i.test(t)) return true;
  if (/\b(?:hundreds?|thousands?|millions?|billions?|grand)\b/i.test(t)) return true;
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(m[0].replace(/,/g, "").replace(/\.$/, ""));
    if (!(value >= 100)) continue;
    const at = m.index ?? 0;
    // A year (1900-2099, no separator) is a date only where a date is introduced: "in 2026", "of the 2026 summary",
    // "October 2026". "She gets 2000" is money.
    if (/^(?:19|20)\d\d,?$/.test(m[0]) && YEAR_BEFORE.test(t.slice(Math.max(0, at - 24), at))) continue;
    if (RATE_OR_TIME.test(t.slice(at + m[0].length)) || /(?:\bpages?|\bpp?\.)\s*$/i.test(t.slice(Math.max(0, at - 8), at))) continue;
    return true;
  }
  return false;
}
function withoutMoney(text: string, dropped: string[], keep: (s: string) => string = (s) => s): string {
  return sentencesOf(text ?? "").filter((s) => { const money = statesMoney(keep(s)); if (money) dropped.push(s); return !money; }).join(" ").trim();
}
/** A next step may keep a helpline, policy, certificate or claim number, or a page, when it is labelled as one and the
 * documents cited in this answer print it (R41-2): the number is read past, and the rest of the sentence still may not
 * state money. The cited excerpt must print that whole number directly after the same kind of label, and never as a
 * figure with a currency sign (R42-1): "Call 1250" does not stand on a page that prints "S$1,250". */
const LABEL = String.raw`\b(phone|hotline|helpline|call|tel\.?|telephone|fax|(?:policy|certificate|claim)\s*(?:no\.?|number|#))\s*(?:on|at|is)?\s*:?\s*(\+?\d[\d\s-]*\d)`;
const PAGES = String.raw`\b(?:p\.|pp\.|pages?)\s*(\d+)(?:\s*(?:to|-|–|and)\s*(\d+))?`;
const LABELLED = new RegExp(`${LABEL}|${PAGES}`, "gi");
const labelKind = (label: string) => { const l = label.toLowerCase(); return /^(?:policy|certificate|claim)/.test(l) ? l.match(/^\w+/)![0] : "phone"; };
const digitsOf = (s: string) => s.replace(/\D/g, "");
function labelledNumbersRead(citations: ChatCitation[]): (s: string) => string {
  const printed = new Set<string>();
  for (const c of citations) {
    const excerpt = c.excerpt ?? "";
    const money = moneyFiguresIn(excerpt).map((f) => f.value);
    for (const m of excerpt.matchAll(new RegExp(LABEL, "gi"))) {
      const digits = digitsOf(m[2]);
      if (!money.some((v) => sameValue(v, Number(digits)))) printed.add(`${labelKind(m[1])}:${digits}`);
    }
  }
  const pages = new Set(citations.flatMap((c) => [c.pageStart, c.pageEnd]).filter((n): n is number => typeof n === "number"));
  return (s) => s.replace(LABELLED, (whole, label?: string, num?: string, page?: string, page2?: string) => {
    if (page) return pages.has(Number(page)) && (page2 == null || pages.has(Number(page2))) ? " " : whole;
    const digits = digitsOf(num ?? "");
    return digits.length >= 3 && printed.has(`${labelKind(label ?? "")}:${digits}`) ? " " : whole;
  });
}

const FOOTNOTE = /^\s*([*#^†‡§]+)/;
/** Whether a condition's quoted words are printed on the page the statement's quote is on, and (for a footnote) whether
 * the statement's row carries that footnote's mark. */
function conditionApplies(household: Household, found: Found, quote: string): boolean {
  const doc = household.documents[found.docIndex];
  const page = doc.pages.find((p) => p.page === found.page);
  if (!page) return false;
  const where = locateQuote({ ...household, documents: [{ ...doc, pages: [page] }] }, quote, 0);
  if (!where) return false;
  const lineOf = (offset: number) => { const start = page.text.lastIndexOf("\n", offset - 1) + 1; const end = page.text.indexOf("\n", offset); return page.text.slice(start, end < 0 ? undefined : end); };
  const mark = FOOTNOTE.exec(lineOf(where.offset))?.[1];
  if (!mark) return true;
  // The row is the statement's line, with the mark printed after its first character (a row label such as "Ambulance Cost*").
  const row = lineOf(found.offset);
  return row.trimStart().slice(1).includes(mark);
}

/** Whether every excerpt sits on the same line of the same page. */
function oneRow(household: Household, found: Found[]): boolean {
  const f0 = found[0];
  if (found.some((f) => f.docIndex !== f0.docIndex || f.page !== f0.page)) return false;
  const page = household.documents[f0.docIndex].pages.find((p) => p.page === f0.page);
  const parts = found.map((f) => squash(f.excerpt.replace(/…$/, "")).text);
  return !!page && page.text.split("\n").some((line) => { const l = squash(line).text; return parts.every((x) => l.includes(x)); });
}

// ------------------------------------------------------------------ the answer
export type VerifyReport = { dropped: { kind: string; why: string; text: string }[]; sentencesLeftOut: string[]; questionsLeftOut: string[]; conditionsLeftOut: string[] };

const asStrings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
function readPercentOf(v: unknown): ModelStatement["percentOf"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.percent !== "number" || typeof o.baseAmount !== "string") return null;
  return { percent: o.percent, baseAmount: o.baseAmount, baseDocument: strOrNull(o.baseDocument), baseQuote: strOrNull(o.baseQuote) };
}
/** A condition without its own quote is read with quote null, and is then left out (verifyAnswer). */
const readConditions = (v: unknown): ModelStatement["conditions"] => (Array.isArray(v) ? v : []).flatMap((c) =>
  typeof c === "string" && c.trim() ? [{ text: c, quote: null }]
    : c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" && (c as { text: string }).text.trim() ? [{ text: (c as { text: string }).text, quote: strOrNull((c as { quote?: unknown }).quote) }] : []);

/** Whether a sentence asks something. */
const asks = (sentence: string) => /\?["”’)\]]*\s*$/.test(sentence.trim());
/** Text without the sentences that ask something; those are reported. Questions go only in "question" (one at most). */
function withoutQuestions(text: string, dropped: string[]): string {
  return sentencesOf(text ?? "").filter((x) => { const q = asks(x); if (q) dropped.push(x); return !q; }).join(" ").trim();
}
/** The model's JSON as a ModelAnswer, or null when it is not one. */
export function readModelAnswer(json: unknown): ModelAnswer | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.bottomLine !== "string" || !Array.isArray(o.statements)) return null;
  const kinds = new Set(["amount", "fact", "not_found", "uncertainty"]);
  const statements = (o.statements as Record<string, unknown>[]).filter((s) => s && typeof s === "object" && kinds.has(String(s.kind)) && typeof s.text === "string").map((s) => ({
    kind: s.kind as ModelStatement["kind"], text: String(s.text),
    person: typeof s.person === "string" ? s.person : null, document: typeof s.document === "string" ? s.document : null,
    quote: typeof s.quote === "string" ? s.quote : null, amount: typeof s.amount === "string" ? s.amount : null,
    percentOf: readPercentOf(s.percentOf),
    conditions: readConditions(s.conditions), alternativeGroup: typeof s.alternativeGroup === "string" && s.alternativeGroup.trim() ? s.alternativeGroup.trim() : null,
  }));
  return { bottomLine: o.bottomLine, statements, nextSteps: asStrings(o.nextSteps).slice(0, 3), question: typeof o.question === "string" && o.question.trim() ? o.question.trim() : null };
}

/** A document as the household knows it: its product name, with the file name when two documents share one. */
function docLabel(household: Household, d: HouseholdDocument): string {
  const product = d.productName?.trim();
  if (!product) return d.name;
  const shared = household.documents.some((o) => o !== d && o.productName?.trim().toLowerCase() === product.toLowerCase());
  return shared ? `${product} (${d.name.replace(/\.[a-z0-9]+$/i, "")})` : product;
}

/** How an illustration was worked out, in plain words with its sources. */
function basisOf(household: Household, c: Checked): string {
  const po = c.s.percentOf!;
  if (!c.base) return `${po.percent}% of ${po.baseAmount}, worked out from the document's terms`;
  const bdoc = household.documents[c.base.found.docIndex];
  const cover = c.base.cover.replace(/\b\w/g, (x) => x.toUpperCase());
  const asOf = c.base.asOf ? `, as of ${c.base.asOf.split("-").reverse().join("/")}` : "";
  return `${po.percent}% of ${c.person}'s ${cover} sum insured of ${formatMoney(currencyOf(po.baseAmount, c.base.found.excerpt).sign, moneyFiguresIn(po.baseAmount)[0].value)} (${docLabel(household, bdoc)}, page ${c.base.found.page}${asOf}), worked out from the document's terms`;
}

export function verifyAnswer(household: Household, model: ModelAnswer): { answer: StructuredAnswer; report: VerifyReport } {
  const report: VerifyReport = { dropped: [], sentencesLeftOut: [], questionsLeftOut: [], conditionsLeftOut: [] };
  const checked: Checked[] = [];
  for (const st of model.statements) {
    const preferred = st.document ? Number(/^D(\d+)$/i.exec(st.document.trim())?.[1] ?? NaN) - 1 : null;
    const found = st.quote ? locateQuote(household, st.quote, Number.isFinite(preferred) ? preferred : null) : null;
    const person = matchMember(household, st.person);
    if (st.kind === "amount") {
      if (!found) { report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue; }
      const r = checkAmount(st, found, household, person);
      if (!r.ok) {
        if (!r.asFact) report.dropped.push({ kind: st.kind, why: r.why, text: st.text });
        // A percentage that is not worked out is kept as the printed percentage, without an amount.
        if (st.percentOf) checked.push({ s: { ...st, kind: "fact", amount: null, percentOf: null, alternativeGroup: null }, found, amount: null, person, note: null });
        continue;
      }
      checked.push({ s: st, found, amount: r.amount, person, note: null, base: r.base ?? null });
    } else if (st.kind === "fact") {
      if (!found) { report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue; }
      checked.push({ s: st, found, amount: null, person, note: null });
    } else {
      checked.push({ s: st, found, amount: null, person, note: null });
    }
  }
  // What a source says about the person it is used for: not linked to them, or replaced by a later version.
  for (const c of checked) {
    if (!c.found) continue;
    const doc = household.documents[c.found.docIndex];
    const notes: string[] = [];
    if (c.person && doc.linkedPeople.length && !doc.linkedPeople.some((p) => baseName(p) === c.person)) notes.push(`This document is not linked to ${c.person} in your library.`);
    if (doc.supersededAt) notes.push(`This document was replaced by a later version on ${doc.supersededAt.slice(0, 10)}.`);
    c.note = notes.join(" ") || null;
  }
  // A condition is kept only when its quoted words are printed on the statement's own page, and, when they are a footnote
  // ("*This Benefit can only be claimed ..."), only for a row that carries the same footnote mark (release-set B1).
  for (const c of checked) {
    c.conditions = c.s.conditions.flatMap((x) => {
      if (c.found && x.quote && conditionApplies(household, c.found, x.quote)) return [x.text];
      report.conditionsLeftOut.push(x.text);
      return [];
    });
  }
  // Either/or is drawn only for one person's amounts printed on one line (one row) of one page: alternatives the model
  // groups across rows or documents (ambulance cost and the recuperation benefit are separate benefits) are separate
  // cards, with a note that they are not a total.
  const groups = new Map<string, Checked[]>();
  for (const c of checked) if (c.amount && c.s.alternativeGroup) groups.set(c.s.alternativeGroup, [...(groups.get(c.s.alternativeGroup) ?? []), c]);
  const groupOf = new Map<Checked, string>();
  const notTotals: Checked[][] = [];
  let g = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    if (oneRow(household, members.map((m) => m.found!)) && new Set(members.map((m) => m.person ?? "")).size === 1) {
      const id = `g${++g}`;
      for (const m of members) groupOf.set(m, id);
    } else notTotals.push(members);
  }
  const citations: ChatCitation[] = [];
  const statements: AnswerStatement[] = [];
  // One card per quoted row: a second statement quoting the same words on the same page (without an amount) adds nothing.
  const seenRows = new Set<string>();
  checked.forEach((c, i) => {
    if (c.found && !c.amount) {
      const key = `${c.found.docIndex}:${c.found.page}:${squash(c.found.excerpt).text}`;
      if (seenRows.has(key)) return;
      seenRows.add(key);
    }
    const doc = c.found ? household.documents[c.found.docIndex] : null;
    let text = withoutMoney(withoutQuestions(c.s.text, report.questionsLeftOut), report.sentencesLeftOut);
    // With no words of its own left, a card says what its source prints (the quoted words carry the benefit's name).
    if (!text && doc && c.found) text = `${docLabel(household, doc)} prints: “${c.found.excerpt}”`;
    if (!text) return;
    const conditions = (c.conditions ?? []).map((x) => withoutMoney(withoutQuestions(x, report.questionsLeftOut), report.sentencesLeftOut)).filter(Boolean);
    let source: AnswerStatement["source"] = null;
    if (c.found && doc) {
      const chunkId = `simple-${doc.policyId}-p${c.found.page}-${i + 1}`;
      citations.push({ chunkId, policyId: doc.policyId, policyName: docLabel(household, doc), insurer: doc.insurer ?? undefined, pageStart: c.found.page, pageEnd: c.found.page, documentRole: doc.documentRole ?? undefined, excerpt: c.found.excerpt, documentDate: doc.effectiveDate ?? undefined } as ChatCitation);
      source = { policyName: docLabel(household, doc), page: c.found.page, note: c.note, citationIds: [chunkId] };
      if (c.base) {
        const bdoc = household.documents[c.base.found.docIndex];
        const baseId = `${chunkId}-base`;
        citations.push({ chunkId: baseId, policyId: bdoc.policyId, policyName: docLabel(household, bdoc), insurer: bdoc.insurer ?? undefined, pageStart: c.base.found.page, pageEnd: c.base.found.page, documentRole: bdoc.documentRole ?? undefined, excerpt: c.base.found.excerpt, documentDate: bdoc.effectiveDate ?? undefined } as ChatCitation);
        source.citationIds.push(baseId);
      }
    }
    const kind: AnswerStatement["kind"] = c.amount ? (c.amount.illustration ? "calculation" : "benefit_terms") : c.s.kind === "fact" || c.s.kind === "amount" ? "fact" : c.s.kind;
    const gid = groupOf.get(c);
    statements.push({
      id: `s${i + 1}`, kind, text, fullText: text, personName: c.person, amount: c.amount ? { text: c.amount.text, currencyResolved: c.amount.currencyResolved, illustration: c.amount.illustration } : null,
      basis: c.amount?.illustration && c.s.percentOf ? basisOf(household, c) : null,
      conditions, asOf: c.base?.asOf ?? null, source, group: gid ? { id: gid, kind: "either_or", note: ALTERNATIVES_NOTE } : null,
    });
  });
  for (const members of notTotals) {
    const who = members[0].person;
    const shown = members.filter((m) => statements.some((s) => s.amount?.text === m.amount!.text && s.personName === m.person));
    if (shown.length < 2) continue;
    const text = `${shown.map((m) => m.amount!.text).join(", ").replace(/, ([^,]*)$/, " and $1")}${who ? ` for ${who}` : ""} come from different parts of your documents. They are not a total; the insurer decides which applies.`;
    statements.push({ id: `not-total-${statements.length + 1}`, kind: "uncertainty", text, fullText: text, conditions: [] });
  }
  if (report.dropped.some((d) => d.kind === "amount")) statements.push({ id: "left-out-amount", kind: "uncertainty", text: LEFT_OUT_AMOUNT, fullText: LEFT_OUT_AMOUNT, conditions: [] });
  else if (report.dropped.length) statements.push({ id: "left-out-fact", kind: "uncertainty", text: LEFT_OUT_FACT, fullText: LEFT_OUT_FACT, conditions: [] });
  let bottomLine = withoutMoney(withoutQuestions(model.bottomLine, report.questionsLeftOut), report.sentencesLeftOut);
  const nextSteps = model.nextSteps.map((x) => withoutMoney(withoutQuestions(x, report.questionsLeftOut), report.sentencesLeftOut, labelledNumbersRead(citations))).filter(Boolean);
  // One question back at most: the first one the model asks; any further question is left out.
  const asked = model.question ? sentencesOf(model.question).filter(asks) : [];
  report.questionsLeftOut.push(...asked.slice(1));
  const question = asked.length ? withoutMoney(asked[0], report.sentencesLeftOut) : "";
  const shownAmounts = statements.filter((s) => s.amount).length;
  if (!bottomLine) {
    // Built here, without another model call, from the first amount card: whose it is and what the model said it is for.
    const first = statements.find((x) => x.amount);
    const forWhom = first?.personName ? ` for ${first.personName}` : "";
    const said = first && !first.text.includes("prints: “") ? ` ${first.text.replace(/\s+$/, "")}` : "";
    bottomLine = first
      ? `Your documents list ${shownAmounts > 1 ? "these benefits" : "this benefit"}${forWhom}.${said ? said.replace(/([^.!?])$/, "$1.") : ""} ${shownAmounts > 1 ? "The amounts are shown below; they are separate and not added together." : "The amount is shown below."}`
      : statements.length ? "Here is what your documents say." : NO_ANSWER;
  }
  const questions: ChatQuestion[] = question ? [{ id: "simple_question", text: question, type: "text", why: "This helps me answer from the right part of your documents." }] : [];
  const answer: StructuredAnswer = {
    mode: "answer", summary: bottomLine, details: [], claimItems: [], nextSteps, confidence: citations.length ? "partial_match" : "insufficient_evidence",
    citations, disclaimer: DISCLAIMER, claimSessionId: null, questions, knownFacts: [], missingFacts: [],
    bottomLine, statements,
    // The prose carries no figures; the live monetary boundary (lib/chat/monetary-boundary.ts) holds it to that on save and reopen.
    verifiedPolicyFactsOnly: true, verifiedPolicyFigures: [],
  };
  return { answer, report };
}

/** The text a later turn shows the model for this answer. */
export function answerAsText(answer: Pick<ChatAnswer, "summary" | "nextSteps" | "questions"> & { statements?: AnswerStatement[]; bottomLine?: string | null }): string {
  const lines = [answer.bottomLine || answer.summary, ...(answer.statements ?? []).map((s) => `- ${s.personName ? s.personName + ": " : ""}${s.amount ? s.amount.text + " — " : ""}${s.text}${s.source ? ` (${s.source.policyName}, page ${s.source.page})` : ""}`), ...answer.nextSteps.map((n) => `Next: ${n}`), ...answer.questions.map((q) => q.text)];
  return lines.filter(Boolean).join("\n");
}
export { documentId };
