-- The benefit table (lib/benefit-table): each document read once, and what the household confirmed or corrected.
-- Each person's table is assembled on request from these rows (lib/benefit-table/assemble.ts); no copy of it is stored,
-- so nothing here can go stale against the documents.
--
--   benefit_readings       one row per document: the model's reading as returned (the server re-checks it against the
--                          stored pages every time it is used), with the model and prompt version that made it.
--   benefit_links          which cover a benefit section is paid under: proposed by the model or set by the household.
--                          A household's choice is never replaced by a re-read or a re-link.
--   benefit_confirmations  a person's headline amount the household confirmed, or corrected to the figure they gave.
--
-- Additive only: three new tables, nothing existing is changed or dropped. Requires sql/schema.sql and
-- sql/household-rls.sql (is_household_member). Code deployed before this file is applied keeps working without it: every
-- reader checks to_regclass first and the Coverage page shows the existing view.
-- Rollback: DROP TABLE benefit_confirmations, benefit_links, benefit_readings;
CREATE TABLE IF NOT EXISTS benefit_readings (
  policy_id uuid PRIMARY KEY REFERENCES policies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reading jsonb NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_benefit_readings_account ON benefit_readings(account_id);

CREATE TABLE IF NOT EXISTS benefit_links (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  cover_key text,
  why text NOT NULL DEFAULT '',
  chosen_by text NOT NULL CHECK (chosen_by IN ('model','household')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, section_key)
);

CREATE TABLE IF NOT EXISTS benefit_confirmations (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  cover_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('confirmed','corrected')),
  sum_insured numeric CHECK (sum_insured IS NULL OR sum_insured >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, family_member_id, cover_key)
);

-- Household members may read their own rows from a browser, never write them: every write goes through the server
-- routes, which check the reading against the stored pages, the link against the household's own sections and covers,
-- and the confirmation against a cover the person holds (lib/benefit-table/service.ts). The server uses the service
-- connection, so it needs no grant here.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['benefit_readings','benefit_links','benefit_confirmations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_select ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS household_member_write ON public.%I', t);
    EXECUTE format('CREATE POLICY household_member_select ON public.%I FOR SELECT TO authenticated USING (is_household_member(account_id))', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
  END LOOP;
END $$;
