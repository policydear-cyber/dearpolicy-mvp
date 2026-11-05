/**
 * A Benefits row whose passage prints no amount for it ("Named in the policy; no amount is printed beside it here" from
 * describeBenefitFormula in lib/policies/benefit-catalog.ts, or "… describes this in words, with no amount in it" from
 * lib/policies/unread-amount-line.ts) can sit beside a sum insured the household's schedule prints for the same policy,
 * which Coverage shows. Read side by side, "no amount" and a figure look like a contradiction. The row says where that
 * sum is, so the reader knows both are true: this passage prints none, the schedule may. It adds no figure and changes
 * none. Lines that already say where the amount comes from (premiums waived, a share of the death benefit, a maximum
 * further down the page) or that ask the household to read it get nothing, and so does any benefit whose amount is not the
 * sum insured. A row whose amount "could not be read" gets it too, but only when the household's own cover on that same
 * document holds a sum for every person the row is shown for (`foundSum`, set by /api/benefits): Coverage then shows a
 * figure the row itself could not, and the two must not read as a contradiction (live check, 5 Nov). Pure: safe for
 * client components.
 */
const NO_AMOUNT_HERE = /\bno amount (?:is )?printed beside it here\b|\bwith no amount in it\b|\bpays the whole sum insured, which this document does not print for you\b/i;

/** Only a benefit whose amount is the policy's sum insured (Critic M1, TE #355): one that names a lump sum paid on death,
 * terminal illness, total and permanent disability or a critical illness, or whose own passage names the insured amount.
 * A closed list: anything else (hospital cash, funeral costs, evacuation, a helpline) pays something other than the sum
 * insured, and the pointer beside it would read as if it paid that sum. */
const SUM_BENEFIT = /\b(?:death|dies|terminal(?:ly)?\s+ill(?:ness)?|total\s+(?:and|&)\s+permanent\s+disab(?:ility|led)|permanent\s+total\s+disab(?:ility|led)|TPD|critical\s+illness(?:es)?|dread\s+disease|major\s+illness)\b/i;
const NAMES_SUM = /\b(?:sum\s+(?:insured|assured)|insured\s+amount|amount\s+(?:of\s+)?(?:insurance|cover(?:age)?)|coverage\s+amount|face\s+amount)\b/i;
/** Never beside a waiver: it pays no amount itself, so a sum insured beside it misleads (#348 shows it as named). */
const WAIVER = /\bwaiv(?:e|er|es|ed|ing)\b/i;
/** A benefit named after death but paying something else (a funeral grant, burial expenses, a cash allowance) is not the sum
 * insured either (TE #355). */
const OTHER_PAYMENT = /\b(?:funeral|burial|cremation|expenses?|costs?|allowance|cash|grant)\b/i;
const WHOLE_SUM = /\bpays the whole sum insured, which this document does not print for you\b/i;
/** unreadAmountLine's last line: the passage was read, its amount was not. */
const NOT_READ = /^The amount on (?:page \d+|the page) could not be read\.$/;

/** Whether the row, showing `line` as what it pays, is one of those. */
export function pointsToScheduleSum(b: { formulaKind: string; attention: string | null; needsConfirmation: boolean; planColumns?: boolean; benefitName: string; quote: string | null; foundSum?: boolean },
  line: string) {
  const notRead = b.attention === "unreadable" && b.foundSum === true && NOT_READ.test(line);
  if (b.formulaKind !== "none" || b.attention === "confirm" || b.needsConfirmation || b.planColumns || !(NO_AMOUNT_HERE.test(line) || notRead)) return false;
  const words = `${b.benefitName} ${b.quote ?? ""}`;
  if (WAIVER.test(words)) return false;
  if (notRead) return SUM_BENEFIT.test(b.benefitName) && !OTHER_PAYMENT.test(b.benefitName);
  return WHOLE_SUM.test(line) || (SUM_BENEFIT.test(b.benefitName) && !OTHER_PAYMENT.test(b.benefitName)) || NAMES_SUM.test(b.quote ?? "");
}

export const SCHEDULE_SUM_POINTER = "If your schedule prints a sum insured for this policy, Coverage shows it.";
