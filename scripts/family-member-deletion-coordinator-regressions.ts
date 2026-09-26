/* Coordinator-level suite from claude/v1-quality-evaluation-harness, kept
 * alongside the route-level scripts/family-member-deletion-regressions.ts when that branch
 * was merged into claude/v1-launch-hardening. */
/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening) sub-
 * checkpoint 4: family-member deletion (lib/lifecycle/coordinator.ts's
 * requestFamilyMemberDeletion/finishFamilyMemberDeletion,
 * resource_type='family_member').
 *
 * The property this suite exists to prove: app/api/family/[id]/route.ts
 * used to run a raw, unrecoverable `DELETE FROM family_members` that
 * bypassed this checkpoint's lifecycle machinery entirely (no
 * deletion_requests bookkeeping, no audit trail, no recovery window),
 * even though family_members was already migrated for READS
 * (activePredicate()). This flow closes that gap while preserving,
 * unchanged, the pre-existing product rule the original route enforced:
 * deletion is refused -- not cascaded -- whenever the profile has any
 * real linked activity, across all six tables the original route
 * checked (policies, policy_members, chat_conversations, claim_sessions,
 * coverage_rules, premium_records).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { getLifecycleState } from "@/lib/lifecycle/state-machine";
import {
  DeletionValidationError,
  HasLinkedActivityError,
  finishFamilyMemberDeletion,
  requestFamilyMemberDeletion,
} from "@/lib/lifecycle/coordinator";
import type { ScopedDbClient } from "@/lib/db/authz-client";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

async function seedAccount(db: typeof pool): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO accounts(id,name) VALUES ($1,'Test')`, [id]);
  return id;
}

async function seedFamilyMember(db: typeof pool, accountId: string, opts?: { relationship?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'Test Member',$3)`, [
    id,
    accountId,
    opts?.relationship ?? "self",
  ]);
  return id;
}

async function seedPolicy(db: typeof pool, accountId: string, familyMemberId: string, opts?: { lifecycleState?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state,quarantine_status)
     VALUES ($1,$2,$3,'test.pdf','key','ready',$4,'scan_clean')`,
    [id, accountId, familyMemberId, opts?.lifecycleState ?? "active"],
  );
  return id;
}

async function linkPolicyMember(db: typeof pool, accountId: string, policyId: string, familyMemberId: string) {
  await db.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id,source) VALUES ($1,$2,$3,'upload')`, [
    policyId,
    familyMemberId,
    accountId,
  ]);
}

async function seedChatConversation(db: typeof pool, accountId: string, familyMemberId: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO chat_conversations(id,account_id,family_member_id,title) VALUES ($1,$2,$3,'Test chat')`, [id, accountId, familyMemberId]);
  return id;
}

async function seedClaimSession(db: typeof pool, accountId: string, familyMemberId: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,facts) VALUES ($1,$2,$3,'fact_finding','{}'::jsonb)`, [
    id,
    accountId,
    familyMemberId,
  ]);
  return id;
}

async function seedCoverageRule(db: typeof pool, accountId: string, familyMemberId: string) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO coverage_rules(id,account_id,family_member_id,plan_name,event_type) VALUES ($1,$2,$3,'Test Plan','death')`,
    [id, accountId, familyMemberId],
  );
  return id;
}

async function seedPremiumRecord(db: typeof pool, accountId: string, familyMemberId: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO premium_records(id,account_id,family_member_id,amount) VALUES ($1,$2,$3,100)`, [id, accountId, familyMemberId]);
  return id;
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/chat-upgrade.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/coverage-ledger.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));

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
  // requestFamilyMemberDeletion's precondition query and
  // finishFamilyMemberDeletion both go through pool.query() only (no
  // pool.connect() use anywhere in this flow, unlike the claim-evidence
  // flow's appendClaimEvidenceAudit()/ensureClaimEvidenceSchema() path)
  // -- patched anyway for parity with the established harness so a
  // future change to this flow that starts using pool.connect() doesn't
  // silently fall through to an unconfigured real Postgres pool.
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release };
  }) as typeof pool.connect;

  const fakeScopedClient: ScopedDbClient = {
    query: (async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pool.query(text, params);
      return result as unknown as { rows: T[]; rowCount: number | null };
    }) as ScopedDbClient["query"],
  };

  try {
    await testAsync("requestFamilyMemberDeletion immediately revokes logical access to a profile with no linked activity", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId, { relationship: "child" });

      const outcome = await requestFamilyMemberDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        familyMemberId: memberId,
        reasonCategory: "user_requested",
        idempotencyKey: "member-1",
      });
      assert.equal(outcome.status, "accepted");
      assert.equal(outcome.displayName, "Test Member");

      const state = await getLifecycleState(pool, { resourceType: "family_member", resourceId: memberId, accountId });
      assert.equal(state?.lifecycle_state, "pending_deletion");
    });

    await testAsync("a profile with an active policy is refused, not silently cascaded, and the profile is left untouched", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      await seedPolicy(pool, accountId, memberId);

      await assert.rejects(
        () =>
          requestFamilyMemberDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            familyMemberId: memberId,
            reasonCategory: "user_requested",
            idempotencyKey: "member-2",
          }),
        HasLinkedActivityError,
      );

      const state = await getLifecycleState(pool, { resourceType: "family_member", resourceId: memberId, accountId });
      assert.equal(state?.lifecycle_state, "active", "a refused deletion must never leave the profile in pending_deletion");
    });

    await testAsync("a policy that is already non-active (soft-deleted) does not block deleting its family member", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      await seedPolicy(pool, accountId, memberId, { lifecycleState: "soft_deleted" });

      const outcome = await requestFamilyMemberDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        familyMemberId: memberId,
        reasonCategory: "user_requested",
        idempotencyKey: "member-3",
      });
      assert.equal(outcome.status, "accepted", "a policy already excluded by activePredicate() must never block this member's own deletion");
    });

    await testAsync("a profile linked only via policy_members (shared coverage, zero owned policies) is refused", async () => {
      const accountId = await seedAccount(pool);
      const ownerId = await seedFamilyMember(pool, accountId, { relationship: "self" });
      const sharedId = await seedFamilyMember(pool, accountId, { relationship: "spouse" });
      const policyId = await seedPolicy(pool, accountId, ownerId);
      await linkPolicyMember(pool, accountId, policyId, sharedId);

      await assert.rejects(
        () =>
          requestFamilyMemberDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            familyMemberId: sharedId,
            reasonCategory: "user_requested",
            idempotencyKey: "member-4",
          }),
        HasLinkedActivityError,
      );
    });

    await testAsync("a policy_members link to a policy that is already deleted does not block deleting the profile", async () => {
      const accountId = await seedAccount(pool);
      const ownerId = await seedFamilyMember(pool, accountId, { relationship: "self" });
      const sharedId = await seedFamilyMember(pool, accountId, { relationship: "child" });
      const policyId = await seedPolicy(pool, accountId, ownerId, { lifecycleState: "soft_deleted" });
      await linkPolicyMember(pool, accountId, policyId, sharedId);

      const outcome = await requestFamilyMemberDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        familyMemberId: sharedId,
        reasonCategory: "user_requested",
        idempotencyKey: "member-4b",
      });
      assert.equal(outcome.status, "accepted", "a link to a deleted policy is not linked activity");
    });

    await testAsync("a profile with chat history is refused", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      await seedChatConversation(pool, accountId, memberId);

      await assert.rejects(
        () =>
          requestFamilyMemberDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            familyMemberId: memberId,
            reasonCategory: "user_requested",
            idempotencyKey: "member-5",
          }),
        HasLinkedActivityError,
      );
    });

    await testAsync("a profile with a claim session is refused", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      await seedClaimSession(pool, accountId, memberId);

      await assert.rejects(
        () =>
          requestFamilyMemberDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            familyMemberId: memberId,
            reasonCategory: "user_requested",
            idempotencyKey: "member-6",
          }),
        HasLinkedActivityError,
      );
    });

    await testAsync("a profile with a coverage-ledger rule is refused", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      await seedCoverageRule(pool, accountId, memberId);

      await assert.rejects(
        () =>
          requestFamilyMemberDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            familyMemberId: memberId,
            reasonCategory: "user_requested",
            idempotencyKey: "member-7",
          }),
        HasLinkedActivityError,
      );
    });

    await testAsync("a profile with a premium record is refused", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      await seedPremiumRecord(pool, accountId, memberId);

      await assert.rejects(
        () =>
          requestFamilyMemberDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            familyMemberId: memberId,
            reasonCategory: "user_requested",
            idempotencyKey: "member-8",
          }),
        HasLinkedActivityError,
      );
    });

    await testAsync("requestFamilyMemberDeletion is idempotent: a retry returns the same request and does not duplicate the audit row", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);

      const first = await requestFamilyMemberDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        familyMemberId: memberId,
        reasonCategory: "user_requested",
        idempotencyKey: "member-retry",
      });
      await finishFamilyMemberDeletion({ accountId, actorUserId: randomUUID(), familyMemberId: memberId, deletionRequestId: first.deletionRequestId });

      const second = await requestFamilyMemberDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        familyMemberId: memberId,
        reasonCategory: "user_requested",
        idempotencyKey: "member-retry",
      });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const deletionAuditRows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_id=$1`, [memberId]);
      assert.equal(deletionAuditRows.rows[0].n, "1", "a retry must not duplicate the audit event");
    });

    await testAsync("deleting a family member that does not exist is reported as a validation error, not thrown unhandled", async () => {
      const accountId = await seedAccount(pool);
      await assert.rejects(() =>
        requestFamilyMemberDeletion({
          client: fakeScopedClient,
          accountId,
          actorUserId: randomUUID(),
          familyMemberId: randomUUID(),
          reasonCategory: "user_requested",
          idempotencyKey: "member-missing",
        }),
      DeletionValidationError,
      );
    });

    await testAsync("finishFamilyMemberDeletion marks the deletion request completed with no storage cleanup wait", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);

      const outcome = await requestFamilyMemberDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        familyMemberId: memberId,
        reasonCategory: "user_requested",
        idempotencyKey: "member-finish",
      });
      await finishFamilyMemberDeletion({ accountId, actorUserId: randomUUID(), familyMemberId: memberId, deletionRequestId: outcome.deletionRequestId });

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
  console.log(`family-member-deletion regressions passed: ${cases} cases (clean-profile deletion, active-policy refusal, inactive-policy exclusion, shared-coverage-only refusal, chat/claim/coverage-rule/premium-record refusal, idempotency, missing-member validation, finish-without-storage-wait).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
