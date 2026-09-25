/**
 * Behavioral regression suite for Checkpoint 7's "active-read scopes" work
 * (claude/v1-launch-hardening): proves, against a real (disposable PGlite)
 * database, that ordinary application reads actually exclude non-active
 * rows -- not merely that the source text contains the right substring.
 *
 * scripts/lifecycle-query-guard-regressions.ts is a STATIC check: it scans
 * source text for `FROM <table>` / `JOIN <table>` occurrences and confirms
 * `lifecycle_state` or `activePredicate(` appears nearby. That proves the
 * guard is present in the text. It cannot prove the guard actually works --
 * a typo'd column name, an `OR` instead of `AND`, or a predicate applied to
 * the wrong alias in a multi-table JOIN would all pass the static scan
 * while silently leaking deleted data. This suite closes that gap by
 * seeding one active and one non-active row per lifecycle-scoped table and
 * calling the REAL application functions (not hand-rolled SQL) to prove
 * the non-active row never comes back.
 *
 * Covers all four lifecycle-scoped tables (lib/lifecycle/scopes.ts's
 * LifecycleScopedTable): accounts, policies, claim_evidence_documents,
 * family_members -- exercised through a representative, high-value sample
 * of the call sites migrated onto activePredicate() during this
 * checkpoint: lib/policies/linking.ts's familyMembersForAccount(),
 * lib/policies/inventory.ts's loadPolicyInventory(), lib/coverage/
 * facts.ts's confirmedOwnedCoverages(), and lib/household/export.ts's
 * buildHouseholdExportSnapshot() (which alone touches all four tables in
 * one call, plus is the one place an inactive ACCOUNT itself must make the
 * read fail rather than just filter a list).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { activePredicate, readIncludingDeletedForInternalUse, InternalReadAuthorizationError } from "@/lib/lifecycle/scopes";
import { familyMembersForAccount } from "@/lib/policies/linking";
import { loadPolicyInventory } from "@/lib/policies/inventory";
import { confirmedOwnedCoverages } from "@/lib/coverage/facts";
import { buildHouseholdExportSnapshot } from "@/lib/household/export";
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
function test(name: string, fn: () => void) {
  try {
    fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

// ---- activePredicate() / readIncludingDeletedForInternalUse() (pure) -----
test("activePredicate() with no alias returns the bare column predicate", () => {
  assert.equal(activePredicate(), "lifecycle_state='active'");
});
test("activePredicate(alias) qualifies the column with the given table alias", () => {
  assert.equal(activePredicate("p"), "p.lifecycle_state='active'");
});
test("readIncludingDeletedForInternalUse() does not throw for a context on the allowed list", () => {
  readIncludingDeletedForInternalUse("deletion_coordinator", "test");
});
test("readIncludingDeletedForInternalUse() throws InternalReadAuthorizationError for an unrecognized context", () => {
  // @ts-expect-error -- deliberately passing a context not in the allowed list
  assert.throws(() => readIncludingDeletedForInternalUse("not_a_real_context", "test"), InternalReadAuthorizationError);
});

async function seedAccount(db: typeof pool, opts?: { lifecycleState?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO accounts(id,name,lifecycle_state) VALUES ($1,'Test Household',$2)`, [id, opts?.lifecycleState ?? "active"]);
  return id;
}
async function seedFamilyMember(db: typeof pool, accountId: string, opts?: { lifecycleState?: string; displayName?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO family_members(id,account_id,display_name,relationship,lifecycle_state) VALUES ($1,$2,$3,'self',$4)`,
    [id, accountId, opts?.displayName ?? "Test Member", opts?.lifecycleState ?? "active"],
  );
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
async function seedClaimEvidenceDocument(db: typeof pool, accountId: string, familyMemberId: string, claimSessionId: string, opts?: { lifecycleState?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,lifecycle_state)
     VALUES ($1,$2,$3,$4,'death_certificate','cert.pdf',$5,'application/pdf',100,$6,$7)`,
    [id, accountId, familyMemberId, claimSessionId, `acct/evidence/${id}/cert.pdf`, `hash-${id}`, opts?.lifecycleState ?? "active"],
  );
  return id;
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-evidence.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-composition.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/benefit-catalog.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));
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

  const fakeScopedClient: ScopedDbClient = {
    query: (async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pool.query(text, params);
      return result as unknown as { rows: T[]; rowCount: number | null };
    }) as ScopedDbClient["query"],
  };

  try {
    // ---- family_members: familyMembersForAccount() -------------------
    await testAsync("familyMembersForAccount() excludes a soft-deleted family member and keeps the active one", async () => {
      const accountId = await seedAccount(pool);
      const activeId = await seedFamilyMember(pool, accountId, { displayName: "Active Member" });
      await seedFamilyMember(pool, accountId, { displayName: "Deleted Member", lifecycleState: "soft_deleted" });

      const result = await familyMembersForAccount(accountId);
      assert.equal(result.length, 1, "the soft-deleted member must not be returned");
      assert.equal(result[0].id, activeId);
    });

    // ---- policies: loadPolicyInventory() ------------------------------
    await testAsync("loadPolicyInventory() excludes a pending_deletion policy document and keeps the active one", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const activePolicyId = await seedPolicy(pool, accountId, memberId);
      const deletedPolicyId = await seedPolicy(pool, accountId, memberId, { lifecycleState: "pending_deletion" });

      const inventory = await loadPolicyInventory(accountId, [{ id: memberId, display_name: "Test Member", preferred_name: null, relationship: "self" }]);
      const ids = inventory.documents.map((d) => d.id);
      assert.ok(ids.includes(activePolicyId), "the active policy must still be in the inventory");
      assert.ok(!ids.includes(deletedPolicyId), "the pending_deletion policy must not be in the inventory");
    });

    // ---- policies (via JOIN): confirmedOwnedCoverages() ---------------
    await testAsync("confirmedOwnedCoverages() excludes a coverage row whose policy has been soft-deleted", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const activePolicyId = await seedPolicy(pool, accountId, memberId);
      const deletedPolicyId = await seedPolicy(pool, accountId, memberId, { lifecycleState: "soft_deleted" });
      await pool.query(
        `INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified)
         VALUES ($1,$2,$3,$4,'death','100000','USD',true,true)`,
        [randomUUID(), accountId, activePolicyId, memberId],
      );
      await pool.query(
        `INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,confirmed,evidence_verified)
         VALUES ($1,$2,$3,$4,'death','50000','USD',true,true)`,
        [randomUUID(), accountId, deletedPolicyId, memberId],
      );

      const coverages = await confirmedOwnedCoverages(accountId, memberId);
      const policyIds = coverages.map((c) => c.policyId);
      assert.ok(policyIds.includes(activePolicyId), "coverage on the active policy must still be returned");
      assert.ok(!policyIds.includes(deletedPolicyId), "coverage on the soft-deleted policy must be excluded -- it must never continue unlocking money");
    });

    // ---- accounts + all three child tables: buildHouseholdExportSnapshot() ----
    await testAsync("buildHouseholdExportSnapshot() excludes soft-deleted family members, policies, and claim evidence from an active household's export", async () => {
      const accountId = await seedAccount(pool);
      const activeMemberId = await seedFamilyMember(pool, accountId, { displayName: "Active Member" });
      const deletedMemberId = await seedFamilyMember(pool, accountId, { displayName: "Deleted Member", lifecycleState: "soft_deleted" });
      const activePolicyId = await seedPolicy(pool, accountId, activeMemberId);
      const deletedPolicyId = await seedPolicy(pool, accountId, activeMemberId, { lifecycleState: "pending_deletion" });
      const { rows: claimRows } = await pool.query<{ id: string }>(
        `INSERT INTO claim_sessions(id,account_id,family_member_id,status) VALUES ($1,$2,$3,'fact_finding') RETURNING id`,
        [randomUUID(), accountId, activeMemberId],
      );
      const claimSessionId = claimRows[0].id;
      const activeEvidenceId = await seedClaimEvidenceDocument(pool, accountId, activeMemberId, claimSessionId);
      const deletedEvidenceId = await seedClaimEvidenceDocument(pool, accountId, activeMemberId, claimSessionId, { lifecycleState: "soft_deleted" });

      const snapshot = await buildHouseholdExportSnapshot(fakeScopedClient, accountId);

      const memberIds = snapshot.familyMembers.map((m) => m.id);
      assert.ok(memberIds.includes(activeMemberId), "the active family member must be in the export");
      assert.ok(!memberIds.includes(deletedMemberId), "the soft-deleted family member must not be in the export");

      const policyIds = snapshot.policies.map((p) => p.id);
      assert.ok(policyIds.includes(activePolicyId), "the active policy must be in the export");
      assert.ok(!policyIds.includes(deletedPolicyId), "the pending_deletion policy must not be in the export");

      const evidenceIds = snapshot.evidence.map((e) => e.id);
      assert.ok(evidenceIds.includes(activeEvidenceId), "the active claim evidence document must be in the export");
      assert.ok(!evidenceIds.includes(deletedEvidenceId), "the soft-deleted claim evidence document must not be in the export -- deleted evidence must never appear in a household export");
    });

    await testAsync("buildHouseholdExportSnapshot() refuses to build a snapshot for a household that is itself not active", async () => {
      const accountId = await seedAccount(pool, { lifecycleState: "pending_deletion" });
      await assert.rejects(
        () => buildHouseholdExportSnapshot(fakeScopedClient, accountId),
        /not found/i,
        "a pending_deletion household must be treated the same as a nonexistent one for export purposes -- no export may be built against it",
      );
    });
  } finally {
    pool.query = originalQuery;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(
    `active-read-scopes regressions passed: ${cases} cases (activePredicate()/readIncludingDeletedForInternalUse() unit behavior, plus behavioral proof -- against real seeded active+non-active rows, through the real application functions, not static text scanning -- that familyMembersForAccount(), loadPolicyInventory(), confirmedOwnedCoverages(), and buildHouseholdExportSnapshot() all exclude non-active rows across all four lifecycle-scoped tables).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
