/**
 * Rows of a printed figures table (a benefit or surrender-value illustration, a premium schedule) are shown as a table,
 * never as raw strings (DC, 16 Nov 2026: "show me the illustrated figures" answered with lines such as
 * `READYBUILDER 10 prints: “10/38 47,909 28,175 1,585 29,760 2,850 31,025”` was "unreadable").
 *
 * Only the server's own fallback is changed: a point with no words of its own that verify.ts shows as
 * `<document> prints: “<quoted row>”`. The cells are the quoted row's own words, split where the page splits them (a tab
 * or a wide gap), or, for a row of figures, at each figure. Rows quoted from the same page with the same number of cells
 * become one table, in the order the page prints them.
 *
 * Column headings are used only when the page prints them as one line above the rows with exactly one heading per column.
 * Any insurer's layout: when the headings cannot be matched to columns that way (headings over several lines, merged
 * header cells), none is made up: the table has no headings and the heading lines printed above the rows are shown with
 * it as printed, so nothing is labelled on a guess. A group heading line printed over the column headings is shown with the
 * table as printed too. Nothing here adds, works out or changes a figure.
 */
import type { AnswerStatement, PrintedTable } from "@/components/answer-cards";
import type { Household, HouseholdDocument } from "./library";

const PRINTS = /^(.+?) prints: “([\s\S]+)”$/;
const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** A cell that is a figure: a number with separators or decimals, a percentage, year/age ("10/38"), a dash or "N.A.". */
const FIGURE_CELL = /^(?:[A-Z]{0,3}\$?|[£€¥])?\(?-?\d[\d,]*(?:\.\d+)?\)?%?$|^\d{1,3}\/\d{1,3}$|^[-–—]$|^n\.?a\.?$|^nil$/i;

/** A line's cells: split at tabs or gaps of two spaces or more; a line spaced only by single spaces is split at its figures
 * (a leading label stays whole), and only when it has at least three figures. */
export function cellsOf(line: string): string[] | null {
  // A tab-separated line keeps its blank cells ("10<TAB>45<TAB>24,000<TAB><TAB>31,200"): a figure never moves into the
  // column of the one before it (TE1 #505 F1).
  if (line.includes("\t")) {
    const tabbed = line.replace(/^[ \t]*?(?=\S)/, "").replace(/ +$/, "").split("\t").map((c) => c.trim());
    return tabbed.length >= 3 && tabbed.some(Boolean) ? tabbed : null;
  }
  const wide = line.trim().split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
  if (wide.length >= 3) return wide;
  const words = line.trim().split(/\s+/);
  const first = words.findIndex((w) => FIGURE_CELL.test(w));
  if (first < 0 || words.slice(first).some((w) => !FIGURE_CELL.test(w))) return null;
  const cells = [...(first > 0 ? [words.slice(0, first).join(" ")] : []), ...words.slice(first)];
  return cells.length >= 3 ? cells : null;
}
const figures = (cells: string[]) => cells.filter((c) => FIGURE_CELL.test(c)).length;
/** A data row: three or more figures, and figures in most of its cells. */
const isDataRow = (cells: string[] | null): cells is string[] => !!cells && figures(cells) >= 3 && figures(cells) * 2 >= cells.length;

/** Whether a row of `n` cells fills its table: no data row printed in the same run of rows, and no heading line just above
 * them that splits into columns, is wider. A narrower row has a cell that cannot be placed (a blank printed as spaces). */
function fitsItsTable(lines: string[], at: number, n: number): boolean {
  let widest = n;
  for (const step of [-1, 1]) {
    for (let i = at + step; i >= 0 && i < lines.length; i += step) {
      if (!lines[i].trim()) continue;
      const c = cellsOf(lines[i]);
      if (isDataRow(c)) { widest = Math.max(widest, c.length); continue; }
      // The words line just above the rows: when it splits into columns (a tab or a wide gap), its column count counts.
      if (step < 0 && /\t|\S\s{2,}\S/.test(lines[i].trim())) {
        const heads = cellsOf(lines[i]) ?? lines[i].trim().split(/\s{2,}/);
        if (heads.length >= 3 && figures(heads) === 0) widest = Math.max(widest, heads.length);
      }
      break;
    }
  }
  return n === widest;
}

type Row = { st: AnswerStatement; doc: HouseholdDocument; page: number; lineAt: number; cells: string[] };

/** The quoted row's line on its page (its own spacing kept), or -1. */
function lineOf(lines: string[], quote: string): number {
  const q = flat(quote);
  const exact = lines.findIndex((l) => flat(l) === q);
  if (exact >= 0) return exact;
  return lines.findIndex((l) => flat(l).includes(q) && q.length >= 8);
}

/** Headings for `n` columns above line `at`: the nearest line of words (not a data row) with exactly n cells; otherwise
 * none, with the heading lines printed above the rows (up to four, nearest last), as printed. */
function headingsFor(lines: string[], at: number, n: number): { headers: string[] | null; printedAbove: string[] } {
  const above: string[] = [];
  for (let i = at - 1; i >= 0 && above.length < 4 && at - i <= 40; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = cellsOf(line) ?? line.split(/\t+|\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (isDataRow(cellsOf(line))) { if (above.length) break; continue; }
    if (cells.length === n && figures(cells) === 0 && !above.length) {
      // A heading line over the column headings (a group such as "Illustrated at 4.25% p.a.") is shown as printed with them.
      // A heading printed over two tab-separated lines, column by column ("Guaranteed" over "surrender value"), is one
      // heading per column: the two lines are joined in each column, so no column loses its first line (TE1 #505 F5).
      let j = i - 1;
      while (j >= 0 && !lines[j].trim()) j--;
      const upper = j >= 0 && lines[i].includes("\t") && lines[j].includes("\t") ? cellsOf(lines[j]) : null;
      const twoLine = !!upper && upper.length === n && figures(upper) === 0 && upper.some((c) => !c);
      const headers = twoLine ? cells.map((c, k) => [upper![k], c].filter(Boolean).join(" ")) : cells;
      const top = twoLine ? j : i;
      const over = lines.slice(Math.max(0, top - 3), top).map((l) => l.trim()).filter((l) => l && l.length <= 160 && !isDataRow(cellsOf(l))).slice(-1);
      return { headers, printedAbove: over.map((l) => l.replace(/\s+/g, " ")) };
    }
    if (line.length <= 160) above.unshift(line.replace(/\s+/g, " "));
  }
  return { headers: null, printedAbove: above };
}

/** Turns the server's `<document> prints: “row”` points for table rows into one table point per page. In place. */
export function tablesFromPrintedRows(statements: AnswerStatement[], household: Household, label: (d: HouseholdDocument) => string): AnswerStatement[] {
  const rows: Row[] = [];
  for (const st of statements) {
    if (st.amount || st.kind === "calculation" || !st.source || st.source.page == null || (st.conditions ?? []).length) continue;
    const m = PRINTS.exec(st.text.trim());
    if (!m) continue;
    const doc = household.documents.find((d) => label(d) === st.source!.policyName && m[1].trim() === label(d));
    const page = doc?.pages.find((p) => p.page === st.source!.page);
    if (!doc || !page) continue;
    const lines = page.text.split(/\r?\n/);
    const at = lineOf(lines, m[2]);
    // Only a row found on the page it is cited from.
    if (at < 0) continue;
    // Only a whole printed line: part of a row has no columns of its own to show (TE1 #505 F2).
    if (flat(lines[at]) !== flat(m[2])) continue;
    const cells = cellsOf(lines[at]);
    if (!isDataRow(cells)) continue;
    // A row narrower than the rows printed with it, or than the column headings just above, has a cell that cannot be
    // placed (a blank printed as spaces): it is not drawn as a grid, and stays as quoted (TE1 #505 F1).
    if (!fitsItsTable(lines, at, cells.length)) continue;
    rows.push({ st, doc, page: page.page, lineAt: at, cells });
  }
  if (!rows.length) return statements;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.doc.policyId}|${r.page}|${r.cells.length}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const replaced = new Map<AnswerStatement, AnswerStatement | null>();
  // Rows of one table only: two tables of the same width on one page (guaranteed and non-guaranteed) are split wherever a
  // line of words stands between two rows (Critic #505 L).
  const blocks: Row[][] = [];
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.lineAt - b.lineAt);
    const lines = sorted[0].doc.pages.find((p) => p.page === sorted[0].page)!.text.split(/\r?\n/);
    let block: Row[] = [];
    for (const r of sorted) {
      const prev = block[block.length - 1];
      if (prev && lines.slice(prev.lineAt + 1, r.lineAt).some((l) => l.trim() && !isDataRow(cellsOf(l)))) { blocks.push(block); block = []; }
      block.push(r);
    }
    blocks.push(block);
  }
  for (const sorted of blocks) {
    const first = sorted[0];
    const lines = first.doc.pages.find((p) => p.page === first.page)!.text.split(/\r?\n/);
    const firstLine = Math.min(...sorted.map((r) => r.lineAt).filter((n) => n >= 0));
    const { headers, printedAbove } = Number.isFinite(firstLine) ? headingsFor(lines, firstLine, first.cells.length) : { headers: null, printedAbove: [] };
    const table: PrintedTable = { headers, rows: sorted.map((r) => r.cells), printedAbove };
    const where = `${label(first.doc)}, page ${first.page}`;
    const text = `${sorted.length === 1 ? "This row is" : "These rows are"} printed in ${where}.`;
    const merged: AnswerStatement = { ...first.st, id: `${first.st.id}-table`, kind: "fact", text,
      // The quoted rows stay in the checked sentence, as before, for every check that reads the answer's text.
      fullText: sorted.map((r) => r.st.text).join(" "),
      source: { ...first.st.source!, citationIds: [...new Set(sorted.flatMap((r) => r.st.source?.citationIds ?? []))] }, table };
    sorted.forEach((r, i) => replaced.set(r.st, i === 0 ? merged : null));
  }
  return statements.flatMap((s) => replaced.has(s) ? (replaced.get(s) ? [replaced.get(s)!] : []) : [s]);
}

/** A leftover `<document> prints: “…”` point that is neither a printed row (tabled above, or kept as quoted when it
 * cannot be placed: TE1 #505 F1) nor a whole sentence: a fragment cut mid-sentence ("…will be the higher of:") or a
 * bare label ("As of 06/10/2022") says nothing a household can use on its own (live f954eb2, post-#539 check, ask 8).
 * Its card and source stay wherever another point cites them. Returns the points' texts taken out. In place. */
export function dropQuoteFragments(answer: { statements?: AnswerStatement[] }): string[] {
  const removed: string[] = [];
  if (!answer.statements) return removed;
  answer.statements = answer.statements.filter((st) => {
    if (st.amount || st.table || (st.conditions ?? []).length) return true;
    const m = PRINTS.exec(st.text.trim());
    if (!m) return true;
    const quote = m[2].trim();
    const row = quote.split(/\r?\n/).some((l) => isDataRow(cellsOf(l)));
    const sentence = /[.!?)”"]$/.test(quote) && quote.split(/\s+/).length >= 6;
    if (row || sentence) return true;
    removed.push(st.text);
    return false;
  });
  return removed;
}
