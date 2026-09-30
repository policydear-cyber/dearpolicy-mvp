#!/usr/bin/env bash
# Local rehearsal of the pending release migration on a DISPOSABLE local
# PostgreSQL database (never a live one). Usage:
#   REHEARSAL_DATABASE_URL=postgresql://user:pass@localhost:5432/rehearsal scripts/release-migration-rehearsal.sh
# The database is dropped and recreated. Synthetic rows only.
set -euo pipefail
URL="${REHEARSAL_DATABASE_URL:?set REHEARSAL_DATABASE_URL to a disposable LOCAL database}"
HOST=$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$URL")
case "$HOST" in localhost|127.0.0.1) ;; *) echo "refusing non-local host $HOST"; exit 2;; esac
DB=$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$URL")
ADMIN=$(node -e 'const u=new URL(process.argv[1]);u.pathname="/postgres";console.log(u.toString())' "$URL")
P=(psql "$URL" -v ON_ERROR_STOP=1 -q)
psql "$ADMIN" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS \"$DB\"" -c "CREATE DATABASE \"$DB\""
echo "1. schema as currently live (every file except the pending migration)"
for f in schema benefit-catalog claim-evidence claim-composition critical-illness disability cover-conditions model-usage chat-upgrade coverage-ledger background-jobs rate-limit lifecycle claim-reviewers model-provenance storage-purge household-rls infrastructure-rls; do "${P[@]}" -f "sql/$f.sql" >/dev/null; done
echo "2. Supabase-style default grants and synthetic raw-text rows"
"${P[@]}" <<'SQL'
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
INSERT INTO accounts(id,name) VALUES ('73000000-0000-4000-8000-000000000001','SYNTHETIC rehearsal household');
INSERT INTO family_members(id,account_id,display_name,relationship) VALUES ('73000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001','SYNTHETIC member','self');
INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,processing_status,quarantine_status,scan_result_detail,processing_error)
  VALUES ('73000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002','synthetic.pdf','k','failed','scan_pending','SYNTHETIC VirusTotal analysis x: malicious=0','SYNTHETIC raw failure ECONNREFUSED');
SQL
echo "3. preflight (count-only)"; "${P[@]}" -A -f sql/checks/release-preflight.sql
echo "4. failure injection: an error inside the transaction applies nothing"
echo "SELECT 1/0;" > /tmp/release-rehearsal-boom.sql
if "${P[@]}" --single-transaction -f sql/processing-failure-diagnostics.sql -f /tmp/release-rehearsal-boom.sql >/dev/null 2>&1; then echo "expected failure"; exit 1; fi
test "$("${P[@]}" -Atc "select to_regclass('public.processing_failure_diagnostics') is null")" = t
echo "5. apply (one transaction)"; start=$(date +%s%N)
"${P[@]}" --single-transaction -f sql/processing-failure-diagnostics.sql -f sql/infrastructure-rls.sql >/dev/null 2>&1
echo "   applied in $(( ($(date +%s%N)-start)/1000000 )) ms"
echo "6. post-check (every boolean t, every count 0)"; "${P[@]}" -A -f sql/checks/processing-failure-diagnostics-post.sql
echo "7. browser role denied"; if "${P[@]}" -c "BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM processing_failure_diagnostics; ROLLBACK;" >/dev/null 2>&1; then echo "authenticated could read diagnostics"; exit 1; fi
echo "8. re-apply is a no-op"; "${P[@]}" --single-transaction -f sql/processing-failure-diagnostics.sql -f sql/infrastructure-rls.sql >/dev/null 2>&1
test "$("${P[@]}" -Atc "select count(*) from processing_failure_diagnostics")" = 2
echo "REHEARSAL PASSED"
