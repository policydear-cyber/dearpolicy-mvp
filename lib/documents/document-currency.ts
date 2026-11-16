/** The currency a document states once for all its amounts (a schedule whose figure lines print no currency at all:
 * "Critical Illness  100,000.00", with "Currency : Singapore Dollar" in its header, its footer or on another page).
 * The fact check (lib/documents/fact-check.ts checkCoverage) confirms a bare, money-shaped figure on a cover benefit's own
 * evidence line in that currency, at intake only, when every one of these holds (an allow-list throughout):
 * - the document states its currency in a closed list of shapes, at document level: a field ("Currency : SGD", "Policy
 *   Currency - Singapore Dollars") or a sentence about all its amounts ("All amounts are in Singapore Dollars"). A
 *   statement under or inside a premium, fund, value, table, section or rider heading is that part's, and never counts;
 * - the statement names SGD or USD in one of their own spellings ("S$", "SGD", "Singapore Dollar(s)"; "US$", "USD", "US
 *   Dollar(s)"). A bare "$" or "dollars" never names one;
 * - every currency-like token on every page of the document, read from the page's own text before any check stripped
 *   it, and from its image reading, is one of that currency's own spellings (or a bare "$" / "dollars"): any other code,
 *   any letters before a "$" but the currency's own ("USS", "U5$", "A$"), any other currency sign or word, a
 *   denomination, "payable in" anything else, or the word "currency" outside an allowed field gives none;
 * - no page is unread, empty or failed to read, and no exception wording ("except", "save for", "other than", "unless",
 *   "excluding", "not in ...") anywhere in the document refers to a currency, plan, rider or policy;
 * - the evidence line prints no currency-like token of its own, its figure stands alone in its cell, and its label names
 *   a cover benefit (never a premium, deductible, excess, fund units or a value).
 * Only within one document. Pure: no model, no I/O, nothing about a particular insurer or document. */

export type StatedCurrency = "SGD" | "USD";

const SGD_VALUE = String.raw`(?:S\$|SG\$|SGD|Singapore\s+Dollars?)`;
const USD_VALUE = String.raw`(?:US\$|U\.S\.\$|USD|(?:US|U\.S\.)\s+Dollars?|United\s+States\s+Dollars?)`;
/** The value a statement gives, as a currency: "SGD", "Singapore Dollars (SGD)", or the value followed by the next field
 * on the same line ("Singapore Dollar Policy Term: 20 years"). Anything else is no currency of the list. */
function valueCurrency(value: string): StatedCurrency | null {
  const v = value.trim().replace(/[.;,]+$/, "").trim();
  const one = (core: string) => new RegExp(String.raw`^${core}(?:\s*\(\s*${core}\s*\))?(?:\s+only)?(?:$|\s+[A-Z][A-Za-z]*(?:\s+[A-Za-z()]+){0,4}\s*:)`, "i");
  if (one(SGD_VALUE).test(v)) return "SGD";
  if (one(USD_VALUE).test(v)) return "USD";
  return null;
}

// ---------------------------------------------------------------------------
// Currency-like tokens (an allow-list: anything not one of the two currencies' own spellings is "other")
// ---------------------------------------------------------------------------
export type CurrencyToken = { raw: string; code: StatedCurrency | "$" | "other" };
/** Codes of currencies (ISO 4217, the ones a policy may print): counted beside a figure, in brackets, as a cell, or after
 * a colon. Any other three capitals count only right beside a figure ("USS 300,000.00"). */
const ISO = new Set(("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP BYN BZD CAD CDF CHF CLP CNH CNY COP CRC CUP CVE CZK "
  + "DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD "
  + "KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB "
  + "RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR "
  + "ZMW ZWL RMB").split(" "));
/** Three capitals beside a figure that are never money: ages, days, references, months, units. */
const NOT_MONEY_CAPS = new Set("AGE DAY NOS REF TEL FAX BLK APT BOX PER NOV DEC JAN FEB MAR APR MAY JUN JUL AUG SEP OCT YRS MTH MOS PTE LTD NET KMS TPD ECI ICU HDU MRI CT GST".split(" "));
const CURRENCY_WORDS = /\b(?:won|yen|yuan|renminbi|rupees?|rupiah|baht|ringgit|francs?|euros?|pounds?|sterling|dinars?|patacas?|lira|liras|roubles?|rubles?|taka|pesos?|dirhams?|riyals?|rials?|kron(?:a|e|or|er)|zloty|forint|rand|shekels?|kip|kyat|riel|dong|rufiyaa|naira|cedis?|shillings?|reais|kwacha|lempira|quetzal|bolivar(?:es)?|guarani|hryvnia|tenge|lari|manat|som|somoni|dram|leu|lei|lev|ngultrum|afghani|ariary|birr|nakfa|dalasi|leone|loti|pula|lilangeni|kina|vatu|tala|pa'anga|ouguiya|denar|marka|kuna|koruna|kunas)\b/gi;
const DOLLAR_PHRASE = /\b([A-Za-z.]+(?:\s+[A-Za-z.]+)?)\s+dollars?\b/gi;
const PAYABLE_IN = /\bpayable\s+in\s+([^.;,\n]{0,40})/gi;
const PAYABLE_IN_OK = /^(?:advance|arrears|full|(?:a|one)\s+lump\s+sum|lump\s+sum|(?:equal\s+)?instal+ments?|accordance|respect|the\s+event|hospital|addition|total|each|any|one|the\s+(?:same|following)|monthly|yearly|annual|quarterly|half-?yearly)\b/i;

/** The currency a spelling names, when it is one of the two currencies' own; "other" for anything else. */
const spelled = (t: string): StatedCurrency | "other" => valueCurrency(t) ?? "other";

/** Every currency-like token in the text (see the module note). */
export function currencyTokens(text: string): CurrencyToken[] {
  const t = String(text ?? "").normalize("NFKC"), out: CurrencyToken[] = [];
  // Letters (or a misread digit and letters) before a "$": only "S$" / "SG$" and "US$" / "U.S.$" are spellings.
  for (const m of t.matchAll(/(?<![A-Za-z0-9])((?:[A-Za-z]|\d(?=[A-Za-z]))[A-Za-z0-9.]{0,4})?\s?\$/g)) {
    const p = (m[1] ?? "").replace(/\s/g, "");
    out.push({ raw: m[0], code: !p ? "$" : /^(?:S|SG)$/i.test(p) ? "SGD" : /^(?:US|U\.S\.)$/i.test(p) ? "USD" : "other" });
  }
  // Any other currency sign.
  for (const m of t.matchAll(/\p{Sc}/gu)) if (m[0] !== "$") out.push({ raw: m[0], code: "other" });
  // Three capitals: a currency code beside a figure, in brackets, as a cell, or after a colon; any other beside a figure.
  for (const m of t.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]{2})(?![A-Za-z0-9])/g)) {
    const code = m[1], at = m.index!, prev = t.slice(0, at), next = t.slice(at + 3);
    const byFigure = /^[ \t]?\d/.test(next) || /\d[ \t]?$/.test(prev);
    const inBrackets = /\(\s*$/.test(prev) && /^\s*\)/.test(next);
    const asCell = /(?:^|\n|\t)[ ]*$/.test(prev) && /^[ ]*(?:$|\n|\t)/.test(next);
    const afterColon = /:\s*$/.test(prev.slice(-4));
    const counted = ISO.has(code) ? byFigure || inBrackets || asCell || afterColon
      : /\d/.test(code) ? byFigure || afterColon || inBrackets || asCell
      : byFigure && !NOT_MONEY_CAPS.has(code);
    if (counted) out.push({ raw: code, code: code === "SGD" ? "SGD" : code === "USD" ? "USD" : "other" });
  }
  // "RM 300", "Rs. 500": a currency's letters right before a figure.
  for (const m of t.matchAll(/(?<![A-Za-z])(RM|Rs\.?|Rp\.?|zł|kr|Bs\.?)\s?\d/g)) out.push({ raw: m[1], code: "other" });
  // Currency words, and dollars of any country but the two.
  for (const m of t.matchAll(CURRENCY_WORDS)) out.push({ raw: m[0], code: "other" });
  for (const m of t.matchAll(DOLLAR_PHRASE)) {
    const c = spelled(m[0]);
    if (c !== "other") { out.push({ raw: m[0], code: c }); continue; }
    const last = m[1].split(/\s+/).pop() ?? "";
    out.push({ raw: m[0], code: /^(?:singapore|us|u\.s\.|states)$/i.test(last) ? (spelled(`${last === "states" ? "United States" : last} dollars`) as StatedCurrency) : /^(?:in|of|the|and|or|all|any|to|per|a|its|your|our|their|these|those|are|is|be|by|for)$/i.test(last) ? "$" : "other" });
  }
  // A denomination, "payable in" anything but a currency's own spelling or a closed set of non-currency phrases, and
  // the word "currency" anywhere but an allowed field: counted as other unless they name the currency themselves.
  for (const m of t.matchAll(/\bdenominat\w*\b[^\n]{0,30}/gi)) {
    const v = /\b(?:in|:|-)\s*([^.;,\n]{1,30})/.exec(m[0]);
    out.push({ raw: m[0], code: v ? spelled(v[1]) : "other" });
  }
  for (const m of t.matchAll(PAYABLE_IN)) {
    const v = m[1].trim();
    if (PAYABLE_IN_OK.test(v)) continue;
    out.push({ raw: m[0], code: spelled(v.split(/\s+(?:only|per|for|each|a|an|on|at|by|from|to|with|under)\b/i)[0]) });
  }
  // "Currencv" (a misread "y") is the word too.
  for (const m of t.matchAll(/\bcurrenc(?:y|ies|v)\b/gi)) {
    const f = FIELD_AT.exec(t.slice(m.index!).split("\n")[0]);
    out.push({ raw: m[0], code: f ? spelled(f[2]) : "other" });
  }
  return out;
}
/** A currency field from the word "currency" on: "Currency : SGD", "Currency of the Policy - S$", "Currency\tSGD". */
const FIELD_AT = /^currenc(?:y|ies|v)(\s+of\s+[A-Za-z ]{1,30}?(?=\s*(?::|=|–|-\s|\t|\s{2,})))?\s*(?::|=|–|-\s|\t|\s{2,}|\s(?=(?:S\$|SG\$|SGD|US\$|U\.S\.|USD|Singapore|United)))\s*([^\t|]*?)\s*(?=\t|\s{2,}|\||$)/i;

/** Whether the line prints any currency-like token of its own (it is then never a bare line). */
export const lineNamesCurrency = (line: string) => currencyTokens(line).length > 0;

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------
/** A field or sentence about a part of the document only: premiums, funds, values, a table, a section, a rider, a plan. */
const SCOPED = /\b(?:premiums?|payments?|paying|funds?|units?|cash\s+values?|surrender|values?|tables?|sections?|parts?|appendix|annex|riders?|plan\s+[a-z0-9]\b|illustrations?|projections?|loans?|bonus(?:es)?|dividends?|mode|billing|top-?ups?|withdrawals?|annuity|coupons?|maturity)\b/i;
/** A sentence about all of the document's amounts, opening its line. */
const SENTENCE = new RegExp(String.raw`^\s*\(?\s*(?:all\s+)?(?:the\s+)?(?:monetary\s+)?(?:amounts?|figures|sums(?:\s+(?:insured|assured))?|benefits)`
  + String.raw`(?:\s+(?:shown|stated|listed|printed|payable|quoted))?`
  + String.raw`(?:\s+(?:in|on|under)\s+this\s+(?:schedule|document|policy|certificate))?`
  + String.raw`(?:\s+(?:are|is|will\s+be|shall\s+be))?(?:\s+(?:shown|stated|expressed|denominated|quoted|presented|given|payable))?`
  + String.raw`\s+in\s+([^.;)\]\n]{1,60}?)\s*[.;)\]]?\s*$`, "i");
/** An exception that may take some amounts out of the statement: anywhere in the document. */
const EXCEPTION = /\b(?:except(?:ion)?|save\s+(?:for|as|that)|other\s+than|unless|excluding|exclud(?:e|es|ed)|apart\s+from|but\s+for)\b[^.\n]{0,80}?\b(?:currenc\w*|SGD|USD|S\$|US\$|dollars?|singapore|plans?|riders?|polic(?:y|ies)|amounts?|benefits?)\b|\bnot\s+(?:in|denominated\s+in|payable\s+in|expressed\s+in)\s+(?:SGD|S\$|USD|US\$|singapore|u\.?s\.?\b|dollars?)/i;

/** The statements of the document's currency: each line that is, as a whole, a currency field or a sentence about all
 * amounts, not under or inside a scoped heading (SCOPED). A field or sentence whose value is not a currency of the list
 * gives "other". */
export function currencyStatements(text: string): (StatedCurrency | "other")[] {
  const lines = String(text ?? "").normalize("NFKC").split("\n"), out: (StatedCurrency | "other")[] = [];
  const heading = (i: number) => { for (let j = i - 1; j >= 0 && j >= i - 3; j--) if (lines[j].trim()) return lines[j]; return ""; };
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    let value: string | null = null;
    // A field: the line (or its first cell) is "<label words> Currency <sep> <value>".
    // The field may be a cell of its line ("Name\tMei Tan\t\tCurrency\tSGD"); its label words are its own cell's.
    const f = /(?:^|\t|\s{2,})(?:([A-Za-z/ ]{0,30}?)[ ]*)?(currenc(?:y|ies|v)\b.*)$/i.exec(line);
    const field = f ? FIELD_AT.exec(f[2]) : null;
    if (field && (!f![1] || /^(?:policy|contract|plan|benefits?|basic|base|schedule|sum\s+(?:assured|insured))(?:\s*\/\s*(?:sum\s+(?:assured|insured)|benefits?))?$/i.test(f![1].trim()))) value = field[2];
    const s = value == null ? SENTENCE.exec(line) : null;
    if (s) value = s[1];
    if (value == null || !value.trim()) continue;
    // A part's own statement is never the document's (it does not count, and it does not block: the token scan does).
    if (SCOPED.test(line.replace(value, " ")) || (field && SCOPED.test(field[1] ?? "")) || SCOPED.test(heading(i))) continue;
    if (/^(?:\$|dollars?)$/i.test(value.trim().replace(/[.;,]+$/, ""))) continue;
    out.push(valueCurrency(value) ?? "other");
  }
  return out;
}
/** The currencies a document's text states for all its amounts (currencyStatements), the list's only. */
export const statedCurrencies = (text: string) => currencyStatements(text).filter((c): c is StatedCurrency => c !== "other");

export type CurrencyPage = { text: string; rawText?: string; imageText?: string; imageCurrency?: string; unreadable?: boolean; notRead?: boolean };
/** The one currency the document states for all its amounts, or null (see the module note). `pages`: the document's
 * checked pages, where a statement counts. `allPages`: every page of the document, checked or not, each with its own
 * text before any check stripped it (rawText) and its image reading (imageText). */
export function documentStatedCurrency(pages: CurrencyPage[], allPages: CurrencyPage[] = pages): StatedCurrency | null {
  if (allPages.some((p) => p.unreadable || p.notRead || !String(p.rawText ?? p.text ?? "").trim())) return null;
  const stated = new Set(currencyStatements(pages.map((p) => p.text).join("\n")));
  if (stated.size !== 1 || stated.has("other")) return null;
  const code = [...stated][0] as StatedCurrency;
  const texts = [...pages, ...allPages].flatMap((p) => [p.rawText ?? p.text, p.text, p.imageText ?? ""]);
  for (const t of texts) {
    if (EXCEPTION.test(t.replace(/\s+/g, " "))) return null;
    if (currencyTokens(t).some((x) => x.code !== code && x.code !== "$")) return null;
  }
  for (const p of [...pages, ...allPages]) if (p.imageCurrency && p.imageCurrency.toUpperCase() !== code) return null;
  return code;
}

/** A bare figure in an amount position: the whole of its cell, or the end of its line, with no unit or other word after it
 * in the same cell ("100,000.00 units", "10,000.00 km" are not amounts). */
export function figureStandsAlone(line: string, value: number): boolean {
  for (const m of String(line ?? "").matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})/g)) {
    if (Math.abs(Number(m[1].replace(/,/g, "")) - value) >= 0.005) continue;
    const before = line.slice(0, m.index), after = line.slice(m.index + m[1].length);
    if (!/(?:\t|\s{2,}|[A-Za-z):]\s)$/.test(before)) continue;
    if (!/^\s*(?:$|\t|\s{2,})/.test(after)) continue;
    return true;
  }
  return false;
}

/** Words of a cover benefit's label (an allow-list): the evidence line's label must hold one, and none of NOT_COVER. */
const COVER_WORD = /\b(?:death|dies|life|illness(?:es)?|critical|dread|cancer|disabilit\w*|tpd|ci|eci|accident\w*|injur\w*|hospital\w*|cash|income|allowance|benefits?|cover(?:age)?|sum\s+(?:assured|insured)|outpatient|in-?patient|surgical|surgery|medical|fracture|dismemberment|funeral|terminal|permanent|early|maternity|dental|ward|daily|rider|term|protection|payout|lump\s+sum|recovery|ambulance|rehabilitation|nursing|care)\b/i;
const NOT_COVER = /\b(?:premiums?|deductibles?|excess(?:es)?|co-?pay\w*|co-?insurance|funds?|units?|unit\s+price|nav|values?|surrender|loans?|bonus(?:es)?|dividends?|age|years?|start|date|term\s+\(?years|no\.?|number|policy\s+year|projected|illustrat\w*|tax|gst|fees?|charges?|policy\s+term|premium\s+term)\b/i;
/** Whether the evidence line's label (its words before the figure) names a cover benefit and nothing that is not one. */
export function coverBenefitLabel(line: string, value: number): boolean {
  const m = /(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})/.exec(String(line ?? "").split("\n").find((l) => figureStandsAlone(l, value)) ?? "");
  const label = m ? m.input.slice(0, m.index) : "";
  return COVER_WORD.test(label) && !NOT_COVER.test(label);
}
