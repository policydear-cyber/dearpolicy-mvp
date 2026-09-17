/**
 * Reading a document into the Coverage Ledger.
 *
 * This is the job the person pays for: the model reads the whole document
 * against the fixed list of events and writes ledger rows, then checks its
 * own rows against the page text. A row is confirmed when
 *   1. the quoted sentence is really on the cited page,
 *   2. every number in the row appears on that page, and
 *   3. a second, independent read of the page agrees the row is what the
 *      document says.
 * A row that fails 1 or 2 is dropped; one that fails only 3 is kept as a
 * proposal. The person never has to confirm anything; they can look.
 */
import { z } from "zod";
import { structuredCompletion } from "@/lib/ai/llm";
import { readingProvider } from "@/lib/ai/reading-model";
import { query } from "@/lib/db/client";
import { normalText } from "@/lib/chat/facts";
import { EVENTS,type EventType,type PaysKind } from "@/lib/ledger/events";
import { ensureLedgerSchema } from "@/lib/ledger/store";

const EVENT_LIST=Object.keys(EVENTS) as EventType[];
const PAYS_LIST=["lump_sum","per_day","per_month","percent_of_sum","reimbursement_cap","stated"] as const;

const RowSchema=z.object({
  insuredName:z.string().nullable().optional(),
  planName:z.string().min(1),
  benefitName:z.string().nullable().optional(),
  eventType:z.enum(EVENT_LIST as [EventType,...EventType[]]),
  detail:z.string().nullable().optional(),
  cause:z.enum(["accident","illness"]).nullable().optional(),
  paysKind:z.enum(PAYS_LIST),
  amount:z.number().nullable().optional(),
  currency:z.string().nullable().optional(),
  sumBasis:z.number().nullable().optional(),
  offsetDays:z.number().int().nullable().optional(),
  maximumDays:z.number().int().nullable().optional(),
  conditions:z.array(z.string()).optional(),
  minimum:z.object({factKey:z.enum(["flightDelayHours","hospitalNights","icuNights"]),value:z.number()}).nullable().optional(),
  sourcePage:z.number().int().min(1),
  quote:z.string().min(8),
});
const ExtractionSchema=z.object({rows:z.array(RowSchema)});
type ExtractedRow=z.infer<typeof RowSchema>;
const VerifySchema=z.object({verdicts:z.array(z.object({index:z.number().int(),supported:z.boolean(),why:z.string().optional()}))});

export const LEDGER_SYSTEM=
"Build the coverage ledger for an insurance document. You are given the text of a personal insurance document (a certificate, schedule, benefit summary or policy wording) page by page, and the names of the family members it may cover. "+
"Return every payout rule the document states, one row per (insured person, plan, event, how it pays). Only state what the document itself says; never assume a standard rule. "+
"Fields: insuredName (the person the row is for, exactly as named in the document, or null if the document does not name one); planName (the plan or benefit section as the document names it); benefitName (the benefit's own name as printed); "+
"eventType, one of: "+EVENT_LIST.join(", ")+"; detail (a sub-condition such as the body part for a fracture row, or the benefit's own name when eventType is other); "+
"cause: 'accident' when the row pays only for accidents, 'illness' when only for illness, else null; "+
"paysKind: lump_sum (a stated sum), percent_of_sum (amount is the fraction, e.g. 0.25 for 25%; sumBasis is the sum insured it applies to when the document states it), per_day (amount per day; offsetDays waiting period; maximumDays cap), per_month, reimbursement_cap (amount is the limit), stated (the document names the benefit but gives no figure); "+
"amount as a plain number with no symbols; currency as an ISO code; conditions as short quoted restrictions that change eligibility or the amount; minimum when the benefit starts only at a threshold, as {factKey: flightDelayHours|hospitalNights|icuNights, value}; sourcePage as the page the quote is on; quote as an exact sentence or table row copied from that page that states the rule. "+
"Skip premiums, premium tables, age bands, exclusions lists, deductibles and co-insurance percentages, and any figure that is a cost to the person rather than a payment to them. "+
"Return JSON {\"rows\":[...]}.";

export const VERIFY_SYSTEM=
"Check coverage ledger rows against the insurance document page they cite. For each row, answer supported=true only if the page states that exact benefit, for that event, with that amount and pay kind, and the row's insured person is either named on the page or the page does not restrict the benefit to a named person. Answer supported=false if any number, event, cause or condition in the row is not what the page says. Return JSON {\"verdicts\":[{\"index\",\"supported\",\"why\"}]}.";

type Page={page_number:number;text:string};
function pageText(pages:Page[],n:number){return pages.find(p=>p.page_number===n)?.text??"";}
function quoteOnPage(quote:string,text:string){
  const q=normalText(quote),t=normalText(text);
  if(!q||!t)return false;
  if(t.includes(q))return true;
  // Tolerate a broken line or a dropped word: the longest half must be there.
  const half=Math.max(20,Math.floor(q.length/2));
  return t.includes(q.slice(0,half))||t.includes(q.slice(q.length-half));
}
function numbersOnPage(row:ExtractedRow,text:string){
  const flat=text.replace(/[,\s]/g,"");
  const check=(n:number|null|undefined)=>{
    if(n==null)return true;
    const variants=[String(n),n.toFixed(2),n.toFixed(0)];
    if(row.paysKind==="percent_of_sum"&&n<=1)variants.push(String(Math.round(n*1000)/10),String(Math.round(n*100)));
    return variants.some(v=>flat.includes(v.replace(/\.0+$/,"")));
  };
  return check(row.amount)&&check(row.sumBasis)&&check(row.offsetDays)&&check(row.maximumDays)&&check(row.minimum?.value);
}
/** How much text one reading call may carry. A hosted reader takes a whole
 * document; a local model takes a page or two. */
function batchBudget(){return readingProvider()==="ollama"?3200:60_000;}
function batches(pages:Page[]):Page[][]{
  const budget=batchBudget();const out:Page[][]=[];let current:Page[]=[];let size=0;
  for(const page of pages){
    const text=page.text.slice(0,budget);
    if(current.length&&size+text.length>budget){out.push(current);current=[];size=0;}
    current.push({page_number:page.page_number,text});size+=text.length;
  }
  if(current.length)out.push(current);
  return out;
}

export type LedgerExtraction={rows:(ExtractedRow&{status:"confirmed"|"proposed";familyMemberId:string})[];read:number;dropped:number};

export async function extractLedgerRows(args:{accountId:string;policyId:string;pages:Page[];
  members:{id:string;names:string[]}[];planName:string|null;insurer:string|null;report?:(stage:string)=>void}):Promise<LedgerExtraction>{
  const pages=args.pages.filter(p=>p.text.trim().length>40);
  const out:LedgerExtraction={rows:[],read:pages.length,dropped:0};
  if(!pages.length||!args.members.length)return out;
  const memberNames=args.members.flatMap(m=>m.names.map(name=>({id:m.id,name})));
  for(const [index,batch] of batches(pages).entries()){
    args.report?.("Reading pages "+batch[0].page_number+"–"+batch[batch.length-1].page_number);
    const extraction=await structuredCompletion({
      role:"reading",schema:ExtractionSchema,temperature:0,numCtx:4096,maxOutputTokens:4000,timeoutMs:180_000,attempts:1,
      coerce:(raw)=>{const source=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
        const rows=Array.isArray(source.rows)?source.rows:[];
        return {rows:rows.map(r=>{const row=(r&&typeof r==="object"?r:{}) as Record<string,unknown>;
          if(typeof row.amount==="string")row.amount=Number(String(row.amount).replace(/[^0-9.]/g,""))||null;
          if(typeof row.sumBasis==="string")row.sumBasis=Number(String(row.sumBasis).replace(/[^0-9.]/g,""))||null;
          if(typeof row.sourcePage==="string")row.sourcePage=Number(row.sourcePage);
          if(row.conditions&&!Array.isArray(row.conditions))row.conditions=[String(row.conditions)];
          return row;}).filter(row=>RowSchema.safeParse(row).success)};},
      system:LEDGER_SYSTEM,
      user:JSON.stringify({document:{plan:args.planName,insurer:args.insurer,part:index+1},
        familyMembers:[...new Set(memberNames.map(m=>m.name))],
        pages:batch.map(p=>({page:p.page_number,text:p.text}))}),
    });
    // Deterministic checks: the quote is on the page and the numbers are on the page.
    const kept:ExtractedRow[]=[];
    for(const row of extraction.rows){
      const text=pageText(pages,row.sourcePage);
      if(!quoteOnPage(row.quote,text)||!numbersOnPage(row,text)){out.dropped++;continue;}
      kept.push(row);
    }
    if(!kept.length)continue;
    // Second read: does the page really say this?
    let supported=new Set<number>();
    try{
      args.report?.("Checking what was read");
      const verdict=await structuredCompletion({
        role:"reading",schema:VerifySchema,temperature:0,numCtx:4096,maxOutputTokens:1500,timeoutMs:180_000,attempts:1,
        coerce:(raw)=>{const source=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;return {verdicts:Array.isArray(source.verdicts)?source.verdicts:[]};},
        system:VERIFY_SYSTEM,
        user:JSON.stringify({rows:kept.map((row,i)=>({index:i,insuredName:row.insuredName??null,planName:row.planName,eventType:row.eventType,detail:row.detail??null,cause:row.cause??null,
            paysKind:row.paysKind,amount:row.amount??null,sumBasis:row.sumBasis??null,offsetDays:row.offsetDays??null,maximumDays:row.maximumDays??null,quote:row.quote,page:row.sourcePage})),
          pages:[...new Set(kept.map(r=>r.sourcePage))].map(n=>({page:n,text:pageText(pages,n)}))}),
      });
      supported=new Set(verdict.verdicts.filter(v=>v.supported).map(v=>v.index));
    }catch{/* Unverified rows stay proposals. */}
    kept.forEach((row,i)=>{
      // Whose row is it: the named person if they are in the family, else
      // everyone this document is linked to.
      const named=row.insuredName?memberNames.find(m=>normalText(m.name)===normalText(row.insuredName!)||normalText(row.insuredName!).includes(normalText(m.name))||normalText(m.name).includes(normalText(row.insuredName!))):null;
      const owners=named?[named.id]:args.members.map(m=>m.id);
      for(const familyMemberId of owners)out.rows.push({...row,status:supported.has(i)?"confirmed":"proposed",familyMemberId});
    });
  }
  return out;
}

function seedKeyFor(policyId:string,row:ExtractedRow,familyMemberId:string){
  const parts=[familyMemberId,row.eventType,row.paysKind,row.cause??"",normalText(row.planName).slice(0,40),normalText(row.detail??"").slice(0,40),row.amount??"",row.sourcePage];
  return "ai:"+policyId+":"+parts.join("|");
}
/** Reads one document into the ledger. Additive; never touches an existing row. */
export async function readDocumentIntoLedger(args:{accountId:string;policyId:string;report?:(stage:string)=>void}):Promise<{added:number;read:number;dropped:number}>{
  await ensureLedgerSchema();
  const doc=(await query<{product_name:string|null;insurer:string|null}>("SELECT product_name,insurer FROM policies WHERE id=$1 AND account_id=$2",[args.policyId,args.accountId])).rows[0];
  if(!doc)return {added:0,read:0,dropped:0};
  const pages=(await query<Page>("SELECT page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id=$2 ORDER BY page_number",[args.accountId,args.policyId])).rows;
  const members=(await query<{id:string;display_name:string;preferred_name:string|null}>(
    "SELECT f.id,f.display_name,f.preferred_name FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id WHERE pm.account_id=$1 AND pm.policy_id=$2",[args.accountId,args.policyId])).rows
    .map(m=>({id:m.id,names:[m.display_name,...(m.preferred_name?[m.preferred_name]:[])]}));
  const extraction=await extractLedgerRows({accountId:args.accountId,policyId:args.policyId,pages,members,planName:doc.product_name,insurer:doc.insurer,report:args.report});
  let added=0;
  for(const row of extraction.rows){
    const r=await query<{id:string}>(
      `INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,insurer,event_type,detail,cause,pays_kind,amount,currency,sum_basis,offset_days,maximum_days,conditions,note,source_page,quote,origin,inferred,status,seed_key,minimum_fact,minimum_value)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16,$17,$18,'wording',false,$19,$20,$21,$22)
       ON CONFLICT (account_id,seed_key) WHERE seed_key IS NOT NULL DO NOTHING RETURNING id`,
      [args.accountId,row.familyMemberId,args.policyId,row.planName.slice(0,200),doc.insurer,row.eventType,row.detail?.slice(0,200)??null,row.cause??null,row.paysKind,
       row.amount??null,(row.currency??"SGD").toUpperCase().slice(0,3),row.sumBasis??null,row.offsetDays??null,row.maximumDays??null,(row.conditions??[]).slice(0,6).map(c=>c.slice(0,240)),
       (row.benefitName??row.detail)?.slice(0,200)??null,row.sourcePage,row.quote.slice(0,600),row.status,seedKeyFor(args.policyId,row,row.familyMemberId),row.minimum?.factKey??null,row.minimum?.value??null]);
    added+=r.rows.length;
  }
  await query("UPDATE policies SET ledger_read_at=now() WHERE id=$1 AND account_id=$2",[args.policyId,args.accountId]);
  return {added,read:extraction.read,dropped:extraction.dropped};
}

type ExtractGlobals=typeof globalThis&{__dearpolicyLedgerReading?:Map<string,Promise<{documents:number;added:number}>>};
/** Reads every ready document that has not been read into the ledger yet.
 * One run per account at a time; a second caller joins the first. */
export async function readPendingDocuments(accountId:string,report?:(stage:string)=>void):Promise<{documents:number;added:number}>{
  const state=globalThis as ExtractGlobals;
  state.__dearpolicyLedgerReading??=new Map();
  const running=state.__dearpolicyLedgerReading.get(accountId);
  if(running)return running;
  const job=(async()=>{
    await ensureLedgerSchema();
    const pending=(await query<{id:string;original_filename:string}>(
      `SELECT p.id,p.original_filename FROM policies p WHERE p.account_id=$1 AND p.processing_status='ready' AND p.ledger_read_at IS NULL
         AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
         AND EXISTS(SELECT 1 FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id) ORDER BY p.created_at`,[accountId])).rows;
    let added=0;
    for(const doc of pending){
      try{
        const result=await readDocumentIntoLedger({accountId,policyId:doc.id,report:stage=>report?.(doc.original_filename+": "+stage)});
        added+=result.added;
      }catch(error){
        console.warn("Ledger reading failed for "+doc.original_filename+":",error instanceof Error?error.message:error);
      }
    }
    return {documents:pending.length,added};
  })().finally(()=>state.__dearpolicyLedgerReading?.delete(accountId));
  state.__dearpolicyLedgerReading.set(accountId,job);
  return job;
}
export async function pendingDocumentCount(accountId:string){
  await ensureLedgerSchema();
  const r=await query<{n:number}>(
    `SELECT count(*)::int AS n FROM policies p WHERE p.account_id=$1 AND p.processing_status='ready' AND p.ledger_read_at IS NULL
       AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
       AND EXISTS(SELECT 1 FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id)`,[accountId]);
  return Number(r.rows[0]?.n??0);
}
export function ledgerReadingInProgress(accountId:string){
  return !!(globalThis as ExtractGlobals).__dearpolicyLedgerReading?.has(accountId);
}
