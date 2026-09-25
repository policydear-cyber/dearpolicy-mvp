-- Critical-illness extensions to the claim-evidence pipeline (sql/claim-
-- evidence.sql, PR #9). Deliberately reuses claim_evidence_documents,
-- claim_evidence_extractions and claim_evidence_audit_log AS-IS -- those
-- tables and their pipeline (lib/claims/evidence/*) are already generic,
-- document-type-agnostic infrastructure (see lib/claims/evidence/types.ts's
-- module doc comment). This file only WIDENS the document_type CHECK
-- constraint to also accept the medical-evidence document types, and adds
-- ONE new table for critical-illness-specific policy-definition matches,
-- scoped additionally to benefit_code/illness_name because one CI policy
-- can define many benefit rows that must never cross-unlock each other.
--
-- This runs strictly after sql/claim-evidence.sql (see
-- lib/claims/evidence/ci-schema.ts, which calls ensureClaimEvidenceSchema()
-- before applying this file), so claim_evidence_documents is guaranteed to
-- already exist by the time the ALTER TABLE below runs.

ALTER TABLE claim_evidence_documents DROP CONSTRAINT IF EXISTS claim_evidence_documents_document_type_check;
-- The accepted set is exactly lib/claims/evidence/types.ts's
-- CLAIM_EVIDENCE_DOCUMENT_TYPES: the cause-of-death set, the clinical
-- medical-evidence set, and the medical-CLAIM (bill/receipt/settlement) set
-- that hospital-cash, medical-reimbursement and travel-medical claims are
-- proved from. scripts/claim-evidence-document-type-regressions.ts fails CI
-- if this list and that constant ever diverge. Dropping and re-adding the
-- constraint is idempotent, and every previously accepted value is still
-- accepted, so existing rows remain valid on upgrade.
ALTER TABLE claim_evidence_documents ADD CONSTRAINT claim_evidence_documents_document_type_check
  CHECK (document_type IN (
    'death_certificate','police_report','coroners_report','medical_examiner_report','other_official_document',
    'specialist_memo','medical_report','pathology_report','imaging_report','laboratory_report','discharge_summary','surgical_report','other_medical_evidence',
    'hospital_bill','itemised_bill','doctor_memo','referral','pre_authorisation','procedure_report','receipt_payment_proof',
    'other_insurer_settlement_statement','medishield_integrated_shield_settlement_statement'
  ));

-- Policy-specific matches between reviewed medical evidence and ONE
-- policy's own critical-illness benefit definition, for ONE exact benefit
-- and named illness. Mirrors claim_cause_definition_matches exactly (same
-- append-only/supersede-not-edit history model -- see that table's own
-- comment in sql/claim-evidence.sql), widened with benefit_code and
-- illness_name and a six-valued result instead of three: calculateCriticalIllness()
-- (lib/claims/calculators/critical-illness.ts) is the only downstream
-- consumer, and independently re-validates every field of whichever row
-- this table hands it -- this table is never itself trusted at face value.
CREATE TABLE IF NOT EXISTS claim_ci_definition_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  claim_session_id uuid NOT NULL REFERENCES claim_sessions(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  coverage_id uuid REFERENCES policy_coverages(id) ON DELETE CASCADE,
  evidence_document_id uuid NOT NULL REFERENCES claim_evidence_documents(id) ON DELETE CASCADE,
  benefit_code text NOT NULL,
  illness_name text NOT NULL,
  medical_evidence jsonb NOT NULL,
  definition_evidence jsonb NOT NULL,
  result text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL,
  reason text,
  superseded_at timestamptz,
  superseded_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_ci_definition_matches_result_check
    CHECK (result IN ('matches','does_not_match','needs_medical_review','needs_policy_review','insufficient_evidence','ambiguous'))
);
CREATE INDEX IF NOT EXISTS idx_ci_matches_scope
  ON claim_ci_definition_matches(account_id, family_member_id, claim_session_id, contract_id, benefit_code)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ci_matches_document
  ON claim_ci_definition_matches(evidence_document_id);
CREATE INDEX IF NOT EXISTS idx_ci_matches_coverage
  ON claim_ci_definition_matches(coverage_id);

-- Evidence model-execution provenance snapshot for a reviewed match; see
-- sql/claim-evidence.sql. NULL on older rows, which fails closed.
ALTER TABLE claim_ci_definition_matches ADD COLUMN IF NOT EXISTS evidence_provenance jsonb;
