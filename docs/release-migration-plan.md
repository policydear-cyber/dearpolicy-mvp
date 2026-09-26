# Release migration plan (pending: `processing-failure-diagnostics.sql`)

Status: **prepared, not applied.** Applying anything to the live database requires the owner's explicit approval (§9). Nothing in this document has been run against the live database except the read-only, count-only preflight in §2.

## 1. Inventory: SQL changed since the live database was last updated

The live schema was compared (read-only catalog metadata) with the repository's SQL applied to an empty local PostgreSQL 17 database on 2026-09-27.

| Check | Live | Repository without the pending file | Result |
|---|---|---|---|
| Public tables | 45 | 45 | equal |
| Columns per table (all 45) | — | — | identical names |
| RLS policies (public) | 103 | 103 | equal |
| Non-internal triggers (public) | 6 | 6 | equal |
| Tables without RLS | 0 | 0 | equal |

So exactly **one** change is pending: `sql/processing-failure-diagnostics.sql` (from former PR #28), plus the one-line change to `sql/infrastructure-rls.sql` that adds the new table to its service-only list. No other file differs from the live state.

### What the pending migration does
- **New table** `processing_failure_diagnostics` (`bigserial` id and sequence, FK to `accounts ON DELETE CASCADE`, CHECK on `resource_type`, index `idx_processing_failure_diagnostics_resource`). It is service-only: after `infrastructure-rls.sql` it has RLS on, a single always-false policy, and no privileges for `PUBLIC`, `anon` or `authenticated`.
- **Backfill (existing-row rewrite):** copies raw failure text into the new table, then replaces household-readable copies with fixed text:
  - `policies.processing_error` and `policies.scan_result_detail`;
  - `claim_evidence_documents.processing_error`;
  - `claim_evidence_audit_log.reason` (only `processing_failed` rows);
  - `policy_document_audit_log.reason` (only `scan_attempt_failed` rows).
- No new columns, triggers or grants on existing tables. No change to ownership, lifecycle, amounts or links.

## 2. Live preflight (read-only, count-only) — run 2026-09-27

`sql/checks/release-preflight.sql` returns counts and booleans only. Result:

| Item | Value |
|---|---|
| diagnostics table exists | false |
| household RLS applied | true |
| rows to rewrite: `policies.processing_error` | **0** |
| rows to rewrite: `policies.scan_result_detail` | **0** |
| rows to rewrite: `claim_evidence_documents.processing_error` | **0** |
| rows to rewrite: `claim_evidence_audit_log` | **0** |
| rows to rewrite: `policy_document_audit_log` | **0** |
| policies total | 6 (none has a processing error or scan detail) |
| default ACL entries granting `authenticated` on new tables | **2** |
| background jobs pending / dead-lettered | 0 / 0 |

**The backfill would rewrite no existing row.** The six existing policy records are counted but not changed. The default-ACL result confirms that Supabase grants browser roles on new tables, so the single-transaction rule in §3 is required, not optional.

## 3. Order, transaction boundary, role
1. Run as the table owner (Supabase `postgres`), never `authenticated`, `anon` or `service_role`.
2. Take a backup or record the PITR point (runbook §2).
3. Run the preflight. It must match §2; stop if any rewrite count is non-zero without a separate approval for those rows.
4. **One transaction, both files, this order:**
   `psql -v ON_ERROR_STOP=1 --single-transaction -f sql/processing-failure-diagnostics.sql -f sql/infrastructure-rls.sql`
   `psql` wraps every `-f` in one transaction. The local rehearsal proves that an error in the second file leaves nothing applied.
5. Post-check: `sql/checks/processing-failure-diagnostics-post.sql`. Every boolean must be `t` and every rewrite count `0`.
6. Browser probe (rolled back): `BEGIN; SET LOCAL ROLE authenticated; SELECT count(*) FROM processing_failure_diagnostics; ROLLBACK;` must fail with `permission denied`.

## 4. Locks and downtime
- `infrastructure-rls.sql` takes a brief `ACCESS EXCLUSIVE` lock per service-only table (19) for `ENABLE ROW LEVEL SECURITY` and the policy changes. The locks are held until commit.
- The backfill `UPDATE`s scan `policies` (6 rows), `claim_evidence_documents` (0 rows) and the audit logs, and match nothing.
- Rehearsed apply time on real PostgreSQL 17 with the full schema: **72–74 ms**.
- Expected downtime: none planned. Apply while the app is idle (no upload in progress) so a request does not wait on the brief lock.

## 5. Application compatibility and deployment order
The application is already deployed (`main`) and works on every schema state:

| Schema state | Behaviour (rehearsed) |
|---|---|
| Old (table absent — current live) | `recordProcessingFailure()` catches the error and logs its class only. Household-readable columns receive fixed text only. No request fails. |
| Migration without `infrastructure-rls.sql` | **Unsafe:** `authenticated` could read raw detail (negative control). Prevented by the single transaction. |
| Final | Raw detail is written server-side. Browsers are denied. The household still reads its own policy row, with the fixed message. |

Deployment order: the code is already live, so apply the migration → re-apply the same transaction once (a no-op if nothing was written in between) → post-check. No redeploy is needed.

## 6. Rollback and recovery
- The backfill is not reversible from the database alone, and must not be reversed: copying raw text back would reopen the leak. With 0 rows to rewrite today, nothing is lost either way.
- `DROP TABLE processing_failure_diagnostics` is safe: diagnostics only, and the application tolerates its absence. The rehearsal proves that dropping it does not re-expose raw text, and that re-applying the transaction restores it with no browser access (forward repair).
- Full rollback: PITR to the recorded point.
- Re-apply requirement: whenever `household-rls.sql` is re-run, re-run `infrastructure-rls.sql` afterwards (runbook §3).

## 7. Rehearsal evidence (local, synthetic)
- `npm run security:processing-failure-migration-procedure-test` (PGlite, Supabase-style default grants): 8 cases. They cover:
  - count-only preflight;
  - single-transaction apply;
  - post-check;
  - idempotent re-apply;
  - negative control (migration alone is readable);
  - old / final application compatibility;
  - ownership unchanged;
  - rollback without re-exposure, then forward repair.
- `scripts/release-migration-rehearsal.sh` (real PostgreSQL 17 + psql, disposable local database):
  - failure injection applies nothing;
  - apply takes 72 ms;
  - post-check is all `t`, rewrite counts are 0, diagnostics rows are 2;
  - `authenticated` is denied;
  - re-apply is a no-op.

## 8. Readiness checklist (owner)
- [ ] Backup / PITR point recorded
- [ ] Preflight re-run on the day and matches §2
- [ ] App idle (no uploads in progress)
- [ ] Single-transaction apply as `postgres`
- [ ] Post-check all `t` and `0`; browser probe denied
- [ ] Transaction re-applied once; post-check repeated
- [ ] Result pasted into the change ticket

## 9. Approval needed
Written approval from the owner to run §3 steps 4–6 on project `dear-policy` (`ejpgjqqhdxupnvpopnkt`). No other live change is part of this release.
