/**
 * Admin console: deleting an account (lib/admin/account-deletion.ts, app/admin/accounts).
 *
 *   npm run -s admin:account-deletion-test
 *
 * Offline: PGlite with the production schema and made-up households. The household deletion is the REAL one (the same
 * coordinator an owner's own "delete household" uses); only the call to Supabase Auth is replaced by a stand-in that
 * deletes the row from auth.users. Not covered here (needs a live project): Supabase Auth's own admin API.
 * Covers: who is refused (the admin themself, an allow-listed address, a wrong confirmation, no such account, a
 * shared household without the acknowledgement); what is removed (the household's people, documents, chats, stored
 * file queue, memberships, the sign-in); what is never touched (another household, a member's own sign-in, a
 * household another owner keeps); a half-finished attempt that finishes on retry; the audit record holding no email;
 * and the server action refusing anyone who isn't a recently signed-in admin.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

process.env.DEV_AUTH_ENABLED = "1";
const id = (n: number) => "81000000-0000-4000-8000-" + String(n).padStart(12, "0");
const U = { admin: id(1), solo: id(2), owner: id(3), member: id(4), other: id(5), coA: id(6), coB: id(7), nobody: id(8), leaver: id(9) };
const H = { solo: id(11), shared: id(12), other: id(13), co: id(14), withLeaver: id(15) };
const EMAILS: Record<string, string> = {
  [U.admin]: "boss@example.com", [U.solo]: "solo@example.com", [U.owner]: "family-owner@example.com", [U.member]: "family-member@example.com",
  [U.other]: "other@example.com", [U.coA]: "co-a@example.com", [U.coB]: "co-b@example.com", [U.nobody]: "nobody@example.com", [U.leaver]: "leaver@example.com",
};
const ADMIN = { id: U.admin, email: "boss@example.com" };
const ENV = { ADMIN_EMAILS: "boss@example.com, second-admin@example.com" } as unknown as NodeJS.ProcessEnv;

let ready: Promise<import("@electric-sql/pglite").PGlite> | null = null;
async function database() {
  ready ??= (async () => {
    const { installDatabase } = await import("../r6/fixture");
    const db = await installDatabase();
    await db.exec(`CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, created_at timestamptz NOT NULL DEFAULT now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz);`);
    const fs = await import("node:fs/promises");
    await db.exec(await fs.readFile("sql/admin-audit-log.sql", "utf8"));
    for (const [uid, email] of Object.entries(EMAILS)) await db.query(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())`, [uid, email]);
    await db.query(`INSERT INTO accounts(id,name) VALUES($1,'Solo household'),($2,'Shared household'),($3,'Other household'),($4,'Co-owned household'),($5,'Leaver household')`,
      [H.solo, H.shared, H.other, H.co, H.withLeaver]);
    await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner'),($3,$4,'owner'),($3,$5,'member'),($6,$7,'owner'),($8,$9,'owner'),($8,$10,'owner'),($11,$12,'owner'),($11,$13,'member')`,
      [H.solo, U.solo, H.shared, U.owner, U.member, H.other, U.other, H.co, U.coA, U.coB, H.withLeaver, U.admin, U.leaver]);
    const person = (n: number, account: string) => id(100 + n);
    await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES($1,$2,'Solo Person','self'),($3,$4,'Shared Person','self'),($5,$6,'Other Person','self'),($7,$8,'Co Person','self')`,
      [person(1, H.solo), H.solo, person(2, H.shared), H.shared, person(3, H.other), H.other, person(4, H.co), H.co]);
    const doc = (n: number, account: string, p: string) => db.query(
      `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,original_filename,storage_key,file_hash,processing_status,quarantine_status)
       VALUES($1,$2,$3,'Example Insurance','Example Shield',$4,$5,$6,'ready','scan_clean')`, [id(200 + n), account, p, `file-${n}.pdf`, `${account}/key-${n}`, `hash-${n}`]);
    await doc(1, H.solo, person(1, H.solo)); await doc(2, H.solo, person(1, H.solo));
    await doc(3, H.shared, person(2, H.shared));
    await doc(4, H.other, person(3, H.other));
    await doc(5, H.co, person(4, H.co));
    await db.query(`INSERT INTO chat_conversations(id,account_id,family_member_id,title) VALUES($1,$2,$3,'t')`, [id(300), H.solo, person(1, H.solo)]).catch(() => undefined);
    return db;
  })();
  return ready;
}

const rows = async (sql: string, params: unknown[] = []) => (await (await database()).query<Record<string, unknown>>(sql, params)).rows;
const n = async (sql: string, params: unknown[] = []) => Number((await rows(sql, params))[0]?.n ?? 0);
const exists = (table: string, col: string, v: string) => n(`SELECT count(*) AS n FROM ${table} WHERE ${col} = $1`, [v]).then((c) => c > 0);

async function deps(opts: { failAuth?: () => boolean } = {}) {
  const calls: string[] = [];
  const real = await import("@/lib/admin/account-deletion");
  return {
    calls,
    deps: {
      deleteHousehold: real.defaultDeps.deleteHousehold,
      async deleteAuthUser(userId: string) {
        calls.push(userId);
        if (opts.failAuth?.()) throw new Error("Supabase Auth is unreachable");
        await (await database()).query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
      },
    },
  };
}

test("refused: your own account, an allow-listed address, no such account, a wrong confirmation", async () => {
  await database();
  const { deleteAccount, planAccountDeletion } = await import("@/lib/admin/account-deletion");
  const d = await deps();

  const self = await planAccountDeletion("BOSS@example.com ", ADMIN, ENV);
  assert.ok(self.found && self.plan.blockers.length === 1, "the admin's own account is blocked, whatever the case");
  assert.deepEqual(await deleteAccount(ADMIN, { userId: U.admin, confirmEmail: "boss@example.com", acknowledgeSharedHouseholds: true }, d.deps, ENV),
    { ok: false, reason: "This is your own admin account. It can't be deleted from the console." });

  // Another allow-listed admin (not the one signed in) is protected too.
  await (await database()).query(`INSERT INTO auth.users(id,email) VALUES($1,'second-admin@example.com') ON CONFLICT DO NOTHING`, [id(50)]);
  const other = await deleteAccount(ADMIN, { userId: id(50), confirmEmail: "second-admin@example.com", acknowledgeSharedHouseholds: true }, d.deps, ENV);
  assert.equal(other.ok, false);
  assert.match((other as { reason: string }).reason, /admin list/);

  assert.deepEqual(await planAccountDeletion("ghost@example.com", ADMIN, ENV), { found: false, reason: "No account has that email address." });
  assert.equal((await planAccountDeletion("not an email", ADMIN, ENV)).found, false);
  assert.equal((await deleteAccount(ADMIN, { userId: id(99), confirmEmail: "x@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV)).ok, false, "an id that isn't an account");

  const wrong = await deleteAccount(ADMIN, { userId: U.solo, confirmEmail: "solo@example.org", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.equal(wrong.ok, false);
  assert.equal(d.calls.length, 0, "Supabase Auth was never called");
  assert.ok(await exists("accounts", "id::text", H.solo), "the household is still there after a wrong confirmation");
  assert.ok(await exists("auth.users", "id::text", U.solo));
});

test("the plan says what will go, without file names", async () => {
  const { planAccountDeletion } = await import("@/lib/admin/account-deletion");
  const r = await planAccountDeletion("solo@example.com", ADMIN, ENV);
  assert.ok(r.found);
  if (!r.found) return;
  const h = r.plan.households[0];
  assert.equal(h.action, "delete_household");
  assert.deepEqual([h.people, h.documents, h.documentsRead, h.storedFiles], [1, 2, 2, 2]);
  assert.equal(r.plan.needsSharedAcknowledgement, false);
  assert.ok(!JSON.stringify(r.plan).includes("file-1.pdf") && !JSON.stringify(r.plan).includes("key-1"));
});

test("a shared household needs the acknowledgement, and then goes whole; the member's own sign-in stays", async () => {
  const { deleteAccount, planAccountDeletion } = await import("@/lib/admin/account-deletion");
  const plan = await planAccountDeletion("family-owner@example.com", ADMIN, ENV);
  assert.ok(plan.found && plan.plan.needsSharedAcknowledgement && plan.plan.households[0].otherMembers.join() === "family-member@example.com");
  const d = await deps();
  const refused = await deleteAccount(ADMIN, { userId: U.owner, confirmEmail: "family-owner@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.equal(refused.ok, false);
  assert.ok(await exists("accounts", "id::text", H.shared), "nothing was deleted without the acknowledgement");
  assert.equal(d.calls.length, 0);

  const done = await deleteAccount(ADMIN, { userId: U.owner, confirmEmail: " Family-Owner@Example.com", acknowledgeSharedHouseholds: true }, d.deps, ENV);
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(await exists("accounts", "id::text", H.shared), false);
  assert.equal(await n(`SELECT count(*) AS n FROM household_members WHERE household_id = $1 OR user_id = $2`, [H.shared, U.owner]), 0, "no membership of either person is left behind");
  assert.equal(await n(`SELECT count(*) AS n FROM family_members WHERE account_id = $1`, [H.shared]), 0);
  assert.equal(await n(`SELECT count(*) AS n FROM policies WHERE account_id = $1`, [H.shared]), 0);
  assert.equal(await exists("auth.users", "id::text", U.owner), false, "the owner's sign-in is gone");
  assert.ok(await exists("auth.users", "id::text", U.member), "the member's own sign-in is not deleted");
  assert.deepEqual(d.calls, [U.owner]);
});

test("a solo owner: the household, people, documents, chats and memberships go; the file objects are queued for removal; other households are untouched", async () => {
  const { deleteAccount } = await import("@/lib/admin/account-deletion");
  const before = {
    other: [await n(`SELECT count(*) AS n FROM policies WHERE account_id = $1`, [H.other]), await n(`SELECT count(*) AS n FROM family_members WHERE account_id = $1`, [H.other])],
    co: await n(`SELECT count(*) AS n FROM policies WHERE account_id = $1`, [H.co]),
  };
  const d = await deps();
  const done = await deleteAccount(ADMIN, { userId: U.solo, confirmEmail: "solo@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.ok(done.ok, JSON.stringify(done));
  if (done.ok) assert.deepEqual([done.householdsDeleted, done.remaining.memberships, done.remaining.signIn], [1, 0, false]);
  for (const table of ["family_members", "policies", "chat_conversations"]) assert.equal(await n(`SELECT count(*) AS n FROM ${table} WHERE account_id = $1`, [H.solo]), 0, table);
  assert.equal(await exists("accounts", "id::text", H.solo), false);
  assert.equal(await exists("auth.users", "id::text", U.solo), false);
  const queued = await rows(`SELECT storage_key FROM storage_purge_queue WHERE storage_key LIKE $1`, [`${H.solo}/%`]);
  const purged = await rows(`SELECT count(*) AS n FROM storage_purge_queue WHERE storage_key LIKE $1 AND purged_at IS NOT NULL`, [`${H.solo}/%`]);
  assert.ok(queued.length === 2, "both stored files were queued for removal: " + queued.length + " (" + Number(purged[0].n) + " already removed)");
  // Household isolation: nothing of anyone else's changed.
  assert.deepEqual([await n(`SELECT count(*) AS n FROM policies WHERE account_id = $1`, [H.other]), await n(`SELECT count(*) AS n FROM family_members WHERE account_id = $1`, [H.other])], before.other);
  assert.equal(await n(`SELECT count(*) AS n FROM policies WHERE account_id = $1`, [H.co]), before.co);
  assert.ok(await exists("auth.users", "id::text", U.other));
});

test("a member only leaves; a co-owner leaves and the household stays with the other owner", async () => {
  const { planAccountDeletion, deleteAccount } = await import("@/lib/admin/account-deletion");
  const d = await deps();
  const co = await planAccountDeletion("co-a@example.com", ADMIN, ENV);
  assert.ok(co.found && co.plan.households[0].action === "leave" && co.plan.households[0].note?.includes("Another owner"));
  const done = await deleteAccount(ADMIN, { userId: U.coA, confirmEmail: "co-a@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.ok(done.ok, JSON.stringify(done));
  if (done.ok) assert.deepEqual([done.householdsDeleted, done.membershipsRemoved], [0, 1]);
  assert.ok(await exists("accounts", "id::text", H.co), "the co-owned household stays");
  assert.equal(await n(`SELECT count(*) AS n FROM policies WHERE account_id = $1`, [H.co]), 1);
  assert.deepEqual((await rows(`SELECT user_id::text AS u, role FROM household_members WHERE household_id = $1`, [H.co])).map((r) => [r.u, r.role]), [[U.coB, "owner"]]);

  const leaver = await deleteAccount(ADMIN, { userId: U.leaver, confirmEmail: "leaver@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.ok(leaver.ok, JSON.stringify(leaver));
  assert.ok(await exists("accounts", "id::text", H.withLeaver), "a household the person only belonged to stays");
  assert.equal(await n(`SELECT count(*) AS n FROM household_members WHERE user_id = $1`, [U.leaver]), 0);
});

test("a half-finished deletion (Auth unreachable) says so, leaves no data behind a sign-in, and finishes on retry", async () => {
  const { deleteAccount } = await import("@/lib/admin/account-deletion");
  await (await database()).query(`INSERT INTO auth.users(id,email) VALUES($1,'retry@example.com')`, [id(60)]);
  await (await database()).query(`INSERT INTO accounts(id,name) VALUES($1,'Retry household')`, [id(61)]);
  await (await database()).query(`INSERT INTO household_members(household_id,user_id,role) VALUES($1,$2,'owner')`, [id(61), id(60)]);
  let down = true;
  const d = await deps({ failAuth: () => down });
  const first = await deleteAccount(ADMIN, { userId: id(60), confirmEmail: "retry@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.equal(first.ok, false);
  assert.match((first as { reason: string }).reason, /stopped part-way/);
  assert.equal(await exists("accounts", "id::text", id(61)), false, "the data went first");
  assert.ok(await exists("auth.users", "id::text", id(60)), "the sign-in is still there to retry against");
  down = false;
  const second = await deleteAccount(ADMIN, { userId: id(60), confirmEmail: "retry@example.com", acknowledgeSharedHouseholds: false }, d.deps, ENV);
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(await exists("auth.users", "id::text", id(60)), false);
});

test("every attempt is logged, with no email address in the record", async () => {
  const log = await rows(`SELECT action, admin_ref, target_ref, outcome, detail::text AS detail FROM admin_audit_log ORDER BY id`);
  assert.ok(log.length >= 6);
  const outcomes = new Set(log.map((r) => r.outcome));
  for (const o of ["completed", "refused", "failed"]) assert.ok(outcomes.has(o), `${o} is recorded`);
  assert.ok(log.every((r) => r.action === "delete_account" && typeof r.target_ref === "string" && typeof r.admin_ref === "string"));
  const text = JSON.stringify(log);
  for (const e of Object.values(EMAILS)) assert.ok(!text.includes(e), `${e} is not in the audit log`);
  assert.ok(!text.includes("@example.com"));
});

test("the server action refuses anyone who isn't a recently signed-in admin", async () => {
  const db = await database();
  const { deleteAccountAction } = await import("@/app/admin/accounts/actions");
  const form = (userId: string, email: string) => { const f = new FormData(); f.set("userId", userId); f.set("confirmEmail", email); f.set("acknowledgeShared", "on"); return f; };
  const target = id(70);
  await db.query(`INSERT INTO auth.users(id,email) VALUES($1,'victim@example.com')`, [target]);
  process.env.DEV_ACCOUNT_ID = id(71); // the dev session's own user

  delete process.env.ADMIN_EMAILS;
  let r = await deleteAccountAction({ done: null }, form(target, "victim@example.com"));
  assert.deepEqual(r.done, { ok: false, reason: "Not allowed." }, "no allow-list: nobody");
  process.env.ADMIN_EMAILS = "someone-else@example.com";
  r = await deleteAccountAction({ done: null }, form(target, "victim@example.com"));
  assert.deepEqual(r.done, { ok: false, reason: "Not allowed." }, "signed in but not on the list");

  process.env.ADMIN_EMAILS = "dev@localhost";
  process.env.DEV_LAST_SIGN_IN_AT = "2026-01-01T00:00:00Z";
  r = await deleteAccountAction({ done: null }, form(target, "victim@example.com"));
  assert.match(String((r.done as { reason?: string }).reason), /sign in again/, "a stale session is asked to sign in again");
  delete process.env.DEV_LAST_SIGN_IN_AT;
  r = await deleteAccountAction({ done: null }, form("not-an-id", "victim@example.com"));
  assert.equal(r.done?.ok, false);

  assert.ok(await exists("auth.users", "id::text", target), "the account survived every refused call");
  delete process.env.ADMIN_EMAILS; delete process.env.DEV_ACCOUNT_ID;
});

test("the action and the page keep their checks (a source guard: it fails if one is removed)", () => {
  const action = readFileSync("app/admin/accounts/actions.ts", "utf8");
  assert.match(action, /isAdminUser\(user\)/);
  assert.match(action, /requireRecentAuthentication\(/);
  assert.match(readFileSync("app/admin/accounts/page.tsx", "utf8"), /await requireAdminOrNotFound\(\)/);
  const lib = readFileSync("lib/admin/account-deletion.ts", "utf8");
  assert.match(lib, /adminEmails\(env\)\.has/, "an allow-listed address is protected");
  assert.match(lib, /u\.id === admin\.id/, "the signed-in admin is protected");
});
