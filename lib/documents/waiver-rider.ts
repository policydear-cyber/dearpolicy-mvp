/** A premium-waiver rider is never a cover amount (Live tester, 12 Nov: two waiver riders on a schedule were stored as
 * "Critical Illness" and "Early Critical Illness" covers with the premium they waive, a small figure in the premium
 * column, as if it were a sum insured). A waiver rider pays the policy's future premiums when the event happens; it pays
 * no sum of its own. So a cover whose own name, or its own evidence line, names a premium-waiver rider is kept as a line
 * with no amount: no tile, total, share or answer uses a figure from it, and its event is still listed as covered.
 *
 * Names only, in closed forms: "Waiver of Premium", "Premium Waiver", "Crisis Waiver", "Early Stage Crisis Waiver",
 * "Payor Benefit", "Payer Rider", "Premium Eraser", and the same words in Malay and Chinese/Japanese. Not a waiver rider:
 * - a waiver of an excess, deductible or co-payment ("Excess Waiver", "Waiver of Deductible"): a cover that pays;
 * - a cover sold "with" a waiver ("Critical Illness Benefit with Premium Waiver"): the cover's own sum stays;
 * - a line that only says premiums are waived ("future premiums waived"): a feature, not the rider's name.
 * Pure logic: no database, network or model. */
const WAIVER_NAME = new RegExp([
  String.raw`\bwaiver\b`,
  String.raw`\bpayor\b|\bpayer\s+(?:benefit|rider|cover|waiver)\b`,
  String.raw`\bpremium\s+(?:eraser|protector|saver\s+benefit)\b`,
  String.raw`\bpengecualian\s+(?:premi(?:um)?|sumbangan|caruman)\b|\bpembebasan\s+premi(?:um)?\b`,
  String.raw`豁免|払込免除`,
].join("|"), "iu");
/** What a waiver also names when it is no premium waiver: an excess, a deductible, a co-payment, a subrogation right. */
const NOT_PREMIUM = /\b(?:excess|deductibles?|co-?pay(?:ment)?s?|co-?insurance|subrogation|collision\s+damage|cdw|ldw|loss\s+damage)\b/iu;
/** A cover sold with a waiver keeps its own sum ("... with Premium Waiver", "incl. Waiver of Premium"). */
const SOLD_WITH = /\b(?:with|incl(?:uding|\.)?|plus|\+|&|and)\s+(?:(?:a|the|an)\s+)?(?:\w+\s+){0,2}(?:waiver|payor|payer)\b/iu;

/** Whether this name or evidence line names a premium-waiver rider (see the module note). */
export function namesWaiverRider(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => {
    const s = String(t ?? "").normalize("NFKC").replace(/\s+/g, " ");
    return WAIVER_NAME.test(s) && !NOT_PREMIUM.test(s) && !SOLD_WITH.test(s);
  });
}
export const WAIVER_RIDER_NOTE = "This is a premium-waiver rider: it pays the policy's premiums, not a sum of its own, so DearPolicy does not use its figure as a cover amount.";
