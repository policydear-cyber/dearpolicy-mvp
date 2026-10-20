import { NextResponse, type NextRequest } from "next/server";
import { isUuid,query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { scheduleRequestDrain } from "@/lib/jobs/request-drain";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { POLICY_PROCESSING_STOPPED_MESSAGE, userFacingScanResultDetail, type DocumentSafetyMode } from "@/lib/policies/quarantine/ui";
import { malwareScanningIntentionallyDisabled } from "@/lib/scanning/adapter";
import { POLICY_PROCESSING_JOB_TYPE } from "@/lib/rag/processing-queue";
import { USER_ACTIONABLE_PROCESSING_ERRORS } from "@/lib/documents/processing-errors";
import { notDismissedCondition } from "@/lib/policies/name-dismissals";
import { ensurePolicyMemberTierSchema, loadTableTiers, namedTierFor, tierOptionsForDocument } from "@/lib/policies/member-tier";
export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

type PolicyRow = {
  id: string; family_member_id: string; insurer: string | null; product_name: string | null; policy_number: string | null;
  group_policy_number: string | null; policy_type: string | null; document_role: string | null; personal_coverage_confirmed: boolean;
  document_authority: number; document_authority_label: string | null; needs_review: boolean; review_reason: string | null; status: string;
  processing_status: string; processing_stage: string; processing_progress: number; processing_message: string | null;
  quarantine_status: string; scan_result_detail: string | null;
  original_filename: string; page_count: number | null; processing_error: string | null;
  linked_people: { id: string; name: string; relationship: string; source: string; planTier: string | null }[];
  insured_hints: { name: string | null; hint: string | null }[] | null;
  detected_people: { name: string; matchedFamilyMemberId: string | null }[]; created_at: Date;
};

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    scheduleRequestDrain(); // bounded job drain after the response (lib/jobs/request-drain.ts)
    const url = new URL(request.url);
    const familyMemberId = url.searchParams.get("familyMemberId");
    if (familyMemberId && !isUuid(familyMemberId)) return NextResponse.json({ policies: [] });

    await ensurePolicyMemberTierSchema();
    // A name the household said is not in its family stays hidden while nobody is linked to it.
    const notDismissed = await notDismissedCondition("pd");
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
         COALESCE((SELECT json_agg(json_build_object('id',f.id,'name',f.display_name,'relationship',f.relationship,'source',pm.source,'planTier',pm.benefit_tier) ORDER BY f.display_name)
           FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND ${activePredicate("f")}),'[]'::json) AS linked_people,
         COALESCE((SELECT json_agg(json_build_object('name',pd.detected_name,'matchedFamilyMemberId',pd.matched_family_member_id) ORDER BY pd.detected_name)
           FROM policy_detected_people pd WHERE pd.policy_id=p.id AND pd.account_id=p.account_id
             ${notDismissed ? `AND (pd.matched_family_member_id IS NOT NULL OR ${notDismissed})` : ""}),'[]'::json) AS detected_people,
         -- Round 5: the people the document names and the tier each is covered
         -- as (employee / spouse / child), for the "who does this cover" picker.
         CASE WHEN jsonb_typeof(p.extracted_json->'insuredPeople')='array' THEN
           (SELECT json_agg(json_build_object('name',ip->>'name','hint',ip->>'relationshipHint'))
              FROM jsonb_array_elements(p.extracted_json->'insuredPeople') ip) END AS insured_hints
         FROM policies p WHERE p.account_id=$1 AND p.superseded_at IS NULL AND p.lifecycle_state='active' ${memberClause}
         ORDER BY CASE WHEN p.processing_status IN ('queued','extracting','indexing') THEN 0 ELSE 1 END,
                  p.needs_review DESC,p.personal_coverage_confirmed DESC,p.document_authority DESC,p.created_at DESC`,
        params,
      );
      // Overlay the newest household correction per field (append-only log;
      // the policies row itself keeps the AI-extracted original).
      const corrected = await client.query<{ policy_id: string; field_name: string; corrected_value: unknown }>(
        `SELECT DISTINCT ON (policy_id, field_name) policy_id, field_name, corrected_value
           FROM policy_corrections WHERE account_id=$1 ORDER BY policy_id, field_name, created_at DESC`,
        [ctx.householdId],
      );
      const overlays = new Map<string, Record<string, string>>();
      for (const row of corrected.rows) {
        if (typeof row.corrected_value !== "string") continue;
        const entry = overlays.get(row.policy_id) ?? {};
        entry[row.field_name] = row.corrected_value;
        overlays.set(row.policy_id, entry);
      }
      const tableTiers = await loadTableTiers(client, ctx.householdId, result.rows.map((r) => r.id));
      return result.rows.map(({ insured_hints, ...base }) => {
        const columns = tableTiers.get(base.id) ?? [];
        const tierOptions = tierOptionsForDocument({ hints: (insured_hints ?? []).map((h) => h.hint), groupPolicyNumber: base.group_policy_number, policyType: base.policy_type, tableTiers: columns });
        // Who the document names, and as which tier -- used to pre-select.
        const namedTiers = (insured_hints ?? []).filter((h) => h.name).map((h) => ({ name: h.name as string, tier: namedTierFor(h.hint, tierOptions, columns) }));
        const row = { ...base, tier_options: tierOptions, named_tiers: namedTiers };
        const overlay = overlays.get(row.id);
        if (!overlay) return row;
        return {
          ...row,
          insurer: overlay.insurer ?? row.insurer,
          product_name: overlay.product_name ?? row.product_name,
          policy_number: overlay.policy_number ?? row.policy_number,
          policy_type: overlay.policy_type ?? row.policy_type,
        };
      });
    });
    // A document stuck in an in-flight status whose background job died
    // permanently can only be recovered through Re-analyse, so the UI needs
    // to know "stalled" from "being analysed". Jobs are service-only; this
    // reads them on the trusted connection, scoped to the policies the RLS
    // query above already authorised, and the 2-minute grace covers the
    // window between a policy being marked queued and its job row landing.
    const inFlightIds = policies.filter((p) => ["queued", "extracting", "indexing"].includes(p.processing_status)).map((p) => p.id);
    const stalledIds = new Set<string>();
    if (inFlightIds.length) {
      const stalledRows = await query<{ id: string }>(
        `SELECT p.id FROM policies p
          WHERE p.account_id=$1 AND p.id=ANY($2::uuid[]) AND ${activePredicate("p")}
            AND p.updated_at < now() - interval '2 minutes'
            AND NOT EXISTS (SELECT 1 FROM background_jobs j
                  WHERE j.job_type=$3 AND j.idempotency_key=p.id::text
                    AND (j.status IN ('queued','failed_retryable')
                         OR (j.status='processing' AND j.lease_expires_at > now())))`,
        [ctx.householdId, inFlightIds, POLICY_PROCESSING_JOB_TYPE],
      );
      for (const stalledRow of stalledRows.rows) stalledIds.add(stalledRow.id);
    }
    // scan_result_detail is operator-facing (it can hold a scanner's analysis
    // id and engine counts); only a fixed, category-level string is returned.
    // processing_error holds the raw pipeline error for operators; the UI only
    // needs to know that analysis stopped, so a fixed string is returned.
    const documentSafetyMode: DocumentSafetyMode = malwareScanningIntentionallyDisabled() ? "not_scanned_prototype" : "malware_scan";
    return NextResponse.json({
      documentSafetyMode,
      policies: policies.map((p) => ({
        ...p,
        scan_result_detail: userFacingScanResultDetail(p),
        processing_stalled: stalledIds.has(p.id),
        processing_error: p.processing_error ? (USER_ACTIONABLE_PROCESSING_ERRORS.has(p.processing_error) ? p.processing_error : POLICY_PROCESSING_STOPPED_MESSAGE) : null,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
