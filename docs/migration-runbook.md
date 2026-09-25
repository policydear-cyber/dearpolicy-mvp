# DearPolicy database migration runbook

For the operator applying `sql/*.sql` to a Supabase Postgres database (staging first, then production).
Nothing here has been run against any live database. Placeholders look like `<LIKE_THIS>`; this file contains no real credentials or identifiers.

## 0. Ground rules

- Apply to **staging first**, run every check in sections 5-7 there, and only then schedule production.
- Apply migrations **before** deploying the application build that needs them. The app lazily re-applies `claim-evidence.sql`, `critical-illness.sql`, `disability.sql` and `claim-reviewers.sql` at runtime (`lib/claims/evidence/*schema.ts`, `lib/claims/reviewers/schema.ts`). If those tables were created that way *after* `household-rls.sql` ran, they would carry Supabase's default grants and none of the household guards.
- Do **not** use `npm run db:setup` for staging or production. `scripts/setup-db.ts` is a local-development helper: it omits `model-provenance.sql`, `rate-limit.sql`, `background-jobs.sql` and `storage-rls.sql`.
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
| 16 | `household-rls.sql` | **all of 1-15** | Enables RLS and policies on every household table. Narrows the evidence tables (a column grant plus a guard trigger that depend on 14's `lifecycle_state`), the three decision tables (8, 9, 10), `model_executions` (11), `scan_provider_events` and the audit logs (1, 8). Each optional block is `to_regclass`-guarded, so running it too early silently skips protections. **It must be the last public-schema migration.** |
| 17 | `storage-rls.sql` | 16, Supabase Storage | Uses `is_household_member()` from 16 (it raises an exception if that is missing). The household object policies cover only `policy-files`; `claim-evidence-files` has no household access. Forces both app buckets private. |

Any later change to 1-15 must be followed by re-running 16 (and then 17).

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
 AND tgname IN ('guard_household_evidence_update','guard_household_decision_retirement','claim_reviewer_audit_log_append_only')
 ORDER BY 1;  -- 1 evidence + 3 decision + 1 reviewer audit = 5 rows

-- 5.5 Lifecycle columns exist on evidence.
SELECT column_name FROM information_schema.columns WHERE table_name='claim_evidence_documents' AND column_name IN ('lifecycle_state','lifecycle_version');

-- 5.6 Tables a browser JWT could reach without RLS (review every row).
SELECT c.relname FROM pg_class c
 WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND NOT c.relrowsecurity
   AND has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE');
```

Check 5.6 is expected to list some infrastructure tables (for example `background_jobs`, `deletion_requests`, `rate_limit_buckets`, the storage-cleanup and export tables). They carry no RLS in this release and, under Supabase's default grants, are reachable by any signed-in user through the Data API. **Before production**, either restrict the Data API's exposed schemas so `public` is not served, or revoke `authenticated` on those tables. Record which you did. See the abort conditions in section 10.

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
ROLLBACK;
```

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
| household-rls.sql | Re-apply the `household-rls.sql` from the previously deployed commit, then restore grants from `pre_table_grants.csv` and `pre_column_grants.csv`. Note: this re-opens the household write paths that this release closed. Prefer staying on the new file and fixing forward. |
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
- Any check in section 5 differs from its expected result.
- Check 5.6 lists a table holding household data, or the infrastructure tables it lists are still reachable through the Data API with no recorded mitigation (production only).
- Any RLS test in section 6 lets a household, another household or a reviewer read or change what it should not, or any service-path check fails.
- Any bucket in section 7 is public, or a household session can reach `claim-evidence-files` directly.
- The application was deployed against this database before the migrations finished.
