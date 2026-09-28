/**
 * Whether a benefit can be offered as a POSSIBLE benefit for a reported
 * event (V1.1): only from a policy that was current on the event date, and
 * only where it fits where the event happened. A benefit that fails either
 * test keeps its card, labelled with the reason, and is never named as a
 * possible benefit (lib/chat/fact-finding-chat.ts, finalizeClaimAnswer).
 *
 *  - Expired: the policy's own renewal/expiry date has passed with no later
 *    premium or renewal evidence (lib/policies/currentness.ts,
 *    "expiry_date_passed"), and the event did not happen on or before that
 *    date. An expired travel policy's "Overseas medical expenses" is not a
 *    possible benefit for a fracture last week.
 *  - Location: cover that pays only for events overseas (travel policies,
 *    overseas / evacuation / repatriation benefits) is not a possible benefit
 *    for an event in Singapore.
 */
export type EventFitIssue = { kind: "expired" | "location"; text: string };

const UNKNOWN = /^(?:not sure|unsure|unknown|not yet known|don'?t know)$/i;
export function meaningfulFact(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text && !UNKNOWN.test(text) ? text : null;
}
const OVERSEAS_ONLY = /\b(?:overseas|abroad|outside (?:of )?singapore|travel|trip|journey|evacuat\w*|repatriat\w*|baggage|flight)\b/i;
/** Cover that exists only for events away from home. */
export function overseasOnly(benefitTitle: string, policyType: string | null | undefined) {
  return OVERSEAS_ONLY.test(benefitTitle) || /\btravel\b/i.test(policyType ?? "");
}
/** The event happened in Singapore (and nothing says it was overseas). */
export function happenedInSingapore(location: string | null) {
  return !!location && /\bsingapore\b/i.test(location) && !/overseas|abroad/i.test(location);
}
function isoDay(value: string | null | undefined) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}
export function eventFitIssue(args: {
  benefitTitle: string;
  policyType?: string | null;
  /** The policy's latest printed renewal or expiry date. */
  expiryDate?: string | null;
  /** True when currentness is "expiry_date_passed" (no renewal evidence since). */
  expiryPassed: boolean;
  eventDate?: string | null;
  eventLocation?: string | null;
  /** The event itself is a trip (a travel claim): location does not rule cover out. */
  travelEvent?: boolean;
}): EventFitIssue | null {
  const expiry = isoDay(args.expiryDate);
  const eventDay = isoDay(meaningfulFact(args.eventDate));
  if (args.expiryPassed && expiry && !(eventDay && eventDay <= expiry))
    return { kind: "expired", text: "Not a possible benefit: this policy’s cover ended on " + expiry +
      (eventDay ? ", before the event on " + eventDay + "." : " and no renewal is on file. If it happened before then, tell DearPolicy the date.") };
  if (!args.travelEvent && happenedInSingapore(meaningfulFact(args.eventLocation)) && overseasOnly(args.benefitTitle, args.policyType))
    return { kind: "location", text: "Not a possible benefit: this cover is for events overseas, and this happened in Singapore." };
  return null;
}
