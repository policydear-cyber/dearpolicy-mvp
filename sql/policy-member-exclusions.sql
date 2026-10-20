-- Remembered removals: a household said this document does NOT cover this
-- person ("Who does this document cover?", app/api/policies/link-person).
-- Re-reading a document rebuilds its automatic links (a printed name, the
-- upload profile, matching wording); without this record a person the
-- household removed came back after every re-read. Every automatic link
-- writer skips a pair recorded here (lib/policies/member-exclusions.ts);
-- ticking the person again deletes the record.
--
-- Additive only: one new table, nothing existing is changed or dropped.
-- Requires sql/schema.sql and sql/household-rls.sql (is_household_member).
-- Code deployed before this file is applied keeps working without it (every
-- reader checks to_regclass first). Rollback: DROP TABLE policy_member_exclusions;
-- (removals made since are then forgotten, as before this file).
CREATE TABLE IF NOT EXISTS policy_member_exclusions (
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(policy_id, family_member_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_member_exclusions_account ON policy_member_exclusions(account_id);
CREATE INDEX IF NOT EXISTS idx_policy_member_exclusions_member ON policy_member_exclusions(family_member_id);

-- Same household-member policies as policy_members (sql/household-rls.sql),
-- in this file so the table is never browser-reachable without them.
ALTER TABLE public.policy_member_exclusions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_member_select ON public.policy_member_exclusions;
DROP POLICY IF EXISTS household_member_insert ON public.policy_member_exclusions;
DROP POLICY IF EXISTS household_member_update ON public.policy_member_exclusions;
DROP POLICY IF EXISTS household_member_delete ON public.policy_member_exclusions;
CREATE POLICY household_member_select ON public.policy_member_exclusions FOR SELECT TO authenticated USING (is_household_member(account_id));
-- A row may only name a document and a person of its own household.
CREATE POLICY household_member_insert ON public.policy_member_exclusions FOR INSERT TO authenticated WITH CHECK (is_household_member(account_id)
  AND EXISTS (SELECT 1 FROM public.policies p WHERE p.id = policy_member_exclusions.policy_id AND p.account_id = policy_member_exclusions.account_id)
  AND EXISTS (SELECT 1 FROM public.family_members f WHERE f.id = policy_member_exclusions.family_member_id AND f.account_id = policy_member_exclusions.account_id));
CREATE POLICY household_member_update ON public.policy_member_exclusions FOR UPDATE TO authenticated USING (is_household_member(account_id)) WITH CHECK (is_household_member(account_id)
  AND EXISTS (SELECT 1 FROM public.policies p WHERE p.id = policy_member_exclusions.policy_id AND p.account_id = policy_member_exclusions.account_id)
  AND EXISTS (SELECT 1 FROM public.family_members f WHERE f.id = policy_member_exclusions.family_member_id AND f.account_id = policy_member_exclusions.account_id));
CREATE POLICY household_member_delete ON public.policy_member_exclusions FOR DELETE TO authenticated USING (is_household_member(account_id));
REVOKE ALL ON public.policy_member_exclusions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.policy_member_exclusions TO authenticated;
