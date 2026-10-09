/**
 * Agent K: what a benefit's own stored wording says about how it is calculated -- the day-count rule, a waiting
 * (excess) period, a minimum stay, a day cap, benefit-specific exclusions, and the order of deductions -- each with
 * the verbatim passage (an EvidenceRef on the stored page of the version read). Read from the household's readable
 * pages only (lib/rag2/store.ts). Nothing is defaulted: what the wording does not state is reported as not stated.
 */
import { dayEdgeExceptionsFromWording, dayRuleFromWording, remainderHoursIn, type DayEdgeException, type PolicyDayRule } from "@/lib/claims/day-count";
import { evidenceFor, type EvidenceRef } from "../evidence";
import { loadDocs, pageMap } from "../store";

export type Term<T> = { value: T; words: string; evidence: EvidenceRef };
export type BenefitTerms = {
  policyId: string; documentHash: string | null; productName: string | null;
  /** V1: remainderHours for completed_24h_remainder (the remaining hours that count as one more day). */
  dayRule: (Term<PolicyDayRule> & { remainderHours?: number }) | null;
  /** Two passages stating different day-count rules (never resolved by picking one). */
  dayRuleConflict: EvidenceRef[];
  waitingDays: Term<number> | null;
  minimumStayHours: Term<number> | null;
  dayCap: Term<number> | null;
  exclusions: Term<string>[];
  /** "deductible applies before co-insurance" style wording. */
  deductionOrder: Term<"deductible_first" | "co_insurance_first"> | null;
  /** Integration (D28): where the excess / deductible is taken relative to the benefit's limit, as the wording states
   * it ("the Excess is then deducted ... after the limit per accident has been applied"). Null when not stated. */
  limitOrder: Term<"limit_first" | "deductible_first"> | null;
  /** Two passages stating opposite orders (never resolved by picking one). */
  limitOrderConflict: EvidenceRef[];
  /** Integration (D30): admission / discharge day exceptions of the day-count rule, each with its passage. */
  dayEdges: Term<DayEdgeException>[];
};

const GENERIC = new Set(["benefit", "benefits", "limit", "amount", "cover", "payable", "maximum", "per", "day", "days", "each", "the", "and", "for", "policy", "year", "plan", "insured", "under", "with", "from", "sum"]);
const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !GENERIC.has(w));
const stem = (w: string) => w.replace(/(?:ies|es|s)$/, "");

/** The sentences of a page (a table row is one sentence), with their offsets. */
function sentencesOfPage(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let at = 0;
  // V1: a line that continues a sentence (the next line starts in lower case) is read with it; offsets are unchanged.
  for (const line of text.replace(/\n(?=[a-z])/g, " ").split("\n")) {
    const re = /[^.;]+(?:[.;]|$)/g;
    for (const m of line.matchAll(re)) { const t = m[0].trim(); if (t.length >= 6) out.push({ text: t, start: at + m.index! + m[0].indexOf(t) }); }
    at += line.length + 1;
  }
  return out;
}

const WAITING = /\b(?:after|following|excluding)\s+the\s+first\s+(\d{1,3})\s+(?:days?|nights?)\b|\b(?:excess|waiting|deferment|deferred|qualifying)\s+period\s+of\s+(\d{1,3})\s+days?\b|\bfrom\s+the\s+(\d{1,3})(?:st|nd|rd|th)\s+day\b/i;
const MIN_STAY = /\b(?:minimum|at\s+least)\s+(?:of\s+)?(\d{1,3})\s+(?:consecutive\s+|continuous\s+)?hours?\b/i;
const DAY_CAP = /\bmax(?:imum)?\.?\s+(?:of\s+)?(\d{1,4})\s+days?\b|\bup\s+to\s+(\d{1,4})\s+days?\b|\b(\d{1,4})\s+days?\s+(?:maximum|max)\b/i;
const EXCLUSION = /\b(?:not\s+payable|is\s+not\s+covered|are\s+not\s+covered|excluded|does\s+not\s+(?:pay|cover|apply))\b/i;
const DED_FIRST = /\bdeductible\b[^.]{0,80}\b(?:before|then)\b[^.]{0,40}\bco-?insurance\b|\bco-?insurance\b[^.]{0,60}\b(?:after|on\s+the\s+(?:amount|balance)\s+(?:above|after|exceeding))\b[^.]{0,30}\bdeductible\b/i;
const DED_WORD = String.raw`(?:excess|deductible)`, LIM_WORD = String.raw`(?:limit|maximum|sum insured|cap)`;
/** The excess / deductible is taken from what is left after the limit. */
const LIMIT_FIRST = new RegExp([
  String.raw`\b${DED_WORD}\b[^.]{0,80}\b(?:deducted|applied|taken|subtracted)\b[^.]{0,80}\bafter\b[^.]{0,60}\b${LIM_WORD}\b`,
  String.raw`\b${LIM_WORD}\b[^.]{0,60}\b(?:is\s+)?(?:applied|taken)\s+(?:first|before)\b[^.]{0,60}\b${DED_WORD}\b`,
  String.raw`\b${DED_WORD}\b[^.]{0,40}\b(?:from|on)\s+the\s+(?:amount|benefit)\s+(?:payable\s+)?after\s+the\s+${LIM_WORD}\b`,
].join("|"), "i");
/** The limit applies to what is left after the excess / deductible. */
const DEDUCTIBLE_FIRST_OF_LIMIT = new RegExp([
  String.raw`\b${DED_WORD}\b[^.]{0,80}\b(?:deducted|applied|taken|subtracted)\b[^.]{0,40}\b(?:first|before)\b[^.]{0,60}\b${LIM_WORD}\b`,
  String.raw`\b${LIM_WORD}\b[^.]{0,60}\bappl(?:y|ies)\b[^.]{0,40}\bafter\b[^.]{0,40}\b${DED_WORD}\b`,
  String.raw`\b${LIM_WORD}\b[^.]{0,60}\b(?:net\s+of|less)\s+the\s+${DED_WORD}\b`,
].join("|"), "i");
const CO_FIRST = /\bco-?insurance\b[^.]{0,80}\b(?:before|then)\b[^.]{0,40}\bdeductible\b|\bdeductible\b[^.]{0,60}\bafter\b[^.]{0,30}\bco-?insurance\b/i;

export async function readBenefitTerms(args: { accountId: string; policyId: string; benefit: string; subjectId: string; rowLabel?: string | null }): Promise<BenefitTerms | null> {
  const doc = (await loadDocs(args.accountId, [args.policyId]))[0];
  if (!doc) return null;
  const pages = await pageMap(args.accountId, args.policyId);
  const want = [...new Set(words(args.benefit).map(stem))];
  const terms: BenefitTerms = { policyId: doc.id, documentHash: doc.fileHash, productName: doc.productName, dayRule: null, dayRuleConflict: [], waitingDays: null, minimumStayHours: null, dayCap: null, exclusions: [], deductionOrder: null, limitOrder: null, limitOrderConflict: [], dayEdges: [] };
  const ev = (page: number, text: string, start: number) => evidenceFor({ policyId: doc.id, documentHash: doc.fileHash, page, pageText: pages.get(page) ?? "", passage: text, near: start, subjectId: args.subjectId });
  type RuleTerm = Term<PolicyDayRule> & { remainderHours?: number };
  const rules: RuleTerm[] = [];
  /** V1: a day-count rule stated at plan level (a clause that names no benefit: "How days of confinement are counted"),
   * used only when no wording of this benefit states one. */
  const planRules: RuleTerm[] = [];
  let prev: { page: number; start: number; list: RuleTerm[]; idx: number } | null = null;
  /** A remainder clause ("Any remaining period of 12 hours or more counts as one further day") read together with the
   * complete-24-hours sentence right before it, as one passage. */
  const noteRule = (page: number, s: { text: string; start: number }, list: RuleTerm[], e: EvidenceRef | null): void => {
    const text = pages.get(page) ?? "";
    const r = dayRuleFromWording(s.text);
    if (!r && remainderHoursIn(s.text) != null && prev && prev.page === page && prev.list[prev.idx]?.value === "completed_24h") {
      const joined = text.slice(prev.start, s.start + s.text.length);
      const r2 = dayRuleFromWording(joined);
      const e2 = r2 ? ev(page, joined, prev.start) : null;
      if (r2 && e2) { prev.list[prev.idx] = { value: r2.rule, words: r2.words, evidence: e2, ...(r2.remainderHours ? { remainderHours: r2.remainderHours } : {}) }; prev = null; return; }
    }
    if (r && e) { list.push({ value: r.rule, words: r.words, evidence: e, ...(r.remainderHours ? { remainderHours: r.remainderHours } : {}) }); prev = { page, start: s.start, list, idx: list.length - 1 }; return; }
    prev = null;
  };
  const limitOrders: Term<"limit_first" | "deductible_first">[] = [];
  const noteEdges = (page: number, s: { text: string; start: number }) => {
    for (const x of dayEdgeExceptionsFromWording(s.text)) {
      if (terms.dayEdges.some((d) => d.value.edge === x.edge)) continue;
      const e = ev(page, s.text, s.start); if (e) terms.dayEdges.push({ value: x, words: s.text, evidence: e });
    }
  };
  const noteLimitOrder = (page: number, s: { text: string; start: number }) => {
    const lf = LIMIT_FIRST.test(s.text), df = DEDUCTIBLE_FIRST_OF_LIMIT.test(s.text);
    if (lf === df) return; // neither, or both in one sentence (ambiguous): not a statement of the order
    const e = ev(page, s.text, s.start); if (e) limitOrders.push({ value: lf ? "limit_first" : "deductible_first", words: s.text, evidence: e });
  };
  for (const [page, text] of [...pages].sort((a, b) => a[0] - b[0])) {
    for (const s of sentencesOfPage(text)) {
      const own = new Set(words(s.text).map(stem));
      const about = want.length > 0 && want.every((w) => own.has(w) || [...own].some((o) => o.startsWith(w) || w.startsWith(o)));
      const isRow = !!args.rowLabel && s.text.startsWith(args.rowLabel.trim().slice(0, 24));
      if (!about && !isRow) {
        // Deduction order is a plan-level statement (it names the deductible and co-insurance, not the benefit).
        const d = DED_FIRST.test(s.text) ? "deductible_first" : CO_FIRST.test(s.text) ? "co_insurance_first" : null;
        if (d && !terms.deductionOrder) { const e = ev(page, s.text, s.start); if (e) terms.deductionOrder = { value: d, words: s.text, evidence: e }; }
        // A plan-level statement of the order of the excess and the limit counts only when it names no other benefit.
        if (!/\bbenefit\b|\breimbursement\b|\bcash\b|\bincome\b/i.test(s.text)) { noteLimitOrder(page, s); noteEdges(page, s); noteRule(page, s, planRules, dayRuleFromWording(s.text) ? ev(page, s.text, s.start) : null); }
        else prev = null;
        continue;
      }
      const e = ev(page, s.text, s.start);
      if (!e) continue;
      noteRule(page, s, rules, e);
      const w = WAITING.exec(s.text);
      if (w && !terms.waitingDays) { const n = w[1] ?? w[2] ?? (w[3] ? String(Number(w[3]) - 1) : null); if (n != null) terms.waitingDays = { value: Number(n), words: w[0], evidence: e }; }
      const m = MIN_STAY.exec(s.text);
      if (m && !terms.minimumStayHours) terms.minimumStayHours = { value: Number(m[1]), words: m[0], evidence: e };
      const c = DAY_CAP.exec(s.text);
      if (c && !terms.dayCap) terms.dayCap = { value: Number(c[1] ?? c[2] ?? c[3]), words: c[0], evidence: e };
      if (EXCLUSION.test(s.text)) terms.exclusions.push({ value: s.text, words: s.text, evidence: e });
      const d = DED_FIRST.test(s.text) ? "deductible_first" : CO_FIRST.test(s.text) ? "co_insurance_first" : null;
      if (d && !terms.deductionOrder) terms.deductionOrder = { value: d, words: s.text, evidence: e };
      noteLimitOrder(page, s);
      noteEdges(page, s);
    }
  }
  const orders = new Set(limitOrders.map((o) => o.value));
  if (orders.size === 1) terms.limitOrder = limitOrders[0];
  else if (orders.size > 1) terms.limitOrderConflict = limitOrders.map((o) => o.evidence);
  const use = rules.length ? rules : planRules;
  const distinct = new Set(use.map((r) => r.value + "|" + (r.remainderHours ?? "")));
  if (distinct.size === 1) terms.dayRule = use[0];
  else if (distinct.size > 1) terms.dayRuleConflict = use.map((r) => r.evidence);
  return terms;
}
