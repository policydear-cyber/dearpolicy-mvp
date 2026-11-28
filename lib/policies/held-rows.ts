/** Splits rows into those shown open and those held behind one control: every row is in exactly one list, in its own order,
 * so a row is never dropped or shown twice (TE #648). Pure, so a test can run it. */
export function splitHeld<T>(rows: T[], isHeld: (row: T) => boolean): { open: T[]; folded: T[] } {
  const open: T[] = [], folded: T[] = [];
  for (const row of rows) (isHeld(row) ? folded : open).push(row);
  return { open, folded };
}
