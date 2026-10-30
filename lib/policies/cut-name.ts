/** A benefit's name is stored at most 90 characters long (catalog-builder cleanBenefitName cuts a longer row label;
 * names the reader writes are refused above 90), so a stored name of exactly 90 characters is almost always cut, often
 * mid-word or mid-bracket ("… damage to other people, items or propert", "… (between elbow and wrist"). The stored name stays
 * as it is: rules and links key on it. What the Benefits pages add after it: ")" when the row's quote closes the bracket
 * the name left open, nothing when the quote shows the name whole (its end, a figure, a capital or punctuation right
 * after it), and "…" otherwise, including when the quote does not print the name in one piece (a table row whose label
 * wraps between its figures). Runs in the browser and on the server: no database code here. */
const NAME_CAP = 90;
const spaced = (t: string) => t.replace(/\s+/g, " ").trim();

export function cutNameSuffix(name: string, quote: string | null | undefined): "" | "…" | ")" {
  const raw = name ?? "";
  if (raw.length !== NAME_CAP) return "";
  const n = spaced(raw), q = spaced(String(quote ?? ""));
  const at = q.indexOf(n);
  const next = at < 0 ? null : q.slice(at + n.length);
  const open = (n.match(/\(/g) ?? []).length - (n.match(/\)/g) ?? []).length;
  if (next != null && open > 0 && next.startsWith(")")) return ")";
  if (next != null && (next === "" || !(/^\p{L}/u.test(next) || /^ \p{Ll}/u.test(next)))) return "";
  return "…";
}
