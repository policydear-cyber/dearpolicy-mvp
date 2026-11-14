/** A benefit row's own line(s) inside its quote, and counts that are never money.
 *
 * A quote the model copies in page order may run over two rows ("Hospital cash\tS$100 per day\nSurgical fees\tS$5,000",
 * "(a) loss of one limb\n(b) loss of sight of one eye\tS$100,000"). The figure is printed in the quote, but on the other
 * row's line: shown for this row it is a wrong amount (wrapped-quote gate, P1). A row's figure counts only when it is
 * printed on the row's own lines: the line whose label is the row's label, and the lines that carry that same row on
 * (no item marker, no bullet, no new label of a row of its own).
 *
 * A bare number (no currency sign or code) is money only when what follows it is on an allow-list (nothing, punctuation,
 * "per", "each", "a day", "or", a currency word ...): "up to a maximum of 2 procedures", "12 fillings" are counts, never
 * money (wrapped-quote gate, P2: "up to S$2"; cross-row gate H5). A figure printed with a currency is always money
 * ("S$150\tDays 1-30", cross-row gate M1). Allow-lists throughout. No model, database or network. */
import { ANY_MONEY_FIGURE, anyMoneyFigures } from "@/lib/format/currency";

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

/** What may follow a bare number that is money: nothing, punctuation, a bracket or a slash, or a word from this list.
 * Anything else ("procedures", "fillings", "check-ups", "x") makes it no money figure. */
const MONEY_AFTER = /^(?:[ \t]*$|[ \t]*[,.;:)\]\n\t(\/]|[ \t]*[-–](?![ \t]*\d)|[ \t]+(?:per|each|every|a(?:n)?[ \t]+(?:day|night|week|month|year)|for|in[ \t]+respect[ \t]+of|in[ \t]+total|in[ \t]+aggregate|or|and|whichever|up[ \t]+to|subject|max(?:imum)?|only|payable|paid|lump|overall|on|upon|after|from|if|when|while|under|less|plus|limit|dollars?|ringgit|pounds?|euros?|sgd|usd|myr|hkd|aud|gbp|eur|rm)\b)/i;
const BARE_NUMBER = /(?<![\d.,\/\p{L}$£€])(?<!\d[ \t]?[-–][ \t]?)\d[\d,]*(?:\.\d+)?(?![\d%])/gu;
/** Bare numbers in the text that read as money (followed by an allowed word), with where each starts. */
function bareMoney(t: string): { value: number; index: number }[] {
  return [...t.matchAll(BARE_NUMBER)].filter((m) => MONEY_AFTER.test(t.slice(m.index! + m[0].length)))
    .map((m) => ({ value: Number(m[0].replace(/,/g, "")), index: m.index! }));
}
/** A figure in a line or cell: a money figure (any currency), a percentage, or a bare number that reads as money. */
const MONEY_RE = new RegExp(ANY_MONEY_FIGURE, "u");
function firstFigureAt(t: string): number {
  const at = [t.search(/\d\s*%/), t.search(MONEY_RE), ...bareMoney(t).slice(0, 1).map((b) => b.index)].filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
}
/** A label that only names a tier of the row above: "Days 1-30", "Day 31 onwards", "Year 1", "Visits 1 to 10",
 * "Thereafter", "Subsequent days" (cross-row gate M2). */
const TIER_LABEL = /^[ \t(]*(?:(?:days?|nights?|weeks?|months?|years?|visits?|sessions?|claims?|trips?)[ \t]*\d+(?:[ \t]*(?:-|–|to)[ \t]*\d+)?(?:[ \t]*(?:onwards?|and[ \t]+above|thereafter))?|thereafter|subsequent(?:[ \t]+\p{L}+)?|(?:first|next|following|remaining)[ \t]+\d+[ \t]+\p{L}+|from[ \t]+day[ \t]+\d+(?:[ \t]+onwards?)?)[ \t):,;\-–]*$/iu;
/** A label that carries the row's limit on: a cap phrase, optionally after "or"/"(", or a lone connective ("or S$50,000"). */
const CAP_LABEL = /^[ \t,;(]*(?:(?:or|and)[ \t]+)?(?:up[ \t]+to|subject[ \t]+to|max(?:imum)?\.?|limited[ \t]+to|not[ \t]+(?:to[ \t]+)?exceed(?:ing)?|capped[ \t]+at|whichever)\b|^[ \t,;(]*(?:or|and|plus)?[ \t,;:(]*$/i;
/** The line above runs on into this one: it stops on a joining word, a comma, "&", "/" or a hyphen, without ending a
 * sentence (a lower-case start is judged by the caller). */
const RUNS_INTO = (above: string) => !/[.!?:]\s*$/.test(above) && /(?:\b(?:by|for|of|on|in|to|with|under|from|at|and|or|the|a|an|any|all|other|our|your|its|their|which|that|than|is|are|be)|[,&/–-])\s*$/.test(above);

/** A label that ends by introducing its figure as a limit ("will be payable, subject to a maximum amount of"). */
const CAP_BEFORE_FIGURE = /(?:\bup[ \t]+to|\bmax(?:imum)?(?:[ \t]+amount)?(?:[ \t]+of)?|\bmax\.|\blimited[ \t]+to|\bcapped[ \t]+at|\bnot[ \t]+(?:to[ \t]+)?exceed(?:ing)?|\bsubject[ \t]+to(?:[ \t]+an?)?(?:[ \t]+max(?:imum)?)?(?:[ \t]+(?:amount|limit))?(?:[ \t]+of)?)[ \t:]*$/i;
/** A figure followed by a description in lower case, of three words or more ("S$100 for every six hours diverted"): it
 * describes the row's benefit, not another row's figure. */
const DESCRIBED_FIGURE = /^[ \t]*\S*\d[\d,.]*%?(?:[ \t]+[a-z][\p{L}'’-]*){3,}/u;
/** A table row whose cells wrap: as many cells as the line above, and a cell above that runs into the one below it
 * ("Angioplasty and other invasive treatment for" over "coronary artery": the wrapped-quote branch's CELL_CONTINUES). */
const cellsRunOn = (above: string, line: string) => {
  const a = above.split("\t").map((c) => c.trim()).filter(Boolean), b = line.split("\t").map((c) => c.trim()).filter(Boolean);
  return a.length >= 2 && a.length === b.length && a.some((c) => RUNS_INTO(c));
};
type Line = { from: number; text: string; marked: boolean; label: string; figure: boolean };
type Group = { label: string; marked: boolean; figure: boolean; ownFigure: boolean; pieces: string[]; first: number; last: number };
const markerLength = (t: string) => ITEM_START.exec(t)?.[0].length ?? 0;
function lineOf(text: string, from: number): Line {
  const m = markerLength(text), rest = text.slice(m), f = firstFigureAt(rest);
  return { from, text, marked: m > 0, label: (f < 0 ? rest : rest.slice(0, f)).replace(/\s+/g, " ").trim(), figure: f >= 0 };
}
const hasWords = (t: string) => /\p{L}{2}/u.test(t);

/** The row's own text among the lines its quote touches, or null when that cannot be told.
 * rows: how many rows those lines hold (1: the quote is the row's, as before).
 * The lines are read whole (a cap printed after the quote on the row's own cells is the row's: cross-row gate M0) and cut
 * into rows. A line starts another row when:
 * - it starts with an item marker or a bullet;
 * - it prints a label, then a figure (whatever its case: "surgical fees\tS$5,000", "And Ambulance\tS$500"), unless the label
 *   names a tier of the row ("Days 1-30") or carries its limit on ("up to", "subject to a maximum of", "or"), or the line
 *   above runs into it (as a whole, or a cell into the cell below it), or no figure has been printed yet and the line is
 *   the row's label wrapped (it starts in lower case, or its words finish the benefit's name);
 * - it prints only a figure after a row that already has its figure, unless the line above runs into it;
 * - it prints only words, after a row that has its figure, and the next line of the quote prints only a figure (a label
 *   with its figure below: "Surgical fees\n\tS$5,000"); or before any figure, when the row's label above is already whole
 *   and these words are not part of it.
 * A tab cell after a figure starts another row on the same line when it is a label (words only, no cap or value words, not
 * the reading's column) with a figure after it. A heading above the first row that is not the row's own label is part of it.
 * The row's own is the one whose label is most like the benefit's, only when exactly one is, and only when it prints a figure;
 * except a quote that starts on a line of a figure alone, just above the row's label line, where the page line above that
 * figure is not a label without a figure and the line below the label is not a figure alone ("100%\n9.\tLoss of …": a
 * figure extracted above its label; never "(a) Left Hand\n70%\n(b) Right Hand\n60%": cross-row gate H3). */
export function ownRowText(pageText: string, start: number, end: number, benefit: string, column: string | null = null): { rows: number; text: string | null } {
  const from = pageText.lastIndexOf("\n", start - 1) + 1;
  const stop = (() => { const e = pageText.indexOf("\n", Math.max(start, end - 1)); return e < 0 ? pageText.length : e; })();
  const whole = pageText.slice(start, end);
  if (!whole.includes("\n") && !/\S\t+\S/.test(pageText.slice(from, stop))) return { rows: 1, text: whole };
  const want = labelWords(benefit), columnWords = labelWords(column ?? "");
  const lines: Line[] = [];
  for (let at = from; at <= stop;) {
    const e = pageText.indexOf("\n", at), to = e < 0 || e > stop ? stop : e;
    const text = pageText.slice(at, to);
    if (text.trim()) lines.push(lineOf(text, at));
    at = to + 1;
  }
  const groups: Group[] = [];
  const open = (marked: boolean, k: number) => { groups.push({ label: "", marked, figure: false, ownFigure: false, pieces: [], first: k, last: k }); return groups[groups.length - 1]; };
  lines.forEach((line, k) => {
    // A line whose figure is a limit ("Capped at S$200 per day", or words in lower case, in one cell, ending in a cap phrase:
    // "will be payable, subject to a maximum amount of S$25,000") carries the row on, and its figure is not the row's own
    // figure (the row's figures may still follow it).
    const capLine = line.figure && (CAP_LABEL.test(line.label) || (/^[a-z]/.test(line.label) && !line.text.slice(0, line.text.search(/\d/)).includes("\t") && CAP_BEFORE_FIGURE.test(line.label)));
    let g = groups[groups.length - 1];
    if (!g) g = open(line.marked, k);
    else {
      const prev = lines[k - 1].text, next = lines[k + 1];
      const lower = /^[a-z]/.test(line.label), words = labelWords(line.label);
      let starts: boolean;
      if (line.marked) starts = true;
      else if (line.figure && hasWords(line.label)) {
        starts = !(capLine || TIER_LABEL.test(line.label) || RUNS_INTO(prev) || cellsRunOn(prev, line.text)
          || (!g.ownFigure && (lower || (within(words, want) && !within(want, labelWords(g.label))))));
      } else if (line.figure) starts = g.ownFigure && !RUNS_INTO(prev) && !DESCRIBED_FIGURE.test(line.text.split("\t")[0]);
      else if (CAP_LABEL.test(line.label) || TIER_LABEL.test(line.label) || lower || RUNS_INTO(prev)) starts = false;
      else if (g.ownFigure) starts = !!next && !next.marked && next.figure && !hasWords(next.label);
      else starts = within(want, labelWords(g.label)) && !within(words, want);
      if (starts) g = open(line.marked, k);
    }
    g.last = k;
    // The line's cells: a later cell that is a label with a figure after it is another row on the same line.
    const cells = line.text.split("\t").filter((c) => c.trim());
    cells.forEach((cell, j) => {
      const c = cell.trim();
      if (j > 0 && g.ownFigure && !/\d/.test(c) && /^[A-Z][\p{L}'’&/(). -]+$/u.test(c) && hasWords(c) && !CAP_LABEL.test(c)
        && !VALUE_WORDS.test(c) && !CARRIES_ON.test(c) && !TIER_LABEL.test(c) && !within(labelWords(c), columnWords)
        && cells.slice(j + 1).some((x) => firstFigureAt(x) >= 0)) { g = open(false, k); }
      const bare = j === 0 ? c.slice(markerLength(c)).trim() : c;
      const f = firstFigureAt(bare);
      if (!g.ownFigure && !capLine) g.label += " " + (f < 0 ? bare : bare.slice(0, f));
      if (f >= 0) { g.figure = true; if (!capLine) g.ownFigure = true; }
      g.pieces.push(c);
    });
  });
  // A heading above the first row ("Section 2: Hospital", "Permanent disablement:") that is not itself the row's label is
  // that row's heading.
  while (groups.length > 1 && !groups[0].figure && !groups[0].marked && !within(want, labelWords(groups[0].label))) {
    const [head, next] = groups.splice(0, 2);
    groups.unshift({ ...next, label: `${head.label} ${next.label}`, pieces: [...head.pieces, ...next.pieces], first: head.first });
  }
  if (groups.length <= 1) return { rows: 1, text: whole };
  const scores = groups.map((g) => likeness(labelWords(g.label), want));
  const best = Math.max(...scores);
  const top = groups.filter((_, k) => scores[k] === best);
  if (best <= 0 || top.length !== 1) return { rows: groups.length, text: null };
  const own = top[0];
  if (own.figure) return { rows: groups.length, text: own.pieces.join("\t") };
  // A figure alone, extracted above its label: only as the quote's first line, just above the label line, with the page line
  // above it not a label lacking a figure, and the page line below the label not a figure alone.
  const head = groups[0];
  if (groups.indexOf(own) !== 1 || !head.figure || hasWords(head.label) || head.first !== head.last || own.first !== 1) return { rows: groups.length, text: null };
  const pageLine = (pos: number, dir: -1 | 1): Line | null => {
    let at = pos;
    for (;;) {
      if (dir < 0) { if (at <= 0) return null; const s0 = pageText.lastIndexOf("\n", at - 2) + 1; const t = pageText.slice(s0, at - 1); at = s0; if (t.trim()) return lineOf(t, s0); }
      else { const e = pageText.indexOf("\n", at); if (e < 0) return null; const e2 = pageText.indexOf("\n", e + 1); const t = pageText.slice(e + 1, e2 < 0 ? pageText.length : e2); at = e + 1; if (t.trim()) return lineOf(t, e + 1); }
    }
  };
  const above = pageLine(lines[head.first].from, -1), below = pageLine(lines[own.last].from, 1);
  if (above && !above.figure && (hasWords(above.label) || above.marked)) return { rows: groups.length, text: null };
  if (below && below.figure && !hasWords(below.label) && !below.marked) return { rows: groups.length, text: null };
  return { rows: groups.length, text: [...head.pieces, ...own.pieces].join("\t") };
}

/** The value is printed in the text, and never as money: no money figure prints it, and every bare printing of it is
 * followed by something off the MONEY_AFTER allow-list ("up to a maximum of 2 procedures", "12 fillings", "2 x"). */
export function printedOnlyAsCount(text: string, value: number): boolean {
  const t = text.normalize("NFKC");
  if (anyMoneyFigures(t).some((f) => Math.abs(f.value - value) < 0.005)) return false;
  const hits = [...t.matchAll(BARE_NUMBER)].filter((m) => Math.abs(Number(m[0].replace(/,/g, "")) - value) < 0.005);
  return hits.length > 0 && !bareMoney(t).some((b) => Math.abs(b.value - value) < 0.005);
}

/** A cap figure in the cap's own words that is money: a money figure (a code or a sign; a bare "$" too, whose currency it
 * never sets: check.ts capFigureCurrency), or a bare number that reads as money (MONEY_AFTER) where the row's currency is
 * declared ("Limit (S$)": "up to 500 per year"). */
export function moneyCapPrinted(text: string, value: number, declared: string | null): boolean {
  const t = text.normalize("NFKC");
  if (anyMoneyFigures(t).some((f) => Math.abs(f.value - value) < 0.005)) return true;
  return !!declared && bareMoney(t).some((b) => Math.abs(b.value - value) < 0.005);
}
