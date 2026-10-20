import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { syncInsuredPersonToMember } from "@/lib/policies/linking";
import type { PolicyExtraction } from "@/lib/ai/extract-policy";
import { rebuildForAddedPeople, saveDocumentCoverage } from "@/lib/policies/coverage-assignments";
import { exclusionsReady } from "@/lib/policies/member-exclusions";
import { dismissalsReady, nameKeySql, notDismissedClause } from "@/lib/policies/name-dismissals";
import { ensurePolicyMemberTierSchema, loadTableTiers, normalizePlanTier, tierOptionsForDocument } from "@/lib/policies/member-tier";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

const Schema = z.object({
  policyId: z.string().uuid(),
  // A generic booklet names nobody, so a declaration carries no detected name.
  detectedName: z.string().min(1).optional(),
  familyMemberId: z.string().uuid().optional(),
  declared: z.boolean().optional(),
  // "Not in my family": the detected name is nobody in this household.
  notFamily: z.literal(true).optional(),
}).refine((b) => b.notFamily ? !!b.detectedName && !b.familyMemberId && !b.declared : !!b.familyMemberId, { message: "Choose a family member, or send notFamily with the detected name only." });

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
class NameNotFound extends Error {}
class NameLinked extends Error {}

/** Review state is server-derived and server-written (browser sessions cannot
 * update policies' verification columns), so it runs on the service connection
 * after the household's own transaction has authorised and saved the change.
 * A name the household said is not theirs is not waiting to be linked. */
async function refreshReviewState(accountId: string, policyId: string, unmatchedClause: string) {
  const unmatched = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM policy_detected_people pd WHERE pd.account_id=$1 AND pd.policy_id=$2 AND pd.matched_family_member_id IS NULL${unmatchedClause}`,
    [accountId, policyId],
  );
  const unverified = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM policy_coverages WHERE account_id=$1 AND policy_id=$2 AND evidence_verified=false`,
    [accountId, policyId],
  );
  const u = Number(unmatched.rows[0]?.count ?? 0), e = Number(unverified.rows[0]?.count ?? 0);
  const reason = [u ? `${u} named insured ${u === 1 ? "person is" : "people are"} not linked` : null, e ? `${e} coverage item${e === 1 ? "" : "s"} could not be source-verified` : null].filter(Boolean).join("; ");
  await query(`UPDATE policies SET needs_review=$1,review_reason=$2 WHERE id=$3 AND account_id=$4`, [u > 0 || e > 0, reason || null, policyId, accountId]);
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.json().catch(() => ({}));
    if (raw && typeof raw === "object" && Array.isArray((raw as { assignments?: unknown }).assignments)) {
      const assignment = AssignmentsSchema.parse(raw);
      const assignCtx = await requireHouseholdContext(request);
      await ensurePolicyMemberTierSchema();
      // Authorise the document and every person against this household
      // through the RLS-scoped client; the save itself is one transaction.
      const checked = await createUserSupabaseClient(assignCtx.userId, async (client) => {
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
        return {
          ownerId: policyRow.rows[0].family_member_id,
          extraction: policyRow.rows[0].extracted_json,
          assignments: ids.map((id) => ({ familyMemberId: id, tier: normalizePlanTier(assignment.assignments.find((a) => a.familyMemberId === id)?.planTier, offered) })),
        };
      });
      const saved = await saveDocumentCoverage({ accountId: assignCtx.householdId, policyId: assignment.policyId, ownerId: checked.ownerId, assignments: checked.assignments });
      // Someone ticked again gets back what was read from the document for them.
      await rebuildForAddedPeople({ accountId: assignCtx.householdId, policyId: assignment.policyId, added: saved.added, extraction: checked.extraction })
        .catch((error) => console.warn("Rebuilding cover for re-linked people failed:", error instanceof Error ? error.message : error));
      return NextResponse.json({ ok: true, assigned: saved.assigned, removed: saved.removed, linked: saved.linked });
    }
    const body = Schema.parse(raw);
    const ctx = await requireHouseholdContext(request);
    const remembersRemovals = await exclusionsReady();
    const remembersDismissals = await dismissalsReady();
    const unmatchedClause = await notDismissedClause();

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

      if (body.notFamily) {
        const name = body.detectedName!;
        const named = await client.query<{ matched: string | null }>(
          `SELECT matched_family_member_id::text AS matched FROM policy_detected_people WHERE account_id=$1 AND policy_id=$2 AND ${nameKeySql("detected_name")}=${nameKeySql("$3")}`,
          [ctx.householdId, body.policyId, name],
        );
        if (!named.rows[0]) throw new NameNotFound();
        // A name already linked to someone is taken off them in "Who does this cover", not here.
        if (named.rows.some((r) => r.matched)) throw new NameLinked();
        // Before sql/detected-name-dismissals.sql is applied the answer cannot be
        // kept; the page remembers it in the browser and nothing here changes.
        if (!remembersDismissals) return { ok: true, notFamily: true, remembered: false };
        await client.query(
          `INSERT INTO policy_name_dismissals(policy_id,account_id,name_key,detected_name) VALUES($1,$2,${nameKeySql("$3")},$3)
           ON CONFLICT(policy_id,name_key) DO NOTHING`,
          [body.policyId, ctx.householdId, name],
        );
        return { ok: true, notFamily: true, remembered: true, refresh: true };
      }

      const memberRow = await client.query<{ id: string }>(
        `SELECT id FROM family_members WHERE id=$1 AND account_id=$2 AND ${activePredicate()}`,
        [body.familyMemberId, ctx.householdId],
      );
      if (!memberRow.rows[0]) throw new FamilyMemberNotFound();
      // Linking a name to a person takes back an earlier "Not in my family".
      if (remembersDismissals && body.detectedName) {
        await client.query(`DELETE FROM policy_name_dismissals WHERE policy_id=$1 AND account_id=$2 AND name_key=${nameKeySql("$3")}`, [body.policyId, ctx.householdId, body.detectedName]);
      }
      // The household is linking this person by hand: forget any earlier removal.
      if (remembersRemovals) {
        await client.query(`DELETE FROM policy_member_exclusions WHERE policy_id=$1 AND account_id=$2 AND family_member_id=$3`, [body.policyId, ctx.householdId, body.familyMemberId]);
      }

      // Somebody who uploads their own welcome booklet is telling you they hold
      // that cover. The document still cannot prove their personal sum insured,
      // but refusing to admit they own the policy at all is simply wrong.
      if (body.declared || !body.detectedName) {
        await client.query(
          `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
           VALUES($1,$2,$3,'user_declared',1.0)
           ON CONFLICT(policy_id,family_member_id) DO UPDATE SET source='user_declared',confidence=1.0`,
          [body.policyId, body.familyMemberId!, ctx.householdId],
        );
        return { ok: true, declared: true };
      }

      const extraction = policyRow.rows[0].extracted_json;
      if (!extraction) return { notFoundExtraction: true };

      await syncInsuredPersonToMember({
        accountId: ctx.householdId,
        sourcePolicyId: body.policyId,
        familyMemberId: body.familyMemberId!,
        detectedName: body.detectedName!,
        extraction,
        householdChoice: true,
      });
      return { ok: true, refresh: true };
    });

    if ("notFoundExtraction" in result) return NextResponse.json({ error: "Policy extraction not found" }, { status: 404 });
    if ("refresh" in result) {
      const { refresh: _refresh, ...shown } = result;
      await refreshReviewState(ctx.householdId, body.policyId, unmatchedClause);
      return NextResponse.json(shown);
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid request", issues: error.issues }, { status: 400 });
    if (error instanceof PolicyNotFound) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    if (error instanceof NameLinked) return NextResponse.json({ error: "That name is linked to someone in your family. Change who this document covers instead." }, { status: 409 });
    if (error instanceof NameNotFound) return NextResponse.json({ error: "That name isn't on this document" }, { status: 404 });
    if (error instanceof FamilyMemberNotFound) return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    if (error instanceof NobodyLeft) return NextResponse.json({ error: "A document has to cover at least one person. Choose who it covers (add them on the Family page first if they aren't listed), or delete the document if it isn't your family's." }, { status: 409 });
    const authResponse = routeErrorResponse(error);
    if (authResponse.status === 500) return NextResponse.json({ error: "Link failed" }, { status: 500 });
    return authResponse;
  }
}
