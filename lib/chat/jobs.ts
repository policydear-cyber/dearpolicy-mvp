import { createHash } from "node:crypto";
import { query } from "@/lib/db/client";
import { runAfterResponse } from "@/lib/http/background";
import { classifyError } from "@/lib/telemetry/errors";
import { ensureChatSchema,getConversation,ChatConflict } from "./store";
import { prepareChat,runChatWorkflow,type ChatContext,type ChatRequest } from "./workflow";
import type { Progress } from "./types";

type QueueGlobal=typeof globalThis&{__dearpolicyChatTail?:Promise<void>;__dearpolicyChatRecovery?:Promise<void>};
async function initializeQueue(){
  await ensureChatSchema();
  const state=globalThis as QueueGlobal;
  // Serverless means the POST that dispatches a job, and the GET that polls
  // it, can land on different instances -- a per-instance "ran once" flag
  // does not stop a fresh instance from treating a job another instance is
  // actively running as orphaned. Scoping the sweep to jobs stale well past
  // the route's own 300s maxDuration keeps it able to clean up a real crash
  // without ever touching a job that is still legitimately in flight.
  state.__dearpolicyChatRecovery??=query(
    "UPDATE chat_analysis_jobs SET status='failed',error='The app restarted before this analysis finished. Please resend the message.',updated_at=now() WHERE status IN ('queued','running') AND updated_at<now()-interval '10 minutes'",
  ).then(()=>undefined);
  await state.__dearpolicyChatRecovery;
}
// D12 (Wave 2 adversarial audit, minimal scope): a retried enqueueChat()
// call for the exact same question -- a client resend after a dropped 202
// response, a double-submit -- must not spin up a second, independent
// analysis run for a conversation that already has one queued/running. The
// key is derived only from values that fully determine what the analysis
// run would do (which conversation/revision it reads, what was actually
// asked, and the scope/claim/person selectors that change how it's
// answered), never from anything time-varying, so two calls describing the
// identical request hash to the identical key.
function chatIdempotencyKey(context:ChatContext):string{
  const r=context.request;
  const parts=[context.conversation.id,String(context.conversation.revision),r.question,r.familyMemberId??"",r.scope??"",r.claimSessionId??"",r.personChoiceId??""];
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
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
    // D17 (Wave 2 adversarial audit): persist classifyError()'s safe,
    // taxonomy-level message instead of the raw error.message -- this
    // column is read straight back by getChatJob() and returned to the
    // client as-is (see app/api/chat/jobs/[id]/route.ts), so a raw
    // exception message stored here was reaching the browser directly.
    // classifyError() already has a ChatConflict entry ("This changed
    // underneath the request -- please retry."), so the cancelled-vs-failed
    // status split below is unaffected by this change.
    const safeMessage=classifyError(error).safeMessage;
    await query("UPDATE chat_analysis_jobs SET status=$1,error=$2,updated_at=now() WHERE id=$3 AND account_id=$4 AND status='running'",
      [error instanceof ChatConflict?"cancelled":"failed",safeMessage,id,accountId]);
  }
}
export async function enqueueChat(request:ChatRequest){
  await initializeQueue();
  const context=await prepareChat(request);
  const idempotencyKey=chatIdempotencyKey(context);
  // D12: ON CONFLICT targets the partial unique index on
  // (account_id,idempotency_key) WHERE status IN ('queued','running')
  // (sql/chat-upgrade.sql) -- a genuinely new request, or a retry of one
  // whose prior run already reached a terminal status, always inserts
  // normally, since a terminal-status row no longer satisfies that
  // predicate and so can never conflict with a fresh insert.
  const inserted=await query<{id:string}>(
    `INSERT INTO chat_analysis_jobs(account_id,family_member_id,conversation_id,request_json,idempotency_key)
     VALUES($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (account_id,idempotency_key) WHERE status IN ('queued','running') DO NOTHING
     RETURNING id`,
    [request.accountId,context.conversation.family_member_id,context.conversation.id,JSON.stringify(request),idempotencyKey]);
  let id:string;
  if(inserted.rows.length){
    id=inserted.rows[0].id;
  }else{
    // A conflicting queued/running job with the same idempotency key
    // already exists -- re-read and return it instead of enqueueing a
    // duplicate analysis run for the exact same request.
    const existing=await query<{id:string}>(
      "SELECT id FROM chat_analysis_jobs WHERE account_id=$1 AND idempotency_key=$2 AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1",
      [request.accountId,idempotencyKey]);
    if(existing.rows.length){
      id=existing.rows[0].id;
    }else{
      // Extremely unlikely race: the conflicting row reached a terminal
      // status between the failed INSERT above and this SELECT. Fall back
      // to a plain insert rather than looping.
      const fallback=await query<{id:string}>(
        "INSERT INTO chat_analysis_jobs(account_id,family_member_id,conversation_id,request_json,idempotency_key) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id",
        [request.accountId,context.conversation.family_member_id,context.conversation.id,JSON.stringify(request),idempotencyKey]);
      id=fallback.rows[0].id;
    }
  }
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
