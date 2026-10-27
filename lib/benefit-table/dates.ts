/** Printed dates as day counts, shared by the table (assemble.ts: a cover whose term has ended) and the chat (chat.ts:
 * waiting periods and cover periods). Pure, no database code. */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A printed date as a day count (UTC midnight): "20/10/2026" (day first, as Singapore prints it), "2026-10-20",
 * "20 October 2026". Null for anything else. */
export function printedDay(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const at = (y: number, mo: number, d: number) => {
    const ms = Date.UTC(y, mo - 1, d), x = new Date(ms);
    return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? ms / 86_400_000 : null;
  };
  if (m) return at(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return at(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[2].toLowerCase())) return at(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
  return null;
}
/** Today in Singapore (UTC+8), as a day count. */
export const singaporeDay = (now: Date) => Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000);
