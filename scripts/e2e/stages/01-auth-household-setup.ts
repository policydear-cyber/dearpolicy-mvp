/**
 * Checkpoint 14g, Stage 1/9: auth and household setup.
 *
 * Same documented dev-auth identity substitute
 * scripts/full-household-e2e-regressions.ts and scripts/authz-http-
 * regressions.ts both already accept (no real Supabase project in this
 * sandbox) -- this stage does not change that scope, only WHERE the
 * journey's steps run (their own process, sharing a persisted fixture).
 */
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, writeHandoff } from "@/scripts/e2e/shared";

const OWNER_ID = "f0000000-0000-4000-8000-000000000001";
const HOUSEHOLD_NAME = "The Renamed Household";

runStage("01-auth-household-setup", async ({ step }) => {
  const { GET: getHousehold, PATCH: patchHousehold } = await import("@/app/api/household/route");
  const { GET: getFamily, POST: postFamily } = await import("@/app/api/family/route");
  const { pool } = await import("@/lib/db/client");

  let householdId = "";
  let selfMemberId = "";
  let spouseMemberId = "";

  await step("brand-new dev-auth user has zero households before any are seeded", async () => {
    asUser(OWNER_ID);
    const res = await getHousehold(requestFor("http://localhost/api/household"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.memberships.length, 0);
  });

  await step("household + owner membership seeded (signup substitute)", async () => {
    const result = await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), 'E2E Household') RETURNING id`);
    householdId = result.rows[0].id;
    await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'owner')`, [householdId, OWNER_ID]);
  });

  await step("the seeded household is visible through GET /api/household, with the correct active household resolved", async () => {
    const res = await getHousehold(requestFor("http://localhost/api/household", { household: householdId }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.memberships.length, 1);
    assert.equal(body.activeHouseholdId, householdId);
  });

  await step("PATCH /api/household renames the household -- verified against the real persisted accounts row, since neither PATCH's own {ok:true} response nor GET /api/household's {memberships,activeHouseholdId} body actually returns the household's display name (a real, previously-undetected gap in scripts/full-household-e2e-regressions.ts's own step 4 assertion -- body.activeHouseholdName -- discovered while building this stage from it; see this checkpoint's PR comment)", async () => {
    const res = await patchHousehold(requestFor("http://localhost/api/household", { household: householdId, method: "PATCH", body: { name: HOUSEHOLD_NAME } }));
    assert.equal(res.status, 200);
    const check = await getHousehold(requestFor("http://localhost/api/household", { household: householdId }));
    const body = await check.json();
    assert.equal(body.activeHouseholdId, householdId);
    const row = await pool.query<{ name: string }>(`SELECT name FROM accounts WHERE id=$1`, [householdId]);
    assert.equal(row.rows[0]?.name, HOUSEHOLD_NAME, "the rename must really be persisted, not just accepted");
  });

  await step("POST /api/family creates the household owner's own family profile", async () => {
    const res = await postFamily(requestFor("http://localhost/api/family", { household: householdId, method: "POST", body: { displayName: "Jordan Rivera", relationship: "self" } }));
    assert.equal(res.status, 201);
    selfMemberId = (await res.json()).member.id;
    assert.ok(selfMemberId);
  });

  await step("POST /api/family creates a second family member", async () => {
    const res = await postFamily(requestFor("http://localhost/api/family", { household: householdId, method: "POST", body: { displayName: "Casey Rivera", relationship: "spouse" } }));
    assert.equal(res.status, 201);
    spouseMemberId = (await res.json()).member.id;
    assert.ok(spouseMemberId);
  });

  await step("GET /api/family lists both family members, self ordered first", async () => {
    const res = await getFamily(requestFor("http://localhost/api/family", { household: householdId }));
    const body = await res.json();
    assert.equal(body.family.length, 2);
    assert.equal(body.family[0].relationship, "self");
  });

  await writeHandoff({ ownerId: OWNER_ID, householdId, selfMemberId, spouseMemberId, householdName: HOUSEHOLD_NAME });
});
