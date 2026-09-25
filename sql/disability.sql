-- Disability extensions to the claim-evidence pipeline (sql/claim-evidence.sql,
-- sql/critical-illness.sql). Reuses claim_evidence_documents, claim_evidence_
-- extractions and claim_evidence_audit_log AS-IS -- no new document types are
-- needed: a disability/TPD medical assessment is read exactly like a
-- critical-illness diagnosis document (MedicalEvidenceDocumentType already
-- covers specialist_memo/medical_report/etc., see
-- lib/claims/calculators/evidence.ts), so the document_type CHECK
-- constraint sql/critical-illness.sql already widened is NOT touched again
-- here. This file only adds ONE new table for disability-specific
-- policy-definition matches, scoped by benefit_code/match_key exactly like
-- claim_ci_definition_matches is scoped by benefit_code/illness_name -- see
-- lib/claims/calculators/evidence.ts's DisabilityDefinitionMatch doc
-- comment for why match_key plays illness_name's exact role here (a fixed
-- "total_permanent_disability"/"disability_income" sentinel, or the exact
-- schedule-of-injuries row code -- never a fuzzy injury description).
--
-- This runs strictly after sql/claim-evidence.sql (see
-- lib/claims/evidence/disability-schema.ts, which calls
-- ensureClaimEvidenceSchema() before applying this file).

CREATE TABLE IF NOT EXISTS claim_disability_definition_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  claim_session_id uuid NOT NULL REFERENCES claim_sessions(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  coverage_id uuid REFERENCES policy_coverages(id) ON DELETE CASCADE,
  evidence_document_id uuid NOT NULL REFERENCES claim_evidence_documents(id) ON DELETE CASCADE,
  benefit_code text NOT NULL,
  match_key text NOT NULL,
  medical_evidence jsonb NOT NULL,
  definition_evidence jsonb NOT NULL,
  result text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL,
  reason text,
  superseded_at timestamptz,
  superseded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_disability_definition_matches_result_check
    CHECK (result IN ('matches','does_not_match','needs_medical_review','needs_policy_review','insufficient_evidence','ambiguous'))
);
CREATE INDEX IF NOT EXISTS idx_disability_matches_scope
  ON claim_disability_definition_matches(account_id, family_member_id, claim_session_id, contract_id, benefit_code)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_disability_matches_document
  ON claim_disability_definition_matches(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_disability_matches_coverage
  ON claim_disability_definition_matches(coverage_id);

-- Evidence model-execution provenance snapshot for a reviewed match; see
-- sql/claim-evidence.sql. NULL on older rows, which fails closed.
ALTER TABLE claim_disability_definition_matches ADD COLUMN IF NOT EXISTS evidence_provenance jsonb;

-- Reviewer decisions are identified per evidence document (see
-- lib/claims/evidence/decision-selection.ts): additive lookup index for a
-- document's active decisions. Never unique -- historical duplicates are
-- left in place and ignored (fail-closed) when read, never rewritten.
CREATE INDEX IF NOT EXISTS claim_disability_definition_matches_active_document
  ON claim_disability_definition_matches(account_id, claim_session_id, evidence_document_id) WHERE superseded_at IS NULL;
