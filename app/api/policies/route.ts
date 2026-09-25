import { NextResponse, type NextRequest } from "next/server";
import { isUuid } from "@/lib/db/client";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { userFacingScanResultDetail } from "@/lib/policies/quarantine/ui";
export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

type PolicyRow = {
  id: string; family_member_id: string; insurer: string | null; product_name: string | null; policy_number: string | null;
  group_policy_number: string | null; policy_type: string | null; document_role: string | null; personal_coverage_confirmed: boolean;
  document_authority: number; document_authority_label: string | null; needs_review: boolean; review_reason: string | null; status: string;
  processing_status: string; processing_stage: string; processing_progress: number; processing_message: string | null;
  quarantine_status: string; scan_result_detail: string | null;
  original_filename: string; page_count: number | null; processing_error: string | null;
  linked_people: { id: string; name: string; relationship: string; source: string }[];
  detected_people: { name: string; matchedFamilyMemberId: string | null }[]; created_at: Date;
};

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId");
    if (familyMemberId && !isUuid(familyMemberId)) return NextResponse.json({ policies: [] });

    const policies = await createUserSupabaseClient(ctx.userId, async (client) => {
      const params: unknown[] = [ctx.householdId];
      let memberClause = "";
      if (familyMemberId) {
        params.push(familyMemberId);
        memberClause = ` AND EXISTS (SELECT 1 FROM policy_members x WHERE x.policy_id=p.id AND x.account_id=p.account_id AND x.family_member_id=$${params.length})`;
      }
      const result = await client.query<PolicyRow>(
        `SELECT p.id,p.family_member_id,p.insurer,p.product_name,p.policy_number,p.group_policy_number,p.policy_type,p.document_role,
         p.personal_coverage_confirmed,p.document_authority,p.document_authority_label,p.needs_review,p.review_reason,p.status,
         p.processing_status,p.processing_stage,p.processing_progress,p.processing_message,p.quarantine_status,p.scan_result_detail,p.original_filename,p.page_count,p.processing_error,p.created_at,
         COALESCE((SELECT json_agg(json_build_object('id',f.id,'name',f.display_name,'relationship',f.relationship,'source',pm.source) ORDER BY f.display_name)
           FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id WHERE pm.policy_id=p.id AND pm.account_id=p.account_id),'[]'::json) AS linked_people,
         COALESCE((SELECT json_agg(json_build_object('name',pd.detected_name,'matchedFamilyMemberId',pd.matched_family_member_id) ORDER BY pd.detected_name)
           FROM policy_detected_people pd WHERE pd.policy_id=p.id AND pd.account_id=p.account_id),'[]'::json) AS detected_people
         FROM policies p WHERE p.account_id=$1 AND p.superseded_at IS NULL AND p.lifecycle_state='active' ${memberClause}
         ORDER BY CASE WHEN p.processing_status IN ('queued','extracting','indexing') THEN 0 ELSE 1 END,
                  p.needs_review DESC,p.personal_coverage_confirmed DESC,p.document_authority DESC,p.created_at DESC`,
        params,
      );
      return result.rows;
    });
    // scan_result_detail is operator-facing (it can hold a scanner's analysis
    // id and engine counts); only a fixed, category-level string is returned.
    return NextResponse.json({ policies: policies.map((p) => ({ ...p, scan_result_detail: userFacingScanResultDetail(p) })) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
