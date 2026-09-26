/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening): the
 * deletion & derived-data invalidation lifecycle -- lib/lifecycle/*.
 *
 * Runs against a disposable PGlite instance, the same convention as
 * scripts/storage-cleanup-regressions.ts / scripts/household-export-
 * regressions.ts: real SQL, real constraints, no live Postgres required.
 * Covers the state machine's CAS/transition-table correctness, the
 * deletion-requests store's idempotency, and one full deletion flow
 * (policy-document) wired through the coordinator end to end, including
 * the "deleted policy removed from chat retrieval" requirement.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import {
  InvalidLifecycleTransitionError,
  LifecycleResourceNotFoundError,
  LifecycleVersionConflictError,
  transitionLifecycle,
  getLifecycleState,
} from "@/lib/lifecycle/state-machine";
import { activeStorageKeys } from "@/lib/storage/cleanup";
import {
  appendDeletionAudit,
  createOrGetDeletionRequest,
  transitionDeletionRequest,
  DeletionRequestVersionConflictError,
} from "@/lib/lifecycle/deletion-requests";
import { finishPolicyDocumentDeletion, requestPolicyDocumentDeletion } from "@/lib/lifecycle/coordinator";
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

async function seedFamilyMember(db: typeof pool, accountId: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'Test Member','self')`, [id, accountId]);
  return id;
}

async function seedPolicy(db: typeof pool, accountId: string, familyMemberId: string, opts?: { lifecycleState?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state,quarantine_status)
     VALUES ($1,$2,$3,'test.pdf',$5,'ready',$4,'scan_clean')`,
    [id, accountId, familyMemberId, opts?.lifecycleState ?? "active", `acct/policy/${id}/test.pdf`],
  );
  return id;
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
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
  pool.query = (async (text: string, params: unknown[] = []) => {
    const release = await acquire();
    try {
      return await execute(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;

  // A ScopedDbClient stand-in that just delegates to the same patched
  // pool -- PGlite is a single connection here (no real RLS transaction
  // boundary in this harness, exactly like scripts/storage-cleanup-
  // regressions.ts and scripts/household-export-regressions.ts, which
  // also test service-level/table-level logic without a live RLS
  // engine; scripts/rls-regressions.ts is what proves RLS itself).
  const fakeScopedClient: ScopedDbClient = {
    query: (async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pool.query(text, params);
      return result as unknown as { rows: T[]; rowCount: number | null };
    }) as ScopedDbClient["query"],
  };

  try {
    // ---- transitionLifecycle: valid transitions ---------------------
    await testAsync("transitionLifecycle moves active -> pending_deletion and increments the version", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const row = await transitionLifecycle(pool, {
        resourceType: "policy_document",
        resourceId: policyId,
        accountId,
        fromState: "active",
        toState: "pending_deletion",
      });
      assert.equal(row.lifecycle_state, "pending_deletion");
      assert.equal(row.lifecycle_version, 1);
    });

    await testAsync("transitionLifecycle rejects a structurally-invalid transition without mutating anything", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      await assert.rejects(
        () =>
          transitionLifecycle(pool, {
            resourceType: "policy_document",
            resourceId: policyId,
            accountId,
            fromState: "active",
            toState: "permanently_deleted",
          }),
        InvalidLifecycleTransitionError,
      );
      const current = await getLifecycleState(pool, { resourceType: "policy_document", resourceId: policyId, accountId });
      assert.equal(current?.lifecycle_state, "active", "must still be active -- the invalid transition must not have partially applied");
      assert.equal(current?.lifecycle_version, 0);
    });

    await testAsync("transitionLifecycle throws LifecycleResourceNotFoundError for a resource that does not exist", async () => {
      const accountId = await seedAccount(pool);
      await assert.rejects(
        () =>
          transitionLifecycle(pool, {
            resourceType: "policy_document",
            resourceId: randomUUID(),
            accountId,
            fromState: "active",
            toState: "pending_deletion",
          }),
        LifecycleResourceNotFoundError,
      );
    });

    await testAsync("transitionLifecycle throws LifecycleVersionConflictError when the row already moved (lost CAS race)", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      // Simulate a concurrent worker that already moved this row.
      await transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "active", toState: "pending_deletion" });
      await assert.rejects(
        () =>
          transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "active", toState: "pending_deletion" }),
        LifecycleVersionConflictError,
      );
      // The second (losing) caller's attempted toState must never have
      // been applied on top of the first -- version stays at 1, not 2.
      const current = await getLifecycleState(pool, { resourceType: "policy_document", resourceId: policyId, accountId });
      assert.equal(current?.lifecycle_version, 1);
    });

    await testAsync("transitionLifecycle allows recovery (pending_deletion -> active) but never from permanently_deleted", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      await transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "active", toState: "pending_deletion" });
      const recovered = await transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "pending_deletion", toState: "active" });
      assert.equal(recovered.lifecycle_state, "active");

      // Drive it all the way to permanently_deleted and confirm recovery
      // is structurally impossible from there.
      await transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "active", toState: "pending_deletion" });
      await transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "pending_deletion", toState: "soft_deleted" });
      await transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "soft_deleted", toState: "permanently_deleted" });
      await assert.rejects(
        () =>
          transitionLifecycle(pool, { resourceType: "policy_document", resourceId: policyId, accountId, fromState: "permanently_deleted", toState: "active" }),
        InvalidLifecycleTransitionError,
      );
    });

    // ---- deletion_requests: idempotency ------------------------------
    await testAsync("createOrGetDeletionRequest is idempotent for the same idempotency key", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const first = await createOrGetDeletionRequest(pool, {
        accountId,
        resourceType: "policy_document",
        resourceId: policyId,
        requestedBy: null,
        reasonCategory: "user_requested",
        idempotencyKey: "key-1",
      });
      const second = await createOrGetDeletionRequest(pool, {
        accountId,
        resourceType: "policy_document",
        resourceId: policyId,
        requestedBy: null,
        reasonCategory: "user_requested",
        idempotencyKey: "key-1",
      });
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(first.row.id, second.row.id);

      const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM deletion_requests WHERE resource_id=$1`, [policyId]);
      assert.equal(count.rows[0].n, "1", "a repeated idempotency key must never create a second deletion_requests row");
    });

    await testAsync("createOrGetDeletionRequest with a DIFFERENT idempotency key creates a distinct request", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const first = await createOrGetDeletionRequest(pool, {
        accountId,
        resourceType: "policy_document",
        resourceId: policyId,
        requestedBy: null,
        reasonCategory: "user_requested",
        idempotencyKey: "key-a",
      });
      const second = await createOrGetDeletionRequest(pool, {
        accountId,
        resourceType: "policy_document",
        resourceId: policyId,
        requestedBy: null,
        reasonCategory: "user_requested",
        idempotencyKey: "key-b",
      });
      assert.notEqual(first.row.id, second.row.id);
    });

    await testAsync("transitionDeletionRequest CASes and throws DeletionRequestVersionConflictError on a lost race", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const { row } = await createOrGetDeletionRequest(pool, {
        accountId,
        resourceType: "policy_document",
        resourceId: policyId,
        requestedBy: null,
        reasonCategory: "user_requested",
        idempotencyKey: "key-cas",
      });
      await transitionDeletionRequest(pool, { id: row.id, fromStates: ["pending_deletion"], toState: "soft_deleted" });
      await assert.rejects(
        () => transitionDeletionRequest(pool, { id: row.id, fromStates: ["pending_deletion"], toState: "soft_deleted" }),
        DeletionRequestVersionConflictError,
      );
    });

    // ---- end-to-end: policy-document deletion flow -------------------
    await testAsync("requestPolicyDocumentDeletion immediately revokes logical access and invalidates premium_records", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      await pool.query(
        `INSERT INTO premium_records(id,account_id,family_member_id,policy_id,amount,currency,frequency,payment_date) VALUES ($1,$2,$3,$4,100,'USD','monthly',now())`,
        [randomUUID(), accountId, memberId, policyId],
      );

      const outcome = await requestPolicyDocumentDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "delete-flow-1",
      });
      assert.equal(outcome.status, "accepted");

      const current = await getLifecycleState(pool, { resourceType: "policy_document", resourceId: policyId, accountId });
      assert.equal(current?.lifecycle_state, "pending_deletion", "the row must be pending_deletion immediately, before any storage cleanup has run");

      const premiums = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM premium_records WHERE policy_id=$1`, [policyId]);
      assert.equal(premiums.rows[0].n, "0");

      const auditRows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM policy_document_audit_log WHERE policy_id=$1 AND action='deleted'`, [policyId]);
      assert.equal(auditRows.rows[0].n, "1");
    });

    await testAsync("a deleted policy is excluded from the chat-retrieval predicate immediately", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      await pool.query(
        `INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES ($1,$2,$3)`,
        [policyId, memberId, accountId],
      );
      await pool.query(
        `INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,heading,text,embedding) VALUES ($1,$2,$3,$4,1,1,'h','some coverage text',$5)`,
        [randomUUID(), accountId, memberId, policyId, `[${new Array(1024).fill(0).join(",")}]`],
      );

      // Exactly the predicate lib/rag/retrieve.ts's final SELECT uses
      // after Checkpoint 7 (processing_status='ready' AND
      // lifecycle_state='active') -- proven directly against real chunk
      // data rather than through the full retrieveRelevantChunks(), which
      // also calls out to Pinecone/embedding infrastructure this harness
      // does not stand up.
      const before = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM policy_chunks c JOIN policies p ON p.id=c.policy_id AND p.account_id=c.account_id
          WHERE c.account_id=$1 AND p.processing_status='ready' AND p.lifecycle_state='active'`,
        [accountId],
      );
      assert.equal(before.rows[0].n, "1");

      await requestPolicyDocumentDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "delete-flow-chat",
      });

      const after = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM policy_chunks c JOIN policies p ON p.id=c.policy_id AND p.account_id=c.account_id
          WHERE c.account_id=$1 AND p.processing_status='ready' AND p.lifecycle_state='active'`,
        [accountId],
      );
      assert.equal(after.rows[0].n, "0", "the deleted policy's chunks must stop being retrievable as soon as pending_deletion is set");
    });

    await testAsync("requestPolicyDocumentDeletion is idempotent: a retry with the same key does not duplicate the audit log", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);

      const first = await requestPolicyDocumentDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "delete-retry",
      });
      await finishPolicyDocumentDeletion({ accountId, actorUserId: randomUUID(), policyId, deletionRequestId: first.deletionRequestId });

      const second = await requestPolicyDocumentDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "delete-retry",
      });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const auditRows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM policy_document_audit_log WHERE policy_id=$1 AND action='deleted'`, [policyId]);
      assert.equal(auditRows.rows[0].n, "1", "a retry must not duplicate the audit event");

      const deletionAuditRows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_id=$1`, [policyId]);
      assert.equal(deletionAuditRows.rows[0].n, "1", "a retry must not duplicate the deletion_audit_log event either");
    });

    await testAsync("deleting a document that does not exist is reported, not thrown as an unhandled error", async () => {
      const accountId = await seedAccount(pool);
      await assert.rejects(() =>
        requestPolicyDocumentDeletion({
          client: fakeScopedClient,
          accountId,
          actorUserId: randomUUID(),
          policyId: randomUUID(),
          reasonCategory: "user_requested",
          idempotencyKey: "delete-missing",
        }),
      );
    });

    // ---- storage-cleanup integration ---------------------------------
    await testAsync("activeStorageKeys() stops protecting a policy's storage object once it leaves 'active'", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const activeId = await seedPolicy(pool, accountId, memberId);
      const deletedId = await seedPolicy(pool, accountId, memberId);
      await requestPolicyDocumentDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: deletedId,
        reasonCategory: "user_requested",
        idempotencyKey: "delete-storage",
      });

      const keys = await activeStorageKeys(pool, "policy");
      const activeRow = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM policies WHERE id=$1`, [activeId]);
      const deletedRow = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM policies WHERE id=$1`, [deletedId]);
      assert.ok(keys.has(activeRow.rows[0].storage_key), "an active policy's storage object must stay protected");
      assert.ok(!keys.has(deletedRow.rows[0].storage_key), "a pending_deletion policy's storage object must no longer be reported as active/protected");
    });

    // ---- audit trail contains no sensitive content -------------------
    await testAsync("deletion_audit_log rows carry only structural metadata, never policy content or filenames", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const outcome = await requestPolicyDocumentDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "delete-audit-shape",
      });
      await finishPolicyDocumentDeletion({ accountId, actorUserId: randomUUID(), policyId, deletionRequestId: outcome.deletionRequestId });

      const rows = await pool.query<Record<string, unknown>>(`SELECT * FROM deletion_audit_log WHERE resource_id=$1`, [policyId]);
      for (const row of rows.rows) {
        const serialized = JSON.stringify(row);
        assert.ok(!serialized.includes("test.pdf"), "must never leak the original filename");
        assert.ok(!serialized.includes("acct/policy/test.pdf"), "must never leak the storage key");
      }
    });
  } finally {
    pool.query = originalQuery;
    await db.close();
  }
}

/** PGlite is a single connection, so it cannot reproduce the multi-
 * connection wait this guards against: every deletion transaction in
 * lib/lifecycle/coordinator.ts writes its audit row through the SERVICE pool
 * (a second connection) whose foreign key to the locked row needs FOR KEY
 * SHARE. A row locked FOR UPDATE blocks that forever on real Postgres, so
 * the coordinator must lock FOR NO KEY UPDATE. Behavioural coverage on real
 * Postgres is the browser E2E's delete steps (.github/workflows/browser-e2e.yml). */
async function lockLevelGuard() {
  const src = await readFile(path.resolve("lib/lifecycle/coordinator.ts"), "utf8");
  const sql = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/FOR\s+UPDATE/.test(sql), "lib/lifecycle/coordinator.ts must not lock rows FOR UPDATE (its service-pool audit writes would wait on it forever); use FOR NO KEY UPDATE");
  assert.ok((sql.match(/FOR NO KEY UPDATE/g) ?? []).length >= 4, "every deletion transaction still locks its row (FOR NO KEY UPDATE)");
  cases++;
}

async function main() {
  await runDatabaseTests();
  await lockLevelGuard();
  console.log(`lifecycle regressions passed: ${cases} cases (state machine CAS, deletion-request idempotency, policy-document deletion flow, chat-retrieval exclusion, storage-cleanup integration, audit redaction).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
