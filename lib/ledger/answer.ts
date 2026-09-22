/**
 * One answer path: (person, event, facts) â†’ ledger rows â†’ figures.
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
  return person.name+" Â· "+row.planName+" â€” "+name;
}
export function describePays(row:LedgerRow){
  const c=row.currency;
  switch(row.paysKind){
    case "lump_sum":return row.amount!=null?formatMoney(row.amount,c)+" lump sum":"a lump sum";
    case "per_day":return row.amount!=null?formatMoney(row.amount,c)+" per day"+(row.offsetDays?" after the first "+row.offsetDays:"")+(row.maximumDays?", up to "+row.maximumDays+" days":""):"a daily amount";
    case "per_month":return row.amount!=null?formatMoney(row.amount,c)+" per month":"a monthly amount";
    case "percent_of_sum":return row.amount!=null?Math.round(row.amount*1000)/10+"% of the sum insured"+(row.sumBasis!=null?" ("+formatMoney(row.sumBasis,c)+")":""):"a percentage of the sum insured";
    case "reimbursement_cap":return row.amount!=null?"the actual cost, up to "+formatMoney(row.amount,c):"the actual cost, up to a limit";
    default:return "as stated in the plan â€” no figure on file";
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
      for(const row of rows){¶–b†WfVçCÓÓÒ&g&7GW&R"bgG—Vöb&öG•'CÓÓÒ'7G&–ær"bbg&7GW&U&÷tÖF6†W2‡&÷ræFWF–ÂÆ&öG•'B’–6öçF–çVS°¢òò&÷r&W7G&–7FVBFòöæR6W6R—26¶—VBv†VâF†R6W6R6öçG&F–7G0¢òò—BÂæBv—G2†6¶–ær’v†–ÆRF†R6W6R—2Væ¶æ÷vâà¢–b‡&÷ræ6W6Rbbv†D–b—°¢–b‡&÷ræ6W6RÓÖ6W6R—°¢–b†6W6SÓÖçVÆÂ—¶6²‡W'6öâæ–BÄtDU2æ66–FVçBÆf7G2“¶6öçF–çVS·Ğ¢6öçF–çVS°¢Ğ¢Ğ¢–b‡&÷rç—4¶–æCÓÓÒ'7FFVB'ÇÇ&÷ræÖ÷VçCÓÖçVÆÇÇÂ‡&÷rç—4¶–æCÓÓÒ'W&6VçEööe÷7VÒ"bg&÷rç7VÔ&6—3ÓÖçVÆÂ’–÷WBæ6ö×ÆWFSÖfÇ6S°¢òòF‡&W6†öÆBF†RWfVçB†2æ÷B&V6†VB'VÆW2F†R&÷r÷WC²Væ¶æ÷vâÂ—B—26¶VBà¢–b‡&÷ræÖ–æ–×VÔf7Bbg&÷ræÖ–æ–×VÕfÇVRÖçVÆÂbbv†D–b—°¢6öç7B†fSÖ¶æ÷våfÇVR†f7G2Ç&÷ræÖ–æ–×VÔf7B“°¢–b‡G—Vöb†fSÓÓÒ&çVÖ&W""bf†fSÇ&÷ræÖ–æ–×VÕfÇVR—¶÷WBç'VÆVD÷WBçW6‚‡&÷uF—FÆR‡W'6öâÇ&÷r’²"(	BæVVG2"·&÷ræÖ–æ–×VÔf7Bç&WÆ6R‚ò…´Õ¥Ò’örÂ"C"’çFôÆ÷vW$66R‚’²"öbBÆV7B"·&÷ræÖ–æ–×VÕfÇVR²"ÂæB"¶†fR²"v2&W÷'FVB"“¶6öçF–çVS·Ğ¢–b††fSÓÖçVÆÂ—¶6öç7BÔÔ”ä”ÕTÕõTU5D”ôå5·&÷ræÖ–æ–×VÔf7EÓ¶–b‡–6²‡W'6öâæ–BÇÆf7G2“·Ğ¢Ğ¢÷WBæ6æF–FFW2çW6‚‡&÷rçÆäæÖR²"(	B"¶Æ&VÂ‡&÷r’²‡&÷ræFWF–Âbg&÷ræWfVçEG—SÓÓÒ&g&7GW&R#ò"‚"·&÷ræFWF–Â²"’#¢""’“°¢òòVçF—F–W2ÂöæÇ’v†VâF†RWfVçB—2–âÆ’æBF†—2—2æ÷Bv†BÖ–bà¢6öç7BVçF—G“ÕTåD•E•ôd5E¶WfVçEÓ°¢6öç7BæVVG5VçF—G“Ò‡&÷rç—4¶–æCÓÓÒ'W%öF’'ÇÇ&÷rç—4¶–æCÓÓÒ'&V–Ö'W'6VÖVçEö6"’bg&÷ræÖ÷VçBÖçVÆÂbgVçF—G“°¢–b†æVVG5VçF—G’bf¶æ÷våfÇVR†f7G2ÇVçF—G’æf7D¶W’“ÓÖçVÆÂ–6²‡W'6öâæ–BÇ²ââçVçF—G’ÇG—S¢'FW‡B'ÒÆf7G2“°¢6öç7B&6—3Ö&6—4öb‡&÷r“°¢ÆWBÖ÷VçC¦çVÖ&W'ÆçVÆÃÖçVÆÃ¶ÆWB&6—5FW‡CÒ"#¶6öç7BÖ—76–æs§7G&–æuµÓÕµÓ°¢7v—F6‚‡&÷rç—4¶–æB—°¢66R&ÇV×÷7VÒ#¦Ö÷VçC×&÷ræÖ÷VçC¶&6—5FW‡C×&÷ræÖ÷VçBÖçVÆÃöf÷&ÖDÖöæW’‡&÷ræÖ÷VçBÇ&÷ræ7W'&Væ7’’²"ÇV×7VÒ#¢"#¶'&V³°¢66R'W&6VçEööe÷7VÒ# ¢–b‡&÷ræÖ÷VçBÖçVÆÂbg&÷rç7VÔ&6—2ÖçVÆÂ—¶Ö÷VçCÔÖF‚ç&÷VæB‡&÷ræÖ÷VçB§&÷rç7VÔ&6—2£’ó¶&6—5FW‡CÔÖF‚ç&÷VæB‡&÷ræÖ÷VçB£’ó²"Röb"¶f÷&ÖDÖöæW’‡&÷rç7VÔ&6—2Ç&÷ræ7W'&Væ7’“·Ğ¢VÇ6R–b‡&÷ræÖ÷VçBÖçVÆÂ–Ö—76–ærçW6‚‚'F†R7VÒ–ç7W&VBf÷""·&÷rçÆäæÖR²"(	Bæò66†VGVÆR÷"6W'F–f–6FRöâf–ÆR7FFW2—B"“°¢'&V³°¢66R'W%öF’#§°¢6öç7Bæ–v‡G3Ö¶æ÷våfÇVR†f7G2ÇVçF—G“òæf7D¶W“óò&†÷7—FÄæ–v‡G2"“°¢6öç7Böævö–æsÒv†D–bbf¶æ÷våfÇVR†f7G2Â&†÷7—FÅ7F”öævö–ær"“ÓÓ×G'VS°¢–b‡&÷ræÖ÷VçBÖçVÆÂbföævö–ær—°¢òò6ö×ÆWFVBÆVæwF‚öb7F’—2v†BGW&ç2F†—2–çFòf–wW&S°¢òò6¶–ærF†R6ÖRVçF—G’VW7F–öâv—F‚æò6öçFW‡B&VG20¢òòFV%öÆ–7’–væ÷&–ærv†Bv2§W7B6–BÂ6òF†R&VæVf—B—0¢òòæÖVB2÷FVçF–ÆÇ’Æ–6&ÆRæBF†R&VÂ&Æö6¶W"‡F†P¢òò7F’†2æ÷BVæFVB–WB’—27FFVBÆ–æÇ’–ç7FVBà¢Ö—76–ærçW6‚‚'F†R6ö×ÆWFVBÆVæwF‚öb7F’(	BF†—2&VæVf—BÖ’7F–ÆÂÇ’öæ6RF†R7F’†2VæFVB"“°¢ÖVÇ6R–b‡&÷ræÖ÷VçBÖçVÆÂbgG—Vöbæ–v‡G3ÓÓÒ&çVÖ&W""—°¢òòF†R6Æ7VÆF÷"—2F†RöæÇ’Æ6RF†—2&—F†ÖWF–2'Vç3¢—@¢òò&÷VæG2–&ÆRF—2FòF†RF’6†æWfW"âVæ6VBF–Ç¢òò&VæVf—B’æB&WGW&ç2æ÷EöÆ–6&ÆR&F†W"F†âC–÷W@¢òòv†VâF†Rv—F–ærW&–öBv2æWfW"6ÆV&VBà¢6öç7B6Æ3Ö6Æ7VÆFT†÷7—FÄ66‚‡°¢F–Ç•&FS§&÷ræÖ÷VçBÆ7W'&Væ7“§&÷ræ7W'&Væ7’Æ†÷7—FÅ7F”öævö–æs¦fÇ6RÆ†÷7—FÄæ–v‡G3¦æ–v‡G2À¢öfg6WDF—3§&÷ræöfg6WDF—3óóÆÖ†–×VÔF—3§&÷ræÖ†–×VÔF—2À¢÷væW'6†—§¶6öçG&7D–C§&÷rçöÆ–7”–Có÷&÷ræ–BÆ6÷fW&vT–C§&÷ræ–BÆÆ&VÃ§&÷rçÆäæÖWÒÀ¢'VÆTWf–FVæ6S§¶6‡Væ´–C¢&ÆVFvW#¢"·&÷ræ–BÇöÆ–7”–C§&÷rçöÆ–7”–Có÷VæFVf–æVBÇvU7F'C§&÷rç6÷W&6UvSó÷VæFVf–æVBÇvTVæC§&÷rç6÷W&6UvSó÷VæFVf–æVBÆÆ&VÃ§&÷rçÆäæÖWÒÀ¢÷væW'6†—Wf–FVæ6S§¶6‡Væ´–C¢&ÆVFvW#¢"·&÷ræ–BÇöÆ–7”–C§&÷rçöÆ–7”–Có÷VæFVf–æVBÇvU7F'C§&÷rç6÷W&6UvSó÷VæFVf–æVBÇvTVæC§&÷rç6÷W&6UvSó÷VæFVf–æVBÆÆ&VÃ§&÷rçÆäæÖWÒÀ¢Ò“°¢–b†6Æ2ç7FGW3ÓÓÒ&6Æ7VÆFVB"—°¢Ö÷VçCÖ6Æ2ç÷FVçF–ÄÖ÷VçC°¢&6—5FW‡CÖf÷&ÖDÖöæW’‡&÷ræÖ÷VçBÇ&÷ræ7W'&Væ7’’²"9r"¶6Æ2ç–&ÆTF—2²"–&ÆRæ–v‡B"²†6Æ2ç–&ÆTF—3ÓÓÓò"#¢'2"’²†6Æ2æöfg6WDF—3ò"†gFW"F†Rf—'7B"¶6Æ2æöfg6WDF—2²"’#¢""“°¢ÖVÇ6R–b†6Æ2ç7FGW3ÓÓÒ&æ÷EöÆ–6&ÆR"—°¢Ö—76–ærçW6‚‚&6ö×ÆWFVB7F’ÆöærVæ÷Vv‚Fò6ÆV"F†R"¶6Æ2æöfg6WDF—2²"ÖF’v—F–ærW&–öB‚"¶6Æ2ç&W÷'FVD†÷7—FÄæ–v‡G2²"æ–v‡B"²†6Æ2ç&W÷'FVD†÷7—FÄæ–v‡G3ÓÓÓò"#¢'2"’²"&W÷'FVB’"“°¢ÖVÇ6W°¢òò7G'V7GW&Â&Æö6²†Ö÷7B6öÖÖöæÇ’Ö—76–ærF’6“¢æWfW ¢òò6†÷râVæ6VB÷"÷F†W'v—6RVçfW&–f–VBF–Ç’Ö÷VçBà¢Ö—76–ærçW6‚†6Æ2æÖW76vR“°¢Ğ¢ÖVÇ6R–b‚v†D–bbg&÷ræÖ÷VçBÖçVÆÂ–Ö—76–ærçW6‚‚'F†RçVÖ&W"öbæ–v‡G2"“°¢'&V³·Ğ¢66R'&V–Ö'W'6VÖVçEö6#§°¢6öç7B&–ÆÃÖ¶æ÷våfÇVR†f7G2ÇVçF—G“òæf7D¶W“óò&÷WDöeö6¶WB"“°¢–b‡&÷ræÖ÷VçBÖçVÆÂbgG—Vöb&–ÆÃÓÓÒ&çVÖ&W""—¶Ö÷VçCÔÖF‚æÖ–â†&–ÆÂÇ&÷ræÖ÷VçB“¶&6—5FW‡CÒ'F†RÆ÷vW"öbF†R&W÷'FVB6÷7B"¶f÷&ÖDÖöæW’†&–ÆÂÇ&÷ræ7W'&Væ7’’²"æBF†RÆ–Ö—B"¶f÷&ÖDÖöæW’‡&÷ræÖ÷VçBÇ&÷ræ7W'&Væ7’“·Ğ¢VÇ6R–b‚v†D–bbg&÷ræÖ÷VçBÖçVÆÂ–Ö—76–ærçW6‚‚'F†R7GVÂ6÷7B"“°¢'&V³·Ğ¢66R'W%öÖöçF‚#¦'&V³°¢FVfVÇC¦'&V³°¢Ğ¢6öç7B6öæF—F–öç3Õ²ââç&÷ræ6öæF—F–öç2æÖ†3Óæ2çG&–Ò‚’’æf–ÇFW"„&ööÆVâ•Ó°¢f÷"†6öç7BÒöbÖ—76–ær–6öæF—F–öç2çW6‚‚%7F–ÆÂæVVFVC¢"¶Ò“°¢–b‡&÷rç7FGW2ÓÒ&6öæf—&ÖVB"–6öæF—F–öç2çW6‚‡&÷ræ÷&–v–ãÓÓÒ'66†VGVÆR#ò$77VÖW2F†R7FæF&B'VÆRf÷"F†—2¶–æBöbÆâVçF–ÂF†Rv÷&F–ær—2&VBâ#¢$æ÷B–WBfW&–f–VBv–ç7BF†RöÆ–7’v÷&F–ærâ"“°¢6öæF—F–öç2çW6‚‚%7V&¦V7BFòF†R–ç7W&W"w276W76ÖVçBæBF†RÆâw2÷vâFW&×2æBW†6ÇW6–öç2â"“°¢òòf–wW&RW'6öâ6ææ÷BG&6R&6²FòöæRöbF†V—"÷vâ6÷fW'2—2¢òòf–wW&RF†W’6ææ÷B6†V6²ÂæBF†RÖöæWF'’vFR&Æö6·2ç¢òò6Æ7VÆFVBÖ÷VçBv—F†÷WBF†—2Ö–ærâ&÷rçöÆ–7”–F—2F†P¢òòFö7VÖVçBFV%öÆ–7’7GVÆÇ’&VBF†—2'VÆRg&öÒÒÒÇ&VG’&÷fV@¢òòFò&VÆöærFòâ÷væVB6öçG&7B&Vf÷&RF†R&÷rv2WfW"6VVFV@¢òò‡v÷&F–æu6VVG2÷66†VGVÆU6VVG2öæÇ’'Vâ÷fW"W'6öâw2÷và¢òò6öçG&7G2’ÒÒ6ò—B—2F†R&VÂÂ÷væVB–FVçF–f–W"Âæ÷B7FæBÖ–âà¢6öç7B&÷t6öçG&7D–C×&÷rçöÆ–7”–Cóò‚&ÆVFvW#¢"·&÷ræfÖ–Ç”ÖVÖ&W$–B“°¢6öç7B—FVÓ¤6Æ–Ô—FVÓ×°¢F—FÆS§&÷uF—FÆR‡W'6öâÇ&÷r’À¢6öçG&7D–C§&÷t6öçG&7D–BÀ¢6÷fW$¶W“¦6÷fW$¶W’‡¶–ç7W&W#§&÷ræ–ç7W&W"Ç&öGV7DæÖS§&÷rçÆäæÖRÆ6öçG&7D–C§&÷t6öçG&7D–GÒ’À¢7FGW3¦Ö÷VçBÖçVÆÃò†Ö—76–æræÆVæwF‡ÇÇ&÷rç7FGW2ÓÒ&6öæf—&ÖVB'ÇÇ&÷ræ6öæF—F–öç2æÆVæwFƒò'÷FVçF–ÆÇ•öÆ–6&ÆR#¢&Æ–¶VÇ•öÆ–6&ÆR"“¢&æVVG5öFö7VÖVçB"À¢Ö÷VçEFW‡C¦Ö÷VçBÖçVÆÃöf÷&ÖDÖöæW’†Ö÷VçBÇ&÷ræ7W'&Væ7’“¢‡&÷rç—4¶–æCÓÓÒ'7FFVB'ÇÇv†D–gÇÇ&÷rç—4¶–æCÓÓÒ'W%öÖöçF‚"“öFW67&–&U—2‡&÷r“¦çVÆÂÀ¢Ö÷VçDÆ&VÃ¦Ö÷VçBÖçVÆÃò‡&÷rç—4¶–æCÓÓÒ'&V–Ö'W'6VÖVçEö6#ò%÷FVçF–Â&V–Ö'W'6VÖVçB#¢%÷FVçF–Â–÷WB"“¢%v†BF†—2&VæVf—B—2"À¢âââ†Ö÷VçBÖçVÆÃ÷¶W7F–ÖFT&6—3¦&6—2Æ6Æ7VÆFVDÖ÷VçC¦Ö÷VçBÆ7W'&Væ7“§&÷ræ7W'&Væ7’À¢6Æ7VÆF–öä¶–æC§&÷rç—4¶–æCÓÓÒ'W&6VçEööe÷7VÒ#ò'7VÕö–ç7W&VB#§&÷rç—4¶–æCÓÓÒ&ÇV×÷7VÒ#ò&f—†VB#§&÷rç—4¶–æCÓÓÒ'W%öF’#ò&F–Ç’#¢&W‡Vç6Uö6"À¢vw&VvF–öã§&÷rç—4¶–æCÓÓÒ'&V–Ö'W'6VÖVçEö6#ò'&V–Ö'W'6VÖVçB"26öç7C¢&FF—F—fR"26öç7BÆ6Æ7VÆF–öä–C¢&ÆVFvW#¢"·&÷ræ–GÓ§·Ò’À¢&V6öã¢†Ö÷VçBÖçVÆÃö&6—5FW‡B²"â#¢%F†—2Æâ—2"¶FW67&–&U—2‡&÷r’²"â"’·v‡•FW‡B‡&÷rÆ&6—2’À¢6öæF—F–öç3¥²ââææWr6WB†6öæF—F–öç2•ÒÀ¢Ó°¢÷WBæ—FV×2çW6‚†—FVÒ“°¢÷WBæ6—FF–öç2çW6‚‡¶6‡Væ´–C¢&ÆVFvW#¢"·&÷ræ–BÇöÆ–7”–C§&÷rçöÆ–7”–Cóò""ÇöÆ–7”æÖS§&÷rçÆäæÖRÆ–ç7W&W#§&÷ræ–ç7W&W#ó÷VæFVf–æVBÀ¢vU7F'C§&÷rç6÷W&6UvSóóÇvTVæC§&÷rç6÷W&6UvSóóÇW'6öæÄWf–FVæ6S§&÷ræ÷&–v–âÓÒ'v÷&F–ær"À¢Wf–FVæ6TÆ&VÃ§&÷ræ÷&–v–ãÓÓÒ'66†VGVÆR#ò%–÷W"66†VGVÆR÷"6W'F–f–6FR#§&÷ræ÷&–v–ãÓÓÒ'W'6öâ#ò$VçFW&VBöâF†R6÷fW&vRvR#¢%öÆ–7’v÷&F–ærÂ&VBv†VâF†RFö7VÖVçBv2WÆöFVB'Ò“°¢Ğ¢Ğ¢Ğ¢÷WBæ6æF–FFW3Õ²ââææWr6WB†÷WBæ6æF–FFW2•Ó°¢–b‡VW7F–öç2æÆVæwF‚—¶÷WBçVW7F–öã×VW7F–öç5³Ó¶÷WBçVW7F–öç4ÆVgC×VW7F–öç2æÆVæwFƒ·Ğ¢&WGW&â÷WC°§Ğ 