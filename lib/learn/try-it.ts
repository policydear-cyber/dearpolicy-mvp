/**
 * Arithmetic for the library's try-it sliders. MADE-UP NUMBERS ONLY: these never read a household's policy, and the
 * pages label every result as an illustration. Real policies set their own order of deductible, co-payment and limits.
 */

export type BillSplitInput = { bill: number; deductible: number; coPaymentPercent: number; limit: number };
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

/** One common order: deductible first, then co-payment on the rest, then the limit caps the policy's share. */
export function splitBill(input: BillSplitInput): BillSplit {
  const bill = clean(input.bill);
  const deductible = Math.min(clean(input.deductible), bill);
  const afterDeductible = bill - deductible;
  const pct = Math.min(clean(input.coPaymentPercent), 100);
  const coPayment = Math.round((afterDeductible * pct) / 100);
  const beforeLimit = afterDeductible - coPayment;
  const policyShare = Math.min(beforeLimit, clean(input.limit));
  const overLimit = beforeLimit - policyShare;
  return { deductible, coPayment, overLimit, policyShare, yourShare: bill - policyShare };
}

export function percentOf(percent: number, base: number): number {
  return Math.round((Math.min(clean(percent), 100) * clean(base)) / 100);
}

/** Plain grouped number, the same on server and phone, with no currency. */
export function plainNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
