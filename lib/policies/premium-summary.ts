/**
 * Round 5: what a household member's policies cost, from their premium
 * evidence.
 *
 * One Integrated Shield policy number carries two premiums -- the plan and
 * its rider -- and a renewal notice prints the plan's cash portion after a
 * MediSave deduction. Keeping only the latest record per policy number
 * showed the rider alone (S$758/year) as the whole cost. Each premium
 * component (plan, rider) is its own line; a MediSave portion printed beside
 * a cash amount is added back, so the total is the premium, with the cash
 * and MediSave split shown; and a policy with no premium evidence is named
 * as missing rather than silently counted as zero.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { annualisePremium } from "@/lib/insurance";
import { SHORT_TERM_DAYS, samePolicyNumber, type PersonCover } from "@/lib/benefit-table/assemble";
import { printedDay } from "@/lib/benefit-table/dates";
import { longDate, printedStatus } from "@/lib/chat/policy-status";
import { canonicalDeathInsurer } from "@/lib/claims/death-evidence";
import { formatMoney, normalizeCurrencyCode, statedCurrencyCode } from "@/lib/format/currency";
import { loadPolicyInventory, normalizedIdentifier } from "@/lib/policies/inventory";
import type { ClaimPerson } from "@/lib/claims/person";

export type PremiumRecordRow = { id: string; policy_id: string | null; family_member_id: string | null; insurer: string | null; product_name: string | null; policy_number: string | null;
  amount: string; currency: string | null; frequency: string | null; payment_date: string | null; period_start: string | null; period_end?: string | null; created_at: string; notes?: string | null;
  /** The document_role of the current document the record was read from (null: unknown, or that document is no longer current). */
  source_role?: string | null };
export type PremiumItem = Omit<PremiumRecordRow, "amount" | "currency"> & { amount: number; currency: string; shared: boolean;
  /** Round 16: the record states its currency (false: `currency` is only this summary's display default, never a fact to total or show). */
  currencyStated: boolean;
  /** What the record's amount is: the whole premium, or only the cash paid after MediSave. */
  cash: number | null; medisave: number | null; total: number; annual: number; monthly: number; cashAnnual: number | null; medisaveAnnual: number | null;
  /** The record says the premium is paid once (single, one-off, for the period): never annualised or totalled. */
  oneOff: boolean;
  /** The record prints no payment frequency, only a short cover period: it may be a trip's one-off premium or one month of a
   * monthly plan, so it is never annualised or totalled, and the total says it leaves it out (Critic R264). */
  shortPeriod: boolean;
  /** Read from the premium line the policy's own document prints (its benefit table), not from a premium record. */
  fromTable?: boolean;
  /** Said with the premium: a first-year premium, and the premium from the next policy year. */
  detail?: string | null };
export type PremiumSummary = { monthly: number; annual: number; cashAnnual: number | null; medisaveAnnual: number | null; items: PremiumItem[];
  /** Premiums the record says are one-off (PremiumItem.oneOff): listed, never in the totals or treated as missing. */
  oneOff: PremiumItem[];
  /** Premiums for a short period with no frequency (PremiumItem.shortPeriod): left out of the totals, and named in the note. */
  shortPeriod: PremiumItem[];
  /** Policies on file with no premium evidence: the total leaves them out. */
  missing: string[]; complete: boolean; note: string | null };

// "S$1,050.00 is payable from MediSave" (amount first) or "MediSave
// deduction S$1,050" (amount after). The amount-first form is tried first so
// "... from MediSave and S$234.00 in cash" never reads the cash as MediSave.
const MEDISAVE_BEFORE = /(?:S\$|SGD)\s?(\d[\d,]*(?:\.\d+)?)[^0-9$]{0,40}?\b(?:from|by|via|through|using)\s+medisave/i;
const MEDISAVE = /medisave[^0-9]{0,60}?(?:S\$|SGD)\s?(\d[\d,]*(?:\.\d+)?)/i;
/** Reads the MediSave split a premium record's evidence prints. */
export function premiumSplit(amount: number, notes: string | null | undefined): { total: number; cash: number | null; medisave: number | null } {
  let text = notes ?? "";
  // A renewal notice prints ONE MediSave split for the plan ("MediSave pays
  // S$1,050.00; cash payable S$362.00") and ingestion copies that line onto
  // every premium it read from the notice, the rider included. The split
  // belongs only to the premium whose amount is that cash figure; on any
  // other line (a cash-only rider) it is not this premium's MediSave.
  const printed = text.match(/As printed:\s*([^·]*)/i)?.[1] ?? "";
  const printedCash = printed.match(/cash payable (?:S\$|SGD)\s?(\d[\d,]*(?:\.\d+)?)/i)?.[1];
  if (printedCash != null && Math.abs(Number(printedCash.replace(/,/g, "")) - amount) > 0.005) text = text.replace(/As printed:[^·]*/i, "");
  const m = text.match(MEDISAVE_BEFORE) ?? text.match(MEDISAVE);
  const medisave = m ? Number(m[1].replace(/,/g, "")) : null;
  if (medisave == null) return { total: amount, cash: /\bcash\b/i.test(text) ? amount : null, medisave: null };
  // "cash portion after MediSave S$1,050": the recorded amount is the cash.
  if (/\bcash\b|after medisave|less[: ]+medisave/i.test(text) && !/of which/i.test(text)) return { total: amount + medisave, cash: amount, medisave };
  // "S$1,284, of which S$1,050 is payable from MediSave": the amount is the total.
  return { total: amount, cash: Math.max(0, Math.round((amount - medisave) * 100) / 100), medisave };
}
function component(row: PremiumRecordRow) {
  const product = (row.product_name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return (normalizedIdentifier(row.policy_number) || row.policy_id || (row.insurer ?? "")) + "|" + product;
}
const RECURRING = /month|quarter|semi|half.?year|6 month|week|fortnight|year|annum|annual|\bp\.?\s*a\b\.?|bulanan|tahunan/i;
/** A premium the record says is paid once ("Single premium", "one-off", "for the period") is a one-off premium. */
export function isOneOffPremium(row: Pick<PremiumRecordRow, "frequency">) {
  return /single|one[- ]?off|for the period/i.test(row.frequency ?? "");
}
/** A premium with no payment frequency whose record prints a cover period of at most SHORT_TERM_DAYS (29 Sep to 4 Oct) is
 * not known to be yearly: S$73.17 for a six-day trip is not S$73.17 a year (Home tile showed "S$6.10/month", 27 Oct), and
 * a monthly plan's statement for October is not a year's premium either (Critic R264). A year's renewal (1 Jan to 31 Dec)
 * or an end date alone stays yearly, as before (Critic R263). */
export function isShortPeriodPremium(row: Pick<PremiumRecordRow, "frequency" | "period_start" | "period_end">) {
  if (isOneOffPremium(row) || RECURRING.test(row.frequency ?? "") || !row.period_start || !row.period_end) return false;
  const days = (Date.parse(row.period_end.slice(0, 10)) - Date.parse(row.period_start.slice(0, 10))) / 86_400_000;
  return Number.isFinite(days) && days >= 0 && days <= SHORT_TERM_DAYS;
}
export function summariseRecords(rows: PremiumRecordRow[]): PremiumItem[] {
  // rows arrive newest first: the latest record of each premium component.
  const latest = new Map<string, PremiumRecordRow>();
  for (const row of rows) if (!latest.has(component(row))) latest.set(component(row), row);
  return [...latest.values()].map((row) => {
    const amount = Number(row.amount), split = premiumSplit(amount, row.notes);
    const annual = annualisePremium(split.total, row.frequency);
    return { ...row, amount, currency: normalizeCurrencyCode(row.currency, "SGD"), currencyStated: !!statedCurrencyCode(row.currency), shared: row.family_member_id == null, cash: split.cash, medisave: split.medisave, total: split.total,
      oneOff: isOneOffPremium(row), shortPeriod: isShortPeriodPremium(row), annual, monthly: annual / 12, cashAnnual: split.cash == null ? null : annualisePremium(split.cash, row.frequency), medisaveAnnual: split.medisave == null ? null : annualisePremium(split.medisave, row.frequency) };
  });
}
/** The parts of a benefit-table cover its printed premium needs (lib/benefit-table/check.ts). */
export type TablePremiumCover = Pick<PersonCover, "product" | "cover" | "plan" | "policyNumber" | "premium" | "premiumFrequency" | "currency" | "premiumCurrency" |
  "premiumNote" | "firstYearPremium" | "firstYearFrom" | "startDate" | "endDate" | "documentPeriodFrom" | "documentPeriodTo" | "documentKind" | "source" | "premiumSource" | "ended">;
/** What the summary knows of a premium's document beyond the table: the insurer and policy number it was filed under (a
 * cover the reading gave no number still has its document's), and whether its pages
 * say the policy lapsed or ended (lib/chat/policy-status.ts printedStatus). */
export type TablePremiumDocument = { insurer: string | null; policyNumber?: string | null; lapsedOrEnded: boolean;
  /** Pages that say the policy ended (ENDED_WORDS): a premium printed on one is not a current cost. */
  endedPages?: number[] };
/** Words that say a policy has ended, said of it rather than of what may happen: "terminated with effect from", "cancelled
 * your policy", "surrendered on", "void from inception", "no longer in force", an undated "has lapsed" (Critic R293 H1). */
export const ENDED_WORDS = /\b(?:terminated|cancell?ed|surrendered)\b|\bvoid\s+(?:from|ab\s+initio)\b|\bno\s+longer\s+in\s+force\b|\b(?:has|had|have)\s+(?:been\s+)?lapsed\b|\blapsed\s+on\b/i;
type RecordKey = Pick<PremiumRecordRow, "policy_id" | "policy_number" | "product_name" | "amount" | "insurer">;
const productKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isoOfDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
/** How many times a year a premium is paid, for the frequency words a premium line prints, exactly as listed: any other
 * wording ("6-monthly", "Bi-monthly", "Annual (paid by employer)", "10 years") gives none, so the premium is left out
 * rather than multiplied by the first word known (TE pr158 F1). */
const PERIODS_PER_YEAR: [RegExp, number][] = [
  [/^(?:monthly|per month|a month|bulanan)$/, 12],
  [/^(?:quarterly|per quarter)$/, 4],
  [/^(?:half yearly|semi annual|semi annually)$/, 2],
  [/^(?:yearly|annual|annually|per annum|p a|pa|a year|per year|tahunan)$/, 1],
  [/^(?:weekly)$/, 52],
  [/^(?:fortnightly)$/, 26],
];
export function premiumsPerYear(frequency: string | null | undefined): number | null {
  const f = (frequency ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return PERIODS_PER_YEAR.find(([re]) => re.test(f))?.[1] ?? null;
}
/** Every word of the shorter name is in the longer, and the shorter has two words or more: "Term Shield", "Lionrock Life
 * Term Shield", "Term Shield Plan (with rider)" may all be one policy (TE pr158 F2); "Plan" alone says nothing (TE O3). */
function maySameProduct(a: string | null | undefined, b: string | null | undefined) {
  const x = productKey(a).split(" ").filter(Boolean), y = productKey(b).split(" ").filter(Boolean);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && short.every((w) => long.includes(w));
}
/** A printed number's letters and digits with the zeros that lead its digits dropped: "LT-00918273" and "LT918273". */
const numberKey = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]+/g, "").replace(/(^|[A-Z])0+(?=\d)/g, "$1");
type PolicyHint = { number: string | null; product: string | null; amounts?: number[]; insurer?: string | null };
/** Whether two premiums are one policy's: "same" when both print a number and the numbers may be one (#152
 * samePolicyNumber, or equal without leading zeros); "different" when both print numbers that differ, whatever their names
 * say (TE O1, O4), unless their amount and insurer are the same; otherwise "maybe" when the names may be one product, the amounts are equal, or the insurer is the same
 * (Critic R284 H1, TE O2), and "different" when nothing links them. */
function samePolicy(a: PolicyHint, b: PolicyHint): "same" | "maybe" | "different" {
  const sameAmount = (a.amounts ?? []).some((x) => (b.amounts ?? []).some((y) => Math.abs(x - y) < 0.005));
  const sameInsurer = !!a.insurer && !!b.insurer && canonicalDeathInsurer(a.insurer) === canonicalDeathInsurer(b.insurer);
  // Numbers that differ are two policies, unless the amount and the insurer are the same: a record may print a receipt or
  // contract number instead of the policy's (Critic R294 H1). Two identical plans of one insurer are then named, not added.
  if (a.number && b.number) return samePolicyNumber(a.number, b.number) || numberKey(a.number) === numberKey(b.number) ? "same" : sameAmount && sameInsurer ? "maybe" : "different";
  if (maySameProduct(a.product, b.product)) return "maybe";
  if (sameAmount || sameInsurer) return "maybe";
  return "different";
}
/** Why a table premium was left out, for the note: its document may not show what is paid now, it may be a policy whose
 * premium is already counted, two documents give it a premium, or how often or in what currency it is paid is not plain. */
export type TableLeftOut = { name: string; why: "not_current" | "maybe_counted" | "two_documents" | "unclear" | "unread" | "unread_old" };

/** Premiums the household's own policy documents print, for policies no premium record covers (28 Oct: a schedule printing
 * its instalment premium and "Payment Frequency : Monthly" had no premium record, so Home said "Not known yet"). Only a
 * premium the benefit table has checked against its page is used (one plain premium line for this life, check.ts), and only
 * when what is paid now is certain; anything unsure is left out, never guessed:
 * - a stated currency, and a payment frequency from an exact list (premiumsPerYear);
 * - never a document whose pages say the policy lapsed or ended (Critic R284 H2, M1); a printed period that has ended, or an
 *   old start, never drops it: every policy on file is in force (DC, 31 Oct);
 * - a page that prints a different first-year premium gives the first-year figure while today is in the first policy year,
 *   and the other figure after, counted from the cover's own start date or the policy start that page labels; with neither
 *   it is left out, as a document's period may start at a renewal or a letter (Critic R284 M3, TE pr158 Y4);
 * - never a policy a premium record of this person may be: the same document, a policy number that may be the same, a
 *   product name whose words are all in the other's, the same amount, or the same insurer with no numbers to tell them
 *   apart (Critic R284 H1, TE pr158 F2);
 * - one premium per document and amount (one premium printed on two pages, or quoted by two covers, is one), and none at
 *   all for a policy two documents give a premium (a renewal may have changed it) (TE pr158 F3, Critic R284 M2).
 * `today` is a day count in Singapore (lib/benefit-table/dates.ts singaporeDay). `leftOut` names every premium left out for
 * being unsure, with why, for the note: an unsure drop is never silent, so the total never looks complete without it. */
export function tablePremiumItems(covers: TablePremiumCover[], records: RecordKey[], member: { id: string }, today: number,
  documents: Map<string, TablePremiumDocument> = new Map()): { items: PremiumItem[]; leftOut: TableLeftOut[] } {
  const seen = new Set<string>(), leftOut: TableLeftOut[] = [];
  const found: { cover: TablePremiumCover; name: string; item: PremiumItem }[] = [];
  for (const c of covers) {
    if (c.premium == null || !(c.premium > 0) || c.ended) continue;
    const documentId = c.source?.documentId;
    if (!documentId) continue;
    const doc = documents.get(documentId);
    const name = c.product?.trim() || (doc?.insurer ? doc.insurer + " policy" : "one policy");
    const amounts = [c.premium, c.firstYearPremium].filter((x): x is number => x != null);
    const hint = { number: c.policyNumber ?? doc?.policyNumber ?? null, product: c.product, amounts, insurer: doc?.insurer ?? null };
    // A record from this document, or with this policy's number, is this premium: it is already counted. One that may be
    // this policy is not added again, and the note says so (TE O1-O4).
    const overlap = records.map((r) => r.policy_id === documentId ? "same" : samePolicy(hint, { number: r.policy_number, product: r.product_name, amounts: [Number(r.amount)], insurer: r.insurer }));
    if (overlap.includes("same")) continue;
    if (overlap.includes("maybe")) { leftOut.push({ name, why: "maybe_counted" }); continue; }
    const key = documentId + "|" + c.premium;
    if (seen.has(key)) continue;
    seen.add(key);
    const currency = statedCurrencyCode(c.premiumCurrency === undefined ? c.currency : c.premiumCurrency);
    const perYear = premiumsPerYear(c.premiumFrequency);
    if (!currency || !perYear || !c.premiumFrequency) { leftOut.push({ name, why: "unclear" }); continue; }
    // A printed period that has ended, or an old start, never drops a premium: every policy on file is in force (DC, 31 Oct).
    // Only a personal schedule or certificate shows what is paid now: never a letter, a wording or a bill (Critic R293 H1).
    const page = (c.premiumSource ?? c.source).page;
    if (doc?.lapsedOrEnded || doc?.endedPages?.includes(page) || c.documentKind !== "personal_proof") { leftOut.push({ name, why: "not_current" }); continue; }
    let amount = c.premium, detail: string | null = null;
    if (c.premiumNote || c.firstYearPremium != null) {
      const start = printedDay(c.startDate ?? c.firstYearFrom ?? null);
      if (c.firstYearPremium == null || start == null) { leftOut.push({ name, why: "not_current" }); continue; }
      const next = new Date(start * 86_400_000); next.setUTCFullYear(next.getUTCFullYear() + 1);
      const anniversary = next.getTime() / 86_400_000;
      if (today < anniversary) { amount = c.firstYearPremium; detail = "first policy year; " + formatMoney(c.premium, currency) + " " + c.premiumFrequency.toLowerCase() + " from " + longDate(isoOfDay(anniversary)); }
    }
    const annual = amount * perYear;
    found.push({ cover: c, name, item: { id: "table:" + documentId + ":" + productKey(c.product), policy_id: documentId, family_member_id: member.id, insurer: doc?.insurer ?? null, product_name: c.product,
      policy_number: c.policyNumber ?? null, frequency: c.premiumFrequency, payment_date: null, period_start: null, period_end: null, created_at: "", notes: null,
      amount, currency, currencyStated: true, shared: false, cash: null, medisave: null, total: amount, annual, monthly: annual / 12, cashAnnual: null, medisaveAnnual: null,
      oneOff: false, shortPeriod: false, fromTable: true, detail } });
  }
  // A policy two documents give a premium (by a number, or a name, that may be one): the one whose printed period starts
  // latest is the renewal, and its premium counts (Critic R453 M1: last year's and this year's schedule). Choosing between
  // versions of one policy is reading content, never an expiry: no premium is dropped for its end date. When the starts tie
  // or one is missing, which is current is not known.
  const startOf = (c: TablePremiumCover) => {
    const starts = [printedDay(c.startDate ?? null), printedDay(c.documentPeriodFrom ?? null)].filter((x): x is number => x != null);
    return starts.length ? Math.max(...starts) : null;
  };
  const items: PremiumItem[] = [];
  for (const { cover, name, item } of found) {
    const others = found.filter((o) => o.cover.source.documentId !== cover.source.documentId
      && samePolicy({ number: o.cover.policyNumber ?? null, product: o.cover.product }, { number: cover.policyNumber ?? null, product: cover.product }) !== "different");
    if (!others.length) { items.push(item); continue; }
    const mine = startOf(cover), theirs = others.map((o) => startOf(o.cover));
    if (mine != null && theirs.every((t) => t != null && t < mine)) items.push(item);
    else if (mine != null && theirs.some((t) => t != null && t > mine) && theirs.every((t) => t != null)) continue;
    else leftOut.push({ name, why: "two_documents" });
  }
  return { items, leftOut: leftOut.filter((x, i) => leftOut.findIndex((y) => y.name === x.name && y.why === x.why) === i) };
}

/** This person's policies the benefit table shows from a current personal schedule or certificate, but for which no premium
 * was read and nothing counted is theirs (28 Oct: two schedules whose premium figure could not be tied to its label were
 * neither counted nor named, so the total looked complete). Each policy is named once: by document and policy number, so a
 * second numbered policy on a combined schedule is named too (Critic R300 H2); with no number, once per document, as its
 * riders cannot be told apart from other plans (TE pr163 R1b). "maybe_counted" when a counted premium may be its policy by number or product name, never by insurer alone (M1).
 * Skipped: documents the inventory lists (`namedDocumentIds`) and policies it names as missing (`named`, L1), a policy
 * whose premium the table read (tablePremiumItems names those), and a cover that has ended or whose page says it ended. */
export function unreadPremiumCovers(covers: TablePremiumCover[], counted: Pick<PremiumItem, "policy_id" | "policy_number" | "product_name" | "amount" | "insurer">[],
  documents: Map<string, TablePremiumDocument>, namedDocumentIds: Set<string>, today: number,
  named: { policy_number: string | null; product_name: string | null; insurer: string | null }[] = []): TableLeftOut[] {
  const policyOf = (c: TablePremiumCover) => {
    const number = c.policyNumber ?? documents.get(c.source?.documentId ?? "")?.policyNumber;
    // With no number printed, a document's covers cannot be told apart from a plan and its riders: one entry per document
    // (TE pr163 R1b). Numbers tell a combined schedule's policies apart (Critic R300 H2).
    return (c.source?.documentId ?? "") + "|" + (number ? numberKey(number) : "");
  };
  const oneProduct = (a: string | null | undefined, b: string | null | undefined) => (!!productKey(a) && productKey(a) === productKey(b)) || maySameProduct(a, b);
  const read = covers.filter((c) => c.premium != null && c.premium > 0 && !c.ended);
  // A read premium is its policy's when both covers print the same number; a document's filed number says nothing about which of
  // its plans a premium is for (Critic R303 H1). Otherwise only the cover whose product it is (TE pr163 R3).
  const premiumRead = (c: TablePremiumCover) => read.some((r) => r === c || (r.source.documentId === c.source.documentId
    && (c.policyNumber && r.policyNumber ? numberKey(c.policyNumber) === numberKey(r.policyNumber) : oneProduct(r.product, c.product))));
  // How many policies a document prints its own numbers for: with more than one, a record that names neither is not tied to either (R303 M2).
  const numbersOn = (documentId: string) => new Set(covers.filter((c) => c.source.documentId === documentId && c.policyNumber).map((c) => numberKey(c.policyNumber!))).size;
  type Entry = { cover: TablePremiumCover; doc: TablePremiumDocument; old: boolean };
  const groups = new Map<string, Entry[]>();
  for (const c of covers) {
    const documentId = c.source?.documentId, doc = documentId ? documents.get(documentId) : undefined;
    if (!documentId || !doc || c.ended || c.documentKind !== "personal_proof" || doc.lapsedOrEnded) continue;
    if (premiumRead(c) || namedDocumentIds.has(documentId)) continue;
    // Only a proven end (c.ended, doc.lapsedOrEnded, above) drops a policy. A page with an ending word ("will be terminated
    // if ...") may still be a held policy: named, with its document perhaps out of date (TE pr163 N6-N8, Critic R301 H3). A
    // printed period that has run out, or an old start, says nothing: every policy on file is in force (DC, 31 Oct).
    const old = !!doc.endedPages?.includes(c.source.page);
    const key = policyOf(c);
    groups.set(key, [...(groups.get(key) ?? []), { cover: c, doc, old }]);
  }
  // A document's products, a rider joined to the plan it is named after: with one, its filed number, or a record naming no
  // product, is that plan's (Critic R304 H2, R305 H1).
  const productsOn = (documentId: string) => {
    const seen: (string | null)[] = [];
    for (const c of covers) if (c.source.documentId === documentId && !c.ended && !seen.some((p) => oneProduct(p, c.product))) seen.push(c.product);
    return seen.length;
  };
  const out: TableLeftOut[] = [];
  for (const group of groups.values()) {
    // One entry per policy, naming each product on it that is not another's rider by name (Critic R303 M1): plans a schedule
    // prints with no number of their own cannot be told apart from riders. Within a product, a cover whose term ran out does not
    // name it while a current one is listed (TE pr163 R5); another product is never dropped for being old (Critic R304 H1).
    const products: Entry[][] = [];
    for (const g of group) { const p = products.find((x) => oneProduct(x[0].cover.product, g.cover.product)); if (p) p.push(g); else products.push([g]); }
    const kept: { entry: Entry; old: boolean; maybe: boolean }[] = [];
    for (const p of products) {
      const { cover: c, doc } = p.find((g) => !g.old) ?? p[0], old = p.every((g) => g.old);
      const documentId = c.source.documentId;
      const hint = { number: c.policyNumber ?? (productsOn(documentId) <= 1 ? doc.policyNumber ?? null : null), product: c.product, insurer: doc.insurer };
      // From the same document: the same policy when the numbers agree, or with a number missing, when the record names this
      // product or (on a document with one policy and one product at most) no product; another plan's premium on it may be this one's (R3, R303 M2).
      const link = (i: { policy_id?: string | null; policy_number: string | null; product_name: string | null; insurer: string | null; amount?: number }) => {
        if (i.policy_id === documentId) {
          if (hint.number && i.policy_number) { if (samePolicyNumber(hint.number, i.policy_number) || numberKey(hint.number) === numberKey(i.policy_number)) return "same"; }
          else return (!i.product_name?.trim() && numbersOn(documentId) <= 1 && productsOn(documentId) <= 1) || !c.product?.trim() || oneProduct(c.product, i.product_name) ? "same" : "maybe";
        }
        // The filed number and this product both printed on the record: this plan's, whatever else the schedule holds.
        if (doc.policyNumber && i.policy_number && numberKey(doc.policyNumber) === numberKey(i.policy_number) && oneProduct(c.product, i.product_name)) return "same";
        const r = samePolicy(hint, { number: i.policy_number, product: i.product_name, amounts: i.amount == null ? [] : [Number(i.amount)], insurer: i.insurer });
        return r === "maybe" && !(hint.number && i.policy_number) && !maySameProduct(c.product, i.product_name) ? "different" : r;
      };
      const overlap = counted.map(link), already = named.map(link);
      if (overlap.includes("same") || already.includes("same") || already.includes("maybe")) continue;
      kept.push({ entry: { cover: c, doc, old }, old, maybe: overlap.includes("maybe") });
    }
    if (!kept.length) continue;
    const doc = kept[0].entry.doc;
    const name = [...new Set([...kept].sort((a, b) => Number(a.old) - Number(b.old)).map((k) => k.entry.cover.product?.trim()).filter((x): x is string => !!x))].join(" and ") || (doc.insurer ? doc.insurer + " policy" : "one policy");
    out.push({ name, why: kept.some((k) => k.maybe) ? "maybe_counted" : kept.every((k) => k.old) ? "unread_old" : "unread" });
  }
  return out;
}
export async function summarisePremiums(accountId: string, member: ClaimPerson, table?: { covers: TablePremiumCover[]; today: number }): Promise<PremiumSummary> {
  const r = await query<PremiumRecordRow>(
    `SELECT pr.id,pr.policy_id,pr.family_member_id,pr.insurer,pr.product_name,pr.policy_number,pr.amount::text,pr.currency,pr.frequency,pr.payment_date::text,pr.period_start::text,pr.period_end::text,pr.created_at::text,pr.notes,sd.document_role AS source_role
       FROM premium_records pr LEFT JOIN policies sd ON sd.id=pr.source_document_id AND sd.account_id=pr.account_id AND ${activePredicate("sd")}
      WHERE pr.account_id=$1 AND (pr.family_member_id=$2 OR (pr.family_member_id IS NULL AND pr.policy_id IS NOT NULL AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=pr.policy_id AND pm.account_id=pr.account_id AND pm.family_member_id=$2)))
      ORDER BY COALESCE(pr.payment_date,pr.period_start,pr.created_at::date) DESC,pr.created_at DESC`, [accountId, member.id]);
  let fromTable: PremiumItem[] = [], tableLeftOut: TableLeftOut[] = [];
  let documents = new Map<string, TablePremiumDocument>();
  if (table?.covers.length) {
    const ids = [...new Set(table.covers.map((c) => c.source.documentId))];
    // Only current documents: a premium from a deleted or superseded one is never counted (no row, so it is left out below).
    const docs = await query<{ id: string; insurer: string | null; policy_number: string | null; expiry: string | null }>(`SELECT p.id::text AS id,p.insurer,p.policy_number,p.renewal_or_expiry_date::text AS expiry FROM policies p WHERE p.account_id=$1 AND p.id::text=ANY($2::text[]) AND ${activePredicate("p")} AND p.superseded_at IS NULL`, [accountId, ids]);
    const pages = await query<{ policy_id: string; page_number: number; text: string }>(`SELECT policy_id::text AS policy_id,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY page_number`, [accountId, ids]);
    const todayIso = isoOfDay(table.today);
    documents = new Map(docs.rows.map((d) => [d.id, { insurer: d.insurer, policyNumber: d.policy_number,
      endedPages: pages.rows.filter((p) => p.policy_id === d.id && ENDED_WORDS.test(p.text)).map((p) => p.page_number),
      lapsedOrEnded: ["lapsed", "ended"].includes(printedStatus(pages.rows.filter((p) => p.policy_id === d.id).map((p) => ({ page: p.page_number, text: p.text })), d.expiry, todayIso).state) }]));
    ({ items: fromTable, leftOut: tableLeftOut } = tablePremiumItems(table.covers.filter((c) => documents.has(c.source.documentId)), r.rows, member, table.today, documents));
  }
  const all = [...summariseRecords(r.rows), ...fromTable], items = all.filter((i) => !i.oneOff && !i.shortPeriod);
  const oneOff = all.filter((i) => i.oneOff), shortPeriod = all.filter((i) => i.shortPeriod);
  const annual = items.reduce((sum, item) => sum + item.annual, 0);
  const cashAnnual = items.some((i) => i.cashAnnual != null) ? items.reduce((sum, i) => sum + (i.cashAnnual ?? i.annual), 0) : null;
  const medisaveAnnual = items.some((i) => i.medisaveAnnual != null) ? items.reduce((sum, i) => sum + (i.medisaveAnnual ?? 0), 0) : null;
  // Which of this person's policies have no premium evidence at all.
  let missing: string[] = [], inventoryDocumentIds = new Set<string>();
  let missingPolicies: { policy_number: string | null; product_name: string | null; insurer: string | null }[] = [];
  try {
    const inventory = await loadPolicyInventory(accountId, [member]);
    inventoryDocumentIds = new Set(inventory.contracts.flatMap((c) => [...c.documents, ...c.references].map((d) => d.id)));
    const unpaid = inventory.contracts.filter((c) => {
      const ids = new Set([...c.documents, ...c.references].map((d) => d.id));
      const numbers = new Set(c.documents.map((d) => normalizedIdentifier(d.policy_number)).filter(Boolean));
      return !all.some((i) => (i.policy_id && ids.has(i.policy_id)) || (normalizedIdentifier(i.policy_number) && numbers.has(normalizedIdentifier(i.policy_number))));
    });
    missing = unpaid.map((c) => c.name);
    missingPolicies = unpaid.flatMap((c) => c.documents.map((d) => ({ policy_number: d.policy_number, product_name: d.product_name ?? c.name, insurer: d.insurer })));
  } catch { missing = []; }
  missing = [...new Set(missing)];
  // A table policy the inventory does not list (an unconfirmed schedule) with no premium read is named too, never silent;
  // when the inventory could not be read, every such policy is named rather than none (Critic R300 L2).
  if (table) tableLeftOut.push(...unreadPremiumCovers(table.covers, all, documents, inventoryDocumentIds, table.today, missingPolicies));
  const missingNote = missing.length
    ? "The total leaves out " + missing.slice(0, 4).join(", ") + (missing.length > 4 ? " and " + (missing.length - 4) + " more" : "") + ": no premium is printed in the documents on file for " + (missing.length === 1 ? "it" : "them") + "."
    : null;
  const shortNote = shortPeriod.length
    ? "The total " + (missingNote ? "also " : "") + "leaves out " + shortPeriod.slice(0, 4).map((i) => (i.product_name ?? i.insurer ?? "a policy") + " (" + (i.currencyStated ? formatMoney(i.amount, i.currency) : formatMoney(i.amount, null)) + " for " + longDate(i.period_start!) + " to " + longDate(i.period_end!) + ")").join(", ") +
      ": the record prints no payment frequency, so it may be a one-off premium and is not counted as a yearly one."
    : null;
  const WHY: Record<TableLeftOut["why"], [string, string]> = {
    not_current: ["the premium its document prints may not be what is paid now", "the premiums their documents print may not be what is paid now"],
    maybe_counted: ["it may be the policy of a premium already counted, so it is not added again", "they may be policies whose premiums are already counted, so they are not added again"],
    unclear: ["its document does not say plainly how often, or in what currency, the premium is paid", "their documents do not say plainly how often, or in what currency, the premiums are paid"],
    two_documents: ["two of its documents print a premium, and which is current is not known", "two of their documents print a premium, and which is current is not known"],
    unread: ["no premium could be read from its documents", "no premium could be read from their documents"],
    unread_old: ["no premium could be read from its documents, which may not show the policy as it is now", "no premium could be read from their documents, which may not show the policies as they are now"],
  };
  const tableNote = (Object.keys(WHY) as TableLeftOut["why"][]).map((why) => {
    const names = [...new Set(tableLeftOut.filter((x) => x.why === why).map((x) => x.name))];
    return names.length ? names.slice(0, 4).join(", ") + ": " + WHY[why][names.length === 1 ? 0 : 1] : null;
  }).filter(Boolean).map((part, i) => (i === 0 ? "The total " + (missingNote || shortNote ? "also " : "") + "leaves out " : "It also leaves out ") + part + ".").join(" ") || null;
  const note = [missingNote, shortNote, tableNote].filter(Boolean).join(" ") || null;
  return { monthly: annual / 12, annual, cashAnnual, medisaveAnnual, items, oneOff, shortPeriod, missing, complete: missing.length === 0 && shortPeriod.length === 0 && tableLeftOut.length === 0 && items.length > 0, note };
}
