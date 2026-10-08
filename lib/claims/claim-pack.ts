import { FACT_FINDING_SPECS, type FactFindingCategory } from "./fact-finding";
import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import { PRELIMINARY_ASSESSMENT_NOTICE,scrubMonetaryText } from "@/lib/chat/monetary-boundary";
import type { ClaimDecisionPacket,ClaimFacts } from "./types";
import { benefitName,sentenceKey,sentencesOf } from "./answer-shape";

/** The claim pack.
 *
 * DearPolicy already works out what a household can claim. The part that still
 * defeats people is the hour at the kitchen table afterwards: which benefit,
 * under which policy, for how much, and what has to go in the envelope. This
 * turns the assessment into one sheet a person can put in front of an insurer.
 *
 * It states only what is already established: the facts the person reported,
 * the rules read out of their own documents, and the arithmetic done from them.
 * It never invents an amount, never fills in a fact nobody supplied, and always
 * says that the insurer decides the final figure. */
export type ClaimPackSection={heading:string;lines:string[];note?:string};
export type ClaimPackContent={title:string;subtitle:string;sections:ClaimPackSection[];footer:string};

function dateText(value:string|null|undefined){
  if(!value)return null;
  const parsed=new Date(value+(/^\d{4}-\d{2}-\d{2}$/.test(value)?"T00:00:00":""));
  if(Number.isNaN(parsed.getTime()))return value;
  return parsed.toLocaleDateString("en-SG",{day:"numeric",month:"long",year:"numeric"});
}
function eventLines(facts:ClaimFacts){
  const lines:string[]=[];
  const add=(label:string,value:string|null|undefined)=>{if(value)lines.push(label+": "+value);};
  add("Date of the event",dateText(facts.eventDate??facts.accidentDate??facts.diagnosisDate??facts.deathDate));
  add("What happened",facts.accidentType);
  add("Diagnosis",[facts.diagnosis,facts.diagnosisSite,facts.diagnosisStage].filter(Boolean).join(", ")||null);
  if(facts.death)add("Date of death",dateText(facts.deathDate)??"reported, date not stated");
  add("Cause of death",facts.causeOfDeath);
  if(facts.injuries.length)add("Injuries reported",facts.injuries.join(", "));
  add("Fracture",facts.fractureBodyPart);
  if(facts.hospitalNights!=null)add("Nights in hospital",String(facts.hospitalNights));
  if(facts.surgery)add("Surgery","yes");
  if(facts.ambulanceUsed)add("Ambulance used","yes");
  // Figures the family typed are facts to verify, never coverage, and their
  // currency is unknown: no currency symbol is ever attached to them.
  const reported=(value:number)=>value.toLocaleString("en-SG")+" as reported (currency and amount to be verified from the receipts)";
  if(facts.hospitalBill!=null)add("Hospital bill",reported(facts.hospitalBill));
  if(facts.ambulanceBill!=null)add("Ambulance bill",reported(facts.ambulanceBill));
  if(facts.outOfPocket!=null)add("Paid out of pocket",reported(facts.outOfPocket));
  // Agent G: the amount the household says it is claiming -- their figure, in the currency they gave (none if they gave
  // none), never the bill or an estimate.
  const claimed=facts.claimedAmount;
  if(claimed&&Number.isFinite(claimed.amount))add("Amount being claimed",(claimed.currency?claimed.currency+" ":"")+claimed.amount.toLocaleString("en-SG")+" as you reported it"+(claimed.currency?"":" (currency not stated)")+" — to be verified from the receipts");
  return lines;
}
/** What an insurer asks for, decided by what actually happened. Generic enough
 * to be right for any insurer, specific enough to save a second trip. */
export function documentsToAttach(facts:ClaimFacts){
  const documents:string[]=["The insurer's own claim form, signed and dated","A copy of the policy schedule or certificate for the plan being claimed under"];
  if(facts.death){
    // One document to the family: the death certificate, with the doctor's
    // Certificate of Cause of Death where one was issued.
    documents.push("Death certificate (with the Certificate of Cause of Death, if one was issued)");
    documents.push("Proof of the claimant's identity and relationship to the deceased");
  }
  if(facts.accidentType||facts.eventType==="accident")documents.push("Police or accident report, if one was made");
  if(facts.diagnosis){
    documents.push("Specialist's medical report stating the diagnosis and the date it was made");
    documents.push("Test results confirming the diagnosis (histology, biopsy or scan report)");
  }
  if(facts.hospitalised||facts.hospitalNights!=null){
    documents.push("Hospital discharge summary showing the dates of admission and discharge");
    documents.push("Itemised final hospital bill");
  }
  if(facts.surgery)documents.push("Operation report");
  if(facts.ambulanceUsed||facts.ambulanceBill!=null)documents.push("Ambulance invoice");
  if(facts.permanentImpairment)documents.push("Attending doctor's assessment of permanent impairment");
  if(facts.hospitalBill!=null||facts.outOfPocket!=null||facts.ambulanceBill!=null||facts.claimedAmount!=null)
    documents.push("Original receipts for every amount being claimed");
  return [...new Set(documents)];
}
/** The proof a travel claim needs depends on what happened on the trip. */
function travelIncidentDocument(label:string,facts:ClaimFacts){
  if(!/^Airline delay letter, police report or medical report/.test(label))return label;
  const kind=String((facts as Record<string,unknown>).travelEventType??"").toLowerCase();
  if(/baggage|luggage/.test(kind))return /delay/.test(kind)?"The airline’s report of the delayed bag, and receipts for essentials bought":"The airline’s property irregularity report (or a police report), and receipts or photos of the lost items";
  if((facts as Record<string,unknown>).flightDelayHours!=null||/delay/.test(kind))return "The airline’s letter confirming the delay and how long it was";
  if(/cancel|cut short|curtail/.test(kind))return "Proof of why the trip was cancelled or cut short (for example a medical report or death certificate), and the booking receipts";
  if(/passport|travel document/.test(kind))return "A police report of the loss, and receipts for the replacement travel document";
  if(/medical|sick|ill/.test(kind))return "The overseas doctor’s report and itemised bills";
  return label;
}
/** The claim's category, from what happened (not from which benefit matched). */
export function claimCategoryFromFacts(facts:ClaimFacts&Record<string,unknown>,eventType?:string|null,stored?:string|null):FactFindingCategory|null{
  if(stored&&stored in FACT_FINDING_SPECS)return stored as FactFindingCategory;
  const type=String(eventType??facts.eventType??"");
  if(facts.death===true||type==="death")return "accidental_death";
  if(facts.injured===true||facts.fractureBodyPart||facts.injuryKind||(Array.isArray(facts.injuries)&&facts.injuries.length)||type==="accident")return "accidental_injury";
  if(facts.diagnosis||type==="diagnosis")return "critical_illness";
  if(facts.disabled===true||type==="disability")return "disability_tpd";
  if(facts.flightDelayHours!=null||facts.tripStartDate||type==="travel_disruption")return "travel";
  if(facts.hospitalised===true||facts.hospitalNights!=null||type==="hospitalisation")return "medical_reimbursement";
  return null;
}
/** Every document this claim needs, in one list: the insurer's form and the
 * schedule, the category's required documents (a doctor's or X-ray report for
 * a fracture, a death certificate only for a death), and what the reported
 * facts add. The claim pack, the claims list, the claim page and the chat's
 * final answer all read this, so they never disagree. */
export function claimDocuments(facts:ClaimFacts,category:FactFindingCategory|null){
  const own=category?FACT_FINDING_SPECS[category].documents.filter(d=>d.required).map(d=>d.label).map(d=>category==="travel"?travelIncidentDocument(d,facts):d):[];
  const stay=category==="medical_reimbursement"||(category==="accidental_injury"&&(facts.hospitalised||facts.hospitalNights!=null))
    ?FACT_FINDING_SPECS.medical_reimbursement.documents.filter(d=>d.required).map(d=>d.label):[];
  const all=[...documentsToAttach(facts).slice(0,2),...own,...stay,...documentsToAttach(facts).slice(2)]
    // A death from an illness involves no police or coroner.
    .filter(d=>!(category==="accidental_death"&&(facts as {accidentalDeath?:boolean|null}).accidentalDeath===false&&/police|coroner/i.test(d)));
  return dedupeDocuments(all);
}
/** The same document under two names ("Discharge summary" and "Hospital
 * discharge summary showing the dates of admission and discharge"; two
 * itemised-bill lines) is asked for once, in its most specific wording. */
function documentKey(label:string){
  const t=label.toLowerCase();
  if(/discharge summary/.test(t))return "discharge-summary";
  if(/itemi[sz]ed/.test(t)&&/bill|invoice/.test(t))return "itemised-bill";
  if(/death certificate|certificate of (?:cause of )?death/.test(t))return "death-certificate";
  if(/specialist/.test(t)&&/diagnos/.test(t))return "specialist-report";
  if(/histopatholog|histolog|biopsy|test results/.test(t)&&/diagnos/.test(t))return "diagnosis-tests";
  if(/police/.test(t)&&/coroner/.test(t))return "police-coroner";
  if(/doctor|x-ray|scan report|medical report/.test(t)&&/injur/.test(t))return "injury-report";
  return t.replace(/[^a-z]+/g," ").trim();
}
/** Where two names for one document are asked for, the wording that names both wins. */
const PREFERRED_LABEL:Record<string,RegExp>={"death-certificate":/Certificate of Cause of Death, if one/,"specialist-report":/date it was made/,"diagnosis-tests":/histology, biopsy or scan/};
export function dedupeDocuments(labels:string[]):string[]{
  const chosen=new Map<string,string>();
  for(const label of labels){
    const key=documentKey(label),current=chosen.get(key);
    if(!current)chosen.set(key,label);
    else if(PREFERRED_LABEL[key]?.test(current))continue;
    else if(PREFERRED_LABEL[key]?.test(label)||label.length>current.length)chosen.set(key,label);
  }
  return [...chosen.values()];
}
/** The status of each benefit, in the words the chat's cards use (app/chat/page.tsx). */
export const PACK_STATUS:Record<ClaimDecisionPacket["assessments"][number]["status"],string>={likely_applicable:"Likely applicable",potentially_applicable:"Potentially applicable",not_applicable:"Not applicable",needs_document:"Needs checking"};
export function claimPackContent(args:{packet:ClaimDecisionPacket;claimantName:string;relationship?:string|null;generatedOn?:Date}){
  const {packet}=args;
  const generated=args.generatedOn??new Date();
  // Round 13: every benefit the chat's answer shows is on the sheet, with its
  // status -- a personal benefit that still needs documents is not left off
  // because only the group card was "potentially applicable".
  const claimable=packet.assessments.filter(item=>item.status!=="not_applicable");
  const sections:ClaimPackSection[]=[];
  sections.push({heading:"Claimant",lines:[
    "Name: "+args.claimantName,
    ...(args.relationship&&args.relationship!=="self"?["Relationship to the policyholder: "+args.relationship]:[]),
  ]});
  sections.push({heading:"What happened",lines:[packet.eventSummary,...eventLines(packet.facts)].filter(Boolean)});
  // A claim pack is built from a PRELIMINARY claim assessment (live chat has
  // no reviewed claim evidence), so it lists benefits, pages, conditions and
  // documents -- never an amount or a total. See lib/chat/monetary-boundary.ts.
  // Round 13: the sheet says each sentence once, like the chat's answer
  // (lib/claims/answer-shape.ts): what several benefits share is printed once
  // under them, and a document in the list is not asked for again as a step.
  // Two benefits whose reasons open the same way ("Pays as charged (page 3).") are told apart by their names, as on the chat's cards.
  const openingKey=(item:typeof claimable[number])=>sentenceKey(sentencesOf(scrubMonetaryText(item.reason))[0]??"");
  const openings=new Map<string,number>();
  for(const item of claimable)openings.set(openingKey(item),(openings.get(openingKey(item))??0)+1);
  const reasonOf=(item:typeof claimable[number])=>{
    const sentences=sentencesOf(scrubMonetaryText(item.reason)),name=benefitName(item.title);
    if(sentences.length&&(openings.get(openingKey(item))??0)>1&&name&&!sentenceKey(sentences[0]).startsWith(sentenceKey(name)))
      sentences[0]=name+": "+sentences[0].replace(/^./,x=>x.toLowerCase());
    return sentences;
  };
  const conditionsOf=(item:typeof claimable[number])=>[...new Set(item.conditions.map(c=>scrubMonetaryText(c)))];
  const holders=new Map<string,{text:string;count:number}>();
  for(const item of claimable){
    const own=new Set<string>();
    for(const sentence of [...reasonOf(item).slice(1),...conditionsOf(item).flatMap(sentencesOf)]){
      const key=sentenceKey(sentence);if(sentence.length<25||own.has(key))continue;own.add(key);
      const entry=holders.get(key)??{text:sentence,count:0};entry.count++;holders.set(key,entry);
    }
  }
  const sharedKeys=new Set(claimable.length>1?[...holders].filter(([,e])=>e.count>1).map(([k])=>k):[]);
  const notShared=(sentence:string)=>!sharedKeys.has(sentenceKey(sentence));
  if(claimable.length)sections.push({
    heading:"Benefits that may be relevant",
    lines:[...claimable.flatMap(item=>{
      const evidence=item.ruleEvidence;
      const reason=reasonOf(item);
      const said=new Set(reason.map(sentenceKey));
      const conditions=conditionsOf(item).map(c=>sentencesOf(c).filter(notShared).filter(x=>!said.has(sentenceKey(x))).join(" ")).filter(Boolean);
      return [
        item.title+(item.supersededBy?" (the policy pays this instead of \u201c"+item.supersededBy+"\u201d)":"")+" \u2014 "+PACK_STATUS[item.status],
        "    Why it may be relevant: "+[reason[0],...reason.slice(1).filter(notShared)].filter(Boolean).join(" "),
        ...(evidence?["    Policy wording: "+evidence.policyName+", page "+evidence.pageStart+(evidence.pageEnd!==evidence.pageStart?"–"+evidence.pageEnd:"")]:[]),
        ...conditions.map(condition=>"    Condition: "+condition),
      ];
    }),...(sharedKeys.size?["Applies to each benefit above:",...[...sharedKeys].map(k=>"    "+holders.get(k)!.text)]:[])],
    note:PRELIMINARY_ASSESSMENT_NOTICE+" The insurer determines eligibility and any amount after assessment.",
  });
  else sections.push({heading:"Benefits that may be relevant",lines:[
    "No relevant benefit has been identified yet from the documents on file.",
  ],note:"This usually means a policy schedule or the benefit wording is still missing. Upload it and the claim pack can be produced again."});
  const missing=[...new Set(packet.missingFacts)];
  if(missing.length)sections.push({
    heading:"Still needed before this is submitted",
    lines:missing.map(fact=>"• "+fact),
  });
  const documents=claimDocuments(packet.facts,claimCategoryFromFacts(packet.facts as ClaimFacts&Record<string,unknown>,null,packet.claimCategory??null));
  sections.push({heading:"Documents to attach",lines:documents.map(document=>"• "+document)});
  // "Attach: <a document already in the list>" is the list again, not a step.
  const listed=new Set(documents.map(sentenceKey));
  const steps=[...new Set(packet.nextSteps)].filter(step=>{const m=step.match(/^Attach:\s*(.*?)\.?$/);return !m||!listed.has(sentenceKey(m[1]));});
  if(steps.length)sections.push({heading:"Next steps",lines:steps.map((step,index)=>index+1+". "+step)});
  return {
    title:"Claim summary",
    subtitle:args.claimantName+" · prepared "+generated.toLocaleDateString("en-SG",{day:"numeric",month:"long",year:"numeric"}),
    sections,
    footer:"Prepared by DearPolicy. Figures are calculated from the policy wording quoted in this pack and from the facts reported by the claimant. They are not an offer, an admission of liability, or a decision by any insurer.",
  } satisfies ClaimPackContent;
}

/** Lays the pack out as a PDF. Plain type, generous margins, no images: it is
 * made to be printed, signed and put in an envelope. */
export async function renderClaimPack(content:ClaimPackContent){
  const pdf=await PDFDocument.create();
  pdf.setTitle(content.title+" — "+content.subtitle);
  pdf.setProducer("DearPolicy");
  const body=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const [width,height]=[595.28,841.89],margin=54,right=width-margin;
  const ink=rgb(0.09,0.13,0.11),muted=rgb(0.42,0.46,0.44),rule=rgb(0.82,0.85,0.83);
  let page=pdf.addPage([width,height]),y=height-margin;
  const newPage=()=>{page=pdf.addPage([width,height]);y=height-margin;};
  const wrap=(text:string,size:number,font:typeof body,maxWidth:number)=>{
    const lines:string[]=[];
    // A continuation line keeps the indent of the line it belongs to, so a
    // condition never reads as a new benefit.
    const indent=text.match(/^\s*/)?.[0]??"";
    for(const paragraph of text.split("\n")){
      let current="";
      for(const word of paragraph.trim().split(/\s+/)){
        const candidate=current?current+" "+word:indent+word;
        if(font.widthOfTextAtSize(candidate,size)>maxWidth&&current){lines.push(current);current=indent+"   "+word;}
        else current=candidate;
      }
      lines.push(current);
    }
    return lines;
  };
  const write=(text:string,options:{size?:number;font?:typeof body;colour?:typeof ink;gap?:number}={})=>{
    const size=options.size??10,font=options.font??body,colour=options.colour??ink;
    for(const line of wrap(text,size,font,right-margin)){
      if(y-size<margin+28)newPage();
      page.drawText(line,{x:margin,y:y-size,size,font,color:colour});
      y-=size*1.45;
    }
    y-=options.gap??0;
  };
  write(content.title,{size:20,font:bold,gap:2});
  write(content.subtitle,{size:9.5,colour:muted,gap:10});
  for(const section of content.sections){
    if(y<margin+90)newPage();
    page.drawLine({start:{x:margin,y:y+4},end:{x:right,y:y+4},thickness:0.7,color:rule});
    y-=10;
    write(section.heading.toUpperCase(),{size:8.5,font:bold,colour:muted,gap:3});
    for(const line of section.lines)write(line,{size:10});
    if(section.note)write(section.note,{size:8.5,colour:muted,gap:2});
    y-=8;
  }
  if(y<margin+50)newPage();
  y-=4;
  page.drawLine({start:{x:margin,y:y+4},end:{x:right,y:y+4},thickness:0.7,color:rule});
  y-=10;
  write(content.footer,{size:8,colour:muted});
  return pdf.save();
}
export async function buildClaimPack(args:Parameters<typeof claimPackContent>[0]){
  return renderClaimPack(claimPackContent(args));
}
