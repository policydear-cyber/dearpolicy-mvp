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
};

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
