/** The same figure printed again: an illustration prints one running total on many pages and for many policy years
 * ("Total premiums paid to date" is the same sum on page 38, 42 and 45, and flat once premiums stop). Such a row is shown
 * once, at its first policy year or age, and the repeats are named in `repeatedAt`, never listed as more figures.
 * General: it looks only at a row's own words and numbers, never at an insurer or a document. A row that differs in any
 * word, amount, currency, rate or person is kept. Pure. */
type Rowish = {
  personId: string; coverKey: string; benefit: string; section?: string | null; column?: string | null; pays?: string | null;
  figure: { kind: string; amount?: number | null; currency?: string | null };
  valueAt?: { age?: number; policyYear?: number; rate?: number | string };
  source?: { documentId?: string; page?: number | null };
};

/** A running total: its own words say it adds up to a date, so it can only stay flat or grow with the years. */
const RUNNING = /\b(?:to[- ]date|cumulative|accumulated|running\s+total|total\s+(?:\w+\s+){0,4}(?:paid|cost|charges?|premiums?))\b/i;

export const isRunningTotal = (benefit: string, column?: string | null) => RUNNING.test(`${benefit} ${column ?? ""}`);

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const amountOf = (r: Rowish) => (r.figure.amount != null ? `${r.figure.kind}|${r.figure.amount}|${r.figure.currency ?? ""}` : null);
const yearOf = (r: Rowish) => r.valueAt?.policyYear ?? r.valueAt?.age ?? null;

export function collapseRepeats<R extends Rowish>(rows: R[]): (R & { repeatedAt?: number[] })[] {
  const out: (R & { repeatedAt?: number[] })[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const amt = amountOf(r);
    const yr = yearOf(r);
    // Only a figure dated by a year is judged: a row with no year or no amount is always kept.
    if (amt == null || yr == null) { out.push(r); continue; }
    const base = [r.personId, r.coverKey, r.source?.documentId ?? "", norm(r.benefit), norm(r.section), norm(r.column), r.pays ?? "", amt, r.valueAt?.rate ?? ""].join("|");
    // The same figure for the same year (a table printed twice) is one row. A running total at a later year with the same
    // amount (flat after premiums stop) is one row too; any other row for another year is a different figure.
    const key = isRunningTotal(r.benefit, r.column) ? base : `${base}|${yr}`;
    const at = seen.get(key);
    if (at == null) { seen.set(key, out.length); out.push(r); continue; }
    const first = out[at]!;
    const list = first.repeatedAt ?? [];
    if (yr !== yearOf(first) && !list.includes(yr)) first.repeatedAt = [...list, yr].sort((a, b) => a - b);
  }
  return out;
}
