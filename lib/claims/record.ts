import { EMPTY_CLAIM_FACTS,type ClaimAssessmentItem,type ClaimDecisionPacket,type ClaimFacts,type ClaimQuestion } from "./types";
import { createClaimSession,getClaimSession,saveClaimSession } from "./session";
import { documentsToAttach } from "./claim-pack";
import { looksLikeInterviewReply } from "./event-name";
import { query } from "@/lib/db/client";
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
  // What happened on a trip decides which proof the insurer needs (lib/claims/claim-pack.ts).
  for(const key of ["travelEventType","flightDelayHours","tripStartDate","tripEndDate"]){const value=knownValue(facts,key);if(value!=null)(out as Record<string,unknown>)[key]=value;}
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
    ...(item.coverLabel?{coverLabel:item.coverLabel}:{}),
    ...(evidence&&evidence.pageStart!=null&&evidence.pageEnd!=null?{ruleEvidence:{...evidence,pageStart:evidence.pageStart,pageEnd:evidence.pageEnd}}:{}),
  };
}
/** Additive: which conversation a claim event belongs to (so repeated turns
 * of one conversation update ONE event), and the claim's category (so its
 * status and requested documents follow what happened). */
let claimRecordSchemaReady:Promise<void>|null=null;
export function ensureClaimRecordSchema(){
  claimRecordSchemaReady??=query("ALTER TABLE claim_sessions ADD COLUMN IF NOT EXISTS conversation_id uuid; ALTER TABLE claim_sessions ADD COLUMN IF NOT EXISTS claim_category text")
    .then(()=>undefined).catch(error=>{claimRecordSchemaReady=null;throw error;});
  return claimRecordSchemaReady;
}
async function findClaimFor(args:{accountId:string;familyMemberId:string;existingId?:string|null;conversationId?:string|null}){
  let session=args.existingId?await getClaimSession(args.accountId,args.familyMemberId,args.existingId):null;
  if(!session&&args.conversationId){
    const same=(await query<{id:string}>("SELECT id FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2 AND conversation_id=$3 ORDER BY created_at LIMIT 1",
      [args.accountId,args.familyMemberId,args.conversationId])).rows[0];
    if(same)session=await getClaimSession(args.accountId,args.familyMemberId,same.id);
  }
  return session;
}
/** The event name to store: the proposed one, unless it is reply-shaped and
 * the event already has a proper name (which then stays). */
function eventNameToStore(proposed:string,existing:string|null|undefined){
  if(!looksLikeInterviewReply(proposed))return proposed;
  if(existing&&!looksLikeInterviewReply(existing))return existing;
  return proposed;
}
/** Keeps the claim event in step with an interview that is still open: the
 * claim this conversation is about is "fact_finding" with the question the
 * chat is waiting on, so the Claims list says "Questions to answer" -- not
 * "Documents needed" -- while the chat is still asking. Created on the
 * first question (so the event is there to pick up), reopened when an
 * earlier final answer's interview is reopened. The last final answer's
 * decision packet is kept; recordClaim replaces it at the next final. */
export async function recordClaimProgress(args:{accountId:string;familyMemberId:string;existingId?:string|null;conversationId:string;
  facts:SubjectFacts;eventSummary:string;claimCategory:string|null;pendingQuestion:ClaimQuestion}){
  const facts=claimFactsFromSubject(args.facts);
  await ensureClaimRecordSchema();
  const session=await findClaimFor(args)??await createClaimSession(args.accountId,args.familyMemberId);
  await query(`UPDATE claim_sessions SET status='fact_finding',event_type=$1,event_summary=$2,facts=$3::jsonb,pending_question=$4::jsonb,completed_at=NULL,updated_at=now(),
      conversation_id=COALESCE(conversation_id,$5),claim_category=COALESCE($6,claim_category)
    WHERE id=$7 AND account_id=$8 AND family_member_id=$9`,
    [facts.eventType,eventNameToStore(args.eventSummary,session.event_summary),JSON.stringify(facts),JSON.stringify(args.pendingQuestion),
      args.conversationId,args.claimCategory,session.id,args.accountId,args.familyMemberId]);
  return session.id;
}
/** Writes (or updates) the claim session for an assessment and returns its id.
 * One conversation is one claim event: without an id in hand, the event this
 * conversation already recorded is updated rather than a new one created. */
export async function recordClaim(args:{accountId:string;familyMemberId:string;existingId?:string|null;
  facts:SubjectFacts;eventSummary:string;items:ClaimItem[];citations:ChatCitation[];knownFacts:string[];missingFacts:string[];
  complete:boolean;nextSteps:string[];conversationId?:string|null;claimCategory?:string|null}){
  const facts=claimFactsFromSubject(args.facts);
  await ensureClaimRecordSchema();
  const session=await findClaimFor(args)??await createClaimSession(args.accountId,args.familyMemberId);
  const eventSummary=eventNameToStore(args.eventSummary,session.event_summary);
  const packet:ClaimDecisionPacket={
    sessionId:session.id,eventSummary,facts,knownFacts:args.knownFacts,missingFacts:args.missingFacts,
    relevantOwnedProducts:[...new Set(args.items.map(item=>item.title.split(" · ")[0]))],
    assessments:args.items.map((item,index)=>assessmentFromItem(item,index,args.citations)),
    nextSteps:args.nextSteps,ready:args.complete,claimCategory:args.claimCategory??null,
  };
  await saveClaimSession({accountId:args.accountId,familyMemberId:args.familyMemberId,id:session.id,
    status:args.complete?"complete":"fact_finding",facts,pendingQuestion:null,eventSummary,
    decisionPacket:args.complete?packet:null});
  await query("UPDATE claim_sessions SET conversation_id=COALESCE(conversation_id,$1),claim_category=COALESCE($2,claim_category) WHERE id=$3 AND account_id=$4",
    [args.conversationId??null,args.claimCategory??null,session.id,args.accountId]);
  return {id:session.id,attach:documentsToAttach(facts)};
}
/** Adds cards decided after the claim was written (employer group cover,
 * lib/chat/claim-completion.ts) to the claim on record, so the claim pack and
 * the Claims page show what the chat showed. Cards of the same title are
 * replaced; documents to get are added to the pack's next steps once. */
export async function addRecordedClaimItems(args:{accountId:string;familyMemberId:string;sessionId:string;items:ClaimItem[];citations:ChatCitation[];documents?:string[]}){
  const session=await getClaimSession(args.accountId,args.familyMemberId,args.sessionId);
  const packet=session?.decision_packet;
  if(!session||!packet||!args.items.length)return false;
  const titles=new Set(args.items.map(item=>item.title));
  const kept=packet.assessments.filter(item=>!titles.has(item.title));
  const updated:ClaimDecisionPacket={...packet,
    assessments:[...kept,...args.items.map((item,index)=>assessmentFromItem(item,kept.length+index,args.citations))],
    nextSteps:[...packet.nextSteps,...(args.documents??[]).map(document=>"Attach: "+document).filter(step=>!packet.nextSteps.includes(step))]};
  await query("UPDATE claim_sessions SET decision_packet=$1::jsonb,updated_at=now() WHERE id=$2 AND account_id=$3 AND family_member_id=$4",
    [JSON.stringify(updated),session.id,args.accountId,args.familyMemberId]);
  return true;
}
