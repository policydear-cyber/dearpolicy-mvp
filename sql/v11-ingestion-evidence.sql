-- DearPolicy V1.1: evidence for every stored fact, and the reading cache.
-- Additive and repeatable: new nullable columns only; nothing is dropped or
-- rewritten. lib/documents/evidence.ts ensureEvidenceSchema() applies the
-- same statements lazily (tables created lazily elsewhere get their columns
-- the first time a document is read after they exist).
--
-- source_text_start/_end: character offsets of the supporting passage in
--   policy_pages.text for the row's source_page.
-- extraction_method: 'table' | 'model' | 'ocr_table' | 'ocr_model' | 'manual'.
-- passage_verified: the row's amount + currency (+ name) were re-found in
--   that passage by code. A row that fails stays stored with false.
-- conflict_note: another page, or another current version of the same plan,
--   states a contradictory value; both rows are kept.
-- amended_by_policy_id / amendment_note: a later endorsement or amendment of
--   the same plan states a different value for this benefit. On the OLD row,
--   amended_by_policy_id names the amending document (the row is no longer
--   current) and amendment_note says what it now is; on the amending row,
--   amendment_note says what it replaced. Both rows are kept; neither is a
--   conflict.
-- Written out statement by statement (not a dynamic loop) so the static
-- migration checks (lib/launch/policy-state-protection.ts) can see them.
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS source_text_start integer;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS source_text_end integer;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS extraction_method text;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS passage_verified boolean;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS conflict_note text;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS amended_by_policy_id uuid;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS amendment_note text;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS source_text_start integer;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS source_text_end integer;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS extraction_method text;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS passage_verified boolean;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS conflict_note text;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS amended_by_policy_id uuid;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS amendment_note text;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS source_text_start integer;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS source_text_end integer;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS extraction_method text;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS passage_verified boolean;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS conflict_note text;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS amended_by_policy_id uuid;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS amendment_note text;
-- The printed issue/effective date of the document, when it prints one.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS document_date date;
-- Model readings of this document, keyed by stage + model + a hash of the
-- exact input (derived from the document's own content). A retry or a
-- re-upload of identical bytes by the same household reuses them instead of
-- paying again. Lives and dies with the household's own document row.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS reading_cache jsonb;
-- How each stored page's text was obtained: 'native', 'ocr' or 'unreadable'.
ALTER TABLE policy_pages ADD COLUMN IF NOT EXISTS extraction_method text;
-- Round 5: tier = the heading of the table column a row's value is printed in
-- ("Plan A", "Private hospital", "Child"); row_kind types a schedule row
-- ('benefit','as_charged','not_covered','unlimited','deductible','co_insurance',
-- 'co_payment','co_payment_cap','pro_ration','policy_year_limit','family_limit')
-- -- only 'benefit' rows carry a payout formula; duplicate_of_policy_id marks a
-- row that a more authoritative document of the same plan states identically
-- (show that one). policy_members.benefit_tier: the column heading that
-- applies to this person.
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS row_kind text;
ALTER TABLE IF EXISTS policy_benefits ADD COLUMN IF NOT EXISTS duplicate_of_policy_id uuid;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS row_kind text;
ALTER TABLE IF EXISTS policy_coverages ADD COLUMN IF NOT EXISTS duplicate_of_policy_id uuid;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS row_kind text;
ALTER TABLE IF EXISTS coverage_rules ADD COLUMN IF NOT EXISTS duplicate_of_policy_id uuid;
ALTER TABLE IF EXISTS policy_members ADD COLUMN IF NOT EXISTS benefit_tier text;
