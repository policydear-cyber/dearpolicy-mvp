import { PRINTED_FIGURE, FIGURE_END, printedNumber, groupsInLakhs } from "@/lib/format/printed-number";

/**
 * Is the amount on a schedule line a benefit's sum, or something else the line prints beside a cover's name?
 *
 * A schedule prints more than sums: "Life Cover Premium A$1,200", "TPD Premium Waiver S$3,000", "Life Insurance Fund Value
 * RM45,000", "Deductible S$3,500". Intake files such a line under the cover its words name (lib/insurance.ts
 * normalizeCoverageCategory: "TPD Premium Waiver" is stored as Total Permanent Disability), so its stored category says
 * nothing; only the words the line prints before its figure (policy_coverages.evidence_text) do.
 *
 * Only the label's HEAD decides: the noun phrase directly before the stored amount's figure. Bracketed text, qualifiers
 * ("in excess of S$500", "after deductible", "including service charges", "ohne Selbstbeteiligung", "in addition to the
 * cash value") and dates or ages ("as at 30 Sep 2026", "at age 65") never decide. A line is no benefit sum only when a
 * premium, waiver, fund/surrender/cash value, policy loan, policy fee, tax or the person's own share of a bill ENDS that
 * head ("Term Life Premium", "Fund Value", "Deductible", "Co-insurance cap"). A cover word after it keeps the line ("Excess
 * Waiver Benefit", "Car Rental Excess Cover", "Return of Premium Benefit"), and so does a sum named as an alternative ("higher
 * of sum assured or fund value"). Anything doubtful stays a sum: a figure that stands on its own after a comma ("Hospital &
 * Surgical, 10% co-insurance, up to S$1,000,000"), a line whose stored figure is not printed, a line with no label.
 * Read at read time, so a line already stored this way is left out without a re-read, and nothing is deleted.
 *
 * A closed list in English, Malay, Indonesian, French, German and Chinese.
 */
const NOT_A_SUM_TERM = [
  // A premium or contribution the person pays (Takaful "contribution", Malay "caruman", French "cotisation").
  String.raw`\bpremi(?:um|ums|a)?`, String.raw`\bcontributions?`, String.raw`\bcaruman`, String.raw`\biuran`, String.raw`\bcotisations?`,
  String.raw`\bprimes?\s+(?:annuelle|mensuelle|totale|d['’]assurance|nette|brute)`, String.raw`prämie`, String.raw`\bbeitr[aä]g\w*`, "保费", "保費",
  // A waiver of premium: what is waived is a premium, never the cover's sum.
  String.raw`\bwaiver`,
  // A value the policy holds, not a sum it pays on a claim.
  String.raw`\b(?:fund|surrender|cash|account|policy|cash[\s-]in|transfer|units?|bid|investment)\s+values?`,
  String.raw`\bnilai\s+(?:tunai|serahan|dana|akaun|penyerahan)`, String.raw`\bvaleur\s+de\s+rachat`, String.raw`r[uü]ckkaufswert`, "现金价值", "現金價值", "退保金",
  // A loan against the policy, or a fee or tax charged on it.
  String.raw`\bpolicy\s+loans?(?:\s+(?:outstanding|balance|interest))?`, String.raw`\bloans?\s+(?:outstanding|balance|interest)`, String.raw`\bpinjaman\s+polisi`,
  String.raw`\b(?:policy|admin(?:istration)?|surrender|management|service|processing)\s+(?:fees?|charges?)`, String.raw`\bstamp\s+duty`,
  String.raw`\b(?:gst|vat|sst)`, String.raw`\blev(?:y|ies)`,
  // The person's own share of a bill.
  String.raw`\bdeductibles?`, String.raw`\bdeduktibel`, String.raw`\bexcess`, String.raw`\bco-?(?:payments?|pay|insurance)`, String.raw`\brisiko\s+sendiri`,
  String.raw`\bfranchise`, String.raw`selbstbeteiligung`, String.raw`selbstbehalt`,
];
/** Words that may follow the term and still leave it the head's end ("Premium payable", "Co-insurance cap", "Prime annuelle"). */
const TRAILER = String.raw`(?:\s+(?:amount|payable|due|cap|max(?:imum)?|outstanding|total|p\.?\s?a\.?|yearly|annual(?:ly)?|monthly|quarterly|tahunan|bulanan|annuelle|mensuelle|jährlich))*`;
const ENDS_NOT_A_SUM = new RegExp("(?:" + NOT_A_SUM_TERM.join("|") + ")" + TRAILER + "$", "iu");
/** A cover that pays the person's excess or a rental car's excess: a benefit, though its head ends in "excess". */
const EXCESS_COVER = /\b(?:rental\s+(?:vehicle|car)|car\s+rental|vehicle|motor|car|hire\s+car)\s+excess\b/i;
/** A payout of the premiums paid back ("Return of Premium S$20,000", "Pengembalian premi"): a sum the policy pays. */
const RETURN_OF_PREMIUM = /\breturn\s+of\s+(?:premiums?|contributions?)\b|\bpremiums?\s+refund\b|\bpengembalian\s+(?:premi|kontribusi)\b|\bpemulangan\s+(?:premium|caruman|sumbangan)\b|\bremboursement\s+des\s+primes\b|\bBeitragsr[uü]ckgew[aä]hr\b|退还保费|返还保费/iu;
/** A sum or benefit named as one alternative ("…or Sum Assured", "higher of sum assured or fund value"). */
const NAMES_A_SUM = /\bsum\s+(?:assured|insured|covered|at\s+risk)\b|\bbenefits?\b|\blimits?\b|\bcover(?:ed|age)?\b|\bmanfaat\b|\bsantunan\b|\bpertanggungan\b|\bcapital\b|\bplafond\b|leistung|保额|保額|保障/iu;
const CURRENCY_AT_END = /(?:[A-Z]{1,3}\$|R\$|Rp\.?|RM|€|£|¥|₹|₩|₱|฿|₫|Fr\.|kr\.?|\$|\b(?:SGD|MYR|USD|EUR|GBP|IDR|HKD|AUD|NZD|INR|CHF|JPY|CNY|RMB|THB|PHP|VND|KRW|TWD|AED|SAR|QAR|BHD|KWD|OMR|CAD|ZAR))\s*$/u;
const LINK_AT_END = /\s*(?:\b(?:up\s+to|capped\s+at|max(?:imum)?(?:\s+of)?|limited\s+to|of|is|at|sebanyak|sehingga|hingga|jusqu['’]à|bis\s+zu)\b|[=:])\s*$/iu;
const QUALIFIER = /(?:^|\s+)(?:in\s+addition\s+to|including|inclusive\s+of|incl\.?|in\s+excess\s+of|after|without|excluding|excl\.?|net\s+of|less|on\s+top\s+of|ohne|mit|sans|avec|termasuk|tidak\s+termasuk|selepas|setelah|tanpa|不含|包括|含)(?=\s|$).*$/iu;
const WHEN = /\s+(?:as\s+(?:at|of)|at|on|per|for|pada|au|am|zum)\s+.*$/iu;

/** A space-grouped figure ("1 200 €", "€150 000", "CHF 12 500,50") read only with a currency printed right beside it. */
function spaceGrouped(raw: string, before: string, after: string): number | null {
  const m = /^(\d{1,3}(?:[   ]\d{3})+)(?:,(\d{1,2}))?$/.exec(raw);
  if (!m) return null;
  const sign = /(?:€|£|¥|₹|\$|\b[A-Z]{3})\s?$/u.test(before) || /^\s?(?:€|£|¥|₹|\b[A-Z]{3}\b)/u.test(after);
  return sign ? Number(m[1].replace(/\D/g, "") + (m[2] ? "." + m[2] : "")) : null;
}

/** The words a line prints before the stored amount's own figure, back to the start of its row. "" when the figure is not printed. */
export function lineLabel(evidenceText: string | null | undefined, amount: number | null | undefined): string {
  const text = String(evidenceText ?? "");
  if (!text.trim() || amount == null) return "";
  const lakh = groupsInLakhs(text);
  const at = [...text.matchAll(new RegExp("(?<![\\d.,'’])" + PRINTED_FIGURE + FIGURE_END, "g"))]
    .find((m) => (printedNumber(m[0], null, { lakh }) ?? spaceGrouped(m[0], text.slice(0, m.index), text.slice(m.index! + m[0].length))) === amount);
  if (!at) return "";
  const before = text.slice(0, at.index);
  // The label runs back to the start of its own line or row, never into the row before ("…S$500,000\nPremium S$1,200").
  const start = Math.max(before.lastIndexOf("\n"), before.lastIndexOf(";"), before.lastIndexOf("|"));
  return before.slice(start + 1).trim();
}

/** The label with brackets, the currency and linking words before the figure taken off. */
function trimmedLabel(label: string): string {
  // Brackets, also the full-width ones Chinese and Japanese schedules print ("身故保险金（保费豁免除外）").
  let s = label.replace(/\([^()]*\)|\[[^\[\]]*\]|（[^（）]*）|［[^［］]*］|【[^【】]*】/gu, " ").replace(/\s+/g, " ").trim();
  s = s.replace(CURRENCY_AT_END, "").trim();
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(LINK_AT_END, "").trim(); }
  return s;
}

/** The noun phrase directly before the figure (see above), or "" when the figure stands on its own. */
export function labelHead(label: string): string {
  let s = trimmedLabel(label);
  // A figure after a comma stands on its own: the comma ends the phrase before it ("Hospital & Surgical, 10% co-insurance, up to").
  if (/[,;]$/.test(s) || !s) return "";
  // Qualifiers and dates never decide ("Annual limit after deductible", "Fund value as at 30 Sep 2026").
  s = s.replace(QUALIFIER, "").replace(WHEN, "").replace(/[\s,:;—–\/-]+$/u, "").trim();
  // The last clause: after the last separator, or after an earlier figure on the same row ("Life Cover S$500,000 Premium").
  const clauses = s.split(/\s*[,:;—–\/]\s*|\s+-\s+|\s*(?:[A-Z]{1,3}\$|RM|Rp\.?|€|£)?\s?\d[\d.,'’ ]*\s?(?:%|€|£)?\s+/u);
  return (clauses.pop() ?? "").trim();
}

/**
 * A premium, waiver, contribution, value or share word INSIDE the head, with a cover word after it ("Waiver of premium
 * benefit", "Premium waiver cover", "Fund value benefit", "Excess Waiver Benefit"): the figure may be the premium it waives
 * or the value it holds, so the line stays but its amount is withheld. A plan tier ("Premium Plan", "Premium ward",
 * "Contribution Takaful Plan") is a product's name, not a premium. Loans and fees decide only at the head's end, since a
 * mortgage cover's sum is the "outstanding loan balance covered".
 */
const HOLDS_NOT_A_SUM = new RegExp([
  String.raw`\bpremi(?:um|ums|a)?\b(?!\s+(?:plans?|tiers?|class|wards?|rooms?|edition|option|package|series|shield|saver|select|gold|platinum|version)\b)`,
  String.raw`\bcontributions?\b(?!\s+(?:takaful|plans?)\b)`, String.raw`\bcaruman\b|\biuran\b|\bcotisations?\b|prämie|\bbeitr[aä]g|保费|保費`,
  String.raw`\bwaiver\b|\bpayor\b|\bpayer\s+benefit\b`,
  String.raw`\b(?:fund|surrender|cash|account|policy|units?|investment)\s+values?\b|\bnilai\s+(?:tunai|serahan|dana|akaun|penyerahan)\b|\bvaleur\s+de\s+rachat\b|r[uü]ckkaufswert|现金价值|現金價值`,
  String.raw`\bdeductibles?\b|\bexcess\b|\bco-?(?:payments?|pay|insurance)\b|\bfranchise\b|selbstbeteiligung|selbstbehalt`,
].join("|"), "iu");
/** A value term, then "of the policy/plan" ("Surrender value of the policy"): still the value. */
const OF_THE_POLICY = /\s+of\s+(?:the|this|your)\s+(?:policy|plan|contract|certificate)$/i;

export type BenefitSumKind = "sum" | "not_a_sum" | "withhold";

/**
 * "not_a_sum": the line's own label names a premium, waiver, value, loan, fee, tax or share, so it is no cover at all.
 * "withhold": the line is a cover, but its figure may be something else (see HOLDS_NOT_A_SUM), so it shows no figure.
 * "sum": the figure is the cover's sum. Anything doubtful is kept as a cover, never dropped on a guess.
 */
export function benefitSumKind(line: { evidenceText?: string | null; amount?: number | null }): BenefitSumKind {
  const label = lineLabel(line.evidenceText, line.amount ?? null);
  if (!label) return "sum";
  const head = labelHead(label);
  if (!head) {
    // A figure on its own after a comma belongs to the row's first words: a share or premium named there withholds it
    // ("Co-insurance 10%, capped at S$3,000"); a cover named there keeps it ("Hospital & Surgical, 10% co-insurance, up to").
    const first = trimmedLabel(label).split(/\s*[,;:—–]\s*/u)[0] ?? "";
    return new RegExp("^(?:" + HOLDS_NOT_A_SUM.source + ")", "iu").test(first.trim()) ? "withhold" : "sum";
  }
  if (EXCESS_COVER.test(head) || RETURN_OF_PREMIUM.test(head)) return "sum";
  const alternatives = head.split(/\s+(?:or|atau|ou|oder)\s+|或/iu);
  const last = (alternatives.pop() ?? "").replace(/[.\s]+$/, "").replace(OF_THE_POLICY, "");
  const ends = ENDS_NOT_A_SUM.test(last);
  // A sum named as the other choice ("higher of sum assured or fund value"): the cover stays, the figure is withheld.
  if (alternatives.some((a) => NAMES_A_SUM.test(a))) return ends || HOLDS_NOT_A_SUM.test(last) ? "withhold" : "sum";
  if (ends) return "not_a_sum";
  return HOLDS_NOT_A_SUM.test(last) ? "withhold" : "sum";
}

/** True when the line is no cover at all (see benefitSumKind). */
export function notABenefitSum(line: { evidenceText?: string | null; amount?: number | null }): boolean {
  return benefitSumKind(line) === "not_a_sum";
}

/**
 * For a reader of stored lines: null when the line is no cover (leave it out), else the line with its amount withheld
 * when the figure may not be the cover's sum. The amount keeps the reader's own type (text from SQL, or a number).
 */
export function asBenefitLine<T extends { amount: string | number | null }>(row: T, evidenceText: string | null | undefined): T | null {
  const kind = benefitSumKind({ evidenceText, amount: row.amount == null ? null : Number(row.amount) });
  if (kind === "not_a_sum") return null;
  return kind === "withhold" ? { ...row, amount: null } : row;
}
