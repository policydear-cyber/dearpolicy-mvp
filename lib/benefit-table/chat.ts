/** Ask DearPolicy on the benefit table: the chat's amounts come only from each person's table rows. Pure.
 *
 * The table is shown to the model as numbered rows (R1, R2, ...) next to the documents. The model never types an amount:
 * an amount statement names a row, and the server writes that row's figure, person and page into the statement before
 * the simple chat's own checks (lib/simple-chat/verify.ts, unchanged) re-check it against the stored pages. An amount
 * statement without a row, with a row that does not exist, or with another person's row is dropped. So every amount the
 * household sees in the chat is an amount on their Coverage page, checked twice. */
import type { BenefitTable, Figure, PersonCover, TableRow } from "./assemble";
import type { Source } from "./check";
import { figureText } from "./assemble";
import type { Household } from "@/lib/simple-chat/library";
import { documentId, escapeText } from "@/lib/simple-chat/library";
import { LEFT_OUT_AMOUNT, LEFT_OUT_FACT, locateQuote, matchMember, rowWithContinuation } from "@/lib/simple-chat/verify";
import { CAP_WORDS } from "./check";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";

export type ChatRow = TableRow & { id: string; docIndex: number; baseDocIndex: number | null };
/** `labels`: the server's own wording of each statement it wrote. The chat's checks keep exactly these words (verifyAnswer's
 * serverWords), and an amount whose statement does not read exactly one of them is refused (keepLabelledAmounts). */
export type RowReport = { dropped: { why: string; text: string }[]; labels: string[];
  /** For each label of a daily row: the first paid day and the most days the table read for it (one entry per row). */
  days?: Record<string, { fromDay: number | null; maxDays: number | null; alone: boolean }[]> };

/** Said when the table has no rows yet, so a missing amount is never silent. */
export const NO_ROWS_YET = "Amounts are not shown yet: your documents have not been read into your Coverage page. They appear there, and here, once they have.";

const SIGN: Record<string, string> = { SGD: "S$", USD: "US$", MYR: "RM", HKD: "HK$" };
const money = (n: number, currency: string | null) => `${currency ? SIGN[currency] ?? currency + " " : "$"}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const baseName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

/** Every person's rows, numbered, with the library index of the document each row (and its base) is printed in. A row
 * whose document is not in the library (removed since) is left out. After the benefit rows come each person's own cover
 * lines as the Coverage page shows them: the sum insured and the premium their personal document prints (release-set A3,
 * A6), so those amounts too come only from a row. */
export function chatRows(table: BenefitTable, household: Household): ChatRow[] {
  const index = new Map(household.documents.map((d, i) => [d.policyId, i]));
  const rows: ChatRow[] = [];
  const add = (r: TableRow) => {
    const docIndex = index.get(r.source.documentId);
    if (docIndex == null) return;
    rows.push({ ...r, id: `R${rows.length + 1}`, docIndex, baseDocIndex: r.baseSource ? index.get(r.baseSource.documentId) ?? null : null });
  };
  for (const p of table.people) for (const r of p.rows) add(r);
  // One premium per policy and person: a schedule read as two covers (a benefit and its death benefit) prints one premium.
  const premiums = new Set<string>();
  for (const p of table.people) for (const c of p.covers) for (const r of coverRows(c, p.name)) {
    if (r.benefit === premiumName(c)) {
      const key = [p.id, c.product, c.premium, (c.premiumSource ?? c.source).documentId, (c.premiumSource ?? c.source).excerpt].join("|");
      if (premiums.has(key)) continue;
      premiums.add(key);
    }
    add(r);
  }
  return rows;
}

/** The words a cover is named by on an answer card: the full product, cover and plan, as printed ("MINDEF & MHA GROUP
 * INSURANCE SCHEME (GROUP POLICY NO. G007500), GROUP TERM LIFE(POLICY NO.3037850)"). */
const fullCover = (r: Pick<TableRow, "product" | "cover" | "plan">) => [r.product, r.cover !== r.product ? r.cover : null, r.plan ? `plan ${r.plan}` : null].filter(Boolean).join(", ");
const COVER_KIND = /\b(?:life|death|accident\w*|illness\w*|critical|disab\w*|tpd|hospital\w*|medical|medicare|health|surg\w*|ward|cancer|travel|income|care|term|endowment|annuity|savings|retirement|motor|car|home|property|shield|rider|benefit)\b/i;
const noNumbers = (s: string) => s.replace(/\s*\(\s*(?:group\s+)?(?:policy|certificate|cert)\.?\s*(?:no|number)\b[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
/** Each cover's short name for an answer card, keyed by its full printed name (fullCover): the cover's own words without a
 * printed policy number, with its plan ("GROUP TERM LIFE"). When two covers would read the same, the product is added;
 * when that still reads the same, the full printed names are kept. The citation under the card names the document and page. */
export function coverLabels(rows: Pick<TableRow, "product" | "cover" | "plan">[]): Map<string, string> {
  const covers = [...new Map(rows.map((r) => [fullCover(r), r])).values()];
  type C = (typeof covers)[number];
  const unique = (name: (c: C) => string) => {
    const count = new Map<string, number>();
    for (const c of covers) count.set(name(c), (count.get(name(c)) ?? 0) + 1);
    return (c: C) => count.get(name(c)) === 1;
  };
  const short = (c: C) => [noNumbers(c.cover !== c.product ? c.cover : c.product) || c.cover, c.plan ? `plan ${c.plan}` : null].filter(Boolean).join(", ");
  const withProduct = (c: C) => c.cover !== c.product ? `${short(c)}, ${noNumbers(c.product) || c.product}` : short(c);
  const shortUnique = unique(short), productUnique = unique(withProduct);
  // A cover name that says no kind of cover ("Single Trip") keeps its product, so the card still says what it is (Critic R117-1).
  const saysKind = (c: C) => COVER_KIND.test(short(c));
  const picked = covers.map((c) => [c, shortUnique(c) && saysKind(c) ? short(c) : productUnique(c) ? withProduct(c) : fullCover(c)] as const);
  // Two different rules can still land on the same words ("Life, Beta" as a cover, and "Life" in product Beta): any label
  // used twice falls back to the full printed name (TE #99).
  const used = new Map<string, number>();
  for (const [, l] of picked) used.set(l, (used.get(l) ?? 0) + 1);
  return new Map(picked.map(([c, l]) => [fullCover(c), used.get(l)! > 1 ? fullCover(c) : l]));
}

/** A premium row's name: the premium line's own words ("Instalment Premium"), and how often it is paid when printed. */
const premiumName = (c: PersonCover) => `${c.premiumLabel || "Premium"}${c.premiumFrequency ? `, ${c.premiumFrequency}` : ""}`;

/** A cover's own printed figures as rows: its sum insured (as of the date printed with it) and its premium. A sum insured
 * the household corrected is not printed anywhere, so that row has no amount (the Coverage page shows the correction). */
function coverRows(c: PersonCover, person: string): TableRow[] {
  const row = (benefit: string, figure: Figure, source: Source): TableRow => ({ personId: c.personId, person, coverKey: c.coverKey, product: c.product, cover: c.cover,
    plan: c.plan, benefit, section: null, column: null, pays: "amount", figure, fromDay: null, maxDays: null, conditions: [], source, baseSource: null,
    linkWhy: "the person's own cover line", qualifier: null, percent: null, base: null, baseCorrected: false, percentOf: null, capSource: null });
  const out: TableRow[] = [];
  if (c.sumInsured != null) {
    const corrected = c.confirmation?.status === "corrected";
    out.push(row(`Sum insured${c.asOf ? `, dated ${c.asOf}` : ""}`, corrected ? { kind: "none", why: "corrected by you on the Coverage page" }
      : { kind: "printed", amount: c.sumInsured, currency: c.currency, unit: "lump_sum" }, c.source));
  }
  if (c.premium != null)
    out.push(row(premiumName(c), { kind: "printed", amount: c.premium, currency: c.currency, unit: "lump_sum" }, c.premiumSource ?? c.source));
  return out;
}

/** The table as the model sees it: what each row is and what it shows, never a figure the Coverage page does not show. */
/** The pages the rows come from (each row's own page, its base's and its cap's), as `${policyId}#${page}`: what the
 * chat sends with the table instead of the whole library. */
export function citedPages(rows: ChatRow[]): Set<string> {
  return new Set(rows.flatMap((r) => [r.source, r.baseSource, r.capSource].flatMap((s) => (s ? [`${s.documentId}#${s.page}`] : []))));
}

/** Wording that can stop a benefit being paid: a waiting or survival period, an exclusion, a pre-existing condition, or a
 * "will not pay". A page that prints it is sent for every document a row comes from, cited or not (Critic R113-1). */
export const RULE_PAGE = /\bwaiting\s+period|\bexclusions?\b|pre-?\s?existing|\bwill\s+not\s+pay\b|\bdoes\s+not\s+cover\b|\bnot\s+covered\b|\bsurvival\s+period|\bnot\s+(?:be\s+)?payable\b|\bnot\s+be\s+liable\b/i;

/** What the chat sends with the table: the pages its rows come from, and every page of those documents that prints a
 * rule that can stop a payment (RULE_PAGE). Keys as in citedPages. */
export function pagesToSend(rows: ChatRow[], household: Household): Set<string> {
  const sent = citedPages(rows);
  const docs = new Set([...sent].map((k) => k.slice(0, k.indexOf("#"))));
  for (const d of household.documents)
    if (docs.has(d.policyId)) for (const p of d.pages) if (RULE_PAGE.test(p.text)) sent.add(`${d.policyId}#${p.page}`);
  return sent;
}

/** Said on every answer that gives an amount while the chat was sent only some pages (Critic R113-1): a fixed server
 * note, whatever the model wrote. No figure in it. */
export const NARROWED_PAGES_NOTE = "Waiting periods, exclusions and other conditions can be printed on pages not used for this answer. Check the full document, or ask the insurer, before you claim.";
export function noteNarrowedPages<T extends { id: string; kind: string; text: string; amount?: unknown }>(statements: T[], make: (id: string, text: string) => T): T[] {
  if (!statements.some((s) => s.amount) || statements.some((s) => s.id === "narrowed-pages")) return statements;
  return [...statements, make("narrowed-pages", NARROWED_PAGES_NOTE)];
}

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
  const report: RowReport = { dropped: [], labels: [], days: {} };
  if (!json || typeof json !== "object" || !Array.isArray((json as { statements?: unknown }).statements)) return { json, report };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labels = coverLabels(rows);
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
    const st = statementFromRow(row, raw, labels);
    if (st) {
      statements.push(st); report.labels.push(String(st.text));
      if (row.figure.kind === "printed" && row.figure.unit === "per_day")
        (report.days![String(st.text)] ??= []).push({ fromDay: row.fromDay, maxDays: row.maxDays, alone: dailyRateAlone(row, household) });
    }
    else report.dropped.push({ why: `row ${row.id} has no amount (${figureText(row.figure)})`, text });
  }
  if (!rows.length && report.dropped.length)
    statements.push({ kind: "uncertainty", text: NO_ROWS_YET, person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
  return { json: { ...(json as object), statements }, report };
}

/** Whether a daily row's printed words (its line, the lines that continue it, and its quote) hold no limit but its most
 * days: no money figure other than the daily rate, and no cap word once "max 30 days" is taken out. A stay is never worked
 * out past an overall limit ("S$100 a day, max 30 days, overall limit S$2,000", Critic R108-1). */
const MAX_DAYS = /\b(?:up\s+to\s+(?:a\s+)?)?max(?:imum)?\.?\s*(?:of\s*)?:?\s*(?:[a-z-]+\s*)?\(?\d+\)?\s*(?:continuous\s+)?days?\b/gi;
function dailyRateAlone(row: ChatRow, household: Household): boolean {
  if (row.figure.kind !== "printed") return false;
  const found = locateQuote(household, row.source.excerpt, row.docIndex);
  const page = found && household.documents[found.docIndex].pages.find((p) => p.page === found.page);
  if (!found || !page) return false;
  const words = `${rowWithContinuation(page.text, found.offset)}\n${found.excerpt}`;
  const daily = row.figure.amount;
  if (moneyFiguresIn(words).some((f) => Math.abs(f.value - daily) > 0.005)) return false;
  const rest = words.replace(MAX_DAYS, " ");
  return !CAP_WORDS.test(rest) && !/\b(?:limit|aggregate|overall|in\s+total)\b/i.test(rest);
}

/** What a row is, in the server's words only: its benefit and cover, whom it is for, how it is paid, and whether it is
 * a projection. The model's own sentence is not used for an amount, so a figure is never labelled as another benefit. */
export function rowLabel(row: ChatRow, labels?: Map<string, string>): string {
  const f = row.figure;
  const cover = labels?.get(fullCover(row)) ?? fullCover(row);
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
 * the checks (or was never labelled), so its amount is refused. One exception: what a stay the household described could
 * pay under a labelled daily row (the checks' own "For a 12-day stay ..." card, release-set B3, H4), kept only when every
 * row with that label was read with the same most days and first paid day the checks found printed. */
export function keepLabelledAmounts<T extends { id?: string; amount?: unknown; text: string; basis?: string | null }>(statements: T[], report: RowReport): { kept: T[]; refused: T[] } {
  const labels = new Set(report.labels);
  const stayOf = (st: T) => {
    if (!st.id?.endsWith("-stay")) return false;
    const parent = statements.find((s) => s.id === st.id!.slice(0, -"-stay".length));
    const rule = /paid from day (\d+), for at most (\d+) days/.exec(st.basis ?? "");
    const rows = parent && labels.has(parent.text) ? report.days?.[parent.text] ?? [] : [];
    return !!rule && rows.length > 0 && rows.every((r) => r.alone && r.maxDays === Number(rule[2]) && (r.fromDay == null || r.fromDay === Number(rule[1])));
  };
  const refused = statements.filter((st) => st.amount && !labels.has(st.text) && !stayOf(st));
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
function statementFromRow(row: ChatRow, raw: Record<string, unknown>, labels: Map<string, string>): Record<string, unknown> | null {
  const f = row.figure;
  const said = rowLabel(row, labels);
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
