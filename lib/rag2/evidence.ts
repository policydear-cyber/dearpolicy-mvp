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

export type EvidenceRef = {
  policyId: string;
  /** policies.file_hash of the version read (null when the document has none on file). */
  documentHash: string | null;
  page: { start: number; end: number };
  passage: EvidencePassage;
  subjectId?: string | null;
  table?: EvidenceTableRef | null;
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
