/**
 * Checkpoint 14i (claude/v1-launch-hardening): behavioral proof that
 * household export generation is genuinely enqueue-only + separate-
 * worker-claim -- the same Checkpoint 14f producer/consumer topology
 * scripts/worker-runtime-regressions.ts and
 * scripts/pipeline-worker-regressions.ts already prove for policy/
 * claim-evidence processing, now proven for the export path too (see
 * app/api/household/export/route.ts's own doc comment and
 * lib/household/export-queue.ts/lib/household/export-generation.ts).
 *
 * Runs against a disposable PGlite instance, like the other suites this
 * branch has added. Unlike scripts/household-export-regressions.ts (which
 * calls buildHouseholdExportSnapshot() directly against a plain
 * query-only wrapper -- see that file's own doc comment on why it does
 * not exercise lib/db/authz-client.ts's createUserSupabaseClient()), this
 * suite exercises the REAL production call chain end to end, including
 * createUserSupabaseClient()'s own BEGIN/SET LOCAL ROLE
 * authenticated/set_config('request.jwt.claim.sub', ...)/COMMIT
 * transaction -- by giving `pool.connect()` (not just `pool.query()`) a
 * PGlite-backed adapter. PGlite is a single connection, so `connect()`
 * calls are serialized through the same tail-queue technique
 * scripts/household-export-regressions.ts already uses for `query()`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pool } from "@/lib/db/client";
import { getExportRow, markExportRunning, createOrGetExportRequest, reapStaleRunningExports } from "@/lib/household/export-store";
import { enqueueHouseholdExport, HOUSEHOLD_EXPORT_JOB_TYPE } from "@/lib/household/export-queue";
import { claimAndProcessOne } from "@/lib/jobs/worker-runtime";
// Checkpoint 14i: imports lib/jobs/household-export-processor.ts
// DIRECTLY, not lib/jobs/processors.ts -- that module's top-level
// imports (processPolicy()/processClaimEvidence(), which transitively
// pull in the PDF-parsing/OCR/AI-extraction/Pinecone stack) are real
// weight this suite has no reason to pay for just to exercise the
// export worker path. PRODUCTION_JOB_TYPES registration itself is
// proven separately below by reading lib/jobs/processors.ts's own
// source, and end to end by scripts/e2e/stages/05-export.ts's real
// runWorkerOnce("household_export") call (which DOES go through the
// real processors.ts/PRODUCTION_JOB_TYPES lookup, in the full orchestrator).
import { processHouseholdExportJob } from "@/lib/jobs/household-export-processor";

let cases = 0;
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    cases++;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}

async function main() {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.waitReady;
  await db.exec(await readFile(path.resolve("sql/schema.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-evidence.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/claim-composition.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/benefit-catalog.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/household-rls.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/lifecycle.sql"), "utf8"));
  await db.exec(await readFile(path.resolve("sql/background-jobs.sql"), "utf8"));

  // Serializes every real query AND every "connected client" session
  // against PGlite's single underlying connection, so createUserSupabase
  // Client()'s own BEGIN/COMMIT transaction never interleaves with a
  // concurrent plain pool.query() call from elsewhere in the same test.
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
  const rawQuery = async (text: string, params: unknown[] = []) => {
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
      return await rawQuery(text, params);
    } finally {
      release();
    }
  }) as typeof pool.query;
  // A pooled client "connection" is really just a hold on the SAME
  // single-threaded acquire() lock for the whole BEGIN..COMMIT/ROLLBACK
  // span -- released only when the caller calls .release(), exactly like
  // a real pg.PoolClient's lifecycle from the caller's point of view.
  pool.connect = (async () => {
    const release = await acquire();
    let released = false;
    return {
      query: async (text: string, params: unknown[] = []) => rawQuery(text, params),
      release: () => {
        if (released) return;
        released = true;
        release();
      },
    };
  }) as typeof pool.connect;

  try {
    const ownerId = randomUUID();
    const householdId = randomUUID();
    await pool.query(`INSERT INTO accounts(id,name) VALUES ($1,$2)`, [householdId, "Worker export household"]);
    await pool.query(`INSERT INTO household_members(household_id,user_id,role) VALUES ($1,$2,'owner')`, [householdId, ownerId]);
    const memberId = randomUUID();
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ($1,$2,'Riley Doe','self')`, [memberId, householdId]);

    await testAsync(
      "enqueueHouseholdExport() enqueues a real background_jobs row and returns without generating anything -- the export row stays exactly as the caller (mimicking the route) left it, no inline processing",
      async () => {
        const { row } = await createOrGetExportRequest(pool, { householdId, requestedBy: ownerId, idempotencyKey: "worker-test-1" });
        const running = await markExportRunning(pool, row.id);
        assert.ok(running, "the route's own markExportRunning() CAS transition must still work unchanged");
        assert.equal(running!.status, "running");

        await enqueueHouseholdExport({ exportId: row.id, householdId, requestedBy: ownerId });

        // Immediately after enqueueing (no worker has run yet): the export
        // row must be untouched -- still `running`, no storage_key, no
        // content -- proving enqueueHouseholdExport() itself never calls
        // generateAndStoreHouseholdExport().
        const stillRunning = await getExportRow(pool, householdId, row.id);
        assert.ok(stillRunning);
        assert.equal(stillRunning!.status, "running", "enqueueHouseholdExport() must not have generated the export inline");
        assert.equal(stillRunning!.storage_key, null, "no storage object should exist until a separate worker pass actually runs");

        const jobRows = await pool.query<{ job_type: string; status: string; idempotency_key: string }>(
          `SELECT job_type, status, idempotency_key FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`,
          [HOUSEHOLD_EXPORT_JOB_TYPE, row.id],
        );
        assert.equal(jobRows.rows.length, 1, "enqueueHouseholdExport() must persist exactly one background_jobs row");
        assert.equal(jobRows.rows[0].status, "queued");

        // Test isolation (test-integrity fix, alongside Defect D10/D11):
        // this job has now served its purpose (proving enqueue-only, no
        // inline processing). Left "queued", it would sit ahead of a later
        // test's own job in claimNextJob()'s FIFO ordering (both share
        // job_type=HOUSEHOLD_EXPORT_JOB_TYPE) and get claimed by a later
        // test's single claimAndProcessOne() call instead of that test's
        // own job -- silently breaking that test's assertions about its OWN
        // export/job, not a production code bug. Cancel it here so each
        // later test's single claim call observes exactly the one job it
        // itself enqueued.
        await pool.query(`UPDATE background_jobs SET status='cancelled' WHERE job_type=$1 AND idempotency_key=$2`, [
          HOUSEHOLD_EXPORT_JOB_TYPE,
          row.id,
        ]);
      },
    );

    await testAsync(
      "a real, separately-invoked worker pass (claimAndProcessOne(), the exact primitive scripts/worker.ts's standalone poll loop calls) claims the queued household_export job and completes it -- through the REAL processHouseholdExportJob -> generateAndStoreHouseholdExport() -> createUserSupabaseClient()/buildHouseholdExportSnapshot() chain, not a stub",
      async () => {
        const { row } = await createOrGetExportRequest(pool, { householdId, requestedBy: ownerId, idempotencyKey: "worker-test-2" });
        await markExportRunning(pool, row.id);
        await enqueueHouseholdExport({ exportId: row.id, householdId, requestedBy: ownerId });

        // lib/jobs/processors.ts's PRODUCTION_JOB_TYPES registration is
        // checked via its own source text here (cheap, no heavy import)
        // rather than importing that module directly -- see this file's
        // own import comment.
        const processorsSource = await readFile(path.resolve("lib/jobs/processors.ts"), "utf8");
        assert.match(
          processorsSource,
          /\{\s*jobType:\s*HOUSEHOLD_EXPORT_JOB_TYPE,\s*process:\s*processHouseholdExportJob\s*\}/,
          "household_export must be registered in PRODUCTION_JOB_TYPES (with the real processor, not a substitute) so scripts/worker.ts actually runs it",
        );

        const outcome = await claimAndProcessOne({ jobType: HOUSEHOLD_EXPORT_JOB_TYPE, workerId: "test-worker-1", process: processHouseholdExportJob });
        assert.equal(outcome, "succeeded", "the worker's own claim-and-run pass must complete the export job");

        const ready = await getExportRow(pool, householdId, row.id);
        assert.ok(ready);
        assert.equal(ready!.status, "ready", "the export must be genuinely completed by the WORKER, not left running forever");
        assert.ok(ready!.storage_key, "a real storage object must have been written by the worker pass");
        assert.ok(ready!.manifest_hash);
        assert.ok(typeof ready!.byte_size === "number" && ready!.byte_size! > 0);

        // The content itself is real, RLS-scoped export content (proving
        // createUserSupabaseClient(args.requestedBy, ...) inside the
        // worker really resolved this household's own data), not empty.
        const { readHouseholdExportFile } = await import("@/lib/storage");
        const bytes = await readHouseholdExportFile(ready!.storage_key!);
        const text = new TextDecoder().decode(bytes);
        assert.ok(text.includes("Riley Doe"), "the worker-generated export must contain the real household data, not a stub");
      },
    );

    await testAsync(
      "claimAndProcessOne() against an empty household_export queue finds nothing to do -- proving the job really is gone/claimed exactly once, not left duplicated",
      async () => {
        const outcome = await claimAndProcessOne({ jobType: HOUSEHOLD_EXPORT_JOB_TYPE, workerId: "test-worker-2", process: processHouseholdExportJob });
        assert.equal(outcome, "empty");
      },
    );

    await testAsync(
      "reapStaleRunningExports() marks a stuck 'running' export failed once its background job has permanently dead-lettered, but leaves an actively-retrying export alone",
      async () => {
        const { row: deadLettered } = await createOrGetExportRequest(pool, { householdId, requestedBy: ownerId, idempotencyKey: "reaper-test-dead-letter" });
        await markExportRunning(pool, deadLettered.id);
        await enqueueHouseholdExport({ exportId: deadLettered.id, householdId, requestedBy: ownerId });
        await pool.query(`UPDATE background_jobs SET status='dead_letter' WHERE job_type=$1 AND idempotency_key=$2`, [
          HOUSEHOLD_EXPORT_JOB_TYPE,
          deadLettered.id,
        ]);

        const { row: stillRetrying } = await createOrGetExportRequest(pool, { householdId, requestedBy: ownerId, idempotencyKey: "reaper-test-still-retrying" });
        await markExportRunning(pool, stillRetrying.id);
        await enqueueHouseholdExport({ exportId: stillRetrying.id, householdId, requestedBy: ownerId });
        await pool.query(`UPDATE background_jobs SET status='failed_retryable' WHERE job_type=$1 AND idempotency_key=$2`, [
          HOUSEHOLD_EXPORT_JOB_TYPE,
          stillRetrying.id,
        ]);

        const reaped = await reapStaleRunningExports(pool, 0);
        const reapedIds = reaped.map((r) => r.id);
        assert.ok(reapedIds.includes(deadLettered.id), "a running export whose background job has dead-lettered must be reaped to failed");
        assert.ok(!reapedIds.includes(stillRetrying.id), "a running export whose background job is still queued/processing/failed_retryable must NOT be reaped");

        const deadLetteredRow = await getExportRow(pool, householdId, deadLettered.id);
        assert.equal(deadLetteredRow!.status, "failed");
        assert.ok(
          deadLetteredRow!.error && !deadLetteredRow!.error.includes("dead_letter"),
          "the row's client-facing error must be a safe generic message, not a raw job-status/internal string",
        );

        const stillRetryingRow = await getExportRow(pool, householdId, stillRetrying.id);
        assert.equal(stillRetryingRow!.status, "running", "an actively-retrying export must be left running, not raced by the reaper");

        // Test isolation, same reasoning as the earlier "cancel the queued
        // job" comment above: this job has served its purpose.
        await pool.query(`UPDATE background_jobs SET status='cancelled' WHERE job_type=$1 AND idempotency_key=$2`, [
          HOUSEHOLD_EXPORT_JOB_TYPE,
          stillRetrying.id,
        ]);
      },
    );

    await testAsync(
      "reapStaleRunningExports() reaps an orphaned 'running' export with no background_jobs row at all, but only once it is past the staleness threshold",
      async () => {
        const { row: orphan } = await createOrGetExportRequest(pool, { householdId, requestedBy: ownerId, idempotencyKey: "reaper-test-orphan" });
        await markExportRunning(pool, orphan.id);
        // Deliberately never enqueued -- reproduces
        // app/api/household/export/route.ts's own markExportRunning()-
        // succeeded-but-enqueueHouseholdExport()-threw failure window.

        const tooSoon = await reapStaleRunningExports(pool, 24 * 60 * 60 * 1000);
        assert.ok(
          !tooSoon.some((r) => r.id === orphan.id),
          "an orphaned export younger than the staleness threshold must not be reaped yet -- it may just be mid-enqueue",
        );
        const stillRunning = await getExportRow(pool, householdId, orphan.id);
        assert.equal(stillRunning!.status, "running");

        const reaped = await reapStaleRunningExports(pool, 0);
        assert.ok(reaped.some((r) => r.id === orphan.id), "the same orphaned export, once past the staleness threshold, must be reaped to failed");
        const failedRow = await getExportRow(pool, householdId, orphan.id);
        assert.equal(failedRow!.status, "failed");
      },
    );

    console.log(
      `household-export-worker regressions passed: ${cases} cases (enqueueHouseholdExport() is genuinely enqueue-only with no inline ` +
        `generation, a separately-invoked worker pass claims and completes it through the real processHouseholdExportJob/` +
        `generateAndStoreHouseholdExport()/createUserSupabaseClient() chain with real content, the job is claimed exactly once, and ` +
        `reapStaleRunningExports() recovers a stuck "running" export -- dead-lettered or orphaned -- without racing one still actively working).`,
    );
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
