/**
 * Agent K: what a benefit's own stored wording says about how it is calculated -- the day-count rule, a waiting
 * (excess) period, a minimum stay, a day cap, benefit-specific exclusions, and the order of deductions -- each with
 * the verbatim passage (an EvidenceRef on the stored page of the version read). Read from the household's readable
 * pages only (lib/rag2/store.ts). Nothing is defaulted: what the wording does not state is reported as not stated.
 */
import { dayRuleFromWording, type PolicyDayRule } from "@/lib/claims/day-count";
import { evidenceFor, type EvidenceRef } from "../evidence";
import { loadDocs, pageMap } from "../store";

export type Term<T> = { value: T; words: string; evidence: EvidenceRef };
export type BenefitTerms = {
  policyId: string; documentHash: string | null; productName: string | null;
  dayRule: Term<PolicyDayRule> | null;
  /** Two passages stating different day-count rules (never resolved by picking one). */
  dayRuleConflict: EvidenceRef[];
  waitingDays: Term<number> | null;
  minimumStayHours: Term<number> | null;
  dayCap: Term<number> | null;
  exclusions: Term<string>[];
  /** "deductible applies before co-insurance" style wording. */
  deductionOrder: Term<"deductible_first" | "co_insurance_first"> | null;
};

const GENERIC = new Set(["benefit", "benefits", "limit", "amount", "cover", "payable", "maximum", "per", "day", "days", "each", "the", "and", "for", "policy", "year", "plan", "insured", "under", "with", "from", "sum"]);
const words = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !GENERIC.has(w));
const stem = (w: string) => w.replace(/(?:ies|es|s)$/, "");

/** The sentences of a page (a table row is one sentence), with their offsets. */
function sentencesOfPage(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
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
const CO_FIRST = /\bco-?insurance\b[^.]{0,80}\b(?:before|then)\b[^.]{0,40}\bdeductible\b|\bdeductible\b[^.]{0,60}\bafter\b[^.]{0,30}\bco-?insurance\b/i;

export async function readBenefitTerms(args: { accountId: string; policyId: string; benefit: string; subjectId: string; rowLabel?: string | null }): Promise<BenefitTerms | null> {
  const doc = (await loadDocs(args.accountId, [args.policyId]))[0];
  if (!doc) return null;
  const pages = await pageMap(args.accountId, args.policyId);
  const want = [...new Set(words(args.benefit).map(stem))];
  const terms: BenefitTerms = { policyId: doc.id, documentHash: doc.fileHash, productName: doc.productName, dayRule: null, dayRuleConflict: [], waitingDays: null, minimumStayHours: null, dayCap: null, exclusions: [], deductionOrder: null };
  const ev = (page: number, text: string, start: number) => evidenceFor({ policyId: doc.id, documentHash: doc.fileHash, page, pageText: pages.get(page) ?? "", passage: text, near: start, subjectId: args.subjectId });
  const rules: Term<PolicyDayRule>[] = [];
  for (const [page, text] of [...pages].sort((a, b) => a[0] - b[0])) {
    for (const s of sentencesOfPage(text)) {
      const own = new Set(words(s.text).map(stem));
      const about = want.length > 0 && want.every((w) => own.has(w) || [...own].some((o) => o.startsWith(w) || w.startsWith(o)));
      const isRow = !!args.rowLabel && s.text.startsWith(args.rowLabel.trim().slice(0, 24));
      if (!about && !isRow) {
        // Deduction order is a plan-level statement (it names the deductible and co-insurance, not the benefit).
        const d = DED_FIRST.test(s.text) ? "deductible_first" : CO_FIRST.test(s.text) ? "co_insurance_first" : null;
        if (d && !terms.deductionOrder) { const e = ev(page, s.text, s.start); if (e) terms.deductionOrder = { value: d, words: s.text, evidence: e }; }
        continue;
      }
      const e = ev(page, s.text, s.start);
      if (!e) continue;
      const r = dayRuleFromWording(s.text);
      if (r) rules.push({ value: r.rule, words: r.words, evidence: e });
      const w = WAITING.exec(s.text);
      if (w && !terms.waitingDays) { const n = w[1] ?? w[2] ?? (w[3] ? String(Number(w[3]) - 1) : null); if (n != null) terms.waitingDays = { value: Number(n), words: w[0], evidence: e }; }
      const m = MIN_STAY.exec(s.text);
      if (m && !terms.minimumStayHours) terms.minimumStayHours = { value: Number(m[1]), words: m[0], evidence: e };
      const c = DAY_CAP.exec(s.text);
      if (c && !terms.dayCap) terms.dayCap = { value: Number(c[1] ?? c[2] ?? c[3]), words: c[0], evidence: e };
      if (EXCLUSION.test(s.text)) terms.exclusions.push({ value: s.text, words: s.text, evidence: e });
      const d = DED_FIRST.test(s.text) ? "deductible_first" : CO_FIRST.test(s.text) ? "co_insurance_first" : null;
      if (d && !terms.deductionOrder) terms.deductionOrder = { value: d, words: s.text, evidence: e };
    }
  }
  const distinct = new Set(rules.map((r) => r.value));
  if (distinct.size === 1) terms.dayRule = rules[0];
  else if (distinct.size > 1) terms.dayRuleConflict = rules.map((r) => r.evidence);
  return terms;
}
