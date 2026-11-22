-- Admin audit log: one row per destructive action taken from the admin console (today: deleting an account).
-- Holds only pseudonymised references (keyed HMACs), counts and a result, never an email address, name or file name,
-- so a deleted account leaves nothing that identifies the person. No foreign keys: the rows must outlive what they
-- describe. Additive and idempotent; the admin console works without it (the action is then recorded in telemetry only).
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  admin_ref text,
  target_ref text,
  outcome text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_occurred ON admin_audit_log(occurred_at DESC);
-- Service-only, like every other infrastructure table (sql/infrastructure-rls.sql).
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_audit_log_no_client_access ON admin_audit_log;
CREATE POLICY admin_audit_log_no_client_access ON admin_audit_log FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON admin_audit_log FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON admin_audit_log FROM anon'; EXECUTE 'REVOKE ALL ON SEQUENCE admin_audit_log_id_seq FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON admin_audit_log FROM authenticated'; EXECUTE 'REVOKE ALL ON SEQUENCE admin_audit_log_id_seq FROM authenticated'; END IF;
END $$;
