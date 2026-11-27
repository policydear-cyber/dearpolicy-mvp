/** How the Documents page checks on a document being read: fast for the first minute, then relaxed, then slow, and for
 * good only up to an hour (a long document can take half an hour or more). A failed check slows the next one down
 * (doubling, at most 8 times) and the first good check puts it back. */
export const POLL_LIMIT_MS = 60 * 60_000;
export function pollDelay(elapsedMs: number, misses: number): number {
  const base = elapsedMs > 10 * 60_000 ? 15_000 : elapsedMs > 60_000 ? 5000 : 1400;
  return base * (misses > 0 ? Math.min(2 ** misses, 8) : 1);
}
