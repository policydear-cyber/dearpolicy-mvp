/** The same figure printed again: an illustration prints one running total on many pages and for many policy years
 * ("Total premiums paid to date" is the same sum on page 38, 42 and 45, and flat once premiums stop). Such a row is shown
 * once, at its first policy year or age, and the repeats are named in `repeatedAt`, never listed as more figures.
 * General: it looks only at a row's own words and numbers, never at an insurer or a document. A row that differs in any
 * word, amount, currency, rate or person is kept. Pure. */
type Rowish = {
  personId: string; coverKey: string; benefit: string; section?: string | null; column?: string | null; pays?: string | null;
  figure: { kind: string; amount?: number | null; currency?: string | null; asOf?: string | null };
  qualifier?: unknown; holding?: unknown; conditions?: unknown; fromDay?: unknown; maxDays?: unknown;
  valueAt?: { age?: number; policyYear?: number; rate?: number | string };
  source?: { documentId?: string; page?: number | null };
};

/** A running total: its own words say it adds up to a date, so it can only stay flat or grow with the years. */
const RUNNING = /\b(?:to[- ]date|cumulative|accumulated|running\s+total|premiums?\s+paid)\b/i;

export const isRunningTotal = (benefit: string, column?: string | null) => RUNNING.test(`${benefit} ${column ?? ""}`);

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const amountOf = (r: Rowish) => (r.figure.amount != null ? `${r.figure.kind}|${r.figure.amount}|${r.figure.currency ?? ""}` : null);
const yearOf = (r: Rowish) => r.valueAt?.policyYear ?? r.valueAt?.age ?? null;

/** Everything the household sees about a row except its year: two rows are the same figure only if all of it is equal. */
const shown = (r: Rowish) => JSON.stringify([{ ...r.figure, asOf: undefined, amount: undefined }, r.qualifier ?? null, r.holding ?? null, r.conditions ?? null, r.fromDay ?? null, r.maxDays ?? null]);

export function collapseRepeats<R extends Rowish>(rows: R[]): (R & { repeatedAt?: number[] })[] {
  const out: (R & { repeatedAt?: number[] })[] = [];
  const seen = new Map<string, number>();
  const last = new Map<string, number>();
  for (const r of rows) {
    const amt = amountOf(r);
    const yr = yearOf(r);
    // Only a figure dated by a year is judged: a row with no year or no amount is always kept.
    if (amt == null || yr == null) { out.push(r); continue; }
    const group = [r.personId, r.coverKey, r.source?.documentId ?? "", norm(r.benefit), norm(r.section), norm(r.column), r.pays ?? "", r.valueAt?.rate ?? "", shown(r)].join("|");
    const base = `${group}|${amt}`;
    const running = isRunningTotal(r.benefit, r.column);
    // The same figure for the same year (a table printed twice) is one row. A running total at a later year with the same
    // amount (flat after premiums stop) is one row too, but only while it is still the latest amount of its group: a
    // total that went up and came back is not a running total, so that row stays.
    const key = running ? base : `${base}|${yr}`;
    const at = seen.get(key);
    const latest = last.get(group);
    if (at != null && (!running || latest === at || yr === yearOf(out[at]!))) {
      const first = out[at]!;
      const list = first.repeatedAt ?? [];
      if (yr !== yearOf(first) && !list.includes(yr)) first.repeatedAt = [...list, yr].sort((x, y) => x - y);
      continue;
    }
    seen.set(key, out.length); last.set(group, out.length); out.push(r);
  }
  return out;
}
