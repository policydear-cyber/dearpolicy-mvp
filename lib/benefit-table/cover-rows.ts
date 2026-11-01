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
 * from it (a wrong amount is worse than none). No match: the card says which card of the same product lists them. */

type RowLike = { coverKey: string; product?: string | null; benefit: string; percent?: number | null; base?: number | null };
type CoverLike = { coverKey: string; product: string; cover: string; sumInsured: number | null };

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Words that never tell one benefit from another, in the languages policies are written in. A closed list. */
const FILLER = new Set([
  "benefit", "benefits", "rider", "riders", "cover", "coverage", "plan", "the", "of", "on", "for", "and", "a", "an", "to", "in", "upon", "with",
  "manfaat", "faedah", "perlindungan", "untuk", "dan", "atas", "bagi", "pelan",
  "prestation", "prestations", "garantie", "garanties", "de", "du", "des", "la", "le", "les", "en", "et", "au", "aux",
  "leistung", "leistungen", "der", "die", "das", "des", "für", "bei", "und", "von",
  "beneficio", "beneficios", "cobertura", "el", "los", "del", "por", "y",
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

/** A row's own name: the words before any ":" or opening bracket ("Death benefit: higher of 105% of ..."). */
export const rowHead = (benefit: string) => benefit.split(/[:：(（]|\s[-–—]\s/u)[0];

const sameWords = (a: Set<string>, b: Set<string>) => a.size > 0 && a.size === b.size && [...a].every((w) => b.has(w));

/** The rows a cover's card shows, and, when it shows none, the cover of the same product whose card lists them. */
export function rowsForCover<R extends RowLike, C extends CoverLike>(cover: C, covers: C[], rows: R[]): { rows: R[]; borrowed: boolean; listedWith: C | null } {
  const own = rows.filter((r) => r.coverKey === cover.coverKey);
  if (own.length) return { rows: own, borrowed: false, listedWith: null };
  const product = norm(cover.product);
  const others = rows.filter((r) => r.coverKey !== cover.coverKey && !!r.product && norm(r.product) === product);
  const words = benefitWords(cover.cover);
  const same = others.filter((r) => sameWords(words, benefitWords(rowHead(r.benefit))))
    // A figure worked out from another cover's sum insured is that cover's: kept only when this cover prints that sum.
    .filter((r) => r.percent == null || r.base == null || (cover.sumInsured != null && Number(cover.sumInsured) === Number(r.base)));
  if (same.length) return { rows: same, borrowed: true, listedWith: null };
  const withRows = new Set(others.map((r) => r.coverKey));
  const listedWith = covers.find((c) => c.coverKey !== cover.coverKey && withRows.has(c.coverKey)) ?? null;
  return { rows: [], borrowed: false, listedWith };
}
