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
import { benefitName, benefitNames } from "./headline";
import type { Household } from "@/lib/simple-chat/library";
import { documentId, escapeText, unreadable } from "@/lib/simple-chat/library";
import { LEFT_OUT_AMOUNT, LEFT_OUT_FACT, conditionApplies, locateQuote, matchMember, membersNamedIn, readModelAnswer, rowWithContinuation, sentences, statesMoney, verifyAnswer } from "@/lib/simple-chat/verify";
import { CAP_WORDS } from "./check";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";

export type ChatRow = TableRow & { id: string; docIndex: number; baseDocIndex: number | null;
  /** The limit's own line, or the same benefit's line for the same figure in another of the person's documents, says the
   * cost is paid when it is less ("up to $10,000 of the costs ..., whichever is lesser", release-set H7). */
  lesserOf?: boolean;
  /** The date the person's cover started, as its own cover line prints it (a start date, or the date the line is printed
   * for): a cover this new may still be inside a waiting period. */
  coverSince?: string | null };
/** `labels`: the server's own wording of each statement it wrote. The chat's checks keep exactly these words (verifyAnswer's
 * serverWords), and an amount whose statement does not read exactly one of them is refused (keepLabelledAmounts). */
export type RowReport = { dropped: { why: string; text: string; notFit?: boolean; row?: string }[]; labels: string[];
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
  // First-year premiums come last, so the other rows keep their numbers.
  const firstYears: TableRow[] = [];
  for (const p of table.people) for (const c of p.covers) for (const r of coverRows(c, p.name)) {
    const firstYear = r.source === c.firstYearSource;
    if (r.benefit === premiumName(c) || firstYear) {
      const key = [p.id, firstYear ? "first year" : "premium", c.product, c.premium, (c.premiumSource ?? c.source).documentId, (c.premiumSource ?? c.source).excerpt].join("|");
      if (premiums.has(key)) continue;
      premiums.add(key);
    }
    if (firstYear) firstYears.push(r); else add(r);
  }
  for (const r of firstYears) add(r);
  // A limit whose own line prints one daily rate ("Capped at S$200 per day" over "S$8,000") pays that rate a day, up to the
  // limit: the rate is a row of its own after it, so the card for "how much a day" is the rate, never the limit (stress run
  // 23 Oct, S016). Added last, so every other row keeps its number.
  for (const r of [...rows]) {
    const rate = r.figure.kind === "printed" && r.figure.unit === "up_to" ? dailyRateOf(r.source.excerpt, r.figure.amount) : null;
    if (rate != null && r.figure.kind === "printed") add({ ...r, figure: { kind: "printed", amount: rate, currency: r.figure.currency, unit: "per_day" }, fromDay: null, maxDays: null });
  }
  // Plan-table lines the reading left out ("Sub-limit for laptop / tablet (in total)", overnight run 23 Oct, N112, N113,
  // N133, N263), in the plan column the person's other rows from that table are read in. Added last, after every other row.
  for (const r of planTableRows(rows, household)) add(r);
  const since = new Map(table.people.flatMap((p) => p.covers.map((c) => [`${p.id}|${c.coverKey}`, c.startDate ?? c.asOf ?? null] as const)));
  for (const r of rows) r.coverSince = since.get(`${r.personId}|${r.coverKey}`) ?? null;
  for (const r of rows) if (r.figure.kind === "printed" && r.figure.unit === "up_to" && [r, ...siblings(r, rows)].some((o) => sameFigure(o.figure, r.figure) && lesserOf(o.source.excerpt)))
    r.lesserOf = true;
  return rows;
}

/** A plan table's cell: a money figure, or words printed in place of one. */
const PLAN_CELL = /^(?:(?:S\$|US\$|SGD\s?|\$)\s?\d[\d,]*(?:\.\d+)?|not\s+covered|not\s+applicable|covered|unlimited)$/i;
const SUB_LIMIT = /^(?:sub-?\s?limit|overall\s+limit)\b/i;
/** Rows a plan table prints that the reading left out, for each person's plan: a line that prints exactly one cell per plan
 * column under the table's own heading line ("Premium\tBusiness\tFirst"), named by the line just above it (with the words
 * before its cells), or, when the line above is another row's cells, the line just below it. A sub-limit is named with the
 * benefit whose cells come just before it, and only then. A line with fewer cells (merged across plans), a qualifier
 * ("Adult below 70 years of age"), a family-plan limit, or a name another row from that page already has gives none:
 * a row left out is a missing card, never a wrong one. */
export function planTableRows(rows: ChatRow[], household: Household): TableRow[] {
  const out: TableRow[] = [];
  const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Set<string>();
  for (const template of rows) {
    if (!template.column || !template.plan || template.figure.kind !== "printed") continue;
    const group = `${template.personId}|${template.source.documentId}|${template.coverKey}`;
    if (seen.has(group)) continue;
    seen.add(group);
    const doc = household.documents[template.docIndex];
    const theirs = rows.filter((o) => o.personId === template.personId && o.source.documentId === template.source.documentId);
    for (const page of doc?.pages ?? []) {
      const lines = page.text.split("\n").map((l) => l.trim());
      const cellsOf = (l: string | undefined) => (l ?? "").split("\t").map((c) => c.trim()).filter(Boolean);
      let cols: string[] | null = null, parent: string | null = null;
      const valuesOf = (l: string | undefined) => { const c = cellsOf(l); return cols && c.length >= cols.length && c.length <= cols.length + 1 && c.slice(-cols.length).every((x) => PLAN_CELL.test(x)) ? c : null; };
      const labelLine = (l: string | undefined) => !!l && !l.includes("\t") && /^[A-Z]/.test(l) && !/\d/.test(l) && !valuesOf(l) && !/^(?:maximum benefit limit|unless otherwise|note\b)/i.test(l);
      const used = new Set<number>();
      for (let i = 0; i < lines.length; i++) {
        const c = cellsOf(lines[i]);
        // An optional cover's table ("Optional covers" over its heading) is for a cover the person may not hold: never read.
        if (c.length >= 2 && c.includes(template.column) && c.every((x) => /^[A-Z][A-Za-z ]{1,20}$/.test(x))) { cols = /\b(?:optional|add-?ons?|riders?)\b/i.test(lines[i - 1] ?? "") ? null : c; parent = null; continue; }
        if (!cols || used.has(i)) continue;
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
        const below = above == null && !inline && valuesOf(lines[i - 1]) && labelLine(lines[i + 1]) && !SUB_LIMIT.test(lines[i + 1]) && !valuesOf(lines[i + 2]) ? i + 1 : null;
        const own = [above != null ? lines[above] : below != null ? lines[below] : null, inline].filter((x): x is string => !!x).join(": ");
        if (above != null) used.add(above);
        if (below != null) used.add(below);
        used.add(i);
        if (!own) { parent = null; continue; }
        const sub = SUB_LIMIT.test(own);
        if (!sub) parent = own;
        if (sub && (!parent || /family/i.test(own))) continue;
        const name = sub ? `${parent}: ${own}` : own;
        if (/^(?:adult|child|children|overall)\b/i.test(own) && !sub) { parent = null; continue; }
        const money = /^(?:S\$|US\$|SGD\s?|\$)\s?(\d[\d,]*(?:\.\d+)?)$/i.exec(cell);
        const notCovered = /^not\s+(?:covered|applicable)$/i.test(cell);
        if (!money && !notCovered) continue;
        // A name another row from this page already has (as its name or in its line) is that row's.
        const keys = [own, above != null ? lines[above] : null, below != null ? lines[below] : null].filter((x): x is string => !!x).map(plain);
        if (theirs.some((o) => o.source.page === page.page && keys.some((key) => plain(o.benefit).includes(key) || plain(o.source.excerpt).includes(key)))) continue;
        const excerpt = [above, i, below].filter((x): x is number => x != null).sort((x, y) => x - y).map((k) => lines[k]).join("\n");
        out.push({ ...template, benefit: name, pays: money ? "up_to" : "not_covered", conditions: [], fromDay: null, maxDays: null, qualifier: null,
          figure: money ? { kind: "printed", amount: Number(money[1].replace(/,/g, "")), currency: template.figure.currency, unit: "up_to", period: null } : { kind: "none", why: "printed as not covered" },
          source: { ...template.source, page: page.page, excerpt }, baseSource: null, percent: null, percentOf: null, base: null, capSource: null } as TableRow);
      }
    }
  }
  return out;
}

/** The one daily rate a limit's own line caps it at ("Capped at S$200 per day", "maximum S$300 per day"), when it is not the
 * limit itself; null when it prints none, or more than one. */
function dailyRateOf(excerpt: string, limit: number): number | null {
  // A daily figure that is something else (an ICU rate, an excess, a companion's or an allowance's) is never the limit's
  // own rate, so a line that names one gives none (Critic R153-2).
  if (/\b(?:ICU|intensive|excess|deductible|co-?pay\w*|companion|allowance)\b/i.test(excerpt)) return null;
  // A line with its own day rule ("from the 11th day") would lose it on a row of its own (TE R6).
  if (/\b(?:from|after|beyond|starting|commencing)\b[^.\n]{0,25}\bday\b|\bday\s+\d/i.test(excerpt)) return null;
  const rates = new Set(moneyFiguresIn(excerpt).filter((f) => {
    const at = excerpt.indexOf(f.raw ?? "");
    // Only a rate that caps what is paid: "Capped at S$200 per day", "maximum S$300 per day".
    return at >= 0 && /^\s*(?:per|a|each|every)\s+day\b/i.test(excerpt.slice(at + (f.raw ?? "").length))
      && /\b(?:capped\s+at|up\s+to|maximum(?:\s+of)?|max\.?|limited\s+to|not\s+exceeding)\s*:?\s*$/i.test(excerpt.slice(Math.max(0, at - 30), at));
  }).map((f) => f.value));
  const [rate] = [...rates];
  return rates.size === 1 && Math.abs(rate - limit) > 0.005 && rate < limit ? rate : null;
}

/** The same benefit of the same cover, for the same person and group, printed in another of their documents. */
const siblings = (row: ChatRow, rows: ChatRow[]) => rows.filter((o) => o !== row && o.personId === row.personId && o.coverKey === row.coverKey
  && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit));
const lesserOf = (excerpt: string) => /\bwhichever\s+is\s+(?:the\s+)?(?:lesser|lower|less)\b|\b(?:the\s+)?(?:lesser|lower)\s+of\b/i.test(excerpt);

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

/** A premium row's name: the premium line's own words ("Instalment Premium"), how often it is paid when printed, and that
 * the first policy year's premium is different when its page says so. */
const premiumName = (c: PersonCover) => `${c.premiumLabel || "Premium"}${c.premiumFrequency ? `, ${c.premiumFrequency}` : ""}${c.premiumNote ? ` (${c.premiumNote})` : ""}`;

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
    out.push(row(premiumName(c), { kind: "printed", amount: c.premium, currency: c.premiumCurrency === undefined ? c.currency : c.premiumCurrency, unit: "lump_sum" }, c.premiumSource ?? c.source));
  // The first policy year's premium its page prints (release-set A6), named as that page names it.
  if (c.premium != null && c.firstYearPremium != null && c.firstYearSource)
    out.push(row(`${c.firstYearLabel || "First Year Premium"}${c.premiumFrequency ? `, ${c.premiumFrequency}` : ""} (first policy year only)`, { kind: "printed", amount: c.firstYearPremium, currency: c.premiumCurrency === undefined ? c.currency : c.premiumCurrency, unit: "lump_sum" }, c.firstYearSource));
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
 * note, whatever the model wrote. No figure in it. */
export const NARROWED_PAGES_NOTE = "Waiting periods, exclusions and other conditions can be printed on pages not used for this answer. Check the full document, or ask the insurer, before you claim.";
export function noteNarrowedPages<T extends { id: string; kind: string; text: string; amount?: unknown }>(statements: T[], make: (id: string, text: string) => T): T[] {
  if (!statements.some((s) => s.amount) || statements.some((s) => s.id === "narrowed-pages")) return statements;
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
For every statement that gives a row's amount, or points at one ("this amount"), set "eventFit": "on_list" when the row pays only for what a list names (critical illnesses, early critical illnesses, listed injuries) and the event asked about is on that list; "not_on_list" when it pays only for a list and the event is not on it (that card is never shown, so say in a fact that it is not on the list); "any_event" when the row is not limited to a list and pays on the event itself; "not_described" when the row pays only if a further thing happened that the household has not said happened, even one that often follows such an event (an ambulance was used, a hospital or intensive care stay, equipment bought, a death: that card is never shown either, so say in a fact what it needs); "no_event" when the question names no event (asking what a benefit is, or what a person has, is no event). For an event, give every row that pays on it, also one paid for a family member (per child, for a spouse), saying its condition. For a statement about an event ("on_list" or "any_event"), set "waiting" when a waiting period printed for the row's cover could apply to it: {"applies": "yes", "unsure" or "no" (whether it covers this event), "days": its length in days as printed (3 months is 90), "from": the date it runs from as printed for this person (the policy's issue, start or cover date, as DD/MM/YYYY)}; null when the cover prints no waiting period. The app compares those dates with today and never shows a card inside a waiting period that applies or may apply, so say why in a fact. Set "period" for every statement; for an amount whose cover prints its own period of cover (a trip's dates, a policy's start and end): {"from": its first day, "to": its last day, as printed (DD/MM/YYYY, "" when not printed), "eventOn": the date the event happened as the household said it (DD/MM/YYYY; today's date when they say it is happening now; "" when they did not say when)}; all three "" when no period is printed for the cover. The app compares these dates with today as well (a card for an event outside the period is never shown; say why in a fact), so say whether a period has started or ended only from those dates. Set "row" to the id of the row it gives and "rowBenefit" to that row's benefit name, copied exactly from the table ("" for a statement with no row; the app leaves out a card whose name is not its row's), and leave "amount" and "percentOf" null: the app fills in the row's figure. Give only amounts that are a row here, always with its id, also when you read the figure in another document (a premium on a tax invoice is the premium row); an amount no row shows is not given (say in a "fact" what the documents print instead). The person must be that row's person. A row "for child" or "per family" is only that; say so in the text. A projected figure is not guaranteed; say so.
${rows.map((r) => escapeText(line(r))).join("\n")}
</benefit_table>`;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A printed date as a day count (UTC midnight): "20/10/2026" (day first, as Singapore prints it), "2026-10-20",
 * "20 October 2026". Null for anything else. */
export function printedDay(text: unknown): number | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  const at = (y: number, mo: number, d: number) => {
    const ms = Date.UTC(y, mo - 1, d), x = new Date(ms);
    return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? ms / 86_400_000 : null;
  };
  if (m) return at(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return at(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/i.exec(t);
  if (m && MONTHS.includes(m[2].toLowerCase())) return at(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()) + 1, Number(m[1]));
  return null;
}
/** Today in Singapore (UTC+8), as a day count. */
const singaporeDay = (now: Date) => Math.floor((now.getTime() + 8 * 3_600_000) / 86_400_000);
/** A waiting period runs this long at most: a cover that started earlier is past every one. */
const LONGEST_WAIT_DAYS = 365;
/** Why a card is not shown because of a waiting period, or null. The model says for each card whether a waiting period
 * applies to the event and, as printed, how many days it runs and from what date; the server compares the dates itself.
 * A period that applies or may apply, and has not ended today (or cannot be dated), hides the card: an amount inside a
 * waiting period is never shown as payable (stress run 23 Oct, S023). A list cover (critical illnesses, listed injuries)
 * whose cover started within a year, for an event, with no waiting period said, is hidden too: it was not checked. */
function insideWaiting(raw: Record<string, unknown>, row: ChatRow, today: number, household: Household): string | null {
  // Only for an event: a cover listed with no event asked about ("what is Desmond covered for") is not a payment.
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

/** Why a card for an event is not shown because its cover's printed period (a trip's dates) does not include the event's
 * date, or null. The model gives the period as printed and the date of the event as the household said it (today's for an
 * event happening now); with no date said, the card is shown with when its period ended. The server compares the dates (live run 23 Oct, S048 and S008: a trip that ended on 4 Oct). */
function outsidePeriod(raw: Record<string, unknown>, row: ChatRow, today: number): string | null {
  if (raw.eventFit !== "on_list" && raw.eventFit !== "any_event") return null;
  const p = raw.period as { from?: unknown; to?: unknown; eventOn?: unknown } | null | undefined;
  if (!p || typeof p !== "object") return null;
  // An event with no date said is not taken as today's: it may have happened during the trip, and missing information is
  // never an exclusion (Critic R156-1). Its card says when the period ended instead.
  const from = printedDay(p.from), to = printedDay(p.to), on = printedDay(p.eventOn);
  if (on == null) return null;
  if (to != null && on > to) return `its cover period ended on ${p.to}`;
  if (from != null && on < from) return `its cover period starts on ${p.from}`;
  return null;
}
/** The day a card's cover period ended, as printed, when it ended before today: said on a card shown with no event. */
function periodEnded(raw: Record<string, unknown>, today: number): string | null {
  const p = raw.period as { to?: unknown } | null | undefined;
  const to = p && typeof p === "object" ? printedDay(p.to) : null;
  return to != null && to < today ? String(p!.to) : null;
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
/** The model's raw reply with every amount statement rewritten from its row, before readModelAnswer and verifyAnswer see
 * it. Statements of other kinds are left as they are. */
export function amountsFromRows(json: unknown, rows: ChatRow[], household: Household, now: Date = new Date(), question = ""): { json: unknown; report: RowReport } {
  const report: RowReport = { dropped: [], labels: [], days: {} };
  if (!json || typeof json !== "object" || !Array.isArray((json as { statements?: unknown }).statements)) return { json, report };
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labels = coverLabels(rows), names = benefitNames(rows);
  const statements: unknown[] = [];
  const given = new Set<string>();
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
      : x.eventFit === "not_described" ? (asksFor(question, r) ? null : `${names(r)} pays only on something not described`)
      // A premium is charged, never paid on an event: no waiting period or cover dates hide it (live run 23 Oct, A6).
      : PREMIUM_ROW.test(r.benefit) ? null : insideWaiting(x, r, today, household) ?? outsidePeriod(x, r, today);
    if (r && why) for (const o of rows) if (!ruledOut.has(o.id) && (o.id === r.id || (o.personId === r.personId && o.coverKey === r.coverKey && o.qualifier === r.qualifier && sameBenefit(o.benefit, r.benefit)))) ruledOut.set(o.id, why);
  }
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
          away.set(key, st); statements.push(st); continue;
        }
        if (shown && Array.isArray(shown.conditions)) { shown.conditions.push({ text: t, quote }); continue; }
        statements.push({ kind: "fact", text: said, person: baseName(row.person), document: documentId(row.docIndex), quote, amount: null, percentOf: null,
          conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
      }
      continue;
    }
    given.add(row.id); given.add(named.id);
    // The same benefit of the same cover printed in another of the person's documents ("Neck, Skull or Spine (Full Break)"
    // at 100% of S$5,000 in the product summary, and at 100% of S$600,000 in the benefit summary) is given with it, as an
    // alternative that is not a total: an answer that gives one document's figure alone hides the other (release-set B7,
    // H7, H10).
    const companions = rows.filter((o) => o.id !== row.id && !given.has(o.id) && !ruledOut.has(o.id) && o.personId === row.personId && o.coverKey === row.coverKey
      && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit)
      // The same figure printed again adds nothing.
      && !sameFigure(o.figure, row.figure));
    const group = companions.length ? (typeof raw.alternativeGroup === "string" && raw.alternativeGroup.trim() ? raw.alternativeGroup : `same benefit ${row.id}`) : raw.alternativeGroup;
    // A premium whose page prints a different first-year premium is given with that first-year premium (release-set A6):
    // one after the other, never alternatives and never a total.
    const firstYear = /first policy year\)$/.test(row.benefit) ? rows.filter((o) => !given.has(o.id) && o.personId === row.personId && o.coverKey === row.coverKey
      && o.source.documentId === row.source.documentId && /\(first policy year only\)$/.test(o.benefit)) : [];
    // The named row's own conditions that the row given in its place does not print go with it, each as a point quoting
    // the named row's document (Critic R131-2).
    // Said after the card they belong to, never before it (live run 23 Oct, S087: a condition line with no card above it).
    const points: Record<string, unknown>[] = [];
    for (const c of carried) points.push({ kind: "fact", text: `${names(named)} also depends on this: ${c}`, person: baseName(named.person), document: documentId(named.docIndex),
      quote: c, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null });
    // The model's conditions that the given row's page does not print, but the same benefit's row in another of the
    // person's documents does (the Benefit Summary's "proof of need" for the Product Summary's mobility aid row,
    // release-set H7), are points of their own quoting that document. Each must apply to that row there (conditionApplies:
    // its section, its footnote mark), and never states money.
    // One point for everyone it is carried for: said for nobody in particular once it is carried for a second person.
    for (const c of awayConditions(row, raw.conditions, rows, household)) {
      if (carried.includes(c.text)) continue;
      const text = `${names(row)} also depends on this: ${c.text}`, key = `${text}|${c.at.docIndex}`;
      const seen = away.get(key);
      if (seen) { if (seen.person !== baseName(row.person)) seen.person = null; continue; }
      const st: Record<string, unknown> = { kind: "fact", text, person: baseName(row.person), document: documentId(c.at.docIndex),
        quote: c.quote, amount: null, percentOf: null, conditions: [], alternativeGroup: null, perDay: null, ofBill: null };
      away.set(key, st); points.push(st);
    }
    for (const r of [row, ...companions, ...firstYear]) {
      given.add(r.id);
      // A companion carries its own row's conditions, never the model's for the row it named (Critic R126-2).
      // Premiums for different policy years are paid one after the other, never alternatives (live run 23 Oct, A6).
      const st = statementFromRow(r, { ...raw, alternativeGroup: firstYear.includes(r) || PERIOD_ROW.test(r.benefit) ? null : group, ...(r === named ? {} : { conditions: r.conditions.map((t) => ({ text: t, quote: t })) }) }, labels, names);
      // A card shown with no event, for a cover whose printed period has ended, says so (S008: an ended trip's daily cash).
      // So does an event card with no date said (Critic R156-1).
      const event = raw.eventFit === "on_list" || raw.eventFit === "any_event";
      const undated = printedDay((raw.period as { eventOn?: unknown } | null | undefined)?.eventOn) == null;
      const ended = st && (!event || undated) ? periodEnded(raw, today) : null;
      if (st && ended) st.text = `${String(st.text).replace(/\.?\s*$/, ".")} Its cover period ended on ${ended}${event ? ", so it pays only for an event on or before that day" : ""}.`;
      if (st) {
        statements.push(st); report.labels.push(String(st.text));
        if (r.figure.kind === "printed" && r.figure.unit === "per_day")
          (report.days![String(st.text)] ??= []).push({ fromDay: r.fromDay, maxDays: r.maxDays, alone: dailyRateAlone(r, household) });
      }
      else if (r === row) report.dropped.push({ why: `row ${row.id} has no amount (${figureText(row.figure)})`, text });
    }
    statements.push(...points);
  }
  // A card left out for its copied name whose row is shown anyway (given with the same benefit from another document) is
  // not missing: no "left out an amount" for it.
  report.dropped = report.dropped.filter((d) => !d.row || !given.has(d.row));
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
const PREMIUM_ROW = /^(?!.*\b(?:waiv|return|refund)\w*).*\bpremiums?\b/i;
/** The same benefit of the same cover, printed in another of the person's documents. */
const twinOf = (o: ChatRow, row: ChatRow) => o.id !== row.id && o.personId === row.personId && o.coverKey === row.coverKey
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
  const twins = rows.filter((o) => o.id !== row.id && !given.has(o.id) && o.personId === row.personId && o.coverKey === row.coverKey
    && o.source.documentId !== row.source.documentId && o.qualifier === row.qualifier && sameBenefit(o.benefit, row.benefit) && sameFigure(o.figure, row.figure));
  const named = { row, carried: [] as string[] };
  if (!twins.length) return named;
  const passes = (r: ChatRow, conditions: unknown) => {
    const st = statementFromRow(r, { ...raw, conditions, alternativeGroup: null }, labels, names);
    if (!st) return false;
    const parsed = readModelAnswer({ bottomLine: "-", nextSteps: [], question: null, statements: [st] });
    return !!parsed && (verifyAnswer(household, parsed, [], new Set([String(st.text)])).answer.statements ?? []).some((x) => x.amount && x.text === st.text);
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
  const others = rows.filter((o) => o.id !== row.id && o.personId === row.personId && !(o.coverKey === row.coverKey && o.qualifier === row.qualifier
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
export function rowLabel(row: ChatRow, labels?: Map<string, string>, names?: (row: ChatRow) => string): string {
  const f = row.figure;
  const cover = labels?.get(fullCover(row)) ?? fullCover(row);
  // A daily row's first paid day and most days are part of what it pays, so its card always says them (stress run 23 Oct,
  // S008, S016: "S$30 per day" shown without "from day 11").
  const daily = `paid per day${row.fromDay != null && row.fromDay > 1 ? `, from day ${row.fromDay} of the stay` : ""}${row.maxDays != null ? `, for at most ${row.maxDays} days` : ""}`;
  const how = f.kind === "printed" ? (f.unit === "per_day" ? daily : f.unit === "per_period" ? `paid per ${(f.period ?? "period").replace("_", " ")}` : f.unit === "up_to" ? (row.lesserOf ? "the cost, up to this limit, whichever is less" : "up to this limit") : null)
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

/** What a printed figure is counted per, as its quote prints it right after the figure: "S$5,000 per child (up to 2
 * children)" gives "per child (up to 2 children)". Null when nothing follows. */
function perUnit(excerpt: string, amount: number): string | null {
  for (const m of excerpt.matchAll(/(?:S\$|US\$|SGD|\$)?\s?(\d[\d,]*(?:\.\d+)?)\s*(?:each\s+)?(per\s+(?:child|children|person|insured(?:\s+person)?|life|member|dependant|family|claim|visit|trip|event|accident|incident|injury|bone|fracture|policy\s+year|year|disability|confinement|admission)\b(?:\s*\((?:up\s+to|maximum|max\.?|subject\s+to)[^)]{1,40}\))?(?:,?\s*subject\s+to\s+a\s+maximum\s+of\s+\w+\s+\w+)?)/gi))
    if (Math.abs(Number(m[1].replace(/,/g, "")) - amount) < 0.005) return m[2].replace(/\s+/g, " ").trim();
  return null;
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
  // An amount the answer itself says does not fit the event is not one the documents fail to print: no note for it.
  if (!report.dropped.some((d) => !d.notFit) || statements.some((s) => s.id === "left-out-amount")) return statements;
  return [...statements.filter((s) => !(s.id === "left-out-fact" && s.text === LEFT_OUT_FACT)), make("left-out-amount", LEFT_OUT_AMOUNT)];
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

/** A sentence of the model's own words that shuts a person out of a cover by ownership ("they belong to Desmond, not
 * Charmaine", "only Desmond has it", "Desmond's alone") while the answer's cards, or that person's own table rows for the
 * same benefit, show they have it (live run 22 Oct, C5). Such a sentence is a wrong-person statement even without an
 * amount, so it is left out. A sentence that names a kind of cover the person has no row for ("Charmaine is not covered by
 * the travel policy") is kept. */
export const PERSON_OVERRULED = "a sentence said a person does not have a cover their own rows show";
const NOT_COVER_WORD = new Set(["benefit"]);
export function dropPeopleShutOut<T extends { kind: string; text: string; fullText?: string; amount?: unknown; personName?: string | null }>(
  answer: { summary: string; bottomLine?: string | null; statements?: T[] }, rows: ChatRow[], household: Household, labels: readonly string[]): string[] {
  const people = household.members.map((m) => baseName(m.name));
  const words = (n: string) => n.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
  // The words that name each person and no one else ("desmond", "chuen", "charmaine").
  const own = new Map(people.map((p) => [p, words(p).filter((w) => !people.some((o) => o !== p && words(o).includes(w)))]));
  const alt = (p: string) => own.get(p)!.length ? `(?:${own.get(p)!.join("|")})` : null;
  const statements = answer.statements ?? [];
  const cards = statements.filter((s) => s.amount);
  // The rows behind the cards: the row whose server label a card reads.
  const labelled = new Set(labels);
  const carded = rows.filter((r) => cards.some((c) => c.text === rowLabel(r, coverLabels(rows), benefitNames(rows)) && labelled.has(c.text)));
  const rowText = (r: ChatRow) => [r.product, r.cover, r.plan, r.benefit].join(" ").toLowerCase();
  // Y is shut out of a cover the answer itself shows is Y's: a card of Y's, or Y's own row for a carded benefit, of the
  // kind the sentence names. A card of Y's for another cover says nothing about it ("Only Wei Ming has the Term Life
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
  // Only ownership or exclusivity is read ("belongs to Desmond, not Charmaine", "Desmond's alone", "only Desmond has it"). A
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
