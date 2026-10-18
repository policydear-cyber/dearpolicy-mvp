/**
 * PR #55 (sa-live-4 SBb): completeness of the schedules a benefit lookup already returned.
 *
 * When the existing lookup (person_benefits) returned several percentage schedules for the requested person, and the
 * reply addresses that family of benefits, every schedule that is about the event the household described has a
 * disposition before the turn ends:
 *   explained / evaluated  its terms (or its conditional illustration) are in the reply;
 *   excluded               with a reason taken from the household's own words or the benefit's own record;
 *   unresolved             with the specific uncertainty.
 * Nothing is silently omitted. Nothing else is calculated: only schedules the lookup returned, only for the person the reply
 * is about, never every benefit in the library and never a second retrieval.
 */
import { COMPARISON_REQUEST } from "./requirement-question";
import { sharedTopic, topicStems } from "./topic";
import { BODY_WORDS, familiesOf, familiesIntersect, familyName } from "../event-relations";

export type DiscoveredSchedule = { id: string; benefit: string; subjectId: string };
export type Disposition = { benefitId: string; benefit: string; disposition: "explained" | "evaluated" | "excluded" | "unresolved"; reason: string };

/** The topic words (other than the generic "accident") a schedule's own label shares with what the household described. */
export const eventWordsShared = (eventText: string, s: DiscoveredSchedule): string[] =>
  sharedTopic(topicStems(eventText), topicStems(s.benefit)).filter((w) => w !== "accident");

/**
 * Death-journey release: is this schedule about the event the household described? By the ESTABLISHED relationship between
 * the event and the benefit the schedule is NAMED for (a fracture event -> fracture schedules; a dismemberment event ->
 * dismemberment schedules) -- never by a word the household's account happens to share with a schedule's rows or label
 * ("leg", "permanent", "total"). Only a label naming no benefit family falls back to topic words, and body-part words
 * never count there.
 */
export function scheduleRelation(eventText: string, s: DiscoveredSchedule): { relevant: boolean; reason: string } {
  const ev = familiesOf(eventText), fam = familiesOf(s.benefit);
  if (ev.size && fam.size) {
    return familiesIntersect(ev, fam) ? { relevant: true, reason: "" }
      : { relevant: false, reason: `it is a ${familyName(fam)} benefit, not the ${familyName(ev)} event the household described` };
  }
  const shared = eventWordsShared(eventText, s).filter((w) => !BODY_WORDS.has(w));
  return shared.length ? { relevant: true, reason: "" } : { relevant: false, reason: "its label shares no topic with the event the household described" };
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
const names = (text: string, label: string) => new RegExp(`(?<![a-z])${norm(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(norm(text));

/**
 * The schedules the household explicitly asked about by name, from their most recent message that names any of them
 * (a label contained in another named label does not count on its own: asking about "Simple Fracture or Other Fracture due to
 * Accident" names that one benefit). Null when no message names one, or when the request compares alternatives.
 */
export function namedSchedules(userTexts: string[], message: string, candidates: DiscoveredSchedule[]): Set<string> | null {
  if (COMPARISON_REQUEST.test(message)) return null;
  for (const text of [...userTexts].reverse()) {
    if (COMPARISON_REQUEST.test(text)) return null;
    const hit = candidates.filter((c) => names(text, c.benefit));
    if (!hit.length) continue;
    const alone = hit.filter((c) => !hit.some((o) => o.id !== c.id && norm(o.benefit).includes(norm(c.benefit)) && norm(o.benefit) !== norm(c.benefit)));
    return new Set(alone.map((c) => c.id));
  }
  return null;
}

export type SchedulePlan = { rows: Disposition[]; complete: DiscoveredSchedule[] };

export function planSchedules(a: {
  discovered: DiscoveredSchedule[]; subjectId: string; eventText: string; userTexts: string[]; message: string;
  covered: ReadonlyMap<string, "explained" | "evaluated">; notApplicable: ReadonlyMap<string, string>;
}): SchedulePlan {
  const none: SchedulePlan = { rows: [], complete: [] };
  const mine = [...new Map(a.discovered.filter((d) => d.subjectId === a.subjectId).map((d) => [d.id, d])).values()];
  if (mine.length < 2) return none;
  // the reply must already address this family of benefits: a later question about something else is never padded
  if (!mine.some((m) => a.covered.has(m.id))) return none;
  const rows: Disposition[] = [];
  const relevant: DiscoveredSchedule[] = [];
  for (const m of mine) {
    const rel = scheduleRelation(a.eventText, m);
    if (rel.relevant) relevant.push(m);
    else rows.push({ benefitId: m.id, benefit: m.benefit, disposition: "excluded", reason: rel.reason });
  }
  if (relevant.length < 2) return { rows, complete: [] };
  const named = namedSchedules(a.userTexts, a.message, relevant);
  const complete: DiscoveredSchedule[] = [];
  for (const m of relevant) {
    const cov = a.covered.get(m.id);
    if (cov) { rows.push({ benefitId: m.id, benefit: m.benefit, disposition: cov, reason: cov === "evaluated" ? "its conditional illustration is in the reply" : "its printed terms are in the reply" }); continue; }
    if (named && !named.has(m.id)) { rows.push({ benefitId: m.id, benefit: m.benefit, disposition: "excluded", reason: "the household asked about another benefit by name (their own words)" }); continue; }
    const why = a.notApplicable.get(m.id);
    if (a.notApplicable.has(m.id)) { rows.push({ benefitId: m.id, benefit: m.benefit, disposition: "excluded", reason: why || "its own definition does not fit what the household reported" }); continue; }
    complete.push(m);
  }
  return { rows, complete };
}
