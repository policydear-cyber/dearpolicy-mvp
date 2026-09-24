/**
 * Checkpoint 14f (claude/v1-launch-hardening): the operational
 * consumer/drain for dead-lettered jobs that scripts/launch-check.ts's
 * dead_letter_retry_support diagnosis found missing -- failJob() (and
 * recoverExpiredLeases()) have classified failures into dead_letter since
 * Checkpoint 8, but nothing before this module ever read, retried, or
 * surfaced one again. dead_letter_growth (lib/telemetry/alerts.ts) can
 * tell an operator dead-letter volume is climbing; this module is what
 * they actually do about it.
 *
 * Deliberately built on lib/jobs/queue.ts's own primitives and audit/
 * telemetry helpers (appendJobAudit / recordJobEvent), not new ad hoc
 * SQL or a parallel audit trail: a retried dead-letter job produces the
 * exact same background_job_audit_log + telemetry shape any other
 * transition does.
 */
import { pool } from "@/lib/db/client";
import { appendJobAudit, recordJobEvent, type BackgroundJobRow } from "./queue";

const COLUMNS =
  "id, account_id, job_type, idempotency_key, correlation_id, payload, status, attempt_count, max_attempts, available_at, lease_owner, " +
  "lease_expires_at, last_heartbeat_at, last_error_message, last_error_category, cancel_requested, created_at, updated_at, completed_at";

/** Lists dead-lettered jobs, newest-failed first, optionally scoped to
 * one jobType -- the read side of the drain: "what's stuck". */
export async function listDeadLetterJobs(params: { jobType?: string; limit?: number } = {}): Promise<BackgroundJobRow[]> {
  const limit = Math.max(1, Math.min(params.limit ?? 50, 500));
  if (params.jobType) {
    const result = await pool.query<BackgroundJobRow>(
      `SELECT ${COLUMNS} FROM background_jobs WHERE status='dead_letter' AND job_type=$1 ORDER BY updated_at DESC LIMIT $2`,
      [params.jobType, limit],
    );
    return result.rows;
  }
  const result = await pool.query<BackgroundJobRow>(
    `SELECT ${COLUMNS} FROM background_jobs WHERE status='dead_letter' ORDER BY updated_at DESC LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/** Per-jobType counts of currently dead-lettered rows -- the shape an
 * operator dashboard or alert would actually want, rather than making
 * every caller page through listDeadLetterJobs() itself to count. */
export async function countDeadLetterJobsByType(): Promise<{ jobType: string; count: number }[]> {
  const result = await pool.query<{ job_type: string; count: string }>(
    `SELECT job_type, COUNT(*)::text AS count FROM background_jobs WHERE status='dead_letter' GROUP BY job_type ORDER BY job_type`,
  );
  return result.rows.map((row) => ({ jobType: row.job_type, count: Number(row.count) }));
}

export class DeadLetterJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`No dead_letter job found with id ${jobId}`);
    this.name = "DeadLetterJobNotFoundError";
  }
}

/**
 * Requeues exactly one dead-lettered job so the NEXT worker poll
 * (claimNextJob(), via scripts/worker.ts's loop) claims and reprocesses
 * it: resets status back to 'queued', available_at to now(), and
 * attempt_count to 0 -- resetting attempt_count is required, not
 * cosmetic, because failJob()'s own bound (attempt_count >= max_attempts
 * => dead_letter) would otherwise immediately re-dead-letter this job on
 * its very next failure, defeating the retry entirely for a job that was
 * already at its attempt ceiling. last_error_message/_category are
 * cleared so a job that succeeds this time doesn't keep showing a stale
 * failure reason. CAS-guarded on status='dead_letter' -- retrying a job
 * that already moved on (e.g. another operator retried it first, or a
 * worker's recoverExpiredLeases() reclaimed it) is refused with
 * DeadLetterJobNotFoundError rather than silently reprocessing a job
 * that already isn't dead-lettered.
 */
export async function retryDeadLetterJob(jobId: string): Promise<BackgroundJobRow> {
  const result = await pool.query<BackgroundJobRow>(
    `UPDATE background_jobs
        SET status='queued',
            attempt_count=0,
            available_at=now(),
            last_error_message=NULL,
            last_error_category=NULL,
            updated_at=now()
      WHERE id=$1 AND status='dead_letter'
      RETURNING ${COLUMNS}`,
    [jobId],
  );
  const row = result.rows[0];
  if (!row) throw new DeadLetterJobNotFoundError(jobId);

  await appendJobAudit(pool, row, "queued", { fromStatus: "dead_letter" });
  await recordJobEvent(row, "job.dead_letter_retried", { status: "in_progress" });
  return row;
}
