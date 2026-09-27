-- DearPolicy release preflight (live, READ-ONLY, count-only).
-- Returns only counts, booleans and catalog facts. It never selects a row's
-- content: no policy or medical text, names, storage keys, failure messages
-- or household identifiers. Run as the Supabase `postgres` role in the SQL
-- editor or with `psql -v ON_ERROR_STOP=1 -f`. Record the single result row
-- in the change ticket. Pending migration covered: processing-failure-diagnostics.sql.

SELECT
  -- Schema state
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r')::int                                   AS public_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity)::int         AS public_tables_without_rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public')::int                    AS public_policies,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal)::int                              AS public_triggers,
  to_regclass('public.processing_failure_diagnostics') IS NOT NULL                     AS diagnostics_table_exists,
  to_regprocedure('public.is_household_member(uuid)') IS NOT NULL                      AS household_rls_applied,
  to_regclass('public.background_jobs') IS NOT NULL                                    AS background_jobs_exists,
  (SELECT count(*) FROM pg_default_acl WHERE defaclnamespace='public'::regnamespace AND defaclobjtype='r'
    AND defaclacl::text LIKE '%authenticated=%')::int                                  AS default_acl_entries_granting_authenticated,
  -- Rows the backfill would rewrite (counts only)
  (SELECT count(*) FROM policies WHERE processing_error IS NOT NULL
    AND processing_error <> 'Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.')::int AS rewrite_policies_processing_error,
  (SELECT count(*) FROM policies WHERE scan_result_detail IS NOT NULL AND scan_result_detail NOT IN (
    'No malware-scanning adapter is configured in this environment.',
    'The malware scan did not complete. The document stays on hold until it is scanned successfully.',
    'This file was flagged by malware scanning and cannot be processed.',
       'Not scanned: malware scanning is intentionally disabled in this prototype build.'))::int         AS rewrite_policies_scan_result_detail,
  (SELECT count(*) FROM claim_evidence_documents WHERE processing_error IS NOT NULL
    AND processing_error <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.')::int AS rewrite_evidence_processing_error,
  (SELECT count(*) FROM claim_evidence_audit_log WHERE action='processing_failed' AND reason IS NOT NULL
    AND reason <> 'Processing stopped. DearPolicy kept the uploaded document; it can be processed again.')::int AS rewrite_evidence_audit_reason,
  (SELECT count(*) FROM policy_document_audit_log WHERE action='scan_attempt_failed' AND reason IS NOT NULL
    AND reason <> 'The malware scan could not be completed; the document stays on hold.')::int AS rewrite_policy_audit_reason,
  -- Aggregate context (counts only)
  (SELECT count(*) FROM policies)::int                                                 AS policies_total,
  (SELECT count(*) FROM policies WHERE processing_error IS NOT NULL)::int              AS policies_with_processing_error,
  (SELECT count(*) FROM policies WHERE scan_result_detail IS NOT NULL)::int            AS policies_with_scan_detail,
  (SELECT count(*) FROM background_jobs WHERE status IN ('queued','failed_retryable','processing'))::int AS jobs_pending,
  (SELECT count(*) FROM background_jobs WHERE status='dead_letter')::int              AS jobs_dead_letter;
