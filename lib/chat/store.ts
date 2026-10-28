import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { pool, query } from "@/lib/db/client";
import type { ChatAnswer } from "@/types";
import { legacyState } from "./facts";
import { guardChatAnswer } from "./output-guard";
import { maskIdentityNumbers } from "./identity-numbers";
import type { Conversation, ConversationState, HistoryToken } from "./types";

export class ChatConflict extends Error {}
/** Round 9: the household's message as typed, when the chat read it in plainer words; it is what the history shows. */
export const turnDisplay=new AsyncLocalStorage<{message?:string}>();
type ChatGlobals = typeof globalThis & { __dearpolicyChatSchema?: Promise<void> };
export async function ensureChatSchema() {
  const state = globalThis as ChatGlobals;
  state.__dearpolicyChatSchema ??= (async () => {
    const sql = await readFile(path.join(process.cwd(), "sql/chat-upgrade.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise migrations across requests/processes without a permanent lock.
      await client.query("SELECT pg_advisory_xact_lock(73499201)");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  })().catch(error => { delete state.__dearpolicyChatSchema; throw error; });
  await state.__dearpolicyChatSchema;
}
function normalize(row: Conversation): Conversation {
  const state = row.state as ConversationState & { legacyFacts?: Record<string, unknown>; legacyPending?: {id:string;text:string;type:"text";why:string} };
  if (state.legacyFacts && row.family_member_id) {
    const converted = legacyState(row.family_member_id, state.legacyFacts, new Date().toISOString());
    const fields: Record<string,string> = { hospital_nights:"hospitalNights",hospital_bill:"hospitalBill",ambulance_bill:"ambulanceBill",hospitalised:"hospitalised",
      event_date:"eventDate",death_date:"deathDate",diagnosis_date:"diagnosisDate",diagnosis:"diagnosis",competitive_racing:"competitiveRacing",
      racing_authority_sanctioned:"racingAuthoritySanctioned",medical_report:"medicalReportAvailable" };
    return { ...row, revision:Number(row.revision), state:{ ...converted, activeQuery:row.title,
      ...(state.legacyPending ? {pending:{...state.legacyPending,subjectId:row.family_member_id,factKey:fields[state.legacyPending.id]??state.legacyPending.id}} : {}) } };
  }
  return { ...row, revision:Number(row.revision), state:{ ...state, subjects:state.subjects??{} } };
}
export async function getConversation(accountId: string, id: string) {
  await ensureChatSchema();
  const result = await query<Conversation>("SELECT id,account_id,family_member_id,title,revision,state FROM chat_conversations WHERE account_id=$1 AND id=$2", [accountId,id]);
  return result.rows[0] ? normalize(result.rows[0]) : null;
}
export async function openConversation(args: { accountId:string; memberId:string|null; id?:string|null; title:string }) {
  await ensureChatSchema();
  if (args.id) {
    const row = await getConversation(args.accountId,args.id);
    if (!row) throw new ChatConflict("This chat was deleted or is unavailable. Start a new chat.");
    return row;
  }
  const result = await query<Conversation>(
    "INSERT INTO chat_conversations(account_id,family_member_id,title) VALUES($1,$2,$3) RETURNING id,account_id,family_member_id,title,revision,state",
    [args.accountId,args.memberId,args.title.slice(0,100)]);
  return normalize(result.rows[0]);
}
export async function assignConversationMember(conversation:Conversation,memberId:string){
  if(conversation.family_member_id===memberId)return conversation;
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const current=await client.query<Conversation>(
      "SELECT id,account_id,family_member_id,title,revision,state FROM chat_conversations WHERE account_id=$1 AND id=$2 AND revision=$3 FOR UPDATE",
      [conversation.account_id,conversation.id,conversation.revision]);
    if(!current.rows.length)throw new ChatConflict("This chat was deleted or changed while the family member was being resolved.");
    const row=normalize(current.rows[0]);
    if(!row.state.personContext)throw new ChatConflict("This chat already belongs to a different family profile. Start a new chat for that person.");
    const updated=await client.query<Conversation>(
      "UPDATE chat_conversations SET family_member_id=$1,updated_at=now() WHERE account_id=$2 AND id=$3 RETURNING id,account_id,family_member_id,title,revision,state",
      [memberId,conversation.account_id,conversation.id]);
    // Keep every dependent row in the same profile scope. This matters when the
    // first message was stored before an ambiguous pronoun/name was clarified.
    await client.query("UPDATE chat_messages SET family_member_id=$1 WHERE account_id=$2 AND conversation_id=$3",[memberId,conversation.account_id,conversation.id]);
    await client.query("UPDATE chat_analysis_jobs SET family_member_id=$1 WHERE account_id=$2 AND conversation_id=$3",[memberId,conversation.account_id,conversation.id]);
    await client.query("COMMIT");
    return normalize(updated.rows[0]);
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function historyToken(accountId:string,memberId:string|null):Promise<HistoryToken> {
  const scopeKey=memberId??"family";
  await query("INSERT INTO chat_history_epochs(account_id,scope_key) VALUES($1,'*'),($1,$2) ON CONFLICT DO NOTHING",[accountId,scopeKey]);
  const result=await query<{scope_key:string;epoch:string}>("SELECT scope_key,epoch::text FROM chat_history_epochs WHERE account_id=$1 AND scope_key IN ('*',$2)",[accountId,scopeKey]);
  return {global:Number(result.rows.find(r=>r.scope_key==="*")?.epoch??0),profile:Number(result.rows.find(r=>r.scope_key===scopeKey)?.epoch??0),scopeKey};
}
export async function recentMessages(accountId:string,id:string) {
  const r=await query<{role:string;content:string}>(
    "SELECT role,content FROM (SELECT role,content,created_at,message_order FROM chat_messages WHERE account_id=$1 AND conversation_id=$2 ORDER BY created_at DESC,message_order DESC LIMIT 6) m ORDER BY created_at,message_order",[accountId,id]);
  return r.rows;
}
export async function saveTurn(args:{conversation:Conversation;token:HistoryToken;state:ConversationState;message:string;answer:ChatAnswer;jobId?:string}) {
  // The last check before anything reaches the household (lib/chat/output-guard.ts). An identity number is masked in the
  // answer and in what is kept with the turn, for every chat path, before it is saved or returned.
  maskIdentityNumbers(args.answer);
  maskIdentityNumbers(args.state);
  guardChatAnswer(args.answer);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const epochs=await client.query<{scope_key:string;epoch:string}>(
      "SELECT scope_key,epoch::text FROM chat_history_epochs WHERE account_id=$1 AND scope_key IN ('*',$2) ORDER BY scope_key FOR UPDATE",
      [args.conversation.account_id,args.token.scopeKey]);
    if (Number(epochs.rows.find(r=>r.scope_key==="*")?.epoch)!==args.token.global ||
        Number(epochs.rows.find(r=>r.scope_key===args.token.scopeKey)?.epoch)!==args.token.profile) throw new ChatConflict("History was cleared while this answer was being prepared.");
    if(args.jobId) {
      const job=await client.query("SELECT id FROM chat_analysis_jobs WHERE id=$1 AND account_id=$2 AND status='running' FOR UPDATE",[args.jobId,args.conversation.account_id]);
      if(!job.rows.length)throw new ChatConflict("This answer was cancelled.");
    }
    const updated=await client.query(
      "UPDATE chat_conversations SET state=$1::jsonb,last_answer=$2::jsonb,revision=revision+1,updated_at=now() WHERE account_id=$3 AND id=$4 AND revision=$5 RETURNING id",
      [JSON.stringify(args.state),JSON.stringify(args.answer),args.conversation.account_id,args.conversation.id,args.conversation.revision]);
    if(!updated.rows.length)throw new ChatConflict("This chat was deleted or changed while the answer was being prepared.");
    await client.query(
      "INSERT INTO chat_messages(account_id,family_member_id,conversation_id,role,content,citations,answer_json) VALUES($1,$2,$3,'user',$4,NULL,NULL),($1,$2,$3,'assistant',$5,$6::jsonb,$7::jsonb)",
      [args.conversation.account_id,args.conversation.family_member_id,args.conversation.id,turnDisplay.getStore()?.message??args.message,args.answer.summary,JSON.stringify(args.answer.citations),JSON.stringify(args.answer)]);
    // The answer and the visible chat-job completion are one atomic unit.
    // If a worker dies after COMMIT but before acknowledging its generic
    // background job, the retry sees this terminal row and exits without
    // inserting the same user/assistant pair a second time.
    if(args.jobId) {
      await client.query(
        "UPDATE chat_analysis_jobs SET status='complete',result_json=$1::jsonb,error=NULL,updated_at=now() WHERE id=$2 AND account_id=$3 AND status='running'",
        [JSON.stringify({answer:args.answer,retrieved:[]}),args.jobId,args.conversation.account_id]);
    }
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function listConversations(accountId:string,scope:string|null,cursor?:string|null) {
  await ensureChatSchema();
  const result=await query<{id:string;family_member_id:string|null;title:string;updated_at:string;revision:string}>(
    "SELECT id,family_member_id,title,updated_at::text,revision::text FROM chat_conversations WHERE account_id=$1 AND ($2='all' OR family_member_id IS NOT DISTINCT FROM $3::uuid) AND ($4::uuid IS NULL OR (updated_at,id)<(SELECT updated_at,id FROM chat_conversations WHERE account_id=$1 AND id=$4::uuid)) ORDER BY updated_at DESC,id DESC LIMIT 51",
    [accountId,scope==="all"?"all":"profile",scope==="all"||scope==="family"?null:scope,cursor??null]);
  const hasMore=result.rows.length>50;const conversations=result.rows.slice(0,50);
  return {conversations,nextCursor:hasMore?conversations.at(-1)?.id:null};
}
export async function deleteHistory(accountId:string,args:{id?:string;memberId?:string|null;all?:boolean}) {
  await ensureChatSchema();
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("INSERT INTO chat_history_epochs(account_id,scope_key) VALUES($1,'*') ON CONFLICT DO NOTHING",[accountId]);
    await client.query("SELECT epoch FROM chat_history_epochs WHERE account_id=$1 AND scope_key='*' FOR UPDATE",[accountId]);
    if(args.id){
      const deleted=await client.query("DELETE FROM chat_conversations WHERE account_id=$1 AND id=$2 RETURNING id",[accountId,args.id]);
      if(!deleted.rows.length)throw new ChatConflict("Chat not found.");
      await client.query("DELETE FROM claim_sessions WHERE account_id=$1 AND id=$2",[accountId,args.id]);
    }else{
      const scope=args.memberId??"family";
      await client.query("INSERT INTO chat_history_epochs(account_id,scope_key,epoch) VALUES($1,$2,1) ON CONFLICT(account_id,scope_key) DO UPDATE SET epoch=chat_history_epochs.epoch+1",[accountId,args.all?"*":scope]);
      await client.query("DELETE FROM chat_analysis_jobs WHERE account_id=$1 AND ($2 OR family_member_id IS NOT DISTINCT FROM $3::uuid)",[accountId,!!args.all,args.memberId??null]);
      await client.query("DELETE FROM chat_messages WHERE account_id=$1 AND ($2 OR family_member_id IS NOT DISTINCT FROM $3::uuid)",[accountId,!!args.all,args.memberId??null]);
      await client.query("DELETE FROM chat_conversations WHERE account_id=$1 AND ($2 OR family_member_id IS NOT DISTINCT FROM $3::uuid)",[accountId,!!args.all,args.memberId??null]);
      await client.query("DELETE FROM claim_sessions WHERE account_id=$1 AND ($2 OR family_member_id IS NOT DISTINCT FROM $3::uuid)",[accountId,!!args.all,args.memberId??null]);
    }
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
