import type { CompositionType } from "./types";

export type CompositionSignal = {
  /** V1 only detects relationships between the two benefit codes this
   * codebase currently calculates deterministically for one policy's own
   * wording (`gtl-death`, `gpa-accidental-death`) -- see the composition
   * engine's own doc comment for why cross-policy relationships and other
   * benefit codes are out of scope for this slice. */
  compositionType: Extract<CompositionType, "alternative_highest" | "accelerated_from_base" | "additional_to_base">;
  quote: string;
  page: number;
  pageEnd: number;
};

type Page = { page_number: number; text: string };

const ALTERNATIVE_PATTERN = /\b(?:in\s+lieu\s+of|not\s+payable\s+(?:in\s+addition\s+to|together\s+with|together)|higher\s+of\s+the\s+two|whichever\s+is\s+(?:the\s+)?(?:higher|greater)|either.{1,80}\bor\b.{0,40}\bnot\s+both\b)\b[^.]{0,200}/gis;
const ACCELERATED_PATTERN = /\b(?:accelerat(?:es|ed|ion|ory)|advance\s+payment\s+of\s+(?:the\s+)?(?:death|sum\s+insured)|will\s+reduce\s+the\s+(?:death\s+)?(?:benefit|sum\s+insured)\s+payable)\b[^.]{0,200}/gis;
const ADDITIONAL_PATTERN = /\b(?:payable\s+in\s+addition\s+to|in\s+addition\s+to\s+(?:any\s+)?(?:other\s+)?benefit|on\s+top\s+of\s+(?:the\s+)?(?:death\s+)?benefit)\b[^.]{0,200}/gis;

function pageFor(pages: Page[], offset: number, joinedOffsets: { start: number; page: number }[]) {
  return joinedOffsets.filter((p) => p.start <= offset).at(-1)?.page ?? pages[0]?.page_number ?? 1;
}

/**
 * Deterministic, evidence-backed detection of composition relationships
 * between the two benefits this codebase currently calculates for one
 * policy's own wording. Every returned signal carries the exact quote and
 * page it was read from -- nothing here is inferred from a benefit's name
 * or product label, only from explicit relationship language actually
 * present in the uploaded wording. Returns no signal (an empty array) when
 * the wording says nothing explicit, which is the correct, safe default:
 * the composition engine treats two benefits under one policy as
 * `independent_additive` only when nothing here says otherwise, and NEVER
 * infers an alternative/accelerated/additional relationship on its own.
 *
 * V1 scope: this only looks WITHIN one policy's own wording pages, so a
 * relationship stated across two separate policy documents (for example, a
 * master wording that describes how a rider interacts with a base policy
 * issued as a separate document) is not detected -- documented as a known
 * limitation in the composition engine's PR description.
 */
export function findCompositionSignals(pages: Page[]): CompositionSignal[] {
  if (pages.length === 0) return [];
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number });
    joined += `${page.text}\n`;
  }
  const signals: CompositionSignal[] = [];
  const scan = (pattern: RegExp, compositionType: CompositionSignal["compositionType"]) => {
    for (const match of joined.matchAll(pattern)) {
      const quote = match[0].trim();
      if (!quote) continue;
      const start = match.index!;
      const end = start + match[0].length;
      signals.push({ compositionType, quote, page: pageFor(pages, start, offsets), pageEnd: pageFor(pages, Math.max(start, end - 1), offsets) });
    }
  };
  scan(ALTERNATIVE_PATTERN, "alternative_highest");
  scan(ACCELERATED_PATTERN, "accelerated_from_base");
  scan(ADDITIONAL_PATTERN, "additional_to_base");
  return signals;
}

export type AggregateCapSignal = {
  scope: "coverage" | "benefit_group" | "policy" | "event" | "lifetime";
  amount: number;
  currency: string;
  quote: string;
  page: number;
  pageEnd: number;
};

const CAP_PATTERN = /\b(?:aggregate\s+lifetime|lifetime)\s+(?:maximum|limit|cap)(?:\s+benefit)?\s+(?:of|payable\s+(?:shall|will|is)\s+not\s+exceed)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)|\b(?:aggregate|overall|combined|total)\s+(?:maximum|limit|cap)\s+(?:of|payable\s+under\s+this\s+(?:policy|event)\s+(?:shall|will|is)\s+not\s+exceed)\s+((?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*[\d,]+(?:\.\d+)?)\s*(?:per\s+(?:event|policy\s+year|life))?/gis;
const MONEY_PATTERN = /(?:S\$|SGD|USD|US\$|MYR|EUR|GBP)\s*([\d,]+(?:\.\d+)?)/i;
// Explicit cross-policy language required before a "per event" clause is
// ever classified as "event" scope (applied across every policy in the
// claim by engine.ts's applyEventScopeCaps()) rather than the narrower,
// safer "policy" scope. Deliberately conservative/whitelist-based --
// "per event" alone is common, ordinary single-policy wording and must
// never be enough on its own (Defect D3).
const CROSS_POLICY_PATTERN = /\bacross\s+(?:all|every)\s+(?:the\s+)?(?:polic(?:y|ies)|covers?)\b|\ball\s+covers\b|\ball\s+policies\b/i;
function currencyOf(text: string) {
  if (/\bUS\$|USD\b/i.test(text)) return "USD";
  if (/\bS\$|SGD\b/i.test(text)) return "SGD";
  if (/\bMYR\b/i.test(text)) return "MYR";
  if (/\bEUR|€/i.test(text)) return "EUR";
  if (/\bGBP|£/i.test(text)) return "GBP";
  return "SGD";
}

/** Evidence-backed aggregate-cap detection, same pattern as
 * findCompositionSignals(): only an explicit, quoted maximum is ever
 * returned, never a guessed or inferred ceiling. `scope` is "lifetime" for
 * an explicit "lifetime maximum of $X" statement, "event" ONLY when the
 * quote says "per event" AND also contains explicit cross-policy language
 * (e.g. "across all policies", "across every policy", "all covers") --
 * otherwise "policy". This is a fail-closed default: ordinary, common
 * single-policy wording like "The aggregate maximum of S$50,000 per event
 * shall be payable under this policy in respect of any one Event" says
 * nothing about applying across OTHER policies, so it must resolve to the
 * narrower "policy" scope, never "event" -- the composition engine applies
 * an "event" cap against every included benefit across every policy in the
 * claim (see engine.ts's applyEventScopeCaps()), so misclassifying an
 * ordinary single-policy cap as "event" scope would let one policy's own
 * cap wrongly zero out or reduce a completely different, uncapped policy.
 * (Defect D3, reported by an independent audit: this exact misclassification
 * caused an 86% / ~S$300,000 underpayment on a reproduced two-policy
 * fixture before this fail-closed check was added.) A lifetime cap's
 * AMOUNT can come from wording like any other cap, but the composition
 * engine only ever DEDUCTS against it using an explicit, user-reported
 * prior-paid-amount fact -- never a guess -- and blocks the affected
 * benefit closed when wording establishes a lifetime cap but no prior-paid
 * amount is on file. */
export function findAggregateCapSignals(pages: Page[]): AggregateCapSignal[] {
  if (pages.length === 0) return [];
  let joined = "";
  const offsets: { start: number; page: number }[] = [];
  for (const page of [...pages].sort((a, b) => a.page_number - b.page_number)) {
    offsets.push({ start: joined.length, page: page.page_number });
    joined += `${page.text}\n`;
  }
  const signals: AggregateCapSignal[] = [];
  for (const match of joined.matchAll(CAP_PATTERN)) {
    const isLifetime = match[1] != null;
    const moneyText = match[1] ?? match[2];
    const money = moneyText?.match(MONEY_PATTERN);
    if (!money) continue;
    const amount = Number(money[1].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const quote = match[0].trim();
    const start = match.index!;
    const end = start + match[0].length;
    // "event" scope is reserved for wording that BOTH says "per event" AND
    // explicitly says the cap applies across other policies -- see the
    // module doc comment above (Defect D3). Anything narrower (including
    // ordinary "per event ... payable under this policy" wording, which
    // says nothing about other policies) fails closed to "policy" scope.
    // The cross-policy check reads a WIDER window than `quote` on purpose:
    // CAP_PATTERN's own match ends right after "per event" (or the money
    // amount), so genuinely cross-policy language like "...applies across
    // all policies for this event" -- which comes AFTER that point in the
    // sentence -- would never be seen if only the narrow `quote` were
    // checked. This window never widens `quote` itself (the returned
    // evidence citation stays exactly what CAP_PATTERN matched); it only
    // widens what the scope check is allowed to look at, out to the end
    // of the same sentence (or 200 chars, whichever is shorter).
    const sentenceEnd = joined.indexOf(".", end);
    const contextEnd = sentenceEnd === -1
      ? Math.min(joined.length, end + 200)
      : Math.min(sentenceEnd + 1, end + 200);
    const scopeContext = joined.slice(start, contextEnd);
    const scope: AggregateCapSignal["scope"] = isLifetime
      ? "lifetime"
      : /per\s+event/i.test(quote) && CROSS_POLICY_PATTERN.test(scopeContext)
        ? "event"
        : "policy";
    signals.push({ scope, amount, currency: currencyOf(moneyText!), quote, page: pageFor(pages, start, offsets), pageEnd: pageFor(pages, Math.max(start, end - 1), offsets) });
  }
  return signals;
}
