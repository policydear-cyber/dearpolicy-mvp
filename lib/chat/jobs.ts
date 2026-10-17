import { createHash } from "node:crypto";
import { pool,query } from "@/lib/db/client";
import { classifyError } from "@/lib/telemetry/errors";
import { recordEvent } from "@/lib/telemetry";
import { enqueueJob, heartbeatJob, type BackgroundJobRow } from "@/lib/jobs/queue";
import { classifyPipelineError } from "@/lib/jobs/pipeline-worker";
import { ensureChatSchema,getConversation,ChatConflict } from "./store";
import { prepareChat,runChatWorkflow,type ChatContext,type ChatRequest } from "./workflow";
import type { Progress } from "./types";

async function initializeQueue(){
  await ensureChatSchema();
}
export const CHAT_ANALYSIS_JOB_TYPE="chat_analysis";
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
export async function processChatAnalysisJob(job:BackgroundJobRow){
  const id=typeof (job.payload as Record<string,unknown>|null)?.chatJobId==="string"?(job.payload as Record<string,string>).chatJobId:"";
  if(!id||!job.account_id)throw new Error("background chat job payload is incomplete");
  const accountId=job.account_id;
  const stored=await query<{status:string;request_json:ChatRequest;queue_ms:number}>("SELECT status,request_json,(extract(epoch from (now()-created_at))*1000)::int AS queue_ms FROM chat_analysis_jobs WHERE id=$1 AND account_id=$2",[id,accountId]);
  if(!stored.rows.length)throw new ChatConflict("This chat was deleted or the analysis was cancelled.");
  if(stored.rows[0].status==="complete"||stored.rows[0].status==="cancelled")return;
  const started=await query("UPDATE chat_analysis_jobs SET status='running',error=NULL,updated_at=now() WHERE id=$1 AND account_id=$2 AND status IN ('queued','running') RETURNING id",[id,accountId]);
  if(!started.rows.length)throw new ChatConflict("This chat analysis is no longer runnable.");
  // latency evidence: queue delay (accepted -> picked up), preparation, and the workflow (loop + validation + save) apart
  const queueMs=stored.rows[0].queue_ms;const prepT0=Date.now();
  const context=await prepareChat(stored.rows[0].request_json);
  const prepareMs=Date.now()-prepT0;
  const check=async()=>{
    if(job.lease_owner){
      const lease=await heartbeatJob(pool,{jobId:job.id,workerId:job.lease_owner});
      if(lease.cancel_requested)throw new ChatConflict("This chat was deleted or the analysis was cancelled.");
    }
    const chatJob=await query("SELECT id FROM chat_analysis_jobs WHERE id=$1 AND account_id=$2 AND status='running'",[id,accountId]);
    if(!chatJob.rows.length||!await getConversation(accountId,context.conversation.id))throw new ChatConflict("This chat was deleted or the analysis was cancelled.");
  };
  const report=async(progress:Progress)=>{
    await check();
    await query("UPDATE chat_analysis_jobs SET progress=$1::jsonb,updated_at=now() WHERE id=$2 AND account_id=$3 AND status='running'",[JSON.stringify(progress),id,accountId]);
  };
  try{
    const wfT0=Date.now();
    await runChatWorkflow(context,{jobId:id,check,report});
    void recordEvent({name:"chat.job.timing",correlationId:id,status:"success",extra:{queueMs,prepareMs,workflowMs:Date.now()-wfT0}});
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
    const category=classifyPipelineError(error);
    const terminal=error instanceof ChatConflict||category==="non_retryable"||job.attempt_count>=job.max_attempts;
    await query("UPDATE chat_analysis_jobs SET status=$1,error=$2,updated_at=now() WHERE id=$3 AND account_id=$4 AND status='running'",
      [error instanceof ChatConflict?"cancelled":terminal?"failed":"queued",safeMessage,id,accountId]);
    throw error;
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
  const persistedRequest={...request,conversationId:context.conversation.id,conversationRevision:context.conversation.revision};
  const inserted=await query<{id:string}>(
    `INSERT INTO chat_analysis_jobs(account_id,family_member_id,conversation_id,request_json,idempotency_key)
     VALUES($1,$2,$3,$4::jsonb,$5)
     ON CONFLICT (account_id,idempotency_key) WHERE status IN ('queued','running') DO NOTHING
     RETURNING id`,
    [request.accountId,context.conversation.family_member_id,context.conversation.id,JSON.stringify(persistedRequest),idempotencyKey]);
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
        [request.accountId,context.conversation.family_member_id,context.conversation.id,JSON.stringify(persistedRequest),idempotencyKey]);
      id=fallback.rows[0].id;
    }
  }
  await enqueueJob(pool,{jobType:CHAT_ANALYSIS_JOB_TYPE,idempotencyKey:id,accountId:request.accountId,payload:{chatJobId:id}});
  return {jobId:id,conversationId:context.conversation.id,conversationRevision:context.conversation.revision,
    familyMemberId:context.conversation.family_member_id};
}
// A worker that dies silently -- the serverless invocation is killed
// mid-run, so its lease expires and the sweep dead-letters the background
// job -- never reaches processChatAnalysisJob's catch block, which is the
// ONLY writer of a terminal chat status on failure. The chat row then sits
// 'running' forever and the browser polls a spinner that can never end.
// Heal that at the read: every poll, and a reopened chat's pendingJob
// resume, goes through getChatJob, so the stuck turn surfaces as a normal,
// retryable failure instead of an endless spinner.
const STUCK_ANALYSIS_MESSAGE="The analysis stopped unexpectedly and could not be finished after several attempts. Your message is saved. Please try sending it again.";
export async function getChatJob(accountId:string,id:string){
  await initializeQueue();
  const row=(await query<{id:string;status:string;progress:Progress;result_json:unknown;error:string|null}>(
    "SELECT id,status,progress,result_json,error FROM chat_analysis_jobs WHERE account_id=$1 AND id=$2",[accountId,id])).rows[0]??null;
  if(row&&(row.status==="queued"||row.status==="running")){
    try{
      const healed=await query<{id:string}>(
        `UPDATE chat_analysis_jobs c SET status='failed',error=$3,updated_at=now()
          WHERE c.id=$1 AND c.account_id=$2 AND c.status IN ('queued','running')
            AND (EXISTS (SELECT 1 FROM background_jobs j
                  WHERE j.job_type=$4 AND j.account_id=c.account_id AND j.idempotency_key=c.id::text AND j.status='dead_letter')
              -- No progress for 10 minutes and nothing left that could still
              -- run it: the background job is missing (the enqueue failed
              -- after this row was written) or already terminal.
              OR (c.updated_at < now() - interval '10 minutes'
                  AND NOT EXISTS (SELECT 1 FROM background_jobs j
                    WHERE j.job_type=$4 AND j.account_id=c.account_id AND j.idempotency_key=c.id::text
                      AND j.status IN ('queued','processing','failed_retryable'))))
          RETURNING id`,
        [id,accountId,STUCK_ANALYSIS_MESSAGE,CHAT_ANALYSIS_JOB_TYPE]);
      if(healed.rows.length)return {...row,status:"failed",error:STUCK_ANALYSIS_MESSAGE};
    }catch(error){
      // Best-effort hygiene: a heal that cannot run (e.g. background_jobs
      // missing in a partial environment) must never break the poll itself.
      console.warn("stuck chat job heal failed:",error);
    }
  }
  return row;
}
export async function cancelChatJob(accountId:string,id:string){
  await ensureChatSchema();
  await query("UPDATE chat_analysis_jobs SET status='cancelled',result_json=NULL,request_json='{}'::jsonb,updated_at=now() WHERE account_id=$1 AND id=$2 AND status IN ('queued','running')",[accountId,id]);
}
