-- "Not in my family": a household said a name read from a document is not one
-- of its people ("Who is this?" on the Documents page,
-- app/api/policies/link-person with notFamily: true). Re-reading a document
-- rebuilds policy_detected_people, so the answer is kept here, by document and
-- name, and GET /api/policies leaves those names out of detected_people.
-- Linking the same name to a person later deletes the record.
--
-- Additive only: one new table, nothing existing is changed or dropped.
-- Requires sql/schema.sql and sql/household-rls.sql (is_household_member).
-- Code deployed before this file is applied keeps working without it (every
-- reader checks to_regclass first; the page then remembers the answer in the
-- browser only). Rollback: DROP TABLE policy_name_dismissals;
CREATE TABLE IF NOT EXISTS policy_name_dismissals (
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- lower-case, single-spaced, trimmed (lib/policies/name-dismissals.ts nameKeySql)
  name_key text NOT NULL CHECK (length(name_key) BETWEEN 1 AND 200),
  detected_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(policy_id, name_key)
);
CREATE INDEX IF NOT EXISTS idx_policy_name_dismissals_account ON policy_name_dismissals(account_id);

-- Same household-member policies as policy_members (sql/household-rls.sql),
-- in this file so the table is never browser-reachable without them.
ALTER TABLE public.policy_name_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_member_select ON public.policy_name_dismissals;
DROP POLICY IF EXISTS household_member_insert ON public.policy_name_dismissals;
DROP POLICY IF EXISTS household_member_update ON public.policy_name_dismissals;
DROP POLICY IF EXISTS household_member_delete ON public.policy_name_dismissals;
CREATE POLICY household_member_select ON public.policy_name_dismissals FOR SELECT TO authenticated USING (is_household_member(account_id));
-- A row may only name a document of its own household.
CREATE POLICY household_member_insert ON public.policy_name_dismissals FOR INSERT TO authenticated WITH CHECK (is_household_member(account_id)
  AND EXISTS (SELECT 1 FROM public.policies p WHERE p.id = policy_name_dismissals.policy_id AND p.account_id = policy_name_dismissals.account_id));
CREATE POLICY household_member_update ON public.policy_name_dismissals FOR UPDATE TO authenticated USING (is_household_member(account_id)) WITH CHECK (is_household_member(account_id)
  AND EXISTS (SELECT 1 FROM public.policies p WHERE p.id = policy_name_dismissals.policy_id AND p.account_id = policy_name_dismissals.account_id));
CREATE POLICY household_member_delete ON public.policy_name_dismissals FOR DELETE TO authenticated USING (is_household_member(account_id));
REVOKE ALL ON public.policy_name_dismissals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_name_dismissals TO authenticated;
