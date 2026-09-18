import { query } from "@/lib/db/client";
import { runAfterResponse } from "@/lib/http/background";
import { ensureChatSchema,getConversation,ChatConflict } from "./store";
import { prepareChat,runChatWorkflow,type ChatContext,type ChatRequest } from "./workflow";
import type { Progress } from "./types";

type QueueGlobal=typeof globalThis&{__dearpolicyChatTail?:Promise<void>;__dearpolicyChatRecovery?:Promise<void>};
async function initializeQueue(){
  await ensureChatSchema();
  const state=globalThis as QueueGlobal;
  state.__dearpolicyChatRecovery??=query(
    "UPDATE chat_analysis_jobs SET status='failed',error='The app restarted before this analysis finished. Please resend the message.',updated_at=now() WHERE status IN ('queued','running')",
  ).then(()=>undefined);
  await state.__dearpolicyChatRecovery;
}
async function runJob(id:string,context:ChatContext){
  const accountId=context.request.accountId;
  const started=await query("UPDATE chat_analysis_jobs SET status='running',updated_at=now() WHERE id=$1 AND account_id=$2 AND status='queued' RETURNING id",[id,accountId]);
  if(!started.rows.length)return;
  const check=async()=>{
    const job=await query("SELECT id FROM chat_analysis_jobs WHERE id=$1 AND account_id=$2 AND status='running'",[id,accountId]);
    if(!job.rows.length||!await getConversation(accountId,context.conversation.id))throw new ChatConflict("This chat was deleted or the analysis was cancelled.");
  };
  const report=async(progress:Progress)=>{
    await check();
    await query("UPDATE chat_analysis_jobs SET progress=$1::jsonb,updated_at=now() WHERE id=$2 AND account_id=$3 AND status='running'",[JSON.stringify(progress),id,accountId]);
  };
  try{
    const result=await runChatWorkflow(context,{jobId:id,check,report});
    await query("UPDATE chat_analysis_jobs SET status='complete',result_json=$1::jsonb,updated_at=now() WHERE id=$2 AND account_id=$3 AND status='running'",[JSON.stringify(result),id,accountId]);
  }catch(error){
    await query("UPDATE chat_analysis_jobs SET status=$1,error=$2,updated_at=now() WHERE id=$3 AND account_id=$4 AND status='running'",
      [error instanceof ChatConflict?"cancelled":"failed",error instanceof Error?error.message:"Analysis failed",id,accountId]);
  }
}
export async function enqueueChat(request:ChatRequest){
  await initializeQueue();
  const context=await prepareChat(request);
  const job=await query<{id:string}>(
    "INSERT INTO chat_analysis_jobs(account_id,family_member_id,conversation_id,request_json) VALUES($1,$2,$3,$4::jsonb) RETURNING id",
    [request.accountId,context.conversation.family_member_id,context.conversation.id,JSON.stringify(request)]);
  const id=job.rows[0].id;
  const state=globalThis as QueueGlobal;
  // after() keeps the function alive past the response (Vercel's waitUntil
  // under the hood) instead of racing the serverless instance being frozen
  // the instant the 202 is returned, which is what a bare fire-and-forget
  // promise would do -- the chat UI would then spin on "Reading..." forever
  // for a job that never actually ran.
  runAfterResponse(()=>{
    state.__dearpolicyChatTail=(state.__dearpolicyChatTail??Promise.resolve()).catch(()=>undefined).then(()=>runJob(id,context)).catch(()=>undefined);
    return state.__dearpolicyChatTail;
  });
  return {jobId:id,conversationId:context.conversation.id,conversationRevision:context.conversation.revision,
    familyMemberId:context.conversation.family_member_id};
}
export async function getChatJob(accountId:string,id:string){
  await initializeQueue();
  return (await query<{id:string;status:string;progress:Progress;result_json:unknown;error:string|null}>(
    "SELECT id,status,progress,result_json,error FROM chat_analysis_jobs WHERE account_id=$1 AND id=$2",[accountId,id])).rows[0]??null;
}
export async function cancelChatJob(accountId:string,id:string){
  await ensureChatSchema();
  await query("UPDATE chat_analysis_jobs SET status='cancelled',result_json=NULL,request_json='{}'::jsonb,updated_at=now() WHERE account_id=$1 AND id=$2 AND status IN ('queued','running')",[accountId,id]);
}
