-- Checkpoint 7 (claude/v1-launch-hardening): deletion & derived-data
-- invalidation lifecycle.
--
-- Adds a dedicated lifecycle_state/lifecycle_version pair to every
-- top-level resource type this checkpoint governs, kept deliberately
-- separate from each table's own domain-specific status column
-- (policies.quarantine_status, claim_evidence_documents.status,
-- claim_evidence_documents.scan_status/identity_status) so deletion
-- lifecycle can never be confused with processing/scan lifecycle.
-- lifecycle_version is the optimistic-concurrency token every transition
-- CASes against (lib/lifecycle/state-machine.ts's transitionLifecycle) --
-- it guards against two concurrent deletion workers mutating the same
-- resource, it is not a row "version" in the audit-history sense.
--
-- Runtime-validated states (see lib/lifecycle/types.ts):
--   active -> pending_deletion -> soft_deleted -> permanently_deleted -> audit_tombstone
-- with limited recovery (pending_deletion -> active, soft_deleted -> active)
-- gated by policy in the coordinator, never assumed by the schema itself.
--
-- household_members / household_invitations are NOT given a
-- lifecycle_state column here: membership is revoked (row deleted) and
-- invitations are already soft-stated via revoked_at/accepted_at
-- (sql/household-rls.sql), so those two deletion flows are represented
-- entirely through deletion_requests below, not through this column.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'active';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 0;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_lifecycle_state_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_lifecycle_state_check
  CHECK (lifecycle_state IN ('active','pending_deletion','soft_deleted','permanently_deleted','audit_tombstone'));
CREATE INDEX IF NOT EXISTS idx_accounts_lifecycle_state ON accounts(lifecycle_state);

ALTER TABLE policies ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'active';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 0;
ALTER TABLE policies DROP CONSTRAINT IF EXISTS policies_lifecycle_state_check;
ALTER TABLE policies ADD CONSTRAINT policies_lifecycle_state_check
  CHECK (lifecycle_state IN ('active','pending_deletion','soft_deleted','permanently_deleted','audit_tombstone'));
CREATE INDEX IF NOT EXISTS idx_policies_lifecycle_state ON policies(account_id, lifecycle_state);

-- claim_evidence_documents lives in sql/claim-evidence.sql, which not
-- every harness/environment loads before this file (e.g. a suite that
-- only needs sql/schema.sql) -- guarded the same way
-- sql/household-rls.sql already guards its own optional tables, so this
-- file stays a safe no-op for that table rather than failing outright.
DO $$
BEGIN
  IF to_regclass('public.claim_evidence_documents') IS NOT NULL THEN
    ALTER TABLE claim_evidence_documents ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'active';
    ALTER TABLE claim_evidence_documents ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 0;
    ALTER TABLE claim_evidence_documents DROP CONSTRAINT IF EXISTS claim_evidence_documents_lifecycle_state_check;
    ALTER TABLE claim_evidence_documents ADD CONSTRAINT claim_evidence_documents_lifecycle_state_check
      CHECK (lifecycle_state IN ('active','pending_deletion','soft_deleted','permanently_deleted','audit_tombstone'));
    CREATE INDEX IF NOT EXISTS idx_claim_evidence_documents_lifecycle_state ON claim_evidence_documents(account_id, lifecycle_state);
  END IF;
END
$$;

ALTER TABLE family_members ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'active';
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 0;
ALTER TABLE family_members DROP CONSTRAINT IF EXISTS family_members_lifecycle_state_check;
ALTER TABLE family_members ADD CONSTRAINT family_members_lifecycle_state_check
  CHECK (lifecycle_state IN ('active','pending_deletion','soft_deleted','permanently_deleted','audit_tombstone'));
CREATE INDEX IF NOT EXISTS idx_family_members_lifecycle_state ON family_members(account_id, lifecycle_state);

-- One durable record per deletion request. Independent of the specific
-- resource-type table's own lifecycle_state column above -- this is the
-- coordinator's own bookkeeping (retry state, cleanup job linkage,
-- retention deadline) and the source of the idempotency guarantee, for
-- EVERY deletion flow including the two (household-member removal,
-- invitation revocation) that have no lifecycle_state column of their own.
CREATE TABLE IF NOT EXISTS deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reason_category text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'pending_deletion',
  state_version integer NOT NULL DEFAULT 0,
  retention_deadline timestamptz,
  cleanup_job_id text,
  completed_at timestamptz,
  failure_category text,
  retry_count integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deletion_requests_resource_type_check
    CHECK (resource_type IN ('policy_document','policy','claim_evidence','family_member','household_member','household_leave','invitation','household')),
  CONSTRAINT deletion_requests_lifecycle_state_check
    CHECK (lifecycle_state IN ('pending_deletion','soft_deleted','permanently_deleted','audit_tombstone','failed_recoverable','blocked')),
  CONSTRAINT deletion_requests_failure_category_check
    CHECK (failure_category IS NULL OR failure_category IN ('storage_partial_failure','database_partial_failure','provider_failure','validation_failure'))
);

-- Idempotency: a repeated request with the same key for the same resource
-- returns the SAME deletion_requests row rather than creating a second one
-- or repeating destructive work -- mirrors household_exports' own
-- (household_id, idempotency_key) unique index (sql/schema.sql).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_idempotency
  ON deletion_requests(account_id, resource_type, resource_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_account ON deletion_requests(account_id, resource_type, lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_resource ON deletion_requests(resource_type, resource_id);

-- Immutable audit trail for every lifecycle transition. Deliberately holds
-- no policy text, medical facts, filenames, tokens or signed URLs -- only
-- structural metadata, matching the redaction convention already
-- established by policy_document_audit_log / claim_evidence_audit_log /
-- storage_cleanup_audit_log / household_export_audit_log.
CREATE TABLE IF NOT EXISTS deletion_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deletion_request_id uuid REFERENCES deletion_requests(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  actor uuid,
  from_state text,
  to_state text NOT NULL,
  correlation_id uuid NOT NULL,
  cleanup_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_account ON deletion_audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deletion_audit_log_request ON deletion_audit_log(deletion_request_id);
