-- Round 5: physical removal of deleted documents' storage objects.
-- One row per storage object that must be removed because the document (or
-- the whole household) that referenced it was deleted. Deliberately no
-- foreign key to accounts: a household deletion cascades its rows away, and
-- the storage keys to remove must survive that. Additive and idempotent.
CREATE TABLE IF NOT EXISTS storage_purge_queue (
  id bigserial PRIMARY KEY,
  storage_domain text NOT NULL,
  storage_key text NOT NULL,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz,
  CONSTRAINT storage_purge_queue_domain_check CHECK (storage_domain IN ('policy','claim-evidence','household-export')),
  CONSTRAINT storage_purge_queue_unique UNIQUE (storage_domain, storage_key)
);
CREATE INDEX IF NOT EXISTS idx_storage_purge_queue_pending ON storage_purge_queue(next_attempt_at) WHERE purged_at IS NULL;
-- Service-only, like every other infrastructure table (sql/infrastructure-rls.sql).
ALTER TABLE storage_purge_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storage_purge_queue_no_client_access ON storage_purge_queue;
CREATE POLICY storage_purge_queue_no_client_access ON storage_purge_queue FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
REVOKE ALL ON storage_purge_queue FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON storage_purge_queue FROM anon'; EXECUTE 'REVOKE ALL ON SEQUENCE storage_purge_queue_id_seq FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON storage_purge_queue FROM authenticated'; EXECUTE 'REVOKE ALL ON SEQUENCE storage_purge_queue_id_seq FROM authenticated'; END IF;
END $$;
