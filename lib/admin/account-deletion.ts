/**
 * Admin console: delete an account (a sign-in) and what it owns. Called only from the admin page's server action
 * (app/admin/accounts/actions.ts), after the admin allow-list check, and re-checked here.
 *
 * What "delete this account" means:
 *  - Every household the person OWNS alone is deleted whole, through the same path as an owner deleting their own
 *    household (lib/lifecycle/coordinator.ts requestHouseholdDeletion): people, documents, readings, chats, claim
 *    documents, stored files, model usage and search passages. A household with another owner is not deleted; only
 *    this person leaves it.
 *  - A household the person only belongs to loses that membership and nothing else.
 *  - Then the sign-in itself is deleted from Supabase Auth. Data goes first, so a failure part-way leaves a sign-in
 *    with less data (which can be tried again), never data with no sign-in to find it by.
 *
 * Refused outright: the signed-in admin's own account, any address on the ADMIN_EMAILS allow-list, an address that
 * isn't an account, and a confirmation that isn't the exact email. Allowed only with an explicit acknowledgement: an
 * owned household that other people still belong to (they lose it).
 *
 * Every attempt is recorded (telemetry always; admin_audit_log when sql/admin-audit-log.sql has been applied) with
 * pseudonymised references and counts only, never the email address.
 */
import { randomUUID } from "node:crypto";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { adminEmails, type AdminUser } from "@/lib/admin/access";
import { pseudonymizeId, recordEvent } from "@/lib/telemetry";
import { requestHouseholdDeletion } from "@/lib/lifecycle/coordinator";
import { requireSupabaseServiceEnv } from "@/lib/supabase/env";
import { ACCOUNT_DATA_RULES, type DeletionContext } from "@/lib/admin/account-data-map";
import { drainStoragePurge, enqueueStoragePurge, householdStorageKeys, purgeDriverFor } from "@/lib/storage/purge";
import type { StorageDomain } from "@/lib/storage/cleanup";

export type HouseholdImpact = {
  householdId: string;
  name: string;
  role: "owner" | "member";
  /** delete_household: removed whole. leave: only this person's membership goes. */
  action: "delete_household" | "leave";
  /** Why a household this person owns is not deleted (another owner remains). */
  note: string | null;
  /** Other people who belong to the household (emails, or "an account" when one can't be read). */
  otherMembers: string[];
  people: number;
  documents: number;
  documentsRead: number;
  claimDocuments: number;
  conversations: number;
  storedFiles: number;
};

export type AccountPlan = {
  userId: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
  households: HouseholdImpact[];
  /** Reasons this account can't be deleted. Empty means it can. */
  blockers: string[];
  /** Things to know that the console can't do for you (a paid plan lives at Stripe, not here). */
  warnings: string[];
  /** True when a household that will be deleted still has other people in it. */
  needsSharedAcknowledgement: boolean;
};

export type PlanLookup = { found: true; plan: AccountPlan } | { found: false; reason: string };

const EMAIL = /^[^\s@,]+@[^\s@,]+$/;
const norm = (s: string) => s.trim().toLowerCase();

async function count(sql: string, params: unknown[]): Promise<number> {
  try { return Number((await query<{ n: string }>(sql, params)).rows[0]?.n ?? 0); } catch { return 0; } // a table not set up yet has nothing in it
}

async function authUsersPresent(): Promise<boolean> {
  try { return (await query<{ p: boolean }>(`SELECT to_regclass('auth.users') IS NOT NULL AS p`)).rows[0]?.p === true; } catch { return false; }
}

/** What deleting this email's account would remove, for the confirmation screen. Reads only; names no file or document. */
export async function planAccountDeletion(emailInput: string, admin: AdminUser, env: NodeJS.ProcessEnv = process.env): Promise<PlanLookup> {
  const email = norm(emailInput);
  if (!EMAIL.test(email)) return { found: false, reason: "Enter the full email address of the account." };
  if (!(await authUsersPresent())) return { found: false, reason: "Accounts can't be looked up here: Supabase Auth's user list can't be read from this database." };
  const user = (await query<{ id: string; email: string; created_at: string | null; last_sign_in_at: string | null }>(
    `SELECT id::text, email, created_at::text, last_sign_in_at::text FROM auth.users WHERE lower(email) = $1 LIMIT 2`, [email])).rows;
  if (user.length === 0) return { found: false, reason: "No account has that email address." };
  if (user.length > 1) return { found: false, reason: "More than one account has that email address; nothing was changed." };
  const u = user[0];

  const memberships = (await query<{ household_id: string; role: string; name: string | null }>(
    `SELECT hm.household_id::text, hm.role, a.name FROM household_members hm JOIN accounts a ON a.id = hm.household_id
      WHERE hm.user_id = $1 AND ${activePredicate("a")} ORDER BY hm.created_at`, [u.id])).rows;

  const households: HouseholdImpact[] = [];
  for (const m of memberships) {
    const others = (await query<{ user_id: string; role: string; email: string | null }>(
      `SELECT hm.user_id::text, hm.role, (SELECT au.email FROM auth.users au WHERE au.id = hm.user_id) AS email
         FROM household_members hm WHERE hm.household_id = $1 AND hm.user_id <> $2`, [m.household_id, u.id])).rows;
    const coOwned = m.role === "owner" && others.some((o) => o.role === "owner");
    const deletes = m.role === "owner" && !coOwned;
    const h = m.household_id;
    households.push({
      householdId: h, name: m.name ?? "Unnamed household", role: m.role === "owner" ? "owner" : "member",
      action: deletes ? "delete_household" : "leave",
      note: coOwned ? "Another owner remains, so the household stays." : m.role !== "owner" ? "Not the owner, so the household stays." : null,
      otherMembers: others.map((o) => o.email ?? "an account"),
      people: deletes ? await count(`SELECT count(*) AS n FROM family_members WHERE account_id = $1`, [h]) : 0,
      documents: deletes ? await count(`SELECT count(*) AS n FROM policies WHERE account_id = $1 AND ${activePredicate()}`, [h]) : 0,
      documentsRead: deletes ? await count(`SELECT count(*) AS n FROM policies WHERE account_id = $1 AND lifecycle_state = 'active' AND processing_status = 'ready'`, [h]) : 0,
      claimDocuments: deletes ? await count(`SELECT count(*) AS n FROM claim_evidence_documents WHERE account_id = $1 AND ${activePredicate()}`, [h]) : 0,
      conversations: deletes ? await count(`SELECT count(*) AS n FROM chat_conversations WHERE account_id = $1`, [h]) : 0,
      storedFiles: deletes ? (await count(`SELECT count(*) AS n FROM policies WHERE account_id = $1 AND ${activePredicate()} AND storage_key IS NOT NULL`, [h]))
        + (await count(`SELECT count(*) AS n FROM claim_evidence_documents WHERE account_id = $1 AND ${activePredicate()} AND storage_key IS NOT NULL`, [h])) : 0,
    });
  }

  const blockers: string[] = [];
  if (u.id === admin.id || norm(u.email) === norm(admin.email)) blockers.push("This is your own admin account. It can't be deleted from the console.");
  else if (adminEmails(env).has(norm(u.email))) blockers.push("This address is on the admin list (ADMIN_EMAILS). Remove it there first if it really should go.");

  const warnings: string[] = [];
  const paid = await count(
    `SELECT count(*) AS n FROM household_plans WHERE account_id = ANY($1::uuid[]) AND (stripe_subscription_id IS NOT NULL OR stripe_customer_id IS NOT NULL)`,
    [households.filter((h) => h.action === "delete_household").map((h) => h.householdId)]);
  if (paid > 0) warnings.push("A household here has a Stripe customer or subscription. Deleting it here does not cancel billing: cancel it in Stripe too.");

  return {
    found: true,
    plan: {
      userId: u.id, email: u.email, createdAt: u.created_at, lastSignInAt: u.last_sign_in_at, households, blockers, warnings,
      needsSharedAcknowledgement: households.some((h) => h.action === "delete_household" && h.otherMembers.length > 0),
    },
  };
}

export type StorageSweep = { verified: boolean; stillQueued: number };

export type DeletionDeps = {
  /** Removes every stored file of these households and keys, then reports whether any is left. */
  sweepStorage: (householdIds: string[], keys: string[]) => Promise<StorageSweep>;
  /** Deletes the sign-in from Supabase Auth. */
  deleteAuthUser: (userId: string) => Promise<void>;
  /** Deletes one household whole, as its owner would. */
  deleteHousehold: (ownerUserId: string, householdId: string) => Promise<void>;
};

const DOMAINS: StorageDomain[] = ["policy", "claim-evidence", "household-export"];

/**
 * Storage left behind after the households' own deletion: drains the removal queue, then lists each bucket and
 * removes anything still under a deleted household's id or named by a collected key (a file the queue missed), and
 * says how many queued removals are still waiting on a retry. Never throws: unverified is reported, not hidden.
 */
async function sweepStorage(householdIds: string[], keys: string[]): Promise<StorageSweep> {
  let verified = true;
  try { await drainStoragePurge({ limit: 500 }); } catch { verified = false; }
  const wanted = new Set(keys);
  for (const domain of DOMAINS) {
    try {
      const driver = purgeDriverFor(domain);
      for (const object of await driver.listObjects()) {
        if (wanted.has(object.key) || householdIds.some((h) => object.key.startsWith(`${h}/`))) await driver.deleteObject(object.key);
      }
    } catch { verified = false; }
  }
  const stillQueued = await count(`SELECT count(*) AS n FROM storage_purge_queue WHERE purged_at IS NULL AND (storage_key = ANY($1::text[]) OR left(storage_key, 36) = ANY($2::text[]))`, [keys, householdIds]);
  return { verified: verified && stillQueued === 0, stillQueued };
}

export const defaultDeps: DeletionDeps = {
  sweepStorage,
  async deleteAuthUser(userId) {
    const { url, anonKey: serviceKey } = requireSupabaseServiceEnv();
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.admin.deleteUser(userId, false); // a real delete, not Supabase's soft delete
    // An account already gone counts as deleted, so a retry after a half-finished attempt completes.
    if (error && !/not.?found/i.test(error.message) && (error as { status?: number }).status !== 404) throw new Error(`Supabase Auth refused the deletion: ${error.message}`);
  },
  async deleteHousehold(ownerUserId, householdId) {
    await requestHouseholdDeletion({ actorUserId: ownerUserId, householdId, idempotencyKey: `admin-delete:${householdId}` });
  },
};

export type DeleteAccountInput = { userId: string; confirmEmail: string; acknowledgeSharedHouseholds: boolean };
export type DeleteAccountResult =
  | { ok: true; householdsDeleted: number; membershipsRemoved: number; remaining: { memberships: number; signIn: boolean }; storage: StorageSweep }
  | { ok: false; reason: string; partial?: { householdsDeleted: number } };

async function audit(admin: AdminUser, targetId: string, outcome: string, detail: Record<string, unknown>) {
  const adminRef = pseudonymizeId(admin.id), targetRef = pseudonymizeId(targetId);
  await recordEvent({
    name: "admin.account_deletion", correlationId: randomUUID(), status: outcome === "completed" ? "success" : outcome === "refused" ? "cancelled" : "failure",
    resourceRef: targetRef, extra: { outcome, adminRef, ...detail },
  });
  await query(`INSERT INTO admin_audit_log(action, admin_ref, target_ref, outcome, detail) VALUES ('delete_account', $1, $2, $3, $4::jsonb)`,
    [adminRef, targetRef, outcome, JSON.stringify(detail)]).catch(() => undefined); // table not applied yet: telemetry still has it
}

async function buildContext(plan: AccountPlan, householdIds: string[]): Promise<DeletionContext> {
  const jobIds = householdIds.length ? (await query<{ id: string }>(`SELECT id::text FROM background_jobs WHERE account_id = ANY($1::uuid[])`, [householdIds]).catch(() => ({ rows: [] }))).rows.map((r) => r.id) : [];
  const keys: string[] = [];
  for (const id of householdIds) for (const k of await householdStorageKeys(id).catch(() => [])) keys.push(k.storageKey);
  return {
    userId: plan.userId, email: norm(plan.email), householdIds,
    householdRefs: householdIds.map((id) => pseudonymizeId(id)).filter((r): r is string => !!r),
    jobIds, storageKeys: keys,
  };
}

/** Runs every rule of one scope. A table that isn't set up in this database has nothing to remove; any other error stops the deletion. */
async function runRules(ctx: DeletionContext, scope: "household" | "user") {
  for (const rule of ACCOUNT_DATA_RULES.filter((r) => r.scope === scope)) {
    try { await query(rule.sql, rule.params(ctx)); }
    catch (error) {
      if ((error as { code?: string })?.code === "42P01" || (error as { code?: string })?.code === "42703") continue; // table or column not there yet
      throw error;
    }
  }
}

const countMemberships = (userId: string) => count(`SELECT count(*) AS n FROM household_members WHERE user_id = $1`, [userId]);

/**
 * Deletes the account. Looks everything up again itself: nothing the browser sent about what is safe is trusted,
 * only the account id and the typed confirmation.
 */
export async function deleteAccount(admin: AdminUser, input: DeleteAccountInput, deps: DeletionDeps = defaultDeps, env: NodeJS.ProcessEnv = process.env): Promise<DeleteAccountResult> {
  const found = await query<{ email: string }>(`SELECT email FROM auth.users WHERE id::text = $1`, [input.userId]).then((r) => r.rows[0]).catch(() => undefined);
  if (!found) return { ok: false, reason: "No account with that id." };
  const lookup = await planAccountDeletion(found.email, admin, env);
  if (!lookup.found) return { ok: false, reason: lookup.reason };
  const plan = lookup.plan;
  if (plan.userId !== input.userId) return { ok: false, reason: "That email now belongs to a different account; nothing was changed." };
  if (plan.blockers.length) { await audit(admin, plan.userId, "refused", { why: "blocked" }); return { ok: false, reason: plan.blockers[0] }; }
  if (norm(input.confirmEmail) !== norm(plan.email)) return { ok: false, reason: "The email you typed doesn't match this account. Nothing was deleted." };
  if (plan.needsSharedAcknowledgement && !input.acknowledgeSharedHouseholds) {
    return { ok: false, reason: "Other people belong to a household this account owns. Tick the box to confirm they should lose it too." };
  }

  let householdsDeleted = 0, membershipsRemoved = 0;
  const owned = plan.households.filter((h) => h.action === "delete_household").map((h) => h.householdId);
  let sweep: StorageSweep = { verified: true, stillQueued: 0 };
  try {
    const ctx = await buildContext(plan, owned);
    // Records with no foreign key to the household go first (they hold only counters and logs), so nothing is left
    // pointing at it if the household's own deletion is interrupted; they run again afterwards for anything a job
    // still in flight wrote in between.
    await runRules(ctx, "household");
    // An export the person made of a household that stays: its file goes too.
    const exportKeys = (await query<{ storage_key: string }>(`SELECT storage_key FROM household_exports WHERE requested_by = $1 AND storage_key IS NOT NULL`, [plan.userId]).catch(() => ({ rows: [] }))).rows;
    if (exportKeys.length) { await enqueueStoragePurge(exportKeys.map((r) => ({ domain: "household-export" as const, storageKey: r.storage_key })), "account_deleted"); ctx.storageKeys.push(...exportKeys.map((r) => r.storage_key)); }
    for (const id of owned) { await deps.deleteHousehold(plan.userId, id); householdsDeleted++; }
    await runRules(ctx, "household");
    membershipsRemoved = await countMemberships(plan.userId);
    await runRules(ctx, "user");
    sweep = await deps.sweepStorage(owned, ctx.storageKeys);
    await runRules(ctx, "household"); // the queue's finished entries, now that the sweep has run
    await deps.deleteAuthUser(plan.userId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    await audit(admin, plan.userId, "failed", { householdsDeleted, membershipsRemoved, errorClass: error instanceof Error ? error.name : "unknown" });
    return { ok: false, reason: `Deletion stopped part-way: ${reason}. Run it again to finish; what was already removed stays removed.`, partial: { householdsDeleted } };
  }

  const left = await count(`SELECT count(*) AS n FROM household_members WHERE user_id = $1`, [plan.userId]);
  const signIn = (await count(`SELECT count(*) AS n FROM auth.users WHERE id::text = $1`, [plan.userId])) > 0;
  const orphanHouseholds = await count(
    `SELECT count(*) AS n FROM accounts a WHERE ${activePredicate("a")} AND NOT EXISTS (SELECT 1 FROM household_members hm WHERE hm.household_id = a.id) AND a.id = ANY($1::uuid[])`,
    [plan.households.map((h) => h.householdId)]);
  await audit(admin, plan.userId, "completed", { householdsDeleted, membershipsRemoved, remainingMemberships: left, signInRemains: signIn, householdsLeftWithoutOwner: orphanHouseholds, storageVerified: sweep.verified, filesStillQueued: sweep.stillQueued });
  return { ok: true, householdsDeleted, membershipsRemoved, remaining: { memberships: left, signIn }, storage: sweep };
}
