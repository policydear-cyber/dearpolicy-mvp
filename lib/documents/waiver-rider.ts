/** A premium-waiver rider is never a cover amount (Live tester, 12 Nov: two waiver riders on a schedule were stored as
 * "Critical Illness" and "Early Critical Illness" covers with the premium they waive, a small figure in the premium
 * column, as if it were a sum insured). A waiver rider pays the policy's future premiums when the event happens; it pays
 * no sum of its own. So a cover whose own name, or the first cell of its evidence line, names a premium-waiver rider is
 * kept as a line with no amount: no tile, total, share or answer uses a figure from it, and its event is still listed as covered.
 *
 * A closed allow-list of rider-name forms (Critic #436), tested against the cover's own product or rider name and the
 * first cell of its evidence line only, never the whole line:
 * - "Waiver of Premium(s)", "WOP", "Premium Waiver Rider/Benefit";
 * - "(Early [Stage]) Crisis / CI / Critical Illness / Cancer / TPD / Disability [Premium] Waiver [Plus/Rider/Benefit/II]";
 * - "Payor/Payer Benefit/Rider", "Premium Eraser"; the Malay "Pengecualian Premium" and the Chinese/Japanese 豁免, 払込免除.
 * Not a waiver rider, and so keeping its sum:
 * - a waiver of anything else (an excess, a deductible, a waiting period, a surrender charge, an exclusion);
 * - a cover sold with or including a waiver ("Critical Illness Benefit with Premium Waiver", "Term Life incl. Waiver of
 *   Premium"): the words after "with"/"incl." are not the cover's name;
 * - a cover line that mentions a waiver feature beside its own sum ("Death Benefit  100,000  Premium Waiver: Included",
 *   "Term Life (Premium Waiver Option)"), or a person labelled payor ("Life Assured / Payor: ...").
 * Pure logic: no database, network or model. */
const EVENT = String.raw`(?:(?:early(?:\s+stage)?\s+)?(?:crisis|ci|critical\s+illness(?:es)?|dread\s+disease)|cancer|tpd|total\s+(?:and\s+|&\s+)?permanent\s+disability|disability)`;
const RIDER_FORMS = new RegExp([
  String.raw`\bwaiver\s+of\s+(?:future\s+)?premiums?\b`,
  String.raw`\bwop\b`,
  String.raw`\bpremium\s+waiver\s+(?:rider|benefit)\b`,
  String.raw`\b${EVENT}\s+(?:premium\s+)?waiver\b`,
  String.raw`\bpay(?:o|e)r\s+(?:benefit|rider)\b`,
  String.raw`\bpremium\s+eraser\b`,
  String.raw`\bpengecualian\s+premi(?:um)?\b|\bpembebasan\s+premi(?:um)?\b`,
  String.raw`豁免|払込免除`,
].join("|"), "iu");
/** What follows "with" or "incl." is a feature the cover is sold with, not the cover's own name. */
const SOLD_WITH = /\s+(?:with|incl\.?|including)\s.*$/iu;
/** The first cell of an evidence line: its name, before a tab, a run of spaces, a bar or a colon. */
const firstCell = (line: string) => line.split(/\t| {2,}|\||:/u).map((c) => c.trim()).find(Boolean) ?? "";

/** Whether the cover's own name, or the first cell of its evidence line, names a premium-waiver rider (see the module note). */
export function namesWaiverRider(productName: string | null | undefined, evidenceText?: string | null): boolean {
  const clean = (t: string) => t.normalize("NFKC").replace(/[ \u00a0]+/g, " ").replace(SOLD_WITH, "");
  const name = clean(String(productName ?? "").replace(/\s+/g, " "));
  const cell = clean(firstCell(String(evidenceText ?? "").normalize("NFKC").replace(/\r/g, "")));
  return [name, cell].some((t) => !!t && RIDER_FORMS.test(t));
}
export const WAIVER_RIDER_NOTE = "This is a premium-waiver rider: it pays the policy's premiums, not a sum of its own, so DearPolicy does not use its figure as a cover amount.";
