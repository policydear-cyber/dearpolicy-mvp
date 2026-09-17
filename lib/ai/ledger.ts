import { pool,query } from "@/lib/db/client";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { costUsd,type ModelChoice,type ModelRole } from "./providers";

/** What a household costs, in tokens and dollars, per model job.
 *
 * A subscription price is a bet on this number. Every model call — hosted or
 * local — writes one row, so the bet can be checked, a runaway household can
 * be stopped before it costs more than its plan, and the monthly usage screen
 * is arithmetic over rows rather than a guess. Local calls cost $0 but are
 * still counted: they are what a hosted bill would be. */
type LedgerGlobals={__dearpolicyLedgerSchema?:Promise<void>;__dearpolicyLedgerAccount?:string};
export async function ensureLedgerSchema(){
  const state=globalThis as LedgerGlobals;
  state.__dearpolicyLedgerSchema??=(async()=>{
    const sql=await readFile(path.join(process.cwd(),"sql/model-usage.sql"),"utf8");
    const client=await pool.connect();
    try{await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(73499203)");await client.query(sql);await client.query("COMMIT");}
    catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  })().catch(error=>{delete state.__dearpolicyLedgerSchema;throw error;});
  await state.__dearpolicyLedgerSchema;
}
/** Calls do not carry the account through every layer; the request sets it
 * once here. Single-household local build: one account per process. */
export function setLedgerAccount(accountId:string){(globalThis as LedgerGlobals).__dearpolicyLedgerAccount=accountId;}
function ledgerAccount(){return (globalThis as LedgerGlobals).__dearpolicyLedgerAccount??process.env.DEV_ACCOUNT_ID??"00000000-0000-0000-0000-000000000001";}

export async function recordUsage(args:{role:ModelRole;choice:ModelChoice;input:number;output:number;cached?:number;durationMs:number;ok:boolean}){
  try{
    await ensureLedgerSchema();
    const cost=costUsd(args.choice,{input:args.input,output:args.output,cached:args.cached});
    await query(
      `INSERT INTO model_usage(account_id,role,provider,model,input_tokens,output_tokens,cached_tokens,cost_usd,priced,duration_ms,ok)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ledgerAccount(),args.role,args.choice.provider,args.choice.model,args.input,args.output,args.cached??0,cost??0,cost!=null,args.durationMs,args.ok]);
  }catch{/* The ledger never breaks the thing it is measuring. */}
}

export type UsageSummary={
  month:string;calls:number;inputTokens:number;outputTokens:number;costUsd:number;unpricedCalls:number;
  byRole:{role:string;calls:number;inputTokens:number;outputTokens:number;costUsd:number}[];
  chatTurns:number;documentsRead:number;
  plan:{name:string;priceUsd:number;includedChatTurns:number;includedDocuments:number;hardStopUsd:number};
  warnings:string[];
};
export function planLimits(){
  return {
    name:process.env.PLAN_NAME??"Individual",
    priceUsd:Number(process.env.PLAN_PRICE_USD??4.99),
    includedChatTurns:Number(process.env.PLAN_CHAT_TURNS??150),
    includedDocuments:Number(process.env.PLAN_DOCUMENTS??12),
    // A household that costs three times its plan is a fault, not a customer.
    hardStopUsd:Number(process.env.PLAN_HARD_STOP_USD??(3*Number(process.env.PLAN_PRICE_USD??4.99)).toFixed(2)),
  };
}
export async function usageThisMonth(accountId:string):Promise<UsageSummary>{
  await ensureLedgerSchema();
  const rows=await query<{role:string;calls:number;input_tokens:number;output_tokens:number;cost_usd:string;unpriced:number}>(
    `SELECT role,count(*)::int AS calls,coalesce(sum(input_tokens),0)::int AS input_tokens,coalesce(sum(output_tokens),0)::int AS output_tokens,
            coalesce(sum(cost_usd),0)::text AS cost_usd,count(*) FILTER (WHERE NOT priced)::int AS unpriced
       FROM model_usage WHERE account_id=$1 AND at>=date_trunc('month',now()) GROUP BY role ORDER BY role`,[accountId]);
  const turns=await query<{count:number}>(
    `SELECT count(*)::int AS count FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
      WHERE c.account_id=$1 AND m.role='user' AND m.created_at>=date_trunc('month',now())`,[accountId]).catch(()=>({rows:[{count:0}]}));
  const documents=await query<{count:number}>(
    `SELECT count(*)::int AS count FROM policies WHERE account_id=$1 AND benefits_indexed_at>=date_trunc('month',now())`,[accountId]).catch(()=>({rows:[{count:0}]}));
  const byRole=rows.rows.map(row=>({role:row.role,calls:row.calls,inputTokens:row.input_tokens,outputTokens:row.output_tokens,costUsd:Number(row.cost_usd)}));
  const plan=planLimits();
  const summary:UsageSummary={
    month:new Date().toISOString().slice(0,7),
    calls:byRole.reduce((n,r)=>n+r.calls,0),inputTokens:byRole.reduce((n,r)=>n+r.inputTokens,0),outputTokens:byRole.reduce((n,r)=>n+r.outputTokens,0),
    costUsd:Math.round(byRole.reduce((n,r)=>n+r.costUsd,0)*10000)/10000,unpricedCalls:rows.rows.reduce((n,r)=>n+r.unpriced,0),
    byRole,chatTurns:Number(turns.rows[0]?.count??0),documentsRead:Number(documents.rows[0]?.count??0),plan,warnings:[],
  };
  if(summary.chatTurns>=plan.includedChatTurns*0.8)summary.warnings.push(summary.chatTurns+" of "+plan.includedChatTurns+" included questions used this month.");
  if(summary.documentsRead>=plan.includedDocuments*0.8)summary.warnings.push(summary.documentsRead+" of "+plan.includedDocuments+" included documents read this month.");
  if(summary.costUsd>=plan.hardStopUsd*0.8)summary.warnings.push("Model spend this month is "+Math.round(summary.costUsd/plan.hardStopUsd*100)+"% of the hard stop ($"+plan.hardStopUsd.toFixed(2)+").");
  if(summary.unpricedCalls)summary.warnings.push(summary.unpricedCalls+" call"+(summary.unpricedCalls===1?"":"s")+" used a model with no price on file, so the cost shown is low.");
  return summary;
}
/** Thrown before a hosted call when the household has passed its hard stop. */
export class SpendCapReached extends Error{constructor(message:string){super(message);this.name="SpendCapReached";}}
export async function assertUnderSpendCap(accountId:string){
  const plan=planLimits();
  if(!(plan.hardStopUsd>0))return;
  const spent=await query<{cost:string}>(`SELECT coalesce(sum(cost_usd),0)::text AS cost FROM model_usage WHERE account_id=$1 AND at>=date_trunc('month',now())`,[accountId]).catch(()=>({rows:[{cost:"0"}]}));
  if(Number(spent.rows[0]?.cost??0)>=plan.hardStopUsd)
    throw new SpendCapReached("This household has reached its model-spend limit for the month ($"+plan.hardStopUsd.toFixed(2)+"). Questions from documents already read still work; reading new documents and model-assisted answers resume next month or on an upgraded plan.");
}
