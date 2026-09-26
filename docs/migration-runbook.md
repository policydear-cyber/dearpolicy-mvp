# DearPolicy database migration runbook

For the operator applying `sql/*.sql` to a Supabase Postgres database (staging first, then production).
Nothing here has been run against any live database. Placeholders look like `<LIKE_THIS>`; this file contains no real credentials or identifiers.

## 0. Ground rules

- Apply to **staging first**, run every check in sections 5-7 there, and only then schedule production.
- Apply migrations **before** deploying the application build that needs them. The app lazily re-applies `claim-evidence.sql`, `critical-illness.sql`, `disability.sql` and `claim-reviewers.sql` at runtime (`lib/claims/evidence/*schema.ts`, `lib/claims/reviewers/schema.ts`). If those tables were created that way *after* `household-rls.sql` ran, they would carry Supabase's default grants and none of the household guards.
- Do **not** use `npm run db:setup` for staging or production. `scripts/setup-db.ts` is a local-development helper: it omits `model-provenance.sql`, `rate-limit.sql`, `background-jobs.sql`, `infrastructure-rls.sql` and `storage-rls.sql`.
- Run each file with `psql -v ON_ERROR_STOP=1 --single-transaction -f <file>`, one file per invocation. None of the files contains its own `BEGIN`/`COMMIT`, `CREATE INDEX CONCURRENTLY` or `ALTER TYPE ... ADD VALUE`, so each file can be applied atomically: it either fully applies or rolls back.
- Connect as the Supabase `postgres` role (the table owner). Do not apply migrations as `authenticated`, `anon` or `service_role`.

## 1. Prerequisite checks (abort if any fail)

```sql
-- Supabase auth schema and roles must already exist (household-rls.sql only
-- creates stand-ins when they are missing, which is correct for CI, not Supabase).
SELECT to_regprocedure('auth.uid()') IS NOT NULL AS has_auth_uid;
SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY 1;  -- expect 3 rows
-- schema.sql runs CREATE EXTENSION IF NOT EXISTS vector / pgcrypto: both must be available.
SELECT name, installed_version FROM pg_available_extensions WHERE name IN ('pgcrypto','vector') ORDER BY 1;  -- expect both rows
-- Storage schema (needed only by storage-rls.sql).
SELECT to_regclass('storage.objects') IS NOT NULL AS has_storage_objects,
       to_regclass('storage.buckets') IS NOT NULL AS has_storage_buckets;
-- Current role must own the public tables.
SELECT current_user, (SELECT tableowner FROM pg_tables WHERE schemaname='public' AND tablename='accounts') AS accounts_owner;
```

Also confirm, outside SQL:
- The application is in maintenance mode or has no deploy in flight, and no worker (`npm run jobs:worker`) is running against this database.
- The release commit is the reviewed PR head, and this runbook is read from that commit.
- The buckets `policy-files`, `claim-evidence-files` and `household-exports` exist (or their names are set in `SUPABASE_STORAGE_BUCKET`, `SUPABASE_CLAIM_EVIDENCE_BUCKET` and `SUPABASE_HOUSEHOLD_EXPORT_BUCKET`). If the names differ from these defaults, `storage-rls.sql` must be edited to match before it is applied.

## 2. Backup and recovery point

1. Confirm Point-in-Time Recovery is enabled for the project, or take a manual backup: `pg_dump --format=custom --no-owner` of the whole database.
2. Record the recovery timestamp (UTC) and the backup identifier in the change ticket **before** step 3.
3. Capture the current policy and grant state for rollback (section 8):
   ```sql
   \copy (SELECT * FROM pg_policies WHERE schemaname IN ('public','storage')) TO 'pre_policies.csv' CSV HEADER
   \copy (SELECT grantee, table_schema, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated')) TO 'pre_table_grants.csv' CSV HEADER
   \copy (SELECT grantee, table_name, column_name, privilege_type FROM information_schema.column_privileges WHERE grantee IN ('anon','authenticated')) TO 'pre_column_grants.csv' CSV HEADER
   ```
4. Record what browser roles can currently do to policy documents and coverages (the policy-state fix, §5.8). Before this release, expect `authenticated` to hold INSERT/UPDATE/DELETE on both tables; keep the output in the change ticket:
   ```sql
   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
    WHERE table_name IN ('policies','policy_coverages') AND grantee IN ('anon','authenticated','PUBLIC') ORDER BY 1,2,3;
   SELECT table_name, column_name, grantee, privilege_type FROM information_schema.column_privileges
    WHERE table_name IN ('policies','policy_coverages') AND grantee IN ('anon','authenticated')
      AND privilege_type IN ('INSERT','UPDATE') ORDER BY 1,2,3,4;
   SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename IN ('policies','policy_coverages') ORDER BY 1,2;
   -- Documents that would stop contributing coverage after this release (not yet scan_clean, or superseded) -- counts only:
   SELECT quarantine_status, (superseded_at IS NOT NULL) AS superseded, processing_status, count(*) FROM policies GROUP BY 1,2,3 ORDER BY 1,2,3;
   ```

## 3. Migration order (derived from the SQL itself)

Each row lists what the file needs to exist first. It is verified against the `REFERENCES`, `ALTER TABLE`, `to_regclass()` and function dependencies in the files.

| # | File | Depends on | Why this position |
|---|------|-----------|-------------------|
| 1 | `schema.sql` | `vector`, `pgcrypto` available | Creates `accounts`, `family_members`, `policies`, `claim_sessions`, `policy_coverages`, chat, audit, storage-cleanup and export tables. |
| 2 | `benefit-catalog.sql` | 1 | Alters `policies` and `policy_benefits`. |
| 3 | `cover-conditions.sql` | 1 | Uses `policies`. |
| 4 | `coverage-ledger.sql` | 1 | Uses `family_members` and `policies`. |
| 5 | `model-usage.sql` | none | Standalone; `schema.sql` also creates the table. |
| 6 | `chat-upgrade.sql` | 1 | Alters `chat_messages` and `policy_chunks`; backfills from `claim_sessions`. |
| 7 | `claim-composition.sql` | 1 | Uses `claim_sessions`. |
| 8 | `claim-evidence.sql` | 1 | Uses `policies`, `policy_coverages` and `claim_sessions`. Creates the evidence tables and the cause-decision table. |
| 9 | `critical-illness.sql` | 8 | Replaces the `claim_evidence_documents` document-type CHECK and creates `claim_ci_definition_matches`. |
| 10 | `disability.sql` | 8 (and 9, for the document types it relies on) | Creates `claim_disability_definition_matches`. |
| 11 | `model-provenance.sql` | none | Must exist before 16, which locks `model_executions`. |
| 12 | `rate-limit.sql` | none | Standalone infrastructure table. |
| 13 | `background-jobs.sql` | 1 | Uses `accounts`. |
| 14 | `lifecycle.sql` | 1, 8 | Adds lifecycle columns to `accounts`, `policies`, `family_members` and (only if it exists) `claim_evidence_documents`. **Must run after 8**, otherwise the evidence lifecycle columns are silently skipped. |
| 15 | `claim-reviewers.sql` | 1, 8, roles | Uses `claim_evidence_documents` and `claim_sessions`. Revokes browser roles from the reviewer tables. |
| 16 | `household-rls.sql` | **all of 1-15** | Enables RLS and policies on every household table. Narrows the evidence tables (a column grant plus a guard trigger that depend on 14's `lifecycle_state`), the three decision tables (8, 9, 10), `model_executions` (11), `scan_provider_events` and the audit logs (1, 8). Takes `policies` and `policy_coverages` out of the generic member CRUD loop: browser roles keep SELECT only, plus UPDATE on `policies(lifecycle_state, lifecycle_version, updated_at)` guarded by the `guard_household_policy_update` trigger (active -> pending_deletion only); that grant and trigger also depend on 14. Each optional block is `to_regclass`-guarded, so running it too early silently skips protections. |
| 17 | `infrastructure-rls.sql` | **all of 1-16** | For each of the 18 service/operator-only tables in `lib/db/table-inventory.ts` (jobs, dead letters, deletion requests and audit, rate-limit buckets, exports and export audit, storage-cleanup locks and audit, model provenance, the `model_usage` spend ledger, chat job/cache/epoch state, the scan ledger, and the reviewer registry): enables RLS, drops every other policy, installs one always-false policy, and revokes all table and sequence privileges from PUBLIC, `anon` and `authenticated`. Removes `anon` EXECUTE on the SECURITY DEFINER helpers. **It must run after 16, and be re-run whenever 16 is re-run**, because 16's grants would otherwise stand. RLS is deliberately not FORCEd; see §11. |
| 18 | `storage-rls.sql` | 16, Supabase Storage | Uses `is_household_member()` from 16 (it raises an exception if that is missing). The household object policies cover only `policy-files`; `claim-evidence-files` has no household access. Forces both app buckets private. |

Any later change to 1-15 must be followed by re-running 16, then 17 (and then 18).

## 4. Repeatability and locking

| File | Safe to re-run? | Notes |
|------|-----------------|-------|
| schema.sql | Yes | Backfills are guarded (`ON CONFLICT DO NOTHING` / `NOT EXISTS`). The currency and product-name normalisation `UPDATE`s are idempotent but rewrite rows, so expect row locks on `policy_coverages` and `premium_records`. |
| benefit-catalog, cover-conditions, coverage-ledger, model-usage, claim-composition, model-provenance, rate-limit, background-jobs | Yes | Only `IF NOT EXISTS` DDL. |
| chat-upgrade.sql | Yes | Backfills use `ON CONFLICT DO NOTHING` plus `WHERE conversation_id IS NULL`. |
| claim-evidence.sql | Yes | Also re-applied by the app at runtime. |
| critical-illness.sql | Yes | Drops and re-adds the document-type CHECK: an `ACCESS EXCLUSIVE` lock plus a full-table validation of `claim_evidence_documents`. Also re-applied by the app at runtime. |
| disability.sql | Yes | Also re-applied by the app at runtime. |
| lifecycle.sql | Yes | `ADD COLUMN IF NOT EXISTS` with defaults; CHECK constraints are dropped and re-added. |
| claim-reviewers.sql | Yes | Uses `DROP ... IF EXISTS` before `CREATE TRIGGER`/`CREATE POLICY`; REVOKEs are idempotent. |
| household-rls.sql | Yes | Every policy and trigger is dropped and recreated. The shims create roles and `auth.uid()` only if missing. |
| infrastructure-rls.sql | Yes | Drops and recreates the always-false policy, drops any other policy on those tables, and repeats the REVOKEs. It takes a brief `ACCESS EXCLUSIVE` lock per table for `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and the policy changes. |
| storage-rls.sql | Yes | Policies are dropped and recreated; the bucket `UPDATE` is idempotent. |

Pre-flight checks for objects the files expect to replace (informational; a mismatch is not an error, because the files drop and recreate these objects):

```sql
SELECT conname, conrelid::regclass FROM pg_constraint
 WHERE conname IN ('claim_evidence_documents_document_type_check','claim_evidence_documents_lifecycle_state_check',
                   'family_members_lifecycle_state_check');
SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname IN ('public','storage') ORDER BY 1,2,3;
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE NOT tgisinternal
 AND tgname IN ('guard_household_decision_retirement','guard_household_evidence_update','claim_reviewer_audit_log_append_only');
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_claim_evidence%';
```

Abort if a table that a file *creates* already exists with a different shape (for example, `claim_evidence_documents` without `file_hash`). Stop and escalate; do not edit the migration on the fly.

## 5. Post-migration verification (all must pass)

```sql
-- 5.1 Every expected table exists.
SELECT t, to_regclass('public.'||t) IS NOT NULL AS present FROM unnest(ARRAY[
 'accounts','household_members','household_invitations','family_members','policies','claim_sessions',
 'claim_evidence_documents','claim_evidence_extractions','claim_evidence_audit_log',
 'claim_cause_definition_matches','claim_ci_definition_matches','claim_disability_definition_matches',
 'claim_reviewers','claim_review_assignments','claim_reviewer_audit_log','model_executions',
 'background_jobs','background_job_audit_log','deletion_requests','deletion_audit_log','rate_limit_buckets',
 'scan_provider_events','household_exports']) t;

-- 5.2 RLS is enabled on every household-data and reviewer table.
SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN (
 'accounts','household_members','household_invitations','family_members','policies','claim_sessions',
 'claim_evidence_documents','claim_evidence_extractions','claim_evidence_audit_log',
 'claim_cause_definition_matches','claim_ci_definition_matches','claim_disability_definition_matches',
 'claim_reviewers','claim_review_assignments','claim_reviewer_audit_log','model_executions','scan_provider_events')
 ORDER BY 1;  -- every row: relrowsecurity = true

-- 5.3 Browser roles hold exactly the intended evidence privileges.
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee='authenticated' AND table_name IN ('claim_evidence_documents','claim_evidence_extractions','claim_evidence_audit_log',
   'claim_cause_definition_matches','claim_ci_definition_matches','claim_disability_definition_matches')
 ORDER BY 1,2;  -- expect no INSERT, UPDATE, DELETE or TRUNCATE rows (SELECT, and Supabase's default REFERENCES/TRIGGER, may appear)
SELECT table_name, column_name FROM information_schema.column_privileges
 WHERE grantee='authenticated' AND privilege_type='UPDATE'
   AND table_name IN ('claim_evidence_documents','claim_cause_definition_matches','claim_ci_definition_matches','claim_disability_definition_matches')
 ORDER BY 1,2;
-- expect: claim_evidence_documents -> lifecycle_state, lifecycle_version, updated_at;
--         each *_definition_matches -> superseded_at, superseded_reason; nothing else.
SELECT grantee, table_name FROM information_schema.role_table_grants
 WHERE grantee IN ('anon','authenticated') AND table_name IN ('claim_reviewers','claim_review_assignments','claim_reviewer_audit_log','model_executions','scan_provider_events');
 -- expect 0 rows

-- 5.4 Guard triggers are installed.
SELECT tgrelid::regclass, tgname FROM pg_trigger WHERE NOT tgisinternal
 AND tgname IN ('guard_household_evidence_update','guard_household_decision_retirement','claim_reviewer_audit_log_append_only','guard_household_policy_update')
 ORDER BY 1;  -- 1 evidence + 3 decision + 1 reviewer audit + 1 policy = 6 rows

-- 5.5 Lifecycle columns exist on evidence.
SELECT column_name FROM information_schema.columns WHERE table_name='claim_evidence_documents' AND column_name IN ('lifecycle_state','lifecycle_version');

-- 5.6 No infrastructure table is reachable by a browser role (expect 0 rows from each).
WITH infra(t) AS (SELECT unnest(ARRAY['background_jobs','background_job_audit_log','chat_analysis_jobs','chat_history_epochs',
  'policy_analysis_cache','deletion_requests','deletion_audit_log','rate_limit_buckets','household_exports','household_export_audit_log',
  'storage_cleanup_locks','storage_cleanup_audit_log','model_executions','model_usage','scan_provider_events',
  'claim_reviewers','claim_review_assignments','claim_reviewer_audit_log']))
SELECT t, r FROM infra, unnest(ARRAY['anon','authenticated']) r
 WHERE to_regclass('public.'||t) IS NOT NULL
   AND (has_table_privilege(r, 'public.'||t, 'SELECT') OR has_table_privilege(r, 'public.'||t, 'INSERT')
     OR has_table_privilege(r, 'public.'||t, 'UPDATE') OR has_table_privilege(r, 'public.'||t, 'DELETE')
     OR has_table_privilege(r, 'public.'||t, 'TRUNCATE'));
SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY(ARRAY['background_jobs','deletion_requests',
  'rate_limit_buckets','household_exports','storage_cleanup_locks','model_usage','claim_reviewers']) AND NOT c.relrowsecurity;
SELECT tablename, policyname, qual, with_check FROM pg_policies
 WHERE schemaname='public' AND tablename IN ('background_jobs','background_job_audit_log','chat_analysis_jobs','chat_history_epochs',
  'policy_analysis_cache','deletion_requests','deletion_audit_log','rate_limit_buckets','household_exports','household_export_audit_log',
  'storage_cleanup_locks','storage_cleanup_audit_log','model_executions','model_usage','scan_provider_events',
  'claim_reviewers','claim_review_assignments','claim_reviewer_audit_log')
   AND (coalesce(qual,'false') <> 'false' OR coalesce(with_check,'false') <> 'false');
-- Sequences behind those tables:
SELECT s.relname, r FROM pg_class s, unnest(ARRAY['anon','authenticated']) r
 WHERE s.relkind='S' AND s.relnamespace='public'::regnamespace
   AND s.relname IN ('background_job_audit_log_id_seq','deletion_audit_log_id_seq','household_export_audit_log_id_seq','claim_reviewer_audit_log_id_seq')
   AND has_sequence_privilege(r, s.oid, 'USAGE,SELECT,UPDATE');
-- SECURITY DEFINER helpers: fixed search_path, not executable by anon (expect 0 rows).
SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef
   AND (NOT coalesce(proconfig::text,'') LIKE '%search_path=%' OR has_function_privilege('anon', oid, 'EXECUTE'));

-- 5.7 Tables a browser JWT can still reach without RLS (review every row).
SELECT c.relname FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT c.relrowsecurity
   AND has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE');

-- 5.8 Policy-processing and coverage-verification state (lib/db/table-inventory.ts POLICY_STATE_COLUMNS).
-- a) No table-level write privilege for any browser role (expect 0 rows).
SELECT t, r, p FROM unnest(ARRAY['policies','policy_coverages']) t, unnest(ARRAY['anon','authenticated']) r,
       unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
 WHERE has_table_privilege(r, 'public.'||t, p);
-- b) Column-level write privileges: expect exactly 3 rows, all authenticated/UPDATE on policies:
--    lifecycle_state, lifecycle_version, updated_at. Any other row -- in particular quarantine_status,
--    scan_*, processing_*, file_hash, storage_key, supersedes_id, superseded_at, account_id,
--    family_member_id, personal_coverage_confirmed, needs_review, or ANY policy_coverages column
--    (confirmed, evidence_verified, amount, currency, category, source_page, evidence_text, ...) -- is an abort (§10).
SELECT a.attrelid::regclass AS tbl, a.attname, r, p FROM pg_attribute a,
       unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['INSERT','UPDATE']) p
 WHERE a.attrelid IN ('public.policies'::regclass,'public.policy_coverages'::regclass) AND a.attnum > 0 AND NOT a.attisdropped
   AND has_column_privilege(r, a.attrelid, a.attname, p)
 ORDER BY 1,2,3,4;
-- c) RLS on, and only the expected policies (policies: household_member_select + household_member_update;
--    policy_coverages: household_member_select).
SELECT relname, relrowsecurity FROM pg_class WHERE oid IN ('public.policies'::regclass,'public.policy_coverages'::regclass);
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' AND tablename IN ('policies','policy_coverages') ORDER BY 1,2;
-- d) The lifecycle guard is installed and enabled (expect 1 row, tgenabled = 'O').
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.policies'::regclass AND tgname='guard_household_policy_update';
-- e) Every live column is classified: compare this list with POLICY_STATE_COLUMNS (43 policies, 15 policy_coverages columns).
SELECT table_name, count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('policies','policy_coverages') GROUP BY 1;
```

Check 5.7 must return **0 rows**. Every household table has RLS from `household-rls.sql`, and every infrastructure table has RLS with no browser privilege from `infrastructure-rls.sql`. A row here means a table exists that is not classified in `lib/db/table-inventory.ts`: stop (§10).

**Server workers still function.** The trusted server connection is the table owner, which non-forced RLS does not apply to, so the queue worker, deletion coordinator, rate limiter, export worker, storage cleanup, scan callback and reviewer CLI are unaffected. After applying, confirm on staging that:
- `npm run jobs:worker` claims and completes a job;
- sign-in rate limiting still refuses after its limit;
- deleting a family member from the app succeeds;
- a household export completes;
- `npm run reviewer:admin -- assign ...` succeeds.

**Trusted-worker controls for policy documents.** Every write to `policies` and `policy_coverages` other than the deletion move now runs on the server connection: the upload route's INSERT, the quarantine gate and scan callback (`lib/policies/quarantine/store.ts`), the ingest pipeline (`lib/rag/ingest.ts`: processing state, extraction, `policy_coverages` rebuild), reprocess queueing, family linking (`lib/policies/linking.ts`, link-person review flags) and supersession. Before sign-off, confirm the server connection is the table owner (or otherwise bypasses RLS and holds the table privileges):
```sql
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, current_user,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls
  FROM pg_class c WHERE c.oid IN ('public.policies'::regclass,'public.policy_coverages'::regclass);
-- run as the DATABASE_URL role: owner must equal current_user, or bypassrls must be true.
```
If neither holds, stop (§10): the enforcement is correct but the server would lose its write path.

## 6. RLS tests with household, reviewer and service identities

Use dedicated staging test accounts only, never real households. Run each block in a transaction and `ROLLBACK`.

```sql
-- Helper: act as a browser user.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<HOUSEHOLD_A_OWNER_UUID>', true);
SELECT set_config('request.jwt.claims', json_build_object('sub','<HOUSEHOLD_A_OWNER_UUID>','role','authenticated')::text, true);

-- 6.1 Own rows are readable (expect >0), other household's rows are not (expect 0).
SELECT count(*) FROM claim_evidence_documents WHERE account_id='<HOUSEHOLD_A_UUID>';
SELECT count(*) FROM claim_evidence_documents WHERE account_id='<HOUSEHOLD_B_UUID>';
-- 6.2 Each of these must fail with "permission denied" (run them one at a time, rolling back after each).
UPDATE claim_evidence_documents SET status='matched' WHERE id='<EVIDENCE_A_UUID>';
UPDATE claim_evidence_documents SET scan_status='clean' WHERE id='<EVIDENCE_A_UUID>';
UPDATE claim_evidence_extractions SET reviewed_fields='{}' WHERE evidence_document_id='<EVIDENCE_A_UUID>';
INSERT INTO claim_evidence_audit_log(account_id,actor,action) VALUES ('<HOUSEHOLD_A_UUID>','x','x');
INSERT INTO scan_provider_events(provider,event_id) VALUES ('virustotal','x');
SELECT 1 FROM claim_reviewers;
-- 6.3 Lifecycle: skipping a state must fail with "may only move an active evidence document to pending deletion".
UPDATE claim_evidence_documents SET lifecycle_state='soft_deleted', lifecycle_version=lifecycle_version+1 WHERE id='<EVIDENCE_A_UUID>';
-- 6.4 Policy state: each must fail with "permission denied" (one at a time, rolling back after each).
UPDATE policies SET quarantine_status='scan_clean' WHERE id='<POLICY_A_UUID>';
UPDATE policies SET processing_status='ready' WHERE id='<POLICY_A_UUID>';
UPDATE policies SET file_hash='x', storage_key='x' WHERE id='<POLICY_A_UUID>';
UPDATE policies SET family_member_id='<OTHER_MEMBER_A_UUID>' WHERE id='<POLICY_A_UUID>';
INSERT INTO policies(account_id,family_member_id,original_filename,storage_key,quarantine_status,processing_status)
  VALUES ('<HOUSEHOLD_A_UUID>','<MEMBER_A_UUID>','x.pdf','x','scan_clean','ready');
UPDATE policy_coverages SET confirmed=true, evidence_verified=true WHERE policy_id='<POLICY_A_UUID>';
UPDATE policy_coverages SET amount=9999999 WHERE policy_id='<POLICY_A_UUID>';
INSERT INTO policy_coverages(account_id,policy_id,family_member_id,category,amount,confirmed,evidence_verified)
  VALUES ('<HOUSEHOLD_A_UUID>','<POLICY_A_UUID>','<MEMBER_A_UUID>','x',1,true,true);
DELETE FROM policies WHERE id='<POLICY_A_UUID>';
-- 6.5 Lifecycle on a policy: reviving or skipping must fail with "may only move an active policy to pending deletion".
UPDATE policies SET lifecycle_state='active', lifecycle_version=lifecycle_version+1 WHERE id='<DELETED_POLICY_A_UUID>';
UPDATE policies SET lifecycle_state='soft_deleted', lifecycle_version=lifecycle_version+1 WHERE id='<POLICY_A_UUID>';
ROLLBACK;
```
Repeat 6.4 as `anon` (no `sub`): every statement fails with "permission denied".

**Policy upload / scan / process smoke tests** (staging, deployed build, dedicated test household):
1. Upload a policy PDF. Expect `policies.quarantine_status` to move `uploaded -> quarantined -> scan_pending` and, after the scanner verdict or callback, `scan_clean`; nothing is extracted before that.
2. Once `scan_clean`, processing reaches `processing_status='ready'`, chunks and coverages exist, and the dashboard and chat show the document.
3. Upload the EICAR test file: it ends `scan_rejected`, never reaches processing, and contributes nothing to the dashboard, chat or claims.
4. Reprocess a ready document from the app: it returns 202 and re-reaches `ready`; a second reprocess while it is running is refused.
5. Link a detected person to a family member from the app: the linked member's coverage appears only after linking, and the review flags update.
6. Delete a policy from the app: it moves to `pending_deletion`, disappears from chat and claims, and the deletion worker completes it.

Repeat block 6 with `<HOUSEHOLD_B_OWNER_UUID>`: every read of household A returns 0 rows and every update affects 0 rows. Repeat with `<REVIEWER_USER_UUID>` (a provisioned reviewer): the same result, because reviewers never read evidence through the database API; they read it through the reviewer routes only.

Service identity: as `postgres` (outside `SET ROLE`), confirm the server path still works, inside a transaction you then roll back:
```sql
BEGIN;
UPDATE claim_evidence_documents SET processing_attempts=processing_attempts WHERE id='<EVIDENCE_A_UUID>';  -- 1 row
SELECT count(*) FROM claim_reviewers;                                                                         -- works
ROLLBACK;
```

End-to-end, on staging with the deployed build: upload a document, let the scan callback complete, delete one document from the claim page, and correct one bill through the bill-review screen. Each must succeed.

## 7. Storage bucket privacy

```sql
SELECT id, public FROM storage.buckets WHERE id IN ('policy-files','claim-evidence-files','household-exports');  -- public = false for all
SELECT policyname, qual, with_check FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY 1;
-- expect the four household_storage_objects_* policies, each limited to bucket_id = 'policy-files';
-- no policy may mention 'claim-evidence-files' or 'household-exports'.
```
Then, with a staging household's user JWT, call Supabase Storage directly (the REST API or `supabase-js` with the anon key and the user session). Listing, downloading, signing or uploading an object in `claim-evidence-files` must fail. Do the same for another household's `policy-files` object.

## 8. Rollback

Prefer forward fixes. Roll back only when the application cannot run safely on the new schema.

| File | Rollback |
|------|----------|
| storage-rls.sql | Re-create the pre-migration storage policies from `pre_policies.csv`, or, to fail closed, `DROP POLICY household_storage_objects_{select,insert,update,delete} ON storage.objects` (the service role is unaffected). Never make a bucket public. |
| infrastructure-rls.sql | Do not roll back. It only removes browser privileges and adds an always-false policy; no data is changed or destroyed, and the server connection is unaffected. If a server path unexpectedly fails, fix that path forward. Restoring browser access (re-granting from `pre_table_grants.csv`) reopens the unauthorized paths this migration closes. |
| household-rls.sql | Re-apply the `household-rls.sql` from the previously deployed commit, then restore grants from `pre_table_grants.csv` and `pre_column_grants.csv`. Note: this re-opens the household write paths that this release closed -- including direct browser writes to `policies.quarantine_status` and `policy_coverages.confirmed`/`evidence_verified`, i.e. a household could mark an unscanned document clean or its own coverage verified. Prefer staying on the new file and fixing forward. **Deployment coupling:** the previous application build inserts policies and queues reprocessing through the browser-scoped connection; against the new grants those requests are refused (fail closed, no data change) until this release's build is deployed. Rolling the application back while keeping the new migration therefore disables upload, reprocess and link-person but leaves no security gap. To remove only the policy-state block, restore the table grants for `policies`/`policy_coverages` from `pre_table_grants.csv` and `DROP TRIGGER guard_household_policy_update ON public.policies`; do not do this while any household can reach the app. |
| claim-reviewers.sql | New tables only: `DROP TABLE claim_reviewer_audit_log, claim_review_assignments, claim_reviewers CASCADE;` is safe only before any reviewer or assignment is recorded. After that, restore from backup instead, because the audit log is append-only by design. |
| lifecycle.sql | Additive columns and tables. Leave in place; older code ignores them. To remove, restore from backup; do not drop columns by hand while any row is non-`active`. |
| background-jobs, rate-limit, model-provenance, claim-composition, coverage-ledger, cover-conditions, benefit-catalog, model-usage | Additive. Leave in place, or drop the new tables if they are empty. |
| disability.sql / critical-illness.sql | Additive decision tables: drop only if empty. The document-type CHECK change is widening only; re-applying the old `claim-evidence.sql` constraint would reject existing CI and disability documents, so do not revert it by hand. Restore from backup if needed. |
| claim-evidence.sql | Drop only if the evidence tables are empty; otherwise restore from backup. |
| chat-upgrade.sql, schema.sql | Contain data backfills and normalisation. Roll back only by restoring the backup or PITR from section 2. |

Full rollback means restoring the backup to the recovery point recorded in section 2, then redeploying the previous application build.

## 9. Reviewer provisioning (after 5-7 pass)

Reviewers are DearPolicy staff; nothing a household does can create one. Run from a trusted operator machine with `DATABASE_URL` for the target environment:

```bash
npm run reviewer:admin -- provision  --user <AUTH_USER_UUID> --label "<Display label>" --operator <operator-name>
npm run reviewer:admin -- assign     --reviewer <AUTH_USER_UUID> --household <HOUSEHOLD_UUID> --claim <CLAIM_SESSION_UUID> --hours <1-720> --operator <operator-name>
npm run reviewer:admin -- revoke     --assignment <ASSIGNMENT_UUID> --reason "<why>" --operator <operator-name>
npm run reviewer:admin -- suspend    --user <AUTH_USER_UUID> --reason "<why>" --operator <operator-name>
```
- The user must already exist in Supabase Auth, and must not be a member of the household they review.
- Verify afterwards: `SELECT action, operator, occurred_at FROM claim_reviewer_audit_log ORDER BY occurred_at DESC LIMIT 5;`
- Assignments expire. Grant the shortest window that covers the review.

## 10. Abort conditions (stop, do not continue to the next file)

- Any prerequisite in section 1 fails.
- No confirmed backup or recovery point.
- Any `psql` error while applying a file. The file's own transaction has rolled back; do not re-run later files.
- `household-rls.sql` would run before any of files 1-15 has been applied, or any of those files is changed afterwards without re-running it.
- `infrastructure-rls.sql` would run before `household-rls.sql`, or `household-rls.sql` has been re-applied without re-applying `infrastructure-rls.sql` afterwards.
- Any check in section 5 differs from its expected result.
- Check 5.6 returns any row: an authenticated or anonymous browser role still holds a privilege on an infrastructure table, a permissive policy exists on one, a sequence behind one is usable by a browser role, or a SECURITY DEFINER helper is executable by anon.
- Check 5.7 returns any row (an unclassified table reachable by browser sessions).
- Check 5.8 shows any browser role able to INSERT, UPDATE, DELETE or TRUNCATE `policies` or `policy_coverages` beyond UPDATE on `policies(lifecycle_state, lifecycle_version, updated_at)`, RLS off on either table, or the `guard_household_policy_update` trigger missing or disabled. In particular: **abort if any browser role can set any security or verification field** -- `policies.quarantine_status`, `scan_provider`, `scan_result_detail`, `scan_event_id`, `scanned_at`, `personal_coverage_confirmed`, `needs_review`, `review_reason`, or `policy_coverages.confirmed`, `evidence_verified`.
- The `DATABASE_URL` role is neither the owner of `policies`/`policy_coverages` nor `BYPASSRLS` (§5 trusted-worker controls).
- Any statement in 6.4 or 6.5 succeeds, or any policy upload/scan/process smoke test fails.
- Any RLS test in section 6 lets a household, another household or a reviewer read or change what it should not, or any service-path check fails.
- Any bucket in section 7 is public, or a household session can reach `claim-evidence-files` directly.
- The application was deployed against this database before the migrations finished.

## 11. Why infrastructure RLS is not FORCEd

`infrastructure-rls.sql` enables RLS but does not `FORCE` it. The application's server connection (`DATABASE_URL`) is the table owner, and it relies on owner bypass, exactly as every other server-only table in this schema already does. Forcing RLS would make those tables inaccessible to the server unless the production role also has `BYPASSRLS`, which is not a documented property of this deployment. Browser roles are excluded twice: they hold no privileges at all on these tables, and the only policy on each is always-false.

## 12. Production telemetry: configured or intentionally disabled

Production refuses to start unless **exactly one** of these is set (`lib/launch/guards.ts`, `checkTelemetryProductionAdapterConfigured`):

| Setting | Meaning | Startup | `launch:check` `operational_telemetry` |
|---|---|---|---|
| `TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED=true` | A real `TelemetryAdapter` is wired in and verified | starts | ready |
| `TELEMETRY_INTENTIONALLY_DISABLED=true` | Prototype / internal testing only: knowingly running without operational telemetry | starts, with a prominent warning in the server log | blocked by external configuration (acknowledged limitation, never ready) |
| neither, or both | Misconfiguration | refuses to start | blocked by external configuration |

While telemetry is intentionally disabled:
- redaction is unchanged, and every `recordEvent()` call still goes through the same boundary; the events simply reach the `NoopTelemetryAdapter`, which emits nothing;
- **no operational alert can fire**: scan failures, stuck quarantine, dead-letter jobs, failed exports or deletions, rejected monetary calculations, reviewer-assignment expiry, model/provenance staleness and authorization failures all go unobserved;
- label every internal test session as running without operational telemetry, and check job, quarantine and dead-letter state manually (`npm run jobs:dead-letter -- list`, and the section 5 queries) at least daily;
- never use this setting with real users. Before any wider rollout, wire a real adapter, set `TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED=true` and remove `TELEMETRY_INTENTIONALLY_DISABLED`.

## 13. Internal-testing operations (current state)

This is the exact procedure for **controlled internal testing** of the prototype. It is not a production operating procedure, and DearPolicy is not production-ready.

### 13.1 Current state (2026-09-26)
- **No operational telemetry.** `TELEMETRY_INTENTIONALLY_DISABLED=true`: no alert can fire for scan failures, stuck quarantine, dead letters, failed exports or deletions, rejected calculations or authorization failures (§12). Every check below is manual. Label every test session **"running without operational telemetry"**.
- **Malware scanning:** VirusTotal, through `MALWARE_SCANNER_PROVIDER` and `VIRUSTOTAL_API_KEY` (Production only, Sensitive). No synthetic file has yet been observed going through it in production.
- **Background jobs:** processed only by `GET /api/internal/jobs/run` (`docs/production-job-topology.md`). It needs `CRON_SECRET` (Production, Sensitive; **not set** as of 2026-09-26; production refuses to start without it once the runner is merged). The project is on **Vercel Hobby**, so `vercel.json` can only schedule a **once-daily** backstop (`0 3 * * *`). Until Vercel Pro or an approved external scheduler is in place, **every test upload must be followed by a manual run** (13.3).

### 13.2 Synthetic data rules
- Only synthetic data. Never a real policy, medical or identity document, and never upload any real document to VirusTotal.
- Name everything with the prefix `SYNTHETIC-DPTEST-<yyyymmdd>-<initials>-`: household name, family members (for example `SYNTHETIC-DPTEST-20260926-DC-Parent`), uploaded file names, claim descriptions. Synthetic test accounts use an email alias you control containing `+dptest`.
- Synthetic PDFs contain only the prefix, a fictitious insurer name and made-up benefit wording. No personal, medical or real policy data.
- Never open, edit, reprocess or delete the six pre-existing policy records. Every query below aggregates counts only and never reads document contents.

### 13.3 Running the job runner by hand (Hobby only)
Preferred: as the project owner, run `vercel crons run /api/internal/jobs/run` (Vercel CLI, logged in and linked to `dearpolicy-mvp`), or use the equivalent control on the project's Cron Jobs settings page. Vercel triggers the deployed cron itself and sends the `CRON_SECRET` header, so nobody handles the secret.

Fallback, only for an operator who already holds `CRON_SECRET` (a Sensitive variable cannot be read back from Vercel):
```bash
read -rs CRON_SECRET   # paste; not echoed, not saved in shell history
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://dearpolicy-mvp.vercel.app/api/internal/jobs/run
unset CRON_SECRET
```
Deployment Protection may block direct calls to `*.vercel.app` URLs; if so, use `vercel crons run` instead. Never paste the secret into chat, tickets or a third-party scheduler without the owner's explicit approval.

**Expected result:** HTTP 200 with a counts-only body, for example `{"ok":true,"claimed":2,"byType":{"policy_processing":{"succeeded":2,"failed":0}},"recoveredLeases":0,"deadLetteredLeases":0,"stoppedBy":"empty"}`. `401` means the header is wrong. `503` means `CRON_SECRET` is not configured. `500` means the batch failed; check the Vercel function log (it logs the error class only). Repeat until `stoppedBy` is `"empty"`.

### 13.4 Checking that the trigger ran and the queue drained
1. **Invocation:** Vercel dashboard, then Settings, Cron Jobs (last run), or Logs filtered to `/api/internal/jobs/run`. Confirm a 200 at the expected time: 03:00 UTC daily, or right after a manual run.
2. **Queue drain** (read-only, as the `DATABASE_URL` role or in the SQL editor):
```sql
-- Anything queued or retrying for more than 15 minutes after a run means the runner is not working.
SELECT job_type, status, count(*), min(created_at) AS oldest
  FROM background_jobs WHERE status IN ('queued','failed_retryable','processing') GROUP BY 1,2 ORDER BY oldest;
```
Pass condition: after a manual run returns `stoppedBy: "empty"`, no `queued` rows older than the run, and no `processing` rows.

### 13.5 Leases and dead letters
```sql
-- Expired leases (a run killed mid-job). The next run returns them to failed_retryable or dead_letter.
SELECT job_type, count(*) FROM background_jobs WHERE status='processing' AND lease_expires_at < now() GROUP BY 1;
-- Dead letters.
SELECT job_type, count(*), max(updated_at) FROM background_jobs WHERE status='dead_letter' GROUP BY 1;
```
Inspect with `npm run jobs:dead-letter -- list`. Retry one job only after reading its error category: `npm run jobs:dead-letter -- retry --job=<id>`.

### 13.6 Stuck quarantine
```sql
SELECT quarantine_status, count(*), min(updated_at) FROM policies
  WHERE quarantine_status IN ('uploaded','quarantined','scan_pending') GROUP BY 1;
SELECT status, scan_status, count(*) FROM claim_evidence_documents
  WHERE status IN ('uploaded','quarantined') GROUP BY 1,2;
```
Nothing re-scans these automatically. A synthetic document stuck at `scan_pending` is re-scanned by reprocessing it from the app and then running the job runner (13.3). It must never reach processing without a clean verdict.

### 13.7 VirusTotal quota and timeouts
- Check the VirusTotal account's API usage page before and after each session. The free tier allows about 4 requests a minute and 500 a day.
- Upload at most 3 synthetic files per minute.
- A quota error, a timeout or an exhausted 60 s poll budget leaves the file on hold and shows "On hold: malware scan did not complete" (once PR #22 is merged). It is never released. Count these in 13.6.

### 13.8 Failed exports and deletions
```sql
SELECT status, count(*) FROM household_exports WHERE status IN ('pending','running','failed') GROUP BY 1;
SELECT resource_type, lifecycle_state, count(*) FROM deletion_requests WHERE completed_at IS NULL GROUP BY 1,2;
-- Reviewer assignments past expiry that were never revoked.
SELECT count(*) FROM claim_review_assignments WHERE expires_at < now() AND revoked_at IS NULL;
```
Review each failed export or unfinished deletion by hand before the next session. Do not retry a deletion by editing rows.

### 13.9 Weekly
- `npm run ai:model-execution-staleness-check`: enqueues an audit, which then needs a runner pass (13.3).
- `npm run storage:audit-orphans` (read-only). Run `npm run storage:cleanup` only after reviewing its dry run.

### 13.10 Synthetic cleanup after every session
1. Delete each synthetic household from the app (Settings, then Delete household), then run the job runner (13.3) so deletion jobs execute.
2. Confirm no rows remain, using counts only:
```sql
SELECT count(*) FROM accounts WHERE name LIKE 'SYNTHETIC-DPTEST-%';
SELECT count(*) FROM family_members WHERE display_name LIKE 'SYNTHETIC-DPTEST-%';
SELECT count(*) FROM policies WHERE original_filename LIKE 'SYNTHETIC-DPTEST-%';
```
3. Run `npm run storage:audit-orphans` and confirm no orphaned objects.
4. Revoke any synthetic reviewer assignment (Operators only, through the authorised reviewer tooling).

### 13.11 Stop conditions
**Internal testing must stop if the worker does not run reliably, quarantine can be bypassed, synthetic cleanup fails, or any unsupported positive claim amount appears.**

Also stop if any of these happen:
- a document reaches processing without a clean scan;
- a blocked benefit is shown as `$0`, or amounts in different currencies are combined;
- data from one household is visible to another;
- dead letters or stuck-quarantine counts keep growing between sessions;
- a real (non-synthetic) document is uploaded by mistake. Delete it immediately, and do not reprocess it.

### 13.12 Rollback
- **Code:** in the Vercel dashboard, go to Deployments, pick the previous production deployment, then Promote. Environment variables are not rolled back.
- **Pause background processing:** disable the job in Settings, then Cron Jobs, and stop manual runs. Jobs then stay queued (fail closed).
- **Do not remove `CRON_SECRET` to pause.** Once the runner is merged, production refuses to start without it.
- **Database:** no migration in this branch. Never roll back by editing rows.

## 14. `processing-failure-diagnostics.sql` (PR #28): application procedure

**Not applied to any live database.** Applying it needs the owner's explicit authorization. It is a data migration as well as DDL: its backfill **rewrites existing rows** of `policies`, `policy_document_audit_log`, `claim_evidence_documents` and `claim_evidence_audit_log` that hold raw failure text. That can include the existing live policy records, so the owner must approve that change specifically; the counts from P3 below show how many rows it would touch, without reading their contents.

### 14.1 What it does
- Creates the service-only `processing_failure_diagnostics` table (and its `bigserial` sequence and index).
- Copies raw failure detail into it, then replaces every household-readable copy with fixed text (`policies.processing_error`, `policies.scan_result_detail`, `claim_evidence_documents.processing_error`, the `processing_failed` reasons in `claim_evidence_audit_log`, the `scan_attempt_failed` reasons in `policy_document_audit_log`).
- Idempotent: every step touches only rows that still hold something other than the fixed text.

### 14.2 Order and coupling
- **Requires** 1–17 of §3 (it reads the audit logs and evidence tables) and PR #22's code (#28 is stacked on #22). Merge order: **#22 → #28 → #30**.
- **Must be applied in the same transaction as the updated `infrastructure-rls.sql` from the same commit.** Supabase's default privileges grant `anon`/`authenticated` on every new table in `public`, so between `CREATE TABLE` and the `REVOKE` in `infrastructure-rls.sql` the raw detail would be browser-readable. The CI rehearsal proves both the window (negative control) and that the single transaction closes it.
- Code vs schema: `recordProcessingFailure()` never throws, so a build deployed **before** the migration loses diagnostics but still stores only fixed text. A migration applied **before** the deploy leaves the old build writing raw text into household-readable columns until the new build is live. Therefore: apply → deploy → **re-run the same transaction once** to scrub anything written in between (a no-op if nothing was).

### 14.3 Steps (owner, staging first)
1. §1 prerequisites and §2 backup/recovery point. Record the PITR timestamp.
2. Pre-checks, read-only, counts and catalog facts only:
   `psql -v ON_ERROR_STOP=1 -f sql/checks/processing-failure-diagnostics-pre.sql`
   Expected: P1 all `t`; P2 `f`; P3 five non-negative counts (record them; these rows will be rewritten); P4 shows the default ACL (for the ticket).
3. Apply both files atomically, as the table owner:
   `psql -v ON_ERROR_STOP=1 --single-transaction -f sql/processing-failure-diagnostics.sql -f sql/infrastructure-rls.sql`
4. Post-checks: `psql -v ON_ERROR_STOP=1 -f sql/checks/processing-failure-diagnostics-post.sql`
   Expected: Q1 and Q2 every column `t`; Q3 every count `0`; Q4 `diagnostics_rows` ≥ the sum of P3.
5. Browser-role probe (rolled back): `BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM processing_failure_diagnostics; ROLLBACK;` must fail with `permission denied`.
6. Deploy the build, then repeat step 3 once and step 4 (Q3 must still be 0).
7. Staging only: trigger one synthetic failure (a synthetic PDF that fails processing) and confirm the household sees only the fixed message while one new diagnostics row exists.

### 14.4 Abort conditions
- P1 has any `f`, or P2 is `t` with a different shape: stop.
- Any error during step 3: the single transaction rolls back completely; nothing changed. Stop and investigate.
- Q2 has any `f`: run `sql/infrastructure-rls.sql` again immediately (it only removes browser privileges), then re-check.

### 14.5 Rollback
- The table: `DROP TABLE processing_failure_diagnostics;` is safe only while nothing depends on its contents (it is diagnostics only). Keep it unless it causes harm.
- The backfill is **not reversible from the database alone**: the fixed text replaced the raw text in household-readable columns, and the only copy of the raw text is in the diagnostics table (restorable by joining on `resource_id`) or in the §2 backup. Do not copy raw text back into household-readable columns; that re-opens the leak this migration closes. Full rollback = PITR to the §2 recovery point.

### 14.6 Rehearsed in CI
`npm run security:processing-failure-migration-procedure-test` (`scripts/processing-failure-migration-procedure-regressions.ts`) runs these exact pre/post SQL files on a PGlite database with every earlier migration applied, Supabase-style default grants and synthetic raw-text rows, applies both files in one transaction, re-applies it (no-op), and shows that applying the migration alone leaves the table readable by `authenticated` (negative control). PGlite is not Supabase; the live run is still required and is not done.
