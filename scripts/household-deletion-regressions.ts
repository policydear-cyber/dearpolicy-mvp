/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening): whole-
 * household (whole-account) deletion, through the REAL route --
 * app/api/household/route.ts's DELETE handler.
 *
 * Checkpoint 14d integrity correction: package.json has referenced
 * `security:household-deletion-test` -> this exact file since Checkpoint
 * 7, but this file did not exist in the committed repo until this
 * checkpoint -- confirmed missing via a fresh GITHUB_GET_A_TREE listing
 * against the real branch head, not a local-checkout artifact. Prior
 * PR #16 checkpoints (see PR body's "Checkpoint 14d" section for exactly
 * which ones -- this is also the exact suite
 * scripts/full-household-e2e-regressions.ts's own file header cites BY
 * NAME as already covering this flow "in much more depth than one route
 * call each") reported this suite passing -- those reports were false.
 *
 * As with the other route-backed suites in this checkpoint: the REAL
 * route calls lib/household/repo.ts's deleteHousehold() directly (a
 * genuine, immediate `DELETE FROM accounts WHERE id=$1`, cascading via
 * ON DELETE CASCADE to every household-owned table), NOT
 * lib/lifecycle/coordinator.ts's requestHouseholdDeletion() wrapper --
 * grepping app/ and lib/ confirms that wrapper has no caller anywhere
 * outside lib/lifecycle/coordinator.ts itself. This suite tests the REAL
 * route/deleteHousehold() path, including the route's OWN confirmName
 * re-entry gate (coordinator.ts's own doc comment on requestHouseholdDeletion
 * explains why this flow, uniquely among the eight, keeps an immediate
 * hard delete with no lifecycle bookkeeping survivable past the delete
 * itself -- deletion_requests/deletion_audit_log both cascade-delete
 * along with the account they reference).
 *
 * Mirrors scripts/full-household-e2e-regressions.ts's established
 * pattern: PGlite-backed pool.query/pool.connect patching, DEV_AUTH_ENABLED
 * + DEV_ACCOUNT_ID identity, real route handler functions invoked with a
 * constructed NextRequest. Run as its own separate process -- this is
 * EXACTLY the suite full-household-e2e-regressions.ts's own header names
 * as the reason it deliberately does NOT exercise household deletion in
 * its own process (a real, reproduced, documented OOM risk running
 * deletion flows alongside a large already-loaded suite).
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

const SQL_FILES = ["sql/schema.sql", "sql/claim-evidence.sql", "sql/household-rls.sql", "sql/lifecycle.sql"];

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

async function seedHousehold(name: string, ownerId: string, role: "owner" | "member" = "owner"): Promise<string> {
  const result = await pool.query<{ id: string }>(`INSERT INTO accounts(id, name) VALUES (gen_random_uuid(), $1) RETURNING id`, [name]);
  const householdId = result.rows[0].id;
  await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, $3)`, [householdId, ownerId, role]);
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
    const { DELETE: deleteHouseholdRoute, GET: getHousehold } = await import("@/app/api/household/route");

    await testAsync("DELETE /api/household: owner types the exact household name and it is really, permanently gone -- cascading through family members, policies, claim-evidence documents, and household bookkeeping", async () => {
      const owner = "e0000000-0000-4000-8000-000000000001";
      const householdId = await seedHousehold("The Rivera Household", owner);
      const memberRow = await pool.query<{ id: string }>(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES (gen_random_uuid(),$1,'Jordan','self') RETURNING id`, [householdId]);
      const familyMemberId = memberRow.rows[0].id;
      const policyRow = await pool.query<{ id: string }>(
        `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state,personal_coverage_confirmed)
         VALUES (gen_random_uuid(),$1,$2,'p.pdf',$3,'ready','active',true) RETURNING id`,
        [householdId, familyMemberId, `acct/policy/${randomUUID()}/p.pdf`],
      );
      const policyId = policyRow.rows[0].id;
      const sessionRow = await pool.query<{ id: string }>(
        `INSERT INTO claim_sessions(id,account_id,family_member_id,status,facts) VALUES (gen_random_uuid(),$1,$2,'fact_finding','{}'::jsonb) RETURNING id`,
        [householdId, familyMemberId],
      );
      await pool.query(
        `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
         VALUES (gen_random_uuid(),$1,$2,$3,'death_certificate','doc.pdf','key','application/pdf',10,$4)`,
        [householdId, familyMemberId, sessionRow.rows[0].id, randomUUID()],
      );

      asUser(owner);
      const res = await deleteHouseholdRoute(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: { confirmName: "The Rivera Household" } }));
      assert.equal(res.status, 200);

      const account = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdId]);
      assert.equal(account.rows.length, 0, "the accounts row must be genuinely, permanently gone");
      const members = await pool.query(`SELECT 1 FROM household_members WHERE household_id=$1`, [householdId]);
      assert.equal(members.rows.length, 0, "household_members must cascade-delete");
      const family = await pool.query(`SELECT 1 FROM family_members WHERE id=$1`, [familyMemberId]);
      assert.equal(family.rows.length, 0, "family_members must cascade-delete");
      const policies = await pool.query(`SELECT 1 FROM policies WHERE id=$1`, [policyId]);
      assert.equal(policies.rows.length, 0, "policies must cascade-delete");
      const evidence = await pool.query(`SELECT 1 FROM claim_evidence_documents WHERE claim_session_id=$1`, [sessionRow.rows[0].id]);
      assert.equal(evidence.rows.length, 0, "claim_evidence_documents must cascade-delete");
    });

    await testAsync("DELETE /api/household: refuses (400) when confirmName does not match the real household name, and the household survives completely untouched", async () => {
      const owner = "e0000000-0000-4000-8000-000000000002";
      const householdId = await seedHousehold("Household Confirm Mismatch", owner);

      asUser(owner);
      const res = await deleteHouseholdRoute(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: { confirmName: "the wrong name" } }));
      assert.equal(res.status, 400);

      const account = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdId]);
      assert.equal(account.rows.length, 1, "a wrong confirmName must never delete anything");
    });

    await testAsync("DELETE /api/household: refuses (400) with an EMPTY confirmName (no accidental one-click destructive delete)", async () => {
      const owner = "e0000000-0000-4000-8000-000000000003";
      const householdId = await seedHousehold("Household No Confirm", owner);

      asUser(owner);
      const res = await deleteHouseholdRoute(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: {} }));
      assert.equal(res.status, 400);

      const account = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdId]);
      assert.equal(account.rows.length, 1);
    });

    await testAsync("DELETE /api/household: an ordinary (non-owner) member cannot delete the household even with the correct name typed (RLS accounts_delete is owner-only)", async () => {
      const owner = "e0000000-0000-4000-8000-000000000004";
      const householdId = await seedHousehold("Household Non-Owner Delete", owner);
      const nonOwner = "e0000000-0000-4000-8000-000000000005";
      await pool.query(`INSERT INTO household_members(household_id, user_id, role) VALUES ($1, $2, 'member')`, [householdId, nonOwner]);

      asUser(nonOwner);
      const res = await deleteHouseholdRoute(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: { confirmName: "Household Non-Owner Delete" } }));
      assert.equal(res.status, 404, "a non-owner's delete attempt must be refused (RLS blocks the actual DELETE; deleteHousehold() reports rowCount=0 as NotFoundError)");

      const account = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdId]);
      assert.equal(account.rows.length, 1, "the household must survive a refused non-owner attempt completely untouched");
    });

    await testAsync("DELETE /api/household: forging the active-household cookie to a DIFFERENT household you do not belong to never deletes that household -- you can only ever act on your OWN (real cross-household authorization boundary)", async () => {
      const ownerA = "e0000000-0000-4000-8000-000000000006";
      const householdA = await seedHousehold("Household A Protected", ownerA);

      const ownerB = "e0000000-0000-4000-8000-000000000007";
      const householdB = await seedHousehold("Household B Attacker", ownerB);

      // ownerB is not a member of householdA at all. Forging the cookie
      // to householdA does not grant access to it -- requireHouseholdContext()'s
      // resolveActiveHouseholdId() falls back to the caller's own real
      // household (B) whenever the cookie names a household they don't
      // belong to, so this request actually targets household B, not A --
      // and B's real name is "Household B Attacker", not the confirmName
      // below, so it is refused too.
      asUser(ownerB);
      const res = await deleteHouseholdRoute(requestFor("http://localhost/api/household", { household: householdA, method: "DELETE", body: { confirmName: "Household A Protected" } }));
      assert.equal(res.status, 400, "the forged cookie must never let the caller operate on a household they don't belong to");

      const accountA = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdA]);
      assert.equal(accountA.rows.length, 1, "household A must never be touched by a caller who isn't a member of it");
      const accountB = await pool.query(`SELECT 1 FROM accounts WHERE id=$1`, [householdB]);
      assert.equal(accountB.rows.length, 1, "household B (the attacker's own, real target of this request) must also survive since its own name did not match the submitted confirmName");
    });

    await testAsync("a deleted household's owner has zero memberships on the real downstream GET /api/household read path immediately afterward", async () => {
      const owner = "e0000000-0000-4000-8000-000000000008";
      const householdId = await seedHousehold("Household Downstream Check", owner);

      asUser(owner);
      const before = await getHousehold(requestFor("http://localhost/api/household", { household: householdId }));
      assert.equal((await before.json()).memberships.length, 1);

      const del = await deleteHouseholdRoute(requestFor("http://localhost/api/household", { household: householdId, method: "DELETE", body: { confirmName: "Household Downstream Check" } }));
      assert.equal(del.status, 200);

      const after = await getHousehold(requestFor("http://localhost/api/household", {}));
      const afterBody = await after.json();
      assert.equal(afterBody.memberships.length, 0, "the deleted household must never appear on the real GET /api/household read path again");
      assert.equal(afterBody.activeHouseholdId, null);
    });

    console.log(`household-deletion regressions passed: ${cases} real, authenticated, route-level cases (DELETE /api/household) -- happy path with full real cascade verification (family members, policies, claim-evidence documents, membership rows), confirmName-mismatch refusal, empty-confirmName refusal, non-owner (RLS) refusal, real cross-household authorization boundary (a forged cookie can only ever operate on the caller's own household), downstream exclusion from GET /api/household. Run as its own isolated process, exactly as scripts/full-household-e2e-regressions.ts's own header documents is required for this flow. NOTE: this suite tests deleteHousehold()'s REAL production path, not lib/lifecycle/coordinator.ts's unused requestHouseholdDeletion() wrapper -- see file header, reported to PR #16 as follow-up.`);
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
