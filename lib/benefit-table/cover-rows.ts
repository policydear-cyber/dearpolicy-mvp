/** The benefit rows a Coverage card shows for one cover (components/benefit-table-coverage.tsx).
 *
 * A schedule often prints, as lines of their own, benefits that are part of the main plan ("TERMINAL ILLNESS", "WAIVER OF
 * PREMIUM ON TPD BENEFIT" under a life plan). Their wording is the main plan's, so every row read from it is linked to the
 * main plan and the line itself gets none. Without this its card said "No benefits are listed ... upload its policy
 * wording" while the very benefit was listed a card above, and on Benefits (live check, 1 Nov).
 *
 * So a cover with no rows of its own shows the rows of the same person's same product that are this very benefit: the
 * row's own name (before any ":" or bracket) has exactly the cover's words, ignoring filler words ("benefit", "rider",
 * "of", "on", in several languages) and reading common short forms (TPD, TI, CI) in full. Exactly, never "contains": an
 * "Accidental death benefit" row is never shown for a "Death" line. A row whose figure was worked out from another
 * cover's sum insured is shown only when this cover prints that same sum: a different sum, or none, shows no figure
 * from it (a wrong amount is worse than none). No match: the card says which card of the same product lists them.
 *
 * Only rows read from the very document this line is printed in are borrowed: two policies of one product (two
 * "Takaful Hayat" plans of different sums) share a cover key, so a row of the other policy never lends its figure (TE F2
 * on #282). And a line that prints its own sum shows a borrowed row's figure only when it is that same sum in the same
 * currency; any other figure is left out and the row says to see the page (TE F1 on #282). */

type Doc = { documentId?: string | null } | null | undefined;
type Fig = { kind: string; amount?: number; currency?: string | null };
type RowLike = { coverKey: string; product?: string | null; benefit: string; percent?: number | null; base?: number | null; figure?: Fig; source?: Doc };
type CoverLike = { coverKey: string; product: string; cover: string; sumInsured: number | null; currency?: string | null; source?: Doc };
const sameDocument = (a: Doc, b: Doc) => !!a?.documentId && a.documentId === b?.documentId;
/** The figure says to see the page instead: a borrowed amount this line does not itself print. */
const withoutFigure = <R extends RowLike>(r: R): R => ({ ...r, percent: null, base: null,
  figure: { kind: "none", why: "the amount printed for it elsewhere in the document is not this line's sum: see the page" } });

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Words that never tell one benefit from another, in English. A closed list. */
const FILLER = new Set([
  "benefit", "benefits", "rider", "riders", "cover", "coverage", "plan", "the", "of", "on", "for", "and", "a", "an", "to", "in", "upon", "with",
]);
/** Short forms read in full, so "TPD" and "total and permanent disability" are the same words. A closed list. */
const SHORT: Record<string, string[]> = {
  tpd: ["total", "permanent", "disability"],
  ti: ["terminal", "illness"],
  ci: ["critical", "illness"],
  eci: ["early", "critical", "illness"],
  wop: ["waiver", "premium"],
};
/** A plural or verb form of a word, for comparing: "premiums" and "premium", "disabilities" and "disability". */
const stem = (w: string) => w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/** A benefit name's own words, as a set. Script with no spaces (Chinese, Japanese) keeps each run whole. */
export function benefitWords(name: string): Set<string> {
  const out = new Set<string>();
  for (const w of norm(name).match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (FILLER.has(w)) continue;
    for (const x of SHORT[w] ?? [w]) out.add(stem(x));
  }
  return out;
}

/** A row's own name: the words before any ":" ("Death benefit: higher of 105% of ..."). Words in brackets or after a dash
 * stay part of the name, because they narrow the benefit ("Death benefit (accidental only)", "Critical illness (second and
 * subsequent claims)"): such a row matches only a line that has those words too. A bracket that only repeats the name
 * ("Total and permanent disability (TPD)") still matches, as its words are the same (Critic M1 on #282). */
export const rowHead = (benefit: string) => benefit.split(/[:：]/u)[0];

const sameWords = (a: Set<string>, b: Set<string>) => a.size > 0 && a.size === b.size && [...a].every((w) => b.has(w));

/** The rows a cover's card shows, and, when it shows none, the cover of the same product whose card lists them. */
export function rowsForCover<R extends RowLike, C extends CoverLike>(cover: C, covers: C[], rows: R[]): { rows: R[]; borrowed: boolean; listedWith: C | null } {
  const own = rows.filter((r) => r.coverKey === cover.coverKey);
  if (own.length) return { rows: own, borrowed: false, listedWith: null };
  const product = norm(cover.product);
  const sameProduct = rows.filter((r) => r.coverKey !== cover.coverKey && !!r.product && norm(r.product) === product);
  const others = sameProduct.filter((r) => sameDocument(r.source, cover.source));
  const words = benefitWords(cover.cover);
  const matching = others.filter((r) => sameWords(words, benefitWords(rowHead(r.benefit))));
  // Rows of two or more covers of the product ("Room and board" under Plan A and under Plan B) are not one benefit this
  // line can be said to pay: none is borrowed (Critic M2 on #282).
  const same = new Set(matching.map((r) => r.coverKey)).size === 1 ? matching.map((r) => {
    // A share ("50% advance of the death benefit") is this line's only when it is worked out from this line's own printed
    // sum; otherwise its figure is left out, never read against the sum this card prints (Critic L1 on #282).
    // A row with a share figure whose percent was not kept counts as a share too (Critic M3 on #282).
    const f = r.figure;
    if (r.percent != null || (f as { share?: unknown } | undefined)?.share) {
      const sameCurrency = typeof f?.amount !== "number" || (f.currency ?? null) === (cover.currency ?? null);
      return r.base != null && cover.sumInsured != null && Number(r.base) === Number(cover.sumInsured) && sameCurrency ? r : withoutFigure(r);
    }
    if (!f || f.kind === "none" || typeof f.amount !== "number") return r;
    // This line prints its own sum: only that very sum, in its currency, is shown.
    if (cover.sumInsured != null) return Number(f.amount) === Number(cover.sumInsured) && (f.currency ?? null) === (cover.currency ?? null) ? r : withoutFigure(r);
    return r;
  }) : [];
  if (same.length) return { rows: same, borrowed: true, listedWith: null };
  // Naming the card that sets them out says no amount, so any card of the same product may be named; one printed in the
  // same document first.
  const withRows = new Set(sameProduct.map((r) => r.coverKey));
  const listed = covers.filter((c) => c.coverKey !== cover.coverKey && withRows.has(c.coverKey));
  const listedWith = listed.find((c) => sameDocument(c.source, cover.source)) ?? listed[0] ?? null;
  return { rows: [], borrowed: false, listedWith };
}
