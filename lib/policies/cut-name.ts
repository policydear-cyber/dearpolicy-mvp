/** A benefit's name is stored at most 90 characters long (catalog-builder cleanBenefitName cuts a longer row label;
 * names the reader writes are refused above 90), so a stored name of exactly 90 characters is almost always cut, often
 * mid-word or mid-bracket ("… damage to other people, items or propert", "… (between elbow and wrist"). The stored name stays
 * as it is: rules and links key on it. What the Benefits pages add after it (an allow-list, Critic R404): nothing only
 * when the quote shows the name whole (it ends there, or a figure, a currency or a closing . ; : follows after a space),
 * ")" only when the quote closes the bracket the name left open and then ends or gives a figure, and "…" for anything
 * else: a cut mid-number ("age 7" + "0 years"), a word, a hyphen or comma, or a quote that does not print the name in one
 * piece (a table row whose label wraps between its figures). Runs in the browser and on the server: no database code. */
const NAME_CAP = 90;
// A figure or currency starting the quote's next cell: "S$500,000", "SGD 1,000", "RM50", "100%", "$1,000".
const FIGURE = String.raw`(?:\p{Sc}|(?:S|US|HK|A|NZ)\$|(?<![A-Za-z])(?:SGD|USD|MYR|RM|GBP|EUR|HKD|AUD|NZD)(?=[\s\d])|\d)`;
const spaced = (t: string) => t.replace(/\s+/g, " ").trim();

export function cutNameSuffix(name: string, quote: string | null | undefined): "" | "…" | ")" {
  const raw = name ?? "";
  if (raw.length !== NAME_CAP) return "";
  const n = spaced(raw), q = spaced(String(quote ?? ""));
  const at = q.indexOf(n);
  const next = at < 0 ? null : q.slice(at + n.length);
  const open = (n.match(/\(/g) ?? []).length - (n.match(/\)/g) ?? []).length;
  if (next == null) return "…";
  if (open > 0 && new RegExp(String.raw`^\)(?:$|\s+${FIGURE})`, "u").test(next)) return ")";
  if (next === "" || new RegExp(String.raw`^(?:\s+${FIGURE}|[.;:](?:\s|$))`, "u").test(next)) return "";
  return "…";
}
