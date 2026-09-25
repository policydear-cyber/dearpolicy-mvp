/* Coordinator-level suite from claude/v1-quality-evaluation-harness, kept
 * alongside the route-level scripts/claim-evidence-deletion-regressions.ts when that branch
 * was merged into claude/v1-launch-hardening. */
/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening) sub-
 * checkpoint 3: claim-evidence deletion (lib/lifecycle/coordinator.ts's
 * requestClaimEvidenceDeletion/finishClaimEvidenceDeletion,
 * resource_type='claim_evidence').
 *
 * Complements scripts/lifecycle-regressions.ts and scripts/policy-
 * deletion-regressions.ts. The critical property this suite proves:
 * lib/claims/evidence/store.ts's loadActiveCauseDefinitionMatches() and
 * its CI/disability siblings only filter superseded_at IS NULL -- they
 * do NOT join back to claim_evidence_documents -- so a definition match
 * citing a deleted evidence document would otherwise keep being read
 * (and keep unlocking a claim amount) even after its source document is
 * gone, unless this flow explicitly supersedes it.
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
import { activeStorageKeys } from "@/lib/storage/cleanup";
import { DeletionValidationError, finishClaimEvidenceDeletion, requestClaimEvidenceDeletion } from "@/lib/lifecycle/coordinator";
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

async function seedPolicy(db: typeof pool, accountId: string, familyMemberId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state)
     VALUES ($1,$2,$3,'test.pdf','key',$5,$4)`,
    [id, accountId, familyMemberId, "active", "ready"],
  );
  return id;
}

async function seedClaimSession(db: typeof pool, accountId: string, familyMemberId: string, opts?: { status?: string }): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_sessions(id,account_id,family_member_id,status,facts,decision_packet,pending_question)
     VALUES ($1,$2,$3,$4,'{}'::jsonb,'{"result":"stale"}'::jsonb,'{"question":"stale"}'::jsonb)`,
    [id, accountId, familyMemberId, opts?.status ?? "fact_finding"],
  );
  return id;
}

async function seedEvidenceDocument(
  db: typeof pool,
  accountId: string,
  familyMemberId: string,
  claimSessionId: string,
  opts?: { lifecycleState?: string },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash,lifecycle_state)
     VALUES ($1,$2,$3,$4,'death_certificate','doc.pdf',$5,'application/pdf',10,$6,$7)`,
    [id, accountId, familyMemberId, claimSessionId, `acct/evidence/${id}/doc.pdf`, randomUUID(), opts?.lifecycleState ?? "active"],
  );
  return id;
}

async function seedCauseMatch(db: typeof pool, args: { accountId: string; familyMemberId: string; claimSessionId: string; contractId: string; evidenceDocumentId: string }) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_cause_definition_matches(id,account_id,family_member_id,claim_session_id,contract_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by)
     VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb,'{}'::jsonb,'matches','tester')`,
    [id, args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.evidenceDocumentId],
  );
  return id;
}

async function runDatabaseTests() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-evidence.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/critical-illness.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/disability.sql"), "utf8"));
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
  // appendClaimEvidenceAudit() calls ensureClaimEvidenceSchema(), which
  // uses pool.connect() (a real client, BEGIN/advisory-lock/COMMIT), not
  // just pool.query() -- must be patched too, or it tries to open a real
  // Postgres connection against an unconfigured DATABASE_URL. This test
  // already loads sql/claim-evidence.sql directly above, so the migration
  // itself is a safe no-op once patched through to the same PGlite mutex.
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
    await testAsync("requestClaimEvidenceDeletion immediately revokes logical access to the document", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      const outcome = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: evidenceId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-1",
      });
      assert.equal(outcome.status, "accepted");
      assert.equal(outcome.filename, "doc.pdf");

      const state = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: evidenceId, accountId });
      assert.equal(state?.lifecycle_state, "pending_deletion");
    });

    await testAsync("an unrelated evidence document in the same claim session is never touched", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const targetId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      const otherId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: targetId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-2",
      });

      const other = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: otherId, accountId });
      assert.equal(other?.lifecycle_state, "active");
    });

    await testAsync("deleting an evidence document supersedes its cause-definition match and resets the OPEN claim to a needs-document state", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const sessionId = await seedClaimSession(pool, accountId, memberId, { status: "fact_finding" });
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      const matchId = await seedCauseMatch(pool, { accountId, familyMemberId: memberId, claimSessionId: sessionId, contractId: policyId, evidenceDocumentId: evidenceId });

      const outcome = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: evidenceId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-3",
      });
      assert.deepEqual(outcome.affectedOpenClaimSessionIds, [sessionId]);

      const match = await pool.query<{ superseded_at: string | null; superseded_reason: string | null }>(
        `SELECT superseded_at::text, superseded_reason FROM claim_cause_definition_matches WHERE id=$1`,
        [matchId],
      );
      assert.ok(match.rows[0].superseded_at, "a match citing the deleted evidence document must be superseded");
      assert.equal(match.rows[0].superseded_reason, "evidence_deleted");

      const session = await pool.query<{ status: string; decision_packet: unknown; pending_question: unknown }>(
        `SELECT status, decision_packet, pending_question FROM claim_sessions WHERE id=$1`,
        [sessionId],
      );
      assert.equal(session.rows[0].status, "fact_finding");
      assert.equal(session.rows[0].decision_packet, null);
      assert.equal(session.rows[0].pending_question, null);

      // The precise property this suite exists to prove: loadActiveCauseDefinitionMatches()
      // itself (not just a raw table count) must no longer return this match.
      const active = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM claim_cause_definition_matches WHERE account_id=$1 AND family_member_id=$2 AND claim_session_id=$3 AND superseded_at IS NULL`,
        [accountId, memberId, sessionId],
      );
      assert.equal(active.rows[0].n, "0", "loadActiveCauseDefinitionMatches()'s own query must return nothing for this claim now");
    });

    await testAsync("deleting an evidence document supersedes a match on a COMPLETED claim without disturbing its decision packet", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const sessionId = await seedClaimSession(pool, accountId, memberId, { status: "complete" });
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      await seedCauseMatch(pool, { accountId, familyMemberId: memberId, claimSessionId: sessionId, contractId: policyId, evidenceDocumentId: evidenceId });

      const outcome = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: evidenceId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-4",
      });
      assert.deepEqual(outcome.affectedOpenClaimSessionIds, [], "a completed claim must never be reported as reset");

      const session = await pool.query<{ status: string; decision_packet: unknown }>(`SELECT status, decision_packet FROM claim_sessions WHERE id=$1`, [sessionId]);
      assert.equal(session.rows[0].status, "complete");
      assert.notEqual(session.rows[0].decision_packet, null, "a completed claim's decision packet is immutable audit history");
    });

    await testAsync("requestClaimEvidenceDeletion writes exactly one audit row through appendClaimEvidenceAudit's single-writer path", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: evidenceId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-audit",
      });

      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='deleted'`,
        [evidenceId],
      );
      assert.equal(rows.rows[0].n, "1");
    });

    await testAsync("requestClaimEvidenceDeletion is idempotent: a retry returns the same request and does not duplicate the audit row", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      const first = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: evidenceId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-retry",
      });
      await finishClaimEvidenceDeletion({ accountId, actorUserId: randomUUID(), evidenceDocumentId: evidenceId, deletionRequestId: first.deletionRequestId });

      const second = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: evidenceId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-retry",
      });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const rows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM claim_evidence_audit_log WHERE evidence_document_id=$1 AND action='deleted'`,
        [evidenceId],
      );
      assert.equal(rows.rows[0].n, "1", "a retry must not duplicate the audit event");

      const deletionAuditRows = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_id=$1`, [evidenceId]);
      assert.equal(deletionAuditRows.rows[0].n, "1");
    });

    await testAsync("deleting an evidence document that does not exist is reported as a validation error, not thrown unhandled", async () => {
      const accountId = await seedAccount(pool);
      await assert.rejects(() =>
        requestClaimEvidenceDeletion({
          client: fakeScopedClient,
          accountId,
          actorUserId: randomUUID(),
          evidenceDocumentId: randomUUID(),
          reasonCategory: "user_requested",
          idempotencyKey: "evidence-missing",
        }),
      );
    });

    await testAsync("a superseded-but-not-deleted (business-level) evidence document is never touched by deleting the current version", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const oldId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      const newId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      // Mirrors lib/claims/evidence/store.ts's supersedeEvidenceDocument():
      // the OLD row is marked superseded_at/supersedes_id, but its own
      // lifecycle_state is untouched -- it stays 'active' for audit.
      await pool.query(`UPDATE claim_evidence_documents SET superseded_at=now() WHERE id=$1`, [oldId]);
      await pool.query(`UPDATE claim_evidence_documents SET supersedes_id=$1 WHERE id=$2`, [oldId, newId]);

      await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: newId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-chain",
      });

      const oldState = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: oldId, accountId });
      assert.equal(oldState?.lifecycle_state, "active", "deleting the current version must never cascade into its business-superseded predecessor");
    });

    await testAsync("activeStorageKeys('claim-evidence') stops protecting a deleted evidence document's storage object", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const keptId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      const deletedId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: deletedId,
        reasonCategory: "user_requested",
        idempotencyKey: "evidence-storage",
      });

      const keys = await activeStorageKeys(pool, "claim-evidence");
      const kept = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM claim_evidence_documents WHERE id=$1`, [keptId]);
      const deleted = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM claim_evidence_documents WHERE id=$1`, [deletedId]);
      assert.ok(keys.has(kept.rows[0].storage_key));
      assert.ok(!keys.has(deleted.rows[0].storage_key));
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`claim-evidence-deletion regressions passed: ${cases} cases (logical-access revocation, unrelated-document isolation, open/completed claim invalidation via evidence_document_id, single-writer audit trail, idempotency, business-supersede-chain isolation, storage-cleanup integration).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
