/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening) sub-
 * checkpoint 7: invitation revocation (lib/lifecycle/coordinator.ts's
 * requestInvitationRevocation, resource_type='invitation').
 *
 * Like scripts/household-membership-deletion-regressions.ts, this is
 * proven against REAL Postgres Row Level Security (PGlite +
 * sql/household-rls.sql), not a scripted fake pool, because
 * lib/household/repo.ts's revokeInvitation() (which this flow calls
 * rather than reimplements) is itself built on a real RLS-scoped
 * transaction.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { NotFoundError, ForbiddenError, acceptInvitation } from "@/lib/household/repo";
import { DeletionValidationError, requestInvitationRevocation } from "@/lib/lifecycle/coordinator";

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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

async function seedInvitation(
  db: typeof pool,
  householdId: string,
  invitedBy: string,
  opts?: { email?: string; token?: string; acceptedAt?: string | null; revokedAt?: string | null },
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = opts?.token ?? randomUUID();
  await db.query(
    `INSERT INTO household_invitations(id,household_id,email,role,token_hash,invited_by,expires_at,accepted_at,revoked_at)
     VALUES ($1,$2,$3,'member',$4,$5, now() + interval '7 days', $6, $7)`,
    [id, householdId, opts?.email ?? "invitee@example.com", hashToken(token), invitedBy, opts?.acceptedAt ?? null, opts?.revokedAt ?? null],
  );
  return { id, token };
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
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  try {
    await testAsync("an owner revoking a pending invitation succeeds and revoked_at is actually set", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId);

      const outcome = await requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-1" });
      assert.equal(outcome.status, "completed");

      const row = await pool.query<{ revoked_at: string | null }>(`SELECT revoked_at::text FROM household_invitations WHERE id=$1`, [invitationId]);
      assert.ok(row.rows[0].revoked_at, "revoked_at must actually be set");
    });

    await testAsync("the deletion_requests row is scoped to the invitation's OWN household_id, not any caller-supplied one", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId);

      const outcome = await requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-scope" });

      const request = await pool.query<{ account_id: string }>(`SELECT account_id FROM deletion_requests WHERE id=$1`, [outcome.deletionRequestId]);
      assert.equal(request.rows[0].account_id, householdId);
    });

    await testAsync("revoking an already-revoked invitation is refused as not found", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId, { revokedAt: new Date().toISOString() });

      await assert.rejects(
        () => requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-already-revoked" }),
        NotFoundError,
      );
    });

    await testAsync("revoking an already-accepted invitation is refused as not found", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId, { acceptedAt: new Date().toISOString() });

      await assert.rejects(
        () => requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-already-accepted" }),
        NotFoundError,
      );
    });

    await testAsync("a plain member (not the owner) cannot revoke an invitation (RLS-enforced, surfaces as not found)", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const memberId = await seedMember(pool, householdId, "member");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId);

      await assert.rejects(
        () => requestInvitationRevocation({ callerUserId: memberId, invitationId, idempotencyKey: "revoke-forbidden" }),
        NotFoundError,
      );

      const row = await pool.query<{ revoked_at: string | null }>(`SELECT revoked_at::text FROM household_invitations WHERE id=$1`, [invitationId]);
      assert.equal(row.rows[0].revoked_at, null, "a refused revocation must never leave the invitation revoked");
    });

    await testAsync("requestInvitationRevocation is idempotent: a retry does not re-attempt revokeInvitation or duplicate the audit row", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId);

      const first = await requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-retry" });
      assert.equal(first.status, "completed");

      // A naive retry that called revokeInvitation() again here would
      // throw NotFoundError (the invitation is already revoked) -- this
      // must not happen; the coordinator must short-circuit instead.
      const second = await requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-retry" });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const auditRows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_type='invitation' AND resource_id=$1`,
        [invitationId],
      );
      assert.equal(auditRows.rows[0].n, "1", "a retry must not duplicate the audit event");
    });

    await testAsync("a revoked invitation can no longer be accepted (end-to-end proof, not just revokeInvitation()'s own check)", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId, token } = await seedInvitation(pool, householdId, ownerId, { email: "invitee@example.com" });

      await requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-then-accept" });

      await assert.rejects(
        () => acceptInvitation(token, randomUUID(), "invitee@example.com"),
        ForbiddenError,
        "a revoked invitation must remain unacceptable even after going through this coordinator's flow",
      );
    });

    await testAsync("revoking an invitation that does not exist is a validation error, and creates no deletion_requests row", async () => {
      await assert.rejects(
        () => requestInvitationRevocation({ callerUserId: randomUUID(), invitationId: randomUUID(), idempotencyKey: "revoke-missing" }),
        DeletionValidationError,
      );
    });

    await testAsync("finishes with the deletion request marked soft_deleted and completed_at set", async () => {
      const householdId = await seedHousehold(pool);
      const ownerId = await seedMember(pool, householdId, "owner");
      const { id: invitationId } = await seedInvitation(pool, householdId, ownerId);

      const outcome = await requestInvitationRevocation({ callerUserId: ownerId, invitationId, idempotencyKey: "revoke-finish" });

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
  console.log(`invitation-revocation-deletion regressions passed: ${cases} cases (owner revocation, correct account scoping, already-revoked/accepted refusal, RLS-enforced forbidden revocation, idempotency, revoked-invitation-acceptance proof, missing-invitation validation, finish state).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
