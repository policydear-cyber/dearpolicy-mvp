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
import { flagUnclearFigures } from "@/lib/documents/messy";
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

/** A figure that states no currency but is plainly an amount because a money
 * cue introduces it ("Sum insured: 50,000", "benefit limit 25000"). Without a
 * currency it can be neither shown as money nor relabelled, so before review
 * it is withheld exactly like a currency amount. Only thousands-separated or
 * 4+ digit figures directly after the cue qualify, so "Page 4", "100%" and
 * "90 days" are untouched. */
export const CUED_BARE_AMOUNT_PATTERN = /\b(sums? (?:insured|assured)|benefit(?: amount| limit)?|limit|payable|pays?|coverage|amount)(\s*(?::|=|of|is|up to)?\s*)(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\d%])(?!\s*(?:days?|months?|years?|%))/gi;

export function containsMoney(text: string | null | undefined): boolean {
  return !!text && (new RegExp(MONEY_PATTERN.source, "i").test(text) || new RegExp(CUED_BARE_AMOUNT_PATTERN.source, "i").test(text));
}
export function containsForbiddenPhrase(text: string | null | undefined): boolean {
  return !!text && FORBIDDEN_MONETARY_PHRASES.some((p) => p.test(text));
}

function moneyKey(text: string) { return text.replace(/\s+/g, "").replace(/\.00$/, "").toUpperCase(); }

/** Common ways a figure is written into a sentence, rewritten without it so
 * the sentence still reads ("S$1,000 lump sum." -> "A lump sum."). */
function withoutFigures(text: string): string {
  const M = "(?:" + MONEY_PATTERN.source + ")";
  let out = text
    .replace(new RegExp(M + "\\s*[×x]\\s*\\d+\\s+payable (?:nights?|days?)(?:\\s*\\(after the first \\d+\\))?", "gi"), "a set amount for each payable night")
    .replace(new RegExp("the lower of the reported cost " + M + " and the limit " + M, "gi"), "the lower of the reported cost and the policy limit")
    .replace(new RegExp("(\\d+(?:\\.\\d+)?% of )" + M, "gi"), "$1the sum insured")
    .replace(new RegExp("\\b(?:up to|a maximum of|maximum of|capped at) " + M, "gi"), "up to the policy limit")
    .replace(new RegExp(M + "\\s+lump sum", "gi"), "a lump sum")
    .replace(new RegExp(M + "\\s+(per (?:day|night|month|visit|accident|admission|year|policy year|person|trip))", "gi"), "a set amount $1");
  // A sentence that now starts with a lower-case word starts with a capital.
  out = out.replace(/(^|[.!?]\s+)(a set amount|a lump sum|up to the policy limit|the lower of)/g, (_m, lead: string, word: string) => lead + word.charAt(0).toUpperCase() + word.slice(1));
  return out;
}
export function scrubMonetaryText(text: string): string {
  // Round 9: a premium is what the household pays, never a payout; "the premium of S$86.40 due on ..."
  // keeps its figure instead of reading "the premium of an amount that is only shown after ...".
  let out = withoutFigures(text).replace(new RegExp(MONEY_PATTERN.source, "gi"), (m: string, ...rest: unknown[]) => {
    const wi = rest.map((x) => typeof x).lastIndexOf("string");
    const whole = wi >= 0 ? rest[wi] as string : "", at = wi > 0 && typeof rest[wi - 1] === "number" ? rest[wi - 1] as number : 0;
    const before = whole.slice(Math.max(0, at - 30), at), after = whole.slice(at + m.length, at + m.length + 30);
    return /\bpremiums?(?: of| is| was| due| payable)?:?\s*$/i.test(before) || /^\s*(?:premiums?\b|(?:a|per|each) (?:month|year) in premiums?)/i.test(after) ? m : WITHHELD_AMOUNT_TEXT;
  });
  out = out.replace(new RegExp(CUED_BARE_AMOUNT_PATTERN.source, "gi"), (_m, cue: string, gap: string) => `${cue}${gap}${WITHHELD_AMOUNT_TEXT}`);
  out = out.replace(/the an amount that is only shown after claim evidence has been reviewed\s+([a-z]+) limit/gi, "the $1 limit");
  out = out.replace(/verified an amount that is only shown after claim evidence has been reviewed/gi, "the verified policy limit");
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
  if (!limit.citation?.policyId || !limit.citation.chunkId || !((limit.citation.pageStart ?? 0) > 0) || !limit.quote) return false;
  const digits = limit.quote.replace(/(\d),(?=\d{3}\b)/g, "$1");
  if (!new RegExp(`(^|[^\\d.])${String(limit.amount)}(?![\\d])`).test(digits) && !new RegExp(`(^|[^\\d.])${limit.amount.toLocaleString("en-US")}(?![\\d])`).test(limit.quote)) return false;
  const markers: Record<string, RegExp> = { SGD: /\bSGD\b|(?:^|[^A-Za-z])S\$/, USD: /\bUSD\b|US\$/, EUR: /\bEUR\b|€/, GBP: /\bGBP\b|£/, JPY: /\bJPY\b|¥/ };
  const marker = markers[limit.currency] ?? new RegExp(`\\b${limit.currency}\\b`);
  return marker.test(limit.quote);
}

/** Policy-value questions (maturity, surrender, cash value, premiums) ask what
 * the policy document itself states; they are policy information, not claim
 * assessments, so cited figures from verified policy quotes may be explained.
 * Anything that reports an event, asks what can be claimed/received, or comes
 * from the claim or fact-finding workflow stays inside the pre-review claim
 * boundary. When in doubt this returns true (claim context, fail closed). */
const POLICY_VALUE_QUESTION = /\b(?:matur\w*|endowment|surrender\w*|cash values?|survival benefits?|premiums?)\b/i;
/** A term the policy prints for every claim (an excess, a deductible, a limit). */
const POLICY_TERM_QUESTION = /\b(?:excess|no[- ]?claims? discount|ncd|payouts?|pays? out|deductible|co-?insurance|co-?pay\w*|limits?|premiums?|sums? (?:insured|assured)|waiting period)\b/i;
const CLAIM_AMOUNT_ASKED = /\bhow much (?:can|could|would|will|do|does|did) (?:i|we|he|she|they|you|\w+) (?:claim|get|receive|be paid)\b|\b(?:can|could) (?:i|we|he|she|they) claim\b|\bhow much (?:is|was) (?:the |my |our )?(?:claim|payout)\b/i;
/** Round 11: "ambulance fee can claim or not?", "is TCM claimable?": whether a benefit exists, answered by what the policy prints. */
const COVER_YES_NO = /^(?![^?]*\bhow much\b)[^?]*\b(?:can claim (?:or not|anot)|claimable|can (?:i |we )?claim (?:for )?(?:the |an? )?\w+ (?:or not|anot))\b/i;
const CLAIM_MONEY_QUESTION = /\b(?:claim\w*|payouts?|pays? out|pay\s*out|compensat\w*|reimburs\w*|entitled|settlement)\b/i;
const CLAIM_EVENT = /\b(?:die[sd]?|death|dead|passed away|diagnos\w*|hospital\w*|admitted|accident\w*|injur\w*|cancer|illness|disab\w*|fractur\w*|surgery|operation|delay\w*|damage\w*|stolen|theft|collision|crash\w*|murder\w*|killed)\b/i;
/** V1.1: an answer built only from policy facts that lib/chat/assertions.ts
 * verified against their cited passages (set by lib/chat/policy-answer.ts).
 * Honoured only for a plain answer: no claim items, no composition. */
function verifiedPolicyFactAnswer(answer: Pick<ChatAnswer, "mode" | "claimItems"> & Partial<Pick<ChatAnswer, "verifiedPolicyFactsOnly" | "composition">>) {
  return answer.verifiedPolicyFactsOnly === true && answer.mode === "answer" && answer.claimItems.length === 0 && !answer.composition;
}
export function liveClaimContext(intent: string | undefined, answer: Pick<ChatAnswer, "mode" | "claimItems"> & Partial<Pick<ChatAnswer, "verifiedPolicyFactsOnly" | "composition">>, question = ""): boolean {
  const mode: string = answer.mode;
  if (intent === "claim" || mode !== "answer") return true;
  // "What's the excess on his accident claims?" asks a term the policy prints; "how much can she claim?" asks for an amount.
  if (CLAIM_MONEY_QUESTION.test(question) && !(verifiedPolicyFactAnswer(answer) && (POLICY_TERM_QUESTION.test(question) || COVER_YES_NO.test(question)) && !CLAIM_AMOUNT_ASKED.test(question))) return true;
  // "What is her hospital coverage?" names an event word but asks what the
  // documents state. A verified policy-fact answer states the printed figure;
  // "How much can she claim?" (above) and every claim turn stay scrubbed.
  if (verifiedPolicyFactAnswer(answer)) return false;
  if (CLAIM_EVENT.test(question)) return true;
  if (intent === "policy_question" && POLICY_VALUE_QUESTION.test(question)) return false;
  return answer.claimItems.length > 0;
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
    // A claim turn never carries the policy-fact exemption forward.
    delete answer.verifiedPolicyFactsOnly; delete answer.verifiedPolicyFigures;
    answer.summary = scrubMonetaryText(answer.summary);
    answer.details = answer.details.map(scrubMonetaryText);
    answer.nextSteps = answer.nextSteps.map(scrubMonetaryText);
    answer.missingFacts = answer.missingFacts.map(scrubMonetaryText);
    if (answer.assessmentKind === "preliminary") answer.disclaimer = PRELIMINARY_ASSESSMENT_NOTICE;
  } else {
    answer.summary = answer.summary.replace(/potential payouts?/gi, "possible benefit");
    // A verified policy-fact answer may show only the figures its verified
    // assertions state; anything else in its text is withheld.
    if (verifiedPolicyFactAnswer(answer)) {
      const allowed = new Set((answer.verifiedPolicyFigures ?? []).map(moneyKey));
      const keep = (text: string) => text
        .replace(new RegExp(MONEY_PATTERN.source, "gi"), (m) => allowed.has(moneyKey(m)) ? m : WITHHELD_AMOUNT_TEXT)
        .replace(new RegExp(CUED_BARE_AMOUNT_PATTERN.source, "gi"), (_m, cue: string, gap: string) => `${cue}${gap}${WITHHELD_AMOUNT_TEXT}`);
      answer.summary = keep(answer.summary);
      answer.details = answer.details.map(keep);
      answer.nextSteps = answer.nextSteps.map(keep);
    }
  }
  if (answer.composition) answer.composition = { ...answer.composition, disclaimer: INDICATIVE_ESTIMATE_NOTICE };
  // Round 10: a figure or year a scan printed unclearly ("S$12,5OO", "2O18")
  // is never shown as a figure: it is said to be unclear, in every line.
  answer.summary = flagUnclearFigures(answer.summary);
  answer.details = answer.details.map(flagUnclearFigures);
  answer.nextSteps = answer.nextSteps.map(flagUnclearFigures);
  answer.claimItems = answer.claimItems.map((item) => ({ ...item, reason: flagUnclearFigures(item.reason), conditions: item.conditions.map(flagUnclearFigures) }));
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
