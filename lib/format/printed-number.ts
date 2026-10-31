/**
 * A money figure as a policy prints it, in any of the ways markets group digits:
 * "1,500,000.00" (comma thousands), "5,00,000" (Indian lakh grouping), "1.500.000" or "2.500,50" (dot thousands with a
 * decimal comma), "10'000" or "10 000" (apostrophe or space thousands), "1500" or "12.5" (no grouping).
 *
 * Reading "€50.000" as fifty or "Rp 1.500.000" as one and a half is a wrong amount, so every figure is read whole and
 * only in a grouping that has one meaning. A figure that could be read two ways ("12,50": twelve and a half, or a
 * misprinted 1,250?) or fits no grouping is null: no amount is better than a wrong one.
 */

/** Currencies with three decimal places: "BHD 1.500" is one and a half dinars, never fifteen hundred. */
const THREE_DECIMALS = /^(?:BHD|KWD|OMR|JOD|TND|LYD|IQD)$/;

/** The digits of a printed figure with its separators, as a pattern to capture before reading it with printedNumber.
 * A separator counts only between digits, so the full stop ending a sentence ("up to €5,000.") is never taken. */
export const PRINTED_FIGURE = String.raw`\d(?:\d|[,.'’](?=\d))*`;

export function printedNumber(raw: string | null | undefined, currency?: string | null): number | null {
  if (!raw) return null;
  const s = raw.trim();
  let digits: string | null = null;
  if (/^\d+(?:\.\d{1,2})?$/.test(s)) digits = s;
  // A single dot then three digits: thousands in a market that groups with dots ("€50.000"), but a decimal in a
  // three-decimal currency.
  else if (/^\d{1,3}\.\d{3}$/.test(s)) digits = currency && THREE_DECIMALS.test(currency.toUpperCase()) ? s : s.replace(".", "");
  else if (/^\d+\.\d{3}$/.test(s)) digits = currency && THREE_DECIMALS.test(currency.toUpperCase()) ? s : null;
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) digits = s.replace(/,/g, "");
  else if (/^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?$/.test(s)) digits = s.replace(/,/g, "");
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) digits = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:['’ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?$/.test(s)) digits = s.replace(/['’ \u00a0\u202f]/g, "").replace(",", ".");
  if (digits === null) return null;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
