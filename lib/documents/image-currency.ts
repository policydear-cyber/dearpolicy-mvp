/** The currency a page prints only in its image (DC 11 Nov, option b): a schedule whose text layer gives every figure bare
 * ("Total Permanent Disability\t100,000.00") while the page itself prints its currency in a header or a drawn label, so no
 * figure on it could be confirmed as money. When the page has been read again from its image (layout-check
 * crossCheckPages) and the two readings agree on its figure lines, the image reading's currency is the page's, taken only
 * when all of these hold:
 * - the text layer prints no currency at all (a sign, a code, a currency word): otherwise the text decides;
 * - the image reading prints exactly one currency, from a closed list ("S$", "SGD", "Singapore Dollar" are one; "$" next
 *   to one dollar currency is that currency); any other currency sign or word, two currencies, or only a bare "$", gives none.
 * The fact check then confirms a figure in it only when the reading's currency is that same currency, and only a
 * money-shaped figure (thousands separators or two decimals) on the cover's own evidence line (moneyShapedFigure).
 * Nothing here uses a model or reads a particular document: the image reading is the one the page check already made. */

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
  // A bare "$" or "dollars" names no currency (S$, US$, A$ ...): none (Critic #417 C3).
  if (!named.length) return null;
  // "$" beside one named currency is that currency only when it is a dollar ("S$" header, "$" figures); beside a ringgit,
  // euro or pound it is another currency.
  if (found.has("$") && !DOLLARS.has(named[0])) return null;
  return named[0];
}

/** A money-shaped figure on the line equal to the value: with thousands separators or two decimals ("250,000",
 * "250,000.00", "80.50"), never a plain number (an age, a term, a policy or plan number, a year, a phone number), a
 * percentage, a count of days or years, or a figure after a number, code, age, term, period or date label (Critic #417 C1). */
export function moneyShapedFigure(line: string, value: number): boolean {
  if (!Number.isFinite(value) || value <= 0) return false;
  const re = /(?<![\w.,/:-])(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})(?![\w.,/%-]|\s*(?:%|per\s*cent|days?|nights?|years?|months?|weeks?|hours?|times|x\b))/gi;
  for (const m of String(line ?? "").matchAll(re)) {
    if (Math.abs(Number(m[1].replace(/,/g, "")) - value) >= 0.005) continue;
    const before = line.slice(0, m.index);
    // A field whose label names it as a number, code, date or contact is never money, wherever the word stands.
    if (/\b(?:number|code|ref(?:erence)?|date|tel|phone|fax|hotline|nric|id)\b[^\d\n]*$/i.test(before)) continue;
    // "No.", "Age", "Period" and "Year" mark a non-money field only as the label's last word ("Policy No.", "Entry age",
    // "Waiting period", "Policy year:"). Inside a label they name a cover: "No Claim Bonus", "Old Age Benefit", "Benefit
    // Period Limit"; and "per policy year" is a limit's unit ("Overall limit per policy year").
    if (/\b(?:no\.?|nos?\.|age|period|years?)\s*(?:\([^)\n]*\))?\s*[:#\-]?\s*$/i.test(before) && !/\bper\s+(?:[a-z]+\s+)?years?\s*[:\-]?\s*$/i.test(before)) continue;
    // ... and as the word that opens a field phrase anywhere in the label: "No. of units", "Age next birthday", "Age at
    // entry", "Age limit", "Period of cover", "Years in force", "Year of entry" (Critic #423). "per period of insurance"
    // stays a limit's unit ("Annual limit per period of insurance").
    if (/(?<!\bper\s(?:[a-z]+\s)?)\b(?:nos?\.|no\.|age|period|years?)\s+(?:of|at|next|last|on|in|to|attained)\b|\bage\s+limit\b/i.test(before)) continue;
    // "Term" is a label only as the label's last word ("Policy Term", "Term (years):"); "Term Life", "Long Term Care" and
    // "Short-term disability" are covers (Critic #417).
    if (/\bterm\s*(?:\([^)\n]*\))?\s*[:\-]?\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}
