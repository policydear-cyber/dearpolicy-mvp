/**
 * One answer path: (person, event, facts) → ledger rows → figures.
 *
 * A what-if and a reported event are the same lookup. The only differences
 * are where the events come from (the question's words, or the recorded
 * facts) and whether quantities are asked (a what-if has none to give).
 *
 * Facts first: while a gate that rules a row in or out is unanswered, the
 * answer is that question, with the rows that may apply named and no figure.
 * Figures come once the facts are in, so they are never revised downwards.
 */
import { knownValue } from "@/lib/chat/facts";
import type { SubjectFacts } from "@/lib/chat/types";
import { formatMoney } from "@/lib/format/currency";
import type { ChatCitation,ChatQuestion,ClaimItem } from "@/types";
import { EVENTS,GATES,QUANTITY_FACT,candidateEvents,eventsFromText,fractureRowMatches,type EventCandidate,type EventType } from "@/lib/ledger/events";
import type { LedgerRow } from "@/lib/ledger/store";
import { calculateHospitalCash } from "@/lib/claims/calculators/hospital-cash";
import { coverKey } from "@/lib/insurance/claim-events";

export type LedgerQuestion=ChatQuestion&{subjectId:string;factKey:string};
export type LedgerAnswer={
  items:ClaimItem[];citations:ChatCitation[];
  /** The one question to ask now, gates before quantities. */
  question:LedgerQuestion|null;questionsLeft:number;
  /** Rows that may apply, by name, for the fact-finding turn. */
  candidates:string[];
  notes:string[];
  /** Rows that were in play but a reported number rules out. */
  ruledOut:string[];
  /** True when some row was found for the events asked about. */
  considered:boolean;
  /** True when every row in play carries a figure. Until the ledger is that
   * complete for an event, the older reading paths still get their turn. */
  complete:boolean;
};
type Person={id:string;name:string};
const MINIMUM_QUESTIONS:Record<string,{factKey:string;type:"text";text:string;why:string}>={
  flightDelayHours:{factKey:"flightDelayHours",type:"text",text:"How many hours was the departure delayed?",why:"Delay benefits start at a threshold and pay per block of hours."},
  hospitalNights:{factKey:"hospitalNights",type:"text",text:"How many nights in hospital?",why:"The benefit starts after a minimum stay."},
  icuNights:{factKey:"icuNights",type:"text",text:"How many nights in ICU?",why:"The benefit starts after a minimum stay."},
};

function causeOf(facts:SubjectFacts,hints:string[]):"accident"|"illness"|null{
  const k=(key:string)=>knownValue(facts,key);
  if(k("eventType")==="accident"||k("accidentalDeath")===true||k("accidentType")!=null||k("injured")===true||k("fractureBodyPart")!=null)return "accident";
  if(k("eventType")==="illness"||k("eventType")==="diagnosis"||k("diagnosis")!=null)return "illness";
  const h=new Set(hints);
  if(h.has("accident")||h.has("vehicle_collision")||(h.has("external")&&h.has("violent")))return "accident";
  if(h.has("illness")||h.has("diagnosis"))return "illness";
  return null;
}
function alreadyAsked(facts:SubjectFacts,factKey:string){const f=facts[factKey];return !!f&&f.state!=="known";}
function label(row:LedgerRow){return EVENTS[row.eventType]?.label??row.eventType;}
function rowTitle(person:Person,row:LedgerRow){
  // A row read from wording keeps the benefit's own name, which is what the
  // person will find in their policy; a schedule row is named by its event.
  const name=row.origin==="wording"&&row.note?row.note:label(row)+(row.detail?" ("+row.detail+")":"");
  return person.name+" · "+row.planName+" — "+name;
}
export function describePays(row:LedgerRow){
  const c=row.currency;
  switch(row.paysKind){
    case "lump_sum":return row.amount!=null?formatMoney(row.amount,c)+" lump sum":"a lump sum";
    case "per_day":return row.amount!=null?formatMoney(row.amount,c)+" per day"+(row.offsetDays?" after the first "+row.offsetDays:"")+(row.maximumDays?", up to "+row.maximumDays+" days":""):"a daily amount";
    case "per_month":return row.amount!=null?formatMoney(row.amount,c)+" per month":"a monthly amount";
    case "percent_of_sum":return row.amount!=null?Math.round(row.amount*1000)/10+"% of the sum insured"+(row.sumBasis!=null?" ("+formatMoney(row.sumBasis,c)+")":""):"a percentage of the sum insured";
    case "reimbursement_cap":return row.amount!=null?"the actual cost, up to "+formatMoney(row.amount,c):"the actual cost, up to a limit";
    default:return "as stated in the plan — no figure on file";
  }
}
function basisOf(row:LedgerRow):"confirmed"|"estimated"|"indicative"{
  if(row.inferred&&row.status!=="confirmed")return "indicative";
  if(row.status==="confirmed")return "confirmed";
  return "estimated";
}
function whyText(row:LedgerRow,basis:"confirmed"|"estimated"|"indicative"){
  const where=row.sourcePage?" (page "+row.sourcePage+")":"";
  if(row.origin==="person")return "Entered on the Coverage page.";
  if(row.origin==="schedule")return "Your schedule or certificate states this cover"+where+". The plan's own wording has not been read yet, so this assumes the standard rule for this kind of plan: "+(row.note??"it pays as stated")+". Upload the policy wording or benefit summary and DearPolicy replaces the assumption with the actual clause.";
  if(basis==="indicative")return "Read from a table heading rather than the row itself"+where+", so it is shown but not added to the total.";
  return basis==="confirmed"
    ?"Read from your policy wording"+where+" and verified against the page by a second read."
    :"Read from your policy wording"+where+"; the second read could not fully verify it, so it is shown as an estimate.";
}

export function answerFromLedger(args:{rows:LedgerRow[];people:Person[];facts:Record<string,SubjectFacts>;hints?:Record<string,string[]>;whatIfText?:string}):LedgerAnswer{
  const out:LedgerAnswer={items:[],citations:[],question:null,questionsLeft:0,candidates:[],notes:[],ruledOut:[],considered:false,complete:true};
  const questions:LedgerQuestion[]=[];
  const seenQuestion=new Set<string>();
  const ask=(subjectId:string,q:{factKey:string;type:ChatQuestion["type"];options?:string[];text:string;why:string},facts:SubjectFacts)=>{
    if(seenQuestion.has(q.factKey)||knownValue(facts,q.factKey)!=null||alreadyAsked(facts,q.factKey))return;
    seenQuestion.add(q.factKey);
    questions.push({id:"ledger-"+q.factKey,type:q.type,text:q.text,why:q.why,subjectId,factKey:q.factKey,
      options:q.type==="yes_no"?["Yes","No","Not sure"]:q.options?[...q.options,"Not sure"]:undefined});
  };
  const whatIf=!!args.whatIfText;
  for(const person of args.people){
    const facts=args.facts[person.id]??{};
    const candidates:EventCandidate[]=whatIf?eventsFromText(args.whatIfText!):candidateEvents(facts,args.hints?.[person.id]??[]);
    if(!candidates.length)continue;
    const mine=args.rows.filter(r=>r.familyMemberId===person.id);
    const byEvent=new Map<EventType,LedgerRow[]>();
    for(const c of candidates){
      const rows=mine.filter(r=>r.eventType===c.event);
      if(rows.length)byEvent.set(c.event,rows);
    }
    if(!byEvent.size)continue;
    out.considered=true;
    // Gates first: only for events that have a row, so nothing is asked in vain.
    if(!whatIf)for(const c of candidates){
      if(!c.gate||!byEvent.has(c.event))continue;
      const gate=GATES[c.gate];
      const v=knownValue(facts,gate.factKey);
      if(v!=null)continue;
      ask(person.id,gate,facts);
    }
    const bodyPart=knownValue(facts,"fractureBodyPart");
    const cause=causeOf(facts,args.hints?.[person.id]??[]);
    if(!whatIf&&byEvent.has("fracture")&&bodyPart==null&&byEvent.get("fracture")!.some(r=>r.detail))
      ask(person.id,{factKey:"fractureBodyPart",type:"text",text:"Which bone was fractured?",why:"The fracture table pays a different amount for each part of the body."},facts);
    for(const [event,rows] of byEvent){
      const candidate=candidates.find(c=>c.event===event)!;
      // A gate answered "no" rules the event out; unanswered, it is being asked.
      if(candidate.gate){
        const gate=GATES[candidate.gate];
        const v=knownValue(facts,gate.factKey);
        if(!whatIf&&v==null)continue;
        if(v===false||(gate.factKey==="eventType"&&v==="illness"))continue;
      }
      for(const row of rows){	