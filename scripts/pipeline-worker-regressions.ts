/**
 * Regression suite for Checkpoint 8's real-queue migration
 * (lib/jobs/pipeline-worker.ts) -- the shared "enqueue durably, then
 * process in this process, complete/fail through lib/jobs/queue.ts"
 * driver that lib/claims/evidence/queue.ts and
 * lib/rag/processing-queue.ts are now both built on, replacing their old
 * in-memory-only promise chains.
 *
 * Most cases exercise runAsDurableJob() directly with a fake `work()`
 * function against a disposable PGlite instance (sql/schema.sql +
 * sql/background-jobs.sql), the same pool-patching pattern as every other
 * suite in this checkpoint family. One case drives the REAL, migrated
 * lib/claims/evidence/queue.ts's enqueueClaimEvidenceProcessing() end to
 * end against a real (if minimal) claim-evidence fixture, reusing
 * lib/claims/evidence/store.ts's own functions -- not a reimplementation
 * -- to prove the actual production call site is wired onto the durable
 * job framework, not just the primitive underneath it in isolation.
 *
 * lib/rag/processing-queue.ts's enqueuePolicyProcessing() is
 * structurally identical (same runAsDurableJob() wrapper, same shape) but
 * does not get its own dedicated live processPolicy() end-to-end case
 * here -- no existing suite in this codebase drives processPolicy() with
 * a full fixture yet, and building that fixture from scratch (quarantine
 * state, OCR/extraction stubbing) is a separate, larger effort honestly
 * left for a follow-up rather than rushed. Its wiring is proven by (a)
 * scoped typecheck, (b) code-identical structure to the proven claims
 * path, and (c) runAsDurableJob()'s own generic, pipeline-agnostic
 * coverage below.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { setTelemetryAdapter } from "@/lib/telemetry";
import { NoopTelemetryAdapter } from "@/lib/telemetry/adapters";
import { runAsDurableJob, classifyPipelineError } from "@/lib/jobs/pipeline-worker";
import { claimNextJob } from "@/lib/jobs/queue";

const SQL_FILES = ["sql/schema.sql", "sql/background-jobs.sql"];

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

async function jobRow(jobType: string, idempotencyKey: string) {
  const result = await pool.query<{ status: string; attempt_count: number; last_error_category: string | null }>(
    `SELECT status, attempt_count, last_error_category FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`,
    [jobType, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function runPureTests() {
  test("classifyPipelineError treats a rate-limit-shaped message as transient", () => {
    assert.equal(classifyPipelineError(new Error("Model service is busy (429)")), "transient");
    assert.equal(classifyPipelineError(new Error("rate limit exceeded")), "transient");
  });
  test("classifyPipelineError treats a network-shaped message as transient", () => {
    assert.equal(classifyPipelineError(new Error("fetch failed: ECONNRESET")), "transient");
    assert.equal(classifyPipelineError(new Error("request timeout")), "transient");
  });
  test("classifyPipelineError defaults everything else to non_retryable", () => {
    assert.equal(classifyPipelineError(new Error("ENOENT: no such file or directory")), "non_retryable");
    assert.equal(classifyPipelineError(new Error("Invalid JSON payload")), "non_retryable");
    assert.equal(classifyPipelineError("a plain string error"), "non_retryable");
  });
}

async function runDatabaseTests() {
  setTelemetryAdapter(new NoopTelemetryAdapter());
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
    if (params.length === 0) {
      const results = await db.exec(text);
      const last = results[results.length - 1];
      return { rows: last?.rows ?? [], rowCount: (last as { affectedRows?: number } | undefined)?.affectedRows ?? last?.rows?.length ?? 0 };
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
    await testAsync("runAsDurableJob completes successfully and persists a succeeded row", async () => {
      const key = `success-${randomUUID()}`;
      let called = 0;
      await runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work: async () => { called++; } });
      assert.equal(called, 1);
      const row = await jobRow("test_pipeline", key);
      assert.equal(row?.status, "succeeded");
      assert.equal(row?.attempt_count, 1);
    });

    await testAsync("runAsDurableJob classifies a transient-shaped failure as failed_retryable, not dead_letter", async () => {
      const key = `transient-${randomUUID()}`;
      await assert.rejects(() =>
        runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work: async () => { throw new Error("upstream rate limit (429)"); } }),
      );
      const row = await jobRow("test_pipeline", key);
      assert.equal(row?.status, "failed_retryable");
      assert.equal(row?.last_error_category, "transient");
    });

    await testAsync("runAsDurableJob classifies a non-retryable-shaped failure as dead_letter immediately, even on attempt 1", async () => {
      const key = `nonretryable-${randomUUID()}`;
      await assert.rejects(() =>
        runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work: async () => { throw new Error("ENOENT: source file missing"); } }),
      );
      const row = await jobRow("test_pipeline", key);
      assert.equal(row?.status, "dead_letter");
      assert.equal(row?.last_error_category, "non_retryable");
    });

    await testAsync("runAsDurableJob re-throws the original error so an existing caller catch still runs", async () => {
      const key = `rethrow-${randomUUID()}`;
      let caught: unknown = null;
      try {
        await runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work: async () => { throw new Error("specific failure message"); } });
      } catch (error) {
        caught = error;
      }
      assert.ok(caught instanceof Error);
      assert.equal((caught as Error).message, "specific failure message");
    });

    await testAsync("runAsDurableJob is idempotent: a repeat call for an already-succeeded idempotencyKey never re-runs work()", async () => {
      const key = `idempotent-${randomUUID()}`;
      let called = 0;
      const work = async () => { called++; };
      await runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work });
      await runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work });
      await runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work });
      assert.equal(called, 1, "work() must run exactly once across three enqueue calls for the same finished job");
    });

    await testAsync("runAsDurableJob never runs work() for a job another caller already holds the lease on", async () => {
      const key = `already-claimed-${randomUUID()}`;
      // Enqueue first (without running it) by claiming it out from under a
      // future runAsDurableJob call, simulating a concurrent process that
      // is already processing this exact idempotency key.
      const { enqueueJob } = await import("@/lib/jobs/queue");
      await enqueueJob(pool, { jobType: "test_pipeline", idempotencyKey: key });
      const otherWorkerId = "other-worker-already-processing";
      const claimed = await claimNextJob(pool, { jobType: "test_pipeline", workerId: otherWorkerId });
      assert.ok(claimed, "fixture assumes the job is claimable");

      let called = 0;
      await runAsDurableJob({ jobType: "test_pipeline", idempotencyKey: key, work: async () => { called++; } });
      assert.equal(called, 0, "a job already 'processing' under another lease must not be run again");
    });

    // ============================================================

    await testAsync("runAsDurableJob only ever runs work() for the row it actually enqueued, never a different queued job of the same jobType that claimNextJob() happens to pick up", async () => {
      // claimNextJob() claims the OLDEST available row of a jobType, not
      // necessarily the one this call just enqueued -- job_type is shared
      // across every document/policy (e.g. "claim_evidence_processing" for
      // every claim evidence document in the system). Leave an earlier job
      // of the SAME jobType genuinely queued (never claimed), then enqueue
      // and run a second, newer job of that jobType: claimNextJob() must
      // claim the older row, so runAsDurableJob() must detect the mismatch
      // and return WITHOUT running work() for the wrong job.
      const jobType = "test_pipeline_shared";
      const olderKey = `older-${randomUUID()}`;
      const newerKey = `newer-${randomUUID()}`;
      const { enqueueJob } = await import("@/lib/jobs/queue");
      await enqueueJob(pool, { jobType, idempotencyKey: olderKey });

      let called = 0;
      await runAsDurableJob({ jobType, idempotencyKey: newerKey, work: async () => { called++; } });
      assert.equal(called, 0, "work() must not run when claimNextJob() claimed a different (older) job than the one just enqueued");

      const newerRow = await jobRow(jobType, newerKey);
      assert.equal(newerRow?.status, "queued", "the newer job must remain untouched -- still queued, not falsely completed");
      const olderRow = await jobRow(jobType, olderKey);
      assert.equal(olderRow?.status, "processing", "the older job is the one that actually got claimed");
    });

    // ============================================================
    // Real end-to-end: the actual migrated claim-evidence queue
    // ============================================================
    await testAsync("end-to-end: enqueueClaimEvidenceProcessing() (the real, migrated call site) persists both the pipeline's own effect and a background_jobs row", async () => {
      const { ensureClaimEvidenceSchema } = await import("@/lib/claims/evidence/schema");
      await ensureClaimEvidenceSchema();
      // lifecycle_state (activePredicate()) is added by sql/lifecycle.sql, but
      // its claim_evidence_documents ALTER is a no-op until that table exists --
      // exec it now, after ensureClaimEvidenceSchema() has just created it, the
      // same ordering scripts/claim-evidence-regressions.ts uses.
      await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
      const { createEvidenceDocument, transitionEvidenceStatus, getEvidenceDocument } = await import("@/lib/claims/evidence/store");
      const { enqueueClaimEvidenceProcessing } = await import("@/lib/claims/evidence/queue");

      const account = randomUUID();
      const member = randomUUID();
      const claimSession = randomUUID();
      await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'E2E Test')`, [account]);
      await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,'Test Person','Test','self')`, [member, account]);
      await pool.query(`INSERT INTO claim_sessions(id,account_id,family_member_id,status,event_type) VALUES($1,$2,$3,'fact_finding','death')`, [claimSession, account, member]);

      const { document } = await createEvidenceDocument({
        accountId: account, familyMemberId: member, claimSessionId: claimSession, documentType: "police_report",
        originalFilename: "e2e.pdf", storageKey: "nonexistent-key-e2e", mimeType: "application/pdf", byteSize: 100, fileHash: `hash-e2e-${randomUUID()}`,
      });
      // A scan_status of 'clean' clears the quarantine gate (the same
      // fixture shape scripts/claim-evidence-regressions.ts's own "a
      // document whose scan is explicitly clean is allowed past
      // quarantine" case uses) -- storageKey does not point at a real
      // file, so processClaimEvidence() is expected to fail once it tries
      // to actually read it, which is the real, non-retryable failure this
      // test proves gets durably recorded rather than silently lost.
      await transitionEvidenceStatus({ accountId: account, id: document.id, from: "uploaded", to: "quarantined", scanStatus: "clean" });

      await enqueueClaimEvidenceProcessing({ accountId: account, documentId: document.id });

      const afterPipeline = await getEvidenceDocument(account, document.id);
      assert.equal(afterPipeline?.status, "failed", "the real pipeline's own effect (writing status='failed' for an unreadable file) must still happen exactly as before this migration");

      const row = await jobRow("claim_evidence_processing", document.id);
      assert.ok(row, "the migrated call site must persist a background_jobs row -- this is the entire point of the migration");
      assert.equal(row!.status, "dead_letter", "an ENOENT-shaped failure is non-retryable and must dead-letter immediately, not silently vanish or retry forever");
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

async function main() {
  runPureTests();
  await runDatabaseTests();
  console.log(
    `pipeline-worker regressions passed: ${cases} cases (error classification, successful/transient/non-retryable ` +
      `job outcomes, error re-throw, idempotent no-op on a finished job, no double-run against an already-claimed ` +
      `lease, and a real end-to-end run through the migrated lib/claims/evidence/queue.ts proving both the ` +
      `pipeline's own effect and the durable job row are persisted together).`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
