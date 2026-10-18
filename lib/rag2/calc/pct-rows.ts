/**
 * V1.5 (s52-live-1: the retrieved passage stopped at the table's first row; the leg row was on the next line of the same
 * page, so the proportion was refused and the turn ended without the calculation): a percentage table on ONE stored
 * page, reconstructed with the layout rules the tools already use -- a table row's cells are separated by a tab or by 3+
 * spaces (tables.ts / readTableRest), and the "% of ..." column header names what the percentages are of (percentBaseOf).
 * Each logical row keeps:
 *  - its continuation lines: a label wrapped onto the next line ("Jaw, Pelvis, Leg," / "Ankle or Knee   50%"), or a
 *    percentage printed on its own line below its label;
 *  - its table's own heading (the section heading above the header) and the header naming the base;
 *  - its exact span on the page (source identity: the same document, page and characters).
 * Nothing here chooses between rows that a condition does not single out: a tie, a row printing no percentage or two,
 * or the same row printed twice with different percentages is returned as unresolved, never as the first or the larger.
 */
export type PctRow = { label: string; percents: number[]; start: number; end: number; text: string; lines: number };
export type PctTable = { name: string | null; heading: string; header: string; base: string; headerStart: number; start: number; end: number; rows: PctRow[] };

const PCT_HEADER = /(?:%|per ?cent(?:age)?)\s+of\s+([^\n]{2,80}?)\)?\s*$/i;
const CELL_GAP = /\S(?:\t+| {3,})\S/;
const SECTION = /^\s*(?:section|part|schedule|table)\s+[\w.]+\s*[-–—:.]\s*(.+?)\s*$/i;
/** V1.5 (pr50-live D): a table extracted as plain text with single spaces -- "Bone fractured Compensation (% of S$5,000)"
 * then "Jaw, Pelvis, Leg, Ankle or Knee 50%" -- has no cell gap. Such a row is one label and exactly one percentage at
 * the END of the line (bullet stripped, no sentence punctuation), so a sentence that merely mentions a percentage never
 * reads as a row. */
const PLAIN_ROW = /^(?:[•▪●◦*\-–]\s*)?([^%\d.;:!?][^%;:!?]{0,78}?[^%\s.;:!?])\s+(\d+(?:\.\d+)?)\s*%$/;
const plainRow = (t: string) => PLAIN_ROW.exec(t.trim());
const pctsOf = (t: string) => (t.match(/(\d+(?:\.\d+)?)\s*%/g) ?? []).map((m) => Number(m.replace(/[%\s]/g, "")));

export function percentTables(page: string): PctTable[] {
  const lines: { text: string; start: number; end: number }[] = [];
  let at = 0;
  for (const t of page.split("\n")) { lines.push({ text: t, start: at, end: at + t.length }); at += t.length + 1; }
  const out: PctTable[] = [];
  let floor = 0; // the heading of a table never reaches back into the previous table
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i];
    const hm = PCT_HEADER.exec(h.text.trim());
    if (!hm || pctsOf(h.text).length) continue;
    const gapped = CELL_GAP.test(h.text) || h.text.includes("\t");
    // a plain-text header is a short column-header line (no sentence ending) immediately followed by a plain row
    const nextText = lines.slice(i + 1).find((l) => l.text.trim())?.text ?? "";
    const plain = !gapped && h.text.trim().length <= 100 && !/[.;!?]$/.test(h.text.trim()) && !!plainRow(nextText);
    // V1.5 (PR #51 review: the ACTUAL stored page 13): a column header wrapped over two lines -- "Schedule<TAB>Compensation"
    // then "(% of S$5,000)" on its own line. The "% of" line has no cell gap and the line with the cells has no "% of",
    // so neither alone was a header and the table was never found. The "% of" line continues the cell line above it.
    const prev = i > 0 ? lines[i - 1].text : "";
    const wrapped = !gapped && (CELL_GAP.test(prev) || prev.includes("\t")) && !/\d/.test(prev) && /^\(?\s*(?:%|per ?cent(?:age)?)\s+of\b/i.test(h.text.trim());
    if (!gapped && !plain && !wrapped) continue;
    const above = lines.slice(floor, i).filter((l) => l.text.trim()).slice(-4);
    const sectionLine = [...above].reverse().find((l) => SECTION.test(l.text));
    const rows: PctRow[] = [];
    let frag: typeof lines = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j], t = l.text.trim();
      if (!t) { if (rows.length || frag.length) break; continue; }
      if (PCT_HEADER.test(t) || SECTION.test(t)) break;
      const p = pctsOf(t);
      const cellLike = CELL_GAP.test(l.text) || l.text.includes("\t") || (plain && !!plainRow(t));
      const pctOnly = /^\d+(?:\.\d+)?\s*%$/.test(t);
      if (p.length) {
        if (!cellLike && !pctOnly) break; // a sentence that mentions a percentage ends the table
        if (pctOnly && !frag.length) break;
        const first = frag[0] ?? l;
        const label = [...frag.map((f) => f.text.trim()), t.replace(/^[•▪●◦*\-–]\s*/, "").replace(/(\d+(?:\.\d+)?)\s*%/g, " ").trim()].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim()
          // a footnote marker is not part of the case's name ("Leg^, Ankle", "# Arm , Elbow")
          .replace(/(?<=[A-Za-z])[\^*†‡]+(?=[\s,]|$)/g, "").replace(/^[#^*†‡]\s*/, "").replace(/\s+,/g, ",").replace(/\s{2,}/g, " ").trim();
        rows.push({ label, percents: p, start: first.start, end: l.end, text: page.slice(first.start, l.end), lines: frag.length + 1 });
        frag = [];
        continue;
      }
      if (cellLike) {
        // a row whose value cell prints no percentage ("see Note 2", "-"): kept as a row with none (incomplete)
        const first = frag[0] ?? l;
        rows.push({ label: [...frag.map((f) => f.text.trim()), t.split(/\t+| {3,}/)[0].trim()].join(" ").replace(/\s{2,}/g, " ").trim(), percents: [], start: first.start, end: l.end, text: page.slice(first.start, l.end), lines: frag.length + 1 });
        frag = [];
        continue;
      }
      // a label-only line: a wrapped label, when the table goes on right below it (at most two such lines)
      if (frag.length >= 2) break;
      frag.push(l);
    }
    if (!rows.length) continue;
    const end = rows[rows.length - 1].end;
    out.push({ name: sectionLine ? SECTION.exec(sectionLine.text)![1] : null, heading: above.map((l) => l.text.trim()).join("\n"), header: (wrapped ? prev.split(/\t+| {3,}/).map((c) => c.trim()).filter(Boolean).join(" ") + " " : "") + h.text.trim().replace(/\s{2,}/g, "  "), base: hm[1].trim(), headerStart: wrapped ? lines[i - 1].start : h.start, start: wrapped ? lines[i - 1].start : h.start, end, rows });
    floor = j;
    i = j - 1;
  }
  return out;
}

const GENERIC = new Set(["the", "and", "for", "with", "had", "has", "have", "his", "her", "its", "who", "what", "would", "could", "case", "any", "per", "not", "was", "were", "are", "one", "two", "from", "into", "onto", "that", "this", "than", "then", "there", "hypothetical", "hypothetically", "suppose", "benefit", "benefits", "payable", "compensation", "percentage", "percent", "table", "row", "section", "limit", "sum", "insured", "simple", "closed", "open", "compound", "fracture", "fractures", "fractured", "broken", "break", "broke", "injury", "injured", "accident", "accidental", "bone", "bones", "if", "of", "or", "to", "in", "on", "at", "by", "an", "a"]);
const stem = (w: string) => w.replace(/(?:ies)$/, "y").replace(/(?<=[a-z]{3})s$/, "");
const wordsOf = (t: string) => [...new Set((t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !GENERIC.has(w)).map(stem))];
/** The table a calculation's benefit names as its own: a table whose own section heading names every distinctive word
 * of the benefit ("Section D - Simple Fracture" for \"Simple Fracture\"; not \"Section 6 - Other Fracture\", whose text
 * merely mentions simple fractures). Without a section heading the table's heading lines are used. */
export function ownTables(tables: PctTable[], benefit: string): PctTable[] {
  const want = (benefit.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !["benefit", "benefits", "limit", "table", "compensation"].includes(w)).map(stem);
  if (!want.length) return tables;
  const named = tables.filter((t) => { const own = (t.name ?? t.heading).toLowerCase(); return want.every((w) => own.includes(w)); });
  return named.length ? named : tables;
}
export type RowChoice = { row: PctRow; table: PctTable } | { ambiguous: { row: PctRow; table: PctTable }[] } | { unresolved: string; row: PctRow; table: PctTable } | { none: { row: PctRow; table: PctTable }[] };
/** The ONE row the condition's own words name (\"... of the leg\" names \"Jaw, Pelvis, Leg, Ankle or Knee\"), in the table
 * the benefit names. A tie, or no row named, is never resolved; a named row that prints no single percentage, or is
 * printed again with a different percentage, is unresolved. */
/** Reliable chat (rc-live-1, RCT1a: "the shin bone" matched no row of "Leg - below the knee (tibia or fibula)"): the
 * everyday name of a bone also carries its anatomical name, which schedules print. Only adds words; never removes. */
const ANATOMY: Record<string, string[]> = {
  shin: ["tibia"], shinbone: ["tibia"], calf: ["fibula"], thigh: ["femur"], thighbone: ["femur"], kneecap: ["patella"],
  collarbone: ["clavicle"], breastbone: ["sternum"], tailbone: ["coccyx"], heel: ["calcaneus"], cheekbone: ["zygoma"],
  forearm: ["radius", "ulna"], jawbone: ["mandible"], skull: ["cranium"], backbone: ["vertebra", "vertebrae"], spine: ["vertebra", "vertebrae"],
};
function withAnatomy(words: string[]): string[] {
  return [...new Set([...words, ...words.flatMap((w) => (ANATOMY[w] ?? []).map(stem))])];
}
export function choosePercentRow(tables: PctTable[], benefit: string, condition: string): RowChoice {
  const pool = ownTables(tables, benefit).flatMap((table) => table.rows.map((row) => ({ row, table })));
  const benefitWords = new Set(wordsOf(benefit));
  const want = withAnatomy(wordsOf(condition)).filter((w) => !benefitWords.has(w));
  const scored = pool.map((x) => { const have = new Set(wordsOf(x.row.label)); return { ...x, hits: want.filter((w) => have.has(w)).length }; }).filter((x) => x.hits > 0);
  if (!scored.length) return { none: pool };
  const best = Math.max(...scored.map((x) => x.hits));
  const top = scored.filter((x) => x.hits === best);
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const distinct = [...new Map(top.map((x) => [norm(x.row.label) + "|" + x.table.headerStart, x])).values()];
  if (distinct.length > 1) {
    // the same row printed twice in one table with different percentages is a conflict, not a choice
    return { ambiguous: distinct.map(({ row, table }) => ({ row, table })) };
  }
  const { row, table } = distinct[0];
  const same = top.filter((x) => x.table === table && norm(x.row.label) === norm(row.label));
  const printed = [...new Set(same.flatMap((x) => x.row.percents))];
  if (same.length > 1 && printed.length > 1) return { unresolved: `the row “${row.label}” is printed more than once with different percentages (${printed.map((p) => p + "%").join(", ")})`, row, table };
  if (row.percents.length !== 1) return { unresolved: row.percents.length ? `the row “${row.label}” prints more than one percentage (${row.percents.map((p) => p + "%").join(", ")})` : `the row “${row.label}” prints no percentage`, row, table };
  return { row, table };
}

/** The reconstructed row a stored span lies in (its first character), if it is in one. */
export function rowAt(tables: PctTable[], start: number): { row: PctRow; table: PctTable } | null {
  for (const table of tables) for (const row of table.rows) if (row.start <= start && start <= row.end) return { row, table };
  return null;
}
/**
 * V1.5: why a percentage READ FOR A BENEFIT NAME (select_table_value / the server's own read) is not that benefit's
 * row, or null when it is. On a page whose percentage tables are reconstructed: the row must be in the table the
 * benefit names (never the adjacent Other Fracture table for "Simple Fracture"), and the benefit name must single that
 * row out ("Simple Fracture" names the table, not one of its six rows). Rows outside a reconstructed table: null.
 */
export function benefitRowProblem(page: string, start: number, benefit: string): string | null {
  const tables = percentTables(page);
  const at = rowAt(tables, start);
  if (!at) return null;
  if (!ownTables(tables, benefit).includes(at.table)) return `that row (“${at.row.label}”) is printed in the ${at.table.name ?? "another"} table, not in ${benefit}'s`;
  const choice = choosePercentRow([at.table], at.table.name ?? "", benefit);
  if (!("row" in choice) || "unresolved" in choice || choice.row !== at.row) return `“${benefit}” does not name the row “${at.row.label}” of the ${at.table.name ?? "percentage"} table (it names ${"none" in choice ? "no single row" : "another or more than one row"})`;
  return null;
}
