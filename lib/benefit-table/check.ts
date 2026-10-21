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
import { CAPPED, locateQuote } from "@/lib/simple-chat/verify";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import { BASES, DOCUMENT_KINDS, PAYS, PERCENT_OF, PERIODS, type ReadBenefit, type ReadCover, type Reading } from "./reading";

export type SourceDoc = { id: string; name: string; readable: boolean; pages: { page: number; text: string }[] };
export type Source = { documentId: string; document: string; page: number; excerpt: string };
export type CheckedCover = ReadCover & { source: Source; currency: string | null };
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
/** The currency a page declares for its table ("Benefits (S$)"), or null. */
export function declaredCurrency(pageText: string): string | null {
  const m = pageText.match(DECLARED);
  if (!m) return null;
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
/** Text that goes on with the same row: it starts lower-case, with a bracket or with a connective ("or up to S$50,000,
 * whichever is lesser", "subject to a maximum of ..."), never with a new row's label, bullet or number. */
const continues = (text: string) => /^[ \t,;:]*(?:[a-z(]|(?:or|and|up\s+to|subject|whichever|max(?:imum)?|limited|not\s+exceed(?:ing)?|capped)\b)/.test(text)
  || /^[ \t,;:]*(?:or|and|up\s+to|subject|whichever|max(?:imum)?|limited|not\s+exceed(?:ing)?|capped)\b/i.test(text);
/** The row as printed: the quoted words (by their place on the page), the rest of their line when it goes on with the row,
 * and up to three following lines that go on with it. A line that starts another row ends it (Critic R95-1, R95-2). */
function rowSegment(pageText: string, start: number, end: number): string {
  const lineEnd = (i: number) => { const e = pageText.indexOf("\n", i); return e < 0 ? pageText.length : e; };
  let seg = pageText.slice(start, end);
  const tail = pageText.slice(end, lineEnd(end));
  if (tail.trim()) {
    if (!continues(tail)) return seg;
    seg += tail;
  }
  let pos = lineEnd(end);
  for (let k = 0; k < 3 && pos < pageText.length; k++) {
    const line = pageText.slice(pos + 1, lineEnd(pos + 1));
    if (!line.trim() || !continues(line)) break;
    seg += " " + line;
    pos = lineEnd(pos + 1);
  }
  return seg;
}

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
  const find = (quote: string | null, page: number | null): Source | null => {
    if (!quote) return null;
    const f = locateQuote(household, quote, 0);
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
  const segmentOf = (src: Source) => { const p = placed.get(src); return p ? rowSegment(pageText(src.page), p.start, p.end) : src.excerpt; };

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
    if (premium != null && !printsNumber(source.excerpt, premium)) { out.dropped.push({ what: label, why: `premium ${premium} not printed in the quote; kept the cover without it` }); premium = null; }
    const currency = sumInsured == null && premium == null ? null : statedCurrencyCode(source.excerpt) ?? declaredCurrency(pageText(source.page));
    const page = pageText(source.page);
    const policyNumber = str(c.policyNumber) && squashed(page).includes(squashed(str(c.policyNumber)!)) ? str(c.policyNumber) : null;
    out.covers.push({ person, product, cover, plan: str(c.plan), riderOf: str(c.riderOf), policyNumber, sumInsured, premium,
      premiumFrequency: premium == null ? null : str(c.premiumFrequency), asOf: dateOnPage(str(c.asOf), page),
      startDate: dateOnPage(str(c.startDate), page), endDate: dateOnPage(str(c.endDate), page), page: source.page, quote, source, currency });
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
      const row = segmentOf(source);
      const claimed = num(b.cap);
      const s = claimed != null && claimed > 0 ? find(str(b.capQuote), source.page) : null;
      if (s && claimed != null && s.page === source.page && printsNumber(s.excerpt, claimed) && CAP_WORDS.test(s.excerpt) && flat(row).includes(flat(s.excerpt))) {
        cap = claimed; capSource = s;
      } else {
        if (claimed != null) out.dropped.push({ what: label, why: `cap ${claimed} not printed in the row; no amount is worked out for it` });
        capUnread = claimed != null || CAP_WORDS.test(source.excerpt) || conditions.some((c) => CAP_WORDS.test(c))
          || CAPPED.test(row);
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
