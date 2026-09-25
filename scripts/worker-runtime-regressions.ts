/**
 * Regression suite for Checkpoint 14f's lib/jobs/worker-runtime.ts --
 * the standalone claim-and-run driver (claimAndProcessOne() /
 * runWorkerLoop()) that makes it possible for a job to be enqueued by
 * one process/call and actually claimed and completed by a completely
 * separate, later call -- the real gap
 * scripts/launch-check.ts's background_job_reliability diagnosis named
 * (every real call site previously claimed and ran the job it had just
 * enqueued, synchronously, inside its own process).
 *
 * Same disposable-PGlite + pool-patching pattern as
 * scripts/pipeline-worker-regressions.ts and
 * scripts/background-jobs-regressions.ts. Every case here uses a fake
 * `process()` function (never processPolicy()/processClaimEvidence()
 * themselves -- that real-pipeline proof lives in
 * scripts/pipeline-worker-regressions.ts, which now also proves the
 * genuinely-separate-worker-pass case end to end against the real claim-
 * evidence pipeline); this suite is about the worker-loop mechanics
 * themselves, independent of which pipeline runs inside them.
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
import { enqueueJob } from "@/lib/jobs/queue";
import { claimAndProcessOne, runWorkerLoop } from "@/lib/jobs/worker-runtime";

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

async function jobRow(jobType: string, idempotencyKey: string) {
  const result = await pool.query<{ status: string; attempt_count: number; lease_owner: string | null }>(
    `SELECT status, attempt_count, lease_owner FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`,
    [jobType, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function main() {
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
    await testAsync("claimAndProcessOne returns 'empty' when nothing is queued", async () => {
      const outcome = await claimAndProcessOne({ jobType: "wr_test_empty", workerId: "w1", process: async () => {} });
      assert.equal(outcome, "empty");
    });

    await testAsync("claimAndProcessOne claims a job a DIFFERENT call enqueued (never enqueues itself) and completes it", async () => {
      const jobType = "wr_test_separate";
      const key = `sep-${randomUUID()}`;
      // Simulates a request handler enqueuing and returning -- this call
      // never claims or runs anything.
      await enqueueJob(pool, { jobType, idempotencyKey: key });
      const before = await jobRow(jobType, key);
      assert.equal(before?.status, "queued", "enqueueJob() alone must never advance the job past queued");

      // A LATER, separate call (standing in for scripts/worker.ts's poll
      // loop running in a different process) claims and completes it.
      let ran = 0;
      const outcome = await claimAndProcessOne({ jobType, workerId: "separate-worker", process: async () => { ran++; } });
      assert.equal(outcome, "succeeded");
      assert.equal(ran, 1);
      const after = await jobRow(jobType, key);
      assert.equal(after?.status, "succeeded");
      assert.equal(after?.lease_owner, null);
    });

    await testAsync("claimAndProcessOne fails a job through failJob() when process() throws, classifying via classifyPipelineError", async () => {
      const jobType = "wr_test_fail";
      const key = `fail-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: key });
      const outcome = await claimAndProcessOne({
        jobType,
        workerId: "w1",
        process: async () => { throw new Error("ENOENT: missing file"); },
      });
      assert.equal(outcome, "failed");
      const row = await jobRow(jobType, key);
      assert.equal(row?.status, "dead_letter", "a non-retryable-shaped error must dead-letter on attempt 1");
    });

    await testAsync("runWorkerLoop drains multiple queued jobs of multiple job types before going idle, without enqueueing anything itself", async () => {
      const jobTypeA = "wr_test_loop_a";
      const jobTypeB = "wr_test_loop_b";
      const keys = [randomUUID(), randomUUID(), randomUUID()];
      for (const key of keys) await enqueueJob(pool, { jobType: jobTypeA, idempotencyKey: key });
      const keyB = randomUUID();
      await enqueueJob(pool, { jobType: jobTypeB, idempotencyKey: keyB });

      const processed: string[] = [];
      let idleCalls = 0;
      await runWorkerLoop({
        jobTypes: [
          { jobType: jobTypeA, process: async (job) => { processed.push(`${jobTypeA}:${job.idempotency_key}`); } },
          { jobType: jobTypeB, process: async (job) => { processed.push(`${jobTypeB}:${job.idempotency_key}`); } },
        ],
        workerId: "loop-worker",
        pollIntervalMs: 1,
        maxIterations: 2,
        onIdle: () => { idleCalls++; },
      });

      assert.equal(processed.length, 4, "all 4 enqueued jobs across both job types must be claimed and processed");
      for (const key of keys) assert.ok(processed.includes(`${jobTypeA}:${key}`));
      assert.ok(processed.includes(`${jobTypeB}:${keyB}`));
      assert.ok(idleCalls >= 1, "the loop must report at least one idle cycle once the queue is drained (maxIterations=2 forces a second, empty pass)");

      for (const key of keys) assert.equal((await jobRow(jobTypeA, key))?.status, "succeeded");
      assert.equal((await jobRow(jobTypeB, keyB))?.status, "succeeded");
    });

    await testAsync("runWorkerLoop stops after maxIterations even with no signal, so a test never hangs", async () => {
      let iterations = 0;
      await runWorkerLoop({
        jobTypes: [{ jobType: "wr_test_bounded", process: async () => {} }],
        pollIntervalMs: 1,
        maxIterations: 3,
        onIdle: () => { iterations++; },
      });
      assert.equal(iterations, 3);
    });

    await testAsync("runWorkerLoop stops immediately when passed an already-aborted signal", async () => {
      const controller = new AbortController();
      controller.abort();
      let ran = false;
      await runWorkerLoop({
        jobTypes: [{ jobType: "wr_test_aborted", process: async () => { ran = true; } }],
        signal: controller.signal,
        pollIntervalMs: 1,
      });
      assert.equal(ran, false);
    });

    await testAsync("runWorkerLoop's periodic recoverExpiredLeases() reclaims a job whose lease expired mid-processing, across a worker crash", async () => {
      const jobType = "wr_test_recovery";
      const key = `recovery-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: key });
      // Simulate a worker that claimed the job then crashed mid-run: claim
      // it directly (bypassing claimAndProcessOne, which would
      // complete/fail it), then force its lease into the past -- exactly
      // what a crashed process leaves behind.
      const { claimNextJob } = await import("@/lib/jobs/queue");
      const claimed = await claimNextJob(pool, { jobType, workerId: "crashed-worker" });
      assert.ok(claimed, "fixture assumes the job is claimable");
      await pool.query(`UPDATE background_jobs SET lease_expires_at = now() - interval '1 hour' WHERE id=$1`, [claimed!.id]);
      const stuck = await jobRow(jobType, key);
      assert.equal(stuck?.status, "processing", "fixture assumes the job still looks 'processing' -- exactly the zombie state a crash leaves");

      // A live worker's loop (this one, standing in for whichever
      // instance is still alive) must reclaim it on its very first
      // recovery pass -- leaseRecoveryEveryNPolls=1 forces recovery on
      // iteration 1 rather than waiting for the real default of 30.
      await runWorkerLoop({
        jobTypes: [{ jobType, process: async () => {} }],
        pollIntervalMs: 1,
        maxIterations: 1,
        leaseRecoveryEveryNPolls: 1,
      });

      const recovered = await jobRow(jobType, key);
      assert.equal(recovered?.status, "failed_retryable", "attempt_count is 1 < max_attempts, so recovery must return it to failed_retryable, not dead_letter");
      assert.equal(recovered?.lease_owner, null);
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

main()
  .then(() => {
    console.log(
      `worker-runtime regressions passed: ${cases} cases (empty-queue no-op, claim-what-a-different-call-enqueued, ` +
        `failure classification, multi-job-type draining, bounded/aborted loop termination, and lease-expiry recovery ` +
        `across a simulated worker crash).`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
