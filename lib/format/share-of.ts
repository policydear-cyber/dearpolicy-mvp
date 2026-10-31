/**
 * The share a percentage row pays, in the row's own words: "10% of Prevailing Insured Amount, up to maximum" gives
 * { percent: 10, of: "Prevailing Insured Amount" }; "25% daripada Jumlah Diinsuranskan" gives "Jumlah Diinsuranskan".
 *
 * For any insurer's wording, read with CLOSED lists only, so a wording no list foresaw gives null rather than a share
 * that drops a word that changes it ("of Sum Insured minus claims paid", "of Sum Insured, once only"). A share is read
 * only when the row prints exactly one percentage, followed by "of" (or Malay "daripada"/"dari") and one to six words
 * made of letters, and then either
 *   - nothing more (an optional full stop or semicolon), or
 *   - an optional comma or bracket and a cap opener from a closed list ("up to", "max", "maximum", "subject to a
 *     maximum", "limited to", "not exceeding", "capped at", "whichever is lower/less", "sehingga", "maksimum", "hingga").
 * Anything else is null, so nothing is said that the row does not print. A share is never an amount: callers show it
 * as words and work out no figure from it.
 */
const PERCENT = /\p{Nd}+(?:[.,]\p{Nd}+)?\s*%/gu;
const WORD = String.raw`\p{L}[\p{L}'’-]*`;
const CAP_OPENER = String.raw`(?:subject[ \t]+to[ \t]+(?:a[ \t]+)?maximum|up[ \t]+to|maximum|max\.?|limited[ \t]+to|not[ \t]+exceeding|capped[ \t]+at|whichever[ \t]+is[ \t]+(?:lower|less)|sehingga|maksimum|hingga)`;
const SHARE = new RegExp(
  String.raw`(\p{Nd}+(?:[.,]\p{Nd}+)?)[ \t]*%[ \t]*(?:of|daripada|dari)[ \t]+(${WORD}(?:[ \t]+${WORD}){0,5}?)` +
  String.raw`(?:[ \t]*[.;]?\s*$|[ \t]*[,(]?[ \t]*${CAP_OPENER}(?![\p{L}\p{Nd}]))`, "iu");
/** A phrase that ends on one of these was cut short ("10% of the", "10% of Sum Insured minus"): no share. */
const DANGLING = new Set(("the a an of your its his her their and or but nor by to for per with than in on at from after before if upon " +
  "minus plus less except excluding including yang dan atau bagi untuk dengan").split(" "));

export function shareOf(text: string | null | undefined): { percent: number; of: string } | null {
  const t = (text ?? "").normalize("NFKC").trim();
  if ((t.match(PERCENT) ?? []).length !== 1) return null;
  const m = t.match(SHARE);
  if (!m) return null;
  const percent = Number(m[1].replace(",", "."));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 1000) return null;
  const words = m[2].trim().split(/[ \t]+/);
  if (DANGLING.has(words[words.length - 1].toLowerCase())) return null;
  return { percent, of: words.join(" ") };
}
