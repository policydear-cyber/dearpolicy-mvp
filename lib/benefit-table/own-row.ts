/** A benefit row's own line(s) inside its quote, and counts that are never money.
 *
 * A quote the model copies in page order may run over two rows ("Hospital cash\tS$100 per day\nSurgical fees\tS$5,000",
 * "(a) loss of one limb\n(b) loss of sight of one eye\tS$100,000"). The figure is printed in the quote, but on the other
 * row's line: shown for this row it is a wrong amount (wrapped-quote gate, P1). A row's figure counts only when it is
 * printed on the row's own lines: the line whose label is the row's label, and the lines that carry that same row on
 * (no item marker, no bullet, no new label of a row of its own).
 *
 * A number followed by a count noun ("up to a maximum of 2 procedures", "10 sessions a year") is a count, never money
 * (wrapped-quote gate, P2: "up to S$2"). Both are allow-lists. No model, database or network. */
import { anyMoneyFigures } from "@/lib/format/currency";

/** A list item's own marker: "(a)", "b)", "ii.", "3)", "(iv)", or a bullet. A line that starts with one is its own item. */
const ITEM_START = /^[ \t]*(?:\(?(?:[a-z]|[ivx]{1,5}|\d{1,3})[.)](?=\s|$)|\((?:[a-z]|[ivx]{1,5}|\d{1,3})\)|[•●○◦▪▫■□‣⁃∙·*–—-](?=\s))/i;
/** A line or cell that carries on the row's limit or wording rather than naming a row: a connective or a cap word. */
const CARRIES_ON = /^[ \t,;:(]*(?:or|and|up\s+to|subject|whichever|max(?:imum)?|min(?:imum)?|limit(?:ed|s)?|not\s+(?:to\s+)?exceed(?:ing)?|capped|per|each|every|payable|paid|plus|less|after|before|from|within|for|in|on|of|if|with|including|excluding|except|unless|provided)\b/i;
/** Cell words that are a figure's own words, never a row's label ("Covered", "Not covered", "As charged", "Per Disability"). */
const VALUE_WORDS = /^(?:not\s+)?(?:covered|included|applicable|available)$|^(?:nil|n\/?a|none|yes|no|as\s+charged|full|reimbursement|overall|in\s+total|total)$|^(?:per|each|every|for\s+each|for\s+every)\b|\b(?:limit|maximum|max|cap)\b/i;
/** Words that say nothing about which row it is. */
const FILLER = new Set(("a an the and or of to in on at by for from with per due & benefit benefits cover covers covered coverage " +
  "expense expenses fee fees charge charges cost costs amount amounts payable paid limit limits sum insured assured plan rider").split(" "));
/** A line above that runs on into the next: it does not end a sentence and stops on a joining word, a comma, "&", "/" or a
 * hyphen; or the line below starts in lower case (as check.ts CONTINUES, CELL_CONTINUES on the wrapped-quote branch). */
const RUNS_ON = (above: string, line: string) => !/[.!?:]\s*$/.test(above)
  && (/^\s*[a-z(]/.test(line) || /(?:\b(?:by|for|of|on|in|to|with|under|from|at|and|or|the|a|an|any|all|other|our|your|its|their|which|that|than|is|are|be)|[,&/–-])\s*$/.test(above));

const stem = (w: string) => w.length > 4 ? w.replace(/(?:ies)$/, "y").replace(/(?<!s)s$/, "") : w;
/** A label's words that tell rows apart: lower case, no filler, no lone numbers or letters. */
export function labelWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/&amp;/g, "&").split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !FILLER.has(w)).map(stem))];
}
/** Two words the same, or one plainly the other's longer form ("hospital", "hospitalisation"). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
const has = (words: string[], w: string) => words.some((x) => sameWord(x, w));
/** Every word of `inner` is in `outer` (a non-empty `inner`). */
const within = (inner: string[], outer: string[]) => inner.length > 0 && inner.every((w) => has(outer, w));
/** How alike two labels are: shared words over all words, 0 to 1. */
function likeness(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const shared = a.filter((w) => has(b, w)).length;
  return shared / (a.length + b.length - shared);
}

type Group = { label: string; marked: boolean; figure: boolean; pieces: string[] };

/** The row's own text inside its quote's span of the page, or null when that cannot be told.
 * rows: how many rows the span holds (1: the whole span is the row's, as before).
 * The span's lines are cut into rows: a line starts another row when it starts with an item marker or a bullet, or when it
 * prints a figure after a label of its own that does not carry on the line above (RUNS_ON), is not a connective or cap
 * word, and is not the rest of this row's label wrapped below (its words are in the row's label, and the label above does
 * not yet hold all of them, and no figure has been printed yet). A tab cell after a figure starts another row on the same
 * line when it is a label (upper case, words only, no cap or value words, not the reading's column) with a figure after
 * it. A heading above the first row that is not the row's own label (no marker, no figure) is part of that first row.
 * With two or more rows, the row's own is the one whose label is most like the benefit's, and only when exactly one is;
 * a row with no figure of its own (a list item "(a) loss of one limb" above "(b) … S$100,000") gives no figure, unless the
 * quote starts on a line that prints only a figure, with no label, just above the row's label line. */
export function ownRowText(pageText: string, start: number, end: number, benefit: string, column: string | null = null): { rows: number; text: string | null } {
  const from = pageText.lastIndexOf("\n", start - 1) + 1;
  const stop = (() => { const e = pageText.indexOf("\n", Math.max(start, end - 1)); return e < 0 ? pageText.length : e; })();
  const whole = pageText.slice(start, end);
  if (!whole.includes("\n") && !/\S\t+\S/.test(pageText.slice(from, stop))) return { rows: 1, text: whole };
  const want = labelWords(benefit), columnWords = labelWords(column ?? "");
  const groups: Group[] = [];
  let at = from, prevLine = "", prevFirst = "";
  for (const line of pageText.slice(from, stop).split("\n")) {
    const lineFrom = at;
    at += line.length + 1;
    if (!line.trim()) continue;
    const cells: { text: string; s: number; e: number }[] = [];
    for (const m of line.matchAll(/[^\t]+/g)) if (m[0].trim()) cells.push({ text: m[0].trim(), s: lineFrom + m.index!, e: lineFrom + m.index! + m[0].length });
    const firstFigureCell = cells.findIndex((c) => /\d/.test(c.text.replace(ITEM_START, "")));
    cells.forEach((c, j) => {
      let g = groups[groups.length - 1];
      const bare = c.text.replace(ITEM_START, "").trim();
      const labelPart = bare.replace(/(?:[A-Z]{0,3}\$|RM|£|€)?\s*\d.*$/s, "").trim();
      let starts = !g;
      if (g && j === 0) {
        const marked = ITEM_START.test(line);
        const words = labelWords(labelPart);
        const wrappedLabel = !g.figure && within(words, want) && !within(want, labelWords(g.label));
        starts = marked || (firstFigureCell >= 0 && !!labelPart && /^[A-Z]/.test(labelPart) && !CARRIES_ON.test(labelPart)
          && !RUNS_ON(prevLine, line) && !RUNS_ON(prevFirst, c.text) && !wrappedLabel);
      } else if (g && j > 0) {
        starts = g.figure && !/\d/.test(c.text) && /^[A-Z][\p{L}'’&/(). -]+$/u.test(c.text) && /\p{L}{2}/u.test(c.text)
          && !CARRIES_ON.test(c.text) && !VALUE_WORDS.test(c.text) && !within(labelWords(c.text), columnWords)
          && cells.slice(j + 1).some((x) => /\d/.test(x.text));
      }
      if (starts) { groups.push({ label: "", marked: j === 0 && ITEM_START.test(line), figure: false, pieces: [] }); g = groups[groups.length - 1]; }
      if (!g.figure) g.label += " " + labelPart;
      if (/\d/.test(bare)) g.figure = true;
      const s = Math.max(c.s, start), e = Math.min(c.e, end);
      if (e > s) g.pieces.push(pageText.slice(s, e));
    });
    prevLine = line; prevFirst = cells[0]?.text ?? "";
  }
  // A heading above the first row ("Section 2: Hospital", "Permanent disablement:") that is not itself the row's label is
  // that row's heading.
  while (groups.length > 1 && !groups[0].figure && !groups[0].marked && !within(want, labelWords(groups[0].label))) {
    const [head, next] = groups.splice(0, 2);
    groups.unshift({ label: `${head.label} ${next.label}`, marked: next.marked, figure: next.figure, pieces: [...head.pieces, ...next.pieces] });
  }
  if (groups.length <= 1) return { rows: 1, text: whole };
  const scores = groups.map((g) => likeness(labelWords(g.label), want));
  const best = Math.max(...scores);
  const top = groups.filter((_, k) => scores[k] === best);
  if (best <= 0 || top.length !== 1) return { rows: groups.length, text: null };
  const own = groups.indexOf(top[0]);
  // A figure printed on a line of its own, with no label, that the quote starts on, just above the row's label line that
  // prints none ("70%\n(b) Right Hand": an extraction that puts the figure cell above its label) is the row's.
  if (!top[0].figure && own === 1 && groups[0].figure && !labelWords(groups[0].label).length && !groups[0].label.trim())
    return { rows: groups.length, text: [...groups[0].pieces, ...top[0].pieces].join("\t") };
  if (!top[0].figure) return { rows: groups.length, text: null };
  return { rows: groups.length, text: top[0].pieces.join("\t") };
}

/** Nouns of things counted: a number before one is a count, never money. */
export const COUNT_NOUN = /^[ \t]*(?:procedures?|treatments?|visits?|sessions?|days?|nights?|weeks?|months?|years?|yrs?|hours?|hrs?|claims?|times|events?|persons?|people|child(?:ren)?|members?|items?|pairs?|admissions?|trips?|operations?|surger(?:y|ies)|consultations?|courses?|cycles?|teeth|tooth|lives|polic(?:y|ies)|units?|occasions?|episodes?)\b/i;

/** The value is printed in the text only as a count: every printed occurrence of it is followed by a count noun, and none is
 * a money figure ("up to a maximum of 2 procedures", "10 sessions"). */
export function printedOnlyAsCount(text: string, value: number): boolean {
  const t = text.normalize("NFKC");
  if (anyMoneyFigures(t).some((f) => Math.abs(f.value - value) < 0.005 && !COUNT_NOUN.test(t.slice(f.index + f.length)))) return false;
  const hits = [...t.matchAll(/(?<![\d.,])\d[\d,]*(?:\.\d+)?(?![\d])/g)].filter((m) => Math.abs(Number(m[0].replace(/,/g, "")) - value) < 0.005);
  return hits.length > 0 && hits.every((m) => COUNT_NOUN.test(t.slice(m.index! + m[0].length)));
}

/** A cap figure in the cap's own words that is money: printed as a money figure (with a code or a sign, a bare "$" too,
 * whose currency it never sets: check.ts capFigureCurrency), or printed bare on a page that declares its currency ("Limit
 * (S$)": "up to 500"); and never followed by a count noun ("up to a maximum of 2 procedures"). */
export function moneyCapPrinted(text: string, value: number, pageDeclares: string | null): boolean {
  const t = text.normalize("NFKC");
  if (anyMoneyFigures(t).some((f) => Math.abs(f.value - value) < 0.005 && !COUNT_NOUN.test(t.slice(f.index + f.length)))) return true;
  if (!pageDeclares) return false;
  return [...t.matchAll(/(?<![\d.,])\d[\d,]*(?:\.\d+)?(?![\d])/g)].some((m) => Math.abs(Number(m[0].replace(/,/g, "")) - value) < 0.005
    && !COUNT_NOUN.test(t.slice(m.index! + m[0].length)) && !/^\s*(?:%|per\s?cent|x\b|×)/i.test(t.slice(m.index! + m[0].length)));
}
