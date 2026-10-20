import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { syncInsuredPersonToMember } from "@/lib/policies/linking";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { ensurePolicyMemberTierSchema, loadTableTiers, normalizePlanTier, tierOptionsForDocument } from "@/lib/policies/member-tier";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Schema = z.object({
  policyId: z.string().uuid(),
  // A generic booklet names nobody, so a declaration carries no detected name.
  detectedName: z.string().min(1).optional(),
  familyMemberId: z.string().uuid(),
  declared: z.boolean().optional(),
});

/** Round 5 (item 3): set everyone a document covers in one request, each
 * with the cover tier they hold when the document has tiers. Everyone the
 * picker shows as covered and the household left out now is unlinked,
 * whatever made the link (a name the reading matched, the upload profile, an
 * older build's backfill): the household's word is what the picker promises
 * to save. Links to matching wording (scheme_reference_match) are not shown
 * as covered by the picker, so they are left alone. */
const AssignmentsSchema = z.object({
  policyId: z.string().uuid(),
  assignments: z.array(z.object({ familyMemberId: z.string().uuid(), planTier: z.string().max(60).nullable().optional() })).max(30),
});

class PolicyNotFound extends Error {}
class FamilyMemberNotFound extends Error {}
class NobodyLeft extends Error {}

/** Links the "who does this cover" picker does not show as covered. */
const NOT_SHOWN_AS_COVERED = ["scheme_reference_match"];

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => ({}));
    if (raw && typeof raw === "object" && Array.isArray((raw as { assignments?: unknown }).assignments)) {
      const assignment = AssignmentsSchema.parse(raw);
      const assignCtx = await requireHouseholdContext(request);
      await ensurePolicyMemberTierSchema();
      const assigned = await createUserSupabaseClient(assignCtx.userId, async (client) => {
        const policyRow = await client.query<{ id: string; family_member_id: string; extracted_json: PolicyExtraction | null; group_policy_number: string | null; policy_type: string | null }>(
          `SELECT id, family_member_id, extracted_json, group_policy_number, policy_type FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
          [assignment.policyId, assignCtx.householdId],
        );
        if (!policyRow.rows[0]) throw new PolicyNotFound();
        const ids = [...new Set(assignment.assignments.map((a) => a.familyMemberId))];
        // policies.family_member_id (the upload profile) is required, and the
        // chat treats that person as covered by the document, so a document
        // cannot be left covering nobody: it would still answer for them.
        if (!ids.length) throw new NobodyLeft();
        const members = await client.query<{ id: string }>(
          `SELECT id FROM family_members WHERE id=ANY($1::uuid[]) AND account_id=$2 AND ${activePredicate()}`,
          [ids, assignCtx.householdId],
        );
        if (members.rows.length !== ids.length) throw new FamilyMemberNotFound();
        const people = policyRow.rows[0].extracted_json?.insuredPeople;
        const tableTiers = (await loadTableTiers(client, assignCtx.householdId, [assignment.policyId])).get(assignment.policyId) ?? [];
        const offered = tierOptionsForDocument({ hints: Array.isArray(people) ? people.map((p) => p?.relationshipHint) : [], groupPolicyNumber: policyRow.rows[0].group_policy_number, policyType: policyRow.rows[0].policy_type, tableTiers });
        for (const id of ids) {
          const tier = normalizePlanTier(assignment.assignments.find((a) => a.familyMemberId === id)?.planTier, offered);
          await client.query(
            `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier)
             VALUES($1,$2,$3,'user_declared',1.0,$4)
             ON CONFLICT(policy_id,family_member_id) DO UPDATE SET benefit_tier=EXCLUDED.benefit_tier`,
            [assignment.policyId, id, assignCtx.householdId, tier],
          );
        }
        const removed = (await client.query<{ family_member_id: string }>(
          `DELETE FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($4::text[])) AND NOT (family_member_id=ANY($3::uuid[]))
           RETURNING family_member_id::text AS family_member_id`,
          [assignment.policyId, assignCtx.householdId, ids, NOT_SHOWN_AS_COVERED],
        )).rows.map((r) => r.family_member_id);
        if (removed.length) {
          // What was read from this document for the people just removed goes
          // with the link, so no screen or answer keeps using their cover. The
          // household's own ledger entries (origin 'person') are kept;
          // policy_coverages is cleared below (server-written).
          await client.query(`DELETE FROM premium_records WHERE account_id=$1 AND source_document_id=$2 AND family_member_id=ANY($3::uuid[])`, [assignCtx.householdId, assignment.policyId, removed]);
          await client.query(`UPDATE policy_detected_people SET matched_family_member_id=NULL WHERE account_id=$1 AND policy_id=$2 AND matched_family_member_id=ANY($3::uuid[])`, [assignCtx.householdId, assignment.policyId, removed]);
          if ((await client.query<{ t: string | null }>("SELECT to_regclass('public.coverage_rules')::text AS t")).rows[0]?.t) {
            await client.query(`DELETE FROM coverage_rules WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[]) AND origin<>'person'`, [assignCtx.householdId, assignment.policyId, removed]);
          }
        }
        const linked = (await client.query<{ family_member_id: string }>(
          `SELECT family_member_id::text AS family_member_id FROM policy_members WHERE policy_id=$1 AND account_id=$2 AND NOT (source=ANY($3::text[])) ORDER BY family_member_id`,
          [assignment.policyId, assignCtx.householdId, NOT_SHOWN_AS_COVERED],
        )).rows.map((r) => r.family_member_id);
        return { assigned: ids.length, removed, linked, moveOwnerTo: ids.includes(policyRow.rows[0].family_member_id) ? null : ids[0] };
      });
      // Server-written columns, after the household's change has committed
      // (both ids were authorised against this household above).
      if (assigned.removed.length) {
        await query(`DELETE FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND family_member_id=ANY($3::uuid[])`, [assignCtx.householdId, assignment.policyId, assigned.removed]);
      }
      // The upload profile moves to someone the document still covers.
      if (assigned.moveOwnerTo) {
        await query(`UPDATE policies SET family_member_id=$3,updated_at=now() WHERE id=$1 AND account_id=$2`, [assignment.policyId, assignCtx.householdId, assigned.moveOwnerTo]);
      }
      return NextResponse.json({ ok: true, assigned: assigned.assigned, removed: assigned.removed, linked: assigned.linked });
    }
    const body = Schema.parse(raw);
    const ctx = await requireHouseholdContext(request);

    const result = await createUserSupabaseClient(ctx.userId, async (client) => {
      // Both ids are client-supplied -- authorize each against the caller's
      // own household before touching anything, rather than relying on the
      // account_id column alone to filter a later write. A UUID guessed for
      // another household's policy or family member must fail here, not
      // silently create a cross-household link.
      const policyRow = await client.query<{ id: string; extracted_json: PolicyExtraction | null }>(
        `SELECT id, extracted_json FROM policies WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
        [body.policyId, ctx.householdId],
      );
      if (!policyRow.rows[0]) throw new PolicyNotFound();

      const memberRow = await client.query<{ id: string }>(
        `SELECT id FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
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
      // Review state is server-derived and server-written (browser sessions
      // cannot update policies' verification columns).
      await query(`UPDATE policies SET needs_review=$1,review_reason=$2 WHERE id=$3 AND account_id=$4`, [u > 0 || e > 0, reason || null, body.policyId, ctx.householdId]);
      return { ok: true };
    });

    if ("notFoundExtraction" in result) return NextResponse.json({ error: "Policy extraction not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof PolicyNotFound) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (error instanceof FamilyMemberNotFound) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    if (error instanceof NobodyLeft) return NextResponse.json({ error: "A document has to cover at least one person. Choose who it covers, or delete it if it isn't your family's." }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Link failed" }, { status: 500 });
    return authResponse;
  }
}
