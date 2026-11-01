/**
 * A money figure as a policy prints it, in any of the ways markets group digits:
 * "1,500,000.00" (comma thousands), "5,00,000" (Indian lakh grouping), "1.500.000" or "2.500,50" (dot thousands with a
 * decimal comma), "10'000" (apostrophe thousands), "1500" or "12.5" (no grouping), before a multiplier "1.25 million".
 *
 * Reading "€50.000" as fifty or "Rp 1.500.000" as one and a half is a wrong amount, so every figure is read whole and
 * only in a grouping that has one meaning. A figure that could be read two ways ("12,50": twelve and a half, or a
 * misprinted 1,250?) or fits no grouping is null: no amount is better than a wrong one.
 */

/** Currencies with three decimal places: "BHD 1.500" is one and a half dinars, never fifteen hundred. */
const THREE_DECIMALS = /^(?:BHD|KWD|OMR|JOD|TND|LYD|IQD)$/;

const LAKH_CURRENCY = /^(?:INR|NPR|PKR|LKR|BDT)$/;
/** A rupee or taka marker in text: where figures are grouped in lakhs. */
export const LAKH_MARKER = /₹|৳|(?<![A-Za-z])(?:Rs\.?|INR|NPR|PKR|LKR|BDT|Tk\.?)\s?\d/u;
export function groupsInLakhs(text: string | null | undefined) { return LAKH_MARKER.test(text ?? ""); }

/** The digits of a printed figure with its separators, as a pattern to capture before reading it with printedNumber.
 * A separator counts only between digits, so the full stop ending a sentence ("up to €5,000.") is never taken. A space
 * before exactly three digits is captured too ("€10 000"), so the figure is never cut to its first group; it then reads
 * as no figure, since "S$500 365 days" prints the same way. */
export const PRINTED_FIGURE = String.raw`\d(?:\d|[,.'’](?=\d)|[ \u00a0\u202f](?=\d{3}(?!\d)))*`;
/** Put right after a captured PRINTED_FIGURE: the capture is the whole figure, never a shorter part of it. */
export const FIGURE_END = String.raw`(?![,.'’ \u00a0\u202f]?\d)`;
/** A word after a figure that multiplies it ("1.5 million", "S$2.250m", "₹2 crore", "Rp 1,5 juta"). */
const SCALE_WORDS = ["million", "mil", "mio", "mln", "mn", "m", "tsd", "billion", "bn", "mrd", "md", "mld", "miliar", "milyar", "k", "thousand", "lakhs?", "lacs?", "crores?", "juta",
  // In other languages ("€ 2.500 milioni", "R$ 1,5 milhões", "150 triệu ₫"), each read as no figure by scaleOf (TE #262 F2):
  // a reader that does not apply them still never takes the bare figure.
  "milione", "milioni", "miliardo", "miliardi", "milh(?:ão|ao|ões|oes)", "mill(?:ón|on|ones)", "milliard(?:s|e|en)?", "milliarden", "triệu", "trieu", "tỷ", "triliun"];
/** Each letter in both cases, so the pattern reads "M", "Mio." or "MILLION" with or without the i flag; a letter with an
 * accent ("ệ", "õ") too. */
const anyCase = (word: string) => word.replace(/[a-z\u00e0-\u00ff\u1ea0-\u1ef9]/g, (c) => c.toUpperCase() === c ? c : "[" + c + c.toUpperCase() + "]");
export const SCALE_WORD = "(?:" + SCALE_WORDS.map(anyCase).join("|") + ")";
/** NaN for a multiplier that reads two ways: the caller gives no figure. */
export function scaleOf(word: string | null | undefined): number {
  const w = (word ?? "").toLowerCase();
  if (!w) return 1;
  // "mil" is a thousand in Spanish and Portuguese ("€5 mil") and a million in Malaysia ("RM5 mil"): it reads two ways.
  if (w === "mil") return NaN;
  if (/^(?:million|mio|mln|mn|m|juta)$/.test(w)) return 1_000_000;
  if (/^(?:billion|bn|mrd|md|mld|miliar|milyar)$/.test(w)) return 1_000_000_000;
  if (/^(?:k|thousand|tsd)$/.test(w)) return 1_000;
  if (/^(?:lakhs?|lacs?)$/.test(w)) return 100_000;
  if (/^crores?$/.test(w)) return 10_000_000;
  return NaN;
}
/** A reader that does not apply a multiplier puts this right after the figure: "S$1.5 million" is never read as S$1.5. */
// Every character is in the basic plane, so it reads the same in a pattern with or without the u flag and after toLowerCase().
export const NO_SCALE_AFTER = String.raw`(?!\s*${SCALE_WORD}(?![A-Za-z0-9]))`;

export function printedNumber(raw: string | null | undefined, currency?: string | null, options: { scaled?: boolean; lakh?: boolean } = {}): number | null {
  if (!raw) return null;
  const s = raw.trim();
  let digits: string | null = null;
  // Before a multiplier ("1.25 million", "1,5 juta") one dot or comma with one or two digits after it is the decimal point.
  // Grouped figures and three digits after the dot or comma ("1,500 million", "1.500 Mio.") are no figure.
  if (options.scaled) {
    // A dot or comma before three digits reads two ways a thousand apart ("€1.500 Mio.", "HK$1.000 million"): no figure.
    if (/^\d+(?:\.\d{1,2})?$/.test(s) || /^0\.\d+$/.test(s)) digits = s;
    else if (/^\d+,\d{1,2}$/.test(s) || /^0,\d+$/.test(s)) digits = s.replace(",", ".");
  }
  else if (/^\d+(?:\.\d{1,2})?$/.test(s)) digits = s;
  // A first group of 0 is never a thousands group ("S$0.500", "0,250").
  else if (/^0[.,'’ \u00a0\u202f]/.test(s)) digits = null;
  // A single dot then three digits: thousands in a market that groups with dots ("€50.000"), but a decimal in a
  // three-decimal currency.
  else if (/^\d{1,3}\.\d{3}$/.test(s)) digits = currency && THREE_DECIMALS.test(currency.toUpperCase()) ? s : s.replace(".", "");
  else if (/^\d+\.\d{3}$/.test(s)) digits = currency && THREE_DECIMALS.test(currency.toUpperCase()) ? s : null;
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) digits = s.replace(/,/g, "");
  // Lakh grouping ("5,00,000") only where it is printed, next to a rupee or taka sign: "HK$1,50,000" is a misprint that
  // could be 150,000 or 1,500,000, so it is no figure.
  else if (/^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?$/.test(s)) digits = options.lakh || (currency && LAKH_CURRENCY.test(currency.toUpperCase())) ? s.replace(/,/g, "") : null;
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) digits = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:['’]\d{3})+(?:[.,]\d{1,2})?$/.test(s)) digits = s.replace(/['’]/g, "").replace(",", ".");
  // Space grouping ("€10 000") cannot be told from a figure followed by another ("S$500 365 days"), so it is no figure.
  if (digits === null) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
