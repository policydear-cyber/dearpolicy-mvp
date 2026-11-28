import { money } from "@/lib/benefit-table/headline";

/** A figure with no currency, in one fixed format so server and browser renders agree (Critic R376 L2). */
export const plainFigure = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

/** A premium figure as a cover card says it: with its currency, or, when the premium's line and page state none, as a plain
 * figure that says so, never a bare "$" (Critic R374 L1). */
export const premiumFigure = (amount: number, code: string | null | undefined): string => code ? money(amount, code) : `${plainFigure(Number(amount))} (currency not stated)`;

/** The cover card's line when the premium's page also prints a different first-policy-year premium (check.ts premiumNote):
 * the premium above is not what is charged in that year. The first-year figure is said only when the server read it, in the
 * premium's own currency, as the figure for the policy as a whole (a plan and its rider carry the same one) and with no
 * frequency of its own (28 Nov: Coverage S$269.05 + S$201.80 vs Premiums S$376.68; TE and Critic #652). Null when the card
 * shows no premium or the page prints no such premium. */
export function firstYearNote(c: { premium: number | null; premiumNote?: string | null; firstYearPremium?: number | null; premiumCurrency?: string | null; currency: string | null }): string | null {
  if (c.premium == null || !c.premiumNote) return null;
  const code = c.premiumCurrency === undefined ? c.currency : c.premiumCurrency;
  const figure = c.firstYearPremium != null ? ` (${premiumFigure(c.firstYearPremium, code)}, for the policy as a whole)` : "";
  return `The page also prints a different premium for the first policy year${figure}, so the premium above is not what is charged in that year.`;
}
