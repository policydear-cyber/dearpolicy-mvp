import { NextResponse } from "next/server";
import { devAccountId,query } from "@/lib/db/client";
import { annualisePremium,COVERAGE_CATEGORIES,monthlyEquivalent,normalizeCoverageCategory } from "@/lib/insurance";
import { normalizeCurrencyCode } from "@/lib/format/currency";

export const runtime="nodejs";
type PremiumRow={id:string;policy_id:string|null;family_member_id:string|null;insurer:string|null;product_name:string|null;policy_number:string|null;amount:string;currency:string;frequency:string|null;payment_date:string|null;period_start:string|null;created_at:string};

function canonicalProduct(value:string|null|undefined){
  const v=(value??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  if(/group term life|\bgtl\b/.test(v))return "group term life";
  if(/group personal accident|\bgpa\b/.test(v))return "group personal accident";
  if(/living care plus/.test(v))return "living care plus";
  if(/\bliving care\b/.test(v))return "living care";
  if(/disability income/.test(v))return "disability income";
  if(/outpatient medicare/.test(v))return "outpatient medicare";
  return v;
}
function productFromCategory(category:string){
  if(category==="Death"||category==="Total Permanent Disability"||category==="Hospital Cash")return "group term life";
  if(category==="Personal Accident")return "group personal accident";
  if(category==="Critical Illness")return "living care";
  if(category==="Early Critical Illness")return "living care plus";
  if(category==="Disability Income")return "disability income";
  if(category==="Outpatient")return "outpatient medicare";
  return "";
}

export async function GET(request:Request){
 try{
  const accountId=devAccountId(); const url=new URL(request.url);
  // The person should never have to ask DearPolicy to read a document or
  // check its own work — opening the app is enough. This runs in the
  // background (not awaited) so the dashboard itself is never slowed down
  // by it; readPendingDocuments dedupes concurrent calls on its own.
  void (async()=>{
    try{
      const { pendingDocumentCount,readPendingDocuments }=await import("@/lib/ledger/extract");
      const pending=await pendingDocumentCount(accountId);
      if(!pending)return;
      await readPendingDocuments(accountId);
      const { seedLedger }=await import("@/lib/ledger/store");
      await seedLedger(accountId);
    }catch(error){console.warn("Background coverage-ledger read failed:",error instanceof Error?error.message:error);}
  })();
  const familyResult=await query<{id:string;display_name:string;relationship:string;policy_count:number}>(`SELECT f.id,f.display_name,f.relationship,count(DISTINCT pm.policy_id)::int AS policy_count FROM family_members f LEFT JOIN policy_members pm ON pm.family_member_id=f.id AND pm.account_id=f.account_id WHERE f.account_id=$1 GROUP BY f.id ORDER BY CASE WHEN f.relationship='self' THEN 0 ELSE 1 END,f.created_at`,[accountId]);
  const requested=url.searchParams.get("familyMemberId"); const active=familyResult.rows.find((m)=>m.id===requested)??familyResult.rows[0]??null;
  if(!active)return NextResponse.json({family:[],activeMember:null,coverages:[],premiums:{monthly:0,annual:0,items:[]},reminders:[],unclaimed:[],quality:{needsReview:0,referenceDocs:0,personalDocs:0}});

  const coverageRows=await query<{id:string;category:string;amount:string|null;currency:string|null;coverage_product_name:string|null;policy_key:string;document_product_name:string|null;insurer:string|null;group_policy_number:string|null;document_authority:number;effective_date:string|null;created_at:string}>(`SELECT pc.id,pc.category,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,coalesce(p.policy_number,p.id::text) AS policy_key,p.product_name AS document_product_name,p.insurer,p.group_policy_number,p.document_authority,p.effective_date::text,p.created_at::text FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true`,[accountId,active.id]);
  type Chosen={category:string;amount:number|null;currency:string;policyKey:string;productName:string|null;insurer:string|null;ownedProduct:string;groupPolicyNumber:string|null;authority:number;effectiveDate:string|null;createdAt:string};
  const byPolicyCategory=new Map<string,Chosen[]>();
  for(const row of coverageRows.rows){
    const category=normalizeCoverageCategory(row.category);
    const ownedProduct=canonicalProduct(row.coverage_product_name)||productFromCategory(category);
    const key=`${row.policy_key}|${category}`; const list=byPolicyCategory.get(key)??[];
    list.push({category,amount:row.amount==null?null:Number(row.amount),currency:normalizeCurrencyCode(row.currency,"SGD"),policyKey:row.policy_key,productName:row.coverage_product_name??row.document_product_name,insurer:row.insurer,ownedProduct,groupPolicyNumber:row.group_policy_number,authority:Number(row.document_authority),effectiveDate:row.effective_date,createdAt:row.created_at});
    byPolicyCategory.set(key,list);
  }
  const selected:Chosen[]=[]; const conflictCategories=new Set<string>();
  for(const [,list] of byPolicyCategory){
    list.sort((a,b)=>b.authority-a.authority+((b.effectiveDate?Date.parse(b.effectiveDate):Date.parse(b.createdAt))-(a.effectiveDate?Date.parse(a.effectiveDate):Date.parse(a.createdAt)))/1e15);
    const top=list[0]; selected.push(top); const sameAuthority=list.filter(x=>x.authority===top.authority); const amounts=new Set(sameAuthority.map(x=>x.amount).filter(x=>x!=null)); if(amounts.size>1)conflictCategories.add(top.category);
  }
  const coverageMap=new Map<string,{total:number|null;currency:string;count:number;policyNames:string[];displayAmount:string|null;derived:boolean}>();
  for(const row of selected){
    const cur=coverageMap.get(row.category)??{total:null,currency:row.currency,count:0,policyNames:[],displayAmount:null,derived:false};
    if(row.amount!=null)cur.total=(cur.total??0)+row.amount; cur.count+=1; if(row.productName&&!cur.policyNames.includes(row.productName))cur.policyNames.push(row.productName); coverageMap.set(row.category,cur);
  }

  // Reference wording can expand an OWNED product into its included benefits.
  // It never creates ownership on its own.
  const refs=await query<{category:string;product_name:string|null;insurer:string|null;group_policy_number:string|null}>(`SELECT prc.category,prc.product_name,p.insurer,p.group_policy_number FROM policy_reference_coverages prc JOIN policies p ON p.id=prc.policy_id JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE prc.account_id=$1 AND pm.family_member_id=$2`,[accountId,active.id]);
  const ownedByProduct=new Map<string,Chosen[]>();
  for(const row of selected){if(!row.ownedProduct)continue;const list=ownedByProduct.get(row.ownedProduct)??[];list.push(row);ownedByProduct.set(row.ownedProduct,list);}
  for(const ref of refs.rows){
    const category=normalizeCoverageCategory(ref.category); if(coverageMap.has(category))continue;
    const product=canonicalProduct(ref.product_name)||productFromCategory(category); const owners=ownedByProduct.get(product); if(!owners?.length)continue;
    const owner=owners.find(x=>(x.groupPolicyNumber&&ref.group_policy_number?x.groupPolicyNumber===ref.group_policy_number:true)&&(x.insurer&&ref.insurer?x.insurer.toLowerCase()===ref.insurer.toLowerCase():true))??null; if(!owner)continue; let amount:number|null=null; let displayAmount:string|null=null;
    if(category==="Total Permanent Disability"&&product==="group term life"){
      const death=owners.find(x=>x.category==="Death"&&x.amount!=null)??selected.find(x=>x.ownedProduct===product&&x.category==="Death"&&x.amount!=null); amount=death?.amount??null;
    }
    if(category==="Hospital Cash"&&product==="group term life"&&owners.some(x=>x.groupPolicyNumber==="G007500"||ref.group_policy_number==="G007500")) displayAmount="S$30/day from day 11 · max 30 days";
    const policyName=owner.productName??ref.product_name??"Owned policy"; coverageMap.set(category,{total:amount,currency:owner.currency,count:1,policyNames:[policyName],displayAmount,derived:true});
  }

  const categories=COVERAGE_CATEGORIES.map((category)=>{const row=coverageMap.get(category);return{category,status:row?"covered":"not_covered",reviewRequired:conflictCategories.has(category),amount:row?.total??null,displayAmount:row?.displayAmount??null,currency:normalizeCurrencyCode(row?.currency,"SGD"),count:row?.count??0,policyNames:row?.policyNames??[],derived:row?.derived??false};});

  const premiumResult=await query<PremiumRow>(`SELECT pr.id,pr.policy_id,pr.family_member_id,pr.insurer,pr.product_name,pr.policy_number,pr.amount::text,pr.currency,pr.frequency,pr.payment_date::text,pr.period_start::text,pr.created_at::text FROM premium_records pr WHERE pr.account_id=$1 AND (pr.family_member_id=$2 OR (pr.family_member_id IS NULL AND pr.policy_id IS NOT NULL AND EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=pr.policy_id AND pm.account_id=pr.account_id AND pm.family_member_id=$2))) ORDER BY COALESCE(pr.payment_date,pr.period_start,pr.created_at::date) DESC,pr.created_at DESC`,[accountId,active.id]);
  const latest=new Map<string,PremiumRow>(); for(const row of premiumResult.rows){const key=row.policy_number||row.policy_id||`${row.insurer??""}|${row.product_name??""}`;if(!latest.has(key))latest.set(key,row);}
  const premiumItems=[...latest.values()].map((row)=>({...row,currency:normalizeCurrencyCode(row.currency,"SGD"),shared:row.family_member_id==null,amount:Number(row.amount),annual:annualisePremium(Number(row.amount),row.frequency),monthly:monthlyEquivalent(Number(row.amount),row.frequency)}));
  const annual=premiumItems.reduce((s,r)=>s+r.annual,0),monthly=premiumItems.reduce((s,r)=>s+r.monthly,0);

  const unmatched=await query<{count:number}>(`SELECT count(*)::int AS count FROM policy_detected_people pd JOIN policies p ON p.id=pd.policy_id WHERE pd.account_id=$1 AND pd.matched_family_member_id IS NULL AND p.personal_coverage_confirmed=true`,[accountId]);
  const quality=await query<{needs_review:number;reference_docs:number;personal_docs:number}>(`SELECT count(*) FILTER(WHERE p.needs_review)::int AS needs_review,count(*) FILTER(WHERE p.personal_coverage_confirmed=false)::int AS reference_docs,count(*) FILTER(WHERE p.personal_coverage_confirmed=true)::int AS personal_docs FROM policies p JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE p.account_id=$1 AND pm.family_member_id=$2`,[accountId,active.id]);
  const q=quality.rows[0]??{needs_review:0,reference_docs:0,personal_docs:0};
  // Documents nobody has claimed are invisible everywhere else: they are not
  // on anyone's portfolio, so nothing about them appears until someone says
  // whose they are. An uploaded document is evidence the household holds it, so
  // the only thing missing is the name — which is one click to supply.
  const unclaimed=await query<{id:string;original_filename:string;product_name:string|null;insurer:string|null;document_role:string|null}>(
    `SELECT p.id,p.original_filename,p.product_name,p.insurer,p.document_role
       FROM policies p
      WHERE p.account_id=$1 AND p.processing_status='ready'
        AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)
      ORDER BY p.created_at DESC LIMIT 12`,[accountId]);
  const reminders:{kind:string;title:string;detail:string;href:string}[]=[];
  if(!premiumItems.length)reminders.push({kind:"payment",title:"Add your latest premium record",detail:"Upload a renewal notice or premium receipt so DearPolicy can track whether the cover is still being paid for.",href:"/records"});
  else{const now=Date.now();const staleMonthly=premiumItems.find((p)=>/month/i.test(p.frequency??"")&&now-new Date(p.payment_date||p.period_start||p.created_at).getTime()>45*86400000);const staleAnnual=premiumItems.find((p)=>/year|annual/i.test(p.frequency??"")&&now-new Date(p.payment_date||p.period_start||p.created_at).getTime()>330*86400000);if(staleMonthly)reminders.push({kind:"payment",title:"Upload this month's premium record",detail:`${staleMonthly.product_name??staleMonthly.insurer??"A monthly policy"} has no recent payment record.`,href:"/records"});else if(staleAnnual)reminders.push({kind:"payment",title:"Upload the latest annual renewal",detail:`${staleAnnual.product_name??staleAnnual.insurer??"An annual policy"} may have a newer premium or renewal notice.`,href:"/records"});}
  if(Number(unmatched.rows[0]?.count??0)>0)reminders.push({kind:"family",title:"Match the people we found",detail:"A personalised document contains named insured people that are not linked to a family profile yet.",href:"/policies"});
  if(Number(q.needs_review)>0)reminders.push({kind:"coverage",title:"Review source evidence",detail:`${q.needs_review} document${q.needs_review===1?" needs":"s need"} review. Portfolio cards still show the best-supported binary result, with the review flag inside the evidence view.`,href:"/policies"});
  if(unclaimed.rows.length)reminders.push({kind:"family",title:`Say whose ${unclaimed.rows.length===1?"document this is":"documents these are"}`,
    detail:`${unclaimed.rows.length} uploaded document${unclaimed.rows.length===1?" is":"s are"} not linked to anyone yet, so nothing in ${unclaimed.rows.length===1?"it":"them"} is being used to answer questions.`,href:"/"});
  if(!selected.length)reminders.push({kind:"coverage",title:"Upload personal proof",detail:"DearPolicy needs at least one certificate or policy schedule before it can say what is covered or not covered.",href:"/policies"});

  return NextResponse.json({family:familyResult.rows,activeMember:active,coverages:categories,premiums:{monthly,annual,items:premiumItems},reminders,unclaimed:unclaimed.rows,quality:{needsReview:Number(q.needs_review),referenceDocs:Number(q.reference_docs),personalDocs:Number(q.personal_docs)}});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Dashboard error"},{status:500});}
}
