/**
 * Conversational RAG: evidence identities. Every figure or statement a lib/rag2 tool returns carries an EvidenceRef:
 * the policy (document) id, the version's file hash, the page range, the verbatim passage located by character
 * offsets in the stored page text (policy_pages.text), the person it is about, and -- for a table value -- the table,
 * row label, column header and who that column applies to. toFigureBinding() turns one into the existing save-time
 * gate's FigureBinding (types/index.ts) so an answer built from these tools passes lib/chat/answer-verification.ts.
 * Pure: no database access here.
 */
import type { FigureBinding } from "@/types";

export type AppliesToKind = "person_class" | "tier" | "plan" | "ward" | "version" | "everyone";
/** Who a table column's values apply to ("Child" -> person_class child; "Plan B" -> plan; "After" -> version). */
export type AppliesTo = { kind: AppliesToKind; value: string; personClass?: string | null };

export type EvidenceTableRef = {
  tableId: string;
  rowLabel: string;
  columnHeader: string;
  /** The header cell printed directly above the value (columnHeader without any spanning heading above it). */
  columnLeaf?: string | null;
  appliesTo: AppliesTo | null;
  /** The value cell itself: verbatim text and offsets in the row page's stored text. */
  cell?: { text: string; start: number; end: number } | null;
};

export type EvidencePassage = {
  /** Verbatim: always === pageText.slice(start, end) of `onPage`. */
  text: string;
  start: number;
  end: number;
  /** The page whose stored text holds the passage (within page.start..page.end). */
  onPage: number;
};

/** A verbatim span of one stored page (text === pageText.slice(start, end) of `onPage`). */
export type EvidenceSpan = { text: string; start: number; end: number; onPage: number };
/** Text that must travel with a supporting span for it to be read correctly: the header row of the table the row is
 * in, the header of a table continued from the previous page, or a footnote the span's marker points to. */
export type EvidenceContext = EvidenceSpan & { role: "table_header" | "continuation_header" | "footnote" };

export type EvidenceRef = {
  policyId: string;
  /** policies.file_hash of the version read (null when the document has none on file). */
  documentHash: string | null;
  page: { start: number; end: number };
  passage: EvidencePassage;
  subjectId?: string | null;
  table?: EvidenceTableRef | null;
  /** The exact sentence or table row inside `passage` that supports the statement (internal precision; the page stays
   * the household-facing link). Absent when no single sentence / row has been identified yet. */
  support?: EvidenceSpan | null;
  /** What the support needs to be read correctly (table header, continued header, footnote). */
  context?: EvidenceContext[] | null;
};

export type Span = { start: number; end: number; text: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every exact span of `passage` in `pageText`; when the exact text is absent, the spans that match it with any run of
 * whitespace standing for any other (a passage re-flowed by a model or a quote). Each returned span's `text` is the
 * page's own verbatim slice. Empty when the passage is not on the page. */
export function locateAll(passage: string, pageText: string): Span[] {
  const p = (passage ?? "").trim();
  if (!p || !pageText) return [];
  const out: Span[] = [];
  for (let i = pageText.indexOf(p); i >= 0; i = pageText.indexOf(p, i + 1)) out.push({ start: i, end: i + p.length, text: pageText.slice(i, i + p.length) });
  if (out.length) return out;
  const words = p.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const re = new RegExp(words.map(esc).join("\\s+"), "g");
  for (const m of pageText.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0] });
  return out;
}

/** The exact span of `passage` in `pageText` -- the first, or the one nearest `near` (a char offset) when the passage
 * is printed more than once. Null when the page does not print it. */
export function locate(passage: string, pageText: string, near?: number): Span | null {
  const all = locateAll(passage, pageText);
  if (!all.length) return null;
  if (near == null) return all[0];
  return [...all].sort((a, b) => Math.abs(a.start - near) - Math.abs(b.start - near))[0];
}

/** An EvidenceRef for `passage` on one page, or null when the page does not print it. */
export function evidenceFor(args: { policyId: string; documentHash: string | null; page: number; pageText: string; passage: string; near?: number; pageStart?: number; subjectId?: string | null; table?: EvidenceTableRef | null }): EvidenceRef | null {
  const span = locate(args.passage, args.pageText, args.near);
  if (!span) return null;
  return { policyId: args.policyId, documentHash: args.documentHash, page: { start: Math.min(args.pageStart ?? args.page, args.page), end: args.page }, passage: { text: span.text, start: span.start, end: span.end, onPage: args.page }, subjectId: args.subjectId ?? null, table: args.table ?? null };
}

/** An EvidenceRef for an exact [start, end) span of one page. */
export function evidenceAt(args: { policyId: string; documentHash: string | null; page: number; pageText: string; start: number; end: number; pageStart?: number; subjectId?: string | null; table?: EvidenceTableRef | null }): EvidenceRef {
  const start = Math.max(0, Math.min(args.start, args.pageText.length)), end = Math.max(start, Math.min(args.end, args.pageText.length));
  return { policyId: args.policyId, documentHash: args.documentHash, page: { start: Math.min(args.pageStart ?? args.page, args.page), end: args.page }, passage: { text: args.pageText.slice(start, end), start, end, onPage: args.page }, subjectId: args.subjectId ?? null, table: args.table ?? null };
}

/** True when the ref's passage is still exactly where it says on the stored page text. */
export function verifyEvidence(ref: EvidenceRef, pageText: string | null | undefined): boolean {
  if (!ref || !pageText) return false;
  const { start, end, text } = ref.passage;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && pageText.slice(start, end) === text;
}

/** A stable identity string for a ref (dedupe / logs). */
export function evidenceKey(ref: EvidenceRef): string {
  return [ref.policyId, ref.documentHash ?? "", ref.page.start, ref.page.end, ref.passage.onPage, ref.passage.start, ref.passage.end, ref.table?.tableId ?? "", ref.table?.columnHeader ?? ""].join("|");
}

const numbersIn = (t: string) => (t.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** The existing save-time gate's binding for one figure read through these tools. Null when the ref names no person,
 * or its passage does not print the value (a binding the gate would reject anyway is never produced). */
export function toFigureBinding(ref: EvidenceRef, benefit: string, value: number, currency: string): FigureBinding | null {
  void currency;
  if (!ref || !ref.subjectId || !benefit?.trim() || !Number.isFinite(value)) return null;
  if (!numbersIn(ref.passage.text).some((n) => Math.abs(n - value) < 1e-9)) return null;
  return {
    policyId: ref.policyId,
    subjectId: ref.subjectId,
    benefit: benefit.trim(),
    documentHash: ref.documentHash,
    pageStart: ref.page.start,
    pageEnd: ref.page.end,
    passage: ref.passage.text,
    column: ref.table ? (ref.table.columnLeaf || ref.table.columnHeader || null) : null,
  };
}

// ---------------------------------------------------------------------------
// Precision: the supporting sentence / row inside a passage, and what it needs (header, continuation, footnote).
// ---------------------------------------------------------------------------
type Line = { start: number; end: number; text: string };
/** The page's lines with their offsets. */
export function linesOf(pageText: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const raw of (pageText ?? "").split("\n")) { out.push({ start: at, end: at + raw.length, text: raw }); at += raw.length + 1; }
  return out;
}
/** A line laid out as table cells (a tab, or three or more spaces between two cells). */
export function isTableLine(text: string): boolean { return /\t/.test(text.trim()) || /\S {3,}\S/.test(text.trim()); }
const FOOT_MARK = /(?:[*†‡§¶]+|[¹²³⁴⁵⁶⁷⁸⁹]|\((?:\d{1,2}|[a-h])\))/;
const hasFigure = (t: string) => /\d/.test(t);
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{3,}|\d+(?:[.,]\d+)*/g) ?? []).map((w) => w.replace(/,/g, "").replace(/(?:es|s)$/, "")));

/** Candidate supporting units of a passage: each table line whole, each prose line cut into sentences. */
function unitsOf(ref: EvidenceRef, pageText: string): EvidenceSpan[] {
  const out: EvidenceSpan[] = [];
  for (const l of linesOf(pageText)) {
    if (l.end <= ref.passage.start || l.start >= ref.passage.end || !l.text.trim()) continue;
    const lead = l.text.length - l.text.trimStart().length, start = l.start + lead, end = l.start + l.text.trimEnd().length;
    if (isTableLine(l.text)) { out.push({ text: pageText.slice(start, end), start, end, onPage: ref.passage.onPage }); continue; }
    const body = pageText.slice(start, end);
    const re = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g;
    for (const m of body.matchAll(re)) {
      const t = m[0], a = start + m.index! + (t.length - t.trimStart().length), b = start + m.index! + t.trimEnd().length;
      if (b > a) out.push({ text: pageText.slice(a, b), start: a, end: b, onPage: ref.passage.onPage });
    }
  }
  return out;
}

/** The sentence / row of `ref`'s passage that best supports `about` (a query or the sentence being said), or -- for a
 * table value -- the row holding the value cell. Null when nothing in the passage shares a word with `about`. */
export function supportSpan(ref: EvidenceRef, pageText: string, about?: string | null): EvidenceSpan | null {
  if (!pageText) return null;
  const units = unitsOf(ref, pageText);
  if (ref.table?.cell) {
    const c = ref.table.cell;
    const row = units.find((u) => u.start <= c.start && u.end >= c.end);
    if (row) return row;
  }
  if (units.length === 1) return units[0];
  const want = words(about ?? "");
  if (!want.size) return null;
  let best: EvidenceSpan | null = null, score = 0;
  for (const u of units) {
    const have = words(u.text);
    let s = 0;
    for (const w of want) if (have.has(w)) s += /^\d/.test(w) ? 3 : 1;
    if (s > score) { score = s; best = u; }
  }
  return best;
}

/** What the support needs to be read correctly: the header row of its table (walking up through the table block), or,
 * when the block starts the page with no header, the header of the table on the previous page (a continuation); and
 * any footnote a marker in the support points to (on the same page). `pages` maps page number -> stored text. */
export function contextFor(support: EvidenceSpan, pages: Map<number, string>): EvidenceContext[] {
  const out: EvidenceContext[] = [];
  const text = pages.get(support.onPage);
  if (!text) return out;
  const lines = linesOf(text);
  const at = lines.findIndex((l) => l.start <= support.start && l.end >= support.start);
  const span = (l: Line, page: number, role: EvidenceContext["role"]): EvidenceContext => {
    const lead = l.text.length - l.text.trimStart().length;
    return { role, onPage: page, start: l.start + lead, end: l.start + l.text.trimEnd().length, text: l.text.trim() };
  };
  if (at >= 0 && isTableLine(lines[at].text)) {
    let header: Line | null = null, top = at;
    for (let i = at - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l.text.trim() || !isTableLine(l.text)) break;
      top = i;
      if (!hasFigure(l.text)) { header = l; break; }
    }
    if (header) out.push(span(header, support.onPage, "table_header"));
    else {
      // Nothing above but (at most) a running title: a table continued from the previous page.
      const above = lines.slice(0, top).filter((l) => l.text.trim());
      const prev = pages.get(support.onPage - 1);
      if (above.length <= 1 && prev) {
        const pl = linesOf(prev);
        const cells = (t: string) => t.trim().split(/\t| {3,}/).length;
        const want = cells(lines[at].text);
        for (let i = pl.length - 1; i >= 0; i--) if (isTableLine(pl[i].text) && !hasFigure(pl[i].text) && cells(pl[i].text) === want) { out.push(span(pl[i], support.onPage - 1, "continuation_header")); break; }
      }
    }
  }
  const mark = support.text.match(new RegExp("\\S(" + FOOT_MARK.source + ")(?=\\s|$)"));
  if (mark) {
    const m = mark[1];
    const foot = lines.find((l) => l.start !== lines[at]?.start && l.text.trimStart().startsWith(m));
    if (foot) out.push(span(foot, support.onPage, "footnote"));
  }
  return out;
}

/** Sets `support` (and `context`) on a ref in place, when it has none yet. Returns the ref. */
export function refineEvidence(ref: EvidenceRef, pages: Map<number, string>, about?: string | null): EvidenceRef {
  if (ref.support) return ref;
  const pageText = pages.get(ref.passage.onPage);
  if (!pageText || !verifyEvidence(ref, pageText)) return ref;
  const support = supportSpan(ref, pageText, about);
  if (!support) return ref;
  ref.support = support;
  const context = contextFor(support, pages);
  ref.context = context.length ? context : null;
  return ref;
}
