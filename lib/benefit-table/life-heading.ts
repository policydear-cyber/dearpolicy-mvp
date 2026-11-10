/** Whether a block or column heading is a person's life (joint schedules, 10 Nov; Critic #406 J1). Shared by the benefit
 * table (assemble.ts) and the Benefits page; no database code, so either may import it. */
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A full name: two or more words. A given name alone ("Jane") never tells two people apart. */
const wholeName = (name: string) => { const n = norm(name); return n.includes(" ") ? n : null; };
/** Labels that say the name after them is the life covered. Any other words around a name (a payee, an owner, a
 * beneficiary) do not make the heading that person's (Critic #406 J1). */
const LIFE_LABEL = /^(?:(?:benefits?|cover|coverage|schedule)\s+(?:for|of)\s+)?(?:the\s+)?(?:life\s+assured|life\s+insured|insured(?:\s+person)?|name\s+of\s+(?:the\s+)?insured|name\s+of\s+(?:the\s+)?life\s+assured)\s*(?:\d+\s*)?$/;
/** Whether a heading is a person's life: the heading is their full name, or a life label followed by it ("Life Assured:
 * Jane Doe"), or their name in the possessive at its start ("Jane Doe's benefits"). A given name alone is never enough. */
export function headingIsLife(heading: string | null, names: string[]): boolean {
  const h = norm(heading);
  if (!h) return false;
  return names.some((n) => {
    const w = wholeName(n);
    if (!w) return false;
    if (h === w || h.startsWith(`${w} s `) || h === `${w} s`) return true;
    if (!h.endsWith(` ${w}`)) return false;
    return LIFE_LABEL.test(h.slice(0, h.length - w.length).trim());
  });
}
