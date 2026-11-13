/** Checking a page's text before anything reads it (a household's new documents, 24 Oct: two Prudential schedules whose
 * text came out with every label first and every value after, and neighbouring figures glued together, so no row could
 * be tied to its amount).
 *
 * A page whose text shows those signs is read a second time from its image. The page is used only when both readings
 * agree line by line: the same figures, and each figure beside the same label in both. The text reading, the document's
 * own words, is what is stored; the image reading only confirms it. A page they do not agree on, or one whose text puts no
 * label beside its figures (one reading of the pairing is not two), is "unchecked": its text stays searchable, but
 * nothing reads an amount from it, and the document says it was read in part. Nothing here uses a model. */

import { singleImageCurrency } from "@/lib/documents/image-currency";

/** "50,000.0050,000.00": a complete decimal amount with a second one straight after it. A rate or date with more
 * decimals ("1.235", "4.125%", "01.10.2026") is not glued (TE U-F3). */
const GLUED = /\d\.\d{2}\d[\d,]*\.\d{2}(?!\d)/;
const UNGLUE = /(\d\.\d{2})(?=\d[\d,]*\.\d{2}(?!\d))/g;
/** An amount: two decimals or thousands groups, in any market's way of writing them ("12,000.00", "12.000,00", "250,00",
 * "12'000", "2 500"). A page number or an age is not one.
 *
 * Space thousands ("2 500 kr", "120 000 zł", with a plain, no-break or narrow space) are amounts: before, a Swedish,
 * Polish or French table whose labels came out before their values was never seen as scrambled, so its amounts were used
 * without the image check (TE #329). One dot group ("1.500") is always read as thousands, the safe reading: by its figures
 * alone a rate card ("1.235", "0.925") cannot be told from a rupiah table whose currency is printed only in its heading
 * ("250.000", "0.5"), and a missed table pairs amounts by guess while a flagged rate card costs one image reading (TE #330
 * round 2). */
const AMOUNT = /\d[\d,]*\.\d{2}(?!\d)|\d{1,3}(?:,\d{3})+|\d[\d.]*,\d{2}(?!\d)|\d{1,3}(?:\.\d{3})+(?!\d)|\d{1,3}(?:['’]\d{3})+|(?<!\d)\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?!\d)/;
/** Whether a value line prints an amount. A date is never one ("01.10.2026" is a date, not "01.10"; TE #329). */
const amountOn = (line: string) => AMOUNT.test(line.replace(new RegExp(DATE, "gi"), " "));
// Every number on the line, small amounts and percentages too ("S$300", "25%"): two readings that pair them differently
// must not agree (Critic R175-1).
const FIGURE = /\d[\d,]*(?:\.\d+)?/g;
/** A line holding only figures, each with or without its currency: any currency symbol, with the letters a market prints
 * before it ("S$", "US$", "HK$", "R$"); an ISO code ("SGD", "MYR", "GBP", "IDR"); or a market's own short form ("RM",
 * "Rp", "Rs", "kr"). Before, only "$" and the letters of "SGD"/"USD" counted, so a ringgit, pound or rupiah table whose
 * labels came out before their values was never seen as scrambled (TE #324). Closed lists: any other word keeps the
 * line a label line. */
const ISO_CURRENCIES = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["SGD", "USD", "MYR", "GBP", "EUR", "IDR", "HKD", "INR", "PHP", "THB", "AUD", "CNY", "JPY"]);
const LOCAL_CURRENCY_FORMS = new Set(["RM", "Rp", "Rs", "kr", "Kr", "zł", "Kč", "Ft", "lei", "TL", "KSh", "Ksh", "đ", "円", "元", "원"]);
// The letters a market prints before its symbol, a closed list (Critic #329 L3): "MAX$1,500" stays a label line.
const CURRENCY_MARK = /(?<![A-Za-z])(?:S|US|HK|A|AU|NZ|NT|R|C|CA|MX|N|J|B|BZ|T|TT|Z|RD|CI|EC|FJ|G|GY|L|SI|SG)?\p{Sc}/gu;
const NUMBERS_ONLY = {
  test(line: string): boolean {
    const bare = line.replace(CURRENCY_MARK, " ").replace(/[\p{L}]+\.?/gu, (word) => {
      const w = word.replace(/\.$/, "");
      return ISO_CURRENCIES.has(w) || LOCAL_CURRENCY_FORMS.has(w) ? " " : word;
    });
    // Swiss thousands are written with an apostrophe ("1'500.00", "1’500.00"; Critic #329 L2).
    return /^[\s\d,.'’\-–—%]*\d[\s\d,.'’\-–—%]*$/.test(bare);
  },
};
// Letters of any script count: Vietnamese "Nằm viện" or "Hệ số" has no three Latin letters in a row, so its labels were
// never seen and its scrambled table never checked (TE #330).
const LABEL_ONLY = (line: string) => line.length >= 3 && line.length <= 60 && !/\d/.test(line) && (line.match(/\p{L}/gu) ?? []).length >= 3;

/** Signs that a page's table text came out scrambled: glued figures, or a run of labels with no figures followed by a run
 * of lines holding only figures (labels read before values). */
export function scrambleSigns(text: string): string[] {
  const signs: string[] = [];
  if (GLUED.test(text)) signs.push("figures printed side by side came out glued together");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let labels = 0;
    while (i + labels < lines.length && LABEL_ONLY(lines[i + labels])) labels++;
    let values = 0;
    while (i + labels + values < lines.length && NUMBERS_ONLY.test(lines[i + labels + values])) values++;
    const run = lines.slice(i + labels, i + labels + values);
    const amounts = run.filter(amountOn).length;
    // A table's own column header over its rows ("Age  Male  Female" over "35  120.50  110.20") is not scrambled, and
    // a contents list's page numbers are not amounts (TE U-F2).
    const cells = (line: string) => line.split("\t").length;
    // Only a header whose rows carry their own key in the first cell ("35" for an age) pairs each row; rows of amounts
    // alone under "Sum Assured  Premium" still leave the plan labels above unpaired (TE UC-2).
    const rows = run;
    const header = labels > 0 && cells(lines[i + labels - 1]) >= 2 && values > 0 && rows.every((r) => cells(r) === cells(lines[i + labels - 1]) && !AMOUNT.test(r.split("\t")[0]));
    if (labels >= 3 && values >= 3 && amounts >= 2 && !header) { signs.push("labels came out before their values"); break; }
    i += Math.max(0, labels - 1);
  }
  return signs;
}
export const looksScrambled = (text: string) => scrambleSigns(text).length > 0;

const unglue = (text: string) => text.replace(UNGLUE, "$1 ");
/** A word joined by underscores that holds a digit ("CC_1234_5678_9012", "FORM_B_2024") is a printed code (a print run,
 * a form or batch reference), never an amount: no market writes an amount with "_". Image readers often leave such small
 * print out, so its digits are not compared as figures; the code is one word ("code") in both readings. Before, a page
 * whose footer printed one was "read in part" (live, 11 Nov). */
const codesAsWords = (text: string) => text.replace(/\w*_\w*/g, (w) => (/\d/.test(w) ? " code " : w));
const figuresIn = (text: string) => (unglue(codesAsWords(text)).match(FIGURE) ?? []).map((f) => Number(f.replace(/,/g, ""))).filter((n) => n > 0);

/** Whether the page's image reading agrees with its text reading: every line of each that prints figures has a line in
 * the other with the same words and figures in the same order (a line printed twice must be printed twice), and the image
 * reading prints figures at all. A figure line with no label in the text reading has nothing to agree on. */
/** Why two readings did not agree, in words that quote nothing from the page: what is kept in the processing history
 * (TE P115-1: a label or an amount there would outlive the deleted document). */
export type DisagreeKind = "image prints no figures" | "figures differ" | "figure line with no label" | "pairing differs";
export function readingsAgree(textReading: string, imageReading: string, pageNumber?: number): { agree: true } | { agree: false; why: string; kind: DisagreeKind } {
  const check = checkLines(textReading, imageReading, pageNumber);
  return check.agree ? { agree: true } : { agree: false, why: check.why, kind: check.kind! };
}

/** What is stored, searched and read in place of a page the two readings did not agree on: a notice, and the page's lines
 * that print no amount (the policy's name, number and status), so the policy is not missing from answers (Critic R175-c).
 * Storing it in place of the page text keeps every reader of the page, search included, off its amounts (TE U-F5). */
export const UNCHECKED_PAGE = "[This page could not be checked against the page image, so no amount on it is used. Say its amounts are not shown.]";
// Only lines with no figure at all, or a number or date by its own label ("Policy Number: 63639755"): a bare "Sum Assured
// 13500" on a page whose pairing is not checked is still an amount (Critic R176-2).
// The labelled number or date is taken out first, and the line kept only when no other figure is left on it, so "Policy
// number TE-1 Annual limit 150000" is dropped (TE UC-1).
// A real month only: "Expiry 30 days 1500" is not a date (Critic R179-1).
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
const DATE = String.raw`(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+${MONTH}\s+\d{4}|${MONTH}\s+\d{1,2},?\s+\d{4})`;
const LABELLED = new RegExp(String.raw`\b(?:policy|certificate|contract|member|account)\s*(?:no\.?|number)\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9/-]*`
  + String.raw`|\b(?:date(?:\s+of\s+[a-z]+)?|dated|(?:commencement|expiry|issue|start|end)(?:\s+date)?|issued(?:\s+on)?)\s*[:-]?\s*` + DATE, "gi");
const LONE_NUMBER = /^\s*(?:page\s+)?\d{1,3}(?:\s+of\s+\d{1,3})?\s*$/i;
const LONE_DATE = new RegExp(String.raw`^\s*` + DATE + String.raw`\s*$`, "i");

type Token = string | number;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WHOLE_DATE = new RegExp(String.raw`^` + DATE + String.raw`$`, "i");
/** A date is one token, whatever its separators: "01.10.2026", "1/10/2026" and "1 Oct 2026" are one date, so two readings
 * that print it differently still agree on its line, and its parts are never read as figures (Critic plan step 3). */
function dateToken(printed: string): string {
  const t = printed.toLowerCase(), month = (m: string) => MONTHS.findIndex((x) => m.startsWith(x)) + 1;
  let d = 0, m = 0, y = 0, p: RegExpMatchArray | null;
  if ((p = t.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [y, m, d] = [+p[1], +p[2], +p[3]];
  else if ((p = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) [d, m, y] = [+p[1], +p[2], +p[3]];
  else if ((p = t.match(/^(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})$/))) [d, m, y] = [+p[1], month(p[2]), +p[3]];
  else if ((p = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/))) [m, d, y] = [month(p[1]), +p[2], +p[3]];
  else return `date ${t}`;
  return `date ${d}-${m}-${y}`;
}
const isDate = (t: Token) => typeof t === "string" && t.startsWith("date ");
/** A line's words and figures in printed order. Every word counts, "A" and "B" too, and order counts, so two pairs swapped
 * within one line, or "Plan A" and "Plan B" swapped, do not agree (TE U-F1). Currency marks and "%" are left out: the two
 * readings may print them differently. */
function lineTokens(line: string): Token[] {
  const tokens = unglue(codesAsWords(line)).replace(/US\$|S\$|\$|\b(?:SGD|USD)\b/gi, " ").toLowerCase().match(new RegExp(DATE + String.raw`|\d[\d,]*(?:\.\d+)?|[a-z]+`, "gi")) ?? [];
  return tokens.map((t): Token => (WHOLE_DATE.test(t) ? dateToken(t) : /^\d/.test(t) ? Number(t.replace(/,/g, "")) : t));
}
const figureLine = (l: Token[]) => l.some((t) => (typeof t === "number" ? t > 0 : isDate(t)));
const sameLine = (a: Token[], b: Token[]) => a.length === b.length && a.every((t, i) => (typeof t === "number" ? typeof b[i] === "number" && Math.abs(t - (b[i] as number)) < 0.005 : t === b[i]));
const sameFigures = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 0.005);
const figuresOf = (l: Token[]) => l.filter((t): t is number => typeof t === "number");
const labelOf = (l: Token[]) => l.filter((t) => typeof t === "string" && !isDate(t)).join(" ");

/** The lines that pair nothing: a page number or a date on a line of its own (TE UC-3). One lone number is the page
 * number; several are values whose labels are elsewhere, and stay to be refused. The page number is "Page 3" or "3 of 12"
 * anywhere, the page's own number anywhere (a footer the text layer puts before its footer line, Critic R189-1), or a one-
 * or two-digit number as the first or last line, unless the line beside it is a label alone: a value under its label
 * ("Hospital Cash per day" over "150", first or last or mid-page) stays to be refused (TE N8, P122-1, Critic R189-2). */
function pairingNothing(t: string, pageNumber?: number): Set<number> {
  const lines = t.split("\n"), numbers = lines.filter((l) => LONE_NUMBER.test(l)).length;
  const filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const first = filled[0], last = filled[filled.length - 1];
  const beside = (i: number) => lines[i === first ? filled[1] : filled[filled.length - 2]]?.trim() ?? "";
  const edge = (i: number) => /page|of/i.test(lines[i]) || Number(lines[i].trim()) === pageNumber
    || ((i === first || i === last) && /^\s*\d{1,2}\s*$/.test(lines[i]) && !LABEL_ONLY(beside(i)));
  return new Set(lines.map((l, i) => (LONE_DATE.test(l) || (numbers === 1 && LONE_NUMBER.test(l) && edge(i)) ? i : -1)).filter((i) => i >= 0));
}

/** What an unconfirmed figure is shown as: the line keeps its words, and the reader is told the amount was not checked. */
export const NOT_CHECKED = "[amount not checked]";
// A figure never ends in a comma: the sentence's own comma after it stays.
const ANY_FIGURE = new RegExp(String.raw`(?:US\$|S\$|\$)?(?:` + DATE + String.raw`|\d(?:[\d,]*\d)?(?:\.\d+)?%?)`, "gi");
const notChecked = (line: string) => unglue(line).replace(ANY_FIGURE, NOT_CHECKED);

/** One figure as the history keeps it: its kind and where it sits on the page, never its digits or the words beside it. */
type Seen = { key: string; shape: string; where: string };
function shapeOf(printed: string): string {
  if (WHOLE_DATE.test(printed)) return "date";
  if (printed.endsWith("%")) return "percent";
  if (/\.\d{2}$/.test(printed)) return printed.includes(",") ? "comma decimal amount" : "decimal amount";
  if (printed.includes(".")) return "other decimal";
  if (printed.includes(",")) return "comma amount";
  return printed.length <= 2 ? "1-2 digit number" : "3+ digit whole number";
}
function seenFigures(text: string): Seen[] {
  const lines = text.split("\n"), filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  return lines.flatMap((line, i) => {
    const at = filled.indexOf(i);
    const where = at >= 0 && at < 3 ? "first lines" : at >= filled.length - 3 ? "last lines" : labelOf(lineTokens(line)) ? "labelled line" : "line with no label";
    return (unglue(codesAsWords(line)).match(new RegExp(DATE + String.raw`|\d[\d,]*(?:\.\d+)?%?`, "gi")) ?? [])
      .map((printed) => ({ printed, key: WHOLE_DATE.test(printed) ? dateToken(printed) : Number(printed.replace(/[,%]/g, "")).toFixed(2) }))
      .filter((f) => f.key.startsWith("date ") || Number(f.key) > 0)
      .map((f) => ({ key: f.key, shape: shapeOf(f.printed), where }));
  });
}
function only(a: Seen[], b: Seen[]): Seen[] {
  const left = [...b];
  return a.filter((f) => { const i = left.findIndex((o) => o.key === f.key); if (i < 0) return true; left.splice(i, 1); return false; });
}
const tally = (xs: string[]) => [...new Set(xs)].sort().map((x) => `${x} ${xs.filter((y) => y === x).length}`).join(", ");
const described = (xs: Seen[]) => (xs.length ? `${xs.length} (${tally(xs.map((x) => x.shape))}; ${tally(xs.map((x) => x.where))})` : "0");

/** The page's text reading checked line by line against its image reading. Each figure line of the text is kept word for
 * word only when the image reading prints a line with the same words and the same figures in the same order (each image
 * line confirms one text line). A figure line with no label confirms nothing. `text` is the page as it may be stored: null
 * when no figure line was confirmed (the whole page is unchecked), otherwise every unconfirmed line with its figures shown
 * as NOT_CHECKED. `log` says what kind of difference it was, in counts and fixed words only (Critic plan step 1). */
/** A cell as both readings can compare it: lower case, letters and digits only, thousands marks dropped, a decimal point
 * kept between digits, currency marks left out. "Sum Assured: S$100,000.00" is "sumassured100000.00". */
const squash = (cell: string) => cell.normalize("NFKC").replace(CURRENCY_MARK, " ").toLowerCase()
  .replace(/(\d)[,'’](?=\d)/g, "$1").replace(/(\d)\.(?=\d)/g, "$1\u0001").replace(/[^\p{L}\p{N}\u0001]/gu, "").replace(/\u0001/g, ".");
const hasDigit = (s: string) => /\d/.test(s);
const SPACED_DIGITS = /\d\s+\d/;

/** The cells of an image line the reader printed with spaces only, no TAB between its cells ("Accidental Death In Force
 * 200,000.00 12.50 01-Mar-2019"; a household's schedule, 10 Nov: the reader gave the whole page so, and no column could
 * be compared). The line is split where the page's own text splits it: into the fewest runs of words that each stand
 * inside one text cell, a word the text does not print being a cell of its own. A figure (a word with a digit, or a
 * date) ends its cell: words may stand before it ("RM 200.00", "Jane Doe [AD-778]"), never after it, so two figures are
 * never in one cell and a run glued across two rows in the text ("200.00RM 400.00") is not taken for one cell. Nothing
 * is guessed:
 * - two figures that could be one amount written with a space for thousands ("2 500", "Option 2 500.00") leave the line
 *   whole;
 * - a line that can be split into that fewest number of cells in more than one way stays whole.
 * A line left whole, or split wrongly, matches no text cell, so its figures stay held back: the cells only say where the
 * columns are, and every check below still has to pass on them. */
const SPACE_THOUSANDS = (a: string, b: string) => /^\p{Sc}?\d{1,3}$/u.test(a) && /^\d{3}(?:[.,]\d+)?(?!\S)/.test(b);
/** Exported for the column-check regressions. */
export function spacedCells(line: string, vocab: string): string[] {
  const words = line.trim().match(new RegExp(DATE + String.raw`|\S+`, "gi")) ?? [];
  // A mark alone ("S$", ":", "-") goes with the word after it, or, at the end, the word before it.
  const tokens: string[] = [];
  for (const w of words) {
    if (tokens.length && !squash(tokens[tokens.length - 1])) tokens[tokens.length - 1] += " " + w;
    else tokens.push(w);
  }
  if (tokens.length > 1 && !squash(tokens[tokens.length - 1])) tokens[tokens.length - 2] += " " + tokens.pop();
  const n = tokens.length;
  if (n < 2) return [line.trim()];
  for (let k = 1; k < n; k++) if (hasDigit(tokens[k - 1]) && hasDigit(tokens[k]) && SPACE_THOUSANDS(tokens[k - 1], tokens[k])) return [line.trim()];
  const cell = (a: number, b: number) => b - a === 1
    || (vocab.includes(tokens.slice(a, b).map(squash).join("")) && tokens.slice(a, b - 1).every((t) => !hasDigit(t)));
  // fewest[a]: the fewest cells for tokens[a..]; ways[a]: how many splits give that many (counted to two).
  const fewest = Array<number>(n + 1).fill(Infinity), ways = Array<number>(n + 1).fill(0), next = Array<number>(n + 1).fill(-1);
  fewest[n] = 0; ways[n] = 1;
  for (let a = n - 1; a >= 0; a--) for (let b = a + 1; b <= n; b++) {
    if (!cell(a, b)) continue;
    const cells = fewest[b] + 1;
    if (cells < fewest[a]) { fewest[a] = cells; ways[a] = ways[b]; next[a] = b; } else if (cells === fewest[a]) ways[a] = Math.min(2, ways[a] + ways[b]);
  }
  if (ways[0] !== 1) return [line.trim()];
  const out: string[] = [];
  for (let a = 0; a < n; a = next[a]) out.push(tokens.slice(a, next[a]).join(" "));
  return out;
}

/** A page whose text layer gives each table column as one run, top to bottom, with nothing between the cells ("In
 * ForceIn ForceIn Force", "100,000.002,000.00500.00", "17-Nov-201617-Nov-2016"), while the image reading gives the rows
 * (a household's PruLink schedule, 9 Nov: every amount on pages 3 and 4 held back since October). Line by line nothing
 * can agree, but the two readings can still be checked against each other column by column:
 *
 * - a text cell that prints a figure is matched to the cells one column of the image prints on two or more consecutive
 *   lines, none blank and never the heading row, when joined in that order they are exactly the cell, or the column's own
 *   heading glued before them (then one line is enough: the text ties the figure to its heading); two figures may only
 *   meet where the first ends a complete decimal amount or a date's year, and no cell with digits apart by a space is
 *   matched, so a figure is never split or joined differently from how the image prints it; a run beside a row of the
 *   same table that prints no figure in that column could sit a row off and is not matched;
 * - every column of those lines, labels and words as well as figures, joined in the same order, is held by exactly one
 *   text cell, so each cell is in the same row in both readings; a run printed in two places is no evidence;
 * - each of those text cells lies in its own table's part of the text: from the table's first heading cell (or, with no
 *   heading row, its labels' run) up to the next table's, so a run cannot be borrowed from another table at the same
 *   left edge;
 * - those text cells, and the one text cell of each heading cell (the whole cell, exactly, where there is one), stand left
 *   to right on the page (the page geometry) in the order the image prints them: each figure is under the same heading.
 *
 * A row is kept only when every cell of it passes, and a text line only when every cell of it that prints a figure is
 * matched to rows that are all kept. Such a line is stored as the image's rows it holds, every figure of which the text
 * prints in the same column order; anything else stays as the line check left it (held back). */
function columnRows(textReading: string, imageReading: string, geometry: (number[] | undefined)[], held: Set<number>):
  { text: string; confirmed: Set<number>; image: Set<number> } | null {
  const tLines = textReading.split("\n");
  if (geometry.length !== tLines.length) return null;
  const tCells = tLines.map((l) => l.split("\t"));
  const xOf = (t: number, c: number) => { const xs = geometry[t]; return xs && xs.length === tCells[t].length && Number.isFinite(xs[c]) ? xs[c] : undefined; };
  const iLines = imageReading.split("\n");
  const vocab = tCells.flat().map(squash).filter(Boolean).join("\u0000");
  const iCells = iLines.map((l) => (l.includes("\t") ? l.split("\t").map((c) => c.trim()) : spacedCells(l, vocab)));
  // Lines the reader printed with spaces only that hold more than one cell.
  const spaced = new Set(iLines.map((l, k) => (!l.includes("\t") && iCells[k].length > 1 ? k : -1)).filter((k) => k >= 0));
  const filled = iLines.map((l, k) => (l.trim() ? k : -1)).filter((k) => k >= 0);
  if (!filled.length) return null;
  const widest = Math.max(...filled.map((k) => iCells[k].length));
  type Match = { t: number; ci: number; x: number; c: number; rows: number[] };
  type Spot = { x: number; t: number; s: string };
  const figureRow = (k: number) => iCells[k].some(hasDigit);
  // The heading row of the table a line belongs to: the nearest line above, past rows of the same width, that prints no
  // figure and has as many cells.
  const headingOf = (k: number) => {
    let p = filled.indexOf(k) - 1;
    while (p >= 0 && figureRow(filled[p]) && iCells[filled[p]].length === iCells[k].length) p--;
    const h = filled[p];
    return h !== undefined && iCells[h].length >= 2 && iCells[h].length === iCells[k].length && !figureRow(h) ? h : null;
  };
  // A row of the same table right above or below the run whose cell in that column prints no figure (blank, "N.A.", "Not
  // covered"): the run could belong one row further up or down, so it is no evidence (TE P398 C14).
  // A row right above or below with another number of cells, whose label the text prints glued to the run's labels, is a
  // row of the same table with a cell left out: a reader that prints cells with spaces only drops a blank cell without a
  // trace ("Trip cancellation" over "Overseas medical 150,000.00"), so which row the figures belong to is not known.
  const inOneCell = (s: string) => !!s && vocab.includes(s);
  const spacedRun = (a: number, b: number) => filled.slice(a, b + 1).some((k) => spaced.has(k));
  const labelRun = (rows: number[]) => rows.map((r) => squash(iCells[r][0] ?? "")).join("");
  const besideGap = (a: number, b: number, c: number) => [filled[a - 1], filled[b + 1]].some((k) =>
    k !== undefined && (iCells[k].length === iCells[filled[a]].length
      ? !squash(iCells[k][c]) || (iCells[k].some(hasDigit) && !hasDigit(iCells[k][c]))
      : (spaced.has(k) || spacedRun(a, b)) && k !== headingOf(filled[a]) && !!squash(iCells[k][0] ?? "")
        && inOneCell(k < filled[a] ? labelRun([k, ...filled.slice(a, b + 1)]) : labelRun([...filled.slice(a, b + 1), k]))));
  // Rows printed with spaces only: the line right above the run, when it prints no figure, is the run's heading row or a
  // title: a heading the text does not split the same way is not one cell of the text, and its rows are not compared
  // without it.
  // A title over the table ("Policy Details") is one line the text prints inside one cell, and is not a heading row.
  const headed = (a: number) => { const p = filled[a - 1]; return p === undefined || figureRow(p) || headingOf(filled[a]) === p || (iCells[p].length === 1 && inOneCell(squash(iCells[p][0]))); };
  const matches: Match[] = [];
  for (const t of held) for (let ci = 0; ci < tCells[t].length; ci++) {
    const x = xOf(t, ci), core = squash(tCells[t][ci]);
    // Figures with only a space between them ("Option 2 500.00", "2 500") would squash into one: never matched (Critic P398 B).
    if (x === undefined || !hasDigit(core) || SPACED_DIGITS.test(tCells[t][ci])) continue;
    let best: Match | null = null;
    for (let c = 0; c < widest; c++) for (let a = 0; a < filled.length; a++) {
      // A run never starts on a heading row: its heading is matched as the heading, glued before the run or not.
      if (a + 1 < filled.length && headingOf(filled[a + 1]) === filled[a]) continue;
      const h = headingOf(filled[a]), head = h === null ? "" : squash(iCells[h][c] ?? "");
      let joined = "", last = "", pieces = 0;
      for (let b = a; b < filled.length && iCells[filled[b]].length > c; b++) {
        if (SPACED_DIGITS.test(iCells[filled[b]][c])) break;
        const piece = squash(iCells[filled[b]][c]);
        // A blank cell inside the run: which row it belongs to is not known (TE P398 C11).
        if (!piece) break;
        if (/\d$/.test(last) && /^\d/.test(piece) && !/\.\d{2}$|\p{L}\d{4}$/u.test(last)) break;
        if (spacedRun(a, b) && !headed(a)) break;
        joined += piece; last = piece; pieces++;
        if (joined.length > core.length) break;
        // Two rows or more: one cell alone says nothing about which row it belongs to (Critic P398 A1-A3, C7). Exactly the
        // text cell, or its own heading glued before it, nothing else: a word cell ("N.A.", "Not covered") the image left
        // out would otherwise let the figures shift by a row (TE P398 C10, C14, C24).
        // One row is enough only when the text prints the column's own heading glued before it: the text itself then ties
        // the figure to its heading.
        // The run must then start on the first row right under that heading (Critic P398 H1).
        const glued = !!head && filled[a - 1] === h && head + joined === core;
        if ((pieces >= 2 || glued) && hasDigit(joined) && (joined === core || glued) && (!best || b - a + 1 > best.rows.length) && !besideGap(a, b, c)) best = { t, ci, x, c, rows: filled.slice(a, b + 1) };
      }
    }
    if (best) matches.push(best);
  }
  if (!matches.length) return null;
  const spots = (pick: (s: string) => boolean): Spot[] => tCells.flatMap((cs, t) => cs.flatMap((c, ci) => { const x = xOf(t, ci); return x !== undefined && squash(c) && pick(squash(c)) ? [{ x, t, s: squash(c) }] : []; }));
  // A run (cells of one column joined in row order) stands somewhere only when exactly one text cell holds it: printed in
  // two places it could be either table's (Critic P398 E2), and the row is held.
  const runAt = (run: string): Spot | undefined => { const at = spots((s) => s.includes(run)); return at.length === 1 ? at[0] : undefined; };
  // Where a heading cell stands: the one text cell that is exactly it; failing that, the one that holds it, not counting a
  // cell that holds a longer cell of the same heading (the "Component" of "Component Premium"). A heading word inside a
  // row label ("Benefit" in "Surgical benefit") does not count against a cell that is exactly "Benefit" (TE P398 C20).
  // Two places or none: no evidence, and the rows are held (Critic P398 C5, TE P398 C17).
  const headingAt = (cell: string, line: string[]): Spot | undefined => {
    const s = squash(cell), exact = spots((o) => o === s);
    if (exact.length) return exact.length === 1 ? exact[0] : undefined;
    const longer = line.map(squash).filter((o) => o !== s && o.includes(s));
    const at = spots((o) => o.includes(s) && !longer.some((l) => o.includes(l)));
    return at.length === 1 ? at[0] : undefined;
  };
  // Where each table starts in the text: the first text line holding one of its heading cells, or, for rows with no
  // heading row, the line holding their labels' run. A table's text runs from its start to the next table's start.
  const headsOf = (h: number) => iCells[h].map((c) => (squash(c) ? headingAt(c, iCells[h]) : undefined));
  const startOf = (anchors: (Spot | undefined)[]) => { const ts = anchors.filter((a): a is Spot => !!a).map((a) => a.t); return ts.length ? Math.min(...ts) : undefined; };
  const labelsOf = (m: Match) => runAt(m.rows.map((r) => squash(iCells[r][0] ?? "")).join(""));
  const starts = [...new Set([
    ...[...new Set(matches.map((m) => headingOf(m.rows[0])).filter((h): h is number => h !== null))].map((h) => startOf(headsOf(h))),
    ...matches.filter((m) => headingOf(m.rows[0]) === null).map((m) => labelsOf(m)?.t),
  ].filter((t): t is number => t !== undefined))].sort((p, q) => p - q);
  const within = (at: Spot, start: number) => at.t >= start && at.t < (starts.find((t) => t > start) ?? Infinity);
  // The text's own heading over a run's cell is the image's heading over the run: glued right before the run in the same
  // cell, or, failing that, the nearest text cell above it at the same left edge that prints no figure (TE P398 C33: an
  // image that leaves out a second table's heading row must not hand that table's runs to the first table's headings).
  const underOwnHeading = (at: Spot, head: string, run: string) => {
    if (!head) return true;
    if (at.s.includes(head + run)) return true;
    for (let t = at.t - 1; t >= 0; t--) {
      const above = tCells[t].map((c, ci) => ({ s: squash(c), x: xOf(t, ci) })).find((c) => c.s && c.x !== undefined && Math.abs(c.x - at.x) < 0.5);
      if (above && !hasDigit(above.s)) return above.s === head;
    }
    return false;
  };
  const kept = new Map<number, boolean>();
  // A row is kept when, for every figure run that covers it, each column of its rows (labels, words and figures, joined in
  // the same row order) is exactly one text cell (Critic P398 E6: a status column swapped between two rows), and that cell
  // lies in the row's own table's text: from the table's start up to the next table's start (TE P398 C25: two tables whose
  // last columns share a left edge). Each column keeps one place across runs, and the places, like the heading cells', go
  // left to right as the image prints them.
  const rowKept = (k: number) => {
    if (kept.has(k)) return kept.get(k)!;
    const h = headingOf(k);
    const heads = h === null ? null : headsOf(h);
    const place = new Map<number, Spot>();
    let ok = !heads || iCells[h!].every((c, d) => !squash(c) || heads[d] !== undefined);
    for (let c = 0; c < iCells[k].length && ok; c++) {
      if (!hasDigit(iCells[k][c])) continue;
      const covering = matches.filter((m) => m.c === c && m.rows.includes(k));
      if (!covering.length) ok = false;
      for (const m of covering) {
        const own = runAt(squash(tCells[m.t][m.ci]));
        if (!own || own.t !== m.t || own.x !== m.x) { ok = false; break; }
        const labels = labelsOf(m), start = heads ? startOf(heads) : labels?.t;
        for (let d = 0; d < iCells[k].length && ok; d++) {
          if (!squash(iCells[k][d])) continue;
          const run = m.rows.map((r) => squash(iCells[r][d] ?? "")).join("");
          const at = d === c ? own : runAt(run);
          const tied = !!at && start !== undefined && within(at, start) && (h === null || underOwnHeading(at, squash(iCells[h][d] ?? ""), run));
          if (!at || !tied || (place.has(d) && Math.abs(place.get(d)!.x - at.x) >= 0.5)) ok = false; else place.set(d, at);
        }
      }
    }
    const rightward = (xs: number[]) => xs.every((x, n) => n === 0 || x > xs[n - 1] + 0.5);
    ok &&= rightward([...place.entries()].sort((p, q) => p[0] - q[0]).map(([, s]) => s.x)) && (!heads || rightward(heads.filter((s): s is Spot => !!s).map((s) => s.x)));
    kept.set(k, ok);
    return ok;
  };
  const sound = (m: Match) => m.rows.every((k) => !figureRow(k) || rowKept(k));
  const replaced = [...held].filter((t) => {
    const digitCells = tCells[t].map((c, ci) => (hasDigit(squash(c)) ? ci : -1)).filter((ci) => ci >= 0);
    return digitCells.length > 0 && digitCells.every((ci) => matches.some((m) => m.t === t && m.ci === ci && sound(m)));
  });
  if (!replaced.length) return null;
  const rows = new Set(matches.filter((m) => replaced.includes(m.t)).flatMap((m) => m.rows));
  for (const k of [...rows]) { const h = figureRow(k) ? headingOf(k) : null; if (h !== null) rows.add(h); }
  // A row the reader printed with spaces only is stored with its cells as checked, a TAB between them.
  const emitted = [...rows].sort((p, q) => p - q).map((k) => (spaced.has(k) ? iCells[k].join("\t") : iLines[k].trim()));
  const at = Math.min(...replaced);
  const rest = tLines.map((l, t) => (replaced.includes(t) ? tCells[t].filter((c) => squash(c) && !hasDigit(c)).join("\t") : l));
  const lines = [...rest.slice(0, at), ...emitted, ...rest.slice(at)];
  return { text: lines.join("\n"), confirmed: new Set(emitted.map((_, n) => at + n)), image: rows };
}

export type LineCheck = { agree: boolean; kind: DisagreeKind | null; why: string; text: string | null; log: string;
  /** How many of the page's figure lines are held back (shown as not checked). */
  held: number };
export function checkLines(textReading: string, imageReading: string, pageNumber?: number, geometry?: (number[] | undefined)[]): LineCheck {
  const first = checkLinesOnce(textReading, imageReading, pageNumber, undefined, geometry);
  if (first.agree || !geometry || !first.heldLines.size) return first;
  // Lines held back on a page whose text layer gives each table column as one run: confirmed column by column (columnRows).
  const zipped = columnRows(textReading, imageReading, geometry, first.heldLines);
  if (!zipped) return first;
  const second = checkLinesOnce(zipped.text, imageReading, pageNumber, zipped);
  return second.agree || second.held < first.held ? second : first;
}
function checkLinesOnce(textReading: string, imageReading: string, pageNumber?: number, pre?: { confirmed: Set<number>; image: Set<number> },
  geometry?: (number[] | undefined)[]): LineCheck & { heldLines: Set<number> } {
  const lines = textReading.split("\n"), skipText = pairingNothing(textReading, pageNumber), skipImage = pairingNothing(imageReading, pageNumber);
  const imageLinesAll = imageReading.split("\n");
  // A line is confirmed only under the same heading in both readings: the nearest label-only line above it that both
  // readings print. Headings only one reading prints are passed over (Critic R211-3).
  const headingsOf = (ls: string[]) => ls.map((l) => lineTokens(l)).map((t) => (t.length && !figureLine(t) ? t.join(" ") : null));
  const textHeads = headingsOf(lines), imageHeads = headingsOf(imageLinesAll);
  const shared = new Set(textHeads.filter((h) => h && imageHeads.includes(h)));
  const under = (heads: (string | null)[]) => { let h = ""; return heads.map((x) => (x && shared.has(x) ? (h = x) : h)); };
  const textUnder = under(textHeads), imageUnder = under(imageHeads);
  // Image lines already confirmed column by column, and any line the image prints again with the same words and figures
  // (a reader that gave the page twice), confirm nothing more.
  const used = [...(pre?.image ?? [])].map((i) => lineTokens(imageLinesAll[i]));
  const pool = imageLinesAll.map((l, i) => ({ t: skipImage.has(i) ? [] : lineTokens(l), h: imageUnder[i], l }))
    .filter((o) => figureLine(o.t) && !used.some((u) => sameLine(u, o.t)));
  const imageLines = pool.length;
  const unconfirmed: number[] = [];
  // A label the text layer wraps or splits onto a line of its own, words only, right above or below the row ("Comprehensive
  // Critical\t300,000.00 ..." over "Illness Benefit"; ": Singapore Dollar" over "Instalment Premium\t: 470.85\tCurrency"),
  // while the image reading prints the row on one line. The row is confirmed when the image line is the row's own words
  // and figures, in the same order, with that line's words in one run beside a word of the row, never between two of its
  // figures. Each such line lends its words once. Every figure must still match in order, so nothing is paired differently
  // from how the image reads it (re-read 1 Nov: a schedule's sum and premium were withheld, so its cover had no sum).
  const filledText = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  const lent = new Set<number>();
  // A confirmed wrapped row is handed on whole: its line rebuilt with the lent words inside it, in the order the image
  // prints them, and the words-only line emptied (the line count kept), so a figure never travels with part of its
  // label ("Death 500,000" with "(accidental causes only)" on the next line; Critic H1, TE B1 on #289).
  const rebuilt = new Map<number, string>();
  const rebuild = (line: string, words: string, joined: Token[], image: string) => {
    for (let p = 0; p <= line.length; p++) {
      if (p > 0 && p < line.length && !/\s/.test(line[p])) continue;
      const head = line.slice(0, p).trimEnd(), tail = line.slice(p);
      const candidate = !head ? `${words} ${tail.trimStart()}` : `${head} ${words}${tail}`;
      if (sameLine(lineTokens(candidate), joined)) return candidate;
    }
    return image;
  };
  const isWord = (t: Token | undefined) => typeof t === "string" && !isDate(t);
  const wordsOnly = (j: number) => { if (j < 0 || skipText.has(j) || lent.has(j) || joinedAway.has(j)) return null; const t = lineTokens(lines[j]); return t.length && t.every(isWord) ? t : null; };
  const wrapped = (i: number, tokens: Token[]): { at: number; j: number; joined: Token[] } | null => {
    const k = filledText.indexOf(i);
    for (const j of [filledText[k + 1] ?? -1, filledText[k - 1] ?? -1]) {
      const words = wordsOnly(j);
      if (!words) continue;
      for (let pos = 0; pos <= tokens.length; pos++) {
        if (!isWord(tokens[pos - 1]) && !isWord(tokens[pos])) continue;
        const joined = [...tokens.slice(0, pos), ...words, ...tokens.slice(pos)];
        const at = pool.findIndex((o) => sameLine(joined, o.t) && o.h === textUnder[i]);
        if (at >= 0) return { at, j, joined };
      }
    }
    return null;
  };
  // Rows of figures only, right under their table's column header ("Coverage amount (S$)\tMonthly premium (S$)\t..." over
  // "50,000\t11.40\t100,000\t22.80"): a premium-rate table has no label in its rows, the header says what each column is.
  // Such a run of rows is confirmed when the image reading prints the same rows, line for line, with the same figures in
  // the same order and no label beside them. The run must start right under a words-only line with at least two cells,
  // and no row may have more cells than it: values that a scrambled page printed apart from their labels sit under no
  // such header (scrambleSigns' header rule). Before, every such row was held back, so a rate table both readings print
  // identically made the document "read in part" (live, 10 Nov: 29 figures alike in both readings).
  const tableRows = new Set<number>();
  {
    const cellsOf = (l: string) => l.split("\t").filter((c) => c.trim()).length;
    const bare = (t: Token[]) => figureLine(t) && !labelOf(t);
    const filledImage = imageLinesAll.map((l, j) => (l.trim() ? j : -1)).filter((j) => j >= 0);
    for (let k = 0; k < filledText.length; k++) {
      const h = filledText[k], head = lineTokens(lines[h]), width = cellsOf(lines[h]);
      if (skipText.has(h) || width < 2 || !head.length || figureLine(head)) continue;
      // Every row fills every column of the header; only the run's last row (never its first) may be shorter (a table's half-filled last
      // row). A shorter row elsewhere cannot say which column it skipped (Critic #432 B2).
      const run: number[] = [];
      for (let m = k + 1; m < filledText.length; m++) {
        const i = filledText[m], t = lineTokens(lines[i]), c = cellsOf(lines[i]);
        if (skipText.has(i) || !bare(t) || c < 2 || c > width || (!run.length && c < width)) break;
        run.push(i);
        if (c < width) break;
      }
      if (!run.length) continue;
      // The image must print the same header right above the same rows, so both readings say the same thing about each
      // column (Critic #432 C1/C2: the same rows under "Premium  Sum assured", or under another table's header, are not
      // the same table). A two-line header the image prints as one line is accepted cell by cell ("Coverage" over
      // "amount (S$)" is "Coverage amount (S$)").
      const prev = filledText[k - 1];
      const merged = prev !== undefined && !skipText.has(prev) && cellsOf(lines[prev]) === width && lineTokens(lines[prev]).length && !figureLine(lineTokens(lines[prev]))
        ? lineTokens(lines[prev].split("\t").filter((c) => c.trim()).map((c, x) => `${c} ${lines[h].split("\t").filter((d) => d.trim())[x] ?? ""}`).join("\t")) : null;
      const headerAt = (s0: number) => {
        const j = filledImage[s0 - 1], t = j === undefined ? [] : lineTokens(imageLinesAll[j]);
        return t.length > 0 && (sameLine(t, head) || (merged !== null && sameLine(t, merged)));
      };
      const rowsAt = (s0: number) => headerAt(s0) && run.every((i, r) => {
        const j = filledImage[s0 + r], t = j === undefined || skipImage.has(j) ? [] : lineTokens(imageLinesAll[j]);
        return bare(t) && sameLine(lineTokens(lines[i]), t);
      });
      const starts = filledImage.map((_, s0) => s0).filter((s0) => rowsAt(s0));
      if (!starts.length) continue;
      // Each image line confirms one text line: take the run's image lines out of the pool.
      const picked = run.map((_, r) => imageLinesAll[filledImage[starts[0] + r]]);
      const taken: number[] = [];
      for (const l of picked) taken.push(pool.findIndex((o, x) => o.l === l && !taken.includes(x)));
      if (taken.some((x) => x < 0)) continue;
      for (const x of [...taken].sort((p1, p2) => p2 - p1)) pool.splice(x, 1);
      run.forEach((i) => tableRows.add(i));
      k += run.length;
    }
  }
  // A row whose cells wrap onto two or more lines in the text layer, figures on more than one of them, while the image
  // reading prints the row on one line: "Early-stage critical illness\t25% of the Sum Covered, up to a maximum of" over
  // "RM 50,000, once per lifetime", or a label and its amount both wrapping ("Angioplasty and other invasive treatment
  // for\t10% of the Sum Covered, up to a maximum of" over "coronary artery\tRM 25,000"), or a sentence that runs onto the
  // next line mid-date ("... dated 18 February" over "2025)"). Any table, any market: a wrapped cell is how every
  // schedule prints a long benefit. Before, each part was compared alone, matched nothing, and every figure on the page
  // was held back although both readings print the same figures (TE-ACC-20261113 H2-A: an RM 50,000 early-stage benefit
  // hidden).
  // The lines are joined back into one row in the only two ways the page itself supports, and the row is confirmed when
  // the image prints one line with exactly its words and figures in the same order, under the same heading:
  // - column by column, where the page geometry says which column each cell stands in (each column's parts in line order,
  //   the columns left to right), so a label and its amount that both wrap are read as the row the page prints;
  // - in reading order, where every line but one is a single cell (a value or a sentence running on).
  // Nothing is paired differently from how the image reads it: every figure must match in order, a figure the image prints
  // in another row or not at all matches nothing, and the joined lines stay held back as before. A line that matches an
  // image line on its own is never joined to another, so two rows the image prints apart are never merged, and a join
  // that could be made two ways at the same size is no evidence. The joined row is stored on its first line, the other
  // lines emptied (the line count kept), as a wrapped label is.
  const joinedAway = new Set<number>();
  // Every line of a joined row, by each of its lines: a row held back later takes all of its lines with it.
  const groupOf = new Map<number, number[]>();
  const sharedHeading = (j: number) => { const h = textHeads[j]; return !!h && shared.has(h); };
  const alone = (j: number) => { const t = lineTokens(lines[j]); return figureLine(t) && pool.some((o) => sameLine(t, o.t) && o.h === textUnder[j]); };
  const free = (j: number | undefined): j is number => j !== undefined && !skipText.has(j) && !lent.has(j) && !joinedAway.has(j) && !rebuilt.has(j)
    && !tableRows.has(j) && !pre?.confirmed.has(j) && !sharedHeading(j);
  const byColumn = (group: number[]): string | null => {
    if (!geometry) return null;
    const rows = group.map((j) => { const cs = lines[j].split("\t"), xs = geometry[j]; return xs && xs.length === cs.length ? cs.map((c, n) => ({ c: c.trim(), x: xs[n] })) : null; });
    if (rows.some((r) => !r)) return null;
    // The columns are where the widest line's cells start; every other cell goes to the nearest, left to right. Where every
    // line is one cell (a label centred between its value's lines), the columns are the distinct places the lines start.
    const widest = rows.reduce((w, r) => (r!.length > w!.length ? r : w))!;
    const anchors = widest.length > 1 ? widest.map((c) => c.x)
      : rows.map((r) => r![0].x).sort((p, q) => p - q).filter((x, n, xs) => n === 0 || x > xs[n - 1] + 1);
    if (anchors.length < 2) return null;
    const columns: string[][] = anchors.map(() => []);
    for (const r of rows) {
      let last = -1;
      for (const { c, x } of r!) {
        if (!c) continue;
        const col = anchors.reduce((best, a, n) => (Math.abs(a - x) < Math.abs(anchors[best] - x) ? n : best), 0);
        if (col <= last) return null;
        columns[col].push(c); last = col;
      }
    }
    return columns.map((parts) => parts.join(" ")).join("\t").replace(/\t+$/, "");
  };
  // No geometry for these lines, but every line keeps its TAB slots, blank ones too ("Dental\t80%\tup to", "\t\tAUD 500 a year"): the slots
  // are the columns.
  const bySlot = (group: number[]): string | null => {
    // A line's slots always start at the first column; blank slots at its end are not printed ("\t250" under three columns).
    const raw = group.map((j) => lines[j].split("\t").map((c) => c.trim()));
    const width = Math.max(...raw.map((r) => r.length));
    if (width < 2) return null;
    const slots = raw.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
    return slots[0].map((_, n) => slots.map((r) => r[n]).filter(Boolean).join(" ")).join("\t").replace(/\t+$/, "");
  };
  const inOrder = (group: number[]) => (group.filter((j) => lines[j].includes("\t")).length <= 1 ? group.map((j) => lines[j].trim()).join(" ") : null);
  // A line below that prints a figure joins the row only when it reads as a wrapped part, never as a row of its own
  // (Critic #446 F3, R1: two complete rows an image reader ran together are never stored as one):
  // - where the page geometry puts its first cell in a value column (right of the row's label column), it is a part of
  //   that column ("RM 50,000, once per lifetime", "Maximum S$1,500 a year");
  // - otherwise it must start lower case in a cased script, with a figure, or with a currency ("coronary artery\tRM
  //   25,000", "2025)", "$1,000"). A row marker ("(a)", "1.", "ii)"), a capital, or a letter of a script with no case
  //   ("身故", "เสียชีวิต") starts a row: that line stays held, as before.
  // Words-only lines below are wrapped label parts and always join.
  const firstX = (j: number) => { const xs = geometry?.[j]; return xs && xs.length === lines[j].split("\t").length ? xs[0] : undefined; };
  const partStart = (l: string) => {
    const t = l.trim();
    if (/^\(?(?:\d{1,3}|[a-z]|[ivxlc]{1,5})[.)]\s/i.test(t)) return false;
    const code = t.match(/^\p{L}+/u)?.[0];
    if (code && (ISO_CURRENCIES.has(code) || LOCAL_CURRENCY_FORMS.has(code))) return true;
    return /^(?:\d|\p{Ll})/u.test(t) || t.replace(CURRENCY_MARK, "") !== t && /^\S{0,3}\p{Sc}/u.test(t);
  };
  // `left` is where the row's lines so far start furthest left. A line that starts further left still is the row's label
  // cell, when no line of the row has one yet (a label centred beside its value's second line): it joins, once.
  // A line with a label cell of its own under a line that ends on a figure is a row of its own whatever its first letter
  // ("Death\tRM 200,000" over "e-hailing accident\tRM 10,000"): a wrapped label continues a row whose value wraps too.
  const endsOnFigure = (j: number) => { const t = lineTokens(lines[j]).at(-1); return t !== undefined && (typeof t === "number" || isDate(t)); };
  const ownRow = (j: number, left: number | undefined, prev: number) => {
    if (!figureLine(lineTokens(lines[j]))) return false;
    const xj0 = firstX(j);
    const labelCell = left !== undefined && xj0 !== undefined ? Math.abs(xj0 - left) <= 1 : !!lines[j].split("\t")[0].trim() && lines[j].includes("\t");
    if (labelCell && endsOnFigure(prev)) return true;
    const xj = firstX(j);
    if (left !== undefined && xj !== undefined && (xj > left + 1 || xj < left - 1)) return false;
    // A blank first slot: the line starts in a value column.
    if (/^[ \t]*\t/.test(lines[j]) && !lines[j].split("\t")[0].trim()) return false;
    return !partStart(lines[j]);
  };
  // A word hyphenated across the wrap ("peri-" over "od") is tried whole and with its hyphen, as well as with a space.
  const variants = (text: string) => [text, text.replace(/(\p{L})- (?=\p{Ll})/gu, "$1"), text.replace(/(\p{L})- (?=\p{Ll})/gu, "$1-")];
  const joinedRow = (i: number): { group: number[]; text: string; at: number } | null => {
    const k = filledText.indexOf(i);
    const above: number[] = [];
    for (let u = k - 1; u >= 0 && above.length < 3; u--) {
      const j = filledText[u], t = lineTokens(lines[j]);
      if (!free(j) || !t.length || !t.every(isWord) || lines[j].includes("\t")) break;
      above.unshift(j);
    }
    const below: number[] = [];
    const xsSoFar = [...above, i].map(firstX);
    let left = xsSoFar.every((x) => x !== undefined) ? Math.min(...(xsSoFar as number[])) : undefined;
    for (let u = k + 1; u < filledText.length && below.length < 5; u++) {
      const j = filledText[u];
      if (!free(j) || alone(j) || ownRow(j, left, below.at(-1) ?? i)) break;
      below.push(j);
      const xj = firstX(j);
      left = left === undefined || xj === undefined ? undefined : Math.min(left, xj);
    }
    for (let size = 2; size <= above.length + 1 + below.length; size++) {
      let found: { group: number[]; text: string; at: number } | null = null, ways = 0;
      for (let up = Math.min(above.length, size - 1); up >= 0; up--) {
        const down = size - 1 - up;
        if (down > below.length) continue;
        const group = [...above.slice(above.length - up), i, ...below.slice(0, down)];
        // One group is one way, however many of its spellings match.
        for (const text of new Set([byColumn(group) ?? bySlot(group), inOrder(group)].filter((x): x is string => x !== null).flatMap(variants))) {
          const at = pool.findIndex((o) => sameLine(lineTokens(text), o.t) && o.h === textUnder[i]);
          if (at >= 0) { ways++; found ??= { group, text, at }; break; }
        }
      }
      if (found) return ways === 1 ? found : null;
    }
    return null;
  };
  let figureLines = 0, noLabel = -1, why = "";
  lines.forEach((line, i) => {
    if (skipText.has(i)) return;
    const tokens = lineTokens(line);
    if (!figureLine(tokens)) return;
    figureLines++;
    if (pre?.confirmed.has(i) || tableRows.has(i) || joinedAway.has(i)) return;
    const at = labelOf(tokens) ? pool.findIndex((o) => sameLine(tokens, o.t) && o.h === textUnder[i]) : -1;
    if (at >= 0) { pool.splice(at, 1); return; }
    const wrap = labelOf(tokens) ? wrapped(i, tokens) : null;
    if (wrap) {
      rebuilt.set(i, rebuild(line, lines[wrap.j].trim().replace(/\s+/g, " "), wrap.joined, pool[wrap.at].l));
      pool.splice(wrap.at, 1); lent.add(wrap.j); return;
    }
    const joined = joinedRow(i);
    if (joined) {
      const [head, ...rest] = joined.group;
      rebuilt.set(head, joined.text);
      for (const j of rest) joinedAway.add(j);
      for (const j of joined.group) groupOf.set(j, joined.group);
      if (head !== i) joinedAway.add(i);
      pool.splice(joined.at, 1); return;
    }
    unconfirmed.push(i);
    if (!labelOf(tokens) && noLabel < 0) noLabel = i;
    why ||= labelOf(tokens) ? `the image reading does not print ${figuresOf(tokens).join(", ")} beside "${labelOf(tokens)}" in that order` : `the text reading prints ${figuresOf(tokens).join(", ")} with no label beside it`;
  });
  if (!why && pool.length) why = `the text reading does not print ${figuresOf(pool[0].t).join(", ")} beside "${labelOf(pool[0].t)}" in that order`;
  const a = figuresIn(textReading).sort((x, y) => x - y), b = figuresIn(imageReading).sort((x, y) => x - y);
  let kind: DisagreeKind | null = !b.length ? "image prints no figures" : !unconfirmed.length && !pool.length ? null
    : !sameFigures(a, b) ? "figures differ" : noLabel >= 0 ? "figure line with no label" : "pairing differs";
  // A masked line takes its row and table with it (Critic R211-1, R211-2): a continuation ("or up to S$50,000, whichever
  // is lesser") read without the row's own figure would stand as the row's whole limit, and a masked row that starts a
  // run of tab-cell rows is their column header, without which no figure under it can be tied to its plan or age.
  // A continuation starts lower-case or with a connective or cap word (the same words lib/benefit-table/check.ts joins).
  const continues = (l: string) => /^[ \t,;:(]*[a-z]/.test(l) || /^[ \t,;:(]*(?:or|and|up\s+to|subject|whichever|max(?:imum)?|min(?:imum)?|limit(?:ed)?|capped|not\s+(?:to\s+)?exceed(?:ing)?)\b/i.test(l);
  const cells = (l: string) => l.split("\t").filter((c) => c.trim()).length;
  const isFig = (i: number) => !skipText.has(i) && figureLine(lineTokens(lines[i]));
  const spread = new Set(unconfirmed);
  for (const i of unconfirmed) {
    for (let j = i + 1; j < lines.length && continues(lines[j]); j++) if (isFig(j)) spread.add(j);
    for (let j = i; j > 0 && continues(lines[j]); j--) if (isFig(j - 1)) spread.add(j - 1);
    if (cells(lines[i]) >= 3) for (let j = i + 1; j < lines.length && cells(lines[j]) === cells(lines[i]); j++) if (isFig(j)) spread.add(j);
  }
  // A lone date or a lone number under its label ("Expiry date" over "30/09/2027") pairs nothing, so it is checked as the
  // figures of all such lines, in printed order: unless the image reading prints the same ones in the same order on its own
  // lines that pair nothing, none of them is used. That covers a value the image prints with another figure, beside its
  // label, on its own line, in another order, or not at all (TE P139-1, A26-A31, N8).
  // The page's own number pairs nothing, but a lone number equal to it may be a value whose label is above it
  // ("Hospital cash per day (max 30 days)" over "3" on page 3, TE A28, A30, A36). Such a value, under a line that ends in
  // words, is kept only when the image reading prints the same line over the same number. Otherwise the page's own number
  // is left out of the comparison when it is the first or last line, or the other reading prints it alone too: image
  // readers often drop a footer, or print it elsewhere (Critic R215-1, R189-1). Mid-page, with no lone page number in the
  // other reading, it is compared like any lone value (TE A38).
  const above = (ls: string[], i: number) => ls.slice(0, i).reverse().find((l) => l.trim())?.trim() ?? "";
  const pageNo = (l: string) => /page|of/i.test(l) || (pageNumber != null && Number(l.trim()) === pageNumber);
  const valueUnder = (ls: string[], i: number) => {
    if (pageNumber == null || Number(ls[i].trim()) !== pageNumber) return false;
    const last = lineTokens(above(ls, i)).at(-1);
    return typeof last === "string" && !isDate(last);
  };
  const edge = (ls: string[], i: number) => { const filled = ls.map((l, j) => (l.trim() ? j : -1)).filter((j) => j >= 0); return i === filled[0] || i === filled.at(-1); };
  const hasLonePage = (ls: string[], skip: Set<number>) => [...skip].some((i) => pageNo(ls[i]));
  // At the page's edge, only under nothing or under a row that ends in an amount ("Premium 181.44"): under "Hospital cash
  // per day, up to 30" the number may be the row's own value (TE A40).
  const rowDone = (ls: string[], i: number) => { const a = above(ls, i); return !a || /(?:\d{1,3}(?:,\d{3})+|\d\.\d{2})\s*%?\s*$/.test(a); };
  const left = (ls: string[], i: number, otherHasLone: boolean) => pageNo(ls[i]) && (valueUnder(ls, i) || /page|of/i.test(ls[i]) || (edge(ls, i) && rowDone(ls, i)) || otherHasLone);
  const imageHasLone = hasLonePage(imageLinesAll, skipImage), textHasLone = hasLonePage(lines, skipText);
  const loneFigures = (ls: string[], skip: Set<number>, otherHasLone: boolean) => ls.flatMap((l, i) => (skip.has(i) && !left(ls, i, otherHasLone) ? lineTokens(l).filter((t) => typeof t !== "string" || isDate(t)) : []));
  skipText.forEach((i) => {
    if (!valueUnder(lines, i)) return;
    const label = lineTokens(above(lines, i)), value = lineTokens(lines[i]);
    if (!imageLinesAll.some((l, j) => sameLine(lineTokens(l), value) && sameLine(lineTokens(above(imageLinesAll, j)), label))) spread.add(i);
  });
  const loneText = loneFigures(lines, skipText, imageHasLone), loneImage = loneFigures(imageLinesAll, skipImage, textHasLone);
  if (!sameLine(loneText, loneImage)) skipText.forEach((i) => { if (figureLine(lineTokens(lines[i]))) spread.add(i); });
  if (kind === null && spread.size) {
    kind = !sameFigures(a, b) ? "figures differ" : "pairing differs";
    why = "the lines that print a date or a number alone do not print the same ones in the same order";
  }
  // A held line that is part of a joined row holds the whole row: the row is stored on its first line, so holding only
  // the emptied part would leave the row shown beside a held continuation, or a continuation shown beside its held row
  // (Critic #446 F1, F2; the same rule as R211-1).
  for (const i of [...spread]) for (const j of groupOf.get(i) ?? []) spread.add(j);
  const confirmed = figureLines - [...spread].filter((i) => !skipText.has(i) && isFig(i)).length;
  // A joined row's words-only first line is held with its row, but is not a figure line of its own.
  const heldCount = [...spread].filter((i) => skipText.has(i) || isFig(i)).length;
  const seenText = seenFigures(textReading), seenImage = seenFigures(imageReading);
  const log = `figure lines ${figureLines} in text, ${imageLines} in image, ${confirmed} confirmed; figures ${seenText.length} in text, ${seenImage.length} in image; `
    + `only in text ${described(only(seenText, seenImage))}; only in image ${described(only(seenImage, seenText))}`;
  if (!b.length) return { agree: false, kind, why: "the image reading prints no figures", text: null, log, held: heldCount, heldLines: spread };
  const handed = lines.map((l, i) => rebuilt.get(i) ?? (lent.has(i) || joinedAway.has(i) ? "" : l));
  const text = !spread.size ? handed.join("\n") : confirmed ? handed.map((l, i) => (spread.has(i) ? notChecked(l) : l)).join("\n") : null;
  return { agree: kind === null, kind, why, text, log, held: heldCount, heldLines: spread };
}
export const uncheckedText = (text: string) => text.startsWith(UNCHECKED_PAGE) ? text
  : [UNCHECKED_PAGE, ...text.split("\n").filter((l) => l.trim() && !/\d/.test(l.replace(LABELLED, " ")))].join("\n");

type CheckedPage = { pageNumber: number; text: string; extractionMethod?: string; unreadable?: boolean; unchecked?: boolean; uncheckedWhy?: string; partChecked?: boolean; checkLog?: string;
  /** The one currency the page image prints when its text layer prints none (lib/documents/image-currency). */
  imageCurrency?: string;
  /** The page's lines as its geometry gave them: where each cell starts (lib/documents/layout.ts). */
  lines?: { text: string; cells: string[]; xs?: number[] }[] };
/** Where each cell of each text line starts on the page, when the stored text is still exactly the geometry's lines. */
const geometryOf = (p: CheckedPage) => (p.lines && p.lines.map((l) => l.text).join("\n") === p.text
  ? p.lines.map((l) => (l.xs && l.xs.length === l.text.split("\t").length ? l.xs : undefined)) : undefined);
/** The pages to read again from their image at upload: text pages whose table text shows a scramble sign. */
export const suspectPages = (pages: CheckedPage[]) => pages.filter((p) => p.extractionMethod !== "ocr" && !p.unreadable && !p.unchecked && !p.partChecked && looksScrambled(p.text)).map((p) => p.pageNumber);
/** Checks the given pages against their image reading. A page is kept as it is (the document's own words) only when the
 * image reading confirms it; otherwise, and when the image could not be read, it becomes unchecked, its text replaced by
 * uncheckedText, and uncheckedWhy says why in fixed words, for the processing history. `readImage` returns null when the reading failed. */
export async function crossCheckPages<P extends CheckedPage>(pages: P[], numbers: number[], readImage: (numbers: number[]) => Promise<CheckedPage[] | null>): Promise<P[]> {
  if (!numbers.length) return pages;
  const second = await readImage(numbers).catch(() => null);
  return pages.map((p) => {
    if (!numbers.includes(p.pageNumber)) return p;
    const image = second?.find((s) => s.pageNumber === p.pageNumber);
    // The reason is a fixed phrase: nothing from the page (TE P115-1).
    const check = !second ? { agree: false as const, kind: "image reading failed", text: null, log: undefined }
      : !image || image.extractionMethod !== "ocr" ? { agree: false as const, kind: "image reading gave no text for this page", text: null, log: undefined }
      : image.unreadable ? { agree: false as const, kind: "image unreadable", text: null, log: undefined }
      : checkLines(p.text, image.text, p.pageNumber, geometryOf(p));
    // Agreed: kept as checked. A row confirmed through a wrapped label is stored rebuilt, its full label on the figure's
    // line, so every reader sees the row as the image prints it (re-read check 3 Nov: the rebuilt text was dropped here).
    // A page the image confirmed (in whole or in part) whose text layer prints no currency takes the one currency the image
    // prints, for its confirmed figures only (DC 11 Nov, option b; lib/documents/image-currency).
    const currency = check.text != null || check.agree ? singleImageCurrency(p.text, image!.text) : null;
    const withCurrency = <T extends P>(x: T): T => (currency ? { ...x, imageCurrency: currency } : x);
    if (check.agree) return withCurrency(check.text && check.text !== p.text ? { ...p, text: check.text, checkLog: check.log } : p);
    // Every figure line confirmed, and the image prints a line the text does not: nothing on the page is unconfirmed.
    if (check.text === p.text) return withCurrency({ ...p, checkLog: check.log });
    // Some lines confirmed: those are kept word for word, the rest keep their words and lose their figures (Critic plan step 2).
    if (check.text) return withCurrency({ ...p, text: check.text, partChecked: true, uncheckedWhy: check.kind ?? undefined, checkLog: check.log });
    return { ...p, text: uncheckedText(p.text), unchecked: true, uncheckedWhy: check.kind ?? undefined, checkLog: check.log };
  });
}

/** The note a document gets when some pages could not be checked, or some lines on them. */
const pageList = (n: number[]) => n.length === 1 ? `page ${n[0]}` : `pages ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
export function uncheckedPagesNote(pageNumbers: number[], partChecked: number[] = []): string | null {
  if (!pageNumbers.length && !partChecked.length) return null;
  const whole = pageNumbers.length ? `${pageList(pageNumbers).replace(/^p/, "P")} could not be checked: a second reading from the page image did not agree with ${pageNumbers.length === 1 ? "its" : "their"} text, so no amount on ${pageNumbers.length === 1 ? "it" : "them"} is used.` : null;
  const part = partChecked.length ? `Some amounts on ${pageList(partChecked)} could not be checked against the page image, so they are shown as not checked and not used; the rest of ${partChecked.length === 1 ? "that page" : "those pages"} agreed and is used.` : null;
  return ["Read in part.", whole, part].filter(Boolean).join(" ");
}
export const READ_IN_PART = /^Read in part\b/;
