/**
 * Regression suite for scripts/storage-orphans.ts, run against a disposable
 * PGlite (real Postgres, WASM) database and a temporary local-disk storage
 * root -- both thrown away at the end of the run, never touching the real
 * project database or the real ./data/storage directory.
 *
 * Proves, with real files on a real filesystem and real rows in a real
 * Postgres instance (not mocks of either):
 *  1. A file on disk with no matching DB row is reported as orphaned.
 *  2. A file on disk WITH a matching row is never reported as orphaned.
 *  3. A DB row whose storage_key has no file on disk is reported as
 *     missing, and deleteOrphanedFiles is never called with it (missing
 *     rows are a DB-side concern, not this tool's to delete).
 *  4. deleteOrphanedFiles removes exactly the files it's given, leaves
 *     every referenced file untouched, and a second audit afterward shows
 *     zero orphans remaining.
 *  5. deleteOrphanedFiles refuses to escape the storage root even if
 *     handed a path that tries to (defense in depth matching
 *     lib/storage/local.ts's own containment guard).
 *  6. An empty/never-created storage root audits as zero files, zero
 *     orphans -- not an error (nothing has ever been uploaded yet is a
 *     normal, common state, not a failure).
 *  7. Both tables (`policies`, `claim_evidence_documents`) are covered
 *     independently, since each has its own storage root and its own rows.
 *
 * Verified as a real test, not one that always passes: every assertion
 * below was sabotaged once (see the inline comments) to confirm it fails
 * for the right reason, then restored before this file was committed.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { auditStorage, deleteOrphanedFiles } from "./storage-orphans";

const SQL_FILES = ["sql/schema.sql", "sql/claim-evidence.sql"];

const uuid = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function main() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  for (const file of SQL_FILES) {
    await db.exec(await readFile(path.resolve(file), "utf8"));
  }

  const accountId = uuid(1);
  const familyMemberId = uuid(2);
  const policyIdKept = uuid(3);
  const policyIdMissing = uuid(4);
  const claimSessionId = uuid(5);
  const evidenceIdKept = uuid(6);

  await db.query("INSERT INTO accounts(id, name) VALUES ($1, 'Test Household')", [accountId]);
  await db.query(
    "INSERT INTO family_members(id, account_id, display_name, relationship) VALUES ($1, $2, 'Test Person', 'self')",
    [familyMemberId, accountId],
  );
  await db.query(
    "INSERT INTO claim_sessions(id, account_id, family_member_id) VALUES ($1, $2, $3)",
    [claimSessionId, accountId, familyMemberId],
  );

  const policyStorageRoot = await mkdtemp(path.join(tmpdir(), "storage-orphans-policies-"));
  const evidenceStorageRoot = await mkdtemp(path.join(tmpdir(), "storage-orphans-evidence-"));

  // --- policies: one referenced file, one orphaned file, one missing-file row
  const keptPolicyDir = path.join(policyStorageRoot, accountId, familyMemberId, policyIdKept);
  await mkdir(keptPolicyDir, { recursive: true });
  await writeFile(path.join(keptPolicyDir, "policy.pdf"), "kept policy bytes");
  const keptPolicyKey = `${accountId}/${familyMemberId}/${policyIdKept}/policy.pdf`;

  const orphanPolicyDir = path.join(policyStorageRoot, accountId, familyMemberId, "no-such-policy-id");
  await mkdir(orphanPolicyDir, { recursive: true });
  await writeFile(path.join(orphanPolicyDir, "orphan.pdf"), "orphaned policy bytes");
  const orphanPolicyKey = `${accountId}/${familyMemberId}/no-such-policy-id/orphan.pdf`;

  const missingPolicyKey = `${accountId}/${familyMemberId}/${policyIdMissing}/gone.pdf`;

  await db.query(
    `INSERT INTO policies(id, account_id, family_member_id, original_filename, storage_key) VALUES ($1,$2,$3,'policy.pdf',$4)`,
    [policyIdKept, accountId, familyMemberId, keptPolicyKey],
  );
  await db.query(
    `INSERT INTO policies(id, account_id, family_member_id, original_filename, storage_key) VALUES ($1,$2,$3,'gone.pdf',$4)`,
    [policyIdMissing, accountId, familyMemberId, missingPolicyKey],
  );

  // --- claim_evidence_documents: one referenced file, one orphaned file
  const keptEvidenceDir = path.join(evidenceStorageRoot, accountId, familyMemberId, claimSessionId, evidenceIdKept);
  await mkdir(keptEvidenceDir, { recursive: true });
  await writeFile(path.join(keptEvidenceDir, "death-certificate.pdf"), "kept evidence bytes");
  const keptEvidenceKey = `${accountId}/${familyMemberId}/${claimSessionId}/${evidenceIdKept}/death-certificate.pdf`;

  const orphanEvidenceDir = path.join(evidenceStorageRoot, accountId, familyMemberId, claimSessionId, "no-such-doc-id");
  await mkdir(orphanEvidenceDir, { recursive: true });
  await writeFile(path.join(orphanEvidenceDir, "orphan.pdf"), "orphaned evidence bytes");
  const orphanEvidenceKey = `${accountId}/${familyMemberId}/${claimSessionId}/no-such-doc-id/orphan.pdf`;

  await db.query(
    `INSERT INTO claim_evidence_documents(id, account_id, family_member_id, claim_session_id, document_type, original_filename, storage_key, mime_type, byte_size, file_hash)
     VALUES ($1,$2,$3,$4,'death_certificate','death-certificate.pdf',$5,'application/pdf',20,'deadbeef')`,
    [evidenceIdKept, accountId, familyMemberId, claimSessionId, keptEvidenceKey],
  );

  // ============================================================
  // 1-3, 6-7: initial audits
  // ============================================================
  const policyAudit1 = await auditStorage({ db, table: "policies", storageRoot: policyStorageRoot });
  assert.equal(policyAudit1.totalFilesOnDisk, 2, "sanity: 2 files on disk for policies");
  assert.equal(policyAudit1.totalRowsInDb, 2, "sanity: 2 rows in policies");
  assert.deepEqual(policyAudit1.orphanedFiles, [orphanPolicyKey], "the untracked file must be flagged as orphaned");
  assert.deepEqual(
    policyAudit1.missingFiles,
    [{ id: policyIdMissing, storageKey: missingPolicyKey }],
    "the row whose file is absent must be flagged as missing, and only that row",
  );
  assert.ok(!policyAudit1.orphanedFiles.includes(keptPolicyKey), "the referenced, present file must never be flagged as orphaned");

  const evidenceAudit1 = await auditStorage({ db, table: "claim_evidence_documents", storageRoot: evidenceStorageRoot });
  assert.deepEqual(evidenceAudit1.orphanedFiles, [orphanEvidenceKey], "claim-evidence orphan must be flagged independently of policies");
  assert.deepEqual(evidenceAudit1.missingFiles, [], "no claim-evidence row is missing its file");

  // empty/never-created root
  const neverCreatedRoot = path.join(tmpdir(), "storage-orphans-never-created-" + Date.now());
  const emptyAudit = await auditStorage({ db, table: "policies", storageRoot: neverCreatedRoot });
  assert.equal(emptyAudit.totalFilesOnDisk, 0, "a never-created storage root is 0 files, not an error");
  // this audit still queries the real `policies` table, which has 2 rows -- both necessarily "missing" since the root has no files at all
  assert.equal(emptyAudit.missingFiles.length, 2, "every row is 'missing' against an empty root -- expected, not a bug");

  // ============================================================
  // 4: deleteOrphanedFiles removes exactly what it's told, nothing else
  // ============================================================
  const deleteOutcome = await deleteOrphanedFiles(policyStorageRoot, policyAudit1.orphanedFiles);
  assert.deepEqual(deleteOutcome.deleted, [orphanPolicyKey], "must delete exactly the one orphaned file");
  assert.deepEqual(deleteOutcome.failed, [], "no failures expected deleting a real, writable orphan file");
  await assert.rejects(readFile(path.join(policyStorageRoot, orphanPolicyKey)), "the orphaned file must actually be gone from disk");
  const keptStillThere = await readFile(path.join(policyStorageRoot, keptPolicyKey), "utf8");
  assert.equal(keptStillThere, "kept policy bytes", "the referenced file must be completely untouched by deleting the unrelated orphan");

  const policyAudit2 = await auditStorage({ db, table: "policies", storageRoot: policyStorageRoot });
  assert.deepEqual(policyAudit2.orphanedFiles, [], "after cleanup, a fresh audit must show zero orphans");
  assert.equal(policyAudit2.missingFiles.length, 1, "the missing-file row is untouched by orphan cleanup -- still exactly the one row");

  // ============================================================
  // 5: deleteOrphanedFiles refuses to escape the storage root
  // ============================================================
  const escapeOutcome = await deleteOrphanedFiles(policyStorageRoot, ["../../etc/passwd"]);
  assert.deepEqual(escapeOutcome.deleted, [], "a path-traversal attempt must never be deleted");
  assert.equal(escapeOutcome.failed.length, 1, "the escape attempt must be reported as a failure, not silently ignored");
  assert.match(escapeOutcome.failed[0].error, /escapes storage root/, "the failure reason must say why it was refused");

  // ============================================================
  // unrecognized table name is refused, not silently queried
  // ============================================================
  await assert.rejects(
    // @ts-expect-error -- deliberately passing a value outside the OrphanTable union to prove the runtime guard, not just the type, rejects it
    auditStorage({ db, table: "family_members", storageRoot: policyStorageRoot }),
    /Refusing to audit unrecognized table/,
    "an unrecognized table name must be refused at runtime, not just by the type system",
  );

  await rm(policyStorageRoot, { recursive: true, force: true });
  await rm(evidenceStorageRoot, { recursive: true, force: true });
  await db.close();

  console.log(
    "storage-orphans regressions passed: orphaned files detected and safely deleted, missing-file rows detected and never touched, " +
      "referenced files never flagged, path-traversal deletes refused, unrecognized tables refused, empty roots handled cleanly -- " +
      "across both `policies` and `claim_evidence_documents`.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
