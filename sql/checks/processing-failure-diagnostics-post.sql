-- POST-migration checks for sql/processing-failure-diagnostics.sql (PR #28).
-- Read-only (the role probe runs inside a transaction that is rolled back).
-- Every boolean must be true.

-- Q1: the table exists, RLS is on, and its only policy is the always-false one.
SELECT (to_regclass('public.processing_failure_diagnostics') IS NOT NULL) AS table_exists,
       (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.processing_failure_diagnostics')) AS rls_enabled,
       (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='processing_failure_diagnostics') = 1 AS exactly_one_policy,
       (SELECT bool_and(policyname = 'processing_failure_diagnostics_no_client_access' AND qual = 'false' AND with_check = 'false')
          FROM pg_policies WHERE schemaname='public' AND tablename='processing_failure_diagnostics') AS policy_is_always_false;

-- Q2: no browser role holds any table or sequence privilege.
SELECT NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                    WHERE table_schema='public' AND table_name='processing_failure_diagnostics'
                      AND grantee IN ('anon','authenticated','PUBLIC')) AS no_browser_table_grants,
       NOT has_table_privilege('authenticated','public.processing_failure_diagnostics','SELECT') AS authenticated_cannot_select,
       NOT has_table_privilege('anon','public.processing_failure_diagnostics','SELECT') AS anon_cannot_select,
       NOT has_sequence_privilege('authenticated','public.processing_failure_diagnostics_id_seq','USAGE') AS authenticated_no_sequence;

-- Q3: no household-readable column still holds anything but the fixed text
-- (every count must be 0; same query as P3).
SELECT
  (SELECT count(*) FROM policies WHERE processing_error IS NOT NULL AND processing_error <> 'Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.')::int AS policies_processing_error,
  (SELECT count(*) FROM policies WHERE scan_result_detail IS NOT NULL AND scan_result_detail NOT IN ('No malware-scanning adapter is configured in this environment.','The malware scan did not complete. The document stays on hold until it is scanned successfully.','This file was flagged by malware scanning and cannot be processed.'))::int AS policies_scan_result_detail,
  (SELECT count(*) FROM claim_evidence_documents WHERE processing_error IS NOT NULL AND processing_error <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.')::int AS evidence_processing_error,
  (SELECT count(*) FROM claim_evidence_audit_log WHERE action='processing_failed' AND reason IS NOT NULL AND reason <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.')::int AS evidence_audit_reason,
  (SELECT count(*) FROM policy_document_audit_log WHERE action='scan_attempt_failed' AND reason IS NOT NULL AND reason <> 'The malware scan could not be completed; the document stays on hold.')::int AS policy_audit_reason;

-- Q4: raw detail was preserved server-side (compare with the sum of P3).
SELECT count(*)::int AS diagnostics_rows FROM processing_failure_diagnostics;
