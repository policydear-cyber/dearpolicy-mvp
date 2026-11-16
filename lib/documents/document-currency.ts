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
 * - the evidence line itself prints no explicit currency (a line's own currency always decides).
 * Only within one document: the pages passed are that document's own, never another document of the household.
 * Pure: no model, no I/O, nothing about a particular insurer or document. */

export type StatedCurrency = "SGD" | "USD";

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

/** A field naming the document's currency: the label opens its line (or a cell), the value follows. */
const FIELD = /(?:^|\t|\s{2,}|\|\s*)(?:(?:policy|contract|plan|benefit|schedule|base|basic)\s+)?currency(?:\s+of\s+(?:the\s+)?(?:policy|plan|contract|benefits?|schedule|this\s+(?:policy|plan|schedule|document)))?\s*(?::|-|–|=|\t|\s{2,}|\s(?=\S))\s*([^\t|]+?)(?=\t|\s{2,}|\s*\||$)/gim;
/** A sentence about all of the document's amounts. */
const SENTENCE = new RegExp(String.raw`(?:^|[\s(\[])(?:all\s+)?(?:the\s+)?(?:monetary\s+)?(?:amounts?|figures|sums(?:\s+(?:insured|assured))?|values|benefits)`
  + String.raw`(?:\s+(?:shown|stated|stated|listed|printed|payable|quoted))?`
  + String.raw`(?:\s+(?:in|on|under)\s+this\s+(?:schedule|document|policy|certificate|statement|page|table|summary))?`
  + String.raw`(?:\s+(?:are|is|will\s+be|shall\s+be))?(?:\s+(?:shown|stated|expressed|denominated|quoted|presented|given|payable))?`
  + String.raw`\s+in\s+(${SGD_VALUE}|${USD_VALUE})(?:\s*\(\s*(?:${SGD_VALUE}|${USD_VALUE})\s*\))?(?:\s+only)?\s*(?:[.)\]]|$)`, "gim");
/** A sentence that converts, exchanges or makes an exception is never the document's own currency. */
const NOT_A_STATEMENT = /\b(?:convert(?:ed|s|ing)?|conversion|exchange|rate|equivalent|unless|except|otherwise|foreign)\b/i;

/** The currencies a document's text states for its amounts, in the closed shapes above. */
export function statedCurrencies(text: string): StatedCurrency[] {
  const out: StatedCurrency[] = [];
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.normalize("NFKC");
    if (NOT_A_STATEMENT.test(line)) continue;
    for (const m of line.matchAll(FIELD)) {
      const c = valueCurrency(m[1]);
      if (c) out.push(c);
    }
    for (const m of line.matchAll(SENTENCE)) {
      const c = valueCurrency(m[1]);
      if (c) out.push(c);
    }
  }
  return out;
}

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
 * document's pages; a page's image currency (lib/documents/image-currency) counts as a currency the document names. */
export function documentStatedCurrency(pages: { text: string; imageCurrency?: string }[]): StatedCurrency | null {
  const text = pages.map((p) => p.text).join("\n");
  const stated = new Set(statedCurrencies(text));
  if (stated.size !== 1) return null;
  const code = [...stated][0];
  const named = new Set(mentionedCurrencies(text).filter((c) => c !== "$"));
  for (const p of pages) if (p.imageCurrency) named.add(p.imageCurrency.toUpperCase());
  for (const c of named) if (c !== code) return null;
  return code;
}

/** Whether the line prints an explicit currency of its own (a bare "$" is none). */
export const lineNamesCurrency = (line: string) => mentionedCurrencies(line).some((c) => c !== "$");
