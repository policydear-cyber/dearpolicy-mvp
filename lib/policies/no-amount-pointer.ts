/**
 * A Benefits row whose passage prints no amount for it ("Named in the policy; no amount is printed beside it here" from
 * describeBenefitFormula in lib/policies/benefit-catalog.ts, or "… describes this in words, with no amount in it" from
 * lib/policies/unread-amount-line.ts) can sit beside a sum insured the household's schedule prints for the same policy,
 * which Coverage shows. Read side by side, "no amount" and a figure look like a contradiction. The row says where that
 * sum is, so the reader knows both are true: this passage prints none, the schedule may. It adds no figure and changes
 * none. Lines that already say where the amount comes from (premiums waived, a share of the death benefit, a maximum
 * further down the page) or that ask the household to read it get nothing. Pure: safe for client components.
 */
const NO_AMOUNT_HERE = /\bno amount (?:is )?printed beside it here\b|\bwith no amount in it\b|\bpays the whole sum insured, which this document does not print for you\b/i;

/** Whether the row, showing `line` as what it pays, is one of those. */
export function pointsToScheduleSum(b: { formulaKind: string; attention: string | null; needsConfirmation: boolean; planColumns?: boolean }, line: string) {
  return b.formulaKind === "none" && b.attention !== "confirm" && !b.needsConfirmation && !b.planColumns && NO_AMOUNT_HERE.test(line);
}

export const SCHEDULE_SUM_POINTER = "If your schedule prints a sum insured for this policy, Coverage shows it.";
