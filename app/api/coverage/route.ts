import { NextResponse, type NextRequest } from "next/server";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { isUuid } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { normalizeCoverageCategory } from "@/lib/insurance";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { categoryRows, wordingDescribes } from "@/lib/coverage/table-figures";
import { rowDetail, shortFigure } from "@/lib/benefit-table/headline";
import { maskShownText } from "@/lib/chat/identity-numbers";
import { documentCardTitle } from "@/lib/policies/document-name";
import { notFullyRead, notFullyReadNote } from "@/lib/policies/not-fully-read";

export const runtime="nodejs";
export const ROUTE_AUTH = "household-member" as const;
/** The person's benefit-table rows for this category, each with the figure and page its document prints: the same rows
 * the Family page and the chat use. Empty where the benefit table is off or names nothing for the category. */
async function tableRows(accountId:string,member:string,category:string){
  try{
    const { benefitTableLive,appDb }=await import("@/lib/benefit-table/app");
    if(!(await benefitTableLive(accountId)))return [];
    const { tableFor }=await import("@/lib/benefit-table/service");
    const { table,documents }=await tableFor(appDb,accountId);const person=table.people.find(p=>p.id===member);
    // The source document is named as its Documents card names it, never by a machine-made file name (TE P179 F1).
    const name=(id:string,fallback:string)=>documentCardTitle(documents.find(d=>d.id===id)?.file??{product_name:null,original_filename:fallback});
    return categoryRows(category,person?.rows??[]).map(r=>{const f=shortFigure(r);return{benefit:r.benefit,product:r.product,cover:r.cover,plan:r.plan,figure:f.text,note:f.note,detail:rowDetail(r)||null,document:name(r.source.documentId,r.source.document),page:r.source.page,excerpt:r.source.excerpt};});
  }catch(error){console.warn("Benefit table unavailable for Coverage:",error instanceof Error?error.message:error);return [];}
}
export async function GET(request:NextRequest){
 try{
  const ctx = await requireHouseholdContext(request);
  const url=new URL(request.url);const member=url.searchParams.get("familyMemberId");const category=normalizeCoverageCategory(url.searchParams.get("category")??"");if(!member||!category)return NextResponse.json({error:"familyMemberId and category are required"},{status:400});if(!isUuid(member))return NextResponse.json({error:"Family member not found"},{status:404});
  const accountId = ctx.householdId;
  const payload = await createUserSupabaseClient(ctx.userId, async (client) => {
    const memberRow=await client.query<{display_name:string}>(`SELECT display_name FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,[member,accountId]);if(!memberRow.rows[0])return null;
    const confirmed=await client.query(`SELECT pc.id,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,pc.notes,pc.source_page,pc.evidence_text,pc.evidence_verified,p.id AS policy_id,p.insurer,p.product_name,p.policy_number,p.group_policy_number,p.document_role,p.document_authority_label,p.effective_date::text,p.original_filename FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.category=$3 ORDER BY pc.confirmed DESC,pc.evidence_verified DESC,p.document_authority DESC,p.effective_date DESC NULLS LAST,p.created_at DESC`,[accountId,member,category]);
    const reference=await client.query(`SELECT prc.id,prc.product_name,prc.notes,prc.source_page,p.id AS policy_id,p.insurer,p.product_name AS document_product,p.policy_number,p.group_policy_number,p.document_role,p.original_filename FROM policy_reference_coverages prc JOIN policies p ON p.id=prc.policy_id AND ${activePredicate("p")} JOIN policy_members pm ON pm.policy_id=p.id AND pm.account_id=p.account_id WHERE prc.account_id=$1 AND pm.family_member_id=$2 AND prc.category=$3 ORDER BY p.document_authority DESC,p.created_at DESC`,[accountId,member,category]);
    const owned=await client.query<{id:string;category:string;amount:string|null;currency:string|null;coverage_product_name:string|null;source_page:number|null;evidence_text:string|null;policy_id:string;insurer:string|null;policy_name:string|null;policy_number:string|null;group_policy_number:string|null;document_role:string|null;original_filename:string}>(`SELECT pc.id,pc.category,pc.amount::text,pc.currency,pc.product_name AS coverage_product_name,pc.source_page,pc.evidence_text,p.id AS policy_id,p.insurer,p.product_name AS policy_name,p.policy_number,p.group_policy_number,p.document_role,p.original_filename FROM policy_coverages pc JOIN policies p ON p.id=pc.policy_id AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true`,[accountId,member]);
    const derived:any[]=[];
    if(!confirmed.rows.length&&reference.rows.length){
     for(const ref of reference.rows as any[]){const owner=owned.rows.find(o=>wordingDescribes({productName:o.coverage_product_name??o.policy_name,groupPolicyNumber:o.group_policy_number,insurer:o.insurer},{productName:ref.product_name,groupPolicyNumber:ref.group_policy_number,insurer:ref.insurer}));if(!owner)continue;derived.push({id:`derived:${owner.id}:${ref.id}`,amount:null,currency:owner.currency,display_amount:null,product_name:ref.product_name??owner.coverage_product_name??owner.policy_name,insurer:owner.insurer,policy_number:owner.policy_number,group_policy_number:owner.group_policy_number,ownership_source_page:owner.source_page,ownership_evidence_text:owner.evidence_text,ownership_name:documentCardTitle({product_name:owner.policy_name,original_filename:owner.original_filename,insurer:owner.insurer,document_role:owner.document_role,policy_number:owner.policy_number}),reference_name:documentCardTitle({product_name:ref.document_product,original_filename:ref.original_filename,insurer:ref.insurer,document_role:ref.document_role,policy_number:ref.policy_number}),reference_role:ref.document_role,reference_notes:ref.notes});}
    }
    return {member:{id:member,name:memberRow.rows[0].display_name},category,confirmed:confirmed.rows,derived,reference:reference.rows.map((r:any)=>({...r,document_name:documentCardTitle({product_name:r.document_product,original_filename:r.original_filename,insurer:r.insurer,document_role:r.document_role,policy_number:r.policy_number})})),table:await tableRows(accountId,member,category)};
  });
  if(!payload) return NextResponse.json({error:"Family member not found"},{status:404});
  // A failed or partly read document of this person may hold this cover: "not found" says so (see lib/policies/not-fully-read).
  const notRead=notFullyReadNote(await notFullyRead(accountId,member),payload.member.name);
  // ID numbers in quotes, excerpts and evidence are masked as chat masks them; ids are left as stored.
  return NextResponse.json(maskShownText({...payload,notFullyRead:notRead}));
 }catch(error){return routeErrorResponse(error);}
}
