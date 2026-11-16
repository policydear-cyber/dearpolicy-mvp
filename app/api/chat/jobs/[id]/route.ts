import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleChatDrain,scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { cancelChatJob,getChatJob } from "@/lib/chat/jobs";
import { sanitizeStoredAnswer } from "@/lib/chat/monetary-boundary";
import { invalidateAnswersWithDeletedPolicies, replacedEarlierAnswers } from "@/lib/chat/stale-answers";
import { query } from "@/lib/db/client";
import { getConversation } from "@/lib/chat/store";
import type { ChatAnswer } from "@/types";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
// Round 10: the chat answer is worked out by the drain this poll schedules
// after its response (lib/jobs/request-drain.ts); the platform default time
// limit cut that work off mid-answer and left the chat "thinking" until the
// lease expired. The same limit as the chat route itself.
export const maxDuration=300;
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);
    const ctx=await requireHouseholdContext(request);
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    scheduleChatDrain(); // Round 10: and the chat lane, so an answer never waits behind a document job
    const job=await getChatJob(ctx.householdId,id);
    if(!job)return NextResponse.json({error:"Analysis not found or its chat was deleted."},{status:404});
    let result:unknown=job.status==="complete"?sanitizeStoredAnswer(job.result_json):null;
    let replaced:ReturnType<typeof replacedEarlierAnswers>=[];
    // An answer that relied on a since-deleted policy is never re-served as current cover; nor is one a later turn of its
    // chat corrected (who it was about: lib/simple-chat/subjects.ts), read from the chat's saved state.
    if(result&&typeof result==="object"){
      const conversationState=job.conversation_id?(await getConversation(ctx.householdId,job.conversation_id))?.state:undefined;
      const wrapper=result as {answer?:Partial<ChatAnswer>};
      if(wrapper.answer&&typeof wrapper.answer==="object"){const [current]=await invalidateAnswersWithDeletedPolicies(ctx.householdId,[wrapper.answer],{conversationState});result={...wrapper,answer:current};}
      else{const [current]=await invalidateAnswersWithDeletedPolicies(ctx.householdId,[result as Partial<ChatAnswer>],{conversationState});result=current;}
      // The earlier answers of this chat its saved state now marks replaced ("Actually it was Daniel, not Grace"), with the
      // same rule and the same replacement the reopened chat serves (lib/chat/replaced-live.ts): the live page marks them
      // as this answer arrives, so the live and the reopened chat never disagree (TE-ACC-20261116 journey 4).
      if(job.conversation_id&&conversationState){
        const earlier=await query<{answer_json:unknown}>("SELECT answer_json FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 AND role<>'user' AND answer_json IS NOT NULL ORDER BY created_at DESC,message_order DESC LIMIT 200",[ctx.householdId,job.conversation_id]);
        const finished=wrapper.answer&&typeof wrapper.answer==="object"?wrapper.answer:wrapper as Partial<ChatAnswer>;
        replaced=replacedEarlierAnswers(earlier.rows.map(r=>sanitizeStoredAnswer(r.answer_json) as Partial<ChatAnswer>|null),conversationState,finished);
      }
    }
    return NextResponse.json({job:{id:job.id,status:job.status,progress:job.progress,error:job.error},result,...(replaced.length?{replaced}:{})});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Analysis lookup failed"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Analysis lookup failed"},{status:500});
    return authResponse;
  }
}
export async function DELETE(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;z.string().uuid().parse(id);
    const ctx=await requireHouseholdContext(request);
    await cancelChatJob(ctx.householdId,id);
    return NextResponse.json({cancelled:true});
  }catch(error){
    if(error instanceof z.ZodError)return NextResponse.json({error:"Cancellation failed"},{status:400});
    const authResponse=routeErrorResponse(error);
    if(authResponse.status===500)return NextResponse.json({error:"Cancellation failed"},{status:500});
    return authResponse;
  }
}
