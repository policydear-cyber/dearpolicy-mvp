CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  relationship text NOT NULL,
  date_of_birth date,
  preferred_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE family_members ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS preferred_name text;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  insurer text,
  product_name text,
  policy_number text,
  policy_type text,
  document_role text,
  personal_coverage_confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  processing_status text NOT NULL DEFAULT 'uploaded',
  original_filename text NOT NULL,
  storage_key text NOT NULL,
  page_count integer,
  extracted_json jsonb,
  processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_role text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS personal_coverage_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS processing_stage text NOT NULL DEFAULT 'uploaded';
ALTER TABLE policies ADD COLUMN IF NOT EXISTS processing_progress integer NOT NULL DEFAULT 0;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS processing_message text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS policy_members (
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'upload',
  confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(policy_id, family_member_id)
);

CREATE TABLE IF NOT EXISTS policy_detected_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  detected_name text NOT NULL,
  matched_family_member_id uuid REFERENCES family_members(id) ON DELETE SET NULL,
  confidence numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(policy_id, detected_name)
);

CREATE TABLE IF NOT EXISTS policy_pages (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  text text NOT NULL,
  UNIQUE(policy_id, page_number)
);

CREATE TABLE IF NOT EXISTS policy_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  page_start integer NOT NULL,
  page_end integer NOT NULL,
  heading text,
  text text NOT NULL,
  embedding vector(1024),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  category text NOT NULL,
  amount numeric,
  currency text,
  notes text,
  source_page integer,
  authority text NOT NULL DEFAULT 'personal_document',
  confirmed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS premium_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES policies(id) ON DELETE SET NULL,
  family_member_id uuid REFERENCES family_members(id) ON DELETE SET NULL,
  insurer text,
  product_name text,
  policy_number text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'SGD',
  frequency text,
  payment_date date,
  period_start date,
  period_end date,
  source_document_id uuid REFERENCES policies(id) ON DELETE SET NULL,
  source_page integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES family_members(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  citations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  ai_value jsonb,
  corrected_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_members_account ON family_members(account_id);
CREATE INDEX IF NOT EXISTS idx_policies_account_member ON policies(account_id, family_member_id);
CREATE INDEX IF NOT EXISTS idx_policy_members_account_member ON policy_members(account_id, family_member_id);
CREATE INDEX IF NOT EXISTS idx_detected_people_policy ON policy_detected_people(policy_id);
CREATE INDEX IF NOT EXISTS idx_chunks_account_member ON policy_chunks(account_id, family_member_id);
CREATE INDEX IF NOT EXISTS idx_chunks_policy ON policy_chunks(policy_id);
CREATE INDEX IF NOT EXISTS idx_coverages_member ON policy_coverages(account_id, family_member_id);
CREATE INDEX IF NOT EXISTS idx_premium_member ON premium_records(account_id, family_member_id);
CREATE INDEX IF NOT EXISTS idx_premium_policy ON premium_records(policy_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON policy_chunks USING hnsw (embedding vector_cosine_ops);

-- Single-column FK indexes: the composite indexes above lead with account_id
-- (or policy_id), so a query/constraint check that filters or joins purely on
-- one of these other foreign-key columns still had no covering index
-- (flagged by Supabase's performance advisor). Mirrors the migration applied
-- directly to the hosted Supabase project. (A few more of these land later in
-- this file, and in chat-upgrade.sql / coverage-ledger.sql, next to the
-- tables/columns they depend on, which are created after this point.)
CREATE INDEX IF NOT EXISTS idx_chat_messages_family_member_id ON chat_messages(family_member_id);
CREATE INDEX IF NOT EXISTS idx_policies_family_member_id ON policies(family_member_id);
CREATE INDEX IF NOT EXISTS idx_policy_chunks_family_member_id ON policy_chunks(family_member_id);
CREATE INDEX IF NOT EXISTS idx_policy_corrections_account_id ON policy_corrections(account_id);
CREATE INDEX IF NOT EXISTS idx_policy_corrections_policy_id ON policy_corrections(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_coverages_family_member_id ON policy_coverages(family_member_id);
CREATE INDEX IF NOT EXISTS idx_policy_coverages_policy_id ON policy_coverages(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_detected_people_account_id ON policy_detected_people(account_id);
CREATE INDEX IF NOT EXISTS idx_policy_detected_people_matched_family_member_id ON policy_detected_people(matched_family_member_id);
CREATE INDEX IF NOT EXISTS idx_policy_members_family_member_id ON policy_members(family_member_id);
CREATE INDEX IF NOT EXISTS idx_premium_records_family_member_id ON premium_records(family_member_id);
CREATE INDEX IF NOT EXISTS idx_premium_records_source_document_id ON premium_records(source_document_id);


-- Backfill the new many-to-many link for documents uploaded with older DearPolicy builds.
INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence)
SELECT id,family_member_id,account_id,'legacy_upload',0.70 FROM policies
ON CONFLICT(policy_id,family_member_id) DO NOTHING;

-- Accuracy / document-intelligence upgrade
ALTER TABLE policies ADD COLUMN IF NOT EXISTS group_policy_number text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_authority integer NOT NULL DEFAULT 30;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_authority_label text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS review_reason text;

ALTER TABLE policy_coverages ADD COLUMN IF NOT EXISTS evidence_text text;
ALTER TABLE policy_coverages ADD COLUMN IF NOT EXISTS evidence_verified boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS policy_reference_coverages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  category text NOT NULL,
  product_name text,
  notes text,
  source_page integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reference_coverages_policy ON policy_reference_coverages(account_id,policy_id);
CREATE INDEX IF NOT EXISTS idx_policies_group_policy ON policies(account_id,group_policy_number);
ALTER TABLE policies ADD COLUMN IF NOT EXISTS file_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_account_file_hash ON policies(account_id,file_hash) WHERE file_hash IS NOT NULL;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS effective_date date;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS renewal_or_expiry_date date;

-- Currency normalization / crash-safety backfill.
-- Older AI extractions may have stored display symbols that Intl.NumberFormat
-- rejects as currency codes (for example S$). Keep persisted data canonical.
UPDATE policy_coverages SET currency='SGD' WHERE currency IS NULL OR btrim(currency)='' OR upper(replace(currency,' ','')) IN ('S$','SG$','$S','$');
UPDATE premium_records SET currency='SGD' WHERE currency IS NULL OR btrim(currency)='' OR upper(replace(currency,' ','')) IN ('S$','SG$','$S','$');
UPDATE policy_coverages SET currency='USD' WHERE upper(replace(currency,' ','')) IN ('US$','USD$');
UPDATE premium_records SET currency='USD' WHERE upper(replace(currency,' ','')) IN ('US$','USD$');
UPDATE policy_coverages SET currency='MYR' WHERE upper(replace(currency,' ',''))='RM';
UPDATE premium_records SET currency='MYR' WHERE upper(replace(currency,' ',''))='RM';
UPDATE policy_coverages SET currency='PHP' WHERE replace(currency,' ','')='₱';
UPDATE premium_records SET currency='PHP' WHERE replace(currency,' ','')='₱';

-- Trust / claims upgrade
ALTER TABLE policy_coverages ADD COLUMN IF NOT EXISTS product_name text;
UPDATE policy_coverages SET product_name = CASE
  WHEN category='Death' THEN 'Group Term Life'
  WHEN category='Total Permanent Disability' THEN 'Group Term Life'
  WHEN category='Personal Accident' THEN 'Group Personal Accident'
  WHEN category='Critical Illness' THEN 'Living Care'
  WHEN category='Early Critical Illness' THEN 'Living Care Plus'
  WHEN category='Disability Income' THEN 'Disability Income'
  WHEN category='Outpatient' THEN 'Outpatient Medicare'
  ELSE product_name END
WHERE product_name IS NULL;
-- Backfill two bundled Group Term Life benefits for the MINDEF & MHA reference set.
-- These rows do not create ownership; they are only usable when Group Term Life
-- is already proven by a personal certificate/schedule.
INSERT INTO policy_reference_coverages(account_id,policy_id,category,product_name,notes,source_page)
SELECT p.account_id,p.id,'Total Permanent Disability','Group Term Life','Included benefit of Group Term Life; personal ownership must be proven separately.',NULL
FROM policies p
WHERE p.group_policy_number='G007500' AND p.document_role IN ('product_summary','benefit_guide','policy_wording')
  AND NOT EXISTS (SELECT 1 FROM policy_reference_coverages r WHERE r.policy_id=p.id AND r.category='Total Permanent Disability' AND lower(coalesce(r.product_name,''))='group term life');

INSERT INTO policy_reference_coverages(account_id,policy_id,category,product_name,notes,source_page)
SELECT p.account_id,p.id,'Hospital Cash','Group Term Life','Daily Hospital Cash is an included Group Term Life benefit; personal ownership must be proven separately.',NULL
FROM policies p
WHERE p.group_policy_number='G007500' AND p.document_role IN ('product_summary','benefit_guide','policy_wording')
  AND NOT EXISTS (SELECT 1 FROM policy_reference_coverages r WHERE r.policy_id=p.id AND r.category='Hospital Cash' AND lower(coalesce(r.product_name,''))='group term life');

-- Guided claim sessions / anti-hallucination workflow
CREATE TABLE IF NOT EXISTS claim_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'fact_finding',
  event_type text,
  event_summary text,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_question jsonb,
  decision_packet jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_claim_sessions_member ON claim_sessions(account_id,family_member_id,updated_at DESC);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS claim_session_id uuid REFERENCES claim_sessions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS policy_benefits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  product_name text,
  benefit_name text NOT NULL,
  traits text[] NOT NULL DEFAULT '{}',
  formula_kind text NOT NULL DEFAULT 'none',
  formula_value numeric,
  currency text,
  fact_key text,
  offset_days integer,
  maximum_days integer,
  source_page integer,
  quote text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs_review boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- A rule a person corrected after reading their own policy. Human review
-- outranks extraction, so a reviewed row survives re-indexing.
ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
-- True when the payout rule came from a heading above the row rather than from
-- the row itself. Weaker evidence, so it is shown to a person before it is ever
-- turned into money.
ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS basis_inferred boolean NOT NULL DEFAULT false;
-- Traits an event MUST have for this benefit to respond at all. An
-- accident-only benefit must never be offered for dengue.
ALTER TABLE policy_benefits ADD COLUMN IF NOT EXISTS requires text[] NOT NULL DEFAULT '{}';
-- When this document's benefit rules were last read. A document that yields no
-- rules has still been read; without this it would ask to be read forever.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS benefits_indexed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_policy_benefits_policy ON policy_benefits(account_id, policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_benefits_traits ON policy_benefits USING gin(traits);
-- One row per model call, hosted or local, so a household's cost is a sum,
-- not a guess. Additive and idempotent.
CREATE TABLE IF NOT EXISTS model_usage (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  role text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cached_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  priced boolean NOT NULL DEFAULT true,
  duration_ms integer,
  ok boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_model_usage_month ON model_usage(account_id, at);

-- Remaining single-column FK indexes: these depend on tables/columns created
-- later in this file (claim_sessions and the claim_session_id column it's
-- referenced by, and policy_reference_coverages).
CREATE INDEX IF NOT EXISTS idx_claim_sessions_family_member_id ON claim_sessions(family_member_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_claim_session_id ON chat_messages(claim_session_id);
CREATE INDEX IF NOT EXISTS idx_policy_reference_coverages_policy_id ON policy_reference_coverages(policy_id);

-- Policy-document quarantine gate (checkpoint 3, claude/v1-launch-hardening).
-- A separate, dedicated state machine layered IN FRONT OF the existing
-- processing_status column above (uploaded -> extracting -> indexing ->
-- ready|failed, see lib/rag/ingest.ts's processPolicy()): nothing may move
-- processing_status past 'uploaded'/'queued' until quarantine_status is
-- 'scan_clean' (see lib/policies/quarantine/store.ts's
-- runPolicyQuarantineGate(), the single choke point processPolicy() calls
-- at its own entry point). This deliberately reuses the EXISTING
-- processing_status values for "processing"/"processed"/"failed" (the
-- checkpoint's naming-convention instruction) rather than inventing a
-- second copy of them here -- this column's job is only the gate itself:
--   uploaded -> quarantined -> scan_pending -> scan_clean | scan_rejected
-- scan_pending is a stable resting state (mirrors claim_evidence_documents'
-- "quarantined" -- see sql/claim-evidence.sql): a scan_unavailable, still-
-- pending, timed-out, missing or malformed verdict leaves a document here
-- indefinitely, never silently promoted to scan_clean. `deleted` is
-- reachable from every other state and is terminal.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS quarantine_status text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS scan_provider text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS scan_result_detail text;
-- Reserved for a future real async scan-provider callback (checkpoint 4)
-- to key its idempotency/replay checks on; unused by the synchronous null
-- adapter today, exactly like claim_evidence_documents has no equivalent
-- column yet either.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS scan_event_id text;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS scanned_at timestamptz;
-- A re-upload of a corrected/updated document creates a NEW policies row
-- and points back at the one it replaces, mirroring
-- claim_evidence_documents' supersedes_id/superseded_at exactly (see that
-- table's own comment in sql/claim-evidence.sql) -- the old row's audit
-- history, coverages and any downstream evidence match stay inspectable
-- rather than being mutated in place.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES policies(id) ON DELETE SET NULL;
ALTER TABLE policies ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- Backfill: a document already at processing_status='ready' predates this
-- gate and was already fully processed and served before it existed --
-- grandfathered as scan_clean rather than stranding it in permanent
-- quarantine on migration (there is no real bytes-on-disk retroactive scan
-- to run here). Everything else defaults to 'uploaded', the true starting
-- point of the gate for a document that has not been through it yet. This
-- UPDATE is idempotent: it only ever touches rows where quarantine_status
-- is still NULL, so re-running this file is a no-op on a database that has
-- already been migrated once.
UPDATE policies SET quarantine_status = 'scan_clean' WHERE quarantine_status IS NULL AND processing_status = 'ready';
UPDATE policies SET quarantine_status = 'uploaded' WHERE quarantine_status IS NULL;
ALTER TABLE policies ALTER COLUMN quarantine_status SET DEFAULT 'uploaded';
ALTER TABLE policies ALTER COLUMN quarantine_status SET NOT NULL;

ALTER TABLE policies DROP CONSTRAINT IF EXISTS policies_quarantine_status_check;
ALTER TABLE policies ADD CONSTRAINT policies_quarantine_status_check
  CHECK (quarantine_status IN ('uploaded','quarantined','scan_pending','scan_clean','scan_rejected','deleted'));

-- Re-scoped to exclude superseded rows so a re-upload of byte-identical
-- content as a new VERSION (supersedes_id pointing at the old row,
-- marked superseded_at once the new row is inserted) is never blocked by
-- the old row's own hash -- mirrors claim_evidence_documents' own dedupe
-- index exactly (idx_claim_evidence_documents_dedupe in
-- sql/claim-evidence.sql).
DROP INDEX IF EXISTS idx_policies_account_file_hash;
CREATE UNIQUE INDEX IF NOT EXISTS idx_policies_account_file_hash ON policies(account_id,file_hash) WHERE file_hash IS NOT NULL AND superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_policies_quarantine_status ON policies(account_id, quarantine_status);
CREATE INDEX IF NOT EXISTS idx_policies_supersedes ON policies(supersedes_id);

-- Append-only audit trail for the policy-document quarantine gate, mirroring
-- claim_evidence_audit_log exactly (see sql/claim-evidence.sql's own
-- comment). Application code only ever INSERTs here -- see
-- lib/policies/quarantine/audit.ts, the one place allowed to write to this
-- table -- and never UPDATEs or DELETEs a row.
CREATE TABLE IF NOT EXISTS policy_document_audit_log (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor text NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  previous_value jsonb,
  new_value jsonb,
  policy_id uuid REFERENCES policies(id) ON DELETE SET NULL,
  reason text,
  reason_code text
);
CREATE INDEX IF NOT EXISTS idx_policy_document_audit_policy ON policy_document_audit_log(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_document_audit_account ON policy_document_audit_log(account_id, occurred_at DESC);

-- Scan-provider callback replay protection (checkpoint 4,
-- claude/v1-launch-hardening). Insert-only: a provider's (provider,
-- event_id) pair may be recorded exactly once, ever, regardless of which
-- document it was for or what verdict it carried -- lib/scanning/
-- callback-auth.ts inserts a row here BEFORE looking up or mutating any
-- document, so a replayed or duplicated callback (a MITM replay, a
-- provider's own at-least-once retry) is rejected at this layer even
-- before the document-level CAS in lib/policies/quarantine/store.ts's
-- recordPolicyScanResult() gets a chance to run. Deliberately holds no
-- document/account reference and no payload -- only enough to detect a
-- repeat, so it carries none of the privacy weight a full callback log
-- would.
CREATE TABLE IF NOT EXISTS scan_provider_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_scan_provider_events_received ON scan_provider_events(received_at);
