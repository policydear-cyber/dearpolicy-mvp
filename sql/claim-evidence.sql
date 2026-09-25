-- Claim-evidence pipeline: documents uploaded to support a specific claim
-- (death certificate, police report, coroner's/medical examiner's report),
-- kept entirely separate from policy documents (sql/schema.sql's `policies`
-- table). Every table here is scoped to account_id plus the narrower ids
-- that matter for that row (family member, claim event/session, contract,
-- coverage) so a query can never accidentally cross those boundaries --
-- there is no reliance on Postgres row-level security here, matching the
-- rest of this codebase, which enforces ownership in application code and
-- explicit WHERE clauses rather than RLS policies (see lib/db/client.ts).

CREATE TABLE IF NOT EXISTS claim_evidence_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  claim_session_id uuid NOT NULL REFERENCES claim_sessions(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  original_filename text NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  file_hash text NOT NULL,
  status text NOT NULL DEFAULT 'uploaded',
  scan_status text NOT NULL DEFAULT 'pending_scan',
  identity_status text NOT NULL DEFAULT 'pending',
  processing_error text,
  processing_error_code text,
  processing_attempts integer NOT NULL DEFAULT 0,
  -- A re-upload for the same claim/document-type slot creates a NEW row and
  -- points back at the one it replaces, rather than mutating history in
  -- place -- the audit log and any cause-definition match already reviewed
  -- against the old row stay intact and inspectable.
  supersedes_id uuid REFERENCES claim_evidence_documents(id) ON DELETE SET NULL,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_evidence_documents_document_type_check
    CHECK (document_type IN ('death_certificate','police_report','coroners_report','medical_examiner_report','other_official_document')),
  CONSTRAINT claim_evidence_documents_status_check
    CHECK (status IN ('uploaded','quarantined','processing','extracted','needs_review','matched','rejected','failed')),
  CONSTRAINT claim_evidence_documents_scan_status_check
    CHECK (scan_status IN ('pending_scan','clean','infected','scan_unavailable')),
  CONSTRAINT claim_evidence_documents_identity_status_check
    CHECK (identity_status IN ('pending','confirmed','needs_review','mismatch'))
);

-- Idempotent, duplicate-safe upload: re-submitting the exact same bytes
-- (by content hash) for the same claim while the earlier upload is still
-- active resolves to the SAME row rather than creating a second one or
-- erroring. A superseded/replaced row is excluded so a genuine re-upload of
-- a corrected file is never blocked by an old version's hash.
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_evidence_documents_dedupe
  ON claim_evidence_documents(account_id, claim_session_id, file_hash)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claim_evidence_documents_claim
  ON claim_evidence_documents(account_id, claim_session_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_documents_member
  ON claim_evidence_documents(account_id, family_member_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_documents_status
  ON claim_evidence_documents(account_id, status);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_documents_supersedes
  ON claim_evidence_documents(supersedes_id);

-- One row per extraction ATTEMPT against one specific document VERSION
-- (source_document_version = the document's file_hash at extraction time).
-- Retrying extraction for the same document version is idempotent: it
-- upserts this same row rather than creating a duplicate, so a retried or
-- duplicated background job can never fork the record. extracted_fields is
-- the model's untrusted proposal; reviewed_fields (null until a reviewer
-- acts) is the only thing anything downstream may treat as confirmed.
CREATE TABLE IF NOT EXISTS claim_evidence_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  evidence_document_id uuid NOT NULL REFERENCES claim_evidence_documents(id) ON DELETE CASCADE,
  source_document_version text NOT NULL,
  extracted_fields jsonb NOT NULL,
  reviewed_fields jsonb,
  reviewed_at timestamptz,
  reviewed_by text,
  extraction_model text NOT NULL,
  extraction_provider text NOT NULL,
  extraction_version text NOT NULL,
  processing_timestamp timestamptz NOT NULL DEFAULT now(),
  identity_conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_evidence_extractions_dedupe
  ON claim_evidence_extractions(evidence_document_id, source_document_version);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_extractions_account
  ON claim_evidence_extractions(account_id);

-- Policy-specific matches between a reviewed cause-of-death document and
-- ONE policy's own accidental-death definition. This table is the single
-- source of truth calculateAccidentalDeath() is ultimately fed from (see
-- lib/claims/evidence/matches.ts); it is never written from chat text or
-- model output, only from an explicit reviewer action or a deterministic
-- rule. A row is never edited in place once reviewed -- a later change
-- (corrected evidence, a new policy-document version) supersedes it via
-- superseded_at, so the OLD match cannot keep unlocking anything, and the
-- history stays inspectable in the audit log.
CREATE TABLE IF NOT EXISTS claim_cause_definition_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  claim_session_id uuid NOT NULL REFERENCES claim_sessions(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  coverage_id uuid REFERENCES policy_coverages(id) ON DELETE CASCADE,
  evidence_document_id uuid NOT NULL REFERENCES claim_evidence_documents(id) ON DELETE CASCADE,
  cause_evidence jsonb NOT NULL,
  definition_evidence jsonb NOT NULL,
  result text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL,
  reason text,
  superseded_at timestamptz,
  superseded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_cause_definition_matches_result_check
    CHECK (result IN ('matches','does_not_match','needs_review'))
);
CREATE INDEX IF NOT EXISTS idx_cause_matches_scope
  ON claim_cause_definition_matches(account_id, family_member_id, claim_session_id, contract_id)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cause_matches_document
  ON claim_cause_definition_matches(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_cause_matches_coverage
  ON claim_cause_definition_matches(coverage_id);

-- Append-only audit trail. Application code only ever INSERTs here -- see
-- lib/claims/evidence/audit.ts, which is the one place allowed to write to
-- this table -- and never UPDATEs or DELETEs a row.
CREATE TABLE IF NOT EXISTS claim_evidence_audit_log (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor text NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  previous_value jsonb,
  new_value jsonb,
  evidence_document_id uuid REFERENCES claim_evidence_documents(id) ON DELETE SET NULL,
  claim_session_id uuid REFERENCES claim_sessions(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES policies(id) ON DELETE SET NULL,
  coverage_id uuid REFERENCES policy_coverages(id) ON DELETE SET NULL,
  reason text,
  reason_code text
);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_audit_document
  ON claim_evidence_audit_log(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_audit_claim
  ON claim_evidence_audit_log(account_id, claim_session_id);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_audit_occurred
  ON claim_evidence_audit_log(account_id, occurred_at DESC);

-- Evidence model-execution provenance, additive and idempotent. The
-- extraction row records the exact model_executions identity behind its
-- extracted_fields; a definition-match row snapshots the provenance the
-- reviewer's decision rested on. Rows written before these columns existed
-- keep NULL, which every monetary gate treats as missing provenance and
-- therefore fails closed.
ALTER TABLE claim_evidence_extractions ADD COLUMN IF NOT EXISTS model_execution jsonb;
ALTER TABLE claim_cause_definition_matches ADD COLUMN IF NOT EXISTS evidence_provenance jsonb;
