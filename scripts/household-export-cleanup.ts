/**
 * Proactive sweep for household exports nobody ever polled again after
 * they expired (checkpoint 6). The PRIMARY cleanup path is lazy: every
 * status/download request already calls lib/household/export-store.ts's
 * expireIfPast() itself, so an expired export is never servable the next
 * time anyone asks about it. This script exists for the export nobody
 * ever asks about again -- its storage object would otherwise sit there
 * indefinitely. Safe to run repeatedly / on a schedule (idempotent: an
 * already-expired row is simply skipped).
 *
 * Read-only by default (`--dry-run`, also the default with no flags);
 * pass `--delete` to actually expire+clean up what it finds.
 */
import path from "node:path";
import { pool } from "../lib/db/client";
import { expireIfPast, reapStaleRunningExports, DEFAULT_STALE_RUNNING_THRESHOLD_MS, type HouseholdExportRow } from "../lib/household/export-store";
import { deleteHouseholdExportFile } from "../lib/storage";

async function findPastDueReadyExports(): Promise<HouseholdExportRow[]> {
  const { rows } = await pool.query<HouseholdExportRow>(
    `SELECT id, household_id, requested_by, idempotency_key, status, schema_version, storage_key, byte_size, manifest_hash, error, requested_at, completed_at, expires_at
       FROM household_exports WHERE status='ready' AND expires_at IS NOT NULL AND expires_at < now()
       ORDER BY expires_at ASC`,
  );
  return rows;
}

/** Preview counterpart to reapStaleRunningExports() -- read-only, so the
 * dry-run path below can report what WOULD be reaped without mutating
 * anything (mirroring findPastDueReadyExports()'s own preview/act
 * split). */
async function findStaleRunningExports(staleAfterMs: number): Promise<HouseholdExportRow[]> {
  const { rows } = await pool.query<HouseholdExportRow>(
    `SELECT id, household_id, requested_by, idempotency_key, status, schema_version, storage_key, byte_size, manifest_hash, error, requested_at, completed_at, expires_at
       FROM household_exports he
       WHERE he.status='running'
         AND he.requested_at < now() - ($1 || ' milliseconds')::interval
         AND NOT EXISTS (
           SELECT 1 FROM background_jobs bj
           WHERE bj.job_type='household_export' AND bj.idempotency_key = he.id::text
             AND bj.status IN ('queued','processing','failed_retryable')
         )
       ORDER BY requested_at ASC`,
    [staleAfterMs],
  );
  return rows;
}

async function main() {
  try {
    process.loadEnvFile(path.resolve(".env.local"));
  } catch {
    /* .env.local is optional outside local dev */
  }

  const deleteRequested = process.argv.includes("--delete");
  const pastDue = await findPastDueReadyExports();
  const staleRunning = await findStaleRunningExports(DEFAULT_STALE_RUNNING_THRESHOLD_MS);

  if (pastDue.length === 0 && staleRunning.length === 0) {
    console.log("No past-due ready exports and no stuck \"running\" exports found -- nothing to clean up.");
    await pool.end();
    return;
  }

  if (pastDue.length > 0) {
    console.log(`${pastDue.length} past-due ready export(s) found:`);
    for (const row of pastDue) console.log(`  - id=${row.id} household=${row.household_id} expiredAt=${row.expires_at}`);
  }
  if (staleRunning.length > 0) {
    console.log(
      `${staleRunning.length} stuck "running" export(s) found (no actively-working background job, ` +
        `requested more than ${DEFAULT_STALE_RUNNING_THRESHOLD_MS / 60000} minute(s) ago):`,
    );
    for (const row of staleRunning) console.log(`  - id=${row.id} household=${row.household_id} requestedAt=${row.requested_at}`);
  }

  if (!deleteRequested) {
    console.log("\nDry run (default): nothing was cleaned up. Re-run with --delete to expire/reap these.");
    await pool.end();
    return;
  }

  let cleaned = 0;
  for (const row of pastDue) {
    const updated = await expireIfPast(pool, row, deleteHouseholdExportFile);
    if (updated.status === "expired") cleaned++;
  }
  console.log(`\nExpired and cleaned up ${cleaned}/${pastDue.length} export(s).`);

  const reaped = await reapStaleRunningExports(pool, DEFAULT_STALE_RUNNING_THRESHOLD_MS);
  console.log(`Reaped ${reaped.length}/${staleRunning.length} stuck "running" export(s) to "failed".`);
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
