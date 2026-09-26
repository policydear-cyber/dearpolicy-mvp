-- Infrastructure tables: no browser role may touch them.
--
-- On Supabase every table created in `public` is granted to `anon` and
-- `authenticated` by default privileges, and a table without RLS is then
-- readable and writable by any signed-in user through the Data API. The
-- tables below hold durable jobs and dead letters, deletion requests and
-- their audit trail, rate-limit counters, household export records, storage
-- cleanup locks and audit, model provenance and the plan spend ledger,
-- the scan-callback replay ledger, chat job/cache state and the reviewer
-- registry. They are written and read only by the trusted server connection
-- (the table owner, which non-forced RLS does not apply to) -- workers,
-- route handlers after their own authorization, and the operator CLI.
-- lib/db/table-inventory.ts is the authoritative list; keep both in step
-- (scripts/infrastructure-table-permissions-regressions.ts and
-- `npm run launch:check` fail if they drift).
--
-- For each table that exists: enable RLS; drop every policy except a single
-- always-false one (so no permissive policy can restore access); revoke all
-- table privileges and the privileges on its sequences from anon,
-- authenticated and PUBLIC. RLS is deliberately NOT forced: the server
-- connection relies on owner bypass, and forcing would make correctness
-- depend on the production role having BYPASSRLS, which is not a documented
-- property of this deployment. The Supabase `service_role` is left as
-- Supabase manages it.
--
-- Also hardens the SECURITY DEFINER helpers: fixed search_path (already set
-- in their definitions) and EXECUTE only for `authenticated` (the RLS
-- policies that call them are all TO authenticated; anon has no use for
-- them).
--
-- Idempotent. Apply after sql/household-rls.sql (and re-apply whenever
-- household-rls.sql is re-applied). See docs/migration-runbook.md.
DO $$
DECLARE
  t text;
  p record;
  c record;
  seq text;
  infra text[] := ARRAY[
    'background_jobs', 'background_job_audit_log',
    'chat_analysis_jobs', 'chat_history_epochs', 'policy_analysis_cache',
    'deletion_requests', 'deletion_audit_log',
    'rate_limit_buckets',
    'household_exports', 'household_export_audit_log',
    'storage_cleanup_locks', 'storage_cleanup_audit_log',
    'model_executions', 'model_usage',
    'scan_provider_events', 'processing_failure_diagnostics',
    'claim_reviewers', 'claim_review_assignments', 'claim_reviewer_audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY infra LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname <> t || '_no_client_access' LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_no_client_access', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO PUBLIC USING (false) WITH CHECK (false)', t || '_no_client_access', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM authenticated', t);
    END IF;
    FOR c IN SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t LOOP
      seq := pg_get_serial_sequence(format('public.%I', t), c.column_name);
      IF seq IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC', seq);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon', seq);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM authenticated', seq);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- SECURITY DEFINER helpers used by RLS policies.
  IF to_regprocedure('public.is_household_member(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.is_household_member(uuid) FROM anon;
    END IF;
  END IF;
  IF to_regprocedure('public.is_household_owner(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.is_household_owner(uuid) FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.is_household_owner(uuid) FROM anon;
    END IF;
  END IF;
  IF to_regprocedure('public.is_household_storage_object(text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.is_household_storage_object(text) FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON FUNCTION public.is_household_storage_object(text) FROM anon;
    END IF;
  END IF;
END $$;
