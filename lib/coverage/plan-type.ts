/** Whether a policy is a savings or an investment plan, by what its own document says it is. Pure, for any household and
 * insurer: it reads only the policy's own name and the sentence a contract prints about itself ("This is a regular
 * premium participating endowment insurance policy"), never a product or insurer named in code. A whole life, term,
 * health or accident plan is protection, even when it builds a cash value or has a maturity benefit: only the document's
 * own words make a plan savings. When the words disagree, or say nothing, the plan type is not known (null). */
export type PlanKind = "savings" | "investment";
export type PlanType = { kind: PlanKind; page: number | null; quote: string };

/** A plan name that says what it is ("Endowment Plan", "Savings Policy", "Investment-Linked Plan", Malay "Polisi
 * Endowmen", "Berkaitan Pelaburan"). "Saver" alone does not: brand names use it for protection plans. */
const NAME_KINDS: [RegExp, PlanKind][] = [
  [/\bendowmen(?:t)?\b|\bsavings?\s+(?:plan|policy|insurance|assurance)\b|\btabungan\b/i, "savings"],
  [/\b(?:investment|unit)[\s-]linked\b|\bilp\b|\bberkaitan[\s-]pelaburan\b/i, "investment"],
];
export function planKindOfName(...names: (string | null | undefined)[]): PlanKind | null {
  const text = names.filter(Boolean).join(" · ");
  // A name that also states a protection type ("Prairie Health Savings Plan") is not a savings plan (TE #213 F2).
  if (PROTECTION_WORD.test(text)) return null;
  const kinds = new Set(NAME_KINDS.filter(([re]) => re.test(text)).map(([, k]) => k));
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** A contract's sentence about itself: "This (policy|plan|contract) is a/an <up to ten words> policy/plan/insurance",
 * words only (a clause number or figure ends it: "This is a medical condition as defined in clause 26").
 * "is not a" never matches. The words between are classified as a whole (kindOfPhrase). */
const SELF = /\bthis\s+(?:(?:policy|plan|product|contract|certificate)\s+)?is\s+an?\s+((?:[A-Za-z][A-Za-z-]*,?\s+){0,10}?)(?:insurance\s+|assurance\s+)?(?:policy|plan|product|contract)\b/gi;
// "non-savings" or "non-investment-linked" is the opposite (TE #213 F5).
const SAVINGS_WORD = /(?<!\bnon[\s-])\b(?:endowment|savings?)\b/i, INVESTMENT_WORD = /(?<!\bnon[\s-])\b(?:investment|unit)[\s-]linked\b/i;
/** Protection words; "term" only as a plan type, never "long term", "short-term" or "medium term". */
export const PROTECTION_WORD = /\b(?:whole[\s-]life|(?<!\b(?:long|short|medium)[\s-])term|annuity|health|medical|hospital\w*|accident|critical\s+illness|travel|universal\s+life|disability|long[\s-]term\s+care|shield)\b/i;
const kindOfPhrase = (phrase: string): PlanKind | "protection" | null => {
  const kinds = [SAVINGS_WORD.test(phrase) && "savings", INVESTMENT_WORD.test(phrase) && "investment", PROTECTION_WORD.test(phrase) && "protection"].filter(Boolean) as (PlanKind | "protection")[];
  // "an investment-linked whole life plan": an investment plan with life cover. Savings and investment words together are unsure.
  if (kinds.includes("savings") && kinds.includes("investment")) return null;
  return kinds.find((k) => k !== "protection") ?? kinds[0] ?? null;
};

/** The plan type the document's own pages state, with the page and sentence; null when no page states one, or pages state
 * different ones (a pack holding two products' summaries). A protection type ("whole life", "term") is a stated type too:
 * it makes a savings sentence elsewhere in the pack unsure. */
export function planTypeOfPages(pages: { page: number; text: string }[]): PlanType | null {
  const found: { kind: PlanKind | "protection"; page: number; quote: string }[] = [];
  for (const p of pages) for (const m of p.text.matchAll(SELF)) {
    const kind = kindOfPhrase(m[1]);
    if (kind) found.push({ kind, page: p.page, quote: m[0].replace(/\s+/g, " ").trim() });
  }
  const kinds = new Set(found.map((f) => f.kind));
  if (kinds.size !== 1) return null;
  const first = found[0];
  return first.kind === "protection" ? null : { kind: first.kind, page: first.page, quote: first.quote };
}

/** A rider, add-on or waiver by its own name, whether or not the reading linked it to its plan (Critic R418 M3). */
const RIDER_NAME = /\b(?:riders?|supplementary|add[\s-]?ons?|waiver|payor|payer)\b/i;
const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A cover's plan type. Never for a rider (linked, or named as one), nor for a cover whose own name states a protection type
 * ("Health Savings Plan", "Critical Illness Benefit", "Term Plan": TE #213 F2). Its own name (cover, then plan) decides
 * first, then its product's name; then what its document says about itself, and only for the document's base plan: the
 * cover named as the document's product, or its only base cover (Critic R418 M2). Anything else is not known. */
export function planTypeOf(cover: { product?: string | null; cover?: string | null; plan?: string | null; riderOf?: string | null },
  fromPages: PlanType | null, reading?: { product?: string | null; baseCovers?: number }): PlanType | null {
  const names = [cover.cover, cover.plan, cover.product];
  if (cover.riderOf || RIDER_NAME.test(cover.cover ?? "") || names.some((n) => n && PROTECTION_WORD.test(n))) return null;
  for (const n of names) {
    const kind = n ? planKindOfName(n) : null;
    if (kind) return { kind, page: null, quote: n! };
  }
  if (!fromPages) return null;
  const isBase = (reading?.product && [cover.cover, cover.plan, cover.product].some((n) => norm(n) && norm(n) === norm(reading.product)) && norm(cover.cover) === norm(cover.product ?? cover.cover))
    || reading?.baseCovers === 1;
  // Without the reading (a caller that has only the cover and its document's sentence) the sentence stands.
  return !reading || isBase ? fromPages : null;
}
