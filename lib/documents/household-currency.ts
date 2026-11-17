/**
 * The household's own currency (Account settings, DC 17 Nov): the currency a household says its policies are in. It
 * stands for the currency of a cover amount ONLY when the document itself does not say otherwise:
 * - a currency the document prints (on the line, in a header, once for the whole schedule, or in its page image) always
 *   decides, and the household's choice never relabels it;
 * - the household's currency is used for a page only when nothing that page prints names any OTHER currency (its text
 *   and its image reading), and, for a page that names no currency at all, nothing any page of the document prints
 *   does. A bare "$" or "dollars" is a dollar of some kind, so it agrees with a dollar currency (S$, US$, HK$, A$) and
 *   with no other;
 * - a document that prints two currencies, or one the household did not choose, is held exactly as before.
 * The fact check then confirms a figure in it only as it does an image's currency: a money-shaped figure (thousands
 * separators or two decimals) on the cover's own evidence line (image-currency moneyShapedFigure), never a plain number,
 * a percentage, days or years. Pure functions; no I/O.
 */
import { currenciesIn } from "@/lib/documents/image-currency";
import { UNCHECKED_PAGE } from "@/lib/documents/layout-check";

export { HOUSEHOLD_CURRENCIES, NO_HOUSEHOLD_CURRENCY, DEFAULT_HOUSEHOLD_CURRENCY, HOUSEHOLD_CURRENCY_LABELS, type HouseholdCurrency, type HouseholdCurrencySetting } from "@/lib/documents/household-currency-options";
import { HOUSEHOLD_CURRENCIES, NO_HOUSEHOLD_CURRENCY, DEFAULT_HOUSEHOLD_CURRENCY, type HouseholdCurrency, type HouseholdCurrencySetting } from "@/lib/documents/household-currency-options";

const DOLLARS = new Set<string>(["SGD", "USD", "HKD", "AUD"]);

/** A stored or submitted setting, read strictly: anything else is not a setting. */
export function parseHouseholdCurrencySetting(value: unknown): HouseholdCurrencySetting | null {
  const v = typeof value === "string" ? value.trim().toUpperCase() : "";
  return v === NO_HOUSEHOLD_CURRENCY || (HOUSEHOLD_CURRENCIES as readonly string[]).includes(v) ? (v as HouseholdCurrencySetting) : null;
}

/** The currency the household's setting gives, or null for "Don't assume". Not chosen (or unreadable) is the default. */
export function effectiveHouseholdCurrency(stored: unknown): HouseholdCurrency | null {
  const s = parseHouseholdCurrencySetting(stored);
  if (s === NO_HOUSEHOLD_CURRENCY) return null;
  return s ?? DEFAULT_HOUSEHOLD_CURRENCY;
}

/** Whether a currency the document names is consistent with the household's: the same code, or a bare dollar beside a
 * dollar currency. */
const agrees = (named: string, household: string) => named === household || (named === "$" && DOLLARS.has(household));

type Page = { pageNumber: number; text: string; imageCurrency?: string; imageCurrencies?: string[]; unreadable?: boolean; notRead?: boolean };

/** A page whose words are not known: unreadable, not read, a page the image check could not confirm (its figure lines,
 * and any currency on them, were taken out), or no text and no image reading. It may be the page that prints another
 * currency, so it never counts as agreeing (Critic #526 H3). */
const unknownPage = (p: Page) => !!p.unreadable || !!p.notRead || p.text.startsWith(UNCHECKED_PAGE)
  || (!p.text.trim() && !(p.imageCurrencies?.length || p.imageCurrency));

/** The pages whose bare figures may be read in the household's currency (see the module note), decided page by page:
 * - a page that names a currency by name or code (in its text or its image reading) uses the household's only when every
 *   currency it names agrees with it: a schedule that says "Currency : Singapore Dollar" once, for a household in S$;
 * - a page that names none, or only a bare "$" or "dollars", uses it only when every page of the document is known and
 *   no page, and no page image, names any other currency: a bare "$" beside "Policy Currency: USD" on another page is
 *   US$, never S$ (Critic #526 H1), and a policy wording that lists the currencies a policy may be written in holds
 *   every such page.
 * Nothing when the household chose "Don't assume". */
export function householdCurrencyPages(pages: Page[], household: string | null | undefined): Map<number, string> {
  const out = new Map<number, string>();
  const code = parseHouseholdCurrencySetting(household);
  if (!code || code === NO_HOUSEHOLD_CURRENCY) return out;
  const namedOn = (p: Page) => [...currenciesIn(p.text), ...(p.imageCurrency ? [p.imageCurrency] : []), ...(p.imageCurrencies ?? [])];
  const documentAgrees = pages.every((p) => !unknownPage(p) && namedOn(p).every((c) => agrees(c, code)));
  for (const p of pages) {
    if (unknownPage(p)) continue;
    const named = namedOn(p);
    const byName = named.filter((c) => c !== "$");
    if (byName.length ? named.every((c) => agrees(c, code)) : documentAgrees) out.set(p.pageNumber, code);
  }
  return out;
}

/** The short note a cover amount carries when its currency is the household's. */
export const HOUSEHOLD_CURRENCY_NOTE = "Currency from your account settings.";
