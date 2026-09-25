/**
 * Checkpoint 14g, Stage 9/9: household deletion and cleanup -- the final
 * stage of the 9-stage journey.
 *
 * Mirrors scripts/household-deletion-regressions.ts's real-route pattern
 * (app/api/household/route.ts's DELETE handler, requiring a real
 * confirmName match against the household's real, current name --
 * exercised as "The Renamed Household", the name stage 1's real PATCH
 * rename this journey depends on), then verifies real cascading deletion
 * of every table this journey's earlier stages actually populated:
 * household_members, family_members, policies, claim_sessions and
 * claim_evidence_documents -- not a generic/synthetic cascade check, but
 * THIS journey's own real rows.
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, readHandoff, requireHandoff } from "@/scripts/e2e/shared";

runStage("09-household-deletion-cleanup", async ({ step, pool }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "householdName", "selfMemberId", "spouseMemberId", "policyId", "claimSessionId"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const householdName = String(handoff.householdName);
  const selfMemberId = String(handoff.selfMemberId);
  const spouseMemberId = String(handoff.spouseMemberId);
  const policyId = String(handoff.policyId);
  const claimSessionId = String(handoff.claimSessionId);

  asUser(ownerId);

  const { GET: getHousehold, DELETE: deleteHousehold } = await import("@/app/api/household/route");

  await step("validates stage 8's real output: the household is still there, back down to its real single-owner membership, through the real GET /api/household route, before this stage deletes it", async () => {
    const res = await getHousehold(requestFor("http://localhost/api/household", { household: householdId }));
    const body = await res.json();
    assert.equal(body.memberships.length, 1);
    assert.equal(body.activeHouseholdId, householdId);
  });

  await step("DELETE /api/household refuses (400) a WRONG confirmName first, real household completely untouched -- proven before the real deletion below, not assumed", async () => {
    const res = await deleteHousehold(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: { confirmName: "definitely not the real name" } }));
    assert.equal(res.status, 400);
    const account = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdId]);
    assert.equal(account.rows.length, 1, "a wrong confirmName must never delete anything");
  });

  await step("DELETE /api/household -- the real route, real deleteHousehold() underneath it -- really, permanently deletes the whole household with the REAL confirmName this journey's own stage 1 PATCH-rename produced", async () => {
    const res = await deleteHousehold(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: { confirmName: householdName } }));
    if (res.status !== 200) throw new Error(`expected a real 200 deletion, got ${res.status}: ${await res.text()}`);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  await step("CLEANUP: every one of THIS journey's own real rows across every table it actually populated is really, permanently gone -- the accounts row itself, both cascading household/family tables, and the surviving policy-chain/claim rows stages 1-8 built up", async () => {
    const account = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdId]);
    assert.equal(account.rows.length, 0, "the accounts row must be genuinely, permanently gone");

    const members = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1`, [householdId]);
    assert.equal(members.rows.length, 0, "household_members must cascade-delete");

    const family = await pool.query(`SELECT 1 FROM family_members WHERE id=ANY($1::uuid[])`, [[selfMemberId, spouseMemberId]]);
    assert.equal(family.rows.length, 0, "this journey's real family_members rows (stage 1) must cascade-delete");

    const policy = await pool.query(`SELECT 1 FROM policies WHERE id=$1`, [policyId]);
    assert.equal(policy.rows.length, 0, "this journey's real policy row (stage 2, already lifecycle-deleted in stage 7) must cascade-delete");

    const claimSession = await pool.query(`SELECT 1 FROM claim_sessions WHERE id=$1`, [claimSessionId]);
    assert.equal(claimSession.rows.length, 0, "this journey's real claim_sessions row (stage 3) must cascade-delete");

    const evidence = await pool.query(`SELECT 1 FROM claim_evidence_documents WHERE claim_session_id=$1`, [claimSessionId]);
    assert.equal(evidence.rows.length, 0, "this journey's real claim_evidence_documents row (stage 4, already lifecycle-deleted in stage 6) must cascade-delete");
  });

  await step("INVALIDATION: the real GET /api/household route no longer shows this household at all -- the exact real read path it used to appear on for its owner", async () => {
    const res = await getHousehold(requestFor("http://localhost/api/household", { household: householdId }));
    const body = await res.json();
    assert.equal(body.memberships.length, 0);
    assert.equal(body.activeHouseholdId, null);
  });

  console.log("\n=== Journey complete: all 9 stages passed against the SAME persisted fixture ===");
});
