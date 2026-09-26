-- PRE-migration checks for sql/processing-failure-diagnostics.sql (PR #28).
-- Read-only. Returns COUNTS and catalog facts only: never selects the
-- failure text itself. Run as the table owner (Supabase `postgres`).
-- Record every result in the change ticket before applying.

-- P1: dependencies exist (all must be true).
SELECT to_regclass('public.accounts') IS NOT NULL AS has_accounts,
       to_regclass('public.policies') IS NOT NULL AS has_policies,
       to_regclass('public.policy_document_audit_log') IS NOT NULL AS has_policy_audit,
       to_regclass('public.claim_evidence_documents') IS NOT NULL AS has_evidence,
       to_regclass('public.claim_evidence_audit_log') IS NOT NULL AS has_evidence_audit,
       to_regprocedure('public.is_household_member(uuid)') IS NOT NULL AS household_rls_applied;

-- P2: the table is new (expect false; if true, stop and compare its shape).
SELECT to_regclass('public.processing_failure_diagnostics') IS NOT NULL AS diagnostics_table_exists;

-- P3: rows the backfill will rewrite, per column (counts only). Save these:
-- the post-check expects every one to be 0 and the diagnostics table to hold
-- at least their sum.
SELECT
  (SELECT count(*) FROM policies WHERE processing_error IS NOT NULL AND processing_error <> 'Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.')::int AS policies_processing_error,
  (SELECT count(*) FROM policies WHERE scan_result_detail IS NOT NULL AND scan_result_detail NOT IN ('No malware-scanning adapter is configured in this environment.','The malware scan did not complete. The document stays on hold until it is scanned successfully.','This file was flagged by malware scanning and cannot be processed.'))::int AS policies_scan_result_detail,
  (SELECT count(*) FROM claim_evidence_documents WHERE processing_error IS NOT NULL AND processing_error <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.')::int AS evidence_processing_error,
  (SELECT count(*) FROM claim_evidence_audit_log WHERE action='processing_failed' AND reason IS NOT NULL AND reason <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.')::int AS evidence_audit_reason,
  (SELECT count(*) FROM policy_document_audit_log WHERE action='scan_attempt_failed' AND reason IS NOT NULL AND reason <> 'The malware scan could not be completed; the document stays on hold.')::int AS policy_audit_reason;

-- P4: default privileges a NEW public table inherits (Supabase grants the API
-- roles on new tables by default). This is why the migration and
-- infrastructure-rls.sql must be applied in ONE transaction: otherwise the
-- new table is browser-readable until infrastructure-rls.sql runs.
SELECT pg_get_userbyid(defaclrole) AS owner_role, defaclacl::text AS default_acl
  FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace AND defaclobjtype = 'r';
