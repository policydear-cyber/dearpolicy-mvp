-- Household membership schema + Row Level Security for every household-owned
-- table. This file is idempotent (safe to re-run) and environment-aware: it
-- runs unchanged against a real Supabase project (where the `auth` schema,
-- `auth.uid()`, and the `anon`/`authenticated` roles already exist and are
-- backed by real JWTs) and against the disposable PGlite database CI stands
-- up for scripts/rls-regressions.ts (where none of that exists yet), so the
-- exact policies this file installs are what CI actually exercises.
--
-- Why RLS alone is not the whole story here: the application's own server
-- routes currently talk to Postgres through lib/db/client.ts's `pg.Pool`,
-- authenticated as the Supabase `postgres`/`service_role` connection user,
-- which has BYPASSRLS. That means these policies do not yet constrain the
-- app's own hand-written SQL -- they constrain (a) any direct/anon access
-- through Supabase's REST or realtime APIs, (b) any future connection that
-- runs queries as the `authenticated` role with a real request.jwt.claim.sub
-- set (a per-request "SET LOCAL ROLE authenticated; SELECT set_config(...)"
-- pattern that a migrated API layer would need to adopt route-by-route --
-- not yet implemented as an app-level helper in this pass), and (c) they are
-- the fixture this file's own regression suite (scripts/rls-regressions.ts)
-- proves against directly. See the PR description's "Database ownership and
-- RLS" section for the honest status of wiring every route through that
-- context.

-- ---------------------------------------------------------------------------
-- Environment shims: create auth.uid() and the authenticated/anon roles only
-- when they don't already exist (a real Supabase project already has real,
-- JWT-backed versions of all three; a bare PGlite/Postgres does not).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'auth' AND p.proname = 'uid'
  ) THEN
    -- Test/CI stand-in for Supabase's real auth.uid(): reads the same
    -- request.jwt.claim.sub session setting Supabase's Postgres wrapper
    -- populates from a verified JWT, so policies written against auth.uid()
    -- behave identically in both environments.
    CREATE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE
      AS $fn$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Household membership + invitations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS household_members (
  household_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);
CREATE INDEX IF NOT EXISTS household_members_user_id_idx ON household_members(user_id);
CREATE INDEX IF NOT EXISTS household_members_household_id_idx ON household_members(household_id);

CREATE TABLE IF NOT EXISTS household_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  token_hash text NOT NULL,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS household_invitations_token_hash_idx ON household_invitations(token_hash);
CREATE INDEX IF NOT EXISTS household_invitations_household_id_idx ON household_invitations(household_id);
CREATE INDEX IF NOT EXISTS household_invitations_email_idx ON household_invitations(lower(email));
-- A single-use token: once accepted or revoked it can never be reused, and a
-- household can't have two outstanding invitations to the same address.
CREATE UNIQUE INDEX IF NOT EXISTS household_invitations_pending_unique_idx
  ON household_invitations(household_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Helper functions used by every policy below. SECURITY DEFINER so a policy
-- that calls is_household_member() on, say, `policies` doesn't itself need a
-- (recursive) policy granting it read access to household_members.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_household_member(target_household_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM household_members hm
    WHERE hm.household_id = target_household_id AND hm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION is_household_owner(target_household_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM household_members hm
    WHERE hm.household_id = target_household_id AND hm.user_id = auth.uid() AND hm.role = 'owner'
  );
$$;

REVOKE ALL ON FUNCTION is_household_member(uuid) FROM public;
REVOKE ALL ON FUNCTION is_household_owner(uuid) FROM public;
REVOKE ALL ON FUNCTION is_household_member(uuid) FROM anon;
REVOKE ALL ON FUNCTION is_household_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_household_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_household_owner(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- accounts: membership grants read; only the owner may rename/delete the
-- household. Row creation is a service_role-only operation (a signup route
-- must create the accounts row and the owner's household_members row in the
-- same transaction, so half-created households can't exist).
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;
DROP POLICY IF EXISTS accounts_delete ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT TO authenticated USING (is_household_member(id));
CREATE POLICY accounts_update ON accounts FOR UPDATE TO authenticated USING (is_household_owner(id)) WITH CHECK (is_household_owner(id));
CREATE POLICY accounts_delete ON accounts FOR DELETE TO authenticated USING (is_household_owner(id));

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_members_select ON household_members;
DROP POLICY IF EXISTS household_members_insert ON household_members;
DROP POLICY IF EXISTS household_members_update ON household_members;
DROP POLICY IF EXISTS household_members_delete ON household_members;
CREATE POLICY household_members_select ON household_members FOR SELECT TO authenticated USING (is_household_member(household_id));
CREATE POLICY household_members_insert ON household_members FOR INSERT TO authenticated WITH CHECK (is_household_owner(household_id));
CREATE POLICY household_members_update ON household_members FOR UPDATE TO authenticated USING (is_household_owner(household_id)) WITH CHECK (is_household_owner(household_id));
-- An owner can remove anyone; a member may remove only themselves (leave).
CREATE POLICY household_members_delete ON household_members FOR DELETE TO authenticated USING (is_household_owner(household_id) OR user_id = auth.uid());

ALTER TABLE household_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_invitations_select ON household_invitations;
DROP POLICY IF EXISTS household_invitations_insert ON household_invitations;
DROP POLICY IF EXISTS household_invitations_update ON household_invitations;
DROP POLICY IF EXISTS household_invitations_delete ON household_invitations;
CREATE POLICY household_invitations_select ON household_invitations FOR SELECT TO authenticated USING (is_household_owner(household_id));
CREATE POLICY household_invitations_insert ON household_invitations FOR INSERT TO authenticated WITH CHECK (is_household_owner(household_id));
CREATE POLICY household_invitations_update ON household_invitations FOR UPDATE TO authenticated USING (is_household_owner(household_id)) WITH CHECK (is_household_owner(household_id));
CREATE POLICY household_invitations_delete ON household_invitations FOR DELETE TO authenticated USING (is_household_owner(household_id));
-- Acceptance (looking a token up by hash before the invitee has a
-- household_members row yet) is intentionally not exposed to `authenticated`
-- here -- it is a service_role-mediated operation performed by the
-- accept-invitation server route, which validates the token hash, expiry and
-- single-use state itself before creating the membership row.

GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, household_members, household_invitations TO authenticated;

-- ---------------------------------------------------------------------------
-- Every other household-owned table: standard household-member CRUD, scoped
-- by that table's own account_id column (every one of the tables below has a
-- direct, NOT NULL account_id FK -- verified against sql/schema.sql,
-- sql/claim-evidence.sql, sql/claim-composition.sql, sql/critical-illness.sql,
-- sql/disability.sql, sql/cover-conditions.sql, sql/model-usage.sql and
-- sql/coverage-ledger.sql). Tables that don't exist yet in a given
-- environment (e.g. the claim-evidence tables in the live database before
-- that migration has been applied there) are skipped rather than erroring,
-- so this file can run before or after them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  member_tables text[] := ARRAY[
    'family_members', 'policy_members', 'policy_detected_people',
    'policy_pages', 'policy_chunks', 'premium_records',
    -- policies and policy_coverages are NOT here: their scan, processing,
    -- extraction and verification columns are server-owned (see the
    -- dedicated block below and lib/db/table-inventory.ts's
    -- POLICY_STATE_COLUMNS).
    'chat_messages', 'policy_corrections', 'policy_reference_coverages',
    'claim_sessions', 'policy_benefits', 'coverage_rules', 'chat_conversations',
    'policy_cover_conditions',
    -- chat_history_epochs, chat_analysis_jobs, policy_analysis_cache and
    -- model_usage are server-only infrastructure (job/cache state and the
    -- plan spend ledger): see sql/infrastructure-rls.sql.
    'claim_evidence_documents', 'claim_evidence_extractions',
    'claim_cause_definition_matches', 'claim_composition_snapshots',
    'claim_ci_definition_matches', 'claim_disability_definition_matches'
  ];
BEGIN
  FOREACH t IN ARRAY member_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_update ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_delete ON public.%I', t);
    EXECUTE format($f$CREATE POLICY household_member_select ON public.%I FOR SELECT TO authenticated USING (is_household_member(account_id))$f$, t);
    EXECUTE format($f$CREATE POLICY household_member_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (is_household_member(account_id))$f$, t);
    EXECUTE format($f$CREATE POLICY household_member_update ON public.%I FOR UPDATE TO authenticated USING (is_household_member(account_id)) WITH CHECK (is_household_member(account_id))$f$, t);
    EXECUTE format($f$CREATE POLICY household_member_delete ON public.%I FOR DELETE TO authenticated USING (is_household_member(account_id))$f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- A household session may retire (supersede) a policy-definition decision
-- only as part of deleting the evidence document or policy it rests on
-- (lib/lifecycle/coordinator.ts moves that document or policy out of the
-- active state first, in the same transaction). It can never revive a
-- retired decision, and never retire one whose evidence and policy are
-- both still live -- which would otherwise let it hide an unfavourable
-- decision. The trusted server connection is not affected.
CREATE OR REPLACE FUNCTION public.guard_household_decision_retirement() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'a household session may only retire an active policy-definition decision';
  END IF;
  IF EXISTS (SELECT 1 FROM public.claim_evidence_documents d WHERE d.id = OLD.evidence_document_id AND d.lifecycle_state = 'active' AND d.superseded_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.policies p WHERE p.id = OLD.contract_id AND p.lifecycle_state = 'active') THEN
    RAISE EXCEPTION 'a policy-definition decision can only be retired while its evidence document or policy is being deleted';
  END IF;
  RETURN NEW;
END;
$$;

-- Policy-definition decisions (the three *_definition_matches tables) and
-- model-read extractions are written only by the trusted server: a decision
-- by an assigned DearPolicy reviewer (lib/claims/reviewers/boundary.ts), an
-- extraction by the evidence pipeline. A household member's own session may
-- read them, and may retire a decision (superseded_at/superseded_reason
-- only, used when evidence or a policy is deleted), which can only ever
-- remove what an estimate rests on. It can never create, rewrite or delete
-- one -- otherwise a household could record its own "matches" decision, or
-- its own model provenance, directly through the database API.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['claim_cause_definition_matches', 'claim_ci_definition_matches', 'claim_disability_definition_matches'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS household_member_insert ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_delete ON public.%I', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM authenticated', t);
    EXECUTE format('GRANT UPDATE (superseded_at, superseded_reason) ON public.%I TO authenticated', t);
    EXECUTE format('DROP TRIGGER IF EXISTS guard_household_decision_retirement ON public.%I', t);
    EXECUTE format('CREATE TRIGGER guard_household_decision_retirement BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_household_decision_retirement()', t);
  END LOOP;
  -- Model-execution provenance is written only by the server's model
  -- boundary (lib/ai/provenance.ts); no browser session may read or write it.
  IF to_regclass('public.model_executions') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.model_executions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS model_executions_no_client_access ON public.model_executions';
    EXECUTE 'CREATE POLICY model_executions_no_client_access ON public.model_executions FOR ALL TO PUBLIC USING (false) WITH CHECK (false)';
    EXECUTE 'REVOKE ALL ON public.model_executions FROM authenticated, anon';
  END IF;
  IF to_regclass('public.claim_evidence_extractions') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.claim_evidence_extractions';
    EXECUTE 'DROP POLICY IF EXISTS household_member_update ON public.claim_evidence_extractions';
    EXECUTE 'DROP POLICY IF EXISTS household_member_delete ON public.claim_evidence_extractions';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.claim_evidence_extractions FROM authenticated';
  END IF;
END $$;

-- Policy documents and coverages: households own the rows, the server owns
-- the state. Every column that carries malware-scan/quarantine state,
-- processing/indexing state, storage/version identity, supersession,
-- extraction results or verification flags (policies.quarantine_status,
-- processing_status, file_hash, storage_key, personal_coverage_confirmed;
-- policy_coverages.confirmed, evidence_verified, amount, currency, ...) is
-- written only by the trusted server connection (upload route, quarantine
-- gate and scan callback, ingest pipeline, linking). A household session may
-- read its own rows and do exactly one thing: move an ACTIVE policy to
-- pending_deletion inside the lifecycle deletion route
-- (lib/lifecycle/coordinator.ts, RLS-scoped). It can never insert a policy
-- or coverage (so no row can arrive with trusted flags pre-set), update any
-- other column, delete a row, revive a deleted one or skip lifecycle states.
-- lib/db/table-inventory.ts's POLICY_STATE_COLUMNS / BROWSER_WRITABLE_COLUMNS
-- is the authoritative classification; scripts/policy-state-protection-
-- regressions.ts and launch:check enforce it.
-- The household guard trigger functions (and claim-reviewers.sql's
-- append-only trigger) are SECURITY INVOKER and run with an empty, fixed
-- search_path: every object they reference is schema-qualified, and the
-- built-ins they use (current_user, comparisons, integer arithmetic) resolve
-- from pg_catalog regardless. scripts/policy-state-protection-regressions.ts
-- fails if a fixed search_path is removed.
CREATE OR REPLACE FUNCTION public.guard_household_policy_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Browser roles only; the trusted server connection (table owner) is not constrained.
  IF current_user IN ('authenticated', 'anon') AND (
       OLD.lifecycle_state IS DISTINCT FROM 'active'
       OR NEW.lifecycle_state IS DISTINCT FROM 'pending_deletion'
       OR NEW.lifecycle_version IS DISTINCT FROM OLD.lifecycle_version + 1) THEN
    RAISE EXCEPTION 'a household session may only move an active policy to pending deletion'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.policies') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS household_member_select ON public.policies';
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.policies';
    EXECUTE 'DROP POLICY IF EXISTS household_member_update ON public.policies';
    EXECUTE 'DROP POLICY IF EXISTS household_member_delete ON public.policies';
    EXECUTE $f$CREATE POLICY household_member_select ON public.policies FOR SELECT TO authenticated USING (is_household_member(account_id))$f$;
    EXECUTE $f$CREATE POLICY household_member_update ON public.policies FOR UPDATE TO authenticated USING (is_household_member(account_id)) WITH CHECK (is_household_member(account_id))$f$;
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.policies FROM authenticated, anon';
    EXECUTE 'GRANT SELECT ON public.policies TO authenticated';
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'policies' AND column_name = 'lifecycle_state') THEN
      EXECUTE 'GRANT UPDATE (lifecycle_state, lifecycle_version, updated_at) ON public.policies TO authenticated';
      EXECUTE 'DROP TRIGGER IF EXISTS guard_household_policy_update ON public.policies';
      EXECUTE 'CREATE TRIGGER guard_household_policy_update BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.guard_household_policy_update()';
    END IF;
  END IF;
  IF to_regclass('public.policy_coverages') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.policy_coverages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS household_member_select ON public.policy_coverages';
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.policy_coverages';
    EXECUTE 'DROP POLICY IF EXISTS household_member_update ON public.policy_coverages';
    EXECUTE 'DROP POLICY IF EXISTS household_member_delete ON public.policy_coverages';
    EXECUTE $f$CREATE POLICY household_member_select ON public.policy_coverages FOR SELECT TO authenticated USING (is_household_member(account_id))$f$;
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.policy_coverages FROM authenticated, anon';
    EXECUTE 'GRANT SELECT ON public.policy_coverages TO authenticated';
  END IF;
END $$;

-- claim_evidence_audit_log is an append-only audit trail with exactly one
-- writer, the trusted server (lib/claims/evidence/audit.ts's
-- appendClaimEvidenceAudit, on the service connection). Members may read
-- their household's entries but never write one: a browser-inserted row
-- could otherwise forge scan, processing, correction or review history.
DO $$
BEGIN
  IF to_regclass('public.claim_evidence_audit_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.claim_evidence_audit_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS household_member_select ON public.claim_evidence_audit_log';
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.claim_evidence_audit_log';
    EXECUTE $f$CREATE POLICY household_member_select ON public.claim_evidence_audit_log FOR SELECT TO authenticated USING (is_household_member(account_id))$f$;
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_audit_log FROM authenticated, anon';
    EXECUTE 'GRANT SELECT ON public.claim_evidence_audit_log TO authenticated';
  END IF;
END $$;

-- Claim-evidence documents: every column that carries scan, quarantine,
-- processing, extraction, checksum/storage identity, provenance, review,
-- supersession, failure or ownership state is written only by the trusted
-- server (upload route, scan callback, evidence pipeline, reviewer
-- boundary -- all on the service connection). A household session may read
-- its own rows and may do exactly one thing to them: move an ACTIVE
-- document to pending_deletion inside the lifecycle deletion route
-- (lib/lifecycle/coordinator.ts's requestClaimEvidenceDeletion, which runs
-- in the caller's own RLS-scoped transaction). It cannot insert or delete a
-- row, revive a deleted one, skip lifecycle states or touch any other
-- column. The trusted server connection is not affected.
CREATE OR REPLACE FUNCTION public.guard_household_evidence_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_state IS DISTINCT FROM 'active'
     OR NEW.lifecycle_state IS DISTINCT FROM 'pending_deletion'
     OR NEW.lifecycle_version IS DISTINCT FROM OLD.lifecycle_version + 1 THEN
    RAISE EXCEPTION 'a household session may only move an active evidence document to pending deletion'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.claim_evidence_documents') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.claim_evidence_documents';
    EXECUTE 'DROP POLICY IF EXISTS household_member_delete ON public.claim_evidence_documents';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_documents FROM authenticated, anon';
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'claim_evidence_documents' AND column_name = 'lifecycle_state') THEN
      EXECUTE 'GRANT UPDATE (lifecycle_state, lifecycle_version, updated_at) ON public.claim_evidence_documents TO authenticated';
      EXECUTE 'DROP TRIGGER IF EXISTS guard_household_evidence_update ON public.claim_evidence_documents';
      EXECUTE 'CREATE TRIGGER guard_household_evidence_update BEFORE UPDATE ON public.claim_evidence_documents FOR EACH ROW EXECUTE FUNCTION public.guard_household_evidence_update()';
    END IF;
  END IF;
  -- Extractions: no browser write at all (extends the block above to the
  -- anon role and TRUNCATE).
  IF to_regclass('public.claim_evidence_extractions') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.claim_evidence_extractions FROM authenticated, anon';
  END IF;
  -- Scan-callback replay ledger: account-agnostic, written only by the
  -- verified scan callback (lib/scanning/callback-auth.ts). A browser
  -- session must never read it or pre-insert an event id, which would make
  -- the genuine callback look like a replay and leave evidence unscanned.
  IF to_regclass('public.scan_provider_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.scan_provider_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS scan_provider_events_no_client_access ON public.scan_provider_events';
    EXECUTE 'CREATE POLICY scan_provider_events_no_client_access ON public.scan_provider_events FOR ALL TO PUBLIC USING (false) WITH CHECK (false)';
    EXECUTE 'REVOKE ALL ON public.scan_provider_events FROM authenticated, anon';
  END IF;
END $$;

-- policy_document_audit_log is an append-only audit trail for the
-- policy-document quarantine gate, mirroring claim_evidence_audit_log:
-- members may READ their household's entries (lib/household/export.ts's
-- RLS-scoped export reads it), but the only writer is the trusted server
-- (lib/policies/quarantine/audit.ts's appendPolicyDocumentAudit on the
-- service connection, including for deletions recorded by
-- lib/lifecycle/coordinator.ts). A browser session can never insert,
-- rewrite or delete an entry.
DO $$
BEGIN
  IF to_regclass('public.policy_document_audit_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.policy_document_audit_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS household_member_select ON public.policy_document_audit_log';
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.policy_document_audit_log';
    EXECUTE $f$CREATE POLICY household_member_select ON public.policy_document_audit_log FOR SELECT TO authenticated USING (is_household_member(account_id))$f$;
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.policy_document_audit_log FROM authenticated, anon';
    EXECUTE 'GRANT SELECT ON public.policy_document_audit_log TO authenticated';
  END IF;
END $$;

-- No table in this schema is meant to be readable anonymously; the app has
-- no public/unauthenticated pages that read household data.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
