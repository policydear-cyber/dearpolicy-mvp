/** V1.5: the saved next steps in their saved order, each shown once (the same step saved twice, ignoring spacing and
 * case, is one step). Nothing else is dropped: every distinct saved step is shown. */
export function uniqueSteps(steps: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of steps ?? []) {
    const k = String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(String(s));
  }
  return out;
}
