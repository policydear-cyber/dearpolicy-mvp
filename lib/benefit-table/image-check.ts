/** The page-image figure check (DC, 14 Nov 2026: "there can be a million formats ... there's no standard format"): one
 * general rule instead of a rule per layout. Every figure the table uses must be confirmed against the page itself.
 *
 * - A figure read from a page with its own text layer ("native") is already confirmed by the reading's checks: it is used
 *   only when it is printed in its row's own words on that page (check.ts). Nothing more is paid for it.
 * - A figure read from a page whose words came from OCR (Baidu, or the AI page reader) may carry an OCR misread ("S$20,000"
 *   read as "$520,000", "S$1,372,820" as "S$1.372.820", a lost currency letter). A checker that reads the same OCR text
 *   cannot see that, so a checker model is shown the PAGE ITSELF (the stored file's page) and told only where to look (the
 *   page, the row's label, its heading and column, or the person and cover), never the figure, and copies the cell as
 *   printed. The figure is used only when the copy prints the same number and does not name another currency.
 * - A copy that does not confirm it: a second, stronger checker copies it again, blind. Confirmed by that copy: used.
 *   Otherwise the figure is not used anywhere: its row keeps its printed words and the household is asked to check it, with
 *   the figures the checkers copied from the page (never a figure only the OCR text gave).
 *
 * The result is a GuardRecord (guards.ts) with its own version, so the table's existing rules apply unchanged: a figure
 * with no "agreed" verdict is never used, a household's own figure is final, and a check cut off by its time limit goes on
 * in the continuation job. Models are passed in; nothing here calls a model by itself. Proof (made-up documents, 14 Nov):
 * one Sonnet checker that saw the page caught 34 of 34 wrong figures the reader had accepted and questioned 1 right one;
 * text-only checkers caught none of them. */
import { priceFor } from "@/lib/ai/providers";
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";
import { UNTRUSTED_DOCUMENT_NOTICE } from "@/lib/documents/evidence";
import type { CheckedReading } from "./check";
import { numbersIn, printsNumber } from "./check";
import type { OnUsage } from "./service";
import type { Attachment, TableModel, TableReply } from "./model";
import { claimsOf, type Claim, type GuardRecord, type Per, type Verdict } from "./guards";

export const IMAGE_CHECK_VERSION = "image-2026-11-14.1";
/** At most this many figures are asked about in one call (a page with more is asked in several calls). */
export const IMAGE_BATCH = 40;
/** The page's own size in the prompt, worst case: about 1,600 tokens for the page image and up to 3,000 for any text a
 * PDF page carries, charged at the uncached input price. */
export const PAGE_TOKENS = 4_600;
const OUT_BASE = 300;
const OUT_PER_CLAIM = 60;
const UNKNOWN_PRICE = { input: 5, output: 25 };

/** A checker: a model that is shown the page, and where its spend is booked. */
export type ImageChecker = { model: TableModel; onUsage?: OnUsage };
/** What the check needs to know about the stored file: the pages known to carry their own text layer (extraction method
 * "native"; every other page, a page with no record included, is checked against the page), and the page itself as the
 * model is shown it. page() returns null when the stored file cannot give that page (gone, unreadable, or not a PDF or
 * picture): its figures are then not confirmed. */
export type PageSource = { nativePages: number[]; page(n: number): Promise<Attachment | null> };
/** first: the checker every OCR figure goes to; second: the stronger checker a figure goes to when the first one's copy
 * does not confirm it. capUsd: the most the check may spend on this document (earlier checks of it included). */
export type ImageCheckSetup = { kind: "image"; first: ImageChecker; second: ImageChecker; capUsd: number; source: (policyId: string) => Promise<PageSource> };
export type ImageCheckOptions = { capUsd: number; callTime?: () => number | null; minCallMs?: number; now?: () => Date; previous?: GuardRecord | null; spentBefore?: number };

export const IMAGE_CHECK_PROMPT = `You check figures in an insurance document against the page itself. You are shown one page of the document. For each question, find the row on THIS page by its label (and its heading, and the column named, or the person and cover named) and copy the figure cell EXACTLY as it is printed on the page: every character, the currency letters and signs included (S$, US$, HK$, A$, NZ$, RM, SGD, USD, €, £, ¥, ₹ ...), digits, thousands separators, decimals, % and the words printed in the cell with it ("per day", "per year", "of Sum Insured"). Never correct, convert, round, add or work anything out, and never copy from another row, column, person or page. When a table has several plan or person columns, copy only the cell under the column named.

If the page does not print that row, column, person or cover, or prints no figure for it, or you cannot read the cell with certainty, answer null.

The questions follow in <questions>.${UNTRUSTED_DOCUMENT_NOTICE}`;

export const IMAGE_CHECK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "printed"],
    properties: { id: { type: "string" }, printed: { type: ["string", "null"] } } } } },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The values a printed number token can stand for: as read, and with its scale word ("520K", "S$0.52m", "1.5 million"). */
const SCALES: [RegExp, number][] = [[/^(?:k|thousand)$/i, 1e3], [/^(?:m|mil|million|mn)$/i, 1e6], [/^(?:b|bn|billion)$/i, 1e9]];
export function tokenValues(tok: string): number[] {
  const m = /^(\d[\d,.]*)\s*([a-z]*)$/i.exec(tok.trim());
  const out = numbersIn(tok);
  if (m) {
    const base = Number(m[1].replace(/,/g, ""));
    const scale = SCALES.find(([re]) => re.test(m[2]))?.[1];
    if (Number.isFinite(base) && scale) out.push(base * scale);
  }
  return out;
}
/** Where to look, with every number masked that prints ANY figure asked in the same call: the row, column, heading,
 * product and plan names come from the OCR text and can print a figure ("Plan B (S$520,000)"), an OCR misread included,
 * and a plan column's name repeats in every row of it (Critic 2, R485 H2, R2-2). Other numbers stay, so "Plan 1" and
 * "Plan 2" are still told apart. */
export function blindWhere(where: string, values: number[]): string {
  return where.replace(/\d[\d,.]*(?:\s*(?:million|mil|mn|billion|bn|thousand|k|m|b)\b)?/gi,
    (tok) => tokenValues(tok).some((n) => values.some((v) => Math.abs(n - v) < 0.005)) ? "…" : tok);
}
/** The questions: where to look and what to copy; never a figure asked in the call. */
export function imageQuestions(claims: Claim[]): string {
  const values = claims.map((c) => c.value);
  return `<questions>\n${claims.map((c, i) => `<q id="q${i + 1}">${esc(blindWhere(c.where, values))}. Copy ${esc(c.ask)}, exactly as printed.</q>`).join("\n")}\n</questions>`;
}
/** A checker's reply read back to each claim by id: the copied cell, or null (not found, unreadable or malformed). */
export function readCopies(json: unknown, claims: Claim[]): (string | null)[] {
  const list = Array.isArray((json as { answers?: unknown })?.answers) ? (json as { answers: unknown[] }).answers : [];
  const byId = new Map<string, string | null>();
  for (const raw of list) {
    const a = (raw ?? {}) as { id?: unknown; printed?: unknown };
    if (typeof a.id !== "string" || byId.has(a.id)) continue;
    byId.set(a.id, typeof a.printed === "string" && a.printed.trim() ? a.printed.trim().slice(0, 300) : null);
  }
  return claims.map((_, i) => byId.get(`q${i + 1}`) ?? null);
}

/** What each claim's figure is, in claimsOf's order: the currency it is read in (the table's own for that row or cover),
 * and what it is per (a percentage is per "percent"; a cap, a money limit, has none). */
export type ClaimFacts = { currency: string | null; per: Per | null };
export function claimFacts(r: CheckedReading): ClaimFacts[] {
  const cur = currencies(r);
  return claimsOf(r).map((c, i) => ({ currency: cur[i] ?? null, per: c.field === "cap" ? null : c.per }));
}
function currencies(r: CheckedReading): (string | null)[] {
  const out: (string | null)[] = [];
  for (const b of r.benefits) {
    if (b.value != null) out.push(b.currency ?? null);
    if (b.cap != null && b.capSource) out.push(b.currency ?? null);
  }
  for (const c of r.covers) {
    if (c.sumInsured != null) out.push(c.currency ?? null);
    if (c.premium != null) out.push(c.currency ?? null);
  }
  return out;
}

const PERCENT_TOKEN = /\d[\d,.]*\s*(?:%|per\s?cent\b)/gi;
/** The bases a copied cell prints, each mapped to a period, or "other" for a basis no period here can hold ("per visit",
 * "each confinement", "lifetime", "aggregate"). An allow-list: a basis word that is not a known period is "other". */
export function basesIn(copy: string): (Per | "other")[] {
  const out: (Per | "other")[] = [];
  const text = copy.toLowerCase();
  const named = (w: string): Per | "other" => {
    const x = w.replace(/^(?:policy|calendar|insured|benefit|cover|contract)\s+/, "").trim();
    if (/^days?$/.test(x)) return "day";
    if (/^weeks?$/.test(x)) return "week";
    if (/^months?$/.test(x)) return "month";
    if (/^quarters?$/.test(x)) return "quarter";
    if (/^half[-\s]?years?$/.test(x)) return "half_year";
    if (/^(?:years?|annum)$/.test(x)) return "year";
    return "other";
  };
  for (const m of text.matchAll(/\b(?:per|each|every|a|an)\s+((?:(?:policy|calendar|insured|benefit|cover|contract)\s+)?(?:half[-\s]year|[a-z]+))/g)) out.push(named(m[1]));
  for (const m of text.matchAll(/\/\s*(day|week|month|year)\b/g)) out.push(named(m[1]));
  if (/\bhalf[-\s]?yearly\b|\bsemi[-\s]?annual(?:ly)?\b/.test(text)) out.push("half_year");
  const rest = text.replace(/\bhalf[-\s]?yearly\b|\bsemi[-\s]?annual(?:ly)?\b/g, " ");
  if (/\bdaily\b|\bper\s+diem\b/.test(rest)) out.push("day");
  if (/\bweekly\b/.test(rest)) out.push("week");
  if (/\bmonthly\b/.test(rest)) out.push("month");
  if (/\bquarterly\b/.test(rest)) out.push("quarter");
  if (/\bannual(?:ly)?\b|\byearly\b|\bp\.\s?a\.?(?![a-z])/.test(rest)) out.push("year");
  if (/\blifetime\b|\bfor\s+life\b|\bin\s+total\b|\baggregate\b/.test(rest)) out.push("other");
  return out;
}
/** The periods a copied cell prints that map to one (see basesIn). */
export const periodsIn = (copy: string): Per[] => [...new Set(basesIn(copy).filter((b): b is Per => b !== "other"))];
const MULTIPLIER = /\d\s*(?:x|×|times)(?![a-z])|(?:^|[^a-z])(?:x|×)\s*\d/i;

/** Whether a copy of the cell confirms the figure (an allow-list; Critic 2, R485 H1 and R2-1, TE2 F1):
 * - the copy's OWN amount is the figure: for a percentage, the first figure printed with "%"; for money, the first figure
 *   in the cell. Another number in the cell confirms nothing ("S$100 per day (S$50 for children)": not 50);
 * - money is never confirmed by a copy that also prints a percentage or a multiplier ("200% of S$50,000", "2 x Sum
 *   Insured", "S$150 x 30 days"), nor a percentage by a copy with no "%";
 * - every basis the copy prints ("per day", "yearly", "per visit", "lifetime") must be the figure's own period: a basis no
 *   period can hold, or money with no period of its own (a cap, a lump sum) next to any basis, is not confirmed;
 * - the copy names no other currency, and a bare "$" (which never establishes a currency) does not confirm a figure read
 *   in one. A copy that names a currency the reading does not know confirms the number only: the table keeps the currency
 *   it had (none, when it had none). */
export function copyConfirms(copy: string | null, value: number, facts: ClaimFacts): boolean {
  if (copy == null) return false;
  const percents = [...copy.matchAll(PERCENT_TOKEN)].map((m) => m[0]);
  const percent = facts.per === "percent";
  if (!percent && (percents.length || MULTIPLIER.test(copy))) return false;
  const own = percent ? (percents.length ? numbersIn(percents[0])[0] : undefined) : numbersIn(copy)[0];
  if (own == null || Math.abs(own - value) >= 0.005 || !printsNumber(copy, value)) return false;
  if (!percent) {
    const bases = basesIn(copy);
    if (bases.length && (facts.per == null || facts.per === "once" || bases.some((b) => b !== facts.per))) return false;
  }
  const named = statedCurrencyCode(copy);
  if (named && facts.currency && named !== facts.currency) return false;
  if (!named && facts.currency && /\$/.test(copy)) return false;
  return true;
}

/** The figures a checker copied from the page, for the household to choose from. */
function copiedFigures(copies: (string | null)[]): number[] {
  const out: number[] = [];
  for (const c of copies) for (const n of c == null ? [] : numbersIn(c).slice(0, 1)) if (!out.some((o) => Math.abs(o - n) < 0.005)) out.push(n);
  return out;
}

const price = (m: TableModel) => priceFor(m.choice) ?? UNKNOWN_PRICE;
export function worstUsd(m: TableModel, promptChars: number, maxTokens: number) {
  const p = price(m);
  return ((Math.ceil(promptChars / 3.5) + PAGE_TOKENS) * p.input + maxTokens * p.output) / 1e6;
}
function spentUsd(m: TableModel, r: TableReply) {
  const p = price(m) as { input: number; output: number; cachedInput?: number };
  return (r.input * p.input + (r.cacheWrite ?? 0) * p.input * 1.25 + (r.cacheRead ?? 0) * (p.cachedInput ?? p.input) + r.output * p.output) / 1e6;
}
export const maxTokensFor = (claims: number) => OUT_BASE + OUT_PER_CLAIM * claims;

/** Checks every figure of one document's checked reading (see the module note). claims on text-layer pages are agreed
 * at once; claims on OCR pages are asked page by page. */
export async function runImageCheck(checked: CheckedReading, source: PageSource, first: ImageChecker, second: ImageChecker, o: ImageCheckOptions): Promise<GuardRecord> {
  const record: GuardRecord = { version: IMAGE_CHECK_VERSION, at: o.previous?.at ?? (o.now?.() ?? new Date()).toISOString(), verdicts: {},
    spentUsd: o.previous?.spentUsd ?? o.spentBefore ?? 0, calls: o.previous?.calls ?? 0, stopped: null };
  const all = claimsOf(checked);
  const facts = claimFacts(checked);
  const factsOf = new Map(all.map((c, i) => [c.key, facts[i]]));
  // An earlier run on this same reading (cut off by its time limit): what it settled stays.
  for (const c of all) {
    const v = o.previous?.version === IMAGE_CHECK_VERSION ? o.previous.verdicts?.[c.key] : undefined;
    if (v && v.status !== "checking") record.verdicts[c.key] = v;
  }
  const native = new Set(source.nativePages);
  const agreed = (c: Claim): Verdict => ({ status: "agreed", value: c.value, per: c.per, page: c.page, line: c.excerpt, candidates: [], rounds: 0 });
  for (const c of all) if (!record.verdicts[c.key] && native.has(c.page)) record.verdicts[c.key] = agreed(c);

  const minCall = o.minCallMs ?? 45_000;
  let stop: "spend" | "time" | "error" | null = null;
  const pending = all.filter((c) => !record.verdicts[c.key]);
  const copies = new Map<string, (string | null)[]>(pending.map((c) => [c.key, []]));
  /** One checker over some claims of one page; false when the run must stop. */
  const ask = async (checker: ImageChecker, page: number, claims: Claim[], file: NonNullable<Awaited<ReturnType<PageSource["page"]>>>) => {
    for (let i = 0; i < claims.length; i += IMAGE_BATCH) {
      const batch = claims.slice(i, i + IMAGE_BATCH);
      const user = `Page ${page} of the document.\n${imageQuestions(batch)}`;
      const maxTokens = maxTokensFor(batch.length);
      if (record.spentUsd + worstUsd(checker.model, IMAGE_CHECK_PROMPT.length + user.length + JSON.stringify(IMAGE_CHECK_SCHEMA).length, maxTokens) > o.capUsd) { stop = "spend"; return false; }
      const left = o.callTime?.() ?? null;
      if (left != null && left < minCall) { stop = "time"; return false; }
      let reply: TableReply;
      try { reply = await checker.model.call({ system: IMAGE_CHECK_PROMPT, user, attachments: [file], schema: IMAGE_CHECK_SCHEMA, maxTokens, ...(left != null ? { timeoutMs: left } : {}) }); }
      catch { stop = "error"; return false; }
      record.calls++;
      record.spentUsd += spentUsd(checker.model, reply);
      await checker.onUsage?.("figure check", reply);
      if (reply.stopReason === "timeout") { stop = "time"; return false; }
      readCopies(reply.json, batch).forEach((copy, j) => copies.get(batch[j].key)!.push(copy));
    }
    return true;
  };
  const byPage = new Map<number, Claim[]>();
  for (const c of pending) byPage.set(c.page, [...(byPage.get(c.page) ?? []), c]);
  for (const [page, claims] of [...byPage].sort((a, b) => a[0] - b[0])) {
    if (stop) break;
    let file: Awaited<ReturnType<PageSource["page"]>> = null;
    try { file = await source.page(page); } catch { file = null; }
    // The page cannot be shown: its figures are not confirmed (the household is asked), never used unchecked.
    if (!file) { for (const c of claims) record.verdicts[c.key] = { status: "confirm", value: null, per: null, page, line: c.excerpt, candidates: [], rounds: 0 }; continue; }
    if (!(await ask(first, page, claims, file))) break;
    const doubted = claims.filter((c) => !copyConfirms(copies.get(c.key)![0] ?? null, c.value, factsOf.get(c.key)!));
    for (const c of claims) if (!doubted.includes(c)) record.verdicts[c.key] = { ...agreed(c), rounds: 1 };
    if (doubted.length && !(await ask(second, page, doubted, file))) break;
    for (const c of doubted) {
      const got = copies.get(c.key)!;
      record.verdicts[c.key] = copyConfirms(got[1] ?? null, c.value, factsOf.get(c.key)!)
        ? { ...agreed(c), rounds: 2 }
        : { status: "confirm", value: null, per: null, page, line: c.excerpt, candidates: copiedFigures(got), rounds: 2 };
    }
  }
  // Whatever the run did not reach: left "checking" when cut off by time or a failed call (the continuation job goes on);
  // out of spend, the household is asked.
  for (const c of all) {
    if (record.verdicts[c.key]) continue;
    record.verdicts[c.key] = stop === "spend"
      ? { status: "confirm", value: null, per: null, page: c.page, line: c.excerpt, candidates: copiedFigures(copies.get(c.key) ?? []), rounds: (copies.get(c.key) ?? []).length }
      : { status: "checking", value: null, per: null, page: c.page, line: c.excerpt, candidates: [], rounds: 0 };
  }
  record.stopped = stop;
  record.spentUsd = Math.round(record.spentUsd * 1e6) / 1e6;
  return record;
}
