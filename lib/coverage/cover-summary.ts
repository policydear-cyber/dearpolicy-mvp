/** The top of a cover's detail page (DC 18 Nov): Home's card says only Covered; tapping it opens this page, which says what
 * each policy gives for the cover and whether there is a total. A total is shown only where it rests on ONE confirmed
 * figure: separate policies, schedules or benefits are never added together without explicit support in the documents
 * (project rule, 17 Nov; DC 27 Oct: no summing separate death policies), so several are listed one by one and the page says
 * why there is no total. Every figure here is one the dashboard already resolved from a confirmed line of the person's own
 * document (app/api/dashboard/route.ts); nothing is computed, converted or assumed. Pure; used by app/coverage/page.tsx.
 *   Test: scripts/coverage/cover-summary-test.ts */
import { CURRENCY_NOT_STATED, formatMoney, statedCurrencyCode } from "@/lib/format/currency";
import { homeCardShowsAmount, homePolicyName } from "@/lib/coverage/home-card";

export type SummaryPart = { name: string; amount: number | null; currency: string | null; accelerates?: boolean; conditional?: boolean; period?: string | null; noFigure?: boolean; otherTile?: boolean };
export type SummaryCover = { status: string; amount: number | null; displayAmount: string | null; currency: string | null; count?: number | null; policyNames?: string[] | null;
  sources?: string[] | null; parts?: SummaryPart[] | null; reviewRequired?: boolean | null; partial?: boolean | null;
  /** A partly confirmed cover's one confirmed line, sent only when one policy is the whole cover (route.ts oneConfirmed): kept off `amount`; this page shows it as that line's amount, never as a total (DC 18 Nov). */
  partialAmount?: number | null; partialDisplay?: string | null };
export type SummaryLine = { name: string; amount: string | null; notes: string[] };
export type CoverSummary = { lines: SummaryLine[]; total: string | null; why: string | null };

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** A cover's name without a policy number printed into it ("GROUP TERM LIFE(POLICY NO.123)"). */
const partLabel = (n: string) => homePolicyName(clean(n).replace(/\s*\((?:group\s+)?policy\s+no\.?[^)]*\)/gi, "").trim() || clean(n));
const withPeriod = (text: string, period: string | null | undefined) => (period ? `${text} a ${period}` : text);
/** A figure is shown only with the currency its line states: a bare or missing one never becomes S$ (Home rule, 16 Nov). */
const priced = (amount: number | null | undefined, currency: string | null | undefined) => amount != null && Number.isFinite(amount) && statedCurrencyCode(currency) ? formatMoney(amount, currency) : null;
const partNotes = (p: SummaryPart) => [p.conditional && "conditions apply", p.accelerates && "paid instead of the death benefit, not on top of it",
  p.otherTile && "pays only on what another cover type covers"].filter((n): n is string => !!n);
const NO_CURRENCY = "the line prints no currency, so no amount is shown";

export function coverSummary(c: SummaryCover): CoverSummary | null {
  if (c.status !== "covered") return null;
  const parts = (c.parts ?? []).filter((p) => clean(p.name));
  const why: string[] = [];
  // DC 18 Nov: a confirmed amount still shows when other lines of the cover are not confirmed yet; those show none, and
  // there is no total, since the confirmed amounts may not be all the cover pays.
  if (c.partial) why.push("Some of this cover's lines are not confirmed against the document yet, so no total is shown, and the amounts shown may not be all this cover pays.");
  const amountIn = c.partial ? c.partialAmount ?? null : c.amount;
  const displayIn = c.partial ? c.partialDisplay ?? null : c.displayAmount;
  if (c.reviewRequired) why.push("One policy prints more than one amount for this cover, so each is listed with its page below instead of a total.");
  // One confirmed figure, nothing to add up: it is the amount.
  // A single part keeps its own period and "no figure" mark; the dashboard's displayAmount already carries the period.
  if (homeCardShowsAmount(c) && (amountIn != null || displayIn) && !parts[0]?.noFigure) {
    const name = clean(c.sources?.[0]) || clean(c.policyNames?.[0]) || clean(parts[0]?.name);
    const figure = amountIn != null ? priced(amountIn, c.currency) : (clean(displayIn).includes(CURRENCY_NOT_STATED) ? null : clean(displayIn) || null);
    const amount = figure && amountIn != null ? withPeriod(figure, parts[0]?.period) : figure;
    const label = name ? partLabel(name) : "Your policy";
    if (!amount) return { lines: [{ name: label, amount: null, notes: [NO_CURRENCY] }], total: null, why: why.join(" ") || null };
    // A single part keeps what qualifies it ("paid instead of the death benefit"), as the list does (TE PR 535 F2).
    const notes = parts.length === 1 ? partNotes(parts[0]) : [];
    if (c.partial) return { lines: [{ name: label, amount, notes: [...notes, "confirmed in your document"] }], total: null, why: why.join(" ") };
    return { lines: [{ name: label, amount, notes }], total: amount, why: null };
  }
  if (parts.length) {
    const withheld = Boolean(c.reviewRequired);
    const lines = parts.map((p): SummaryLine => {
      const notes = partNotes(p);
      // A policy printing several amounts for this cover shows none of them (Critic PR 535 M1). A partly confirmed cover
      // shows each confirmed amount (DC 18 Nov), with no total and the why line saying it may not be all.
      if (withheld) { notes.push("this policy prints more than one amount; see each with its page below"); return { name: partLabel(p.name), amount: null, notes }; }
      const figure = p.amount != null && !p.noFigure ? priced(p.amount, p.currency) : null;
      const amount = figure ? withPeriod(figure, p.period) : null;
      if (amount == null) notes.push(p.noFigure ? "see the document for how much it pays" : p.amount != null ? NO_CURRENCY : "amount not confirmed");
      return { name: partLabel(p.name), amount, notes };
    });
    if (lines.length > 1) why.push("No total is shown: these are separate policies or benefits, and DearPolicy adds amounts together only where your documents show they are paid together.");
    return { lines, total: null, why: why.join(" ") || null };
  }
  // Covered with no per-policy figures here (a whole-policy kind such as travel, or a benefit described in the plan's
  // wording): the documents below say what it pays.
  const names = [...new Set((c.sources?.length ? c.sources : c.policyNames ?? []).map(clean).filter(Boolean))];
  if ((c.count ?? 0) > 1 || names.length > 1) why.push("No total is shown: this cover comes from more than one policy or benefit, and each is listed with its page below.");
  return { lines: names.map((n) => ({ name: partLabel(n), amount: null, notes: ["its amounts are in the documents below"] })), total: null, why: why.join(" ") || null };
}
