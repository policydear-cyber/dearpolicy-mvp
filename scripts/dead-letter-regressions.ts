/**
 * Regression suite for Checkpoint 14f's lib/jobs/dead-letter.ts -- the
 * operational consumer/drain for dead_letter jobs that
 * scripts/launch-check.ts's dead_letter_retry_support diagnosis found
 * missing entirely (failJob() classifies into dead_letter, but nothing
 * before this checkpoint ever read, retried, or surfaced one again).
 *
 * Same disposable-PGlite + pool-patching pattern as every other suite in
 * this checkpoint family.
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
import { enqueueJob, failJob, claimNextJob } from "@/lib/jobs/queue";
import { claimAndProcessOne } from "@/lib/jobs/worker-runtime";
import { listDeadLetterJobs, countDeadLetterJobsByType, retryDeadLetterJob, DeadLetterJobNotFoundError } from "@/lib/jobs/dead-letter";

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

async function dropToDeadLetter(jobType: string, idempotencyKey: string, errorMessage = "permanently malformed input") {
  await enqueueJob(pool, { jobType, idempotencyKey });
  const claimed = await claimNextJob(pool, { jobType, workerId: "dl-fixture-worker" });
  if (!claimed) throw new Error("fixture assumes the job is claimable");
  return failJob(pool, { jobId: claimed.id, workerId: "dl-fixture-worker", errorCategory: "non_retryable", errorMessage });
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
    await testAsync("listDeadLetterJobs returns an empty list when nothing has dead-lettered", async () => {
      const rows = await listDeadLetterJobs({ jobType: "dl_test_never_used" });
      assert.deepEqual(rows, []);
    });

    await testAsync("a job failJob() classifies non_retryable is visible via listDeadLetterJobs and countDeadLetterJobsByType", async () => {
      const jobType = "dl_test_visible";
      const key = `visible-${randomUUID()}`;
      await dropToDeadLetter(jobType, key, "ENOENT: source file missing");

      const rows = await listDeadLetterJobs({ jobType });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].idempotency_key, key);
      assert.equal(rows[0].last_error_message, "ENOENT: source file missing");

      const counts = await countDeadLetterJobsByType();
      const entry = counts.find((c) => c.jobType === jobType);
      assert.ok(entry, "the job type must appear in the per-type summary");
      assert.equal(entry!.count, 1);
    });

    await testAsync("retryDeadLetterJob requeues a dead-letter job: status becomes queued, attempt_count resets to 0", async () => {
      const jobType = "dl_test_retry";
      const key = `retry-${randomUUID()}`;
      const deadLettered = await dropToDeadLetter(jobType, key);
      assert.equal(deadLettered.status, "dead_letter");
      assert.equal(deadLettered.attempt_count, 1);

      const retried = await retryDeadLetterJob(deadLettered.id);
      assert.equal(retried.status, "queued");
      assert.equal(retried.attempt_count, 0, "attempt_count must reset so the next failure doesn't immediately re-dead-letter it");
      assert.equal(retried.last_error_message, null);

      const stillListed = await listDeadLetterJobs({ jobType });
      assert.equal(stillListed.length, 0, "a retried job must no longer show up as dead_letter");
    });

    await testAsync("end-to-end: a requeued dead-letter job is claimed and completed by the NEXT worker pass, via claimAndProcessOne", async () => {
      const jobType = "dl_test_requeue_complete";
      const key = `requeue-${randomUUID()}`;
      const deadLettered = await dropToDeadLetter(jobType, key);
      await retryDeadLetterJob(deadLettered.id);

      let ran = 0;
      const outcome = await claimAndProcessOne({ jobType, workerId: "dl-retry-worker", process: async () => { ran++; } });
      assert.equal(outcome, "succeeded");
      assert.equal(ran, 1, "the retried job must actually be re-run, not silently skipped");

      const rows = await listDeadLetterJobs({ jobType });
      assert.equal(rows.length, 0);
    });

    await testAsync("retryDeadLetterJob refuses a job id that is not currently dead_letter (queued)", async () => {
      const jobType = "dl_test_wrong_state";
      const key = `wrong-state-${randomUUID()}`;
      const { row } = await enqueueJob(pool, { jobType, idempotencyKey: key });
      await assert.rejects(() => retryDeadLetterJob(row.id), DeadLetterJobNotFoundError);
    });

    await testAsync("retryDeadLetterJob refuses a job id that does not exist at all", async () => {
      await assert.rejects(() => retryDeadLetterJob(randomUUID()), DeadLetterJobNotFoundError);
    });

    await testAsync("retryDeadLetterJob is not double-applicable: retrying the same already-requeued job a second time is refused, not a silent duplicate requeue", async () => {
      const jobType = "dl_test_double_retry";
      const key = `double-${randomUUID()}`;
      const deadLettered = await dropToDeadLetter(jobType, key);
      await retryDeadLetterJob(deadLettered.id);
      await assert.rejects(() => retryDeadLetterJob(deadLettered.id), DeadLetterJobNotFoundError);
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
      `dead-letter regressions passed: ${cases} cases (list/count visibility, requeue resets attempt_count, a requeued ` +
        `job is actually claimed and completed by the next worker pass, and retry is refused for a non-dead-letter or ` +
        `already-retried job id).`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
