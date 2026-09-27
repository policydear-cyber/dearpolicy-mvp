-- Safe processing-failure storage (additive; idempotent; NOT applied live by
-- this change -- see docs/migration-runbook.md).
--
-- Household members can SELECT their own rows of policies,
-- claim_evidence_documents, policy_document_audit_log and
-- claim_evidence_audit_log directly (household RLS), not only through the API.
-- Raw pipeline/provider errors (provider responses, analysis ids, engine
-- counts, storage paths, stack fragments) therefore must never be stored in
-- those tables. Raw detail, when it is worth keeping, goes to this
-- service-only table instead (RLS on, one always-false policy, all browser
-- privileges revoked by sql/infrastructure-rls.sql).
CREATE TABLE IF NOT EXISTS processing_failure_diagnostics (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  failure_code text NOT NULL,
  error_class text,
  detail text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processing_failure_diagnostics_type_check CHECK (resource_type IN ('policy_document','claim_evidence','policy_scan','claim_evidence_scan'))
);
CREATE INDEX IF NOT EXISTS idx_processing_failure_diagnostics_resource ON processing_failure_diagnostics(account_id, resource_id);

-- Backfill: preserve existing raw detail server-side, then replace every
-- household-readable copy with a fixed classified message. Each step only
-- touches rows that still hold something other than the safe text, so a
-- re-run is a no-op.
INSERT INTO processing_failure_diagnostics(account_id, resource_type, resource_id, failure_code, detail)
  SELECT account_id, 'policy_document', id, 'PROCESSING_FAILED', processing_error
    FROM policies WHERE processing_error IS NOT NULL AND processing_error <> 'Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.';
UPDATE policies SET processing_error = 'Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.'
  WHERE processing_error IS NOT NULL AND processing_error <> 'Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.';

INSERT INTO processing_failure_diagnostics(account_id, resource_type, resource_id, failure_code, detail)
  SELECT account_id, 'policy_scan', id, 'SCAN_DETAIL', scan_result_detail
    FROM policies
   WHERE scan_result_detail IS NOT NULL
     AND scan_result_detail NOT IN ('No malware-scanning adapter is configured in this environment.',
       'The malware scan did not complete. The document stays on hold until it is scanned successfully.',
       'This file was flagged by malware scanning and cannot be processed.',
       'Not scanned: malware scanning is intentionally disabled in this prototype build.');
UPDATE policies SET scan_result_detail = CASE
    WHEN quarantine_status = 'scan_rejected' THEN 'This file was flagged by malware scanning and cannot be processed.'
    WHEN quarantine_status = 'not_scanned_prototype' THEN 'Not scanned: malware scanning is intentionally disabled in this prototype build.'
    WHEN lower(scan_result_detail) LIKE '%no malware-scanning adapter%' THEN 'No malware-scanning adapter is configured in this environment.'
    WHEN quarantine_status = 'scan_pending' THEN 'The malware scan did not complete. The document stays on hold until it is scanned successfully.'
    ELSE NULL END
  WHERE scan_result_detail IS NOT NULL
    AND scan_result_detail NOT IN ('No malware-scanning adapter is configured in this environment.',
      'The malware scan did not complete. The document stays on hold until it is scanned successfully.',
      'This file was flagged by malware scanning and cannot be processed.',
       'Not scanned: malware scanning is intentionally disabled in this prototype build.');

DO $$
BEGIN
  IF to_regclass('public.claim_evidence_documents') IS NOT NULL THEN
    INSERT INTO processing_failure_diagnostics(account_id, resource_type, resource_id, failure_code, detail)
      SELECT account_id, 'claim_evidence', id, coalesce(processing_error_code, 'PROCESSING_ERROR'), processing_error
        FROM claim_evidence_documents WHERE processing_error IS NOT NULL AND processing_error <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.';
    UPDATE claim_evidence_documents SET processing_error = 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.'
      WHERE processing_error IS NOT NULL AND processing_error <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.';
  END IF;
  IF to_regclass('public.claim_evidence_audit_log') IS NOT NULL THEN
    INSERT INTO processing_failure_diagnostics(account_id, resource_type, resource_id, failure_code, detail)
      SELECT account_id, 'claim_evidence', evidence_document_id, coalesce(reason_code, 'PROCESSING_ERROR'), reason
        FROM claim_evidence_audit_log
       WHERE action = 'processing_failed' AND evidence_document_id IS NOT NULL AND reason IS NOT NULL AND reason <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.';
    UPDATE claim_evidence_audit_log SET reason = 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.'
      WHERE action = 'processing_failed' AND reason IS NOT NULL AND reason <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.';
  END IF;
END $$;

INSERT INTO processing_failure_diagnostics(account_id, resource_type, resource_id, failure_code, detail)
  SELECT account_id, 'policy_scan', policy_id, coalesce(reason_code, 'SCAN_ATTEMPT_FAILED'), reason
    FROM policy_document_audit_log
   WHERE action = 'scan_attempt_failed' AND policy_id IS NOT NULL AND reason IS NOT NULL AND reason <> 'The malware scan could not be completed; the document stays on hold.';
UPDATE policy_document_audit_log SET reason = 'The malware scan could not be completed; the document stays on hold.'
  WHERE action = 'scan_attempt_failed' AND reason IS NOT NULL AND reason <> 'The malware scan could not be completed; the document stays on hold.';
