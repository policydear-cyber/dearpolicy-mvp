const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A date a document's details print, as the rest of the site writes it: "19 October 2026", never "2026-10-19". The day
 * is read from the text, never through a Date, so it is the document's own day in every time zone. A value that is not an
 * ISO date (with or without a time part) is returned as written, and empty is the caller's to word. */
export function isoDateWords(value: unknown): string | null {
  const m = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/) : null;
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}
