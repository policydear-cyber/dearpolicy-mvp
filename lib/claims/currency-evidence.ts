/**
 * Currency matching for benefits whose amount is quoted in the policy
 * wording itself (travel). DearPolicy never converts currencies and never
 * assumes one: an amount may be shown only when the cover's own currency is
 * explicitly stated on its personal document AND the benefit's currency is
 * explicitly stated in the cited wording AND the two are the same. Anything
 * else -- a mismatch, a missing or default-only currency, or evidence that
 * cannot be traced to a specific policy document version and page -- keeps
 * the benefit visible but without an amount, asking for the page that would
 * settle it.
 */
import type { OwnedCoverage } from "@/lib/coverage/facts";
import type { ClaimEvidence } from "./types";

export const CURRENCY_UNMATCHED_REASON = "The benefit and coverage currencies could not be matched from the policy wording.";
export const CURRENCY_UNMATCHED_CONDITION = "Upload the policy schedule or certificate page that states this cover's currency and the benefit's amount, so DearPolicy can match them without guessing.";

export type CurrencyEvidence = {
  policyId: string;
  coverageId: string;
  policyDocumentVersion: string;
  coverageCurrency: string;
  coverageSourcePage: number;
  benefitCurrency: string | null;
  wording: { chunkId: string; pageStart: number; pageEnd: number };
};

export type CurrencyMatch =
  | { ok: true; currency: string; evidence: CurrencyEvidence }
  | { ok: false; reasonCode: "COVERAGE_CURRENCY_UNVERIFIED" | "COVERAGE_CURRENCY_UNCITED" | "POLICY_VERSION_UNKNOWN" | "BENEFIT_CURRENCY_MISSING" | "BENEFIT_CURRENCY_UNCITED" | "CURRENCY_MISMATCH" };

const CURRENCY_TOKENS: Record<string, RegExp> = {
  SGD: /(?:\bS\$|\bSGD\b)/i, USD: /(?:\bUS\$|\bUSD\b)/i, MYR: /\bMYR\b|\bRM\s?\d/i, EUR: /\bEUR\b|€/i, GBP: /\bGBP\b|£/i,
  HKD: /\bHK\$|\bHKD\b/i, AUD: /\bA\$|\bAUD\b/i, JPY: /\bJPY\b|¥/i, PHP: /\bPHP\b|₱/i,
};

/** Every currency explicitly written in `text`. A bare "$" names no currency
 * and is never read as SGD (or anything else). */
export function currenciesStatedIn(text: string | null | undefined): string[] {
  const t = text ?? "";
  return Object.entries(CURRENCY_TOKENS).filter(([, re]) => re.test(t)).map(([code]) => code);
}
/** The one currency `text` explicitly states, or null when it states none or
 * more than one (ambiguous -- never guessed). */
export function statedCurrency(text: string | null | undefined): string | null {
  const found = currenciesStatedIn(text);
  return found.length === 1 ? found[0] : null;
}
/** True only when `code` is explicitly written in `text`. */
export function currencyStatedIn(code: string | null | undefined, text: string | null | undefined): boolean {
  const c = iso(code);
  const token = c ? CURRENCY_TOKENS[c] : undefined;
  return !!token && token.test(text ?? "");
}

export const COVERAGE_CURRENCY_UNVERIFIED_REASON = "The currency of this cover is not stated in the policy evidence DearPolicy has read, so no amount is calculated or totalled. DearPolicy never assumes a currency.";
export const QUOTED_CURRENCY_MISSING_REASON = "The matching wording does not state the currency of this amount, so no amount is calculated or totalled. DearPolicy never assumes a currency.";
export const QUOTED_CURRENCY_MISMATCH_REASON = "The matching wording quotes an amount in a different currency than this cover's verified currency. DearPolicy never converts or relabels currencies, so no amount is calculated.";

export type NonTravelCurrencyCheck =
  | { ok: true; currency: string }
  | { ok: false; reasonCode: "COVERAGE_CURRENCY_UNVERIFIED" | "BENEFIT_CURRENCY_MISSING" | "CURRENCY_MISMATCH"; reason: string; condition: string };

/** Currency gate for every non-travel benefit (death, critical illness,
 * disability, medical reimbursement, hospital cash).
 *
 * - `requireCoverageCurrency`: the figure is computed from the cover itself
 *   (sum insured, reviewed bills), so the cover's currency must be verified
 *   from its own policy evidence -- a stored or defaulted "SGD" is not enough.
 * - `quoted`: every currency the matching wording quotes for this benefit
 *   (fixed amount, cap, daily rate). Each must be explicitly stated, and when
 *   the cover's currency is verified, each must equal it.
 * Anything else fails closed with a specific request for the page that
 * settles it. */
export function checkNonTravelCurrency(args: {
  coverage: Pick<OwnedCoverage, "currency" | "currencyVerified">;
  quoted: Array<string | null | undefined>;
  requireCoverageCurrency: boolean;
}): NonTravelCurrencyCheck {
  const coverageCurrency = args.coverage.currencyVerified === true ? iso(args.coverage.currency) : null;
  if (args.requireCoverageCurrency && !coverageCurrency)
    return { ok: false, reasonCode: "COVERAGE_CURRENCY_UNVERIFIED", reason: COVERAGE_CURRENCY_UNVERIFIED_REASON, condition: CURRENCY_UNMATCHED_CONDITION };
  const quoted = args.quoted.map((q) => (q === undefined ? undefined : iso(q)));
  if (quoted.some((q) => q === null))
    return { ok: false, reasonCode: "BENEFIT_CURRENCY_MISSING", reason: QUOTED_CURRENCY_MISSING_REASON, condition: CURRENCY_UNMATCHED_CONDITION };
  const distinct = [...new Set(quoted.filter((q): q is string => !!q))];
  if (distinct.length > 1 || (coverageCurrency && distinct.some((q) => q !== coverageCurrency)))
    return { ok: false, reasonCode: "CURRENCY_MISMATCH", reason: QUOTED_CURRENCY_MISMATCH_REASON, condition: CURRENCY_UNMATCHED_CONDITION };
  const currency = coverageCurrency ?? distinct[0] ?? null;
  if (!currency)
    return { ok: false, reasonCode: "COVERAGE_CURRENCY_UNVERIFIED", reason: COVERAGE_CURRENCY_UNVERIFIED_REASON, condition: CURRENCY_UNMATCHED_CONDITION };
  return { ok: true, currency };
}

function iso(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

/** `benefitCurrency` is the currency the cited wording quotes the benefit
 * amount in; pass null (with `requireBenefitCurrency: false`) only for a
 * benefit that quotes no amount at all (an "as charged" reimbursement),
 * whose figure then comes from reviewed bills in the cover's currency. */
export function matchBenefitCurrency(args: {
  coverage: OwnedCoverage; benefitCurrency: string | null; benefitQuote: string; citation: ClaimEvidence; requireBenefitCurrency?: boolean;
}): CurrencyMatch {
  const { coverage, citation } = args;
  const coverageCurrency = iso(coverage.currency);
  if (coverage.currencyVerified !== true || !coverageCurrency) return { ok: false, reasonCode: "COVERAGE_CURRENCY_UNVERIFIED" };
  if (coverage.sourcePage == null) return { ok: false, reasonCode: "COVERAGE_CURRENCY_UNCITED" };
  if (!coverage.policyDocumentVersion) return { ok: false, reasonCode: "POLICY_VERSION_UNKNOWN" };
  const benefitCurrency = iso(args.benefitCurrency);
  if (args.benefitCurrency != null || args.requireBenefitCurrency !== false) {
    if (!benefitCurrency) return { ok: false, reasonCode: "BENEFIT_CURRENCY_MISSING" };
    const token = CURRENCY_TOKENS[benefitCurrency];
    if (!token || !token.test(args.benefitQuote)) return { ok: false, reasonCode: "BENEFIT_CURRENCY_UNCITED" };
    if (benefitCurrency !== coverageCurrency) return { ok: false, reasonCode: "CURRENCY_MISMATCH" };
  }
  return {
    ok: true, currency: coverageCurrency,
    evidence: {
      policyId: coverage.policyId, coverageId: coverage.id, policyDocumentVersion: coverage.policyDocumentVersion,
      coverageCurrency, coverageSourcePage: coverage.sourcePage, benefitCurrency,
      wording: { chunkId: citation.chunkId, pageStart: citation.pageStart, pageEnd: citation.pageEnd },
    },
  };
}
