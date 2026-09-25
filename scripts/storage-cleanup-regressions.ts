/**
 * Regression suite for lib/storage/cleanup.ts (checkpoint 5,
 * claude/v1-launch-hardening) -- runs against a disposable PGlite
 * instance, exactly the way scripts/policy-quarantine-regressions.ts and
 * scripts/claim-evidence-regressions.ts test their own database
 * behaviour: real SQL, real constraints, no live Postgres required.
 *
 * Deliberately does not exercise a real Supabase Storage bucket or real
 * local-disk files for every case -- most tests drive classifyObjects/
 * buildManifest/executeManifest directly with in-memory StorageObjectInfo
 * fixtures and a tiny fake StorageCleanupDriver, which is enough to prove
 * the protection rules, the manifest/confirmation contract, the
 * concurrency lock, and the audit trail -- the actual local/Supabase
 * driver implementations are exercised separately by
 * scripts/storage-orphans-regressions.ts (local disk, real files) and are
 * otherwise a thin, mostly non-branching wrapper around fs/Supabase APIs.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { randomUUID } from "node:crypto";
import {
  activeStorageKeys,
  appendCleanupAudit,
  buildManifest,
  classifyObjects,
  CleanupLockHeldError,
  cleanupLockKey,
  dbRowsMissingObjects,
  executeManifest,
  redactStorageKey,
  withCleanupLock,
  type StorageCleanupDriver,
  type StorageObjectInfo,
} from "@/lib/storage/cleanup";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

function fakeDriver(name: "local" | "supabase", behavior?: { onDelete?: (key: string) => void | Promise<void> }): StorageCleanupDriver {
  return {
    name,
    async listObjects() {
      return [];
    },
    async deleteObject(key: string) {
      if (behavior?.onDelete) await behavior.onDelete(key);
    },
  };
}

async function seedAccount(db: typeof pool, _suffix: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO accounts(id,name) VALUES ($1,'Test')`, [id]);
  return id;
}

async function seedFamilyMember(db: typeof pool, accountId: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'Test Member','self')`, [id, accountId]);
  return id;
}

async function seedPolicy(db: typeof pool, accountId: string, familyMemberId: string, storageKey: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO policies(account_id, family_member_id, original_filename, storage_key, quarantine_status)
     VALUES ($1,$2,'policy.pdf',$3,'scan_clean') RETURNING id`,
    [accountId, familyMemberId, storageKey],
  );
  return rows[0].id;
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  // Checkpoint 7's lifecycle_state column is now referenced unconditionally
  // by activeStorageKeys()/dbRowsMissingObjects() for the policy/claim-
  // evidence domains -- exec sql/lifecycle.sql so those columns exist here
  // too, same convention as every other suite that needs more than the
  // base schema (see this file's own header comment).
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

  try {
    // ---- redactStorageKey ------------------------------------------------
    await testAsync("redactStorageKey hides the filename but keeps structure and is deterministic", async () => {
      const key = "acct-1/member-1/policy-1/John_Smith_Life_Insurance.pdf";
      const redacted = redactStorageKey(key);
      assert.notEqual(redacted, key);
      assert.ok(!redacted.includes("John_Smith"));
      assert.ok(redacted.endsWith(".pdf"));
      assert.ok(redacted.startsWith("acct-1/member-1/policy-1/"));
      assert.equal(redactStorageKey(key), redacted, "must be deterministic for the same input");
      const otherKey = "acct-1/member-1/policy-1/Someone_Else.pdf";
      assert.notEqual(redactStorageKey(otherKey), redacted, "different filenames must redact differently");
    });

    // ---- classifyObjects ---------------------------------------------------
    await testAsync("classifyObjects protects a referenced object as active_reference", async () => {
      const objects: StorageObjectInfo[] = [{ key: "a/b/c.pdf", sizeBytes: 10, lastModifiedMs: Date.now() - 100 * 24 * 60 * 60 * 1000 }];
      const { orphanCandidates, protectedObjects } = await classifyObjects(objects, new Set(["a/b/c.pdf"]));
      assert.equal(orphanCandidates.length, 0);
      assert.equal(protectedObjects.length, 1);
      assert.equal(protectedObjects[0].reason, "active_reference");
    });

    await testAsync("classifyObjects protects a recently-written unreferenced object as in_flight_grace", async () => {
      const objects: StorageObjectInfo[] = [{ key: "a/b/new.pdf", sizeBytes: 10, lastModifiedMs: Date.now() - 1000 }];
      const { orphanCandidates, protectedObjects } = await classifyObjects(objects, new Set());
      assert.equal(orphanCandidates.length, 0);
      assert.equal(protectedObjects[0].reason, "in_flight_grace");
    });

    await testAsync("classifyObjects treats an old, unreferenced object as an orphan candidate", async () => {
      const objects: StorageObjectInfo[] = [{ key: "a/b/old.pdf", sizeBytes: 10, lastModifiedMs: Date.now() - 30 * 24 * 60 * 60 * 1000 }];
      const { orphanCandidates, protectedObjects } = await classifyObjects(objects, new Set());
      assert.equal(protectedObjects.length, 0);
      assert.equal(orphanCandidates.length, 1);
      assert.equal(orphanCandidates[0].key, "a/b/old.pdf");
    });

    await testAsync("classifyObjects honors a retention hold even for an old, unreferenced object", async () => {
      const objects: StorageObjectInfo[] = [{ key: "a/b/held.pdf", sizeBytes: 10, lastModifiedMs: Date.now() - 30 * 24 * 60 * 60 * 1000 }];
      const { orphanCandidates, protectedObjects } = await classifyObjects(objects, new Set(), {
        retentionChecker: async () => ({ held: true, detail: "legal hold" }),
      });
      assert.equal(orphanCandidates.length, 0);
      assert.equal(protectedObjects[0].reason, "retention_hold");
      assert.equal(protectedObjects[0].detail, "legal hold");
    });

    // ---- buildManifest ------------------------------------------------------
    await testAsync("buildManifest is deterministic regardless of input order and reflects content", async () => {
      const now = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const a: StorageObjectInfo = { key: "a.pdf", sizeBytes: 10, lastModifiedMs: now };
      const b: StorageObjectInfo = { key: "b.pdf", sizeBytes: 20, lastModifiedMs: now };
      const m1 = buildManifest({ domain: "policy", driver: "local", orphanCandidates: [a, b], generatedAt: new Date(0) });
      const m2 = buildManifest({ domain: "policy", driver: "local", orphanCandidates: [b, a], generatedAt: new Date(1000000) });
      assert.equal(m1.manifestHash, m2.manifestHash, "hash must not depend on input order or generatedAt");
      const m3 = buildManifest({ domain: "policy", driver: "local", orphanCandidates: [a], generatedAt: new Date(0) });
      assert.notEqual(m1.manifestHash, m3.manifestHash, "hash must change when the content changes");
      for (const entry of m1.entries) {
        assert.ok(entry.displayKey.endsWith(".pdf"));
        assert.ok(entry.displayKey !== "a.pdf" && entry.displayKey !== "b.pdf", "display key must not equal the raw filename");
      }
    });

    // ---- executeManifest: confirmation gate ---------------------------------
    await testAsync("executeManifest refuses to delete anything when confirmHash does not match", async () => {
      let deleteCalls = 0;
      const driver = fakeDriver("local", { onDelete: () => { deleteCalls++; } });
      const manifest = buildManifest({
        domain: "policy",
        driver: "local",
        orphanCandidates: [{ key: "orphan.pdf", sizeBytes: 5, lastModifiedMs: Date.now() - 99999999 }],
      });
      await assert.rejects(
        () => executeManifest({ db: pool, driver, domain: "policy", manifest, confirmHash: "wrong-hash", actor: "test" }),
        /Confirmation hash does not match/,
      );
      assert.equal(deleteCalls, 0);
    });

    // ---- executeManifest: happy path + audit trail --------------------------
    await testAsync("executeManifest deletes an orphan and records a redacted audit row", async () => {
      const deletedKeys: string[] = [];
      const driver = fakeDriver("local", { onDelete: (key) => { deletedKeys.push(key); } });
      const sensitiveKey = "acct/mem/pol/Very_Sensitive_Name.pdf";
      const manifest = buildManifest({
        domain: "policy",
        driver: "local",
        orphanCandidates: [{ key: sensitiveKey, sizeBytes: 5, lastModifiedMs: Date.now() - 99999999 }],
      });
      const result = await executeManifest({ db: pool, driver, domain: "policy", manifest, confirmHash: manifest.manifestHash, actor: "tester-1" });
      assert.deepEqual(result.deleted, [sensitiveKey]);
      assert.equal(deletedKeys.length, 1);

      const { rows } = await pool.query<{ display_key: string; action: string; actor: string }>(
        `SELECT display_key, action, actor FROM storage_cleanup_audit_log WHERE manifest_hash=$1`,
        [manifest.manifestHash],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].action, "object_deleted");
      assert.equal(rows[0].actor, "tester-1");
      assert.ok(!rows[0].display_key.includes("Very_Sensitive_Name"), "audit log must never store the raw filename");
    });

    // ---- executeManifest: became referenced since manifest generation -------
    await testAsync("executeManifest skips an object that a new row now references", async () => {
      const accountId = await seedAccount(pool, "skip-ref");
      const memberId = await seedFamilyMember(pool, accountId);
      const key = "acct/mem/pol/now-referenced.pdf";
      const manifest = buildManifest({ domain: "policy", driver: "local", orphanCandidates: [{ key, sizeBytes: 5, lastModifiedMs: Date.now() - 99999999 }] });

      // A new upload committed its row AFTER the manifest was built, but
      // BEFORE "clean" ran -- executeManifest must catch this via its own
      // fresh re-read, not just trust the manifest's snapshot.
      await seedPolicy(pool, accountId, memberId, key);

      let deleteCalls = 0;
      const driver = fakeDriver("local", { onDelete: () => { deleteCalls++; } });
      const result = await executeManifest({ db: pool, driver, domain: "policy", manifest, confirmHash: manifest.manifestHash, actor: "test" });
      assert.equal(deleteCalls, 0, "must never call deleteObject for a now-referenced key");
      assert.deepEqual(result.skippedReferenced, [key]);

      const { rows } = await pool.query<{ action: string }>(`SELECT action FROM storage_cleanup_audit_log WHERE manifest_hash=$1`, [manifest.manifestHash]);
      assert.equal(rows[0].action, "object_skipped_referenced");
    });

    // ---- executeManifest: already-gone is idempotent success ----------------
    await testAsync("executeManifest treats an already-deleted object as a successful skip, not a failure", async () => {
      const key = "acct/mem/pol/already-gone.pdf";
      const manifest = buildManifest({ domain: "policy", driver: "local", orphanCandidates: [{ key, sizeBytes: 5, lastModifiedMs: Date.now() - 99999999 }] });
      const driver = fakeDriver("local", {
        onDelete: () => {
          throw new Error("ENOENT: no such file or directory");
        },
      });
      const result = await executeManifest({ db: pool, driver, domain: "policy", manifest, confirmHash: manifest.manifestHash, actor: "test" });
      assert.deepEqual(result.skippedAlreadyGone, [key]);
      assert.equal(result.failed.length, 0);
    });

    // ---- executeManifest: real failures are retried, then reported ----------
    await testAsync("executeManifest retries a persistent failure and then reports it, never silently drops it", async () => {
      const key = "acct/mem/pol/permission-denied.pdf";
      const manifest = buildManifest({ domain: "policy", driver: "local", orphanCandidates: [{ key, sizeBytes: 5, lastModifiedMs: Date.now() - 99999999 }] });
      let attempts = 0;
      const driver = fakeDriver("local", {
        onDelete: () => {
          attempts++;
          throw new Error("EACCES: permission denied");
        },
      });
      const result = await executeManifest({ db: pool, driver, domain: "policy", manifest, confirmHash: manifest.manifestHash, actor: "test", retries: 2 });
      assert.equal(attempts, 3, "must attempt retries+1 times total");
      assert.equal(result.deleted.length, 0);
      assert.equal(result.failed.length, 1);
      assert.equal(result.failed[0].key, key);

      const { rows } = await pool.query<{ action: string }>(`SELECT action FROM storage_cleanup_audit_log WHERE manifest_hash=$1`, [manifest.manifestHash]);
      assert.equal(rows[0].action, "object_delete_failed");
    });

    // ---- withCleanupLock ------------------------------------------------------
    await testAsync("withCleanupLock releases the lock after a successful run", async () => {
      const key = cleanupLockKey("local", "policy");
      await withCleanupLock(pool, key, async () => {});
      const { rows } = await pool.query(`SELECT 1 FROM storage_cleanup_locks WHERE lock_key=$1`, [key]);
      assert.equal(rows.length, 0);
    });

    await testAsync("withCleanupLock releases the lock even when the wrapped function throws", async () => {
      const key = cleanupLockKey("local", "claim-evidence");
      await assert.rejects(
        withCleanupLock(pool, key, async () => {
          throw new Error("boom");
        }),
        /boom/,
      );
      const { rows } = await pool.query(`SELECT 1 FROM storage_cleanup_locks WHERE lock_key=$1`, [key]);
      assert.equal(rows.length, 0, "a thrown error inside the locked section must not leak the lock");
    });

    await testAsync("withCleanupLock refuses a second concurrent run while a live lock is held", async () => {
      const key = cleanupLockKey("supabase", "policy");
      await pool.query(`INSERT INTO storage_cleanup_locks(lock_key, holder) VALUES ($1,'other-run')`, [key]);
      try {
        await assert.rejects(withCleanupLock(pool, key, async () => {}), CleanupLockHeldError);
      } finally {
        await pool.query(`DELETE FROM storage_cleanup_locks WHERE lock_key=$1`, [key]);
      }
    });

    await testAsync("withCleanupLock reclaims a stale lock left by a crashed run", async () => {
      const key = cleanupLockKey("supabase", "claim-evidence");
      await pool.query(`INSERT INTO storage_cleanup_locks(lock_key, holder, acquired_at) VALUES ($1,'crashed-run', now() - interval '2 hours')`, [key]);
      let ran = false;
      await withCleanupLock(pool, key, async () => {
        ran = true;
      });
      assert.ok(ran, "a stale lock (older than the default staleness window) must be reclaimable");
      const { rows } = await pool.query(`SELECT 1 FROM storage_cleanup_locks WHERE lock_key=$1`, [key]);
      assert.equal(rows.length, 0);
    });

    // ---- activeStorageKeys / dbRowsMissingObjects ----------------------------
    await testAsync("activeStorageKeys and dbRowsMissingObjects are distinct, correct reports", async () => {
      const accountId = await seedAccount(pool, "reports");
      const memberId = await seedFamilyMember(pool, accountId);
      const referencedKey = "acct/mem/pol/referenced.pdf";
      const missingKey = "acct/mem/pol/points-nowhere.pdf";
      await seedPolicy(pool, accountId, memberId, referencedKey);
      await seedPolicy(pool, accountId, memberId, missingKey);

      const referenced = await activeStorageKeys(pool, "policy");
      assert.ok(referenced.has(referencedKey));
      assert.ok(referenced.has(missingKey), "a DB row's key is 'active' even if the object itself is missing on disk");

      // Other tests in this same suite share one PGlite instance and may
      // have inserted their own policy rows, so assert membership rather
      // than an exact count/order -- this function scans the whole table
      // by design (see its own doc comment), which is correct production
      // behaviour, not a test-isolation bug to work around by narrowing it.
      const missing = await dbRowsMissingObjects(pool, "policy", new Set([referencedKey]));
      assert.ok(missing.some((m) => m.storageKey === missingKey), "the row with no matching object must be reported");
      assert.ok(!missing.some((m) => m.storageKey === referencedKey), "a row whose key IS in the object set must never be reported as missing");
    });

    await testAsync("appendCleanupAudit rejects an unrecognized action via the schema's own check constraint", async () => {
      await assert.rejects(
        appendCleanupAudit(pool, {
          driver: "local",
          domain: "policy",
          // @ts-expect-error -- deliberately invalid to prove the DB constraint, not just the type, enforces this
          action: "not_a_real_action",
          displayKey: "x",
          manifestHash: "h",
          actor: "test",
        }),
      );
    });
  } finally {
    pool.query = originalQuery;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`storage-cleanup regressions passed: ${cases} cases (redaction, protection rules, deterministic manifest/confirmation, concurrency lock, audit trail).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
