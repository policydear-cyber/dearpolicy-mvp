import { NextResponse } from "next/server";
import { z } from "zod";
import { devAccountId, query } from "@/lib/db/client";
import { syncInsuredPersonToMember } from "@/lib/policies/linking";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";

export const runtime = "nodejs";

const Schema = z.object({
  policyId: z.string().uuid(),
  // A generic booklet names nobody, so a declaration carries no detected name.
  detectedName: z.string().min(1).optional(),
  familyMemberId: z.string().uuid(),
  declared: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = Schema.parse(await request.json());
    const accountId = devAccountId();
    // Somebody who uploads their own welcome booklet is telling you they hold
    // that cover. The document still cannot prove their personal sum insured,
    // but refusing to admit they own the policy at all is simply wrong.
    if (body.declared || !body.detectedName) {
      await query(
        `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
         VALUES($1,$2,$3,'user_declared',1.0)
         ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='user_declared',confidence=1.0`,
        [body.policyId, body.familyMemberId, accountId],
      );
      return NextResponse.json({ ok: true, declared: true });
    }
    const result = await query<{ extracted_json: PolicyExtraction }>(`SELECT extracted_json FROM policies WHERE id=$1 AND account_id=$2`, [body.policyId, accountId]);
    const extraction = result.rows[0]?.extracted_json;
    if (!extraction) return NextResponse.json({ error: "Policy extraction not found" }, { status: 404 });
    await syncInsuredPersonToMember({ accountId, sourcePolicyId: body.policyId, familyMemberId: body.familyMemberId, detectedName: body.detectedName!, extraction });
    const unmatched = await query<{ count: number }>(`SELECT count(*)::int AS count FROM policy_detected_people WHERE account_id=$1 AND policy_id=$2 AND matched_family_member_id IS NULL`, [accountId, body.policyId]);
    const unverified = await query<{ count: number }>(`SELECT count(*)::int AS count FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND evidence_verified=false`, [accountId, body.policyId]);
    const u = Number(unmatched.rows[0]?.count ?? 0), e = Number(unverified.rows[0]?.count ?? 0);
    const reason = [u ? `${u} named insured ${u === 1 ? "person is" : "people are"} not linked` : null, e ? `${e} coverage item${e === 1 ? "" : "s"} could not be source-verified` : null].filter(Boolean).join("; ");
    await query(`UPDATE policies SET needs_review=$1,review_reason=$2 WHERE id=$3 AND account_id=$4`, [u > 0 || e > 0, reason || null, body.policyId, accountId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Link failed" }, { status: 500 });
  }
}
