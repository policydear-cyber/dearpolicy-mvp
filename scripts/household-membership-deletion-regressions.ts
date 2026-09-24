/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening):
 * household-membership deletion -- owner-removes-member AND
 * member-leaves-household -- through the REAL route:
 * app/api/household/members/[userId]/route.ts's DELETE handler.
 *
 * Checkpoint 14d integrity correction: package.json has referenced
 * `security:household-membership-deletion-test` -> this exact file since
 * Checkpoint 7, but this file did not exist in the committed repo until
 * this checkpoint -- confirmed missing via a fresh GITHUB_GET_A_TREE
 * listing against the real branch head, not a local-checkout artifact.
 * Prior PR #16 checkpoints (see PR body's "Checkpoint 14d" section for
 * exactly which ones) reported running this suite and getting real pass
 * counts -- those reports were false.
 *
 * As with the family-member suite in this same checkpoint: the REAL route
 * calls lib/household/repo.ts's removeMember() directly, NOT
 * lib/lifecycle/coordinator.ts's requestHouseholdMemberRemoval()/
 * requestHouseholdLeave() (which wrap removeMember() but ALSO write
 * deletion_requests/deletion_audit_log bookkeeping) -- grepping app/ and
 * lib/ confirms the coordinator's own wrapper functions have no caller
 * anywhere outside lib/lifecycle/coordinator.ts itself. This suite tests
 * the REAL route/removeMember() path as it actually behaves in
 * production (a plain membership DELETE with no lifecycle bookkeeping,
 * authorized by RLS's household_members_delete policy), not the unused
 * coordinator wrapper -- the same discrepancy flagged in PR #16's
 * Checkpoint 14d section for the family-member suite.
 *
 * Mirrors scripts/full-household-e2e-regressions.ts's established
 * pattern: PGlite-backed pool.query/pool.connect patching, DEV_AUTH_ENABLED
 * + DEV_ACCOUNT_ID identity, real route handler functions invoked with a
 * constructed NextRequest. Run as its own separate process.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { NextRequest } from "next/server";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

const SQL_FILES = ["sql/schema.sql", "sql/household-rls.sql", "sql/lifecycle.sql"];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

function asUser(userId: string) {
  process.env.DEV_AUTH_ENABLED = "1";
  process.env.DEV_ACCOUNT_ID = userId;
}

function requestFor(url: string, opts: { household?: string; method?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.household) headers["cookie"] = `${ACTIVE_HOUSEHOLD_COOKIE}=${opts.household}`;
  return new NextRequest(url, { method: opts.method ?? "GET", headers });
}

async function seedHousehold(name: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [name]);
  return result.rows[0].id;
}

async function addMember(householdId: string, userId: string, role: "owner" | "member") {
  await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, $3)`, [householdId, userId, role]);
}

async function main() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }
  await db.exec("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;");

  let tail = Promise.resolve();
  const acquire = async () => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  };
  const execute = async (text: string, params: unknown[] = []) => {
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
    }
    const result = await db.query(text, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = (async (text: string, params: unknown[] = []) => {
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release } as any;
  }) as typeof pool.connect;

  try {
    const { DELETE: deleteMember } = await import("@/app/api/household/members/[userId]/route");
    const { GET: getMembers } = await import("@/app/api/household/members/route");

    await testAsync("DELETE /api/household/members/[userId]: owner removes another member -- real removal, membership row really gone", async () => {
      const householdId = await seedHousehold("Household Owner Removes");
      const owner = "c0000000-0000-4000-8000-000000000001";
      const target = "c0000000-0000-4000-8000-000000000002";
      await addMember(householdId, owner, "owner");
      await addMember(householdId, target, "member");

      asUser(owner);
      const res = await deleteMember(requestFor(`http://localhost/api/household/members/${target}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ userId: target }) } as any);
      assert.equal(res.status, 200);

      const row = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, target]);
      assert.equal(row.rows.length, 0, "the membership row must be really gone, not soft-deleted");
    });

    await testAsync("DELETE /api/household/members/[userId]: a member removes THEMSELVES (leave) -- same route, same underlying operation", async () => {
      const householdId = await seedHousehold("Household Leave");
      const owner = "c0000000-0000-4000-8000-000000000003";
      const leaver = "c0000000-0000-4000-8000-000000000004";
      await addMember(householdId, owner, "owner");
      await addMember(householdId, leaver, "member");

      asUser(leaver);
      const res = await deleteMember(requestFor(`http://localhost/api/household/members/${leaver}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ userId: leaver }) } as any);
      assert.equal(res.status, 200);

      const row = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, leaver]);
      assert.equal(row.rows.length, 0);
    });

    await testAsync("DELETE /api/household/members/[userId]: refuses (409) to remove the household's LAST remaining owner", async () => {
      const householdId = await seedHousehold("Household Sole Owner");
      const soleOwner = "c0000000-0000-4000-8000-000000000005";
      const member = "c0000000-0000-4000-8000-000000000006";
      await addMember(householdId, soleOwner, "owner");
      await addMember(householdId, member, "member");

      asUser(soleOwner);
      const res = await deleteMember(requestFor(`http://localhost/api/household/members/${soleOwner}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ userId: soleOwner }) } as any);
      assert.equal(res.status, 409);

      const row = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, soleOwner]);
      assert.equal(row.rows.length, 1, "a refused last-owner removal must never partially apply");
    });

    await testAsync("DELETE /api/household/members/[userId]: a member of a DIFFERENT household cannot remove a member of this household (real cross-household authorization boundary)", async () => {
      const householdA = await seedHousehold("Household A Membership");
      const ownerA = "c0000000-0000-4000-8000-000000000007";
      const memberA = "c0000000-0000-4000-8000-000000000008";
      await addMember(householdA, ownerA, "owner");
      await addMember(householdA, memberA, "member");

      const householdB = await seedHousehold("Household B Membership");
      const ownerB = "c0000000-0000-4000-8000-000000000009";
      await addMember(householdB, ownerB, "owner");

      asUser(ownerB);
      const res = await deleteMember(requestFor(`http://localhost/api/household/members/${memberA}`, { household: householdB, method: "DELETE" }), { params: Promise.resolve({ userId: memberA }) } as any);
      assert.equal(res.status, 404, "a foreign household's membership target must be indistinguishable from a genuinely missing one");

      const row = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdA, memberA]);
      assert.equal(row.rows.length, 1, "the victim household's membership must never be touched by a cross-household attempt");
    });

    await testAsync("DELETE /api/household/members/[userId]: an ordinary (non-owner) member cannot remove a DIFFERENT member of the SAME household", async () => {
      const householdId = await seedHousehold("Household Non-Owner Attempt");
      const owner = "c0000000-0000-4000-8000-00000000000a";
      const memberX = "c0000000-0000-4000-8000-00000000000b";
      const memberY = "c0000000-0000-4000-8000-00000000000c";
      await addMember(householdId, owner, "owner");
      await addMember(householdId, memberX, "member");
      await addMember(householdId, memberY, "member");

      asUser(memberX);
      const res = await deleteMember(requestFor(`http://localhost/api/household/members/${memberY}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ userId: memberY }) } as any);
      assert.equal(res.status, 404, "RLS's household_members_delete policy (owner OR self) must refuse a non-owner removing someone else");

      const row = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [householdId, memberY]);
      assert.equal(row.rows.length, 1);
    });

    await testAsync("a removed member is excluded from GET /api/household/members (the real downstream roster-read path) immediately", async () => {
      const householdId = await seedHousehold("Household Roster");
      const owner = "c0000000-0000-4000-8000-00000000000d";
      const target = "c0000000-0000-4000-8000-00000000000e";
      await addMember(householdId, owner, "owner");
      await addMember(householdId, target, "member");

      asUser(owner);
      const before = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
      assert.equal((await before.json()).members.length, 2);

      const del = await deleteMember(requestFor(`http://localhost/api/household/members/${target}`, { household: householdId, method: "DELETE" }), { params: Promise.resolve({ userId: target }) } as any);
      assert.equal(del.status, 200);

      const after = await getMembers(requestFor("http://localhost/api/household/members", { household: householdId }));
      const afterBody = await after.json();
      assert.equal(afterBody.members.length, 1);
      assert.ok(!afterBody.members.some((m: { userId: string }) => m.userId === target), "the removed member must never appear on the real GET /api/household/members read path again");
    });

    console.log(`household-membership-deletion regressions passed: ${cases} real, authenticated, route-level cases (DELETE /api/household/members/[userId], covering both owner-removes-member and member-leaves) -- happy path for both directions, last-owner protection, real cross-household authorization boundary, non-owner-removing-someone-else refusal, downstream exclusion from GET /api/household/members. NOTE: this suite tests removeMember()'s REAL production path, not lib/lifecycle/coordinator.ts's unused requestHouseholdMemberRemoval()/requestHouseholdLeave() wrappers -- see file header, reported to PR #16 as follow-up.`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
