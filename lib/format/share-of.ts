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
 *     maximum", "limited to", "not exceeding", "capped at", "whichever is lower/less").
 * Before the percentage, on its line and any line above it, there may be only the row's own benefit name or heading (opts.name), a bullet or
 * numbering, punctuation, or a closed lead-in ("Pays", "We will pay", "Benefit", "Payable", "Bayaran"): a condition printed
 * first ("After 2 years, 10% of Sum Insured") makes the share conditional, so it gives null. A phrase naming a currency
 * ("10% of SGD, up to maximum": the figure wrapped onto the next line) is not what the share is of, so it gives null.
 * Anything else is null, so nothing is said that the row does not print. A share is never an amount: callers show it
 * as words and work out no figure from it.
 */
const PERCENT = /\p{Nd}+(?:[.,]\p{Nd}+)?\s*%/gu;
const WORD = String.raw`\p{L}[\p{L}'’-]*`;
const CAP_OPENER = String.raw`(?:subject[ \t]+to[ \t]+(?:a[ \t]+)?maximum|up[ \t]+to|maximum|max\.?|limited[ \t]+to|not[ \t]+exceeding|capped[ \t]+at|whichever[ \t]+is[ \t]+(?:lower|less))`;
const SHARE = new RegExp(
  String.raw`(\p{Nd}+(?:[.,]\p{Nd}+)?)[ \t]*%[ \t]*(?:of)[ \t]+(${WORD}(?:[ \t]+${WORD}){0,5}?)` +
  String.raw`(?:[ \t]*[.;]?\s*$|[ \t]*[,(]?[ \t]*${CAP_OPENER}(?![\p{L}\p{Nd}]))`, "iu");
/** A phrase that ends on one of these was cut short ("10% of the", "10% of Sum Insured minus"): no share. */
const DANGLING = new Set(("the a an of your its his her their and or but nor by to for per with than in on at from after before if upon " +
  "minus plus less except excluding including yang dan atau bagi untuk dengan").split(" "));

/** Words that name a currency, never what a share is of: every ISO code (in capitals) and the common written names. */
const ISO_CODES = new Set(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : []);
const CURRENCY_NAMES = new Set(("rm rp hk us nz sg ringgit ringgits rupiah rupee rupees dollar dollars euro euros pound pounds sterling yen yuan " +
  "renminbi baht peso pesos won dong dirham dirhams riyal riyals franc francs krona kronor krone kroner").split(" "));
const isCurrency = (w: string) => ISO_CODES.has(w) || ISO_CODES.has(w.toUpperCase()) && w === w.toUpperCase() || CURRENCY_NAMES.has(w.toLowerCase());
/** Words that may lead into a share without changing it. */
const LEAD_IN = new Set(["pays", "pay", "we", "will", "benefit", "payable", "bayaran"]);
const wordsOf = (t: string) => t.normalize("NFKC").toLowerCase().match(/[\p{L}\p{Nd}]+/gu) ?? [];

export function shareOf(text: string | null | undefined, opts: { name?: string | null } = {}): { percent: number; of: string } | null {
  const t = (text ?? "").normalize("NFKC").trim();
  if ((t.match(PERCENT) ?? []).length !== 1) return null;
  const m = t.match(SHARE);
  if (!m) return null;
  // Everything printed before the percentage, on its line and on any line above it in the passage: only the row's own
  // name or heading, numbering, a bullet or a lead-in. A condition on the line above ("After 2 years:") is still a condition.
  const before = t.slice(0, m.index).split("\n").map((line) => line.replace(/^\s*(?:[-–•*·▪]|\(?(?:[a-z]|\d{1,3}|[ivx]{1,4})[.)])\s*/i, "")).join(" ");
  const named = new Set(wordsOf(opts.name ?? ""));
  if (wordsOf(before).some((w) => !named.has(w) && !LEAD_IN.has(w))) return null;
  const percent = Number(m[1].replace(",", "."));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 1000) return null;
  const words = m[2].trim().split(/[ \t]+/);
  if (DANGLING.has(words[words.length - 1].toLowerCase())) return null;
  if (words.some(isCurrency)) return null;
  return { percent, of: words.join(" ") };
}
