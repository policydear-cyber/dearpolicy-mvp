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
 * the line's printed amount is what that benefit pays. A line's sum is that benefit's only: never also a disability or
 * terminal-illness figure (new-user walkthrough, 31 Oct: an Australian schedule printing Life Cover $850,000 and TPD
 * Cover $500,000 showed "Total and permanent disability A$850,000"). A category not listed here seeds its own nothing. */
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
/** A line category in other words than the list above ("Life Cover", "Death Benefit", "TPD", "Trauma"), read from the
 * category alone, never from the plan's name: a "TPD Cover" line on a life plan is TPD, never death. Ordered so the
 * narrower cover wins ("Accidental Death" before "Death", "Early Critical Illness" before "Critical Illness"). */
const SCHEDULE_LINE_WORDS:[RegExp,string][]=[
  [/\btpd\b|\btotal (?:and |& )?permanent(?:ly)? disab\w*/i,"Total Permanent Disability"],
  [/\b(?:early|intermediate|early[- ]stage|minor)\b[^,;]{0,20}\b(?:critical|dread|trauma|crisis)\b(?:\s+(?:illness|disease|cover))?/i,"Early Critical Illness"],
  [/\b(?:critical illness|dread disease|trauma|crisis cover|major illness|\bci\b)/i,"Critical Illness"],
  [/\baccident(?:al)?\b[^,;]{0,20}\b(?:death|life)\b|\bpersonal accident\b/i,"Personal Accident"],
  [/(?:\bhospital (?:cash|income|allowance)\b|\bdaily (?:hospital )?(?:cash|allowance)\b)(?:\s+for\s+life\b)?/i,"Hospital Cash"],
  [/\b(?:long[- ]term care|severe disability)\b/i,"Long-term Care"],
  [/\b(?:income protection|disability income|salary continuance)\b/i,"Disability Income"],
  [/\b(?:death in service|death|life (?:cover|insurance|assurance|benefit|sum assured)|^life$|term life|whole life)\b/i,"Death"],
];
/** The whole category is a cover's name: the cover words, plus only words that name a sum ("Life Cover", "TPD Benefit",
 * "Critical Illness Sum Assured"). A line that says anything else is a different thing with a cover's name in it: "TPD
 * Premium Waiver", "Life Cover Premium" and "Life Insurance Fund Value" are not a TPD or death sum (TE, 31 Oct). */
// Words that say what kind of the same cover it is ("Group Term Life", "Level Life Cover", "Accelerated Critical
// Illness Rider") are part of its name too.
const COVER_NAME_FILLER=new Set(["cover","coverage","benefit","benefits","sum","assured","insured","amount","insurance","assurance","plan","protection","lump","basic","main","and","&","the","of","on","upon","for",
  "group","individual","family","joint","single","level","decreasing","increasing","accelerated","standalone","stand","alone","additional","supplementary","enhanced","rider","policy"]);
function wholeCoverName(category:string,re:RegExp):boolean{
  const m=re.exec(category);
  if(!m)return false;
  const rest=(category.slice(0,m.index)+" "+category.slice(m.index+m[0].length)).toLowerCase().split(/[^a-z&]+/).filter(Boolean);
  return rest.every((w)=>COVER_NAME_FILLER.has(w));
}
/** What a printed line costs or holds rather than pays: a premium, a waiver of premium, a fund, surrender or cash value,
 * a fee, a charge, an excess or deductible, a contribution or subscription, a loan. Intake stores such a line under the
 * cover it names ("TPD Premium Waiver" as Total Permanent Disability), so its printed label is read too (TE, 31 Oct). */
const NOT_A_SUM=/\b(?:premiums?|waiver|fund value|surrender(?: value)?|cash value|fees?|charges?|excess|deductible|contributions?|subscriptions?|loan|levy|caruman|yuran|bayaran)\b|保费|保費|退保/i;
export function printedLabelIsNotASum(evidenceText:string|null|undefined):boolean{
  const label=String(evidenceText??"").split(/\t|\s(?=(?:[A-Z]{1,3}\$|RM|£|€|¥|S\$|A\$|US\$|\$)?\s?\d)/)[0]??"";
  return NOT_A_SUM.test(label);
}
/** A schedule line's own label: the printed words before its figure. */
function printedLabel(printed:string|null|undefined):string{
  const t=String(printed??"");
  return (t.split(/\t|\s(?=(?:[A-Z]{1,3}\$|RM|£|€|¥|S\$|A\$|US\$|\$)?\s?\d)/)[0]??"").replace(/[\s:;,.–—-]+$/,"").replace(/\s+/g," ").trim();
}
/** A travel schedule's lines are limits for one benefit each, named by the printed label (intake stores them all as
 * "Travel"). Only a label that is the whole benefit's name counts, closed list: "Overseas medical expenses",
 * "Trip cancellation", "Loss of baggage and personal belongings". A label with any other word (evacuation, post-trip,
 * cash, visit, delay, sub-limit, per item, an age, terrorism) is another benefit or a sub-limit, so it seeds nothing
 * (Critic H1 on #294). */
const TRAVEL_LINES:[RegExp,EventType][]=[
  [/^(?:(?:overseas|emergency|foreign|travel)\s+)*medical(?:\s+and\s+(?:hospital(?:isation)?|associated))?\s+expenses(?:\s+(?:overseas|abroad|outside (?:your )?home country))?$/i,"travel_medical"],
    [/^(?:(?:trip|travel|journey|holiday)\s+)?cancell?ation(?:\s+(?:charges|costs|cover))?$/i,"trip_cancellation"],
  [/^(?:(?:loss of|loss or damage to|lost or damaged)\s+)?(?:personal\s+)?(?:baggage|luggage)(?:\s+and\s+personal\s+(?:belongings|effects|possessions))?$/i,"baggage"],
];
export function scheduleLineEvent(category:string,name:string,printed?:string|null):{event:EventType;pays:PaysKind}|null{
  if(printedLabelIsNotASum(printed))return null;
  if(/^travel$/i.test(category.trim())){
    const parts=printedLabel(printed).split(/\s+\/\s+/).map((p)=>p.trim()).filter(Boolean);
    const found=new Set(parts.map((label)=>TRAVEL_LINES.find(([re])=>re.test(label))?.[1]??null));
    const travel=found.size===1?[...found][0]:null;
    return travel?{event:travel,pays:"stated"}:null;
  }
  const said=category.trim();
  const own=SCHEDULE_LINE_EVENTS[said]??SCHEDULE_LINE_EVENTS[SCHEDULE_LINE_WORDS.find(([re])=>wholeCoverName(said,re))?.[1]??""];
  if(!own)return null;
  if(own.event==="death"&&/\b(?:personal accident|group accident|accident(?:al)?(?: death)?(?: cover| plan| insurance| protection)?|\bpa\b)\b/i.test(name))return {event:"accidental_death",pays:"lump_sum"};
  return own;
}

/** How a line the list calls "stated" pays, when its own printed words say so, with its printed amount: "Monthly benefit
 * £2,400" pays £2,400 a month, "Daily hospital cash S$200" pays per day, a travel line whose label is the whole benefit
 * reimburses up to its figure, and a hospital plan's "Overall limit" / "Annual limit" is the plan's limit. A rate counts
 * only when nothing on the label says the figure is a total ("for 24 months, total", "overall maximum"); a hospital
 * limit only when the label is that limit and nothing else ("Room & Board limit", "Surgical limit" are sub-limits).
 * Anything else keeps no figure, never a lump sum (Critic H2/M3 on #294). */
const NOT_A_RATE=/\b(?:total|maximum|max|overall|aggregate|lifetime|limit|cap|up to|for (?:up to )?\d+|\d+\s*(?:months?|years?|days?|weeks?))\b/i;
const HOSPITAL_PLAN_LIMIT=/^(?:(?:overall|annual|yearly|policy[- ]year)\s+)?(?:limit|benefit limit|maximum limit|sum insured)$/i;
export function scheduleLinePays(event:EventType,printed:string|null|undefined):PaysKind|null{
  // A bilingual label ("Elaun hospital harian / Daily hospital allowance") is read one language at a time.
  const parts=printedLabel(printed).split(/\s+\/\s+/).map((p)=>p.trim()).filter(Boolean);
  // The value cell must be the figure itself: "£2,400 or 75% of salary, whichever is lower" or "As charged" is not a
  // rate or limit this line can carry (Critic p294).
  const text=String(printed??"");
  const figures=text.match(/(?:[A-Z]{1,3}\$|RM|£|€|¥|S\$|A\$|US\$|HK\$|\$)\s?\d[\d,]*(?:\.\d+)?/g)??[];
  if(figures.length!==1||/\b(?:or|whichever|lower|higher|lesser|greater|as charged)\b|%/i.test(text.slice(text.indexOf(figures[0])+figures[0].length)))return null;
  const kinds=new Set(parts.map((label)=>labelPays(event,label,printed)));
  // A rate is the value cell's figure and nothing more: "Up to £2,400", "Maximum S$5,000", "75% of salary up to
  // £2,400" or "50% of sum assured, S$1,000" are limits or worked-out amounts, not what is paid each month or day
  // (TE V1 on #294).
  const rate=kinds.size===1?[...kinds][0]:null;
  if(rate==="per_month"||rate==="per_day"){
    const label=printedLabel(printed);
    const value=(text.includes("\t")?text.slice(text.indexOf("\t")+1):text.slice(text.indexOf(label)+label.length)).trim();
    const cell=value.slice(0,value.indexOf(figures[0]))+"#"+value.slice(value.indexOf(figures[0])+figures[0].length);
    if(!/^\s*#\s*(?:(?:per|a|each|\/)\s*(?:calendar\s+)?(?:month|day|night)|monthly|daily|for life)?\s*\.?\s*$/i.test(cell))return null;
  }
  return rate;
}
function labelPays(event:EventType,label:string,printed:string|null|undefined):PaysKind|null{
  const text=String(printed??"");
  const figures=(text.match(/(?:[A-Z]{1,3}\$|RM|£|€|¥|S\$|A\$|US\$|\$)\s?\d[\d,]*(?:\.\d+)?/g)??[]).length;
  if(figures>1)return null; // two amounts on one line: which is which is not certain
  if(event==="disability_income"||event==="long_term_care")
    return /^(?:monthly (?:benefit|income|payment|payout|allowance)|(?:benefit|income|payment|payout|allowance) per month)$/i.test(label)&&!NOT_A_RATE.test(label)?"per_month":null;
  if(event==="hospital_daily_cash"||event==="icu_daily_cash")
    return /^(?:(?:daily (?:hospital )?(?:cash|income|allowance|benefit))|(?:hospital )?(?:cash|income|allowance) per (?:day|night))$/i.test(label)&&!NOT_A_RATE.test(label.replace(/\bper (?:day|night)\b/i,""))?"per_day":null;
  if(event==="travel_medical"||event==="trip_cancellation"||event==="baggage")
    return /\bper\b|\/\s?(?:day|month|year|annum|item|person)/i.test(text)?null:"reimbursement_cap";
  // A rate in the value cell ("Benefit limit  S$500 per day", "Sum insured  S$2,000,000 per lifetime") is not the
  // plan's whole-bill limit (Critic H4 on #294).
  if(event==="hospital_medical_expense")return HOSPITAL_PLAN_LIMIT.test(label)&&!/\bper\b|\/\s?(?:day|night|month|year|annum|item|person|life)|\b(?:a|each) (?:day|night)\b|\bdaily\b/i.test(text)?"reimbursement_cap":null;
  return null;
}
/** Whether a line's printed rate or limit is the one such line its plan printed for that benefit. Every line the plan
 * printed under that cover kind is read; when they could not be read (null), the answer is no, so the line keeps no
 * figure: a figure is never given because a second line went unchecked (Critic H1/M5 on #294). */
export function onlyPrintedRateLine(category:string,name:string,event:EventType,printedLines:string[]|null):boolean{
  if(!printedLines||!printedLines.length)return false;
  return printedLines.filter(t=>{const e=scheduleLineEvent(category,name,t);return e?.event===event&&e.pays==="stated"&&!!scheduleLinePays(event,t);}).length===1;
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
  {pattern:/\b(?:income protection|disability income|income replacement|salary continuance)\b/i,
   events:[{event:"disability_income",pays:"per_month",note:"an income protection plan pays a monthly income while the person cannot work, after its waiting period"}]},
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

/** DearPolicy reads English only (owner's rule, 4 Nov 2026): a row name in another language is not glossed, so it maps to
 * no event and its figure is never seeded as a cover. */
const B=String.raw`(?<![\p{L}\p{N}])`,E=String.raw`(?![\p{L}\p{N}])`;
/** An accident word with a negation right before it ("non-accidental", "bukan akibat kemalangan", "no accidental", "非意外")
 * says the benefit is NOT for an accident: the phrase is dropped before the name is read, so it never makes an accident
 * benefit (TE #270 F2). Up to three linking words may sit between ("not caused by an accident", "bukan akibat kemalangan"). */
const ACCIDENT_WORDS="accident(?:al(?:ly)?|s)?";
const NEGATED_ACCIDENT=new RegExp(B+"(?:not|non|no(?![\\s-]+claims?)|other than|except|excluding|bukan|tidak|tanpa|selain|sin|sans|nicht|kein(?:e[mnrs]?)?|ohne|außer|não|nao|senza)(?:[\\s-]+[\\p{L}]+){0,3}?[\\s-]+(?:"+ACCIDENT_WORDS+")"+E+"|(?:非|不是|不属于|不屬於|无关|無關)\\s*意外","giu");
export function withoutNegatedAccident(name:string):string{return name.replace(NEGATED_ACCIDENT," ").replace(/\s{2,}/g," ").trim();}
export function glossedName(name:string):string{
  return withoutNegatedAccident(name);
}
/** A row whose own name only says it is the policy's sum ("Sum assured", "Uang Pertanggungan", "Monthly benefit") names no
 * event: what it pays is the plan's own main benefit, read from the plan's name when exactly one plan kind fits it. */
const GENERIC_SUM=new RegExp(B+"(?:(?:basic |main )?(?:sum (?:assured|insured|covered)|face amount|benefit amount|amount (?:of cover|insured|assured)|cover amount|monthly (?:benefit|income)|benefit per month))"+E,"iu");
const GENERIC_FILLER=/^(?:the|your|basic|main|benefit|plan|policy|cover|amount|of|and|\W)*$/iu;
/** A row whose own name only says it is the plan's overall limit ("Annual limit", "Overall limit per policy year", "Had
 * Tahunan", "Límite anual", "Plafond annuel", "年度限额") names no event either. A limit is a reimbursement ceiling, so it is
 * read as the plan's own main benefit only when that benefit is reimbursed: exactly one plan kind fits the plan's name and
 * it is a hospital plan (cross-page check, 31 Oct: a hospital plan's "Annual limit" landed on "Other benefit"). A limit on
 * a life, accident or travel plan, or on a plan naming two covers, stays unmapped. */
const GENERIC_LIMIT=new RegExp(B+"(?:(?:(?:overall|annual|yearly|lifetime|policy[- ]year|maximum|max\\.?|aggregate|total) )*(?:benefit )?limits?(?: (?:of (?:cover|benefits?|indemnity)|per (?:policy[- ]year|year|annum|lifetime|life)|a year|for (?:the|each) policy year))*)"+E,"iu");
const LIMIT_FILLER=/^(?:the|your|basic|main|benefit|plan|policy|overall|amount|of|per|and|\W)*$/iu;
const NARROW_HEALTH_PLAN=new RegExp(B+"(?:dental|dentist\\w*|teeth|orthodont\\w*|vision|optical|eye(?:care|wear)?|eyes|spectacles|maternity|pregnancy|"+
  "pergigian|gigi|mata|bersalin|kehamilan|dentale?s?|dentaire|odontol[oó]gic[oa]s?|zahn\\w*|visión|visão|vue|optique|maternidad|maternidade|maternité|mutterschaft|nha khoa|thai sản)"+E+"|牙|眼|產|产科|孕","iu");
/** Words saying a benefit is a cash amount paid to the person, not a limit on a bill (Critic #285 M1): a closed list. */
const CASH_WORDS="(?:cash(?![\\s-]*less)|allowances?|income|benefit per (?:day|night)|daily benefit|per diem|daily payments?|payments? per (?:day|night)|allocation)";
const CASH_PAID=new RegExp(B+CASH_WORDS+E,"iu");
/** "Hospital and Surgical", "Hospital & Surgical", "Hospital dan Pembedahan" name one kind of plan, a hospital plan, not two
 * covers (cross-page check, 1 Nov). */
const HOSPITAL_SURGICAL=new RegExp(B+"(?:hospital(?:i[sz]ation)?|in-?patient)\\s*(?:and|&|\\+)\\s*(?:surg(?:ical|ery))"+E+"(?!\\s+"+CASH_WORDS+")","giu");
/** A "MediCare" or "Medicover" plan is a hospital plan only when nothing else in its name says what it is: "Medicare Term
 * Life" is a life plan, "MediCare Accident Plan" an accident plan (Critic #285 M2). */
const MEDI_PLAN=new RegExp(B+"medi[- ]?(?:care|cover)"+E,"iu");
const MEDI_NOT_HOSPITAL=/\b(?:cancer|critical|illness|dread|accident\w*|life|travel|motor|car|home|savings|endowment|income|cash|term)\b/i;
function planEvent(productName:string|null|undefined,limit=false):EventType|null{
  if(!productName)return null;
  productName=productName.replace(HOSPITAL_SURGICAL,"hospital plan");
  let name=productName;
  if(MEDI_PLAN.test(productName)&&!MEDI_NOT_HOSPITAL.test(productName)&&!PRODUCT_DEFAULTS.some(d=>d.pattern.test(name)&&!(d.exclude&&d.exclude.test(name))))name+=" hospital plan";
  // A plan naming two covers ("Life and Critical Illness Plan") does not say which one its sum is.
  if(/\s(?:and|&|\+|with|plus|dan|y|e|et|und)\s/i.test(productName))return null;
  const kinds=PRODUCT_DEFAULTS.filter(d=>d.pattern.test(name)&&!(d.exclude&&d.exclude.test(name)));
  // Only a plan kind whose main benefit is its sum or its monthly income: an endowment's sum is not its maturity value.
  const main=kinds.length===1?kinds[0].events[0]:null;
  // A dental, vision or maternity plan is not a hospital plan, whatever health words its name also holds (TE #281 F2).
  if(limit)return main&&main.event==="hospital_medical_expense"&&!NARROW_HEALTH_PLAN.test(productName)?main.event:null;
  return main&&(main.pays==="lump_sum"||main.pays==="per_month")?main.event:null;
}

/** Maps a benefit-table row's own name to an event. A row whose name only says it is the plan's sum takes the plan's own
 * main benefit from the plan's name (productName), when exactly one plan kind fits it. */
/** A row whose own name holds a premium, contribution, waiver, refund or value word, in any language, is no cover sum:
 * "Pengecualian Sumbangan atas Kematian" waives contributions on death, "Nilai Tunai Kematian" is a cash value, "身故退还保费"
 * returns premiums. Its figure is never seeded as the death, TPD or CI amount it names (TE #270 F1; the same closed list
 * as the cover-line reader's HOLDS_NOT_A_SUM, #261). A plan tier ("Premium Plan", "Contribution Takaful") is a name, not a premium. */
const NOT_A_SUM_NAME=new RegExp([
  String.raw`\bpremi(?:um|ums|a|o|os|e|en)?\b(?!\s+(?:plans?|tiers?|class|wards?|rooms?|edition|option|package|series|shield|saver|select|gold|platinum|version)\b)`,
  String.raw`\bprimas?\b|\bcontributions?\b(?!\s+(?:takaful|plans?)\b)|\bcaruman\b|\biuran\b|\bsumbangan\b|\bcotisations?\b|\bcontribuiç(?:ão|ões)\b|prämie|\bbeitr[aä]g|\bbeitragsbefreiung`,
  String.raw`\bwaiver\b|\bwaive[ds]?\b|\bpayor\b|\bpayer\s+benefit\b|\bpengecualian\b|\bpembebasan\b|\bexenci[oó]n\b|\bexonération\b|\bexoneration\b|\bisenção\b|\bisencao\b|\bbefreiung\b|\besonero\b`,
  // A refund word decides only with a premium word ("Pengembalian Premi", "Remboursement des primes"): alone it is often a
  // reimbursement of costs ("Pengembalian biaya", "Remboursement des frais médicaux"), which is a cover.
  String.raw`\b(?:remboursement|restitution)\s+des\s+primes\b|\bprimes?\s+(?:rembours|restitu)`,
  String.raw`\b(?:fund|surrender|cash|account|policy|units?|investment)\s+values?\b|\bnilai\s+(?:tunai|serahan|dana|akaun|penyerahan)\b|\bvalor\s+de\s+rescate\b|\bvalor\s+de\s+resgate\b|\bvaleur\s+de\s+rachat\b|r[uü]ckkaufswert|\bvalore\s+di\s+riscatto\b`,
  String.raw`保费|保費|保険料|豁免|払込免除|现金价值|現金價值|解約返戻金`,
].join("|"),"iu");
export function eventForBenefitName(name:string,productName?:string|null):{event:EventType;detail:string|null}{
  if(NOT_A_SUM_NAME.test(name))return {event:"other",detail:name};
  const own=withPlanKind(eventForOwnName(name),name,productName);
  if(own.event!=="other"||THIRD_PARTY_LIABILITY.test(glossedName(name)))return own;
  const m=GENERIC_SUM.exec(name);
  if(!m||!GENERIC_FILLER.test(name.slice(0,m.index)+" "+name.slice(m.index+m[0].length))){
    const l=GENERIC_LIMIT.exec(name);
    if(!l||!LIMIT_FILLER.test(name.slice(0,l.index)+" "+name.slice(l.index+l[0].length)))return own;
    const event=planEvent(productName,true);
    return event?{event,detail:name}:own;
  }
  const event=planEvent(productName);
  return event?{event,detail:null}:own;
}
const CI_TREATMENT=new RegExp(B+"(?:drugs?|medications?|medicines?|chemo(?:therap(?:y|ies))?|radio(?:therap(?:y|ies))?|radiation|immunotherap(?:y|ies)|targeted therap(?:y|ies)|"+
  "outpatient|dialysis|treatments?|reimburse\\w*|expenses?|costs?)"+E,"iu");
/** The plan's own kind settles a row whose name fits both an illness and its treatment (Critic #281 H, H1):
 * - on a hospital plan (exactly one plan kind, a hospital plan), an illness named with a treatment or drug word ("Annual
 *   limit for outpatient cancer drug", "Rawatan kemoterapi kanser") pays the treatment bills: a medical expense, never the
 *   illness's lump sum;
 * - on a critical illness plan, a condition named with its definition wording ("Kidney Failure (requiring dialysis)",
 *   "Major organ transplant (treatment received)") is never moved to a reimbursement: it stays the CI it names, or is left
 *   unmapped when its name alone names no illness;
 * - on any other plan, or when the kind is unknown or two kinds fit, the name's own mapping stands. */
/** A plan whose own kind is a daily cash plan, from a closed list of plan-type phrases ("Hospital Income Plan", "Pelan
 * Pendapatan Hospital", "Krankenhaustagegeldversicherung", "住院现金"). A name that also names a reimbursement plan (Shield,
 * medical, perubatan, Krankenversicherung, 医疗) is not one, and a cash word that is no plan type ("Cash rebate", "Income
 * Protection") never makes one (Critic #285 M1, round 3). */
const CASH_PLAN=new RegExp(B+"(?:hospital(?:i[sz]ation)?(?:\\s*(?:and|&)\\s*surgical)?\\s+(?:cash|income|allowance)(?:\\s+(?:plan|insurance|benefit|policy|rider))?|daily (?:hospital )?cash plan)"+E,"iu");
const REIMBURSEMENT_PLAN=new RegExp(B+"(?:shield|surgical(?!\\s+(?:cash|income|allowance))|perubatan|medical|medic|health|krankenversicherung|krankenhauszusatz\\w*|kesehatan|salud|sa[úu]de|sant[ée]|sanitaria|reimburs\\w*)"+E+"|医疗|醫療|报销|報銷","iu");
function isCashPlan(productName:string|null|undefined){return !!productName&&CASH_PLAN.test(productName)&&!REIMBURSEMENT_PLAN.test(productName);}
function withPlanKind(own:{event:EventType;detail:string|null},name:string,productName?:string|null):{event:EventType;detail:string|null}{
  const ci=own.event==="critical_illness"||own.event==="early_critical_illness";
  const bill=own.event==="hospital_medical_expense"||own.event==="accident_medical_expense";
  if(!ci&&!bill)return own;
  const n=glossedName(name);
  if(ci&&CI_TREATMENT.test(n)&&planEvent(productName,true)==="hospital_medical_expense")return {event:"hospital_medical_expense",detail:name};
  if(bill){const kind=planEvent(productName);if(kind==="critical_illness"||kind==="early_critical_illness")return {event:"other",detail:name};}
  // A room and board line on a hospital cash or income plan is that plan's daily cash amount, not a bill limit (Critic #285
  // M1, TE #285 G2).
  if(own.event==="hospital_medical_expense"&&ROOM_AND_BOARD.test(n)&&isCashPlan(productName))return {event:"hospital_daily_cash",detail:null};
  // A plan named both as a cash plan and as a reimbursement plan ("Medic Hospital Cash Plan") does not settle which a room
  // line is: unsure, so neither a bill limit nor daily cash (Critic #285 low, round 4).
  if(own.event==="hospital_medical_expense"&&ROOM_AND_BOARD.test(n)&&!!productName&&CASH_PLAN.test(productName)&&REIMBURSEMENT_PLAN.test(productName))return {event:"other",detail:name};
  return own;
}
const ROOM_AND_BOARD=new RegExp(B+"(?:room\\s*(?:and|&)\\s*board|(?:daily\\s+)?room\\s+(?:charges?|rates?|accommodation)|ward\\s+(?:charges?|and board|&\\s*board))"+E,"iu");
function eventForOwnName(name:string):{event:EventType;detail:string|null}{
  const n=glossedName(name).toLowerCase();
  if(THIRD_PARTY_LIABILITY.test(n))return {event:"other",detail:name};
  // An income paid while unable to work is its own benefit, not the total and permanent disability lump sum.
  if(/disability income|income (?:protection|replacement)|loss of income|salary continuance/.test(n))return {event:"disability_income",detail:name};
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
  // A room and board line ("Room & Board (per day)", "Bilik dan Makan (sehari)", "Zimmer pro Tag") is the most the plan pays
  // towards the room charge each day: a limit on a hospital bill, never a cash amount paid per night (cross-page check, 1 Nov).
  if(ROOM_AND_BOARD.test(n)&&!CASH_PAID.test(n))return {event:accident?"accident_medical_expense":"hospital_medical_expense",detail:name};
  if(/recuperat|daily (?:hospital )?cash|hospital (?:cash|income|allowance)|per day|per diem|daily (?:benefit|payment)|confinement/.test(n))return {event:"hospital_daily_cash",detail:null};
  if(/surg|operation/.test(n))return {event:"surgery",detail:name};
  if(/ambulance/.test(n))return {event:"ambulance",detail:null};
  // Treatment abroad (a travel plan's overseas medical expenses) is not a hospital bill at home.
  if(/overseas|abroad|covid|evacuat|repatriat/.test(n)&&!accident)return {event:"travel_medical",detail:name};
  if(/medical (?:expense|reimburse|cost)|treatment|clinical|outpatient|physiotherap|tcm|chinese physician|dialysis|chemotherap|radiotherap|immunotherap/.test(n))return {event:accident?"accident_medical_expense":"hospital_medical_expense",detail:name};
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
  const n=withoutNegatedAccident(name).toLowerCase();
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
