/**
 * The Coverage Ledger's vocabulary.
 *
 * Personal insurance answers a small, fixed set of events, and pays in a small,
 * fixed set of ways. Naming them once, here, is what lets every answer be a
 * lookup instead of a classification: a question names an event, the ledger
 * holds one row per (person, plan, event, pays), and the answer is the join.
 *
 * Nothing in this file calls a model. It is the part of the product a person
 * can read and check.
 */
import { knownValue } from "@/lib/chat/facts";
import type { SubjectFacts } from "@/lib/chat/types";

export type EventType =
  | "death" | "accidental_death" | "tpd" | "terminal_illness"
  | "critical_illness" | "early_critical_illness"
  | "hospital_daily_cash" | "icu_daily_cash" | "surgery"
  | "hospital_medical_expense" | "accident_medical_expense" | "ambulance"
  | "fracture" | "dismemberment" | "accidental_disablement"
  | "long_term_care" | "disability_income"
  | "travel_delay" | "trip_cancellation" | "baggage" | "travel_medical"
  | "motor_damage" | "home_damage" | "maturity" | "other";

export type PaysKind = "lump_sum" | "per_day" | "per_month" | "percent_of_sum" | "reimbursement_cap" | "stated";

export const EVENTS:Record<EventType,{label:string;asks?:string[]}>={
  death:{label:"Death"},
  accidental_death:{label:"Accidental death"},
  tpd:{label:"Total and permanent disability"},
  terminal_illness:{label:"Terminal illness"},
  critical_illness:{label:"Critical illness"},
  early_critical_illness:{label:"Early-stage critical illness"},
  hospital_daily_cash:{label:"Hospital daily cash"},
  icu_daily_cash:{label:"ICU daily cash"},
  surgery:{label:"Surgery"},
  hospital_medical_expense:{label:"Hospital medical expenses"},
  accident_medical_expense:{label:"Accident medical expenses"},
  ambulance:{label:"Ambulance"},
  fracture:{label:"Fracture"},
  dismemberment:{label:"Dismemberment / loss of use"},
  accidental_disablement:{label:"Accidental permanent disablement"},
  long_term_care:{label:"Long-term care (severe disability)"},
  disability_income:{label:"Disability income"},
  travel_delay:{label:"Travel delay"},
  trip_cancellation:{label:"Trip cancellation"},
  baggage:{label:"Baggage loss or delay"},
  travel_medical:{label:"Overseas medical expenses"},
  motor_damage:{label:"Vehicle damage"},
  home_damage:{label:"Home contents damage"},
  maturity:{label:"Maturity / survival benefit"},
  other:{label:"Other benefit"},
};

/** The fact a pay kind needs before it becomes a figure. */
export const QUANTITY_FACT:Partial<Record<EventType,{factKey:string;text:string;why:string}>>={
  hospital_daily_cash:{factKey:"hospitalNights",text:"How many nights in hospital?",why:"Daily hospital cash is paid per night, after any waiting period."},
  icu_daily_cash:{factKey:"icuNights",text:"How many nights in ICU?",why:"ICU cash is paid per night in intensive care."},
  hospital_medical_expense:{factKey:"hospitalBill",text:"How much was the hospital bill?",why:"Reimbursement benefits pay what was actually spent, up to their limit."},
  accident_medical_expense:{factKey:"outOfPocket",text:"How much did the treatment cost?",why:"It is reimbursed up to the policy's limit."},
  ambulance:{factKey:"ambulanceBill",text:"How much was the ambulance charge?",why:"It is reimbursed up to the policy's limit."},
  travel_medical:{factKey:"outOfPocket",text:"How much did the overseas treatment cost?",why:"It is reimbursed up to the policy's limit."},
  motor_damage:{factKey:"vehicleRepairBill",text:"How much was the repair bill?",why:"It is reimbursed up to the policy's limit."},
};

/** Gates: yes/no facts that rule an event in or out. Asked before any figure. */
export const GATES:Record<string,{factKey:string;type:"yes_no"|"choice";options?:string[];text:string;why:string}>={
  accident:{factKey:"eventType",type:"choice",options:["An accident","An illness"],text:"Was this caused by an accident, or an illness?",why:"Some benefits only pay for accidents, so this decides which ones apply."},
  accidentalDeath:{factKey:"accidentalDeath",type:"yes_no",text:"Was the death caused by an accident?",why:"Personal accident cover pays on accidental death only; life cover pays either way."},
  hospitalised:{factKey:"hospitalised",type:"yes_no",text:"Was there a hospital admission?",why:"Hospital benefits only respond to an admission, and the daily ones depend on how long it lasted."},
  icu:{factKey:"icuAdmitted",type:"yes_no",text:"Was any of the stay in intensive care?",why:"ICU cash is a separate daily amount."},
  surgery:{factKey:"surgery",type:"yes_no",text:"Was surgery performed?",why:"Surgical benefits pay only when an operation took place."},
  ambulanceUsed:{factKey:"ambulanceUsed",type:"yes_no",text:"Was an ambulance used?",why:"Ambulance charges are reimbursed only if one was used."},
};

/** Which events a reported situation can turn on, and which gate decides each. */
export type EventCandidate={event:EventType;gate?:keyof typeof GATES};

export function candidateEvents(facts:SubjectFacts,hints:string[]=[]):EventCandidate[]{
  const k=(key:string)=>knownValue(facts,key);
  const out:EventCandidate[]=[];
  const add=(event:EventType,gate?:keyof typeof GATES)=>{if(!out.some(o=>o.event===event))out.push({event,gate});};
  // Scenario hints come from the reader's classification of what happened:
  // "sudden, external, violent" is what a personal accident plan means by an
  // accident, so a homicide is not asked "was it an accident?".
  const hinted=new Set(hints);
  const hintedAccident=hinted.has("accident")||(hinted.has("external")&&hinted.has("violent"))||hinted.has("vehicle_collision");
  const accident=k("eventType")==="accident"||k("accidentalDeath")===true||k("accidentType")!=null||(k("accidentalDeath")!==false&&k("eventType")!=="illness"&&hintedAccident);
  const illness=k("eventType")==="illness"||k("eventType")==="diagnosis"||k("diagnosis")!=null;
  const causeKnown=accident||illness;
  if(k("death")===true||k("eventType")==="death"){
    add("death");
    if(k("accidentalDeath")===false||illness){/* life only */}
    else add("accidental_death",accident?undefined:"accidentalDeath");
    return out;
  }
  const injured=k("injured")===true||k("injuries")!=null||k("fractureBodyPart")!=null;
  const hospitalised=k("hospitalised")===true||k("hospitalNights")!=null||(k("hospitalised")!==false&&hinted.has("hospitalisation"));
  // A dented car or a stolen bag is not a bodily event unless someone says so.
  const propertyOnly=(k("vehicleDamaged")===true||k("vehicleRepairBill")!=null||k("stolenItem")!=null||k("propertyDamaged")===true)&&!injured&&!hospitalised&&k("injured")!==true;
  if((accident||injured)&&!propertyOnly){
    if(k("fractureBodyPart")!=null||/fractur|broke/i.test(String(k("injuries")??"")))add("fracture");
    add("accident_medical_expense");
    add("ambulance",k("ambulanceUsed")==null?"ambulanceUsed":undefined);
    if(k("permanentImpairment")!=null){add("dismemberment");add("accidental_disablement");add("tpd");}
  }
  if(illness){
    // A named diagnosis can be a critical illness; "an illness" alone
    // (food poisoning on a trip) is not asked about as one.
    if(k("diagnosis")!=null||k("eventType")==="diagnosis"){add("critical_illness");add("early_critical_illness");}
    add("hospital_medical_expense",hospitalised?undefined:"hospitalised");
  }
  if((accident||injured||illness||hospitalised)&&!propertyOnly){
    add("hospital_daily_cash",hospitalised?undefined:"hospitalised");
    // Always gated: "No" to the surgery question must rule the surgical rows
    // out (dropping the gate once answered used to let them back in).
    add("surgery","surgery");
    if(!causeKnown&&!accident&&!injured&&hospitalised){
      // A stay with no cause named: the cause decides the accident-only rows.
      add("accident_medical_expense","accident");
    }
  }
  if(k("flightDelayHours")!=null)add("travel_delay");
  if(k("tripCancelled")===true)add("trip_cancellation");
  // Hurt or ill overseas: a travel plan's overseas medical expenses answer it.
  if((accident||injured||illness||hospitalised)&&/overseas|abroad/i.test(String(k("eventLocation")??"")))add("travel_medical");
  // What happened on a trip, as the household picked it.
  const trip=String(k("travelEventType")??"").toLowerCase();
  if(/delay/.test(trip))add("travel_delay");
  if(/baggage|luggage/.test(trip))add("baggage");
  if(/cancel|curtail/.test(trip))add("trip_cancellation");
  if(/medical|sick|ill|hospital/.test(trip))add("travel_medical");
  if(k("vehicleDamaged")===true||k("vehicleRepairBill")!=null)add("motor_damage");
  if(k("careNeed")===true||k("adlFailed")!=null)add("long_term_care");
  return out;
}

/** Events named in a what-if question, where no facts have been recorded. */
export function eventsFromText(text:string):EventCandidate[]{
  const t=text.toLowerCase();
  const out:EventCandidate[]=[];
  const add=(event:EventType,gate?:keyof typeof GATES)=>{if(!out.some(o=>o.event===event))out.push({event,gate});};
  const accident=/\b(?:accident|accidental|fell|fall|slipped|collision|crash|knocked|hit by)\b/.test(t);
  const illness=/\b(?:illness|disease|sick|cancer|stroke|heart attack|diagnos\w*|dengue|kidney|tumou?r)\b/.test(t);
  if(/\b(?:die|dies|died|death|passes? away|passed away|killed|murdered)\b/.test(t)){
    add("death");
    if(!illness)add("accidental_death",accident?undefined:"accidentalDeath");
    return out;
  }
  if(/\b(?:fractur\w*|broke|broken|break)\b/.test(t))add("fracture");
  if(/\b(?:hospitali[sz]\w*|admitted|warded|in hospital|hospital stay)\b/.test(t)){add("hospital_daily_cash");add("hospital_medical_expense");}
  if(/\b(?:surgery|operation)\b/.test(t))add("surgery");
  if(/\b(?:critical illness|cancer|stroke|heart attack|kidney failure)\b/.test(t)){add("critical_illness");add("early_critical_illness");}
  if(/\b(?:disab\w*|permanently|tpd|loss of (?:use|sight|limb|hearing|speech))\b|\b(?:lost|loss of) (?:(?:his|her|my|their|a|an|one|both|the) )?(?:thumbs?|(?:index )?fingers?|toes?|eyes?|arms?|legs?|hands?|feet|foot|limbs?)\b/.test(t)){add("tpd");add("accidental_disablement");add("dismemberment");}
  if(/\b(?:terminal)\b/.test(t))add("terminal_illness");
  if(/\b(?:ambulance)\b/.test(t))add("ambulance");
  if(/\b(?:flight|delay\w*)\b/.test(t)&&/\b(?:delay\w*)\b/.test(t))add("travel_delay");
  if(/\b(?:cancel\w*)\b/.test(t)&&/\b(?:trip|flight|holiday|travel)\b/.test(t))add("trip_cancellation");
  if(/\b(?:baggage|luggage)\b/.test(t))add("baggage");
  if(/\b(?:car|vehicle|motor)\b/.test(t)&&/\b(?:damage\w*|accident|crash|collision)\b/.test(t))add("motor_damage");
  if(/\b(?:nursing|long[- ]term care|activities of daily living|careshield|eldershield)\b/.test(t))add("long_term_care");
  if(/\b(?:matur\w*|survival benefit|endowment)\b/.test(t))add("maturity");
  if(accident&&!out.length){add("accident_medical_expense");add("ambulance");add("hospital_daily_cash","hospitalised");add("fracture");}
  if(illness&&!out.some(o=>o.event==="critical_illness")){add("critical_illness");add("hospital_daily_cash","hospitalised");}
  // Round 9: hurt or ill on a trip: a travel plan's overseas medical expenses answer it.
  if(/\b(?:overseas|abroad)\b/.test(t)&&(accident||illness||/\b(?:fractur\w*|broke|broken|break|injur\w*|hurt|hospital\w*|treatment)\b/.test(t)))add("travel_medical");
  return out;
}

/** The one benefit a schedule line names by its own cover category ("Death", "Total Permanent Disability"), and whether
 * the line's printed amount is what that benefit pays. A schedule line says what it insures and no more: a life cover's
 * sum is never also a disability or terminal-illness figure, and nothing a plan type "usually" pays is added beside it
 * (new-user walkthrough, 31 Oct: an Australian schedule printing Life Cover $850,000 and TPD Cover $500,000 showed
 * "Total and permanent disability A$850,000"). A category not listed here seeds nothing. */
export const SCHEDULE_LINE_EVENTS:Record<string,{event:EventType;pays:PaysKind}>={
  "Death":{event:"death",pays:"lump_sum"},
  "Total Permanent Disability":{event:"tpd",pays:"lump_sum"},
  "Critical Illness":{event:"critical_illness",pays:"lump_sum"},
  "Early Critical Illness":{event:"early_critical_illness",pays:"lump_sum"},
  "Personal Accident":{event:"accidental_death",pays:"lump_sum"},
  "Hospitalisation":{event:"hospital_medical_expense",pays:"stated"},
  "Hospital Cash":{event:"hospital_daily_cash",pays:"stated"},
  "Long-term Care":{event:"long_term_care",pays:"stated"},
  "Disability Income":{event:"disability_income",pays:"stated"},
};
/** The benefit a schedule line seeds: its own category's, with an accident plan's death line read as accidental death
 * (a personal accident schedule's "Death" sum pays only on an accident). Null when the line names no listed cover. */
export function scheduleLineEvent(category:string,name:string):{event:EventType;pays:PaysKind}|null{
  const own=SCHEDULE_LINE_EVENTS[category.trim()];
  if(!own)return null;
  if(own.event==="death"&&/\b(?:personal accident|group accident|accident(?:al)?(?: death)?(?: cover| plan| insurance| protection)?|\bpa\b)\b/i.test(name))return {event:"accidental_death",pays:"lump_sum"};
  return own;
}

/** What a plan of a given kind pays, when only its schedule line is on file.
 * These are the industry's standard shapes, and every row seeded from them
 * says so: they are proposals for the person to confirm, never the wording. */
export const PRODUCT_DEFAULTS:{pattern:RegExp;exclude?:RegExp;events:{event:EventType;pays:PaysKind;note:string}[]}[]=[
  {pattern:/\b(?:term life|whole life|group life|life (?:cover|insurance|assurance|plan|policy)|death(?: cover| benefit)?|dependants?'? protection|dps)\b/i,exclude:/\b(?:living|accident)\b/i,
   events:[{event:"death",pays:"lump_sum",note:"a life plan pays its sum assured on death"},
           {event:"tpd",pays:"lump_sum",note:"most life plans also pay the sum assured on total and permanent disability, subject to the plan's definition"},
           {event:"terminal_illness",pays:"lump_sum",note:"most life plans advance the sum assured on a terminal illness diagnosis"}]},
  {pattern:/\b(?:personal accident|group accident|accident(?:al)? (?:cover|plan|insurance|protection)|\bpa\b|group pa)\b/i,
   events:[{event:"accidental_death",pays:"lump_sum",note:"a personal accident plan pays 100% of its sum insured on accidental death"},
           {event:"accidental_disablement",pays:"stated",note:"permanent disablement is paid as a percentage of the sum insured from the plan's scale"},
           {event:"fracture",pays:"stated",note:"fractures, if covered, are paid from the plan's fracture table"},
           {event:"accident_medical_expense",pays:"stated",note:"accident medical expenses, if covered, are reimbursed up to the plan's limit"}]},
  {pattern:/\b(?:critical illness|living care|dread disease|major illness|crisis cover|\bci\b)\b/i,
   events:[{event:"critical_illness",pays:"lump_sum",note:"a critical illness plan pays its sum assured on a qualifying diagnosis"},
           {event:"early_critical_illness",pays:"stated",note:"early-stage conditions, if covered, pay a percentage of the sum assured"}]},
  {pattern:/\b(?:careshield|eldershield|long[- ]term care|severe disability)\b/i,
   events:[{event:"long_term_care",pays:"per_month",note:"CareShield/ElderShield pays a monthly amount while the person cannot perform the required activities of daily living"}]},
  {pattern:/\b(?:medishield|integrated shield|shield plan|hospital(?:isation)? (?:plan|insurance)|medical (?:plan|insurance)|health insurance)\b/i,
   events:[{event:"hospital_medical_expense",pays:"stated",note:"a hospital plan reimburses eligible hospital bills subject to its deductible, co-insurance and limits"}]},
  {pattern:/\b(?:hospital (?:cash|income)|daily cash)\b/i,
   events:[{event:"hospital_daily_cash",pays:"per_day",note:"a hospital cash plan pays a fixed amount per night in hospital"}]},
  {pattern:/\b(?:travel)\b/i,
   events:[{event:"travel_delay",pays:"stated",note:"travel plans pay a fixed amount per block of delay"},
           {event:"trip_cancellation",pays:"stated",note:"cancellation is reimbursed up to the plan's limit"},
           {event:"travel_medical",pays:"stated",note:"overseas medical expenses are reimbursed up to the plan's limit"},
           {event:"baggage",pays:"stated",note:"baggage loss or delay is paid up to the plan's limit"}]},
  {pattern:/\b(?:motor|car insurance)\b/i,events:[{event:"motor_damage",pays:"stated",note:"own-damage cover reimburses repairs less the excess"}]},
  {pattern:/\b(?:endowment|savings)\b/i,events:[{event:"maturity",pays:"stated",note:"an endowment pays its maturity value on the maturity date"},{event:"death",pays:"stated",note:"endowments also pay a death benefit, usually the higher of the sum assured and premiums paid"}]},
  {pattern:/\b(?:home|household|contents)\b/i,events:[{event:"home_damage",pays:"stated",note:"home contents cover reimburses loss or damage up to the plan's limit"}]},
];

/** Liability to other people ("if you are liable for accidental death, injury or damage to other people") pays a third
 * party's claim against the insured. It is never a death or injury benefit for the insured person, whatever words it uses. */
export const THIRD_PARTY_LIABILITY=/\b(?:liable|liability|liabilities)\b|third[- ]part(?:y|ies)\b|\bto other (?:people|persons)\b/i;
/** Liability to other people in a printed quote. Narrower than THIRD_PARTY_LIABILITY: a quote's "the Company shall not
 * be liable for death caused by war" is an exclusion of the person's own cover, not liability cover. */
// A bare "third party" is not enough: "assault by a third party" is the person's own personal accident cover.
export const THIRD_PARTY_SENSE=/\b(?:personal|legal|public|third[- ]party) liabilit\w*|\bliab\w*\b[^.]{0,60}\b(?:to|towards|for) (?:a |any )?(?:third[- ]part(?:y|ies)|other (?:people|persons)|others)\b/i;
/** A row printing two or more amounts side by side ("S$500,000 S$750,000 S$1,000,000") is one row of a table with a column
 * per plan, and "Not covered" in a row means some plan's column pays nothing. Either way one figure cannot be told to be
 * the person's without knowing their plan, so no figure is taken from the row. */
export function rowFiguresDependOnPlan(text:string|null|undefined){
  const t=String(text??"");
  const money=String.raw`(?:[A-Z]{0,3}\$|[A-Z]{3}\s?)\s?\d[\d,]*(?:\.\d+)?`;
  // ("Not covered" next to an amount is a column; "fractures of the thumb are not covered" in a footnote is not.)
  return new RegExp(`${money}\\s+${money}|\\bnot covered\\s+${money}|${money}\\s+not covered\\b`,"i").test(t);
}

/** Maps a benefit-table row's own name to an event. */
export function eventForBenefitName(name:string):{event:EventType;detail:string|null}{
  const n=name.toLowerCase();
  if(THIRD_PARTY_LIABILITY.test(n))return {event:"other",detail:name};
  const accident=/\baccident/.test(n);
  if(/\bdeath\b|\bdies\b|loss of life/.test(n))return {event:accident?"accidental_death":"death",detail:null};
  if(/fractur/.test(n))return {event:"fracture",detail:name};
  if(/\b(?:total (?:and|&) permanent|tpd|permanent (?:total )?disab)/.test(n))return {event:accident?"accidental_disablement":"tpd",detail:null};
  // Round 11: "Loss of a thumb", "Loss of an index finger", "Loss of any other finger" are lines of the same scale.
  if(/dismember|loss of (?:use|sight|hearing|speech|limb|one|two|both)|loss of (?:an? |any (?:other )?|the )?(?:thumbs?|(?:index |other )?fingers?|toes?|eyes?|arms?|legs?|hands?|feet|foot)\b|amputat/.test(n))return {event:"dismemberment",detail:name};
  if(/terminal/.test(n))return {event:"terminal_illness",detail:null};
  if(/early|intermediate/.test(n)&&/illness|stage|critical/.test(n))return {event:"early_critical_illness",detail:name};
  if(/critical illness|major illness|dread disease|cancer|heart attack|stroke|kidney failure/.test(n))return {event:"critical_illness",detail:name};
  if(/\bicu\b|intensive care/.test(n))return {event:"icu_daily_cash",detail:null};
  if(/recuperat|daily (?:hospital )?cash|hospital (?:cash|income|allowance)|per day|daily benefit|confinement/.test(n))return {event:"hospital_daily_cash",detail:null};
  if(/surg|operation/.test(n))return {event:"surgery",detail:name};
  if(/ambulance/.test(n))return {event:"ambulance",detail:null};
  // Treatment abroad (a travel plan's overseas medical expenses) is not a hospital bill at home.
  if(/overseas|abroad|covid|evacuat|repatriat/.test(n)&&!accident)return {event:"travel_medical",detail:name};
  if(/medical (?:expense|reimburse|cost)|treatment|clinical|outpatient|physiotherap|tcm|chinese physician/.test(n))return {event:accident?"accident_medical_expense":"hospital_medical_expense",detail:name};
  if(/mobility aid|wheelchair|home modification/.test(n))return {event:"accidental_disablement",detail:name};
  // "Baggage delay" is a baggage benefit, not a flight delay one.
  if(/baggage|luggage/.test(n))return {event:"baggage",detail:name};
  if(/flight delay|travel delay|delay/.test(n))return {event:"travel_delay",detail:null};
  if(/cancel/.test(n))return {event:"trip_cancellation",detail:null};
  if(/nursing|long[- ]term care|activities of daily living|adl/.test(n))return {event:"long_term_care",detail:null};
  if(/matur|survival/.test(n))return {event:"maturity",detail:null};
  return {event:"other",detail:name};
}

/** Whether a benefit row is restricted to one cause. "Accidental Hospital
 * Recuperation" pays for a hospital stay, but only one an accident caused. */
export function causeForBenefit(name:string,requires:string[]=[]):"accident"|"illness"|null{
  const n=name.toLowerCase();
  if(requires.includes("accident")||/\baccident/.test(n))return "accident";
  if(requires.includes("illness")||/\b(?:due to|caused by|from) (?:an )?(?:illness|sickness|disease)\b/.test(n))return "illness";
  return null;
}

/** A fracture row names body parts; the person names one. */
const BODY_PART_WORDS:Record<string,RegExp>={
  forearm:/\b(?:arm|forearm|radius|ulna)\b/i, arm:/\b(?:arm|humerus|upper limb)\b/i, wrist:/\b(?:wrist|arm)\b/i, elbow:/\b(?:elbow|arm)\b/i,
  hand:/\b(?:hand|metacarp)\b/i, finger:/\b(?:finger|thumb|phalan)\b/i, shoulder:/\b(?:shoulder|clavicle|collar ?bone|scapula)\b/i,
  rib:/\b(?:ribs?)\b/i, ribs:/\b(?:ribs?)\b/i, leg:/\b(?:leg|femur|tibia|fibula|lower limb)\b/i, thigh:/\b(?:thigh|femur|leg)\b/i,
  knee:/\b(?:knee|patella|leg)\b/i, ankle:/\b(?:ankle|leg)\b/i, foot:/\b(?:foot|feet|metatars)\b/i, toe:/\b(?:toe)\b/i,
  hip:/\b(?:hip|pelvis)\b/i, pelvis:/\b(?:pelvis|hip)\b/i, spine:/\b(?:spine|vertebra|back)\b/i, back:/\b(?:spine|vertebra|back)\b/i,
  skull:/\b(?:skull|head)\b/i, head:/\b(?:skull|head)\b/i, jaw:/\b(?:jaw|mandible|face)\b/i, nose:/\b(?:nose|nasal|face)\b/i, face:/\b(?:face|facial|cheek)\b/i,
};
export function fractureRowMatches(detail:string|null,bodyPart:string){
  if(!detail)return true; // A single fracture row applies to any fracture.
  // "Fracture benefit" names no part of the body: it is the one fracture row,
  // and it applies to any fracture -- not to none.
  if(!Object.values(BODY_PART_WORDS).some(re=>re.test(detail))&&!/\b(?:limb|humer|radius|ulna|tibia|fibula|femur|clavic|vertebra|pelvi|skull|patell)/i.test(detail))return true;
  const part=bodyPart.toLowerCase().trim();
  const words=Object.entries(BODY_PART_WORDS).filter(([k])=>part.includes(k)).map(([,re])=>re);
  if(!words.length)return new RegExp("\\b"+part.replace(/[^a-z ]/g,"")+"\\b","i").test(detail);
  return words.some(re=>re.test(detail));
}
