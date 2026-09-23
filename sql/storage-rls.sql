-- Row Level Security for Supabase Storage objects, scoping every read/write
-- against the two private buckets this app uses (policy-files,
-- claim-evidence-files) to the household whose id is encoded as the first
-- path segment of the object's own key -- see lib/storage/supabase.ts's
-- objectKey()/claimEvidenceObjectKey(): every object this app ever writes
-- is named "<accountId>/<...>/<filename>".
--
-- ## Why this exists even though the app never queries storage as
-- `authenticated` today
--
-- lib/storage/supabase.ts's client() always authenticates with
-- SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely. Supabase already
-- enables RLS on storage.objects/storage.buckets by default with zero
-- policies installed, so -- even without this file -- `authenticated`/`anon`
-- can already read and write nothing there today: storage access is
-- fail-closed by default, not fail-open. This file is the same
-- defense-in-depth already established for the Postgres tables in
-- sql/household-rls.sql: if a future feature ever queries storage directly
-- with a user's own (non-service-role) session -- a direct client-side
-- upload, a realtime storage subscription, anything -- these policies are
-- what makes that request behave like an RLS-scoped Postgres query already
-- does, rather than seeing nothing at all just because nobody wrote a
-- policy yet. It also documents, in one place, exactly what "storage
-- ownership matches database ownership" is supposed to mean for this app --
-- see scripts/storage-rls-regressions.ts for the regression suite that
-- proves it (against a local stand-in schema; PGlite has no real Supabase
-- Storage extension to load storage.objects/storage.buckets from, so that
-- script creates a reduced stub matching just the columns this file reads,
-- clearly marked as test-only -- see its own header comment).
--
-- ## Buckets must be created (and kept) private
--
-- This file only writes RLS policies -- it does not, and cannot reliably,
-- create the buckets themselves (Supabase Storage bucket creation goes
-- through its own Management API/dashboard in most project configurations,
-- not a plain SQL INSERT). Both buckets -- whatever their actually
-- configured names are (see SUPABASE_STORAGE_BUCKET /
-- SUPABASE_CLAIM_EVIDENCE_BUCKET; 'policy-files' / 'claim-evidence-files'
-- are this app's defaults, matched below -- update both this file and the
-- env vars together if either default ever changes) -- MUST be created
-- with "Public bucket" left OFF. A public bucket serves every object over a
-- predictable, unauthenticated URL, which would make every policy below
-- moot regardless of how correct they are. The idempotent UPDATE at the
-- bottom of this file is a safety net, not a substitute for creating them
-- private in the first place: it forces `public` back to false on every
-- re-run of this file, in case someone toggles it on by mistake later, but
-- does nothing at all if the bucket row doesn't exist yet.
--
-- Idempotent (safe to re-run against a real Supabase project). Depends on
-- is_household_member() from sql/household-rls.sql -- run that file first;
-- this one raises a clear error rather than silently installing broken
-- policies if it hasn't been.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_household_member'
  ) THEN
    RAISE EXCEPTION 'is_household_member() is not defined -- run sql/household-rls.sql before sql/storage-rls.sql.';
  END IF;
END $$;

-- The first '/'-delimited segment of an object's key is always the
-- household id this app wrote it under. A malformed or missing segment
-- (never expected from this app's own code, but never trusted either) must
-- deny access, not error the whole query out for every other row -- the
-- cast is guarded exactly the way app code already guards a path-segment
-- uuid cast (see lib/db/client.ts's isUuid() and its callers).
CREATE OR REPLACE FUNCTION is_household_storage_object(object_name text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  segment text := split_part(object_name, '/', 1);
  household uuid;
BEGIN
  IF segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN false;
  END IF;
  household := segment::uuid;
  RETURN is_household_member(household);
END;
$$;

REVOKE ALL ON FUNCTION is_household_storage_object(text) FROM public;
GRANT EXECUTE ON FUNCTION is_household_storage_object(text) TO authenticated, anon;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_storage_objects_select ON storage.objects;
DROP POLICY IF EXISTS household_storage_objects_insert ON storage.objects;
DROP POLICY IF EXISTS household_storage_objects_update ON storage.objects;
DROP POLICY IF EXISTS household_storage_objects_delete ON storage.objects;

CREATE POLICY household_storage_objects_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id IN ('policy-files', 'claim-evidence-files') AND is_household_storage_object(name));

CREATE POLICY household_storage_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('policy-files', 'claim-evidence-files') AND is_household_storage_object(name));

CREATE POLICY household_storage_objects_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id IN ('policy-files', 'claim-evidence-files') AND is_household_storage_object(name))
  WITH CHECK (bucket_id IN ('policy-files', 'claim-evidence-files') AND is_household_storage_object(name));

CREATE POLICY household_storage_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id IN ('policy-files', 'claim-evidence-files') AND is_household_storage_object(name));

-- Letting `authenticated` see the bucket ROW (id/name/public flag) for just
-- these two buckets is harmless and lets a future direct-upload client
-- resolve the bucket without needing the service role; it does not itself
-- grant access to any object inside it -- storage.objects' own policies
-- above are what actually gate that.
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_storage_buckets_select ON storage.buckets;
CREATE POLICY household_storage_buckets_select ON storage.buckets
  FOR SELECT TO authenticated
  USING (id IN ('policy-files', 'claim-evidence-files'));

-- Safety net, not a substitute for creating the buckets private from the
-- start (see this file's own doc comment above) -- a no-op if the bucket
-- row doesn't exist yet.
UPDATE storage.buckets SET public = false WHERE id IN ('policy-files', 'claim-evidence-files') AND public IS DISTINCT FROM false;
