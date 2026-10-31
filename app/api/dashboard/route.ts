import { NextResponse } from "next/server";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import type { NextRequest } from "next/server";
import { runAfterResponse } from "@/lib/http/background";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { COVERAGE_CATEGORIES,normalizeCoverageCategory } from "@/lib/insurance";
import { formatMoney, statedCurrencyCode } from "@/lib/format/currency";
import { PERIODIC_CATEGORIES, lineFigure, linePeriodWords, type LinePeriod } from "@/lib/coverage/line-period";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import type { TablePremiumCover } from "@/lib/policies/premium-summary";
import { countedPremiums } from "@/lib/policies/counted-premiums";
import { notDismissedClause } from "@/lib/policies/name-dismissals";
import { categoryRows, confirmedTotalComplete, LUMP_SUM_CATEGORIES, lumpSumParts, personKinds, tableDisplay, tileRows, wordingDescribes, type KnownSum, type TilePart } from "@/lib/coverage/table-figures";
import { maskShownText } from "@/lib/chat/identity-numbers";
import { OWNED_BY_MEMBER, notFullyRead, notFullyReadNote } from "@/lib/policies/not-fully-read";

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
  // A quiet re-fetch from Home (poll=1) never starts a read: the upload's own job is reading it, and a second read would
  // be a second paid call for the same document.
  if(url.searchParams.get("poll")!=="1")runAfterResponse(async()=>{
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
  if(!active)return NextResponse.json({family:[],activeMember:null,coverages:[],premiums:{monthly:0,annual:0,currency:null,totals:[],items:[],missing:[],complete:false,note:null},
    reminders:[{kind:"family",title:"Add your family and upload a policy",detail:"Nothing is on file yet. Add who is in your family, then upload a policy schedule or certificate so DearPolicy can show what it covers and costs.",href:"/"}],
    unclaimed:[],quality:{needsReview:0,referenceDocs:0,personalDocs:0},empty:true});

  const coverageRows=await query<{id:string;policy_id:string;category:string;amount:string|null;currency:string|null;evidence_text:string|null;coverage_product_name:string|null;policy_key:string;document_product_name:string|null;insurer:string|null;group_policy_number:string|null;document_authority:number;effective_date:string|null;created_at:string}>(`SELECT pc.id,p.id::text AS policy_id,pc.category,pc.amount::text,pc.currency,pc.evidence_text,pc.product_name AS coverage_product_name,coalesce(p.policy_number,p.id::text) AS policy_key,p.product_name AS document_product_name,p.insurer,p.group_policy_number,p.document_authority,p.effective_date::text,p.created_at::text FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true`,[accountId,active.id]);
  type Chosen={category:string;amount:number|null;period:LinePeriod|null;currency:string|null;policyKey:string;productName:string|null;insurer:string|null;groupPolicyNumber:string|null;authority:number;effectiveDate:string|null;createdAt:string};
  const byPolicyCategory=new Map<string,Chosen[]>();
  for(const row of coverageRows.rows){
    const category=normalizeCoverageCategory(row.category);
    const key=`${row.policy_key}|${category}`; const list=byPolicyCategory.get(key)??[];
    // A figure paid per day, week or month carries its printed period; a periodic cover's figure with none is not shown
    // (lib/coverage/line-period.ts).
    const figure=lineFigure(category,row.amount==null?null:Number(row.amount),row.evidence_text);
    list.push({category,amount:figure.amount,period:figure.period,currency:statedCurrencyCode(row.currency),policyKey:row.policy_key,productName:row.coverage_product_name??row.document_product_name,insurer:row.insurer,groupPolicyNumber:row.group_policy_number,authority:Number(row.document_authority),effectiveDate:row.effective_date,createdAt:row.created_at});
    byPolicyCategory.set(key,list);
  }
  const selected:Chosen[]=[]; const conflictCategories=new Set<string>();
  for(const [,list] of byPolicyCategory){
    list.sort((a,b)=>b.authority-a.authority+((b.effectiveDate?Date.parse(b.effectiveDate):Date.parse(b.createdAt))-(a.effectiveDate?Date.parse(a.effectiveDate):Date.parse(a.createdAt)))/1e15);
    const top=list[0]; selected.push(top); const sameAuthority=list.filter(x=>x.authority===top.authority); const amounts=new Set(sameAuthority.map(x=>x.amount).filter(x=>x!=null)); if(amounts.size>1)conflictCategories.add(top.category);
  }
  // A currency the document does not state stays unstated (never SGD), and sums are added up only within one stated
  // currency: "120,000" under "All amounts in pounds sterling" is not Singapore dollars, and RM + £ sums give no total.
  // Where they cannot be added, each policy's sum is listed instead.
  const coverageMap=new Map<string,{total:number|null;currency:string|null;count:number;policyNames:string[];displayAmount:string|null;derived:boolean;fromTable?:boolean;parts?:TilePart[];known?:KnownSum|null;planNote?:string|null}>();
  for(const category of new Set(selected.map(x=>x.category))){
    const rows=selected.filter(x=>x.category===category),priced=rows.filter(x=>x.amount!=null);
    const currencies=new Set(priced.map(x=>x.currency));
    const addable=priced.length<=1||(currencies.size===1&&!currencies.has(null));
    // Only lump sums are added up (Critic R246). A figure paid per period, or a limit of a cover that is not a lump sum,
    // is shown with its own period and never added into a total: one line shows its figure, several each show their own
    // (cross-page check, 31 Oct: Disability Income "2,400" a month read as a sum).
    const periodic=PERIODIC_CATEGORIES.has(category)||priced.some(x=>x.period);
    if(!LUMP_SUM_CATEGORIES.has(category)&&(periodic||priced.length>1)){
      const one=rows.length===1?rows[0]:null;
      coverageMap.set(category,{total:null,currency:null,count:rows.length,policyNames:[...new Set(rows.map(x=>x.productName).filter((n):n is string=>!!n))],
        displayAmount:one?.amount!=null?[formatMoney(one.amount,one.currency),linePeriodWords(one.period)].filter(Boolean).join(" "):null,derived:false,
        ...(one?{}:{parts:rows.map(x=>({name:x.productName??"Policy",amount:x.amount,currency:x.currency,period:x.period,...(x.amount==null&&PERIODIC_CATEGORIES.has(category)?{noFigure:true}:{})}))})});
      continue;
    }
    coverageMap.set(category,{total:priced.length&&addable?priced.reduce((t,x)=>t+x.amount!,0):null,currency:currencies.size===1?[...currencies][0]:null,count:rows.length,
      policyNames:[...new Set(rows.map(x=>x.productName).filter((n):n is string=>!!n))],displayAmount:null,derived:false,
      ...(addable?{}:{parts:rows.map(x=>({name:x.productName??"Policy",amount:x.amount,currency:x.currency}))})});
  }

  // The person's benefit table (the same rows the Family page and the chat use): a category its rows name shows the
  // figure the document prints for it, and a category nothing else confirms is covered by those rows. Nothing here is
  // tied to one scheme, product or insurer. Read from stored readings only: no model call.
  let tableCovers:TablePremiumCover[]|null=null;
  let tableDocuments:{id:string;state:string}[]=[];
  try{
    const { benefitTableLive,appDb }=await import("@/lib/benefit-table/app");
    if(await benefitTableLive(accountId)){
      const { tableFor }=await import("@/lib/benefit-table/service");
      const loaded=await tableFor(appDb,accountId);tableDocuments=loaded.documents;
      const person=loaded.table.people.find(p=>p.id===active.id);
      tableCovers=person?.covers??[];
      const held=(person?.covers??[]).map(c=>({coverKey:c.coverKey,...(c.holding?{holding:c.holding}:{}),name:c.cover||c.product,documentId:c.source?.documentId??null,sumInsured:c.confirmation?.status==="corrected"?c.confirmation.sumInsured:c.sumInsured,currency:c.currency}));
      const kinds=personKinds(person?.covers??[],person?.rows??[]);
      for(const category of COVERAGE_CATEGORIES){
        const rows=tileRows(categoryRows(category,person?.rows??[]));
        const lines=selected.filter(x=>x.category===category).map(x=>({name:x.productName??"Policy",amount:x.amount,currency:x.currency,documentIds:coverageRows.rows.filter(r=>r.policy_key===x.policyKey&&normalizeCoverageCategory(r.category)===category).map(r=>r.policy_id)}));
        // A lump-sum category gives each policy's sum and adds them up: a schedule line, and any cover only the table knows
        // (a scheme's sum only its summary prints). A policy whose sum is not read is named with no amount, and there is
        // then no total, never a part sum (DC 27 Oct).
        if(LUMP_SUM_CATEGORIES.has(category)&&(rows.length||lines.length)){
          const {parts,total,known}=lumpSumParts(rows,lines,held,category); const cur=coverageMap.get(category);
          const entry=cur??{total:null,currency:null,count:0,policyNames:[],displayAmount:null,derived:false,fromTable:true};
          entry.total=total; entry.displayAmount=null; entry.parts=parts; entry.known=known; entry.count=parts.length; entry.currency=total!=null?parts.find(p=>p.amount!=null)?.currency??null:null;
          entry.policyNames=[...new Set(parts.map(p=>p.name))]; coverageMap.set(category,entry); continue;
        }
        // A whole-policy kind (travel, savings, investment) is decided by the cover, not by a benefit's name: the same rule
        // for every page (lib/coverage/table-figures personKinds). A held cover with no linked row still counts.
        const kind=kinds.get(category);
        if(kind&&!coverageMap.has(category)){
          coverageMap.set(category,{total:null,currency:null,count:kind.current.length,policyNames:kind.current.slice(0,2),displayAmount:rows.length?tableDisplay(rows):null,derived:false,fromTable:true,planNote:kind.note});
          continue;
        }
        if(!rows.length)continue;
        const cur=coverageMap.get(category); const display=tableDisplay(rows);
        // A confirmed total that leaves out a cover the table gives (a scheme's sum only its summary prints) is part of the
        // cover: the tile says Covered, never a part sum, and the table's own figure is not shown in its place either.
        if(cur&&cur.total!=null){if(!confirmedTotalComplete(rows,lines,held))cur.total=null;continue;}
        if(!cur)coverageMap.set(category,{total:null,currency:statedCurrencyCode(rows.map(r=>(r.figure as {currency?:string|null}).currency).find(Boolean)??null),count:1,policyNames:[...new Set(rows.map(r=>r.product))].slice(0,2),displayAmount:display,derived:false,fromTable:true});
        else if(cur.total==null&&!cur.displayAmount)cur.displayAmount=display;
      }
    }
  }catch(error){console.warn("Benefit table unavailable for the dashboard:",error instanceof Error?error.message:error);}

  // Documents of this household still being read, so Home can fetch again until their cover shows (DC 27 Oct: a new
  // policy changes the tiles). A document is marked ready before its benefit-table reading is stored, and its cover shows
  // only once the household's sections are linked again after that (relink rewrites every link it chooses), so a recent
  // ready document counts until it has a reading AND a link written since, or the household has no section to link (TE
  // F1): a benefit in the whole reading or in a page read again. Strict JSON paths with errors silenced, so a reading of
  // another shape counts as no section and never fails the page (Critic R257). Never a receipt or a letter, which intake never reads; bounded in time, so a document that never gets one stops.
  const benefitLive=await import("@/lib/benefit-table/app").then(m=>m.benefitTableLive(accountId)).catch(()=>false);
  const readingRows=await query<{count:number}>(`SELECT count(*)::int AS count FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL AND (
    (p.processing_status IN ('uploaded','queued','extracting','indexing') AND p.updated_at>now()-interval '30 minutes')
    ${benefitLive?`OR (p.processing_status='ready' AND p.processing_completed_at>now()-interval '10 minutes' AND NOT (coalesce(p.document_role,'')=ANY($2::text[]))
      AND NOT EXISTS(SELECT 1 FROM benefit_readings br WHERE br.policy_id=p.id AND br.account_id=p.account_id AND (
        NOT EXISTS(SELECT 1 FROM benefit_readings b2 WHERE b2.account_id=p.account_id AND (jsonb_path_exists(b2.reading,'strict $.document.benefits[0]','{}',true) OR jsonb_path_exists(b2.reading,'strict $.pages[*].json.benefits[0]','{}',true)))
        OR EXISTS(SELECT 1 FROM benefit_links bl WHERE bl.account_id=p.account_id AND bl.updated_at>=br.read_at))))`:""})`,benefitLive?[accountId,[...NO_COVER_READING_ROLES]]:[accountId]);
  const reading=Number(readingRows.rows[0]?.count??0);

  // Reference wording can expand an OWNED product into its included benefits. It never creates ownership on its own,
  // and it never supplies an amount: the wording's figure is shown only where the person's benefit table prints it.
  const refs=await query<{category:string;product_name:string|null;insurer:string|null;group_policy_number:string|null}>(`SELECT prc.category,prc.product_name,p.insurer,p.group_policy_number FROM policy_reference_coverages prc JOIN policies p ON p.id=prc.policy_id AND ${activePredicate("p")} JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE prc.account_id=$1 AND pm.family_member_id=$2`,[accountId,active.id]);
  for(const ref of refs.rows){
    const category=normalizeCoverageCategory(ref.category); if(coverageMap.has(category))continue;
    const owner=selected.find(x=>wordingDescribes(x,{productName:ref.product_name,groupPolicyNumber:ref.group_policy_number,insurer:ref.insurer}))??null; if(!owner)continue;
    const policyName=owner.productName??ref.product_name??"Owned policy"; coverageMap.set(category,{total:null,currency:owner.currency,count:1,policyNames:[policyName],displayAmount:null,derived:true});
  }

  const categories=COVERAGE_CATEGORIES.map((category)=>{const row=coverageMap.get(category);return{category,status:row?"covered":"not_covered",reviewRequired:conflictCategories.has(category),amount:row?.total??null,displayAmount:row?.displayAmount??null,currency:row?.currency??null,count:row?.count??0,policyNames:row?.policyNames??[],derived:row?.derived??false,fromTable:row?.fromTable??false,parts:row?.parts??null,known:row?.known??null,planNote:row?.planNote??null};});

  // The premiums Home counts, from the same computation Payments shows (lib/policies/counted-premiums.ts).
  const premiums=await countedPremiums(accountId,{id:active.id,display_name:active.display_name,preferred_name:null,relationship:active.relationship},tableCovers);
  const premiumItems=premiums.items;

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
  // A failed or partly read document of this person may hold cover the tiles cannot show: say so, never "not found" alone.
  const notRead=await notFullyRead(accountId,active.id,tableDocuments);
  const notReadNote=notFullyReadNote(notRead,active.display_name,true);
  // Documents with details not matched to their page, in the words Documents uses. One already named as not fully read is not named twice.
  const unconfirmed=Number(q.needs_review)>0?(await query<{id:string}>(`SELECT DISTINCT p.id::text AS id FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL AND ${OWNED_BY_MEMBER("$2")} AND p.needs_review`,[accountId,active.id])).rows.filter((r)=>!notRead.ids.includes(r.id)).length:0;
  if(unconfirmed>0)reminders.push({kind:"coverage",title:unconfirmed===1?"Some details in a document are not confirmed":"Some details in documents are not confirmed",detail:`${unconfirmed===1?"One document has":`${unconfirmed} documents have`} details that could not be matched to the page they came from, so DearPolicy does not use them in answers yet. Documents shows which.`,href:"/policies"});
  if(unclaimed.rows.length)reminders.push({kind:"family",title:`Say whose ${unclaimed.rows.length===1?"document this is":"documents these are"}`,
    detail:`${unclaimed.rows.length} uploaded document${unclaimed.rows.length===1?" is":"s are"} not linked to anyone yet, so nothing in ${unclaimed.rows.length===1?"it":"them"} is being used to answer questions.`,href:"/"});
  if(premiums.note&&premiumItems.length)reminders.push({kind:"payment",title:"Some premiums are missing from the total",detail:premiums.note,href:"/records"});
  if(notReadNote)reminders.push({kind:"coverage",title:notRead.count===1?"A document was not fully read":"Some documents were not fully read",detail:`${notRead.names.slice(0,3).join(", ")}${notRead.count>3?` and ${notRead.count-3} more`:""}: cover in ${notRead.count===1?"it":"them"} may be missing from these tiles. Documents shows which pages and what to do.`,href:"/policies"});
  if(!selected.length)reminders.push({kind:"coverage",title:"Upload personal proof",detail:"DearPolicy needs at least one certificate or policy schedule before it can say what is covered or not covered.",href:"/policies"});

  // ID numbers in document names and notes are masked as chat masks them; ids are left as stored.
  return NextResponse.json(maskShownText({family:familyResult.rows,activeMember:active,coverages:categories,reading,premiums,reminders,notFullyRead:notReadNote,unclaimed:unclaimed.rows,empty:Number(q.personal_docs)===0&&!premiumItems.length,quality:{needsReview:Number(q.needs_review),referenceDocs:Number(q.reference_docs),personalDocs:Number(q.personal_docs)}}));
 }catch(error){
  const authResponse=routeErrorResponse(error);
  if(authResponse.status===500)return NextResponse.json({error:"Dashboard error"},{status:500});
  return authResponse;
 }
}
