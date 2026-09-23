-- Checkpoint 8 (claude/v1-launch-hardening): durable job framework
-- (leases, heartbeat, retry/dead-letter, cancellation).
--
-- Replaces the pattern behind lib/claims/evidence/queue.ts and
-- lib/rag/processing-queue.ts today: an in-memory promise chain, scoped to
-- one process, with no idempotency key, no processing lease, no lease
-- expiry/recovery, no heartbeat, no attempt count, and no bounded retry --
-- a worker crash mid-job simply loses the job silently, and a permanently
-- failing job has nowhere to land except indistinguishable from one that
-- just hasn't been retried yet (see scripts/launch-check.ts's
-- checkBackgroundJobReliability()/checkDeadLetterRetrySupport()).
--
-- One durable table any number of worker processes can safely share.
-- Ownership transfer (claim/heartbeat/complete/fail) is CAS-guarded on
-- (id, lease_owner, status), the same optimistic-concurrency discipline
-- sql/lifecycle.sql's lifecycle_version already establishes for this
-- checkpoint family, so a worker that has silently lost its lease (its
-- heartbeat lapsed past lease_expires_at and a reaper reassigned the job)
-- can never mark success, extend its lease, or record a failure against
-- a job it no longer owns -- see lib/jobs/queue.ts's LeaseLostError.

CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nullable: not every job type is account-scoped (a global maintenance
  -- job has no single owning household). ON DELETE CASCADE mirrors every
  -- other account-scoped table in this checkpoint family so a deleted
  -- household's queued/in-flight jobs cannot outlive the account that
  -- would receive their eventual side effects.
  account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  -- Scoped to job_type alone (not account_id): the same idempotency key
  -- must not collide across unrelated job types, but does need to be
  -- globally unique within one job type even for jobs with no
  -- account_id. Mirrors deletion_requests' own idempotency-key discipline
  -- (sql/lifecycle.sql), applied at the table level via the unique index
  -- below rather than inline here so this file reads top-to-bottom.
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  -- A queued/failed_retryable job is not claimable until this time --
  -- this is how bounded-retry backoff is expressed (see
  -- lib/jobs/queue.ts's backoffMs()), and how enqueueJob() can schedule
  -- work for later without a separate scheduler table.
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  last_error_message text,
  last_error_category text,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT background_jobs_status_check
    CHECK (status IN ('queued','processing','succeeded','failed_retryable','dead_letter','cancelled')),
  CONSTRAINT background_jobs_error_category_check
    CHECK (last_error_category IS NULL OR last_error_category IN ('transient','non_retryable')),
  CONSTRAINT background_jobs_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT background_jobs_max_attempts_check CHECK (max_attempts >= 1)
);

-- Idempotency: enqueueJob() with a (job_type, idempotency_key) pair that
-- already exists returns the SAME row rather than creating a duplicate
-- job.
CREATE UNIQUE INDEX IF NOT EXISTS idx_background_jobs_idempotency
  ON background_jobs(job_type, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_background_jobs_claimable
  ON background_jobs(job_type, available_at) WHERE status IN ('queued', 'failed_retryable');
CREATE INDEX IF NOT EXISTS idx_background_jobs_lease_expiry
  ON background_jobs(lease_expires_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_background_jobs_account ON background_jobs(account_id, job_type, status);

-- Structural-only audit trail -- same redaction convention as
-- deletion_audit_log/claim_evidence_audit_log/etc: no payload, no raw
-- error message, nothing that could hold policy wording, medical facts,
-- or document contents. Full privacy-safe-observability enforcement
-- (required/forbidden field lists, centralized telemetry boundary) is
-- Priority 8, not reimplemented here -- this table only needs to already
-- satisfy that eventual constraint, which a structural-only shape does.
CREATE TABLE IF NOT EXISTS background_job_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid REFERENCES background_jobs(id) ON DELETE SET NULL,
  job_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  attempt_count integer NOT NULL,
  error_category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_background_job_audit_log_job ON background_job_audit_log(job_id, created_at DESC);
