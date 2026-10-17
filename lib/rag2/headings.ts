/**
 * Actual-library findings (16 Oct 2026): what a stored page's lines ARE -- a heading, or prose wrapped over several
 * lines. A booklet's paragraph "If an Insured Person sustains bodily injury as a result of an Accident, which" /
 * "independently of any other cause results in ..." is one sentence; its first line is not a heading, a benefit label
 * or a condition to quote. Shared by the benefit records (product sections), the composer (a figure's label) and the
 * conditions quoted from a passage.
 */
/** Actual-library findings (16 Oct): a heading line -- short, figure-free, not a sentence and not the start of a wrapped
 * sentence (a line ending in a connective or comma, or followed by a line continuing it in lower case, is prose). */
export function isHeadingLine(line: string, next?: string | null): boolean {
  const l = line.trim();
  if (!l || l.length > 90 || /[$€£¥]\s?\d|\b(?:SGD|USD|S\$)\s?\d|\d\s?%/.test(l) || /[.,;:]$/.test(l)) return false;
  // (lower case only: a prose line breaks mid-sentence after a connective; "PART A" is a heading)
  if (/\b(?:which|that|and|or|of|the|to|a|an|by|with|for|if|in|on|at|as|is|are|be|will|we|you|any|from|under|who|whose|when|where|than|not)$/.test(l)) return false;
  if (next != null && /^[a-z(]/.test(next.trim())) return false;
  return /[A-Za-z]{3}/.test(l);
}

/** The lines of a text joined into its sentences' paragraphs: a line that does not end a sentence and is followed by a
 * line continuing it (lower case, or a line of prose after an unfinished one) is joined with the next. Headings stay
 * lines of their own. Offsets are not kept: for reading and quoting only. */
export function paragraphs(text: string): string[] {
  const lines = text.split("\n");
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) { if (cur) out.push(cur); cur = ""; continue; }
    if (!cur) { cur = l; } else cur = `${cur} ${l}`;
    const next = (lines[i + 1] ?? "").trim();
    const unfinished = !/[.!?:;]["”’)]*$/.test(l) && !isHeadingLine(l, next || null);
    const continues = !!next && (/^[a-z(]/.test(next) || (unfinished && !isHeadingLine(next, lines[i + 2] ?? null) && !/\t|\s{3,}/.test(next)));
    if (!continues) { out.push(cur); cur = ""; }
  }
  if (cur) out.push(cur);
  return out;
}
/** The complete sentence of `text` that contains character offset `at` (wrapped lines joined). */
export function sentenceAround(text: string, at: number): string {
  const before = text.slice(0, at), after = text.slice(at);
  const startRel = Math.max(before.search(/[^.!?]*$/), 0);
  const endM = /[.!?](?=\s|$)/.exec(after);
  const raw = text.slice(startRel, at + (endM ? endM.index + 1 : after.length));
  return raw.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
}
/** The index of the last line of the sentence that starts on line `i` (a line left unfinished continues on the next
 * line when that line carries the sentence on -- lower case, or prose that is not a heading); at most four lines. */
export function sentenceEndLine(lines: string[], i: number): number {
  let j = i;
  while (j < lines.length - 1 && j - i < 4) {
    const cur = lines[j].trim(), next = lines[j + 1].trim();
    if (!next || /[.!?]["”’)]*$/.test(cur) || /\t|\s{3,}/.test(next)) break;
    if (!(/^[a-z(]/.test(next) || (/(?:,|\b[a-z]+)$/.test(cur) && !isHeadingLine(next, lines[j + 2] ?? null)))) break;
    j++;
  }
  return j;
}

const productWords = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["policy", "wording", "summary", "benefits", "schedule", "certificate", "document", "insurance", "group", "scheme"].includes(w)));
/** The product a schedule belongs to: of the person's certificate products, the one named by the nearest heading above
 * the table in its own document (pages in order) -- "PART B - GROUP PERSONAL ACCIDENT" above Section 4 - Other Fracture.
 * A heading naming another product nearer the table, or one naming two, decides nothing. Null when no heading names one. */
export function productSection(before: string, labels: string[]): { label: string; heading: string } | null {
  const lines = before.split("\n");
  const want = labels.map((label) => ({ label, w: [...productWords(label)] })).filter((x) => x.w.length);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isHeadingLine(lines[i], lines[i + 1] ?? null)) continue;
    const have = productWords(lines[i]);
    const named = want.filter((x) => x.w.every((w) => have.has(w)));
    if (named.length === 1) return { label: named[0].label, heading: lines[i].trim() };
    if (named.length > 1) return null;
  }
  return null;
}

