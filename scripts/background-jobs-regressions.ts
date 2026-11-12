/**
 * Regression suite for Checkpoint 8 (claude/v1-launch-hardening): the
 * durable job framework (lib/jobs/queue.ts) -- leases, heartbeat, bounded
 * retry, dead-letter, cancellation.
 *
 * Proven against a disposable PGlite instance loaded with the real schema
 * (sql/schema.sql plus sql/background-jobs.sql), with lib/db/client.ts's
 * `pool` monkey-patched to route through it -- the same established
 * pattern every other regression suite in this checkpoint family uses,
 * so lib/jobs/queue.ts's actual SQL (CAS guards, the FOR UPDATE SKIP
 * LOCKED claim, the backoff formula) runs for real, not a mock.
 *
 * As documented on lib/jobs/queue.ts's LeaseLostError and failJob(), the
 * two properties this checkpoint's safety hinges on are: (1) a worker
 * that has lost its lease can never record success/failure/a heartbeat
 * against the job (the ownership CAS), and (2) a permanently-failing job
 * is bounded into dead_letter rather than retried forever. Both are
 * additionally sabotage-and-restore-verified by hand against the live
 * source (not encoded as a mutation test here) -- see PR #16's
 * Checkpoint 8 section for exactly what was mutated, the resulting
 * expected failure, and the restore/reconfirm.
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
import {
  enqueueJob,
  claimNextJob,
  heartbeatJob,
  completeJob,
  failJob,
  recoverExpiredLeases,
  cancelJob,
  finalizeCancelledJob,
  deferJob,
  computeBackoffMs,
  LeaseLostError,
  JobNotFoundError,
  DEFAULT_LEASE_DURATION_MS,
} from "@/lib/jobs/queue";

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

async function runDatabaseTests() {
  // This suite is about the job state machine, not telemetry output --
  // scripts/telemetry-regressions.ts is what actually exercises
  // lib/telemetry/index.ts. Silencing the default console adapter here
  // just keeps this suite's own output readable.
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
    await testAsync("enqueueJob is idempotent: a repeated (jobType, idempotencyKey) returns the same row, not a duplicate", async () => {
      const key = `policy-ingest:${randomUUID()}`;
      const first = await enqueueJob(pool, { jobType: "policy_ingest", idempotencyKey: key, payload: { n: 1 } });
      const second = await enqueueJob(pool, { jobType: "policy_ingest", idempotencyKey: key, payload: { n: 2 } });
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(first.row.id, second.row.id, "a retried enqueue must never create a second job row");
      const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM background_jobs WHERE idempotency_key=$1`, [key]);
      assert.equal(count.rows[0].n, "1");
    });

    await testAsync("claimNextJob claims the oldest queued job and leaves nothing else claimable", async () => {
      const jobType = `t-${randomUUID()}`;
      const { row: job } = await enqueueJob(pool, { jobType, idempotencyKey: "a" });
      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      assert.ok(claimed);
      assert.equal(claimed!.id, job.id);
      assert.equal(claimed!.status, "processing");
      assert.equal(claimed!.attempt_count, 1, "claiming is what advances attempt_count, starting at 1 for a first attempt");
      assert.equal(claimed!.lease_owner, "worker-1");
      assert.ok(claimed!.lease_expires_at, "a claimed job must have a lease expiry");

      const nothingElse = await claimNextJob(pool, { jobType, workerId: "worker-2" });
      assert.equal(nothingElse, null, "a job already claimed by another worker must not be claimable again");
    });

    await testAsync("heartbeatJob extends the lease for the owner and returns cancel_requested for the worker to observe", async () => {
      const jobType = `t-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: "a" });
      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      const beat = await heartbeatJob(pool, { jobId: claimed!.id, workerId: "worker-1" });
      assert.ok(beat.lease_expires_at! > claimed!.lease_expires_at!, "a heartbeat must push the lease expiry forward");
      assert.equal(beat.cancel_requested, false);

      await assert.rejects(
        () => heartbeatJob(pool, { jobId: claimed!.id, workerId: "some-other-worker" }),
        LeaseLostError,
        "a worker that never held the lease must never be able to extend it",
      );
    });

    await testAsync("completeJob marks succeeded, and a repeat by the same or a stale worker is refused", async () => {
      const jobType = `t-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: "a" });
      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      const done = await completeJob(pool, { jobId: claimed!.id, workerId: "worker-1" });
      assert.equal(done.status, "succeeded");
      assert.ok(done.completed_at);
      assert.equal(done.lease_owner, null);

      await assert.rejects(
        () => completeJob(pool, { jobId: claimed!.id, workerId: "worker-1" }),
        LeaseLostError,
        "completing an already-succeeded job again must be refused, not silently accepted",
      );
    });

    await testAsync(
      "completeJob refuses a caller that never held the lease, even while the job is still genuinely 'processing' (not merely after lease expiry)",
      async () => {
        const jobType = `t-${randomUUID()}`;
        await enqueueJob(pool, { jobType, idempotencyKey: "a" });
        const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
        assert.equal(claimed!.status, "processing");

        // worker-2 never claimed this job and its lease has not expired --
        // this isolates the ownership CAS itself, separate from the
        // (already-covered) case of a lease that expired and moved the
        // job out of 'processing' entirely.
        await assert.rejects(
          () => completeJob(pool, { jobId: claimed!.id, workerId: "worker-2" }),
          LeaseLostError,
          "a worker impersonating another worker's still-valid lease must never be able to mark the job succeeded",
        );

        const stillProcessing = await pool.query<{ status: string; lease_owner: string }>(
          `SELECT status, lease_owner FROM background_jobs WHERE id=$1`,
          [claimed!.id],
        );
        assert.equal(stillProcessing.rows[0].status, "processing", "the impersonation attempt must not have changed the job's status");
        assert.equal(stillProcessing.rows[0].lease_owner, "worker-1", "the real owner's lease must be untouched");

        // Clean up so it doesn't leak into a later recoverExpiredLeases() sweep.
        await completeJob(pool, { jobId: claimed!.id, workerId: "worker-1" });
      },
    );

    await testAsync(
      "failJob(transient) retries with backoff matching computeBackoffMs() until max_attempts, then lands in dead_letter -- bounded retry",
      async () => {
        const jobType = `t-${randomUUID()}`;
        const { row: job } = await enqueueJob(pool, { jobType, idempotencyKey: "a", maxAttempts: 3 });

        for (let attempt = 1; attempt <= 2; attempt++) {
          const claimed = await claimNextJob(pool, { jobType, workerId: `worker-${attempt}` });
          assert.ok(claimed, `attempt ${attempt} must still be claimable`);
          assert.equal(claimed!.attempt_count, attempt);
          const before = Date.now();
          const failed = await failJob(pool, {
            jobId: claimed!.id,
            workerId: `worker-${attempt}`,
            errorCategory: "transient",
            errorMessage: "simulated transient failure",
          });
          assert.equal(failed.status, "failed_retryable", `attempt ${attempt} of 3 must retry, not dead-letter yet`);
          const delayMs = failed.available_at.getTime() - before;
          const expectedMs = computeBackoffMs(attempt);
          assert.ok(
            Math.abs(delayMs - expectedMs) < 5000,
            `attempt ${attempt}'s backoff (${delayMs}ms) must match computeBackoffMs(${attempt})=${expectedMs}ms`,
          );
          // Make it immediately claimable again for the next loop iteration
          // rather than waiting out the real backoff window.
          await pool.query(`UPDATE background_jobs SET available_at = now() WHERE id=$1`, [claimed!.id]);
        }

        const finalClaim = await claimNextJob(pool, { jobType, workerId: "worker-final" });
        assert.equal(finalClaim!.attempt_count, 3);
        const deadLettered = await failJob(pool, {
          jobId: finalClaim!.id,
          workerId: "worker-final",
          errorCategory: "transient",
          errorMessage: "simulated transient failure",
        });
        assert.equal(deadLettered.status, "dead_letter", "the 3rd attempt of max_attempts=3 must dead-letter, never retry a 4th time");

        const stillClaimable = await claimNextJob(pool, { jobType, workerId: "worker-x" });
        assert.equal(stillClaimable, null, "a dead_letter job must never be claimable again");
        void job;
      },
    );

    await testAsync("failJob(non_retryable) dead-letters immediately, even on the very first attempt", async () => {
      const jobType = `t-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: "a", maxAttempts: 5 });
      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      assert.equal(claimed!.attempt_count, 1);
      const result = await failJob(pool, {
        jobId: claimed!.id,
        workerId: "worker-1",
        errorCategory: "non_retryable",
        errorMessage: "malformed input, retrying would never help",
      });
      assert.equal(result.status, "dead_letter", "a non_retryable failure must never retry, regardless of attempt_count vs max_attempts");
    });

    await testAsync(
      "recoverExpiredLeases reclaims a job whose worker stopped heartbeating, and the zombie worker can no longer act on it -- the ownership CAS",
      async () => {
        const jobType = `t-${randomUUID()}`;
        await enqueueJob(pool, { jobType, idempotencyKey: "a", maxAttempts: 5 });
        const claimed = await claimNextJob(pool, { jobType, workerId: "zombie-worker" });
        assert.equal(claimed!.status, "processing");

        // Simulate time passing well beyond the lease without a heartbeat.
        const farFuture = new Date(Date.now() + DEFAULT_LEASE_DURATION_MS + 60_000);
        const { recoveredToRetry, movedToDeadLetter } = await recoverExpiredLeases(pool, { asOf: farFuture });
        assert.ok(recoveredToRetry.includes(claimed!.id), "an expired-lease job under max_attempts must be recovered to failed_retryable");
        assert.equal(movedToDeadLetter.length, 0);

        // The zombie worker -- the one that originally claimed it and never
        // heartbeat -- must be refused on every action, because the job is
        // no longer 'processing' under its ownership.
        await assert.rejects(() => heartbeatJob(pool, { jobId: claimed!.id, workerId: "zombie-worker" }), LeaseLostError);
        await assert.rejects(() => completeJob(pool, { jobId: claimed!.id, workerId: "zombie-worker" }), LeaseLostError);
        await assert.rejects(
          () => failJob(pool, { jobId: claimed!.id, workerId: "zombie-worker", errorCategory: "transient", errorMessage: "too late" }),
          LeaseLostError,
        );

        // A different, live worker can now legitimately pick it back up.
        await pool.query(`UPDATE background_jobs SET available_at = now() WHERE id=$1`, [claimed!.id]);
        const reclaimed = await claimNextJob(pool, { jobType, workerId: "live-worker" });
        assert.ok(reclaimed, "after recovery, a live worker must be able to claim the job");
        assert.equal(reclaimed!.attempt_count, 2, "the reclaim is a new attempt, not a continuation of the zombie's");

        // Terminate it so it can't leak into a later test case's own
        // global recoverExpiredLeases() call as a stray 'processing' row.
        await completeJob(pool, { jobId: reclaimed!.id, workerId: "live-worker" });
      },
    );

    await testAsync(
      "recoverExpiredLeases dead-letters an expired-lease job that already exhausted max_attempts, rather than retrying it forever",
      async () => {
        const jobType = `t-${randomUUID()}`;
        await enqueueJob(pool, { jobType, idempotencyKey: "a", maxAttempts: 1 });
        const claimed = await claimNextJob(pool, { jobType, workerId: "zombie-worker" });
        assert.equal(claimed!.attempt_count, 1);

        const farFuture = new Date(Date.now() + DEFAULT_LEASE_DURATION_MS + 60_000);
        const { recoveredToRetry, movedToDeadLetter } = await recoverExpiredLeases(pool, { asOf: farFuture });
        // recoverExpiredLeases() is a global reaper (no jobType filter, by
        // design), so a leftover 'processing' row from an earlier test case
        // in this same suite run may legitimately also be swept up here --
        // assert membership, not exact array length/exclusivity.
        assert.ok(!recoveredToRetry.includes(claimed!.id), "an expired-lease job that already exhausted max_attempts must not be recovered to retry");
        assert.ok(movedToDeadLetter.includes(claimed!.id));

        const stillClaimable = await claimNextJob(pool, { jobType, workerId: "worker-x" });
        assert.equal(stillClaimable, null);
      },
    );

    await testAsync("cancelJob on a queued job cancels it immediately -- it is never claimable", async () => {
      const jobType = `t-${randomUUID()}`;
      const { row: job } = await enqueueJob(pool, { jobType, idempotencyKey: "a" });
      const cancelled = await cancelJob(pool, { jobId: job.id });
      assert.equal(cancelled.status, "cancelled");

      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      assert.equal(claimed, null, "a cancelled job must never be claimed");
    });

    await testAsync(
      "cancelJob on a processing job is cooperative -- status stays processing until the worker finalizes it itself",
      async () => {
        const jobType = `t-${randomUUID()}`;
        await enqueueJob(pool, { jobType, idempotencyKey: "a" });
        const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });

        const afterCancelRequest = await cancelJob(pool, { jobId: claimed!.id });
        assert.equal(afterCancelRequest.status, "processing", "cancelling in-flight work must not unilaterally change its status");
        assert.equal(afterCancelRequest.cancel_requested, true);

        const beat = await heartbeatJob(pool, { jobId: claimed!.id, workerId: "worker-1" });
        assert.equal(beat.cancel_requested, true, "the owning worker must be able to observe the pending cancellation on its next heartbeat");

        await assert.rejects(
          () => finalizeCancelledJob(pool, { jobId: claimed!.id, workerId: "some-other-worker" }),
          LeaseLostError,
          "only the owning worker may finalize its own cancellation",
        );

        const finalized = await finalizeCancelledJob(pool, { jobId: claimed!.id, workerId: "worker-1" });
        assert.equal(finalized.status, "cancelled");
        assert.equal(finalized.lease_owner, null);
      },
    );

    await testAsync("cancelJob on an already-terminal job is an idempotent no-op", async () => {
      const jobType = `t-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: "a" });
      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      const done = await completeJob(pool, { jobId: claimed!.id, workerId: "worker-1" });

      const result = await cancelJob(pool, { jobId: done.id });
      assert.equal(result.status, "succeeded", "cancelling a job that already succeeded must never overwrite its outcome");

      await assert.rejects(() => cancelJob(pool, { jobId: randomUUID() }), JobNotFoundError);
    });

    await testAsync("every status transition is recorded in background_job_audit_log, structurally (no payload column exists on it)", async () => {
      const jobType = `t-${randomUUID()}`;
      const { row: job } = await enqueueJob(pool, { jobType, idempotencyKey: "a" });
      const claimed = await claimNextJob(pool, { jobType, workerId: "worker-1" });
      await completeJob(pool, { jobId: claimed!.id, workerId: "worker-1" });

      const rows = await pool.query<{ to_status: string }>(
        `SELECT to_status FROM background_job_audit_log WHERE job_id=$1 ORDER BY id ASC`,
        [job.id],
      );
      assert.deepEqual(rows.rows.map((r) => r.to_status), ["processing", "succeeded"]);
    });

    await testAsync("resurrectTerminal revives a dead-lettered idempotency key back to queued with attempts reset", async () => {
      const jobType = `t-${randomUUID()}`;
      await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { v: 1 }, maxAttempts: 1 });
      const claimed = await claimNextJob(pool, { jobType, workerId: "w1" });
      await failJob(pool, { jobId: claimed!.id, workerId: "w1", errorMessage: "boom", errorCategory: "non_retryable" });
      // Without the flag the terminal row simply comes back untouched.
      const untouched = await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { v: 2 } });
      assert.equal(untouched.created, false);
      assert.equal(untouched.row.status, "dead_letter");
      // With it, the row is atomically reset and carries the new payload.
      const revived = await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { v: 3 }, resurrectTerminal: true });
      assert.equal(revived.created, true);
      assert.equal(revived.row.status, "queued");
      assert.equal(revived.row.attempt_count, 0);
      assert.equal((revived.row.payload as { v: number }).v, 3);
      const audit = await pool.query<{ from_status: string | null; to_status: string }>(
        `SELECT from_status, to_status FROM background_job_audit_log WHERE job_id=$1 ORDER BY id DESC LIMIT 1`,
        [revived.row.id],
      );
      assert.deepEqual(audit.rows[0], { from_status: "dead_letter", to_status: "queued" });
      const reclaimed = await claimNextJob(pool, { jobType, workerId: "w2" });
      assert.equal(reclaimed?.id, revived.row.id);
    });
    await testAsync("resurrectTerminal never touches a live (queued or leased) row", async () => {
      const jobType = `t-${randomUUID()}`;
      const { row: first } = await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { v: 1 } });
      const again = await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { v: 2 }, resurrectTerminal: true });
      assert.equal(again.created, false);
      assert.equal(again.row.id, first.id);
      assert.equal((again.row.payload as { v: number }).v, 1, "live row keeps its original payload");
      const claimed = await claimNextJob(pool, { jobType, workerId: "w1" });
      assert.ok(claimed);
      const leased = await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { v: 3 }, resurrectTerminal: true });
      assert.equal(leased.created, false);
      assert.equal(leased.row.status, "processing");
    });

    await testAsync("a finished job keeps no PDF password: succeeded, dead-lettered, lease-expired into dead_letter and cancelled rows drop it; a job that can still run keeps it (TE #400)", async () => {
      const PW = "Made-up-Passw0rd";
      const passwordOf = async (id: string) => (await pool.query<{ has: boolean; other: string | null }>(
        `SELECT payload ? 'pdfPassword' AS has, payload->>'policyId' AS other FROM background_jobs WHERE id=$1`, [id])).rows[0];
      const fresh = async (maxAttempts = 3) => {
        const jobType = `pw-${randomUUID()}`;
        const { row } = await enqueueJob(pool, { jobType, idempotencyKey: "doc", payload: { policyId: "p-1", pdfPassword: PW }, maxAttempts });
        return { jobType, id: row.id };
      };
      // Succeeded.
      let j = await fresh();
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await completeJob(pool, { jobId: j.id, workerId: "w" });
      assert.deepEqual(await passwordOf(j.id), { has: false, other: "p-1" }, "succeeded: password gone, the rest of the payload kept");
      // A retryable failure keeps it (the retry needs it); the last attempt's failure drops it.
      j = await fresh(2);
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await failJob(pool, { jobId: j.id, workerId: "w", errorCategory: "transient", errorMessage: "x" });
      assert.equal((await passwordOf(j.id)).has, true, "failed_retryable: kept for the retry");
      await pool.query(`UPDATE background_jobs SET available_at=now() WHERE id=$1`, [j.id]);
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await failJob(pool, { jobId: j.id, workerId: "w", errorCategory: "transient", errorMessage: "x" });
      assert.deepEqual(await passwordOf(j.id), { has: false, other: "p-1" }, "dead_letter: password gone");
      // A non-retryable failure goes straight to dead_letter and drops it.
      j = await fresh();
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await failJob(pool, { jobId: j.id, workerId: "w", errorCategory: "non_retryable", errorMessage: "x" });
      assert.equal((await passwordOf(j.id)).has, false, "non-retryable dead_letter: password gone");
      // A lapsed lease: back to retry keeps it; into dead_letter drops it.
      j = await fresh(1);
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await recoverExpiredLeases(pool, { asOf: new Date(Date.now() + 10 * DEFAULT_LEASE_DURATION_MS) });
      assert.equal((await passwordOf(j.id)).has, false, "lease expired into dead_letter: password gone");
      j = await fresh(3);
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await recoverExpiredLeases(pool, { asOf: new Date(Date.now() + 10 * DEFAULT_LEASE_DURATION_MS) });
      assert.equal((await passwordOf(j.id)).has, true, "lease expired back to retry: kept");
      // Cancelled while queued, and cancelled cooperatively while processing.
      j = await fresh();
      await cancelJob(pool, { jobId: j.id });
      assert.equal((await passwordOf(j.id)).has, false, "cancelled while queued: password gone");
      j = await fresh();
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await cancelJob(pool, { jobId: j.id });
      assert.equal((await passwordOf(j.id)).has, true, "processing with a cancel requested: still running, kept");
      await finalizeCancelledJob(pool, { jobId: j.id, workerId: "w" });
      assert.equal((await passwordOf(j.id)).has, false, "cancelled by its worker: password gone");
      // A run that marked its job as waiting for the malware scan keeps it on success (lib/scanning/held-password.ts); a dead letter never does.
      j = await fresh();
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await pool.query(`UPDATE background_jobs SET payload=payload || '{"heldForScan":true}' WHERE id=$1`, [j.id]);
      await completeJob(pool, { jobId: j.id, workerId: "w" });
      assert.equal((await passwordOf(j.id)).has, true, "held for its scan: kept");
      j = await fresh();
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await pool.query(`UPDATE background_jobs SET payload=payload || '{"heldForScan":true}' WHERE id=$1`, [j.id]);
      await failJob(pool, { jobId: j.id, workerId: "w", errorCategory: "non_retryable", errorMessage: "x" });
      assert.equal((await pool.query(`SELECT payload ?| ARRAY['pdfPassword','heldForScan'] AS has FROM background_jobs WHERE id=$1`, [j.id])).rows[0].has, false, "dead letter: password and mark gone");
      // A job with no password, or a payload that is not an object, finishes as before.
      const { row: plain } = await enqueueJob(pool, { jobType: `pw-${randomUUID()}`, idempotencyKey: "a", payload: ["x"] });
      await claimNextJob(pool, { jobType: plain.job_type, workerId: "w" });
      const done = await completeJob(pool, { jobId: plain.id, workerId: "w" });
      assert.equal(done.status, "succeeded");
      assert.deepEqual(done.payload, ["x"]);
      // Read again revives a finished row with the fresh payload it is given, password and all.
      j = await fresh();
      await claimNextJob(pool, { jobType: j.jobType, workerId: "w" });
      await completeJob(pool, { jobId: j.id, workerId: "w" });
      await enqueueJob(pool, { jobType: j.jobType, idempotencyKey: "doc", payload: { policyId: "p-1", pdfPassword: PW }, resurrectTerminal: true });
      assert.equal((await passwordOf(j.id)).has, true, "a revived job carries the password typed again");
      // The reprocess route's own cancel of a waiting re-read drops it too.
      const { readFileSync } = await import("node:fs");
      assert.match(readFileSync(path.resolve("app/api/policies/reprocess/route.ts"), "utf8"), /SET status='cancelled'[^`]*payload=\$\{WITHOUT_PASSWORD_SQL\}/);
    });
    await testAsync("deferJob puts the same job back to wait: attempt given back, payload patched, due later; a cancel wins; claimAndProcessOne defers on JobDeferral", async () => {
      const jobType = `defer-${randomUUID()}`;
      const { row: job } = await enqueueJob(pool, { jobType, idempotencyKey: "doc-1", payload: { policyId: "p-1", pdfPassword: "pw" }, maxAttempts: 3 });
      const claimed = await claimNextJob(pool, { jobType, workerId: "w" });
      assert.equal(claimed!.attempt_count, 1);
      await assert.rejects(() => deferJob(pool, { jobId: job.id, workerId: "someone-else", delayMs: 1_000, payloadPatch: {} }), LeaseLostError, "only the lease owner defers");
      const waiting = await deferJob(pool, { jobId: job.id, workerId: "w", delayMs: 60_000, payloadPatch: { baiduWait: { runs: 1 } } });
      assert.equal(waiting.status, "queued");
      assert.equal(waiting.attempt_count, 0, "the wait uses up no attempt");
      assert.equal(waiting.lease_owner, null);
      assert.deepEqual(waiting.payload, { policyId: "p-1", pdfPassword: "pw", baiduWait: { runs: 1 } }, "payload kept and patched");
      const dueIn = new Date(waiting.available_at).getTime() - Date.now();
      assert.ok(dueIn > 50_000 && dueIn <= 61_000, `due about a minute later (${dueIn} ms)`);
      assert.equal(await claimNextJob(pool, { jobType, workerId: "w2" }), null, "not claimable before it is due");
      await pool.query(`UPDATE background_jobs SET available_at=now() WHERE id=$1`, [job.id]);
      const again = await claimNextJob(pool, { jobType, workerId: "w2" });
      assert.equal(again!.id, job.id, "the same job, same key");
      assert.equal(again!.attempt_count, 1, "still the first attempt");
      // A cancel asked for while it ran: cancelled, no password, but the patch kept (it may name a staged copy to remove).
      await pool.query(`UPDATE background_jobs SET cancel_requested=true WHERE id=$1`, [job.id]);
      const cancelled = await deferJob(pool, { jobId: job.id, workerId: "w2", delayMs: 1_000, payloadPatch: { baiduWait: { runs: 2 } } });
      assert.equal(cancelled.status, "cancelled");
      assert.deepEqual(cancelled.payload, { policyId: "p-1", baiduWait: { runs: 2 } });
      const audit = await pool.query<{ to_status: string }>(`SELECT to_status FROM background_job_audit_log WHERE job_id=$1 ORDER BY created_at, to_status`, [job.id]);
      assert.ok(audit.rows.some((r) => r.to_status === "queued") && audit.rows.some((r) => r.to_status === "cancelled"), "both transitions audited");
      // The runner: a processor that throws JobDeferral is deferred, not failed.
      const { claimAndProcessOne } = await import("@/lib/jobs/worker-runtime");
      const { JobDeferral } = await import("@/lib/jobs/deferral");
      const type2 = `defer-${randomUUID()}`;
      const { row: j2 } = await enqueueJob(pool, { jobType: type2, idempotencyKey: "doc-2", payload: { n: 1 } });
      const outcome = await claimAndProcessOne({ jobType: type2, workerId: "w", process: async () => { throw new JobDeferral(20_000, { waited: true }); } });
      assert.equal(outcome, "succeeded");
      const after = (await pool.query<{ status: string; attempt_count: number; payload: unknown; last_error_message: string | null }>(`SELECT status, attempt_count, payload, last_error_message FROM background_jobs WHERE id=$1`, [j2.id])).rows[0];
      assert.deepEqual(after, { status: "queued", attempt_count: 0, payload: { n: 1, waited: true }, last_error_message: null });
    });

    console.log(`background-jobs regressions passed: ${cases} cases (idempotent enqueue, claim/SKIP LOCKED exclusivity, heartbeat lease extension, ` +
      `completion, bounded transient retry matching computeBackoffMs(), immediate non_retryable dead-letter, lease-expiry recovery & the zombie-worker ` +
      `ownership CAS, dead-letter-on-recovery once max_attempts is exhausted, immediate and cooperative cancellation, idempotent cancel-of-terminal, ` +
      `structural audit trail, terminal-row resurrection for re-requested work, no PDF password kept on a finished job, deferral back to the queue).`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
  }
}

runDatabaseTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
