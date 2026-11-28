/** Splits rows into those shown open and those held behind one control: every row is in exactly one list, in its own order,
 * so a row is never dropped or shown twice (TE #648). Pure, so a test can run it. */
export function splitHeld<T>(rows: T[], isHeld: (row: T) => boolean): { open: T[]; folded: T[] } {
  const open: T[] = [], folded: T[] = [];
  for (const row of rows) (isHeld(row) ? folded : open).push(row);
  return { open, folded };
}

/** The first `n` rows stay open, and so does any row `keep` names (a question waiting for the household's answer is never
 * hidden); the rest sit behind one control. An exact ordered split of the same list: no row is dropped or shown twice, and
 * each list keeps the rows' own order. `n` that is not a finite number is treated as 0; a fraction is floored. Pure. */
export function splitAfter<T>(rows: T[], n: number, keep: (row: T) => boolean = () => false): { first: T[]; rest: T[] } {
  const k = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const first: T[] = [], rest: T[] = [];
  rows.forEach((row, i) => (i < k || keep(row) ? first : rest).push(row));
  return { first, rest };
}
