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
export type EventFitIssue = { kind: "expired" | "not_started" | "location" | "trip"; text: string };

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
/** The event is known to have happened overseas. */
export function happenedOverseas(location: string | null) {
  return !!location && (/overseas|abroad/i.test(location) || !/\bsingapore\b|\blocal\b|\bhome\b/i.test(location));
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
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-06-30" -> "30 June 2026", as a family would write it. */
export function plainDate(iso: string) {
  const m = iso.match(/^(\d{4})-(\d\d)-(\d\d)/);
  return m ? Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1] : iso;
}
export function eventFitIssue(args: {
  benefitTitle: string;
  /** The policy's name, for saying whose dates these are. */
  policyName?: string | null;
  /** The earliest start date printed on the policy documents on file. */
  effectiveDate?: string | null;
  policyType?: string | null;
  /** The policy's latest printed renewal or expiry date. */
  expiryDate?: string | null;
  /** True when currentness is "expiry_date_passed" (no renewal evidence since). */
  expiryPassed: boolean;
  eventDate?: string | null;
  eventLocation?: string | null;
  /** The event itself is a trip (a travel claim): location does not rule cover out. */
  travelEvent?: boolean;
  /** The insured trip, when known. */
  tripStart?: string | null;
  tripEnd?: string | null;
}): EventFitIssue | null {
  const expiry = isoDay(args.expiryDate);
  const eventDay = isoDay(meaningfulFact(args.eventDate));
  const whose = args.policyName ? args.policyName + "’s" : "this policy’s";
  if (args.expiryPassed && expiry && !(eventDay && eventDay <= expiry))
    return { kind: "expired", text: "Not a possible benefit: " + whose + " cover ended on " + plainDate(expiry) +
      (eventDay ? ", before the event on " + plainDate(eventDay) + ", and no renewal is on file." : " and no renewal is on file. If it happened before then, tell DearPolicy the date.") };
  const effective = isoDay(args.effectiveDate);
  if (effective && eventDay && eventDay < effective)
    return { kind: "not_started", text: "Not a possible benefit on the document on file: " + (args.policyName ? args.policyName + "’s" : "the") + " cover on file starts on " + plainDate(effective) +
      ", after the event on " + plainDate(eventDay) + ". If the policy was in force before then, the earlier certificate or renewal notice will show it." };
  if (!args.travelEvent && happenedInSingapore(meaningfulFact(args.eventLocation)) && overseasOnly(args.benefitTitle, args.policyType))
    return { kind: "location", text: "Not a possible benefit: this cover is for events overseas, and this happened in Singapore." };
  // Travel cover needs a trip: an event overseas, within the trip's dates. A
  // diagnosis at home, a local fracture or a death whose place is unknown is
  // not a travel claim.
  if (!args.travelEvent && overseasOnly(args.benefitTitle, args.policyType)) {
    if (!happenedOverseas(meaningfulFact(args.eventLocation)))
      return { kind: "trip", text: "Not a possible benefit unless this happened during an overseas trip: it is travel cover." };
    const start = isoDay(meaningfulFact(args.tripStart)), end = isoDay(meaningfulFact(args.tripEnd));
    if (eventDay && ((start && eventDay < start) || (end && eventDay > end)))
      return { kind: "trip", text: "Not a possible benefit: travel cover applies only during the insured trip, and this happened outside its dates." };
  }
  return null;
}
