/**
 * The share a percentage row pays, in the row's own words: "10% of Prevailing Insured Amount, up to maximum" gives
 * { percent: 10, of: "Prevailing Insured Amount" }; "25% daripada Jumlah Diinsuranskan" gives "Jumlah Diinsuranskan".
 *
 * For any insurer's wording. Only a share with one meaning is read: the row prints exactly one percentage, it is followed
 * by "of" (or Malay "daripada"/"dari"), and one to six words that end before a comma, bracket or a linking word ("up to",
 * "subject to", "or", "per", "whichever", "sehingga"). Anything else is null, so nothing is said that the row does not
 * print. A share is never an amount: callers show it as words and work out no figure from it.
 */
const PERCENT = /\p{Nd}+(?:[.,]\p{Nd}+)?\s*%/gu;
const SHARE = /(\p{Nd}+(?:[.,]\p{Nd}+)?)\s*%\s*(?:of|daripada|dari)\s+((?:\p{L}[\p{L}'’-]*\s*){1,8})/iu;
const STOP = new Set(("up to max maximum subject or and whichever per for limited capped not payable if provided less minus plus in on at " +
  "with by from after before when which that is are will shall be each any sehingga hingga maksimum atau dan bagi untuk setiap").split(" "));
const TRAILING = new Set(["the", "a", "an", "of", "your", "its", "his", "her", "their", "yang"]);

export function shareOf(text: string | null | undefined): { percent: number; of: string } | null {
  const t = (text ?? "").normalize("NFKC");
  if ((t.match(PERCENT) ?? []).length !== 1) return null;
  const m = t.match(SHARE);
  if (!m) return null;
  const percent = Number(m[1].replace(",", "."));
  if (!Number.isFinite(percent) || percent <= 0 || percent > 1000) return null;
  const words: string[] = [];
  for (const w of m[2].trim().split(/\s+/)) { if (STOP.has(w.toLowerCase()) || words.length === 6) break; words.push(w); }
  while (words.length && TRAILING.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.length ? { percent, of: words.join(" ") } : null;
}
