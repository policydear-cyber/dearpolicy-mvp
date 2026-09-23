/**
 * Checkpoint 8 (claude/v1-launch-hardening): durable job framework --
 * leases, heartbeat, bounded retry, dead-letter, cancellation.
 *
 * background_jobs is an infrastructure/job-tracking table, not RLS-mediated
 * household content -- same category as deletion_requests
 * (lib/lifecycle/deletion-requests.ts), which this module deliberately
 * mirrors: plain-pool (service-level) access, an idempotency-key unique
 * index with ON-CONFLICT-then-re-read for enqueue, and CAS-guarded
 * transitions rather than a lock held across an await.
 *
 * Replaces the pattern behind lib/claims/evidence/queue.ts and
 * lib/rag/processing-queue.ts: an in-memory promise chain, scoped to one
 * process, with no idempotency key, no lease, no heartbeat, no attempt
 * count, and no bounded retry. Wiring an existing queue onto this module
 * is a separate, deliberate follow-up per call site -- this file is the
 * shared primitive, not a forced migration of every caller in one commit.
 *
 * Ownership model: claimNextJob() hands one worker a time-boxed lease
 * (lease_owner + lease_expires_at). heartbeatJob()/completeJob()/failJob()/
 * finalizeCancelledJob() all CAS on (id, lease_owner, status='processing'),
 * so a "zombie" worker -- one that thinks it still owns a job after its
 * lease already lapsed and recoverExpiredLeases() reassigned or
 * dead-lettered it -- can never record success, extend its lease, or
 * record a failure against a job it no longer owns. See
 * scripts/background-jobs-regressions.ts's sabotage-and-restore-verified
 * check on exactly this property, and its second check that a job is
 * bounded into dead_letter rather than retried forever.
 */
import { pool } from "@/lib/db/client";

type DbClient = { query: typeof pool.query };

export type JobStatus = "queued" | "processing" | "succeeded" | "failed_retryable" | "dead_letter" | "cancelled";
export type ErrorCategory = "transient" | "non_retryable";

export type BackgroundJobRow = {
  id: string;
  account_id: string | null;
  job_type: string;
  idempotency_key: string;
  payload: unknown;
  status: JobStatus;
  attempt_count: number;
  max_attempts: number;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  last_heartbeat_at: Date | null;
  last_error_message: string | null;
  last_error_category: ErrorCategory | null;
  cancel_requested: boolean;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

const COLUMNS =
  "id, account_id, job_type, idempotency_key, payload, status, attempt_count, max_attempts, available_at, lease_owner, " +
  "lease_expires_at, last_heartbeat_at, last_error_message, last_error_category, cancel_requested, created_at, updated_at, completed_at";

export const DEFAULT_LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_MAX_ATTEMPTS = 5;

// Exponential backoff, 1-indexed by attempt_count, capped at 15 minutes --
// expressed once in SQL (used identically by failJob() and
// recoverExpiredLeases() so a lease-expiry recovery schedules the same
// retry delay a normal failure would) and mirrored in JS by
// computeBackoffMs() below purely so the regression suite can assert
// against the same formula without parsing it back out of SQL.
const BACKOFF_EXPR_SQL = "LEAST(30000 * POWER(2, GREATEST(attempt_count - 1, 0)), 900000)";

/** JS mirror of BACKOFF_EXPR_SQL above -- kept in exact lockstep; the
 * regression suite asserts computeBackoffMs(n) against the actual
 * available_at the database computes, which is what actually proves the
 * two haven't drifted apart. */
export function computeBackoffMs(attemptCount: number): number {
  const base = 30_000;
  return Math.min(base * 2 ** Math.max(attemptCount - 1, 0), 15 * 60 * 1000);
}

/** Thrown by heartbeatJob()/completeJob()/failJob()/finalizeCancelledJob()
 * when the caller no longer owns the job's lease -- either it expired and
 * recoverExpiredLeases() already reassigned or dead-lettered the job, or
 * another worker's claim otherwise won a race. Callers must treat this as
 * "stop working immediately", not retry the same call. */
export class LeaseLostError extends Error {
  constructor(public readonly jobId: string) {
    super(`Job ${jobId} is no longer owned by this worker -- its lease was lost (expired and reclaimed, or already finalized)`);
    this.name = "LeaseLostError";
  }
}

export class JobNotFoundError extends Error {}

async function appendJobAudit(
  db: DbClient,
  row: BackgroundJobRow,
  toStatus: JobStatus,
  opts: { fromStatus?: JobStatus | null; errorCategory?: ErrorCategory | null } = {},
) {
  await db.query(
    `INSERT INTO background_job_audit_log(job_id, job_type, from_status, to_status, attempt_count, error_category)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [row.id, row.job_type, opts.fromStatus ?? null, toStatus, row.attempt_count, opts.errorCategory ?? null],
  );
}

/** Idempotent enqueue: a repeated call with the same (jobType, idempotencyKey)
 * returns the SAME row rather than creating a duplicate job -- the same
 * ON-CONFLICT-then-re-read pattern as
 * lib/lifecycle/deletion-requests.ts's createOrGetDeletionRequest(), so a
 * retried enqueue (e.g. a route handler retried by the client after a
 * timed-out response) can never double-schedule the underlying work. */
export async function enqueueJob(
  db: DbClient,
  params: {
    jobType: string;
    idempotencyKey: string;
    payload?: unknown;
    accountId?: string | null;
    maxAttempts?: number;
    availableAt?: Date;
  },
): Promise<{ row: BackgroundJobRow; created: boolean }> {
  const inserted = await db.query<BackgroundJobRow>(
    `INSERT INTO background_jobs(account_id, job_type, idempotency_key, payload, max_attempts, available_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (job_type, idempotency_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      params.accountId ?? null,
      params.jobType,
      params.idempotencyKey,
      JSON.stringify(params.payload ?? {}),
      params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      params.availableAt ?? new Date(),
    ],
  );
  if (inserted.rows[0]) return { row: inserted.rows[0], created: true };

  const existing = await db.query<BackgroundJobRow>(
    `SELECT ${COLUMNS} FROM background_jobs WHERE job_type=$1 AND idempotency_key=$2`,
    [params.jobType, params.idempotencyKey],
  );
  if (!existing.rows[0]) {
    throw new Error("enqueueJob: insert was skipped by ON CONFLICT but no existing row was found -- this should never happen");
  }
  return { row: existing.rows[0], created: false };
}

/** Atomically claims the oldest available job of the given type for this
 * worker. FOR UPDATE SKIP LOCKED means concurrent workers never claim the
 * same row or block on each other -- returns null when nothing is
 * claimable. A cancel_requested queued/failed_retryable job is never
 * claimable, so a cancellation issued before any worker picks the job up
 * is honored without that worker doing any work first. */
export async function claimNextJob(
  db: DbClient,
  params: { jobType: string; workerId: string; leaseDurationMs?: number },
): Promise<BackgroundJobRow | null> {
  const leaseDurationMs = params.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status='processing',
            lease_owner=$1,
            lease_expires_at = now() + ($2::text || ' milliseconds')::interval,
            last_heartbeat_at = now(),
            attempt_count = attempt_count + 1,
            updated_at = now()
      WHERE id = (
        SELECT id FROM background_jobs
         WHERE job_type=$3 AND status IN ('queued','failed_retryable')
           AND available_at <= now() AND NOT cancel_requested
         ORDER BY available_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING ${COLUMNS}`,
    [params.workerId, String(leaseDurationMs), params.jobType],
  );
  const row = result.rows[0];
  if (!row) return null;
  await appendJobAudit(db, row, "processing");
  return row;
}

/** Extends the caller's lease -- must be called periodically by any
 * long-running job so recoverExpiredLeases() doesn't treat it as
 * abandoned. Returns the current row (including cancel_requested) so a
 * worker loop can check for a pending cancellation on every heartbeat
 * without a separate query. Throws LeaseLostError if this worker no
 * longer owns the job. */
export async function heartbeatJob(
  db: DbClient,
  params: { jobId: string; workerId: string; leaseDurationMs?: number },
): Promise<BackgroundJobRow> {
  const leaseDurationMs = params.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET lease_expires_at = now() + ($1::text || ' milliseconds')::interval,
            last_heartbeat_at = now(),
            updated_at = now()
      WHERE id=$2 AND lease_owner=$3 AND status='processing'
      RETURNING ${COLUMNS}`,
    [String(leaseDurationMs), params.jobId, params.workerId],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  return row;
}

/** Marks a job successfully finished. CAS-guarded on (id, lease_owner,
 * status='processing') -- a worker that has lost its lease can never
 * record success. */
export async function completeJob(db: DbClient, params: { jobId: string; workerId: string }): Promise<BackgroundJobRow> {
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status='succeeded', completed_at=now(), lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
      WHERE id=$1 AND lease_owner=$2 AND status='processing'
      RETURNING ${COLUMNS}`,
    [params.jobId, params.workerId],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  await appendJobAudit(db, row, "succeeded", { fromStatus: "processing" });
  return row;
}

/** Marks a job attempt failed. `errorCategory: "non_retryable"` sends it
 * straight to dead_letter regardless of attempt_count (a validation
 * error, a permanently-malformed input -- retrying would never help).
 * Otherwise it goes to dead_letter only once attempt_count has reached
 * max_attempts; before that, it returns to failed_retryable with
 * available_at pushed out by computeBackoffMs()'s formula (computed here
 * in SQL so the decision and the schedule update happen in the same
 * CAS-guarded statement). CAS-guarded the same way completeJob() is. */
export async function failJob(
  db: DbClient,
  params: { jobId: string; workerId: string; errorCategory: ErrorCategory; errorMessage: string },
): Promise<BackgroundJobRow> {
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status = CASE WHEN $3 = 'non_retryable' OR attempt_count >= max_attempts THEN 'dead_letter' ELSE 'failed_retryable' END,
            available_at = CASE
              WHEN $3 = 'non_retryable' OR attempt_count >= max_attempts THEN available_at
              ELSE now() + (${BACKOFF_EXPR_SQL} || ' milliseconds')::interval
            END,
            last_error_message = $4,
            last_error_category = $3,
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
      WHERE id=$1 AND lease_owner=$2 AND status='processing'
      RETURNING ${COLUMNS}`,
    [params.jobId, params.workerId, params.errorCategory, params.errorMessage],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  await appendJobAudit(db, row, row.status, { fromStatus: "processing", errorCategory: params.errorCategory });
  return row;
}

/** The reaper: finds every job still marked 'processing' whose lease has
 * lapsed (no heartbeat recorded a live lease past `asOf`, which defaults
 * to real now() but is overridable so tests can simulate "time has
 * passed" without mocking the database clock) and recovers each one using
 * the exact same retry-vs-dead-letter decision failJob() makes. Must be
 * run periodically by an external scheduler (a cron job, a cluster of
 * long-lived workers each running it on an interval) -- this module does
 * not schedule itself. */
export async function recoverExpiredLeases(
  db: DbClient,
  params: { asOf?: Date } = {},
): Promise<{ recoveredToRetry: string[]; movedToDeadLetter: string[] }> {
  const asOf = params.asOf ?? new Date();
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'failed_retryable' END,
            available_at = CASE
              WHEN attempt_count >= max_attempts THEN available_at
              ELSE now() + (${BACKOFF_EXPR_SQL} || ' milliseconds')::interval
            END,
            last_error_message = COALESCE(last_error_message, 'Lease expired: worker stopped heartbeating before completing this job'),
            last_error_category = COALESCE(last_error_category, 'transient'),
            lease_owner = NULL,
            lease_expires_at = NULL,
            updated_at = now()
      WHERE status='processing' AND lease_expires_at < $1
      RETURNING ${COLUMNS}`,
    [asOf],
  );
  const recoveredToRetry: string[] = [];
  const movedToDeadLetter: string[] = [];
  for (const row of result.rows) {
    if (row.status === "dead_letter") movedToDeadLetter.push(row.id);
    else recoveredToRetry.push(row.id);
    await appendJobAudit(db, row, row.status, { fromStatus: "processing", errorCategory: row.last_error_category });
  }
  return { recoveredToRetry, movedToDeadLetter };
}

/** Cancels a job. A queued or backoff-waiting (failed_retryable) job is
 * cancelled immediately -- there is no in-flight work to interrupt. A
 * job currently 'processing' can only be asked to stop cooperatively:
 * this sets cancel_requested and leaves status='processing' untouched;
 * the owning worker is expected to notice cancel_requested (returned by
 * every heartbeatJob() call) and call finalizeCancelledJob() itself
 * rather than completeJob()/failJob(). Idempotent no-op on an
 * already-terminal job (succeeded/dead_letter/cancelled). Throws
 * JobNotFoundError only if the id doesn't exist at all. */
export async function cancelJob(db: DbClient, params: { jobId: string }): Promise<BackgroundJobRow> {
  const immediate = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs SET status='cancelled', cancel_requested=true, updated_at=now()
      WHERE id=$1 AND status IN ('queued','failed_retryable')
      RETURNING ${COLUMNS}`,
    [params.jobId],
  );
  if (immediate.rows[0]) {
    await appendJobAudit(db, immediate.rows[0], "cancelled");
    return immediate.rows[0];
  }

  const cooperative = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs SET cancel_requested=true, updated_at=now()
      WHERE id=$1 AND status='processing'
      RETURNING ${COLUMNS}`,
    [params.jobId],
  );
  if (cooperative.rows[0]) return cooperative.rows[0];

  const existing = await db.query<BackgroundJobRow>(`SELECT ${COLUMNS} FROM background_jobs WHERE id=$1`, [params.jobId]);
  if (!existing.rows[0]) throw new JobNotFoundError(`Job ${params.jobId} not found`);
  return existing.rows[0]; // already terminal -- idempotent no-op
}

/** Finalizes a cooperative cancellation a worker has observed (via
 * cancel_requested on a heartbeatJob() response) and stopped for.
 * CAS-guarded the same way completeJob()/failJob() are, plus requires
 * cancel_requested=true so a worker cannot cancel its own job on a whim
 * without cancelJob() having actually been called for it. */
export async function finalizeCancelledJob(db: DbClient, params: { jobId: string; workerId: string }): Promise<BackgroundJobRow> {
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status='cancelled', lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
      WHERE id=$1 AND lease_owner=$2 AND status='processing' AND cancel_requested
      RETURNING ${COLUMNS}`,
    [params.jobId, params.workerId],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  await appendJobAudit(db, row, "cancelled", { fromStatus: "processing" });
  return row;
}
