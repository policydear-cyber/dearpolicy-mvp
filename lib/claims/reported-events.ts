/**
 * Events a household reports in its own words, read deterministically.
 *
 * The claim interview used to depend on the language model naming the event
 * (a scenario with traits) before any plan could start. When it did not --
 * "she spilled hot soup on her leg", "my bag arrived 9 hours late", "got heart
 * attack last month" -- the chat fell back to "I couldn't find a benefit"
 * and asked for policy wording, even though the household's own plan had a
 * benefit for exactly that event. These are read here, in plain code, from
 * affirmative statements only (never a question, a what-if or a negation),
 * and they only ADD what the model did not already give.
 *
 * Pure; no I/O. Each event carries the facts it states and one scenario.
 */
import type { ScenarioFamily, ScenarioTrait } from "@/lib/chat/types";

export type ReportedEvent = {
  kind: "injury" | "surgery" | "childbirth" | "outpatient_illness" | "baggage_delay" | "trip_cancellation" | "trip_curtailment" | "travel_documents" | "property" | "motor";
  label: string; family: ScenarioFamily; traits: ScenarioTrait[]; quote: string;
  facts: Record<string, string | number | boolean>;
};

const NEGATED = /\b(?:if|what if|whether|suppose|assuming|in case|might|may|could|would|will|going to|gonna|planning|planned|next (?:week|month)|tomorrow|didn['’]?t|did not|not|never|no)\s*$/i;
function affirmed(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 60), index).split(/[.!?;\n]/).at(-1) ?? "";
  if (NEGATED.test(before.trim().split(/\s+/).slice(-3).join(" "))) return false;
  if (/^\s*(?:does|do|is|are|am|can|could|would|will|should|what|how|which|if)\b/i.test(before)) return false;
  const sentence = text.slice(index).split(/[.!;\n]/, 1)[0];
  // A question about cover ("is a dog bite covered?") reports nothing.
  if (sentence.includes("?") && /\b(?:cover(?:ed)?|claimable|pay for)\b/i.test(sentence) && !/\bcan claim\b/i.test(sentence)) return false;
  return true;
}
function first(text: string, re: RegExp) {
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) if (affirmed(text, m.index ?? 0)) return m;
  return null;
}
const ACCIDENT_CUE = /\b(?:fell|fall(?:en)?|falling|slipped|tripped|spilled|spilt|knocked|bitten|bit\b|crash\w*|collid\w*|hit by|scooter|bicycle|bike|playground|playing|accident\w*)\b/i;
const BODY = "arm|leg|wrist|hand|finger|thumb|thigh|ankle|foot|toe|knee|hip|shoulder|elbow|face|head|chest|back|neck|lip|mouth|eye";

/** Every event reported in this message, most specific first. */
export function reportedEvents(text: string): ReportedEvent[] {
  const t = text.replace(/\s+/g, " ").trim();
  const out: ReportedEvent[] = [];
  const injury = (kind: string, quote: string, part: string | null) => {
    const accident = ACCIDENT_CUE.test(t);
    const facts: ReportedEvent["facts"] = { injured: true, injuryKind: kind };
    if (part) facts.injuryBodyPart = part.toLowerCase();
    if (accident) facts.eventType = "accident";
    out.push({ kind: "injury", label: "Reported injury: " + kind, family: "injury", traits: accident ? ["bodily_injury", "accident"] : ["bodily_injury"], quote, facts });
  };
  // ------------------------------------------------------------ injuries that are not fractures
  const tooth = first(t, /\b(?:knocked out|chipped|broke|broken|cracked|lost|fractured)\s+(?:(?:her|his|my|their|a|the|one|two)\s+)?(?:front\s+|baby\s+)?(?:tooth|teeth)\b/i);
  if (tooth) injury("dental injury", tooth[0], "tooth");
  const burn = !tooth && first(t, new RegExp(String.raw`\b(?:got|get|suffered|had|kena)\s+(?:a\s+)?(?:bad\s+|minor\s+|serious\s+|small\s+)?burns?\b|\b(?:burnt|burned|scalded)\s+(?:(?:her|his|my|their)\s+)?(?:${BODY})?|\bspill(?:ed|t)\s+hot\b`, "i"));
  if (burn) injury("burn", burn[0], t.match(new RegExp(String.raw`\b(?:on|to)\s+(?:her|his|my|their)\s+(${BODY})\b`, "i"))?.[1] ?? null);
  const bite = !tooth && !burn && first(t, /\b(?:was|got|been|kena)\s+bitten\b|\b(?:dog|cat|monkey|animal)\s+bite\b|\bbitten by\b/i);
  if (bite) injury("wound", bite[0], t.match(new RegExp(String.raw`\b(?:on|to)\s+(?:her|his|my|their)\s+(${BODY})\b`, "i"))?.[1] ?? null);
  const cut = !tooth && !burn && !bite && first(t, new RegExp(String.raw`\b(?:needed|got|had)\s+(?:\d+\s+)?stitches\b|\b(?:deep|bad|nasty)\s+cut\b|\bcut\s+(?:her|his|my|their)\s+(?:${BODY})\b`, "i"));
  if (cut) injury("wound", cut[0], t.match(new RegExp(String.raw`\b(${BODY})\b`, "i"))?.[1] ?? null);
  // Round 9: "the doctor say maybe fracture", "suspected fracture": an injury the X-ray has yet to confirm.
  const suspected = !tooth && !burn && !bite && !cut && first(t, /\b(?:maybe|might be|may be|could be|suspect(?:ed)?|possible|possibly)\s+(?:a\s+)?(?:fracture[sd]?|broken(?:\s+bone)?)\b/i);
  if (suspected) injury("possible fracture", suspected[0], t.match(new RegExp(String.raw`\b(${BODY})\b`, "i"))?.[1] ?? null);
  // Round 9: "knocked down by a car", "hit by a bus": a road accident, injuries still to be told.
  const road = !tooth && !burn && !bite && !cut && !suspected && first(t, /\b(?:knocked down|hit by a (?:car|bus|lorry|motorcycle|motorbike|van|taxi)|run over)\b/i);
  if (road) { injury("injury in a road accident", road[0], t.match(new RegExp(String.raw`\b(${BODY})\b`, "i"))?.[1] ?? null); out.at(-1)!.facts.eventType = "accident"; out.at(-1)!.traits = ["bodily_injury", "accident"]; }
  // ------------------------------------------------------------ surgery, childbirth
  const surgery = first(t, /\b(?:had|went for|underwent|did)\s+(?:a\s+|an\s+|her\s+|his\s+|my\s+)?(?:day\s+)?(?:surgery|operation)\b|\bday surgery\b/i);
  if (surgery && !/\b(?:next|tomorrow|will|going to|scheduled|planned)\b/i.test(t)) {
    const dayCase = /\bday surgery\b|\bsame day\b|\bwent home\b/i.test(t);
    out.push({ kind: "surgery", label: dayCase ? "Day surgery" : "Surgery", family: "hospitalisation", traits: ["hospitalisation", "medical_expense"], quote: surgery[0],
      facts: { surgery: true, hospitalised: true, ...(dayCase ? { daySurgery: true } : {}) } });
  }
  const birth = first(t, /\b(?:gave birth|delivered (?:a|our|my|the|her)?\s*(?:baby|son|daughter|twins)|had (?:a|our|my|her)\s+baby|normal delivery|c-?section|caesarean)\b/i);
  if (birth) out.push({ kind: "childbirth", label: "Childbirth", family: "hospitalisation", traits: ["hospitalisation"], quote: birth[0], facts: { hospitalised: true, maternity: true } });
  // ------------------------------------------------------------ an illness seen as an outpatient
  const illness = /\b(?:hfmd|hand,? foot and mouth|fever|flu|cough|cold|sore throat|stomach (?:bug|flu)|gastro\w*|food poisoning|diarrh\w*|vomit\w*|rash|infection|sick|unwell|chickenpox|conjunctivitis|covid)\b/i;
  const visit = first(t, /\b(?:saw|see|seen|went to|go|went|visited|brought (?:her|him) to)\s+(?:the\s+|a\s+)?(?:gp|doctor|polyclinic|clinic|a\s*&\s*e|a and e|emergency(?: department)?)\b|\bwent a\s*&\s*e\b/i);
  const notAdmitted = /\bnot admitted\b|\bsent home\b|\bwasn['’]?t admitted\b|\bno need to (?:be )?admit/i.test(t);
  if (visit && illness.test(t) && !out.some((e) => e.kind === "injury") && (notAdmitted || !/\b(?:admitted|warded|hospitali[sz]ed)\b/i.test(t))) {
    const emergency = /\ba\s*&\s*e\b|\ba and e\b|\bemergency\b/i.test(visit[0]);
    out.push({ kind: "outpatient_illness", label: emergency ? "Emergency visit for an illness" : "Clinic visit for an illness", family: "illness", traits: ["illness", "medical_expense"], quote: visit[0],
      facts: { eventType: "illness", hospitalised: false, treatmentType: emergency ? "Emergency department" : "Outpatient or clinic" } });
  }
  // ------------------------------------------------------------ travel
  const bagDelay = first(t, /\b(?:bag|bags|baggage|luggage)\b[^.?!]{0,40}?\b(?:arrived|came|reached|delayed)\b[^.?!]{0,25}?\b(\d{1,3})\s*(?:hours?|hrs?|h)\s*(?:late|later)?\b|\b(?:bag|bags|baggage|luggage)\s+(?:was\s+|were\s+)?delayed\b/i);
  if (bagDelay) out.push({ kind: "baggage_delay", label: "Baggage delay", family: "travel", traits: ["travel_disruption", "delay"], quote: bagDelay[0],
    facts: { eventType: "travel_disruption", travelEventType: "Baggage delay", ...(bagDelay[1] ? { baggageDelayHours: Number(bagDelay[1]) } : {}) } });
  const cancelled = first(t, /\b(?:had to |have to |we |i )?cancel(?:led|ed)?\s+(?:our|my|the|her|his)\s+(?:[A-Za-z]+\s+)?(?:trip|holiday|vacation|tour|flight)s?\b/i);
  if (cancelled) out.push({ kind: "trip_cancellation", label: "Trip cancelled before departure", family: "travel", traits: ["travel_disruption", "trip_cancellation"], quote: cancelled[0],
    facts: { eventType: "travel_disruption", travelEventType: "Trip cancellation" } });
  const curtailed = !cancelled && first(t, /\b(?:cut (?:short|our trip short)|cut short|came back early|flew (?:back|home) early|return(?:ed)? (?:home )?early|curtail\w*)\b/i);
  if (curtailed) out.push({ kind: "trip_curtailment", label: "Trip cut short", family: "travel", traits: ["travel_disruption", "trip_cancellation"], quote: curtailed[0],
    facts: { eventType: "travel_disruption", travelEventType: "Trip cut short" } });
  const passport = first(t, /\b(?:lost|stolen|misplaced)\s+(?:(?:my|her|his|our|the)\s+)?passports?\b|\bpassports?\s+(?:was|were|got)\s+(?:lost|stolen)\b/i);
  if (passport) out.push({ kind: "travel_documents", label: "Lost travel documents", family: "travel", traits: ["travel_disruption", "loss"], quote: passport[0],
    facts: { eventType: "travel_disruption", travelEventType: "Lost passport or travel documents" } });
  // ------------------------------------------------------------ home and car
  const home = first(t, /\b(?:kitchen|house|home|flat|condo|bathroom|ceiling|room)\b[^.?!]{0,25}\b(?:flooded|caught fire|burnt|burned|leaked|leaking)\b|\b(?:burst pipe|water leak|house fire|break-?in|burglary|burgled)\b/i);
  if (home) out.push({ kind: "property", label: "Damage at home", family: "property", traits: ["property_damage"], quote: home[0], facts: { eventType: "property_loss" } });
  const motor = first(t, /\b(?:hit|scratched|dented|rear-?ended|bumped|crashed into)\b[^.?!]{0,30}\b(?:car|vehicle|bumper)\b|\b(?:car|vehicle)\b[^.?!]{0,20}\b(?:was hit|got hit|kena hit|damaged|scratched|dented)\b/i);
  if (motor && /\b(?:nobody|no one|none)\s+(?:was\s+)?(?:hurt|injured)\b|\bbumper\b|\bcarpark\b/i.test(t)) out.push({ kind: "motor", label: "Damage to a car", family: "motor", traits: ["vehicle_collision", "property_damage"], quote: motor[0], facts: { eventType: "property_loss" } });
  return out;
}

/** "my knee surgery is next week", "will be admitted on Monday": an event that has not happened. */
export function plannedMedicalEvent(text: string): { what: string } | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (/\b(?:if|what if|suppose)\b/i.test(t)) return null;
  const m = t.match(/\b((?:[a-z]+\s+){0,2}(?:surgery|operation|procedure|admission|delivery|scope|colonoscopy|biopsy))\b[^.?!]{0,30}\b(?:is|will be|scheduled|planned|booked)\b[^.?!]{0,20}\b(?:next|tomorrow|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in \d+ (?:days|weeks))\b/i)
    ?? t.match(/\b(?:will|going to|gonna|scheduled to|booked to)\s+(?:have|go for|undergo|be admitted for|do)\s+(?:a\s+|an\s+|her\s+|his\s+|my\s+)?((?:[a-z]+\s+){0,2}(?:surgery|operation|procedure|scope|delivery))\b/i)
    ?? t.match(/\b(?:will be|going to be|is being)\s+(admitted)\b[^.?!]{0,30}\b(?:next|tomorrow|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
  // Round 9: "I'm having an operation on my shoulder next month", "knee surgery next week",
  // "my doctor say I need to do a colonoscopy": not happened yet.
  const PROC = "(?:surgery|operation|procedure|op|scope|colonoscopy|endoscopy|gastroscopy|biopsy|cataract surgery|keyhole surgery|angioplasty|delivery|c-section|caesarean)";
  const m9 = m ? null : t.match(new RegExp("\\b(?:i['’]m|i am|she['’]s|he['’]s|she is|he is|we['’]re|(?:my|his|her) \\w+ is)\\s+(?:having|going for|scheduled for|booked for|due for)\\s+(?:a |an |my |his |her |the )?((?:[a-z]+\\s+){0,2}" + PROC + ")\\b", "i"))
    ?? t.match(new RegExp("\\b((?:[a-z]+\\s+){0,2}" + PROC + ")\\s+(?:next|tomorrow|this coming|in \\d+ (?:days|weeks|months))\\b", "i"))
    ?? t.match(new RegExp("\\b(?:need|needs|have|has|got|must) to (?:do|go for|have|undergo|take)\\s+(?:a |an |my |his |her |the )?((?:[a-z]+\\s+){0,2}" + PROC + ")\\b", "i"))
    ?? t.match(new RegExp("\\b(?:need|needs) (?:a |an )((?:[a-z]+\\s+){0,2}" + PROC + ")\\b", "i"));
  const planned = m ?? m9 ?? t.match(/\b(?:a |an |it is a |it['’]s a )?(?:planned|elective|scheduled)\s+((?:[a-z]+\s+)?(?:operation|surgery|procedure|admission))\b/i);
  if (!planned) return null;
  return { what: planned[1].trim().toLowerCase().replace(/^(?:(?:my|her|his|a|an|the|to|do|go|for|have|need|needs|undergo|get)\s+)+/, "") };
}
