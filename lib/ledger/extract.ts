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
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { normalText } from "@/lib/chat/facts";
import { EVENTS,THIRD_PARTY_LIABILITY,THIRD_PARTY_SENSE,rowFiguresDependOnPlan,type EventType,type PaysKind } from "@/lib/ledger/events";
import { ensureLedgerSchema } from "@/lib/ledger/store";
import { normalizeCurrencyCode } from "@/lib/format/currency";
import { statedCurrencyCode } from "@/lib/policies/benefit-rows";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { READ_FAILURE_REASON,readFailureCode,readFailureNotes,type ReadFailureCode } from "@/lib/policies/read-failures";
import { UNTRUSTED_DOCUMENT_NOTICE,cachedReading,ensureEvidenceSchema,readingModelIdentity } from "@/lib/documents/evidence";
import { annotateLedgerEvidence,markConflicts } from "@/lib/documents/evidence-store";
import { unparsedBenefitLines } from "@/lib/policies/catalog-builder";
import { locatePassage,looksLikeInjectedInstruction } from "@/lib/documents/evidence";
import { benefitNamePrinted,eventSupported,looksLikeName,namePrinted,personPrinted,rowFigureSupported } from "@/lib/documents/fact-check";

/** The ISO code of the currency a ledger row's amount is printed in: the
 * model's answer when it is a real code or symbol (US$ -> USD, RM -> MYR),
 * else what the quoted row itself prints. Never a default: a bare "$" or no
 * marker at all is null. */
export function ledgerRowCurrency(row:{currency?:string|null;quote:string;paysKind?:string;amount?:number|null},documentCurrency:string|null=null):string|null{
  const given=row.currency?normalizeCurrencyCode(row.currency,""):"";
  if(/^[A-Z]{3}$/.test(given))return given;
  const printed=statedCurrencyCode(row.quote);
  if(printed)return printed;
  // A row that carries no money figure of its own ("100% of the Sum
  // Insured", or a benefit named with no amount) takes the one currency this
  // document states elsewhere, if it states exactly one. Never a default.
  if(row.paysKind==="percent_of_sum"||row.amount==null)return documentCurrency;
  return null;
}

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
export type ExtractedRow=z.infer<typeof RowSchema>;
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
"Return JSON {\"rows\":[...]}."+UNTRUSTED_DOCUMENT_NOTICE;

export const VERIFY_SYSTEM=
"Check coverage ledger rows against the insurance document page they cite. For each row, answer supported=true only if the page states that exact benefit, for that event, with that amount and pay kind, and the row's insured person is either named on the page or the page does not restrict the benefit to a named person. Answer supported=false if any number, event, cause or condition in the row is not what the page says. Return JSON {\"verdicts\":[{\"index\",\"supported\",\"why\"}]}."+UNTRUSTED_DOCUMENT_NOTICE;

type Page={page_number:number;text:string};
function pageText(pages:Page[],n:number){return pages.find(p=>p.page_number===n)?.text??"";}
function quoteOnPage(quote:string,text:string){return !!printedPart(quote,text);}
/** The part of a quote that is really printed on the page: all of it, or --
 * tolerating a broken line or a dropped word -- its longer printed half. Every
 * figure and word of the row is then checked against THIS text only, never
 * against the half the page does not print or the rest of the page. */
function printedPart(quote:string,text:string):string|null{
  const q=normalText(quote),t=normalText(text);
  if(!q||!t||looksLikeInjectedInstruction(quote))return null;
  const half=Math.max(20,Math.floor(q.length/2));
  const part=t.includes(q)?q:t.includes(q.slice(0,half))?q.slice(0,half):t.includes(q.slice(q.length-half))?q.slice(q.length-half):null;
  if(!part)return null;
  // As the page prints it (case and spacing), so the stored quote is the page's own words.
  const span=locatePassage(text,part);
  return span?text.slice(span.start,span.end):part;
}
/** Round 9: what a ledger row says is what its printed quote says -- the
 * figure in the unit it claims, an event its words can name -- and its
 * restrictions are printed in the document. */
export function rowSupported(row:ExtractedRow,pageText:string){
  const part=printedPart(row.quote,pageText);
  if(!part)return false;
  if(!rowFigureSupported(part,row.paysKind,row.amount??null))return false;
  // One plan column's figure is not the person's figure, and "Not covered" pays nothing.
  if(row.amount!=null&&rowFiguresDependOnPlan(part))return false;
  const names=[row.benefitName,row.detail].filter((n):n is string=>!!n&&benefitNamePrinted(pageText,n)).join(" ");
  // Liability to other people is never the insured person's own death or injury benefit. The row's own name says so
  // in any wording; the printed quote only in the third-party sense, since its "the Company shall not be liable for
  // ..." is an exclusion of the person's own cover (and the model's label may not mention liability at all).
  if((THIRD_PARTY_LIABILITY.test(names)||THIRD_PARTY_SENSE.test(part))&&row.eventType!=="other")return false;
  return eventSupported(row.eventType,[names,part].join(" "));
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
// 3,200 characters was the local model's context talking; a hosted reader
// takes the whole batch.
function batchBudget(){return 60_000;}
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
  // V1.1 ($5/month budget): schedule rows are already in the benefit
  // catalogue (and seeded into the ledger from it without a model); only
  // pages with text that no plain-code reader accounted for are read here,
  // and a document whose every rule is in a schedule costs nothing.
  const pages=args.pages.filter(p=>p.text.trim().length>40&&unparsedBenefitLines(p.text).length>0);
  const out:LedgerExtraction={rows:[],read:pages.length,dropped:0};
  if(!pages.length||!args.members.length)return out;
  const memberNames=args.members.flatMap(m=>m.names.map(name=>({id:m.id,name})));
  for(const [index,batch] of batches(pages).entries()){
    args.report?.("Reading pages "+batch[0].page_number+"–"+batch[batch.length-1].page_number);
    const owner={accountId:args.accountId,policyId:args.policyId};
    const model=await readingModelIdentity();
    const readInput={document:{plan:args.planName,insurer:args.insurer,part:index+1},
      familyMembers:[...new Set(memberNames.map(m=>m.name))],
      pages:batch.map(p=>({page:p.page_number,text:p.text}))};
    // Cached by the exact pages and names read: never re-paid on a retry.
    const extraction=await cachedReading(owner,"ledger_read",{readInput,prompt:LEDGER_SYSTEM},model,()=>structuredCompletion({
      role:"reading",operation:"benefit_extraction",householdId:args.accountId,resourceId:args.policyId,schema:ExtractionSchema,temperature:0,maxOutputTokens:4000,timeoutMs:180_000,attempts:1,
      coerce:(raw)=>{const source=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
        const rows=Array.isArray(source.rows)?source.rows:[];
        return {rows:rows.map(r=>{const row=(r&&typeof r==="object"?r:{}) as Record<string,unknown>;
          if(typeof row.amount==="string")row.amount=Number(String(row.amount).replace(/[^0-9.]/g,""))||null;
          if(typeof row.sumBasis==="string")row.sumBasis=Number(String(row.sumBasis).replace(/[^0-9.]/g,""))||null;
          if(typeof row.sourcePage==="string")row.sourcePage=Number(row.sourcePage);
          if(row.conditions&&!Array.isArray(row.conditions))row.conditions=[String(row.conditions)];
          return row;}).filter(row=>RowSchema.safeParse(row).success)};},
      system:LEDGER_SYSTEM,
      user:JSON.stringify(readInput),
    }));
    // Deterministic checks: the quote is on the page and the numbers are on the page.
    const kept:ExtractedRow[]=[];
    const documentText=args.pages.map(p=>p.text).join("\n");
    for(const raw of extraction.rows){
      const text=pageText(pages,raw.sourcePage);
      if(!quoteOnPage(raw.quote,text)||!numbersOnPage(raw,text)||!rowSupported(raw,text)){out.dropped++;continue;}
      // Round 9: a named person must be printed in the document; the plan and
      // benefit names are the ones it prints; a restriction is kept only as printed.
      if(raw.insuredName&&(!personPrinted(documentText,raw.insuredName)||(args.members.length>1&&!personPrinted(text,raw.insuredName)))){out.dropped++;continue;}
      const tidy=(name:string)=>name.replace(/\s+/g," ").trim();
      const row:ExtractedRow={...raw,quote:printedPart(raw.quote,text)??raw.quote,
        planName:looksLikeName(raw.planName)&&namePrinted(documentText,raw.planName)?tidy(raw.planName):(args.planName??"This plan"),
        benefitName:raw.benefitName&&looksLikeName(raw.benefitName)&&benefitNamePrinted(text,raw.benefitName)?tidy(raw.benefitName):null,
        detail:raw.detail&&looksLikeName(raw.detail)&&benefitNamePrinted(text,raw.detail)?tidy(raw.detail):null,
        conditions:(raw.conditions??[]).filter(c=>normalText(documentText).includes(normalText(c))&&!looksLikeInjectedInstruction(c))};
      // The same row read twice is one row.
      if(kept.some(k=>k.sourcePage===row.sourcePage&&k.eventType===row.eventType&&k.paysKind===row.paysKind&&(k.amount??null)===(row.amount??null)&&normalText(k.quote)===normalText(row.quote)&&normalText(k.insuredName??"")===normalText(row.insuredName??"")))continue;
      kept.push(row);
    }
    if(!kept.length)continue;
    // Second read: does the page really say this?
    let supported=new Set<number>();
    try{
      args.report?.("Checking what was read");
      const verifyInput={rows:kept.map((row,i)=>({index:i,insuredName:row.insuredName??null,planName:row.planName,eventType:row.eventType,detail:row.detail??null,cause:row.cause??null,
            paysKind:row.paysKind,amount:row.amount??null,sumBasis:row.sumBasis??null,offsetDays:row.offsetDays??null,maximumDays:row.maximumDays??null,quote:row.quote,page:row.sourcePage})),
          pages:[...new Set(kept.map(r=>r.sourcePage))].map(n=>({page:n,text:pageText(pages,n)}))};
      const verdict=await cachedReading(owner,"ledger_verify",{verifyInput,prompt:VERIFY_SYSTEM},model,()=>structuredCompletion({
        role:"reading",operation:"benefit_extraction",householdId:args.accountId,resourceId:args.policyId,schema:VerifySchema,temperature:0,maxOutputTokens:1500,timeoutMs:180_000,attempts:1,
        coerce:(raw)=>{const source=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;return {verdicts:Array.isArray(source.verdicts)?source.verdicts:[]};},
        system:VERIFY_SYSTEM,
        user:JSON.stringify(verifyInput),
      }));
      supported=new Set(verdict.verdicts.filter(v=>v.supported).map(v=>v.index));
    }catch{/* Unverified rows stay proposals. */}
    kept.forEach((row,i)=>{
      // Whose row is it: the named person if they are in the family, else
      // everyone this document is linked to.
      // Round 9: the named person is matched on the whole name (display or
      // preferred), never on a fragment two people share; a name that matches
      // no one, or more than one person, is not attributed to anyone.
      const matches=row.insuredName?[...new Set(memberNames.filter(m=>normalText(m.name)===normalText(row.insuredName!)||(normalText(m.name).split(" ").length>=2&&normalText(row.insuredName!).includes(normalText(m.name)))).map(m=>m.id))]:[];
      if(row.insuredName&&matches.length!==1)return;
      const owners=matches.length?matches:args.members.map(m=>m.id);
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
/** With the benefit table switched on (lib/benefit-table), documents are read into it instead: no ledger read runs, from
 * any caller (upload, dashboard, Coverage, chat), so a document is never read and paid for twice. */
async function benefitTableOwnsReading(){
  const { benefitTableLive }=await import("@/lib/benefit-table/app");
  return benefitTableLive();
}
export async function readDocumentIntoLedger(args:{accountId:string;policyId:string;report?:(stage:string)=>void}):Promise<{added:number;read:number;dropped:number}>{
  if(await benefitTableOwnsReading())return {added:0,read:0,dropped:0};
  await ensureLedgerSchema();
  const doc=(await query<{product_name:string|null;insurer:string|null}>(`SELECT p.product_name,p.insurer FROM policies p WHERE p.id=$1 AND p.account_id=$2 AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}`,[args.policyId,args.accountId])).rows[0];
  if(!doc)return {added:0,read:0,dropped:0};
  const pages=(await query<Page>("SELECT page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id=$2 ORDER BY page_number",[args.accountId,args.policyId])).rows;
  const members=(await query<{id:string;display_name:string;preferred_name:string|null}>(
    `SELECT f.id,f.display_name,f.preferred_name FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id AND ${activePredicate("f")} WHERE pm.account_id=$1 AND pm.policy_id=$2`,[args.accountId,args.policyId])).rows
    .map(m=>({id:m.id,names:[m.display_name,...(m.preferred_name?[m.preferred_name]:[])]}));
  let extraction:LedgerExtraction;
  try{extraction=await extractLedgerRows({accountId:args.accountId,policyId:args.policyId,pages,members,planName:doc.product_name,insurer:doc.insurer,report:args.report});}
  catch(error){await recordLedgerReadFailure(args.accountId,args.policyId,error);throw error;}
  // The one currency this document's stored figures are printed in, if they
  // agree on exactly one.
  const documentCurrencies=(await query<{currency:string}>(
    `SELECT DISTINCT currency FROM (SELECT currency FROM policy_coverages WHERE account_id=$1 AND policy_id=$2
       UNION ALL SELECT currency FROM policy_benefits WHERE account_id=$1 AND policy_id=$2) c WHERE currency IS NOT NULL`,
    [args.accountId,args.policyId]).catch(()=>({rows:[] as {currency:string}[]}))).rows.map(r=>r.currency);
  const documentCurrency=documentCurrencies.length===1?documentCurrencies[0]:null;
  let added=0,skippedNoCurrency=0;
  // Idempotent per document version: this read replaces the previous read's
  // model rows for this document, so a retried or repeated read never leaves
  // duplicates or stale figures behind. A row a person has since changed
  // (updated after it was written) is kept; its seed key then keeps the new
  // read from writing it twice.
  await query(
    `DELETE FROM coverage_rules WHERE account_id=$1 AND policy_id=$2 AND origin='wording' AND seed_key LIKE $3 AND updated_at=created_at`,
    [args.accountId,args.policyId,"ai:"+args.policyId+":%"]);
  for(const row of extraction.rows){
    // coverage_rules.currency is NOT NULL (DEFAULT 'SGD') in the live schema,
    // and writing a currency the document never printed would put a guessed
    // unit next to a real amount. A row whose currency is not stated is left
    // out of the ledger instead (its benefit stays on the Benefits page).
    const currency=ledgerRowCurrency(row,documentCurrency);
    if(!currency){skippedNoCurrency++;continue;}
    const r=await query<{id:string}>(
      `INSERT INTO coverage_rules(account_id,family_member_id,policy_id,plan_name,insurer,event_type,detail,cause,pays_kind,amount,currency,sum_basis,offset_days,maximum_days,conditions,note,source_page,quote,origin,inferred,status,seed_key,minimum_fact,minimum_value)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16,$17,$18,'wording',false,$19,$20,$21,$22)
       ON CONFLICT (account_id,seed_key) WHERE seed_key IS NOT NULL DO NOTHING RETURNING id`,
      [args.accountId,row.familyMemberId,args.policyId,row.planName.slice(0,200),doc.insurer,row.eventType,row.detail?.slice(0,200)??null,row.cause??null,row.paysKind,
       row.amount??null,currency,row.sumBasis??null,row.offsetDays??null,row.maximumDays??null,(row.conditions??[]).slice(0,6).map(c=>c.slice(0,240)),
       (row.benefitName??row.detail)?.slice(0,200)??null,row.sourcePage,row.quote.slice(0,600),row.status,seedKeyFor(args.policyId,row,row.familyMemberId),row.minimum?.factKey??null,row.minimum?.value??null]);
    added+=r.rows.length;
  }
  await query("UPDATE policies SET ledger_read_at=now()"+(await hasReadingCache()?",reading_cache=reading_cache-'"+LEDGER_RETRY_KEY+"'":"")+" WHERE id=$1 AND account_id=$2",[args.policyId,args.accountId]);
  try{
    await annotateLedgerEvidence(args.accountId,args.policyId);
    await markConflicts(args.accountId,args.policyId);
  }catch(error){console.warn("Ledger evidence could not be written for policy "+args.policyId+":",error instanceof Error?error.message:error);}
  return {added,read:extraction.read,dropped:extraction.dropped+skippedNoCurrency};
}

// Round 10: a document whose ledger read failed (provider down, out of quota,
// output that did not validate) is not read again on every claim turn,
// dashboard load and ledger view -- each retry is a paid reading call per
// document, so a household with many such documents spent tens of model calls
// on every turn and never got an answer faster. It is retried after a delay
// that doubles with each failure (10 minutes, 20, 40 ... at most a day); a
// person asking for the read on the Coverage Ledger page reads it at once.
// The note lives in the document's own reading cache, so no schema change.
export const LEDGER_RETRY_KEY="ledger_read_failure";
const LEDGER_RETRY_BASE_MS=10*60_000,LEDGER_RETRY_MAX_MS=24*3600_000;
let readingCacheColumn:Promise<boolean>|null=null;
async function hasReadingCache(){
  readingCacheColumn??=ensureEvidenceSchema().then(()=>query<{ok:boolean}>("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='policies' AND column_name='reading_cache') AS ok"))
    .then(r=>!!r.rows[0]?.ok).catch(()=>{readingCacheColumn=null;return false;});
  return readingCacheColumn;
}
async function recordLedgerReadFailure(accountId:string,policyId:string,error?:unknown){
  try{
    if(!await hasReadingCache())return;
    // One statement: the attempt count and the next retry time follow from the note already there.
    // The reason is a code (lib/policies/read-failures.ts), never the raw error.
    await query(`UPDATE policies SET reading_cache=coalesce(reading_cache,'{}'::jsonb)||jsonb_build_object($3::text,jsonb_build_object(
        'attempts',coalesce((reading_cache->$3::text->>'attempts')::int,0)+1,
        'retryAfter',to_char((now()+least(interval '1 millisecond'*$5::bigint,interval '1 millisecond'*$4::bigint*power(2,least(20,coalesce((reading_cache->$3::text->>'attempts')::int,0))))) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'reasonCode',$6::text,'lastFailedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      WHERE id=$1 AND account_id=$2`,
      [policyId,accountId,LEDGER_RETRY_KEY,LEDGER_RETRY_BASE_MS,LEDGER_RETRY_MAX_MS,readFailureCode(error)]);
  }catch{/* Never let the note fail the turn. */}
}
/** A document still waiting for its ledger read and not resting after a failed one. */
async function dueClause(includeBackedOff:boolean){
  if(includeBackedOff||!await hasReadingCache())return "";
  return ` AND coalesce((p.reading_cache->'${LEDGER_RETRY_KEY}'->>'retryAfter')::timestamptz,'-infinity'::timestamptz)<=now()`;
}

type ExtractGlobals=typeof globalThis&{__dearpolicyLedgerReading?:Map<string,Promise<{documents:number;added:number}>>;__dearpolicyLedgerReadingDoc?:Map<string,string>};
/** Reads every ready document that has not been read into the ledger yet.
 * One run per account at a time; a second caller joins the first. */
export async function readPendingDocuments(accountId:string,report?:(stage:string)=>void,opts:{includeBackedOff?:boolean}={}):Promise<{documents:number;added:number}>{
  if(await benefitTableOwnsReading())return {documents:0,added:0};
  const state=globalThis as ExtractGlobals;
  state.__dearpolicyLedgerReading??=new Map();
  const running=state.__dearpolicyLedgerReading.get(accountId);
  if(running)return running;
  const job=(async()=>{
    await ensureLedgerSchema();
    const pending=(await query<{id:string;original_filename:string}>(
      `SELECT p.id,p.original_filename FROM policies p WHERE p.account_id=$1 AND p.processing_status='ready' AND p.ledger_read_at IS NULL AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}
         AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
         AND EXISTS(SELECT 1 FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id)${await dueClause(!!opts.includeBackedOff)} ORDER BY p.created_at`,[accountId])).rows;
    let added=0;
    state.__dearpolicyLedgerReadingDoc??=new Map();
    for(const doc of pending){
      state.__dearpolicyLedgerReadingDoc.set(accountId,doc.id);
      try{
        const result=await readDocumentIntoLedger({accountId,policyId:doc.id,report:stage=>report?.(doc.original_filename+": "+stage)});
        added+=result.added;
      }catch(error){
        console.warn("Ledger reading failed for "+doc.original_filename+":",error instanceof Error?error.message:error);
      }
    }
    return {documents:pending.length,added};
  })().finally(()=>{state.__dearpolicyLedgerReading?.delete(accountId);state.__dearpolicyLedgerReadingDoc?.delete(accountId);});
  state.__dearpolicyLedgerReading.set(accountId,job);
  return job;
}
/** Documents waiting for their ledger read, including one resting after a
 * failed read (callers refresh the ledger's seeded rows when any is waiting);
 * `dueOnly` counts only those readPendingDocuments would read now. */
export async function pendingDocumentCount(accountId:string,opts:{dueOnly?:boolean}={}){
  if(await benefitTableOwnsReading())return 0;
  await ensureLedgerSchema();
  const r=await query<{n:number}>(
    `SELECT count(*)::int AS n FROM policies p WHERE p.account_id=$1 AND p.processing_status='ready' AND p.ledger_read_at IS NULL AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}
       AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
       AND EXISTS(SELECT 1 FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id)${await dueClause(!opts.dueOnly)}`,[accountId]);
  return Number(r.rows[0]?.n??0);
}
export function ledgerReadingInProgress(accountId:string){
  return !!(globalThis as ExtractGlobals).__dearpolicyLedgerReading?.has(accountId);
}

export type LedgerReadState="waiting"|"reading"|"failed"|"backed_off";
export type LedgerReadDocument={policyId:string;name:string;state:LedgerReadState;reasonCode:ReadFailureCode|null;reason:string|null;attempts:number;lastFailedAt:string|null;retryAfter:string|null};
/** Every document still waiting for its ledger read, with where it stands:
 * waiting (not tried yet), reading (being read now), failed (its last read
 * failed and it will be tried again on the next read) or backed_off (its last
 * read failed and it rests until retryAfter). Same documents as
 * pendingDocumentCount. */
export async function ledgerReadDocuments(accountId:string):Promise<LedgerReadDocument[]>{
  await ensureLedgerSchema();
  const docs=(await query<{id:string;name:string}>(
    `SELECT p.id::text AS id,coalesce(p.product_name,p.original_filename) AS name FROM policies p WHERE p.account_id=$1 AND p.processing_status='ready' AND p.ledger_read_at IS NULL AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")}
       AND EXISTS(SELECT 1 FROM policy_pages pg WHERE pg.account_id=p.account_id AND pg.policy_id=p.id)
       AND EXISTS(SELECT 1 FROM policy_members pm WHERE pm.account_id=p.account_id AND pm.policy_id=p.id) ORDER BY p.created_at`,[accountId])).rows;
  const notes=await readFailureNotes(accountId,docs.map(d=>d.id),LEDGER_RETRY_KEY);
  const now=Date.now(),current=(globalThis as ExtractGlobals).__dearpolicyLedgerReadingDoc?.get(accountId);
  return docs.map(d=>{
    const note=notes.get(d.id),retryAfter=note?.retryAfter??null;
    const state:LedgerReadState=current===d.id?"reading":!note?"waiting":retryAfter&&Date.parse(retryAfter)>now?"backed_off":"failed";
    return {policyId:d.id,name:d.name,state,reasonCode:note?.reasonCode??null,reason:note?READ_FAILURE_REASON[note.reasonCode]:null,
      attempts:note?.attempts??0,lastFailedAt:note?.lastFailedAt??null,retryAfter};
  });
}
