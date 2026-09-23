/**
 * Household repository: every household-membership operation the app
 * needs, built on top of lib/db/authz-client.ts's RLS-enforced boundary.
 *
 * The rule throughout this file: use createUserSupabaseClient() (real RLS)
 * for anything a signed-in member does. Only the handful of operations RLS
 * cannot mediate by construction -- because the caller isn't a member yet,
 * or no household exists yet -- go through the service client, and each of
 * those functions does its own explicit authorization checks (matching the
 * comment in sql/household-rls.sql: "Acceptance ... is a service_role-
 * mediated operation performed by the accept-invitation server route,
 * which validates the token hash, expiry and single-use state itself").
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { createUserSupabaseClient, withServiceTransaction, type ScopedDbClient } from "@/lib/db/authz-client";
import { isUuid } from "@/lib/db/client";

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class NotHouseholdOwnerError extends Error {}

export type Role = "owner" | "member";
export type Membership = { householdId: string; userId: string; role: Role; createdAt: string };

/** Every household a user belongs to, most-recently-joined first. Used both
 * to populate a household switcher and to resolve a default when no active
 * household cookie is set yet. */
export async function listMemberships(userId: string, poolOverride?: Pick<Pool, "connect">): Promise<Membership[]> {
  return createUserSupabaseClient(userId, async (client) => {
    const { rows } = await client.query<{ household_id: string; user_id: string; role: Role; created_at: string }>(
      `select household_id, user_id, role, created_at from household_members where user_id = $1 order by created_at asc`,
      [userId],
    );
    return rows.map((r) => ({ householdId: r.household_id, userId: r.user_id, role: r.role, createdAt: r.created_at }));
  }, poolOverride);
}

/** Resolves the household id a request should operate against: the
 * requested id if the caller is genuinely still a member of it (checked via
 * the RLS-enforced client, so a stale/forged cookie can't grant access to a
 * household the caller was removed from), otherwise the caller's
 * oldest/first membership, otherwise null (no household yet). Never trusts
 * a client-supplied household id without this membership check. */
export async function resolveActiveHouseholdId(userId: string, requestedHouseholdId: string | null, poolOverride?: Pick<Pool, "connect">): Promise<string | null> {
  const memberships = await listMemberships(userId, poolOverride);
  if (memberships.length === 0) return null;
  if (requestedHouseholdId && memberships.some((m) => m.householdId === requestedHouseholdId)) {
    return requestedHouseholdId;
  }
  return memberships[0].householdId;
}

/** Guards an owner-only action (household export, invitations, rename/
 * delete -- see each route's own comment for why it's owner-gated).
 * Built on listHouseholdMembers() below, so it inherits that function's
 * own RLS scoping: a caller who is not a genuine current member of
 * `householdId` gets an empty list back, and therefore NotHouseholdOwnerError
 * here too, never a distinguishable "you're not a member" vs "you're not
 * the owner" response -- see lib/auth/request-context.ts's
 * routeErrorResponse() doc comment on why that distinction is
 * deliberately never surfaced to the caller. */
export async function requireHouseholdOwner(callerUserId: string, householdId: string, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  const members = await listHouseholdMembers(callerUserId, householdId, poolOverride);
  const self = members.find((m) => m.userId === callerUserId);
  if (!self || self.role !== "owner") {
    throw new NotHouseholdOwnerError("Only the household owner can perform this action.");
  }
}

/** Lists every current member of `householdId`, for a member-management
 * UI. Uses the RLS-enforced client with household_members_select's policy
 * (is_household_member()) -- so this only returns rows at all if the
 * caller is themselves a genuine current member; a caller no longer in the
 * household gets an empty list, never another household's members. */
export async function listHouseholdMembers(callerUserId: string, householdId: string, poolOverride?: Pick<Pool, "connect">): Promise<Membership[]> {
  return createUserSupabaseClient(callerUserId, async (client) => {
    const { rows } = await client.query<{ household_id: string; user_id: string; role: Role; created_at: string }>(
      `select household_id, user_id, role, created_at from household_members where household_id = $1 order by created_at asc`,
      [householdId],
    );
    return rows.map((r) => ({ householdId: r.household_id, userId: r.user_id, role: r.role, createdAt: r.created_at }));
  }, poolOverride);
}

/** Provisions a brand-new household with `userId` as its sole owner. Uses
 * the service client because, by definition, the user has no
 * household_members row yet -- RLS's household_members_insert policy
 * requires is_household_owner(), which is impossible before any row exists.
 * Idempotent: if the user already has a household, returns the existing
 * one instead of creating a second, so this is safe to call from both
 * signup and a "just in case" check on every sign-in. */
export async function ensureDefaultHousehold(userId: string, displayName: string, poolOverride?: Pick<Pool, "connect">): Promise<string> {
  return withServiceTransaction(async (client) => {
    const existing = await client.query<{ household_id: string }>(
      `select household_id from household_members where user_id = $1 order by created_at asc limit 1`,
      [userId],
    );
    if (existing.rows.length > 0) return existing.rows[0].household_id;

    const created = await client.query<{ id: string }>(`insert into accounts(name) values ($1) returning id`, [
      displayName || "My household",
    ]);
    const householdId = created.rows[0].id;
    await client.query(`insert into household_members(household_id, user_id, role) values ($1, $2, 'owner')`, [
      householdId,
      userId,
    ]);
    return householdId;
  }, poolOverride);
}

/** Owner-only: rename the household. */
export async function renameHousehold(userId: string, householdId: string, name: string, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  await createUserSupabaseClient(userId, async (client) => {
    const { rowCount } = await client.query(`update accounts set name = $1 where id = $2`, [name, householdId]);
    // RLS's accounts_update policy silently filters to zero rows for a
    // non-owner rather than erroring -- rowCount === 0 IS the "you are not
    // the owner" (or "no such household") signal, and the two cases are
    // deliberately indistinguishable to the caller (see the route-migration
    // requirement: foreign/forbidden objects return the same response).
    if (rowCount === 0) throw new NotFoundError("Household not found");
  }, poolOverride);
}

/** Owner-only: add a member directly (no invitation flow) -- used
 * internally by acceptInvitation(); not exposed as its own public route,
 * since the invitation flow is the only supported way to join a household
 * one doesn't own. */
async function insertMember(client: ScopedDbClient, householdId: string, userId: string, role: Role, invitedBy: string | null) {
  await client.query(`insert into household_members(household_id, user_id, role, invited_by) values ($1, $2, $3, $4)`, [
    householdId,
    userId,
    role,
    invitedBy,
  ]);
}

async function countOwners(client: ScopedDbClient, householdId: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `select count(*)::text as count from household_members where household_id = $1 and role = 'owner'`,
    [householdId],
  );
  return Number(rows[0]?.count ?? 0);
}

/** Owner-only: remove a member (or, if userId === callerUserId, "leave").
 * Refuses to remove the last remaining owner -- a household must always
 * have at least one owner able to manage it. */
export async function removeMember(callerUserId: string, householdId: string, targetUserId: string, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  await createUserSupabaseClient(callerUserId, async (client) => {
    const target = await client.query<{ role: Role }>(
      `select role from household_members where household_id = $1 and user_id = $2`,
      [householdId, targetUserId],
    );
    if (target.rows.length === 0) throw new NotFoundError("Membership not found");
    if (target.rows[0].role === "owner") {
      const owners = await countOwners(client, householdId);
      if (owners <= 1) {
        throw new ConflictError("Cannot remove the last owner of a household. Transfer ownership or delete the household instead.");
      }
    }
    // household_members_delete's policy already allows only an owner to
    // remove someone else, or anyone to remove themselves (leave) -- a
    // caller who is neither gets rowCount 0, surfaced the same way as
    // "not found" below.
    const { rowCount } = await client.query(`delete from household_members where household_id = $1 and user_id = $2`, [
      householdId,
      targetUserId,
    ]);
    if (rowCount === 0) throw new ForbiddenError("Not permitted to remove this member");
  }, poolOverride);
}

/** Owner-only: promote/demote a member's role, with the same
 * never-leave-zero-owners protection as removeMember(). */
export async function setMemberRole(callerUserId: string, householdId: string, targetUserId: string, role: Role, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  await createUserSupabaseClient(callerUserId, async (client) => {
    const target = await client.query<{ role: Role }>(
      `select role from household_members where household_id = $1 and user_id = $2`,
      [householdId, targetUserId],
    );
    if (target.rows.length === 0) throw new NotFoundError("Membership not found");
    if (target.rows[0].role === "owner" && role === "member") {
      const owners = await countOwners(client, householdId);
      if (owners <= 1) {
        throw new ConflictError("Cannot demote the last owner of a household.");
      }
    }
    const { rowCount } = await client.query(`update household_members set role = $1 where household_id = $2 and user_id = $3`, [
      role,
      householdId,
      targetUserId,
    ]);
    if (rowCount === 0) throw new ForbiddenError("Not permitted to change this member's role");
  }, poolOverride);
}

// --- Invitations -----------------------------------------------------------

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Owner-only: creates an invitation and returns the PLAINTEXT token -- the
 * only time it ever exists outside the invitee's inbox. Only its SHA-256
 * hash is stored (sql/household-rls.sql's household_invitations.token_hash),
 * so a database read (or backup, or leaked log) can never be used to accept
 * the invitation. */
export async function createInvitation(
  callerUserId: string,
  householdId: string,
  email: string,
  role: Role = "member",
  poolOverride?: Pick<Pool, "connect">,
): Promise<{ token: string; expiresAt: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) throw new ConflictError("A valid email address is required");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();

  await createUserSupabaseClient(callerUserId, async (client) => {
    const { rowCount } = await client.query(
      `insert into household_invitations(household_id, email, role, token_hash, invited_by, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [householdId, normalizedEmail, role, tokenHash, callerUserId, expiresAt],
    );
    // household_invitations_insert requires is_household_owner(); a
    // non-owner's INSERT is rejected by RLS (a thrown error, not a filtered
    // zero rows, since INSERT has no existing row to filter) -- but the
    // unique partial index on (household_id, lower(email)) WHERE pending
    // can also legitimately reject a duplicate pending invite, which
    // surfaces as a distinct Postgres error the route handler should map to
    // 409, not 403. rowCount here will always be 1 if we got this far.
    if (rowCount !== 1) throw new ForbiddenError("Not permitted to invite to this household");
  }, poolOverride);

  return { token, expiresAt };
}

/** Owner-only: revoke a still-pending invitation. */
export async function revokeInvitation(callerUserId: string, invitationId: string, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  await createUserSupabaseClient(callerUserId, async (client) => {
    const { rowCount } = await client.query(
      `update household_invitations set revoked_at = now()
       where id = $1 and accepted_at is null and revoked_at is null`,
      [invitationId],
    );
    if (rowCount === 0) throw new NotFoundError("Invitation not found, already used, or already revoked");
  }, poolOverride);
}

export type InvitationSummary = {
  id: string;
  householdId: string;
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
};

/** Owner-only: lists still-pending (not accepted, not revoked, not expired)
 * invitations for a household, for display in the invite-management UI.
 * household_invitations_select's RLS policy (is_household_owner()) means a
 * non-owner querying this gets zero rows back rather than an error, so the
 * route layer still classifies its GET "household-owner" -- a plain member
 * should see a clear 403-shaped response, not a silently empty list. Never
 * returns token_hash (the plaintext token is returned once, by
 * createInvitation(), and never persisted or re-read). */
export async function listInvitations(
  callerUserId: string,
  householdId: string,
  poolOverride?: Pick<Pool, "connect">,
): Promise<InvitationSummary[]> {
  return createUserSupabaseClient(
    callerUserId,
    async (client) => {
      const { rows } = await client.query<{
        id: string;
        household_id: string;
        email: string;
        role: Role;
        invited_by: string;
        created_at: string;
        expires_at: string;
      }>(
        `select id, household_id, email, role, invited_by, created_at, expires_at
         from household_invitations
         where household_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()
         order by created_at desc`,
        [householdId],
      );
      return rows.map((r) => ({
        id: r.id,
        householdId: r.household_id,
        email: r.email,
        role: r.role,
        invitedBy: r.invited_by,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));
    },
    poolOverride,
  );
}

/** Accepts an invitation for the ALREADY-AUTHENTICATED user identified by
 * `acceptingUserId` + `acceptingUserEmail` (resolved server-side from the
 * real session -- never client-supplied). Service-role-mediated by
 * necessity (the invitee isn't a household member yet, so RLS has nothing
 * to grant them), which means every check RLS would normally provide is
 * done explicitly here instead:
 *   - token looked up by HASH, never plaintext, and compared in constant
 *     time (defense in depth beyond the hash lookup itself)
 *   - not expired, not already accepted, not revoked
 *   - the invitation's intended email matches the accepting user's real
 *     (Supabase-verified) email -- knowing/guessing the token alone is not
 *     sufficient if it was meant for someone else
 *   - membership insert and invitation-accepted update happen in the same
 *     transaction, so a crash between them can't leave an accepted
 *     invitation with no resulting membership
 * A user must not gain access merely by knowing a household ID or
 * invitation ID -- this function never accepts either as an input; only the
 * unguessable token identifies which invitation is being redeemed. */
export async function acceptInvitation(
  token: string,
  acceptingUserId: string,
  acceptingUserEmail: string,
  poolOverride?: Pick<Pool, "connect">,
): Promise<string> {
  if (!token || !acceptingUserId || !isUuid(acceptingUserId)) {
    throw new ForbiddenError("Invalid acceptance request");
  }
  const tokenHash = hashToken(token);
  const normalizedEmail = acceptingUserEmail.trim().toLowerCase();

  return withServiceTransaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      household_id: string;
      email: string;
      role: Role;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
    }>(`select id, household_id, email, role, expires_at, accepted_at, revoked_at from household_invitations where token_hash = $1`, [
      tokenHash,
    ]);
    const invitation = rows[0];
    if (!invitation) throw new NotFoundError("Invitation not found");
    if (invitation.revoked_at) throw new ForbiddenError("This invitation has been revoked");
    if (invitation.accepted_at) throw new ForbiddenError("This invitation has already been used");
    if (new Date(invitation.expires_at).getTime() < Date.now()) throw new ForbiddenError("This invitation has expired");

    const invitedEmail = Buffer.from(invitation.email, "utf8");
    const givenEmail = Buffer.from(normalizedEmail, "utf8");
    const emailMatches =
      invitedEmail.length === givenEmail.length && timingSafeEqual(invitedEmail, givenEmail);
    if (!emailMatches) {
      throw new ForbiddenError("This invitation was issued to a different email address");
    }

    await insertMember(client, invitation.household_id, acceptingUserId, invitation.role, null);
    await client.query(`update household_invitations set accepted_at = now(), accepted_by = $1 where id = $2`, [
      acceptingUserId,
      invitation.id,
    ]);
    return invitation.household_id;
  }, poolOverride);
}

/** Owner-only: permanently deletes a household and (via ON DELETE CASCADE
 * on every household-owned table's account_id/household_id FK) everything
 * in it. See lib/household/repo.ts callers for the reauthentication
 * requirement on this and other destructive operations -- enforced at the
 * route layer, not here. */
export async function deleteHousehold(callerUserId: string, householdId: string, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  await createUserSupabaseClient(callerUserId, async (client) => {
    const { rowCount } = await client.query(`delete from accounts where id = $1`, [householdId]);
    if (rowCount === 0) throw new NotFoundError("Household not found");
  }, poolOverride);
}
