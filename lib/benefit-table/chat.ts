/** Ask DearPolicy on the benefit table: the chat's amounts come only from each person's table rows. Pure.
 *
 * The table is shown to the model as numbered rows (R1, R2, ...) next to the documents. The model never types an amount:
 * an amount statement names a row, and the server writes that row's figure, person and page into the statement before
 * the simple chat's own checks (lib/simple-chat/verify.ts, unchanged) re-check it against the stored pages. An amount
 * statement without a row, with a row that does not exist, or with another person's row is dropped. So every amount the
 * household sees in the chat is an amount on their Coverage page, checked twice. */
import type { BenefitTable, TableRow } from "./assemble";
import { figureText } from "./assemble";
import type { Household } from "@/lib/simple-chat/library";
import { documentId, escapeText } from "@/lib/simple-chat/library";
import { matchMember } from "@/lib/simple-chat/verify";

export type ChatRow = TableRow & { id: string; docIndex: number; baseDocIndex: number | null };
export type RowReport = { dropped: { why: string; text: string }[] };

const SIGN: Record<string, string> = { SGD: "S$", USD: "US$", MYR: "RM", HKD: "HK$" };
const money = (n: number, currency: string | null) => `${currency ? SIGN[currency] ?? currency + " " : "$"}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const baseName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

/** Every person's rows, numbered, with the library index of the document each row (and its base) is printed in. A row
 * whose document is not in the library (removed since) is left out. */
export function chatRows(table: BenefitTable, household: Household): ChatRow[] {
  const index = new Map(household.documents.map((d, i) => [d.policyId, i]));
  const rows: ChatRow[] = [];
  for (const p of table.people) for (const r of p.rows) {
    const docIndex = index.get(r.source.documentId);
    if (docIndex == null) continue;
    rows.push({ ...r, id: `R${rows.length + 1}`, docIndex, baseDocIndex: r.baseSource ? index.get(r.baseSource.documentId) ?? null : null });
  }
  return rows;
}

/** The table as the model sees it: what each row is and what it shows, never a figure the Coverage page does not show. */
export function renderTable(rows: ChatRow[]): string {
  if (!rows.length) return "";
  const line = (r: ChatRow) => [r.id, r.person, [r.product, r.cover !== r.product ? r.cover : null, r.plan ? `plan ${r.plan}` : null].filter(Boolean).join(" / "),
    r.benefit, r.qualifier ? `for ${r.qualifier}` : null, figureText(r.figure), r.conditions.length ? `conditions: ${r.conditions.join("; ")}` : null,
    `${documentId(r.docIndex)} page ${r.source.page}`].filter(Boolean).join(" | ");
  return `\n<benefit_table>
Each person's benefit table, as their Coverage page shows it. One row per line: id | person | cover | benefit | qualifier | figure | conditions | where printed.
For every "amount" statement, set "row" to the id of the row it gives and leave "amount" and "percentOf" null: the app fills in the row's figure. Give only amounts that are a row here; an amount no row shows is not given (say in a "fact" what the documents print instead). The person must be that row's person. A row "for child" or "per family" is only that; say so in the text. A projected figure is not guaranteed; say so.
${rows.map((r) => escapeText(line(r))).join("\n")}
</benefit_table>`;
}

/** The model's raw reply with every amount statement rewritten from its row, before readModelAnswer and verifyAnswer see
 * it. Statements of other kinds are left as they are. */
export function amountsFromRows(json: unknown, rows: ChatRow[], household: Household): { json: unknown; report: RowReport } {
  const report: RowReport = { dropped: [] };
  if (!json || typeof json !== "object" || !Array.isArray((json as { statements?: unknown }).statements)) return { json, report };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const statements: unknown[] = [];
  for (const raw of (json as { statements: Record<string, unknown>[] }).statements) {
    if (!raw || typeof raw !== "object" || raw.kind !== "amount") { statements.push(raw); continue; }
    const text = typeof raw.text === "string" ? raw.text : "";
    const row = typeof raw.row === "string" ? byId.get(raw.row.trim().toUpperCase()) : undefined;
    if (!row) { report.dropped.push({ why: raw.row ? "no such row in the benefit table" : "an amount with no table row", text }); continue; }
    const person = matchMember(household, typeof raw.person === "string" ? raw.person : null);
    if (!person || person !== baseName(row.person)) { report.dropped.push({ why: `the row is ${row.person}'s, not ${raw.person ?? "nobody's"}`, text }); continue; }
    const st = statementFromRow(row, raw, text);
    if (st) statements.push(st); else report.dropped.push({ why: `row ${row.id} has no amount (${figureText(row.figure)})`, text });
  }
  return { json: { ...(json as object), statements }, report };
}

/** One row as a statement the simple chat's checks understand: the figure as printed with the row's own words, or the
 * percentage with the base it is worked out on and the words that print that base. */
function statementFromRow(row: ChatRow, raw: Record<string, unknown>, text: string): Record<string, unknown> | null {
  const f = row.figure;
  const said = [row.qualifier ? `For ${row.qualifier}:` : null, f.kind === "projected" ? "Projected, not guaranteed:" : null, text].filter(Boolean).join(" ");
  const base = { ...raw, text: said, person: baseName(row.person), document: documentId(row.docIndex), quote: row.source.excerpt, amount: null, percentOf: null };
  if (f.kind === "none") return null;
  if (f.kind !== "worked_out") return { ...base, amount: money(f.amount, f.currency) };
  if (row.percent == null || row.base == null) return null;
  // A sum insured the household corrected is not printed anywhere, so the checks cannot find it: the row is given as its
  // printed percentage, with where the amount is shown.
  if (row.baseCorrected)
    return { ...base, kind: "fact", text: `${said} (${row.percent}% of the sum insured you corrected on the Coverage page, which shows the amount.)`, alternativeGroup: null, perDay: null, ofBill: null };
  const own = row.baseSource && row.baseSource.page === row.source.page && row.baseSource.documentId === row.source.documentId;
  return { ...base, percentOf: { percent: row.percent, baseAmount: money(row.base, f.currency),
    baseDocument: own || row.baseDocIndex == null ? null : documentId(row.baseDocIndex), baseQuote: own || !row.baseSource ? null : row.baseSource.excerpt } };
}
