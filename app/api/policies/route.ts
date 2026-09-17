import { NextResponse } from "next/server";
import { devAccountId, query } from "@/lib/db/client";
export const runtime = "nodejs";

type PolicyRow = {
  id: string; family_member_id: string; insurer: string | null; product_name: string | null; policy_number: string | null;
  group_policy_number: string | null; policy_type: string | null; document_role: string | null; personal_coverage_confirmed: boolean;
  document_authority: number; document_authority_label: string | null; needs_review: boolean; review_reason: string | null; status: string;
  processing_status: string; processing_stage: string; processing_progress: number; processing_message: string | null;
  original_filename: string; page_count: number | null; processing_error: string | null;
  linked_people: { id: string; name: string; relationship: string; source: string }[];
  detected_people: { name: string; matchedFamilyMemberId: string | null }[]; created_at: Date;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId");
    const accountId = devAccountId();
    const params: unknown[] = [accountId];
    let memberClause = "";
    if (familyMemberId) {
      params.push(familyMemberId);
      memberClause = ` AND EXISTS (SELECT 1 FROM policy_members x WHERE x.policy_id=p.id AND x.account_id=p.account_id AND x.family_member_id=$${params.length})`;
    }
    const result = await query<PolicyRow>(
      `SELECT p.id,p.family_member_id,p.insurer,p.product_name,p.policy_number,p.group_policy_number,p.policy_type,p.document_role,
       p.personal_coverage_confirmed,p.document_authority,p.document_authority_label,p.needs_review,p.review_reason,p.status,
       p.processing_status,p.processing_stage,p.processing_progress,p.processing_message,p.original_filename,p.page_count,p.processing_error,p.created_at,
       COALESCE((SELECT json_agg(json_build_object('id',f.id,'name',f.display_name,'relationship',f.relationship,'source',pm.source) ORDER BY f.display_name)
         FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id WHERE pm.policy_id=p.id AND pm.account_id=p.account_id),'[]'::json) AS linked_people,
       COALESCE((SELECT json_agg(json_build_object('name',pd.detected_name,'matchedFamilyMemberId',pd.matched_family_member_id) ORDER BY pd.detected_name)
         FROM policy_detected_people pd WHERE pd.policy_id=p.id AND pd.account_id=p.account_id),'[]'::json) AS detected_people
       FROM policies p WHERE p.account_id=$1 ${memberClause}
       ORDER BY CASE WHEN p.processing_status IN ('queued','extracting','indexing') THEN 0 ELSE 1 END,
                p.needs_review DESC,p.personal_coverage_confirmed DESC,p.document_authority DESC,p.created_at DESC`,
      params,
    );
    return NextResponse.json({ policies: result.rows });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Database error" }, { status: 500 });
  }
}
