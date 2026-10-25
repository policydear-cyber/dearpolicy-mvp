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
import { authorizeJobRunner, runJobBatch } from "@/lib/jobs/cron-runner";
import { drainOnce, resetRequestDrainStateForTests, resetStartNowStateForTests, scheduleRequestDrain, startJobNow, START_NOW_MAX_IN_FLIGHT, REQUEST_DRAIN_MAX_JOBS, REQUEST_DRAIN_MIN_INTERVAL_MS } from "@/lib/jobs/request-drain";
import { DEFAULT_JOB_RUNNER_CLAIM_BUDGET_MS } from "@/lib/jobs/cron-runner";
import { livePolicyJob, UNCLAIMED_STALL_MINUTES } from "@/lib/rag/processing-queue";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";

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

    // ---- Vercel Cron job runner (lib/jobs/cron-runner.ts) -------------------
    await testAsync("authorizeJobRunner fails closed without a secret and rejects anything but the exact bearer token", async () => {
      const secret = "s".repeat(40);
      assert.deepEqual(authorizeJobRunner(`Bearer ${secret}`, {} as NodeJS.ProcessEnv), { ok: false, status: 503 }, "no CRON_SECRET -> refuse every call");
      assert.deepEqual(authorizeJobRunner("Bearer short", { NODE_ENV: "test", CRON_SECRET: "short" } as NodeJS.ProcessEnv), { ok: false, status: 503 }, "too-short secret -> treated as unconfigured");
      const env = { NODE_ENV: "test", CRON_SECRET: secret } as NodeJS.ProcessEnv;
      assert.deepEqual(authorizeJobRunner(null, env), { ok: false, status: 401 });
      assert.deepEqual(authorizeJobRunner(secret, env), { ok: false, status: 401 }, "missing Bearer prefix");
      assert.deepEqual(authorizeJobRunner(`Bearer ${"t".repeat(40)}`, env), { ok: false, status: 401 }, "same length, wrong secret");
      assert.deepEqual(authorizeJobRunner(`Bearer ${secret}x`, env), { ok: false, status: 401 }, "different length");
      assert.deepEqual(authorizeJobRunner(`Bearer ${secret}`, env), { ok: true });
    });

    await testAsync("runJobBatch drains every job type round-robin and reports counts only", async () => {
      const a = `cr_a_${randomUUID()}`, b = `cr_b_${randomUUID()}`;
      await enqueueJob(pool, { jobType: a, idempotencyKey: "1" });
      await enqueueJob(pool, { jobType: a, idempotencyKey: "2" });
      await enqueueJob(pool, { jobType: b, idempotencyKey: "1" });
      const summary = await runJobBatch({
        jobTypes: [
          { jobType: a, process: async () => {} },
          { jobType: b, process: async () => { throw new Error("secret-bearing failure detail 4111-1111"); } },
        ],
      });
      assert.equal(summary.claimed, 3);
      assert.deepEqual(summary.byType[a], { succeeded: 2, failed: 0 });
      assert.deepEqual(summary.byType[b], { succeeded: 0, failed: 1 });
      assert.equal(summary.stoppedBy, "empty");
      assert.ok(!JSON.stringify(summary).includes("4111"), "the batch summary must never carry an error message");
      assert.equal((await jobRow(b, "1"))?.status, "dead_letter", "a failed job goes through failJob()'s normal classification (an unclassified error is non-retryable)");
    });

    await testAsync("runJobBatch stops claiming at maxJobs and leaves the rest queued", async () => {
      const t = `cr_max_${randomUUID()}`;
      for (const k of ["1", "2", "3"]) await enqueueJob(pool, { jobType: t, idempotencyKey: k });
      const summary = await runJobBatch({ jobTypes: [{ jobType: t, process: async () => {} }], maxJobs: 2 });
      assert.equal(summary.claimed, 2);
      assert.equal(summary.stoppedBy, "max_jobs");
      const statuses = (await pool.query<{ status: string }>(`SELECT status FROM background_jobs WHERE job_type=$1 ORDER BY idempotency_key`, [t])).rows.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === "queued").length, 1, "the job beyond maxJobs must stay queued for the next invocation");
    });

    await testAsync("runJobBatch stops claiming once the claim budget has elapsed", async () => {
      const t = `cr_budget_${randomUUID()}`;
      await enqueueJob(pool, { jobType: t, idempotencyKey: "1" });
      let clock = 1_000;
      const summary = await runJobBatch({ jobTypes: [{ jobType: t, process: async () => {} }], claimBudgetMs: 50, now: () => (clock += 100) });
      assert.equal(summary.claimed, 0);
      assert.equal(summary.stoppedBy, "time_budget");
      assert.equal((await jobRow(t, "1"))?.status, "queued");
    });

    await testAsync("runJobBatch recovers an expired lease left by an instance the platform killed mid-job", async () => {
      const t = `cr_lease_${randomUUID()}`;
      await enqueueJob(pool, { jobType: t, idempotencyKey: "1" });
      const { claimNextJob } = await import("@/lib/jobs/queue");
      const claimed = await claimNextJob(pool, { jobType: t, workerId: "killed-instance" });
      await pool.query(`UPDATE background_jobs SET lease_expires_at = now() - interval '1 hour' WHERE id=$1`, [claimed!.id]);
      const summary = await runJobBatch({ jobTypes: [], maxJobs: 0 });
      assert.ok(summary.recoveredLeases >= 1);
      assert.equal((await jobRow(t, "1"))?.status, "failed_retryable");
    });

    await testAsync("GET /api/internal/jobs/run: 503 without CRON_SECRET, 401 on a wrong token, a counts-only batch on the right one", async () => {
      const { GET } = await import("@/app/api/internal/jobs/run/route");
      const previous = process.env.CRON_SECRET;
      try {
        delete process.env.CRON_SECRET;
        const unconfigured = await GET(new NextRequest("http://localhost/api/internal/jobs/run", { headers: { authorization: "Bearer anything-at-all-here" } }));
        assert.equal(unconfigured.status, 503);
        process.env.CRON_SECRET = "c".repeat(48);
        const wrong = await GET(new NextRequest("http://localhost/api/internal/jobs/run", { headers: { authorization: `Bearer ${"d".repeat(48)}` } }));
        assert.equal(wrong.status, 401);
        const right = await GET(new NextRequest("http://localhost/api/internal/jobs/run", { headers: { authorization: `Bearer ${"c".repeat(48)}` } }));
        assert.equal(right.status, 200);
        const body = (await right.json()) as { ok: boolean; claimed: number; stoppedBy: string };
        assert.equal(body.ok, true);
        assert.equal(typeof body.claimed, "number");
        assert.equal(right.headers.get("cache-control"), "no-store");
      } finally {
        if (previous === undefined) delete process.env.CRON_SECRET;
        else process.env.CRON_SECRET = previous;
      }
    });

    // ---- Request-driven drain (lib/jobs/request-drain.ts): the prompt
    // trigger on Vercel Hobby, where Cron runs at most once a day.
    await pool.query(`DELETE FROM background_jobs`);
    const rdType = "rd_test_prompt";
    const NO_ENV = {} as unknown as NodeJS.ProcessEnv;
    const rdCounts = async () => (await pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM background_jobs WHERE job_type=$1 GROUP BY status`, [rdType])).rows
      .reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: Number(r.n) }), {});
    let clock = 1_000_000;
    const now = () => clock;
    const tick = () => { clock += REQUEST_DRAIN_MIN_INTERVAL_MS + 1; };
    const ran: string[] = [];
    const rdTypes = [{ jobType: rdType, process: async (job: { idempotency_key: string }) => { ran.push(job.idempotency_key); } }];

    await testAsync("request drain: JOB_DRAIN_ON_REQUEST=false disables it", async () => {
      resetRequestDrainStateForTests();
      const outcome = await drainOnce({ jobTypes: rdTypes as never, now, env: { JOB_DRAIN_ON_REQUEST: "false" } as unknown as NodeJS.ProcessEnv });
      assert.deepEqual(outcome, { ran: false, reason: "disabled" });
    });

    await testAsync("request drain: nothing claimable -> no batch at all", async () => {
      resetRequestDrainStateForTests(); tick();
      assert.deepEqual(await drainOnce({ jobTypes: rdTypes as never, now, env: NO_ENV }), { ran: false, reason: "no_work" });
    });

    await testAsync("request drain: claims at most REQUEST_DRAIN_MAX_JOBS per drain, then is throttled per instance", async () => {
      resetRequestDrainStateForTests(); tick();
      for (const k of ["a", "b", "c"]) await enqueueJob(pool, { jobType: rdType, idempotencyKey: `rd-${k}` });
      const first = await drainOnce({ jobTypes: rdTypes as never, now, env: NO_ENV });
      assert.equal(first.ran, true);
      assert.equal(first.ran && first.summary.claimed, REQUEST_DRAIN_MAX_JOBS);
      assert.equal(first.ran && first.summary.stoppedBy, "max_jobs");
      assert.deepEqual(await rdCounts(), { succeeded: 2, queued: 1 });
      assert.deepEqual(await drainOnce({ jobTypes: rdTypes as never, now, env: NO_ENV }), { ran: false, reason: "throttled" });
      tick();
      const second = await drainOnce({ jobTypes: rdTypes as never, now, env: NO_ENV });
      assert.equal(second.ran && second.summary.claimed, 1);
      assert.deepEqual(await rdCounts(), { succeeded: 3 });
      assert.equal(new Set(ran).size, 3, "every job ran exactly once");
      assert.equal(ran.length, 3);
    });

    await testAsync("request drain: a delayed (scan-retry style) job is not run early, and is picked up by the first drain after it is due", async () => {
      resetRequestDrainStateForTests(); tick();
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "rd-later", availableAt: new Date(Date.now() + 60 * 60_000) });
      assert.deepEqual(await drainOnce({ jobTypes: rdTypes as never, now, env: NO_ENV }), { ran: false, reason: "no_work" });
      assert.equal((await rdCounts()).queued, 1);
      await pool.query(`UPDATE background_jobs SET available_at = now() - interval '1 second' WHERE job_type=$1 AND idempotency_key='rd-later'`, [rdType]);
      tick();
      const due = await drainOnce({ jobTypes: rdTypes as never, now, env: NO_ENV });
      assert.equal(due.ran && due.summary.claimed, 1);
      assert.equal((await rdCounts()).queued, undefined);
    });

    await testAsync("request drain: at most one drain in flight per instance", async () => {
      resetRequestDrainStateForTests(); tick();
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "rd-slow" });
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      let started!: () => void;
      const startedP = new Promise<void>((r) => { started = r; });
      const slow = [{ jobType: rdType, process: async () => { started(); await gate; } }];
      const firstP = drainOnce({ jobTypes: slow as never, now, env: NO_ENV });
      await startedP;
      tick();
      assert.deepEqual(await drainOnce({ jobTypes: slow as never, now, env: NO_ENV }), { ran: false, reason: "in_flight" });
      release();
      const first = await firstP;
      assert.equal(first.ran && first.summary.claimed, 1);
    });

    await testAsync("request drain: failures go through the same bounded retry/dead-letter classification, never succeeded", async () => {
      resetRequestDrainStateForTests(); tick();
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "rd-transient" });
      const transient = [{ jobType: rdType, process: async () => { throw new Error("synthetic provider timeout ETIMEDOUT"); } }];
      const out = await drainOnce({ jobTypes: transient as never, now, env: NO_ENV });
      assert.equal(out.ran && out.summary.byType[rdType]?.failed, 1);
      const row = await jobRow(rdType, "rd-transient");
      assert.equal(row?.status, "failed_retryable", "a transient failure is retried later, with backoff");
      assert.equal(row?.attempt_count, 1);
      await pool.query(`DELETE FROM background_jobs WHERE job_type=$1`, [rdType]);
      resetRequestDrainStateForTests(); tick();
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "rd-permanent" });
      const permanent = [{ jobType: rdType, process: async () => { throw new Error("synthetic unrecoverable failure"); } }];
      await drainOnce({ jobTypes: permanent as never, now, env: NO_ENV });
      assert.equal((await jobRow(rdType, "rd-permanent"))?.status, "dead_letter", "a non-retryable failure is dead-lettered, not retried forever");
    });

    await testAsync("request drain: outside a request scope scheduleRequestDrain() is a no-op (never races a caller)", async () => {
      resetRequestDrainStateForTests(); tick();
      await pool.query(`DELETE FROM background_jobs WHERE job_type=$1`, [rdType]);
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "rd-untouched" });
      scheduleRequestDrain();
      await new Promise((r) => setTimeout(r, 100));
      assert.equal((await jobRow(rdType, "rd-untouched"))?.status, "queued");
    });

    await testAsync("request drain: wired after authentication into every enqueueing and status-polling household route", async () => {
      const routes = ["app/api/policies/route.ts", "app/api/policies/upload/route.ts", "app/api/policies/reprocess/route.ts", "app/api/claims/evidence/route.ts",
        "app/api/claims/evidence/upload/route.ts", "app/api/chat/route.ts", "app/api/chat/jobs/[id]/route.ts", "app/api/household/export/route.ts"];
      for (const r of routes) {
        const src = readFileSync(path.resolve(r), "utf8");
        assert.match(src, /export const ROUTE_AUTH = "household-(?:member|owner)" as const/, `${r} must be an authenticated household route`);
        const auth = src.search(/await requireHouseholdContext\(request\)/);
        const call = src.search(/\n\s*scheduleRequestDrain\(\);/);
        assert.ok(auth >= 0 && call > auth, `${r} must call scheduleRequestDrain() only after requireHouseholdContext()`);
      }
      const drain = readFileSync(path.resolve("lib/jobs/request-drain.ts"), "utf8");
      assert.match(drain, /runJobBatch\(\{ jobTypes, maxJobs: REQUEST_DRAIN_MAX_JOBS, claimBudgetMs: REQUEST_DRAIN_CLAIM_BUDGET_MS/);
      assert.doesNotMatch(drain, /request\.|searchParams|headers\(/, "the caller must not be able to influence the drain");
    });

    // ---- 25 Oct: the job a household asked for starts at once, not behind a drain in flight (a document sat queued a day).
    await testAsync("start now: while a drain is busy with one long document, the next document's job starts and finishes; both run once", async () => {
      await pool.query(`DELETE FROM background_jobs WHERE job_type=$1`, [rdType]);
      resetRequestDrainStateForTests(); resetStartNowStateForTests(); tick();
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "doc-long" });
      let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      let started!: () => void; const startedP = new Promise<void>((r) => { started = r; });
      const order: string[] = [];
      const types = [{ jobType: rdType, process: async (job: { idempotency_key: string }) => { order.push(job.idempotency_key); if (job.idempotency_key === "doc-long") { started(); await gate; } } }];
      const drainP = drainOnce({ jobTypes: types as never, now, env: NO_ENV });
      await startedP;
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "doc-next" });
      tick();
      assert.deepEqual(await drainOnce({ jobTypes: types as never, now, env: NO_ENV }), { ran: false, reason: "in_flight" }, "the drain alone would leave it queued");
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "doc-next", jobTypes: types as never, env: NO_ENV }), "succeeded");
      assert.equal((await jobRow(rdType, "doc-next"))?.status, "succeeded");
      release(); await drainP;
      assert.equal((await jobRow(rdType, "doc-long"))?.status, "succeeded");
      assert.deepEqual(order, ["doc-long", "doc-next"], "each ran exactly once");
    });

    await testAsync("start now: only the named job; one already running, done or waiting out a retry delay is not claimed; capped per instance; off with the flag", async () => {
      await pool.query(`DELETE FROM background_jobs WHERE job_type=$1`, [rdType]);
      resetStartNowStateForTests();
      const seen: string[] = [];
      const types = [{ jobType: rdType, process: async (job: { idempotency_key: string }) => { seen.push(job.idempotency_key); } }];
      for (const k of ["older", "mine"]) await enqueueJob(pool, { jobType: rdType, idempotencyKey: k });
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "mine", jobTypes: types as never, env: NO_ENV }), "succeeded");
      assert.deepEqual(seen, ["mine"], "never the older job of another document");
      assert.equal((await jobRow(rdType, "older"))?.status, "queued");
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "mine", jobTypes: types as never, env: NO_ENV }), "not_claimable", "a finished job is not run again");
      await enqueueJob(pool, { jobType: rdType, idempotencyKey: "later", availableAt: new Date(Date.now() + 60 * 60_000) });
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "later", jobTypes: types as never, env: NO_ENV }), "not_claimable", "a retry delay is respected");
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "older", jobTypes: types as never, env: { JOB_DRAIN_ON_REQUEST: "false" } as unknown as NodeJS.ProcessEnv }), "disabled");
      let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      const slow = [{ jobType: rdType, process: async () => { await gate; } }];
      const held: Promise<unknown>[] = [];
      for (let i = 0; i < START_NOW_MAX_IN_FLIGHT; i++) { await enqueueJob(pool, { jobType: rdType, idempotencyKey: `held-${i}` }); held.push(startJobNow({ jobType: rdType, idempotencyKey: `held-${i}`, jobTypes: slow as never, env: NO_ENV })); }
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "older", jobTypes: types as never, env: NO_ENV }), "busy");
      release(); await Promise.all(held);
      assert.equal(await startJobNow({ jobType: rdType, idempotencyKey: "older", jobTypes: types as never, env: NO_ENV }), "succeeded");
    });

    await testAsync("stalled: a queued job nothing has claimed for 10 minutes no longer counts as live; a leased job or one waiting out a retry always does", async () => {
      await pool.query(`DELETE FROM background_jobs WHERE job_type=$1`, [rdType]);
      for (const k of ["fresh", "unclaimed", "leased", "backoff", "lapsed"]) await enqueueJob(pool, { jobType: rdType, idempotencyKey: k });
      await pool.query(`UPDATE background_jobs SET available_at = now() - make_interval(mins => $2 + 1) WHERE job_type=$1 AND idempotency_key IN ('unclaimed','leased','lapsed')`, [rdType, UNCLAIMED_STALL_MINUTES]);
      await pool.query(`UPDATE background_jobs SET status='processing', lease_owner='w', lease_expires_at = now() + interval '5 minutes' WHERE job_type=$1 AND idempotency_key='leased'`, [rdType]);
      await pool.query(`UPDATE background_jobs SET status='failed_retryable', available_at = now() + interval '3 minutes' WHERE job_type=$1 AND idempotency_key='backoff'`, [rdType]);
      await pool.query(`UPDATE background_jobs SET status='processing', lease_owner='w', lease_expires_at = now() - interval '1 minute' WHERE job_type=$1 AND idempotency_key='lapsed'`, [rdType]);
      const live = (await pool.query<{ idempotency_key: string }>(`SELECT idempotency_key FROM background_jobs j WHERE j.job_type=$1 AND ${livePolicyJob("j", "$2")} ORDER BY idempotency_key`, [rdType, UNCLAIMED_STALL_MINUTES])).rows.map((r) => r.idempotency_key);
      assert.deepEqual(live, ["backoff", "fresh", "leased"]);
    });

    await testAsync("wiring: upload and Read again start their own job after enqueueing it; the runner claims for 150 s of its 300 s; a stalled document offers Try again, never 'will keep trying'", async () => {
      const accept = readFileSync(path.resolve("app/api/policies/upload/accept.ts"), "utf8");
      assert.ok(accept.indexOf("await enqueuePolicyProcessing(") >= 0 && accept.indexOf("scheduleJobStart(POLICY_PROCESSING_JOB_TYPE, policyId)") > accept.indexOf("await enqueuePolicyProcessing("));
      const reprocess = readFileSync(path.resolve("app/api/policies/reprocess/route.ts"), "utf8");
      assert.ok(reprocess.indexOf("await startJobNow({ jobType: POLICY_PROCESSING_JOB_TYPE, idempotencyKey: body.policyId })") > reprocess.indexOf("await enqueuePolicyProcessing({"));
      for (const r of ["app/api/policies/route.ts", "app/api/policies/reprocess/route.ts"]) assert.match(readFileSync(path.resolve(r), "utf8"), /livePolicyJob\("j", "\$\d"\)/, r);
      assert.equal(DEFAULT_JOB_RUNNER_CLAIM_BUDGET_MS, 150_000);
      assert.match(readFileSync(path.resolve("app/api/internal/jobs/run/route.ts"), "utf8"), /export const maxDuration = 300;/);
      const page = readFileSync(path.resolve("app/policies/page.tsx"), "utf8");
      assert.doesNotMatch(page, /will keep trying on its own/);
      assert.match(page, /policy\.processing_stalled\s*\n?\s*\? <><small>Reading has not started\.[^]*?retryReading\(policy\)[^]*?"Try again"/);
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
        `across a simulated worker crash), plus the Vercel Cron job runner: CRON_SECRET auth, round-robin bounded batches, ` +
        `max-jobs and claim-budget stops, lease recovery and the route's counts-only responses), plus the request-driven drain (bounded, throttled, single-flight, delayed-retry pickup, no-op outside a request, wired after auth).`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
