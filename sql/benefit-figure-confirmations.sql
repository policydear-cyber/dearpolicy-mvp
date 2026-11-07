-- The figure guards (lib/benefit-table/guards.ts): a figure five readers could not agree on after three re-reads is
-- given by the household, and what they give is final (DC, 6 Nov 2026). One row per figure: the document, the figure's
-- key (claimsOf: where the figure is printed, never the figure itself) and the household's value. No re-read, check or
-- code change writes here; only the household, through POST /api/benefit-table/figure.
--
-- Additive only: one new table, nothing existing is changed or dropped. Requires sql/benefit-table.sql. Code deployed
-- before this file is applied keeps working without it (every reader checks to_regclass first; the household is then not
-- offered the confirm step). Unused while DEARPOLICY_FIGURE_GUARDS is off.
-- Rollback: DROP TABLE benefit_figure_confirmations;
CREATE TABLE IF NOT EXISTS benefit_figure_confirmations (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  claim_key text NOT NULL,
  value numeric NOT NULL CHECK (value > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, policy_id, claim_key)
);

-- Household members may read their own rows from a browser, never write them: every write goes through the server route,
-- which checks the figure is one the document's current reading uses (lib/benefit-table/service.ts).
ALTER TABLE public.benefit_figure_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS household_member_select ON public.benefit_figure_confirmations;
DROP POLICY IF EXISTS household_member_write ON public.benefit_figure_confirmations;
CREATE POLICY household_member_select ON public.benefit_figure_confirmations FOR SELECT TO authenticated USING (is_household_member(account_id));
REVOKE ALL ON public.benefit_figure_confirmations FROM anon, authenticated;
GRANT SELECT ON public.benefit_figure_confirmations TO authenticated;
