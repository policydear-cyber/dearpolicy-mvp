/** The order of a document's benefit rows on the Benefits pages. The database sorts names as text, so a table's numbered
 * rows came out "1. …, 10. …, 11. …, 2. …, 20. …, 3. …". Within each run of rows the query already put together (same
 * review state, same product), names are compared with their numbers as numbers ("2. Loss of sight" before "10. Loss of
 * fingers"), then by page and plan column, as the query did. Rows are never moved across runs. */
const NAMES = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export type OrderedRow = { needs_review: boolean; product_name: string | null; original_filename?: string | null; benefit_name: string; source_page: number | null; tier?: string | null };

export function inNumberedOrder<T extends OrderedRow>(rows: T[]): T[] {
  const runKey = (r: T) => (r.needs_review ? "1" : "0") + "\u0000" + (r.product_name ?? r.original_filename ?? "");
  const out: T[] = [];
  for (let i = 0; i < rows.length;) {
    let j = i + 1;
    while (j < rows.length && runKey(rows[j]) === runKey(rows[i])) j++;
    out.push(...rows.slice(i, j).map((r, k) => [r, k] as const).sort(([a, ka], [b, kb]) =>
      NAMES.compare(a.benefit_name, b.benefit_name) || (a.source_page ?? 0) - (b.source_page ?? 0) || NAMES.compare(a.tier ?? "", b.tier ?? "") || ka - kb).map(([r]) => r));
    i = j;
  }
  return out;
}
