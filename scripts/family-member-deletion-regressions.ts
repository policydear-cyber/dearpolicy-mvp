/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening):
 * family-member deletion, through the REAL route --
 * app/api/family/[id]/route.ts's DELETE handler.
 *
 * Checkpoint 14d integrity correction: package.json has referenced
 * `security:family-member-deletion-test` -> this exact file since
 * Checkpoint 7, but this file did not exist in the committed repo until
 * this checkpoint -- confirmed missing via a fresh GITHUB_GET_A_TREE
 * listing against the real branch head, not a local-checkout artifact.
 * Prior PR #16 checkpoints (see PR body's "Checkpoint 14d" section for
 * exactly which ones) reported running this suite and getting real pass
 * counts -- those reports were false.
 *
 * A genuine, separately-reported finding from writing this suite:
 * lib/lifecycle/coordinator.ts's requestFamilyMemberDeletion() /
 * finishFamilyMemberDeletion() (soft-delete via transitionLifecycle to
 * pending_deletion, then deletion_requests/deletion_audit_log bookkeeping)
 * is NOT what actually runs in production. Grepping app/ and lib/ for
 * every coordinator export shows the ONLY caller of
 * requestFamilyMemberDeletion anywhere in this codebase is
 * lib/lifecycle/coordinator.ts itself -- app/api/family/[id]/route.ts's
 * real DELETE handler performs its own inline hard
 * `DELETE FROM family_members WHERE id=$1 AND account_id=$2 AND
 * lifecycle_state='active'` after its own, separately-duplicated
 * usage-count precondition, never calling the coordinator, never writing
 * a deletion_requests/deletion_audit_log row, and never going through
 * transitionLifecycle(). This suite therefore tests the REAL route as it
 * REALLY behaves (a permanent hard delete with no lifecycle bookkeeping),
 * not the unused coordinator function -- exactly what this checkpoint's
 * "verify everything yourself, don't propagate assumptions" mandate
 * requires. This discrepancy (dead coordinator code vs. the route's own,
 * different, real implementation) is flagged explicitly in PR #16's
 * Checkpoint 14d section as a follow-up item (either wire the route to
 * the coordinator, or remove/relabel the unused
 * requestFamilyMemberDeletion/finishFamilyMemberDeletion exports) -- not
 * silently smoothed over here.
 *
 * Mirrors scripts/full-household-e2e-regressions.ts's established
 * pattern exactly: PGlite-backed pool.query/pool.connect patching,
 * DEV_AUTH_ENABLED + DEV_ACCOUNT_ID identity (asUser()), real route
 * handler functions imported and invoked with a constructed NextRequest
 * carrying the real ACTIVE_HOUSEHOLD_COOKIE -- no live HTTP server.
 * Run as its own separate process (memory isolation), per this
 * checkpoint's sandbox constraints -- never combined with
 * full-household-e2e-regressions.ts's own already-large suite (see that
 * file's header for the documented OOM reproduction this avoids).
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

const SQL_FILES = ["sql/schema.sql", "sql/chat-upgrade.sql", "sql/coverage-ledger.sql", "sql/household-rls.sql", "sql/lifecycle.sql"];

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

function requestFor(url: string, opts: { household?: string; method?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.household) headers["cookie"] = `${ACTIVE_HOUSEHOLD_COOKIE}=${opts.household}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(url, {
    method: opts.method ?? "GET",
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function seedHousehold(name: string, ownerId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [name]);
  const householdId = result.rows[0].id;
  await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'owner')`, [householdId, ownerId]);
  return householdId;
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
    const { GET: getFamily, POST: postFamily } = await import("@/app/api/family/route");
    const { DELETE: deleteFamilyMember } = await import("@/app/api/family/[id]/route");

    const ownerA = "a0000000-0000-4000-8000-000000000001";
    const householdA = await seedHousehold("Household A", ownerA);

    await testAsync("DELETE /api/family/[id] removes a family member with zero linked activity, and it is really gone from the table", async () => {
      asUser(ownerA);
      const created = await postFamily(requestFor("http://localhost/api/family", { household: householdA, method: "POST", body: { displayName: "To Delete", relationship: "child" } }));
      assert.equal(created.status, 201);
      const memberId = (await created.json()).member.id as string;

      const res = await deleteFamilyMember(requestFor(`http://localhost/api/family/${memberId}`, { household: householdA, method: "DELETE" }), { params: Promise.resolve({ id: memberId }) } as any);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });

      const row = await pool.query<{ id: string }>(`SELECT id FROM family_members WHERE id=$1`, [memberId]);
      assert.equal(row.rows.length, 0, "the real route performs a genuine hard delete -- the row must be completely gone, not merely soft-deleted");
    });

    await testAsync("DELETE /api/family/[id] refuses (409) to delete a family member with linked activity (an active policy), and the member survives untouched", async () => {
      asUser(ownerA);
      const created = await postFamily(requestFor("http://localhost/api/family", { household: householdA, method: "POST", body: { displayName: "Has Policy", relationship: "spouse" } }));
      const memberId = (await created.json()).member.id as string;
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state,personal_coverage_confirmed)
         VALUES (gen_random_uuid(),$1,$2,'p.pdf',$3,'ready','active',true)`,
        [householdA, memberId, `acct/policy/${randomUUID()}/p.pdf`],
      );

      const res = await deleteFamilyMember(requestFor(`http://localhost/api/family/${memberId}`, { household: householdA, method: "DELETE" }), { params: Promise.resolve({ id: memberId }) } as any);
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.match(body.error, /linked documents or activity/);

      const row = await pool.query<{ id: string }>(`SELECT id FROM family_members WHERE id=$1`, [memberId]);
      assert.equal(row.rows.length, 1, "a refused deletion must never partially apply");
    });

    await testAsync("DELETE /api/family/[id] cannot be used by a member of a DIFFERENT household to delete this household's family member (real cross-household authorization boundary)", async () => {
      asUser(ownerA);
      const created = await postFamily(requestFor("http://localhost/api/family", { household: householdA, method: "POST", body: { displayName: "Protected Member", relationship: "child" } }));
      const victimMemberId = (await created.json()).member.id as string;

      const ownerB = "b0000000-0000-4000-8000-000000000002";
      const householdB = await seedHousehold("Household B", ownerB);

      // The attacker is a genuine member of a DIFFERENT household (B),
      // with no membership in household A at all -- attempting to DELETE
      // household A's family member id while requireHouseholdContext()
      // resolves them into their OWN household (B), exactly like a real
      // attacker guessing/observing another household's family-member id.
      asUser(ownerB);
      const res = await deleteFamilyMember(requestFor(`http://localhost/api/family/${victimMemberId}`, { household: householdB, method: "DELETE" }), { params: Promise.resolve({ id: victimMemberId }) } as any);
      assert.equal(res.status, 404, "a foreign family member must be indistinguishable from a genuinely missing one (never a 403 that would confirm it exists)");

      const row = await pool.query<{ id: string; account_id: string }>(`SELECT id, account_id FROM family_members WHERE id=$1`, [victimMemberId]);
      assert.equal(row.rows.length, 1, "the victim's family member must never be touched by a cross-household attempt");
      assert.equal(row.rows[0].account_id, householdA);
    });

    await testAsync("a deleted family member is excluded from GET /api/family (the real downstream list-read path) immediately", async () => {
      asUser(ownerA);
      const created = await postFamily(requestFor("http://localhost/api/family", { household: householdA, method: "POST", body: { displayName: "Listed Then Gone", relationship: "child" } }));
      const memberId = (await created.json()).member.id as string;

      const before = await getFamily(requestFor("http://localhost/api/family", { household: householdA }));
      assert.ok((await before.json()).family.some((m: { id: string }) => m.id === memberId));

      const del = await deleteFamilyMember(requestFor(`http://localhost/api/family/${memberId}`, { household: householdA, method: "DELETE" }), { params: Promise.resolve({ id: memberId }) } as any);
      assert.equal(del.status, 200);

      const after = await getFamily(requestFor("http://localhost/api/family", { household: householdA }));
      assert.ok(!(await after.json()).family.some((m: { id: string }) => m.id === memberId), "the deleted member must never appear on the real GET /api/family read path again");
    });

    await testAsync("DELETE /api/family/[id] on an id that does not exist (or already deleted) returns 404, not a crash", async () => {
      asUser(ownerA);
      const res = await deleteFamilyMember(requestFor(`http://localhost/api/family/${randomUUID()}`, { household: householdA, method: "DELETE" }), { params: Promise.resolve({ id: randomUUID() }) } as any);
      assert.equal(res.status, 404);
    });

    console.log(`family-member-deletion regressions passed: ${cases} real, authenticated, route-level cases (DELETE /api/family/[id]) -- happy-path hard delete, linked-activity refusal, real cross-household authorization boundary, downstream exclusion from GET /api/family, not-found handling. NOTE: this suite tests the route's REAL inline hard-delete implementation, not lib/lifecycle/coordinator.ts's unused requestFamilyMemberDeletion() -- see file header for that discrepancy, reported to PR #16 as follow-up.`);
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
