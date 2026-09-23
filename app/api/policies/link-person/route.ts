import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { syncInsuredPersonToMember } from "@/lib/policies/linking";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Schema = z.object({
  policyId: z.string().uuid(),
  // A generic booklet names nobody, so a declaration carries no detected name.
  detectedName: z.string().min(1).optional(),
  familyMemberId: z.string().uuid(),
  declared: z.boolean().optional(),
});

class PolicyNotFound extends Error {}
class FamilyMemberNotFound extends Error {}

export async function POST(request: NextRequest) {
  try {
    const body = Schema.parse(await request.json().catch(() => ({})));
    const ctx = await requireHouseholdContext(request);

    const result = await createUserSupabaseClient(ctx.userId, async (client) => {
      // Both ids are client-supplied -- authorize each against the caller's
      // own household before touching anything, rather than relying on the
      // account_id column alone to filter a later write. A UUID guessed for
      // another household's policy or family member must fail here, not
      // silently create a cross-household link.
      const policyRow = await client.query<{ id: string; extracted_json: PolicyExtraction | null }>(
        `SELECT id, extracted_json FROM policies WHERE id=$1 AND account_id=$2`,
        [body.policyId, ctx.householdId],
      );
      if (!policyRow.rows[0]) throw new PolicyNotFound();

      const memberRow = await client.query<{ id: string }>(
        `SELECT id FROM family_members WHERE id=$1 AND account_id=$2`,
        [body.familyMemberId, ctx.householdId],
      );
      if (!memberRow.rows[0]) throw new FamilyMemberNotFound();

      // Somebody who uploads their own welcome booklet is telling you they hold
      // that cover. The document still cannot prove their personal sum insured,
      // but refusing to admit they own the policy at all is simply wrong.
      if (body.declared || !body.detectedName) {
        await client.query(
          `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
           VALUES($1,$2,$3,'user_declared',1.0)
           ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='user_declared',confidence=1.0`,
          [body.policyId, body.familyMemberId, ctx.householdId],
        );
        return { ok: true, declared: true };
      }

      const extraction = policyRow.rows[0].extracted_json;
      if (!extraction) return { notFoundExtraction: true };

      await syncInsuredPersonToMember({
        accountId: ctx.householdId,
        sourcePolicyId: body.policyId,
        familyMemberId: body.familyMemberId,
        detectedName: body.detectedName!,
        extraction,
      });
      const unmatched = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM policy_detected_people WHERE account_id=$1 AND policy_id=$2 AND matched_family_member_id IS NULL`,
        [ctx.householdId, body.policyId],
      );
      const unverified = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND evidence_verified=false`,
        [ctx.householdId, body.policyId],
      );
      const u = Number(unmatched.rows[0]?.count ?? 0), e = Number(unverified.rows[0]?.count ?? 0);
      const reason = [u ? `${u} named insured ${u === 1 ? "person is" : "people are"} not linked` : null, e ? `${e} coverage item${e === 1 ? "" : "s"} could not be source-verified` : null].filter(Boolean).join("; ");
      await client.query(`UPDATE policies SET needs_review=$1,review_reason=$2 WHERE id=$3 AND account_id=$4`, [u > 0 || e > 0, reason || null, body.policyId, ctx.householdId]);
      return { ok: true };
    });

    if ("notFoundExtraction" in result) return NextResponse.json({ error: "Policy extraction not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof PolicyNotFound) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (error instanceof FamilyMemberNotFound) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Link failed" }, { status: 500 });
    return authResponse;
  }
}
