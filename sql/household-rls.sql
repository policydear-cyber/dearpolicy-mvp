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
GRANT EXECUTE ON FUNCTION is_household_member(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION is_household_owner(uuid) TO authenticated, anon;

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
    'family_members', 'policies', 'policy_members', 'policy_detected_people',
    'policy_pages', 'policy_chunks', 'policy_coverages', 'premium_records',
    'chat_messages', 'policy_corrections', 'policy_reference_coverages',
    'claim_sessions', 'policy_benefits', 'coverage_rules', 'chat_conversations',
    'chat_history_epochs', 'chat_analysis_jobs', 'policy_analysis_cache',
    'policy_cover_conditions', 'model_usage',
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

-- claim_evidence_audit_log is an append-only audit trail: members may read
-- and insert (the app writes an entry on their behalf), but never update or
-- delete a past entry -- only a service_role job (which bypasses RLS
-- entirely) may do that, e.g. as part of an explicit retention policy.
DO $$
BEGIN
  IF to_regclass('public.claim_evidence_audit_log') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.claim_evidence_audit_log ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS household_member_select ON public.claim_evidence_audit_log';
    EXECUTE 'DROP POLICY IF EXISTS household_member_insert ON public.claim_evidence_audit_log';
    EXECUTE $f$CREATE POLICY household_member_select ON public.claim_evidence_audit_log FOR SELECT TO authenticated USING (is_household_member(account_id))$f$;
    EXECUTE $f$CREATE POLICY household_member_insert ON public.claim_evidence_audit_log FOR INSERT TO authenticated WITH CHECK (is_household_member(account_id))$f$;
    EXECUTE 'GRANT SELECT, INSERT ON public.claim_evidence_audit_log TO authenticated';
  END IF;
END $$;

-- No table in this schema is meant to be readable anonymously; the app has
-- no public/unauthenticated pages that read household data.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
