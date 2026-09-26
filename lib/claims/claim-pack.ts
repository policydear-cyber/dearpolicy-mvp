import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import { PRELIMINARY_ASSESSMENT_NOTICE,scrubMonetaryText } from "@/lib/chat/monetary-boundary";
import type { ClaimDecisionPacket,ClaimFacts } from "./types";

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
  return lines;
}
/** What an insurer asks for, decided by what actually happened. Generic enough
 * to be right for any insurer, specific enough to save a second trip. */
export function documentsToAttach(facts:ClaimFacts){
  const documents:string[]=["The insurer's own claim form, signed and dated","A copy of the policy schedule or certificate for the plan being claimed under"];
  if(facts.death){
    documents.push("Death certificate");
    documents.push("Certificate of cause of death, where one was issued");
    documents.push("Proof of the claimant's identity and relationship to the deceased");
  }
  if(facts.accidentType||facts.eventType==="accident")documents.push("Police or accident report, if one was made");
  if(facts.diagnosis){
    documents.push("Specialist's medical report stating the diagnosis and the date it was made");
    documents.push("Histology, biopsy or scan report supporting the diagnosis");
  }
  if(facts.hospitalised||facts.hospitalNights!=null){
    documents.push("Hospital discharge summary showing the dates of admission and discharge");
    documents.push("Itemised final hospital bill");
  }
  if(facts.surgery)documents.push("Operation report");
  if(facts.ambulanceUsed||facts.ambulanceBill!=null)documents.push("Ambulance invoice");
  if(facts.permanentImpairment)documents.push("Attending doctor's assessment of permanent impairment");
  if(facts.hospitalBill!=null||facts.outOfPocket!=null||facts.ambulanceBill!=null)
    documents.push("Original receipts for every amount being claimed");
  return [...new Set(documents)];
}
export function claimPackContent(args:{packet:ClaimDecisionPacket;claimantName:string;relationship?:string|null;generatedOn?:Date}){
  const {packet}=args;
  const generated=args.generatedOn??new Date();
  const claimable=packet.assessments.filter(item=>item.status==="likely_applicable"||item.status==="potentially_applicable");
  const sections:ClaimPackSection[]=[];
  sections.push({heading:"Claimant",lines:[
    "Name: "+args.claimantName,
    ...(args.relationship&&args.relationship!=="self"?["Relationship to the policyholder: "+args.relationship]:[]),
  ]});
  sections.push({heading:"What happened",lines:[packet.eventSummary,...eventLines(packet.facts)].filter(Boolean)});
  // A claim pack is built from a PRELIMINARY claim assessment (live chat has
  // no reviewed claim evidence), so it lists benefits, pages, conditions and
  // documents -- never an amount or a total. See lib/chat/monetary-boundary.ts.
  if(claimable.length)sections.push({
    heading:"Benefits that may be relevant",
    lines:claimable.flatMap(item=>{
      const evidence=item.ruleEvidence;
      return [
        item.title+(item.supersededBy?" (the policy pays this instead of \u201c"+item.supersededBy+"\u201d)":""),
        "    Why it may be relevant: "+scrubMonetaryText(item.reason),
        ...(evidence?["    Policy wording: "+evidence.policyName+", page "+evidence.pageStart+(evidence.pageEnd!==evidence.pageStart?"–"+evidence.pageEnd:"")]:[]),
        ...item.conditions.map(condition=>"    Condition: "+scrubMonetaryText(condition)),
      ];
    }),
    note:PRELIMINARY_ASSESSMENT_NOTICE+" The insurer determines eligibility and any amount after assessment.",
  });
  else sections.push({heading:"Benefits that may be relevant",lines:[
    "No relevant benefit has been identified yet from the documents on file.",
  ],note:"This usually means a policy schedule or the benefit wording is still missing. Upload it and the claim pack can be produced again."});
  if(packet.missingFacts.length)sections.push({
    heading:"Still needed before this is submitted",
    lines:packet.missingFacts.map(fact=>"• "+fact),
  });
  sections.push({heading:"Documents to attach",lines:documentsToAttach(packet.facts).map(document=>"• "+document)});
  if(packet.nextSteps.length)sections.push({heading:"Next steps",lines:packet.nextSteps.map((step,index)=>index+1+". "+step)});
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
