/**
 * Round 16: the last verification every chat answer passes before it is saved
 * and shown (called from lib/chat/workflow.ts saveTurn, after the monetary
 * boundary, for EVERY answer path -- policy answers, registry / portfolio
 * totals, premiums, amendments, group cover, document and plain questions,
 * claim cards and completion, what-if replies, model-narrated and
 * conversational text).
 *
 * Paths that build structured assertions (lib/chat/policy-answer.ts) are
 * verified clause by clause in lib/chat/assertions.ts; claim turns have every
 * amount withheld by lib/chat/monetary-boundary.ts. Everything else composes
 * its own text, so here every money figure the household would read is
 * checked against the documents the answer cites:
 *
 *  - the figure is printed on a page of a cited document that is this
 *    household's, active and released (a superseded one only where the
 *    sentence says it is superseded), beside the same currency -- a figure
 *    printed in US$ is never accepted as S$, and a bare printed figure counts
 *    only under a heading that names the currency;
 *  - or it is derived from such figures stated in the same answer: a total
 *    of two or more of them in ONE currency, or a figure annualised /
 *    divided by period (x2, x4, x12, /12, /4, /2);
 *  - or the household wrote it in its own message.
 *
 * A sentence with a figure that is none of these is removed (never softened)
 * and the answer says that a figure was left out. A sentence that states
 * cover where the cited page says the opposite ("not covered", "excluded")
 * is removed the same way.
 */
import { query } from "@/lib/db/client";
import type { ChatAnswer } from "@/types";
import { amountPrintedWith, negated, normalPassage, printedFigures } from "./assertions";
import { currenciesStatedIn } from "@/lib/claims/currency-evidence";

export const FIGURE_LEFT_OUT_NOTE = "A figure that couldn’t be matched to the cited page of your documents was left out of this answer.";
export const CLAIM_LEFT_OUT_NOTE = "A statement that the cited page of your documents doesn’t support was left out of this answer.";

const FIGURE = /(?:\b(SGD|USD|MYR|HKD|AUD|EUR|GBP|JPY|PHP|CNY|IDR|THB|INR|KRW|NZD|CHF)\s?|\b(S|SG|US|HK|A|AU|NZ)\$\s?|(RM)\s?|([€£¥₱])\s?)(\d[\d,]*(?:\.\d+)?)(?:\s?(k|m|mil|million|thousand|bn|billion)\b)?|(\d[\d,]*(?:\.\d+)?)\s?(SGD|USD|MYR|HKD|AUD|EUR|GBP)\b/g;
const SYMBOL: Record<string, string> = { S: "SGD", SG: "SGD", US: "USD", HK: "HKD", A: "AUD", AU: "AUD", NZ: "NZD", RM: "MYR", "€": "EUR", "£": "GBP", "¥": "JPY", "₱": "PHP" };
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
export type StatedFigure = { raw: string; value: number; currency: string };
/** Every money figure a text states, with its currency. */
export function figuresIn(text: string): StatedFigure[] {
  const out: StatedFigure[] = [];
  for (const m of (text ?? "").matchAll(FIGURE)) {
    const currency = m[1] ?? (m[2] ? SYMBOL[m[2]] : m[3] ? SYMBOL[m[3]] : m[4] ? SYMBOL[m[4]] : m[8]);
    const digits = (m[5] ?? m[7] ?? "").replace(/,/g, "");
    const value = Number(digits) * (m[6] ? MULT[m[6].toLowerCase()] ?? 1 : 1);
    if (currency && Number.isFinite(value)) out.push({ raw: m[0], value, currency: currency.toUpperCase() });
  }
  return out;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const SAYS_SUPERSEDED = /\b(?:superseded|replaced|earlier|previous(?:ly)?|old(?:er)?|original(?:ly)?|former(?:ly)?|was|were|used to|before|no longer)\b/i;
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
const COVER_CLAIM = /^(?:(?:yes|good news)[,.!]?\s+)?(?:[\p{L}’' -]{2,60}?)\s+(?:is|are)\s+(not\s+)?covered\b/iu;

type Page = { policyId: string; page: number; text: string; current: boolean };

/** Loads the cited documents' pages that may ground a figure (this household's, active, released). */
async function citedPages(accountId: string, answer: ChatAnswer): Promise<Page[]> {
  const ids = new Set<string>();
  for (const c of answer.citations ?? []) if (c?.policyId) ids.add(c.policyId);
  for (const l of answer.policyStatedLimits ?? []) if (l?.citation?.policyId) ids.add(l.citation.policyId);
  if (!ids.size) return [];
  const rows = (await query<{ policy_id: string; page_number: number; text: string; superseded: boolean }>(
    `SELECT pp.policy_id::text AS policy_id, pp.page_number, pp.text, (p.superseded_at IS NOT NULL) AS superseded
       FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
      WHERE pp.account_id=$1 AND pp.policy_id::text=ANY($2::text[]) AND p.lifecycle_state='active'
        AND coalesce(p.quarantine_status,'') IN ('scan_clean','not_scanned_prototype')`, [accountId, [...ids]]).catch(() => ({ rows: [] }))).rows;
  return rows.map((r) => ({ policyId: r.policy_id, page: r.page_number, text: r.text ?? "", current: !r.superseded }));
}

/** Is `f` printed on one of `pages`, beside its own currency? */
function printed(f: StatedFigure, pages: Page[], sentence: string): boolean {
  const usable = pages.filter((p) => p.current || SAYS_SUPERSEDED.test(sentence));
  return usable.some((p) => {
    const how = amountPrintedWith(f.value, f.currency, p.text);
    return how === "match" || (how === "bare" && currenciesStatedIn(p.text).includes(f.currency));
  });
}

export type FigureProblem = { where: string; figure: string; sentence: string; reason: string };

/** Checks (and, unless `report`, repairs in place) every money figure and cover statement of an answer. */
export async function verifyAnswerFigures(answer: ChatAnswer, opts: { accountId: string; userText?: string; report?: boolean }): Promise<FigureProblem[]> {
  if (!answer || typeof answer !== "object") return [];
  const fields: { where: string; get: () => string; set: (v: string) => void }[] = [
    { where: "summary", get: () => answer.summary ?? "", set: (v) => { answer.summary = v; } },
    ...(answer.details ?? []).map((_, i) => ({ where: "details[" + i + "]", get: () => answer.details[i] ?? "", set: (v: string) => { answer.details[i] = v; } })),
    ...(answer.nextSteps ?? []).map((_, i) => ({ where: "nextSteps[" + i + "]", get: () => answer.nextSteps[i] ?? "", set: (v: string) => { answer.nextSteps[i] = v; } })),
    ...(answer.claimItems ?? []).map((_, i) => ({ where: "claim[" + i + "].reason", get: () => answer.claimItems[i]?.reason ?? "", set: (v: string) => { answer.claimItems[i].reason = v; } })),
  ];
  const all = fields.flatMap((f) => sentencesOf(f.get()).map((s) => ({ field: f, sentence: s, figures: figuresIn(s) })));
  const anyFigure = all.some((x) => x.figures.length);
  const anyCover = all.some((x) => COVER_CLAIM.test(x.sentence.trim()));
  if (!anyFigure && !anyCover && !answer.policyStatedLimits?.length) return [];
  const pages = await citedPages(opts.accountId, answer);
  if ((globalThis as { __dpVerifyDebug?: boolean }).__dpVerifyDebug) process.stderr.write("[figure-gate-debug] " + JSON.stringify({ cites: (answer.citations ?? []).map((c) => [c.policyName, c.policyId.slice(-4), c.pageStart]), pages: pages.map((p) => [p.policyId.slice(-4), p.page, p.current, p.text.length]) }) + "\n");
  const user = new Set((opts.userText ?? "").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g)?.map((n) => r2(Number(n))) ?? []);
  // Grounded figures (printed beside their currency on a cited page), then what is derived from them.
  const grounded = new Map<string, Set<number>>();
  const add = (cur: string, v: number) => { (grounded.get(cur) ?? grounded.set(cur, new Set()).get(cur)!).add(r2(v)); };
  for (const x of all) for (const f of x.figures) if (printed(f, pages, x.sentence)) add(f.currency, f.value);
  // A policy-stated limit stands only when its own cited page prints its amount beside its currency.
  const limitProblems: FigureProblem[] = [];
  if (answer.policyStatedLimits?.length) answer.policyStatedLimits = answer.policyStatedLimits.filter((l) => {
    const from = l.citation?.pageStart ?? 0, to = l.citation?.pageEnd ?? from;
    const own = pages.filter((p) => p.policyId === l.citation?.policyId && p.page >= from && p.page <= to);
    const ok = typeof l.amount === "number" && !!l.currency && printed({ raw: "", value: l.amount, currency: l.currency }, own, "");
    if (ok) add(l.currency, l.amount); else limitProblems.push({ where: "policyStatedLimits", figure: l.amountText, sentence: l.benefitTitle, reason: "the limit is not printed beside its currency on its cited page" });
    return ok || !!opts.report;
  });
  const pagePeriods = pages.filter((p) => p.current).flatMap((p) => printedFigures(p.text)).filter((x) => x.period === "month" || x.period === "year");
  const stated = new Map<string, number[]>();
  for (const x of all) for (const f of x.figures) (stated.get(f.currency) ?? stated.set(f.currency, []).get(f.currency)!).push(r2(f.value));
  // "3 × S$298.00": a grounded figure counted several times is one part of a total.
  const multiples: { currency: string; base: number; times: number }[] = [];
  for (const x of all) for (const m of x.sentence.matchAll(/\b(\d{1,2})\s*[×x]\s*/g)) {
    const rest = x.sentence.slice(m.index! + m[0].length), f = figuresIn(rest)[0];
    if (f && rest.trimStart().startsWith(f.raw.trim())) multiples.push({ currency: f.currency, base: r2(f.value), times: Number(m[1]) });
  }
  const derivedOk = (f: StatedFigure, sentence: string) => {
    const g = grounded.get(f.currency); if (!g?.size) return false;
    const v = r2(f.value);
    // A figure restated per period: monthly <-> yearly (x12), quarterly (x4), half-yearly (x2) -- only where the sentence says so.
    const periods = [/\bmonth/i.test(sentence) ? 12 : 0, /\bquarter/i.test(sentence) ? 4 : 0, /\bhalf[- ]?year/i.test(sentence) ? 2 : 0].filter(Boolean);
    for (const k of periods) for (const b of g) if (r2(b * k) === v || r2(b / k) === v || Math.round(b / k) === v) return true;
    // A premium the cited page prints per month, stated per year (x12), or one it prints per year, stated per month.
    const yearly = /\b(?:a|per|each|every)\s+year\b|\bannual|\byearly\b|\bp\.\s?a\./i.test(sentence);
    for (const p of pagePeriods) if (p.currency === f.currency && ((yearly && p.period === "month" && r2(p.value * 12) === v) || (/\bmonth/i.test(sentence) && p.period === "year" && (r2(p.value / 12) === v || Math.round(p.value / 12) === v)))) return true;
    const monthly = /\bmonth/i.test(sentence);
    // A total of two or more grounded figures stated in this answer, in this one currency.
    const parts = [...(stated.get(f.currency) ?? []).filter((n) => g.has(n) && n !== v),
      ...multiples.filter((m) => m.currency === f.currency && g.has(m.base)).map((m) => r2(m.base * (m.times - 1)))].slice(0, 16);
    const n = parts.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      if ((mask & (mask - 1)) === 0) continue;
      let sum = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) sum += parts[i];
      if (r2(sum) === v || (monthly && (r2(sum / 12) === v || Math.round(sum / 12) === v))) return true;
    }
    return false;
  };
  // Derived figures can ground further ones (a monthly figure of a total): two passes.
  for (let pass = 0; pass < 2; pass++) for (const x of all) for (const f of x.figures) if (!grounded.get(f.currency)?.has(r2(f.value)) && derivedOk(f, x.sentence)) add(f.currency, f.value);
  const problems: FigureProblem[] = [...limitProblems];
  const drop = new Map<typeof fields[number], Set<string>>();
  const bad = (x: typeof all[number], figure: string, reason: string) => { problems.push({ where: x.field.where, figure, sentence: x.sentence, reason }); (drop.get(x.field) ?? drop.set(x.field, new Set()).get(x.field)!).add(x.sentence); };
  for (const x of all) {
    for (const f of x.figures) {
      if (user.has(r2(f.value))) continue;
      if (grounded.get(f.currency)?.has(r2(f.value))) continue;
      bad(x, f.raw, !pages.length ? "a figure with no cited document" : "the figure is not printed beside its currency on a cited page");
      break;
    }
    // A cover statement the cited page contradicts ("X is covered" where it prints "X is not covered").
    const m = COVER_CLAIM.exec(x.sentence.trim());
    if (m && pages.length) {
      const subject = normalPassage(x.sentence.trim().split(/\s+(?:is|are)\s+(?:not\s+)?covered\b/i)[0]).replace(/^(?:yes|good news)[,.!]?\s+/, "");
      const words = subject.match(/[a-z]{4,}/g) ?? [];
      if (words.length) {
        const clauses = pages.filter((p) => p.current).flatMap((p) => p.text.split(/\n+|(?<=[.;])\s+/)).filter((c) => words.every((w) => normalPassage(c).includes(w)) && /\bcover|\bexclu|\bpay/i.test(c));
        const neg = !!m[1];
        if (clauses.length && clauses.every((c) => negated(c) !== neg)) bad(x, subject, "the cited page says the opposite");
      }
    }
  }
  if (opts.report || !problems.length) return problems;
  for (const [field, sentences] of drop) {
    const kept = sentencesOf(field.get()).filter((s) => !sentences.has(s)).join(" ").trim();
    field.set(kept);
  }
  answer.details = (answer.details ?? []).filter((d) => d && d.trim());
  answer.nextSteps = (answer.nextSteps ?? []).filter((d) => d && d.trim());
  const note = problems.some((p) => p.reason === "the cited page says the opposite") && problems.every((p) => p.reason === "the cited page says the opposite") ? CLAIM_LEFT_OUT_NOTE : FIGURE_LEFT_OUT_NOTE;
  if (!answer.summary.trim()) answer.summary = note;
  else if (!answer.details.includes(note)) answer.details.push(note);
  return problems;
}
