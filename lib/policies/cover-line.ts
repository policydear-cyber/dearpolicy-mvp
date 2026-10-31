/** A schedule's list of covers, read as benefit rows: "DOUBLE CRITICAL COVER 2217S $100,000.00 21 Sep 2020 21 Sep 2092".
 * The row is the cover's own name, the one amount the schedule lists it at, and the dates it runs from and to. It
 * states no rule of payment, so it is stored with none, and the Benefits page called its amount unreadable while Home
 * showed the same figure. Read back, such a row is said as the schedule prints it.
 *
 * Allow-list, whatever the insurer, currency or date style: the quote is the row's name, then exactly one figure with
 * its currency mark, then one or two dates, and nothing else. A second figure (a premium beside it), any word after
 * the figure ("per day", "per claim"), a figure inside the name, or a quote that does not start with the name gives no
 * line, and the row stays as it was. Only a person's own schedule, certificate or endorsement lists covers this way. */
const COVER_LIST_ROLES = new Set(["personal_schedule", "certificate", "endorsement"]);
const SIGN = String.raw`(?:[A-Z]{1,3}\s?)?(?:[$£€¥₹₩฿₱]|RM|Rp|Rs\.?)|(?:[A-Z]{3})(?=\s?\d)`;
const NUMBER = String.raw`\d{1,3}(?:[,.  ]\d{3})+(?:[.,]\d{2})?|\d{1,7}(?:[.,]\d{2})?`;
const FIGURE = new RegExp(String.raw`^(?:${SIGN})\s?(?:${NUMBER})$`, "u");
const DATE = String.raw`(?:\d{1,2}[\s-](?:\p{L}{3,9})\.?[\s-]\d{4}|\p{L}{3,9}\.?\s\d{1,2},?\s\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4}|\d{4}-\d{2}-\d{2})`;
const TAIL = new RegExp(String.raw`^(.+?)\s(${DATE})(?:\s(${DATE}))?$`, "u");

const squash = (text: string) => text.replace(/\s+/gu, " ").trim();

export function scheduleCoverLine(row: { benefitName: string | null; quote: string | null; documentRole: string | null }): { figure: string } | null {
  if (!COVER_LIST_ROLES.has(row.documentRole ?? "")) return null;
  const name = squash(row.benefitName ?? ""), quote = squash(row.quote ?? "");
  // A name of words, with no figure of its own: "PLAN 2217S" keeps its code, "Plan $50" is not a name.
  if (!/\p{L}{3}/u.test(name) || /[$£€¥₹%]|\d{1,3}[,.]\d{3}/u.test(name)) return null;
  if (quote.length <= name.length || quote.slice(0, name.length).toLocaleLowerCase() !== name.toLocaleLowerCase()) return null;
  if (quote[name.length] !== " ") return null;
  const rest = quote.slice(name.length + 1);
  const tail = TAIL.exec(rest);
  if (!tail) return null;
  const figure = tail[1].trim();
  if (!FIGURE.test(figure)) return null;
  return { figure };
}

/** The line the Benefits page shows for it. */
export const coverLineText = (figure: string) => `The schedule lists this cover at ${figure}.`;
