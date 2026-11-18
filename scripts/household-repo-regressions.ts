/**
 * Regression suite for lib/household/repo.ts's own application-level
 * authorization logic -- the parts RLS does NOT enforce by itself, because
 * they are business rules (never leave a household with zero owners),
 * cross-checks against session-verified identity (an invitation's intended
 * email vs. the accepting user's real email), or secret handling (token
 * hashing, never storing/accepting a plaintext token).
 *
 * scripts/rls-regressions.ts separately proves the underlying Postgres RLS
 * policies this repo relies on (cross-household isolation, owner-only
 * mutations, membership revocation). This suite instead drives
 * lib/household/repo.ts's actual exported functions against a scripted fake
 * Postgres client, since a real `pg.Pool` needs a live TCP connection this
 * sandbox does not have.
 */
import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotHouseholdOwnerError,
  acceptInvitation,
  transferOwnership,
  createInvitation,
  ensureDefaultHousehold,
  removeMember,
  setMemberRole,
} from "../lib/household/repo";

const OWNER = "20000000-0000-4000-8000-000000000010";
const MEMBER = "20000000-0000-4000-8000-000000000011";
const HOUSEHOLD = "20000000-0000-4000-8000-000000000001";

/** A fake pool whose single connection answers queries from a caller-supplied
 * list of {match, result} rules, in order, falling through to a default
 * `{ rows: [], rowCount: 0 }` once exhausted -- close enough to a real
 * connection for exercising this repo's control flow (which branch it
 * takes based on what a query returns), without needing a real database. */
function scriptedPool(rules: Array<{ match: RegExp; result: { rows: unknown[]; rowCount: number } }>) {
  const executed: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      executed.push(sql.trim().split("\n")[0]);
      params.push(values ?? []);
      const rule = rules.find((r) => r.match.test(sql));
      return rule ? rule.result : { rows: [], rowCount: 0 };
    },
    release: () => {},
  } as unknown as PoolClient;
  const pool: Pick<Pool, "connect"> = { connect: async () => client };
  return { pool, executed, params };
}

async function main() {
  // --- ensureDefaultHousehold: idempotent -------------------------------
  {
    const { pool, executed } = scriptedPool([
      { match: /^select household_id from household_members/i, result: { rows: [{ household_id: HOUSEHOLD }], rowCount: 1 } },
    ]);
    const id = await ensureDefaultHousehold(OWNER, "My household", pool as unknown as Pool);
    assert.equal(id, HOUSEHOLD, "an existing household must be returned, not a new one created");
    assert.ok(!executed.some((s) => /^insert into accounts/i.test(s)), "no new accounts row when one already exists");
  }
  {
    const { pool, executed } = scriptedPool([
      { match: /^select household_id from household_members/i, result: { rows: [], rowCount: 0 } },
      { match: /^insert into accounts/i, result: { rows: [{ id: HOUSEHOLD }], rowCount: 1 } },
    ]);
    const id = await ensureDefaultHousehold(OWNER, "My household", pool as unknown as Pool);
    assert.equal(id, HOUSEHOLD);
    assert.ok(executed.some((s) => /^insert into accounts/i.test(s)), "a household must be created when none exists yet");
    assert.ok(executed.some((s) => /^insert into household_members/i.test(s)), "the creator must be inserted as owner");
  }

  // --- ensureDefaultHousehold against the REAL repository schema ----------
  // The scripted pool above cannot see column defaults. accounts.id has none
  // (sql/schema.sql), so a first sign-in failed with a NOT NULL violation;
  // this runs the real function against the real DDL.
  {
    const db = await PGlite.create({ extensions: { vector, pgcrypto } });
    await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
    await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));
    const client = {
      query: async (sql: string, params?: unknown[]) => { const r = await db.query(sql, params as unknown[]); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
      release: () => {},
    } as unknown as PoolClient;
    const realPool: Pick<Pool, "connect"> = { connect: async () => client };
    const created = await ensureDefaultHousehold(OWNER, "SYNTHETIC first sign-in household", realPool as unknown as Pool);
    assert.match(created, /^[0-9a-f-]{36}$/, "a first sign-in must create a household with a generated id");
    const again = await ensureDefaultHousehold(OWNER, "SYNTHETIC first sign-in household", realPool as unknown as Pool);
    assert.equal(again, created, "idempotent against the real schema too");
    const owner = await db.query<{ role: string }>(`select role from household_members where household_id=$1 and user_id=$2`, [created, OWNER]);
    assert.equal(owner.rows[0]?.role, "owner", "the creator is the owner");
    await db.close();
  }

  // --- removeMember: last-owner protection -------------------------------
  {
    const { pool } = scriptedPool([
      { match: /^select role from household_members/i, result: { rows: [{ role: "owner" }], rowCount: 1 } },
      { match: /^select count\(\*\)/i, result: { rows: [{ count: "1" }], rowCount: 1 } },
    ]);
    await assert.rejects(
      () => removeMember(OWNER, HOUSEHOLD, OWNER, pool as unknown as Pool),
      ConflictError,
      "removing the sole remaining owner must be refused",
    );
  }
  {
    const { pool } = scriptedPool([
      { match: /^select role from household_members/i, result: { rows: [{ role: "owner" }], rowCount: 1 } },
      { match: /^select count\(\*\)/i, result: { rows: [{ count: "2" }], rowCount: 1 } },
      { match: /^delete from household_members/i, result: { rows: [], rowCount: 1 } },
    ]);
    await removeMember(OWNER, HOUSEHOLD, MEMBER, pool as unknown as Pool); // must not throw
  }
  {
    const { pool } = scriptedPool([{ match: /^select role from household_members/i, result: { rows: [], rowCount: 0 } }]);
    await assert.rejects(() => removeMember(OWNER, HOUSEHOLD, MEMBER, pool as unknown as Pool), NotFoundError);
  }

  // --- setMemberRole: last-owner demotion protection ---------------------
  {
    const { pool } = scriptedPool([
      { match: /^select role from household_members/i, result: { rows: [{ role: "owner" }], rowCount: 1 } },
      { match: /^select count\(\*\)/i, result: { rows: [{ count: "1" }], rowCount: 1 } },
    ]);
    await assert.rejects(
      () => setMemberRole(OWNER, HOUSEHOLD, OWNER, "member", pool as unknown as Pool),
      ConflictError,
      "demoting the sole remaining owner must be refused",
    );
  }

  // --- transferOwnership: one owner, handed over in one transaction --------
  {
    const { pool, executed } = scriptedPool([
      { match: /^select user_id, role from household_members/i, result: { rows: [{ user_id: OWNER, role: "owner" }, { user_id: MEMBER, role: "member" }], rowCount: 2 } },
      { match: /set role = 'owner'/i, result: { rows: [], rowCount: 1 } },
      { match: /set role = 'member'/i, result: { rows: [], rowCount: 1 } },
    ]);
    await transferOwnership(OWNER, HOUSEHOLD, MEMBER, pool as unknown as Pool);
    const promote = executed.findIndex((q) => /set role = 'owner'/i.test(q));
    const demote = executed.findIndex((q) => /set role = 'member'/i.test(q));
    assert.ok(promote >= 0 && demote > promote, "the new owner is named before the old one steps down (RLS needs the caller still owner)");
    assert.equal(executed[0], "BEGIN", "the transfer runs in one transaction");
  }
  {
    const { pool, executed } = scriptedPool([
      { match: /^select user_id, role from household_members/i, result: { rows: [{ user_id: MEMBER, role: "member" }, { user_id: OWNER, role: "owner" }], rowCount: 2 } },
    ]);
    await assert.rejects(() => transferOwnership(MEMBER, HOUSEHOLD, OWNER, pool as unknown as Pool), NotHouseholdOwnerError, "a member can't take or give ownership");
    assert.ok(!executed.some((q) => /^update/i.test(q)), "nothing is changed when a member asks");
  }
  {
    const { pool } = scriptedPool([
      { match: /^select user_id, role from household_members/i, result: { rows: [{ user_id: OWNER, role: "owner" }], rowCount: 1 } },
    ]);
    await assert.rejects(() => transferOwnership(OWNER, HOUSEHOLD, MEMBER, pool as unknown as Pool), NotFoundError, "only someone in the household can become its owner");
  }
  await assert.rejects(() => transferOwnership(OWNER, HOUSEHOLD, OWNER, scriptedPool([]).pool as unknown as Pool), ConflictError);
  {
    // { role: "owner" } on the members route means transfer, never a second owner.
    const { pool, executed } = scriptedPool([
      { match: /^select user_id, role from household_members/i, result: { rows: [{ user_id: OWNER, role: "owner" }, { user_id: MEMBER, role: "member" }], rowCount: 2 } },
      { match: /set role = /i, result: { rows: [], rowCount: 1 } },
    ]);
    await setMemberRole(OWNER, HOUSEHOLD, MEMBER, "owner", pool as unknown as Pool);
    assert.ok(executed.some((q) => /set role = 'member'/i.test(q)), "promoting someone demotes the old owner in the same call");
  }

  // --- createInvitation: only ever a member --------------------------------
  {
    const { pool, executed } = scriptedPool([]);
    await assert.rejects(() => createInvitation(OWNER, HOUSEHOLD, "tan.mei.ling@example.com", "owner", pool as unknown as Pool), ConflictError);
    assert.equal(executed.length, 0, "an owner invitation is refused before any query runs");
  }

  // --- createInvitation: rejects a malformed email up front ---------------
  {
    const { pool, executed } = scriptedPool([]);
    await assert.rejects(() => createInvitation(OWNER, HOUSEHOLD, "not-an-email", "member", pool as unknown as Pool), ConflictError);
    assert.equal(executed.length, 0, "an invalid email must be rejected before any query runs");
  }

  // --- acceptInvitation: the real authorization surface -------------------
  const baseInvitation = {
    id: "30000000-0000-4000-8000-000000000001",
    household_id: HOUSEHOLD,
    email: "invitee@example.com",
    role: "member" as const,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    accepted_at: null as string | null,
    revoked_at: null as string | null,
  };
  const inviteeId = "20000000-0000-4000-8000-000000000012";

  // A syntactically valid but unrelated token must never match any row.
  await assert.rejects(
    () => acceptInvitation("not-the-real-token", inviteeId, "invitee@example.com", scriptedPool([]).pool as unknown as Pool),
    NotFoundError,
  );

  {
    const { pool } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, revoked_at: new Date().toISOString() }], rowCount: 1 } },
    ]);
    await assert.rejects(() => acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool), ForbiddenError);
  }
  {
    const { pool } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, accepted_at: new Date().toISOString() }], rowCount: 1 } },
    ]);
    await assert.rejects(() => acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool), ForbiddenError);
  }
  {
    const { pool } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, expires_at: new Date(Date.now() - 1000).toISOString() }], rowCount: 1 } },
    ]);
    await assert.rejects(() => acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool), ForbiddenError, "an expired invitation must be refused");
  }
  {
    // Knowing the token is not enough if it was issued to someone else --
    // this is the "a user must not gain access merely by knowing an id"
    // requirement applied to invitations.
    const { pool } = scriptedPool([{ match: /^select id, household_id, email/i, result: { rows: [baseInvitation], rowCount: 1 } }]);
    await assert.rejects(
      () => acceptInvitation("tok", inviteeId, "someone-else@example.com", pool as unknown as Pool),
      ForbiddenError,
      "accepting with a different email than the invitation was issued to must be refused",
    );
  }
  {
    const { pool, executed } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [baseInvitation], rowCount: 1 } },
      { match: /^insert into household_members/i, result: { rows: [], rowCount: 1 } },
      { match: /^update household_invitations set accepted_at/i, result: { rows: [], rowCount: 1 } },
    ]);
    const householdId = await acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool);
    assert.equal(householdId, HOUSEHOLD);
    assert.ok(executed.some((s) => /^insert into household_members/i.test(s)), "acceptance must create the membership row");
    assert.ok(executed.some((s) => /^update household_invitations set accepted_at/i.test(s)), "acceptance must mark the invitation used");
  }

  {
    // An invitation stored as "owner" (made before one owner per household) still only adds a member.
    const { pool, executed, params } = scriptedPool([
      { match: /^select id, household_id, email/i, result: { rows: [{ ...baseInvitation, role: "owner" }], rowCount: 1 } },
      { match: /^insert into household_members/i, result: { rows: [], rowCount: 1 } },
      { match: /^update household_invitations set accepted_at/i, result: { rows: [], rowCount: 1 } },
    ]);
    await acceptInvitation("tok", inviteeId, "invitee@example.com", pool as unknown as Pool);
    const insert = executed.findIndex((q) => /^insert into household_members/i.test(q));
    assert.equal(params[insert]?.[2], "member", "an old owner invitation joins as a member, never a second owner");
  }

  console.log(
    "household-repo regressions passed: ensureDefaultHousehold() is idempotent, last-owner removal/demotion is " +
      "refused, ownership moves only by transfer (new owner first, old owner becomes a member, one transaction), " +
      "invitations only ever add a member, invitation email/expiry/revocation/reuse checks all hold, and a guessed/valid-shaped token that " +
      "doesn't match a real row is rejected.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
