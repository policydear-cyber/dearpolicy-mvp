/* Coordinator-level suite from claude/v1-quality-evaluation-harness, kept
 * alongside the route-level scripts/household-deletion-regressions.ts when that branch
 * was merged into claude/v1-launch-hardening. */
/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening) sub-
 * checkpoint 8: household (whole-account) deletion
 * (lib/lifecycle/coordinator.ts's requestHouseholdDeletion,
 * resource_type='household' -- the last of the 8 flows
 * LIFECYCLE_RESOURCE_TYPES anticipated).
 *
 * Like scripts/household-membership-deletion-regressions.ts and
 * scripts/invitation-revocation-deletion-regressions.ts, this is proven
 * against REAL Postgres Row Level Security (PGlite + sql/household-rls.sql),
 * not a scripted fake pool, because lib/household/repo.ts's
 * deleteHousehold() (which this flow calls rather than reimplements) is
 * itself built on a real RLS-scoped transaction (accounts_delete's
 * is_household_owner() policy).
 *
 * This flow is architecturally different from every flow before it, and
 * these cases exist specifically to prove the design decisions documented
 * on requestHouseholdDeletion() itself:
 *   - deletion is immediate (no pending_deletion staging window), because
 *     nothing in this codebase currently gates read/write access on
 *     accounts.lifecycle_state -- a "soft" delete would revoke nothing.
 *   - the deletion_requests/deletion_audit_log rows this flow writes are
 *     themselves cascade-deleted the instant the accounts row is, since
 *     both tables' account_id column is `REFERENCES accounts(id) ON
 *     DELETE CASCADE` (sql/lifecycle.sql) -- there is no durable audit
 *     trail survives a completed household deletion, by construction, not
 *     oversight.
 *   - a retry (same idempotencyKey) against an already-fully-deleted
 *     household must fail cleanly (NotFoundError) rather than crash on a
 *     foreign-key violation from inserting a deletion_requests row
 *     against a now-nonexistent account_id.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { NotFoundError } from "@/lib/household/repo";
import { requestHouseholdDeletion } from "@/lib/lifecycle/coordinator";

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

async function seedFamilyMember(db: typeof pool, householdId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO family_members(id,account_id,relationship,display_name) VALUES ($1,$2,'child','Test Child')`,
    [id, householdId],
  );
  return id;
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
  // deleteHousehold() -> createUserSupabaseClient() calls pool.connect()
  // to open a single BEGIN/SET LOCAL ROLE authenticated/.../COMMIT
  // transaction -- patched the same way every other real-RLS suite this
  // checkpoint added already patches it.
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  try {
    await testAsync("an owner deleting their household succeeds and the account row is actually gone", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");

      const outcome = await requestHouseholdDeletion({ actorUserId: ownerId, householdId, idempotencyKey: "delete-1" });
      assert.equal(outcome.status, "completed");
      assert.equal(outcome.resourceId, householdId);

      const remaining = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM accounts WHERE id=$1`, [householdId]);
      assert.equal(remaining.rows[0].n, "0", "the accounts row must actually be gone, not just marked pending_deletion");
    });

    await testAsync("cascades to household_members and family_members -- nothing this household owned survives", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");
      const familyMemberId = await seedFamilyMember(pool, householdId);

      await requestHouseholdDeletion({ actorUserId: ownerId, householdId, idempotencyKey: "delete-cascade" });

      const members = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM household_members WHERE household_id=$1`, [householdId]);
      assert.equal(members.rows[0].n, "0", "household_members rows must cascade-delete with the account");
      const family = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM family_members WHERE id=$1`, [familyMemberId]);
      assert.equal(family.rows[0].n, "0", "family_members rows must cascade-delete with the account");
      void memberId;
    });

    await testAsync(
      "the deletion_requests/deletion_audit_log rows this flow itself wrote are also cascade-gone once the delete completes -- documented, not a leak",
      async () => {
        const householdId = await seedHousehold(pool);
        const ownerId = await seedMember(pool, householdId, "owner");

        const outcome = await requestHouseholdDeletion({ actorUserId: ownerId, householdId, idempotencyKey: "delete-audit-gone" });

        const requestRow = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM deletion_requests WHERE id=$1`, [
          outcome.deletionRequestId,
        ]);
        assert.equal(requestRow.rows[0].n, "0", "deletion_requests row must be cascade-gone -- it referenced the now-deleted account_id");
        const auditRows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM deletion_audit_log WHERE deletion_request_id=$1`, [
          outcome.deletionRequestId,
        ]);
        assert.equal(auditRows.rows[0].n, "0", "deletion_audit_log row must be cascade-gone -- it referenced the now-deleted account_id");
      },
    );

    await testAsync("a plain (non-owner) member is refused via real RLS, not this flow's own logic", async () => {
      const householdId = await seedHousehold(pool);
      await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");

      await assert.rejects(
        () => requestHouseholdDeletion({ actorUserId: memberId, householdId, idempotencyKey: "delete-forbidden" }),
        NotFoundError,
      );
      const stillThere = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM accounts WHERE id=$1`, [householdId]);
      assert.equal(stillThere.rows[0].n, "1", "a forbidden attempt must not delete anything");
    });

    await testAsync("a nonexistent household id is refused with NotFoundError", async () => {
      await assert.rejects(
        () => requestHouseholdDeletion({ actorUserId: randomUUID(), householdId: randomUUID(), idempotencyKey: "delete-missing" }),
        NotFoundError,
      );
    });

    await testAsync(
      "a retry with the same idempotencyKey after the household is already fully deleted fails cleanly (NotFoundError), not with a foreign-key crash",
      async () => {
        const householdId = await seedHousehold(pool);
        const ownerId = await seedMember(pool, householdId, "owner");

        const first = await requestHouseholdDeletion({ actorUserId: ownerId, householdId, idempotencyKey: "delete-retry" });
        assert.equal(first.status, "completed");

        await assert.rejects(
          () => requestHouseholdDeletion({ actorUserId: ownerId, householdId, idempotencyKey: "delete-retry" }),
          NotFoundError,
          "a retry against an already-deleted household must surface the same NotFoundError deleteHousehold() itself throws for a missing household, not an unhandled DB error",
        );
      },
    );
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(
    `household-deletion regressions passed: ${cases} cases (owner deletion succeeds, cascades to household_members/family_members, this flow's own deletion_requests/deletion_audit_log rows are provably cascade-gone afterward, RLS-enforced forbidden deletion, missing-household refusal, clean retry-after-completion refusal).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
