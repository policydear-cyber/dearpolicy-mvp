/** The figure guards (DC, 6 Nov 2026): five separate readers must agree on every figure before the table uses it. Pure.
 *
 * Reader 1 is the document's own reading (reading.ts). Four guards then read the same pages, each on its own, with a
 * different model or differently worded instructions. A guard is told only where to look (the page, the row's label, its
 * section and plan column, or the person and cover) and never the figure, so it cannot copy reader 1. Each says the
 * amount it reads there and what it is per (once, a day, a month, a year, a percentage).
 *
 * - All five agree on the amount and what it is per, and the amount is printed in the row: the figure is used.
 * - Any one disagrees: those figures are read again by all five (reader 1's model too, blind, with slower instructions),
 *   up to MAX_REREADS times. When all five then agree on a different figure that is printed in the row, it replaces
 *   reader 1's.
 * - Still not settled after MAX_REREADS re-reads, or the run's spend limit is reached: the figure is not used anywhere,
 *   and the household is asked to confirm it, with the printed line, the page and the figures the readers gave.
 * - A figure the household confirmed is final: no re-read, check or later code changes it (applyGuards).
 *
 * Only figures are checked (amounts, limits, daily rates, percentages, sums insured, premiums), never clauses or
 * plain-words rows. Nothing is dropped: an unsettled figure's row stays in the table as its printed words. */
import { createHash } from "node:crypto";
import type { CheckedBenefit, CheckedCover, CheckedReading, Source } from "./check";
import { printsNumber } from "./check";
import { UNTRUSTED_DOCUMENT_NOTICE } from "@/lib/documents/evidence";

export const GUARDS_VERSION = "2026-11-06.1";
/** Re-reads after the first round (DC, 6 Nov 10:39Z: "after 3 re-reads, it should flag out to the user"). */
export const MAX_REREADS = 3;
export const PER = ["once", "day", "week", "month", "quarter", "half_year", "year", "percent"] as const;
export type Per = (typeof PER)[number];
export const FIELDS = ["value", "cap", "sum_insured", "premium"] as const;
export type Field = (typeof FIELDS)[number];

/** One figure to check: where it is, what reader 1 read there, and the words a guard is told (never the figure). */
export type Claim = { key: string; field: Field; page: number; where: string; ask: string; value: number; per: Per | null; excerpt: string };
export type Answer = { amount: number | null; per: Per | null; line?: string | null };
/** agreed: all five agreed with reader 1. corrected: all five agreed on another figure printed in the row. confirm: not
 * settled after the re-reads or the spend limit; the household is asked. checking: the run stopped before it was settled
 * (its time limit); read again on the next run. */
/** seen: for a figure not settled, what each reader answered in each round ([amount, per], reader 1 first), for audit. */
export type Verdict = { status: "agreed" | "corrected" | "confirm" | "checking"; value: number | null; per: Per | null; page: number; line: string;
  candidates: number[]; rounds: number; seen?: [number | null, Per | null][][] };
/** at: when this reading's check began (kept when a cut-off check is resumed); spentUsd: what checks of this document have
 * spent in all, earlier readings' included (the per-document limit); calls: this reading's check's. */
export type GuardRecord = { version: string; at: string; verdicts: Record<string, Verdict>; spentUsd: number; calls: number; stopped?: string | null };
/** How many figures a record left "checking" (stopped by a time limit): what a continuation job still has to do. */
export const checkingCount = (g: GuardRecord | null | undefined) => Object.values(g?.verdicts ?? {}).filter((v) => v.status === "checking").length;
/** The figures of a checked reading the guards have not finished: left "checking", or with no verdict at all (a check that
 * failed before it began). What a continuation job still has to do. */
export const unfinishedCount = (r: CheckedReading, g: GuardRecord | null | undefined) =>
  claimsOf(r).filter((c) => { const v = g?.verdicts?.[c.key]; return !v || v.status === "checking"; }).length;
/** The household's own figure for one claim (benefit_figure_confirmations): final. */
export type FigureConfirmation = { documentId: string; claimKey: string; value: number };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 22);

export function perOfBenefit(b: Pick<CheckedBenefit, "pays" | "period">): Per | null {
  switch (b.pays) {
    case "amount": case "up_to": case "value": return "once";
    case "per_day": return "day";
    case "percent": return "percent";
    case "per_period": return b.period && (PER as readonly string[]).includes(b.period) ? b.period as Per : null;
    default: return null;
  }
}
export function perOfFrequency(f: string | null | undefined): Per | null {
  const s = norm(f);
  if (!s) return null;
  if (/month/.test(s)) return "month";
  if (/quarter/.test(s)) return "quarter";
  if (/half|semi/.test(s)) return "half_year";
  if (/year|annual/.test(s)) return "year";
  if (/single|once/.test(s)) return "once";
  return null;
}

const quote = (s: string | null | undefined) => `"${(s ?? "").replace(/\s+/g, " ").trim()}"`;
function benefitWhere(b: CheckedBenefit): string {
  return `Page ${b.source.page}: the row ${quote(b.benefit)}${b.section ? ` under the heading ${quote(b.section)}` : ""}${b.column ? `, in the column ${quote(b.column)}` : ""}`;
}
function coverWhere(c: CheckedCover, page: number): string {
  return `Page ${page}: ${quote(c.person)}'s cover ${quote(c.cover)}${c.product && norm(c.product) !== norm(c.cover) ? ` (${quote(c.product)})` : ""}${c.plan ? `, plan ${quote(c.plan)}` : ""}`;
}

/** Every figure a checked reading uses, as claims with stable keys. A key binds to exactly one printed row: the row's
 * label and column (or the person and cover) and the row's own printed words (the excerpt found on the page), never the
 * figure the reader gave, its page or the heading's wording. So a household's confirmation stays with its row when a fresh
 * reading cites another page or words the heading differently (Critic R389-2), and never moves to another table's row
 * with the same label (Critic R389b: an add-on's "Medical expenses" printed with other figures). Two rows that print the
 * very same words under the same label and column also need the same page, heading and order to match, so a reading that
 * cannot tell them apart asks the household again rather than guess. */
export function claimsOf(r: CheckedReading): Claim[] {
  const out: Claim[] = [];
  const drafts: { base: string; strict: unknown[]; claim: Omit<Claim, "key"> }[] = [];
  const add = (field: Field, place: unknown[], strict: unknown[], c: Omit<Claim, "key" | "field">) => {
    drafts.push({ base: JSON.stringify([r.documentId, field, ...place, norm(c.excerpt)]), strict, claim: { field, ...c } });
  };
  for (const b of r.benefits) {
    const place = [norm(b.benefit), norm(b.column)];
    const where = benefitWhere(b);
    if (b.value != null)
      add("value", place, [b.source.page, norm(b.section)], { page: b.source.page, where, ask: b.pays === "percent" ? "the percentage this row pays (25 for 25%)" : "the figure this row pays or holds",
        value: b.value, per: perOfBenefit(b), excerpt: b.source.excerpt });
    if (b.cap != null && b.capSource)
      add("cap", place, [b.capSource.page, norm(b.section)], { page: b.capSource.page, where, ask: "the most this row pays in money (its upper limit, as printed next to it)", value: b.cap, per: null, excerpt: b.capSource.excerpt });
  }
  for (const c of r.covers) {
    const place = [norm(c.person), norm(c.product), norm(c.cover), norm(c.plan)];
    if (c.sumInsured != null)
      add("sum_insured", place, [c.source.page], { page: c.source.page, where: coverWhere(c, c.source.page), ask: "the sum insured or sum assured printed for this person's cover", value: c.sumInsured, per: "once", excerpt: c.source.excerpt });
    if (c.premium != null) {
      const src: Source = c.premiumSource ?? c.source;
      add("premium", place, [src.page], { page: src.page, where: coverWhere(c, src.page), ask: "the premium printed for this person's cover, and how often it is paid", value: c.premium,
        per: perOfFrequency(c.premiumFrequency), excerpt: src.excerpt });
    }
  }
  const count = new Map<string, number>();
  for (const d of drafts) count.set(d.base, (count.get(d.base) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const d of drafts) {
    if (count.get(d.base) === 1) { out.push({ key: hash([d.base]), ...d.claim }); continue; }
    const n = (seen.get(d.base) ?? 0) + 1;
    seen.set(d.base, n);
    out.push({ key: hash([d.base, ...d.strict, n]), ...d.claim });
  }
  return out;
}

/** Whether the row's words print the figure. The excerpt has its table cells joined by single spaces, which printsNumber
 * can read as one space-grouped number ("50 100 150"); so each cell (each run without spaces) is also tried on its own. */
export function rowPrints(excerpt: string, value: number): boolean {
  return printsNumber(excerpt, value) || excerpt.split(/\s+/).some((cell) => cell && printsNumber(cell, value));
}
const same = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.005;
/** Whether the round's "per" answers agree: every reader states one, and the same one. Only this round's answers count
 * (round 0 holds reader 1's own reading; a re-read holds reader 1's model reading again, blind), so a re-read can settle
 * what reader 1 first read wrongly. A premium whose frequency reader 1 did not read is judged on the frequencies stated. */
function perAgrees(field: Field, answers: Answer[]): boolean {
  if (field === "cap") return true;
  const stated = answers.map((a) => a.per).filter((p): p is Per => p != null);
  if (field !== "premium" && stated.length < answers.length) return false;
  return new Set(stated).size <= 1;
}

/** A round's verdict for one claim. answers: the five readers' answers this round (round 0: reader 1's own reading plus
 * the four guards). Agreement: every reader found the row, read the same amount and the same "per", and that amount is
 * printed in the row's own words. */
export function judge(claim: Claim, answers: Answer[], readers: number): { settled: boolean; value: number | null; per: Per | null } {
  if (answers.length < readers) return { settled: false, value: null, per: null };
  const first = answers[0]?.amount ?? null;
  if (first == null || !answers.every((a) => same(a.amount, first))) return { settled: false, value: null, per: null };
  if (!perAgrees(claim.field, answers)) return { settled: false, value: null, per: null };
  if (!rowPrints(claim.excerpt, first)) return { settled: false, value: null, per: null };
  const per = answers.map((a) => a.per).find((p) => p != null) ?? claim.per;
  return { settled: true, value: first, per };
}

/** The figures the readers gave that the row or its page prints, for the household to choose from: never a figure no
 * page prints. */
export function candidatesOf(answers: Answer[][], claim: Claim, pageText: string): number[] {
  const out: number[] = [];
  for (const a of [claim.value, ...answers.flat().map((x) => x.amount)])
    if (a != null && printsNumber(pageText, a) && !out.some((o) => same(o, a))) out.push(a);
  return out;
}

export const GUARD_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers"],
  properties: { answers: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "found", "amount", "per", "line"],
    properties: { id: { type: "string" }, found: { type: "boolean" }, amount: { type: ["number", "null"] },
      per: { anyOf: [{ type: "string", enum: PER }, { type: "null" }] }, line: { type: "string" } } } } },
};

const ANSWER_RULES = `For each question give:
- found: false when the page does not print that row, column, person or cover, or prints no figure for it there; then amount and per are null.
- amount: the figure as a plain number exactly as printed (25000 for "S$25,000", 25 for "25%", 80.5 for "80.50"). Never work anything out, add, convert or round.
- per: "once" for a lump sum, or a limit or value with no period; "day", "week", "month", "quarter", "half_year" or "year" when the row or its cell prints it per that period (a daily benefit, a monthly premium, a yearly payment, an annual or per-year limit); "percent" for a percentage. null only when the page prints nothing that says.
- line: the exact printed words you read the figure from.
The heading and column names are there to help you find the row: when the page prints the row but under a different heading, still answer for that row. When a table has several plan or person columns, read only the column named; never take another column's figure. When the page prints two different figures for the same row and column, set found to false.`;

export const GUARD_PROMPTS = {
  /** Wording A. */
  direct: `You are an independent checker of figures in an insurance document. Another reader has listed figures from it; you are not told what they read. Read the page yourself and answer each question from what is printed there.

The pages arrive between <document> and </document>, each in <page n="...">; the questions follow in <questions>.${UNTRUSTED_DOCUMENT_NOTICE}

${ANSWER_RULES}`,
  /** Wording B: copy first, then answer. */
  copyFirst: `You check one insurance document's figures, one question at a time, without seeing anyone else's answers. For each question, first find the row and copy it exactly, with the table's column headings above it, into line; then read the figure under the named column from what you copied.

The pages arrive between <document> and </document>, each in <page n="...">; the questions follow in <questions>.${UNTRUSTED_DOCUMENT_NOTICE}

${ANSWER_RULES}`,
  /** A re-read: slower, and told that readers disagreed (never on what). */
  reread: `Independent readers disagreed on the figures below in an insurance document. You are not told what any of them read. Read each one again slowly and carefully: find the section heading, then the row, then the column headings; check that the figure sits under the named column on the same line as the row's label (tables can wrap, or print each plan's figure on a separate line); check the unit printed next to it (per day, per month, per year, %).

The pages arrive between <document> and </document>, each in <page n="...">; the questions follow in <questions>.${UNTRUSTED_DOCUMENT_NOTICE}

${ANSWER_RULES}`,
};
export type GuardPrompt = keyof typeof GUARD_PROMPTS;

/** The questions as a guard reads them: an id, where to look and what to read; never the figure. */
export function renderQuestions(claims: Claim[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<questions>\n${claims.map((c, i) => `<q id="q${i + 1}">${esc(c.where)}. Read ${esc(c.ask)}.</q>`).join("\n")}\n</questions>`;
}
/** A guard's reply, read back to each claim by id. A missing or malformed answer counts as not found. */
export function readAnswers(json: unknown, claims: Claim[]): Answer[] {
  const list = Array.isArray((json as { answers?: unknown })?.answers) ? (json as { answers: unknown[] }).answers : [];
  const byId = new Map<string, Answer>();
  for (const raw of list) {
    const a = (raw ?? {}) as { id?: unknown; found?: unknown; amount?: unknown; per?: unknown; line?: unknown };
    if (typeof a.id !== "string" || byId.has(a.id)) continue;
    const found = a.found === true && typeof a.amount === "number" && Number.isFinite(a.amount);
    byId.set(a.id, { amount: found ? a.amount as number : null, per: found && typeof a.per === "string" && (PER as readonly string[]).includes(a.per) ? a.per as Per : null,
      line: typeof a.line === "string" ? a.line.slice(0, 400) : null });
  }
  return claims.map((_, i) => byId.get(`q${i + 1}`) ?? { amount: null, per: null, line: null });
}

/** Reader 1's own answer for a claim (round 0). */
export const firstAnswer = (c: Claim): Answer => ({ amount: c.value, per: c.per, line: c.excerpt });

/** The figure the household sees in place of an unsettled one: the printed line and page. */
export const NEEDS_CONFIRMATION = "Please check this figure: the readers did not agree on it.";
export const STILL_CHECKING = "This figure is still being checked.";

export type GuardNote = { status: "confirm" | "checking"; field: Field; claimKey: string; page: number; line: string; candidates: number[]; note: string };
type Marked = { figureCheck?: GuardNote[] };

/** The checked reading as the table may use it, once its figures have been through the guards:
 * - a household confirmation is final and always wins;
 * - an agreed figure is kept, a corrected one replaces reader 1's;
 * - any other figure (not settled, still being checked, or never checked, such as one a later code change reads afresh)
 *   is taken out of the row so no total or calculation uses it, and the row keeps its printed words with a note.
 * guards null (the document was read before the guards, or with them off): every figure is "never checked". */
export function applyGuards(r: CheckedReading, guards: GuardRecord | null | undefined, confirmations: FigureConfirmation[] = []): CheckedReading {
  const out: CheckedReading = structuredClone(r);
  const confirmed = new Map(confirmations.filter((c) => c.documentId === r.documentId).map((c) => [c.claimKey, c.value]));
  const list = claimsOf(r);
  let i = 0;
  const next = () => list[i++];
  const settle = (claim: Claim): { value: number | null; note: GuardNote | null } => {
    if (confirmed.has(claim.key)) return { value: confirmed.get(claim.key)!, note: null };
    const v = guards?.verdicts?.[claim.key];
    if (v && (v.status === "agreed" || v.status === "corrected") && v.value != null && rowPrints(claim.excerpt, v.value)) return { value: v.value, note: null };
    const status = v?.status === "confirm" ? "confirm" : "checking";
    return { value: null, note: { status, field: claim.field, claimKey: claim.key, page: v?.page ?? claim.page, line: v?.line ?? claim.excerpt,
      candidates: v?.candidates ?? [claim.value], note: status === "confirm" ? NEEDS_CONFIRMATION : STILL_CHECKING } };
  };
  // claimsOf walks benefits then covers, value before cap: the same walk here pairs each claim with its row.
  out.benefits.forEach((b, at) => {
    const was = r.benefits[at];
    const notes: GuardNote[] = [];
    if (b.value != null) {
      const s = settle(next());
      if (s.note) { notes.push(s.note); b.value = null; b.pays = "words"; b.period = null; b.cap = null; b.capSource = null; b.baseAmount = null; b.baseSource = null; }
      else b.value = s.value;
    }
    if (was.cap != null && was.capSource) {
      const s = settle(next());
      if (b.cap != null) {
        if (s.note) { notes.push(s.note); b.cap = null; b.capSource = null; b.capUnread = true; }
        else b.cap = s.value;
      }
    }
    if (notes.length) (b as CheckedBenefit & Marked).figureCheck = notes;
  });
  for (const c of out.covers) {
    const notes: GuardNote[] = [];
    if (c.sumInsured != null) {
      const s = settle(next());
      if (s.note) { notes.push(s.note); c.sumInsured = null; } else c.sumInsured = s.value;
    }
    if (c.premium != null) {
      const s = settle(next());
      if (s.note) { notes.push(s.note); c.premium = null; c.premiumParts = null; c.firstYearPremium = null; } else c.premium = s.value;
    }
    if (notes.length) (c as CheckedCover & Marked).figureCheck = notes;
  }
  return out;
}
