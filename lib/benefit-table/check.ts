/** The benefit table, step 1b: the server's checks on one document's reading. Pure.
 *
 * A row is kept only when its own words are printed in this document: the quote is found on a stored page (the page
 * shown is where it was found, never the model's page number), every figure the row carries is printed in that quote,
 * and a fixed base ("% of S$5,000") is printed on the same page. A cover row also needs the person's name printed on
 * its page. A currency is only one the quote (or the base, or a currency the page declares for its table) prints; a
 * bare "$" stays unresolved. A condition is kept only when its words are printed in this document. Everything dropped
 * is listed with the reason, so a reading can be audited. */
import { normalizePersonName } from "@/lib/insurance";
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";
import { CAPPED, locateQuote, pageCurrency } from "@/lib/simple-chat/verify";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import { BASES, DOCUMENT_KINDS, PAYS, PERCENT_OF, PERIODS, type ReadBenefit, type ReadCover, type Reading } from "./reading";

/** people: the household's member names, so a page naming another member is known (only the premium check uses it). */
export type SourceDoc = { id: string; name: string; readable: boolean; pages: { page: number; text: string }[]; people?: string[] };
export type Source = { documentId: string; document: string; page: number; excerpt: string };
/** premiumSource: where the premium is printed, when not on the cover's own line (a schedule's "Instalment Premium : 470.85"),
 * and premiumLabel the words that line prints before it ("Instalment Premium"). */
export type CheckedCover = ReadCover & { source: Source; currency: string | null; premiumSource?: Source | null; premiumLabel?: string | null };

/** A premium line the table may use on its own: a plain premium for the whole policy ("Premium", "Instalment Premium",
 * "Premium paid", "Total Premium"). A line that qualifies it ("First Year Instalment Premium *", "Rider Premium",
 * "Instalment Premium (Life Assured 2)") is about part of the premium or another life, so it is never used (Critic R108-2,
 * TE #97). */
const PLAIN_PREMIUM = /^(?:(?:total|annual|yearly|monthly|quarterly|half[\s-]yearly|modal|instalment|installment)\s+)?(?:premium|instalment|installment)(?:\s+(?:paid|payable|amount))?$/i;
/** Whether a page may name a life other than this person: another household member's name anywhere on it, a word for
 * another insured person (spouse, child, dependant, covered members), a second or joint life, or a life line naming someone
 * else. Fail-safe: a premium on such a page may be the other life's, so it is not used, even when it is in fact this
 * person's (TE #97). */
const LIFE_LINE = /\b(?:(?:joint\s+)?life\s+(?:assured|insured)|assured|insured(?:\s+person)?|policy\s*holder|proposer|owner)\b[^:\t\n/]{0,20}[:\t][ \t]*:?[ \t]*([^\t\n]+)/gi;
const HEADER_WORD = /^(?:premiums?|sum|benefits?|cessation|commencement|date|term|plan|amount|policy|basic|rider|insured|assured)$/;
const OTHER_INSURED = /\b(?:spouses?|wife|husband|child(?:ren)?|sons?|daughters?|dependa?ents?|covered\s+(?:members?|persons?)|insured\s+members?|family\s+members?)\b|\b(?:life\s+(?:assured|insured)|insured(?:\s+person)?|assured)\s*(?:\(?\s*(?:2|3|ii|iii|two)\s*\)?)(?![\d.])|\bsecond\s+(?:life|insured)\b|\bjoint\s+life\b/i;
function otherLife(pageText: string, person: string, people: string[]): boolean {
  if (OTHER_INSURED.test(pageText)) return true;
  const own = normalizePersonName(person).split(" ").filter((w) => w.length > 1);
  const same = (name: string) => { const n = normalizePersonName(name.replace(/,/g, " ")).split(" ").filter((w) => w.length > 1); return n.every((w) => own.includes(w)) || own.every((w) => n.includes(w)); };
  if (people.some((name) => !same(name) && nameOnPage(name, pageText))) return true;
  return [...pageText.matchAll(LIFE_LINE)].some((m) => {
    const named = normalizePersonName(m[1].replace(/,/g, " ")).split(" ").filter((w) => w.length > 1 && /^[a-z]+$/.test(w));
    // A table header ("Assured/ Premium Cessation …") is column titles, not a name.
    if (named.some((w) => HEADER_WORD.test(w))) return false;
    return named.length > 0 && !named.every((w) => own.includes(w)) && !own.every((w) => named.includes(w));
  });
}
const premiumLineLabel = (line: string, value: number) => {
  const at = [...line.matchAll(/\d[\d,]*(?:\.\d+)?/g)].find((m) => Math.abs(Number(m[0].replace(/,/g, "")) - value) < 0.005);
  return at ? line.slice(0, at.index).replace(/(?:S\$|US\$|SGD|USD|\$)\s*$/i, "").replace(/[\t:]+/g, " ").replace(/\s+/g, " ").trim() : null;
};
/** capSource: where the percentage's printed cap is, next to the row. capUnread: the row's words say it is capped ("up to",
 * "whichever is lesser") but no cap was read and checked, so no amount is worked out for it. */
export type CheckedBenefit = ReadBenefit & { source: Source; currency: string | null; baseSource: Source | null; capSource: Source | null; capUnread: boolean; droppedConditions: string[] };
export type Dropped = { what: string; why: string };
export type CheckedReading = { documentId: string; document: string; kind: Reading["document"]["kind"]; product: string | null; plan: string | null; namedPeople: string[];
  covers: CheckedCover[]; benefits: CheckedBenefit[]; dropped: Dropped[] };

/** Every number printed in a text, commas removed ("S$600,000" -> 600000, "1 million" -> 1000000). */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s*(?:million|m)\b)?/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(m[2] ? n * 1e6 : n);
  }
  return out;
}
export const printsNumber = (text: string, value: number) => numbersIn(text).some((n) => Math.abs(n - value) < 0.005);

const DECLARED = /\(\s*(S\$|SGD|US\$|USD|RM|MYR|HK\$|HKD)\s*\)|\b(?:amounts?|figures?|limits?)\b[^.\n]{0,40}\b(?:in|are in)\s+(S\$|SGD|Singapore dollars?)/i;
/** The currency a page declares for its table ("Benefits (S$)"), or for every figure on it (a policy schedule's "Currency :
 * Singapore Dollar", the chat's own pageCurrency), or null. */
export function declaredCurrency(pageText: string): string | null {
  const m = pageText.match(DECLARED);
  // "All amounts in Singapore Dollar unless stated otherwise" does not settle a figure's currency (TE #97, R59-5).
  if (!m || /\b(?:unless|otherwise|except)\b/i.test(pageText.slice(m.index!, m.index! + m[0].length + 60))) return pageCurrency(pageText);
  const word = m[1] ?? m[2];
  return /singapore/i.test(word) ? "SGD" : statedCurrencyCode(word);
}

function asHousehold(doc: SourceDoc): Household {
  const d: HouseholdDocument = { policyId: doc.id, name: doc.name, insurer: null, productName: null, policyNumber: null, documentType: null, documentRole: null,
    effectiveDate: null, expiryDate: null, uploadedAt: null, uploadedFor: null, linkedPeople: [], supersededAt: null,
    processingStatus: doc.readable ? "ready" : "failed", pages: doc.pages };
  return { accountId: "", members: [], documents: [d] };
}

function nameOnPage(person: string, pageText: string) {
  const words = normalizePersonName(person).split(" ").filter((w) => w.length > 1);
  const page = ` ${normalizePersonName(pageText.replace(/,/g, " "))} `;
  return words.length > 0 && words.every((w) => page.includes(` ${w} `));
}

/** A printed date ("06/10/2022", "1 June 2040") is kept only when its digits are printed together on the page. */
export function dateOnPage(date: string | null, pageText: string): string | null {
  if (!date) return null;
  const digits = date.match(/\d+/g);
  if (!digits) return null;
  const page = numbersIn(pageText.replace(/[/.-]/g, " ")).map(String);
  return digits.every((d) => page.includes(String(Number(d)))) ? date : null;
}
const squashed = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Words that say a figure is capped: a percentage row with them pays at most a printed limit. */
export const CAP_WORDS = /\bup\s+to\b|\bmax(?:imum)?\b|\bwhichever\s+is\s+(?:the\s+)?(?:lower|lesser|less|smaller)\b|\bnot\s+(?:to\s+)?exceed|\blimited\s+to\b|\bcapped\b|\bsubject\s+to\s+(?:a\s+)?(?:maximum|limit)\b/i;
const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
// Signs that a line is another row: an item marker ("(b)", "ii.", "3)"), its own percentage, an upper-case label with a
// figure, or tab-separated cells (Critic R96-1, R98-1, R99).
const ITEM_MARKER = /^[ \t]*\(?(?:[a-z]{1,3}|[ivx]{1,5}|\d{1,3})[.)]\s/i;
// A following line goes on with the row only when it starts with a connective or a cap word, optionally after "(":
// "or up to S$50,000, whichever is lesser", "(max. S$5,000)", "subject to a maximum of ...". Nothing else joins (TE L12-L14).
const CONNECTIVE = /^[ \t,;:(]*(?:or|and|up\s+to|subject|whichever|max(?:imum)?|min(?:imum)?|limit(?:ed)?|not\s+(?:to\s+)?exceed(?:ing)?|capped)\b/i;
const TAB_CELLS = /\S\t+\S/;
const PERCENT = /\d\s*%/;
const LABEL_FIGURE = /^[ \t,;:]*[A-Za-z][A-Za-z'&/ -]*?\s(?:S\$|US\$|SGD|\$)\s?\d/;
/** How many lines below the row are looked at for a cap that was not joined to it. */
const LINES_BELOW = 3;
/** The row as printed, and the text near it whose cap words withhold the row's amount unless a cap is tied to the row.
 * text: the quoted words (by their place on the page); then, from the rest of their line, the part up to the next tab
 * cell or the next label with a percentage, when it starts with a connective or cap word; then up to three following
 * lines that start with a connective or cap word and have no tab cells or percentage of their own.
 * near: the whole rest of the row's own line, never filtered (TE L22), every line below that starts with a connective
 * or cap word, and any other of the next three lines that does not plainly start another row, up to the first that
 * does. Cap words (NEAR_CAP) in it mark the row capped, so it shows no amount rather than a neighbour's cap or an
 * uncapped figure. otherPercent: a second percentage limit printed with the row's own cap. */
function rowSegment(pageText: string, start: number, end: number): { text: string; near: string; otherPercent: boolean } {
  const lineEnd = (i: number) => { const e = pageText.indexOf("\n", i); return e < 0 ? pageText.length : e; };
  let seg = pageText.slice(start, end);
  const near: string[] = [];
  // Another percentage on the row's own line or on a connective line below ("… up to S$50,000 or 10% of annual salary,
  // whichever is lower") is a second limit: the row withholds its amount even with its cap read (Critic R101-2).
  let otherPercent = false;
  const tail = pageText.slice(end, lineEnd(end));
  if (tail.trim()) {
    // A tab cell holding its own label and then a cell with its own percentage is the next row ("Hip\t75%\tWrist\t20% up
    // to S$5,000"): its limit is that row's, not near this one (follow-up to TE L22 control). A label with a cap word
    // ("Payable up to\t50% of S$100,000") or starting with a connective ("Or\t10% …") may be this row's limit, so it
    // stays near (Critic R105, TE layout 32).
    const nextRowCells = tail.match(/^\t+([A-Z][^\t%\d]*)\t+[^\t]*\d\s*%/);
    if (!nextRowCells || CONNECTIVE.test(nextRowCells[1]) || NEAR_CAP.test(nextRowCells[1])) near.push(tail);
    // In a two-column extraction the rest of the line may hold the next row (TE L19-L23): only the part before the next
    // tab cell or the next label with a percentage can be this row's.
    const cell = tail.split("\t").find((c) => c.trim()) ?? "";
    // The next row starts with an upper-case label; "or 10% of annual salary" is this row's second limit (Critic R101-2).
    // A label never starts with a connective: "Or 10% of annual salary" is still this row's (Critic R102-2).
    const next = [...cell.matchAll(/\s+([A-Z][^%\d]*\d+(?:\.\d+)?\s*%)/g)].find((m) => !CONNECTIVE.test(m[1]))?.index ?? -1;
    const own = next < 0 ? cell : cell.slice(0, next);
    otherPercent = PERCENT.test(own);
    if (CONNECTIVE.test(own) && !PERCENT.test(own)) seg += own;
  }
  let pos = lineEnd(end);
  let joining = true;
  for (let k = 0, below = 0; pos < pageText.length && below < LINES_BELOW && k < 3 + LINES_BELOW; k++) {
    const line = pageText.slice(pos + 1, lineEnd(pos + 1));
    pos = lineEnd(pos + 1);
    if (!line.trim()) { joining = false; continue; }
    // A line with its own percentage is never joined, even after "Maximum" ("Maximum Disablement 20% up to S$5,000").
    if (joining && k < 3 && CONNECTIVE.test(line) && !TAB_CELLS.test(line) && !PERCENT.test(line)) { seg += " " + line; continue; }
    joining = false;
    below++;
    if (CONNECTIVE.test(line) && PERCENT.test(line)) otherPercent = true;
    if (CONNECTIVE.test(line) || !otherRow(line)) near.push(line);
    // Lines after the next row belong to it ("Knee 10%\nElbow 10%\nAmbulance up to S$500"): stop there (TE control).
    else break;
  }
  return { text: seg, near: near.join("\n"), otherPercent };
}
// A line below that plainly starts another row has its own limit, not this row's: an item marker or its own percentage
// ("Wrist 20% up to S$5,000"), tab cells with a figure ("•\tAmbulance Cost*\tUp to S$500"), or an upper-case label with
// a figure. A lower-case line ("which is payable up to S$50,000") may be this row's limit (Critic R99-1, TE L12-L14).
const otherRow = (l: string) => (TAB_CELLS.test(l) && /\d\s*%|(?:S\$|US\$|SGD|\$)\s?\d/.test(l))
  || ITEM_MARKER.test(l) || PERCENT.test(l) || (/^[ \t]*[A-Z]/.test(l) && LABEL_FIGURE.test(l) && !NEAR_CAP.test(l));
/** Cap words near a row, including a bare "limit" ("Per accident limit S$50,000", Critic R100). An upper-case line with
 * a figure and these words may go on with the row's own cap ("Payable up to S$50,000 per accident"). */
const NEAR_CAP = new RegExp(`${CAP_WORDS.source}|\\blimit\\b`, "i");

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

export function checkReading(doc: SourceDoc, raw: unknown): CheckedReading {
  const r = (raw ?? {}) as Partial<Reading>;
  const d = (r.document ?? {}) as Partial<Reading["document"]>;
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(d.kind as string) ? d.kind! : "other";
  const out: CheckedReading = { documentId: doc.id, document: doc.name, kind, product: str(d.product), plan: str(d.plan),
    namedPeople: Array.isArray(d.namedPeople) ? d.namedPeople.filter((n): n is string => !!str(n)) : [], covers: [], benefits: [], dropped: [] };
  const household = asHousehold(doc);
  const pageText = (n: number) => doc.pages.find((p) => p.page === n)?.text ?? "";
  // Where on its page each located quote is printed, for reading the row around it.
  const placed = new Map<Source, { start: number; end: number }>();
  const lineEndAt = (text: string, i: number) => { const e = text.indexOf("\n", i); return e < 0 ? text.length : e; };
  // A label cell that wraps onto the next line ("Comprehensive Critical\t300,000.00\t269.05\nIllness Benefit"), copied
  // whole by the model ("Comprehensive Critical\tIllness Benefit\t300,000.00\t269.05"): the row is its own line without
  // that cell, and only when the very next line prints that cell alone, with no figure. One reading only.
  const wrappedLabel = (quote: string) => {
    const cells = quote.split("\t");
    const flatten = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const hits = [];
    for (let j = 1; j < cells.length - 1; j++) {
      if (!/[a-z]/i.test(cells[j]) || /\d/.test(cells[j]) || !/[a-z]/i.test(cells[0])) continue;
      const g = locateQuote(household, [...cells.slice(0, j), ...cells.slice(j + 1)].join("\t"), 0);
      if (!g || g.excerpt.includes("\n")) continue;
      const text = pageText(g.page), end = lineEndAt(text, g.offset);
      if (flatten(text.slice(end + 1, lineEndAt(text, end + 1))) === flatten(cells[j])) hits.push(g);
    }
    return hits.length === 1 ? hits[0] : null;
  };
  const find = (quote: string | null, page: number | null): Source | null => {
    if (!quote) return null;
    const f = locateQuote(household, quote, 0) ?? wrappedLabel(quote);
    if (!f) return null;
    const at = (g: { page: number; excerpt: string; offset: number; end?: number }) => {
      const src: Source = { documentId: doc.id, document: doc.name, page: g.page, excerpt: g.excerpt };
      placed.set(src, { start: g.offset, end: g.end ?? lineEndAt(pageText(g.page), g.offset) });
      return src;
    };
    // The page the words are on, which is shown; the model's page only breaks a tie (locateQuote takes the first page).
    if (page != null && f.page !== page) {
      const onStated = locateQuote({ ...household, documents: [{ ...household.documents[0], pages: doc.pages.filter((p) => p.page === page) }] }, quote, 0);
      if (onStated) return at({ ...onStated, page });
    }
    return at(f);
  };
  const segmentOf = (src: Source) => { const p = placed.get(src); return p ? rowSegment(pageText(src.page), p.start, p.end) : { text: src.excerpt, near: "", otherPercent: false }; };

  for (const c of Array.isArray(r.covers) ? r.covers : []) {
    const label = `cover "${c?.cover}" for ${c?.person}`;
    const person = str(c?.person), product = str(c?.product), cover = str(c?.cover), quote = str(c?.quote);
    if (!person || !product || !cover || !quote) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    const source = find(quote, int(c.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    if (!nameOnPage(person, pageText(source.page))) { out.dropped.push({ what: label, why: "person's name not printed on that page" }); continue; }
    const sumInsured = num(c.sumInsured);
    if (sumInsured != null && !printsNumber(source.excerpt, sumInsured)) { out.dropped.push({ what: label, why: `sum insured ${sumInsured} not printed in the quote` }); continue; }
    let premium = num(c.premium);
    // A premium printed on its own line counts only on the cover's own page, on a line that says it is a premium.
    let premiumSource: Source | null = null, premiumLabel: string | null = null;
    if (premium != null && !printsNumber(source.excerpt, premium)) {
      const at = find(str(c.premiumQuote), source.page);
      const said = at && !at.excerpt.includes("\n") ? premiumLineLabel(at.excerpt, premium) : null;
      // One plain premium line on the page: two (one per life, or per policy on a combined schedule) cannot be told apart.
      const plainLines = pageText(source.page).split("\n").filter((l) => /\d/.test(l) && PLAIN_PREMIUM.test(l.replace(/[\t:]+/g, " ").replace(/(?:S\$|US\$|SGD|USD|\$)?\s*\d[\d,]*(?:\.\d+)?.*$/, "").replace(/\s+/g, " ").trim()));
      if (at && at.page === source.page && said && PLAIN_PREMIUM.test(said) && plainLines.length === 1 && !otherLife(pageText(source.page), person, doc.people ?? [])) { premiumSource = at; premiumLabel = said; }
      else { out.dropped.push({ what: label, why: `premium ${premium} not printed in the quote or on the page's one plain premium line for this life only; kept the cover without it` }); premium = null; }
    }
    const currency = sumInsured == null && premium == null ? null
      : statedCurrencyCode(source.excerpt) ?? (premiumSource ? statedCurrencyCode(premiumSource.excerpt) : null) ?? declaredCurrency(pageText(source.page));
    const page = pageText(source.page);
    const policyNumber = str(c.policyNumber) && squashed(page).includes(squashed(str(c.policyNumber)!)) ? str(c.policyNumber) : null;
    out.covers.push({ person, product, cover, plan: str(c.plan), riderOf: str(c.riderOf), policyNumber, sumInsured, premium,
      premiumFrequency: premium == null || !str(c.premiumFrequency) || !squashed(page).includes(squashed(str(c.premiumFrequency)!)) ? null : str(c.premiumFrequency), asOf: dateOnPage(str(c.asOf), page),
      startDate: dateOnPage(str(c.startDate), page), endDate: dateOnPage(str(c.endDate), page), page: source.page, quote, source, currency, premiumSource, premiumLabel });
  }

  for (const b of Array.isArray(r.benefits) ? r.benefits : []) {
    const label = `benefit "${b?.benefit}"${b?.column ? ` [${b.column}]` : ""}`;
    const benefit = str(b?.benefit), quote = str(b?.quote);
    const pays = (PAYS as readonly string[]).includes(b?.pays as string) ? b.pays : null;
    if (!benefit || !quote || !pays) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    const source = find(quote, int(b.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    let value = num(b.value);
    if (value != null && !printsNumber(source.excerpt, value)) { out.dropped.push({ what: label, why: `figure ${value} not printed in the quote` }); continue; }
    const FIGURED = ["amount", "up_to", "per_day", "per_period", "percent", "value"];
    if (FIGURED.includes(pays) && value == null) { out.dropped.push({ what: label, why: `"${pays}" row with no figure` }); continue; }
    if (!FIGURED.includes(pays)) value = null;
    const period = pays === "per_period" && (PERIODS as readonly string[]).includes(b.period as string) ? b.period! : null;
    if (pays === "per_period" && !period) { out.dropped.push({ what: label, why: "payment with no period" }); continue; }
    const basis = (BASES as readonly string[]).includes(b.basis as string) ? b.basis! : null;
    const percentOf = pays === "percent" && (PERCENT_OF as readonly string[]).includes(b.percentOf as string) ? b.percentOf! : null;
    let baseAmount: number | null = null, baseSource: Source | null = null;
    if (percentOf === "fixed_amount") {
      baseAmount = num(b.baseAmount);
      baseSource = find(str(b.baseQuote), source.page);
      if (baseAmount == null || !baseSource || baseSource.page !== source.page || !printsNumber(baseSource.excerpt, baseAmount)) {
        out.dropped.push({ what: label, why: "fixed base not printed on the row's page" }); continue;
      }
    }
    const currency = pays === "percent"
      ? (baseSource ? statedCurrencyCode(baseSource.excerpt) ?? declaredCurrency(pageText(source.page)) : null)
      : value == null ? null : statedCurrencyCode(source.excerpt) ?? declaredCurrency(pageText(source.page));
    const conditions: string[] = [], droppedConditions: string[] = [];
    for (const cond of Array.isArray(b.conditions) ? b.conditions : []) {
      const words = str(cond);
      if (!words) continue;
      (find(words, null) ? conditions : droppedConditions).push(words);
    }
    // A percentage's printed cap is kept only when its words, with the figure, are printed in the row itself or the lines
    // that continue it (never a neighbouring row's limit); a cap that
    // is claimed but not found, or a row whose words say it is capped with no cap read, gets no worked-out amount.
    let cap: number | null = null, capSource: Source | null = null, capUnread = false;
    // A percentage row's quote holds one row: two percentages mean it runs into the next row (R95-2, N3).
    // A percentage in the row's own label ("Burns: greater than 2% but less than 5%") is the label's, not another row's.
    const percents = (t: string) => (t.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length;
    if (pays === "percent" && percents(source.excerpt) > percents(benefit) + 1) { out.dropped.push({ what: label, why: "quote holds more than one row" }); continue; }
    if (pays === "percent") {
      const { text: row, near, otherPercent } = segmentOf(source);
      const claimed = num(b.cap);
      const s = claimed != null && claimed > 0 ? find(str(b.capQuote), source.page) : null;
      const tied = s && claimed != null && s.page === source.page && printsNumber(s.excerpt, claimed) && CAP_WORDS.test(s.excerpt) && flat(row).includes(flat(s.excerpt));
      // Another money figure in the row besides its cap ("up to S$50,000 or S$500 per day, whichever is lower") is a second
      // limit too (Critic R102-1).
      const otherMoney = [...flat(row).matchAll(/(?:s\$|us\$|sgd|\$)\s?(\d[\d,]*(?:\.\d+)?)/g)].some((m) => Number(m[1].replace(/,/g, "")) !== claimed);
      // "Whichever" with any other number near the row ("or 500 per day, whichever is lower") is a second limit (Critic R103-1).
      // A leading item number ("1. Hip 75%") is the row's own.
      const otherWhichever = /\bwhichever\b/i.test(`${row}\n${near}`)
        && [...`${row.replace(ITEM_MARKER, "")}\n${near}`.matchAll(/\d[\d,]*(?:\.\d+)?/g)].some((m) => ![claimed, value].includes(Number(m[0].replace(/,/g, ""))));
      if (tied && (otherPercent || otherMoney || otherWhichever)) {
        out.dropped.push({ what: label, why: `cap ${claimed} printed with another limit; no amount is worked out for it` });
        capUnread = true;
      } else if (tied) {
        cap = claimed; capSource = s;
      } else {
        if (claimed != null) out.dropped.push({ what: label, why: `cap ${claimed} not printed in the row; no amount is worked out for it` });
        capUnread = claimed != null || CAP_WORDS.test(source.excerpt) || conditions.some((c) => CAP_WORDS.test(c))
          || CAPPED.test(row) || NEAR_CAP.test(near);
      }
    }
    // Day counts are figures too: one the quote does not print is not kept.
    const day = (v: unknown) => { const n = int(v); return n != null && printsNumber(source.excerpt, n) ? n : null; };
    const fromDay = day(b.fromDay), maxDays = day(b.maxDays);
    out.benefits.push({ section: str(b.section), column: str(b.column), benefit, pays, value, period, basis, asOf: dateOnPage(str(b.asOf), pageText(source.page)),
      percentOf, baseAmount, baseQuote: str(b.baseQuote), cap, capQuote: cap != null ? str(b.capQuote) : null,
      fromDay, maxDays, conditions, page: source.page, quote, source, currency, baseSource, capSource, capUnread, droppedConditions });
  }
  return out;
}
