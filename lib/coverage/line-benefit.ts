/** A confirmed schedule line's own benefit name, where intake kept one: lib/policies/linking.ts stores a line's notes as
 * "<product> · <benefit>" ("Singlife Comprehensive Critical Illness II · Death Benefit"). Only that exact shape is read: the
 * notes must open with the line's own product name, and what follows is the benefit. Anything else gives null, and the line
 * is then judged by its product name as before. Pure; used by app/api/dashboard/route.ts.
 *   Test: scripts/coverage/line-benefit-test.ts */
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function lineBenefit(notes: string | null | undefined, product: string | null | undefined): string | null {
  const n = clean(notes), p = clean(product);
  if (!n || !p) return null;
  const head = `${p} · `;
  if (n.length <= head.length || n.slice(0, head.length).toLowerCase() !== head.toLowerCase()) return null;
  return clean(n.slice(head.length)) || null;
}
