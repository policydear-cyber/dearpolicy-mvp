/**
 * Whether a benefit can be offered as a POSSIBLE benefit for a reported
 * event (V1.1): only from a policy that was current on the event date, and
 * only where it fits where the event happened. A benefit that fails either
 * test keeps its card, labelled with the reason, and is never named as a
 * possible benefit (lib/chat/fact-finding-chat.ts, finalizeClaimAnswer).
 *
 *  - Dates: never. Every policy on file is treated as in force (DC, 31 Oct:
 *    "ignore all expiry dates"), so a printed expiry or start date never
 *    rules a benefit out.
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
  const eventDay = isoDay(meaningfulFact(args.eventDate));
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
