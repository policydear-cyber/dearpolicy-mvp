import { EMPTY_CLAIM_FACTS,type ClaimAssessmentItem,type ClaimDecisionPacket,type ClaimFacts } from "./types";
import { createClaimSession,getClaimSession,saveClaimSession } from "./session";
import { documentsToAttach } from "./claim-pack";
import { knownValue } from "@/lib/chat/facts";
import type { SubjectFacts } from "@/lib/chat/types";
import type { ChatCitation,ClaimItem } from "@/types";

/** Turning a chat assessment into a claim on record.
 *
 * The chat works from conversation facts; the claim pack and the Claims page
 * work from a claim session. Without this bridge an answer given from the
 * stored benefit rules — the fast path, now the normal one — left nothing
 * behind: no pack to download, nothing on the Claims page, and the same
 * questions asked again next time. */
export function claimFactsFromSubject(facts:SubjectFacts):ClaimFacts{
  const out:ClaimFacts={...EMPTY_CLAIM_FACTS,injuries:[],uncertainFacts:[]};
  for(const key of Object.keys(EMPTY_CLAIM_FACTS) as (keyof ClaimFacts)[]){
    if(key==="injuries"||key==="uncertainFacts"||key==="factSources")continue;
    const value=knownValue(facts,key);
    if(value!=null)(out as Record<string,unknown>)[key]=value;
  }
  const injuries=knownValue(facts,"injuries");
  if(Array.isArray(injuries))out.injuries=injuries.map(String);
  else if(typeof injuries==="string")out.injuries=[injuries];
  out.uncertainFacts=Object.entries(facts).filter(([,fact])=>fact&&fact.state!=="known").map(([key])=>key);
  if(out.eventType==null){
    if(out.death)out.eventType="death";
    else if(out.diagnosis)out.eventType="diagnosis";
    else if(out.accidentType||out.injured)out.eventType="accident";
    else if(out.hospitalised)out.eventType="hospitalisation";
  }
  return out;
}
function assessmentFromItem(item:ClaimItem,index:number,citations:ChatCitation[]):ClaimAssessmentItem{
  // A rule read from the wording cites "benefit:<id>"; a figure taken from a
  // schedule line cites "coverage:<id>" and already carries that prefix.
  const key=item.calculationId??"";
  const evidence=citations.find(c=>c.chunkId===(key.includes(":")?key:"benefit:"+key));
  return {
    id:item.calculationId??"item-"+index,title:item.title,status:item.status,amountText:item.amountText,
    reason:item.reason,conditions:item.conditions,evidenceTerms:[],productName:null,
    ...(item.calculatedAmount!=null?{calculatedAmount:item.calculatedAmount,currency:item.currency}:{}),
    ...(item.aggregation?{aggregation:item.aggregation}:{}),
    ...(item.supersededBy?{supersededBy:item.supersededBy}:{}),
    ...(evidence?{ruleEvidence:evidence}:{}),
  };
}
/** Writes (or updates) the claim session for an assessment and returns its id. */
export async function recordClaim(args:{accountId:string;familyMemberId:string;existingId?:string|null;
  facts:SubjectFacts;eventSummary:string;items:ClaimItem[];citations:ChatCitation[];knownFacts:string[];missingFacts:string[];
  complete:boolean;nextSteps:string[]}){
  const facts=claimFactsFromSubject(args.facts);
  let session=args.existingId?await getClaimSession(args.accountId,args.familyMemberId,args.existingId):null;
  if(!session)session=await createClaimSession(args.accountId,args.familyMemberId);
  const packet:ClaimDecisionPacket={
    sessionId:session.id,eventSummary:args.eventSummary,facts,knownFacts:args.knownFacts,missingFacts:args.missingFacts,
    relevantOwnedProducts:[...new Set(args.items.map(item=>item.title.split(" · ")[0]))],
    assessments:args.items.map((item,index)=>assessmentFromItem(item,index,args.citations)),
    nextSteps:args.nextSteps,ready:args.complete,
  };
  await saveClaimSession({accountId:args.accountId,familyMemberId:args.familyMemberId,id:session.id,
    status:args.complete?"complete":"fact_finding",facts,pendingQuestion:null,eventSummary:args.eventSummary,
    decisionPacket:args.complete?packet:null});
  return {id:session.id,attach:documentsToAttach(facts)};
}
