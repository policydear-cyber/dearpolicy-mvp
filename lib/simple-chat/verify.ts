/** The server's checks on the simple chat's answer, before anything is shown. Pure: it reads only the household's
 * library (lib/simple-chat/library.ts) and the model's JSON (lib/simple-chat/prompt.ts).
 *
 * 1. Sources come from the stored pages, never from the model's own page numbers: each quote is found in the stored
 *    page text, and the document and page shown are where it was found (Evidence Reviewer, 20 Oct 2026: the baseline
 *    cited the wrist row as page 12 when it is on page 13).
 * 2. Amounts appear only on cards the server builds: a currency-signed figure printed in the quote, or a percentage the
 *    quote prints of the sum its own table heading prints on that page, or a "% of Sum Insured" row worked out on the
 *    person's own printed sum insured for that same cover (both shown as illustrations). A figure with no sign counts only
 *    on a page that declares one currency for its figures (a policy schedule). A stay length the household wrote is worked
 *    out on a daily benefit's quoted start day and cap. A quote that cannot be found drops its amount or fact; a point
 *    about a file itself is stated from the library's own record instead.
 * 3. The model's own sentences carry no money at all (Critic round 39): any sentence of the bottom line, a card's text, a
 *    condition, a next step or the question that states money is left out. So nothing it writes can add amounts together
 *    or give a range (release-set C2), however it is worded. Phone, policy and code numbers the documents print, and file
 *    names, are not money.
 * 4. Alternatives are drawn as either/or only when they come from one document for one person; amounts from different
 *    documents are always separate cards.
 * 5. A condition is kept only when its own quoted words are printed in the same section of the statement's document, or,
 *    for a certificate line, in any document's section for that cover (release-set B1: a condition from one document must
 *    not be put on another document's row).
 * 6. At most one question back (release-set B2, B5): only the first question in "question" is kept, and questions written
 *    anywhere else are left out. */
import type { ChatAnswer, ChatCitation, ChatQuestion } from "@/types";
import type { AnswerStatement, StructuredAnswer } from "@/components/answer-cards";
import { moneyFiguresIn, sentencesOf } from "@/lib/chat/answer-verification";
import { documentId, unreadable, type Household, type HouseholdDocument } from "./library";
import type { ModelAnswer, ModelStatement } from "./prompt";
import { nameOnPage, otherLife } from "@/lib/benefit-table/lives";

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
export type Found = { docIndex: number; page: number; excerpt: string; offset: number; end?: number };

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
      return { docIndex: di, page: page.page, excerpt: excerpt.length > 700 ? excerpt.slice(0, 700) + "…" : excerpt, offset: sq.at[start], end: sq.at[end - 1] + 1 };
    }
  }
  return null;
}

const wordsOf = (s: string) => s.toLowerCase().match(/[a-z]+|\d[\d,]*(?:\.\d+)?/g) ?? [];
/** A table row the page's text split over two lines in a different order ("Mobility aid upon Accidental Total & Up to
 * S$10,000" / "Permanent Disablement*", release-set H7): every word and figure of the quote on one line and the next,
 * on one page, the second line only the label's end: no figure (so the quote's figures are on the first line), no tab, and not the start of another row (a bullet, number or letter), so a label is never paired with the
 * next row's figure (R60-1). The excerpt is those two lines as stored. A quote of fewer than four words, or two places
 * that fit, gives none. */
function acrossTwoLines(household: Household, quote: string): Found | null {
  const want = wordsOf(quote.replace(/\s*(?:\.{3}|…)\s*/g, " "));
  if (want.length < 4) return null;
  const hits: Found[] = [];
  household.documents.forEach((d, di) => {
    if (unreadable(d)) return;
    for (const p of d.pages) {
      const lines = p.text.split("\n");
      let at = 0;
      for (let i = 0; i + 1 < lines.length; i++) {
        const start = at; at += lines[i].length + 1;
        const have = new Set(wordsOf(`${lines[i]} ${lines[i + 1]}`));
        const next = lines[i + 1];
        if (/\d|\t/.test(next) || /^\s*(?:[-•*·]|\(?[A-Za-z0-9]{1,3}[.,)])\s/.test(next) || !next.trim()) continue;
        if (want.every((w) => have.has(w)) && !want.every((w) => new Set(wordsOf(lines[i])).has(w)))
          hits.push({ docIndex: di, page: p.page, excerpt: `${lines[i].trim()} ${lines[i + 1].trim()}`.replace(/[ \t]+/g, " "), offset: start + (lines[i].length - lines[i].trimStart().length) });
      }
    }
  });
  return hits.length === 1 ? hits[0] : null;
}

// ------------------------------------------------------------------ amounts
const CENT = (n: number) => Math.round(n * 100);
const sameValue = (a: number, b: number) => CENT(a) === CENT(b);
/** Every number printed in a text (money or not), as values. */
const numbersIn = (text: string) => [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ""))).filter(Number.isFinite);

type Currency = { sign: string; resolved: boolean };
const SIGN: Record<string, string> = { SGD: "S$", USD: "US$", MYR: "RM", HKD: "HK$", AUD: "A$", EUR: "€", GBP: "£", JPY: "¥", "$": "$" };
/** The currency of an amount, resolved only when the words it rests on print that currency, or when a bare "$" stands in
 * a document that names Singapore dollars and no other currency anywhere in it (a Singapore scheme's benefit summary
 * prints "S$" in one table and "$250" in the next). */
function currencyOf(amountText: string, evidence: string, doc?: HouseholdDocument): Currency {
  const f = moneyFiguresIn(amountText)[0];
  const printed = moneyFiguresIn(evidence).map((x) => x.currency);
  const named = /\bSGD\b|S\$|Singapore dollars?/i.test(evidence) ? "SGD" : null;
  if (f && f.currency !== "$") return { sign: SIGN[f.currency] ?? f.currency, resolved: printed.includes(f.currency) || named === f.currency };
  if (printed.includes("SGD") || (named && !printed.some((c) => c !== "$" && c !== "SGD"))) return { sign: "S$", resolved: true };
  if (doc && !printed.some((c) => c !== "$") && documentCurrency(doc) === "SGD") return { sign: "S$", resolved: true };
  return { sign: "$", resolved: false };
}
const docCurrencies = new WeakMap<HouseholdDocument, string | null>();
/** Anything in a document that may be another currency (Critic R124-1): "dollars" not after "Singapore" ("U.S. dollars",
 * "Canadian dollars"), a currency code other than SGD beside a number ("USD 500", "500 RMB"), a sign with letters before
 * "$" other than S$, SG$ or SGD$ ("NT$", "HK$"), another currency sign, a currency's name, or a foreign-currency clause. Codes are
 * matched from the currency list, in capitals, so a scheme's own abbreviations ("GPA 600", "GTL") never count. */
const OTHER_CODES = "USD|EUR|GBP|JPY|CNY|RMB|HKD|AUD|NZD|CAD|CHF|MYR|IDR|THB|INR|PHP|KRW|TWD|NTD|VND|AED|SAR|QAR|BND|MOP|SEK|NOK|DKK|ZAR|BRL|MXN|RUB|TRY|ILS|LKR|PKR|BDT|MMK|KHR|LAK";
const OTHER_CODE = new RegExp(String.raw`(?<![A-Z])(?:${OTHER_CODES})(?![A-Z])`);
const OTHER_WORDS = new RegExp([
  String.raw`(?<!singapore\s)\bdollars?\b`,
  String.raw`(?<![a-z])(?!s\$|sg\$|sgd\$)[a-z]{1,3}\$`,
  String.raw`[€£¥₹฿₩₱₫₺₽₪]|\brs\.?\s?\d`,
  String.raw`\b(?:euros?|pounds?\s+sterling|yen|yuan|renminbi|rupees?|rupiah|baht|ringgit|pesos?|won(?!['’]t)|francs?|dirhams?|riyals?)\b`,
  String.raw`\bforeign\s+currenc|\bexchange\s+rates?\b`,
].join("|"), "i");
/** "SGD" when a document's pages name Singapore dollars ("S$", "SGD", "Singapore dollars") and nothing in them may be
 * another currency; otherwise null. A bare "$" in such a document is a Singapore dollar. */
export function documentCurrency(doc: HouseholdDocument): string | null {
  if (docCurrencies.has(doc)) return docCurrencies.get(doc)!;
  const t = doc.pages.map((p) => p.text ?? "").join("\n").normalize("NFKC");
  const sgd = /\bSGD\b|(?<![A-Za-z])S\$|Singapore\s+dollars?/i.test(t);
  const other = OTHER_CODE.test(t) || OTHER_WORDS.test(t) || moneyFiguresIn(t).some((x) => x.currency !== "$" && x.currency !== "SGD");
  const found = sgd && !other ? "SGD" : null;
  docCurrencies.set(doc, found);
  return found;
}
/** The one currency a page declares for every figure on it (release-set A2, A3, A6: a policy schedule prints "Death Benefit
 * 5,000.00" under a "Currency : Singapore Dollar" field, with no sign on any figure): a currency field ("Currency : SGD",
 * "Policy Currency	Singapore Dollars", or a schedule's ": Singapore Dollar" value beside its "Currency" label) or "All
 * amounts are in Singapore dollars". Null when the page declares none, or more than one (a list of currency options). */
const CURRENCY_NAMES: [string, string][] = [["SGD", String.raw`singapore\s+dollars?|SGD`], ["USD", String.raw`(?:us|united\s+states)\s+dollars?|USD`], ["MYR", String.raw`ringgit|MYR`], ["HKD", String.raw`hong\s+kong\s+dollars?|HKD`], ["AUD", String.raw`australian\s+dollars?|AUD`], ["EUR", String.raw`euros?|EUR`], ["GBP", String.raw`pounds?\s+sterling|GBP`]];
export function pageCurrency(pageText: string): string | null {
  const t = pageText ?? "";
  const said = new Set<string>();
  for (const [code, name] of CURRENCY_NAMES) {
    const field = new RegExp(String.raw`(?:^|\t)[ ]*(?:policy\s+|contract\s+)?currency[ \t]*:?[ \t]*(?:${name})[ ]*(?:\t|$)`, "im");
    const value = new RegExp(String.raw`^[ \t]*:[ \t]*(?:${name})[ ]*$`, "im");
    const all = new RegExp(String.raw`\ball\s+amounts\s+(?:are|quoted\s+are|shown\s+are)\s+in\s+(?:${name})\b`, "i");
    if (field.test(t) || all.test(t) || (value.test(t) && /(?:^|\t)[ ]*currency[ ]*(?:\t|$)/im.test(t))) said.add(code);
    // A page listing the currencies a policy can be in ("Six currency options are available: SGD, USD, ...") declares none.
    if (new RegExp(String.raw`currency\s+options|currencies\s+are\s+available`, "i").test(t)) return null;
  }
  if (said.size !== 1) return null;
  const code = [...said][0];
  // "All amounts are in Singapore dollars unless stated otherwise", or any figure or name of another currency on the page
  // (a row "(in US$)"): the page does not settle a figure's currency (R59-5).
  if (/\bunless\s+(?:otherwise\s+)?(?:stated|specified|shown|indicated)\b/i.test(t)) return null;
  if (moneyFiguresIn(t).some((f) => f.currency !== "$" && f.currency !== code)) return null;
  if (CURRENCY_NAMES.some(([other, name]) => other !== code && new RegExp(String.raw`(?:${name})`, "i").test(t)) || /US\$|HK\$|(?<![A-Z])A\$|RM\s?\d|€|£|¥/.test(t) || (code !== "SGD" && /(?<![A-Z])S\$/.test(t))) return null;
  return code;
}
/** The currency a table's own heading prints on a line of its own ("(S$)", "(SGD$)", "(SGD)") above the quoted figure, on
 * a page that otherwise passes the same tests as a declared page (Outpatient Medicare's "Local Emergency Outpatient
 * Treatment for Illness	100" under "Benefits Limits Per Visit ... (S$)"). Null when there is none above the figure. */
function tableCurrency(pageText: string, offset: number): string | null {
  return moneyTable(pageText, offset) ? pageCurrency(`${pageText}\nCurrency\t: SGD`) : null;
}
/** The "(S$)" table a row sits in (R68-1, R68-3): the heading line is above the row, and nothing between them ends the
 * table: another unit heading ("(Days)", "(%)", "(Visits)") or a line of prose (a sentence, or a long line). `perVisit`
 * is whether the heading's own lines just above it say "Limit(s) Per Visit" (or claim, incident, event, admission). */
function moneyTable(pageText: string, offset: number): { perVisit: boolean; plans: number } | null {
  const lines = (pageText ?? "").slice(0, offset).split("\n");
  lines.pop();
  let table: { perVisit: boolean; plans: number } | null = null;
  lines.forEach((l, i) => {
    if (/^[ \t]*\((?:S\$|SGD\$?|SG\$)\)[ \t]*$/.test(l)) {
      const head = lines.slice(Math.max(0, i - 3), i).join(" ");
      // The plan columns the heading names ("Plan A	Plan B"): a row with one figure per plan column is priced per plan (R72-1).
      table = { perVisit: /\blimits?\s+per\s+(?:visit|claim|incident|event|admission)\b/i.test(head), plans: new Set([...head.matchAll(/\bPlan\s+([A-Z0-9])\b/g)].map((m) => m[1])).size };
      return;
    }
    if (/^[ \t]*\([^)]{1,15}\)[ \t]*$/.test(l) || /\((?:days?|%|months?|years?|weeks?|times|visits?|sessions?)\)/i.test(l) || l.trim().length > 90 || /[.:]\s*$/.test(l)) table = null;
  });
  return table;
}
/** A figure printed without a sign but written as an amount: grouped thousands ("300,000.00", "1,000") or two decimals
 * ("470.85"). A count, a code or a percentage never is. */
const PLAIN_AMOUNT = /(?<![\d.,$\w])(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})(?![\d%]|\.\d|\s?%|\s?per\s?cent)/g;
const plainAmountsIn = (text: string) => [...(text ?? "").matchAll(PLAIN_AMOUNT)].map((m) => Number(m[1].replace(/,/g, "")));
const formatMoney = (sign: string, value: number) => sign + value.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });

type Base = { found: Found; cover: string; asOf: string | null };
type Stay = { value: number; text: string; currencyResolved: boolean; stay: number; payable: number; rule: string };
type Bill = { text: string; currencyResolved: boolean; bill: string; within: boolean };
type Checked = { s: ModelStatement; found: Found | null; amount: { value: number; text: string; currencyResolved: boolean; illustration: boolean } | null; person: string | null; note: string | null; base?: Base | null; conditions?: string[]; stay?: Stay | null; bill?: Bill | null; billed?: Billed | null; uncovered?: string | null; whole?: string | null };

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
export const CAPPED = /\b(?:up\s+to|maximum|max\.?|whichever\s+is\s+(?:the\s+)?(?:lesser|greater|lower|higher)|capped|limit(?:ed)?|subject\s+to|balance)\b/i;
/** The row's own line and the lines that continue it ("15% of Sum Insured" / "or up to S$50,000, whichever is lesser"),
 * up to the next row, bullet or numbered item (R52-1). */
export function rowWithContinuation(pageText: string, offset: number): string {
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

type AmountCheck = { ok: true; amount: NonNullable<Checked["amount"]>; base?: Base; found?: Found } | { ok: false; why: string; asFact?: boolean; found?: Found };

const PCTS = /(?<![\d.])(\d+(?:\.\d+)?)\s?(?:%|per\s?cent)/gi;
const LABEL_STOP = new Set(["and", "the", "for", "due", "with", "from", "any", "one", "per", "all", "his", "her", "its", "of", "to", "or", "in", "on", "an", "by"]);
const labelWords = (s: string) => s.toLowerCase().replace(/\d+/g, " ").split(/[^a-z]+/).filter((w) => w.length >= 3 && !LABEL_STOP.has(w));
/** The table row a percentage statement means when its quote is the table's heading rather than any row (release-set B4
 * quoted "Simple Fracture Benefit Limit: S$5,000" for the hip row). Only when neither the quote nor its line prints a
 * percentage: a quoted row whose percentage is not the stated one is refused, never moved (R59-1, R55-1). It is the one
 * table line in the quoted document that ends in the stated percentage (or "<percentage> of Sum Insured") and whose
 * distinct label words all appear in the statement's own text. Two or more such lines: none is chosen. */
function rowFor(st: ModelStatement, found: Found, household: Household): Found | null {
  const pct = st.percentOf!.percent;
  if ((st.quote ?? "").match(PCTS)) return null;
  const said = new Set(labelWords(st.text));
  for (const di of [found.docIndex]) {
    const doc = household.documents[di];
    if (unreadable(doc)) continue;
    const hits: Found[] = [];
    for (const page of doc.pages) {
      let at = 0;
      for (const line of page.text.split("\n")) {
        const start = at; at += line.length + 1;
        if (line.length > 120 || !/\t/.test(line)) continue;
        const pcts = [...line.matchAll(PCTS)];
        const last = pcts.at(-1);
        if (!last || Number(last[1]) !== pct) continue;
        if (!/^\s*(?:of\s+(?:the\s+)?sum\s+(?:insured|assured))?\s*$/i.test(line.slice((last.index ?? 0) + last[0].length))) continue;
        const words = [...new Set(labelWords(line.slice(0, last.index)))];
        if (!words.length || !words.every((w) => said.has(w))) continue;
        const lead = line.length - line.trimStart().length;
        hits.push({ docIndex: di, page: page.page, excerpt: line.trim().replace(/[ \t]+/g, " "), offset: start + lead });
      }
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

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
    const lines = p.text.split("\n");
    const text = p.page === page ? p.text.slice(0, offset) : p.text;
    text.split("\n").forEach((l, i) => { const h = sectionHeading(l, covers) ?? schemeSection(l, lines.slice(i + 1, i + 4), covers); if (h) last = h; });
  }
  return last;
}
/** A product summary that opens with the scheme's title instead of the product's ("MINDEF & MHA GROUP INSURANCE VOLUNTARY
 * SCHEME", "(GROUP POLICY NO: G00750)", "The Group Term Life Insurance provides coverage ...", release-set H1) starts
 * the section of the one cover its next lines name; the longest name wins ("living care plus" over "living care"). */
function schemeSection(line: string, next: string[], covers: Set<string>): string | null {
  const c = coverName(line);
  if (!c || !/\bscheme\b/.test(c)) return null;
  const words = ` ${next.join(" ").toLowerCase().replace(/[^a-z&]+/g, " ")} `;
  const named = [...covers].filter((k) => !k.startsWith("other:") && words.includes(` ${k} `)).sort((a, b) => b.length - a.length);
  if (!named.length) return null;
  // Two different covers named (not one inside the other): no section is read from the title.
  return named.every((k) => named[0].includes(k)) ? named[0] : null;
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
/** The refusals after which a 100% statement may still be its person's printed sum insured (verifyAnswer): the
 * percentage could not be tied to a table row, or its row prints no sum it is a percentage of. A row whose table prints its
 * own base has settled the base, and every other refusal (a cap, another cover's sum) stands (Critic R126-1). */
const NO_PRINTED_BASE = "the row prints no sum it is a percentage of";
const WHOLE_FALLBACK = new Set(["the percentage is not the quoted row's own figure", NO_PRINTED_BASE]);
/** Where a 100% statement's quoted sum insured is the person's own for the policy the wording is from, or null. The base
 * is printed with its currency, or on a page that settles it (plainAmount checks that), and:
 * - it is in the same document as the wording, or in a document with the same policy number;
 * - its page names no other household member and no other insured person (otherLife);
 * - its line names the person, or names nobody on a page that names them (a one-life schedule prints the name once, as
 *   "Life Assured : ...", not on the sum insured's line);
 * - its page prints exactly one benefit amount, of any size, so it is not another cover's (TE #103 A3, Critic R127-1);
 * - it is printed with the name of the benefit the wording is headed by (R127-1);
 * - it is a sum insured (its lines or the table heading above say "sum insured" or "sum assured"), not a limit or an
 *   expense amount (TE #103 A10b), and its lines print nothing but the heading's benefit words, "sum insured" and the
 *   amount (A10c). */
function wholeSumInsured(st: ModelStatement, wording: Found, household: Household, person: string, serverWords: ReadonlySet<string> = new Set()): Found | null {
  const po = st.percentOf!;
  if (!po.baseQuote) return null;
  const preferred = po.baseDocument ? Number(/^D(\d+)$/i.exec(po.baseDocument.trim())?.[1] ?? NaN) - 1 : null;
  const bf = locateQuote(household, po.baseQuote, Number.isFinite(preferred) ? preferred : null);
  if (!bf) return null;
  const wdoc = household.documents[wording.docIndex], bdoc = household.documents[bf.docIndex];
  const number = (d: HouseholdDocument) => (d.policyNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const samePolicy = bf.docIndex === wording.docIndex || !!(number(wdoc) && number(wdoc) === number(bdoc));
  if (samePolicy && quotedLineIsWhole(bf, wording, household, person)) return bf;
  // Otherwise the plan's own Sum Assured cell, in the wording's document or the base's (when it is the same policy).
  const want = moneyFiguresIn(po.baseAmount)[0]?.value ?? numbersIn(po.baseAmount)[0];
  if (want == null) return null;
  // Words a plan row's name may print besides the benefit's: the product's name as the app read it (the document's own
  // record, or the server's label for a table row; never the model's words).
  const product = [wdoc, ...(samePolicy ? [bdoc] : [])].flatMap((d) => tokens(d.productName ?? ""));
  return planSumAssured(household, [wording.docIndex, ...(samePolicy && bf.docIndex !== wording.docIndex ? [bf.docIndex] : [])], wording, person, want,
    new Set([...product, ...(serverWords.has(st.text) ? tokens(st.text) : [])]));
}
/** A policy schedule's plan table: a header line with exactly one "Sum Assured" (or "Sum Insured") column, which may be
 * printed over two lines ("Sum" above "Assured/"), and the first row under it, with as many cells: the basic plan, whose
 * sum assured is "the Sum Assured" its wording pays a percentage of. Any amount between the header and the row (another
 * row above it) makes it no first row. The row's name is its first cell and the lines right after it that continue the
 * name ("Comprehensive Critical" / "Illness Benefit"). */
const SA_HEAD = /^\s*sum\s*(?:assured|insured)\b/i;
const SA_CELL = /^(?:S\$|SGD|US\$|\$)?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})$/;
function planRow(lines: string[], i: number): { name: string; value: number; line: string } | null {
  const cells = lines[i].split("\t").map((c) => c.trim());
  if (cells.length < 2 || !/[A-Za-z]/.test(cells[0]) || /\d/.test(cells[0])) return null;
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    if (AMOUNT.test(lines[j])) return null;
    const head = lines[j].split("\t").map((c) => c.trim());
    if (head.length !== cells.length) continue;
    const k = head.flatMap((c, n) => SA_HEAD.test(c) || (/^sum$/i.test(c) && /^\s*(?:assured|insured)\b/i.test(lines[j + 1] ?? "")) ? [n] : []);
    if (k.length !== 1 || k[0] === 0) return null;
    const cell = SA_CELL.exec(cells[k[0]]);
    if (!cell) return null;
    let name = cells[0];
    for (const l of lines.slice(i + 1, i + 3)) { if (!l.trim() || /\t|\d/.test(l)) break; name += ` ${l.trim()}`; }
    return { name, value: Number(cell[1].replace(/,/g, "")), line: lines[i] };
  }
  return null;
}
/** The person's sum assured for the plan a 100% wording is from, read from the plan table's Sum Assured cell (planRow) in
 * the given documents (release-set A3: "Comprehensive Critical	300,000.00	269.05 ..." under "Sum / Assured/"). Taken
 * only when every such row says the same:
 * - its page names the person and no other life;
 * - its name prints every word of the benefit the wording is headed by ("critical illness"), and no other word but the
 *   product's own name (`allowed`): "Personal Accident Hospital Income" is another benefit (TE #103 A10c);
 * - its line prints no limit, expense or "per" word;
 * - its cell is the sum the row step worked the 100% out on (`want`), and no other such row prints another sum.
 * Fail-safe: anything else is null and the percentage stays a fact. */
function planSumAssured(household: Household, docs: number[], wording: Found, person: string, want: number, allowed: Set<string>): Found | null {
  const name = headingWords(household, wording);
  if (!name.length) return null;
  const people = household.members.map((m) => m.name.replace(/\s*\(.*\)\s*$/, ""));
  const hits: { found: Found; value: number }[] = [];
  for (const di of docs) for (const page of household.documents[di].pages) {
    if (!nameOnPage(person, page.text) || otherLife(page.text, person, people)) continue;
    const lines = page.text.split("\n");
    let at = 0;
    lines.forEach((l, i) => {
      const start = at; at += l.length + 1;
      if (!/\t/.test(l)) return;
      const row = planRow(lines, i);
      if (!row) return;
      const words = tokens(row.name);
      if (!name.every((w) => words.includes(w)) || words.some((w) => !name.includes(w) && !allowed.has(w) && !HEADING_STOP.has(w))) return;
      if (/\b(?:limits?|up\s+to|max(?:imum)?|expenses?|per\s+(?:claim|day|event|visit|trip|accident|incident))\b/i.test(row.line)) return;
      hits.push({ found: { docIndex: di, page: page.page, excerpt: row.line.trim().replace(/[ \t]+/g, " "), offset: start + (l.length - l.trimStart().length) }, value: row.value });
    });
  }
  if (!hits.length || hits.some((h) => !sameValue(h.value, want))) return null;
  return hits[0].found;
}
/** The quoted base line itself is the person's whole sum insured for this policy (the checks listed on wholeSumInsured). */
function quotedLineIsWhole(bf: Found, wording: Found, household: Household, person: string): boolean {
  const bdoc = household.documents[bf.docIndex];
  const page = bdoc.pages.find((p) => p.page === bf.page);
  if (!page) return false;
  const people = household.members.map((m) => m.name.replace(/\s*\(.*\)\s*$/, ""));
  if (otherLife(page.text, person, people)) return false;
  // The base line names the person, or names nobody on a page about them alone (a one-life schedule's "Life Assured : ...").
  const lines = page.text.split("\n");
  const line = lines[page.text.slice(0, bf.offset).split("\n").length - 1] ?? "";
  if (!nameOnPage(person, line) && !(nameOnPage(person, page.text) && !people.some((n) => nameOnPage(n, line)))) return false;
  // Exactly one benefit-amount line on the page, of any size ("Death Benefit 5,000.00" counts as much as "300,000.00"); a
  // premium, total, discount or tax line is not a benefit amount. Two lines cannot say which one the 100% is of (Critic R127-1).
  const amountLines = lines.filter((l) => AMOUNT.test(l) && !NOT_BENEFIT_AMOUNT.test(l));
  if (amountLines.length !== 1) return false;
  // The base's lines (with the line either side, where a wrapped name continues) name the benefit the wording is headed by.
  const name = headingWords(household, wording);
  const at = page.text.slice(0, bf.offset).split("\n").length - 1;
  const near = new Set(tokens(lines.slice(Math.max(0, at - 1), at + bf.excerpt.split("\n").length + 1).join(" ")));
  if (!name.length || !name.every((w) => near.has(w))) return false;
  // It is a sum insured: its lines, or the table heading just above them ("Sum Assured / ..."), say so, and its lines are
  // not a limit or an expense amount ("Medical Expenses limit S$15,000", TE #103 A10b).
  const own = lines.slice(at, at + bf.excerpt.split("\n").length).join("\n");
  if (/\b(?:limits?|up\s+to|max(?:imum)?|expenses?|per\s+(?:claim|day|event|visit|trip|accident|incident))\b/i.test(own)) return false;
  if (!/\bsum\s+(?:insured|assured)\b/i.test(lines.slice(Math.max(0, at - 10), at + bf.excerpt.split("\n").length).join("\n"))) return false;
  // Fail-safe: once the heading's benefit words, "sum insured" or "sum assured", the amount and its currency are taken out,
  // nothing may be left on the base's lines. Any other word ("Hospital Income", a plan code, another column's figure) may
  // make it another benefit's amount, so it is refused (TE #103 A10c).
  const rest = own.replace(/\bsum\s+(?:insured|assured)\b/gi, " ").replace(/(?:S\$|SGD|US\$|USD|\$)?\s*\d[\d,]*(?:\.\d+)?/gi, " ").replace(/\b(?:SGD|USD)\b/gi, " ");
  if (tokens(rest).some((w) => !name.includes(w) && !HEADING_STOP.has(w)) || /\d/.test(rest)) return false;
  return true;
}
/** A printed amount: a figure with thousands separators or two decimals (not a phone number, code or count). */
const AMOUNT = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d{2})?(?![\d,])|(?<![\w.,])\d+\.\d{2}(?![\d])/;
const NOT_BENEFIT_AMOUNT = /\b(?:premiums?|instalments?|installments?|total|discount|gst|tax|fees?|charges?|payable\s+for\s+advice)\b/i;
const HEADING_STOP = new Set(["benefit", "benefits", "the", "of", "and", "for", "on", "a", "an", "to", "in"]);
/** The name words of the heading above the quoted wording ("2.2. Critical Illness Benefit" gives critical, illness), from
 * the nearest line above it that is a numbered heading or in capitals. Empty when there is none (refused, fail-safe). */
function headingWords(household: Household, found: Found): string[] {
  const page = household.documents[found.docIndex].pages.find((p) => p.page === found.page);
  if (!page) return [];
  const above = page.text.slice(0, found.offset).split("\n").reverse();
  for (const l of above) {
    const t = l.trim();
    const numbered = /^(?:\d+(?:\.\d+)*\.?|[A-Z]\.)[ \t]+([A-Za-z][A-Za-z &'()/-]{2,60})$/.exec(t);
    const capitals = !numbered && /^[A-Z][A-Z &'()/-]{2,60}$/.test(t) ? t : null;
    const heading = numbered?.[1] ?? capitals;
    if (heading) return tokens(heading).filter((w) => !HEADING_STOP.has(w));
  }
  return [];
}
/** Whether the quoted wording, with the lines that continue its row, limits the amount: a cap or limit word, or any money
 * figure ("100% of the Sum Insured, up to S$400,000"), or a line above it on its page prints a sum insured or limit with a
 * figure. Fail-safe: such wording is never read as the whole sum insured. */
function limitedWords(household: Household, found: Found): boolean {
  const page = household.documents[found.docIndex].pages.find((p) => p.page === found.page);
  const words = `${page ? rowWithContinuation(page.text, found.offset) : ""}\n${found.excerpt}`;
  // A table above that prints its own base ("Accidental Medical Expenses (Sum Insured S$5,000)", "% of S$5,000") has
  // settled what its 100% is of (Critic R126-1).
  const above = page ? page.text.slice(0, found.offset).split("\n") : [];
  if (above.some((l) => /\b(?:sum\s+(?:insured|assured)|benefit\s+limit|limit|%\s*of)\b/i.test(l) && moneyFiguresIn(l).length > 0)) return true;
  return moneyFiguresIn(words).length > 0 || /\b(?:up\s+to|limits?|limited|max(?:imum)?|whichever|less(?:er)?|greater|caps?|capped|exceed(?:s|ing)?|reduc\w*|minus|less\s+any|deduct\w*|pro-?rat\w*|proportion\w*|exclud\w*|net\s+of|aggregate\w*|balance|instalments?|advance)\b/i.test(words);
}
/** The amount a statement may show, or why it may not. An amount is a currency-signed figure printed in the quote, or a
 * percentage the quote prints of the sum its own table heading prints on the same page. A percentage of the sum insured is
 * never multiplied: the documents do not tie a benefit row to one of a person's sums insured, so the percentage is shown as
 * a fact and the sum insured as its own printed amount. */
function checkAmount(st: ModelStatement, quoted: Found, household: Household, person: string | null): AmountCheck {
  if (st.percentOf && st.percentOf.percent > 0) {
    const pct = st.percentOf.percent;
    // The percentage must be the row's own compensation figure: printed on the row's line (the first quoted words), and the
    // last percentage on it, since a row label can print thresholds ("Equals to or greater than 8%	100%", R55-1). A quote of
    // the table's heading or wording is read as the one row it means, when exactly one fits (rowFor).
    const ownPcts = (f: Found) => [...rowLine(household.documents[f.docIndex].pages.find((p) => p.page === f.page)!.text, f.offset).text.matchAll(PCTS)].map((m) => Number(m[1]));
    let found = quoted;
    if (ownPcts(found).at(-1) !== pct) {
      const row = ownPcts(found).length ? null : rowFor(st, quoted, household);
      if (!row) return { ok: false, why: "the percentage is not the quoted row's own figure" };
      found = row;
    }
    const r = percentAmount(st, found, household, person);
    return { ...r, found };
  }
  return plainAmount(st, quoted, household);
}
function percentAmount(st: ModelStatement, found: Found, household: Household, person: string | null): AmountCheck {
  const doc = household.documents[found.docIndex];
  {
    const pct = st.percentOf!.percent;
    const page = doc.pages.find((p) => p.page === found.page)!;
    const printed = rowBase(page.text, found.offset);
    if (printed === "sum_insured") {
      const b = sumInsuredBase(st, found, household, person);
      if (!b.ok) return { ok: false, why: b.why, asFact: true };
      const cur = currencyOf(b.raw, b.base.found.excerpt, household.documents[b.base.found.docIndex]);
      const value = Math.round(b.value * pct) / 100;
      return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: true }, base: b.base };
    }
    const base = moneyFiguresIn(st.percentOf!.baseAmount)[0]?.value ?? numbersIn(st.percentOf!.baseAmount)[0];
    if (!printed) return { ok: false, why: NO_PRINTED_BASE };
    if (base == null || !sameValue(printed.value, base)) return { ok: false, why: "the sum is not the one this row's table is a percentage of" };
    const cur = currencyOf(printed.raw, page.text, doc);
    const value = Math.round(base * pct) / 100;
    return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: true } };
  }
}
function plainAmount(st: ModelStatement, found: Found, household: Household): AmountCheck {
  const doc = household.documents[found.docIndex];
  const raw = (st.amount ?? "").trim();
  const figures = moneyFiguresIn(raw);
  const plain = numbersIn(raw);
  // One figure per amount: "S$1,250 to S$2,000" is a range, never an amount.
  if (figures.length > 1 || plain.length > 1) return { ok: false, why: "an amount must be one figure" };
  const value = figures[0]?.value ?? plain[0];
  if (value == null) return { ok: false, why: "no amount given" };
  // Only a figure printed with its currency sign counts: a percentage, a count, a plan number or a code never does. A page
  // that declares one currency for all its figures (a policy schedule) gives that currency to a figure written as an amount.
  if (!moneyFiguresIn(found.excerpt).some((f) => sameValue(f.value, value))) {
    const pageText = doc.pages.find((p) => p.page === found.page)?.text ?? "";
    const table = tableCurrency(pageText, found.offset);
    const declared = pageCurrency(pageText) ?? table;
    const columns = table ? moneyTable(pageText, found.offset)!.plans : 0;
    const signed = figures[0]?.currency;
    // Under a table's own currency heading, a whole figure alone in a value cell ("...for Illness	100") is an amount too.
    const rows = pageText.slice(rowLine(pageText, found.offset).start).split("\n").slice(0, found.excerpt.split("\n").length).join("\n");
    // A row prices its figure only when it prints one, or one under each plan column: "Physiotherapy	80	12" under "Limit
    // Per Visit / Max visits" holds a count beside the limit, and no cell of it is read as money (R72-1).
    const cells = table ? rows.split("\n").flatMap((line) => {
      const own = [...line.matchAll(/\t[ ]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)[ ]*(?=\t|$)/g)].map((m) => Number(m[1].replace(/,/g, "")));
      return own.length === 1 || (columns > 1 && own.length === columns) ? own : [];
    }) : [];
    const inQuote = (v: number) => numbersIn(found.excerpt).some((n) => sameValue(n, v));
    if (!declared || !(plainAmountsIn(found.excerpt).some((v) => sameValue(v, value)) || cells.some((v) => sameValue(v, value) && inQuote(v))) || (signed && signed !== "$" && signed !== declared)) return { ok: false, why: "the amount is not printed with its currency in the quoted words" };
    const at = [...found.excerpt.matchAll(PLAIN_AMOUNT)].find((m) => sameValue(Number(m[1].replace(/,/g, "")), value)) ?? [...found.excerpt.matchAll(/(?<![\d.,])\d[\d,]*(?:\.\d+)?(?![\d.,]*\d)/g)].find((m) => sameValue(Number(m[0].replace(/,/g, "")), value));
    // A figure whose row names a count or a rate is not money, whatever the page's currency (R59-6).
    const label = at ? found.excerpt.slice(Math.max(0, found.excerpt.lastIndexOf("\n", at.index) + 1), at.index) : "";
    // "Per visit" and "per (policy) year" say how often a sum applies, not what is counted; "limit" never makes a count money (R68-1).
    const counted = label.replace(/\bper\s+(?:policy\s+)?(?:year|visit|annum)\b/gi, " ");
    if (/\b(?:units?|rates?|age|ages|years?|points?|factors?|percent(?:age)?|days?|months?|weeks?|times|ratio|count|number|no\.?|plans?|co-?insurance|sessions?|visits?|claims|stays?|admissions?|nights?|period|term|survival|waiting)\b/i.test(counted) && !/\b(?:premium|instalment|benefit|sum|amount|fee|cost|charge|payable|assured|insured|co-?payment|deductible|excess)\b/i.test(counted)) return { ok: false, why: "the figure's row names a count or a rate, not money" };
    return { ok: true, amount: { value, text: upTo(found.excerpt, at?.index ?? -1) + formatMoney(SIGN[declared] ?? declared + " ", value), currencyResolved: true, illustration: false } };
  }
  // The sign is the one the quoted words print with the figure ("$10,000" stays "$10,000" whatever the model wrote, R-H1).
  const printed = moneyFiguresIn(found.excerpt).find((f) => sameValue(f.value, value))!;
  const cur = currencyOf(printed.raw ?? raw, found.excerpt, doc);
  return { ok: true, amount: { value, text: upTo(found.excerpt, printed.raw ? found.excerpt.indexOf(printed.raw) : -1) + formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: false } };
}
/** "Up to " when the quoted words print the figure as a limit ("Up to S$500 per incident", "up to maximum of $500",
 * "funeral expenses of up to $2,000"): a cap is never shown as a plain amount (Evidence Reviewer, 21 Oct: B1, C2, D1, H10). */
const CAP_BEFORE = /\b(?:up\s+to|maximum|max\.?|not\s+exceeding|limited\s+to|capped\s+at)(?:\s+(?:a\s+)?(?:maximum|max\.?))?(?:\s+(?:amount\s+)?of)?\s*:?\s*$/i;
function upTo(excerpt: string, at: number): string {
  return at >= 0 && CAP_BEFORE.test(excerpt.slice(Math.max(0, at - 40), at)) ? "Up to " : "";
}

/** What a stay of the given length could pay under a daily benefit (release-set B3, H4), from the quoted words alone. It
 * is worked out only when the row and its own lines print exactly one daily figure ("$30 per day"), one day payment starts
 * ("after the 10th day", "from the 11th day"), one most-days figure ("up to a maximum of thirty (30) days", "Max: 30
 * days"), no other number of days, and no other day rule ("less than", "minimum", "at least", "per admission", "per
 * policy year", intensive care), R59-2. The stay must be one the household described as a stay ("in hospital 12 days",
 * "a 12-day stay"), R59-3. Anything less shows the daily benefit as printed. */
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
const STAY_WORDS = String.raw`(?:in\s+(?:the\s+)?hospital|hospitali[sz]ed|admitted|warded|stayed|stay(?:ing)?\s+in\s+(?:the\s+)?hospital)`;
function stayDaysWritten(asked: string[], days: number): boolean {
  const n = String.raw`(\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
  const res = [new RegExp(String.raw`\b${STAY_WORDS}\b(?:\s+(?:for|about|around))?\s+${n}\s*days?\b`, "gi"), new RegExp(String.raw`\b${n}[\s-]*days?\s+(?:in\s+(?:the\s+)?hospital|hospital\s+stay|stay)\b`, "gi"), new RegExp(String.raw`\b${n}-day\s+(?:hospital\s+)?stay\b`, "gi")];
  return asked.some((q) => res.some((re) => [...q.matchAll(re)].some((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()]) === days)));
}
const OTHER_DAY_RULE = /\b(?:less\s+than|minimum|at\s+least|per\s+(?:admission|confinement|policy\s+year|year|disability)|intensive|ICU|not\s+payable|waiting)\b/i;
function stayPays(st: ModelStatement, found: Found, household: Household, amount: NonNullable<Checked["amount"]>, asked: string[]): Stay | null {
  const stay = st.perDay?.stayDays;
  if (!stay || !Number.isInteger(stay) || stay < 1 || stay > 366 || !stayDaysWritten(asked, stay)) return null;
  const page = household.documents[found.docIndex].pages.find((p) => p.page === found.page)!;
  // The row with its own continuing lines, or the quote when it reaches further; each rule is read once.
  const row = rowWithContinuation(page.text, found.offset).replace(/\s+/g, " ");
  const quoted = found.excerpt.replace(/…$/, "").replace(/\s+/g, " ");
  const rule = squash(row).text.includes(squash(quoted).text) ? row : quoted;
  if (OTHER_DAY_RULE.test(rule)) return null;
  const dailies = moneyFiguresIn(rule).filter((f) => /^\s*(?:per|a|each)\s+day\b/i.test(rule.slice(rule.indexOf(f.raw ?? "") + (f.raw ?? "").length)));
  if (dailies.length !== 1 || !sameValue(dailies[0].value, amount.value)) return null;
  const starts = [...rule.matchAll(/\b(after|from)\s+(?:the\s+)?(\d+)\s*(?:st|nd|rd|th)?\s+day\b/gi)];
  const maxes = [...rule.matchAll(/\bmax(?:imum)?\.?\s*(?:of\s*)?:?\s*(?:[a-z-]+\s*)?\(?(\d+)\)?\s*days?\b/gi)];
  if (starts.length !== 1 || maxes.length !== 1) return null;
  const startDay = Number(starts[0][2]), most = Number(maxes[0][1]);
  // Every number of days printed is one of these two: "(30) days" and "10th day" only.
  const dayNumbers = [...rule.matchAll(/(\d+)\)?\s*(?:st|nd|rd|th)?\s+days?\b/gi)].map((m) => Number(m[1]));
  if (dayNumbers.some((d) => d !== startDay && d !== most)) return null;
  const unpaid = starts[0][1].toLowerCase() === "after" ? startDay : startDay - 1;
  const payable = Math.max(0, Math.min(stay - unpaid, most));
  const value = Math.round(amount.value * payable * 100) / 100;
  const sign = amount.text.replace(/^up to\s+/i, "").replace(/[\d,.\s]+$/, "");
  return { value, text: formatMoney(sign, value), currencyResolved: amount.currencyResolved, stay, payable, rule: `${amount.text} a day, paid from day ${unpaid + 1}, for at most ${most} days` };
}

type Billed = { raw: string; kind: RegExp | null };
/** Where the household wrote a bill figure in this conversation, as money ("$800", "800 dollars"), or null. */
function billWritten(bill: number, written: string[]): { q: string; value: number; currency: string; raw: string } | null {
  return written.flatMap((q) => [...moneyFiguresIn(q).map((f) => ({ q, value: f.value, currency: f.currency, raw: f.raw ?? "" })),
    ...[...q.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:dollars?|sgd)\b/gi)].map((m) => ({ q, value: Number(m[1].replace(/,/g, "")), currency: /sgd/i.test(m[0]) ? "SGD" : "$", raw: m[0] }))]).map((m) => ({ ...m, raw: m.raw.trim().replace(/[.,;:!?]+$/, "") })).find((m) => sameValue(m.value, bill)) ?? null;
}
/** The bill the household gave, as they wrote it, for a "not_found" point that says no cover in the documents pays it (the
 * GP bill of $800 when Outpatient Medicare is not on the certificate): one figure the household wrote in this conversation. */
function billUncovered(st: ModelStatement, written: string[]): Billed | null {
  const nums = numbersIn(st.ofBill?.bill ?? "");
  if (nums.length !== 1 || nums[0] <= 0) return null;
  const m = billWritten(nums[0], written);
  if (!m?.raw) return null;
  // The figure must be written as a bill, charge or cost ("GP bill was $800"), never a premium or a sum (TE #91 Q4).
  const at = m.q.indexOf(m.raw);
  const near = m.q.slice(Math.max(0, at - 40), at + m.raw.length + 25);
  if (at < 0 || !/\b(?:bills?|billed|charged?|charges|costs?|cost\s+me|invoice|receipt|fees?|paid|came\s+to)\b/i.test(near) || /\b(?:premium|instalment|sum\s+(?:insured|assured)|coverage|cover|savings?|salary)\b/i.test(near)) return null;
  return { raw: m.raw, kind: BILL_KINDS.find(([said]) => said.test(m.q))?.[1] ?? null };
}
/** What a bill was for, as the household wrote it, and how the documents name a benefit for that kind of bill. */
const BILL_KINDS: [RegExp, RegExp][] = [
  [/\bGPs?\b|general\s+practitioner|\b(?:poly)?clinics?\b|\bdoctors?\b/i, /\bGPs?\b|general\s+practitioner|medical\s+practitioner|\b(?:poly)?clinics?\b|\bdoctors?\b|\bconsultations?\b|outpatient/i],
  [/\bA\s*&\s*E\b|emergency/i, /\bA\s*&\s*E\b|emergency/i],
  [/specialist/i, /specialist/i],
  [/dental|dentist/i, /dental|dentist/i],
  [/physio/i, /physio/i],
  [/\bx-?ray|\blab(?:oratory)?\b|scan\b|diagnostic/i, /x-?ray|laborator|diagnostic|scan/i],
];
const billPhrase = (raw: string) => (/^[^\d\s]/.test(raw) ? `The ${raw} bill` : `The bill of ${raw}`);
/** Whether a bill can be said to be uncovered for a person (TE #91, Critic R77): it never can when an amount shown for
 * them takes a bill, comes from a per-visit or per-claim row, or names the same kind of care; nor when a document that may
 * be theirs prints a figure for that kind of care (their GP limit, whatever the model said); nor when the bill's kind is
 * not known or the person is not a household member. Leaning safe, the model's own finding then stands without the card. */
function billMayBeUncovered(household: Household, c: Checked, checked: Checked[]): boolean {
  const kind = c.billed?.kind;
  if (!kind || !c.person) return false;
  const theirs = (p: string | null) => !p || p === c.person;
  for (const o of checked) {
    if (!o.amount || !theirs(o.person) || !o.found) continue;
    const page = household.documents[o.found.docIndex].pages.find((p) => p.page === o.found!.page)?.text ?? "";
    const row = rowLine(page, o.found.offset).text;
    if (o.s.ofBill || kind.test(`${row} ${o.found.excerpt}`) || /\bper\s+(?:visit|claim|incident)\b|\bup\s+to\b/i.test(`${row} ${o.found.excerpt}`) || moneyTable(page, o.found.offset)?.perVisit) return false;
  }
  return !household.documents.some((d) => !unreadable(d) && (!d.linkedPeople.length || d.linkedPeople.some((p) => baseName(p) === c.person)) &&
    d.pages.some((p) => {
      // The care's name with a figure on its line or the next three: a table can print the name and its figures on
      // separate lines ("Physiotherapy" over its limits, Critic R78-1).
      const lines = p.text.split("\n");
      return lines.some((l, i) => kind.test(l) && lines.slice(i, i + 4).some((x) => /\d/.test(x.replace(/\b(?:19|20)\d\d\b/g, ""))));
    }));
}

/** How much of a bill the household gave a per-visit or per-claim limit could cover (the A&E bill of $800 against
 * Outpatient Medicare's S$100 limit per visit): the card shows the limit and says whether the bill is above or within it,
 * with no worked figure (what is paid or left over), and the bill as the household wrote it. Only
 * when the bill is one figure the household wrote in this conversation, in no other currency than the limit's, and the
 * limit is printed as a limit: "Up to", or a row under a "Limit(s) Per Visit/Claim/..." heading on its page. A co-payment,
 * deductible, excess or premium row is never a limit. Nothing else (co-payment, eligibility) is taken off. */
function billAgainst(st: ModelStatement, found: Found, household: Household, amount: NonNullable<Checked["amount"]>, written: string[]): Bill | null {
  const nums = numbersIn(st.ofBill?.bill ?? "");
  if (nums.length !== 1 || !(nums[0] > 0)) return null;
  const bill = nums[0];
  const sign = amount.text.replace(/^Up to\s+/i, "").replace(/[\d,.\s]+$/, "");
  // The bill is a figure the household wrote as money, in their own currency ("$800" stays theirs; "US$80" or "RM800"
  // never meets an S$ limit), for one visit or claim: "$300 for 2 visits" is not set against a per-visit limit (R68-2/3).
  // A count may have words between it and what it counts ("her 2 A&E visits", R72-2); a plural visit or claim, or "twice",
  // means more than one whatever the words.
  const MANY = /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|several|multiple|both)\s+(?:[^\s\d]+\s+){0,3}(?:days|nights|weeks|months|times)\b|\b(?:visits|claims|bills|admissions|sessions|consultations|trips|twice)\b/i;
  const mention = billWritten(bill, written);
  if (!mention || (mention.currency !== "$" && SIGN[mention.currency] !== sign) || MANY.test(mention.q)) return null;
  const raw = mention.raw.trim();
  const page = household.documents[found.docIndex].pages.find((p) => p.page === found.page)!.text;
  const row = rowLine(page, found.offset).text;
  if (/co-?\s?pay|deductible|excess|premium/i.test(row)) return null;
  // A per-day, per-week or per-year sum is not a limit on one bill (P6, P7).
  if (/\bper\s+(?:day|night|week|month|year|policy\s+year|annum|lifetime|admission)\b|\b(?:daily|weekly|annual|annually)\b/i.test(`${row} ${found.excerpt}`)) return null;
  if (!/^Up to /.test(amount.text) && !moneyTable(page, found.offset)?.perVisit) return null;
  // The bill stays as the household wrote it ("$800": its currency is theirs to say), and the card shows the limit only:
  // never a worked figure such as what is paid or left over, since the documents do not say how the co-payment comes off.
  return { text: `Up to ${formatMoney(sign, amount.value)}`, currencyResolved: amount.currencyResolved, bill: raw, within: bill <= amount.value };
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
const YEAR_BEFORE = new RegExp(String.raw`(?:\b(?:in|since|from|until|by|before|after|of|dated|issued|year|as\s+at|effective)|\b${MONTH})\s+(?:the\s+)?$`, "i");
const RATE_OR_TIME = /^\s*(?:%|per\s?cent|percent|-?\s*(?:calendar\s+)?(?:days?|nights?|weeks?|months?|years?|hours?|minutes?)\b)/i;
/** Whether a sentence states money, in any form (Critic round 40): a figure with a currency; "dollars"; a number with k, m,
 * mn, million, thousand, grand or bn after it; the words hundred, thousand, million, billion or grand; or any number of 100
 * or more that is not a percentage, a length of time, a page number, a year or part of a date. Amounts are shown only on the
 * server's cards, so no sentence the model wrote may carry one -- which is what keeps it from adding amounts or giving a
 * range, whatever words it uses. */
export function statesMoney(sentence: string): boolean {
  // Full-width digits ("S$１,０００,０００") are money as much as ASCII ones (Critic R92-1).
  sentence = (sentence ?? "").normalize("NFKC");
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
/** Sentences, without splitting after an abbreviation ("Group Policy No. G00750", "p. 13"). */
const JOIN = "\u2060";
export const sentences = (text: string) => sentencesOf((text ?? "").replace(/\b(No|Nos|no|nos|p|pp|Cl|cl|Ref|ref|approx|e\.g|i\.e|vs)\.\s+(?=[A-Z0-9])/g, `$1.${JOIN}`)).map((x) => x.replace(new RegExp(JOIN, "g"), " "));
function withoutMoney(text: string, dropped: string[], keep: (s: string) => string = (s) => s): string {
  return sentences(text ?? "").filter((s) => { const money = statesMoney(keep(s)); if (money) dropped.push(s); return !money; }).join(" ").trim();
}
/** A file name is never money ("output_2026.pdf", release-set E1, E2). */
const FILE_NAME = /[^\s$,()“”"']+\.(?:pdf|png|jpe?g|heic|webp|gif|tiff?|docx?|xlsx?)\b/gi;
/** Numbers the household's documents print as an identifier (release-set A1, B1, H8): a phone number ("6827 8000",
 * "+65 6820 8888"), a code with letters ("G00750"), or a bare number of six or more digits ("1234567"). A number in the
 * answer is read past only when the documents print that same identifier, and never when it is the value of an amount any
 * document prints with a currency (R42-1: "Call 1250" never stands on "S$1,250"). An identity number
 * ("S1234567A") is never read past. */
const IDENTIFIER = /(?<![\w$,+])(?<!\d\.)(?:\+\d{1,3}[ -]?)?\d{3,4}(?:[ -]\d{3,4}){1,2}(?![\w%$]|[.,]\d)|(?<![\w$])[A-Z]{1,3}\d{4,}[A-Z]?(?![\w]|[.,]\d)|(?<![\w$,])(?<!\d\.)\d{6,}(?![\w%$]|[.,]\d)/g;
const NRIC = /^[STFGM]\d{7}[A-Z]$/;
const idKey = (s: string) => s.replace(/[\s+-]/g, "").toUpperCase();
/** What kind of identifier a number is: a phone number by its shape, a code by its letters, and a bare number by the label
 * just before it ("Policy No. 1234567" is a policy number; "Call 1234567" asks for a phone number), as R42-1 requires. */
function idKind(id: string, before: string): string {
  if (/[A-Za-z]/.test(id)) return "code";
  if (/[\s+-]/.test(id.trim())) return "phone";
  const l = ID_LABEL.exec(before);
  return l ? labelKind(l[1]) : "number";
}
const ID_LABEL = /\b(phone|hotline|helpline|call|tel\.?|telephone|fax|(?:policy|certificate|claim)\s*(?:no\.?|number|#))\s*(?:on|at|is)?\s*:?\s*$/i;
const idsOf = new WeakMap<Household, Map<string, Set<string>>>();
function printedIdentifiers(household: Household): Map<string, Set<string>> {
  let ids = idsOf.get(household);
  if (ids) return ids;
  const amounts = new Set<number>();
  const found = new Map<string, Set<string>>();
  for (const d of household.documents) {
    if (unreadable(d)) continue;
    for (const p of d.pages) {
      for (const f of moneyFiguresIn(p.text)) amounts.add(CENT(f.value));
      for (const m of p.text.matchAll(IDENTIFIER)) {
        const k = idKey(m[0]);
        found.set(k, (found.get(k) ?? new Set()).add(idKind(m[0], p.text.slice(Math.max(0, (m.index ?? 0) - 40), m.index))));
      }
    }
  }
  // A code with letters is never an amount; a number made only of digits is never one the documents print as money.
  ids = new Map([...found].filter(([k]) => !NRIC.test(k) && (/[A-Z]/.test(k) || !amounts.has(CENT(Number(k))))));
  idsOf.set(household, ids);
  return ids;
}
/** What the money check reads of a sentence: file names and the documents' own identifiers taken out. */
function proseRead(household: Household): (s: string) => string {
  const ids = printedIdentifiers(household);
  return (s) => s.replace(FILE_NAME, " ").replace(IDENTIFIER, (m, at: number, whole: string) => {
    const kinds = ids.get(idKey(m));
    const kind = idKind(m, whole.slice(Math.max(0, at - 40), at));
    // A bare number with no label in the answer is read past only when the documents print it as plain number too, or when
    // the sentence calls it by the label the documents print it under ("the cover's own policy number ... is 3037850",
    // release-set H8).
    const named = kind === "number" && [...(kinds ?? [])].some((k) => /^(?:policy|certificate|claim)$/.test(k) && new RegExp(String.raw`\b${k}\s*(?:no\.?|number|#)`, "i").test(whole));
    return kinds && (kinds.has(kind) || named) ? " " : m;
  });
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
/** Every cover heading the household's documents print (certificates' product headings and the like), for reading
 * which section a passage sits in. */
const coversOf = new WeakMap<Household, Set<string>>();
function allCovers(household: Household): Set<string> {
  let c = coversOf.get(household);
  if (!c) { c = new Set(household.documents.filter((d) => !unreadable(d)).flatMap((d) => d.pages.flatMap((p) => headingsOf(p.text).map((h) => h.cover)))); coversOf.set(household, c); }
  return c;
}
/** Every page of a document that prints the words: the same sentence can open each cover's section ("If an Insured Person
 * dies ..."). */
function placesOf(household: Household, di: number, quote: string): Found[] {
  return household.documents[di].pages.flatMap((p) => onPage(household, di, p, quote));
}
/** Every place one page prints the words: "This Benefit can only be claimed ..." closes each sub-benefit on a page. */
function onPage(household: Household, di: number, page: HouseholdDocument["pages"][number], quote: string): Found[] {
  const out: Found[] = [];
  let text = page.text;
  for (let n = 0; n < 20; n++) {
    const f = locateQuote({ ...household, documents: [{ ...household.documents[di], pages: [{ ...page, text }] }] }, quote, 0);
    if (!f) break;
    out.push({ ...f, docIndex: di, excerpt: f.excerpt });
    // Blank what was matched (same length, so offsets hold) and look again.
    text = text.slice(0, f.offset) + " ".repeat(Math.min(text.length, f.offset + 1) - f.offset) + text.slice(f.offset + 1);
  }
  return out;
}
/** The line a printed amount moves to when its condition is printed only in another document (Evidence Reviewer, 21 Oct:
 * B1's S$250 recuperation card cited the Product Summary row, while its 24-hour stay condition is on the Benefit Summary
 * page that also prints the $250): the one line, on a page that prints one of the card's conditions, that prints the same
 * figure, in a document linked to the same people, in the same cover's section, under a sub-benefit title whose every
 * word is in the card's own row label ("J, Accidental Hospital Recuperation Benefit"), R60-2. Null when there is none or
 * more than one, and then the card stays as quoted. */
function lineWithCondition(household: Household, c: Checked, quotes: string[]): Found | null {
  const value = c.amount!.value;
  const hits = new Map<string, Found>();
  const from = household.documents[c.found!.docIndex];
  const covers = allCovers(household);
  const cover = sectionOf(from, c.found!.page, c.found!.offset, covers);
  const fromPage = from.pages.find((p) => p.page === c.found!.page)!.text;
  const label = new Set(labelWords(rowLine(fromPage, c.found!.offset).text));
  for (const q of quotes) for (let di = 0; di < household.documents.length; di++) {
    const d = household.documents[di];
    if (di === c.found!.docIndex || unreadable(d) || !d.linkedPeople.length || people(d) !== people(from)) continue;
    for (const f of placesOf(household, di, q)) {
      const text = d.pages.find((p) => p.page === f.page)!.text;
      let at = 0;
      for (const line of text.split("\n")) {
        const start = at; at += line.length + 1;
        if (!moneyFiguresIn(line).some((m) => sameValue(m.value, value))) continue;
        const sub = subBenefitOf(d, f.page, start, covers);
        if (!cover || sectionOf(d, f.page, start, covers) !== cover || !sub || !labelWords(sub).every((w) => label.has(w))) continue;
        hits.set(`${di}:${f.page}:${start}`, { docIndex: di, page: f.page, excerpt: line.trim().replace(/[ \t]+/g, " "), offset: start + (line.length - line.trimStart().length) });
      }
    }
  }
  return hits.size === 1 ? [...hits.values()][0] : null;
}

/** The people a document is linked to, as one key. */
const people = (d: HouseholdDocument) => [...d.linkedPeople].map(baseName).sort().join("|");
/** Whether a condition's quoted words state a condition of the statement (release-set B1, B5, H2):
 * - printed on the statement's own page; a footnote ("*This Benefit can only be claimed ...") only for a row that carries
 *   the same footnote mark;
 * - or printed elsewhere in the statement's own document, in the same section (the 365-day and visible-wound terms of the
 *   personal accident schedule a few pages on). A footnote never travels to another page;
 * - or, for a statement quoting a certificate line that names a household member under a cover heading ("GROUP LIVING
 *   CARE" above a member's S$350,000), printed in the section for that same cover of a document linked to the same
 *   people (the Living Care 90-day waiting period), R62-1.
 * A condition from another document's row is never put on this one (the Benefit Summary's "Core or Voluntary" on the
 * Product Summary's wrist row). */
function conditionApplies(household: Household, found: Found, quote: string): boolean {
  const doc = household.documents[found.docIndex];
  const page = doc.pages.find((p) => p.page === found.page);
  if (!page) return false;
  const lineOf = (text: string, offset: number) => { const start = text.lastIndexOf("\n", offset - 1) + 1; const end = text.indexOf("\n", offset); return text.slice(start, end < 0 ? undefined : end); };
  const covers = allCovers(household);
  const here = sectionOf(doc, found.page, found.offset, covers);
  const hereSub = subBenefitOf(doc, found.page, found.offset, covers);
  const onThisPage = onPage(household, found.docIndex, page, quote);
  for (const where of onThisPage) {
    const mark = FOOTNOTE.exec(lineOf(page.text, where.offset))?.[1];
    if (!mark) { if (subBenefitOf(doc, where.page, where.offset, covers) === hereSub) return true; continue; }
    // The row is the statement's line, with the mark printed after its first character (a row label such as "Ambulance Cost*").
    if (lineOf(page.text, found.offset).trimStart().slice(1).includes(mark)) return true;
  }
  if (onThisPage.length) return false;
  const footnote = (f: Found) => { const d = household.documents[f.docIndex]; return FOOTNOTE.test(lineOf(d.pages.find((p) => p.page === f.page)!.text, f.offset)); };
  const placesIn = (di: number) => placesOf(household, di, quote);
  if (placesIn(found.docIndex).some((f) => !footnote(f) && sectionOf(doc, f.page, f.offset, covers) === here && subBenefitOf(doc, f.page, f.offset, covers) === hereSub)) return true;
  const lineNo = page.text.slice(0, found.offset).split("\n").length - 1;
  const head = headingsOf(page.text).filter((h) => h.line < lineNo).at(-1);
  if (!head) return false;
  // Only for a line naming a household member, and only from a document linked to the same people (R62-1: a travel
  // policy linked to one spouse never lends its age rule to the other's group certificate line).
  const own = new Set(tokens(lineOf(page.text, found.offset)));
  if (!household.members.some((m) => { const t = tokens(baseName(m.name)); return t.length > 0 && t.every((w) => own.has(w)); })) return false;
  if (!doc.linkedPeople.length) return false;
  return household.documents.some((d, di) => di !== found.docIndex && !unreadable(d) && people(d) === people(doc) && placesIn(di).some((f) => !footnote(f) && sectionOf(d, f.page, f.offset, covers) === head.cover));
}
/** A lettered sub-benefit title within a cover's section ("A. Death due to Accident", "M. Comatose State Lump Sum
 * Benefit", "J, Accidental Hospital Recuperation Benefit", "C. ... (continued)"): a short title-case line with no figures. Numbered lines are a schedule's rows ("7. Loss
 * of ... both hands"), not sub-benefits. */
const SUB_BENEFIT = /^\s*[A-Z][.,)]\s+([A-Z][A-Za-z&'’\/,\- ()]{2,80}?)\s*$/;
/** The sub-benefit a passage sits under, within its section (R59-4): conditions never travel between sub-benefits. Empty
 * when the passage is at the cover's own level. */
function subBenefitOf(doc: HouseholdDocument, page: number, offset: number, covers: Set<string>): string {
  let sub = "";
  for (const p of doc.pages) {
    if (p.page > page) break;
    const text = p.page === page ? p.text.slice(0, offset) : p.text;
    const lines = p.text.split("\n");
    text.split("\n").forEach((l, i) => {
      if (sectionHeading(l, covers) ?? schemeSection(l, lines.slice(i + 1, i + 4), covers)) { sub = ""; return; }
      const m = SUB_BENEFIT.exec(l);
      const title = m?.[1].replace(/\(\s*continued\s*\)/i, "").trim().toLowerCase();
      if (title && title.split(/\s+/).length <= 8) sub = title;
    });
  }
  return sub;
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
export type VerifyReport = { dropped: { kind: string; why: string; text: string }[]; sentencesLeftOut: string[]; questionsLeftOut: string[]; conditionsLeftOut: string[]; keptAsFact?: { why: string; text: string }[] };

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
  return sentences(text ?? "").filter((x) => { const q = asks(x); if (q) dropped.push(x); return !q; }).join(" ").trim();
}
/** The model's JSON as a ModelAnswer, or null when it is not one. */
export function readModelAnswer(json: unknown): ModelAnswer | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  if (typeof o.bottomLine !== "string" || !Array.isArray(o.statements)) return null;
  const kinds = new Set(["amount", "fact", "not_found", "uncertainty"]);
  const perDayOf = (v: unknown) => (v && typeof v === "object" && typeof (v as { stayDays?: unknown }).stayDays === "number" ? { stayDays: (v as { stayDays: number }).stayDays } : null);
  const statements = (o.statements as Record<string, unknown>[]).filter((s) => s && typeof s === "object" && kinds.has(String(s.kind)) && typeof s.text === "string").map((s) => ({
    kind: s.kind as ModelStatement["kind"], text: String(s.text),
    person: typeof s.person === "string" ? s.person : null, document: typeof s.document === "string" ? s.document : null,
    quote: typeof s.quote === "string" ? s.quote : null, amount: typeof s.amount === "string" ? s.amount : null,
    percentOf: readPercentOf(s.percentOf),
    conditions: readConditions(s.conditions), alternativeGroup: typeof s.alternativeGroup === "string" && s.alternativeGroup.trim() ? s.alternativeGroup.trim() : null,
    perDay: perDayOf(s.perDay),
    ofBill: s.ofBill && typeof s.ofBill === "object" && typeof (s.ofBill as { bill?: unknown }).bill === "string" ? { bill: (s.ofBill as { bill: string }).bill } : null,
  }));
  return { bottomLine: o.bottomLine, statements, nextSteps: asStrings(o.nextSteps).slice(0, 3), question: typeof o.question === "string" && o.question.trim() ? o.question.trim() : null };
}

/** A document as the household knows it: its product name, with the file name when two documents share one. */
/** A document as the household would name it: its product, told apart from another file of the same product by the
 * file's own name when a person chose it ("Product Summary"), or else by what kind of document it is. A name a machine
 * gave the file ("817d6e8b-....pdf", "output_202609281146053.pdf") is never shown as a source. Two documents that would
 * still read the same are told apart by their upload date, and then by their order (TE #102). */
function docLabel(household: Household, d: HouseholdDocument): string {
  const base = (x: HouseholdDocument) => {
    const product = x.productName?.trim();
    const own = personalFileName(x.name);
    const kind = x.documentRole ? x.documentRole.replace(/_/g, " ") : null;
    if (!product) return { label: own ?? [x.insurer?.trim(), kind ?? "document"].filter(Boolean).join(" ").replace(/^./, (c) => c.toUpperCase()), inside: null as string | null };
    const shared = household.documents.some((o) => o !== x && o.productName?.trim().toLowerCase() === product.toLowerCase());
    const apart = own ?? kind;
    return shared && apart ? { label: product, inside: apart } : { label: product, inside: shared ? "" : null };
  };
  const text = (b: { label: string; inside: string | null }, extra: string[] = []) => {
    const inside = [b.inside, ...extra].filter(Boolean).join(", ");
    return inside ? `${b.label} (${inside})` : b.label;
  };
  const mine = base(d);
  const same = household.documents.filter((o) => text(base(o)).toLowerCase() === text(mine).toLowerCase());
  if (same.length < 2) return text(mine);
  const day = (x: HouseholdDocument) => x.uploadedAt ? `uploaded ${sgDay(x.uploadedAt)}` : null;
  const byDay = same.filter((o) => day(o) === day(d));
  if (day(d) && byDay.length === 1) return text(mine, [day(d)!]);
  return text(mine, [day(d), `file ${same.indexOf(d) + 1} of ${same.length}`].filter((x): x is string => !!x));
}
const sgDay = (iso: string) => {
  const t = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(t.getTime()) ? iso.slice(0, 10) : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" });
};
/** A file's name without its extension, when a person gave it; null for a name a scanner, app or upload gave it. */
export function personalFileName(name: string): string | null {
  const base = (name ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").trim();
  if (!/[A-Za-z]{3,}/.test(base)) return null;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(base) || /^[0-9a-f]{16,}$/i.test(base)) return null;
  // A name made only of words apps and devices give files ("WhatsApp Image 2026-09-01 at 10.15.32", "Screenshot ...",
  // "document (3)", "Download (1)", "PXL_20260901_101532"), with dates, times and counters, is not a name a person chose.
  const rest = base.replace(/(?<![A-Za-z])(?:whatsapp|image|img|screenshot|screen\s*shot|scan|scanned|camscanner|document|doc|file|download|upload|untitled|pdf|photo|pxl|dsc|mvimg|output|attachment|print|copy|of|at|am|pm)(?![A-Za-z])/gi, " ");
  if (!/[A-Za-z]{2,}/.test(rest.replace(/[\d_.:()\s-]+/g, " "))) return null;
  return base;
}

/** What the library records about a file, in the server's words. */
/** A question about the library itself: which documents there are, or whose. */
const ABOUT_DOCUMENTS = /\b(?:documents?|files?|uploads?|uploaded|paperwork)\b/i;
const ABOUT_FILE = /\b(?:read|readable|unreadable|linked|link|uploaded|upload|scan(?:ned)?|failed)\b/i;
function libraryFact(household: Household, d: HouseholdDocument): string {
  // A point about the file itself names the file as it was uploaded, so the household can find it on the Documents page.
  const label = d.productName?.trim() ? docLabel(household, d) : d.name;
  const named = label === d.name ? d.name : `${label} (${d.name})`;
  const read = unreadable(d) ? `${named} could not be read (status: ${d.processingStatus}), so nothing in it was used.` : `${named} was read.`;
  const linked = d.linkedPeople.length ? ` It is linked to ${d.linkedPeople.map(baseName).join(" and ")} in DearPolicy.` : " It is not linked to anyone in DearPolicy; it can be linked on the Documents page.";
  return `${read}${linked}${d.uploadedFor ? ` It was uploaded for ${baseName(d.uploadedFor)}.` : ""}`;
}

function libraryCount(household: Household): string {
  const bad = household.documents.filter(unreadable);
  const n = household.documents.length;
  return `Of your ${n} uploaded files, ${n - bad.length} ${n - bad.length === 1 ? "was" : "were"} read${bad.length ? ` and ${bad.length} could not be read (${bad.map((d) => d.name).join(", ")})` : ""}.`;
}

/** A sentence that only says amounts are separate: "They are not a total.", "These are different benefits, not a total;
 * the insurer decides which applies." Anything with a number, a time limit or a condition is more than that. */
/** The household members a sentence names, by the words of each one's name that no other member's name has ("Desmond",
 * "Charmaine"). */
export function membersNamedIn(household: Household, text: string): string[] {
  const people = household.members.map((m) => baseName(m.name));
  const words = (n: string) => n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
  const t = ` ${text.toLowerCase().replace(/[^a-z]+/g, " ")} `;
  return people.filter((p) => words(p).filter((w) => !people.some((o) => o !== p && words(o).includes(w))).some((w) => t.includes(` ${w} `)));
}
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
// Only a plain count ("four documents", "3 uploaded files"): "two travel documents" counts something else (Critic R131-4).
const DOC_COUNT = new RegExp(String.raw`\b(${COUNT_WORDS.join("|")}|\d{1,2})\s+(?:(?:uploaded|linked)\s+)?(?:documents?|files?|uploads?)\b`, "i");
/** The names a sentence can call a document by: its file name when it is a name ("Product Summary.pdf"), and its product. */
function docNames(d: HouseholdDocument): string[] {
  const own = personalFileName(d.name);
  return [own, d.name.replace(/\.[a-z0-9]{2,4}$/i, ""), d.productName].filter((x): x is string => !!x && /[a-z]{3}/i.test(x) && x.split(/\s+/).length <= 8 && !/^[0-9a-f-]{20,}$/i.test(x));
}
/** Sentences of the model's own words about the library itself, held to the library's own record (live run 22 Oct, E4, A8):
 * - a count of a person's (or the household's) documents that is not the count of documents linked to them (or uploaded)
 *   is replaced by the right count, in the server's words;
 * - "uploaded for (under) <person>" or "linked (only) to <people>" said of a document the record does not upload for, or
 *   link to, them is left out;
 * - a premium sentence saying the insurer decides which premium applies is left out (a printed premium is what is charged).
 * Any other sentence is kept as written. */
/** "The insurer decides which premium applies", "Singlife decides if they differ", "the one to rely on": said of premiums, never
 * of a printed rule such as a premium waiver ("waived if the insurer determines you are disabled", Critic R131-3). */
const PREMIUM_DECIDES = (x: string) => /\bpremiums?\b/i.test(x) && /\b(?:decides?|will\s+decide|determines?)\s+(?:which|what)\b|\b(?:decides?|will\s+decide|determines?)\s+(?:if|whether)\s+(?:they|the\s+\w+(?:\s+\w+)?)\s+(?:differ|appl(?:y|ies))\b|\bwhich\s+(?:premium|figure|amount|one)\s+applies\b|\bto\s+rely\s+on\b/i.test(x);
function libraryClaimsRead(household: Household, left: string[]): (text: string, statement?: boolean) => string {
  const live = household.documents.filter((d) => !d.supersededAt);
  return (text: string, statement = false) => {
    // A printed premium is what is charged: "the insurer decides which premium applies" is never said (release-set A6). A
    // statement built on it is left out whole, so no sentence that only explained it is left standing.
    if (statement && PREMIUM_DECIDES(text)) { left.push(text); return ""; }
    return sentences(text).flatMap((x) => {
    if (PREMIUM_DECIDES(x)) { left.push(x); return []; }
    const named = membersNamedIn(household, x);
    const count = DOC_COUNT.exec(x);
    if (count && /\b(?:has|have|had|linked|uploaded|in\s+(?:your|the)\s+library|there\s+(?:are|is))\b/i.test(x) && !/\b(?:print|prints|printed|show|shows|say|says|list|lists|give|gives|differ|different)\b/i.test(x) && named.length <= 1) {
      const said = COUNT_WORDS.indexOf(count[1].toLowerCase()) >= 0 ? COUNT_WORDS.indexOf(count[1].toLowerCase()) : Number(count[1]);
      const person = named[0] ?? null;
      const truth = person ? live.filter((d) => d.linkedPeople.some((p) => baseName(p) === person)).length : live.length;
      if (said !== truth) {
        left.push(x);
        const n = `${truth} document${truth === 1 ? "" : "s"}`;
        return [person ? `${person} has ${n} linked in DearPolicy.` : `Your library has ${n}.`];
      }
    }
    const docs = live.filter((d) => docNames(d).some((n) => x.toLowerCase().includes(n.toLowerCase())));
    // "No document is linked to Alex" says what no file is: not a claim about a named file.
    const negated = (at: number) => /\b(?:no|not|never|none|nothing|neither|nor)\b|n't\b/i.test(x.slice(0, at).split(/[,;]|\b(?:and|but|while)\b/i).pop() ?? "");
    const uploaded = /\buploaded\s+(?:under|for|in)\b([^.;]*)/i.exec(x);
    if (uploaded && docs.length && !negated(uploaded.index)) {
      const whom = membersNamedIn(household, uploaded[1]);
      if (whom.length && docs.some((d) => !d.uploadedFor || !whom.includes(baseName(d.uploadedFor)))) { left.push(x); return []; }
    }
    const linked = /\blinked\s+(only\s+)?to\b([^.;]*)/i.exec(x);
    if (linked && docs.length && !negated(linked.index)) {
      const whom = membersNamedIn(household, linked[2]);
      const to = (d: HouseholdDocument) => d.linkedPeople.map(baseName);
      if (whom.length && docs.some((d) => whom.some((w) => !to(d).includes(w)) || (!!linked[1] && to(d).some((p) => !whom.includes(p))))) { left.push(x); return []; }
    }
    return [x];
  }).join(" ");
  };
}
function onlyNotATotal(sentence: string, docNames: string[] = [], differOk = false): boolean {
  // "The Product Summary and the Benefit Summary print different wrist fracture figures, so the insurer decides which
  // applies." says what the server's note says, once the documents' and the benefit's names are set aside, but only when
  // the server's notes cover every amount shown (`differOk`): otherwise it may be about amounts no note covers (TE #102).
  const differ = differOk && /\b(?:print|prints|printed|show|shows|give|gives|list|lists|state|states)\s+(?:different|differing)\b[^.]*\b(?:figures?|amounts?|sums?)\b/i.test(sentence) && /\binsurer\s+decides\s+which\b/i.test(sentence);
  if (!(/\bnot (?:a|the) total\b/i.test(sentence) || differ) || /\d/.test(sentence)) return false;
  if (/\b(?:within|days?|weeks?|months?|deadline|notice|must|only|if|when|whenever|where|while|unless|except|provided|subject to|waiting|exclu\w*|after|before|until|once|newer|older|latest|later|earlier|dated)\b/i.test(sentence)) return false;
  let rest = sentence;
  for (const n of docNames) rest = rest.split(n).join(" ");
  if (differ) rest = rest.replace(/\b(?:print|prints|printed|show|shows|give|gives|list|lists|state|states)\s+(?:different|differing)\b[^.]*?\b(?:figures?|amounts?|sums?)\b/gi, " ").replace(/\b(?:product|benefit|summary|summaries|certificate|schedule|policy|wording|brochure)\b/gi, " ")
    // "... for the same wrist fracture, so ..." only names the benefit the cards already show.
    .replace(/\bfor\s+(?:the\s+same|this|that)\s+[a-z' -]{1,40}?(?=\s*[,;]|\s+so\b)/gi, " ").replace(/\b(?:two|both)\b/gi, " ");
  rest = rest.replace(/\bnot (?:a|the) total\b/gi, " ").replace(/\b(?:they|these|this|it|are|is|amounts?|figures?|benefits?|separate|different|and|so|the|insurer|decides|which|one|applies|alternatives?|added|together|not|each|other|from|parts?|of|your|documents?|but|be|can|cannot|should)\b/gi, " ");
  return !/[a-z]{3,}/i.test(rest);
}

/** How an illustration was worked out, in plain words with its sources. */
function basisOf(household: Household, c: Checked): string {
  const po = c.s.percentOf!;
  if (!c.base) return `${po.percent}% of ${po.baseAmount}`;
  const bdoc = household.documents[c.base.found.docIndex];
  const cover = c.base.cover.replace(/\b\w/g, (x) => x.toUpperCase());
  const asOf = c.base.asOf ? `, as of ${c.base.asOf.split("-").reverse().join("/")}` : "";
  return `${po.percent}% of ${c.person}'s ${cover} sum insured of ${formatMoney(currencyOf(po.baseAmount, c.base.found.excerpt, bdoc).sign, moneyFiguresIn(po.baseAmount)[0].value)} (${docLabel(household, bdoc)}, page ${c.base.found.page}${asOf})`;
}

/** `written` is what the household wrote in this conversation (this question first): a stay length is taken only from it. */
/** `serverWords`: statement texts the server wrote itself (the benefit table's row labels, lib/benefit-table/chat.ts). Only a
 * statement whose text is exactly one of them keeps its words without the money filter; everything else is filtered. */
export function verifyAnswer(household: Household, model: ModelAnswer, written: string[] = [], serverWords: ReadonlySet<string> = new Set()): { answer: StructuredAnswer; report: VerifyReport } {
  const report: VerifyReport = { dropped: [], sentencesLeftOut: [], questionsLeftOut: [], conditionsLeftOut: [], keptAsFact: [] };
  const checked: Checked[] = [];
  const read = proseRead(household);
  const library = libraryClaimsRead(household, report.sentencesLeftOut);
  const aboutFiles = new Set<number>();
  for (const st of model.statements) {
    const preferred = st.document ? Number(/^D(\d+)$/i.exec(st.document.trim())?.[1] ?? NaN) - 1 : null;
    const found = st.quote ? locateQuote(household, st.quote, Number.isFinite(preferred) ? preferred : null) ?? (st.kind === "amount" && moneyFiguresIn(st.quote).length ? acrossTwoLines(household, st.quote) : null) : null;
    const person = matchMember(household, st.person);
    if (st.kind === "amount") {
      if (!found) { report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue; }
      let r = checkAmount(st, found, household, person);
      // 100% of the sum insured is the sum insured: when the percentage cannot be tied to a table row ("100% of the Sum
      // Assured will be payable in one lump sum"), the amount is the person's sum insured as their own schedule prints it
      // (live run 22 Oct, A3), only where wholeSumInsured finds it is theirs for this policy (Critic R126-1).
      let whole: string | null = null;
      if (!r.ok && WHOLE_FALLBACK.has(r.why) && st.percentOf?.percent === 100 && person && !limitedWords(household, found)) {
        const bf = wholeSumInsured(st, found, household, person, serverWords);
        const plain = bf ? plainAmount({ ...st, percentOf: null, amount: st.percentOf.baseAmount, quote: bf.excerpt }, bf, household) : null;
        // The card stays on the wording's own page, so its conditions are read there, and says where the sum is printed.
        if (bf && plain?.ok) {
          r = { ...plain, found };
          whole = `100% of ${person}'s sum insured of ${plain.amount.text} (${docLabel(household, household.documents[bf.docIndex])}, page ${bf.page})`;
        }
      }
      if (!r.ok) {
        if (!r.asFact) report.dropped.push({ kind: st.kind, why: r.why, text: st.text });
        else report.keptAsFact!.push({ why: r.why, text: st.text });
        // A percentage that is not worked out is kept as the printed percentage, without an amount. A benefit table's label
        // does not print the percentage (the card's own line does), so it is said here.
        if (st.percentOf) {
          const pct = serverWords.has(st.text) ? `${st.text.replace(/\.\s*$/, "")}: ${st.percentOf.percent}% of ${st.percentOf.baseQuote ? "the sum insured" : "the figure its table prints"}.` : st.text;
          checked.push({ s: { ...st, text: pct, kind: "fact", amount: null, percentOf: null, alternativeGroup: null }, found: r.found ?? found, amount: null, person, note: null });
        }
        continue;
      }
      const at = r.found ?? found;
      checked.push({ s: st, found: at, amount: r.amount, person, note: null, base: r.base ?? null, whole, stay: st.perDay && !r.amount.illustration ? stayPays(st, at, household, r.amount, written) : null, bill: st.ofBill && !r.amount.illustration ? billAgainst(st, at, household, r.amount, written) : null });
    } else if (st.kind === "fact") {
      if (!found) {
        // A point about a file itself (whether it could be read, whom it is linked to) has no words on any page to quote: it
        // is stated from the library's own record of that file instead, in the server's words (release-set E2, E3).
        const di = Number.isFinite(preferred) ? (preferred as number) : -1;
        // When the question is about the documents themselves ("show me Charmaine's documents"), any unquoted point about one
        // file is said the same way (release-set E4).
        if (di >= 0 && di < household.documents.length && (ABOUT_FILE.test(st.text) || ABOUT_DOCUMENTS.test(written[0] ?? ""))) {
          if (!aboutFiles.has(di)) { aboutFiles.add(di); checked.push({ s: { ...st, text: libraryFact(household, household.documents[di]), person: null, conditions: [], alternativeGroup: null }, found: null, amount: null, person: null, note: null }); }
          continue;
        }
        // A point about several files at once ("The other documents (D1, D2, ...) were read") is stated as the library's count.
        if (di < 0 && /\bD\d+\b/.test(st.text) && ABOUT_FILE.test(st.text)) {
          if (!aboutFiles.has(-1)) { aboutFiles.add(-1); checked.push({ s: { ...st, text: libraryCount(household), person: null, conditions: [], alternativeGroup: null }, found: null, amount: null, person: null, note: null }); }
          continue;
        }
        report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue;
      }
      checked.push({ s: st, found, amount: null, person, note: null });
    } else {
      checked.push({ s: st, found, amount: null, person, note: null, billed: st.kind === "not_found" && st.ofBill ? billUncovered(st, written) : null });
    }
  }
  // A bill set against a limit is never also said to be uncovered for the same person, and one bill gets one card.
  const carded = new Set<string>();
  for (const c of checked) {
    const key = `${c.person}:${c.billed?.raw}`;
    c.uncovered = c.billed && !carded.has(key) && billMayBeUncovered(household, c, checked) ? c.billed.raw : null;
    if (c.uncovered) carded.add(key);
  }
  // What a source says about the person it is used for: not linked to them, or replaced by a later version.
  for (const c of checked) {
    if (!c.found) continue;
    const doc = household.documents[c.found.docIndex];
    const notes: string[] = [];
    if (c.person && doc.linkedPeople.length && !doc.linkedPeople.some((p) => baseName(p) === c.person)) notes.push(`This document is not linked to ${c.person} in your library.`);
    else if (c.person && !doc.linkedPeople.length) notes.push("This document is not linked to anyone in your library.");
    if (doc.supersededAt) notes.push(`This document was replaced by a later version on ${doc.supersededAt.slice(0, 10)}.`);
    c.note = notes.join(" ") || null;
  }
  // A condition is kept only when its quoted words are printed on the statement's own page, and, when they are a footnote
  // ("*This Benefit can only be claimed ..."), only for a row that carries the same footnote mark (release-set B1).
  for (const c of checked) {
    const fits = (f: Found | null) => c.s.conditions.filter((x) => f && x.quote && conditionApplies(household, f, x.quote));
    let kept = fits(c.found);
    const away = c.s.conditions.filter((x) => !kept.includes(x) && x.quote && c.found && !placesOf(household, c.found.docIndex, x.quote).length && household.documents.some((d, di) => !unreadable(d) && placesOf(household, di, x.quote!).length));
    // A printed amount whose own condition is printed only in another document is moved to that document's line for the
    // same figure, so it never stands without the condition (B1's S$250). A worked-out amount never moves.
    if (c.found && c.amount && !c.amount.illustration && away.length) {
      const line = lineWithCondition(household, c, away.map((x) => x.quote!));
      const moved = line ? plainAmount({ ...c.s, quote: line.excerpt }, line, household) : null;
      if (line && moved?.ok && fits(line).length > kept.length) { c.found = line; c.amount = moved.amount; kept = fits(line); }
    }
    c.conditions = kept.map((x) => x.text);
    report.conditionsLeftOut.push(...c.s.conditions.filter((x) => !kept.includes(x)).map((x) => x.text));
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
  const uncoveredCard = (c: Checked, i: number) => {
    if (!c.uncovered) return;
    const said = `${billPhrase(c.uncovered)} you gave is not shown to be covered by ${c.person}'s documents; only the insurer can confirm.`;
    statements.push({ id: `s${i + 1}-bill`, kind: "not_found", text: said, fullText: said, personName: c.person, amount: null, basis: null, conditions: [], asOf: null, source: null, group: null });
  };
  checked.forEach((c, i) => {
    if (c.found && !c.amount) {
      const key = `${c.found.docIndex}:${c.found.page}:${squash(c.found.excerpt).text}`;
      if (seenRows.has(key)) return;
      seenRows.add(key);
    }
    const doc = c.found ? household.documents[c.found.docIndex] : null;
    const said = serverWords.has(c.s.text) ? c.s.text : withoutMoney(withoutQuestions(c.s.text, report.questionsLeftOut), report.sentencesLeftOut, read);
    let text = serverWords.has(c.s.text) ? said : library(said, true);
    // A point the library's record or the premium rule leaves out is not shown at all.
    if (said && !text && !c.amount) return;
    // With no words of its own left, a card says what its source prints (the quoted words carry the benefit's name).
    if (!text && doc && c.found) text = `${docLabel(household, doc)} prints: “${c.found.excerpt}”`;
    // A finding left with no words (its only sentence stated money) still shows the bill it says is uncovered (TE #91 Q8).
    if (!text) { uncoveredCard(c, i); return; }
    const conditions = (c.conditions ?? []).map((x) => withoutMoney(withoutQuestions(x, report.questionsLeftOut), report.sentencesLeftOut, read)).filter(Boolean);
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
      basis: c.amount?.illustration && c.s.percentOf ? basisOf(household, c) : c.whole ?? null,
      conditions, asOf: c.base?.asOf ?? null, source, group: gid ? { id: gid, kind: "either_or", note: ALTERNATIVES_NOTE } : null,
    });
    if (c.stay) {
      const st = c.stay;
      const said = st.payable > 0
        ? `For a ${st.stay}-day stay, this works out to ${st.payable} day${st.payable === 1 ? "" : "s"} of the daily benefit.`
        : `A ${st.stay}-day stay ends before this daily benefit starts, so it pays nothing for that stay.`;
      statements.push({
        id: `s${i + 1}-stay`, kind: "calculation", text: said, fullText: said, personName: c.person,
        amount: st.payable > 0 ? { text: st.text, currencyResolved: st.currencyResolved, illustration: true } : null,
        basis: `${st.rule} (${st.payable} × ${c.amount!.text}), for the stay you described`,
        conditions, asOf: null, source, group: null,
      });
    }
    if (c.bill) {
      const b = c.bill, limit = b.text.replace(/^Up to /, "");
      const said = b.within
        ? `${billPhrase(b.bill)} you gave is within the ${limit} limit, so it could be reimbursed up to the bill, subject to any co-payment; the insurer decides what is paid.`
        : `${billPhrase(b.bill)} you gave is above the ${limit} limit, so it could be reimbursed only up to ${limit}, subject to any co-payment; the insurer decides what is paid.`;
      statements.push({
        id: `s${i + 1}-bill`, kind: "calculation", text: said, fullText: said, personName: c.person,
        amount: { text: b.text, currencyResolved: b.currencyResolved, illustration: true },
        basis: `${billPhrase(b.bill).replace(/^The/, "the")} you gave, set against the ${limit} limit printed in the document; how the co-payment comes off is not stated`,
        conditions, asOf: null, source, group: null,
      });
    }
    uncoveredCard(c, i);
  });
  const noted: Checked[] = [];
  for (const members of notTotals) {
    const who = members[0].person;
    const shown = members.filter((m) => statements.some((s) => s.amount?.text === m.amount!.text && s.personName === m.person));
    if (shown.length < 2) continue;
    noted.push(...shown);
    // The person is named only when the answer gives amounts for more than one person.
    const others = statements.some((s) => s.amount && s.personName && s.personName !== who);
    const said = shown.map((m, k) => (k ? m.amount!.text.replace(/^Up to /, "up to ") : m.amount!.text));
    // "S$1,250 and S$120,000": the amounts' own commas never stand in for the list's.
    const list = `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
    const text = `${list}${who && others ? ` for ${who}` : ""} come from different parts of your documents. They are not a total; the insurer decides which applies.`;
    statements.push({ id: `not-total-${statements.length + 1}`, kind: "uncertainty", text, fullText: text, conditions: [] });
  }
  // Said once: the server's note, which names the amounts, is always kept (Critic R121-1). In a point of the model's own,
  // only a sentence that says nothing but "not a total" (or that the documents print different figures and the insurer
  // decides which applies) is left out; any other words (a deadline, a condition) stay, and the point goes only when
  // nothing else is left (Critic R122-1, TE #101).
  if (statements.some((s) => s.id.startsWith("not-total-"))) {
    const covered = new Set(noted.map((m) => `${m.person ?? ""}|${m.amount!.text}`));
    const differOk = statements.filter((s) => s.amount).every((s) => covered.has(`${s.personName ?? ""}|${s.amount!.text}`));
    const docNames = household.documents.flatMap((d) => [docLabel(household, d), d.productName?.trim() ?? "", personalFileName(d.name) ?? ""]).filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
    for (const s of [...statements]) {
      if (s.kind !== "uncertainty" || s.id.startsWith("not-total-")) continue;
      const kept = sentences(s.text).filter((x) => !onlyNotATotal(x, docNames, differOk));
      if (kept.length === sentences(s.text).length) continue;
      if (!kept.length) statements.splice(statements.indexOf(s), 1);
      else if (kept.length < sentences(s.text).length) { s.text = kept.join(" "); s.fullText = s.text; }
    }
  }
  // A left-out amount is always said, so the household never takes the cards shown for all there is. A left-out point that
  // is not an amount stays in the report only: a line saying a point was left out tells the household nothing they can use.
  if (report.dropped.some((d) => d.kind === "amount")) statements.push({ id: "left-out-amount", kind: "uncertainty", text: LEFT_OUT_AMOUNT, fullText: LEFT_OUT_AMOUNT, conditions: [] });
  let bottomLine = library(withoutMoney(withoutQuestions(model.bottomLine, report.questionsLeftOut), report.sentencesLeftOut, read));
  const labelled = labelledNumbersRead(citations);
  const nextSteps = model.nextSteps.map((x) => withoutMoney(withoutQuestions(x, report.questionsLeftOut), report.sentencesLeftOut, (t) => read(labelled(t)))).filter(Boolean);
  // One question back at most: the first one the model asks; any further question is left out.
  const asked = model.question ? sentences(model.question).filter(asks) : [];
  report.questionsLeftOut.push(...asked.slice(1));
  const question = asked.length ? withoutMoney(asked[0], report.sentencesLeftOut, read) : "";
  const shownAmounts = statements.filter((s) => s.amount).length;
  // The finding about a bill the household gave leads a dropped bottom line, unless an amount shown for that person may
  // pay it (Critic R77-2, TE #91 Q9).
  const finding = checked.find((c) => c.uncovered);
  const findingText = finding ? statements.find((x) => x.id === `s${checked.indexOf(finding) + 1}`)?.text : undefined;
  if (!bottomLine && findingText) bottomLine = findingText;
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
