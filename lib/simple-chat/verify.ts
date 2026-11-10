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
import { MONEY_SIGN } from "@/lib/format/currency";
import { documentId, failureAdvice, offersTryAgain, onHold, onHoldWords, pageList, readInPart, sentence, stillReading, unreadable, type Household, type HouseholdDocument } from "./library";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import type { ModelAnswer, ModelStatement } from "./prompt";
import { nameOnPage, otherLife } from "@/lib/benefit-table/lives";

export const LEFT_OUT_AMOUNT = "I left out an amount I couldn’t find printed in your documents.";
export const LEFT_OUT_FACT = "I left out a point I couldn’t find in your documents.";
/** Said when the model gave points and none passed the checks, so a bottom line that introduces them ("here is each adult's
 * list") never stands alone (stress run 23 Oct, S070). */
export const NOTHING_SHOWN = "I couldn’t match the points behind this answer to words in your documents, so none are shown. Please ask again, or open the documents on the Documents page.";
export const NO_ANSWER = "I couldn’t put together an answer from your documents. Please ask again, or ask about one benefit at a time.";
export const ALTERNATIVES_NOTE = "These are alternatives under one benefit in the same document, not a total.";
export const DISCLAIMER = "Answers come from the documents you uploaded. The insurer decides eligibility and the final amount.";

// ------------------------------------------------------------------ finding a quote in the stored pages
/** Text for matching: case, spacing, quote marks and dashes do not count. `at[i]` is where character i came from. */
function squash(s: string): { text: string; at: Int32Array } {
  // Characters are joined once and positions kept in a typed array: a cached page then holds a flat string and 4 bytes a
  // character, not a rope and a boxed array (Critic R445 M1).
  const chars: string[] = []; const at = new Int32Array(s.length); let n = 0;
  for (let i = 0; i < s.length; i++) {
    // Plain ASCII, nearly every character of a page, is decided by its code without a pattern test (Benefits load):
    // the same result as the general path below, which every other character still takes.
    const code = s.charCodeAt(i);
    if (code < 128) {
      if (code === 32 || (code >= 9 && code <= 13)) continue;
      chars.push(code === 96 ? "'" : code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : s[i]); at[n++] = i;
      continue;
    }
    let c = s[i];
    if (/\s/.test(c)) continue;
    if (/[“”„"]/.test(c)) c = "\"";
    else if (/[‘’‚`´]/.test(c)) c = "'";
    else if (/[‐‑‒–—―−]/.test(c)) c = "-";
    chars.push(c.toLowerCase()); at[n++] = i;
  }
  return { text: chars.join(""), at: at.slice(0, n) };
}
/** A stored page's squashed text, made once: every quote of a household is looked for on every page, so squashing the
 * page again for each quote made the Benefits page take seconds on a large library. The page text is the key, so an
 * edited or re-read page is squashed afresh; the cache is emptied once it holds about 8 million characters. */
const squashedPages = new Map<string, { text: string; at: Int32Array }>();
let squashedChars = 0;
function squashPage(s: string): { text: string; at: Int32Array } {
  const hit = squashedPages.get(s);
  if (hit) return hit;
  if (squashedChars + s.length > 8_000_000) { squashedPages.clear(); squashedChars = 0; }
  const sq = squash(s);
  squashedPages.set(s, sq); squashedChars += s.length;
  return sq;
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
      const sq = squashPage(page.text);
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
/** The currency of an amount, resolved only when the words it rests on print that currency, when a bare "$" stands in
 * a document that names Singapore dollars and no other currency anywhere in it (a Singapore scheme's benefit summary
 * prints "S$" in one table and "$250" in the next), or when it stands on a page that declares one currency for every
 * figure on it (pageCurrency: a policy schedule's "Insured Amount : $100,000.00  Currency : Singapore Dollar", in a long
 * pack whose fund pages name other currencies). The benefit table reads the same page declaration (check.ts). */
function currencyOf(amountText: string, evidence: string, doc?: HouseholdDocument, page?: number): Currency {
  const f = moneyFiguresIn(amountText)[0];
  const printed = moneyFiguresIn(evidence).map((x) => x.currency);
  const named = /\bSGD\b|S\$|Singapore dollars?/i.test(evidence) ? "SGD" : null;
  if (f && f.currency !== "$") return { sign: SIGN[f.currency] ?? f.currency, resolved: printed.includes(f.currency) || named === f.currency };
  if (printed.includes("SGD") || (named && !printed.some((c) => c !== "$" && c !== "SGD"))) return { sign: "S$", resolved: true };
  if (doc && !printed.some((c) => c !== "$") && documentCurrency(doc) === "SGD") return { sign: "S$", resolved: true };
  const declared = doc && page != null && !printed.some((c) => c !== "$") ? pageCurrency(doc.pages.find((p) => p.page === page)?.text ?? "") : null;
  if (declared && SIGN[declared]) return { sign: SIGN[declared], resolved: true };
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
/** Wording that speaks of an amount in no particular currency: "the dollar amount", "a dollar limit", "paid dollar for
 * dollar" (AIA schedule: "impose limits on the dollar amount"). Taken out before OTHER_WORDS looks for another currency's
 * "dollars"; only after a plain determiner or a paying verb, so "the US dollar amount" still counts. */
const NO_PARTICULAR_DOLLAR = /\b(?:the|a|any|each|this|that|such|same|total|maximum)\s+dollar(?:[\s-]+(?:amounts?|values?|limits?|figures?|terms)\b|[\s-]+for[\s-]+dollar\b)|\b(?:paid|payable|reduced|reimbursed|offset|matched)\s+(?:on\s+a\s+)?dollar[\s-]for[\s-]dollar\b/gi;
/** A sentence that, or whose neighbour, also names a place, a currency, money or funds may mean that place's dollar ("the
 * dollar amount in US currency", "a dollar limit of 500 Canadian", "The dollar amount is shown below. All amounts are in US
 * currency.", TE pr203 XN1-XN5 and XQ5-XQ7, Critic R392 L1): its wording keeps counting as maybe another currency.
 * Short forms ("US", "U.S.", "HK", "NZ", "NT") count in capitals only, so "payable to us" is not a place. */
const DOLLAR_PLACE_WORD = /\b(?:currenc(?:y|ies)|funds|mone(?:y|ys|ies)|countr(?:y|ies)|states|nation\w*|territor\w*|local|foreign|overseas|abroad|exchange|convert\w*|american|australian|aussie|canadian|hong\s*kong|new\s+zealand|kiwi|brunei\w*|taiwan\w*|fiji\w*|jamaica\w*|bahamian|bahamas|barbad\w*|belize\w*|bermud\w*|cayman|caribbean|liberian?|namibian?|guyan\w*|surinam\w*|trinidad\w*|tobago|zimbabwe\w*|solomon|tuval\w*|kiribati|ecuador\w*|salvador\w*|panama\w*|timor\w*|micronesia\w*|marshall|palau\w*)\b/i;
const DOLLAR_PLACE_CAPS = /(?<![A-Za-z])(?:U\.?S\.?(?:A\.?)?|HK|NZ|NT)(?![A-Za-z])/;
/** The text with NO_PARTICULAR_DOLLAR wording taken out, sentence by sentence, only from sentences that, with the sentence
 * before and the one after, name no place, currency, money or funds. A sentence ends at ".", "!", "?" or ";" before a space
 * or line break, or at a blank line; a single line break does not end one, since PDF text wraps mid-sentence ("impose
 * limits on the\ndollar amount"). A dollar named only by a place off the list ("Guam") is a known limit. */
function withoutPlainDollarWording(t: string): string {
  const sentences = t.split(/(?<=[.!?;])\s+|\n[ \t]*\n/);
  const placed = sentences.map((sentence) => DOLLAR_PLACE_WORD.test(sentence) || DOLLAR_PLACE_CAPS.test(sentence));
  return sentences
    .map((sentence, i) => (placed[i - 1] || placed[i] || placed[i + 1] ? sentence : sentence.replace(NO_PARTICULAR_DOLLAR, " ")))
    .join("\n");
}
/** "SGD" when a document's pages name Singapore dollars ("S$", "SGD", "Singapore dollars") and nothing in them may be
 * another currency; otherwise null. A bare "$" in such a document is a Singapore dollar. */
export function documentCurrency(doc: HouseholdDocument): string | null {
  if (docCurrencies.has(doc)) return docCurrencies.get(doc)!;
  const t = doc.pages.map((p) => p.text ?? "").join("\n").normalize("NFKC");
  const sgd = /\bSGD\b|(?<![A-Za-z])S\$|Singapore\s+dollars?/i.test(t);
  const other = OTHER_CODE.test(t) || OTHER_WORDS.test(withoutPlainDollarWording(t)) || moneyFiguresIn(t).some((x) => x.currency !== "$" && x.currency !== "SGD");
  const found = sgd && !other ? "SGD" : null;
  docCurrencies.set(doc, found);
  return found;
}
/** The one currency a page declares for every figure on it (release-set A2, A3, A6: a policy schedule prints "Death Benefit
 * 5,000.00" under a "Currency : Singapore Dollar" field, with no sign on any figure): a currency field ("Currency : SGD",
 * "Policy Currency	Singapore Dollars", or a schedule's ": Singapore Dollar" value beside its "Currency" label) or "All
 * amounts are in Singapore dollars". Null when the page declares none, or more than one (a list of currency options). */
// A name or its code, and the sign a declaration may print as its value ("Singapore Dollar (SGD)", "S$", "Ringgit
// Malaysia", "RM": TE pr191 F1, F2). The sign counts only as a declared value: a bare "RM" in prose ("Please contact your
// RM", "Form RM-2") names no currency (Critic R359 M1).
const CURRENCY_NAMES: [string, string, string?][] = [["SGD", String.raw`singapore\s+dollars?|SGD`, String.raw`(?<![A-Za-z])S\$`], ["USD", String.raw`(?:us|united\s+states)\s+dollars?|USD`, String.raw`US\$`], ["MYR", String.raw`ringgit(?:\s+malaysia)?|MYR`, String.raw`(?<![A-Za-z])RM(?![A-Za-z])`], ["HKD", String.raw`hong\s+kong\s+dollars?|HKD`], ["AUD", String.raw`australian\s+dollars?|AUD`], ["EUR", String.raw`euros?|EUR`], ["GBP", String.raw`pounds?\s+sterling|GBP`]];
// Case-blind, so a lowercase "us$20" still names another currency (TE pr191 low).
const OTHER_SIGNS: Record<string, RegExp> = { USD: /US\$/i, HKD: /HK\$/i, AUD: /(?<![A-Z])A\$/i, MYR: /RM\s?\d/, EUR: /€/, GBP: /£/, JPY: /¥/, SGD: /(?<![A-Z])S\$/i };
// A second currency field with a qualifier ("Currency of rider : RM", "Rider currency\tRM") names that currency by its
// sign alone, with no figure after it.
const QUALIFIED_FIELD_SIGN = /\bcurrency\b[^\n:\t]{0,40}[:\t][ \t:]*(US\$|HK\$|A\$|S\$|RM|€|£|¥)(?![A-Za-z])/gi;
const SIGN_CODE: Record<string, string> = { "US$": "USD", "HK$": "HKD", "A$": "AUD", "S$": "SGD", RM: "MYR", "€": "EUR", "£": "GBP", "¥": "JPY" };
export function pageCurrency(pageText: string): string | null {
  const t = pageText ?? "";
  const said = new Set<string>();
  for (const [code, name, sign] of CURRENCY_NAMES) {
    // The name may carry its code or sign in brackets: "Singapore Dollar (SGD)", "Ringgit Malaysia (RM)".
    const named = String.raw`(?:${name}${sign ? `|${sign}` : ""})(?:[ ]*\((?:[A-Z]{2,3}|[A-Z]{0,2}\$)\))?`;
    const field = new RegExp(String.raw`(?:^|\t)[ ]*(?:policy\s+|contract\s+)?(?:currency)[ \t]*:?[ \t]*${named}[ ]*(?:\t|$)`, "im");
    const value = new RegExp(String.raw`^[ \t]*:[ \t]*${named}[ ]*$`, "im");
    const all = new RegExp(String.raw`\ball\s+amounts\s+(?:are|quoted\s+are|shown\s+are)\s+in\s+(?:${name})\b`, "i");
    if (field.test(t) || all.test(t) || (value.test(t) && /(?:^|\t)[ ]*(?:currency)[ ]*(?:\t|$)/im.test(t))) said.add(code);
    // A page listing the currencies a policy can be in ("Six currency options are available: SGD, USD, ...") declares none.
    if (new RegExp(String.raw`currency\s+options|currencies\s+are\s+available`, "i").test(t)) return null;
  }
  if (said.size !== 1) return null;
  const code = [...said][0];
  // "All amounts are in Singapore dollars unless stated otherwise", or any figure or name of another currency on the page
  // (a row "(in US$)"): the page does not settle a figure's currency (R59-5).
  if (/\bunless\s+(?:otherwise\s+)?(?:stated|specified|shown|indicated)\b/i.test(t)) return null;
  if (moneyFiguresIn(t).some((f) => f.currency !== "$" && f.currency !== code)) return null;
  if (CURRENCY_NAMES.some(([other, name]) => other !== code && new RegExp(String.raw`(?:${name})`, "i").test(t))) return null;
  // Another currency's sign anywhere on the page; the declared currency's own sign is its figures ("Currency : US$").
  if (Object.entries(OTHER_SIGNS).some(([other, re]) => other !== code && re.test(t))) return null;
  for (const m of t.matchAll(QUALIFIED_FIELD_SIGN)) if (SIGN_CODE[m[1].toUpperCase()] !== code) return null;
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
type Count = { value: number; text: string; currencyResolved: boolean; count: number; payable: number; most: number | null; unit: string; rule: string };
type Checked = { s: ModelStatement; found: Found | null; amount: { value: number; text: string; currencyResolved: boolean; illustration: boolean } | null; person: string | null; note: string | null; base?: Base | null; conditions?: string[]; stay?: Stay | null; count?: Count | null; bill?: Bill | null; billed?: Billed | null; uncovered?: string | null; whole?: string | null;
  /** A point about one file, or one person's files, stated from the library's record (libraryFact, libraryList). */
  libraryDoc?: number; libraryPerson?: string;
  /** The library's count of files (libraryCount). */
  libraryCount?: boolean };

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
/** A line that is one labelled field of its own ("Hospital cash: S$150 per day", "Annual premium: S$2,412.00"): a short
 * label of words, a colon, then its value. */
const FIELD_LINE = /^\s*([A-Za-z][A-Za-z ()'&/.#-]{0,48}?)\s*:\s*\S/;
/** The labels of fields that are never part of what a benefit pays, matched as the whole label (an allow-list): the
 * premium, the policy's number, the person, the plan's name, its period and dates, its currency, how it is paid, the
 * agent. A field with any other label ("Ceiling", "Sum insured", "Waiting period", "Thereafter", "Ward type") stays with
 * the row above it, as before, so a limit or condition is never cut off from its figure (Critic P392). */
const PERIODIC = String.raw`(?:annual|annualised|annualized|yearly|monthly|quarterly|half[- ]?yearly|semi[- ]?annual|single|regular|modal|instalment|installment|total|basic|first[- ]year|renewal|gross|net)`;
const NON_BENEFIT_LABELS = [
  String.raw`(?:${PERIODIC}\s+)*premiums?(?:\s+(?:amount|payable|due|paid|frequency|mode|term|(?:\(?(?:incl|including|inclusive\s+of|excl|excluding|exclusive\s+of)\.?\s+)?(?:gst|tax|vat)\)?))*`,
  String.raw`(?:policy|certificate|contract|member(?:ship)?|plan|account|reference|ref\.?|proposal|application)\s*(?:no\.?|number|#|id)`,
  String.raw`(?:name\s+of\s+)?(?:(?:the\s+)?(?:life\s+)?(?:insured|assured)(?:\s+person)?|policy\s*(?:holder|owner)|policyholder|policyowner|owner|proposer|member|employee|name|full\s+name|nric|nric\s+no\.?|date\s+of\s+birth|dob|gender|sex|occupation|address|relationship)(?:\s+name)?`,
  String.raw`(?:plan|product)(?:\s+(?:name|type|code))?`,
  String.raw`(?:policy|cover(?:age)?|insurance)\s+(?:period|term)|period\s+of\s+(?:cover|coverage|insurance)`,
  String.raw`(?:(?:policy|cover(?:age)?|commencement|effective|start|end|expiry|issue|inception|renewal|maturity|print(?:ed)?|due|next\s+due|billing)\s+)?date`,
  String.raw`(?:policy\s+)?currency`,
  String.raw`(?:payment|premium\s+payment|billing)\s+(?:mode|method|frequency|term)|(?:mode|method|frequency)\s+of\s+payment`,
  String.raw`(?:servicing\s+|financial\s+)?(?:agent|adviser|advisor|consultant|representative)(?:\s+(?:name|code|no\.?))?|agency|branch`,
];
const NON_BENEFIT_LABEL = new RegExp(String.raw`^(?:${NON_BENEFIT_LABELS.join("|")})$`, "i");
/** Words in a field's value that may limit what a row pays: a limit, a cap, a count of days or a stay. */
const LIMIT_IN_VALUE = /\b(?:limits?|limited|max(?:imum)?|min(?:imum)?|up\s+to|caps?|capped|ceiling|aggregate|overall|total|in\s+all|not\s+more|no\s+more|excess|deductible|reduced|half|thereafter|after|from|per|each|days?|weeks?|admissions?|stays?|confinements?|benefits?)\b/i;
/** A money figure in a field's value ("S$2,000", "USD 500", "2,000.00"). */
const MONEY_IN_VALUE = /(?:[A-Z]{1,3}\$|\$|£|€|¥|\b(?:SGD|USD|MYR|RM|GBP|EUR|AUD|HKD)\b)\s?\d|\d{1,3}(?:,\d{3})+|\d+\.\d{2}\b/i;
/** Whether a labelled field is one that is never part of what a row pays: an allowed label (NON_BENEFIT_LABEL) whose value
 * prints no limit or day words, and, except for a premium (which is money by nature), no money figure ("Plan type: S$2,000
 * limit" and "Coverage period: up to 10 days" stay with the row: Critic P392B). */
function nonBenefitField(label: string, value: string): boolean {
  const name = label.trim().replace(/\s+/g, " ");
  if (!NON_BENEFIT_LABEL.test(name) || LIMIT_IN_VALUE.test(value)) return false;
  return /\bpremiums?\b/i.test(name) || !MONEY_IN_VALUE.test(value);
}
/** The row's own line and the lines that continue it ("15% of Sum Insured" / "or up to S$50,000, whichever is lesser"),
 * up to the next row, bullet or numbered item (R52-1). On a schedule that prints one labelled field per line, the next
 * labelled field ("Annual premium: S$2,412.00" under "Hospital cash: S$150 per day") is the next row, not part of this one
 * (TE overnight F1), but only when its label is one of a few fields that are never about what a row pays. */
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

/** Words that, anywhere below a daily row on its page, may change what a stay pays: a limit, an
 * aggregate, a day rule or a condition on the stay (TE #392 layouts, Critic P392). Any day word left once the row's own
 * day cap field is taken out is a day rule ("Plan: Basic (days 1 to 3 not covered)", TE #392). Unsure means no total. */
export const STAY_BLOCK_WORDS = /\b(?:limits?|limited|limitation|sub-?limits?|aggregate|overall|totals?|in\s+all|ceiling|caps?|capped|capping|plafond|restricted|not\s+more|no\s+more|not\s+exceed\w*|excess|deductible|elimination|deferred|deferment|deferral|waiting|excluding|exclud\w*|except|unless|reduced|reduction|half|thereafter|only|once|frequency|sum\s+(?:insured|assured)|per\s+(?:admission|confinement|disability|year|annum|policy\s+year|lifetime)|annual(?:ly)?|lifetime|whichever|subject|balance|co-?pay\w*|co-?insurance|intensive|icu|first\s+\d+|after\s+(?:the\s+)?\d+|minimum|at\s+least|less\s+than|(?:a|each|every|per)\s+(?:year|month|week|quarter)|days?|unpaid|not\s+(?:covered|paid|payable)|non-?payable|no\s+benefit|wards?|paid\s+(?:for|in|if|when|only)|payable\s+(?:for|in|if|when|only)|if|provided|eligib\w*|conditions?|stops?|together|combined|shared|most\s+(?:paid|payable))\b/i;
/** The row's own day numbers: its first paid day and its most days ("from the 3rd day", "maximum 30 days"). */
const ROW_DAYS = /\b(?:after|from)\s+(?:the\s+)?(\d+)\s*(?:st|nd|rd|th)?\s+day\b|\bmax(?:imum)?\.?\s*(?:of\s*)?:?\s*(?:[a-z-]+\s*)?\(?(\d+)\)?\s*(?:continuous\s+)?days?\b/gi;
/** A daily row and every line under it to the end of its page. No line ends it (a heading, a table's heading row, a blank
 * line, a table row, a bullet or a numbered item may all be followed by a limit on this row: Critic P392 rounds 3, 4 and
 * F). Left out of it:
 * - each non-benefit field (premium, policy number, person, plan, dates, currency, payment, agent: nonBenefitField);
 * - another benefit's tabbed rate row and a table's heading row (nextTableRow), and a ward field naming no ward ("Ward:
 *   any", ANY_WARD);
 * - under a later table's heading row, each tabbed row that names none of this row's own words and prints no limit or
 *   rule word: that table's own row ("Trip cancellation\tS$5,000\tS$10,000" under "Travel\tClassic\tBusiness");
 * - a line that only repeats the row's own first paid day or most days ("Payable from: day 3" under "from the 3rd day",
 *   Critic P392 round 4): no money, every number one of the row's own day numbers, and no other limiting word.
 * What a stay pays is worked out only when nothing else is left below the row's own line that could change it.
 * tail: the block below the row's own line. */
export function stayBlock(pageText: string, offset: number): { text: string; tail: string } {
  const row = rowLine(pageText, offset);
  const own = new Set([...row.text.matchAll(ROW_DAYS)].map((m) => Number(m[1] ?? m[2])));
  const kept: string[] = [];
  // The row's own name words ("Ward cash" in "Ward cash\tS$150 per day"), to tell a row of a later table that names it.
  const label = /^[^\t:]*/.exec(row.text.trim())![0];
  const names = (label.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !GENERIC_NAME_WORD.test(w));
  let inLaterTable = false;
  // Whether the later table's heading names no cover of its own ("Benefit\tPlan A\tPlan B", "Section 2", blank): only
  // then may a row under it that names a hospital stay be this row's cap (Critic P396 H).
  let genericHeading = false;
  // A later heading whose first cell says its rows are most amounts ("Maximum benefit\tPlan A\tPlan B"): a limit line once
  // a row under it prints money or days (Critic P396 G); an age table under "Maximum age" is not one (TE #396 AC).
  let limitHeading: string | null = null;
  for (const l of pageText.slice(row.end + 1).split("\n")) {
    if (!l.trim()) continue;
    const table = nextTableRow(l);
    // A table's heading row is left out, never the end of the block: a cap printed under it may be this row's (Critic
    // P392 F). Was (round 5): it ended the block.
    // A heading row whose own words say it prints most amounts ("Maximum benefit\tPlan A\tPlan B", "Yearly maximum", "Max.
    // payable", "Highest amount paid") is a limit line: the rows under it may cap this one (Critic P396 G).
    if (table === "heading") {
      const first = l.split("\t")[0];
      inLaterTable = true;
      genericHeading = genericHeadingCell(first);
      // Only the first cell: a plan tier column named "Max" is not one (Critic P396 H).
      limitHeading = HEADING_LIMIT.test(first) ? l : null;
      continue;
    }
    if (limitHeading && /\t/.test(l) && MONEY_OR_DAYS.test(l)) { kept.push(limitHeading, l); limitHeading = null; continue; }
    if (table === "rate") continue;
    // Under a later table's heading, a tabbed row that names none of this row's words and prints no limit or rule word is
    // that table's own row ("Trip cancellation\tS$5,000\tS$10,000" under "Travel\tClassic\tBusiness"): left out.
    if (inLaterTable && /\t/.test(l) && !(genericHeading && STAY_WORD.test(l)) && !names.some((w) => (genericHeading || !STAY_WORD.test(w)) && new RegExp(String.raw`\b${w}`, "i").test(l)) && !STAY_BLOCK_WORDS.test((genericHeading ? l : l.replace(CARE_LEVEL, " ")).replace(MAX_DAY_FIELD, " ")) && !CAP_OR_RULE.test(l)) continue;
    if (ANY_WARD.test(l)) continue;
    const field = FIELD_LINE.exec(l);
    if (field && nonBenefitField(field[1], l.slice(field[0].length - 1))) continue;
    const numbers = [...l.matchAll(/\d+/g)].map((m) => Number(m[0]));
    const rest = l.replace(/\b\d+\s*(?:st|nd|rd|th)?\b|\bdays?\b/gi, " ");
    if (numbers.length && numbers.every((n) => own.has(n)) && !MONEY_IN_VALUE.test(l) && !STAY_BLOCK_WORDS.test(rest) && !CAP_OR_RULE.test(rest)) continue;
    kept.push(l);
  }
  return { text: [row.text, ...kept].join(" "), tail: kept.join(" ") };
}
/** A tabbed table row with no limit or rule word in it:
 * - "rate": another benefit's own rate row ("Hospital cash\tS$100 per day, maximum 30 days"), left out of the block but
 *   never its end, so a shared cap under it still holds this row back (Critic P392 E);
 * - "heading": a table's heading row ("Travel\tClassic\tBusiness": two or more tabs, no figure), left out of the block;
 *   the rows under it that do not name this row are that table's own (stayBlock; Critic P392 F).
 * A tabbed lump sum ("Overall limit\tS$2,000", "Plafond\tS$2,000") is neither, nor is any line with a limit or rule word. */
function nextTableRow(line: string): "rate" | "heading" | null {
  if (!/\t/.test(line)) return null;
  const rate = /(?:[A-Z]{1,3}\$|\$|£|€|¥|\b(?:SGD|USD|MYR|RM|GBP|EUR|AUD|HKD)\s?)\s?\d[\d,]*(?:\.\d+)?\s*(?:per|a|each)\s+(?:day|week|month)\b/gi;
  const words = line.replace(rate, " ").replace(MAX_DAY_FIELD, " ");
  if (STAY_BLOCK_WORDS.test(words) || CAP_OR_RULE.test(words)) return null;
  if (rate.test(line)) return MONEY_IN_VALUE.test(words) ? null : "rate";
  return (line.match(/\t/g) ?? []).length >= 2 && !/\d/.test(line) ? "heading" : null;
}
/** The first cell of a table's heading row that says its rows are most amounts: "Max.", "Maximum benefit", "Yearly
 * maximum", "Highest amount paid", "Most payable" (Critic P396 G); never "Most popular" (P396 H). */
const HEADING_LIMIT = /\b(?:max(?:imum|ima)?|highest|most\s+(?:paid|payable|amounts?|benefits?)|upper\s+limits?)\b/i;
/** Money or a number of days in a line: what makes a row under a "Maximum ..." heading a limit (TE #396 AC). */
const MONEY_OR_DAYS = /(?:[A-Z]{1,3}\$|\$|£|€|¥|\b(?:SGD|USD|MYR|RM|GBP|EUR|AUD|HKD)\s?)\s?\d|\b\d+\s*(?:days?|nights?)\b/i;
const GENERIC_HEADING_WORD = /^(?:benefits?|description|type|of|item|plans?|payable|section|schedule|cover(?:age)?|details|summary|continued|[a-z]|sgd|usd|myr|rm|gbp|eur|aud|hkd)$/;
/** A heading is another cover's table ("Travel", "Personal accident", "Maximum age") only when its first cell has a word
 * outside GENERIC_HEADING_WORD and no word of a hospital stay; otherwise ("Benefit description", "Benefits (S$)",
 * "Hospital benefits", "In-patient benefits", blank) its rows may be this stay's (Critic P396 H, I). */
const genericHeadingCell = (first: string) => STAY_WORD.test(first) || (first.toLowerCase().match(/[a-z]+/g) ?? []).every((w) => GENERIC_HEADING_WORD.test(w));
/** A level of hospital care ("ICU", "intensive care"): under a heading that names another cover ("Critical illness\tPlan
 * A\tPlan B"), a row that says one ("Admitted to ICU lump sum\tS$10,000") is that cover's own row, not a rule on this stay
 * (Critic P396 H). */
const CARE_LEVEL = /\b(?:intensive(?:\s+care)?|icu)\b/gi;
/** Words of a hospital stay: under a generic heading (genericHeadingCell), a row that says one ("Hospital
 * confinement\tS$2,000") may cap this stay row, so it is never taken for that table's own row (Critic P396 G, H). */
const STAY_WORD = /\b(?:hospital\w*|confine\w*|in-?patient|admission|admitted|warded|wards?|stays?)\b/i;
/** Words of a benefit's name that do not tell one benefit from another ("Daily ... Benefit"). */
const GENERIC_NAME_WORD = /^(?:benefits?|daily|the|and|for|per|day|days|plan|cover|amount|payable|paid)$/;
/** A ward field that names no ward at all ("Ward: any", "Ward type: all wards"): no condition on the stay. */
const ANY_WARD = /^\s*wards?(?:\s+(?:type|class))?\s*:\s*(?:any|all)(?:\s+wards?)?\s*\.?\s*$/i;
/** Words beside a repeated day number that make it a rule of its own, never a repeat ("up to", "first", "after"). */
const CAP_OR_RULE = /\b(?:up\s+to|first|after|within|before|until|following|last|each|every|per|not|no|except|only|less|more|minimum|at\s+least|continuous(?:ly)?|consecutive)\b/i;
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
  for (const re of [new RegExp(String.raw`%\s*of\s*(${MONEY_SIGN}\s?\d[\d,]*(?:\.\d+)?)`, "gi"), new RegExp(String.raw`\blimit\s*:?\s*(${MONEY_SIGN}\s?\d[\d,]*(?:\.\d+)?)`, "gi")])
    for (const m of above.matchAll(re)) heads.push({ at: m.index ?? 0, base: { value: valueOf(m[1]), raw: m[1] } });
  for (const m of above.matchAll(/\(\s*%\s*of\s*(?:the\s*)?sum\s*(?:insured|assured)\s*\)/gi)) heads.push({ at: m.index ?? 0, base: "sum_insured" });
  // "percentage of Comatose State Sum Insured", "% of the Benefit Amount": a base this check cannot know.
  for (const m of above.matchAll(new RegExp(String.raw`(?:%|percentage|per\s?cent)\s+of\s+(?!(?:the\s+)?sum\s+(?:insured|assured)\b)(?!${MONEY_SIGN})([A-Za-z][^\n]{0,60}?)\b(?:sum\s+(?:insured|assured)|amount|limit)\b`, "gi"))) heads.push({ at: m.index ?? 0, base: null });
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

type AmountCheck = { ok: true; amount: NonNullable<Checked["amount"]>; base?: Base; found?: Found } | { ok: false; why: string; asFact?: boolean; found?: Found; baseUnknown?: true };

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
 * POLICY", "DISABILITY INCOME"), or a standalone line naming a cover. A scheme title line ("HARBOUR STAFF GROUP INSURANCE
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
/** A product summary that opens with the scheme's title instead of the product's ("HARBOUR STAFF GROUP INSURANCE VOLUNTARY
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
const NOT_ROW_FIGURE = "the percentage is not the quoted row's own figure";
const WHOLE_FALLBACK = new Set([NOT_ROW_FIGURE, NO_PRINTED_BASE]);
/** The cap a percentage row prints with its own currency ("25% of Sum Assured per claim, maximum RM 50,000 per claim",
 * "15% of the Sum Insured, up to S$50,000"), read from the row's own line and the lines that continue it, when:
 * - the row (with its continuation) prints exactly one money figure, it carries a currency (not a bare "$"), a cap word stands
 *   right before it ("up to", "maximum", "not exceeding", "limited to", "capped at"): a row with a second figure (an
 *   overall limit, another benefit's sum) or a bare number gives nothing;
 * - the statement names a household member, the document is linked to them, and the page names no other life.
 * The cap is then checked as a plain amount (plainAmount) on that row. Fail-safe: anything else gives null and the
 * percentage stays a fact with no amount. */
/** What a cap's percentage may be of: the benefit's own sum (closed list, in the languages households' documents use). */
const PCT_BASE = /^(?:(?:basic\s+|plan\s+|policy\s+|benefit\s+)?(?:sum\s+(?:assured|insured)|amount\s+of\s+cover|cover\s+amount|coverage\s+amount|benefit\s+amount|face\s+amount|insured\s+amount)|(?:the\s+)?capital\s+assur[ée])\b/i;
/** A row that is a share the household pays or a charge, never a cap on what the policy pays (closed list). */
const CHARGE_ROW = /\b(?:co-?insurance|co-?pay(?:ment)?s?|excess(?:es)?|deductibles?|premiums?|loading|contributions?|fees?|charges?|levy|tax)\b/i;
/** Words that may follow a row's cap figure: what it is per, and the lesser-of rule (closed list). */
const CAP_TAIL = new Set(["per", "each", "any", "one", "a", "an", "the", "in", "for", "of", "all", "and", "claim", "claims", "accident", "accidents", "admission",
  "admissions", "bone", "bones", "fracture", "fractures", "injury", "event", "illness", "condition", "policy", "year", "lifetime", "aggregate", "overall", "only",
  "whichever", "is", "lesser", "will", "shall", "be", "payable", "paid", "lower", "less", "smaller", "life", "insured", "person", "an"]);
function rowCap(st: ModelStatement, at: Found, household: Household, person: string | null): { found: Found; raw: string; amount: NonNullable<Checked["amount"]> } | null {
  if (!person) return null;
  const doc = household.documents[at.docIndex];
  const page = doc.pages.find((p) => p.page === at.page);
  if (!page || !doc.linkedPeople.some((p) => baseName(p) === person)) return null;
  const people = household.members.map((m) => m.name.replace(/\s*\(.*\)\s*$/, ""));
  if (otherLife(page.text, person, people)) return null;
  const row = rowLine(page.text, at.offset);
  // The row's own line, with the lines that continue its sentence ("... 15% of Sum Insured" / "or up to S$50,000, whichever
  // is lesser"); a line that starts a new label ("Overall limit for all early stage claims: RM 100,000") is another row.
  const whole = rowWithContinuation(page.text, at.offset), extra = whole.slice(row.text.length).trim();
  // A continuation starts with a closed list of sentence words and prints no label of its own ("burns: maximum S$50,000",
  // "(Dislocation: up to S$20,000)" and "and Burns: up to £5,000" are other benefits' rows, Critic #318 H1).
  const continues = /^(?:or|whichever|subject\s+to|up\s+to|max(?:imum)?\b|max\.|not\s+exceeding|limited\s+to|capped\s+at|per)\b/i.test(extra) && !/:/.test(extra);
  const text = extra && continues ? whole : row.text;
  const figures = moneyFiguresIn(text);
  if (new Set(figures.map((f) => f.value)).size !== 1 || numbersIn(text.replace(/\d+(?:\.\d+)?\s*%/g, " ")).some((n) => !sameValue(n, figures[0].value))) return null;
  const fig = figures[0];
  const i = text.indexOf(fig.raw);
  // A bare "$" names no currency (S$, US$, A$ ...); a row that defines another sum ("Comatose State sum insured will be 15%
  // of the Sum Insured or maximum of $50,000") is that sum's rule, not what this benefit pays.
  if (!fig.currency || fig.currency === "$" || i < 0 || !CAP_BEFORE.test(text.slice(Math.max(0, i - 40), i))) return null;
  if (/\bsum\s+(?:insured|assured)\s+(?:will\s+be|shall\s+be|is|equals?)\b/i.test(text)) return null;
  // The cap is the most only when the percentage is of the benefit's own sum (closed list, several languages) and any
  // "whichever" picks the lesser: "whichever is greater" makes the figure a floor, and "10% of each claim" or "of the
  // bill" is a share the household pays (TE #318). A row that is a share paid or a charge (co-insurance, excess,
  // premium ...) is never a cap on what the policy pays.
  // A row that offers the percentage or the figure ("... or up to S$50,000", "atau", "ou", "oder", "或") is a cap only when
  // it says the lesser applies; "the larger of the two", "if bigger", "mana-mana yang lebih tinggi" or no rule at all
  // gives no figure (TE #318 round 2).
  const lesser = /\bwhichever\s+is\s+(?:the\s+)?(?:lesser|lower|less|smaller)\b/i.test(text);
  if (/\bwhichever\b/i.test(text) && !lesser) return null;
  if (/\b(?:or|atau|ou|oder|o)\b|或/i.test(text) && !lesser) return null;
  // The words after the cap say what it is per, from a closed list; anything else ("if bigger", "where this exceeds the
  // percentage", "per day") may change what the figure means, so no figure.
  const tail = text.slice(i + fig.raw.length).toLowerCase().replace(/[,.;()]/g, " ").split(/\s+/).filter(Boolean);
  if (tail.some((w) => !CAP_TAIL.has(w))) return null;
  if (/\b(?:greater|higher|minimum|min\.|at\s+least|not\s+less\s+than)\b/i.test(text)) return null;
  const pctOf = [...text.matchAll(/\d+(?:\.\d+)?\s*%\s*(?:of\s+(?:the\s+|your\s+|its\s+)?)?([^,;.\t]{0,40})/gi)];
  if (!pctOf.length || pctOf.some((m) => !PCT_BASE.test(m[1]))) return null;
  if (CHARGE_ROW.test(text)) return null;
  const found: Found = { docIndex: at.docIndex, page: at.page, excerpt: text.trim().replace(/[ \t]+/g, " "), offset: row.start };
  const plain = plainAmount({ ...st, percentOf: null, amount: fig.raw, quote: found.excerpt }, found, household);
  return plain.ok && /^Up to /.test(plain.amount.text) ? { found, raw: fig.raw, amount: plain.amount } : null;
}
/** The person's own sum a capped percentage row is a share of, so the card can show the lesser of the two (TE #311 round 4:
 * "25% of Sum Assured per claim, maximum RM 50,000 per claim" on a certificate printing "Sum Assured: RM 150,000" pays at
 * most RM 37,500 a claim, never RM 50,000). Found only when all of these hold, otherwise null and no figure is shown:
 * - it is in the row's own document, which is linked to the person, on a page that names no other life;
 * - its line's label is the benefit's own sum and nothing else (PCT_BASE: "Sum Assured:", "Sum Insured", "Amount of cover")
 *   and the line prints exactly one figure, with a currency (not a bare "$") that is the cap's currency;
 * - the document prints exactly one such sum (a basic plan and a rider's sums assured could be either);
 * - the model's base, when it gives a figure, is that same sum. */
function capBase(st: ModelStatement, row: Found, household: Household, person: string, capCurrency: string): { value: number; raw: string; base: Base } | null {
  const doc = household.documents[row.docIndex];
  if (!doc.linkedPeople.some((p) => baseName(p) === person)) return null;
  const people = household.members.map((m) => baseName(m.name));
  const sums: { value: number; raw: string; found: Found }[] = [];
  const rowCover = coverOfPercent(rowWithContinuation(doc.pages.find((p) => p.page === row.page)?.text ?? "", row.offset));
  for (const page of doc.pages) {
    if (otherLife(page.text, person, people)) return null;
    let offset = 0;
    for (const line of page.text.split("\n")) {
      const figures = moneyFiguresIn(line);
      const at = figures.length ? line.indexOf(figures[0].raw) : -1;
      const label = at >= 0 ? line.slice(0, at).replace(/[:\t]/g, " ").replace(/\s+/g, " ").trim() : "";
      const m = PCT_BASE.exec(label);
      // "Sum Assured (Critical Illness): S$300,000" is the sum too, when its bracket names the cover the row's percentage is
      // of, or the row names none.
      const tail = m ? label.slice(m[0].length).trim() : "";
      const bracket = /^\(([A-Za-z ]+)\)$/.exec(tail);
      const exact = !!m && (!tail || (!!bracket && (!rowCover.length || sameWords(tokens(bracket[1]).filter((w) => !COVER_FILLER.has(w)), rowCover))));
      // Another sum named as a sum ("Rider Sum Assured", "Sum Insured for Accidental Death") could be the base too: a doubt.
      if (!exact && SUM_WORDS.test(label) && !/%|per\s?cent/i.test(line)) return null;
      if (exact && !/%|per\s?cent/i.test(line)) {
        if (figures.length !== 1 || numbersIn(line).length !== 1) return null;
        sums.push({ value: figures[0].value, raw: figures[0].raw, found: { docIndex: row.docIndex, page: page.page, excerpt: line.trim(), offset } });
      }
      offset += line.length + 1;
    }
  }
  // A plan table's "Sum Assured" column, on the row named by the cover the percentage is of ("20% of the Critical Illness sum
  // assured" -> "Critical Illness Cover\t200,000.00\t180.40"), on a page declaring one currency: one more place the sum is.
  const cover = rowCover;
  if (cover.length) for (const page of doc.pages) {
    const lines = page.text.split("\n");
    const declared = pageCurrency(page.text);
    let start = 0;
    lines.forEach((l, i) => {
      const at = start; start += l.length + 1;
      if (!/\t/.test(l)) return;
      const r = planRow(lines, i);
      if (!r) return;
      const words = tokens(r.name).filter((w) => !COVER_FILLER.has(w));
      if (!words.length || !words.every((w) => cover.includes(w)) || !cover.every((w) => words.includes(w))) return;
      if (!declared || !SIGN[declared]) { sums.push({ value: NaN, raw: "", found: { docIndex: row.docIndex, page: page.page, excerpt: l.trim(), offset: at } }); return; }
      sums.push({ value: r.value, raw: formatMoney(SIGN[declared], r.value), found: { docIndex: row.docIndex, page: page.page, excerpt: r.line.trim().replace(/[ \t]+/g, " "), offset: at } });
    });
  }
  if (sums.some((x) => !Number.isFinite(x.value)) || new Set(sums.map((x) => x.value)).size !== 1) return null;
  const sum = sums[0], cur = moneyFiguresIn(sum.raw)[0]?.currency;
  if (!cur || cur === "$" || cur !== capCurrency) return null;
  const said = moneyFiguresIn(st.percentOf?.baseAmount ?? "")[0]?.value ?? numbersIn(st.percentOf?.baseAmount ?? "")[0];
  if (said != null && !sameValue(said, sum.value)) return null;
  return { value: sum.value, raw: sum.raw, base: { found: sum.found, cover: "", asOf: null } };
}
/** Whether the cap is the most a claim pays whichever of the person's sums the percentage is of: the model's quoted base is
 * printed in the household's documents on a line that names the person and prints one figure in the cap's currency, and
 * every line of that document naming the person with one such figure (each of their sums there: a life cover's, an
 * accident cover's) works out to at least the cap ("15% of Sum Insured or up to S$50,000, whichever is lesser" with
 * sums of S$400,000 and S$1,000,000 pays S$50,000 on either). Any line that works out lower, or any doubt: false. */
function capBindsForEverySum(st: ModelStatement, row: Found, household: Household, person: string, capValue: number, capCurrency: string): boolean {
  const po = st.percentOf;
  if (!po?.baseQuote || !(po.percent > 0)) return false;
  const preferred = po.baseDocument ? Number(/^D(\d+)$/i.exec(po.baseDocument.trim())?.[1] ?? NaN) - 1 : null;
  const bf = locateQuote(household, po.baseQuote, Number.isFinite(preferred) ? preferred : null);
  if (!bf) return false;
  const doc = household.documents[bf.docIndex];
  if (!doc.linkedPeople.some((p) => baseName(p) === person)) return false;
  // The sums must be this policy's: the base is in the row's own document, or in one printing the same policy number. A
  // whole life plan's S$1,000,000 says nothing about an accident plan's own sum (Critic #349 H1).
  const number = (d: HouseholdDocument) => (d.policyNumber ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const rowDoc = household.documents[row.docIndex];
  if (bf.docIndex !== row.docIndex && !(number(rowDoc) && number(rowDoc) === number(doc))) return false;
  const who = tokens(person);
  const sums: number[] = [];
  let quotedIsOne = false;
  for (const page of doc.pages) {
    let start = 0;
    for (const line of page.text.split("\n")) {
      const end = start + line.length;
      const have = new Set(tokens(line));
      const figures = moneyFiguresIn(line);
      if (who.every((w) => have.has(w)) && figures.length) {
        if (figures.length !== 1 || figures[0].currency !== capCurrency) return false;
        sums.push(figures[0].value);
        if (page.page === bf.page && bf.offset >= start && bf.offset <= end) quotedIsOne = true;
      }
      start = end + 1;
    }
  }
  return quotedIsOne && sums.length > 0 && sums.every((v) => Math.round(v * po.percent) / 100 >= capValue);
}
/** The lesser of a percentage row's worked-out amount and its own printed cap, or null when the row prints a figure that
 * may limit the amount but is not a cap rowCap can read (fail closed: no figure). A row with no figure of its own (other than
 * the sum it is a share of) keeps its amount. */
function cappedAmount(st: ModelStatement, at: Found, household: Household, person: string | null, amount: NonNullable<Checked["amount"]>, baseValue: number | null):
  { keep: true } | { keep: false; cap: NonNullable<ReturnType<typeof rowCap>> } | null {
  const page = household.documents[at.docIndex].pages.find((p) => p.page === at.page);
  if (!page) return null;
  const text = rowWithContinuation(page.text, at.offset);
  const others = moneyFiguresIn(text).filter((f) => baseValue == null || !sameValue(f.value, baseValue));
  if (!others.length && !CAP_WORD.test(text)) return { keep: true };
  const cap = rowCap(st, at, household, person);
  if (!cap) return null;
  return cap.amount.value < amount.value ? { keep: false, cap } : { keep: true };
}
/** The cover a row's percentage is of, by name ("20% of the Critical Illness sum assured" -> ["critical", "illness"]); empty
 * when the row says only "of (the) Sum Assured". */
function coverOfPercent(rowText: string): string[] {
  const m = /\d+(?:\.\d+)?\s*%\s*of\s+(?:the\s+|your\s+|its\s+)?((?:[A-Za-z]+\s+){0,5}?)(?:sum\s+(?:assured|insured)|amount\s+of\s+cover)\b/i.exec(rowText);
  return m ? tokens(m[1]).filter((w) => !COVER_FILLER.has(w)) : [];
}
const sameWords = (a: string[], b: string[]) => a.length === b.length && a.every((w) => b.includes(w));
const COVER_FILLER = new Set(["cover", "benefit", "benefits", "plan", "basic", "the", "of", "and", "rider"]);
/** A row that pays a percentage of a sum with a cap printed on the row ("25% of Sum Assured per claim, maximum RM 50,000 per
 * claim"): its one percentage, or null. A plain amount card quoting that cap is held to the same lesser-of rule. */
function percentOfRow(rowText: string): number | null {
  const pcts = new Set([...rowText.matchAll(PCTS)].map((m) => Number(m[1])));
  if (pcts.size !== 1) return null;
  if (!/\d\s*%\s*of\s+(?:the\s+|your\s+|its\s+)?(?:[A-Za-z]+\s+){0,5}?(?:sum\s+(?:assured|insured)|amount\s+of\s+cover|cover\s+amount|benefit\s+amount|face\s+amount|insured\s+amount)\b/i.test(rowText)) return null;
  return [...pcts][0];
}
const SUM_WORDS = /\b(?:sum\s+(?:assured|insured)|amount\s+of\s+cover|cover\s+amount|coverage\s+amount|benefit\s+amount|face\s+amount|insured\s+amount)\b/i;
const CAP_WORD = /\b(?:up\s+to|maximum|max\.?|not\s+exceeding|limited\s+to|capped\s+at)\b/i;
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
  // A rider's words in the product's name ("... II with Early Critical Illness Rider") are not the plan's (TE #104 P2).
  const product = [wdoc, ...(samePolicy ? [bdoc] : [])].flatMap((d) => tokens((d.productName ?? "").split(RIDER_PART)[0]));
  return planSumAssured(household, [wording.docIndex, ...(samePolicy && bf.docIndex !== wording.docIndex ? [bf.docIndex] : [])], wording, person, want,
    new Set([...product, ...(serverWords.has(st.text) ? tokens(st.text) : [])]));
}
/** A policy schedule's plan table: a header line with exactly one "Sum Assured" (or "Sum Insured") column, which may be
 * printed over two lines ("Sum" above "Assured/"), and the first row under it, with as many cells: the basic plan, whose
 * sum assured is "the Sum Assured" its wording pays a percentage of. Only the header's own continuation lines (each with
 * a tab) may come between the header and the row: an amount, or a line with no tab (a row's name printed above its cells,
 * "Early" over "Critical Illness\t50,000.00"), makes it no first row (TE #104 P1). A rider's row is never the plan's. The row's name is its first cell and the lines right after it that continue the
 * name ("Comprehensive Critical" / "Illness Benefit"). */
const SA_HEAD = /^\s*sum\s*(?:assured|insured)\b/i;
const RIDER_PART = /\b(?:with|riders?|plus|supplementary|add-?ons?)\b|[+&]/i;
const SA_CELL = new RegExp(String.raw`^${MONEY_SIGN}?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})$`);
function planRow(lines: string[], i: number): { name: string; value: number; line: string } | null {
  const cells = lines[i].split("\t").map((c) => c.trim());
  if (cells.length < 2 || !/[A-Za-z]/.test(cells[0]) || /\d/.test(cells[0])) return null;
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    if (AMOUNT.test(lines[j]) || !/\t/.test(lines[j])) return null;
    const head = lines[j].split("\t").map((c) => c.trim());
    if (head.length !== cells.length) continue;
    const k = head.flatMap((c, n) => SA_HEAD.test(c) || (/^sum$/i.test(c) && /^\s*(?:assured|insured)\b/i.test(lines[j + 1] ?? "")) ? [n] : []);
    if (k.length !== 1 || k[0] === 0) return null;
    const cell = SA_CELL.exec(cells[k[0]]);
    if (!cell) return null;
    let name = cells[0];
    for (const l of lines.slice(i + 1, i + 3)) { if (!l.trim() || /\t|\d/.test(l)) break; name += ` ${l.trim()}`; }
    if (RIDER_PART.test(name)) return null;
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
  const rest = own.replace(/\bsum\s+(?:insured|assured)\b/gi, " ").replace(new RegExp(String.raw`${MONEY_SIGN}?\s*\d[\d,]*(?:\.\d+)?`, "gi"), " ").replace(new RegExp(String.raw`(?<![A-Za-z])(?:SGD|USD|MYR|HKD|AUD|NZD|EUR|GBP)(?![A-Za-z])`, "gi"), " ");
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
      if (!row) return { ok: false, why: NOT_ROW_FIGURE };
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
      if (!b.ok) return { ok: false, why: b.why, asFact: true, baseUnknown: true };
      const cur = currencyOf(b.raw, b.base.found.excerpt, household.documents[b.base.found.docIndex], b.base.found.page);
      const value = Math.round(b.value * pct) / 100;
      return { ok: true, amount: { value, text: formatMoney(cur.sign, value), currencyResolved: cur.resolved, illustration: true }, base: b.base };
    }
    const base = moneyFiguresIn(st.percentOf!.baseAmount)[0]?.value ?? numbersIn(st.percentOf!.baseAmount)[0];
    if (!printed) return { ok: false, why: NO_PRINTED_BASE, baseUnknown: true };
    if (base == null || !sameValue(printed.value, base)) return { ok: false, why: "the sum is not the one this row's table is a percentage of", baseUnknown: true };
    const cur = currencyOf(printed.raw, page.text, doc, page.page);
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
  const cur = currencyOf(printed.raw ?? raw, found.excerpt, doc, found.page);
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
// "Stayed in hospital there 4 days", "hospital cash ... for 25 days" (overnight run 23 Oct, N258, N145): a few words may
// stand between the stay and its length.
// "Admitted 10 days after the accident", "hospitalised 3 days ago" say when, not how long (Critic R169-4).
// "Hospitalised for 12 days after the fall" is a length: "for" says so (TE pr113 S10). "Admitted within 30 days of the trip"
// is not: the few words between never hold a word that says when (TE pr113 S5).
const NOT_LENGTH = String.raw`(?!\s+(?:ago|after|before|later|earlier|prior|since|from|into|of)\b)`;
const FILLER = String.raw`(?:\s+(?!(?:for|about|around|within|after|before|by|until|of|ago|since)\b)[a-z]+){0,3}?`;
const stayPatterns = (n: string) => [new RegExp(String.raw`\b${STAY_WORDS}\b${FILLER}(?:\s+(?:for|about|around)\s+${n}\s*days?\b(?!\s+ago\b)|\s+${n}\s*days?\b${NOT_LENGTH})`, "gi"),
  new RegExp(String.raw`\b${n}[\s-]*days?\s+(?:in\s+(?:the\s+)?hospital|hospital\s+stay|stay)\b`, "gi"), new RegExp(String.raw`\b${n}-day\s+(?:hospital\s+)?stay\b`, "gi"),
  new RegExp(String.raw`\bhospital\s+cash\b[^.?!]{0,40}?\bfor\s+(?:a\s+)?${n}[\s-]*days?\b`, "gi")];
/** The one length of stay the household's latest message describing a stay gives, or null: what a daily card is worked out
 * for when the model gave none (overnight run 23 Oct, N145). */
export function stayDaysSaid(asked: string[]): number | null {
  const n = String.raw`(\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
  for (const q of asked) {
    const value = (m: RegExpMatchArray) => { const v = m[1] ?? m[2]; return /^\d+$/.test(v) ? Number(v) : NUMBER_WORDS[v.toLowerCase()]; };
    const found = new Set(stayPatterns(n).flatMap((re) => [...q.matchAll(re)].map(value)));
    // "In ICU for 3 days and then in the general ward for 7 days", "2 days in ICU and 5 days in the ward": another length makes
    // the stay unclear (TE pr113 S3, R5). A claim window ("within 30 days") or a day said by when ("3 days ago") is not one.
    // Nor is "30 days to claim" or "a 90 days waiting period" (TE pr113 H1).
    const other = [...q.matchAll(new RegExp(String.raw`(?<!\b(?:within|in)\s)\b${n}[\s-]*days?\b${NOT_LENGTH}(?!\s*(?:'s\s+)?(?:waiting|period|notice|to\s+(?:claim|notify|tell|inform)))`, "gi"))].map(value);
    if (found.size) return found.size === 1 && other.every((v) => found.has(v)) ? [...found][0] : null;
  }
  return null;
}
function stayDaysWritten(asked: string[], days: number): boolean {
  const n = String.raw`(\d{1,3}|${Object.keys(NUMBER_WORDS).join("|")})`;
  const res = stayPatterns(n);
  // Once the conversation is about a hospital stay, a later "and if it was 50 days?" or "3 days so far" gives its length
  // (stress run 23 Oct, S050, S088).
  // A turn that names a day rule ("claim within 30 days", "a 90 days waiting period") gives no bare count (TE T2).
  const bare = asked.some((q) => new RegExp(String.raw`\b${STAY_WORDS}\b`, "i").test(q))
    ? new RegExp(String.raw`\b${n}[\s-]*days?\b(?!\s*(?:'s\s+)?(?:waiting|period|ago|since|notice|of\s+(?:cover|the\s+policy)|to\s+(?:claim|notify|tell|inform)))`, "gi") : null;
  const ruleTurn = /\b(?:within|claim\w*|notif\w*|waiting|period|deadline|submit\w*)\b/i;
  const said = (q: string, re: RegExp) => [...q.matchAll(re)].some((m) => { const v = m[1] ?? m[2]; return (/^\d+$/.test(v) ? Number(v) : NUMBER_WORDS[v.toLowerCase()]) === days; });
  return asked.some((q) => res.some((re) => said(q, re)) || (bare != null && !ruleTurn.test(q) && said(q, bare)));
}
/** "An 8-day", "an 11-day", "an 18-day", otherwise "A 12-day" (TE T4). */
const aDay = (n: number) => `${n === 11 || n === 18 || String(n).startsWith("8") ? "An" : "A"} ${n}`;
const OTHER_DAY_RULE = /\b(?:less\s+than|minimum|at\s+least|per\s+(?:admission|confinement|policy\s+year|year|disability)|intensive|ICU|not\s+payable|waiting)\b/i;
/** A day cap printed as its own field under the row ("Maximum: 30 days", "Up to a maximum of 30 days"): read by the day
 * rules below (one cap only), never a limit word by itself (TE #392 D). */
export const MAX_DAY_FIELD = /\b(?:up\s+to\s+(?:a\s+)?)?max(?:imum)?\.?\s*(?:of\s*)?:?\s*(?:[a-z-]+\s*)?\(?\d+\)?\s*(?:continuous\s+)?days?\b/gi;
function stayPays(st: ModelStatement, found: Found, household: Household, amount: NonNullable<Checked["amount"]>, asked: string[]): Stay | null {
  // With none given, only the stay the latest message describes: never one from an earlier turn ("what's the daily amount
  // again" after "hospitalised for 15 days").
  const stay = st.perDay?.stayDays ?? stayDaysSaid(asked.slice(0, 1));
  if (!stay || !Number.isInteger(stay) || stay < 1 || stay > 366 || !stayDaysWritten(asked, stay)) return null;
  const page = household.documents[found.docIndex].pages.find((p) => p.page === found.page)!;
  // The row with every line under it up to the next heading (stayBlock), or the quote with those lines when it reaches
  // further; each rule is read once. A limit, aggregate, day rule or condition anywhere below the row gives no total.
  const block = stayBlock(page.text, found.offset);
  const row = block.text.replace(/\s+/g, " ");
  const quoted = found.excerpt.replace(/…$/, "").replace(/\s+/g, " ");
  const tail = block.tail.replace(/\s+/g, " ").replace(MAX_DAY_FIELD, " ");
  if (STAY_BLOCK_WORDS.test(tail)) return null;
  const rule = squash(row).text.includes(squash(quoted).text) ? row : `${quoted} ${block.tail.replace(/\s+/g, " ")}`;
  if (OTHER_DAY_RULE.test(rule)) return null;
  const dailies = moneyFiguresIn(rule).filter((f) => /^\s*(?:per|a|each)\s+day\b/i.test(rule.slice(rule.indexOf(f.raw ?? "") + (f.raw ?? "").length)));
  if (dailies.length !== 1 || !sameValue(dailies[0].value, amount.value)) return null;
  // Any other money figure or overall limit in the row's words may cap what the stay pays ("Overall annual limit:
  // S$3,000", TE #392 E): no total is worked out past it, as the benefit table already refuses (dailyRateAlone).
  if (moneyFiguresIn(rule).some((f) => !sameValue(f.value, amount.value))) return null;
  if (/\b(?:limits?|aggregate|overall|in\s+total|in\s+all|ceiling|capped|not\s+more\s+than|no\s+more\s+than|reduced|thereafter|half)\b/i.test(rule)) return null;
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

/** What a figure printed per child could pay for the number of children the household's latest message gives
 * (overnight run 23 Oct, N023: "how much in total if we have two kids" was refused; "S$5,000 per child (up to 2 children)"
 * is S$10,000 for two). Read from the row's printed words alone, and only when they print exactly one money figure, the
 * card's own, followed by "per child" (or "for each child", "per dependant"), at most one most-children figure ("up to 2
 * children", "subject to a maximum of two children"), and no other limit (an overall or family limit, "up to S$5,000 per
 * child", "whichever is less"). The count must be the only number of children the household's latest message gives. A
 * count above the printed most is paid for the most. Anything less shows the figure per child as printed. */
const CHILD_UNIT = String.raw`(?:dependant\s+|dependent\s+|eligible\s+)?(?:child(?:ren)?|dependants?|dependents?)`;
const CHILD_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const CHILD_COUNT = String.raw`(\d{1,2}|${Object.keys(CHILD_WORDS).join("|")})`;
const countValue = (v: string) => (/^\d+$/.test(v) ? Number(v) : CHILD_WORDS[v.toLowerCase()]);
/** The number of children the household's message asks a total for ("how much in total if we have two kids"), or null.
 * The number must be said once ("2 sons and 2 daughters" is four children, never two: Critic R271 H1) and the message
 * must ask for a total for them all ("in total", "altogether", "both", "all of them"): a benefit paid on one child's own
 * event ("if one of my 2 kids gets cancer") is never multiplied by every child (Critic R271 H2). */
export function childrenSaid(message: string): number | null {
  const q = message ?? "";
  const counted = [...q.matchAll(new RegExp(String.raw`\b${CHILD_COUNT}\s+(?:(?:young|little|small|school[-\s]?going|dependant|dependent|eligible|grown[-\s]?up)\s+)?(?:kids?|kiddos?|child(?:ren)?|sons?|daughters?|boys?|girls?|dependants?|dependents?)\b`, "gi"))].map((m) => countValue(m[1]));
  // A child added without a number ("2 sons and a daughter", "one more child", "twins") leaves the number unclear. A
  // benefit's name ("the child education fund") adds no child.
  const added = /\b(?:a|an|another|more|other|extra|plus|new)\s+(?:(?:young|little|baby|third|second|fourth)\s+)?(?:kid|kiddo|child|son|daughter|boy|girl|dependant|dependent|baby)\b|\b(?:twins|triplets|baby|babies|newborn|pregnant|expecting)\b/i.test(q);
  if (counted.length !== 1 || added) return null;
  const total = /\b(?:in\s+total|total(?:ly)?|altogether|all\s+together|combined|in\s+all|both|all\s+(?:of\s+)?(?:them|my|our|the)|for\s+(?:all|both|them)|for\s+the\s+(?:kids|children))\b/i.test(q);
  // Every other word is one of a small set: question and total words, and the insured's own death or disability. Any
  // other word (a name, "he", "one", "the elder", "hospitalised") may single out one child's own event, so no number is
  // taken (Critic R275 H2: a list of single-child words always leaked).
  const rest = q.replace(new RegExp(String.raw`\b${CHILD_COUNT}\s+(?:(?:young|little|small|school[-\s]?going|dependant|dependent|eligible|grown[-\s]?up)\s+)?(?:kids?|kiddos?|child(?:ren)?|sons?|daughters?|boys?|girls?|dependants?|dependents?)\b`, "i"), " ")
    .replace(/\bchild(?:ren)?(?:['’]s)?\s+education\s+fund(?:\s+benefit)?\b/gi, " ").toLowerCase();
  // Any other number left ("2 kids and 1 from my wife", "and 3 for my partner") leaves the count unclear (TE #156 F2).
  if (new RegExp(String.raw`\d|\b(?:${Object.keys(CHILD_WORDS).join("|")})\b`, "i").test(rest)) return null;
  if (!total || !(rest.match(/[a-z]+(?:['’][a-z]+)?/g) ?? []).every((w) => TOTAL_QUESTION_WORDS.has(w))) return null;
  const n = counted[0];
  return n >= 1 && n <= 10 ? n : null;
}
/** The words a question for a total for every child may hold besides its number of children (Critic R275 H2). */
const TOTAL_QUESTION_WORDS = new Set(("how much many what whats what's is are was be would will could can does do did it its them there in total totally "
  + "altogether all together both combined for of from to pay pays paid payable payout get gets got receive claim we us our my me i i'm im you your the "
  + "have has had if when then and so this that benefit fund policy cover insurance amount sum money "
  + "die dies died dying pass passes passed away death dead am become becomes disabled disability permanently totally accident accidental accidentally "
  + "killed an wife husband spouse partner").split(" "));
/** The per-child words printed right after a figure: "per child", "for each child", "each dependant". */
const PER_CHILD = new RegExp(String.raw`^\s*(?:per|for\s+each|each|for\s+every)\s+${CHILD_UNIT}\b`, "i");
const MOST_CHILDREN = new RegExp(String.raw`\(?\s*(?:up\s+to|subject\s+to\s+a\s+maximum\s+of|a\s+maximum\s+of|maximum\s+of|max(?:imum)?\.?(?:\s+of)?)\s+(?:\w+\s+)?\(?${CHILD_COUNT}\)?\s+${CHILD_UNIT}\s*\)?`, "gi");
const OTHER_CHILD_LIMIT = /\bup\s+to\b|\bmax(?:imum)?\b|\bwhichever\b|\bnot\s+(?:to\s+)?exceed|\blimit(?:ed)?\b|\bcapped\b|\baggregate\b|\boverall\b|\bin\s+total\b|\bper\s+(?:family|policy|household)\b|\bcombined\b/i;
/** The words a condition may hold and still leave the total as printed per child: who counts as a child, and the insured's
 * own death or disability as the event (TE #156 F1: "reduced by 50% after age 65", "payable once only, regardless of the
 * number of children" each changed the total, and a list of limit words never held them all). Any other word stops it. */
const HARMLESS_CONDITION_WORDS = new Set(("a an the of in into on to and or nor not no is are be been must should shall will may can if when where who whose which that this these "
  + "child children child's children's dependant dependants dependent dependents son sons daughter daughters legitimate natural adopted step stepchild stepchildren legally "
  + "unmarried married full time full-time student students studying study school education educational institution higher learning tertiary university "
  + "including include includes age aged ages year years old below under up till until enlisted national service military "
  + "insured person persons life assured member members policyholder he she his her their him they it its "
  + "accident accidental accidentally bodily injury injuries sustains sustained result results resulting resulted caused due death dies die died dead "
  + "disability disabled permanent permanently total totally becomes become "
  + "with proof receipt relevant documents document required requires form forms prescribed insurer insurer's company company's us we our "
  + "within days day months month from date event occurrence happening "
  + "benefit benefits claim claims claimed claimable payable paid under scheme schemes core voluntary plan plans cover policy").split(" "));
/** Words a figure's own line may print before it ("• Child Education Fund Benefit*", "pay child education fund of"). */
const NAME_WORDS = new Set("benefit benefits the of for and fund allowance pay pays we will as provided clause".split(" "));
/** An age limit ("aged 25 or younger", "younger than 21") names who counts as a child. "Older", "younger" and "only" on
 * their own may pick one child ("payable to the younger child only"), so they are known only in these shapes, in "only
 * if", and in "can only be claimed either under the Core Scheme or ..." (a choice of scheme, not of child) (TE #156 F3). */
const AGE_LIMIT = /\b\d{1,2}\s*(?:years?\s*)?(?:old\s+)?(?:or|and)\s+(?:older|younger|above|below|under|over)\b|\b(?:younger|older)\s+than\s+\d{1,2}\b|\b(?:under|below)\s+(?:the\s+)?(?:age\s+(?:of\s+)?)?\d{1,2}\b/gi;
/** A time to claim in ("within 30 days of death") changes no amount. */
const CLAIM_WITHIN = /\bwithin\s+\d{1,3}\s+(?:days?|months?)\b/gi;
/** The words of a condition or line, once the known shapes are taken out. A number left over ("payable to 1 child") is
 * returned as a word no list holds, so it always stops the total (TE #156 F4). */
const plainWordsOf = (t: string) => {
  const rest = t.replace(AGE_LIMIT, " ").replace(CLAIM_WITHIN, " ").replace(/\bonly\s+(?=(?:if|when|where)\b)/gi, " ")
    .replace(/\b(can|may)\s+only\s+be\s+(claimed|paid)\s+(?:either\s+)?under\b/gi, "$1 be $2 under");
  return [...(rest.toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) ?? []), ...(/\d/.test(rest) ? ["#number"] : [])];
};
function countPays(found: Found, household: Household, amount: NonNullable<Checked["amount"]>, asked: string[], conditions: ModelStatement["conditions"] = [], rowConditions: string[] = []): Count | null {
  const count = childrenSaid(asked[0] ?? "");
  const conditionTexts = [...conditions.flatMap((c) => [c.text, c.quote ?? ""]), ...rowConditions];
  if (conditionTexts.some((t) => /%/.test(t) || !plainWordsOf(t).every((w) => HARMLESS_CONDITION_WORDS.has(w.replace(/['’]s$/, "")) || HARMLESS_CONDITION_WORDS.has(w)))) return null;
  // A condition that states money or a limit ("the total payable under this benefit shall not exceed S$8,000") may cap
  // the total: never multiplied past it (Critic R271 M1).
  if ([...conditions, ...rowConditions.map((t) => ({ text: t, quote: null }))].some((c) => [c.text, c.quote ?? ""].some((t) => moneyFiguresIn(t).length > 0 || OTHER_CHILD_LIMIT.test(t) || /\b(?:total|exceed\w*|sum\s+of|amounts?\s+paid)\b/i.test(t)))) return null;
  // One child is paid the amount printed per child: nothing to work out.
  if (!count || count < 2 || amount.illustration || /^up\s+to\b/i.test(amount.text)) return null;
  const page = household.documents[found.docIndex].pages.find((p) => p.page === found.page);
  if (!page) return null;
  const row = rowWithContinuation(page.text, found.offset).replace(/\s+/g, " ");
  const quoted = found.excerpt.replace(/…$/, "").replace(/\s+/g, " ");
  const rule = squash(row).text.includes(squash(quoted).text) ? row : quoted;
  const figures = moneyFiguresIn(rule);
  if (figures.length !== 1 || !sameValue(figures[0].value, amount.value)) return null;
  const after = rule.slice(rule.indexOf(figures[0].raw ?? "") + (figures[0].raw ?? "").length);
  const per = PER_CHILD.exec(after);
  if (!per) return null;
  const mosts = [...after.matchAll(MOST_CHILDREN)];
  if (mosts.length > 1) return null;
  const most = mosts.length ? countValue(mosts[0][1]) : null;
  // Once the most-children words are taken out, no other limit is left (an overall limit is never multiplied past).
  const rest = mosts.length ? rule.replace(mosts[0][0], " ") : rule;
  if (OTHER_CHILD_LIMIT.test(rest) || CAP_BEFORE.test(rule.slice(0, rule.indexOf(figures[0].raw ?? "")))) return null;
  // The line prints nothing but the benefit's name, the figure, "per child" and the most children: any other word after
  // the figure ("shared equally among all children", "reduced by 50% after age 65") may change the total (TE #156 F1).
  // A paragraph that prints the figure ("... pay child education fund of $5,000 per child, subject to a maximum of two
  // children, provided the Dependant child is unmarried ...") may hold only who counts as a child and the insured's own
  // event.
  // The statement's own words never count: the model can echo the line (Critic R278 L1).
  const harmless = (w: string) => NAME_WORDS.has(w) || HARMLESS_CONDITION_WORDS.has(w) || HARMLESS_CONDITION_WORDS.has(w.replace(/['’]s$/, ""));
  const tail = after.slice(per.index + per[0].length).replace(mosts.length ? mosts[0][0] : "", " ");
  const before = rule.slice(0, rule.indexOf(figures[0].raw ?? ""));
  if (/%/.test(tail + before) || !plainWordsOf(tail).every(harmless) || !plainWordsOf(before).every(harmless)) return null;
  // Every number of children printed is the most: "(up to 2 children)" only.
  const childNumbers = [...rule.matchAll(new RegExp(String.raw`\b${CHILD_COUNT}\)?\s+${CHILD_UNIT}\b`, "gi"))].map((m) => countValue(m[1]));
  if (childNumbers.some((n) => n !== most)) return null;
  const payable = most == null ? count : Math.min(count, most);
  const value = Math.round(amount.value * payable * 100) / 100;
  const sign = amount.text.replace(/[\d,.\s]+$/, "");
  const unit = per[0].trim().replace(/\s+/g, " ").replace(/^(?:for\s+each|each|for\s+every)\b/i, "per").toLowerCase();
  return { value, text: formatMoney(sign, value), currencyResolved: amount.currencyResolved, count, payable, most, unit,
    rule: `${amount.text} ${unit}${most != null ? `, for at most ${most} ${most === 1 ? "child" : "children"}` : ""}` };
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
  return withoutOrphans(sentences(text ?? ""), (s) => statesMoney(keep(s)), dropped);
}
/** A sentence that leans on the one before it ("That period has passed.", "It pays only if ...") goes with it when that
 * one is left out, so no sentence is left pointing at nothing (unseen set U3). */
const STATES_CONDITION = /\b(?:only\s+if|if|unless|provided|within|subject\s+to|must|after|before|until|waiting|exclu\w*|not\s+(?:paid|payable|covered))\b/i;
const LEANS_ON_PREVIOUS = /^(?:it|its|this|that|they|their|these|those|such)\b/i;
function withoutOrphans(all: string[], leaveOut: (s: string) => boolean, dropped: string[]): string {
  let last = false;
  // A sentence that states a condition ("It is paid only if ...") is kept: what it asks for still holds (Critic R140-2).
  return all.filter((s) => { const out = leaveOut(s) || (last && LEANS_ON_PREVIOUS.test(s.trim()) && !STATES_CONDITION.test(s)); if (out) dropped.push(s); last = out; return !out; }).join(" ").trim();
}
/** A file name is never money ("scan_2026.pdf", release-set E1, E2). */
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
    // the sentence calls it by the label the documents print it under ("the cover's own policy number ... is 1234567",
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
export function conditionApplies(household: Household, found: Found, quote: string): boolean {
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
    // The same mark, not a longer one: "*" is never the "**" row's (TE #105 W3).
    if ([...lineOf(page.text, found.offset).trimStart().slice(1).matchAll(/[*#^†‡§]+/g)].some((m) => m[0] === mark)) return true;
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
  return withoutOrphans(sentences(text ?? ""), asks, dropped);
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
    // The benefit table row's own printed conditions, set by the row step (lib/benefit-table/chat.ts): only ever used to
    // refuse more.
    ...(Array.isArray(s.rowConditions) ? { rowConditions: asStrings(s.rowConditions) } : {}),
  }));
  return { bottomLine: o.bottomLine, statements, nextSteps: asStrings(o.nextSteps).slice(0, 3), question: typeof o.question === "string" && o.question.trim() ? o.question.trim() : null };
}

/** A document as the household knows it: its product name, with the file name when two documents share one. */
/** A document as the household would name it: its product, told apart from another file of the same product by the
 * file's own name when a person chose it ("Product Summary"), or else by what kind of document it is. A name a machine
 * gave the file ("0a1b2c3d-....pdf", "scan_20260101090000.pdf") is never shown as a source. Two documents that would
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
const ABOUT_DOCUMENTS = /\b(?:documents?|files|uploads?|uploaded|paperwork)\b|\bfile\b(?!\s+(?:(?:a|an|the|my|your|his|her|their|our|this)\s+)?claims?\b)/i;
/** A question about claiming ("how do I file a claim", "what documents do I need to claim") is not about the library,
 * unless it also asks what was uploaded or linked (TE #104 L9). */
const aboutLibrary = (q: string) => ABOUT_DOCUMENTS.test(q) && (!/\bclaim/i.test(q) || /\b(?:upload(?:ed)?|linked|library|dearpolicy)\b/i.test(q));
const ABOUT_FILE = /\b(?:read|readable|unreadable|linked|link|uploaded|upload|scan(?:ned)?|failed)\b/i;
/** What a document is called in a point about the file: its product, or, when it has none and its file name says nothing
 * ("scan_20260101090000.pdf", a hash), what the app takes it to be ("Example Insurance endorsement, uploaded 1 Jan 2026"), with the
 * file name after it so it can be found on the Documents page (overnight run 23 Oct, N195, N282). A name a person gave the
 * file is kept as it is. */
// A file that could not be read keeps its file name: nothing read says what it is.
const labelFor = (household: Household, d: HouseholdDocument) => d.productName?.trim() || (!personalFileName(d.name) && !unreadable(d)) ? docLabel(household, d) : d.name;
export function libraryFact(household: Household, d: HouseholdDocument): string {
  // A point about the file itself names the file as it was uploaded, so the household can find it on the Documents page.
  const label = labelFor(household, d);
  const named = label === d.name ? d.name : `${label} (${d.name})`;
  const read = stillReading(d) ? `${named} is still being read, so nothing in it is used yet; ask again in a minute.`
    : onHold(d) ? `${named} is ${onHoldWords(d)}${d.holdLabel ? ` (${d.holdLabel})` : ""}, so nothing in it is used yet.`
    : unreadable(d) ? `${named} could not be read (status: ${d.processingStatus}), so nothing in it was used.${offersTryAgain(d) ? " It can be tried again on the Documents page." : ""}${failedWhy(d)}`
    // Every page unreadable: nothing was read (Critic #327 L2).
    : d.unreadablePages?.length && !d.pages.length ? `${named} could not be read: no page of it could be read, so nothing in it was used.`
    : d.uncheckedPages?.length || d.partCheckedPages?.length || d.unreadablePages?.length ? `${named} was read in part:`
      // A page that could not be read at all: named first, since nothing printed only there is known (#324 follow-up).
      + `${d.unreadablePages?.length ? ` ${sentence(pageList(d.unreadablePages))} couldn't be read, so anything printed only there is not known.` : ""}`
      + `${d.uncheckedPages?.length ? ` ${d.unreadablePages?.length ? sentence(pageList(d.uncheckedPages)) : pageList(d.uncheckedPages)} couldn't be checked against the page image, so no amounts from ${d.uncheckedPages.length === 1 ? "it are" : "them are"} used.` : ""}`
      // A page checked line by line: only its unconfirmed amounts are left out (Critic R211-4).
      + `${d.partCheckedPages?.length ? ` Some amounts on ${pageList(d.partCheckedPages)} couldn't be checked against the page image, so they are not used.` : ""}`
    : `${named} was read.`;
  const linked = d.linkedPeople.length ? ` It is linked to ${d.linkedPeople.map(baseName).join(" and ")} in DearPolicy.` : " It is not linked to anyone in DearPolicy; it can be linked on the Documents page.";
  return `${read}${linked}${uploadedApart(d) ? ` It was uploaded for ${baseName(d.uploadedFor!)}.` : ""}`;
}
/** Why a failed document could not be read and what to do, as the Documents page says it (lib/documents/failure-advice.ts):
 * fixed words only, never the stored reason. Empty for any other document. */
const failedWhy = (d: HouseholdDocument) => { const f = failureAdvice(d); return f ? ` ${sentence(f.why)}. ${f.step}` : ""; };
/** Who a file was uploaded for, when that is news: someone it is not linked to. Said of a file linked to the same person,
 * it only repeats the line before it (live 7e6d50e, E1). */
const uploadedApart = (d: HouseholdDocument) => !!d.uploadedFor && !d.linkedPeople.some((p) => baseName(p) === baseName(d.uploadedFor!));
const readInFull = (d: HouseholdDocument) => !unreadable(d) && !d.uncheckedPages?.length && !d.partCheckedPages?.length && !d.unreadablePages?.length;

/** Points about several files, for a question about the documents: the files read in full, listed together under the
 * people each is linked to, then one sentence for each file that is news on its own (read in part, unreadable, linked to
 * nobody, uploaded for someone it is not linked to). One shape whatever way the model split its points: one point per
 * file used to come back as a line per file repeating "was read. It is linked to ..." (live 7e6d50e, E1, E4, H12), and
 * one point per person as a clean list (6809808). Files already in a person's list are not listed again. A file uploaded
 * for someone it is not linked to is said on its own, once. */
export function libraryGroups(household: Household, docs: HouseholdDocument[], listed: ReadonlySet<string> = new Set()): string[] {
  const named = (d: HouseholdDocument) => { const label = labelFor(household, d); return label === d.name ? d.name : `${label} (${d.name})`; };
  const groups = new Map<string, HouseholdDocument[]>(), out: string[] = [];
  for (const d of docs) {
    // A file a newer upload replaced is not listed, as libraryList leaves it out (TE N2).
    if (d.supersededAt) continue;
    if (!readInFull(d) || !d.linkedPeople.length || uploadedApart(d)) continue;
    // The same people in any stored order are one group (Critic R224a, TE N1).
    const people = [...new Set(d.linkedPeople.map(baseName))].sort((a, b) => a.localeCompare(b));
    if (people.every((p) => listed.has(p))) continue;
    const key = people.length > 2 ? `${people.slice(0, -1).join(", ")} and ${people.at(-1)}` : people.join(" and ");
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  for (const [people, ds] of groups) out.push(`Linked to ${people}${ds.length > 1 ? `, ${ds.length} documents, all read` : ", read"}: ${ds.map(named).join("; ")}.`);
  for (const d of docs) {
    if (!readInFull(d) || !d.linkedPeople.length) out.push(libraryFact(household, d));
    else if (uploadedApart(d)) out.push(`${named(d)} was read. It is linked to ${d.linkedPeople.map(baseName).join(" and ")}, but it was uploaded for ${baseName(d.uploadedFor!)}.`);
  }
  return out;
}

/** A person's documents, as the library records them, in the server's words: for a question about the documents, a point
 * the model wrote about whose files are whose ("Alex has 8 documents linked: ...") has no page to quote (stress run
 * 23 Oct, S070: "here is each adult's list" with nothing listed). */
function libraryList(household: Household, person: string): string {
  const docs = household.documents.filter((d) => !d.supersededAt && d.linkedPeople.some((p) => baseName(p) === person));
  if (!docs.length) return `No document is linked to ${person} in DearPolicy.`;
  const named = (d: HouseholdDocument) => { const label = labelFor(household, d); return label === d.name ? d.name : `${label} (${d.name})`; };
  return `${person} has ${docs.length} document${docs.length === 1 ? "" : "s"} linked in DearPolicy: ${docs.map(named).join("; ")}.`;
}

/** `told`: the files whose own point (libraryFact) is in the same answer; their reason and next step are said there, not again here. */
function libraryCount(household: Household, told: ReadonlySet<number> = new Set()): string {
  const reading = household.documents.filter(stillReading), held = household.documents.filter(onHold);
  const bad = household.documents.filter((d) => unreadable(d) && !stillReading(d) && !onHold(d));
  const n = household.documents.length, read = n - reading.length - held.length - bad.length;
  // In the prototype mode (holdLabel null) a held upload is only "on hold", with no scan wording.
  const heldWords = held.every((d) => d.holdLabel === null) ? "on hold" : `on hold for ${held.length === 1 ? "its" : "their"} scan`;
  const parts = [reading.length ? `${reading.length} ${reading.length === 1 ? "is" : "are"} still being read (${reading.map((d) => d.name).join(", ")})` : null,
    held.length ? `${held.length} ${held.length === 1 ? "is" : "are"} ${heldWords} (${held.map((d) => d.name).join(", ")})` : null,
    bad.length ? `${bad.length} could not be read (${bad.map((d) => d.name).join(", ")})` : null].filter(Boolean);
  // Each failed file's reason and next step, said once for the files that share them (the same kind of failure).
  const why = new Map<string, string[]>();
  for (const d of bad) { const f = told.has(household.documents.indexOf(d)) ? null : failureAdvice(d); if (f) { const key = `${f.why}\u0000${f.step}`; why.set(key, [...(why.get(key) ?? []), d.name]); } }
  const reasons = [...why].map(([key, names]) => { const [w, step] = key.split("\u0000");
    return names.length === 1 ? ` ${names[0]}: ${sentence(w)}. ${step}` : ` ${names.slice(0, -1).join(", ")} and ${names.at(-1)}: for each, ${w}. ${step}`; });
  return `Of your ${n} uploaded files, ${read} ${read === 1 ? "was" : "were"} read${parts.length ? `${parts.length > 1 ? `, ${parts.slice(0, -1).join(", ")} and ` : " and "}${parts.at(-1)}` : ""}.${reasons.join("")}`;
}

/** A sentence that only says amounts are separate: "They are not a total.", "These are different benefits, not a total;
 * the insurer decides which applies." Anything with a number, a time limit or a condition is more than that. */
/** The household members a sentence names, by the words of each one's name that no other member's name has ("Alex",
 * "Jamie"). */
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
/** "Two are linked to both Alex and Jamie", "3 of them are linked to Alex only": a count of the documents linked
 * to the people it names (live run 23 Oct, E1). */
const LINKED_COUNT = new RegExp(String.raw`\b(${COUNT_WORDS.join("|")}|\d{1,2})\s+(?:(?:of\s+(?:them|these|those)|(?:uploaded\s+)?(?:documents?|files?))\s+)?(?:are|is|were|was)\s+linked\s+(only\s+)?to\s+(?:both\s+)?([^.;,]*)`, "i");
/** Who the documents are linked to, counted from the library's record, in the server's words. */
function linkCounts(live: HouseholdDocument[]): string {
  const groups = new Map<string, number>();
  for (const d of live) { const k = d.linkedPeople.map(baseName).sort().join(" and ") || "no one"; groups.set(k, (groups.get(k) ?? 0) + 1); }
  const parts = [...groups].sort((a, b) => b[1] - a[1]).map(([k, n], i) => `${n}${i ? "" : ` ${n === 1 ? "is" : "are"} linked`} to ${k}${k.includes(" and ") || k === "no one" ? "" : " only"}`);
  return `Of your ${live.length} document${live.length === 1 ? "" : "s"}, ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}` : parts[0]}.`;
}
function libraryClaimsRead(household: Household, left: string[]): (text: string, statement?: boolean) => string {
  const live = household.documents.filter((d) => !d.supersededAt);
  return (text: string, statement = false) => {
    // A printed premium is what is charged: "the insurer decides which premium applies" is never said (release-set A6). A
    // statement built on it is left out whole, so no sentence that only explained it is left standing.
    if (statement && PREMIUM_DECIDES(text)) { left.push(text); return ""; }
    return sentences(text).flatMap((x) => {
    if (PREMIUM_DECIDES(x)) { left.push(x); return []; }
    const named = membersNamedIn(household, x);
    const linkedCount = LINKED_COUNT.exec(x);
    if (linkedCount) {
      const whom = membersNamedIn(household, linkedCount[3]);
      const only = !!linkedCount[2] || /\bonly\b/i.test(linkedCount[3]);
      const said = COUNT_WORDS.indexOf(linkedCount[1].toLowerCase()) >= 0 ? COUNT_WORDS.indexOf(linkedCount[1].toLowerCase()) : Number(linkedCount[1]);
      const truth = live.filter((d) => { const to = d.linkedPeople.map(baseName); return whom.every((w) => to.includes(w)) && (!only || to.length === whom.length); }).length;
      if (whom.length && said !== truth) { left.push(x); return [linkCounts(live)]; }
    }
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
  return `${po.percent}% of ${c.person}'s ${cover ? cover + " " : ""}sum insured of ${formatMoney(currencyOf(po.baseAmount, c.base.found.excerpt, bdoc, c.base.found.page).sign, moneyFiguresIn(po.baseAmount)[0].value)} (${docLabel(household, bdoc)}, page ${c.base.found.page}${asOf})`;
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
  /** Texts written here from the library's own record: never held to that record again. */
  const fromRecord = new Set<string>();
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
        // The row's own printed cap ("25% of Sum Assured per claim, maximum RM 50,000 per claim") is the most it pays,
        // whatever the percentage works out to: it is shown as that cap, with the row's conditions, while the percentage
        // stays unworked (TE #311 round 3). Only when the percentage is this row's own figure, and rowCap's checks hold.
        // Allow-list (Critic #318 L1): only a refusal about the percentage's base, for a positive percentage, opens the cap.
        const rowCapped = st.percentOf && st.percentOf.percent > 0 && r.baseUnknown && person ? rowCap(st, r.found ?? found, household, person) : null;
        // The cap is the most a claim pays only when the percentage works out to at least the cap: the card shows the lesser
        // of the percentage of the person's own printed sum (capBase) and the cap, and no figure when that sum cannot be
        // found, since "Up to <cap>" would overstate a claim whose percentage is smaller (TE #311 round 4).
        let own = rowCapped && person ? capBase(st, rowCapped.found, household, person, moneyFiguresIn(rowCapped.raw)[0]?.currency ?? "") : null;
        // Or the person's whole sum insured for this policy as wholeSumInsured proves it (its own schedule's plan table).
        if (rowCapped && person && !own) {
          const bf = wholeSumInsured(st, r.found ?? found, household, person, serverWords);
          const plain = bf ? plainAmount({ ...st, percentOf: null, amount: st.percentOf!.baseAmount, quote: bf.excerpt }, bf, household) : null;
          const capSign = rowCapped.amount.text.replace(/^Up to\s+/, "").replace(/[\d,.\s]+$/, "");
          if (bf && plain?.ok && plain.amount.text.replace(/[\d,.\s]+$/, "") === capSign) own = { value: plain.amount.value, raw: plain.amount.text, base: { found: bf, cover: "", asOf: null } };
        }
        const worked = own ? Math.round(own.value * st.percentOf!.percent) / 100 : null;
        const capCurrency = moneyFiguresIn(rowCapped?.raw ?? "")[0]?.currency ?? "";
        const cap = rowCapped && (worked != null ? worked >= rowCapped.amount.value : capBindsForEverySum(st, rowCapped.found, household, person!, rowCapped.amount.value, capCurrency)) ? rowCapped : null;
        if (rowCapped && own && worked != null && worked < rowCapped.amount.value) {
          // The model may also have written the cap as its own card, already turned into this figure: one card.
          const twin = checked.findIndex((c) => c.person === person && c.amount && sameValue(c.amount.value, worked) && c.found?.docIndex === rowCapped.found.docIndex);
          if (twin >= 0) checked.splice(twin, 1);
          const cur = currencyOf(own.raw, own.base.found.excerpt, household.documents[own.base.found.docIndex], own.base.found.page);
          report.keptAsFact!.push({ why: r.why, text: st.text });
          checked.push({ s: { ...st, kind: "amount", percentOf: { ...st.percentOf!, baseAmount: own.raw }, alternativeGroup: null }, found: rowCapped.found, person, note: null, base: own.base,
            amount: { value: worked, text: formatMoney(cur.sign, worked), currencyResolved: cur.resolved, illustration: true } });
          continue;
        }
        if (!r.asFact && !cap) report.dropped.push({ kind: st.kind, why: r.why, text: st.text });
        else report.keptAsFact!.push({ why: r.why, text: st.text });
        // A percentage that is not worked out is kept as the printed percentage, without an amount. A benefit table's label
        // does not print the percentage (the card's own line does), so it is said here.
        if (st.percentOf) {
          const pct = serverWords.has(st.text) ? `${st.text.replace(/\.\s*$/, "")}: ${st.percentOf.percent}% of ${st.percentOf.baseQuote ? "the sum insured" : "the figure its table prints"}.` : st.text;
          if (cap) checked.push({ s: { ...st, text: pct, kind: "amount", amount: cap.raw, percentOf: null, alternativeGroup: null }, found: cap.found, amount: cap.amount, person, note: null });
          else checked.push({ s: { ...st, text: pct, kind: "fact", amount: null, percentOf: null, alternativeGroup: null }, found: r.found ?? found, amount: null, person, note: null });
        }
        continue;
      }
      const at = r.found ?? found;
      if (!st.percentOf && !whole && /^Up to /.test(r.amount.text)) {
        // A plain card quoting the cap of a percentage row ("Up to RM50,000 - her per-claim maximum") is that row's cap: it
        // stands only where the percentage of the person's own printed sum is at least the cap. Below it, the card shows the
        // worked-out figure; with no sum found, no figure (TE #311 round 4).
        const page = household.documents[at.docIndex].pages.find((p) => p.page === at.page);
        const rowText = page ? rowWithContinuation(page.text, at.offset) : "";
        const pct = percentOfRow(rowText);
        if (pct != null) {
          const capCur = moneyFiguresIn(r.amount.text.replace(/^Up to\s+/, ""))[0]?.currency ?? "";
          const own = person ? capBase({ ...st, percentOf: null }, at, household, person, capCur) : null;
          const worked = own ? Math.round(own.value * pct) / 100 : null;
          if (worked == null) {
            report.keptAsFact!.push({ why: "the cap's percentage is of a sum that is not printed for the person", text: st.text });
            checked.push({ s: { ...st, kind: "fact", amount: null, alternativeGroup: null }, found: at, amount: null, person, note: null });
            continue;
          }
          if (worked < r.amount.value) {
            if (checked.some((c) => c.person === person && c.amount && sameValue(c.amount.value, worked) && c.found?.docIndex === at.docIndex)) continue;
            const cur = currencyOf(own!.raw, own!.base.found.excerpt, household.documents[own!.base.found.docIndex], own!.base.found.page);
            checked.push({ s: { ...st, amount: null, percentOf: { percent: pct, baseAmount: own!.raw, baseDocument: null, baseQuote: null }, alternativeGroup: null }, found: at, person, note: null, base: own!.base,
              amount: { value: worked, text: formatMoney(cur.sign, worked), currencyResolved: cur.resolved, illustration: true } });
            continue;
          }
        }
      }
      if (st.percentOf && st.percentOf.percent > 0 && !whole) {
        const base = r.base ? moneyFiguresIn(st.percentOf.baseAmount)[0]?.value ?? null : moneyFiguresIn(st.percentOf.baseAmount)[0]?.value ?? numbersIn(st.percentOf.baseAmount)[0] ?? null;
        const capped = cappedAmount(st, at, household, person, r.amount, base);
        if (!capped) {
          report.keptAsFact!.push({ why: "the row prints a limit that could not be read", text: st.text });
          checked.push({ s: { ...st, kind: "fact", amount: null, percentOf: null, alternativeGroup: null }, found: at, amount: null, person, note: null });
          continue;
        }
        if (!capped.keep) {
          checked.push({ s: { ...st, kind: "amount", amount: capped.cap.raw, percentOf: null, alternativeGroup: null }, found: capped.cap.found, amount: capped.cap.amount, person, note: null });
          continue;
        }
      }
      checked.push({ s: st, found: at, amount: r.amount, person, note: null, base: r.base ?? null, whole, stay: !r.amount.illustration && (st.perDay || !model.statements.some((x) => x.perDay)) ? stayPays(st, at, household, r.amount, written) : null, count: st.perDay || st.ofBill ? null : countPays(at, household, r.amount, written, st.conditions, st.rowConditions), bill: st.ofBill && !r.amount.illustration ? billAgainst(st, at, household, r.amount, written) : null });
    } else if (st.kind === "fact") {
      if (!found) {
        // A point about a file itself (whether it could be read, whom it is linked to) has no words on any page to quote: it
        // is stated from the library's own record of that file instead, in the server's words (release-set E2, E3).
        const di = Number.isFinite(preferred) ? (preferred as number) : -1;
        // When the question is about the documents themselves ("show me Jamie's documents"), any unquoted point about one
        // file is said the same way (release-set E4).
        if (di >= 0 && di < household.documents.length && (ABOUT_FILE.test(st.text) || aboutLibrary(written[0] ?? ""))) {
          if (!aboutFiles.has(di)) { aboutFiles.add(di); checked.push({ s: { ...st, text: libraryFact(household, household.documents[di]), person: null, conditions: [], alternativeGroup: null }, found: null, amount: null, person: null, note: null, libraryDoc: di }); }
          continue;
        }
        // For a question about the documents, a point about one person's files is that person's list, as the library records it.
        const named = membersNamedIn(household, st.text);
        const whose = person ?? (named.length === 1 ? named[0] : null);
        if (di < 0 && aboutLibrary(written[0] ?? "") && whose) {
          const key = -2 - household.members.findIndex((m) => baseName(m.name) === whose);
          if (!aboutFiles.has(key)) { aboutFiles.add(key); checked.push({ s: { ...st, text: libraryList(household, whose), person: null, conditions: [], alternativeGroup: null }, found: null, amount: null, person: null, note: null, libraryPerson: whose }); }
          continue;
        }
        // A point about several files at once ("The other documents (D1, D2, ...) were read") is stated as the library's count.
        if (di < 0 && /\bD\d+\b/.test(st.text) && ABOUT_FILE.test(st.text)) {
          if (!aboutFiles.has(-1)) { aboutFiles.add(-1); checked.push({ s: { ...st, text: libraryCount(household), person: null, conditions: [], alternativeGroup: null }, found: null, amount: null, person: null, note: null, libraryCount: true }); }
          continue;
        }
        report.dropped.push({ kind: st.kind, why: "quote not found in the stored pages", text: st.text }); continue;
      }
      checked.push({ s: st, found, amount: null, person, note: null });
    } else {
      checked.push({ s: st, found, amount: null, person, note: null, billed: st.kind === "not_found" && st.ofBill ? billUncovered(st, written) : null });
    }
  }
  // For a question about the documents, the points about single files become one list per set of people, wherever the
  // first of them stood (libraryGroups).
  const filePoints = checked.filter((c) => c.libraryDoc != null);
  // A failed file's reason and next step are said once: in its own point when the answer has one, else in the count.
  for (const c of checked) if (c.libraryCount) c.s = { ...c.s, text: libraryCount(household, new Set(filePoints.map((f) => f.libraryDoc!))) };
  if (aboutLibrary(written[0] ?? "") && filePoints.length) {
    const listed = new Set(checked.flatMap((c) => (c.libraryPerson ? [c.libraryPerson] : [])));
    const texts = libraryGroups(household, filePoints.map((c) => household.documents[c.libraryDoc!]), listed);
    for (const t of texts) fromRecord.add(t);
    const at = checked.indexOf(filePoints[0]);
    const after = checked.slice(at).filter((c) => c.libraryDoc == null);
    // A grouped line is the library's record: it cites no page and no one file (Critic R224d).
    checked.splice(at, checked.length - at, ...texts.map((text) => ({ ...filePoints[0], found: null, s: { ...filePoints[0].s, text, document: null } })), ...after);
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
    // The library's own record is never cut by the money filter: a product label with a figure would drop the whole group
    // line (Critic R224c).
    const said = serverWords.has(c.s.text) || fromRecord.has(c.s.text) ? c.s.text : withoutMoney(withoutQuestions(c.s.text, report.questionsLeftOut), report.sentencesLeftOut, read);
    let text = serverWords.has(c.s.text) || fromRecord.has(c.s.text) ? said : library(said, true);
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
    // A stay that ends before the daily benefit starts is paid nothing: the daily rate is not shown as a card for it, only
    // said with the day it starts (stress run 23 Oct, S088).
    if (c.stay && c.stay.payable === 0 && c.amount) {
      const said = `${text.replace(/[.\s]+$/, "")}. ${aDay(c.stay.stay)}-day stay ends before this daily benefit starts, so it pays nothing for that stay.`;
      statements.push({ id: `s${i + 1}`, kind: "fact", text: said, fullText: said, personName: c.person, amount: null, basis: null, conditions, asOf: null, source, group: null });
      return;
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
        : `${aDay(st.stay)}-day stay ends before this daily benefit starts, so it pays nothing for that stay.`;
      statements.push({
        id: `s${i + 1}-stay`, kind: "calculation", text: said, fullText: said, personName: c.person,
        amount: st.payable > 0 ? { text: st.text, currencyResolved: st.currencyResolved, illustration: true } : null,
        basis: `${st.rule} (${st.payable} × ${c.amount!.text}), for the stay you described`,
        conditions, asOf: null, source, group: null,
      });
    }
    if (c.count) {
      const k = c.count, children = (n: number) => `${n} ${n === 1 ? "child" : "children"}`;
      const said = k.payable < k.count
        ? `For ${children(k.count)}, this pays for at most ${children(k.payable)}, if this benefit's conditions are met for each child.`
        : `For ${children(k.count)}, this works out to ${k.payable} times the amount ${k.unit}, if this benefit's conditions are met for each child.`;
      statements.push({
        id: `s${i + 1}-count`, kind: "calculation", text: said, fullText: said, personName: c.person,
        amount: { text: k.text, currencyResolved: k.currencyResolved, illustration: true },
        basis: `${k.rule} (${k.payable} × ${c.amount!.text}), for the children you described`,
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
  // The household's own file names the answer says ("0a1b2c3d-….pdf", "scan_20260101090000.pdf"), from the library record:
  // the output guard keeps them, so a bottom line naming one is never replaced by "Sorry, I couldn't put that answer
  // together" (overnight run 23 Oct, N186, N187).
  const said = [bottomLine, ...nextSteps, ...statements.map((x) => x.text)].join("\n");
  const names = household.documents.map((d) => d.name).filter((n) => n && said.includes(n));
  if (names.length) answer.libraryNames = [...new Set(names)];
  return { answer, report };
}

/** Benefit-table states (lib/benefit-table/service.ts documentState) under which a document's cover is not in the table,
 * so no amount from it reaches the chat: said in the household's words. "read" is not here. */
const TABLE_STATE_WORDS: Record<string, string> = {
  table_unread: "could not have its benefits read", no_table: "has not had its benefits read", not_readable: "could not be read",
  stalled: "stopped being read", held: "is on hold for its scan", waiting: "is still being read",
};
/** Table states in which a receipt or letter is a misfiled policy pack whose cover was not read (documentState). */
const MISFILED_STATES = new Set(["table_unread", "waiting"]);
/** Why a document's cover may be missing from an answer, or null when it was read in full. */
function notCountedWhy(d: HouseholdDocument, tableStates: ReadonlyMap<string, string> | null): string | null {
  if (stillReading(d)) return "is still being read";
  if (onHold(d)) return onHoldWords(d) === "on hold" ? "is on hold" : "is on hold for its scan";
  if (unreadable(d)) return "could not be read";
  const state = tableStates?.get(d.policyId);
  if (state && TABLE_STATE_WORDS[state]) return TABLE_STATE_WORDS[state];
  if (readInPart(d)) return "was read only in part";
  return null;
}
/** A person's documents: linked to them, or uploaded for them (or for no one) and linked to no one. */
const ownedBy = (d: HouseholdDocument, person: string) =>
  d.linkedPeople.some((p) => baseName(p) === person) || (!d.linkedPeople.length && (!d.uploadedFor || baseName(d.uploadedFor) === person));
/** "A", "A and B", "A, B and C". */
const andList = (xs: string[]) => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/** An answer that shows amounts for a person while some of that person's documents gave it nothing (not read, read only
 * in part, still being read, or whose benefits the table could not read) never reads as the person's whole cover: the
 * bottom line says the amounts may not be all of it, and names those documents (fresh-start run 10 Nov: a death answer
 * showed one policy's figure while another policy's benefits were unread). Documents that hold no cover (receipts,
 * letters, unless the table says one is a misfiled pack still to read) and superseded copies are not counted. With amounts for no named person, every such document counts.
 * `tableStates`: each document's benefit-table state (policy id to state), when the table is on; `charged`: the premium
 * rows' labels (RowReport.premiumLabels). Returns the sentence
 * added, or null. */
/** The note as noteCoverNotCounted writes it, for any person and documents: a bottom line the model wrote may repeat an
 * earlier turn's note (the history it is sent carries it), which is taken out before this turn's note is said (TE #402). */
const COVER_NOTE = /\s*This may not be all of [^:.]{1,200}?(?:’|')s cover: [\s\S]*?, so any cover in (?:it|them) is not counted here and the amounts shown are not a total\./g;
export function noteCoverNotCounted(answer: StructuredAnswer, household: Household, tableStates: ReadonlyMap<string, string> | null = null, charged: ReadonlySet<string> = new Set()): string | null {
  // An earlier note the model repeated is never kept: this turn's note (or none) is the one that holds now.
  const repeated = (answer.bottomLine ?? answer.summary ?? "");
  const cleaned = repeated.replace(COVER_NOTE, "").trim();
  if (cleaned !== repeated.trim()) { answer.bottomLine = cleaned; answer.summary = cleaned; }
  // A premium is charged, never claimed: an answer whose every amount is a premium row's own card is not about cover.
  const amounts = (answer.statements ?? []).filter((s) => s.amount && !charged.has(s.text));
  if (!amounts.length) return null;
  const people = [...new Set(amounts.map((s) => s.personName ?? null))];
  // A receipt or letter holds no cover, unless the table says it is a misfiled pack waiting for Read again or being read
  // (lib/benefit-table/service.ts documentState): then its state decides, as everywhere else (Critic #402).
  const coverHolding = (d: HouseholdDocument) => !NO_COVER_READING_ROLES.includes(d.documentRole ?? "") || MISFILED_STATES.has(tableStates?.get(d.policyId) ?? "");
  const candidates = household.documents.filter((d) => !d.supersededAt && coverHolding(d));
  const notes: string[] = [];
  const named = people.filter((p): p is string => !!p);
  const sayWho = named.length > 0 && !people.includes(null);
  const groups = sayWho ? named.map((p) => ({ who: p, docs: candidates.filter((d) => ownedBy(d, p)) })) : [{ who: null, docs: candidates }];
  for (const g of groups) {
    const missing = g.docs.flatMap((d) => { const why = notCountedWhy(d, tableStates); return why ? [`${labelFor(household, d)} ${why}`] : []; });
    if (!missing.length) continue;
    const whose = g.who ? `${g.who}’s` : "your household’s";
    notes.push(`This may not be all of ${whose} cover: ${andList(missing)}, so any cover in ${missing.length === 1 ? "it" : "them"} is not counted here and the amounts shown are not a total.`);
  }
  if (!notes.length) return null;
  const said = notes.join(" ");
  const head = (answer.bottomLine ?? answer.summary ?? "").trim();
  answer.bottomLine = head ? `${head.replace(/([^.!?])$/, "$1.")} ${said}` : said;
  answer.summary = answer.bottomLine;
  const names = household.documents.map((d) => d.name).filter((n) => n && said.includes(n));
  if (names.length) answer.libraryNames = [...new Set([...(answer.libraryNames ?? []), ...names])];
  return said;
}

/** The text a later turn shows the model for this answer. */
export function answerAsText(answer: Pick<ChatAnswer, "summary" | "nextSteps" | "questions"> & { statements?: AnswerStatement[]; bottomLine?: string | null }): string {
  const lines = [answer.bottomLine || answer.summary, ...(answer.statements ?? []).map((s) => `- ${s.personName ? s.personName + ": " : ""}${s.amount ? s.amount.text + " — " : ""}${s.text}${s.source ? ` (${s.source.policyName}, page ${s.source.page})` : ""}`), ...answer.nextSteps.map((n) => `Next: ${n}`), ...answer.questions.map((q) => q.text)];
  return lines.filter(Boolean).join("\n");
}
export { documentId };
