/**
 * Checkpoint 14g, Stage 8/9: membership removal.
 *
 * Exercises TWO real, distinct route surfaces built on top of
 * household_members: invitation issue/accept/revoke
 * (app/api/household/invitations/**, mirroring
 * scripts/invitation-revocation-deletion-regressions.ts's real-route
 * pattern) and membership removal
 * (app/api/household/members/[userId]/route.ts's DELETE handler,
 * mirroring scripts/household-membership-deletion-regressions.ts). Both
 * dedicated suites document that the REAL production path here is
 * lib/household/repo.ts's removeMember()/revokeInvitation()/
 * acceptInvitation(), NOT lib/lifecycle/coordinator.ts's unused
 * requestHouseholdMemberRemoval()/requestInvitationRevocation()
 * wrappers -- this stage exercises the real, live path, same as those
 * suites.
 *
 * A second real household member is needed to remove one, and this
 * journey has none yet (stage 1 only ever created ONE owner-user
 * identity plus two FAMILY member profiles, which are a different
 * table). dev-auth (lib/auth/session.ts's devSessionUser()) always
 * resolves to email "dev@localhost" regardless of DEV_ACCOUNT_ID, so an
 * invitation addressed to "dev@localhost" can genuinely be accepted by
 * a SECOND distinct dev-auth user id, producing a real second
 * household_members row through the real accept route -- not a seeded
 * row.
 *
 * sql/rate-limit.sql is applied as extra SQL here (via applyExtraSql())
 * because lib/http/db-rate-limit.ts's createDbRateLimiter() (used by both
 * the invitations POST and accept routes) has no lazy schema creator of
 * its own, unlike lib/claims/evidence/schema.ts's
 * ensureClaimEvidenceSchema() -- confirmed by reading db-rate-limit.ts
 * before writing this stage.
 */
import assert from "node:assert/strict";
import {
  runStage,
  asUser,
  requestFor,
  readHandoff,
  requireHandoff,
  writeHandoff,
  applyExtraSql,
} from "@/scripts/e2e/shared";

const SECOND_MEMBER_ID = "f0000000-0000-4000-8000-000000000002";

runStage("08-membership-removal", async ({ step, pool }) => {
  await applyExtraSql(["sql/rate-limit.sql"]);

  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "householdName"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const householdName = String(handoff.householdName);

  const { GET: getMembers } = await import("@/app/api/household/members/route");
  const { DELETE: deleteMember } = await import("@/app/api/household/members/[userId]/route");
  const { POST: createInvitation, GET: listInvitations } = await import("@/app/api/household/invitations/route");
  const { DELETE: revokeInvitation } = await import("@/app/api/household/invitations/[id]/route");
  const { POST: acceptInvitation } = await import("@/app/api/household/invitations/accept/route");

  await step("validates stage 7's real output: the household this stage acts on is still there, with exactly ONE real member (the owner), through the real GET /api/household/members route", async () => {
    asUser(ownerId);
    const res = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
    const body = await res.json();
    assert.equal(body.members.length, 1);
    assert.equal(body.members[0].userId, ownerId);
  });

  let revokedToken = "";
  await step("POST /api/household/invitations issues a real invitation (email dev@localhost, so a second dev-auth identity can accept it), then DELETE /api/household/invitations/[id] revokes it BEFORE acceptance -- a real revoke-then-fail-to-redeem roundtrip, distinct from the invitation this stage goes on to actually accept", async () => {
    asUser(ownerId);
    const res = await createInvitation(requestFor("http://localhost/api/household/invitations", { household: householdId, method: "POST", body: { email: "dev@localhost", role: "member" } }));
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${await res.text()}`);
    const body = await res.json();
    revokedToken = body.token;
    assert.ok(revokedToken);

    const listBefore = await listInvitations(requestFor("http://localhost/api/household/invitations", { household: householdId }));
    const listBeforeBody = await listBefore.json();
    assert.equal(listBeforeBody.invitations.length, 1);
    const invitationId = listBeforeBody.invitations[0].id;

    const revokeRes = await revokeInvitation(requestFor(`http://localhost/api/household/invitations/${invitationId}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ id: invitationId }) } as any);
    assert.equal(revokeRes.status, 200);
  });

  await step("the revoked invitation's real plaintext token can no longer be redeemed through the real POST /api/household/invitations/accept route (real downstream invalidation, not just a revoked_at column no one reads)", async () => {
    asUser(SECOND_MEMBER_ID);
    const res = await acceptInvitation(requestFor("http://localhost/api/household/invitations/accept", { method: "POST", body: { token: revokedToken } }));
    assert.equal(res.status, 400, "a revoked invitation's token must be refused, not silently accepted");

    const members = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
    asUser(ownerId);
    const membersRes = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
    const membersBody = await membersRes.json();
    assert.equal(membersBody.members.length, 1, "a refused accept must never add a membership row");
  });

  let liveInvitationToken = "";
  await step("POST /api/household/invitations issues a SECOND, live invitation this stage actually accepts", async () => {
    asUser(ownerId);
    const res = await createInvitation(requestFor("http://localhost/api/household/invitations", { household: householdId, method: "POST", body: { email: "dev@localhost", role: "member" } }));
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}: ${await res.text()}`);
    const body = await res.json();
    liveInvitationToken = body.token;
    assert.ok(liveInvitationToken);
  });

  await step("POST /api/household/invitations/accept -- a SECOND real dev-auth identity accepts the live invitation, becoming a real second household_members row through the real route (not seeded)", async () => {
    asUser(SECOND_MEMBER_ID);
    const res = await acceptInvitation(requestFor("http://localhost/api/household/invitations/accept", { method: "POST", body: { token: liveInvitationToken } }));
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
    const body = await res.json();
    assert.equal(body.householdId, householdId);

    const row = await pool.query<{ role: string }>(`SELECT role FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, SECOND_MEMBER_ID]);
    assert.equal(row.rows.length, 1, "the real household_members row for the second identity must now really exist");
    assert.equal(row.rows[0].role, "member");
  });

  await step("GET /api/household/members now lists BOTH real members through the real route", async () => {
    asUser(ownerId);
    const res = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
    const body = await res.json();
    assert.equal(body.members.length, 2);
    assert.ok(body.members.some((m: { userId: string }) => m.userId === SECOND_MEMBER_ID));
  });

  await step("DELETE /api/household/members/[userId] -- the owner really removes the second member through the real route", async () => {
    asUser(ownerId);
    const res = await deleteMember(requestFor(`http://localhost/api/household/members/${SECOND_MEMBER_ID}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ userId: SECOND_MEMBER_ID }) } as any);
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  });

  await step("INVALIDATION: the real GET /api/household/members route is back down to exactly one real member (the owner) -- the exact real read path the second member used to appear on", async () => {
    const res = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
    const body = await res.json();
    assert.equal(body.members.length, 1);
    assert.equal(body.members[0].userId, ownerId);

    const row = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, SECOND_MEMBER_ID]);
    assert.equal(row.rows.length, 0, "the removed membership row must be really gone");
  });

  await writeHandoff({ membershipRemovalDone: true, householdName });
});
