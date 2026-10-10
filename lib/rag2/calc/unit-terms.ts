/**
 * A1 (r6): unit terms of a calculation. The record types and the re-check (checkUnitTerms) live in
 * lib/claims/unit-terms.ts (the save-time gate uses them); this module adds reading them from a tool's evidence.
 */
import type { EvidenceRef } from "../evidence";
import { readValueTerms, type TermSource, type ValueTerms } from "../value-terms";
export * from "@/lib/claims/unit-terms";

/** The texts one table value's evidence prints, with page offsets where they can be located: the value cell, the row
 * label, the column header (no offset: it is printed on the header line). A passage-only value reads its passage. */
export function termSourcesOf(e: EvidenceRef): TermSource[] {
  const p = e.passage, page = p.onPage;
  const at = (text: string, hint?: number | null) => {
    if (!text) return null;
    if (hint != null && p.text.slice(hint - p.start, hint - p.start + text.length) === text) return hint;
    const i = p.text.indexOf(text); return i >= 0 ? p.start + i : null;
  };
  if (!e.table) return [{ source: "passage", text: p.text, page, offset: p.start }];
  const out: TermSource[] = [];
  const cell = e.table.cell;
  if (cell?.text) out.push({ source: "cell", text: cell.text, page, offset: at(cell.text, cell.start) });
  const label = e.table.rowLabel ?? "";
  if (label) out.push({ source: "label", text: label, page, offset: at(label) });
  if (e.table.columnHeader) out.push({ source: "header", text: e.table.columnHeader, page: null, offset: null });
  return out;
}
export function valueTermsOf(e: EvidenceRef): ValueTerms { return readValueTerms(termSourcesOf(e)); }
