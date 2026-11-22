/**
 * The household's own currency (Account settings, DC 17 Nov): the currency a household says its policies are in. It
 * stands for the currency of a cover amount ONLY once the household has chosen it (nothing is assumed before; DC 17 Nov)
 * and ONLY when the document itself does not say otherwise:
 * - a currency the document prints (on the line, in a header, once for the whole schedule, or in its page image) always
 *   decides, and the household's choice never relabels it;
 * - the household's currency is used for a page only when nothing that page prints names any OTHER currency (its text
 *   and its image reading), and, for a page that names no currency at all, nothing any page of the document, or any other
 *   document of the same policy, prints does. A bare "$" or "dollars" names no currency, so it takes the household's
 *   (DC 22 Nov) and never blocks the fill; only a lettered currency other than the household's does;
 * - a document that prints two currencies, or one the household did not choose, is held exactly as before.
 * The fact check then confirms a figure in it only as it does an image's currency: a money-shaped figure (thousands
 * separators or two decimals) on the cover's own evidence line (image-currency moneyShapedFigure), never a plain number,
 * a percentage, days or years. Pure functions; no I/O.
 */
import { UNCHECKED_PAGE } from "@/lib/documents/layout-check";
import { currenciesNamed } from "@/lib/documents/currency-names";
export { currenciesNamed };

export { HOUSEHOLD_CURRENCIES, NO_HOUSEHOLD_CURRENCY, HOUSEHOLD_CURRENCY_LABELS, parseHouseholdCurrencySetting, type HouseholdCurrency, type HouseholdCurrencySetting } from "@/lib/documents/household-currency-options";
import { NO_HOUSEHOLD_CURRENCY, parseHouseholdCurrencySetting, type HouseholdCurrency } from "@/lib/documents/household-currency-options";


/** The currency the household chose, or null when it chose "Don't assume" or has not chosen: nothing is assumed until a
 * household chooses (DC 17 Nov). */
export function effectiveHouseholdCurrency(stored: unknown): HouseholdCurrency | null {
  const s = parseHouseholdCurrencySetting(stored);
  if (s === NO_HOUSEHOLD_CURRENCY) return null;
  return s;
}

/** What currenciesNamed gives for a bare "$" or "dollars": a dollar of no stated kind. */
const BARE_DOLLAR = "$";
/** Whether a currency the document names is consistent with the household's: the same code. A bare "$" or "dollars"
 * is not a currency named (DC 22 Nov: the household set its currency, so an unlabelled amount is read in it, shown or
 * not; namedOn leaves it out). A lettered currency ("US$", "S$", "RM", "USD") always wins: any other code holds the page. */
const agrees = (named: string, household: string) => named === household;

type Page = { pageNumber: number; text: string; imageCurrency?: string; imageCurrencies?: string[]; unreadable?: boolean; notRead?: boolean };

/** A page whose words are not known: unreadable, not read, a page the image check could not confirm (its figure lines,
 * and any currency on them, were taken out), or no text and no image reading. It may be the page that prints another
 * currency, so it never counts as agreeing (Critic #526 H3). */
const unknownPage = (p: Page) => !!p.unreadable || !!p.notRead || p.text.startsWith(UNCHECKED_PAGE)
  || (!p.text.trim() && !(p.imageCurrencies?.length || p.imageCurrency));

/** Where the household's currency stands for a page's figures: its code, and whether the page states that currency itself
 * (then the amount carries no settings note: the document said it; Test engineer #526 F6). */
export type HouseholdPageCurrency = { code: string; stated: boolean };

/** The pages whose bare figures may be read in the household's currency (see the module note), decided page by page:
 * - a page that names a currency (in its text or its image reading) uses the household's only when every currency it
 *   names is the household's: a schedule that says "Currency : Singapore Dollar" once, for a household in S$;
 * - a page that names none uses it only when every page of the document is known and no page, and no page image, names
 *   any currency other than the household's. A bare "$" or "dollars" counts as no currency (DC 22 Nov: it is the household's),
 *   and a policy wording that lists the currencies a policy may be written in holds every such page;
 * - `related`: the text of the household's other documents of the same policy (its schedule, an endorsement). When any
 *   of them names a currency other than the household's, nothing is filled (Test engineer #526 F2).
 * Nothing when the household chose "Don't assume" or has not chosen. */
export function householdCurrencyPages(pages: Page[], household: string | null | undefined, related: string[] = []): Map<number, HouseholdPageCurrency> {
  const out = new Map<number, HouseholdPageCurrency>();
  const code = parseHouseholdCurrencySetting(household);
  if (!code || code === NO_HOUSEHOLD_CURRENCY) return out;
  if (related.some((t) => currenciesNamed(t).some((c) => c !== BARE_DOLLAR && !agrees(c, code)))) return out;
  // A bare "$" names no currency (it is the household's); only a lettered currency counts as named.
  const namedOn = (p: Page) => [...currenciesNamed(p.text), ...(p.imageCurrency ? [p.imageCurrency] : []), ...(p.imageCurrencies ?? [])].filter((c) => c !== BARE_DOLLAR);
  const documentAgrees = pages.every((p) => !unknownPage(p) && namedOn(p).every((c) => agrees(c, code)));
  for (const p of pages) {
    if (unknownPage(p)) continue;
    const named = namedOn(p);
    if (named.length ? named.every((c) => agrees(c, code)) : documentAgrees) out.set(p.pageNumber, { code, stated: named.length > 0 });
  }
  return out;
}

/** The short note a cover amount carries when its currency is the household's. */
export const HOUSEHOLD_CURRENCY_NOTE = "Currency from your account settings.";
