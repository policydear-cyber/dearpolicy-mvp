/** Splits rows into those shown open and those held behind one control: every row is in exactly one list, in its own order,
 * so a row is never dropped or shown twice (TE #648). Pure, so a test can run it. */
export function splitHeld<T>(rows: T[], isHeld: (row: T) => boolean): { open: T[]; folded: T[] } {
  const open: T[] = [], folded: T[] = [];
  for (const row of rows) (isHeld(row) ? folded : open).push(row);
  return { open, folded };
}

/** The first `n` rows stay open and the rest sit behind one control: an exact ordered split of the same list, so no row is
 * dropped or shown twice. `n` below 0 or not a whole number is treated as 0 (nothing open) / its floor. Pure. */
export function splitAfter<T>(rows: T[], n: number): { first: T[]; rest: T[] } {
  const k = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return { first: rows.slice(0, k), rest: rows.slice(k) };
}
