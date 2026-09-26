/**
 * The ONE boundary every live-chat answer passes through before it is shown,
 * persisted, narrated by a model, recorded as a claim, or read back from
 * history. It enforces the binding V1 product decision on money in chat:
 *
 *  1. Policy-stated coverage limit -- a benefit/maximum amount copied
 *     deterministically from the current active policy, its page cited and
 *     its currency written in the cited wording. Shown only as a typed
 *     PolicyStatedLimit (never inside a claim card), labelled
 *     POLICY_STATED_LIMIT_LABEL with POLICY_STATED_LIMIT_NOTICE, and never
 *     totalled. Built only by lib/chat/policy-analysis.ts's
 *     policyStatedLimitFor().
 *  2. Preliminary claim assessment -- live chat never has reviewed claim
 *     evidence, so every event-specific amount (calculatedAmount,
 *     amountText, currency, totals, settlement qualifiers) is removed here.
 *     Benefits keep their title, conditions and a PreliminaryClaimStatus.
 *  3. Indicative claim estimate -- only the evidence-gated deterministic
 *     composition path (lib/claims/composition) may produce one; it is
 *     carried as ChatAnswer.composition and always shown with
 *     INDICATIVE_ESTIMATE_NOTICE.
 *
 * Free text (summary, details, next steps, conditions, reasons) in a claim
 * context is scrubbed of every money figure: a model may explain, never
 * state, create, sum, convert or relabel an amount. Idempotent.
 */
import type { ChatAnswer, ClaimItem, PolicyStatedLimit, PreliminaryClaimStatus } from "@/types";

export const POLICY_STATED_LIMIT_LABEL = "Policy-stated coverage limit" as const;
export const POLICY_STATED_LIMIT_NOTICE = "This is the maximum or benefit amount stated in the policy. It is not an estimate of what the insurer will pay for this event.";
export const INDICATIVE_ESTIMATE_NOTICE = "Indicative estimate based on the policies, facts and reviewed evidence currently on file. The insurer determines eligibility and the final amount after assessment.";
export const PRELIMINARY_ASSESSMENT_NOTICE = "Preliminary claim assessment: DearPolicy has not reviewed claim evidence for this event, so it does not estimate what the insurer will pay. It lists the benefits that may be relevant, their conditions, and the facts and documents still needed.";
export const WITHHELD_AMOUNT_TEXT = "an amount that is only shown after claim evidence has been reviewed";

/** Phrases that must never describe an amount before reviewed evidence. */
export const FORBIDDEN_MONETARY_PHRASES: RegExp[] = [
  /potential payouts?/i, /potential reimbursements?/i, /claimable amounts?/i, /expected payouts?/i,
  /estimated settlements?/i, /amounts? you will receive/i, /approved amounts?/i, /estimated claim amounts?/i,
  /you (?:can|could|will|would|should) (?:claim|receive|get) (?:up to |about |around )?(?:S\$|US\$|\$|SGD|USD)/i,
];

const CURRENCY_CODES = "SGD|USD|EUR|GBP|JPY|AUD|CAD|MYR|PHP|CNY|HKD|INR|THB|KRW|IDR|NZD|CHF";
/** Any money-looking figure: a currency code or symbol next to a number. */
export const MONEY_PATTERN = new RegExp(
  `(?:\\b(?:${CURRENCY_CODES})\\s?|(?:\\b(?:S|US|A|C|HK|NZ))?\\$\\s?|[€£¥]\\s?)\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:k|m|mil|million|thousand|bn|billion)\\b)?` +
  `|\\b\\d[\\d,]*(?:\\.\\d+)?\\s?(?:${CURRENCY_CODES}|dollars?)\\b`,
  "gi",
);

export function containsMoney(text: string | null | undefined): boolean {
  return !!text && new RegExp(MONEY_PATTERN.source, "i").test(text);
}
export function containsForbiddenPhrase(text: string | null | undefined): boolean {
  return !!text && FORBIDDEN_MONETARY_PHRASES.some((p) => p.test(text));
}

export function scrubMonetaryText(text: string): string {
  let out = text.replace(new RegExp(MONEY_PATTERN.source, "gi"), WITHHELD_AMOUNT_TEXT);
  out = out.replace(/potential payouts?|expected payouts?|claimable amounts?|estimated claim amounts?|estimated settlements?|approved amounts?|amounts? you will receive/gi, "possible benefit");
  out = out.replace(/potential reimbursements?/gi, "possible reimbursement");
  out = out.replace(/you (can|could|will|would|should) (claim|receive|get) (up to |about |around )?/gi, "the policy may respond with ");
  return out;
}

function preliminaryStatusFor(item: ClaimItem): PreliminaryClaimStatus {
  if (item.status === "not_applicable") return "not_applicable";
  const text = [item.reason, ...item.conditions].join(" ").toLowerCase();
  if (/still needed:|not yet known|reported as unknown|when did|which /.test(text)) return "information_needed";
  if (/definition|double-checked|claim evidence must confirm|insurer must confirm|reviewer/.test(text)) return "reviewer_assessment_needed";
  if (/exclusion|waiting period|condition|not yet verified|could not check/.test(text)) return "policy_condition_unresolved";
  return "evidence_needed";
}

function sameLimit(a: PolicyStatedLimit, b: PolicyStatedLimit) {
  return a.amount === b.amount && a.currency === b.currency && a.citation.policyId === b.citation.policyId && a.citation.pageStart === b.citation.pageStart && a.benefitTitle === b.benefitTitle;
}

/** A PolicyStatedLimit is accepted only if it is structurally complete and
 * its amount and currency are literally present in its own quoted clause. */
export function isValidPolicyStatedLimit(limit: PolicyStatedLimit | undefined | null): limit is PolicyStatedLimit {
  if (!limit || limit.kind !== "policy_stated_limit" || limit.label !== POLICY_STATED_LIMIT_LABEL || limit.notice !== POLICY_STATED_LIMIT_NOTICE) return false;
  if (!Number.isFinite(limit.amount) || limit.amount <= 0 || !/^[A-Z]{3}$/.test(limit.currency)) return false;
  if (!limit.citation?.policyId || !limit.citation.chunkId || !(limit.citation.pageStart > 0) || !limit.quote) return false;
  const digits = limit.quote.replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (!new RegExp(`(^|[^\\d.])${String(limit.amount)}(?![\\d])`).test(digits) && !new RegExp(`(^|[^\\d.])${limit.amount.toLocaleString("en-US")}(?![\\d])`).test(limit.quote)) return false;
  const markers: Record<string, RegExp> = { SGD: /\bSGD\b|(?:^|[^A-Za-z])S\$/, USD: /\bUSD\b|US\$/, EUR: /\bEUR\b|€/, GBP: /\bGBP\b|£/, JPY: /\bJPY\b|¥/ };
  const marker = markers[limit.currency] ?? new RegExp(`\\b${limit.currency}\\b`);
  return marker.test(limit.quote);
}

export function enforceLiveChatMonetaryBoundary(answer: ChatAnswer, options: { claimContext?: boolean } = {}): ChatAnswer {
  const limits: PolicyStatedLimit[] = [...(answer.policyStatedLimits ?? [])].filter(isValidPolicyStatedLimit);
  const claimContext = options.claimContext ?? (answer.mode !== "answer" || answer.claimItems.length > 0);
  answer.claimItems = answer.claimItems.map((item) => {
    if (isValidPolicyStatedLimit(item.policyStatedLimit) && !limits.some((l) => sameLimit(l, item.policyStatedLimit!))) limits.push(item.policyStatedLimit);
    const stripped: ClaimItem = {
      ...item,
      status: item.status === "likely_applicable" || item.status === "potentially_applicable" ? item.status : item.status,
      amountText: null,
      reason: scrubMonetaryText(item.reason),
      conditions: item.conditions.map(scrubMonetaryText),
    };
    delete stripped.amountLabel; delete stripped.calculatedAmount; delete stripped.currency; delete stripped.aggregation;
    delete stripped.coverAmount; delete stripped.estimateBasis; delete stripped.policyStatedLimit;
    stripped.preliminaryStatus = preliminaryStatusFor(stripped);
    return stripped;
  });
  answer.policyStatedLimits = limits;
  answer.potentialPayoutTotals = [];
  answer.payoutQualifiers = [];
  if (answer.composition) answer.assessmentKind = "indicative";
  else if (claimContext && answer.claimItems.length) answer.assessmentKind = "preliminary";
  if (claimContext) {
    answer.summary = scrubMonetaryText(answer.summary);
    answer.details = answer.details.map(scrubMonetaryText);
    answer.nextSteps = answer.nextSteps.map(scrubMonetaryText);
    answer.missingFacts = answer.missingFacts.map(scrubMonetaryText);
    if (answer.assessmentKind === "preliminary") answer.disclaimer = PRELIMINARY_ASSESSMENT_NOTICE;
  } else {
    answer.summary = answer.summary.replace(/potential payouts?/gi, "possible benefit");
  }
  if (answer.composition) answer.composition = { ...answer.composition, disclaimer: INDICATIVE_ESTIMATE_NOTICE };
  return answer;
}

/** Read-side boundary for answers persisted before this boundary existed
 * (chat_messages.answer_json, chat_analysis_jobs.result_json): an old
 * "Potential payout" message is never re-served, or reused, as a current
 * calculation. Anything that is not a recognisable answer is returned as-is. */
export function sanitizeStoredAnswer<T>(stored: T): T {
  if (!stored || typeof stored !== "object") return stored;
  const candidate = stored as unknown as { answer?: unknown };
  if (candidate.answer && typeof candidate.answer === "object") {
    return { ...(stored as object), answer: sanitizeStoredAnswer(candidate.answer) } as T;
  }
  const answer = stored as unknown as Partial<ChatAnswer>;
  if (!Array.isArray(answer.claimItems) || typeof answer.summary !== "string") return stored;
  const copy = JSON.parse(JSON.stringify(answer)) as ChatAnswer;
  copy.details = Array.isArray(copy.details) ? copy.details : [];
  copy.nextSteps = Array.isArray(copy.nextSteps) ? copy.nextSteps : [];
  copy.missingFacts = Array.isArray(copy.missingFacts) ? copy.missingFacts : [];
  copy.claimItems = copy.claimItems.map((item) => ({ ...item, conditions: Array.isArray(item.conditions) ? item.conditions : [], reason: typeof item.reason === "string" ? item.reason : "" }));
  return enforceLiveChatMonetaryBoundary(copy) as unknown as T;
}
