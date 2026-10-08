/**
 * Conversational RAG: tables read from stored page text at read time, and the one value a table prints for one
 * person's benefit.
 *
 * parseTables() rebuilds tables from policy_pages.text (cells split by tabs -- the stored layout -- or by runs of two
 * or more spaces): header rows, including a spanning heading above them ("Insured Adult" over "Limit | Co-pay"),
 * section headings, sub-rows ("of which physiotherapy"), a table continued on the next page under a repeated header,
 * and two-cell "label  amount" lists. Each column gets a kind (label / condition / amount / percent / count / unit /
 * notes) and who it applies to (person class / tier / plan / ward / version). Every cell keeps its character offsets.
 *
 * selectTableValue() resolves the SUBJECT'S COLUMN before it reads a value: the document's own list of insured
 * persons or an enrolment confirmation naming the person, else the tier recorded for them (policy_members.
 * benefit_tier), else their relation -- and only then the cell where the benefit's row meets that column. A value is
 * only ever a table cell: never "a number elsewhere on the page", never a condition or description column. When the
 * row, the column or the person's class cannot be told apart it says so (ambiguous, with options and one question)
 * or reports what is missing -- it never guesses.
 */
import { evidenceAt, type AppliesTo, type EvidenceRef } from "./evidence";
import { tokens } from "./search";
import { loadDocs, loadLinks, loadMembers, loadPages, type DocRow } from "./store";
import { relationOf, type RelationClass } from "./people";
import { personClause } from "@/lib/policies/member-tiers";

export type ColumnKind = "label" | "condition" | "amount" | "percent" | "count" | "unit" | "notes";
export type Cell = { text: string; start: number; end: number };
export type Column = { index: number; leaf: string; heading: string | null; header: string; kind: ColumnKind; appliesTo: AppliesTo | null; currency: string | null; pos: number };
export type Row = {
  page: number; line: string; lineStart: number; lineEnd: number; label: string; labelCell: Cell | null;
  /** cells by column index (null where the row prints nothing in that column). */
  cells: (Cell | null)[];
  section: string | null; parent: string | null; sub: boolean;
};
export type Table = {
  tableId: string; policyId: string; pageStart: number; pageEnd: number; headerPage: number | null; headerLine: string | null;
  columns: Column[]; rows: Row[]; headed: boolean; continued: boolean;
};

type Line = { page: number; text: string; start: number; end: number; cells: Cell[]; raw: (Cell | null)[]; tabbed: boolean; indent: number };

const MONEY = /(?:\b(?:SGD|USD|MYR|HKD|AUD|EUR|GBP)\s?|\b(?:S|SG|US|HK|A)\$\s?|\bRM\s?|[€£])\d[\d,]*(?:\.\d+)?/i;
const AMOUNTISH = /^(?:(?:SGD|USD|MYR|HKD|AUD|EUR|GBP|S\$|SG\$|US\$|HK\$|A\$|RM|€|£)\s?)?\d[\d,]*(?:\.\d+)?\s?(?:%|k|m)?(?:\s.*)?$/i;
const TEXT_VALUE = /^(?:as charged|not covered|n\.?a\.?|nil|none|-|–|—|included|covered|unlimited|full cost|not applicable)$/i;
const HEADER_WORD = /\b(?:benefits?|amounts?|limits?|cover(?:age)?|adults?|child(?:ren)?|employees?|spouses?|members?|plans?|wards?|stages?|conditions?|groups?|%|percent(?:age)?|before|after|names?|category|categories|items?|descriptions?|options?|tiers?|insured|class|payable|sum|days?|notes?|remarks?|basis|dependants?|parents?|self|co-?pay(?:ment)?|co-?insurance|deductible|maximum|max|sub-?limit|type|private|restructured|old|new|revised|current|previous|effective|relationship|units?|visits?|rate|premium)\b|^%$/i;
const CLASS_RES: [string, RegExp][] = [
  ["child", /\bchild(?:ren)?\b|\bdependant child\b|\bkids?\b/i], ["spouse", /\bspouses?\b|\bwife\b|\bhusband\b/i],
  ["employee", /\bemployees?\b|\bstaff\b|\bprincipal\b|\bmember\b(?! of)/i], ["parent", /\bparents?\b/i],
  ["adult", /\badults?\b/i], ["dependant", /\bdependants?\b/i], ["self", /\bself\b|\bpolicyholder\b|\blife assured\b/i],
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const isMoneyOrNumber = (t: string) => MONEY.test(t) || /^\d[\d,]*(?:\.\d+)?\s?%?$/.test(t.trim());

/** Splits one stored line into cells with offsets (tabs keep empty cells in place; otherwise 2+ spaces separate). */
export function splitCells(text: string, start: number): { cells: Cell[]; raw: (Cell | null)[]; tabbed: boolean } {
  if (text.includes("\t")) {
    const raw: (Cell | null)[] = [];
    let at = 0;
    for (const part of text.split("\t")) {
      const lead = part.length - part.trimStart().length, t = part.trim();
      raw.push(t ? { text: t, start: start + at + lead, end: start + at + lead + t.length } : null);
      at += part.length + 1;
    }
    return { cells: raw.filter((c): c is Cell => !!c), raw, tabbed: true };
  }
  const cells: Cell[] = [];
  for (const m of text.matchAll(/\S+(?: \S+)*/g)) cells.push({ text: m[0], start: start + m.index!, end: start + m.index! + m[0].length });
  return { cells, raw: cells, tabbed: false };
}

function linesOf(page: number, text: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const t of text.split("\n")) {
    const { cells, raw, tabbed } = splitCells(t, at);
    out.push({ page, text: t, start: at, end: at + t.length, cells, raw, tabbed, indent: t.length - t.trimStart().length });
    at += t.length + 1;
  }
  return out;
}

const valueCellCount = (l: Line) => l.cells.slice(1).filter((c) => isMoneyOrNumber(c.text) || AMOUNTISH.test(c.text) || TEXT_VALUE.test(c.text)).length;
function headerLike(l: Line): boolean {
  if (l.cells.length < 2) return false;
  if (l.cells.some((c) => isMoneyOrNumber(c.text) || /\d[\d,]*\.\d{2}\b/.test(c.text))) return false;
  if (l.cells.some((c) => c.text.length > 48)) return false;
  const words = l.cells.filter((c) => HEADER_WORD.test(c.text) || CLASS_RES.some(([, re]) => re.test(c.text))).length;
  return l.cells.length >= 3 ? words >= Math.ceil(l.cells.length / 2) : words === 2;
}
const isDataRow = (l: Line) => l.cells.length >= 2 && valueCellCount(l) >= 1;
const isPageChrome = (l: Line) => /\bpage \d+ of \d+\b|^\s*page \d+\s*$|\(continued(?: on next page)?\)|continued overleaf/i.test(l.text);

function kindOf(header: string, values: string[], index: number): ColumnKind {
  const h = header.toLowerCase().trim();
  const filled = values.filter((v) => v.trim());
  const share = (re: RegExp) => (filled.length ? filled.filter((v) => re.test(v)).length / filled.length : 0);
  if (/^(?:notes?|remarks?|comments?|footnotes?)$/.test(h)) return "notes";
  if (/^(?:unit|basis|per|frequency|period|payable per)$/.test(h)) return "unit";
  if (/%|percent|proportion|share of/.test(h) || (filled.length && share(/^\d+(?:\.\d+)?\s?%$/) >= 0.6)) return "percent";
  if (/\bcondition|illness|disease|definition|criteria|eligib|requirement|what is covered|covered events?|description|group\b/.test(h) && share(MONEY) < 0.5) return "condition";
  if (index === 0) return share(MONEY) >= 0.6 ? "amount" : "label";
  if (/\b(?:days?|visits?|weeks?|times|no\.? of|number of|sessions?)\b/.test(h) && !/\bper (?:day|visit)\b/.test(h) && share(MONEY) < 0.5) return "count";
  if (filled.length && share(MONEY) >= 0.5) return "amount";
  if (filled.length && share(/^\d+\s*(?:days?|visits?|weeks?|sessions?|times)\b/i) >= 0.6) return "count";
  if (filled.length && share(/^\d[\d,]*(?:\.\d+)?$/) >= 0.6) return /\b(?:days?|visits?)\b/.test(h) ? "count" : "amount";
  if (filled.length && share(/\d/) < 0.3 && share(TEXT_VALUE) < 0.5) return /\bnotes?\b|\bremarks?\b/.test(h) ? "notes" : "condition";
  return "amount";
}

/** Who a column applies to, from its heading and leaf ("Insured Child / Limit" -> person class child). */
export function appliesToOf(header: string): AppliesTo | null {
  const h = flat(header);
  if (!h) return null;
  if (/^(?:before|old|previous|original|current \(before\)|existing)\b/i.test(h) || /\b(?:before|previous|old)\b/i.test(h) && !/\bafter\b/i.test(h) && /\b(?:endorsement|alteration|change|amend)/i.test(h)) return { kind: "version", value: "before" };
  if (/^(?:after|new|revised|amended)\b/i.test(h) || /\b(?:after|revised|amended|new)\b/i.test(h) && /\b(?:endorsement|alteration|change|amend)/i.test(h)) return { kind: "version", value: "after" };
  for (const [cls, re] of CLASS_RES) if (re.test(h)) return { kind: "person_class", value: h, personClass: cls };
  if (/\bplan\s*[a-z0-9]{1,4}\b/i.test(h)) return { kind: "plan", value: h };
  if (/\bward\b|\bprivate hospital\b|\brestructured\b|\bclass [a-c]\d?\b/i.test(h)) return { kind: "ward", value: h };
  if (/\b(?:tier|option|grade|level|band)\s*[a-z0-9]/i.test(h)) return { kind: "tier", value: h };
  return null;
}
const currencyOfHeader = (h: string) => { const m = h.match(/\((S\$|SGD|US\$|USD|HK\$|RM|MYR|€|£)\)/i); return m ? normCurrency(m[1]) : null; };
export function normCurrency(sym: string): string {
  const s = sym.toUpperCase().replace(/\s/g, "");
  return ({ "S$": "SGD", "SG$": "SGD", "US$": "USD", "HK$": "HKD", "A$": "AUD", RM: "MYR", "€": "EUR", "£": "GBP" } as Record<string, string>)[s] ?? s;
}

/** Column positions of a header line relative to its own start. */
const relPos = (l: Line, c: Cell) => c.start - l.start;

function buildColumns(header: Line, spanning: Line | null, firstData: Line[]): Column[] {
  const raw: (Cell | null)[] = header.tabbed ? header.raw : header.cells;
  // An implicit label column: header cells start well to the right, data rows have one more cell.
  const dataCounts = firstData.map((l) => (header.tabbed ? l.raw.length : l.cells.length));
  const implicit = !header.tabbed && header.indent >= 6 && dataCounts.length > 0 && dataCounts.filter((n) => n === raw.length + 1).length >= Math.ceil(dataCounts.length / 2);
  const leaves: { text: string; pos: number }[] = [...(implicit ? [{ text: "", pos: 0 }] : []), ...raw.map((c, i) => ({ text: c?.text ?? "", pos: c ? relPos(header, c) : i }))];
  // Spanning heading: each spanning cell covers the leaves from its position up to the next spanning cell.
  const headings: (string | null)[] = leaves.map(() => null);
  if (spanning) {
    if (spanning.tabbed && header.tabbed) {
      let cur: string | null = null;
      spanning.raw.forEach((c, i) => { if (c) cur = c.text; if (i < headings.length && cur) headings[i + (implicit ? 1 : 0)] = cur; });
      for (let i = spanning.raw.length; i < headings.length; i++) headings[i] = cur;
    } else {
      const spans = spanning.cells.map((c) => ({ text: c.text, pos: relPos(spanning, c) }));
      leaves.forEach((leaf, i) => {
        if (i === 0 && leaf.text === "" ) return;
        const s = [...spans].reverse().find((sp) => leaf.pos >= sp.pos - 3);
        headings[i] = s ? s.text : null;
      });
    }
  }
  return leaves.map((leaf, i) => {
    const heading = headings[i] && headings[i] !== leaf.text ? headings[i] : null;
    const header = heading ? `${heading} / ${leaf.text}` : leaf.text;
    return { index: i, leaf: leaf.text, heading, header, kind: "amount" as ColumnKind, appliesTo: appliesToOf(header), currency: currencyOfHeader(header), pos: leaf.pos };
  });
}

/** Places a data line's cells into the table's columns. */
function placeCells(l: Line, cols: Column[], tabbed: boolean, implicit: boolean): (Cell | null)[] {
  const out: (Cell | null)[] = cols.map(() => null);
  if (tabbed && l.tabbed) { l.raw.forEach((c, i) => { const k = i; if (k < out.length) out[k] = c; }); return out; }
  if (l.cells.length === cols.length) { l.cells.forEach((c, i) => (out[i] = c)); return out; }
  // By position: the column whose span the cell overlaps most (right-aligned figures start left of their heading).
  const spans = cols.map((c, i) => ({ from: i === 0 ? 0 : c.pos - 2, to: i + 1 < cols.length ? cols[i + 1].pos - 2 : Infinity }));
  l.cells.forEach((c, idx) => {
    const a = relPos(l, c), b = a + c.text.length;
    let best = -1, bestOv = -1;
    spans.forEach((s, i) => { const ov = Math.min(b, s.to) - Math.max(a, s.from); if (ov > bestOv) { bestOv = ov; best = i; } });
    if (idx === 0 && !implicit && a <= 2) best = 0;
    if (best >= 0 && !out[best]) out[best] = c; else if (best >= 0) { const free = out.findIndex((x, i) => !x && i > best); if (free >= 0) out[free] = c; }
  });
  return out;
}

/** Every table on the given pages of one document (pages in order; a table may continue onto the next page, under a
 * repeated header or straight on in the same columns near the top of the next page). */
export function parseTables(policyId: string, pages: { page: number; text: string }[]): Table[] {
  type Open = { t: Table; header: Line | null; tabbed: boolean; implicit: boolean; section: string | null; suspended: boolean };
  const tables: Table[] = [];
  let open: Open | null = null;
  let n = 0;
  const finish = () => { if (open && open.t.rows.length) { finalizeKinds(open.t); tables.push(open.t); } open = null; };
  const start = (l: Line, header: Line | null, columns: Column[], implicit: boolean) => {
    open = { t: { tableId: `${policyId}:p${l.page}:t${++n}`, policyId, pageStart: l.page, pageEnd: l.page, headerPage: header ? l.page : null, headerLine: header ? header.text : null, columns, rows: [], headed: !!header, continued: false }, header, tabbed: l.tabbed, implicit, section: null, suspended: false };
  };
  for (const pg of [...pages].sort((a, b) => a.page - b.page)) {
    const lines = linesOf(pg.page, pg.text);
    let intoPage = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const cur = open as Open | null;
      const nextNonBlank = lines.slice(i + 1).filter((x) => x.text.trim());
      if (!l.text.trim()) {
        if (cur && !cur.suspended) {
          const next = nextNonBlank[0];
          const fits = next && (isDataRow(next) || (cur.header && flat(next.text) === flat(cur.header.text)));
          if (!fits) { if (!next || isPageChrome(next)) cur.suspended = true; else finish(); }
        }
        continue;
      }
      intoPage++;
      if (cur && isPageChrome(l)) { cur.suspended = true; continue; }
      if (cur && cur.header && flat(l.text) === flat(cur.header.text)) { if (l.page !== cur.t.headerPage) cur.t.continued = true; cur.suspended = false; continue; }
      if (headerLike(l) && nextNonBlank.slice(0, 3).some(isDataRow)) {
        finish();
        const prev = lines[i - 1];
        const headCount = l.tabbed ? l.raw.length : l.cells.length;
        const spanning = prev && prev.text.trim() && prev.cells.length >= 1 && prev.cells.length < headCount && !prev.cells.some((c) => isMoneyOrNumber(c.text)) && (prev.indent >= 4 || (prev.tabbed && !prev.raw[0])) ? prev : null;
        const columns = buildColumns(l, spanning, nextNonBlank.slice(0, 5).filter(isDataRow));
        start(l, l, columns, columns.length > headCount);
        continue;
      }
      if (isDataRow(l)) {
        let o = open as Open | null;
        if (o && o.suspended && l.page !== o.t.pageEnd) {
          const count = o.tabbed && l.tabbed ? l.raw.length : l.cells.length;
          if (intoPage <= 8 && Math.abs(count - o.t.columns.length) <= 1) o.t.continued = true; else { finish(); o = null; }
        }
        if (o && !o.t.headed && l.cells.length !== o.t.columns.length) { finish(); o = null; }
        if (!o) {
          const columns: Column[] = l.cells.map((c, k) => ({ index: k, leaf: "", heading: null, header: "", kind: (k === 0 ? "label" : "amount") as ColumnKind, appliesTo: null, currency: null, pos: relPos(l, c) }));
          start(l, null, columns, false);
          o = open as Open | null;
        }
        const t = o!;
        t.suspended = false;
        const cells = placeCells(l, t.t.columns, t.tabbed, t.implicit);
        const labelCell = cells[0];
        const lastTop = [...t.t.rows].reverse().find((r) => !r.sub);
        const lastIndent = lastTop ? lastTop.line.length - lastTop.line.trimStart().length : 0;
        const sub = !!labelCell && !!lastTop && (/^(?:of which|incl(?:uding|\.)|sub-?limit|-|–|•)\s/i.test(labelCell.text) || l.indent > lastIndent);
        t.t.rows.push({ page: l.page, line: l.text, lineStart: l.start, lineEnd: l.end, label: labelCell ? labelCell.text : "", labelCell, cells, section: t.section, parent: sub && lastTop ? lastTop.label : null, sub });
        t.t.pageEnd = l.page;
        continue;
      }
      if (cur && !cur.suspended && l.cells.length === 1 && l.text.trim().length <= 60 && !MONEY.test(l.text) && nextNonBlank[0] && isDataRow(nextNonBlank[0])) { cur.section = l.cells[0].text; continue; }
      if (cur && cur.suspended && l.page !== cur.t.pageEnd && intoPage <= 8) continue; // running page header above a continuation
      if (cur) finish();
    }
    const still = open as Open | null;
    if (still) still.suspended = true;
  }
  finish();
  return tables;
}

function finalizeKinds(t: Table) {
  for (const c of t.columns) {
    const values = t.rows.map((r) => r.cells[c.index]?.text ?? "");
    c.kind = t.headed ? kindOf(c.header, values, c.index) : c.index === 0 ? "label" : kindOf("", values, c.index);
    if (c.index === 0 && c.kind !== "label" && t.rows.some((r) => r.cells[0] && !isMoneyOrNumber(r.cells[0].text))) c.kind = "label";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------------------------

export type Period = "day" | "night" | "visit" | "week" | "month" | "year" | "policy_year" | "event" | "accident" | "lifetime" | "claim" | "operation" | null;
export type ParsedValue =
  | { kind: "money"; cents: number; amount: number; currency: string; unit: string | null; period: Period; raw: string }
  | { kind: "percent"; ppm: number; percent: number; unit: "%"; period: Period; raw: string }
  | { kind: "count"; count: number; unit: string; period: Period; raw: string }
  | { kind: "text"; text: string; raw: string };

/** Integer cents from a printed amount ("1,234.5" -> 123450); exact (string arithmetic, no float). */
export function toCents(digits: string): number {
  const [w, f = ""] = digits.replace(/,/g, "").split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2)) + (f.length > 2 && Number(f[2]) >= 5 ? 1 : 0);
}
export function periodIn(text: string): Period {
  const t = text.toLowerCase();
  if (/\bper (?:policy|insurance) year\b|\bpolicy year\b/.test(t)) return "policy_year";
  if (/\bper day\b|\ba day\b|\bdaily\b|\/day\b|\bper night\b/.test(t)) return /night/.test(t) ? "night" : "day";
  if (/\bper visit\b|\bper session\b/.test(t)) return "visit";
  if (/\bper week\b|\bweekly\b/.test(t)) return "week";
  if (/\bper month\b|\bmonthly\b/.test(t)) return "month";
  if (/\bper (?:annum|year)\b|\bannual(?:ly)?\b|\bp\.a\.\b|\byearly\b/.test(t)) return "year";
  if (/\bper (?:accident|injury)\b/.test(t)) return "accident";
  if (/\bper (?:event|occurrence|disability|admission)\b/.test(t)) return "event";
  if (/\bper (?:operation|surgery)\b/.test(t)) return "operation";
  if (/\bper claim\b/.test(t)) return "claim";
  if (/\blifetime\b/.test(t)) return "lifetime";
  return null;
}
/** The value one cell prints (with the column's currency for a bare figure under "Benefit (S$)"). */
export function parseCell(text: string, columnCurrency: string | null = null, context = ""): ParsedValue {
  const raw = text.trim();
  const period = periodIn(raw) ?? periodIn(context);
  const m = raw.match(/(SGD|USD|MYR|HKD|AUD|EUR|GBP|S\$|SG\$|US\$|HK\$|A\$|RM|€|£)\s?(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|million)\b)?/i);
  if (m) {
    const mult = m[3] ? (/^k$/i.test(m[3]) ? 1000 : 1_000_000) : 1;
    const cents = toCents(m[2]) * mult;
    return { kind: "money", cents, amount: cents / 100, currency: normCurrency(m[1]), unit: period ? "per " + period.replace("_", " ") : null, period, raw };
  }
  const p = raw.match(/^(\d+(?:\.\d+)?)\s?%/);
  if (p) { const ppm = Math.round(Number(p[1]) * 10000); return { kind: "percent", ppm, percent: ppm / 10000, unit: "%", period, raw }; }
  const c = raw.match(/^(\d+)\s*(days?|nights?|visits?|weeks?|months?|years?|sessions?|times)\b/i);
  if (c) return { kind: "count", count: Number(c[1]), unit: c[2].toLowerCase().replace(/s$/, ""), period, raw };
  const bare = raw.match(/^(\d[\d,]*(?:\.\d+)?)$/);
  if (bare && columnCurrency) { const cents = toCents(bare[1]); return { kind: "money", cents, amount: cents / 100, currency: columnCurrency, unit: period ? "per " + period : null, period, raw }; }
  if (bare) return { kind: "count", count: Number(bare[1].replace(/,/g, "")), unit: "", period, raw };
  return { kind: "text", text: raw, raw };
}

// ---------------------------------------------------------------------------------------------------------------
// Selecting one value
// ---------------------------------------------------------------------------------------------------------------

export type Want = "amount" | "percent" | "count" | "any";
export type SubjectSpec = { memberId: string; relation?: RelationClass | string | null; tier?: string | null };
export type SelectedValue = {
  status: "ok";
  value: number; valueKind: "money" | "percent" | "count"; cents: number | null; ppm: number | null;
  currency: string | null; unit: string | null; period: Period; conditions: string[];
  benefit: string; rowLabel: string; columnHeader: string;
  /** How the subject's column was decided, and the evidence for it when a document says so. */
  columnBasis: { basis: "only_column" | "explicit_tier" | "document" | "recorded_tier" | "relation" | "version_after"; detail: string; evidence: EvidenceRef | null };
  evidence: EvidenceRef;
  amendedFrom?: { value: number; currency: string | null; evidence: EvidenceRef; note: string } | null;
  notes: string[];
};
export type TableSelection =
  | SelectedValue
  | { status: "ambiguous"; options: { label: string; detail: string; evidence: EvidenceRef | null }[]; question: string; reason: string }
  | { status: "missing"; reason: string; evidence?: EvidenceRef | null };

const GENERIC = new Set(["benefit", "limit", "amount", "cover", "sum", "payable", "max", "maximum", "plan", "per", "of", "which", "the", "value", "much", "how"]);
const tokMatch = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b.slice(0, 5)) && b.startsWith(a.slice(0, 5))) && (a.startsWith(b) || b.startsWith(a)));
function benefitScore(benefit: string, t: Table, r: Row): number {
  const want = tokens(benefit).filter((w) => !GENERIC.has(w));
  if (!want.length) return 0;
  const condCols = t.columns.filter((c) => c.kind === "condition").map((c) => r.cells[c.index]?.text ?? "");
  const own = [...tokens(r.label), ...tokens(condCols.join(" "))].filter((w) => !GENERIC.has(w));
  const ctx = [...tokens(r.parent ?? ""), ...tokens(r.section ?? "")];
  let rec = 0;
  for (const w of want) { if (own.some((o) => tokMatch(o, w))) rec += 1; else if (ctx.some((o) => tokMatch(o, w))) rec += 0.8; }
  const ownLabel = tokens(r.label).filter((w) => !GENERIC.has(w));
  const prec = ownLabel.length ? ownLabel.filter((o) => want.some((w) => tokMatch(o, w))).length / ownLabel.length : 0;
  return rec / want.length + 0.3 * prec;
}

/** Candidate rows for a benefit across tables, best first (score >= 0.6 recall). */
export function rowsForBenefit(tables: Table[], benefit: string): { table: Table; row: Row; score: number }[] {
  const out: { table: Table; row: Row; score: number }[] = [];
  for (const t of tables) for (const r of t.rows) { const s = benefitScore(benefit, t, r); if (s >= 0.6) out.push({ table: t, row: r, score: s }); }
  return out.sort((a, b) => b.score - a.score);
}

const valueKindOf = (k: ColumnKind): Want | null => (k === "amount" ? "amount" : k === "percent" ? "percent" : k === "count" ? "count" : null);
/** The value columns of a table that can hold `want` in this row (never label / condition / notes / unit columns). A
 * person's column may print an amount in one row and a count ("30 days") in another, so the row's own cell decides. */
function valueColumns(t: Table, want: Want, r: Row): Column[] {
  const vals = t.columns.filter((c) => valueKindOf(c.kind));
  if (want !== "any") {
    const kind = want === "amount" ? "money" : want;
    return vals.filter((c) => { const cell = r.cells[c.index]; return cell ? parseCell(cell.text, c.currency).kind === kind : c.kind === want; });
  }
  const amounts = vals.filter((c) => c.kind === "amount");
  return amounts.length ? amounts : vals;
}

export type SubjectColumnHints = {
  memberId: string; name: string; names: string[]; relation: RelationClass | string | null; tier: string | null; recordedTier: string | null;
  isDocOwner: boolean; ownerIsSelf: boolean; age: number | null;
  /** Lines of this document (and of documents of the same policy / scheme, e.g. an enrolment confirmation) naming the person. */
  namedLines: { line: string; ref: EvidenceRef }[];
};

const classOfText = (t: string) => CLASS_RES.find(([, re]) => re.test(t))?.[0] ?? null;
const sameTier = (a: string, b: string) => { const x = flat(a).toLowerCase(), y = flat(b).toLowerCase(); return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))); };

/** The label of a list the person is named in ("Insured children" of "Insured children: A; B"): the last "<label>:"
 * before the name in the same sentence / line, with only plain names (no per-person brackets) between it and the name. */
function listLabel(line: string, names: string[]): string | null {
  for (const n of names) {
    const i = n ? line.toLowerCase().indexOf(flat(n).toLowerCase()) : -1;
    if (i < 0) continue;
    const seg = line.slice(0, i).split(/\.\s|\n/).pop() ?? "";
    const c = seg.lastIndexOf(":");
    if (c < 0) continue;
    const label = (seg.slice(0, c).split(/[;,]/).pop() ?? "").trim();
    if (label.length >= 3 && label.length <= 40 && !/[()]/.test(seg.slice(c + 1))) return label;
  }
  return null;
}

/** Decides which of `cols` applies to the subject. */
export function chooseColumn(cols: Column[], hints: SubjectColumnHints): { ok: Column; basis: SelectedValue["columnBasis"] } | { ambiguous: Column[]; reason: string } | { none: string } {
  if (!cols.length) return { none: "the table prints no value column for that" };
  const version = cols.filter((c) => c.appliesTo?.kind === "version");
  if (version.length && version.length === cols.length) {
    const after = version.filter((c) => c.appliesTo!.value === "after");
    if (after.length === 1) return { ok: after[0], basis: { basis: "version_after", detail: `the amended (“${after[0].header}”) column`, evidence: null } };
  }
  const classed = cols.filter((c) => c.appliesTo && c.appliesTo.kind !== "version");
  if (cols.length === 1 && !classed.length) return { ok: cols[0], basis: { basis: "only_column", detail: "the row prints one value for everyone it covers", evidence: null } };
  if (!classed.length) return { ambiguous: cols, reason: "the row prints more than one value and the columns do not say who each applies to" };
  const byTier = (tier: string) => classed.filter((c) => sameTier(c.appliesTo!.value, tier) || sameTier(c.header, tier) || (c.appliesTo!.personClass && c.appliesTo!.personClass === classOfText(tier)) || sameTier(c.leaf, tier));
  if (hints.tier) {
    const m = byTier(hints.tier);
    if (m.length === 1) return { ok: m[0], basis: { basis: "explicit_tier", detail: `the “${m[0].header}” column (tier given: ${hints.tier})`, evidence: null } };
    if (m.length > 1) return { ambiguous: m, reason: `more than one column fits “${hints.tier}”` };
  }
  // A document naming the person with exactly one of the columns' classes / tiers ("Kavya Nair   Child").
  const docMatches = new Map<number, { line: string; ref: EvidenceRef }>();
  for (const named of hints.namedLines) {
    // Only the clause of the line that names the person ("Koh Jun Hao (child)" of "A (adult); Koh Jun Hao (child)").
    const clause0 = hints.names.map((n) => personClause(named.line, n)).find((c): c is string => !!c) ?? named.line;
    // Integration (agent C's request 4): a person named inside a labelled list ("Insured children: A; B") takes the
    // list's label, even when the clause around the name is just "B".
    const label = listLabel(named.line, hints.names);
    const clause = label && !clause0.toLowerCase().includes(label.toLowerCase()) ? `${label}: ${clause0}` : clause0;
    const nl = { ...named, line: clause };
    const fits = classed.filter((c) => {
      const words = [c.appliesTo!.value, c.leaf, c.heading ?? ""].filter((w) => w && w.length >= 3);
      return words.some((w) => new RegExp("(?<![\\w])" + esc(flat(w.replace(/^insured\s+/i, ""))) + "(?![\\w])", "i").test(nl.line.replace(new RegExp(hints.names.map(esc).join("|") || "$^", "gi"), " ")))
        || (c.appliesTo!.personClass && classOfText(nl.line.replace(new RegExp(hints.names.map(esc).join("|") || "$^", "gi"), " ")) === c.appliesTo!.personClass);
    });
    const uniq = [...new Set(fits.map((c) => c.appliesTo!.personClass ?? c.appliesTo!.value))];
    if (uniq.length === 1) for (const c of fits) if (!docMatches.has(c.index)) docMatches.set(c.index, nl);
  }
  if (docMatches.size) {
    const cands = classed.filter((c) => docMatches.has(c.index));
    if (cands.length === 1) { const nl = docMatches.get(cands[0].index)!; return { ok: cands[0], basis: { basis: "document", detail: `the document lists ${hints.name} as “${flat(nl.line)}”`, evidence: nl.ref } }; }
  }
  if (hints.recordedTier) {
    const m = byTier(hints.recordedTier);
    if (m.length === 1) return { ok: m[0], basis: { basis: "recorded_tier", detail: `the tier recorded for ${hints.name}: ${hints.recordedTier}`, evidence: null } };
  }
  // The person's relation, only where the table's classes make it unambiguous.
  const rel = String(hints.relation ?? "");
  const want: string[] = [];
  const hasClass = (k: string) => classed.some((c) => c.appliesTo!.personClass === k);
  if (rel === "child") { if (hints.age != null && hints.age >= 18) return { ambiguous: classed, reason: `${hints.name} is recorded as a child but is ${hints.age}; the document does not say which column applies` }; want.push(hasClass("child") ? "child" : "dependant"); }
  else if (["employee", "spouse", "self"].some(hasClass) && hasClass("employee")) {
    if (hints.isDocOwner) want.push("employee");
    else if (hints.ownerIsSelf && rel === "spouse") want.push("spouse");
    else if (hints.ownerIsSelf && rel === "parent") want.push("parent");
  } else if (["self", "spouse", "parent", "sibling", "grandparent"].includes(rel)) want.push(hasClass("adult") ? "adult" : rel === "spouse" ? "spouse" : rel === "parent" ? "parent" : "self");
  const m = classed.filter((c) => want.includes(c.appliesTo!.personClass ?? ""));
  if (m.length === 1) return { ok: m[0], basis: { basis: "relation", detail: `${hints.name} is recorded as ${rel || "a member"}; the “${m[0].header}” column`, evidence: null } };
  if (m.length > 1) return { ambiguous: m, reason: "more than one column fits the person's relation" };
  return { ambiguous: classed, reason: `nothing on file says which column applies to ${hints.name}` };
}

const NOT_A_VALUE = /^(?:not covered|n\.?a\.?|nil|none|-|–|—|not applicable|excluded)$/i;
export const AMENDS = /\bendorsement\b|\bpolicy (?:is|has been) altered\b|\bpolicy alteration\b|\b(?:is|are|hereby|has been|have been) amended\b/i;
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "01 Jul 2026" / "1 July 2026" / "2026-07-01" -> "2026-07-01". */
export function isoDate(text: string): string | null {
  const a = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/); if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\b/); if (b && MONTHS[b[2].toLowerCase()]) return `${b[3]}-${String(MONTHS[b[2].toLowerCase()]).padStart(2, "0")}-${b[1].padStart(2, "0")}`;
  return null;
}
/** The effective date a document prints ("Effective date: 01 Jul 2026"), with its line. */
export function printedEffectiveDate(text: string): { date: string; line: string; start: number; end: number } | null {
  const m = text.match(/^.*\b(?:effective (?:date|from|on)|with effect from|takes effect (?:on|from))\b.*$/im);
  if (!m) return null;
  const d = isoDate(m[0]);
  return d ? { date: d, line: m[0], start: m.index!, end: m.index! + m[0].length } : null;
}
const normNo = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function ageOn(dob: string | null, asOf: string): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number), [Y, M, D] = asOf.split("-").map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

type Loaded = { doc: DocRow; pages: Map<number, string>; tables: Table[] };

/** The value printed for `benefit` in `policyId`'s tables, in the subject's column. */
export async function selectTableValue(args: { accountId: string; policyId: string; benefit: string; subject: SubjectSpec; want?: Want; asOf?: string | null }): Promise<TableSelection> {
  const want: Want = args.want ?? "any";
  const asOf = (args.asOf ?? new Date().toISOString()).slice(0, 10);
  const docs = await loadDocs(args.accountId);
  const doc = docs.find((d) => d.id === args.policyId);
  if (!doc) return { status: "missing", reason: "that document is not one of this household's readable documents (deleted, not yet released, superseded or not read)" };
  const members = await loadMembers(args.accountId);
  const subject = members.find((m) => m.id === args.subject.memberId);
  if (!subject) return { status: "missing", reason: "that person is not an active member of this household" };
  const links = await loadLinks(args.accountId, docs.map((d) => d.id));
  const link = links.find((l) => l.policyId === doc.id && l.memberId === subject.id);
  if (!link && doc.ownerId !== subject.id) return { status: "missing", reason: `${subject.displayName} is not recorded as insured under ${doc.productName ?? "this document"}` };

  // Documents of the same policy / scheme (an endorsement, an enrolment confirmation).
  const key = normNo(doc.policyNumber), gkey = normNo(doc.groupPolicyNumber);
  const family = docs.filter((d) => d.id !== doc.id && ((key && (normNo(d.policyNumber) === key || normNo(d.groupPolicyNumber) === key)) || (gkey && (normNo(d.groupPolicyNumber) === gkey || normNo(d.policyNumber) === gkey))));
  const pageRows = await loadPages(args.accountId, [doc.id, ...family.map((d) => d.id)]);
  const load = (d: DocRow): Loaded => { const pages = new Map(pageRows.filter((p) => p.policyId === d.id).map((p) => [p.page, p.text])); return { doc: d, pages, tables: parseTables(d.id, [...pages].map(([page, text]) => ({ page, text }))) }; };
  const base = load(doc);

  const names = [subject.displayName, subject.preferredName].filter((n): n is string => !!n && n.trim().length >= 3);
  const namedLines: SubjectColumnHints["namedLines"] = [];
  for (const L of [base, ...family.map(load)]) for (const [page, text] of L.pages) {
    let at = 0;
    for (const line of text.split("\n")) {
      if (names.some((n) => new RegExp("(?<![\\p{L}])" + esc(n) + "(?![\\p{L}])", "iu").test(line))) namedLines.push({ line, ref: evidenceAt({ policyId: L.doc.id, documentHash: L.doc.fileHash, page, pageText: text, start: at, end: at + line.length, subjectId: subject.id }) });
      at += line.length + 1;
    }
  }
  const self = members.find((m) => relationOf(m).relation === "self");
  const hints: SubjectColumnHints = {
    memberId: subject.id, name: subject.displayName, names, relation: args.subject.relation ?? relationOf(subject).relation, tier: args.subject.tier ?? null, recordedTier: link?.tier ?? null,
    isDocOwner: doc.ownerId === subject.id, ownerIsSelf: !!self && doc.ownerId === self.id, age: ageOn(subject.dateOfBirth, asOf), namedLines,
  };
  const picked = pickValue(base, args.benefit, want, hints, subject.id);
  if (picked.status !== "ok") return picked;

  // A later endorsement of the same policy that prints this benefit's amended value.
  const baseDate = doc.effectiveDate ?? doc.documentDate ?? null;
  for (const d of family) {
    const L = load(d);
    const all = [...L.pages.values()].join("\n");
    if (!(d.documentRole === "endorsement" || AMENDS.test(all))) continue;
    const eff = d.effectiveDate ?? d.documentDate ?? [...L.pages.values()].map(printedEffectiveDate).find(Boolean)?.date ?? null;
    if (!eff || (baseDate && eff <= baseDate)) continue;
    const amended = pickValue(L, args.benefit, want, { ...hints, tier: null }, subject.id);
    if (amended.status !== "ok" || amended.columnBasis.basis !== "version_after") continue;
    if (eff > asOf) { picked.notes.push(`An endorsement effective ${eff} changes this to ${fmt(amended)} (not yet in force on ${asOf}).`); continue; }
    return { ...amended, amendedFrom: { value: picked.value, currency: picked.currency, evidence: picked.evidence, note: `amended by the endorsement effective ${eff}` }, notes: [...amended.notes, `Amended by the endorsement effective ${eff}; the schedule printed ${fmt(picked)}.`] };
  }
  return picked;
}
const fmt = (v: SelectedValue) => v.valueKind === "money" ? `${v.currency} ${v.value.toLocaleString("en-SG", { minimumFractionDigits: v.cents! % 100 ? 2 : 0 })}` : v.valueKind === "percent" ? `${v.value}%` : `${v.value} ${v.unit ?? ""}`.trim();

function pickValue(L: Loaded, benefit: string, want: Want, hints: SubjectColumnHints, subjectId: string): TableSelection {
  const cands = rowsForBenefit(L.tables, benefit);
  if (!cands.length) return { status: "missing", reason: `no table row of ${L.doc.productName ?? "this document"} names “${benefit}”` };
  const top = cands[0].score;
  const tied = cands.filter((c) => c.score >= top - 0.05);
  const ev = (t: Table, r: Row, col: Column | null, cell: Cell | null): EvidenceRef => {
    const text = L.pages.get(r.page) ?? "";
    return evidenceAt({ policyId: L.doc.id, documentHash: L.doc.fileHash, page: r.page, pageText: text, start: r.lineStart, end: r.lineEnd, pageStart: t.headerPage ?? r.page, subjectId,
      table: { tableId: t.tableId, rowLabel: r.label, columnHeader: col?.header ?? "", columnLeaf: col?.leaf ?? null, appliesTo: col?.appliesTo ?? (col ? { kind: "everyone", value: "everyone" } : null), cell: cell ? { text: cell.text, start: cell.start, end: cell.end } : null } });
  };
  const results: SelectedValue[] = [];
  const problems: TableSelection[] = [];
  for (const c of tied) {
    const r = pickCell(L, c.table, c.row, benefit, want, hints, ev);
    if (r.status === "ok") results.push(r); else problems.push(r);
  }
  const distinct = new Map<string, SelectedValue>();
  for (const r of results) { const k = `${r.valueKind}|${r.value}|${r.currency}|${r.period}`; if (!distinct.has(k)) distinct.set(k, r); }
  if (distinct.size === 1) return [...distinct.values()][0];
  // "The recuperation benefit" with no kind asked: one amount and day / visit counts tied with it -> the amount, the
  // counts kept as its conditions (they are its limits, printed on their own rows).
  const money = [...distinct.values()].filter((r) => r.valueKind === "money");
  if (want === "any" && money.length === 1 && [...distinct.values()].every((r) => r.valueKind === "money" || r.valueKind === "count")) {
    const counts = [...distinct.values()].filter((r) => r.valueKind === "count");
    return { ...money[0], conditions: [...money[0].conditions, ...counts.map((c) => `${c.rowLabel}: ${fmt(c)} (page ${c.evidence.passage.onPage})`)] };
  }
  if (distinct.size > 1) return { status: "ambiguous", options: [...distinct.values()].map((r) => ({ label: r.rowLabel + (r.columnHeader ? " — " + r.columnHeader : ""), detail: `${fmt(r)} (page ${r.evidence.passage.onPage})`, evidence: r.evidence })), question: `${L.doc.productName ?? "The document"} prints more than one row for “${benefit}”: ${[...distinct.values()].map((r) => `${r.rowLabel} (${fmt(r)})`).join(" or ")}. Which one do you mean?`, reason: "more than one table row fits the benefit equally well" };
  return problems[0];
}

function pickCell(L: Loaded, t: Table, r: Row, benefit: string, want: Want, hints: SubjectColumnHints, ev: (t: Table, r: Row, col: Column | null, cell: Cell | null) => EvidenceRef): TableSelection {
  const cols = valueColumns(t, want, r).filter((c) => t.headed || r.cells[c.index]);
  if (!t.headed) {
    const filled = cols.filter((c) => r.cells[c.index]);
    if (filled.length > 1) return { status: "ambiguous", options: filled.map((c) => ({ label: r.cells[c.index]!.text, detail: `printed in an unheaded column on page ${r.page}`, evidence: ev(t, r, c, r.cells[c.index]) })), question: `The table on page ${r.page} prints ${filled.map((c) => r.cells[c.index]!.text).join(" and ")} for “${r.label}” without column headings. Which applies to ${hints.name}?`, reason: "the table has no header row, so its columns cannot be told apart" };
  }
  // The subject's column first; only then the value in it.
  const choice = chooseColumn(cols, hints);
  if ("none" in choice) return { status: "missing", reason: choice.none, evidence: ev(t, r, null, null) };
  if ("ambiguous" in choice) return { status: "ambiguous", options: choice.ambiguous.map((c) => ({ label: c.header, detail: r.cells[c.index]?.text ?? "(blank)", evidence: ev(t, r, c, r.cells[c.index]) })), question: `Which column of the ${r.label} row applies to ${hints.name} — ${choice.ambiguous.map((c) => c.header).join(" or ")}?`, reason: choice.reason };
  const col = choice.ok;
  const cell = r.cells[col.index];
  if (!cell || NOT_A_VALUE.test(cell.text)) return { status: "missing", reason: cell ? `the ${col.header} column prints “${cell.text}” for ${r.label}` : `the ${col.header} column prints nothing for ${r.label}`, evidence: ev(t, r, col, cell) };
  const context = [r.label, col.header, r.parent ?? "", r.section ?? ""].join(" ");
  const v = parseCell(cell.text, col.currency, context);
  if (v.kind === "text") return { status: "missing", reason: `the ${col.header} column prints “${cell.text}” for ${r.label}, not a figure`, evidence: ev(t, r, col, cell) };
  if (want !== "any" && !(want === "amount" ? v.kind === "money" : want === "percent" ? v.kind === "percent" : v.kind === "count")) return { status: "missing", reason: `the ${col.header} column prints ${cell.text}, not ${want === "amount" ? "an amount" : want === "percent" ? "a percentage" : "a count"}`, evidence: ev(t, r, col, cell) };
  const conditions: string[] = [];
  for (const c of t.columns) if ((c.kind === "condition" || c.kind === "notes" || c.kind === "unit") && r.cells[c.index]) conditions.push(`${c.header || "Condition"}: ${r.cells[c.index]!.text}`);
  const paren = [...r.label.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  conditions.push(...paren);
  if (r.parent) conditions.push(`sub-limit within “${r.parent}”`);
  if (r.section) conditions.push(`under “${r.section}”`);
  for (const c of t.columns) if (c.kind === "percent" && c.index !== col.index && r.cells[c.index] && v.kind === "money") conditions.push(`${c.header}: ${r.cells[c.index]!.text}`);
  const evidence = ev(t, r, col, cell);
  return {
    status: "ok", value: v.kind === "money" ? v.amount : v.kind === "percent" ? v.percent : v.count, valueKind: v.kind, cents: v.kind === "money" ? v.cents : null, ppm: v.kind === "percent" ? v.ppm : null,
    currency: v.kind === "money" ? v.currency : null, unit: v.kind === "count" ? v.unit : v.kind === "percent" ? "%" : v.unit, period: v.period, conditions,
    benefit, rowLabel: r.label, columnHeader: col.header, columnBasis: choice.basis, evidence, notes: [],
  };
}
