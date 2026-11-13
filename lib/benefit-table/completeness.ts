/** The benefit table's completeness check. Pure.
 *
 * A reading of a long document can summarise a table instead of listing it (run benefit-table-20261021-02: a 17-page
 * booklet gave 10 rows and skipped two percentage tables). So after each document is read, every page is compared with
 * the rows read from it: a page that prints many lines carrying a figure (an amount, a percentage) but gave few rows is
 * read again on its own, and the new rows are added. This looks only at the page text, never at what kind of insurance it
 * is, and a re-read that finds nothing new changes nothing. */
import type { CheckedReading, SourceDoc } from "./check";
import { MONEY_SIGN } from "@/lib/format/currency";

const FIGURE = new RegExp(String.raw`\d+(?:\.\d+)?\s?%|${MONEY_SIGN}\s?\d[\d,]*`, "i");
export const MIN_FIGURE_LINES = 4;

export function figureLines(text: string): number {
  return text.split("\n").filter((line) => FIGURE.test(line)).length;
}

/** Pages to read again: at least MIN_FIGURE_LINES lines with a figure, and fewer than a third as many rows read from them. */
export function pagesToReread(doc: SourceDoc, reading: CheckedReading): { page: number; figureLines: number; rowsRead: number }[] {
  if (!doc.readable) return [];
  const read = new Map<number, number>();
  for (const row of [...reading.covers, ...reading.benefits]) read.set(row.source.page, (read.get(row.source.page) ?? 0) + 1);
  return doc.pages
    .map((p) => ({ page: p.page, figureLines: figureLines(p.text), rowsRead: read.get(p.page) ?? 0 }))
    .filter((p) => p.figureLines >= MIN_FIGURE_LINES && p.rowsRead < p.figureLines / 3);
}

const key = (r: { source: { page: number; excerpt: string }; column?: string | null }) =>
  `${r.source.page}|${r.source.excerpt.toLowerCase().replace(/[^a-z0-9%]/g, "")}|${(r.column ?? "").toLowerCase()}`;

/** The document's reading with a page re-read's rows added; a row already read (same page, same words, same column) is not added twice. */
export function mergeReadings(base: CheckedReading, extra: CheckedReading): CheckedReading {
  const seen = new Set([...base.covers, ...base.benefits].map(key));
  return {
    ...base,
    covers: [...base.covers, ...extra.covers.filter((c) => !seen.has(key(c)))],
    benefits: [...base.benefits, ...extra.benefits.filter((b) => !seen.has(key(b)))],
    dropped: [...base.dropped, ...extra.dropped],
    // A note is a line that is no row's own line: in both readings, each worked out with only its own rows.
    ...(base.lifeNotes && extra.lifeNotes ? { lifeNotes: base.lifeNotes.filter((l) => extra.lifeNotes!.includes(l)) } : {}),
  };
}
