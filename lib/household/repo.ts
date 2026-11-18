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
import { parseHouseholdCurrencySetting, type HouseholdCurrencySetting } from "@/lib/documents/household-currency-options";
import type { Pool } from "pg";
import { createUserSupabaseClient, withServiceTransaction, type ScopedDbClient } from "@/lib/db/authz-client";
import { isUuid } from "@/lib/db/client";
import { enqueueStoragePurge, householdStorageKeys, purgeSoon, type PurgeItem } from "@/lib/storage/purge";
import { householdGate, SignupClosedError } from "@/lib/auth/signup-gate";

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
export async function ensureDefaultHousehold(
  userId: string,
  displayName: string,
  poolOverride?: Pick<Pool, "connect">,
  options: { email?: string | null; emailProven?: boolean; beforeCreate?: () => Promise<void>; currency?: HouseholdCurrencySetting | null } = {},
): Promise<string> {
  return withServiceTransaction(async (client) => {
    const existing = await client.query<{ household_id: string }>(
      `select household_id from household_members where user_id = $1 order by created_at asc limit 1`,
      [userId],
    );
    if (existing.rows.length > 0) return existing.rows[0].household_id;

    // Invite-only sign-up (lib/auth/signup-gate.ts, off unless DEARPOLICY_SIGNUP_MODE=invite): a new household only for
    // an invited email that is proven to be theirs. A person already in a household returned above, so is never
    // affected. Fails closed.
    const gate = await householdGate(options.email, options.emailProven === true, client);
    if (gate !== "ok") throw new SignupClosedError(gate);
    // Runs only when a household is about to be made; if it throws, nothing is written (the transaction rolls back).
    if (options.beforeCreate) await options.beforeCreate();

    // accounts.id has NO column default in sql/schema.sql (nor in the live
    // database), so the id must be generated here -- relying on a default
    // made every first sign-in fail with a NOT NULL violation.
    // The policy currency chosen at sign-up (DC 18 Nov: compulsory there) is stored with the new household; a household
    // made any other way (an emailed link, a fresh start) has none until its owner chooses (components/household-currency-prompt).
    const currency = parseHouseholdCurrencySetting(options.currency);
    // A database without accounts.currency yet (sql/household-currency.sql not applied) still makes the household, without
    // the choice: the savepoint keeps the transaction usable, and the owner is asked once the setting exists (Critic #534 H1).
    let created: { rows: { id: string }[] } | null = null;
    if (currency) {
      await client.query("savepoint household_currency");
      try {
        created = await client.query<{ id: string }>(`insert into accounts(id, name, currency) values (gen_random_uuid(), $1, $2) returning id`, [displayName || "My household", currency]);
        await client.query("release savepoint household_currency");
      } catch (error) {
        if ((error as { code?: string })?.code !== "42703") throw error;
        await client.query("rollback to savepoint household_currency");
      }
    }
    created ??= await client.query<{ id: string }>(`insert into accounts(id, name) values (gen_random_uuid(), $1) returning id`, [displayName || "My household"]);
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
    // Only a member row is deleted here: if a transfer made this person the owner after the read above, the delete
    // re-checks the committed row (it waits on the transfer's row lock) and removes nothing, so a household is never
    // left with no owner (Test engineer #538 F1). The rare legacy co-owner case was already checked above.
    const { rowCount } = await client.query(
      `delete from household_members where household_id = $1 and user_id = $2 and (role <> 'owner' or $3::boolean)`,
      [householdId, targetUserId, target.rows[0].role === "owner"],
    );
    if (rowCount === 0) {
      const now = await client.query<{ role: Role }>(`select role from household_members where household_id = $1 and user_id = $2`, [householdId, targetUserId]);
      if (now.rows[0]?.role === "owner") throw new ConflictError("Cannot remove the owner of a household. Transfer ownership first.");
      throw new ForbiddenError("Not permitted to remove this member");
    }
  }, poolOverride);
}

/** A household has exactly one owner (DC, 18 Nov 2026). The owner alone
 * manages documents, people and settings; members can view and use Ask.
 * Ownership moves only by transfer: the target becomes the owner and the
 * caller becomes a member, in one transaction, so the household is never
 * left without an owner and never has two.
 *
 * Promote first, then demote: both statements run under the caller's own
 * RLS (household_members_update needs is_household_owner()), and after a
 * demotion the caller could no longer promote anyone. The one-owner
 * constraint in sql/household-single-owner.sql is DEFERRABLE INITIALLY
 * DEFERRED, so the brief two-owner state inside this transaction is checked
 * only at commit. */
export async function transferOwnership(callerUserId: string, householdId: string, targetUserId: string, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  if (callerUserId === targetUserId) throw new ConflictError("You are already the owner of this household.");
  await createUserSupabaseClient(callerUserId, async (client) => {
    const { rows } = await client.query<{ user_id: string; role: Role }>(
      `select user_id, role from household_members where household_id = $1 and user_id = any($2::uuid[]) for update`,
      [householdId, [callerUserId, targetUserId]],
    );
    const caller = rows.find((r) => r.user_id === callerUserId);
    const target = rows.find((r) => r.user_id === targetUserId);
    if (!caller || caller.role !== "owner") throw new NotHouseholdOwnerError("Only the household owner can perform this action.");
    if (!target) throw new NotFoundError("Membership not found");
    const promoted = await client.query(`update household_members set role = 'owner' where household_id = $1 and user_id = $2`, [householdId, targetUserId]);
    if (promoted.rowCount !== 1) throw new ForbiddenError("Not permitted to change this member's role");
    const demoted = await client.query(`update household_members set role = 'member' where household_id = $1 and user_id = $2`, [householdId, callerUserId]);
    if (demoted.rowCount !== 1) throw new ForbiddenError("Not permitted to change this member's role");
    // Any invitation still pending was sent by the old owner on their own
    // authority; it stays valid (it can only ever add a member).
  }, poolOverride);
}

/** Kept for the members route's PATCH body ({ role }). "owner" means
 * transfer ownership to the target; "member" can only describe someone who
 * already is one, because the single owner can't step down without naming
 * a successor. */
export async function setMemberRole(callerUserId: string, householdId: string, targetUserId: string, role: Role, poolOverride?: Pick<Pool, "connect">): Promise<void> {
  if (role === "owner") return transferOwnership(callerUserId, householdId, targetUserId, poolOverride);
  await createUserSupabaseClient(callerUserId, async (client) => {
    const target = await client.query<{ role: Role }>(
      `select role from household_members where household_id = $1 and user_id = $2`,
      [householdId, targetUserId],
    );
    if (target.rows.length === 0) throw new NotFoundError("Membership not found");
    if (target.rows[0].role === "owner") {
      throw new ConflictError("Cannot demote the last owner of a household. Transfer ownership instead.");
    }
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
  // One owner per household: an invitation can only ever add a member.
  if (role !== "member") throw new ConflictError("An invitation can only add a member. Transfer ownership instead.");
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

    // Always a member: a household has exactly one owner, and an older
    // invitation stored as "owner" must never create a second one.
    await insertMember(client, invitation.household_id, acceptingUserId, "member", null);
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
  // Round 5 (privacy): the household's stored files are collected (under the
  // caller's own RLS, in the same transaction) before the rows cascade away,
  // then queued and removed once the delete has committed. Removal never
  // fails the deletion; the request drain retries anything left.
  let keys: PurgeItem[] = [];
  await createUserSupabaseClient(callerUserId, async (client) => {
    keys = await householdStorageKeys(householdId, client as never, true);
    const { rowCount } = await client.query(`delete from accounts where id = $1`, [householdId]);
    if (rowCount === 0) throw new NotFoundError("Household not found");
  }, poolOverride);
  try {
    await enqueueStoragePurge(keys, "household_deleted");
    await purgeSoon();
  } catch (error) {
    console.warn("household storage purge not completed now:", error instanceof Error ? error.name : "unknown");
  }
}
