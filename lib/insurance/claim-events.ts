import { knownValue } from "@/lib/chat/facts";
import { definedConditionsFor } from "./defined-conditions";
import type { ScenarioTrait,SubjectFacts } from "@/lib/chat/types";

/** What kind of claim this is, and what kind of claim a benefit is written for.
 *
 * The system used to decide that with traits -- "illness", "death",
 * "hospitalisation" -- shared by both sides. A trait is a lossy hash of a
 * contract trigger, and the collisions are exactly the wrong answers this
 * product has been producing: a critical-illness product paying out on a death
 * because both it and the event carry "death" somewhere in their words, and a
 * critical-illness product paying out on dengue because both carry "illness".
 *
 * A trigger is not a topic. "Critical Illness" pays on the diagnosis of a
 * condition named in the policy's own schedule. "Death Benefit" pays on a
 * death. Those are different events, and no amount of keyword overlap turns one
 * into the other. This module names the events, reads them off the facts, reads
 * them off the benefit's own wording, and rules out the benefits whose trigger
 * event simply did not happen -- in plain code, with a reason that can be shown
 * to the person verbatim. */
export type ClaimEventType=
  |"death"
  |"terminal_illness"
  |"critical_illness"
  |"total_permanent_disability"
  |"accidental_injury"
  |"hospitalisation"
  |"surgery"
  |"medical_expense"
  |"income_loss"
  |"care_need"
  |"property_or_motor"
  |"travel"
  |"liability"
  |"policy_event";

/** The once-only, condition-defined triggers: the ones that carry the big
 * lump sums, and the only ones this gate is allowed to rule a benefit out on.
 * An expense or hospital benefit is left alone, because those respond to
 * consequences that can accompany almost any event. */
export const LUMP_SUM_EVENTS:ClaimEventType[]=["death","terminal_illness","critical_illness","total_permanent_disability"];

const TRIGGER_RULES:{event:ClaimEventType;pattern:RegExp}[]=[
  {event:"death",pattern:/\b(?:death|dies|died|deceased|loss of life|funeral|bereavement|mortal remains|repatriation of remains)\b/},
  {event:"terminal_illness",pattern:/\bterminal(?:ly)? ill\w*\b/},
  {event:"critical_illness",pattern:/\b(?:critical illness(?:es)?|critical care|crisis cover|dread disease|major illness|living care|advanced stage|early (?:stage )?critical)\b/},
  {event:"total_permanent_disability",pattern:/\b(?:total(?:ly)? and permanent(?:ly)? disab\w*|permanent total disab\w*|permanent disablement|tpd)\b/},
  {event:"accidental_injury",pattern:/\b(?:bodily injur\w*|accidental injur\w*|dismember\w*|fracture\w*|dislocation|burns?|amputat\w*|loss of (?:limb|sight|hearing|speech|use))\b/},
  {event:"hospitalisation",pattern:/\b(?:hospital\w*|inpatient|in-patient|confine\w*|ward|room and board|daily cash|recuperat\w*|icu|intensive care|admission)\b/},
  {event:"surgery",pattern:/\b(?:surg\w*|operation|implant)\b/},
  {event:"medical_expense",pattern:/\b(?:medical expense\w*|treatment cost\w*|outpatient|out-patient|clinic|consultation|ambulance|reimburs\w*|dental|specialist|diagnostic)\b/},
  {event:"income_loss",pattern:/\b(?:income|salary|earnings|weekly benefit|temporary (?:total|partial) disablement)\b/},
  {event:"care_need",pattern:/\b(?:nursing|activities of daily living|long[- ]?term care|care benefit)\b/},
  {event:"property_or_motor",pattern:/\b(?:motor|vehicle|windscreen|property|contents|theft|stolen|burglar\w*|damage)\b/},
  {event:"travel",pattern:/\b(?:travel|trip|baggage|flight|journey|overseas|delay|curtailment|cancellation)\b/},
  {event:"liability",pattern:/\b(?:liabilit\w*|third[- ]party|legal (?:cost|expense|liabilit)\w*)\b/},
  {event:"policy_event",pattern:/\b(?:maturit\w*|surrender|cash value|no[- ]?claim|premium waiver)\b/},
];

/** Which events a benefit is written to respond to, read from its own name and
 * quoted clause. The name carries more weight than the clause: a critical
 * illness clause routinely mentions death (to say the benefit ends on it, or
 * that it is accelerated against it), and reading that mention as "this pays on
 * death" is how a living-care product came to be offered for a death. */
export function benefitTriggerEvents(benefitName:string,quote:string):ClaimEventType[]{
  const name=(benefitName??"").toLowerCase();
  const full=(name+" "+(quote??"")).toLowerCase();
  const events=new Set<ClaimEventType>();
  for(const rule of TRIGGER_RULES)if(rule.pattern.test(name))events.add(rule.event);
  // A death benefit has to say so in its own name, or the clause has to be
  // about nothing else. A passing mention inside a longer clause is not a
  // trigger.
  const namesALumpSumTrigger=LUMP_SUM_EVENTS.some(event=>events.has(event));
  if(!namesALumpSumTrigger)
    for(const rule of TRIGGER_RULES)if(rule.pattern.test(full))events.add(rule.event);
  return [...events];
}

/** What actually happened, in the same vocabulary.
 *
 * Deliberately permissive where the facts are thin: a question with an illness
 * in it but no named diagnosis counts as a possible critical illness, so
 * "what if I am diagnosed with cancer" still reaches the critical-illness
 * benefits. It is only when a diagnosis IS named, and it is not a condition
 * those benefits are defined to pay for, that the critical-illness door closes.
 * That asymmetry is the point: the system should be certain before it rules
 * something out, and generous while it is still asking. */
export function reportedClaimEvents(facts:SubjectFacts,traits:ScenarioTrait[]=[],diagnoses:string[]=[]):ClaimEventType[]{
  const events=new Set<ClaimEventType>();
  const trait=new Set(traits);
  const known=(key:string)=>knownValue(facts,key);
  if(known("death")===true||trait.has("death"))events.add("death");
  if(known("terminalIllness")===true)events.add("terminal_illness");
  const named=diagnoses.filter(text=>typeof text==="string"&&text.trim().length>0);
  if(named.length){
    if(named.some(text=>definedConditionsFor(text).length>0))events.add("critical_illness");
  } else if(trait.has("illness")||trait.has("diagnosis"))events.add("critical_illness");
  if(known("permanentImpairment")!=null||trait.has("disability"))events.add("total_permanent_disability");
  if(trait.has("bodily_injury")||trait.has("accident")||known("injured")===true)events.add("accidental_injury");
  if(known("hospitalised")===true||known("hospitalNights")!=null||known("hospitalNightsSoFar")!=null||trait.has("hospitalisation"))events.add("hospitalisation");
  if(known("surgery")===true)events.add("surgery");
  if(trait.has("medical_expense")||known("hospitalBill")!=null||known("ambulanceBill")!=null||known("outOfPocket")!=null)events.add("medical_expense");
  if(trait.has("income_loss"))events.add("income_loss");
  if(trait.has("care_need"))events.add("care_need");
  if(trait.has("vehicle_collision")||trait.has("property_damage")||trait.has("theft")||trait.has("loss"))events.add("property_or_motor");
  if(trait.has("travel_disruption")||trait.has("delay")||trait.has("trip_cancellation"))events.add("travel");
  if(trait.has("liability"))events.add("liability");
  if(trait.has("maturity")||trait.has("surrender"))events.add("policy_event");
  return [...events];
}

const RULED_OUT_REASON:Partial<Record<ClaimEventType,string>>={
  critical_illness:"pays on the diagnosis of a condition named in the policy's own schedule of critical illnesses, which is not what happened here",
  death:"pays only on a death, and nobody has died",
  terminal_illness:"pays only on a terminal diagnosis made while the person is alive",
  total_permanent_disability:"pays only on total and permanent disability",
};

/** Why this benefit cannot respond to this event -- or null to leave it alone.
 *
 * Applied only to benefits whose every trigger is a lump-sum event. A benefit
 * that also responds to a hospital stay or a bill is never ruled out here,
 * because those consequences can follow any event and the right move is to ask,
 * not to delete. */
export function ruledOutByEvent(triggers:ClaimEventType[],reported:ClaimEventType[]):string|null{
  if(!triggers.length)return null;
  // Only benefits that carry one of the once-only triggers can be ruled out
  // here. A hospital or expense benefit responds to a consequence that can
  // follow almost any event, so the right move there is to ask, never to
  // delete.
  const lumpSum=triggers.filter(event=>LUMP_SUM_EVENTS.includes(event));
  if(!lumpSum.length)return null;
  // Nothing at all is known about the event yet: say nothing rather than rule
  // the household's biggest benefits out of their own answer.
  if(!reported.length)return null;
  const happened=new Set(reported);
  if(triggers.some(event=>happened.has(event)))return null;
  return RULED_OUT_REASON[lumpSum[0]]??"responds to a different kind of event from the one reported";
}

/** One cover, however many rows describe it.
 *
 * A group personal accident policy that appears once in a certificate and again
 * in the benefit table is one cover, and its accidental death benefit is
 * payable once. Identity is the policy number when there is one, because that
 * is what the insurer settles against -- never the row, and never the benefit's
 * name, which is exactly how the same S$1,000,000 came to be counted twice. */
export function coverKey(input:{policyNumber?:string|null;groupPolicyNumber?:string|null;
  insurer?:string|null;productName?:string|null;contractId:string}):string{
  const identifier=(input.policyNumber??input.groupPolicyNumber??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(identifier.length>=4)return "policy:"+identifier;
  const insurer=(input.insurer??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const product=(input.productName??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(insurer&&product)return "product:"+insurer+"|"+product;
  return "contract:"+input.contractId+(product?"|"+product:"");
}

/** The single lump-sum event a figure is being paid for, or null when the
 * benefit is an expense or per-day benefit that stacks normally. */
export function payingEvent(triggers:ClaimEventType[],reported:ClaimEventType[]):ClaimEventType|null{
  const happened=new Set(reported);
  return LUMP_SUM_EVENTS.find(event=>triggers.includes(event)&&happened.has(event))??null;
}
