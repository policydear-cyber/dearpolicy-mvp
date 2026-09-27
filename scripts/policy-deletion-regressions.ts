/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening) sub-
 * checkpoint 2: whole-policy deletion (lib/lifecycle/coordinator.ts's
 * requestPolicyDeletion/finishPolicyDeletion, resource_type='policy').
 *
 * Complements scripts/lifecycle-regressions.ts (state machine,
 * deletion-request idempotency, the single-document policy_document
 * flow) with the behaviour specific to deleting a WHOLE logical policy:
 * the supersedes_id version chain, shared reference-document protection
 * and orphan cleanup, and resetting an open claim session's stale
 * decision once a policy it depended on is gone. Runs against a
 * disposable PGlite instance, same convention as every other suite in
 * this repository.
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
import { DeletionValidationError, finishPolicyDeletion, requestPolicyDeletion } from "@/lib/lifecycle/coordinator";
import type { ScopedDbClient } from "@/lib/db/authz-client";
import { loadLedger, loadLedgerRow } from "@/lib/ledger/store";

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

async function seedFamilyMember(db: typeof pool, accountId: string, name = "Test Member"): Promise<string> {
  const id = randomUUID();
  await db.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,$3,'self')`, [id, accountId, name]);
  return id;
}

async function seedPolicy(
  db: typeof pool,
  accountId: string,
  familyMemberId: string,
  opts?: { lifecycleState?: string; supersedesId?: string | null; personalCoverageConfirmed?: boolean; groupPolicyNumber?: string | null },
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state,supersedes_id,personal_coverage_confirmed,group_policy_number,quarantine_status)
     VALUES ($1,$2,$3,'test.pdf',$4,'ready',$5,$6,$7,$8,'scan_clean')`,
    [
      id,
      accountId,
      familyMemberId,
      `acct/policy/${id}/test.pdf`,
      opts?.lifecycleState ?? "active",
      opts?.supersedesId ?? null,
      opts?.personalCoverageConfirmed ?? true,
      opts?.groupPolicyNumber ?? null,
    ],
  );
  return id;
}

async function linkSchemeReference(db: typeof pool, accountId: string, refPolicyId: string, familyMemberId: string) {
  await db.query(
    `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES ($1,$2,$3,'scheme_reference_match',0.9)`,
    [refPolicyId, familyMemberId, accountId],
  );
}

async function linkOwnership(db: typeof pool, accountId: string, policyId: string, familyMemberId: string) {
  await db.query(
    `INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence) VALUES ($1,$2,$3,'upload',1.0)`,
    [policyId, familyMemberId, accountId],
  );
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

async function seedCauseMatch(db: typeof pool, args: { accountId: string; familyMemberId: string; claimSessionId: string; contractId: string; evidenceDocumentId: string }) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_cause_definition_matches(id,account_id,family_member_id,claim_session_id,contract_id,evidence_document_id,cause_evidence,definition_evidence,result,reviewed_by)
     VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb,'{}'::jsonb,'matches','tester')`,
    [id, args.accountId, args.familyMemberId, args.claimSessionId, args.contractId, args.evidenceDocumentId],
  );
  return id;
}

async function seedEvidenceDocument(db: typeof pool, accountId: string, familyMemberId: string, claimSessionId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
     VALUES ($1,$2,$3,$4,'death_certificate','doc.pdf','key','application/pdf',10,$5)`,
    [id, accountId, familyMemberId, claimSessionId, randomUUID()],
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
  await db.exec(await readFile(path.resolve("sql/coverage-ledger.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/chat-upgrade.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/background-jobs.sql"), "utf8"));

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
    await testAsync("requestPolicyDeletion deletes an independent policy without touching an unrelated one", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const targetId = await seedPolicy(pool, accountId, memberId);
      const otherId = await seedPolicy(pool, accountId, memberId);

      const outcome = await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: targetId,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-1",
      });
      assert.equal(outcome.status, "accepted");
      assert.deepEqual(outcome.chainPolicyIds, [targetId]);

      const target = await getLifecycleState(pool, { resourceType: "policy", resourceId: targetId, accountId });
      const other = await getLifecycleState(pool, { resourceType: "policy", resourceId: otherId, accountId });
      assert.equal(target?.lifecycle_state, "pending_deletion");
      assert.equal(other?.lifecycle_state, "active", "an unrelated, independent policy must never be touched");
    });

    await testAsync("requestPolicyDeletion includes the full supersedes_id version chain in both directions", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const oldest = await seedPolicy(pool, accountId, memberId);
      const middle = await seedPolicy(pool, accountId, memberId, { supersedesId: oldest });
      const newest = await seedPolicy(pool, accountId, memberId, { supersedesId: middle });

      // Deleting the MIDDLE version must pull in both the older version it
      // supersedes and the newer version that supersedes it.
      const outcome = await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: middle,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-chain",
      });
      assert.equal(outcome.status, "accepted");
      assert.deepEqual([...outcome.chainPolicyIds].sort(), [oldest, middle, newest].sort());

      for (const id of [oldest, middle, newest]) {
        const state = await getLifecycleState(pool, { resourceType: "policy", resourceId: id, accountId });
        assert.equal(state?.lifecycle_state, "pending_deletion", `${id} must be part of the deleted chain`);
      }
    });

    await testAsync("requestPolicyDeletion refuses to delete a shared reference document still authorizing another active family member", async () => {
      const accountId = await seedAccount(pool);
      const member1 = await seedFamilyMember(pool, accountId, "Member One");
      const member2 = await seedFamilyMember(pool, accountId, "Member Two");
      const refDoc = await seedPolicy(pool, accountId, member1, { personalCoverageConfirmed: false });
      const personal1 = await seedPolicy(pool, accountId, member1, { personalCoverageConfirmed: true });
      const personal2 = await seedPolicy(pool, accountId, member2, { personalCoverageConfirmed: true });
      await linkOwnership(pool, accountId, personal1, member1);
      await linkOwnership(pool, accountId, personal2, member2);
      await linkSchemeReference(pool, accountId, refDoc, member1);
      await linkSchemeReference(pool, accountId, refDoc, member2);

      await assert.rejects(
        () =>
          requestPolicyDeletion({
            client: fakeScopedClient,
            accountId,
            actorUserId: randomUUID(),
            policyId: refDoc,
            reasonCategory: "user_requested",
            idempotencyKey: "whole-blocked",
          }),
        DeletionValidationError,
      );

      const refState = await getLifecycleState(pool, { resourceType: "policy", resourceId: refDoc, accountId });
      const p1State = await getLifecycleState(pool, { resourceType: "policy", resourceId: personal1, accountId });
      const p2State = await getLifecycleState(pool, { resourceType: "policy", resourceId: personal2, accountId });
      assert.equal(refState?.lifecycle_state, "active", "a blocked deletion must never partially apply to the reference document");
      assert.equal(p1State?.lifecycle_state, "active");
      assert.equal(p2State?.lifecycle_state, "active", "another family member's own personal cover must never be touched by a blocked deletion");
    });

    await testAsync("requestPolicyDeletion cascades an orphaned reference document once its last authorized personal policy is deleted", async () => {
      const accountId = await seedAccount(pool);
      const member1 = await seedFamilyMember(pool, accountId, "Only Member");
      const refDoc = await seedPolicy(pool, accountId, member1, { personalCoverageConfirmed: false });
      const personal1 = await seedPolicy(pool, accountId, member1, { personalCoverageConfirmed: true });
      await linkOwnership(pool, accountId, personal1, member1);
      await linkSchemeReference(pool, accountId, refDoc, member1);

      const outcome = await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: personal1,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-orphan",
      });
      assert.equal(outcome.status, "accepted");
      assert.ok(outcome.chainPolicyIds.includes(refDoc), "the now-orphaned shared reference document must be cascaded into the same deletion");

      const refState = await getLifecycleState(pool, { resourceType: "policy", resourceId: refDoc, accountId });
      assert.equal(refState?.lifecycle_state, "pending_deletion");
    });

    await testAsync("requestPolicyDeletion resets an OPEN claim session's stale decision after superseding its matched definition", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const sessionId = await seedClaimSession(pool, accountId, memberId, { status: "fact_finding" });
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      const matchId = await seedCauseMatch(pool, { accountId, familyMemberId: memberId, claimSessionId: sessionId, contractId: policyId, evidenceDocumentId: evidenceId });

      await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-claim-open",
      });

      const match = await pool.query<{ superseded_at: string | null; superseded_reason: string | null }>(
        `SELECT superseded_at::text, superseded_reason FROM claim_cause_definition_matches WHERE id=$1`,
        [matchId],
      );
      assert.ok(match.rows[0].superseded_at, "the definition match must be superseded once its contract is deleted");
      assert.equal(match.rows[0].superseded_reason, "policy_deleted");

      const session = await pool.query<{ status: string; decision_packet: unknown; pending_question: unknown }>(
        `SELECT status, decision_packet, pending_question FROM claim_sessions WHERE id=$1`,
        [sessionId],
      );
      assert.equal(session.rows[0].status, "fact_finding");
      assert.equal(session.rows[0].decision_packet, null, "a stale decision packet computed against a deleted policy must be cleared");
      assert.equal(session.rows[0].pending_question, null);
    });

    await testAsync("requestPolicyDeletion supersedes a match on a COMPLETED claim's history without disturbing its decision packet", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const sessionId = await seedClaimSession(pool, accountId, memberId, { status: "complete" });
      const evidenceId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      const matchId = await seedCauseMatch(pool, { accountId, familyMemberId: memberId, claimSessionId: sessionId, contractId: policyId, evidenceDocumentId: evidenceId });

      await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-claim-complete",
      });

      const match = await pool.query<{ superseded_at: string | null }>(`SELECT superseded_at::text FROM claim_cause_definition_matches WHERE id=$1`, [matchId]);
      assert.ok(match.rows[0].superseded_at, "a match against a deleted policy must never keep unlocking anything, even for a completed claim");

      const session = await pool.query<{ status: string; decision_packet: unknown }>(`SELECT status, decision_packet FROM claim_sessions WHERE id=$1`, [sessionId]);
      assert.equal(session.rows[0].status, "complete", "a completed claim's own immutable audit history must not be rewritten");
      assert.notEqual(session.rows[0].decision_packet, null, "the completed claim's decision packet is audit history, not a live cache -- it stays");
    });

    await testAsync("premium_records is invalidated for every policy in the deleted chain", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const older = await seedPolicy(pool, accountId, memberId);
      const newer = await seedPolicy(pool, accountId, memberId, { supersedesId: older });
      await pool.query(
        `INSERT INTO premium_records(id,account_id,family_member_id,policy_id,amount,currency,frequency,payment_date) VALUES ($1,$2,$3,$4,100,'USD','monthly',now())`,
        [randomUUID(), accountId, memberId, older],
      );
      await pool.query(
        `INSERT INTO premium_records(id,account_id,family_member_id,source_document_id,amount,currency,frequency,payment_date) VALUES ($1,$2,$3,$4,100,'USD','monthly',now())`,
        [randomUUID(), accountId, memberId, newer],
      );

      await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: newer,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-premiums",
      });

      const remaining = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM premium_records WHERE account_id=$1`, [accountId]);
      assert.equal(remaining.rows[0].n, "0");
    });

    await testAsync("deleting a document sweeps its analysis cache and scrubs the job payload's PDF password", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      await pool.query(
        `INSERT INTO policy_analysis_cache(account_id,cache_key,analysis_json) VALUES ($1,$2,'{}'::jsonb),($1,$3,'{}'::jsonb)`,
        [accountId, `catalog-progress:benefits:${policyId}`, `chat-analysis:${policyId}:q1`],
      );
      await pool.query(
        `INSERT INTO background_jobs(account_id,job_type,idempotency_key,payload) VALUES ($1,'policy_processing',$2,$3::jsonb)`,
        [accountId, policyId, JSON.stringify({ policyId, storageKey: "k", pdfPassword: "a-password" })],
      );

      await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "side-channels",
      });

      const cache = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM policy_analysis_cache WHERE account_id=$1`, [accountId]);
      assert.equal(cache.rows[0].n, "0", "no analysis-cache rows for the deleted document survive");
      const job = await pool.query<{ payload: { pdfPassword?: string }; cancel_requested: boolean }>(
        `SELECT payload, cancel_requested FROM background_jobs WHERE account_id=$1 AND idempotency_key=$2`, [accountId, policyId]);
      assert.equal(job.rows[0].payload.pdfPassword, undefined, "the PDF password is scrubbed from the job payload");
      assert.equal(job.rows[0].cancel_requested, true, "any in-flight processing is asked to stop");
    });

    await testAsync("requestPolicyDeletion is idempotent across the whole chain: a retry returns the same request without duplicating audit rows", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const older = await seedPolicy(pool, accountId, memberId);
      const newer = await seedPolicy(pool, accountId, memberId, { supersedesId: older });

      const first = await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: newer,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-retry",
      });
      await finishPolicyDeletion({ accountId, actorUserId: randomUUID(), policyId: newer, chainPolicyIds: first.chainPolicyIds, deletionRequestId: first.deletionRequestId });

      const second = await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: newer,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-retry",
      });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const auditRows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM policy_document_audit_log WHERE policy_id=ANY($1::uuid[]) AND action='deleted'`,
        [[older, newer]],
      );
      assert.equal(auditRows.rows[0].n, "2", "one audit row per chain member, never duplicated on retry");
    });

    await testAsync("deleting a whole policy that does not exist is reported as a validation error, not thrown unhandled", async () => {
      const accountId = await seedAccount(pool);
      await assert.rejects(() =>
        requestPolicyDeletion({
          client: fakeScopedClient,
          accountId,
          actorUserId: randomUUID(),
          policyId: randomUUID(),
          reasonCategory: "user_requested",
          idempotencyKey: "whole-missing",
        }),
      );
    });

    await testAsync("activeStorageKeys() stops protecting every chain member's storage object once the whole policy is deleted", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const keptId = await seedPolicy(pool, accountId, memberId);
      const older = await seedPolicy(pool, accountId, memberId);
      const newer = await seedPolicy(pool, accountId, memberId, { supersedesId: older });

      await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId: newer,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-storage",
      });

      const keys = await activeStorageKeys(pool, "policy");
      const kept = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM policies WHERE id=$1`, [keptId]);
      const olderRow = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM policies WHERE id=$1`, [older]);
      const newerRow = await pool.query<{ storage_key: string }>(`SELECT storage_key FROM policies WHERE id=$1`, [newer]);
      assert.ok(keys.has(kept.rows[0].storage_key), "an unrelated, independent policy's storage object must stay protected");
      assert.ok(!keys.has(olderRow.rows[0].storage_key), "every chain member, including the older superseded version, must lose storage protection");
      assert.ok(!keys.has(newerRow.rows[0].storage_key));
    });

    await testAsync("a deleted policy's coverage-ledger rows stop appearing on the Coverage Ledger immediately", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const untiedRowId = randomUUID();
      const tiedRowId = randomUUID();
      await pool.query(
        `INSERT INTO coverage_rules(id,account_id,family_member_id,policy_id,plan_name,event_type,detail,pays_kind,amount,currency,note,origin,status)
         VALUES ($1,$2,$3,NULL,'Standard Default','death',NULL,'lump_sum',100000,'SGD',NULL,'person','confirmed')`,
        [untiedRowId, accountId, memberId],
      );
      await pool.query(
        `INSERT INTO coverage_rules(id,account_id,family_member_id,policy_id,plan_name,event_type,detail,pays_kind,amount,currency,note,origin,status)
         VALUES ($1,$2,$3,$4,'Group Term Life','death',NULL,'lump_sum',500000,'SGD',NULL,'wording','confirmed')`,
        [tiedRowId, accountId, memberId, policyId],
      );

      const before = await loadLedger(accountId, [memberId]);
      assert.equal(before.length, 2, "both the standalone row and the policy-tied row must show before deletion");

      await requestPolicyDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        policyId,
        reasonCategory: "user_requested",
        idempotencyKey: "whole-ledger",
      });

      const after = await loadLedger(accountId, [memberId]);
      assert.deepEqual(after.map((r) => r.id), [untiedRowId], "the deleted policy's own ledger row must stop appearing; a row with no policy_id must stay");

      const tiedRow = await loadLedgerRow(accountId, tiedRowId);
      assert.equal(tiedRow, null, "loadLedgerRow must also exclude a row whose policy was deleted");
      const untiedRow = await loadLedgerRow(accountId, untiedRowId);
      assert.ok(untiedRow, "a row with no policy_id must still be individually loadable");
    });
  } finally {
    pool.query = originalQuery;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`policy-deletion regressions passed: ${cases} cases (version-chain resolution, shared reference-document protection & orphan cascade, open/completed claim invalidation, premium-records cleanup, idempotency, storage-cleanup integration, coverage-ledger exclusion).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
