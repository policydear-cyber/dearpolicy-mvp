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
import { recomputeCalculation } from "@/lib/claims/calc-record";
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
  // "Never mind the claim. How much is her hospital cash?" sets the claim
  // aside: the words doing that are not a question about claim money.
  question = question.replace(/\b(?:never\s*mind|forget(?:\s+about)?|stop|drop|cancel|leave|skip|pause|park)\b[^.?!]{0,20}\bclaims?\b[^.?!]*[.!]?/gi, " ");
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


// ------------------------------------------------------------------ Round 6c: whole sentences, verified printed figures
/** Said once when a sentence stating an amount had to be left out (the amount is never replaced inside a sentence). */
export const WITHHELD_SENTENCE_NOTE = "I left out a sentence that stated an amount: until claim evidence has been reviewed, I only show amounts printed in your policy and checked against it.";
const squashText = (t: string) => (t ?? "").toLowerCase().normalize("NFKC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const sentenceParts = (t: string) => (t ?? "").split(/(?<=[.!?])\s+(?=[A-Z“"(])/).filter((x) => x.trim());
/** The value and currency a written money figure states (null when its currency is not written unambiguously). */
function writtenMoney(raw: string): { value: number; currency: string } | null {
  const r = raw.replace(/\s+/g, "");
  const n = Number((r.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = /(?:m|mil|million)$/i.test(r) ? 1e6 : /(?:k|thousand)$/i.test(r) ? 1e3 : /(?:bn|billion)$/i.test(r) ? 1e9 : 1;
  const cur = /^S\$|SGD/i.test(r) ? "SGD" : /^US\$|USD/i.test(r) ? "USD" : (r.match(new RegExp(`\\b(${CURRENCY_CODES})\\b`, "i"))?.[1]?.toUpperCase() ?? null);
  return cur ? { value: n * mult, currency: cur } : null;
}
/** A printed policy figure the answer carries a FigureBinding for, in the sentence that states it -- never a figure
 * of a sentence that is a computation or a calculated estimate (those stay gated by their own records). The save-time
 * gate (lib/chat/answer-verification.ts) verifies every such binding against the cited page. */
function printedFigureCheck(answer: ChatAnswer): { ok: (sentence: string, raw: string) => boolean; used: Map<string, NonNullable<ChatAnswer["figureBindings"]>[number]> } {
  const gated = [...(answer.computations ?? []), ...(answer.calculations ?? []).filter((k) => k?.kind !== "conditional_illustration")].map((r) => squashText((r as { sentence?: string }).sentence ?? "")).filter(Boolean);
  const illustrations = (answer.calculations ?? []).filter((k) => k?.kind === "conditional_illustration").map((k) => ({ s: squashText(k.sentence ?? ""), v: k.result?.value, c: k.result?.currency }));
  const bound = (answer.figureBindings ?? []).filter((b) => b && typeof b.sentence === "string" && b.sentence.trim() && b.policyId && b.passage && Number.isFinite(b.value) && b.currency);
  const used = new Map<string, (typeof bound)[number]>();
  const ok = (sentence: string, raw: string) => {
    const s = squashText(sentence), m = writtenMoney(raw);
    if (!m || gated.some((g) => s.includes(g) || g.includes(s))) return false;
    if (illustrations.some((k) => k.s && (s.includes(k.s) || k.s.includes(s)) && Math.abs((k.v ?? NaN) - m.value) < 1e-9 && k.c === m.currency)) return true;
    const b = bound.find((x) => { const bs = squashText(x.sentence); return (s.includes(bs) || bs.includes(s)) && Math.abs(x.value - m.value) < 1e-9 && x.currency.toUpperCase() === m.currency; });
    if (b) used.set(`${b.policyId}|${b.pageStart}|${b.benefit}|${b.value}|${b.currency}`, b);
    return !!b;
  };
  return { ok, used };
}
const PREMIUM_BEFORE = /\bpremiums?(?: of| is| was| due| payable)?:?\s*$/i, PREMIUM_AFTER = /^\s*(?:premiums?\b|(?:a|per|each) (?:month|year) in premiums?)/i;
const PHRASES: [RegExp, string][] = [
  [/potential payouts?|expected payouts?|claimable amounts?|estimated claim amounts?|estimated settlements?|approved amounts?|amounts? you will receive/gi, "possible benefit"],
  [/potential reimbursements?/gi, "possible reimbursement"],
  [/you (can|could|will|would|should) (claim|receive|get) (up to |about |around )?/gi, "the policy may respond with "],
];
/** The text with every sentence that states an amount it may not show removed WHOLE (a common phrasing is first
 * rewritten without its figure: "S$1,000 lump sum" -> "a lump sum"); a premium figure and a figure `keep` accepts
 * stay. Never splices placeholder wording into a sentence. */
export function withholdSentences(text: string, keep: (sentence: string, raw: string) => boolean = () => false): { text: string; dropped: number } {
  let dropped = 0;
  const kept: string[] = [];
  for (const sentence of sentenceParts(text ?? "")) {
    const figures = (x: string) => [...x.matchAll(new RegExp(MONEY_PATTERN.source, "gi"))].filter((m) => !(PREMIUM_BEFORE.test(x.slice(Math.max(0, m.index! - 30), m.index!)) || PREMIUM_AFTER.test(x.slice(m.index! + m[0].length, m.index! + m[0].length + 30)))).map((m) => m[0]);
    const cued = (x: string) => new RegExp(CUED_BARE_AMOUNT_PATTERN.source, "i").test(x);
    let out = sentence;
    if (figures(out).some((f) => !keep(sentence, f)) || cued(out)) {
      out = withoutFigures(out);
      if (figures(out).length || cued(out)) { dropped++; continue; }
    }
    for (const [re, to] of PHRASES) out = out.replace(re, to);
    kept.push(out);
  }
  return { text: kept.join(" "), dropped };
}
/** The answer's text fields with unshowable sentences removed, and the one honest note when any was. */
function withholdAnswerText(answer: ChatAnswer, keep: (sentence: string, raw: string) => boolean): void {
  let dropped = 0;
  const pass = (t: string) => { const r = withholdSentences(t, keep); dropped += r.dropped; return r.text; };
  answer.summary = pass(answer.summary);
  answer.details = answer.details.map(pass).filter((d) => d.trim());
  answer.nextSteps = answer.nextSteps.map(pass).filter((d) => d.trim());
  answer.missingFacts = answer.missingFacts.map(pass).filter((d) => d.trim());
  if (dropped) {
    if (!answer.summary.trim()) answer.summary = WITHHELD_SENTENCE_NOTE;
    else if (answer.summary !== WITHHELD_SENTENCE_NOTE && !answer.details.includes(WITHHELD_SENTENCE_NOTE)) answer.details.push(WITHHELD_SENTENCE_NOTE);
  }
}
/** Round 6c: a printed figure kept because of its verified binding is labelled as the existing policy-stated-limit
 * source labels one (POLICY_STATED_LIMIT_LABEL with POLICY_STATED_LIMIT_NOTICE, its own binding, never totalled). */
function limitsFromBindings(answer: ChatAnswer, used: ReturnType<typeof printedFigureCheck>["used"], limits: PolicyStatedLimit[]): void {
  for (const b of used.values()) {
    const citation = (answer.citations ?? []).find((c) => c.policyId === b.policyId && (c.pageStart ?? -1) <= b.pageStart && b.pageStart <= (c.pageEnd ?? c.pageStart ?? -1))
      ?? { chunkId: `binding:${b.policyId}:${b.pageStart}`, policyId: b.policyId, policyName: "Policy document", pageStart: b.pageStart, pageEnd: b.pageEnd, excerpt: b.passage };
    const amountText = (b.currency === "SGD" ? "S$" : b.currency + " ") + b.value.toLocaleString("en-SG", { minimumFractionDigits: Number.isInteger(b.value) ? 0 : 2 });
    const limit: PolicyStatedLimit = { kind: "policy_stated_limit", label: POLICY_STATED_LIMIT_LABEL, notice: POLICY_STATED_LIMIT_NOTICE, benefitTitle: b.benefit, ownerName: null, amount: b.value, currency: b.currency, amountText, quote: b.passage, citation, binding: { policyId: b.policyId, subjectId: b.subjectId, benefit: b.benefit, documentHash: b.documentHash, pageStart: b.pageStart, pageEnd: b.pageEnd, passage: b.passage, ...(b.column !== undefined ? { column: b.column } : {}) } };
    if (isValidPolicyStatedLimit(limit) && !limits.some((l) => sameLimit(l, limit))) limits.push(limit);
  }
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
    // Round 6c: a sentence is shown whole or not at all. A figure printed in the policy and bound to its page (the
    // save-time gate verifies the binding) is shown, labelled as a policy-stated limit; payout and estimate amounts
    // (and anything unbound) are never shown before review -- their sentence is left out, with one honest note.
    const printed = printedFigureCheck(answer);
    withholdAnswerText(answer, printed.ok);
    limitsFromBindings(answer, printed.used, limits);
    answer.policyStatedLimits = limits;
    if (answer.assessmentKind === "preliminary") answer.disclaimer = PRELIMINARY_ASSESSMENT_NOTICE;
  } else {
    answer.summary = answer.summary.replace(/potential payouts?/gi, "possible benefit");
    // A verified policy-fact answer may show only the figures its verified
    // assertions state; anything else in its text is withheld.
    if (verifiedPolicyFactAnswer(answer)) {
      const allowed = new Set((answer.verifiedPolicyFigures ?? []).map(moneyKey));
      // Round 6c: a sentence with an unverified figure is left out whole (never a placeholder inside it).
      withholdAnswerText(answer, (_sentence, raw) => allowed.has(moneyKey(raw)));
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
  // Production fracture conversation (19 Oct 2026): the conversational loop's answer was written with claimContext:false, but a
  // question turn has mode "fact_finding", which the default reads as a claim turn, so reopening the conversation left out the
  // illustrations and added "I left out a sentence that stated an amount": what was shown was not what was saved. Reopening applies
  // the context the answer was WRITTEN under -- when its provenance validates (see storedRenderContext). A calculation count alone
  // proves nothing about the rest of an answer; anything that does not validate is read under the default, claim-aware context.
  const written = storedRenderContext(copy);
  return enforceLiveChatMonetaryBoundary(copy, written === null ? {} : { claimContext: written }) as unknown as T;
}

/** The numbers a stored record states (its result and its own operands), as money amounts. */
function recordAmounts(r: { result?: { value?: unknown }; operands?: unknown[]; value?: unknown }): Set<number> {
  const out = new Set<number>();
  const add = (n: unknown) => { if (typeof n === "number" && Number.isFinite(n)) out.add(Math.round(n * 100) / 100); };
  add(r.result?.value); add(r.value);
  for (const o of r.operands ?? []) { const x = o as { value?: unknown; result?: { value?: unknown }; computation?: { result?: { value?: unknown } } }; add(x?.value); add(x?.result?.value); add(x?.computation?.result?.value); }
  return out;
}
const asAmount = (raw: string): number | null => {
  const m = /(\d[\d,]*(?:\.\d+)?)\s?(k|m|mil|million|thousand|bn|billion)?\b/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  const mult = m[2] ? ({ k: 1e3, thousand: 1e3, m: 1e6, mil: 1e6, million: 1e6, bn: 1e9, billion: 1e9 } as Record<string, number>)[m[2].toLowerCase()] ?? NaN : 1;
  return Number.isFinite(n * mult) ? Math.round(n * mult * 100) / 100 : null;
};
const flat = (t: string) => t.replace(/\s+/g, " ").trim();
/**
 * The monetary-boundary context a stored answer was written under, when that can be shown (null = use the default, claim-aware context).
 * It is honoured only when ALL of these hold: the conversational loop recorded it (renderContext) -- an answer saved before that, or by the
 * claim pipeline, has none; the answer carries no claim items or composition and at least one stored calculation; every stored calculation recomputes from its own operands
 * and steps; and every money figure in the visible text is stated by a sentence that a stored, re-verifiable record (a calculation, a
 * computation or a figure binding) carries and is one of that record's own numbers. The monetary boundary itself and the document
 * lifecycle checks (lib/chat/stale-answers.ts) still run on top of it: only the claim/non-claim reading of the text is restored.
 */
export function storedRenderContext(a: Partial<ChatAnswer>): boolean | null {
  const rc = a.renderContext;
  if (!rc || rc.origin !== "rag_loop" || rc.claimContext !== false) return null;
  if ((a.claimItems?.length ?? 0) > 0 || a.composition) return null;
  const calcs = Array.isArray(a.calculations) ? a.calculations : [];
  // (the restored context exists for the answers that carry re-verifiable calculations -- the production defect; an answer without one is read
  // exactly as before: under the default context, which also labels the printed figures it states as policy-stated limits)
  if (!calcs.length) return null;
  for (const c of calcs) if (!c || typeof c.sentence !== "string" || !c.sentence || !recomputeCalculation(c).ok) return null;
  const records = [
    ...calcs.map((c) => ({ sentence: flat(c.sentence), amounts: recordAmounts(c) })),
    ...(Array.isArray(a.computations) ? a.computations : []).filter((c) => c && typeof c.sentence === "string" && c.sentence).map((c) => ({ sentence: flat(c.sentence), amounts: recordAmounts(c) })),
    ...(Array.isArray(a.figureBindings) ? a.figureBindings : []).filter((b) => b && typeof b.sentence === "string" && b.sentence).map((b) => ({ sentence: flat(b.sentence), amounts: recordAmounts({ value: b.value }) })),
  ];
  const texts = [a.summary, ...(a.details ?? []), ...(a.nextSteps ?? [])].filter((t): t is string => typeof t === "string");
  for (const t of texts) {
    const text = flat(t);
    for (const m of text.matchAll(new RegExp(MONEY_PATTERN.source, "gi"))) {
      const v = asAmount(m[0]);
      // (PR #57 follow-up, critic L1: the figure must lie INSIDE a record's own sentence -- a second sentence repeating it as "you can claim
      // S$2,500" is not that record's statement)
      const at = m.index ?? -1;
      const inside = (r: { sentence: string }) => { for (let i = text.indexOf(r.sentence); i >= 0; i = text.indexOf(r.sentence, i + 1)) if (at >= i && at + m[0].length <= i + r.sentence.length) return true; return false; };
      if (v == null || !records.some((r) => r.sentence && r.amounts.has(v) && inside(r))) return null;
    }
  }
  return false;
}
