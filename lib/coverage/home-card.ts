/** Home's protection cards (DC 16-17 Nov): each card says Covered, with its amount only when the cover rests on ONE
 * confirmed figure. Where the dashboard adds several lines or policies into a total (app/api/dashboard/route.ts), Home
 * shows no total: different schedules are not added together without explicit support (project rule, 17 Nov); the card
 * names the covers instead and its Coverage page shows each amount. Every card names what pays (the policy, or how many),
 * so a card with no amount never reads as an empty box. This file never builds or shows a figure. The grid picks its column count so the last row is never one card alone
 * when another count avoids it. Pure; used by app/page.tsx. Works for any household and any insurer.
 *   Test: scripts/coverage/home-card-test.ts */

export type HomeCardInput = { policyNames?: string[] | null; parts?: { name?: string | null }[] | null; count?: number | null };

/** Whether Home may show the card's amount: only when the cover rests on one line, so the figure is never a sum of
 * several schedules, policies or benefits. */
export const homeCardShowsAmount = (c: { count?: number | null; parts?: unknown[] | null }) => Math.max(c.count ?? 0, c.parts?.length ?? 0) <= 1;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** What pays for this cover, in a few words: one policy's name, two names joined, or "N policies"; one policy with several
 * benefits for this cover says how many ("Group Term Life · 2 benefits"). Null when nothing is named and there is one line. */
export function homeCardSource(c: HomeCardInput): string | null {
  const seen = new Map<string, string>();
  for (const n of [...(c.policyNames ?? []), ...(c.parts ?? []).map((p) => p?.name ?? "")]) {
    const name = clean(n);
    // "Policy" and "Owned policy" are the dashboard's stand-ins for a cover with no product name: they name nothing.
    if (!name || /^(?:owned\s+)?policy$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  const names = [...seen.values()];
  const lines = Math.max(c.count ?? 0, c.parts?.length ?? 0);
  if (names.length <= 1 && lines > 1) return names.length ? `${names[0]} \u00b7 ${lines} benefits` : `${lines} benefits`;
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} + ${names[1]}`;
  return `${names.length} policies`;
}

/** Columns for a wide Home grid of n cards: 3 or 4, whichever fills the last row best, 3 on a tie. 7 cards: 4 + 3, not
 * 3 + 3 + 1. Up to 3 cards keep 3 columns, so one card stays card-sized. A narrow screen uses 2 columns, where an odd
 * last card spans the row (app/globals.css). */
export function homeGridColumns(n: number): number {
  if (n <= 3) return 3;
  let best = 3, bestFill = -1;
  for (const cols of [3, 4]) {
    const last = n % cols || cols;
    const fill = last / cols;
    if (fill > bestFill + 1e-9) { best = cols; bestFill = fill; }
  }
  return best;
}
