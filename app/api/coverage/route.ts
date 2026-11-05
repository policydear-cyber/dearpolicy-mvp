import { NextResponse, type NextRequest } from "next/server";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { lineFigure } from "@/lib/coverage/line-period";
import { isUuid } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { asBenefitLine } from "@/lib/coverage/benefit-sum-line";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { categoryRows, personKinds, wordingDescribes, type KindEntry } from "@/lib/coverage/table-figures";
import { rowDetail, shortFigure } from "@/lib/benefit-table/headline";
import { maskShownText } from "@/lib/chat/identity-numbers";
import { documentCardTitle } from "@/lib/policies/document-name";
import { notFullyRead, notFullyReadNote } from "@/lib/policies/not-fully-read";
import { formatMoney } from "@/lib/format/currency";
import { coverVerdict, provenLine } from "@/lib/coverage/cover-verdict";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
/** The person's benefit-table rows for this category, each with the figure and page its document prints: the same rows
 * the Family page and the chat use. Empty where the benefit table is off or names nothing for the category. */
async function tableRows(accountId:string,member:string,category:string,seen:{documents:{id:string;state:string}[];kind?:KindEntry|null}={documents:[]}){
  try{
    const { benefitTableLive,appDb }=await import("@/lib/benefit-table/app");
    if(!(await benefitTableLive(accountId)))return [];
    const { tableFor }=await import("@/lib/benefit-table/service");
    const { table,documents }=await tableFor(appDb,accountId);seen.documents=documents;const person=table.people.find(p=>p.id===member);
    // The whole-policy kind (travel, savings, investment) by the rule Home uses, so both pages say the same.
    seen.kind=personKinds(person?.covers??[],person?.rows??[]).get(category)??null;
    // The source document is named as its Documents card names it, never by a machine-made file name (TE P179 F1).
    const name=(id:string,fallback:string)=>documentCardTitle(documents.find(d=>d.id===id)?.file??{product_name:null,original_filename:fallback});
    // A document that also covers other people in the household (a group certificate, a family plan): who else, and this
    // person's own sum on it, so a figure it prints for someone else is not read as theirs (lib/policies/shared-policy.ts).
    const holders=(documentId:string)=>table.people.filter(p=>p.covers.some(c=>c.source?.documentId===documentId));
    // One sum only when this person's covers on the document carry one sum (after corrections) in one currency: a base plan
    // and a rider on one certificate give no one "own sum" (Critic M1).
    const ownSum=(documentId:string)=>{const sums=new Set((person?.covers??[]).filter(x=>x.source?.documentId===documentId).map(x=>{const sum=x.confirmation?.status==="corrected"?x.confirmation.sumInsured:x.sumInsured;return sum!=null?formatMoney(sum,x.currency):null;}).filter((x):x is string=>!!x));
      return sums.size===1?[...sums][0]:null;};
    return categoryRows(category,person?.rows??[]).map(r=>{const f=shortFigure(r);const others=holders(r.source.documentId).filter(p=>p.id!==member).map(p=>p.name);
      return{benefit:r.benefit,product:r.product,cover:r.cover,plan:r.plan,figure:f.text,note:f.note,detail:rowDetail(r)||null,document:name(r.source.documentId,r.source.document),page:r.source.page,excerpt:r.source.excerpt,
        shared:others.length?{others,ownSum:ownSum(r.source.documentId)}:null};});
  }catch(error){console.warn("Benefit table unavailable for Coverage:",error instanceof Error?error.message:error);return [];}
}
export async function GET(request:NextRequest){
 try{
  const ctx = await requireHouseholdContext(request);
  const url=new URL(request.url);const member=url.searchParams.get("familyMemberId");const category=normalizeCoverageCategory(url.searchParams.get("category")??"");if(!member||!category)return NextResponse.json({error:"familyMemberId and category are required"},{status:400});if(!isUuid(member))return NextResponse.json({error:"Family member not found"},{status:404});
  const accountId = ctx.householdId;
  const seen:{documents:{id:string;state:string}[];kind?:KindEntry|null}={documents:[]};
  const payload = await createUserSupabaseClient(ctx.userId, async (client) => {
    const memberRow=await client.query<{display_name:string}>(`SELECT display_name FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,[member,accountId]);if(!memberRow.rows[0])return null;
    const confirmed=await client.query(`SELECT pc.id,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,pc.notes,pc.source_page,pc.evidence_text,pc.evidence_verified,pc.confirmed,p.id AS policy_id,p.insurer,p.product_name,p.policy_number,p.group_policy_number,p.document_role,p.document_authority_label,p.effective_date::text,p.original_filename FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.category=$3 ORDER BY pc.confirmed DESC,pc.evidence_verified DESC,p.document_authority DESC,p.effective_date DESC NULLS LAST,p.created_at DESC`,[accountId,member,category]);
    const reference=await client.query(`SELECT prc.id,prc.product_name,prc.notes,prc.source_page,p.id AS policy_id,p.insurer,p.product_name AS document_product,p.policy_number,p.group_policy_number,p.document_role,p.original_filename FROM policy_reference_coverages prc JOIN policies p ON p.id=prc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE prc.account_id=$1 AND pm.family_member_id=$2 AND prc.category=$3 ORDER BY p.document_authority DESC,p.created_at DESC`,[accountId,member,category]);
    const owned=await client.query<{id:string;category:string;amount:string|null;currency:string|null;coverage_product_name:string|null;source_page:number|null;evidence_text:string|null;policy_id:string;insurer:string|null;policy_name:string|null;policy_number:string|null;group_policy_number:string|null;document_role:string|null;original_filename:string}>(`SELECT pc.id,pc.category,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,pc.source_page,pc.evidence_text,p.id AS policy_id,p.insurer,p.product_name AS policy_name,p.policy_number,p.group_policy_number,p.document_role,p.original_filename FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true`,[accountId,member]);
    // A line whose own label names a premium, waiver, fund or surrender value or the person's own share is no benefit sum
    // (lib/coverage/benefit-sum-line.ts): it is not this cover's amount, nor the owner a wording is read for. A cover whose
    // figure may be a waived premium or a value stays, with no figure.
    const benefitLines=<T extends {evidence_text:string|null;amount:string|null}>(rows:T[])=>rows.flatMap(r=>{const line=asBenefitLine(r,r.evidence_text);return line?[line]:[];});
    const confirmedRows=benefitLines(confirmed.rows as {evidence_text:string|null;amount:string|null}[]),ownedRows=benefitLines(owned.rows);
    const derived:any[]=[];
    // Home's rule (lib/coverage/cover-verdict.ts): a plan's wording adds its benefit only where no proven line gives the cover.
    if(!confirmedRows.some(r=>provenLine(r as {confirmed?:boolean|null;evidence_verified?:boolean|null}))&&reference.rows.length){
     for(const ref of reference.rows as any[]){const owner=ownedRows.find(o=>wordingDescribes({productName:o.coverage_product_name??o.policy_name,groupPolicyNumber:o.group_policy_number,insurer:o.insurer},{productName:ref.product_name,groupPolicyNumber:ref.group_policy_number,insurer:ref.insurer}));if(!owner)continue;derived.push({id:`derived:${owner.id}:${ref.id}`,amount:null,currency:owner.currency,display_amount:null,product_name:ref.product_name??owner.coverage_product_name??owner.policy_name,insurer:owner.insurer,policy_number:owner.policy_number,group_policy_number:owner.group_policy_number,ownership_source_page:owner.source_page,ownership_evidence_text:owner.evidence_text,ownership_name:documentCardTitle({product_name:owner.policy_name,original_filename:owner.original_filename,insurer:owner.insurer,document_role:owner.document_role,policy_number:owner.policy_number}),reference_name:documentCardTitle({product_name:ref.document_product,original_filename:ref.original_filename,insurer:ref.insurer,document_role:ref.document_role,policy_number:ref.policy_number}),reference_role:ref.document_role,reference_notes:ref.notes});}
    }
    return {member:{id:member,name:memberRow.rows[0].display_name},category,confirmed:confirmedRows,derived,reference:reference.rows.map((r:any)=>({...r,document_name:documentCardTitle({product_name:r.document_product,original_filename:r.original_filename,insurer:r.insurer,document_role:r.document_role,policy_number:r.policy_number})})),table:await tableRows(accountId,member,category,seen)};
  });
  if(!payload) return NextResponse.json({error:"Family member not found"},{status:404});
  // A failed or partly read document of this person may hold this cover: "not found" says so (see lib/policies/not-fully-read).
  const notRead=notFullyReadNote(await notFullyRead(accountId,member,seen.documents),payload.member.name);
  // ID numbers in quotes, excerpts and evidence are masked as chat masks them; ids are left as stored.
  // A figure paid per period carries its printed period; a periodic cover's figure with none is not shown (lib/coverage/line-period.ts).
  const confirmedShown=(payload.confirmed as {amount:string|null;evidence_text:string|null}[]).map(r=>{const f=lineFigure(category,r.amount==null?null:Number(r.amount),r.evidence_text);return{...r,amount:f.amount==null?null:r.amount,period:f.period};});
  // The same verdict Home's tile gives (lib/coverage/cover-verdict.ts). A line not yet matched to its page, or wording with no
  // plan of the person's that it describes, is "on file, please confirm": listed without its amount, never "Covered".
  const proven=(payload.confirmed as {confirmed?:boolean|null;evidence_verified?:boolean|null}[]).filter(provenLine).length;
  const verdict=coverVerdict({proven:proven+payload.derived.length+payload.table.length+(seen.kind?.current?.length?1:0),
    unmatchedLines:payload.confirmed.length-proven,referenceOnly:payload.derived.length?0:payload.reference.length});
  const shownRows=confirmedShown.map(r=>provenLine(r as {confirmed?:boolean|null;evidence_verified?:boolean|null})?r:{...r,amount:null,period:null});
  return NextResponse.json(maskShownText({...payload,confirmed:shownRows,verdict,kind:seen.kind??null,notFullyRead:notRead}));
 }catch(error){return routeErrorResponse(error);}
}
