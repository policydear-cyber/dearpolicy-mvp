/** The currency a document states once for all its amounts (a schedule whose figure lines print no currency at all:
 * "Critical Illness  100,000.00", with "Currency : Singapore Dollar" in its header, its footer or on another page).
 * The fact check (lib/documents/fact-check.ts checkCoverage) confirms a bare, money-shaped figure on a cover's own
 * evidence line in that currency, only when every one of these holds:
 * - the document states its currency in one of a closed list of statement shapes: a field ("Currency : SGD", "Policy
 *   Currency - Singapore Dollars", "Currency of the Policy: US$") or a sentence about the document's amounts ("All amounts
 *   are in Singapore Dollars", "All figures shown in this schedule are expressed in SGD", "(Amounts in S$)"). A currency
 *   merely mentioned (an address, a reference number, "converted to Singapore Dollars at the prevailing rate") is no
 *   statement;
 * - the statement names a dollar currency explicitly ("S$", "SGD", "Singapore Dollar(s)", "US$", "USD", "US Dollar(s)").
 *   A bare "$" or "dollars" never names one;
 * - the document names no other currency anywhere: not in a second statement, a figure ("US$ 50,000", "RM 120,000"), a
 *   currency word or sign, or the currency its page images print. Two currencies, or one the list does not know, give none;
 * - no currency field or statement anywhere in the document (checked pages or not) gives a value outside the allow-list
 *   ("Policy Currency : USS" blocks), and no statement has an exception on its line or the next ("save for", "except");
 *   a premium, rider or value field ("Premium Currency : SGD") is never a statement for the whole document;
 * - the evidence line itself prints no explicit currency (a line's own currency always decides), and its figure stands
 *   alone in its cell with no unit after it ("100,000.00 units" is not an amount: figureStandsAlone).
 * Only within one document: the pages passed are that document's own, never another document of the household.
 * Pure: no model, no I/O, nothing about a particular insurer or document. */

export type StatedCurrency = "SGD" | "USD";
/** The key in policies.extracted_json that records, at intake, every page checked against its image and the one currency
 * that image printed (or null): { "3": "USD", "4": null }. A page not listed was not looked at against its image. */
export const PAGE_IMAGE_CURRENCY_KEY = "pageImageCurrency";

const SGD_VALUE = String.raw`(?:S\$|SG\$|SGD|Singapore\s+Dollars?)`;
const USD_VALUE = String.raw`(?:US\$|USD|U\.?S\.?\s+Dollars?|United\s+States\s+Dollars?)`;
/** The value a statement gives, as a currency: "SGD", "Singapore Dollars (SGD)", "S$ (Singapore Dollar)", or the value
 * followed by the next field on the same line ("Singapore Dollar Policy Term: 20 years"). A bare "$" or "dollars", or a
 * value naming anything else, is no statement (a currency it names still blocks the fill: documentStatedCurrency). */
function valueCurrency(value: string): StatedCurrency | null {
  const v = value.trim().replace(/[.;,]+$/, "").trim();
  const one = (core: string) => new RegExp(String.raw`^${core}(?:\s*\(\s*${core}\s*\))?(?:\s+only)?(?:$|\s+[A-Z][A-Za-z]*(?:\s+[A-Za-z()]+){0,4}\s*:)`, "i");
  if (one(SGD_VALUE).test(v)) return "SGD";
  if (one(USD_VALUE).test(v)) return "USD";
  return null;
}

/** Words that make a currency field or sentence about one kind of amount, not the whole document's ("Premium Currency",
 * "Mode of Payment  Currency: SGD", "Rider Currency"). Such a statement never fills in; an unknown value in it still blocks. */
const QUALIFIED = /\b(?:premiums?|payments?|paying|rider|riders|cash|surrender|funds?|investment|units?|loan|bonus(?:es)?|dividends?|mode|billing|top-?ups?|withdrawals?|annuity|coupon|maturity)\b/i;
/** Lines about converting one currency into another, which state no currency of the document. */
const CONVERSION = /\b(?:convert(?:ed|s|ing)?|conversion|exchange|rate|equivalent)\b/i;
/** An exception to a statement, on its line or the next one: the statement does not hold for every amount. */
const EXCEPTION = /\b(?:except|exception|save\s+(?:for|as|that)|other\s+than|unless|excluding|exclud(?:e|es|ed)|apart\s+from|but\s+(?:not|for)|otherwise)\b/i;
/** Any currency field: "<qualifier> Currency (of the ...) <sep> <value>". `sep` is ":", "=", a dash, a tab or a cell gap;
 * a single space only when the value is one the list knows. */
const FIELD = /(?<![A-Za-z])currency(\s+of\s+[A-Za-z ]{1,30}?(?=\s*(?::|=|–|-\s|\t|\s{2,})))?(\s*(?::|=|–|-(?=\s)|\t|\s{2,})\s*|\s(?!of\b))([^\t|]*?)\s*(?=\t|\s{2,}|\||$)/gi;
/** A sentence about all of the document's amounts, opening its line, a sentence or a bracket. */
const SENTENCE = new RegExp(String.raw`(?:^|[.;:!?]\s+|[(\[]\s*)(?:all\s+)?(?:the\s+)?(?:monetary\s+)?(?:amounts?|figures|sums(?:\s+(?:insured|assured))?|benefits)`
  + String.raw`(?:\s+(?:shown|stated|listed|printed|payable|quoted))?`
  + String.raw`(?:\s+(?:in|on|under)\s+this\s+(?:schedule|document|policy|certificate|statement|page|table|summary))?`
  + String.raw`(?:\s+(?:are|is|will\s+be|shall\s+be))?(?:\s+(?:shown|stated|expressed|denominated|quoted|presented|given|payable))?`
  + String.raw`\s+in\s+([^.;)\]\n]{1,60}?)\s*(?=[.;)\]]|$)`, "gi");
const BARE = /^(?:\$|dollars?|the\s+dollar)$/i;

export type CurrencyStatements = { stated: StatedCurrency[]; block: boolean };
/** The currencies a document's text states for all its amounts, in the closed shapes above, and whether anything in it
 * blocks the fill: a currency field or statement whose value is outside the allow-list ("Policy Currency : USS",
 * "U.S.D.", "Dollar (US)"), or a statement with an exception on its line or the next. */
export function currencyStatements(text: string): CurrencyStatements {
  const out: StatedCurrency[] = [];
  let block = false;
  const lines = String(text ?? "").normalize("NFKC").split("\n");
  const next = (i: number) => lines.slice(i + 1).find((l) => l.trim()) ?? "";
  for (const [i, line] of lines.entries()) {
    const conversion = CONVERSION.test(line);
    const found: { code: StatedCurrency | null; qualified: boolean }[] = [];
    for (const m of line.matchAll(FIELD)) {
      const value = m[3].trim(), single = m[2] === " ";
      if (!value || BARE.test(value.replace(/[.;,]+$/, ""))) continue;
      const code = valueCurrency(value);
      if (single && !code) continue; // prose ("currency risk applies"), not a field
      const before = line.slice(Math.max(0, m.index - 40), m.index);
      found.push({ code, qualified: QUALIFIED.test(before) || QUALIFIED.test(m[1] ?? "") });
    }
    for (const m of line.matchAll(SENTENCE)) {
      const value = m[1].trim();
      if (BARE.test(value)) continue;
      found.push({ code: valueCurrency(value), qualified: false });
    }
    for (const f of found) {
      if (!f.code) { if (!conversion) block = true; continue; }
      if (f.qualified || conversion) continue;
      if (EXCEPTION.test(line) || EXCEPTION.test(next(i))) { block = true; continue; }
      out.push(f.code);
    }
  }
  return { stated: out, block };
}
/** The currencies a document's text states for all its amounts (currencyStatements). */
export const statedCurrencies = (text: string) => currencyStatements(text).stated;

/** Every currency the text names: codes for the dollars and the currencies the fact check knows, "?" for any other, "$"
 * for a bare dollar sign or word. A three-letter code counts on its own only for a currency the fact check knows (an
 * abbreviation such as "CAD" in a list of illnesses is not one); any other code counts only beside a figure. */
export function mentionedCurrencies(text: string): string[] {
  const t = String(text ?? "").normalize("NFKC"), out: string[] = [];
  for (const m of t.matchAll(/(?<![A-Za-z])([A-Za-z]{1,3})?\$/g)) {
    const p = (m[1] ?? "").toUpperCase();
    out.push(!p ? "$" : p === "S" || p === "SG" ? "SGD" : p === "US" ? "USD" : p === "HK" ? "HKD" : p === "A" || p === "AU" ? "AUD" : "?" + p);
  }
  for (const m of t.matchAll(/\p{Sc}/gu)) if (m[0] !== "$") out.push(m[0] === "€" ? "EUR" : m[0] === "£" ? "GBP" : m[0] === "₱" ? "PHP" : "?");
  for (const m of t.matchAll(/(?<![A-Z])(SGD|USD|HKD|AUD|MYR|EUR|GBP|PHP)(?![A-Za-z])/g)) out.push(m[1]);
  for (const m of t.matchAll(/(?<![A-Za-z])(?:NZD|CAD|CNY|RMB|JPY|IDR|THB|INR|KRW|TWD|CHF|VND|BND)(?=\s?\d)|(?<=\d\s?)(?:NZD|CAD|CNY|RMB|JPY|IDR|THB|INR|KRW|TWD|CHF|VND|BND)(?![A-Za-z])/g)) out.push("?" + m[0]);
  if (/(?<![A-Za-z])RM\s?\d/.test(t)) out.push("MYR");
  if (/\bsingapore\s+dollars?\b/i.test(t)) out.push("SGD");
  if (/\b(?:u\.?s\.?|united\s+states|american)\s+dollars?\b/i.test(t)) out.push("USD");
  if (/\bhong\s+kong\s+dollars?\b/i.test(t)) out.push("HKD");
  if (/\baustralian\s+dollars?\b/i.test(t)) out.push("AUD");
  if (/\bringgit\b/i.test(t)) out.push("MYR");
  if (/\beuros?\b/i.test(t)) out.push("EUR");
  if (/\bpounds?\s+sterling\b|\bsterling\b/i.test(t)) out.push("GBP");
  if (/\bpesos?\b/i.test(t)) out.push("PHP");
  for (const m of t.matchAll(/\b(new\s+zealand|canadian|brunei|taiwan|new\s+taiwan|fiji|jamaican|bahamian|barbados|belize|bermuda|cayman|guyana|liberian|namibian|solomon|surinamese|trinidad|eastern\s+caribbean)\s+dollars?\b/gi)) out.push("?" + m[1]);
  for (const w of ["yen", "yuan", "renminbi", "rupees?", "rupiah", "baht", "francs?", "dong", "kr(?:ona|one|oner)", "rand", "dirhams?", "riyals?"]) if (new RegExp(`\\b${w}\\b`, "i").test(t)) out.push("?" + w);
  if (/(?<![A-Za-z])dollars?\b/i.test(t)) out.push("$");
  return out;
}

/** The one dollar currency the document states for all its amounts, or null (see the module note). `pages` are this one
 * document's checked pages: a statement counts only there, and a page's image currency (lib/documents/image-currency)
 * counts as a currency the document names. `allPages`, when given, are every page of the document, checked or not: any
 * other currency or blocking statement on any of them gives none (it only blocks, never fills). */
export function documentStatedCurrency(pages: { text: string; imageCurrency?: string }[], allPages: { text: string }[] = pages): StatedCurrency | null {
  const text = pages.map((p) => p.text).join("\n"), everything = [...pages, ...allPages].map((p) => p.text).join("\n");
  const stated = new Set(currencyStatements(text).stated);
  if (stated.size !== 1 || currencyStatements(everything).block) return null;
  const code = [...stated][0];
  const named = new Set(mentionedCurrencies(everything).filter((c) => c !== "$"));
  for (const p of pages) if (p.imageCurrency) named.add(p.imageCurrency.toUpperCase());
  for (const c of named) if (c !== code) return null;
  return code;
}

/** A bare figure in an amount position: the whole of its cell, or the end of its line, with no unit or other word after it
 * in the same cell ("100,000.00 units", "10,000.00 km" are not amounts). */
export function figureStandsAlone(line: string, value: number): boolean {
  for (const m of String(line ?? "").matchAll(/(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})/g)) {
    if (Math.abs(Number(m[1].replace(/,/g, "")) - value) >= 0.005) continue;
    const before = line.slice(0, m.index), after = line.slice(m.index + m[1].length);
    // The figure opens its cell: after a tab, a cell gap, or a single space after a label's word or colon.
    if (!/(?:\t|\s{2,}|[A-Za-z):]\s)$/.test(before)) continue;
    if (!/^\s*(?:$|\t|\s{2,})/.test(after)) continue;
    return true;
  }
  return false;
}

/** Whether the line prints an explicit currency of its own (a bare "$" is none). */
export const lineNamesCurrency = (line: string) => mentionedCurrencies(line).some((c) => c !== "$");
