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
/** A passage that pays a share, a multiple or a capped part of the sum ("25% of the sum assured, up to S$250,000", "double the
 * sum assured", "an extra 50%"): the whole sum on Coverage is not what it pays, so a row whose amount could not be read gets
 * no pointer beside it (TE #365 EXTRA 1-5). */
const SHARE_OR_CAP = /%|\bper\s*cent\b|\bpercent(?:age)?\b|\bhalf\b|\bdouble\b|\btwice\b|\btriple\b|\bthrice\b|\bextra\b|\badditional\b|\bbooster\b|\bmultiple\b|\btimes\b|\bfold\b|\b\d+\s*\/\s*\d+\b|\b(?:thirds?|quarters?|fifths?|tenths?)\b|\bportion\b|\bshare\b|\bmax(?:imum|\.)?\b|\bup\s+to\b|\blimit(?:ed)?\b|\bcap(?:ped)?\b|\bnot\s+exceed(?:ing)?\b/i;
/** unreadAmountLine's last line: the passage was read, its amount was not. */
const NOT_READ = /^The amount on (?:page \d+|the page) could not be read\.$/;

/** The Coverage kinds whose sum a death, terminal illness, TPD or critical illness benefit pays, by the benefit's own name: the
 * cover /api/benefits must find a sum for before an unread row points to Coverage (Critic #365 follow-up: a hospital-cash sum
 * on the same policy is not the death benefit's). Empty for any other name. */
export function sumKindsOf(benefitName: string): string[] {
  const kinds: string[] = [];
  if (/\b(?:death|dies|terminal(?:ly)?\s+ill(?:ness)?)\b/i.test(benefitName)) kinds.push("Death");
  if (/\b(?:total\s+(?:and|&)\s+permanent\s+disab(?:ility|led)|permanent\s+total\s+disab(?:ility|led)|TPD)\b/i.test(benefitName)) kinds.push("Total Permanent Disability");
  if (/\b(?:critical\s+illness(?:es)?|dread\s+disease|major\s+illness)\b/i.test(benefitName)) kinds.push("Critical Illness");
  return kinds;
}

/** Whether the row, showing `line` as what it pays, is one of those. */
export function pointsToScheduleSum(b: { formulaKind: string; attention: string | null; needsConfirmation: boolean; planColumns?: boolean; benefitName: string; quote: string | null; foundSum?: boolean },
  line: string) {
  const notRead = b.attention === "unreadable" && b.foundSum === true && NOT_READ.test(line);
  if (b.formulaKind !== "none" || b.attention === "confirm" || b.needsConfirmation || b.planColumns || !(NO_AMOUNT_HERE.test(line) || notRead)) return false;
  const words = `${b.benefitName} ${b.quote ?? ""}`;
  if (WAIVER.test(words)) return false;
  if (notRead) return SUM_BENEFIT.test(b.benefitName) && !OTHER_PAYMENT.test(b.benefitName) && !SHARE_OR_CAP.test(words);
  return WHOLE_SUM.test(line) || (SUM_BENEFIT.test(b.benefitName) && !OTHER_PAYMENT.test(b.benefitName)) || NAMES_SUM.test(b.quote ?? "");
}

export const SCHEDULE_SUM_POINTER = "If your schedule prints a sum insured for this policy, Coverage shows it.";
