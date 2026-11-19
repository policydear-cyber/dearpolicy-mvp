-- Policies the household says it did not renew (DC 19 Nov 2026: "if the user has decided to lapse the policy, then there
-- should be a button to allow them to select ended or lapse"). Home's "Policy dates" asks for proof of renewal once a
-- policy's printed end date has passed; the household's owner may answer "I didn't renew it" instead.
--
-- This is the household's own statement, never an insurer's fact. It applies to one printed end date of one policy for one
-- person (contract_key, lib/policies/inventory.ts buildContracts): a newer schedule with a later end date, or a renewal
-- receipt after that date, is newer evidence and the policy shows as current again. Deleting the row (Undo) takes it back.
--
-- Additive only: one new table. Requires sql/schema.sql, sql/lifecycle.sql and sql/household-rls.sql (is_household_member).
-- Code deployed before this file is applied keeps working without it: every reader checks
-- to_regclass('public.policy_not_renewed') first, and Home shows no "I didn't renew it" button until it exists.
-- Rollback: DROP TABLE policy_not_renewed; DROP FUNCTION policy_not_renewed_same_household();
--
-- Browser roles may only read their own household's rows. Every write goes through the server
-- (app/api/policies/dates/not-renewed), which allows it to the household's owner only; the trigger refuses a row naming
-- another household's person even so.
CREATE TABLE IF NOT EXISTS policy_not_renewed (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  -- The policy, as lib/policies/inventory.ts keys it: person, insurer and printed policy number (or its document).
  contract_key text NOT NULL CHECK (length(contract_key) BETWEEN 1 AND 400),
  -- The printed end date the household answered about.
  ends_on date NOT NULL,
  said_by uuid,
  said_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, family_member_id, contract_key, ends_on)
);
CREATE INDEX IF NOT EXISTS idx_policy_not_renewed_member ON policy_not_renewed(account_id, family_member_id);

CREATE OR REPLACE FUNCTION policy_not_renewed_same_household() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.family_members f WHERE f.id = NEW.family_member_id AND f.account_id = NEW.account_id) THEN
    RAISE EXCEPTION 'policy_not_renewed person belongs to another household' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS policy_not_renewed_same_household ON policy_not_renewed;
CREATE TRIGGER policy_not_renewed_same_household BEFORE INSERT OR UPDATE ON policy_not_renewed
  FOR EACH ROW EXECUTE FUNCTION policy_not_renewed_same_household();

-- Read by every member of the household; no browser writes.
ALTER TABLE public.policy_not_renewed ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_member_select ON public.policy_not_renewed;
CREATE POLICY household_member_select ON public.policy_not_renewed FOR SELECT TO authenticated USING (is_household_member(account_id));
REVOKE ALL ON public.policy_not_renewed FROM anon, authenticated;
GRANT SELECT ON public.policy_not_renewed TO authenticated;
