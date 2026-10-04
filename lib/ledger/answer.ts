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
    ?"Read from your policy wording"+where+" and checked against the page."
    :"Read from your policy wording"+where+"; it could not yet be fully checked against the page, so it is shown as an estimate.";
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
    // Round 9: an illness with no hospital stay said ("my helper fell sick, need to see doctor") is not asked about an
    // operation first: whether there was an admission is the question that fits, and with none, surgery is not asked at all.
    const bodily=knownValue(facts,"injured")===true||knownValue(facts,"fractureBodyPart")!=null||knownValue(facts,"eventType")==="accident"||knownValue(facts,"accidentType")!=null;
    const stay=knownValue(facts,"hospitalised");
    const surgeryWaits=!bodily&&stay!==true&&knownValue(facts,"hospitalNights")==null;
    if(!whatIf)for(const c of candidates){
      if(!c.gate||!byEvent.has(c.event))continue;
      const gate=GATES[c.gate];
      const v=knownValue(facts,gate.factKey);
      if(v!=null)continue;
      if(c.gate==="surgery"&&surgeryWaits){if(stay==null)ask(person.id,GATES.hospitalised,facts);continue;}
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
        if(event==="fracture"&&typeof bodyPart==="string"&&!fractureRowMatches(row.detail,bodyPart))continue;
        // A row restricted to one cause is skipped when the cause contradicts
        // it, and waits (asking) while the cause is unknown.
        if(row.cause&&!whatIf){
          if(row.cause!==cause){
            if(cause==null){ask(person.id,GATES.accident,facts);continue;}
            continue;
          }
        }
        if(row.paysKind==="stated"||row.amount==null||(row.paysKind==="percent_of_sum"&&row.sumBasis==null))out.complete=false;
        // A threshold the event has not reached rules the row out; unknown, it is asked.
        if(row.minimumFact&&row.minimumValue!=null&&!whatIf){
          const have=knownValue(facts,row.minimumFact);
          if(typeof have==="number"&&have<row.minimumValue){out.ruledOut.push(rowTitle(person,row)+" — needs "+row.minimumFact.replace(/([A-Z])/g," $1").toLowerCase()+" of at least "+row.minimumValue+", and "+have+" was reported");continue;}
          if(have==null){const q=MINIMUM_QUESTIONS[row.minimumFact];if(q)ask(person.id,q,facts);}
        }
        out.candidates.push(row.planName+" — "+label(row)+(row.detail&&row.eventType==="fracture"?" ("+row.detail+")":""));
        // Quantities, only when the event is in play and this is not a what-if.
        const quantity=QUANTITY_FACT[event];
        const needsQuantity=(row.paysKind==="per_day"||row.paysKind==="reimbursement_cap")&&row.amount!=null&&quantity;
        if(needsQuantity&&knownValue(facts,quantity.factKey)==null)ask(person.id,{...quantity,type:"text"},facts);
        const basis=basisOf(row);
        let amount:number|null=null;let basisText="";const missing:string[]=[];
        switch(row.paysKind){
          case "lump_sum":amount=row.amount;basisText=row.amount!=null?formatMoney(row.amount,row.currency)+" lump sum":"";break;
          case "percent_of_sum":
            if(row.amount!=null&&row.sumBasis!=null){amount=Math.round(row.amount*row.sumBasis*100)/100;basisText=Math.round(row.amount*1000)/10+"% of "+formatMoney(row.sumBasis,row.currency);}
            else if(row.amount!=null)missing.push("the sum insured for "+row.planName+" — no schedule or certificate on file states it");
            break;
          case "per_day":{
            const nights=knownValue(facts,quantity?.factKey??"hospitalNights");
            const ongoing=!whatIf&&knownValue(facts,"hospitalStayOngoing")===true;
            if(row.amount!=null&&ongoing){
              // A completed length of stay is what turns this into a figure;
              // asking the same quantity question with no context reads as
              // DearPolicy ignoring what was just said, so the benefit is
              // named as potentially applicable and the real blocker (the
              // stay has not ended yet) is stated plainly instead.
              missing.push("the completed length of stay — this benefit may still apply once the stay has ended");
            }else if(row.amount!=null&&typeof nights==="number"){
              // The calculator is the only place this arithmetic runs: it
              // bounds payable days to the day cap (never an uncapped daily
              // benefit) and returns not_applicable rather than a $0 payout
              // when the waiting period was never cleared.
              const calc=calculateHospitalCash({
                dailyRate:row.amount,currency:row.currency,hospitalStayOngoing:false,hospitalNights:nights,
                offsetDays:row.offsetDays??0,maximumDays:row.maximumDays,
                ownership:{contractId:row.policyId??row.id,coverageId:row.id,label:row.planName},
                ruleEvidence:{chunkId:"ledger:"+row.id,policyId:row.policyId??undefined,pageStart:row.sourcePage??undefined,pageEnd:row.sourcePage??undefined,label:row.planName},
                ownershipEvidence:{chunkId:"ledger:"+row.id,policyId:row.policyId??undefined,pageStart:row.sourcePage??undefined,pageEnd:row.sourcePage??undefined,label:row.planName},
              });
              if(calc.status==="calculated"){
                amount=calc.potentialAmount;
                basisText=formatMoney(row.amount,row.currency)+" × "+calc.payableDays+" payable night"+(calc.payableDays===1?"":"s")+(calc.offsetDays?" (after the first "+calc.offsetDays+")":"");
              }else if(calc.status==="not_applicable"){
                missing.push("a completed stay long enough to clear the "+calc.offsetDays+"-day waiting period ("+calc.reportedHospitalNights+" night"+(calc.reportedHospitalNights===1?"":"s")+" reported)");
              }else{
                // A structural block (most commonly a missing day cap): never
                // show an uncapped or otherwise unverified daily amount.
                missing.push(calc.message);
              }
            }else if(!whatIf&&row.amount!=null)missing.push("the number of nights");
            break;}
          case "reimbursement_cap":{
            const bill=knownValue(facts,quantity?.factKey??"outOfPocket");
            if(row.amount!=null&&typeof bill==="number"){amount=Math.min(bill,row.amount);basisText="the lower of the reported cost "+formatMoney(bill,row.currency)+" and the limit "+formatMoney(row.amount,row.currency);}
            else if(!whatIf&&row.amount!=null)missing.push("the actual cost");
            break;}
          case "per_month":break;
          default:break;
        }
        const conditions=[...row.conditions.map(c=>c.trim()).filter(Boolean)];
        for(const m of missing)conditions.push("Still needed: "+m.replace(/[.\s]+$/,"")+".");
        if(row.status!=="confirmed")conditions.push(row.origin==="schedule"?"Assumes the standard rule for this kind of plan until the wording is read.":"Not yet verified against the policy wording.");
        conditions.push("Subject to the insurer's assessment and the plan's own terms and exclusions.");
        // A figure a person cannot trace back to one of their own covers is a
        // figure they cannot check, and the monetary gate blocks any
        // calculated amount without this mapping. `row.policyId` is the
        // document DearPolicy actually read this rule from -- already proved
        // to belong to an owned contract before the row was ever seeded
        // (wordingSeeds/scheduleSeeds only run over a person's own
        // contracts) -- so it is the real, owned identifier, not a stand-in.
        const rowContractId=row.policyId??("ledger:"+row.familyMemberId);
        const item:ClaimItem={
          title:rowTitle(person,row),
          contractId:rowContractId,
          coverKey:coverKey({insurer:row.insurer,productName:row.planName,contractId:rowContractId}),
          status:amount!=null?(missing.length||row.status!=="confirmed"||row.conditions.length?"potentially_applicable":"likely_applicable"):"needs_document",
          amountText:amount!=null?formatMoney(amount,row.currency):(row.paysKind==="stated"||whatIf||row.paysKind==="per_month")?describePays(row):null,
          amountLabel:amount!=null?(row.paysKind==="reimbursement_cap"?"Calculated reimbursement (internal)":"Calculated benefit (internal)"):"What this benefit pays",
          ...(amount!=null?{estimateBasis:basis,calculatedAmount:amount,currency:row.currency,
            calculationKind:row.paysKind==="percent_of_sum"?"sum_insured":row.paysKind==="lump_sum"?"fixed":row.paysKind==="per_day"?"daily":"expense_cap",
            aggregation:row.paysKind==="reimbursement_cap"?"reimbursement" as const:"additive" as const,calculationId:"ledger:"+row.id}:{}),
          reason:(amount!=null?basisText+". ":"This plan pays "+describePays(row)+". ")+whyText(row,basis),
          conditions:[...new Set(conditions)],
        };
        out.items.push(item);
        if(row.policyId)out.citations.push({chunkId:"ledger:"+row.id,policyId:row.policyId,policyName:row.planName,insurer:row.insurer??undefined,
          pageStart:row.sourcePage??null,pageEnd:row.sourcePage??null,personalEvidence:row.origin!=="wording",
          evidenceLabel:row.origin==="schedule"?"Your schedule or certificate":row.origin==="person"?"Entered on the Coverage page":"Policy wording, read when the document was uploaded"});
      }
    }
  }
  out.candidates=[...new Set(out.candidates)];
  if(questions.length){out.question=questions[0];out.questionsLeft=questions.length;}
  return out;
}
