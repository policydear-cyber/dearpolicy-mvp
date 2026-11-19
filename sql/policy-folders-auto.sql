-- Policy folders made for the household (DC, 19 Nov 2026: "Make them all automatically"). Every schedule or certificate
-- on file that is in no folder becomes a folder of its own, for the people it is linked to, with any of the household's
-- documents that print the same policy number (lib/policies/folder-view.ts policyStarters). This table records each
-- document that has had its folder made, or was taken out of a folder or had its folder deleted, so a folder the household
-- deletes is never made again.
--
-- Additive only: one new table, nothing existing is changed. Requires sql/policy-folders.sql. Code deployed before this
-- file is applied keeps working without it: no folder is made for the household until it exists (autoFoldersReady()).
-- Rollback: DROP TABLE policy_folder_auto; DROP FUNCTION policy_folder_auto_same_household();
CREATE TABLE IF NOT EXISTS policy_folder_auto (
  policy_id uuid PRIMARY KEY REFERENCES policies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_folder_auto_account ON policy_folder_auto(account_id);

-- The document must be its own household's.
CREATE OR REPLACE FUNCTION policy_folder_auto_same_household() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.policies p WHERE p.id = NEW.policy_id AND p.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'policy folder record belongs to another household' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS policy_folder_auto_same_household ON policy_folder_auto;
CREATE TRIGGER policy_folder_auto_same_household BEFORE INSERT OR UPDATE ON policy_folder_auto
  FOR EACH ROW EXECUTE FUNCTION policy_folder_auto_same_household();

-- Read by every member of the household; no browser writes.
ALTER TABLE public.policy_folder_auto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_member_select ON public.policy_folder_auto;
CREATE POLICY household_member_select ON public.policy_folder_auto FOR SELECT TO authenticated USING (is_household_member(account_id));
REVOKE ALL ON public.policy_folder_auto FROM anon, authenticated;
GRANT SELECT ON public.policy_folder_auto TO authenticated;
