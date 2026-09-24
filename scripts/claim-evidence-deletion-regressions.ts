/**
 * Regression suite for Checkpoint 7 (claude/v1-launch-hardening): claim-
 * evidence document deletion (lib/lifecycle/coordinator.ts's
 * requestClaimEvidenceDeletion/finishClaimEvidenceDeletion,
 * resource_type='claim_evidence').
 *
 * Checkpoint 14d integrity correction: package.json has referenced
 * `security:claim-evidence-deletion-test` -> scripts/claim-evidence-
 * deletion-regressions.ts since Checkpoint 7, but this file did not exist
 * in the committed repo until this checkpoint -- confirmed missing via a
 * fresh GITHUB_GET_A_TREE listing against the real branch head, not a
 * local-checkout artifact. Prior PR #16 checkpoints reported running this
 * exact suite and getting real pass counts; those reports were false (see
 * PR #16's "Checkpoint 14d" section for the specific sections named).
 *
 * lib-level (coordinator-level), not route-level, and this is a genuine
 * finding of this checkpoint, not a shortcut: unlike the other 4 suites
 * in this same checkpoint, NO route anywhere under app/api/claims/evidence
 * calls requestClaimEvidenceDeletion, and there is no DELETE handler for a
 * claim-evidence document anywhere in this codebase at all (confirmed by
 * grepping every app/api/claims/evidence/** route for both "DELETE" and
 * every coordinator export -- the only destructive-adjacent route is
 * reject/route.ts, which calls transitionEvidenceStatus() to move a
 * document to status='rejected', a completely different, non-destructive,
 * business-status flow that never touches lifecycle_state).
 * requestClaimEvidenceDeletion/finishClaimEvidenceDeletion are reachable
 * only by a future route today -- dead code, honestly reported as such in
 * PR #16 rather than silently tested as if a route already called it.
 * This suite proves the coordinator functions themselves work correctly
 * so that wiring a future DELETE route is a route-shell exercise, not a
 * new lifecycle bug hunt, using the same style template
 * scripts/policy-deletion-regressions.ts already established for the
 * other coordinator flow with no meaningfully different route wrapper:
 * a fakeScopedClient that proxies straight to the PGlite-backed pool with
 * no RLS layer (there is no real request/session to derive RLS identity
 * from for a flow with no route), relying on the coordinator's own
 * explicit `WHERE id=$1 AND account_id=$2` predicate as the defense-in-
 * depth authorization boundary -- exactly what this suite's sabotage
 * cycle (see the checkpoint's PR notes) targets.
 *
 * A second, separately-reported finding surfaced while writing this
 * suite's downstream-exclusion case: lib/claims/evidence/store.ts's
 * getScopedEvidenceDocument()/listEvidenceDocuments()/getEvidenceDocument()
 * do NOT filter on lifecycle_state at all (grepped directly -- zero
 * matches), despite this coordinator's own comment above
 * requestClaimEvidenceDeletion() claiming "every read this checkpoint has
 * migrated (getEvidenceDocument, listEvidenceDocuments, etc. in
 * lib/claims/evidence/store.ts) already filters lifecycle_state='active'".
 * That comment is false as of this checkpoint. Deliberately NOT "fixed"
 * here (out of this suite's scope, and store.ts is a shared, heavily-used
 * module across the whole claim-evidence pipeline that deserves its own
 * reviewed change, not a drive-by edit buried in a test-suite commit) --
 * flagged explicitly in PR #16's Checkpoint 14d section as follow-up work
 * instead. This suite's own downstream-exclusion assertion instead uses
 * the read path the coordinator DOES correctly and verifiably invalidate:
 * lib/claims/evidence/store.ts's loadActiveCauseDefinitionMatches(),
 * which invalidateClaimMatchesReferencing() explicitly supersedes
 * (superseded_at=now()) for every match citing the deleted evidence
 * document -- see the "downstream exclusion" case below.
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
import { DeletionValidationError, finishClaimEvidenceDeletion, requestClaimEvidenceDeletion } from "@/lib/lifecycle/coordinator";
import type { ScopedDbClient } from "@/lib/db/authz-client";
import { loadActiveCauseDefinitionMatches } from "@/lib/claims/evidence/store";

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

async function seedPolicy(db: typeof pool, accountId: string, familyMemberId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,lifecycle_state,personal_coverage_confirmed)
     VALUES ($1,$2,$3,'test.pdf',$4,'ready','active',true)`,
    [id, accountId, familyMemberId, `acct/policy/${id}/test.pdf`],
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

async function seedEvidenceDocument(db: typeof pool, accountId: string, familyMemberId: string, claimSessionId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO claim_evidence_documents(id,account_id,family_member_id,claim_session_id,document_type,original_filename,storage_key,mime_type,byte_size,file_hash)
     VALUES ($1,$2,$3,$4,'death_certificate','doc.pdf','key','application/pdf',10,$5)`,
    [id, accountId, familyMemberId, claimSessionId, randomUUID()],
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
  // ensureClaimEvidenceSchema() (called internally by
  // lib/claims/evidence/audit.ts/store.ts) uses pool.connect() directly,
  // not pool.query() -- must be patched too or it tries a real TCP
  // connection and fails with ECONNREFUSED in this sandbox.
  pool.connect = (async () => {
    const release = await acquire();
    return { query: execute, release } as any;
  }) as typeof pool.connect;

  // Same ordering fix scripts/full-household-e2e-regressions.ts and
  // scripts/pipeline-worker-regressions.ts already established: apply the
  // lazy claim-evidence migration once up front, then re-apply
  // sql/lifecycle.sql so its ALTER TABLE for claim_evidence_documents is
  // guaranteed to run after the table's final shape is settled.
  const { ensureClaimEvidenceSchema } = await import("@/lib/claims/evidence/schema");
  await ensureClaimEvidenceSchema();
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));

  const fakeScopedClient: ScopedDbClient = {
    query: (async <T extends Record<string, unknown>>(text: string, params: unknown[] = []) => {
      const result = await pool.query(text, params);
      return result as unknown as { rows: T[]; rowCount: number | null };
    }) as ScopedDbClient["query"],
  };

  try {
    await testAsync("requestClaimEvidenceDeletion + finishClaimEvidenceDeletion moves an active document through pending_deletion to soft_deleted, with one audit row", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const docId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      const outcome = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: docId,
        reasonCategory: "user_requested",
        idempotencyKey: "ce-happy-1",
      });
      assert.equal(outcome.status, "accepted");
      assert.equal(outcome.filename, "doc.pdf");

      const mid = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: docId, accountId });
      assert.equal(mid?.lifecycle_state, "pending_deletion", "the document's own lifecycle_state must move to pending_deletion immediately -- this alone is what revokes logical access (activePredicate() already excludes it)");

      await finishClaimEvidenceDeletion({ accountId, actorUserId: randomUUID(), evidenceDocumentId: docId, deletionRequestId: outcome.deletionRequestId });

      // finishClaimEvidenceDeletion (matching finishPolicyDocumentDeletion's
      // own, identical convention) transitions the deletion_requests
      // BOOKKEEPING row to soft_deleted -- it deliberately does NOT call
      // transitionLifecycle() again on the claim_evidence_documents row
      // itself, which stays at pending_deletion permanently (there is no
      // further transition anywhere in this codebase that would move it).
      // pending_deletion is already fully excluded from every active read
      // (activePredicate() only matches lifecycle_state='active'), so nothing
      // is left un-revoked; this suite asserts the REAL, current two-track
      // behaviour rather than a plausible-sounding but false expectation.
      const final = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: docId, accountId });
      assert.equal(final?.lifecycle_state, "pending_deletion");

      const requestRow = await pool.query<{ lifecycle_state: string }>(`SELECT lifecycle_state FROM deletion_requests WHERE id=$1`, [outcome.deletionRequestId]);
      assert.equal(requestRow.rows[0].lifecycle_state, "soft_deleted", "the deletion_requests bookkeeping row is what reaches soft_deleted to mark the request completed");

      const auditRows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_type='claim_evidence' AND resource_id=$1`,
        [docId],
      );
      assert.equal(auditRows.rows[0].n, "1");
    });

    await testAsync("requestClaimEvidenceDeletion refuses to delete a document belonging to a DIFFERENT household even when it forges the target household's own accountId", async () => {
      const householdA = await seedAccount(pool);
      const memberA = await seedFamilyMember(pool, householdA, "Household A Member");
      const sessionA = await seedClaimSession(pool, householdA, memberA);
      const victimDocId = await seedEvidenceDocument(pool, householdA, memberA, sessionA);

      const householdB = await seedAccount(pool);

      // The attacker calls the coordinator claiming to be householdB (a
      // household they DO belong to -- no forged JWT/session needed) but
      // names household A's own evidence document id. The coordinator's
      // explicit `WHERE id=$1 AND account_id=$2` predicate is the ONLY
      // thing standing between this and a cross-household deletion, since
      // fakeScopedClient carries no RLS of its own (see file header) --
      // exactly the line this suite's sabotage cycle targets.
      await assert.rejects(
        () =>
          requestClaimEvidenceDeletion({
            client: fakeScopedClient,
            accountId: householdB,
            actorUserId: randomUUID(),
            evidenceDocumentId: victimDocId,
            reasonCategory: "user_requested",
            idempotencyKey: "ce-cross-household-1",
          }),
        DeletionValidationError,
      );

      const victimState = await getLifecycleState(pool, { resourceType: "claim_evidence", resourceId: victimDocId, accountId: householdA });
      assert.equal(victimState?.lifecycle_state, "active", "a cross-household deletion attempt must never touch the victim document's real state");
    });

    await testAsync("deleting an evidence document invalidates its OPEN claim session's stale cause-definition match on the real downstream read path (loadActiveCauseDefinitionMatches)", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const sessionId = await seedClaimSession(pool, accountId, memberId, { status: "fact_finding" });
      const docId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      await seedCauseMatch(pool, { accountId, familyMemberId: memberId, claimSessionId: sessionId, contractId: policyId, evidenceDocumentId: docId });

      const before = await loadActiveCauseDefinitionMatches(accountId, memberId, sessionId);
      assert.equal(before.length, 1, "the match must be visible on the real downstream read path before deletion");

      const outcome = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: docId,
        reasonCategory: "user_requested",
        idempotencyKey: "ce-downstream-1",
      });
      assert.deepEqual(outcome.affectedOpenClaimSessionIds, [sessionId]);

      const after = await loadActiveCauseDefinitionMatches(accountId, memberId, sessionId);
      assert.equal(after.length, 0, "the deleted document's match must be excluded from the real downstream read path immediately, not just marked in a table nothing reads");

      const session = await pool.query<{ status: string; decision_packet: unknown }>(`SELECT status, decision_packet FROM claim_sessions WHERE id=$1`, [sessionId]);
      assert.equal(session.rows[0].status, "fact_finding");
      assert.equal(session.rows[0].decision_packet, null, "an open session's stale decision computed against the deleted evidence must be cleared");
    });

    await testAsync("deleting an evidence document does NOT disturb a COMPLETED claim session's own audit history", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const policyId = await seedPolicy(pool, accountId, memberId);
      const sessionId = await seedClaimSession(pool, accountId, memberId, { status: "complete" });
      const docId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);
      await seedCauseMatch(pool, { accountId, familyMemberId: memberId, claimSessionId: sessionId, contractId: policyId, evidenceDocumentId: docId });

      await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: docId,
        reasonCategory: "user_requested",
        idempotencyKey: "ce-completed-1",
      });

      const after = await loadActiveCauseDefinitionMatches(accountId, memberId, sessionId);
      assert.equal(after.length, 0, "a match against deleted evidence must never keep unlocking anything, even for a completed claim");

      const session = await pool.query<{ status: string; decision_packet: unknown }>(`SELECT status, decision_packet FROM claim_sessions WHERE id=$1`, [sessionId]);
      assert.equal(session.rows[0].status, "complete", "a completed claim's own immutable history must not be rewritten by a later evidence deletion");
      assert.notEqual(session.rows[0].decision_packet, null);
    });

    await testAsync("requestClaimEvidenceDeletion is idempotent: a retry with the same idempotencyKey returns the same request without duplicating audit rows", async () => {
      const accountId = await seedAccount(pool);
      const memberId = await seedFamilyMember(pool, accountId);
      const sessionId = await seedClaimSession(pool, accountId, memberId);
      const docId = await seedEvidenceDocument(pool, accountId, memberId, sessionId);

      const first = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: docId,
        reasonCategory: "user_requested",
        idempotencyKey: "ce-retry-1",
      });
      await finishClaimEvidenceDeletion({ accountId, actorUserId: randomUUID(), evidenceDocumentId: docId, deletionRequestId: first.deletionRequestId });

      const second = await requestClaimEvidenceDeletion({
        client: fakeScopedClient,
        accountId,
        actorUserId: randomUUID(),
        evidenceDocumentId: docId,
        reasonCategory: "user_requested",
        idempotencyKey: "ce-retry-1",
      });
      assert.equal(second.deletionRequestId, first.deletionRequestId);
      assert.equal(second.status, "completed");

      const auditRows = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM deletion_audit_log WHERE resource_type='claim_evidence' AND resource_id=$1`,
        [docId],
      );
      assert.equal(auditRows.rows[0].n, "1", "a retry must never duplicate the audit trail");
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
          idempotencyKey: "ce-missing-1",
        }),
      );
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  await runDatabaseTests();
  console.log(`claim-evidence-deletion regressions passed: ${cases} cases (happy path through soft_deleted with audit, cross-household boundary via the coordinator's own account_id predicate, real downstream-exclusion via loadActiveCauseDefinitionMatches for both an open and a completed claim session, idempotent retry, not-found handling). NOTE: this suite is lib-level, not route-level -- see file header for why no route exists yet for this flow, and for the separately-reported lib/claims/evidence/store.ts activePredicate gap this suite's downstream check deliberately routes around.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
