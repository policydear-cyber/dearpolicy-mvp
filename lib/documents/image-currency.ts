/** The currency a page prints only in its image (DC 11 Nov, option b): a schedule whose text layer gives every figure bare
 * ("Total Permanent Disability\t100,000.00") while the page itself prints its currency in a header or a drawn label, so no
 * figure on it could be confirmed as money. When the page has been read again from its image (layout-check
 * crossCheckPages) and the two readings agree on its figure lines, the image reading's currency is the page's, taken only
 * when all of these hold:
 * - the text layer prints no currency at all (a sign, a code, a currency word): otherwise the text decides;
 * - the image reading prints exactly one currency, from a closed list ("S$", "SGD", "Singapore Dollar" are one; "$" next
 *   to one dollar currency is that currency); any other currency sign or word, or two currencies, gives none.
 * Nothing here uses a model or reads a particular document: the image reading is the one the page check already made. */

/** Currencies the fact check can confirm a figure in, with the mark it reads (lib/documents/fact-check CURRENCY_MARK). */
export const IMAGE_CURRENCY_MARK: Record<string, string> = { SGD: "S$", USD: "US$", HKD: "HK$", AUD: "A$", MYR: "RM", EUR: "€", GBP: "£", PHP: "₱", $: "$" };
const DOLLARS = new Set(["SGD", "USD", "HKD", "AUD"]);

/** Every currency the text names, as codes from the closed list, or "?" for one outside it. */
function currenciesIn(text: string): string[] {
  const out: string[] = [];
  const t = String(text ?? "");
  for (const m of t.matchAll(/(?<![A-Za-z])(SG|S|US|HK|AU|A)?\$/g)) {
    const p = (m[1] ?? "").toUpperCase();
    out.push(p === "S" || p === "SG" ? "SGD" : p === "US" ? "USD" : p === "HK" ? "HKD" : p === "A" || p === "AU" ? "AUD" : "$");
  }
  // Any other sign ("€", "£", "₱" are on the list; "¥", "₹", "฿", "R$" with another prefix ... are not).
  for (const m of t.matchAll(/(?<![A-Za-z])([A-Za-z]{0,3})(\p{Sc})/gu)) {
    if (m[2] === "$") { if (m[1] && !/^(?:SG|S|US|HK|AU|A)$/i.test(m[1])) out.push("?"); continue; }
    out.push(m[2] === "€" ? "EUR" : m[2] === "£" ? "GBP" : m[2] === "₱" ? "PHP" : "?");
  }
  for (const m of t.matchAll(/(?<![A-Za-z])(SGD|USD|HKD|AUD|MYR|EUR|GBP|PHP|NZD|CAD|CNY|RMB|JPY|IDR|THB|INR|KRW|TWD|CHF|VND|BND)(?![A-Za-z])/g))
    out.push(["SGD", "USD", "HKD", "AUD", "MYR", "EUR", "GBP", "PHP"].includes(m[1]) ? m[1] : "?");
  if (/(?<![A-Za-z])RM\s?\d/.test(t)) out.push("MYR");
  if (/\bsingapore\s+dollars?\b/i.test(t)) out.push("SGD");
  if (/\b(?:u\.?s\.?|united\s+states|american)\s+dollars?\b/i.test(t)) out.push("USD");
  if (/\bhong\s+kong\s+dollars?\b/i.test(t)) out.push("HKD");
  if (/\baustralian\s+dollars?\b/i.test(t)) out.push("AUD");
  if (/\bringgit\b/i.test(t)) out.push("MYR");
  if (/\beuros?\b/i.test(t)) out.push("EUR");
  if (/\bpounds?\s+sterling\b/i.test(t)) out.push("GBP");
  if (/\bpesos?\b/i.test(t)) out.push("PHP");
  // A dollar word naming no listed country ("New Zealand dollars", "Canadian Dollar") is another currency; a bare
  // "dollars" is a dollar of some kind.
  for (const m of t.matchAll(/\b([A-Za-z.]+)\s+dollars?\b/gi)) {
    if (!/^(?:singapore|u\.?s\.?|states|american|kong|australian)$/i.test(m[1]) && /^(?:new|zealand|canadian|brunei|taiwan|fiji|jamaican|bahamian|barbados|belize|bermuda|cayman|guyana|liberian|namibian|solomon|surinamese|trinidad|tobago|zimbabwe|eastern|caribbean)$/i.test(m[1])) out.push("?");
  }
  if (/(?<![A-Za-z])dollars?\b/i.test(t) && !out.length) out.push("$");
  for (const w of ["yen", "yuan", "renminbi", "rupees?", "rupiah", "baht", "won", "francs?", "dong", "kr(?:ona|one|oner)"]) if (new RegExp(`\\b${w}\\b`, "i").test(t)) out.push("?");
  return out;
}

/** Whether the page's own text names any currency (a sign, a code or a currency word). */
export const textPrintsCurrency = (text: string) => currenciesIn(text).length > 0;

/** The one currency the page image prints, when the text layer prints none; else null (see the module note). */
export function singleImageCurrency(textReading: string, imageReading: string): string | null {
  if (textPrintsCurrency(textReading)) return null;
  const found = new Set(currenciesIn(imageReading));
  if (!found.size || found.has("?")) return null;
  const named = [...found].filter((c) => c !== "$");
  if (named.length > 1) return null;
  if (!named.length) return "$";
  // "$" beside one named currency is that currency only when it is a dollar ("S$" header, "$" figures); beside a ringgit,
  // euro or pound it is another currency.
  if (found.has("$") && !DOLLARS.has(named[0])) return null;
  return named[0];
}
