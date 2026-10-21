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
import { LEFT_OUT_AMOUNT, LEFT_OUT_FACT, matchMember } from "@/lib/simple-chat/verify";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";

export type ChatRow = TableRow & { id: string; docIndex: number; baseDocIndex: number | null };
/** `labels`: the server's own wording of each statement it wrote. The chat's checks keep exactly these words (verifyAnswer's
 * serverWords), and an amount whose statement does not read exactly one of them is refused (keepLabelledAmounts). */
export type RowReport = { dropped: { why: string; text: string }[]; labels: string[] };

/** Said when the table has no rows yet, so a missing amount is never silent. */
export const NO_ROWS_YET = "Amounts are not shown yet: your documents have not been read into your Coverage page. They appear there, and here, once they have.";

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
  const report: RowReport = { dropped: [], labels: [] };
  if (!json || typeof json !== "object" || !Array.isArray((json as { statements?: unknown }).statements)) return { json, report };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const statements: unknown[] = [];
  const given = new Set<string>();
  for (const raw of (json as { statements: Record<string, unknown>[] }).statements) {
    if (!raw || typeof raw !== "object" || raw.kind !== "amount") { statements.push(raw); continue; }
    const text = typeof raw.text === "string" ? raw.text : "";
    const row = typeof raw.row === "string" ? byId.get(raw.row.trim().toUpperCase()) : undefined;
    if (!row) { report.dropped.push({ why: raw.row ? "no such row in the benefit table" : "an amount with no table row", text }); continue; }
    const person = matchMember(household, typeof raw.person === "string" ? raw.person : null);
    if (!person || person !== baseName(row.person)) { report.dropped.push({ why: `the row is ${row.person}'s, not ${raw.person ?? "nobody's"}`, text }); continue; }
    // A label carries the row's names past the money filter, so a name that states money is never labelled (Critic R92-2).
    if (nameStatesMoney(row.benefit) || nameStatesMoney(row.qualifier ?? "") || nameStatesMoney(row.product, "product") || nameStatesMoney(row.cover, "product") || nameStatesMoney(row.plan ?? "", "plan")) {
      report.dropped.push({ why: `row ${row.id}'s name states money`, text }); continue;
    }
    // The same row named twice is given once (Critic R91-3).
    if (given.has(row.id)) continue;
    given.add(row.id);
    const st = statementFromRow(row, raw);
    if (st) { statements.push(st); report.labels.push(String(st.text)); }
    else report.dropped.push({ why: `row ${row.id} has no amount (${figureText(row.figure)})`, text });
  }
  if (!rows.length && report.dropped.length)
    statements.push({ kind: "uncertainty", text: NO_ROWS_YET, person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
  return { json: { ...(json as object), statements }, report };
}

/** What a row is, in the server's words only: its benefit and cover, whom it is for, how it is paid, and whether it is
 * a projection. The model's own sentence is not used for an amount, so a figure is never labelled as another benefit. */
export function rowLabel(row: ChatRow): string {
  const f = row.figure;
  const cover = [row.product, row.cover !== row.product ? row.cover : null, row.plan ? `plan ${row.plan}` : null].filter(Boolean).join(", ");
  const how = f.kind === "printed" ? (f.unit === "per_day" ? "paid per day" : f.unit === "per_period" ? `paid per ${(f.period ?? "period").replace("_", " ")}` : f.unit === "up_to" ? "up to this limit" : null)
    : f.kind === "value" ? `a value${f.asOf ? ` as of ${f.asOf}` : ", date not printed"}`
    : f.kind === "projected" ? `projected, not guaranteed${f.asOf ? ` (${f.asOf})` : ""}`
    : f.kind === "worked_out" && row.percent != null ? `${row.percent}% of ${row.percentOf === "sum_insured" ? "the sum insured" : "the amount printed"}, ${f.capped ? "up to this limit" : "worked out"}` : null;
  return `${row.benefit} (${cover})${row.qualifier ? `, for ${row.qualifier} only` : ""}${how ? `: ${how}` : ""}.`;
}

/** A word before a number that makes it an identifier, not money: "Plan 300", "Policy No. 3037850", "Certificate 000123". */
const ID_BEFORE = /(?:\b(?:no|nos|number|plan|option|policy|certificate|cert|scheme|section|ward|class|part|clause|schedule|version|ref|reference|code|id|tier|level)\.?|#)\s*:?\s*$/i;
const NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|million|billion)\b/i;

/** A name states money when it prints a currency figure ("S$1,000,000", "$500"), a figure grouped in thousands
 * ("1,000,000", "1 000 000", "1.000.000"), a size word ("1 million", "5k"), dollars with a number ("one million dollars"),
 * a rate ("200 per day", "200/day"), a limit or sum ("up to 5000", "of 600000", "Sum insured: 300000") or a bare figure of
 * five or more digits ("Accidental death 200000"). A benefit's own name also states money with any other bare number of
 * 100 or more ("Room & Board 300"), unless it counts days, visits or claims (Critic R94, TE #96). Products and covers are
 * often named with a number ("Shield 360", "Smart Life 100", "MER 1500"), so for them, and for plans, a bare number needs
 * one of those money cues. A number is a name's own when it is glued to letters or signs ("G007500", "SG-2026-001234"),
 * starts with 0, is a year, or follows a word that numbers things ("Plan 300", "Policy No. 3037850"). */
export function nameStatesMoney(name: string, role: "benefit" | "product" | "plan" = "benefit"): boolean {
  const t = (name ?? "").normalize("NFKC");
  if (moneyFiguresIn(t).length || /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/.test(t) || /\b\d{1,3}(?:\.\d{3}){2,}\b/.test(t) || /(?<![\w.,/-])\d{1,3}(?: \d{3})+(?![\w.,/-])/.test(t)) return true;
  if (/\d(?:[\d,.]*\d)?\s*(?:k|m|mn|mil|million|thousand|grand|bn|billion|lakhs?|crores?)\b/i.test(t)) return true;
  if (/\b(?:dollars?|SGD|USD|lakhs?|crores?)\b/i.test(t) && (/\d/.test(t) || NUMBER_WORD.test(t))) return true;
  if (/\d{2,}\s*(?:per|\/|a|an|each)\s*(?:day|night|visit|week|month|year|annum|trip|accident|event)\b/i.test(t)) return true;
  if (role === "plan") return false;
  if (/\b(?:up\s+to|limit|max(?:imum)?|of|sum\s+(?:insured|assured)|benefit\s+amount|lump\s+sum|payable)\s*:?\s*\d{2,}/i.test(t)) return true;
  for (const m of t.matchAll(/(?<![\w.,/-])\d+(?:\.\d+)?(?![\w,/-]|\.\d)/g)) {
    if (!(Number(m[0]) >= 100) || /^0\d/.test(m[0]) || /^(?:19|20)\d\d$/.test(m[0]) || ID_BEFORE.test(t.slice(0, m.index))) continue;
    // A count of days, visits or claims is not money ("Benefit 365 days").
    if (/^\s*(?:-\s*)?(?:calendar\s+)?(?:days?|nights?|weeks?|months?|years?|hours?|visits?|sessions?|claims?|times|treatments?|km|kilometres?|miles?|%)\b/i.test(t.slice(m.index! + m[0].length))) continue;
    if (role === "benefit" || m[0].replace(/\.\d+$/, "").length >= 5) return true;
  }
  return false;
}

/** Applied to the checked answer: an amount whose statement is not exactly one of the server's labels lost its label to
 * the checks (or was never labelled), so its amount is refused. */
export function keepLabelledAmounts<T extends { amount?: unknown; text: string }>(statements: T[], report: RowReport): { kept: T[]; refused: T[] } {
  const labels = new Set(report.labels);
  const refused = statements.filter((st) => st.amount && !labels.has(st.text));
  return { kept: statements.filter((st) => !refused.includes(st)), refused };
}

/** Applied last: an amount the row step dropped or refused never reached verifyAnswer, so its "left out an amount" note
 * is added here (in place of the weaker "left out a point"), and the household always hears that an amount was left out. */
export function noteLeftOutAmounts<T extends { id: string; kind: string; text: string }>(statements: T[], report: RowReport, make: (id: string, text: string) => T): T[] {
  if (!report.dropped.length || statements.some((s) => s.id === "left-out-amount")) return statements;
  return [...statements.filter((s) => !(s.id === "left-out-fact" && s.text === LEFT_OUT_FACT)), make("left-out-amount", LEFT_OUT_AMOUNT)];
}

/** One row as a statement the simple chat's checks understand: the figure as printed with the row's own words, or the
 * percentage with the base it is worked out on and the words that print that base. */
function statementFromRow(row: ChatRow, raw: Record<string, unknown>): Record<string, unknown> | null {
  const f = row.figure;
  const said = rowLabel(row);
  const base = { ...raw, text: said, person: baseName(row.person), document: documentId(row.docIndex), quote: row.source.excerpt, amount: null, percentOf: null };
  if (f.kind === "none") return null;
  if (f.kind !== "worked_out") return { ...base, amount: money(f.amount, f.currency) };
  // Capped: the amount is the printed cap, checked against the words that print it.
  if (f.capped) return row.capSource ? { ...base, quote: row.capSource.excerpt, amount: money(f.amount, f.currency) } : null;
  if (row.percent == null || row.base == null) return null;
  // A sum insured the household corrected is not printed anywhere, so the checks cannot find it: the row is given as its
  // printed percentage, with where the amount is shown.
  if (row.baseCorrected)
    return { ...base, kind: "fact", text: `${said.replace(/\.$/, "")}, on the sum insured you corrected on the Coverage page, which shows the amount.`, alternativeGroup: null, perDay: null, ofBill: null };
  const own = row.baseSource && row.baseSource.page === row.source.page && row.baseSource.documentId === row.source.documentId;
  return { ...base, percentOf: { percent: row.percent, baseAmount: money(row.base, f.currency),
    baseDocument: own || row.baseDocIndex == null ? null : documentId(row.baseDocIndex), baseQuote: own || !row.baseSource ? null : row.baseSource.excerpt } };
}
