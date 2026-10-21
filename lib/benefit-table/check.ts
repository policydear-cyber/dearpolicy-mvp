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
import { locateQuote } from "@/lib/simple-chat/verify";
import type { Household, HouseholdDocument } from "@/lib/simple-chat/library";
import { DOCUMENT_KINDS, PAYS, PERCENT_OF, type ReadBenefit, type ReadCover, type Reading } from "./reading";

export type SourceDoc = { id: string; name: string; readable: boolean; pages: { page: number; text: string }[] };
export type Source = { documentId: string; document: string; page: number; excerpt: string };
export type CheckedCover = ReadCover & { source: Source; currency: string | null };
export type CheckedBenefit = ReadBenefit & { source: Source; currency: string | null; baseSource: Source | null; droppedConditions: string[] };
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
  const find = (quote: string | null, page: number | null): Source | null => {
    if (!quote) return null;
    const f = locateQuote(household, quote, 0);
    if (!f) return null;
    // The page the words are on, which is shown; the model's page only breaks a tie (locateQuote takes the first page).
    if (page != null && f.page !== page) {
      const onStated = locateQuote({ ...household, documents: [{ ...household.documents[0], pages: doc.pages.filter((p) => p.page === page) }] }, quote, 0);
      if (onStated) return { documentId: doc.id, document: doc.name, page, excerpt: onStated.excerpt };
    }
    return { documentId: doc.id, document: doc.name, page: f.page, excerpt: f.excerpt };
  };

  for (const c of Array.isArray(r.covers) ? r.covers : []) {
    const label = `cover "${c?.cover}" for ${c?.person}`;
    const person = str(c?.person), product = str(c?.product), cover = str(c?.cover), quote = str(c?.quote);
    if (!person || !product || !cover || !quote) { out.dropped.push({ what: label, why: "incomplete row" }); continue; }
    const source = find(quote, int(c.page));
    if (!source) { out.dropped.push({ what: label, why: "quote not found in this document" }); continue; }
    if (!nameOnPage(person, pageText(source.page))) { out.dropped.push({ what: label, why: "person's name not printed on that page" }); continue; }
    const sumInsured = num(c.sumInsured);
    if (sumInsured != null && !printsNumber(source.excerpt, sumInsured)) { out.dropped.push({ what: label, why: `sum insured ${sumInsured} not printed in the quote` }); continue; }
    const currency = sumInsured == null ? null : statedCurrencyCode(source.excerpt) ?? declaredCurrency(pageText(source.page));
    out.covers.push({ person, product, cover, plan: str(c.plan), sumInsured, asOf: str(c.asOf), page: source.page, quote, source, currency });
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
    if (["amount", "up_to", "per_day", "percent"].includes(pays) && value == null) { out.dropped.push({ what: label, why: `"${pays}" row with no figure` }); continue; }
    if (!["amount", "up_to", "per_day", "percent"].includes(pays)) value = null;
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
    // Day counts are figures too: one the quote does not print is not kept.
    const day = (v: unknown) => { const n = int(v); return n != null && printsNumber(source.excerpt, n) ? n : null; };
    const fromDay = day(b.fromDay), maxDays = day(b.maxDays);
    out.benefits.push({ section: str(b.section), column: str(b.column), benefit, pays, value, percentOf, baseAmount, baseQuote: str(b.baseQuote),
      fromDay, maxDays, conditions, page: source.page, quote, source, currency, baseSource, droppedConditions });
  }
  return out;
}
