/**
 * Dates as Singapore households write them: "29 Sep 2026" (never the US
 * "9/29/2026"). Built by hand rather than with Intl, whose en-SG month
 * abbreviations vary between runtimes ("Sep" / "Sept") and would differ
 * between the server render and the browser. A bare calendar date
 * ("2026-09-29") is shown as that date, never shifted by a time zone.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function sgDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    if (m < 1 || m > 12) return value;
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A value that may be a calendar date: formatted if it is one, unchanged otherwise. */
export function maybeSgDate(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return sgDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return sgDate(new Date(value));
  return value == null ? "" : String(value);
}

/** Answer text with every calendar date written the way the rest of the
 * page writes it: "Death Date: 2026-09-28" becomes "Death Date: 28 Sep
 * 2026". Only exact YYYY-MM-DD dates change; amounts, policy numbers and
 * everything else stay as written. */
export function readableDates(text: string): string {
  return text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (match) => sgDate(match) || match);
}
