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
// The single-currency scan: an allow-list. Anything that may be a currency and is not one of the stated currency's own
// spellings is "foreign", and any foreign token anywhere in the document gives no fill.
// ---------------------------------------------------------------------------
/** ISO 4217 codes, active and recent (with RMB, CNH): the full list, not a hand-picked one. */
const ISO_4217 = new Set(("AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BYR BZD CAD CDF CHE CHF CHW "
  + "CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ILS INR IQD IRR "
  + "ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LTL LVL LYD MAD MDL MGA MKD MMK MNT MOP MRO MRU MUR MVR MWK MXN MXV MYR MZN NAD "
  + "NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STD STN SVC SYP SZL THB TJS TMT "
  + "TND TOP TRY TTD TVD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VEF VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XDR XOF XPD XPF XPT XSU XTS XUA XXX "
  + "YER ZAR ZMK ZMW ZWG ZWL RMB CNH").split(" "));
/** Codes that are also common English words or names: matched only in capitals, and in capitals not inside a line of
 * capitals ("ALL AMOUNTS ARE IN SGD"). Beside a figure they are caught by the figure check anyway ("ALL 300,000"). */
const ENGLISH_CODES = new Set("ALL TOP CAD CUP MOP BOB PEN TRY SOS GEL BAM MAD RUB COP RON ANG".split(" "));
/** The stated currency's own spellings next to a figure (glued or a word apart). */
const SPELLINGS: Record<StatedCurrency, Set<string>> = { SGD: new Set(["S$", "SG$", "SGD"]), USD: new Set(["US$", "U.S.$", "USD"]) };
/** The stated currency's full names ("Singapore Dollars"), which may follow or precede a figure. */
const FULL_NAME: Record<StatedCurrency, RegExp> = { SGD: /^singapore\s+dollars?\b/i, USD: /^(?:united\s+states|u\.?s\.?)\s+dollars?\b/i };
/** Words that may follow a figure, a space apart (an explicit list): units of time, rates, grammar. */
const AFTER_OK = new Set(("days day nights night years year yrs yr months month mths weeks week hours per a an each every only and or to in for of on at "
  + "from with by max maximum min minimum the x times % percent cent sum assured insured is are was will be payable paid upon if plus less p.a. pa units unit").split(" "));
/** Short words that may precede a figure, a space apart (an explicit list); a longer word is a label ("Death 200,000.00"). */
const BEFORE_OK = new Set(("to of up at is be and or for max min the a an by from with than are was no upto plus each in on per sum life plan term cash ward "
  + "care ci eci tpd pa icu hdu age day days year rate amt base net fee total").split(" "));
const CJK_SIGNS = /[円元圆圓块]/u;
const CURRENCY_WORDS = /\b(?:won|yen|yuan|renminbi|rupees?|rupiah|baht|ringgit|francs?|euros?|pounds?|sterling|dinars?|patacas?|lira|liras|lire|roubles?|rubles?|taka|pesos?|dirhams?|riyals?|rials?|kron(?:a|e|or|er)|zloty|forint|rand|real|reais|shekels?|kip|kyat|riel|dong|rufiyaa|naira|cedis?|shillings?|kwacha|lempira|quetzal|bolivar(?:es)?|guarani|hryvnia|tenge|lari|manat|somoni|dram|leu|lei|lev|ngultrum|afghani|ariary|birr|nakfa|dalasi|leone|loti|pula|lilangeni|kina|vatu|tala|ouguiya|denar|koruna|kuna|greenbacks?)\b/gi;
const PAYABLE_IN = /\bpayable\s+in\s+([^.;,\n]{0,40})/gi;
const PAYABLE_IN_OK = /^(?:advance|arrears|full|(?:a|one)\s+lump\s+sum|lump\s+sum|(?:equal\s+)?instal+ments?|accordance|respect|the\s+event|hospital|addition|total|each|any|one|the\s+(?:same|following)|monthly|yearly|annual|quarterly|half-?yearly)\b/i;
/** A money-shaped figure: a thousands separator or two decimals. */
const MONEY_FIGURE = /(?<![\d.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})(?![\d,]|\.\d)/g;
const EDGE_PUNCT = /^[(\[:=*#"'“”‘’–-]+|[)\],;.:*"'“”‘’]+$/g;

/** Every foreign token in the text, for a document that states `code` (null: nothing is allowed, as for the evidence
 * line of a bare figure). See the module note. */
export function foreignCurrency(text: string, code: StatedCurrency | null, { tokensOnly = false } = {}): string[] {
  const t = String(text ?? "").normalize("NFKC").replace(/ /g, " "), out: string[] = [];
  const allowed = (tok: string) => !!code && SPELLINGS[code].has(tok);
  // 1. Every money-shaped figure: what is glued to it, and the one word a single space before and after it.
  for (const m of tokensOnly ? [] : t.matchAll(MONEY_FIGURE)) {
    const at = m.index!, before = t.slice(0, at), after = t.slice(at + m[0].length);
    const glueB = (/(\S*)$/.exec(before)?.[1] ?? "").replace(EDGE_PUNCT, "");
    const glueA = (/^(\S*)/.exec(after)?.[1] ?? "").replace(EDGE_PUNCT, "");
    if (glueB && !(glueB === "$" && code) && !allowed(glueB)) out.push(glueB);
    if (glueA && glueA !== "%" && !allowed(glueA) && !AFTER_OK.has(glueA.toLowerCase())) out.push(glueA);
    if (!glueB) {
      // The word a single space before (a longer word is a label: "Death 200,000.00"; a gap of two spaces or a tab is a cell).
      const prev = /(?:^|\s)(\S+) $/.exec(before);
      if (prev && !/ {2}$/.test(before)) {
        const tok = prev[1].replace(EDGE_PUNCT, "");
        const fullBefore = code ? new RegExp(String.raw`(?:${code === "SGD" ? "singapore" : "united\\s+states|u\\.?s\\.?"})\s+dollars?\s$`, "i").test(before) : false;
        if (tok && !allowed(tok) && !(tok === "$" && code) && !fullBefore && !/^\d[\d,.]*$/.test(tok) && tok.length <= 4 && !BEFORE_OK.has(tok.toLowerCase())) out.push(tok);
      }
    }
    if (!glueA) {
      const next = /^ (?! )([^\s]+)/.exec(after);
      if (next) {
        const tok = next[1].replace(EDGE_PUNCT, "");
        const full = code ? FULL_NAME[code].test(after.trimStart()) : false;
        if (tok && !allowed(tok) && !full && !/^\d[\d,.]*$/.test(tok) && !AFTER_OK.has(tok.toLowerCase())) out.push(tok);
      }
    }
  }
  // 2. Currency codes anywhere, as whole words: in capitals always (an English-word code not inside a line of capitals),
  //    and in any case for every other code. Digits may touch them ("USD300,000.00").
  for (const m of t.matchAll(/(?<![A-Za-z])([A-Za-z]{3})(?![A-Za-z])/g)) {
    const w = m[1], up = w.toUpperCase();
    if (!ISO_4217.has(up) || up === code) continue;
    if (ENGLISH_CODES.has(up)) {
      if (w !== up) continue;
      const line = t.slice(t.lastIndexOf("\n", m.index!) + 1, (t.indexOf("\n", m.index!) + 1 || t.length + 1) - 1);
      if (!/[a-z]/.test(line) && (line.match(/[A-Z]{2,}/g) ?? []).length >= 3) continue;
    }
    out.push(w);
  }
  // 3. Currency signs: any but "$", the CJK signs, and a "$" with any letters glued before it but the allowed spellings.
  for (const m of t.matchAll(/\p{Sc}/gu)) if (m[0] !== "$") out.push(m[0]);
  for (const m of t.matchAll(new RegExp(CJK_SIGNS.source, "gu"))) out.push(m[0]);
  for (const m of t.matchAll(/([A-Za-z.]*\d?[A-Za-z.]*)\$/g)) {
    const p = m[1];
    if (!p) { if (!code) out.push("$"); continue; }
    if (!allowed(`${p}$`)) out.push(`${p}$`);
  }
  // 4. Currency words; "dollar(s)" only as the stated currency's full name.
  for (const m of t.matchAll(CURRENCY_WORDS)) out.push(m[0]);
  for (const m of t.matchAll(/\bdollars?\b/gi)) {
    const before = t.slice(Math.max(0, m.index! - 20), m.index);
    const ok = code === "SGD" ? /\bsingapore\s+$/i.test(before) : code === "USD" ? /(?:\bunited\s+states|\bu\.?s\.?)\s+$/i.test(before) : false;
    if (!ok) out.push(m[0]);
  }
  // 5. A denomination, "payable in" anything but the currency or a closed set of non-currency phrases, and the word
  //    "currency" anywhere but a field whose value is the currency's own spelling.
  if (tokensOnly) return out;
  const own = (v: string) => !!code && valueCurrency(v) === code;
  for (const m of t.matchAll(/\bdenominat\w*\b[^\n]{0,30}/gi)) {
    const v = /\b(?:in|:|-)\s*([^.;,\n]{1,30})/.exec(m[0]);
    if (!v || !own(v[1])) out.push(m[0]);
  }
  for (const m of t.matchAll(PAYABLE_IN)) {
    const v = m[1].trim();
    if (PAYABLE_IN_OK.test(v)) continue;
    if (!own(v.split(/\s+(?:only|per|for|each|a|an|on|at|by|from|to|with|under)\b/i)[0])) out.push(m[0]);
  }
  for (const m of t.matchAll(/\bcurrenc(?:y|ies|v)\b/gi)) {
    const f = FIELD_AT.exec(t.slice(m.index!).split("\n")[0]);
    if (!f || !own(f[2])) out.push(m[0]);
  }
  return out;
}
/** A currency field from the word "currency" on: "Currency : SGD", "Currency of the Policy - S$", "Currency\tSGD". */
const FIELD_AT = /^currenc(?:y|ies|v)(\s+of\s+[A-Za-z ]{1,30}?(?=\s*(?::|=|–|-\s|\t|\s{2,})))?\s*(?::|=|–|-\s|\t|\s{2,}|\s(?=(?:S\$|SG\$|SGD|US\$|U\.S\.|USD|Singapore|United)))\s*([^\t|]*?)\s*(?=\t|\s{2,}|\||$)/i;

/** Whether the line prints anything that may be a currency (it is then never a bare line): the same scan, with nothing
 * allowed. */
export const lineNamesCurrency = (line: string) => foreignCurrency(line, null).length > 0;
/** Whether a line that prints a figure read in `code` also prints another currency's code, sign or word (glued to the
 * figure or not): "Death  AUD300,000.00" or "Death  A$300,000.00" is never an SGD line. */
export const lineNamesOtherCurrency = (line: string, code: StatedCurrency) => foreignCurrency(line, code, { tokensOnly: true }).length > 0;

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
  // The heading of the statement's section: the nearest heading line above it (a short line with no figure, field or
  // sentence end), however far up; fields and rows between do not end the section.
  const isHeading = (l: string) => { const x = l.trim(); return !!x && !/[\t\d:]/.test(x) && x.length <= 60 && !/[.;]$/.test(x) && x.split(/\s+/).length <= 8; };
  const heading = (i: number) => { for (let j = i - 1; j >= 0; j--) if (isHeading(lines[j])) return lines[j]; return ""; };
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
    if (foreignCurrency(t, code).length) return null;
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
