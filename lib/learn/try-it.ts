/**
 * Arithmetic for the library's try-it sliders. MADE-UP NUMBERS ONLY: these never read a household's policy, and the
 * pages label every result as an illustration. Real policies set their own order of deductible, co-payment and limits.
 */

/**
 * Where the limit bites. Policies differ, and the two orders give different results:
 * - "share": deductible, then co-payment, then the limit caps what the policy pays.
 * - "bill": the limit caps the claimable bill first, then the deductible and co-payment come off what is left
 *   (common for hospital plans that apply claim limits to the bill).
 */
export type LimitApplies = "share" | "bill";
export type BillSplitInput = { bill: number; deductible: number; coPaymentPercent: number; limit: number; limitApplies?: LimitApplies };
export type BillSplit = {
  /** The part of the bill covered by the deductible (you pay it). */
  deductible: number;
  /** Your co-payment share of what is left after the deductible. */
  coPayment: number;
  /** What the illustration's policy share would have been, above the limit (you pay it). */
  overLimit: number;
  /** The illustrated policy share. */
  policyShare: number;
  /** Everything you pay in this illustration. */
  yourShare: number;
};

const clean = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function splitBill(input: BillSplitInput): BillSplit {
  const bill = clean(input.bill);
  if (input.limitApplies === "bill") {
    const claimable = Math.min(bill, clean(input.limit));
    const deductible = Math.min(clean(input.deductible), claimable);
    const pct = Math.min(clean(input.coPaymentPercent), 100);
    const coPayment = Math.round(((claimable - deductible) * pct) / 100);
    const policyShare = claimable - deductible - coPayment;
    return { deductible, coPayment, overLimit: bill - claimable, policyShare, yourShare: bill - policyShare };
  }
  const deductible = Math.min(clean(input.deductible), bill);
  const afterDeductible = bill - deductible;
  const pct = Math.min(clean(input.coPaymentPercent), 100);
  const coPayment = Math.round((afterDeductible * pct) / 100);
  const beforeLimit = afterDeductible - coPayment;
  const policyShare = Math.min(beforeLimit, clean(input.limit));
  const overLimit = beforeLimit - policyShare;
  return { deductible, coPayment, overLimit, policyShare, yourShare: bill - policyShare };
}

/** A percentage of a base. Not capped at 100: some covers state more than 100% (the page's slider stops at 100). */
export function percentOf(percent: number, base: number): number {
  return Math.round((clean(percent) * clean(base)) / 100);
}

/** Plain grouped number, the same on server and phone, with no currency. */
export function plainNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
