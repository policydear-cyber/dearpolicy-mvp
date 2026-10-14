/**
 * V1.4: a certificate roster whose text layer stores ONE CELL PER LINE (a PDF text layer that emits each table cell on
 * its own line: masked ID, name, amount, "As of", date), reconstructed into the person rows it prints -- by the
 * record STRUCTURE the cells follow, never by proximity alone. Shared by the person-benefit view (the loop's benefits module)
 * and the save-time gate (lib/chat/answer-verification.ts), so retrieval and verification read the page the same way.
 *
 * Rules (pure; no database):
 *  - A block is the cells under one product heading, continued across a page break (page furniture such as "Page 2 of
 *    2" before the first cell of a page is skipped) and across the same heading printed again ("... (continued)").
 *  - Every cell line is classified: masked / national ID, a person's NAME, an AMOUNT, "As of", a DATE. Any other line
 *    inside a block stops it with a gap -- the structure is not what a roster prints.
 *  - Records are segmented by the kind of the block's first cell (each record begins with an ID, or with a name when
 *    the roster prints no IDs). A record must hold exactly one name and exactly one amount, and a date only after "As
 *    of"; otherwise it is a GAP, named specifically, and nothing of it is used (a missing ID merges two records into
 *    one with two names and two amounts -- not guessed apart).
 *  - Only blocks made wholly of single cells are read here; a roster printed one row per line is the table parser's.
 */
export type RosterCellKind = "id" | "name" | "money" | "as_of" | "date";
export type RosterCell = { kind: RosterCellKind; text: string; page: number; start: number; end: number };
export type RosterRecord = { heading: string; headingPage: number; page: number; cells: RosterCell[]; name: RosterCell; amount: RosterCell; asOf: string | null; memberId: string | null };
export type RosterGap = { page: number; heading: string; reason: string };

const MONEY_ONLY = /^(?:S\$|SG\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s?\d[\d,]*(?:\.\d+)?$/i;
const ID_CELL = /^(?:[A-Z]\*{2,}\d{2,4}[A-Z]|[STFGM]\d{7}[A-Z]|[A-Z]{1,2}\d{6,9})$/;
const AS_OF = /^as (?:of|at)$/i;
const DATE_CELL = /^(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4})$/;
const NAME_CELL = /^[A-Za-z][A-Za-z'’.\- ]*(?:,\s*[A-Za-z][A-Za-z'’.\- ]*)?$/;
const FURNITURE = /^(?:page\s+\d+\s+of\s+\d+|.*\bpage\s+\d+\s+of\s+\d+)$/i;

export function isCellRosterHeading(line: string): boolean {
  const l = line.trim();
  if (!l || l.length > 90 || /\S(?:\t+| {3,})\S/.test(l) || /[,.:;]$/.test(l) || l.includes(",") || MONEY_ONLY.test(l)) return false;
  if (/\(\s*(?:group\s+)?policy\s*no/i.test(l)) return !/\bpage\s+\d+\s+of\s+\d+/i.test(l);
  const bare = l.replace(/\([^)]*\)/g, " ").trim();
  return bare === bare.toUpperCase() && /[A-Z]{3,}\s+[A-Z]{3,}/.test(bare) && !/\d/.test(bare) && !/^(?:CERTIFICATE|DEAR|SCHEDULE OF)\b/.test(bare);
}
const headingKey = (h: string) => h.replace(/\((?:continued|cont['’]?d)\)|\b(?:continued|cont['’]?d)\b/gi, " ").replace(/\(\s*(?:group\s+)?policy\s*no\.?[^)]*\)/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
function kindOf(line: string): RosterCellKind | null {
  const t = line.trim();
  if (!t || /\S(?:\t+| {3,})\S/.test(t)) return null;
  if (MONEY_ONLY.test(t)) return "money";
  if (ID_CELL.test(t)) return "id";
  if (AS_OF.test(t)) return "as_of";
  if (DATE_CELL.test(t)) return "date";
  if (NAME_CELL.test(t) && !isCellRosterHeading(t) && t.split(/\s+/).length <= 7) return "name";
  return null;
}
const isoOf = (d: string): string | null => {
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(d);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = Date.parse(d + " UTC"); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/** The person rows a one-cell-per-line roster prints, and the specific gaps where its structure cannot be read. */
export function reconstructCellRoster(pages: { page: number; text: string }[], memberOf: (name: string) => string | null): { records: RosterRecord[]; gaps: RosterGap[] } {
  const records: RosterRecord[] = [], gaps: RosterGap[] = [];
  let heading: string | null = null, headingPage = 0, cells: RosterCell[] = [], stopped = false;
  const close = () => {
    if (heading && cells.length && !stopped) segment(heading, headingPage, cells, memberOf, records, gaps);
    cells = []; stopped = false;
  };
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    let at = 0, pageStart = true;
    for (const raw of p.text.split("\n")) {
      const start = at, line = raw.trim(); at += raw.length + 1;
      if (!line) continue;
      if (isCellRosterHeading(line) && !memberOf(line)) {
        // The same heading printed again (a continuation across a page break): the block goes on.
        if (heading && headingKey(line) === headingKey(heading)) { pageStart = false; continue; }
        close(); heading = line; headingPage = p.page; pageStart = false; continue;
      }
      if (!heading) continue;
      const kind = kindOf(line);
      if (!kind) {
        // Page furniture before the first cell of a page (a running header, "Page 2 of 2") is skipped; any other line
        // inside a block ends what can be read of it.
        if (pageStart && (FURNITURE.test(line) || /^[A-Z0-9 &().,'’/-]+$/.test(line))) continue;
        if (cells.length && !stopped) { gaps.push({ page: p.page, heading, reason: `a line that is not a roster cell (“${line.slice(0, 60)}”) is printed among the cells, so the rows after it cannot be read` }); segment(heading, headingPage, cells, memberOf, records, gaps); stopped = true; }
        continue;
      }
      if (stopped) continue;
      pageStart = false;
      const s = start + (raw.length - raw.trimStart().length);
      cells.push({ kind, text: line, page: p.page, start: s, end: s + line.length });
    }
  }
  close();
  return { records, gaps };
}

function segment(heading: string, headingPage: number, cells: RosterCell[], memberOf: (name: string) => string | null, records: RosterRecord[], gaps: RosterGap[]) {
  if (!cells.length) return;
  const startKind = cells[0].kind;
  if (startKind !== "id" && startKind !== "name") { gaps.push({ page: cells[0].page, heading, reason: `the cells under it begin with ${startKind === "money" ? "an amount" : "a date"}, not a person, so which person each amount belongs to cannot be read` }); return; }
  const groups: RosterCell[][] = [];
  for (const c of cells) { if (c.kind === startKind || !groups.length) groups.push([c]); else groups[groups.length - 1].push(c); }
  groups.forEach((g, i) => {
    const names = g.filter((c) => c.kind === "name"), money = g.filter((c) => c.kind === "money");
    const asOfAt = g.findIndex((c) => c.kind === "as_of"), dates = g.filter((c) => c.kind === "date");
    const where = `row ${i + 1} under “${heading.replace(/\s*\(.*$/, "")}”${names[0] ? ` (${names[0].text})` : ""}`;
    if (g.some((c) => c.page !== g[0].page)) return void gaps.push({ page: g[0].page, heading, reason: `row ${i + 1} under “${heading.replace(/\s*\(.*$/, "")}” is split across a page break` });
    if (names.length !== 1) return void gaps.push({ page: g[0].page, heading, reason: `${where} has ${names.length ? "more than one name" : "no name"}${names.length > 1 ? " -- a cell is missing between two rows" : ""}, so its amount is not assigned` });
    if (money.length !== 1) return void gaps.push({ page: g[0].page, heading, reason: `${where} has ${money.length ? `${money.length} amounts` : "no amount"}` });
    if (g.indexOf(money[0]) < g.indexOf(names[0])) return void gaps.push({ page: g[0].page, heading, reason: `${where} prints its amount before the name` });
    if (dates.length > 1 || (dates.length === 1 && (asOfAt < 0 || g.indexOf(dates[0]) < asOfAt))) return void gaps.push({ page: g[0].page, heading, reason: `${where} prints a date that is not its "As of" date` });
    records.push({ heading, headingPage, page: g[0].page, cells: g, name: names[0], amount: money[0], asOf: dates[0] ? isoOf(dates[0].text) : null, memberId: memberOf(names[0].text) });
  });
}
