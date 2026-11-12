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
import { recordEvent } from "@/lib/telemetry";
import { resolveCorrelationId } from "@/lib/telemetry/correlation";

type DbClient = { query: typeof pool.query };

export type JobStatus = "queued" | "processing" | "succeeded" | "failed_retryable" | "dead_letter" | "cancelled";
export type ErrorCategory = "transient" | "non_retryable";

export type BackgroundJobRow = {
  id: string;
  account_id: string | null;
  job_type: string;
  idempotency_key: string;
  correlation_id: string | null;
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
  "id, account_id, job_type, idempotency_key, correlation_id, payload, status, attempt_count, max_attempts, available_at, lease_owner, " +
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

export async function appendJobAudit(
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

/** Checkpoint 9: every durable-job transition below emits one telemetry
 * event through the shared boundary (lib/telemetry/index.ts), correlated
 * by whatever id was attached at enqueueJob() time (falling back to a
 * fresh one -- see resolveCorrelationId() -- for a job enqueued before
 * this column existed, or by a caller that didn't have one to hand).
 * recordEvent() is itself failure-isolated and time-bounded, so this can
 * never make a job transition fail or hang because telemetry did. */
// Checkpoint 9's safe error taxonomy (SafeErrorCategory) is shared across
// the whole codebase and deliberately does not know about this module's
// own job-retry-specific ErrorCategory ("transient"/"non_retryable" --
// about whether a job gets retried, not what kind of failure it was) --
// this maps one onto the taxonomy's two job-shaped categories rather than
// passing the job-internal value through untranslated (which is also
// exactly what the typechecker itself now catches: the two types are not
// assignable to each other).
function toSafeErrorCategory(category: ErrorCategory | null | undefined): "job_retryable" | "job_permanent" | null {
  if (category === "transient") return "job_retryable";
  if (category === "non_retryable") return "job_permanent";
  return null;
}

export async function recordJobEvent(row: BackgroundJobRow, name: string, extra: Record<string, unknown> = {}) {
  await recordEvent({
    name,
    correlationId: resolveCorrelationId(row.correlation_id),
    jobType: row.job_type,
    status: extra.status as "success" | "failure" | "in_progress" | "cancelled" | null | undefined,
    attempt: row.attempt_count,
    processingState: row.status,
    errorCategory: toSafeErrorCategory(extra.errorCategory as ErrorCategory | undefined),
    extra: { jobId: row.id, ...extra },
  });
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
    correlationId?: string | null;
    /** Revive a terminal (succeeded/dead_letter/cancelled) row for this
     * idempotency key back to queued instead of returning it untouched.
     * Only for callers whose work is safe to run again (policy processing);
     * exactly-once callers (deletion coordinators) must not pass this. */
    resurrectTerminal?: boolean;
  },
): Promise<{ row: BackgroundJobRow; created: boolean }> {
  const inserted = await db.query<BackgroundJobRow>(
    `INSERT INTO background_jobs(account_id, job_type, idempotency_key, correlation_id, payload, max_attempts, available_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
     ON CONFLICT (job_type, idempotency_key) DO NOTHING
     RETURNING ${COLUMNS}`,
    [
      params.accountId ?? null,
      params.jobType,
      params.idempotencyKey,
      params.correlationId ?? null,
      JSON.stringify(params.payload ?? {}),
      params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      params.availableAt ?? new Date(),
    ],
  );
  if (inserted.rows[0]) return { row: inserted.rows[0], created: true };

  // A terminal row for this idempotency key would otherwise block the work
  // forever: ON CONFLICT DO NOTHING returns the old succeeded/dead_letter row
  // and nothing ever runs again -- exactly wrong for a job the user is
  // explicitly asking for again (Re-analyse after a dead-letter, re-read of a
  // document already read once). Opted-in callers get the existing row
  // atomically reset to queued (attempt_count 0, fresh payload, errors
  // cleared -- the same reset lib/jobs/dead-letter.ts's retryDeadLetterJob()
  // performs), CAS-guarded on the terminal status so a live row is never
  // touched and the audit trail records the transition.
  if (params.resurrectTerminal) {
    const bColumns = COLUMNS.split(", ").map((column) => "b." + column).join(", ");
    const resurrected = await db.query<BackgroundJobRow & { previous_status: JobStatus }>(
      `WITH previous AS (
         SELECT id, status FROM background_jobs
          WHERE job_type=$1 AND idempotency_key=$2 AND status IN ('succeeded','dead_letter','cancelled')
          FOR UPDATE
       )
       UPDATE background_jobs b
          SET status='queued', attempt_count=0, payload=$3::jsonb,
              correlation_id=COALESCE($4, b.correlation_id),
              available_at=$5, lease_owner=NULL, lease_expires_at=NULL, last_heartbeat_at=NULL,
              last_error_message=NULL, last_error_category=NULL, cancel_requested=false,
              completed_at=NULL, updated_at=now()
         FROM previous p
        WHERE b.id=p.id
        RETURNING ${bColumns}, p.status AS previous_status`,
      [params.jobType, params.idempotencyKey, JSON.stringify(params.payload ?? {}), params.correlationId ?? null, params.availableAt ?? new Date()],
    );
    const revived = resurrected.rows[0];
    if (revived) {
      await appendJobAudit(db, revived, "queued", { fromStatus: revived.previous_status });
      await recordJobEvent(revived, "job.terminal_reenqueued", { status: "in_progress", previousStatus: revived.previous_status });
      return { row: revived, created: true };
    }
  }

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
  params: { jobType: string; workerId: string; leaseDurationMs?: number; idempotencyKey?: string },
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
           AND ($4::text IS NULL OR idempotency_key=$4)
         ORDER BY available_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )
      RETURNING ${COLUMNS}`,
    [params.workerId, String(leaseDurationMs), params.jobType, params.idempotencyKey ?? null],
  );
  const row = result.rows[0];
  if (!row) return null;
  await appendJobAudit(db, row, "processing");
  await recordJobEvent(row, "job.claimed", { status: "in_progress" });
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

/** SQL: the job's payload without the PDF password a household typed for a locked upload (lib/rag/processing-queue.ts).
 * A job that has finished (succeeded, dead-lettered or cancelled) never needs it again: Read again sends a fresh payload
 * with the password typed again (enqueueJob resurrectTerminal), so the password is kept only while the job can still run
 * (queued, processing, failed_retryable). Before, it stayed in a finished job's row until the document was deleted
 * (TE #400). A payload that is not an object is left as it is. */
export const WITHOUT_PASSWORD_SQL = `CASE WHEN jsonb_typeof(payload)='object' THEN payload - 'pdfPassword' - 'heldForScan' ELSE payload END`;
/** On success the password is dropped too, unless the run marked the job as
 * waiting for its malware scan (lib/scanning/held-password.ts): the scan
 * retry reads the document later from this payload and drops it then. */
const SUCCEEDED_PAYLOAD_SQL = `CASE WHEN jsonb_typeof(payload)='object' AND payload->>'heldForScan' IS DISTINCT FROM 'true' THEN payload - 'pdfPassword' - 'heldForScan' ELSE payload END`;

/** Marks a job successfully finished. CAS-guarded on (id, lease_owner,
 * status='processing') -- a worker that has lost its lease can never
 * record success. */
export async function completeJob(db: DbClient, params: { jobId: string; workerId: string }): Promise<BackgroundJobRow> {
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status='succeeded', completed_at=now(), lease_owner=NULL, lease_expires_at=NULL, updated_at=now(), payload=${SUCCEEDED_PAYLOAD_SQL}
      WHERE id=$1 AND lease_owner=$2 AND status='processing'
      RETURNING ${COLUMNS}`,
    [params.jobId, params.workerId],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  await appendJobAudit(db, row, "succeeded", { fromStatus: "processing" });
  await recordJobEvent(row, "job.completed", { status: "success" });
  return row;
}

/** Puts a running job back in the queue to run again after `delayMs` (lib/jobs/deferral.ts): its work waits on something
 * outside, such as Baidu reading a document's scanned pages. The attempt it was claimed with is given back (the wait is
 * not a failure), `payloadPatch` is merged into its payload for the next run, and the job keeps its id and idempotency
 * key. A job asked to cancel meanwhile is cancelled instead. CAS-guarded the same way completeJob() is. */
export async function deferJob(
  db: DbClient,
  params: { jobId: string; workerId: string; delayMs: number; payloadPatch: Record<string, unknown> },
): Promise<BackgroundJobRow> {
  const result = await db.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'queued' END,
            payload = CASE WHEN jsonb_typeof(payload) <> 'object' THEN $4::jsonb
                           -- Cancelled: no password kept, but the patch is (it can name files still to remove, see
                           -- lib/lifecycle/content-scrub.ts stopDeletedDocumentJobs).
                           WHEN cancel_requested THEN (payload || $4::jsonb) - 'pdfPassword' - 'heldForScan'
                           ELSE payload || $4::jsonb END,
            attempt_count = GREATEST(attempt_count - 1, 0),
            available_at = now() + ($3 || ' milliseconds')::interval,
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_heartbeat_at = NULL,
            updated_at = now()
      WHERE id=$1 AND lease_owner=$2 AND status='processing'
      RETURNING ${COLUMNS}`,
    [params.jobId, params.workerId, String(Math.max(0, Math.round(params.delayMs))), JSON.stringify(params.payloadPatch)],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  await appendJobAudit(db, row, row.status, { fromStatus: "processing" });
  await recordJobEvent(row, row.status === "cancelled" ? "job.cancelled" : "job.deferred", { status: row.status === "cancelled" ? "cancelled" : "in_progress", delayMs: params.delayMs });
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
            payload = CASE WHEN $3 = 'non_retryable' OR attempt_count >= max_attempts THEN ${WITHOUT_PASSWORD_SQL} ELSE payload END,
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
  await recordJobEvent(row, row.status === "dead_letter" ? "job.dead_letter" : "job.failed_retryable", {
    status: "failure",
    errorCategory: params.errorCategory,
  });
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
            payload = CASE WHEN attempt_count >= max_attempts THEN ${WITHOUT_PASSWORD_SQL} ELSE payload END,
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
    await recordJobEvent(row, "job.lease_expired", {
      status: "failure",
      errorCategory: row.last_error_category,
      recoveredTo: row.status,
    });
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
    `UPDATE background_jobs SET status='cancelled', cancel_requested=true, updated_at=now(), payload=${WITHOUT_PASSWORD_SQL}
      WHERE id=$1 AND status IN ('queued','failed_retryable')
      RETURNING ${COLUMNS}`,
    [params.jobId],
  );
  if (immediate.rows[0]) {
    await appendJobAudit(db, immediate.rows[0], "cancelled");
    await recordJobEvent(immediate.rows[0], "job.cancelled", { status: "cancelled" });
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
        SET status='cancelled', lease_owner=NULL, lease_expires_at=NULL, updated_at=now(), payload=${WITHOUT_PASSWORD_SQL}
      WHERE id=$1 AND lease_owner=$2 AND status='processing' AND cancel_requested
      RETURNING ${COLUMNS}`,
    [params.jobId, params.workerId],
  );
  const row = result.rows[0];
  if (!row) throw new LeaseLostError(params.jobId);
  await appendJobAudit(db, row, "cancelled", { fromStatus: "processing" });
  await recordJobEvent(row, "job.cancelled", { status: "cancelled" });
  return row;
}
