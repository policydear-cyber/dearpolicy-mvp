/**
 * Regression suite for household export (checkpoint 6,
 * claude/v1-launch-hardening): lib/household/export.ts's snapshot content
 * (inclusions, exclusions, cross-household isolation), lib/household/
 * export-store.ts's idempotency/CAS/expiry lifecycle, and
 * lib/auth/session.ts's requireRecentAuthentication(). Runs against a
 * disposable PGlite instance, exactly like the other suites this branch
 * has added (scripts/policy-quarantine-regressions.ts,
 * scripts/scan-callback-regressions.ts, scripts/storage-cleanup-
 * regressions.ts).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { requireRecentAuthentication, StaleAuthenticationError, type SessionUser } from "@/lib/auth/session";
import { buildHouseholdExportSnapshot } from "@/lib/household/export";
import {
  appendExportAudit,
  createOrGetExportRequest,
  expireIfPast,
  getExportRow,
  markExportFailed,
  markExportReady,
  markExportRunning,
  type HouseholdExportRow,
} from "@/lib/household/export-store";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

function test(name: string, fn: () => void) {
  try {
    fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return { id: "u1", email: "a@example.test", emailConfirmedAt: new Date(0).toISOString(), lastSignInAt: new Date().toISOString(), ...overrides };
}

// ---- requireRecentAuthentication (pure, no DB) ---------------------------
test("requireRecentAuthentication accepts a session that signed in moments ago", () => {
  requireRecentAuthentication(user({ lastSignInAt: new Date(Date.now() - 1000).toISOString() }), 15 * 60 * 1000);
});

test("requireRecentAuthentication rejects a session with no recorded sign-in", () => {
  assert.throws(() => requireRecentAuthentication(user({ lastSignInAt: null }), 15 * 60 * 1000), StaleAuthenticationError);
});

test("requireRecentAuthentication rejects a session that signed in too long ago", () => {
  assert.throws(
    () => requireRecentAuthentication(user({ lastSignInAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() }), 15 * 60 * 1000),
    StaleAuthenticationError,
  );
});

async function seedHousehold(db: typeof pool, name: string, ownerId: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO accounts(id,name) VALUES ($1,$2)`, [id, name]);
  await db.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [id, ownerId]);
  return id;
}

async function seedFamilyMember(db: typeof pool, accountId: string, name: string): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,$3,'self')`, [id, accountId, name]);
  return id;
}

async function seedFullHousehold(db: typeof pool, ownerId: string, label: string) {
  const householdId = await seedHousehold(db, `${label} household`, ownerId);
  const memberId = await seedFamilyMember(db, householdId, `${label} member`);

  const policyId = randomUUID();
  await db.query(
    `INSERT INTO policies(id,account_id,family_member_id,insurer,original_filename,storage_key,quarantine_status,extracted_json,processing_error)
     VALUES ($1,$2,$3,$4,'policy.pdf','secret/path/John_Doe.pdf','scan_clean','{"raw":"vendor blob"}'::jsonb,'some internal error')`,
    [policyId, householdId, memberId, `${label} Insurer`],
  );

  const coverageId = randomUUID();
  await db.query(`INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency) VALUES ($1,$2,$3,$4,'death','100000','USD')`, [
    coverageId,
    householdId,
    policyId,
    memberId,
  ]);

  const benefitId = randomUUID();
  await db.query(`INSERT INTO policy_benefits(id,account_id,policy_id,benefit_name,quote) VALUES ($1,$2,$3,'Accidental death','pays $X on accidental death')`, [
    benefitId,
    householdId,
    policyId,
  ]);

  const claimId = randomUUID();
  await db.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status) VALUES ($1,$2,$3,'fact_finding')`, [claimId, householdId, memberId]);

  const evidenceId = randomUUID();
  await db.query(
    `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
     VALUES ($1,$2,$3,$4,'death_certificate','cert.pdf','secret/evidence/Jane_Doe_cert.pdf','application/pdf',100,'hash-${label}')`,
    [evidenceId, householdId, memberId, claimId],
  );

  const snapshotId = randomUUID();
  await db.query(
    `INSERT INTO claim_composition_snapshots(id,account_id,family_member_id,claim_session_id,calculation_id,engine_version,facts_snapshot,coverage_versions,result,calculated_at)
     VALUES ($1,$2,$3,$4,'calc-1','v1','{}'::jsonb,'{}'::jsonb,'{"total":100}'::jsonb, now())`,
    [snapshotId, householdId, memberId, claimId],
  );

  await db.query(
    `INSERT INTO policy_document_audit_log(account_id,actor,action,policy_id) VALUES ($1,'system','quarantined',$2),($1,'system','scan_attempt_failed',$2)`,
    [householdId, policyId],
  );
  await db.query(
    `INSERT INTO claim_evidence_audit_log(account_id,actor,action,evidence_document_id,reason) VALUES ($1,'system','status_transition',$2,NULL),($1,'system','processing_failed',$2,'raw vendor timeout detail')`,
    [householdId, evidenceId],
  );

  return { householdId, memberId, policyId, coverageId, benefitId, claimId, evidenceId, snapshotId };
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-evidence.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-composition.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/benefit-catalog.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));
  // Checkpoint 7: buildHouseholdExportSnapshot() now filters on lifecycle_state
  // (accounts/policies/family_members/claim_evidence_documents) via
  // activePredicate() -- exec sql/lifecycle.sql so those columns exist here too.
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

  // createUserSupabaseClient() runs inside a transaction with SET ROLE --
  // meaningless against PGlite's single connection/no real roles, so this
  // suite talks to household_exports/export_audit_log via the plain pool
  // (matching lib/household/export-store.ts's own design), and calls
  // buildHouseholdExportSnapshot() directly against a ScopedDbClient-shaped
  // wrapper around that same pool -- proving the SNAPSHOT CONTENT's own
  // logic (selects, exclusions, ordering), which is this module's actual
  // job; RLS enforcement itself is already covered by scripts/rls-
  // regressions.ts and is orthogonal to what this suite verifies.
  const scopedClient = { query: (text: string, params: unknown[] = []) => pool.query(text, params) };

  try {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const a = await seedFullHousehold(pool, ownerA, "Alpha");
    const b = await seedFullHousehold(pool, ownerB, "Bravo");

    let snapshotA: Awaited<ReturnType<typeof buildHouseholdExportSnapshot>>;

    await testAsync("buildHouseholdExportSnapshot returns the requested household's own metadata", async () => {
      snapshotA = await buildHouseholdExportSnapshot(scopedClient, a.householdId);
      assert.equal(snapshotA.household.id, a.householdId);
      assert.equal(snapshotA.household.name, "Alpha household");
      assert.equal(snapshotA.schemaVersion, 1);
      assert.equal(snapshotA.members.length, 1);
      assert.equal(snapshotA.members[0].userId, ownerA);
      assert.equal(snapshotA.members[0].role, "owner");
    });

    await testAsync("the snapshot includes policy/coverage/benefit/claim/evidence/calculation content", async () => {
      assert.equal(snapshotA.policies.length, 1);
      assert.equal(snapshotA.policies[0].id, a.policyId);
      assert.equal(snapshotA.coverages.length, 1);
      assert.equal(snapshotA.benefits.length, 1);
      assert.equal(snapshotA.claims.length, 1);
      assert.equal(snapshotA.evidence.length, 1);
      assert.equal(snapshotA.calculationSnapshots.length, 1);
      assert.equal(snapshotA.calculationSnapshots[0].calculationId, "calc-1");
    });

    await testAsync("the snapshot never includes a storage_key, raw extracted_json, or internal error text", async () => {
      const json = JSON.stringify(snapshotA);
      assert.ok(!json.includes("secret/path"), "policy storage_key must never appear in an export");
      assert.ok(!json.includes("secret/evidence"), "evidence storage_key must never appear in an export");
      assert.ok(!json.includes("vendor blob"), "raw extracted_json must never appear in an export");
      assert.ok(!json.includes("some internal error"), "internal processing_error text must never appear in an export");
      assert.ok(!("storageKey" in snapshotA.policies[0]));
      assert.ok(!("extractedJson" in snapshotA.policies[0]));
      assert.ok(!("storageKey" in snapshotA.evidence[0]));
    });

    await testAsync("audit history is curated: allowed actions only, no raw diff/reason payloads, diagnostic actions excluded", async () => {
      const actions = snapshotA.auditHistory.map((e) => e.action);
      assert.ok(actions.includes("quarantined"));
      assert.ok(actions.includes("status_transition"));
      assert.ok(!actions.includes("scan_attempt_failed"), "diagnostic-only action must be excluded from the export");
      assert.ok(!actions.includes("processing_failed"), "diagnostic-only action must be excluded from the export");
      const json = JSON.stringify(snapshotA.auditHistory);
      assert.ok(!json.includes("raw vendor timeout detail"), "raw reason/diagnostic text must never appear in the export's audit history");
      for (const entry of snapshotA.auditHistory) {
        assert.ok(!("previousValue" in entry) && !("newValue" in entry) && !("reason" in entry));
      }
    });

    await testAsync("a household's export never contains another household's data", async () => {
      const json = JSON.stringify(snapshotA);
      assert.ok(!json.includes(b.householdId));
      assert.ok(!json.includes(b.policyId));
      assert.ok(!json.includes(b.evidenceId));
      assert.ok(!json.includes("Bravo"));
    });

    // ---- export-store: idempotency ----------------------------------------
    await testAsync("createOrGetExportRequest is idempotent for the same key, distinct for a different key", async () => {
      const key = "req-key-1";
      const first = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: key });
      assert.equal(first.isNew, true);
      const second = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: key });
      assert.equal(second.isNew, false);
      assert.equal(second.row.id, first.row.id);

      const different = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "req-key-2" });
      assert.notEqual(different.row.id, first.row.id);
    });

    // ---- export-store: CAS lifecycle ---------------------------------------
    await testAsync("markExportRunning/Ready/Failed follow the correct CAS transitions", async () => {
      const { row } = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "cas-1" });
      assert.equal(row.status, "pending");

      const runningFromWrongState = await markExportReady(pool, row.id, {
        storageKey: "x",
        byteSize: 1,
        manifestHash: "h",
        expiresAt: new Date(),
      });
      assert.equal(runningFromWrongState, null, "cannot jump straight to ready from pending");

      const running = await markExportRunning(pool, row.id);
      assert.ok(running);
      assert.equal(running!.status, "running");

      const runningAgain = await markExportRunning(pool, row.id);
      assert.equal(runningAgain, null, "cannot start running twice concurrently");

      const failed = await markExportFailed(pool, row.id, "Export generation failed. Please try again.");
      assert.ok(failed);
      assert.equal(failed!.status, "failed");

      // Retry semantics: a failed row can be retried under the SAME
      // idempotency key (a settled `ready`/`expired` row never could be).
      const retried = await markExportRunning(pool, row.id);
      assert.ok(retried, "a failed export must be retryable");
      assert.equal(retried!.status, "running");

      const ready = await markExportReady(pool, row.id, {
        storageKey: "households/x/export.json",
        byteSize: 42,
        manifestHash: "abc123",
        expiresAt: new Date(Date.now() + 1000),
      });
      assert.ok(ready);
      assert.equal(ready!.status, "ready");

      const cannotRetryReady = await markExportRunning(pool, row.id);
      assert.equal(cannotRetryReady, null, "a genuinely-succeeded (ready) export must never be regenerated under the same key");
    });

    // ---- export-store: scoped lookup ----------------------------------------
    await testAsync("getExportRow never returns another household's export", async () => {
      const { row } = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "scope-1" });
      const foundOwn = await getExportRow(pool, a.householdId, row.id);
      assert.ok(foundOwn);
      const foundCrossHousehold = await getExportRow(pool, b.householdId, row.id);
      assert.equal(foundCrossHousehold, null, "an export id must be invisible from a different household");
    });

    // ---- export-store: expiry -------------------------------------------------
    await testAsync("expireIfPast flips a past-due ready export, deletes its object once, and audits it", async () => {
      const { row } = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "expire-1" });
      await markExportRunning(pool, row.id);
      const ready = await markExportReady(pool, row.id, {
        storageKey: "households/x/expire-1.json",
        byteSize: 10,
        manifestHash: "h",
        expiresAt: new Date(Date.now() - 1000), // already in the past
      });
      assert.ok(ready);

      let deleteCalls = 0;
      const deletedKeys: string[] = [];
      const updated = await expireIfPast(pool, ready!, async (key) => {
        deleteCalls++;
        deletedKeys.push(key);
      });
      assert.equal(updated.status, "expired");
      assert.equal(updated.storage_key, null);
      assert.equal(deleteCalls, 1);
      assert.deepEqual(deletedKeys, ["households/x/expire-1.json"]);

      const { rows } = await pool.query<{ action: string }>(`SELECT action FROM household_export_audit_log WHERE export_id=$1 AND action='expired'`, [
        row.id,
      ]);
      assert.equal(rows.length, 1);
    });

    await testAsync("expireIfPast leaves a not-yet-expired ready export untouched", async () => {
      const { row } = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "expire-2" });
      await markExportRunning(pool, row.id);
      const ready = await markExportReady(pool, row.id, {
        storageKey: "households/x/expire-2.json",
        byteSize: 10,
        manifestHash: "h",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // an hour from now
      });
      let deleteCalls = 0;
      const updated = await expireIfPast(pool, ready!, async () => {
        deleteCalls++;
      });
      assert.equal(updated.status, "ready");
      assert.equal(deleteCalls, 0);
    });

    await testAsync("expireIfPast is race-safe: a second call against the same stale `ready` snapshot re-reads the real state instead of trusting it", async () => {
      const { row } = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "expire-3" });
      await markExportRunning(pool, row.id);
      const ready = await markExportReady(pool, row.id, {
        storageKey: "households/x/expire-3.json",
        byteSize: 10,
        manifestHash: "h",
        expiresAt: new Date(Date.now() - 1000),
      });
      assert.ok(ready);

      // Simulates two concurrent requests that both read the row while it
      // was still `ready` (the SAME stale in-memory object passed to both).
      const first = await expireIfPast(pool, ready!, async () => {});
      const second = await expireIfPast(pool, ready!, async () => {});
      assert.equal(first.status, "expired");
      assert.equal(second.status, "expired", "the second caller must see the real current state, not the stale `ready` it started from");
      assert.equal(second.storage_key, null);
    });

    // ---- export-store: audit -------------------------------------------------
    await testAsync("appendExportAudit records every lifecycle action distinctly", async () => {
      const { row } = await createOrGetExportRequest(pool, { householdId: a.householdId, requestedBy: ownerA, idempotencyKey: "audit-1" });
      await appendExportAudit(pool, { householdId: a.householdId, exportId: row.id, actor: ownerA, action: "requested" });
      await appendExportAudit(pool, { householdId: a.householdId, exportId: row.id, actor: ownerA, action: "downloaded" });
      const { rows } = await pool.query<{ action: string }>(`SELECT action FROM household_export_audit_log WHERE export_id=$1 ORDER BY id ASC`, [row.id]);
      assert.deepEqual(rows.map((r) => r.action), ["requested", "downloaded"]);
    });
  } finally {
    pool.query = originalQuery;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(
    `household-export regressions passed: ${cases} cases (recent-auth guard, snapshot content/exclusions, cross-household isolation, idempotency, CAS lifecycle, race-safe expiry, audit trail).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
