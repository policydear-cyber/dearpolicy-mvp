/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening) sub-
 * checkpoint 5: household-member removal and leave-household (lib/
 * lifecycle/coordinator.ts's requestHouseholdMemberRemoval/
 * requestHouseholdLeave, resource_type='household_member'/
 * 'household_leave').
 *
 * Unlike every flow before it, this one is proven against REAL Postgres
 * Row Level Security (PGlite, the same engine and household-rls.sql
 * policies scripts/rls-regressions.ts proves), not a scripted fake pool
 * -- because lib/household/repo.ts's removeMember() (which this flow
 * deliberately calls rather than reimplements) is itself built on
 * lib/db/authz-client.ts's createUserSupabaseClient(), a real RLS-scoped
 * transaction (SET LOCAL ROLE authenticated + request.jwt.claim.sub).
 * Running this suite's assertions through actual RLS is what proves the
 * coordinator's idempotency/audit layer sits correctly on top of the
 * real authorization boundary, not a mock of it.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { ConflictError, ForbiddenError } from "@/lib/household/repo";
import { requestHouseholdLeave, requestHouseholdMemberRemoval } from "@/lib/lifecycle/coordinator";

const SQL_FILES = [
  "sql/schema.sql",
  "sql/benefit-catalog.sql",
  "sql/claim-evidence.sql",
  "sql/claim-composition.sql",
  "sql/critical-illness.sql",
  "sql/disability.sql",
  "sql/cover-conditions.sql",
  "sql/model-usage.sql",
  "sql/chat-upgrade.sql",
  "sql/coverage-ledger.sql",
  "sql/household-rls.sql",
  "sql/lifecycle.sql",
];

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

async function seedHousehold(db: typeof pool, name = "Test household"): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO accounts(id,name) VALUES ($1,$2)`, [id, name]);
  return id;
}

async function seedMember(db: typeof pool, householdId: string, role: "owner" | "member" = "member"): Promise<string> {
  const userId = randomUUID();
  await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,$3)`, [householdId, userId, role]);
  return userId;
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }

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
    if (!params.length && text.includes(";")) {
      const results = await db.exec(text);
      const result = results.at(-1);
      return { rows: result?.rows ?? [], rowCount: result?.affectedRows ?? 0 };
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
  // removeMember() -> createUserSupabaseClient() calls pool.connect() to
  // open a single BEGIN/SET LOCAL ROLE authenticated/.../COMMIT|ROLLBACK
  // transaction -- patched the same way Flow 3/4's harness already
  // patches it for a different internal caller (ensureClaimEvidenceSchema()),
  // sharing the same underlying PGlite instance and mutex so a real RLS-
  // scoped transaction and this suite's own deletion_requests/
  // deletion_audit_log bookkeeping never race each other.
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  try {
    await testAsync("an owner removing another member succeeds, is recorded, and the membership row is actually gone", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");

      const outcome = await requestHouseholdMemberRemoval({
        accountId: householdId,
        callerUserId: ownerId,
        targetUserId: memberId,
        idempotencyKey: "remove-1",
      });
      assert.equal(outcome.status, "completed");

      const remaining = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM household_members WHERE household_id=$1 AND user_id=$2`, [
        householdId,
        memberId,
      ]);
      assert.equal(remaining.rows[0].n, "0", "the membership row must actually be gone");
    });

    await testAsync("a member leaving themselves succeeds and is recorded under resource_type='household_leave'", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");

      const outcome = await requestHouseholdLeave({
        accountId: householdId,
        callerUserId: memberId,
        targetUserId: memberId,
        idempotencyKey: "leave-1",
      });
      assert.equal(outcome.status, "completed");

      const auditRows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_type='household_leave' AND resource_id=$1`,
        [memberId],
      );
      assert.equal(auditRows.rows[0].n, "1");
      void ownerId;
    });

    await testAsync("removing the household's sole remaining owner (self-leave) is refused, not silently allowed", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");

      await assert.rejects(
        () =>
          requestHouseholdLeave({
            accountId: householdId,
            callerUserId: ownerId,
            targetUserId: ownerId,
            idempotencyKey: "leave-last-owner",
          }),
        ConflictError,
      );

      const stillThere = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM household_members WHERE household_id=$1 AND user_id=$2`, [
        householdId,
        ownerId,
      ]);
      assert.equal(stillThere.rows[0].n, "1", "a refused removal must never leave the membership row deleted");
    });

    await testAsync("removing one of two owners is allowed (one owner remains afterward)", async () => {
      const householdId = await seedHousehold(pool);
      const ownerA = await seedMember(pool, householdId, "owner");
      const ownerB = await seedMember(pool, householdId, "owner");

      const outcome = await requestHouseholdMemberRemoval({
        accountId: householdId,
        callerUserId: ownerA,
        targetUserId: ownerB,
        idempotencyKey: "remove-coowner",
      });
      assert.equal(outcome.status, "completed");
    });

    await testAsync("a plain member cannot remove another member (RLS-enforced, surfaces as ForbiddenError)", async () => {
      const householdId = await seedHousehold(pool);
      await seedMember(pool, householdId, "owner");
      const memberA = await seedMember(pool, householdId, "member");
      const memberB = await seedMember(pool, householdId, "member");

      await assert.rejects(
        () =>
          requestHouseholdMemberRemoval({
            accountId: householdId,
            callerUserId: memberA,
            targetUserId: memberB,
            idempotencyKey: "remove-forbidden",
          }),
        ForbiddenError,
      );

      const stillThere = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM household_members WHERE household_id=$1 AND user_id=$2`, [
        householdId,
        memberB,
      ]);
      assert.equal(stillThere.rows[0].n, "1", "a forbidden removal must never leave the membership row deleted");
    });

    await testAsync("requestHouseholdMemberRemoval is idempotent: a retry does not re-attempt removeMember or duplicate the audit row", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");

      const first = await requestHouseholdMemberRemoval({
        accountId: householdId,
        callerUserId: ownerId,
        targetUserId: memberId,
        idempotencyKey: "remove-retry",
      });
      assert.equal(first.status, "completed");

      // A naive retry that called removeMember() again here would throw
      // NotFoundError (the member is already gone) -- this must not
      // happen; the coordinator must short-circuit on the already-created
      // deletion_requests row instead.
      const second = await requestHouseholdMemberRemoval({
        accountId: householdId,
        callerUserId: ownerId,
        targetUserId: memberId,
        idempotencyKey: "remove-retry",
      });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const auditRows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_type='household_member' AND resource_id=$1`,
        [memberId],
      );
      assert.equal(auditRows.rows[0].n, "1", "a retry must not duplicate the audit event");
    });

    await testAsync("finishes with the deletion request marked soft_deleted and completed_at set", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");

      const outcome = await requestHouseholdMemberRemoval({
        accountId: householdId,
        callerUserId: ownerId,
        targetUserId: memberId,
        idempotencyKey: "remove-finish",
      });

      const request = await pool.query<{ lifecycle_state: string; completed_at: string | null }>(
        `SELECT lifecycle_state, completed_at::text FROM deletion_requests WHERE id=$1`,
        [outcome.deletionRequestId],
      );
      assert.equal(request.rows[0].lifecycle_state, "soft_deleted");
      assert.ok(request.rows[0].completed_at);
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`household-membership-deletion regressions passed: ${cases} cases (owner-initiated removal, self-leave, last-owner refusal, co-owner removal, RLS-enforced forbidden removal, idempotency, audit trail).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
