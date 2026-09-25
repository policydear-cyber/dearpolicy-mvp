-- DearPolicy internal claim reviewers.
--
-- A claim reviewer is a DearPolicy staff role, never a household role: no
-- household owner or member can create, activate or assign one, and nothing
-- in a household's own data (membership, cookies, JWT metadata, request
-- bodies) can make someone a reviewer. Reviewers exist only because a
-- trusted operator ran the audited provisioning procedure (see
-- scripts/claim-reviewer-admin.ts and lib/claims/reviewers/admin.ts)
-- against the database directly.
--
-- A reviewer sees nothing by default. Access is granted one claim at a
-- time by an explicit, expiring, revocable assignment, and every check is
-- repeated server-side on every request by
-- lib/claims/reviewers/boundary.ts's requireAssignedClaimReviewer().
--
-- These tables are never reachable from a browser session: row level
-- security is enabled with a single always-false policy, and the anon and
-- authenticated roles hold no privileges on them. Only the trusted server
-- connection (which bypasses RLS) reads or writes them.

CREATE TABLE IF NOT EXISTS claim_reviewers (
  user_id uuid PRIMARY KEY,
  display_label text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  status_reason text,
  provisioned_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_reviewers_status_check CHECK (status IN ('active', 'suspended')),
  CONSTRAINT claim_reviewers_display_label_check CHECK (length(btrim(display_label)) BETWEEN 1 AND 80),
  CONSTRAINT claim_reviewers_provisioned_by_check CHECK (length(btrim(provisioned_by)) > 0)
);

CREATE TABLE IF NOT EXISTS claim_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_user_id uuid NOT NULL REFERENCES claim_reviewers(user_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  claim_session_id uuid NOT NULL REFERENCES claim_sessions(id) ON DELETE CASCADE,
  -- NULL: every current document of this one claim. Otherwise exactly one
  -- document, which never unlocks any other.
  evidence_document_id uuid REFERENCES claim_evidence_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  expires_at timestamptz NOT NULL,
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  CONSTRAINT claim_review_assignments_status_check CHECK (status IN ('active', 'revoked')),
  CONSTRAINT claim_review_assignments_revocation_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT claim_review_assignments_expiry_check CHECK (expires_at > assigned_at),
  CONSTRAINT claim_review_assignments_assigned_by_check CHECK (length(btrim(assigned_by)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS claim_review_assignments_one_active
  ON claim_review_assignments(reviewer_user_id, claim_session_id, coalesce(evidence_document_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS claim_review_assignments_reviewer
  ON claim_review_assignments(reviewer_user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS claim_review_assignments_claim
  ON claim_review_assignments(account_id, claim_session_id, status);

-- Append-only reviewer audit trail: provisioning, suspension, assignment,
-- revocation, document access and every definition decision. Deliberately
-- has no foreign keys, so the record of who did what outlives the rows it
-- describes. A trigger rejects every UPDATE and DELETE.
CREATE TABLE IF NOT EXISTS claim_reviewer_audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL,
  action text NOT NULL,
  reviewer_user_id uuid,
  assignment_id uuid,
  account_id uuid,
  claim_session_id uuid,
  evidence_document_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS claim_reviewer_audit_log_reviewer ON claim_reviewer_audit_log(reviewer_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS claim_reviewer_audit_log_claim ON claim_reviewer_audit_log(account_id, claim_session_id);

CREATE OR REPLACE FUNCTION claim_reviewer_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'claim_reviewer_audit_log is append-only';
END;
$$;
DROP TRIGGER IF EXISTS claim_reviewer_audit_log_append_only ON claim_reviewer_audit_log;
CREATE TRIGGER claim_reviewer_audit_log_append_only
  BEFORE UPDATE OR DELETE ON claim_reviewer_audit_log
  FOR EACH ROW EXECUTE FUNCTION claim_reviewer_audit_log_append_only();

ALTER TABLE claim_reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_reviewer_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS claim_reviewers_no_client_access ON claim_reviewers;
CREATE POLICY claim_reviewers_no_client_access ON claim_reviewers FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS claim_review_assignments_no_client_access ON claim_review_assignments;
CREATE POLICY claim_review_assignments_no_client_access ON claim_review_assignments FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS claim_reviewer_audit_log_no_client_access ON claim_reviewer_audit_log;
CREATE POLICY claim_reviewer_audit_log_no_client_access ON claim_reviewer_audit_log FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON claim_reviewers, claim_review_assignments, claim_reviewer_audit_log FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE claim_reviewer_audit_log_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
