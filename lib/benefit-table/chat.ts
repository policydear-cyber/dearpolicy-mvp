/** Ask DearPolicy on the benefit table: the chat's amounts come only from each person's table rows. Pure.
 *
 * The table is shown to the model as numbered rows (R1, R2, ...) next to the documents. The model never types an amount:
 * an amount statement names a row, and the server writes that row's figure, person and page into the statement before
 * the simple chat's own checks (lib/simple-chat/verify.ts, unchanged) re-check it against the stored pages. An amount
 * statement without a row, with a row that does not exist, or with another person's row is dropped. So every amount the
 * household sees in the chat is an amount on their Coverage page, checked twice. */
import type { BenefitTable, Figure, PersonCover, TableRow } from "./assemble";
import type { Source } from "./check";
import { figureText, periodWords } from "./assemble";
import { benefitName, benefitNames } from "./headline";
import type { Household } from "@/lib/simple-chat/library";
import { documentId, escapeText, unreadable } from "@/lib/simple-chat/library";
import { type ServerFigure, LEFT_OUT_AMOUNT, LEFT_OUT_FACT, childrenSaid, conditionApplies, locateQuote, matchMember, membersNamedIn, readModelAnswer, rowWithContinuation, sentences, statesMoney, stayBlock, STAY_BLOCK_WORDS, MAX_DAY_FIELD, verifyAnswer } from "@/lib/simple-chat/verify";
import { CAP_WORDS } from "./check";
import { printedDay, singaporeDay } from "./dates";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";
import { MONEY_SIGN, anyMoneyFigures, statedCurrencyCode } from "@/lib/format/currency";
import { PREMIUM } from "@/lib/coverage/table-figures";

export type ChatRow = TableRow & { id: string; docIndex: number; baseDocIndex: number | null;
  /** The limit's own line, or the same benefit's line for the same figure in another of the person's documents, says the
   * cost is paid when it is less ("up to $10,000 of the costs ..., whichever is lesser", release-set H7). */
  lesserOf?: boolean;
  /** The date the person's cover started, as its own cover line prints it (a start date, or the date the line is printed
   * for): a cover this new may still be inside a waiting period. */
  coverSince?: string | null;
  /** The row's own conditions are always on its card (a total limit's printed sentence: totalLimitRows). */
  scopeOnCard?: boolean;
  /** The row is a premium the household pays, as its cover line prints it (coverRows: the premium, its parts, the first
   * year's premium). Set only there: a row made any other way is never a premium here. */
  premium?: true };
/** `labels`: the server's own wording of each statement it wrote. The chat's checks keep exactly these words (verifyAnswer's
 * serverWords), and an amount whose statement does not read exactly one of them is refused (keepLabelledAmounts). */
export type RowReport = { dropped: { why: string; text: string; notFit?: boolean; row?: string }[]; labels: string[];
  /** For each label of a daily row: the first paid day and the most days the table read for it (one entry per row). */
  days?: Record<string, { fromDay: number | null; maxDays: number | null; alone: boolean }[]>;
  /** Each "<benefit> also depends on this: <condition>" point, with the condition's own words and the rows whose cards it
   * is said for; and each row's card as given (its label and person). Read by dropConditionsOnCards. */
  conditionPoints?: { text: string; condition: string; rows: string[] }[];
  cards?: Record<string, { text: string; person: string | null }>;
  /** The labels given only for premium rows (ChatRow.premium): an answer whose every amount is one of these gives no benefit
   * amount (noteNarrowedPages). */
  premiumLabels?: string[];
  /** The percentage rows worked out on a person's own sum insured, as pointers the chat's checks verify and work out again
   * (verifyAnswer's serverFigures). */
  figures?: ServerFigure[] };

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
    const row: ChatRow = { ...r, id: `R${rows.length + 1}`, docIndex, baseDocIndex: r.baseSource ? index.get(r.baseSource.documentId) ?? null : null };
    // Only a premium line coverRows made is a premium; a row copied from one (a rate, an intensive-care row) is not.
    if (PREMIUM_LINES.has(r)) row.premium = true; else delete row.premium;
    rows.push(row);
  };
  for (const p of table.people) for (const r of p.rows) add(r);
  // One premium per policy and person: a schedule read as two covers (a benefit and its death benefit) prints one premium.
  const premiums = new Set<string>();
  // First-year premiums come last, so the other rows keep their numbers.
  const firstYears: TableRow[] = [];
  // A premium's parts come after every other row (below), so recorded answers keep their row numbers.
  const parts: TableRow[] = [];
  for (const p of table.people) for (const c of p.covers) for (const r of coverRows(c, p.name)) {
    const firstYear = r.source === c.firstYearSource;
    const part = c.premiumParts?.some((x) => x.source === r.source) ?? false;
    if (r.benefit === premiumName(c) || firstYear || part) {
      const key = [p.id, firstYear ? "first year" : part ? `part ${r.benefit}` : "premium", c.product, c.premium, (c.premiumSource ?? c.source).documentId, (c.premiumSource ?? c.source).excerpt].join("|");
      if (premiums.has(key)) continue;
      premiums.add(key);
    }
    if (firstYear) firstYears.push(r); else if (part) parts.push(r); else add(r);
  }
  for (const r of firstYears) add(r);
  // A limit whose own line prints one daily rate ("Capped at S$200 per day" over "S$8,000") pays that rate a day, up to the
  // limit: the rate is a row of its own after it, so the card for "how much a day" is the rate, never the limit (stress run
  // 23 Oct, S016). Added last, so every other row keeps its number.
  for (const r of [...rows]) {
    const rate = r.figure.kind === "printed" && r.figure.unit === "up_to" ? dailyRateOf(r.source.excerpt, r.figure.amount) : null;
    // The rate's own printed currency, never the limit's: "Capped at US$300 per day" under an S$ limit is not S$300 a day,
    // and a rate in another currency than its limit gives no row (a bare "$" states none).
    // The currency is the rate figure's own, never another figure's of the same value on the line (TE pr157 F2).
    if (rate != null && r.figure.kind === "printed" && rate.currency !== "mixed" && (rate.currency == null || rate.currency === r.figure.currency))
      add({ ...r, figure: { kind: "printed", amount: rate.value, currency: rate.currency, unit: "per_day" }, fromDay: null, maxDays: null });
  }
  // Plan-table lines the reading left out ("Sub-limit for laptop / tablet (in total)", overnight run 23 Oct, N112, N113,
  // N133, N263), in the plan column the person's other rows from that table are read in. Added last, after every other row.
  for (const r of planTableRows(rows, household)) add(r);
  // A daily cash whose own words print a second daily rate for a day in intensive care ("daily income amount will be
  // doubled if hospitalised in intensive care, capped at S$400 per day") pays that rate for such a day: it is a row of its
  // own, named for intensive care, so the rate is never left out of an answer about an ICU day (overnight run 23 Oct, N119).
  // Added last, so every other row keeps its number.
  for (const r of intensiveCareRows(rows, household)) add(r);
  // Premium parts and clause total limits (N087, N088, N092) come after the intensive-care rows, so every earlier row keeps its number.
  for (const r of parts) add(r);
  for (const r of totalLimitRows(rows, household)) add(r);
  const since = new Map(table.people.flatMap((p) => p.covers.map((c) => [`${p.id}|${c.holding ?? c.coverKey}`, c.startDate ?? c.asOf ?? null] as const)));
  for (const r of rows) r.coverSince = since.get(`${r.personId}|${r.holding ?? r.coverKey}`) ?? null;
  for (const r of rows) if (r.figure.kind === "printed" && r.figure.unit === "up_to" && [r, ...siblings(r, rows)].some((o) => sameFigure(o.figure, r.figure) && lesserOf(o.source.excerpt)))
    r.lesserOf = true;
  return rows;
}

/** A plan table's cell: a money figure, or words printed in place of one. */
// A footnote mark after a figure ("S$2,000*") is the cell's own (TE pr113 P7).
const PLAN_CELL = new RegExp(String.raw`^(?:${MONEY_SIGN}\s?\d[\d,]*(?:\.\d+)?|not\s+covered|not\s+applicable|covered|unlimited)[*^†#]*$`, "i");
const OPTIONAL = /\b(?:optional|add-?ons?|riders?)\b/i;
const SUB_LIMIT = /^(?:sub-?\s?limit|overall\s+limit)\b/i;
/** Rows a plan table prints that the reading left out, for each person's plan: a line that prints exactly one cell per plan
 * column under the table's own heading line ("Premium\tBusiness\tFirst"), named by the line just above it (with the words
 * before its cells), or, when the line above is another row's cells, the line just below it. A sub-limit is named with the
 * benefit whose cells come just before it, and only then. A line with fewer cells (merged across plans), a qualifier
 * ("Adult below 70 years of age"), a family-plan limit, or a name another row from that page already has gives none:
 * a row left out is a missing card, never a wrong one. */
export function planTableRows(rows: ChatRow[], household: Household): TableRow[] {
  // Per-block rows come after the others, so a row read before them keeps its number.
  const out: TableRow[] = [], blocks: TableRow[] = [];
  const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  for (const template of rows) {
    if (!template.column || !template.plan || template.figure.kind !== "printed") continue;
    const group = `${template.personId}|${template.source.documentId}|${template.holding ?? template.coverKey}`;
    if (seen.has(group)) continue;
    seen.add(group);
    const doc = household.documents[template.docIndex];
    const theirs = rows.filter((o) => o.personId === template.personId && o.source.documentId === template.source.documentId);
    for (const page of doc?.pages ?? []) {
      const lines = page.text.split("\n").map((l) => l.trim());
      const cellsOf = (l: string | undefined) => (l ?? "").split("\t").map((c) => c.trim()).filter(Boolean);
      let cols: string[] | null = null, parent: string | null = null;
      // A first cell beyond the plan columns is the line's own name, never a figure ("S$500\tS$1,000\tS$1,500\tS$2,000" under
      // three plans is another table's line: Critic R169-3).
      const valuesOf = (l: string | undefined) => { const c = cellsOf(l); return cols && c.length >= cols.length && c.length <= cols.length + 1 && c.slice(-cols.length).every((x) => PLAN_CELL.test(x)) && !(c.length > cols.length && PLAN_CELL.test(c[0])) ? c : null; };
      const heading = (l: string | undefined) => { const c = cellsOf(l); return c.length >= 2 && c.includes(template.column!) && c.every((x) => /^[A-Z][A-Za-z ]{1,20}$/.test(x)); };
      const labelLine = (l: string | undefined) => !!l && !l.includes("\t") && /^[A-Z]/.test(l) && !/\d/.test(l) && !valuesOf(l) && !/^(?:maximum benefit limit|unless otherwise|note\b)/i.test(l);
      const used = new Set<number>();
      for (let i = 0; i < lines.length; i++) {
        const c = cellsOf(lines[i]);
        // An optional cover's table ("Optional covers" over its heading) is for a cover the person may not hold: never read.
        // Only a table the reading already took one of this plan's rows from: another table under the same plan headings (one
        // for insured persons aged 70 and above, an annual plan's) prints other figures (Critic R169-2).
        if (heading(lines[i])) {
          let end = i + 1;
          while (end < lines.length && !heading(lines[end])) end++;
          const block = plain(lines.slice(i + 1, end).join(" "));
          const anchored = theirs.some((o) => o.column === template.column && o.source.page === page.page && plain(o.source.excerpt.split("\n")[0]).length > 0 && block.includes(plain(o.source.excerpt.split("\n")[0])));
          cols = !anchored || OPTIONAL.test(lines[i - 1] ?? "") ? null : c; parent = null; continue;
        }
        // Another table's heading that does not name the plan ("Single Trip\tAnnual Trip"), or an "Optional covers (pay extra)"
        // line, ends the plan's table (TE pr113 P4, P6).
        if (cols && ((c.length >= 2 && !valuesOf(lines[i]) && c.every((x) => /^[A-Z][A-Za-z ]{1,20}$/.test(x))) || (c.length === 1 && OPTIONAL.test(lines[i])))) { cols = null; parent = null; continue; }
        if (!cols || used.has(i)) continue;
        const block = perBlock(lines[i - 1], cellsOf(lines[i]), cellsOf(lines[i + 1]), lines.slice(i + 2).find((l) => l.trim()), cols.length, labelLine(lines[i - 1]) && !used.has(i - 1));
        if (block) {
          used.add(i - 1).add(i).add(i + 1);
          parent = null;
          const k = cols.indexOf(template.column);
          const keys = [block.name, block.label].map(plain);
          if (theirs.some((o) => o.source.page === page.page && keys.some((key) => plain(o.benefit).includes(key)))) continue;
          const [, sign, figure] = block.cells[k];
          // A bare "$" names no currency: never borrowed from another row (Critic R186-1).
          const currency = statedCurrencyCode(sign);
          blocks.push({ ...template, benefit: block.name, pays: "per_period", conditions: [], fromDay: null, maxDays: null, qualifier: null,
            figure: { kind: "printed", amount: Number(figure.replace(/,/g, "")), currency, unit: "per_period", period: block.periods[k] },
            source: { ...template.source, page: page.page, excerpt: lines.slice(i - 1, i + 2).join("\n") }, baseSource: null, percent: null, percentOf: null, base: null, capSource: null } as TableRow);
          continue;
        }
        const cells = valuesOf(lines[i]);
        if (!cells) {
          // Anything but a sub-limit's name ends the benefit a sub-limit could belong to, except the line describing it.
          if (!(labelLine(lines[i]) && SUB_LIMIT.test(lines[i])) && !(i > 0 && valuesOf(lines[i - 1]) && used.has(i - 1) === false && !labelLine(lines[i]))) parent = null;
          continue;
        }
        const cell = cells[cells.length - cols.length + cols.indexOf(template.column)];
        const inline = cells.length > cols.length ? cells[0] : null;
        // A sub-limit named on its own line ("Overall limit^\tS$300\tS$800") never takes the line above as its name.
        const above = labelLine(lines[i - 1]) && !used.has(i - 1) && !(inline && SUB_LIMIT.test(inline)) ? i - 1 : null;
        // A label below with figures of its own on the next line is theirs (TE pr113 P7).
        const below = above == null && !inline && valuesOf(lines[i - 1]) && labelLine(lines[i + 1]) && !SUB_LIMIT.test(lines[i + 1]) && !/\d/.test(lines[i + 2] ?? "") ? i + 1 : null;
        const own = [above != null ? lines[above] : below != null ? lines[below] : null, inline].filter((x): x is string => !!x).join(": ");
        if (above != null) used.add(above);
        if (below != null) used.add(below);
        used.add(i);
        if (!own) { parent = null; continue; }
        // "Personal accident" over "Adult\tS$50,000\tS$100,000" is for adults only (TE pr113 P8).
        if (inline && /^(?:adults?|child(?:ren)?|juveniles?|seniors?|overall)\b/i.test(inline) && !SUB_LIMIT.test(inline)) { parent = null; continue; }
        // "Personal accident (adult)" on the line above names a group too (TE pr113 R3).
        if (/\b(?:adults?|child(?:ren)?|juveniles?|seniors?|elderly|insured\s+persons?\s+aged)\b/i.test(own)) { parent = null; continue; }
        const sub = SUB_LIMIT.test(own);
        if (!sub) parent = own;
        if (sub && (!parent || /family/i.test(own))) continue;
        const name = sub ? `${parent}: ${own}` : own;
        if (/^(?:adult|child|children|overall)\b/i.test(own) && !sub) { parent = null; continue; }
        const money = new RegExp(String.raw`^(${MONEY_SIGN})\s?(\d[\d,]*(?:\.\d+)?)[*^†#]*$`, "i").exec(cell);
        const notCovered = /^not\s+(?:covered|applicable)[*^†#]*$/i.test(cell);
        // The cell's own currency: "US$10,000" is US$ whatever the row it is read beside (TE pr113 P3).
        const currency = !money ? null : statedCurrencyCode(money[1]) ?? template.figure.currency;
        if (!money && !notCovered) continue;
        // A footnote mark is a qualifier: the cell gives a row only when the page prints that footnote and it names no group,
        // limit or share ("* Reduced to 50% for insured persons aged 70 and above", "^ Limited to S$25,000 for children"), and
        // the footnote goes with the row as its condition (Critic R171-1).
        const mark = /([*^†#]+)$/.exec(cell)?.[1];
        const note = mark ? lines.find((l) => l.startsWith(mark) && !l.startsWith(`${mark}${mark[0]}`) && l.length > mark.length + 3) : undefined;
        // A footnote naming a plan ("^ For Premier plan holders only") is a qualifier too (TE pr113 R14).
        if (mark && note && (/\bplans?\b/i.test(note) || cols.some((p) => p !== template.column && note.includes(p)))) continue;
        if (mark && (!note || /\d|\b(?:child(?:ren)?|juveniles?|adults?|age[ds]?|seniors?|elderly|family|spouse|reduced|limited|sub-?\s?limit|max(?:imum)?|per|each)\b/i.test(note.slice(mark.length)))) continue;
        // A name another row from this page already has (as its name or in its line) is that row's.
        const keys = [own, above != null ? lines[above] : null, below != null ? lines[below] : null].filter((x): x is string => !!x).map(plain);
        if (theirs.some((o) => o.source.page === page.page && keys.some((key) => plain(o.benefit).includes(key) || plain(o.source.excerpt).includes(key)))) continue;
        const excerpt = [above, i, below].filter((x): x is number => x != null).sort((x, y) => x - y).map((k) => lines[k]).join("\n");
        out.push({ ...template, benefit: name, pays: money ? "up_to" : "not_covered", conditions: note ? [note.slice(mark!.length).trim()] : [], fromDay: null, maxDays: null, qualifier: null,
          figure: money ? { kind: "printed", amount: Number(money[2].replace(/,/g, "")), currency, unit: "up_to", period: null } : { kind: "none", why: "printed as not covered" },
          source: { ...template.source, page: page.page, excerpt }, baseSource: null, percent: null, percentOf: null, base: null, capSource: null } as TableRow);
      }
    }
  }
  return [...out, ...blocks];
}

/** A numbered clause heading ("2.2. Critical Illness Benefit", "3.1\tCritical Illness Benefit"): its number, and its words. */
const CLAUSE = /^(\d{1,2}(?:\.\d{1,2}){0,3})\.?[\t ]+(\S.*)$/;
/** Limit wording that says the figure is the most paid in total ("The most We will pay in total ... shall not exceed",
 * "aggregated up to the limit of"), and the scope words that say it is a total, never one claim's payment. */
const TOTAL_LIMIT_WORDS = /\b(?:shall|will|must)\s+not\s+exceed\b|\bmost\s+(?:we|the\s+company|the\s+insurer)\s+(?:will\s+)?pay\b|\bup\s+to\s+(?:a|the)\s+(?:total\s+|aggregate\s+|overall\s+)?limit\s+of\b|\bmaximum\s+(?:total|aggregate)\s+(?:amount|limit|benefit)\b/i;
const TOTAL_SCOPE = /\bin\s+total\b|\baggregated?\b|\ball\s+(?:the\s+)?(?:policies|plans|claims)\b|\bsame\s+life(?:\s+assured)?\b|\bin\s+(?:its|their)\s+lifetime\b/i;
/** A total that is for some insured persons, ages or periods only, or a share, is not the benefit's whole limit. */
const TOTAL_QUALIFIER = /\b(?:child(?:ren)?|juveniles?|minors?|adults?|ages?d?|years?\s+old|spouses?|dependants?|elderly|per\s+(?:day|week|month|year|visit|item|trip|journey|claim|event|accident|admission|condition)|(?:each|every|any\s+one|per)\s+(?:[A-Za-z]+\s+){0,4}(?:claim|event|accident|admission)s?)\b|\b(?:above|below|over|under)\s+(?:the\s+)?(?:age\b|\d)|%|\bper\s*cent\b|\bpercent\b/i;
/** The most a benefit pays in total that its own clause prints, as a row of its own after every other (overnight run
 * 23 Oct, N087: "The most We will pay in total for all Early or Intermediate Stages of Critical Illnesses claims under this
 * Policy and all Policies We have issued covering the same Life Assured shall not exceed S$1,050,000"). The reading left
 * it out, so the chat could only drop it.
 *
 * Read from the stored page, never the model: the row's own line is found once on its page, its clause is the nearest
 * numbered heading above it that names the row's benefit, and the clause runs to the next heading that is not one of its
 * sub-clauses (or the page's end). A sentence in it gives a row only when it says it is a total (limit wording and scope
 * words), prints exactly one money figure in a stated currency, and names no group, age, period or share. A figure that is
 * the row's own cap adds nothing. The row is a limit, never what an event pays (combinedLimit), and its condition, always
 * on its card, is the sentence as printed up to its limit words (what the limit is for), which a sentence must have. A clause that cannot be found, or a sentence that is not plainly one total, gives none: a missing
 * card, never a wrong one. */
export function totalLimitRows(rows: ChatRow[], household: Household): TableRow[] {
  const out: TableRow[] = [];
  const seen = new Set<string>();
  const plain = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const STOP = new Set(["benefit", "benefits", "the", "of", "and", "for", "a", "an", "to", "in", "on"]);
  const words = (t: string) => plain(t).trim().split(" ").filter((w) => w && !STOP.has(w));
  for (const r of rows) {
    if (r.combinedLimit || r.linkWhy === "the person's own cover line" || r.pays === "not_covered" || r.figure.kind === "none") continue;
    const page = household.documents[r.docIndex]?.pages.find((p) => p.page === r.source.page);
    if (!page) continue;
    const lines = page.text.split("\n");
    // The row's own line: where its quote's first words start, found once on the page.
    const first = plain(r.source.excerpt).trim().split(" ").slice(0, 6).join(" ");
    if (first.split(" ").length < 4) continue;
    const starts = lines.flatMap((_, i) => plain(lines.slice(i, i + 3).join(" ")).includes(` ${first} `) && !plain(lines.slice(i + 1, i + 3).join(" ")).includes(` ${first} `) ? [i] : []);
    if (starts.length !== 1) continue;
    let head = -1;
    for (let i = starts[0]; i >= 0; i--) {
      const m = CLAUSE.exec(lines[i].trim());
      // A heading is short and is no sentence: "3.1.1 While this Basic Benefit is in force, ..." is a clause's text.
      if (m && m[2].split(/\s+/).length <= 8 && !/[.,;:]$/.test(m[2].trim())) { head = i; break; }
    }
    if (head < 0) continue;
    const [, number, title] = CLAUSE.exec(lines[head].trim())!;
    // The heading names the row's benefit: every word of one is a word of the other.
    const t = words(title), b = words(benefitName(r.benefit));
    if (!t.length || !b.length || !(t.every((w) => b.includes(w)) || b.every((w) => t.includes(w)))) continue;
    let end = head + 1;
    // The clause ends at the next heading that is not one of its sub-clauses, or at any heading-like line without a
    // number ("GENERAL PROVISIONS", "Appendix B"): what follows is not the row's clause (Critic R270 H1).
    while (end < lines.length) {
      const m = CLAUSE.exec(lines[end].trim());
      if (m ? !m[1].startsWith(`${number}.`) : headingLike(lines[end])) break;
      end++;
    }
    // Every clause heading on the page other than the row's and its sub-clauses': a total naming one of their benefits is
    // not only the row's.
    const others = lines.flatMap((l, i) => { const h = CLAUSE.exec(l.trim()); return h && i !== head && !h[1].startsWith(`${number}.`) && h[2].split(/\s+/).length <= 8 && !/[.,;:]$/.test(h[2].trim()) ? [words(h[2])] : []; })
      .filter((w) => w.length && !(w.every((x) => b.includes(x)) && b.every((x) => w.includes(x))));
    // The clause's sentences, each with the page lines it is printed on.
    const body = lines.slice(head + 1, end);
    const offsets: number[] = [];
    let joined = "";
    for (const l of body) { offsets.push(joined.length); joined += `${l} `; }
    const lineAt = (pos: number) => { let k = 0; while (k + 1 < offsets.length && offsets[k + 1] <= pos) k++; return k; };
    const bounds = [0, ...[...joined.matchAll(/[.;](?=\s+(?:[A-Z(“"]|\d{1,2}(?:\.\d{1,2})+))/g)].map((m) => m.index! + 1), joined.length];
    for (let k = 0; k + 1 < bounds.length; k++) {
      const sentence = joined.slice(bounds[k], bounds[k + 1]).replace(/\s+/g, " ").trim().replace(/^\d{1,2}(?:\.\d{1,2})+\s*/, "");
      if (!TOTAL_LIMIT_WORDS.test(sentence) || !TOTAL_SCOPE.test(sentence) || TOTAL_QUALIFIER.test(sentence)) continue;
      const figures = anyMoneyFigures(sentence);
      // A figure with a scale word after it ("S$1 million", "RM2.5 m") is not the number read (TE P155 F1).
      if (figures.some((f) => SCALE_AFTER.test(sentence.slice(f.index + f.length)))) continue;
      const values = new Set(figures.map((f) => f.value));
      if (values.size !== 1) continue;
      const signs = new Set(figures.map((f) => statedCurrencyCode(new RegExp(`^${MONEY_SIGN}`, "i").exec(sentence.slice(f.index, f.index + f.length))?.[0] ?? null)));
      const [amount] = [...values], [currency] = [...signs];
      if (signs.size !== 1 || !currency || !(amount > 0)) continue;
      // The row's own cap ("subject to a maximum amount of S$25,000 per life") said again adds nothing.
      if (r.figure.kind === "worked_out" && r.figure.capped && Math.abs(r.figure.amount - amount) < 0.005) continue;
      if ((r.capSource || r.figure.kind === "printed") && printsAmount(r.source.excerpt, amount)) continue;
      const excerpt = body.slice(lineAt(bounds[k] + (joined.slice(bounds[k]).length - joined.slice(bounds[k]).trimStart().length)), lineAt(bounds[k + 1] - 1) + 1).join("\n");
      if (anyMoneyFigures(excerpt).some((f) => f.value !== amount)) continue;
      // What the limit is printed for, without its figure: the sentence up to its limit words. A card's conditions never
      // state money, so this is what goes on the card with the figure.
      const cut = /\s(?:(?:shall|will|must)\s+not\s+exceed|(?:will\s+be\s+)?aggregated\s+up\s+to|(?:is|are)\s+(?:limited\s+to|capped\s+at)|(?:is|are)\b(?=[^.]*\d))/i.exec(sentence);
      const scope = cut ? sentence.slice(0, cut.index).replace(/[\s,]+$/, "") : "";
      if (scope.split(/\s+/).length < 4 || anyMoneyFigures(scope).length || /\d/.test(scope)) continue;
      // The total names the row's own benefit (every word of its name, plurals too) and no other heading's benefit: a
      // limit for "all Accidental Death claims" printed in the critical illness clause is not the critical illness
      // benefit's (Critic R270 H1).
      const said = words(scope).map(singular);
      const names = (ws: string[]) => ws.every((w) => said.includes(singular(w)));
      // "under this benefit" in the benefit's own clause names it too.
      if (!(names(b) || /\bthis\s+benefit\b/i.test(scope)) || others.some((o) => names(o))) continue;
      // After the limit words, only the figure and words known to change nothing: the amount spelled out, its currency,
      // "(or equivalent currency)", "per life". Anything else ("the higher of", "or the Sum Insured, whichever is lower",
      // "three times the Sum Insured, up to", "less any amount already paid") can change the limit, so no row (TE P155 F2).
      if (!limitTailHarmless(sentence.slice(cut!.index + cut![0].length), figures.map((f) => sentence.slice(f.index, f.index + f.length)))) continue;
      const key = [r.personId, r.coverKey, r.source.documentId, page.page, amount, plain(sentence)].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...r, benefit: `Limit in total on ${benefitName(r.benefit)} claims`, pays: "up_to", conditions: [scope], fromDay: null, maxDays: null, qualifier: null,
        figure: { kind: "printed", amount, currency, unit: "up_to", period: null }, source: { ...r.source, excerpt }, baseSource: null, percent: null, percentOf: null,
        base: null, baseCorrected: false, capSource: null, combinedLimit: true, coverEnded: r.coverEnded ?? null, scopeOnCard: true } as TableRow);
    }
  }
  return out;
}
/** A line that reads as a heading without a number: short, no sentence punctuation at its end, and in capitals or title
 * case ("GENERAL PROVISIONS", "Exclusions"), or opening with "Appendix", "Section", "Schedule", "Part" or "Annex". */
function headingLike(line: string): boolean {
  const t = line.trim();
  if (!t || /[.,;:]$/.test(t) || t.split(/\s+/).length > 6) return false;
  if (/^(?:appendix|section|schedule|part|annex)\b/i.test(t)) return true;
  if (!/[A-Za-z]/.test(t)) return false;
  return t === t.toUpperCase() || t.split(/\s+/).every((w) => /^[A-Z(“"]/.test(w) || /^(?:of|and|the|or|for|in|to|on|a|an|&)$/.test(w));
}
const singular = (w: string) => w.replace(/ies$/, "y").replace(/sses$/, "ss").replace(/([^s])s$/, "$1");
const SCALE_AFTER = /^\s*(?:million|mil|mn|m|billion|bn|b|thousand|k)\b/i;
const EQUIVALENT = /\(\s*or\s+(?:its\s+)?equivalent(?:\s+currency)?(?:\s+based\s+on\s+the\s+exchange\s+rate\s+as\s+(?:decided|determined)\s+by\s+us)?\s*\)/gi;
/** Words that may follow a total's limit words without changing it: the limit verb's own words, the amount spelled out
 * and its currency. An allow-list: a word not on it gives no row. */
const LIMIT_TAIL_WORDS = new Set(("exceed exceeding limited to capped at of a the total sum amount one two three four five six seven eight nine ten eleven twelve "
  + "fifteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million and singapore dollars dollar ringgit malaysia "
  + "pounds pound sterling euros euro us hong kong sgd myr gbp usd hkd eur rm per life").split(" "));
function limitTailHarmless(tail: string, figures: string[]): boolean {
  let rest = tail.replace(EQUIVALENT, " ");
  for (const f of figures) rest = rest.split(f).join(" ");
  // A figure's own brackets ("Dollars (S$1,050,000)") and the closing full stop.
  rest = rest.replace(/[()]/g, " ").replace(/[.\s]+$/, "");
  // "per" only as "per life": "per policy year" or "per claim" is no total.
  if (/\bper\b(?!\s+life\b)/i.test(rest)) return false;
  return rest.toLowerCase().split(/[\s,-]+/).filter(Boolean).every((w) => LIMIT_TAIL_WORDS.has(w));
}
const printsAmount = (text: string, amount: number) => anyMoneyFigures(text).some((f) => Math.abs(f.value - amount) < 0.005);

const BLOCK_FIGURE = new RegExp(String.raw`^(${MONEY_SIGN})\s?(\d[\d,]*(?:\.\d+)?)\s+for\s+every$`, "i");
const BLOCK_LENGTH = /^(?:[a-z]+|\d+)[- ]hours?(?:\s+(?:of\s+)?delay)?$/i;
/** A plan table's per-block cells wrapped over two lines under the benefit's name (overnight run 23 Oct, N106, N107):
 *   Travel delay
 *   S$100 for every\tS$50 for every\tS$50 for every
 *   Delay while overseas\tsix-hour delay\tthree-hour delay\tthree-hour delay
 * read as "Travel delay: Delay while overseas", S$50 for every three-hour delay in the second plan's column. Only this exact
 * shape: one figure cell per plan column, then the line's name and one block length per plan column. Anything else (merged
 * cells, a third line that goes on with the cells, "for the first ... only") gives none. Never worked out for a delay:
 * printed as it is. */
function perBlock(above: string | undefined, figures: string[], lengths: string[], next: string | undefined, columns: number, named: boolean): { name: string; label: string; cells: RegExpExecArray[]; periods: string[] } | null {
  if (!named || !above || figures.length !== columns || lengths.length !== columns + 1) return null;
  // A third line that goes on with the cells ("up to S$1,000\tup to S$500\t...", a lowercase wrap, a limit or total, one
  // figure per plan even in one cell) is part of them: a row without it would drop its limit (Critic R186-2). Blank lines
  // between do not end the block (TE P120-1, P120-2).
  const after = (next ?? "").trim();
  if (after && (/^[a-z]/.test(after) || /^(?:up\s+to|max(?:imum)?|subject|capped|limit|overall|total|aggregate|per\s+(?:trip|journey|period))\b/i.test(after)
    || anyMoneyFigures(after).length >= columns)) return null;
  const cells = figures.map((c) => BLOCK_FIGURE.exec(c));
  if (cells.some((c) => !c)) return null;
  const [label, ...periods] = lengths;
  if (!/^[A-Z][A-Za-z ,()-]{2,60}$/.test(label) || BLOCK_LENGTH.test(label) || !periods.every((p) => BLOCK_LENGTH.test(p))) return null;
  return { name: `${above}: ${label}`, label, cells: cells as RegExpExecArray[], periods: periods.map((p) => p.toLowerCase()) };
}

/** The one daily rate a limit's own line caps it at ("Capped at S$200 per day", "maximum S$300 per day"), when it is not the
 * limit itself; null when it prints none, or more than one. */
function dailyRateOf(excerpt: string, limit: number): { value: number; currency: string | null } | null {
  // A daily figure that is something else (an ICU rate, an excess, a companion's or an allowance's) is never the limit's
  // own rate, so a line that names one gives none (Critic R153-2).
  if (/\b(?:ICU|intensive|excess|deductible|co-?pay\w*|companion|allowance)\b/i.test(excerpt)) return null;
  // A line with its own day rule ("from the 11th day") would lose it on a row of its own (TE R6).
  if (/\b(?:from|after|beyond|starting|commencing)\b[^.\n]{0,25}\bday\b|\bday\s+\d/i.test(excerpt)) return null;
  const figures = moneyFiguresIn(excerpt).filter((f) => {
    const at = excerpt.indexOf(f.raw ?? "");
    // Only a rate that caps what is paid: "Capped at S$200 per day", "maximum S$300 per day".
    return at >= 0 && /^\s*(?:per|a|each|every)\s+day\b/i.test(excerpt.slice(at + (f.raw ?? "").length))
      && /\b(?:capped\s+at|up\s+to|maximum(?:\s+of)?|max\.?|limited\s+to|not\s+exceeding)\s*:?\s*$/i.test(excerpt.slice(Math.max(0, at - 30), at));
  });
  const rates = new Set(figures.map((f) => f.value));
  const [rate] = [...rates];
  if (!(rates.size === 1 && Math.abs(rate - limit) > 0.005 && rate < limit)) return null;
  // The rate figure's own currency: a bare "$" states none; two printings in different currencies are "mixed" (no row).
  const currencies = new Set(figures.map((f) => (f.currency === "$" ? null : statedCurrencyCode(f.currency))));
  return { value: rate, currency: currencies.size === 1 ? [...currencies][0] : "mixed" };
}

const INTENSIVE_CARE = /\bicu\b|\bintensive\s+care\b|\bhigh\s+dependency\b|\bhdu\b/i;
/** Every word a clause giving an intensive-care day's rate may hold besides its one figure. Any other word (a day rule, an
 * age, a plan, "not", "only", "excess") may change what the figure pays, so a clause holding one gives no row. */
const INTENSIVE_CARE_WORDS = new Set(("note the a an this daily day cash income hospital benefit amount will be is shall doubled double twice "
  + "if when while whilst during insured person life assured hospitalised hospitalized confined admitted warded in into to "
  + "intensive care unit icu hdu high dependency capped at up maximum max of limited per each payable paid pays for").split(" "));
/** One clause of a row's own words that prints the daily rate for a day in intensive care, or null: it names intensive care,
 * prints exactly one money figure, paid per day, holds no other number and only the words above (or the benefit's own name's),
 * and a figure with "doubled" is the cap printed after it. */
export function intensiveCareRateOf(clause: string, ownWords: Iterable<string> = []): { amount: number; currency: string | null; doubled: boolean } | null {
  if (!INTENSIVE_CARE.test(clause)) return null;
  const figures = moneyFiguresIn(clause);
  if (figures.length !== 1 || !figures[0].raw) return null;
  const [f] = figures;
  const at = clause.indexOf(f.raw!);
  if (at < 0 || !/^\s*(?:per|a|each)\s+day\b/i.test(clause.slice(at + f.raw!.length))) return null;
  const rest = clause.slice(0, at) + " " + clause.slice(at + f.raw!.length);
  if (/\d/.test(rest)) return null;
  // A place or stay word ("overseas", "abroad") narrows the rate unless the benefit's own name already says it (TE pr154 F2).
  const own = new Set(ownWords);
  if (!(rest.toLowerCase().match(/[a-z]+/g) ?? []).every((w) => INTENSIVE_CARE_WORDS.has(w) || own.has(w))) return null;
  // A clause that doubles the daily amount prints the ICU day's own figure only as the cap after it ("doubled if in intensive
  // care, capped at S$400 per day"). A figure before the multiplier, or with no cap word between them, is the base rate
  // ("S$200 per day, doubled in ICU"), never the ICU day's (Critic R265 H1).
  const times = /\b(?:doubled|double|twice)\b/i.exec(clause);
  if (times && !(times.index < at && /\b(?:capped|up\s+to|maximum|max|limited)\b/i.test(clause.slice(times.index, at)))) return null;
  return { amount: f.value, currency: f.currency !== "$" ? statedCurrencyCode(f.currency) : null, doubled: !!times };
}
/** Rows for a daily cash's intensive-care rate (see chatRows): from a printed row of the benefit that is not itself for
 * intensive care and prints no day rule of its own (a first paid day or most days might hold for an ICU day too, and the
 * row would lose it), each clause of its conditions and its quote (split at brackets, semicolons and lines) that prints
 * such a rate in the row's own document. A rate the person's rows already give for that cover gives none. */
function intensiveCareRows(rows: ChatRow[], household: Household): TableRow[] {
  const out: TableRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.figure.kind !== "printed" || (r.figure.unit !== "up_to" && r.figure.unit !== "per_day")) continue;
    if (INTENSIVE_CARE.test(r.benefit) || INTENSIVE_CARE.test(r.qualifier ?? "")) continue;
    // Its limit's row too (the daily rate of a limit is a row without the limit's day rule).
    const same = rows.filter((o) => o.personId === r.personId && o.coverKey === r.coverKey && o.source.documentId === r.source.documentId && o.benefit === r.benefit);
    if (same.some((o) => o.fromDay != null || o.maxDays != null || /\b(?:from|after|beyond|starting|commencing)\b[^.\n]{0,25}\bday\b|\bday\s+\d/i.test(o.source.excerpt))) continue;
    const ownWords = r.benefit.toLowerCase().match(/[a-z]+/g) ?? [];
    // The row's own daily rate: one figure a day among the benefit's rows (its limit's daily rate is one of them).
    const dailies = [...new Set(same.flatMap((o) => o.figure.kind === "printed" && o.figure.unit === "per_day" ? [`${o.figure.currency}|${o.figure.amount}`] : []))]
      .map((k) => ({ currency: k.slice(0, k.indexOf("|")), amount: Number(k.slice(k.indexOf("|") + 1)) }));
    const clauses = [...r.conditions, r.source.excerpt].flatMap((t) => t.split(/[()\n;]/)).map((t) => t.replace(/^\s*note\s*:\s*/i, "").trim()).filter(Boolean);
    for (const clause of clauses) {
      const rate = intensiveCareRateOf(clause, ownWords);
      if (!rate) continue;
      // "Doubled ..., capped at S$400 per day" pays the cap only when twice the row's own daily rate reaches it: with S$200 a
      // day (or more) an ICU day is S$400; with S$120 it is S$240, and with no known rate it is unknown, so no row (TE pr154 F1).
      // The rate and the cap must be in one stated currency (Critic R268).
      if (rate.doubled && !(dailies.length === 1 && rate.currency != null && dailies[0].currency === rate.currency && 2 * dailies[0].amount >= rate.amount - 0.005)) continue;
      const key = `${r.personId}|${r.coverKey}|${r.source.documentId}|${r.qualifier ?? ""}|${rate.amount}`;
      if (seen.has(key)) continue;
      // The rate is a row already (the reading took it as a row of its own).
      if (rows.some((o) => o.personId === r.personId && o.coverKey === r.coverKey && INTENSIVE_CARE.test(`${o.benefit} ${o.qualifier ?? ""}`)
        && o.figure.kind === "printed" && Math.abs(o.figure.amount - rate.amount) < 0.005)) continue;
      // Printed in the row's own document, where the checks find it again.
      const found = locateQuote(household, clause, r.docIndex);
      if (!found || found.docIndex !== r.docIndex) continue;
      seen.add(key);
      // The clause is the row's condition: "doubled ..., capped at" says the figure is a cap, not what every ICU day pays (R265 M1).
      out.push({ ...r, benefit: `${r.benefit} in intensive care`, pays: "per_day", conditions: [clause], fromDay: null, maxDays: null,
        figure: { kind: "printed", amount: rate.amount, currency: rate.currency, unit: "per_day", period: null },
        source: { ...r.source, page: found.page, excerpt: found.excerpt }, baseSource: null, percent: null, percentOf: null, base: null, capSource: null } as TableRow);
    }
  }
  return out;
}

/** The same benefit of the same cover, for the same person and group, printed in another of their documents. */
/** Rows of one held policy: its holding where the person holds several policies of the cover type (assemble.ts), else
 * its cover type. */
const samePolicy = (a: { coverKey: string; holding?: string }, b: { coverKey: string; holding?: string }) => (a.holding ?? a.coverKey) === (b.holding ?? b.coverKey);
const siblings = (row: ChatRow, rows: ChatRow[]) => rows.filter((o) => o !== row && o.personId === row.personId && samePolicy(o, row)
  && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit));
const lesserOf = (excerpt: string) => /\bwhichever\s+is\s+(?:the\s+)?(?:lesser|lower|less)\b|\b(?:the\s+)?(?:lesser|lower)\s+of\b/i.test(excerpt);

/** The words a cover is named by on an answer card: the full product, cover and plan, as printed ("HARBOUR STAFF GROUP
 * INSURANCE SCHEME (GROUP POLICY NO. G000123), GROUP TERM LIFE(POLICY NO.1234567)"). */
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
  // A plan or product printed with the cover's own name ("PRO LIFETIME PROTECTOR - MAX", plan "AIA PRO LIFETIME PROTECTOR -
  // MAX") says nothing more: it is not repeated (a household's new documents, 24 Oct, AIA).
  // Only when every word of it is shown already, but for the insurer's name the product opens with: "Travel Insurance Premier"
  // or "Hospital & Surgical (Plan 2)" still names the plan (Critic R173-1).
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const repeats = (a: string | null | undefined, b: string | null | undefined, c: C) => {
    if (!a || !b) return false;
    const shown = new Set(words(b)), extra = words(a).filter((w) => !shown.has(w));
    return extra.length === 0 || (extra.length === 1 && extra[0] === words(c.product ?? "")[0]);
  };
  const short = (c: C) => [noNumbers(c.cover !== c.product ? c.cover : c.product) || c.cover, c.plan && !repeats(c.plan, c.cover !== c.product ? c.cover : c.product, c) ? `plan ${c.plan}` : null].filter(Boolean).join(", ");
  const withProduct = (c: C) => c.cover !== c.product && !repeats(c.product, c.cover, c) ? `${short(c)}, ${noNumbers(c.product) || c.product}` : short(c);
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

/** A premium row's name: the premium line's own words ("Instalment Premium"), how often it is paid when printed, and that
 * the first policy year's premium is different when its page says so. */
const premiumName = (c: PersonCover) => `${c.premiumLabel || "Premium"}${c.premiumFrequency ? `, ${c.premiumFrequency}` : ""}${c.premiumNote ? ` (${c.premiumNote})` : ""}`;

/** The premium rows coverRows made (the premium, its parts, the first year's premium), by identity. */
const PREMIUM_LINES = new WeakSet<TableRow>();
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
  const charged = (r: TableRow) => { PREMIUM_LINES.add(r); return r; };
  if (c.premium != null)
    out.push(charged(row(premiumName(c), { kind: "printed", amount: c.premium, currency: c.premiumCurrency === undefined ? c.currency : c.premiumCurrency, unit: "lump_sum" }, c.premiumSource ?? c.source)));
  // The first policy year's premium its page prints (release-set A6), named as that page names it.
  // The premium's parts its schedule line prints (the benefit's own premium and an extra such as "Health Extra": overnight
  // run 23 Oct, N088, N092), named as parts of the premium, never as premiums of their own.
  for (const part of c.premium != null ? c.premiumParts ?? [] : [])
    out.push(charged(row(`${part.label == null ? `Premium for ${noNumbers(c.cover) || c.cover}` : `${part.label}${/premium/i.test(part.label) ? "" : " (premium)"}`}${c.premiumFrequency ? `, ${c.premiumFrequency}` : ""} (part of the ${c.premiumLabel || "Premium"}${c.premiumNote ? "; the first policy year's premium is different" : ""})`,
      { kind: "printed", amount: part.amount, currency: c.premiumCurrency === undefined ? c.currency : c.premiumCurrency, unit: "lump_sum" }, part.source)));
  if (c.premium != null && c.firstYearPremium != null && c.firstYearSource)
    out.push(charged(row(`${c.firstYearLabel || "First Year Premium"}${c.premiumFrequency ? `, ${c.premiumFrequency}` : ""} (first policy year only)`, { kind: "printed", amount: c.firstYearPremium, currency: c.premiumCurrency === undefined ? c.currency : c.premiumCurrency, unit: "lump_sum" }, c.firstYearSource)));
  return out;
}

/** The table as the model sees it: what each row is and what it shows, never a figure the Coverage page does not show. */
/** The pages the rows come from (each row's own page, its base's and its cap's), as `${policyId}#${page}`: what the
 * chat sends with the table instead of the whole library. */
export function citedPages(rows: ChatRow[]): Set<string> {
  return new Set(rows.flatMap((r) => [r.source, r.baseSource, r.capSource].flatMap((s) => (s ? [`${s.documentId}#${s.page}`] : []))));
}

/** Wording that can stop a benefit being paid: a waiting or survival period, an exclusion, a pre-existing condition, or a
 * "will not pay", or whom a claim is paid to ("paid directly to the Insured Person, proper claimant or legal representative",
 * release-set H10). A page that prints it is sent for every document a row comes from, cited or not (Critic R113-1). */
export const RULE_PAGE = /\bwaiting\s+period|\bexclusions?\b|pre-?\s?existing|\bwill\s+not\s+pay\b|\bdoes\s+not\s+cover\b|\bnot\s+covered\b|\bsurvival\s+period|\bnot\s+(?:be\s+)?payable\b|\bnot\s+be\s+liable\b|can\s+only\s+be\s+claimed|\beither\s+under\b|no\s+other\s+benefit\s+(?:has\s+been\s+)?paid|balance\s+of\s+the\s+sum|terminated\s+upon\s+payment|\binstead\s+of\b|\bin\s+lieu\b|\breduce[sd]?\b|\bdeducted\b|paid\s+(?:directly\s+)?to\s+the\s+(?:insured|policy\s*holder|life\s+assured|proper|estate|legal|nominee)|proper\s+claimant|legal\s+(?:personal\s+)?representatives?\b|\bnominees?\b/i;

/** Documents of at most this many pages that no row comes from are sent whole (pagesToSend). */
const SHORT_DOCUMENT_PAGES = 3;
/** At most this many pages in all are sent for such documents, so a household of many receipts stays small (Critic R126-3). */
const SHORT_DOCUMENTS_BUDGET = 15;
/** What the chat sends with the table: the pages its rows come from, and every page of those documents that prints a
 * rule that can stop a payment (RULE_PAGE). A short document the app has read but no row comes from (a premium receipt)
 * is sent whole: with none of its pages sent the model said it "could not be read" (release-set E1, E2). Keys as in
 * citedPages. */
export function pagesToSend(rows: ChatRow[], household: Household): Set<string> {
  const sent = citedPages(rows);
  const docs = new Set([...sent].map((k) => k.slice(0, k.indexOf("#"))));
  let whole = 0;
  for (const d of household.documents) {
    if (docs.has(d.policyId)) { for (const p of d.pages) if (RULE_PAGE.test(p.text)) sent.add(`${d.policyId}#${p.page}`); }
    else if (!unreadable(d) && d.pages.length <= SHORT_DOCUMENT_PAGES && whole + d.pages.length <= SHORT_DOCUMENTS_BUDGET) {
      for (const p of d.pages) sent.add(`${d.policyId}#${p.page}`);
      whole += d.pages.length;
    }
  }
  return sent;
}

/** Said on every answer that gives an amount while the chat was sent only some pages (Critic R113-1): a fixed server
 * note, whatever the model wrote. No figure in it. An answer whose every amount is a premium row's own card (a premium is
 * charged, never claimed) has nothing to claim and goes without it; any other amount, or one the server cannot tie to a
 * premium row, keeps it. */
export const NARROWED_PAGES_NOTE = "Waiting periods, exclusions and other conditions can be printed on pages not used for this answer. Check the full document, or ask the insurer, before you claim.";
export function noteNarrowedPages<T extends { id: string; kind: string; text: string; amount?: unknown }>(statements: T[], report: RowReport, make: (id: string, text: string) => T): T[] {
  const charged = new Set(report.premiumLabels ?? []);
  const amounts = statements.filter((s) => s.amount);
  if (!amounts.length || amounts.every((s) => charged.has(s.text)) || statements.some((s) => s.id === "narrowed-pages")) return statements;
  return [...statements, make("narrowed-pages", NARROWED_PAGES_NOTE)];
}

export function renderTable(rows: ChatRow[]): string {
  if (!rows.length) return "";
  const line = (r: ChatRow) => [r.id, r.person, [r.product, r.cover !== r.product ? r.cover : null, r.plan ? `plan ${r.plan}` : null].filter(Boolean).join(" / "),
    r.benefit, r.qualifier ? `for ${r.qualifier}` : null, figureText(r.figure), r.fromDay != null ? `from day ${r.fromDay}` : null,
    r.maxDays != null ? `for at most ${r.maxDays} days` : null, r.conditions.length ? `conditions: ${r.conditions.join("; ")}` : null,
    `${documentId(r.docIndex)} page ${r.source.page}`].filter(Boolean).join(" | ");
  return `\n<benefit_table>
Each person's benefit table, as their Coverage page shows it. One row per line: id | person | cover | benefit | qualifier | figure | conditions | where printed.
For every statement that gives a row's amount, or points at one ("this amount"), set "eventFit": "on_list" when the row pays only for what a list names (critical illnesses, early critical illnesses, listed injuries) and the event asked about is on that list; "not_on_list" when it pays only for a list and the event is not on it (that card is never shown, so say in a fact that it is not on the list); "any_event" when the row is not limited to a list and pays on the event itself; "not_described" when the row pays only if a further thing happened that the household has not said happened, even one that often follows such an event (an ambulance was used, a hospital or intensive care stay, equipment bought, a death: that card is never shown either, so say in a fact what it needs); "no_event" when the question names no event (asking what a benefit is, or what a person has, is no event). For an event, give every row that pays on it, also one paid for a family member (per child, for a spouse), saying its condition. For a statement about an event ("on_list" or "any_event"), set "waiting" when a waiting period printed for the row's cover could apply to it: {"applies": "yes", "unsure" or "no" (whether it covers this event), "days": its length in days as printed (3 months is 90), "from": the date it runs from as printed for this person (the policy's issue, start or cover date, as DD/MM/YYYY)}; null when the cover prints no waiting period. The app compares those dates with today and never shows a card inside a waiting period that applies or may apply, so say why in a fact. Set "period" for every statement; for an amount whose cover prints its own period of cover (a trip's dates, a policy's start and end): {"from": its first day, "to": its last day, as printed (DD/MM/YYYY, "" when not printed), "eventOn": the date the event happened as the household said it (DD/MM/YYYY; today's date when they say it is happening now; "" when they did not say when)}; all three "" when no period is printed for the cover. Every policy on file is treated as in force: never say a cover has ended, expired, lapsed or not started because of a printed date or period, and never leave an amount out for that reason. Set "row" to the id of the row it gives and "rowBenefit" to that row's benefit name, copied exactly from the table ("" for a statement with no row; the app leaves out a card whose name is not its row's), and leave "amount" and "percentOf" null: the app fills in the row's figure. Give only amounts that are a row here, always with its id, also when you read the figure in another document (a premium on a tax invoice is the premium row); an amount no row shows is not given (say in a "fact" what the documents print instead). The person must be that row's person. A row "for child" or "per family" is only that; say so in the text. A projected figure is not guaranteed; say so.
${rows.map((r) => escapeText(line(r))).join("\n")}
</benefit_table>`;
}

export { printedDay };
/** A waiting period runs this long at most: a cover that started earlier is past every one. */
const LONGEST_WAIT_DAYS = 365;
/** Why a card is not shown because of a waiting period, or null. The model says for each card whether a waiting period
 * applies to the event and, as printed, how many days it runs and from what date; the server compares the dates itself.
 * A period that applies or may apply, and has not ended today (or cannot be dated), hides the card: an amount inside a
 * waiting period is never shown as payable (stress run 23 Oct, S023). A list cover (critical illnesses, listed injuries)
 * whose cover started within a year, for an event, with no waiting period said, is hidden too: it was not checked. */
function insideWaiting(raw: Record<string, unknown>, row: ChatRow, today: number, household: Household): string | null {
  // Only for an event: a cover listed with no event asked about ("what is Alex covered for") is not a payment.
  if (raw.eventFit !== "on_list" && raw.eventFit !== "any_event") return null;
  const w = raw.waiting as { applies?: unknown; days?: unknown; from?: unknown } | null | undefined;
  if (w && typeof w === "object") {
    if (w.applies === "no") return null;
    const days = typeof w.days === "number" && Number.isInteger(w.days) && w.days > 0 ? w.days : null;
    const from = printedDay(w.from);
    if (days != null && from != null) return today < from + days ? `the event falls inside its ${days}-day waiting period` : null;
    return "a waiting period applies that could not be dated";
  }
  // Only where the row's own document prints a waiting period on a page that names the row's cover: a fracture scale on a
  // certificate printed this year prints none, and is not hidden for it (Critic R153-1). The live readings carry no start
  // date, so the cover line's own date (a schedule's issue date) stands in for it.
  const since = printedDay(row.coverSince);
  if (raw.eventFit !== "on_list" || since == null || today - since >= LONGEST_WAIT_DAYS) return null;
  const cover = noNumbers(row.cover).replace(/^group\s+/i, "").toLowerCase();
  const prints = cover.length > 2 && (household.documents[row.docIndex]?.pages.some((p) => /\bwaiting\s+period/i.test(p.text) && p.text.toLowerCase().includes(cover)) ?? false);
  return prints ? "its cover started less than a year ago and no waiting period was checked" : null;
  return null;
}

/** Whether the question asks about the row's benefit by its name: the whole name, or the name before the event it is
 * paid on ("Mobility aid" of "Mobility aid upon Accidental Total & Permanent Disablement"), at least two words long. */
function asksFor(question: string, row: ChatRow): boolean {
  // The benefit's own name, never its cover's: "what does my personal accident cover pay" asks about no one benefit (TE A3).
  if (!question.trim()) return false;
  const q = plainWords(question), whole = plainWords(benefitName(row.benefit)), head = nameHead(row);
  // At least two words: "hip" alone names no one benefit.
  return (whole.trim().split(" ").length >= 2 && q.includes(whole)) || (!!head && q.includes(head));
}
const plainWords = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
/** A benefit's name before the event it is paid on, without a list letter or a closing "benefit": "mobility aid" of "H.
 * Mobility aid upon accidental total & permanent disablement". Null when shorter than two words. */
function nameHead(row: ChatRow): string | null {
  const head = plainWords(benefitName(row.benefit).replace(/^\s*[a-z]\s*[.,]\s+/i, "").split(/\b(?:upon|on|following|after|due\s+to|for|while|in\s+case\s+of|arising|caused\s+by)\b/i)[0].replace(/\bbenefits?\s*$/i, ""));
  return head.trim().split(" ").length >= 2 ? head : null;
}
/** The question asks for a most or a cap (MOST_WORDS) about a plan, and nothing else: every other word is on a closed
 * list of question, plan and cover words, or a word of the name of a product the household holds. Any other word ("dengue",
 * "bitten", "stolen", "crash", or a language the list does not hold) may tell of an event, so the answer is no (Critic
 * and TE #319: an event deny-list let 21 of 25 event questions through). "What's the most my hospital plan pays?" is
 * about the plan, not a stay. */
const MOST_ONLY_PHRASES = /\b(?:(?:hospital|hospitalisation|hospitalization|travel|life|medical|health|critical\s+illness(?:es)?|personal\s+accident|term\s+life|whole\s+life|daily|integrated\s+shield)\s+(?:cash|income|plans?|polic(?:y|ies)|cover|coverage|insurance|benefits?|schemes?)|room\s+and\s+board|up\s+to|had\s+(?:maksimum|keseluruhan))\b/g;
// No word of state or pointing ("was", "are", "there", "at", "this"): "I was at the hospital" tells of a stay (TE #319 round 2).
const MOST_ONLY_WORDS = new Set(("what what's whats how much many is the a an my our your his her their me i we us you can could would will does do should "
  + "get gets give gives pay pays paid payout payouts payable claim claims claimable cover covers covered coverage plan plans policy policies scheme schemes insurance insurer "
  + "benefit benefits most maximum max highest limit limits cap caps capped ceiling in total totals overall altogether combined under from for of on to by with "
  + "each per year yearly annual annually lifetime amount amounts sum sums any which plan's policy's scheme's").split(" "));
export function asksMostOfNothing(question: string, rows: ChatRow[] = []): boolean {
  const q = question.normalize("NFKC").toLowerCase().replace(/[’`]/g, "'");
  if (!MOST_WORDS.some((w) => w.test(q)) || EVENT_WORDS.some((w) => w.test(q))) return false;
  // A product the household holds counts only as its whole name, as one phrase ("dengue shield"): a single word of it is
  // often an illness or a place ("cancer", "japan"), which tells of an event (Critic #319 H1b).
  const spaced = (t: string) => ` ${t.toLowerCase().split(/[^\p{L}\d']+/u).filter(Boolean).join(" ")} `;
  const names = [...new Set(rows.map((r) => spaced(r.product ?? "").trim()).filter((n) => n.split(" ").length >= 2 && !EVENT_WORDS.some((e) => e.test(n))))].sort((a, b) => b.length - a.length);
  let left = spaced(q.replace(MOST_ONLY_PHRASES, " "));
  for (const n of names) left = left.split(` ${n} `).join("  ");
  return left.split(" ").filter(Boolean).every((w) => MOST_ONLY_WORDS.has(w));
}
/** Words that ask for a most, a maximum or a cap; words that ask about many claims together (all claims, over the years,
 * a lifetime); and words that say an event has happened (a stay, a diagnosis, an accident). All closed lists, in the
 * languages households write in (asksOverallMost). "Total" alone is no together word: it asks for a sum of payouts, and
 * is part of cover names ("total and permanent disability", masked first). "Had" alone is English, never the Malay limit. */
/** The same pattern with \b as a word edge in any script: JavaScript's \b sees "é" and "ñ" as no letter, so
 * "hospitalisé" would never end a word. */
const lettersEdge = (r: RegExp) => new RegExp(r.source.replace(/\\b/g, "(?:(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]))"), r.flags.replace("u", "") + "u");
const MOST_WORDS = [/\b(?:most|maximum|max|highest|ceiling|caps?(?=\s+(?:on|of|for))|capped|limits?|up\s+to\s+how\s+much)\b/].map(lettersEdge);
const TOGETHER_WORDS = [/\b(?:all\s+(?:of\s+)?(?:my\s+|the\s+|his\s+|her\s+|our\s+|their\s+|these\s+)?claims|every\s+claim|(?:several|multiple|repeated|many)\s+claims|claims\s+combined|combined\s+claims|aggregate|cumulative(?:ly)?|lifetime\s+(?:limit|limits|cap|maximum|max)|(?:in|over|during)\s+(?:my|his|her|their|a)\s+lifetime|over\s+(?:the|many)\s+years|(?:two|three|several|multiple|different|more\s+than\s+one|repeated|many)\s+(?:\w+\s+){0,3}(?:claims|illnesses|conditions|diagnoses)|each\s+time\s+(?:i|he|she|we|they)\s+claim|over\s+(?:my|his|her|their)\s+(?:life|lifetime)|across\s+(?:all|both|every)\b|overall\s+(?:limit|cap|maximum|max|most))\b/].map(lettersEdge);
const EVENT_WORDS = [/\b(?:diagnos(?:ed|is)|hospitali[sz](?:ed|ation)|admitted|in\s+(?:the\s+)?hospital|warded|icu|intensive\s+care|broke|broken|fractured?|accident|injur(?:ed|y|ies)|surgery|operation|operated|died|passed\s+away|death\s+of|stroke|heart\s+attack|disabled|ambulance|spent\s+\d+\s+days?)\b/,
  /\b(?:didiagnosis|disahkan|dimasukkan\s+ke\s+hospital|masuk\s+hospital|kemalangan|patah|cedera|pembedahan|meninggal)\b/, /(?:住院|确诊|確診|手术|手術|意外|骨折|去世|过世|過世|受伤|受傷)/,
  /(?:\bhospitalis[ée]e?s?\b|\bdiagnostiqu[ée]e?s?\b|\bop[ée]r[ée]e?s?\b|\baccident\b|\bfracture\b|\bd[ée]c[ée]d[ée]e?s?\b|\bbless[ée]e?s?\b)/,
  /(?:\bhospitalizad[oa]s?\b|\bdiagnosticad[oa]s?\b|\boperaron\b|\boperad[oa]s?\b|\baccidente\b|\bfractura\b|\bfalleci[óo]\b|\bherid[oa]s?\b)/].map(lettersEdge);
/** Cover names that hold a together or most word without asking for one. */
const COVER_NAMES = /\b(?:total\s+(?:and|&)\s+permanent\s+disab\w*|total\s+permanent\s+disab\w*|tpd|total\s+disab\w*|totally\s+disabled|maximum\s+care)\b/g;
/** Whether the question asks for the most paid for many claims together ("if I claim for two illnesses over the years,
 * what's the most the plan will pay", "is there a lifetime limit on all my claims"), with no event described. Only then
 * is a limit on what several benefits pay together (combinedLimit) what was asked. A question about an event ("I was in
 * hospital, what's the most I can claim in total") asks what that event pays, which such a limit never is; so does "in
 * total" alone (a sum of payouts) and "the most" alone (the most one event pays). Unsure is no: the limit stays out. */
export function asksOverallMost(question: string): boolean {
  const q = question.normalize("NFKC").toLowerCase().replace(COVER_NAMES, " ");
  if (!MOST_WORDS.some((w) => w.test(q)) || !TOGETHER_WORDS.some((w) => w.test(q)) || EVENT_WORDS.some((w) => w.test(q))) return false;
  // Allowed words, not a list of events (which always misses one: "bitten by a dog", "collapsed at work"): every part of
  // the message that is not the limit question itself must be an "if" clause (TE #312 round 2). "My son was bitten by a
  // dog. What's the most across all his policies?" says something happened, so the limit stays out.
  const parts = q.split(/[.;,!?:，。？！；：、]+|\s[-–—]\s/).map((x) => x.trim()).filter(Boolean);
  const asking = (x: string) => MOST_WORDS.some((w) => w.test(x)) || TOGETHER_WORDS.some((w) => w.test(x));
  return parts.every((x) => asking(x) || HYPOTHETICAL.test(x));
}
/** How a clause that only supposes something opens: "if I claim twice", "jika", "如果", "si", "en caso de". */
const HYPOTHETICAL = lettersEdge(/^(?:(?:and|but|so)\s+)?(?:if|what\s+if|suppose|supposing|say|assuming|in\s+case|jika|kalau|sekiranya|andainya|seandainya|如果|假如|要是|假设|假設|si|s'il|s'ils|en\s+caso\s+de|supongamos)\b/);

/** Whether a limit row's card says it is a limit: its card carries the printed sentence (scopeOnCard), or its own name
 * has limit words ("Limits of compensation", "Aggregate limit"). One that does not is never shown as the answer to a
 * total question: it would read as a payout. */
function readsAsLimit(r: ChatRow): boolean {
  const name = r.benefit.normalize("NFKC").toLowerCase().replace(COVER_NAMES, " ");
  return !!r.scopeOnCard || MOST_WORDS.some((w) => w.test(name)) || /\b(?:in\s+total|total|aggregate|overall|combined)\b/.test(name);
}

/** The model's raw reply with every amount statement rewritten from its row, before readModelAnswer and verifyAnswer see
 * it. Statements of other kinds are left as they are. */
/** `earlier`: the household's earlier messages in this conversation, latest first. */
/** Whether the household's words name one of its members: a word of a member's name that no other member shares, or a
 * family word (closed list, in the languages households write in). */
const FAMILY_WORDS = /\b(?:wife|husband|spouse|partner|son|sons|daughter|daughters|child|children|kid|kids|baby|mother|father|mum|mom|dad|mummy|daddy|parents?|brother|sister|grandma|grandpa|grandmother|grandfather|isteri|suami|anak|ibu|ayah|emak|bapa|esposa|esposo|hijo|hija|madre|padre|femme|mari|fils|fille|m[eè]re|p[eè]re)\b|妻子|老婆|丈夫|老公|儿子|兒子|女儿|女兒|孩子|妈妈|媽媽|爸爸|父亲|父親|母亲|母親/i;
export function namesSomeone(said: string[], household: Household): boolean {
  const text = said.join(" ").normalize("NFKC").toLowerCase();
  if (FAMILY_WORDS.test(text)) return true;
  const words = (n: string) => baseName(n).toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
  const people = household.members.map((m) => m.name);
  const heard = new Set(text.split(/[^\p{L}]+/u));
  // Any word of a member's name, shared or not: "Is Tan covered?" names one of several Tans (Critic #345).
  return people.some((p) => words(p).some((w) => heard.has(w)));
}
/** The speaker alone ("I", "my", "saya", "我", "je", "yo"): the account's own member (relationship "self") is meant, as
 * the model is told, so the words ask for one person. "We", "our" and "我们" ask for the household. Closed list. */
const FIRST_PERSON = /\b(?:i|me|my|mine|myself|i'm|i’m|im|i've|i’ve|i'd|i’d|i'll|i’ll|saya|aku|daku|je|j'|moi|mon|ma|mes|yo|mi|mis|me)\b|我(?![们們])/i;
/** Whether the household's words ask for nobody in particular: no member named (namesSomeone), and not the speaker alone. */
/** Words that ask for more than one person (closed list). */
const MANY_PEOPLE = /\b(?:we|our|ours|us|everyone|everybody|each|both|all\s+of\s+us|the\s+family|who|whose|anyone|anybody|per\s+person|each\s+person)\b/i;
/** Words that point at one person without naming them: a third-person pronoun (closed list). */
const ONE_PERSON = /\b(?:he|she|him|her|his|hers|they|them|their|theirs|himself|herself|themselves)\b/i;
/** What "the", "our" or a possessive may be about without pointing at a person: the policy itself (closed list). */
const POLICY_NOUN = /^(?:polic(?:y|ies)|plans?|schemes?|group|insurers?|insurance|family|cover|coverage)$/i;
/** Whether the household's words ask for nobody in particular: allow-list, default no (Critic #345). They must ask for
 * several people (MANY_PEOPLE) or be about the policy alone, and never point at one person: no member's name word, no
 * family word, not the speaker alone, no third-person pronoun, no possessive "'s" on anything but the policy, and every
 * "the …" or "our …" is the policy itself ("our helper", "the maid", "the employee", "the boy" point at someone). */
export function asksForNobody(said: string[], household: Household, rows: readonly ChatRow[] = []): boolean {
  // "Tell me", "show me", "give me" ask for the answer, not about the speaker (TE #345).
  const text = said.join(" ").normalize("NFKC").replace(/[’`]/g, "'").replace(/\b(?:tell|show|give)\s+me\b/gi, "tell");
  if (namesSomeone(said, household) || FIRST_PERSON.test(text) || ONE_PERSON.test(text)) return false;
  // The words of the benefits, products and covers the household holds: "the ambulance benefit" is about the policy.
  const own = new Set(rows.flatMap((r) => `${r.benefit} ${r.product ?? ""} ${r.cover ?? ""}`.toLowerCase().split(/[^\p{L}\d]+/u)).filter((w) => w.length >= 3));
  const policyWord = (w: string) => POLICY_NOUN.test(w) || own.has(w.toLowerCase());
  for (const m of text.matchAll(/\b([\p{L}]+)'s?\b/gu)) if (/'s?$/.test(m[0]) && !policyWord(m[1])) return false;
  for (const m of text.matchAll(/\b(?:the|our|this|that|these|those)\s+([\p{L}]+)/giu)) if (!policyWord(m[1])) return false;
  // Several people, or the policy alone: every word is a question, policy, pay or several-people word, or a word of a
  // benefit's or product's name the household holds ("How much hospital cash does the group policy pay?", "Who gets
  // hospital cash?"). Any other word ("grandson", "mak", "junior", "maid") may be a person, so no (Critic #345).
  const words = text.toLowerCase().split(/[^\p{L}\d']+/u).filter(Boolean);
  return words.length > 0 && words.every((w) => POLICY_ONLY_WORDS.has(w) || own.has(w));
}
const POLICY_ONLY_WORDS = new Set(("what what's whats how much many is are does do the a an can will would pay pays paid payout payable claim claimable cover covers covered tell "
  + "coverage plan plans policy policies scheme group insurance insurer benefit benefits amount amounts sum get gets give gives for of on under from in per day year total "
  + "most maximum max limit there any which we our ours us everyone everybody each both all who whose anyone anybody person family day days").split(" "));
/** `forNobody`: the chat is about no one in particular and the household's words ask for nobody (asksForNobody). Then a
 * card given for one person's row is given for every other member's own row of the same benefit and document: each
 * person the document is linked to and the table holds a row for is named, never only the one the model picked (live
 * 637c547: a group scheme's hospital cash named one of the two insured people). Each card is that person's own row. */
export function amountsFromRows(json: unknown, rows: ChatRow[], household: Household, now: Date = new Date(), question = "", earlier: string[] = [], forNobody = false): { json: unknown; report: RowReport } {
  const report: RowReport = { dropped: [], labels: [], days: {}, conditionPoints: [], cards: {} };
  // A condition said as a point of its own, for the rows whose cards it belongs to (dropConditionsOnCards).
  const pointFor = (text: string, condition: string, row: ChatRow) => {
    const seen = report.conditionPoints!.find((p) => p.text === text && p.condition === condition);
    if (seen) { if (!seen.rows.includes(row.id)) seen.rows.push(row.id); } else report.conditionPoints!.push({ text, condition, rows: [row.id] });
  };
  if (!json || typeof json !== "object" || !Array.isArray((json as { statements?: unknown }).statements)) return { json, report };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labels = coverLabels(rows), names = benefitNames(rows);
  const statements: unknown[] = [];
  const charges = new Set<string>(), benefits = new Set<string>();
  const given = new Set<string>();
  // Limit cards given for an event (asksOverallMost), with the statement each is: kept only beside a card of the same
  // person's own per-claim amount on the same policy, so the limit is never the only figure (Critic #312 M1).
  const limitsOnEvent: { row: ChatRow; st: Record<string, unknown> }[] = [];
  const away = new Map<string, Record<string, unknown>>();
  const said = [(json as { bottomLine?: unknown }).bottomLine, ...((json as { statements: Record<string, unknown>[] }).statements ?? []).filter((x) => x && x.kind !== "amount").map((x) => x.text)]
    .filter((x): x is string => typeof x === "string").join(" ");
  // A row ruled out anywhere in the answer, with its twins in the person's other documents, is never shown: not when
  // named again with another flag, pointed at, or brought back as a companion (TE #107 E7, E8b, E8c).
  // Built after pointers become cards, so a ruled-out pointer counts too (TE #107 E8d).
  const pointed = pointedRows((json as { statements: Record<string, unknown>[] }).statements, rows, household);
  const ruledOut = new Map<string, string>();
  const today = singaporeDay(now);
  for (const x of pointed) {
    const r = x && x.kind === "amount" && typeof x.row === "string" ? byId.get(x.row.trim().toUpperCase()) : undefined;
    // A cover still inside a waiting period for the event is ruled out with its twins, like one the event is not listed for.
    // So is one that pays only on something the household has not described (an ambulance, a hospital stay; stress run
    // 23 Oct, S088).
    // A benefit the question asks about by name is what was asked, never "not described" (live run 23 Oct, H7: "what is
    // the mobility aid benefit" lost its S$10,000).
    const why = !r ? null : x.eventFit === "not_on_list" ? `the event is not on ${names(r)}'s list`
      // So is a figure paid per child, when the household gives a number of children right after asking about that benefit by
      // name ("what's the child education fund" then "how much in total if we have two kids", overnight run 23 Oct, N023).
      // Nor is one when the question asks for a most and describes nothing at all ("what's the most my hospital plan pays in
      // total?"): there is no event for anything to be missing from (live 637c547, hospital cash lost its daily figure).
      : x.eventFit === "not_described" ? (asksFor(question, r) || asksMostOfNothing(question, rows) || (childrenSaid(question) != null && perChild(r) && asksFor(earlier[0] ?? "", r)) ? null : `${names(r)} pays only on something not described`)
      // A limit on what several benefits pay together is never what an event pays (check.ts combinedLimit; live 27f35c1),
      // unless the question asks for exactly that: the most paid for everything together (chat-speed run 3 Nov, S4). Its
      // card always says it is a limit and what it is printed for (scopeOnCard).
      : r.combinedLimit && (x.eventFit === "on_list" || x.eventFit === "any_event") && !(asksOverallMost(question) && readsAsLimit(r)) ? `${names(r)} is the most paid for several benefits together, not what this event pays`
      // A premium is charged, never paid on an event: no waiting period or cover dates hide it (live run 23 Oct, A6).
      : PREMIUM_ROW.test(r.benefit) ? null : insideWaiting(x, r, today, household);
    if (r && why) for (const o of rows) if (!ruledOut.has(o.id) && (o.id === r.id || (o.personId === r.personId && samePolicy(o, r) && o.qualifier === r.qualifier && sameBenefit(o.benefit, r.benefit)))) ruledOut.set(o.id, why);
  }
  // Every row the model itself gives a card for: a person's own card from the model (with its own conditions) is never
  // replaced by a spread one made from another person's card (forNobody).
  const modelRows = pointed.flatMap((x) => { const r = x && x.kind === "amount" && typeof x.row === "string" ? byId.get(x.row.trim().toUpperCase()) : undefined; return r ? [r] : []; });
  for (const raw of pointed) {
    if (!raw || typeof raw !== "object" || raw.kind !== "amount") { statements.push(raw); continue; }
    const text = typeof raw.text === "string" ? raw.text : "";
    const named = (typeof raw.row === "string" ? byId.get(raw.row.trim().toUpperCase()) : undefined);
    if (!named) { report.dropped.push({ why: raw.row ? "no such row in the benefit table" : "an amount with no table row", text }); continue; }
    // The model copies the benefit name of the row it gives: a name that is not that row's means the id slipped to another
    // row (round 9 check, S088: the recuperation benefit given as the Child Education Fund's row). The card is left out: a
    // missing amount, never a wrong one. An answer recorded before the field existed has none, and is not checked.
    if (typeof raw.rowBenefit === "string" && !copiedName(raw.rowBenefit, named, rows) && !quotesRow(raw.quote, named, rows)) {
      report.dropped.push({ why: `row ${named.id} is ${names(named)}, not "${raw.rowBenefit.slice(0, 80)}"`, text, row: named.id }); continue;
    }
    const { row, carried } = checkedRow(named, raw, rows, household, labels, names, given);
    // Every amount statement says whether the event fits its row: a cover that pays only for what its list names, with
    // the event not on that list, is never shown (live run 23 Oct, H2). Decided per card, never read from the prose.
    // The answer says why only when its own words name the cover or benefit; otherwise the household hears an amount was
    // left out (Critic R143-2).
    if (raw.eventFit === "not_on_list" || ruledOut.has(row.id) || ruledOut.has(named.id)) { report.dropped.push({ why: ruledOut.get(named.id) ?? ruledOut.get(row.id) ?? `the event is not on ${names(row)}'s list`, text, notFit: namesRow(said, row, rows) }); continue; }
    const person = matchMember(household, typeof raw.person === "string" ? raw.person : null);
    if (!person || person !== baseName(row.person)) { report.dropped.push({ why: `the row is ${row.person}'s, not ${raw.person ?? "nobody's"}`, text }); continue; }
    // A label carries the row's names past the money filter, so a name that states money is never labelled (Critic R92-2).
    if (nameStatesMoney(row.benefit) || nameStatesMoney(row.qualifier ?? "") || nameStatesMoney(row.product, "product") || nameStatesMoney(row.cover, "product") || nameStatesMoney(row.plan ?? "", "plan")) {
      report.dropped.push({ why: `row ${row.id}'s name states money`, text }); continue;
    }
    // The same row named twice is given once (Critic R91-3).
    // A card for a row already given, or for the same benefit with the same figure from another document already given
    // (live run 23 Oct, B5), is not given again. Its own conditions are not lost: each is a point quoting its row's
    // document, as a carried condition is (TE #111 T5; a row first given with another card's benefit, round 11 replay).
    const kept = given.has(row.id) ? row : given.has(named.id) ? named : rows.find((o) => given.has(o.id) && twinOf(o, row) && sameFigure(o.figure, row.figure));
    if (kept) {
      for (const c of Array.isArray(raw.conditions) ? raw.conditions as { text?: unknown; quote?: unknown }[] : []) {
        const t = typeof c?.text === "string" ? c.text.trim() : "", quote = typeof c?.quote === "string" ? c.quote.trim() : "";
        const said = `${names(kept)} also depends on this: ${t}`;
        // One the answer already gives in other words ("... within 365 days." and "... within 365 days of the accident.") is
        // not said twice: most of its words are in a condition already given.
        const words = (x: unknown) => new Set(typeof x === "string" ? x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3) : []);
        const same = (x: unknown) => { const a = words(t), b = words(x); return a.size > 0 && [...a].filter((w) => b.has(w)).length >= 0.8 * a.size; };
        // Only the kept card's own conditions count: another card's ("The fracture must result from an accident" on the
        // Product Summary's card) says nothing for this one.
        const card = rowLabel(kept, labels, names);
        if (!t || !quote || statesMoney(t) || statements.some((x) => { const y = x as { text?: unknown; conditions?: unknown };
          return y.text === said || (y.text === card && Array.isArray(y.conditions) && (y.conditions as { text?: unknown }[]).some((k) => same(k?.text))); })) continue;
        // The same row's card already shown (given with another card's benefit) takes it as its own condition; a card from
        // another document cannot quote this one's page, so there it is a point.
        // One its page does not print but the same benefit's row in another document does goes as a point quoting that
        // document, as it would on the card given alone (TE #112 M1b).
        const shown = kept.id === row.id ? statements.find((x) => (x as { text?: unknown }).text === card) as { conditions?: unknown } | undefined : undefined;
        const elsewhere = shown ? awayConditions(kept, [{ text: t, quote }], rows, household)[0] : undefined;
        if (elsewhere) {
          const text = `${names(kept)} also depends on this: ${t}`, key = `${text}|${elsewhere.at.docIndex}`;
          if (away.has(key)) continue;
          const st: Record<string, unknown> = { kind: "fact", text, person: baseName(kept.person), document: documentId(elsewhere.at.docIndex),
            quote, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null };
          away.set(key, st); statements.push(st); pointFor(text, t, kept); continue;
        }
        if (shown && Array.isArray(shown.conditions)) { shown.conditions.push({ text: t, quote }); continue; }
        statements.push({ kind: "fact", text: said, person: baseName(row.person), document: documentId(row.docIndex), quote, amount: null, percentOf: null,
          conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
        pointFor(said, t, kept);
      }
      continue;
    }
    given.add(row.id); given.add(named.id);
    // The same benefit of the same cover printed in another of the person's documents ("Neck, Skull or Spine (Full Break)"
    // at 100% of S$5,000 in the product summary, and at 100% of S$600,000 in the benefit summary) is given with it, as an
    // alternative that is not a total: an answer that gives one document's figure alone hides the other (release-set B7,
    // H7, H10).
    const companions = rows.filter((o) => o.id !== row.id && !given.has(o.id) && !ruledOut.has(o.id) && o.personId === row.personId && samePolicy(o, row)
      && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit)
      // The same figure printed again adds nothing.
      && !sameFigure(o.figure, row.figure));
    const group = companions.length ? (typeof raw.alternativeGroup === "string" && raw.alternativeGroup.trim() ? raw.alternativeGroup : `same benefit ${row.id}`) : raw.alternativeGroup;
    // A premium whose page prints a different first-year premium is given with that first-year premium (release-set A6):
    // one after the other, never alternatives and never a total.
    const firstYear = /first policy year\)$/.test(row.benefit) ? rows.filter((o) => !given.has(o.id) && o.personId === row.personId && samePolicy(o, row)
      && o.source.documentId === row.source.documentId && /\(first policy year only\)$/.test(o.benefit)) : [];
    // The named row's own conditions that the row given in its place does not print go with it, each as a point quoting
    // the named row's document (Critic R131-2).
    // Said after the card they belong to, never before it (live run 23 Oct, S087: a condition line with no card above it).
    const points: Record<string, unknown>[] = [];
    for (const c of carried) {
      points.push({ kind: "fact", text: `${names(named)} also depends on this: ${c}`, person: baseName(named.person), document: documentId(named.docIndex),
        quote: c, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
      pointFor(`${names(named)} also depends on this: ${c}`, c, row);
    }
    // The model's conditions that the given row's page does not print, but the same benefit's row in another of the
    // person's documents does (the Benefit Summary's "proof of need" for the Product Summary's mobility aid row,
    // release-set H7), are points of their own quoting that document. Each must apply to that row there (conditionApplies:
    // its section, its footnote mark), and never states money.
    // One point for everyone it is carried for: said for nobody in particular once it is carried for a second person.
    for (const c of awayConditions(row, raw.conditions, rows, household)) {
      if (carried.includes(c.text)) continue;
      const text = `${names(row)} also depends on this: ${c.text}`, key = `${text}|${c.at.docIndex}`;
      const seen = away.get(key);
      pointFor(text, c.text, row);
      if (seen) { if (seen.person !== baseName(row.person)) seen.person = null; continue; }
      const st: Record<string, unknown> = { kind: "fact", text, person: baseName(row.person), document: documentId(c.at.docIndex),
        quote: c.quote, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null };
      away.set(key, st); points.push(st);
    }
    // The same row of every other member, when the chat is for nobody in particular (forNobody).
    const others = forNobody ? rows.filter((o) => o.personId !== row.personId && !given.has(o.id) && !ruledOut.has(o.id) && o.docIndex === row.docIndex
      && !o.qualifier && !row.qualifier && sameBenefit(o.benefit, row.benefit) && !o.premium && !row.premium
      && !rows.some((x) => x.personId === o.personId && given.has(x.id) && x.docIndex === o.docIndex && sameBenefit(x.benefit, o.benefit))
      && !modelRows.some((x) => x.personId === o.personId && x.docIndex === o.docIndex && sameBenefit(x.benefit, o.benefit))) : [];
    for (const r of [row, ...companions, ...firstYear, ...others]) {
      given.add(r.id);
      // A companion carries its own row's conditions, never the model's for the row it named (Critic R126-2).
      // Premiums for different policy years are paid one after the other, never alternatives (live run 23 Oct, A6).
      // A total limit's card always says what the limit is printed for (its sentence), whatever the model gave: its name
      // alone ("Limit in total on Critical Illness Benefit claims") would leave out a scope such as early stages only.
      const own = r.conditions.map((t) => ({ text: r.scopeOnCard ? `${t}, up to this amount.` : t, quote: t }));
      // A spread card (others) keeps only its own row's printed conditions: a model condition may be about the person it was
      // given for ("she has been insured over 10 months") and is never copied to another person's card (TE #345).
      const conditions = r !== named ? own : r.scopeOnCard ? [...own, ...(Array.isArray(raw.conditions) ? raw.conditions : [])] : undefined;
      const st = statementFromRow(r, { ...raw, alternativeGroup: firstYear.includes(r) || others.includes(r) || PERIOD_ROW.test(r.benefit) ? null : group, ...(conditions ? { conditions } : {}) }, labels, names);
      // A printed cover period never changes what a card says: every policy on file is treated as in force (DC, 31 Oct).
      // The row's own printed conditions ride with it, so a total is never worked out past a cap the model left out
      // (Critic R275 M1).
      if (st) st.rowConditions = r.conditions;
      if (st) {
        statements.push(st); report.labels.push(String(st.text));
        const sf = serverFigureOf(r, st, household);
        if (sf) (report.figures ??= []).push(sf);
        report.cards![r.id] = { text: String(st.text), person: baseName(r.person) };
        if (r.combinedLimit && (raw.eventFit === "on_list" || raw.eventFit === "any_event")) limitsOnEvent.push({ row: r, st });
        (r.premium ? charges : benefits).add(String(st.text));
        if (r.figure.kind === "printed" && r.figure.unit === "per_day")
          (report.days![String(st.text)] ??= []).push({ fromDay: r.fromDay, maxDays: r.maxDays, alone: dailyRateAlone(r, household) });
      }
      else if (r === row) report.dropped.push({ why: `row ${row.id} has no amount (${figureText(row.figure)})`, text });
    }
    statements.push(...points);
  }
  // A card left out for its copied name whose row is shown anyway (given with the same benefit from another document) is
  // not missing: no "left out an amount" for it.
  for (const { row: r, st } of limitsOnEvent) {
    const beside = Object.keys(report.cards!).some((id) => { const o = byId.get(id);
      return !!o && !o.combinedLimit && !o.premium && !PREMIUM_ROW.test(o.benefit) && o.personId === r.personId && samePolicy(o, r); });
    if (beside) continue;
    const at = statements.indexOf(st);
    if (at >= 0) statements.splice(at, 1);
    const label = String(st.text);
    if (!statements.some((x) => (x as { text?: unknown })?.text === label)) report.labels = report.labels.filter((l) => l !== label);
    delete report.cards![r.id]; given.delete(r.id);
    report.dropped.push({ why: `${names(r)} is the most paid for several benefits together, not what this event pays`, text: label, row: r.id });
  }
  report.dropped = report.dropped.filter((d) => !d.row || !given.has(d.row));
  // A label also given for a row that is not a premium is not a premium's.
  report.premiumLabels = [...charges].filter((l) => !benefits.has(l));
  if (!rows.length && report.dropped.length)
    statements.push({ kind: "uncertainty", text: NO_ROWS_YET, person: null, document: null, quote: null, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
  return { json: { ...(json as object), statements }, report };
}

/** Words that point at an amount shown with them ("the Product Summary shows this amount", "the amounts below"). */
export const AMOUNT_POINTER = /\b(?:this|that|these|those)\s+(?:amounts?|figures?|sums?|limits?)\b(?!\s+(?:insured|assured)\b)|\b(?:the\s+)?(?:amounts?|figures?|cards?)\s+(?:below|shown(?!\s+(?:in|on|by)\b)|here)\b|\b(?:amounts?|figures?)\s+(?:is|are)\s+(?:shown\s+|listed\s+)?below(?=\s*(?:[.,;:!]|$))|\b(?:shown|listed|set\s+out)\s+below\b/i;
/** "this amount" in a sentence that says something of it ("This amount is not paid if the injury was self-inflicted"): the
 * benefit is meant, and the sentence is kept saying so (TE #105 Y13). */
const DEICTIC = /\b(this|that|these|those)\s+(amount|figure|sum|limit)(s?)\b(?!\s+(?:insured|assured)\b)/gi;
const asBenefit = (sentence: string) => sentence.replace(DEICTIC, (_m, w: string, _n: string, pl: string) => `${w} benefit${pl ? "s" : ""}`);
/** A sentence without the clauses that point at an amount; null when its first clause does. A clause that only says the
 * amount is shown goes; one that says something of "this amount" keeps it, said of the benefit. */
const clauses = (sentence: string) => sentence.split(/(?:,|;)\s+(?=(?:and|but|so|while|although|though)\b)|;\s+/);
/** A condition about the amounts shown ("the amounts below do not apply if the injury was self-inflicted") is a condition
 * of the benefit: kept, said of the benefit (TE #108 D8). */
const CONDITION_OF_AMOUNT = (sentence: string) => clauses(sentence).some((c) => AMOUNT_POINTER.test(c) && /\b(?:not|no|never|cannot|exclu\w*)\b|n['’]t\b/i.test(c)
  // A condition, or a denial that says what it is about ("does not apply to pre-existing conditions", "is not paid in
  // addition to the death benefit"); never one that only says the amounts shown don't apply.
  && (CONDITIONAL.test(c) || !DENIES_END.test(c)));
const ofBenefit = (sentence: string) => {
  // "The Advance Payment amount below" is "The Advance Payment benefit", not "... this benefit" (Critic R149-2).
  const said = sentence.replace(new RegExp(AMOUNT_POINTER.source, "gi"), (m) => {
    const many = /\b(?:amounts|figures|sums|limits|cards|these|those)\b/i.test(m);
    return /^(?:the|this|that|these|those)\b/i.test(m) ? (many ? "these benefits" : "this benefit") : many ? "benefits" : "benefit";
  });
  return said.charAt(0).toUpperCase() + said.slice(1);
};
function withoutPointer(sentence: string): string | null {
  if (!AMOUNT_POINTER.test(sentence)) return sentence;
  // "..., shown below" only says where: the sentence stays without it (live run 23 Oct after #111, A6).
  const where = sentence.replace(/,\s*(?:as\s+|(?:which|that)\s+(?:is|are)\s+)?(?:shown|listed|set\s+out)\s+below\b,?/gi, "").replace(/\s+([.,;:!?])/g, "$1").trim();
  if (where !== sentence.trim() && where && !AMOUNT_POINTER.test(where)) return where;
  if (CONDITION_OF_AMOUNT(sentence)) return ofBenefit(sentence);
  if (!POSITIVE_POINTER.test(sentence)) { const said = asBenefit(sentence); if (!AMOUNT_POINTER.test(said)) return said; }
  const parts = clauses(sentence);
  if (AMOUNT_POINTER.test(parts[0])) return null;
  const kept = parts.filter((x) => !AMOUNT_POINTER.test(x)).join(", ").replace(/[\s,;:]+$/, "");
  return /[.!?]$/.test(kept) ? kept : `${kept}.`;
}
/** A text without what points at an amount. */
export const withoutPointers = (text: string) => sentences(text ?? "").map(withoutPointer).filter((x): x is string => !!x).join(" ").trim();

/** A point the model wrote about an amount it did not give ("If it is a full break of the spine ... the Product Summary shows
 * this amount", quoting that row's own line, live run 23 Oct, B7) is given that amount: the one row, of the person it is
 * about, whose line in the document it quotes is that quote. An answer left with no amount at all loses what points at
 * one (dropAmountPointers). */
/** Whether words name a row's cover ("Living Care Plus" for "GROUP LIVING CARE PLUS(POLICY NO. 1)") or its benefit. */
function namesRow(text: string, row: ChatRow, rows: ChatRow[]): boolean {
  const plain = (x: string) => ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const coverOf = (r: ChatRow) => plain(noNumbers(r.cover).replace(/^group\s+/i, ""));
  const cover = coverOf(row), benefit = plain(benefitName(row.benefit));
  // A longer cover name is not this one: "Living Care Plus" does not name Living Care (TE #107 L4).
  let t = plain(text);
  for (const o of new Set(rows.map(coverOf))) if (o !== cover && o.includes(cover)) t = t.split(o).join(" ");
  return (cover.trim().length > 2 && t.includes(cover)) || (benefit.trim().length > 2 && t.includes(benefit));
}
/** A row for one policy year's premium, or for the premium after it ("(first policy year only)", "(the page prints a
 * different premium for the first policy year)"). */
const PERIOD_ROW = /first policy year(?: only)?\)$/;
/** A row for a premium the household pays: never a benefit paid on an event that names premiums ("Waiver of Premium",
 * "Return of Premium", Critic R162-1). */
const PREMIUM_ROW = PREMIUM;
/** The same benefit of the same cover, printed in another of the person's documents. */
const twinOf = (o: ChatRow, row: ChatRow) => o.id !== row.id && o.personId === row.personId && samePolicy(o, row)
  && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit);
function pointedRows(raws: Record<string, unknown>[], rows: ChatRow[], household: Household): Record<string, unknown>[] {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
  const out: Record<string, unknown>[] = [];
  for (const raw of raws) {
    const text = raw && typeof raw.text === "string" ? raw.text : "";
    if (!raw || typeof raw !== "object" || raw.kind === "amount" || !AMOUNT_POINTER.test(text)) { out.push(raw); continue; }
    const person = matchMember(household, typeof raw.person === "string" ? raw.person : null);
    const di = typeof raw.document === "string" ? Number(/^D(\d+)$/i.exec(raw.document.trim())?.[1] ?? NaN) - 1 : NaN;
    const quote = typeof raw.quote === "string" ? norm(raw.quote) : "";
    // Only a point that says the amount is shown, about the person it is for and no one else, with no word that it is not
    // paid, does not apply or is someone else's ("this amount is not payable", "that limit is for Tan's policy only",
    // Critic R134-1). Any other point loses its pointing words.
    const shows = POSITIVE_POINTER.test(text) && !NOT_PAID.test(text) && membersNamedIn(household, text).every((m) => m === person);
    const hits = shows && person && Number.isFinite(di) && quote.length >= 8 ? rows.filter((r) => baseName(r.person) === person && r.docIndex === di
      && (norm(r.source.excerpt) === quote || (norm(r.source.excerpt).includes(quote) && norm(benefitName(r.benefit)).length && quote.includes(norm(benefitName(r.benefit)))))) : [];
    if (hits.length === 1) {
      out.push({ ...raw, conditions: [] });
      // Bound by its quote, not by an id the model gave: no copied name to check.
      out.push({ ...raw, kind: "amount", row: hits[0].id, rowBenefit: undefined, amount: null, percentOf: null, alternativeGroup: null, perDay: null, ofBill: null });
      continue;
    }
    const kept = withoutPointers(text);
    if (kept) out.push({ ...raw, text: kept });
  }
  return out;
}
const POSITIVE_POINTER = /\b(?:shows?|gives?|prints?|lists?|sets?\s+out|is|are|pays?|would\s+be|comes?\s+to)\s+(?:this|that|these|those)\s+(?:amounts?|figures?|sums?|limits?)\b|\b(?:the\s+)?(?:amounts?|figures?)\s+(?:below|shown(?!\s+(?:in|on|by)\b))\b|\b(?:shown|listed|set\s+out)\s+below\b/i;
const NOT_PAID = /\b(?:not|no|never|none|nothing|cannot|excluded?|exclusions?|ended|expired|lapsed|only|instead|unless|except)\b|n't\b/i;

/** Words that say an amount does not apply or is not paid. */
const DENIES_AMOUNT = /\b(?:don['’]t|do\s+not|does\s+not|doesn['’]t|won['’]t|will\s+not|would\s+not|wouldn['’]t|cannot|can['’]t)\s+(?:apply|be\s+paid|pay|count)\b|\bnot\s+(?:payable|paid|applicable)\b/i;
const DENIES_END = new RegExp(`(?:${DENIES_AMOUNT.source})(?:\\s+(?:here|to\\s+(?:it|this|them|this\\s+event)|for\\s+(?:it|this|that|them)))?\\s*[.!?]?\\s*$`, "i");
const CONDITIONAL = /\b(?:if|unless|until|within|before|after|during|while|when|where|provided|except|only|for\s+(?:a|an|any)|in\s+the\s+first)\b/i;
const DIFFERENT_FIGURES = /\b(?:print|prints|printed|show|shows|give|gives|list|lists|state|states)\s+(?:different|differing)\b[^.]*\b(?:figures?|amounts?|sums?)\b|\bnot\s+(?:a|the)\s+total\b/i;
/** The day rules a sentence states: each first paid day ("after the 10th day" is 11, "from the 11th day", "from day 11",
 * "11th to 40th day") and each most-days figure ("up to 30 days", "for at most thirty (30) days", "11th to 40th day" is 30). */
function dayRulesIn(sentence: string): { starts: number[]; maxes: number[] } {
  const starts: number[] = [], maxes: number[] = [];
  // "After the 10th day" and "after 10 days" are day 11 (TE D8).
  for (const m of sentence.matchAll(/\bafter\s+(?:the\s+)?(?:first\s+)?(?:(\d+)(?:st|nd|rd|th)\s+day|(\d+)\s+(?:consecutive\s+|continuous\s+)?days)\b/gi)) starts.push(Number(m[1] ?? m[2]) + 1);
  // An ordinal counts only with "day" after it, or a range ending in one: "on 11th October" is a date (TE D9).
  for (const m of sentence.matchAll(/\b(?:from|on)\s+(?:the\s+)?(?:day\s+(\d+)|(\d+)(?:st|nd|rd|th)(?=\s+day\b|\s+(?:to|until|through|-)\s+(?:the\s+)?\d+(?:st|nd|rd|th)?\s+day\b))(?:\s+day)?(?:\s+(?:to|until|through|-)\s+(?:the\s+)?(?:day\s+(\d+)|(\d+)(?:st|nd|rd|th)?\s+day))?/gi)) {
    const start = Number(m[1] ?? m[2]);
    starts.push(start);
    // "From day 11 to day 60" ends on day 60 (TE D11).
    const end = m[3] ?? m[4];
    if (end) maxes.push(Number(end) - start + 1);
  }
  for (const m of sentence.matchAll(/\b(?:up\s+to|at\s+most|max(?:imum)?(?:\s+of)?:?|for)\s+(?:(?:a\s+)?(?:maximum|total)\s+of\s+)?(?:[a-z]+\s+)?\(?(\d+)\)?\s+(?:continuous\s+|consecutive\s+)?days?\b/gi)) maxes.push(Number(m[1]));
  return { starts, maxes };
}
/** Applied to the checked answer: a sentence that states the daily cards' day rule twice over, both the same rule ("one
 * says after the 10th day for up to 30 days, the other says from the 11th to the 40th day"), sets one rule against itself.
 * It is left out, with its whole point when it opens that point (live run 23 Oct, H4; the B3 type). Only when every daily
 * card in the answer was read with the same first paid day and most days. A server label is never changed. */
export function dropAgreeingDayRules<T extends { text: string; fullText?: string; amount?: unknown }>(answer: { summary: string; bottomLine?: string | null; statements?: T[] }, report: RowReport): string[] {
  const rules = Object.values(report.days ?? {}).flat();
  if (!rules.length || rules.some((r) => r.fromDay == null || r.maxDays == null || r.fromDay !== rules[0].fromDay || r.maxDays !== rules[0].maxDays)) return [];
  const { fromDay, maxDays } = rules[0];
  const twice = (x: string) => { const d = dayRulesIn(x); return d.starts.length >= 2 && d.starts.every((n) => n === fromDay) && d.maxes.every((n) => n === maxDays); };
  const left: string[] = [];
  const bottom = answer.bottomLine ?? answer.summary;
  if (bottom && sentences(bottom).some(twice)) {
    left.push(...sentences(bottom).filter(twice));
    const b = sentences(bottom).filter((x) => !twice(x)).join(" ").trim() || "Here is what your documents say.";
    answer.summary = b;
    if (answer.bottomLine != null) answer.bottomLine = b;
  }
  const statements = answer.statements ?? [];
  for (const s of [...statements]) {
    if (report.labels.includes(s.text) || s.amount) continue;
    const parts = sentences(s.text);
    if (!parts.some(twice)) continue;
    left.push(s.text);
    const kept = twice(parts[0]) ? "" : parts.filter((x) => !twice(x)).join(" ").trim();
    if (!kept) statements.splice(statements.indexOf(s), 1);
    else { s.text = kept; s.fullText = kept; }
  }
  return left;
}

/** With no amount in the answer, what points at one ("the amounts below only apply if ...") is left out of its bottom line
 * and points. A server label is never changed. */
export function dropAmountPointers<T extends { text: string; fullText?: string; amount?: unknown }>(answer: { summary: string; bottomLine?: string | null; statements?: T[] }, labels: readonly string[], amountLeftOut = false): string[] {
  const statements = answer.statements ?? [];
  const shown = statements.some((s) => s.amount);
  // With an amount left out, words that point at the amounts shown may point at the one that is not ("the CI II premiums,
  // shown below", live run 23 Oct after #111, A6): they go, as with no amount shown; the rest of the sentence stays.
  const lost = shown && amountLeftOut;
  const left: string[] = [];
  // With no amount shown, "the two documents print different figures, so the insurer decides which applies" is about
  // nothing either (unseen set U16).
  // With amounts shown, only words that say the amounts shown do not apply go ("so the amounts below for it don't apply",
  // unseen set U8): they were about a card the server did not show, and every card shown is one the answer gives.
  // A denial with a condition ("the amount below is not payable for an illness diagnosed in the first 90 days") is a
  // condition, and stays.
  // Only a denial that ends its clause: "is not paid in addition to the death benefit" is a coordination rule, and stays
  // (Critic R147-2).
  const denies = (x: string) => clauses(x).some((c) => AMOUNT_POINTER.test(c) && DENIES_END.test(c) && !CONDITIONAL.test(c));
  const point = (x: string) => (!shown ? (DIFFERENT_FIGURES.test(x) ? null : withoutPointer(x)) : denies(x) || (lost && AMOUNT_POINTER.test(x)) ? withoutPointer(x) : x);
  const flagged = (x: string) => (!shown ? AMOUNT_POINTER.test(x) || DIFFERENT_FIGURES.test(x) : denies(x) || (lost && AMOUNT_POINTER.test(x)));
  const cut = (text: string) => {
    const kept = sentences(text).map(point).filter((x): x is string => !!x).join(" ").trim();
    if (kept !== text.trim()) left.push(...sentences(text).filter((x) => point(x) !== x));
    return kept;
  };
  const bottom = answer.bottomLine ?? answer.summary;
  if (bottom && flagged(bottom)) {
    const b = cut(bottom) || "Here is what your documents say.";
    answer.summary = b;
    if (answer.bottomLine != null) answer.bottomLine = b;
  }
  for (const s of [...statements]) {
    if (labels.includes(s.text) || !flagged(s.text)) continue;
    const text = cut(s.text);
    if (!text) statements.splice(statements.indexOf(s), 1);
    else { s.text = text; s.fullText = text; }
  }
  return left;
}

/** The model's conditions for a row that its own page does not print but a sibling row's page does, where they apply to
 * that sibling row. */
function awayConditions(row: ChatRow, conditions: unknown, rows: ChatRow[], household: Household): { text: string; quote: string; at: ChatRow }[] {
  if (!Array.isArray(conditions)) return [];
  const own = locateQuote(household, row.source.excerpt, row.docIndex);
  const out: { text: string; quote: string; at: ChatRow }[] = [];
  for (const c of conditions as { text?: unknown; quote?: unknown }[]) {
    const text = typeof c?.text === "string" ? c.text.trim() : "", quote = typeof c?.quote === "string" ? c.quote.trim() : "";
    if (!text || !quote || statesMoney(text)) continue;
    if (own && own.docIndex === row.docIndex && conditionApplies(household, own, quote)) continue;
    for (const o of siblings(row, rows)) {
      const at = locateQuote(household, o.source.excerpt, o.docIndex);
      // The point cites where its quote is first printed in that document, so it must be the sibling row's page.
      const cited = locateQuote(household, quote, o.docIndex);
      if (at && at.docIndex === o.docIndex && at.page === o.source.page && cited?.docIndex === o.docIndex && cited.page === o.source.page && conditionApplies(household, at, quote)) { out.push({ text, quote, at: o }); break; }
    }
  }
  return out;
}

/** The row to give for the one the model named: itself, unless the checks would refuse its amount (a percentage printed in
 * prose, wrapped over two lines, release-set H1) and the same benefit of the same cover is printed with the same figure in
 * another of the person's documents (a table row) that they accept. The other row is then given in its place, with its own
 * conditions, and the named row's conditions that its page does not print are carried as points of their own. Never a
 * different figure: that is a companion, given with it. */
function checkedRow(row: ChatRow, raw: Record<string, unknown>, rows: ChatRow[], household: Household, labels: Map<string, string>, names: (row: ChatRow) => string, given: Set<string>): { row: ChatRow; carried: string[] } {
  const twins = rows.filter((o) => o.id !== row.id && !given.has(o.id) && o.personId === row.personId && samePolicy(o, row)
    && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit) && sameFigure(o.figure, row.figure));
  const named = { row, carried: [] as string[] };
  if (!twins.length) return named;
  const passes = (r: ChatRow, conditions: unknown) => {
    const st = statementFromRow(r, { ...raw, conditions, alternativeGroup: null }, labels, names);
    if (!st) return false;
    const parsed = readModelAnswer({ bottomLine: "-", nextSteps: [], question: null, statements: [st] });
    const sf = serverFigureOf(r, st, household);
    return !!parsed && (verifyAnswer(household, parsed, [], new Set([String(st.text)]), sf ? [sf] : []).answer.statements ?? []).some((x) => x.amount && x.text === st.text);
  };
  if (passes(row, raw.conditions)) return named;
  for (const o of twins) {
    // The named row's conditions the twin's page does not print are carried with it; one that states money cannot be said
    // as a point, so that twin is not used (Critic R131-2).
    const carried = row.conditions.filter((c) => { const f = locateQuote(household, c, o.docIndex); return !(f && f.docIndex === o.docIndex && f.page === o.source.page); });
    if (carried.some((c) => statesMoney(c))) continue;
    if (passes(o, o.conditions.map((t) => ({ text: t, quote: t })))) return { row: o, carried };
  }
  return named;
}

/** A benefit's name without its row letter, case or punctuation, split into its section ("Simple Fracture ...") and the
 * benefit ("Neck, Skull or Spine (Full Break)"). */
const nameParts = (benefit: string) => {
  const at = benefit.lastIndexOf(": ");
  // The list numbers a document prints ("2.", "(a)", "(iii)") are where it puts the benefit, not its name: the Benefit
  // Summary's "2. Permanent Total Loss of (a) Sight in at least one eye" is the Product Summary's "Permanent Total Loss of
  // Sight in at least one eye" (live run 23 Oct, B5).
  const plain = (t: string) => benefitName(t.trim()).toLowerCase().replace(LIST_MARKS, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return { section: at < 0 ? null : plain(benefit.slice(0, at)), core: plain(at < 0 ? benefit : benefit.slice(at + 1)) };
};
/** Whether a benefit name the model copied is the row's: the same name, letters and digits only, with any list letter
 * ("D.", "J,") dropped and its section kept; or the same once words that name no benefit are taken out ("Child
 * Education Fund" of "Child Education Fund Benefit"). */
function copiedName(copied: string, row: ChatRow, rows: ChatRow[] = []): boolean {
  const plain = (t: string) => benefitName(t.trim()).toLowerCase().replace(/^\s*[a-z]\s*[.,]\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
  const a = plain(copied), b = plain(row.benefit);
  if (!a) return false;
  // The section is part of the name: "Wrist" is neither "Simple Fracture: Wrist" nor "Compound Fracture: Wrist" (TE K8).
  if (a === b) return true;
  // Never one name inside another: "Hospital Cash" is not "ICU Hospital Cash" (Critic R157-1). Only words that name no
  // benefit ("the", "benefit", "cover", "limit") may differ.
  const core = (t: string) => ` ${t} `.replace(/\s(?:the|benefits?|cover(?:age)?|amount|limit|plan|payment)(?=\s)/g, " ").replace(/\s+/g, " ").trim();
  if (core(a) && core(a) === core(b)) return true;
  // A copy without what the server adds to a name, or a document prints after it: a note in brackets ("(first policy year
  // only)", "(the page prints a different premium for the first policy year)"), a premium's frequency (", Monthly") and
  // list numbers ("2.", "(a)"). Live run 23 Oct, A6 and A2: the CI II premiums and death benefit were left out. Taken only
  // when no other of the person's rows has that short name, other than the same benefit in another document. A copy may
  // leave a note out, never add one ("Child Education Fund (per child)" is not "Child Education Fund").
  const short = (t: string, notes: RegExp) => core(plain(t.replace(notes, "").replace(LIST_MARKS, " ")));
  // A frequency may be left out, never changed: "Premium, Annual" is not the monthly row (TE #111 C5).
  const freq = (t: string) => FREQUENCY.exec(t.replace(/(?:\s*\([^()]*\))+\s*$/, ""))?.[0].toLowerCase().replace(/[^a-z]/g, "").replace(/ly$/, "") ?? null;
  if (freq(copied) && freq(copied) !== freq(row.benefit)) return false;
  // Rows that could be the one meant: the person's other rows, not the same benefit in another document.
  // Only a same-name twin from another document is no rival; "Accidental Death (Public Transport)" still is.
  const others = rows.filter((o) => o.id !== row.id && o.personId === row.personId && !(samePolicy(o, row) && o.qualifier === row.qualifier
    && o.source.documentId !== row.source.documentId && nameParts(o.benefit).core === nameParts(row.benefit).core && sameBenefit(o.benefit, row.benefit)));
  const s = short(copied, FREQUENCY);
  if (s && s === short(row.benefit, TRAILING_NOTES)) return !others.some((o) => short(o.benefit, TRAILING_NOTES) === s);
  // Any other copy in the model's own words ("Monthly Instalment Premium", "Arm, Elbow, Wrist or Ribs (Other Fracture)"
  // for the Benefit Summary's sectioned row): the row's when every word of it is printed in the row's name or cover, it
  // says at least half of the row's own name, and it fits no other row of the person as well (live run 23 Oct after
  // #111, A6 and D1: correct cards left out). A slipped id is still caught: the copy fits the row meant better ("Hospital
  // Cash" against "ICU Hospital Cash"), or has words the named row does not print (S088, the Child Education Fund).
  const fit = (o: ChatRow): [number, number] => {
    // The server's own note on a premium row ("(the page prints a different premium for the first policy year)") is not
    // the row's name: its words would let "First Year ..." fit the later premium too.
    const pool = new Set([o.benefit.replace(PERIOD_NOTE, ""), o.cover, o.plan ?? "", o.product ?? "", o.qualifier ?? ""].flatMap(nameWords));
    const own = nameWords(o.benefit.replace(TRAILING_NOTES, "")), said = nameWords(copied);
    const ownSet = new Set(own.length ? own : nameWords(o.benefit));
    return [said.filter((w) => pool.has(w)).length / said.length, [...ownSet].filter((w) => said.includes(w)).length / ownSet.size];
  };
  if (!nameWords(copied).length) return false;
  // A copy that is another of the person's cover names is that cover, never this row ("Critical Illness" is the CRITICAL
  // ILLNESS policy, not the EARLY CRITICAL ILLNESS row, TE #112 B4).
  // Words that name a policy, not a cover ("Critical Illness Policy", TE #112 B4b), are left out on both sides.
  const asCover = (t: string) => [...new Set(nameWords(t).filter((w) => !/^(?:policy|policies|insurance|rider|no|\d+)$/.test(w)))].sort().join(" ");
  const coverName = (c: string) => asCover(c.replace(/\([^()]*\)/g, " "));
  const saidName = asCover(copied);
  if (!saidName) return false;
  if (coverName(row.cover) !== saidName && rows.some((o) => o.personId === row.personId && o.cover !== row.cover && coverName(o.cover) === saidName)) return false;
  const [all, half] = fit(row);
  if (all < 1 || half < 0.5) return false;
  return others.every((o) => { const [x, y] = fit(o); return x < all || (x === all && y < half); });
}
/** The note the server adds to a premium row's name (chatRows, premiumName). */
const PERIOD_NOTE = /\s*\((?:first policy year only|the page prints a different premium for the first policy year)\)\s*$/i;
/** The words of a name that tell benefits apart: no list numbers, and none of "the", "of", "benefit", "cover". */
const NAME_FILLER = new Set(["the", "of", "or", "and", "for", "a", "an", "to", "in", "on", "at", "by", "with", "due", "benefit", "benefits", "cover", "coverage", "amount", "limit", "plan", "payment", "s"]);
const nameWords = (t: string) => t.replace(LIST_MARKS, " ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !NAME_FILLER.has(w));
/** Whether the model's quote for a card is the named row's own printed line, and no other of the person's rows: the id
 * is right whatever name was copied. The live A6 premiums were copied as their cover's name ("Comprehensive Critical
 * Illness Benefit") while quoting "Instalment Premium : 470.85" (round 11 check). A slipped id quotes the row meant (S088:
 * the Child Education Fund's id with the recuperation benefit's "$250 per hospitalisation"), and is still left out. */
function quotesRow(quote: unknown, row: ChatRow, rows: ChatRow[]): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const q = typeof quote === "string" ? norm(quote) : "";
  if (q.length < 8) return false;
  // A short excerpt inside a longer quote counts only when it names its own benefit (not a bare "S$50,000").
  const holds = (o: ChatRow) => {
    const e = norm(o.source.excerpt ?? "");
    return e.length >= 8 && (e.includes(q) || (q.includes(e) && nameWords(o.benefit).some((w) => e.split(" ").includes(w))));
  };
  return holds(row) && !rows.some((o) => o.id !== row.id && o.personId === row.personId && holds(o));
}
/** A premium's frequency at the end of a name; with notes in brackets. */
const FREQUENCY = /,\s*(?:monthly|quarterly|half[-\s]?yearly|semi[-\s]?annual(?:ly)?|annual(?:ly)?|yearly|single)\s*$/i;
const TRAILING_NOTES = /(?:\s*(?:\([^()]*\)|,\s*(?:monthly|quarterly|half[-\s]?yearly|semi[-\s]?annual(?:ly)?|annual(?:ly)?|yearly|single)))+\s*$/i;
/** List numbers a document prints in or before a benefit's name: "2.", "B.", "(a)", "(iii)". */
const LIST_MARKS = /^\s*(?:\d{1,2}|[a-z])\s*[.,]\s+|\(\s*(?:[a-z]|[ivx]{1,4})\s*\)/gi;
/** One benefit printed in two documents: the same name, or the same benefit where only one of them prints a section
 * before it. Two different sections ("Simple Fracture: Wrist", "Compound Fracture: Wrist") are different benefits (TE #103 C4). */
function sameBenefit(a: string, b: string): boolean {
  const x = nameParts(a), y = nameParts(b);
  if (!(x.section === y.section || x.section == null || y.section == null)) return false;
  if (x.core === y.core) return true;
  // A note in brackets that only one document prints after the name ("Arm, Elbow, Wrist or Ribs (Other Fracture)" in the
  // Benefit Summary, "Arm, Elbow, Wrist or Ribs" in the Product Summary, live run 23 Oct after #111, D1; TE #111 C8). Two
  // different notes ("(Full Break)", "(Partial Break)") are different benefits.
  const note = /\([^()]*\)\s*$/;
  const bare = (t: string) => nameParts(t.replace(/(?:\s*\([^()]*\))+\s*$/, "")).core;
  // The server's own first-year note is not a document's: the first-year premium is not the later one (TE #112 N4).
  if (PERIOD_NOTE.test(a) || PERIOD_NOTE.test(b)) return false;
  return note.test(a) !== note.test(b) && bare(a) === bare(b);
}

const sameFigure = (a: Figure, b: Figure) => (a.kind === "printed" || a.kind === "worked_out") && (b.kind === "printed" || b.kind === "worked_out")
  && Math.abs(a.amount - b.amount) < 0.005 && (a.kind === "printed" ? a.unit : "lump_sum") === (b.kind === "printed" ? b.unit : "lump_sum");

/** Whether a daily row's printed words (its line, the lines that continue it, and its quote) hold no limit but its most
 * days: no money figure other than the daily rate, and no cap word once "max 30 days" is taken out. A stay is never worked
 * out past an overall limit ("S$100 a day, max 30 days, overall limit S$2,000", Critic R108-1). */
// "Maximum 30 days", "up to a maximum of 30 days", or "up to 30 days": the most days the rate is paid, not a money cap.
const MAX_DAYS = /\b(?:(?:up\s+to\s+(?:a\s+)?)?max(?:imum)?\.?\s*(?:of\s*)?:?\s*(?:[a-z-]+\s*)?|up\s+to\s+)\(?\d+\)?\s*(?:continuous\s+|consecutive\s+)?days?\b/gi;
function dailyRateAlone(row: ChatRow, household: Household): boolean {
  if (row.figure.kind !== "printed") return false;
  const found = locateQuote(household, row.source.excerpt, row.docIndex);
  const page = found && household.documents[found.docIndex].pages.find((p) => p.page === found.page);
  if (!found || !page) return false;
  // The row with every line under it up to the next heading, non-benefit fields left out (stayBlock): a limit, aggregate,
  // day rule or condition anywhere below the row gives no total (Critic P392, TE #392).
  const block = stayBlock(page.text, found.offset);
  const below = block.tail.replace(MAX_DAY_FIELD, " ");
  if (STAY_BLOCK_WORDS.test(below)) return false;
  const words = `${block.text}\n${found.excerpt}`;
  const daily = row.figure.amount;
  if (moneyFiguresIn(words).some((f) => Math.abs(f.value - daily) > 0.005)) return false;
  const rest = words.replace(MAX_DAYS, " ");
  return !CAP_WORDS.test(rest) && !/\b(?:limit|aggregate|overall|in\s+total)\b/i.test(rest);
}

/** What a row is, in the server's words only: its benefit and cover, whom it is for, how it is paid, and whether it is
 * a projection. The model's own sentence is not used for an amount, so a figure is never labelled as another benefit. */
export function rowLabel(row: ChatRow, labels?: Map<string, string>, names?: (row: ChatRow) => string): string {
  const f = row.figure;
  const cover = labels?.get(fullCover(row)) ?? fullCover(row);
  // A daily row's first paid day and most days are part of what it pays, so its card always says them (stress run 23 Oct,
  // S008, S016: "S$30 per day" shown without "from day 11").
  const daily = `paid per day${row.fromDay != null && row.fromDay > 1 ? `, from day ${row.fromDay} of the stay` : ""}${row.maxDays != null ? `, for at most ${row.maxDays} days` : ""}`;
  const how = f.kind === "printed" ? (f.unit === "per_day" ? daily : f.unit === "per_period" ? (/\s/.test(f.period ?? "") ? `paid ${periodWords(f.period)}` : `paid per ${(f.period ?? "period").replace("_", " ")}`) : f.unit === "up_to" ? (row.lesserOf ? "the cost, up to this limit, whichever is less" : "up to this limit") : null)
    : f.kind === "value" ? `a value${f.asOf ? ` as of ${f.asOf}` : ", date not printed"}`
    : f.kind === "projected" ? `projected, not guaranteed${f.asOf ? ` (${f.asOf})` : ""}`
    // A worked-out figure's card shows how it is worked out ("25% of S$5,000") on its own line, so the label does not. A
    // capped one is given as its printed cap, with no such line, so its label says what the cap limits.
    : f.kind === "worked_out" && f.capped && row.percent != null ? `${row.percent}% of ${row.percentOf === "sum_insured" ? "the sum insured" : "the figure its table prints"}, up to this limit` : null;
  // A table's row letter or number ("J, ", "D. ") is the document's layout, not the benefit's name.
  // A figure its quote prints "per child (up to 2 children)" is that, never a sum for the family (release-set H10).
  const per = f.kind === "printed" && f.unit !== "per_day" && f.unit !== "per_period" ? perUnit(row.source.excerpt, f.amount) : null;
  return `${names ? names(row) : row.benefit} (${cover})${row.qualifier ? `, for ${row.qualifier} only` : ""}${how ? `: ${how}` : ""}${per ? `${how ? "," : ":"} ${per}` : ""}.`;
}

/** A row whose printed figure is paid per child ("S$5,000 per child (up to 2 children)"). */
const perChild = (row: ChatRow) => row.figure.kind === "printed" && /^per\s+(?:dependant\s+|dependent\s+|eligible\s+)?(?:child(?:ren)?|dependants?|dependents?)\b/i.test(perUnit(row.source.excerpt, row.figure.amount) ?? "");
/** What a printed figure is counted per, as its quote prints it right after the figure: "S$5,000 per child (up to 2
 * children)" gives "per child (up to 2 children)". Null when nothing follows. */
function perUnit(excerpt: string, amount: number): string | null {
  for (const m of excerpt.matchAll(new RegExp(String.raw`${MONEY_SIGN}?\s?(\d[\d,]*(?:\.\d+)?)\s*(?:each\s+)?(per\s+(?:child|children|person|insured(?:\s+person)?|life|member|dependant|family|claim|visit|trip|event|accident|incident|injury|bone|fracture|policy\s+year|year|disability|confinement|admission)\b(?:\s*\((?:up\s+to|maximum|max\.?|subject\s+to)[^)]{1,40}\))?(?:,?\s*subject\s+to\s+a\s+maximum\s+of\s+\w+\s+\w+)?)`, "gi")))
    if (Math.abs(Number(m[1].replace(/,/g, "")) - amount) < 0.005) return m[2].replace(/\s+/g, " ").trim();
  return null;
}

/** A word before a number that makes it an identifier, not money: "Plan 300", "Policy No. 1234567", "Certificate 000123". */
const ID_BEFORE = /(?:\b(?:no|nos|number|plan|option|policy|certificate|cert|scheme|section|ward|class|part|clause|schedule|version|ref|reference|code|id|tier|level)\.?|#)\s*:?\s*$/i;
const NUMBER_WORD = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand|million|billion)\b/i;

/** A name states money when it prints a currency figure ("S$1,000,000", "$500"), a figure grouped in thousands
 * ("1,000,000", "1 000 000", "1.000.000"), a size word ("1 million", "5k"), dollars with a number ("one million dollars"),
 * a rate ("200 per day", "200/day"), a limit or sum ("up to 5000", "of 600000", "Sum insured: 300000") or a bare figure of
 * five or more digits ("Accidental death 200000"). A benefit's own name also states money with any other bare number of
 * 100 or more ("Room & Board 300"), unless it counts days, visits or claims (Critic R94, TE #96). Products and covers are
 * often named with a number ("Shield 360", "Smart Life 100", "MER 1500"), so for them, and for plans, a bare number needs
 * one of those money cues. A number is a name's own when it is glued to letters or signs ("G000123", "SG-2026-001234"),
 * starts with 0, is a year, or follows a word that numbers things ("Plan 300", "Policy No. 1234567"). */
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

/** A condition's words as compared between a card and a point: case, spacing and closing punctuation aside, nothing else. */
const conditionWords = (x: string) => x.toLowerCase().replace(/\s+/g, " ").replace(/[\s.;,:]+$/, "").trim();
/** Each "<benefit> also depends on this: <condition>" point whose condition, word for word, every card it is said for
 * already shows among its own conditions, is left out: the checks can keep a condition on the card (by moving the card to
 * the line of the document that prints it) that the row step had said apart, and the household would read it twice (live
 * run 25 Oct). A point is kept while any card it belongs to is not shown or does not show those same words: a condition is
 * never lost. */
export function dropConditionsOnCards<T extends { kind: string; text: string; amount?: unknown; personName?: string | null; conditions?: string[] }>(statements: T[], report: RowReport): T[] {
  const points = report.conditionPoints ?? [], cards = report.cards ?? {};
  if (!points.length) return statements;
  return statements.filter((s) => {
    if (s.amount || s.kind !== "fact") return true;
    const point = points.find((p) => p.text === s.text);
    if (!point) return true;
    const want = conditionWords(point.condition);
    return !point.rows.every((id) => {
      const card = cards[id];
      if (!card) return false;
      const shown = statements.filter((x) => x.amount && x.text === card.text && (x.personName ?? null) === card.person);
      return shown.length > 0 && shown.every((x) => (x.conditions ?? []).some((c) => conditionWords(c) === want));
    });
  });
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
  // What a number of children could pay under a labelled per-child row (the checks' own "For 2 children ..." card,
  // overnight run 23 Oct, N023): kept only when the row's label prints the same per-child words and the same most children,
  // and the amount is that many times the row's own.
  const countOf = (st: T) => {
    if (!st.id?.endsWith("-count")) return false;
    const parent = statements.find((s) => s.id === st.id!.slice(0, -"-count".length));
    const rule = /^(.+?) (per (?:dependant |dependent |eligible )?(?:child(?:ren)?|dependants?|dependents?))(?:, for at most (\d+) child(?:ren)?)? \((\d+) × (.+?)\), for the children you described$/.exec(st.basis ?? "");
    if (!rule || !parent || !labels.has(parent.text) || !parent.amount || !parent.text.toLowerCase().includes(rule[2])) return false;
    const most = rule[3] != null ? Number(rule[3]) : null, times = Number(rule[4]);
    const said = /\(?(?:up\s+to|subject\s+to\s+a\s+maximum\s+of|a\s+maximum\s+of|maximum\s+of|max(?:imum)?\.?(?:\s+of)?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:dependant\s+|dependent\s+|eligible\s+)?(?:child(?:ren)?|dependants?|dependents?)/i.exec(parent.text);
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    const printed = said ? (/^\d+$/.test(said[1]) ? Number(said[1]) : WORDS.indexOf(said[1].toLowerCase())) : null;
    if (printed !== most || (most != null && times > most)) return false;
    const figure = (x: unknown) => { const t = (x as { text?: unknown } | null)?.text; const m = typeof t === "string" ? /(\d[\d,]*(?:\.\d+)?)\s*$/.exec(t) : null; return m ? Number(m[1].replace(/,/g, "")) : NaN; };
    const sign = (x: unknown) => String((x as { text?: unknown }).text ?? "").replace(/[\d,.\s]+$/, "");
    return rule[5] === (parent.amount as { text?: unknown }).text && sign(st.amount) === sign(parent.amount)
      && Math.abs(figure(st.amount) - times * figure(parent.amount)) < 0.005;
  };
  const refused = statements.filter((st) => st.amount && !labels.has(st.text) && !stayOf(st) && !countOf(st));
  return { kept: statements.filter((st) => !refused.includes(st)), refused };
}

/** Applied last: an amount the row step dropped or refused never reached verifyAnswer, so its "left out an amount" note
 * is added here (in place of the weaker "left out a point"), and the household always hears that an amount was left out. */
export function noteLeftOutAmounts<T extends { id: string; kind: string; text: string }>(statements: T[], report: RowReport, make: (id: string, text: string) => T): T[] {
  // An amount the answer itself says does not fit the event is not one the documents fail to print: no note for it.
  if (!report.dropped.some((d) => !d.notFit) || statements.some((s) => s.id === "left-out-amount")) return statements;
  return [...statements.filter((s) => !(s.id === "left-out-fact" && s.text === LEFT_OUT_FACT)), make("left-out-amount", LEFT_OUT_AMOUNT)];
}

/** A percentage row worked out on the person's own printed sum insured (not a corrected one), with where that sum is. */
const sumInsuredShare = (row: ChatRow) => row.figure.kind === "worked_out" && row.percentOf === "sum_insured" && row.percent != null && row.percent > 0
  && row.base != null && !row.baseCorrected && !!row.baseSource && row.baseDocIndex != null && !!row.figure.currency;
/** The pointers the chat's checks need to show a percentage row's amount (lib/simple-chat/verify.ts serverFigureChecked): the
 * row's percentage, the person's own sum insured line and the row's printed maximum. The checks find each in the stored pages
 * and work the amount out again; nothing here is shown as it is. Null for any other row, or when the row's maximum cannot
 * be read as one figure. */
export function serverFigureOf(row: ChatRow, st: Record<string, unknown>, household: Household): ServerFigure | null {
  if (!sumInsuredShare(row) || row.figure.kind !== "worked_out" || typeof st.quote !== "string") return null;
  const currency = row.figure.currency!;
  let cap: ServerFigure["cap"] = null;
  if (row.capSource) {
    const capDoc = household.documents.findIndex((d) => d.policyId === row.capSource!.documentId);
    const values = [...new Set(moneyFiguresIn(row.capSource.excerpt).filter((m) => m.currency === currency && Math.abs(m.value - row.base!) >= 0.005).map((m) => m.value))];
    const value = row.figure.capped ? row.figure.amount : values.length === 1 ? values[0] : null;
    if (capDoc < 0 || value == null) return null;
    cap = { value, docIndex: capDoc, page: row.capSource.page, quote: row.capSource.excerpt };
  }
  return { text: String(st.text), person: baseName(row.person), quote: st.quote, percent: row.percent!, currency,
    row: { docIndex: row.docIndex, page: row.source.page, quote: row.source.excerpt },
    base: { value: row.base!, docIndex: row.baseDocIndex!, quote: row.baseSource!.excerpt }, cap };
}

/** One row as a statement the simple chat's checks understand: the figure as printed with the row's own words, or the
 * percentage with the base it is worked out on and the words that print that base. */
function statementFromRow(row: ChatRow, raw: Record<string, unknown>, labels: Map<string, string>, names?: (row: ChatRow) => string): Record<string, unknown> | null {
  const f = row.figure;
  const said = rowLabel(row, labels, names);
  const base = { ...raw, text: said, person: baseName(row.person), document: documentId(row.docIndex), quote: row.source.excerpt, amount: null, percentOf: null };
  if (f.kind === "none") return null;
  if (f.kind !== "worked_out") return { ...base, amount: money(f.amount, f.currency) };
  // Capped: the amount is the printed cap, checked against the words that print it.
  if (f.capped) return row.capSource ? { ...base, quote: row.capSource.excerpt, amount: money(f.amount, f.currency) } : null;
  if (row.percent == null || row.base == null) return null;
  // A sum insured the household corrected is not printed anywhere, so the checks cannot find it: the row is given as its
  // printed percentage, with where the amount is shown.
  if (row.baseCorrected)
    return { ...base, kind: "fact", text: `${said.replace(/\.$/, "")}: ${row.percent}% of the sum insured you corrected on the Coverage page, which shows the amount.`, alternativeGroup: null, perDay: null, ofBill: null };
  const own = row.baseSource && row.baseSource.page === row.source.page && row.baseSource.documentId === row.source.documentId;
  return { ...base, percentOf: { percent: row.percent, baseAmount: money(row.base, f.currency),
    baseDocument: own || row.baseDocIndex == null ? null : documentId(row.baseDocIndex), baseQuote: own || !row.baseSource ? null : row.baseSource.excerpt } };
}

/** A sentence of the model's own words that shuts a person out of a cover by ownership ("they belong to Alex, not
 * Jamie", "only Alex has it", "Alex's alone") while the answer's cards, or that person's own table rows for the
 * same benefit, show they have it (live run 22 Oct, C5). Such a sentence is a wrong-person statement even without an
 * amount, so it is left out. A sentence that names a kind of cover the person has no row for ("Jamie is not covered by
 * the travel policy") is kept. */
export const PERSON_OVERRULED = "a sentence said a person does not have a cover their own rows show";
const NOT_COVER_WORD = new Set(["benefit"]);
export function dropPeopleShutOut<T extends { kind: string; text: string; fullText?: string; amount?: unknown; personName?: string | null }>(
  answer: { summary: string; bottomLine?: string | null; statements?: T[] }, rows: ChatRow[], household: Household, labels: readonly string[]): string[] {
  const people = household.members.map((m) => baseName(m.name));
  const words = (n: string) => n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
  // The words that name each person and no one else ("wei", "ming", "ling").
  const own = new Map(people.map((p) => [p, words(p).filter((w) => !people.some((o) => o !== p && words(o).includes(w)))]));
  const alt = (p: string) => own.get(p)!.length ? `(?:${own.get(p)!.join("|")})` : null;
  const statements = answer.statements ?? [];
  const cards = statements.filter((s) => s.amount);
  // The rows behind the cards: the row whose server label a card reads.
  const labelled = new Set(labels);
  const carded = rows.filter((r) => cards.some((c) => c.text === rowLabel(r, coverLabels(rows), benefitNames(rows)) && labelled.has(c.text)));
  const rowText = (r: ChatRow) => [r.product, r.cover, r.plan, r.benefit].join(" ").toLowerCase();
  // Y is shut out of a cover the answer itself shows is Y's: a card of Y's, or Y's own row for a carded benefit, of the
  // kind the sentence names. A card of Y's for another cover says nothing about it ("Only Alex has the Term Life
  // policy" beside her accident card, while her term life is a group policy, TE #104 S4).
  // The product and cover names' own words ("savemore", "shield"), so a sentence naming a policy is held to that policy.
  const GENERIC = new Set(["group", "scheme", "plan", "cover", "policy", "benefit", "benefits", "insurance", "with"]);
  const productWords = new Set(rows.flatMap((r) => `${r.product} ${r.cover}`.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length >= 4 && !GENERIC.has(w)));
  const has = (p: string, sentence: string) => {
    const kinds = [...sentence.toLowerCase().matchAll(new RegExp(COVER_KIND.source, "gi"))].map((m) => m[0]).filter((w) => !NOT_COVER_WORD.has(w))
      .concat(sentence.toLowerCase().split(/[^a-z]+/).filter((w) => productWords.has(w)));
    const named = (r: ChatRow) => kinds.every((k) => rowText(r).includes(k));
    if (carded.some((r) => baseName(r.person) === p && named(r))) return true;
    if (!kinds.length && cards.some((c) => c.personName && baseName(c.personName) === p)) return true;
    return carded.some((r) => baseName(r.person) !== p && rows.some((o) => baseName(o.person) === p && named(o) && fullCover(o) === fullCover(r) && sameBenefit(o.benefit, r.benefit)));
  };
  // Only ownership or exclusivity is read ("belongs to Alex, not Jamie", "Alex's alone", "only Alex has it"). A
  // sentence that gives a reason or a condition ("Tan does not get the ambulance benefit, because no ambulance was used") is
  // never left out (Critic R131-1).
  const REASON = /\b(?:because|unless|if|until|since|without|provided|as\s+long\s+as|only\s+when|so\s+long\s+as|due\s+to)\b/i;
  const OWNED = /\b(?:belong\w*|held\s+by|holds?|owns?|owned)\b|\w's(?:,|\s+(?:alone|only|cover|policy|policies)\b)/i;
  const shutOut = (sentence: string): boolean => !REASON.test(sentence) && people.some((y) => {
    const Y = alt(y);
    if (!Y) return false;
    const notY = OWNED.test(sentence) && new RegExp(String.raw`\b(?:not|but\s+not|rather\s+than|instead\s+of)\s+(?:to\s+|by\s+)?${Y}\b`, "i").test(sentence);
    const others = people.filter((x) => x !== y && alt(x) && new RegExp(String.raw`\b(?:only|solely|exclusively)\s+(?:[a-z]+\s+){0,3}?${alt(x)}(?:\s+[a-z]+){0,3}?(?:'s)?\s+(?:has|have|holds?|owns?|is\s+covered|are\s+covered)\b|\b${alt(x)}'s\s+alone\b|\b${alt(x)}'s\s+(?:[a-z]+\s+)?(?:cover|policy|policies|plan|benefit)s?\s+only\s*(?:[.,;:!?)]|$)|\b${alt(x)}\s+alone\s+(?:has|holds?|owns?|is\s+covered)\b|\bbelongs?\s+only\s+to\s+${alt(x)}\b|\bonly\s+(?:belongs?|held)\s+(?:to|by)\s+${alt(x)}\b`, "i").test(sentence));
    const shut = notY || (others.length > 0 && !new RegExp(String.raw`\b${Y}\b`, "i").test(sentence));
    return shut && has(y, sentence);
  });
  const left: string[] = [];
  const keep = (text: string) => sentences(text).filter((x) => { const out = shutOut(x); if (out) left.push(x); return !out; }).join(" ");
  const bottom = keep(answer.bottomLine ?? answer.summary);
  for (const s of [...statements]) {
    if (s.amount || labelled.has(s.text)) continue;
    const text = keep(s.text);
    if (text === s.text) continue;
    if (!text) statements.splice(statements.indexOf(s), 1);
    else { s.text = text; s.fullText = text; }
  }
  if (left.length) {
    const b = bottom || (cards.length ? "Here is what your documents show for each person." : "Here is what your documents say.");
    answer.summary = b;
    if (answer.bottomLine != null) answer.bottomLine = b;
  }
  return left;
}
