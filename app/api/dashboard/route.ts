import { NextResponse } from "next/server";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import type { NextRequest } from "next/server";
import { runAfterResponse } from "@/lib/http/background";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { COVERAGE_CATEGORIES,normalizeCoverageCategory } from "@/lib/insurance";
import { normalizeCurrencyCode } from "@/lib/format/currency";
import { summarisePremiums } from "@/lib/policies/premium-summary";
import { notDismissedClause } from "@/lib/policies/name-dismissals";
import { categoryRows, confirmedTotalComplete, LUMP_SUM_CATEGORIES, lumpSumParts, tableDisplay, tileRows, wordingDescribes, type TilePart } from "@/lib/coverage/table-figures";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
export const maxDuration=60;

export async function GET(request:NextRequest){
 try{
  const ctx=await requireHouseholdContext(request); const accountId=ctx.householdId; const url=new URL(request.url);
  // The person should never have to ask DearPolicy to read a document or
  // check its own work — opening the app is enough. after() runs this once
  // the response has been sent, without holding up the dashboard, but — unlike
  // a bare fire-and-forget promise — it is kept alive by the hosting platform
  // (Vercel's waitUntil under the hood) instead of racing the serverless
  // function being frozen the instant the response goes out.
  // readPendingDocuments dedupes concurrent calls on its own.
  runAfterResponse(async()=>{
    try{
      const { pendingDocumentCount,readPendingDocuments }=await import("@/lib/ledger/extract");
      const pending=await pendingDocumentCount(accountId);
      if(!pending)return;
      await readPendingDocuments(accountId);
      const { seedLedger }=await import("@/lib/ledger/store");
      await seedLedger(accountId);
    }catch(error){console.warn("Background coverage-ledger read failed:",error instanceof Error?error.message:error);}
  });
  const familyResult=await query<{id:string;display_name:string;relationship:string;policy_count:number}>(`SELECT f.id,f.display_name,f.relationship,count(DISTINCT p.id)::int AS policy_count FROM family_members f LEFT JOIN policy_members pm ON pm.family_member_id=f.id AND pm.account_id=f.account_id LEFT JOIN policies p ON p.id=pm.policy_id AND p.account_id=f.account_id AND p.superseded_at IS NULL AND ${activePredicate("p")} WHERE f.account_id=$1 AND ${activePredicate("f")} GROUP BY f.id ORDER BY CASE WHEN f.relationship='self' THEN 0 ELSE 1 END,f.created_at`,[accountId]);
  const requested=url.searchParams.get("familyMemberId"); const active=familyResult.rows.find((m)=>m.id===requested)??familyResult.rows[0]??null;
  // An empty household is not "everything current": it has nothing on file yet.
  if(!active)return NextResponse.json({family:[],activeMember:null,coverages:[],premiums:{monthly:0,annual:0,items:[],missing:[],complete:false,note:null},
    reminders:[{kind:"family",title:"Add your family and upload a policy",detail:"Nothing is on file yet. Add who is in your family, then upload a policy schedule or certificate so DearPolicy can show what it covers and costs.",href:"/"}],
    unclaimed:[],quality:{needsReview:0,referenceDocs:0,personalDocs:0},empty:true});

  const coverageRows=await query<{id:string;policy_id:string;category:string;amount:string|null;currency:string|null;coverage_product_name:string|null;policy_key:string;document_product_name:string|null;insurer:string|null;group_policy_number:string|null;document_authority:number;effective_date:string|null;created_at:string}>(`SELECT pc.id,p.id::text AS policy_id,pc.category,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,coalesce(p.policy_number,p.id::text) AS policy_key,p.product_name AS document_product_name,p.insurer,p.group_policy_number,p.document_authority,p.effective_date::text,p.created_at::text FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true`,[accountId,active.id]);
  type Chosen={category:string;amount:number|null;currency:string;policyKey:string;productName:string|null;insurer:string|null;groupPolicyNumber:string|null;authority:number;effectiveDate:string|null;createdAt:string};
  const byPolicyCategory=new Map<string,Chosen[]>();
  for(const row of coverageRows.rows){
    const category=normalizeCoverageCategory(row.category);
    const key=`${row.policy_key}|${category}`; const list=byPolicyCategory.get(key)??[];
    list.push({category,amount:row.amount==null?null:Number(row.amount),currency:normalizeCurrencyCode(row.currency,"SGD"),policyKey:row.policy_key,productName:row.coverage_product_name??row.document_product_name,insurer:row.insurer,groupPolicyNumber:row.group_policy_number,authority:Number(row.document_authority),effectiveDate:row.effective_date,createdAt:row.created_at});
    byPolicyCategory.set(key,list);
  }
  const selected:Chosen[]=[]; const conflictCategories=new Set<string>();
  for(const [,list] of byPolicyCategory){
    list.sort((a,b)=>b.authority-a.authority+((b.effectiveDate?Date.parse(b.effectiveDate):Date.parse(b.createdAt))-(a.effectiveDate?Date.parse(a.effectiveDate):Date.parse(a.createdAt)))/1e15);
    const top=list[0]; selected.push(top); const sameAuthority=list.filter(x=>x.authority===top.authority); const amounts=new Set(sameAuthority.map(x=>x.amount).filter(x=>x!=null)); if(amounts.size>1)conflictCategories.add(top.category);
  }
  const coverageMap=new Map<string,{total:number|null;currency:string;count:number;policyNames:string[];displayAmount:string|null;derived:boolean;fromTable?:boolean;parts?:TilePart[]}>();
  for(const row of selected){
    const cur=coverageMap.get(row.category)??{total:null,currency:row.currency,count:0,policyNames:[],displayAmount:null,derived:false};
    if(row.amount!=null)cur.total=(cur.total??0)+row.amount; cur.count+=1; if(row.productName&&!cur.policyNames.includes(row.productName))cur.policyNames.push(row.productName); coverageMap.set(row.category,cur);
  }

  // The person's benefit table (the same rows the Family page and the chat use): a category its rows name shows the
  // figure the document prints for it, and a category nothing else confirms is covered by those rows. Nothing here is
  // tied to one scheme, product or insurer. Read from stored readings only: no model call.
  try{
    const { benefitTableLive,appDb }=await import("@/lib/benefit-table/app");
    if(await benefitTableLive(accountId)){
      const { tableFor }=await import("@/lib/benefit-table/service");
      const person=(await tableFor(appDb,accountId)).table.people.find(p=>p.id===active.id);
      const held=(person?.covers??[]).map(c=>({coverKey:c.coverKey,name:c.cover||c.product,documentId:c.source?.documentId??null,sumInsured:c.confirmation?.status==="corrected"?c.confirmation.sumInsured:c.sumInsured,currency:c.currency}));
      for(const category of COVERAGE_CATEGORIES){
        const rows=tileRows(categoryRows(category,person?.rows??[]));
        const lines=selected.filter(x=>x.category===category).map(x=>({name:x.productName??"Policy",amount:x.amount,currency:x.currency,documentIds:coverageRows.rows.filter(r=>r.policy_key===x.policyKey&&normalizeCoverageCategory(r.category)===category).map(r=>r.policy_id)}));
        // A lump-sum category gives each policy's sum and adds them up: a schedule line, and any cover only the table knows
        // (a scheme's sum only its summary prints). A policy whose sum is not read is named with no amount, and there is
        // then no total, never a part sum (DC 27 Oct).
        if(LUMP_SUM_CATEGORIES.has(category)&&(rows.length||lines.length)){
          const {parts,total}=lumpSumParts(rows,lines,held); const cur=coverageMap.get(category);
          const entry=cur??{total:null,currency:"SGD",count:0,policyNames:[],displayAmount:null,derived:false,fromTable:true};
          entry.total=total; entry.displayAmount=null; entry.parts=parts; entry.count=parts.length; entry.currency=normalizeCurrencyCode(parts.find(p=>p.currency)?.currency??entry.currency,"SGD");
          entry.policyNames=[...new Set(parts.map(p=>p.name))]; coverageMap.set(category,entry); continue;
        }
        if(!rows.length)continue;
        const cur=coverageMap.get(category); const display=tableDisplay(rows);
        // A confirmed total that leaves out a cover the table gives (a scheme's sum only its summary prints) is part of the
        // cover: the tile says Covered, never a part sum, and the table's own figure is not shown in its place either.
        if(cur&&cur.total!=null){if(!confirmedTotalComplete(rows,lines,held))cur.total=null;continue;}
        if(!cur)coverageMap.set(category,{total:null,currency:normalizeCurrencyCode(rows.map(r=>(r.figure as {currency?:string|null}).currency).find(Boolean)??null,"SGD"),count:1,policyNames:[...new Set(rows.map(r=>r.product))].slice(0,2),displayAmount:display,derived:false,fromTable:true});
        else if(cur.total==null&&!cur.displayAmount)cur.displayAmount=display;
      }
    }
  }catch(error){console.warn("Benefit table unavailable for the dashboard:",error instanceof Error?error.message:error);}

  // Reference wording can expand an OWNED product into its included benefits. It never creates ownership on its own,
  // and it never supplies an amount: the wording's figure is shown only where the person's benefit table prints it.
  const refs=await query<{category:string;product_name:string|null;insurer:string|null;group_policy_number:string|null}>(`SELECT prc.category,prc.product_name,p.insurer,p.group_policy_number FROM policy_reference_coverages prc JOIN policies p ON p.id=prc.policy_id AND ${activePredicate("p")} JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE prc.account_id=$1 AND pm.family_member_id=$2`,[accountId,active.id]);
  for(const ref of refs.rows){
    const category=normalizeCoverageCategory(ref.category); if(coverageMap.has(category))continue;
    const owner=selected.find(x=>wordingDescribes(x,{productName:ref.product_name,groupPolicyNumber:ref.group_policy_number,insurer:ref.insurer}))??null; if(!owner)continue;
    const policyName=owner.productName??ref.product_name??"Owned policy"; coverageMap.set(category,{total:null,currency:owner.currency,count:1,policyNames:[policyName],displayAmount:null,derived:true});
  }

  const categories=COVERAGE_CATEGORIES.map((category)=>{const row=coverageMap.get(category);return{category,status:row?"covered":"not_covered",reviewRequired:conflictCategories.has(category),amount:row?.total??null,displayAmount:row?.displayAmount??null,currency:normalizeCurrencyCode(row?.currency,"SGD"),count:row?.count??0,policyNames:row?.policyNames??[],derived:row?.derived??false,fromTable:row?.fromTable??false,parts:row?.parts??null};});

  // Every premium component (plan and rider under one policy number), with
  // the MediSave portion added back where the evidence prints it, and the
  // policies with no premium evidence named -- never the rider alone.
  const premiumSummary=await summarisePremiums(accountId,{id:active.id,display_name:active.display_name,preferred_name:null,relationship:active.relationship});
  const premiumItems=premiumSummary.items;
  const annual=premiumSummary.annual,monthly=premiumSummary.monthly;

  const unmatched=await query<{count:number}>(`SELECT count(*)::int AS count FROM policy_detected_people pd JOIN policies p ON p.id=pd.policy_id AND ${activePredicate("p")} WHERE pd.account_id=$1 AND pd.matched_family_member_id IS NULL AND p.personal_coverage_confirmed=true${await notDismissedClause("pd")}`,[accountId]);
  const quality=await query<{needs_review:number;reference_docs:number;personal_docs:number}>(`SELECT count(*) FILTER(WHERE p.needs_review)::int AS needs_review,count(*) FILTER(WHERE p.personal_coverage_confirmed=false)::int AS reference_docs,count(*) FILTER(WHERE p.personal_coverage_confirmed=true)::int AS personal_docs FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE p.account_id=$1 AND ${activePredicate("p")} AND pm.family_member_id=$2`,[accountId,active.id]);
  const q=quality.rows[0]??{needs_review:0,reference_docs:0,personal_docs:0};
  // Documents nobody has claimed are invisible everywhere else: they are not
  // on anyone's portfolio, so nothing about them appears until someone says
  // whose they are. An uploaded document is evidence the household holds it, so
  // the only thing missing is the name — which is one click to supply.
  const unclaimed=await query<{id:string;original_filename:string;product_name:string|null;insurer:string|null;document_role:string|null}>(
    `SELECT p.id,p.original_filename,p.product_name,p.insurer,p.document_role
       FROM policies p
      WHERE p.account_id=$1 AND p.processing_status='ready' AND ${activePredicate("p")}
        AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)
      ORDER BY p.created_at DESC LIMIT 12`,[accountId]);
  const reminders:{kind:string;title:string;detail:string;href:string}[]=[];
  if(!premiumItems.length)reminders.push({kind:"payment",title:"Add your latest premium record",detail:"Upload a renewal notice or premium receipt so DearPolicy can track whether the cover is still being paid for.",href:"/records"});
  else{const now=Date.now();const staleMonthly=premiumItems.find((p)=>/month/i.test(p.frequency??"")&&now-new Date(p.payment_date||p.period_start||p.created_at).getTime()>45*86400000);const staleAnnual=premiumItems.find((p)=>/year|annual/i.test(p.frequency??"")&&now-new Date(p.payment_date||p.period_start||p.created_at).getTime()>330*86400000);if(staleMonthly)reminders.push({kind:"payment",title:"Upload this month's premium record",detail:`${staleMonthly.product_name??staleMonthly.insurer??"A monthly policy"} has no recent payment record.`,href:"/records"});else if(staleAnnual)reminders.push({kind:"payment",title:"Upload the latest annual renewal",detail:`${staleAnnual.product_name??staleAnnual.insurer??"An annual policy"} may have a newer premium or renewal notice.`,href:"/records"});}
  if(Number(unmatched.rows[0]?.count??0)>0)reminders.push({kind:"family",title:"Match the people we found",detail:"A personalised document contains named insured people that are not linked to a family profile yet.",href:"/policies"});
  if(Number(q.needs_review)>0)reminders.push({kind:"coverage",title:"Review source evidence",detail:`${q.needs_review} document${q.needs_review===1?" needs":"s need"} review. Portfolio cards still show the best-supported binary result, with the review flag inside the evidence view.`,href:"/policies"});
  if(unclaimed.rows.length)reminders.push({kind:"family",title:`Say whose ${unclaimed.rows.length===1?"document this is":"documents these are"}`,
    detail:`${unclaimed.rows.length} uploaded document${unclaimed.rows.length===1?" is":"s are"} not linked to anyone yet, so nothing in ${unclaimed.rows.length===1?"it":"them"} is being used to answer questions.`,href:"/"});
  if(premiumSummary.note&&premiumItems.length)reminders.push({kind:"payment",title:"Some premiums are missing from the total",detail:premiumSummary.note,href:"/records"});
  if(!selected.length)reminders.push({kind:"coverage",title:"Upload personal proof",detail:"DearPolicy needs at least one certificate or policy schedule before it can say what is covered or not covered.",href:"/policies"});

  return NextResponse.json({family:familyResult.rows,activeMember:active,coverages:categories,premiums:{monthly,annual,items:premiumItems,cashAnnual:premiumSummary.cashAnnual,medisaveAnnual:premiumSummary.medisaveAnnual,missing:premiumSummary.missing,complete:premiumSummary.complete,note:premiumSummary.note},reminders,unclaimed:unclaimed.rows,empty:Number(q.personal_docs)===0&&!premiumItems.length,quality:{needsReview:Number(q.needs_review),referenceDocs:Number(q.reference_docs),personalDocs:Number(q.personal_docs)}});
 }catch(error){
  const authResponse=routeErrorResponse(error);
  if(authResponse.status===500)return NextResponse.json({error:"Dashboard error"},{status:500});
  return authResponse;
 }
}
