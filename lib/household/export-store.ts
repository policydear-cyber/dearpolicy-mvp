/**
 * Household export request lifecycle (checkpoint 6,
 * claude/v1-launch-hardening): idempotency, status transitions, expiry,
 * and audit for household_exports/household_export_audit_log. Content
 * generation itself is lib/household/export.ts's job; this module only
 * owns the row.
 *
 * Deliberately plain-pool access (not lib/db/authz-client.ts's RLS-scoped
 * client) with an explicit household_id predicate on every query --
 * mirroring exactly how lib/policies/quarantine/store.ts and
 * lib/storage/cleanup.ts's audit/lock tables are accessed in this
 * codebase: an audit/job-tracking table is not itself household-owned
 * *content* a member browses through the RLS-mediated read path, it is
 * infrastructure state a route handler manages directly, with its own
 * explicit authorization check (the route's own requireHouseholdContext()
 * call) standing in for RLS here, exactly as those other tables do.
 */

export type Db = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type HouseholdExportStatus = "pending" | "running" | "ready" | "failed" | "expired";

export interface HouseholdExportRow {
  id: string;
  household_id: string;
  requested_by: string;
  idempotency_key: string;
  status: HouseholdExportStatus;
  schema_version: number;
  storage_key: string | null;
  byte_size: number | null;
  manifest_hash: string | null;
  error: string | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

export const HOUSEHOLD_EXPORT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const EXPORT_COLUMNS =
  "id, household_id, requested_by, idempotency_key, status, schema_version, storage_key, byte_size, manifest_hash, error, requested_at, completed_at, expires_at";

/** Idempotent create: a repeated request with the same (householdId,
 * idempotencyKey) pair always resolves to the SAME row, whatever its
 * current status -- never a second export, never an error. Distinguishes
 * "just created" from "already existed" so the caller can decide whether
 * to kick off generation. */
export async function createOrGetExportRequest(
  db: Db,
  args: { householdId: string; requestedBy: string; idempotencyKey: string },
): Promise<{ row: HouseholdExportRow; isNew: boolean }> {
  const inserted = await db.query<HouseholdExportRow>(
    `INSERT INTO household_exports(household_id, requested_by, idempotency_key)
     VALUES ($1,$2,$3)
     ON CONFLICT (household_id, idempotency_key) DO NOTHING
     RETURNING ${EXPORT_COLUMNS}`,
    [args.householdId, args.requestedBy, args.idempotencyKey],
  );
  if (inserted.rows.length === 1) {
    return { row: inserted.rows[0], isNew: true };
  }
  const existing = await db.query<HouseholdExportRow>(
    `SELECT ${EXPORT_COLUMNS} FROM household_exports WHERE household_id=$1 AND idempotency_key=$2`,
    [args.householdId, args.idempotencyKey],
  );
  if (existing.rows.length === 0) {
    // Vanishingly unlikely (a concurrent request would have to insert
    // AND be deleted between our INSERT and this SELECT), but never
    // silently return undefined -- surface it as a genuine error rather
    // than a confusing downstream null-pointer.
    throw new Error(`household_exports row for (${args.householdId}, ${args.idempotencyKey}) not found after a conflicting insert.`);
  }
  return { row: existing.rows[0], isNew: false };
}

/** CAS: pending|failed -> running. `failed` is included as a valid
 * starting state deliberately -- a repeated request with the same
 * idempotency key against a row that failed (a transient storage/DB
 * error, not a settled outcome the way `ready` or `expired` are) should
 * retry, not stay permanently broken under that key. `ready` and
 * `expired` are never accepted here: once an export has genuinely
 * succeeded (even if it has since expired), that idempotency key's
 * result is fixed -- a distinct new export uses a distinct new key.
 * Returns null (never throws) if the row was not in `pending`/`failed`
 * at the moment of this UPDATE -- the caller should treat that as
 * "generation is already running or already settled" and act on the
 * row's actual current status rather than starting a second generation. */
export async function markExportRunning(db: Db, exportId: string): Promise<HouseholdExportRow | null> {
  const { rows } = await db.query<HouseholdExportRow>(
    `UPDATE household_exports SET status='running', error=NULL WHERE id=$1 AND status IN ('pending','failed') RETURNING ${EXPORT_COLUMNS}`,
    [exportId],
  );
  return rows[0] ?? null;
}

/** CAS: running -> ready. */
export async function markExportReady(
  db: Db,
  exportId: string,
  args: { storageKey: string; byteSize: number; manifestHash: string; expiresAt: Date },
): Promise<HouseholdExportRow | null> {
  const { rows } = await db.query<HouseholdExportRow>(
    `UPDATE household_exports SET status='ready', storage_key=$2, byte_size=$3, manifest_hash=$4, completed_at=now(), expires_at=$5
     WHERE id=$1 AND status='running' RETURNING ${EXPORT_COLUMNS}`,
    [exportId, args.storageKey, args.byteSize, args.manifestHash, args.expiresAt.toISOString()],
  );
  return rows[0] ?? null;
}

/** CAS: running -> failed. `error` is a short, operator-facing message --
 * callers must not pass a raw provider/database error string through
 * here; that is exactly the "internal security telemetry"/"raw provider
 * payload" content the export itself must never surface, and this field
 * is never included in the export snapshot, only shown on the request's
 * own status endpoint to the household that requested it. */
export async function markExportFailed(db: Db, exportId: string, error: string): Promise<HouseholdExportRow | null> {
  const { rows } = await db.query<HouseholdExportRow>(
    `UPDATE household_exports SET status='failed', error=$2, completed_at=now() WHERE id=$1 AND status='running' RETURNING ${EXPORT_COLUMNS}`,
    [exportId, error],
  );
  return rows[0] ?? null;
}

/** Scoped lookup: returns null for a genuinely missing id AND for an id
 * that belongs to a different household -- the same indistinguishable-404
 * convention every other route in this codebase follows (see
 * lib/auth/request-context.ts's routeErrorResponse() doc comment), so a
 * caller can never learn that an export id exists at all if it isn't
 * theirs. */
export async function getExportRow(db: Db, householdId: string, exportId: string): Promise<HouseholdExportRow | null> {
  const { rows } = await db.query<HouseholdExportRow>(`SELECT ${EXPORT_COLUMNS} FROM household_exports WHERE id=$1 AND household_id=$2`, [
    exportId,
    householdId,
  ]);
  return rows[0] ?? null;
}

export async function listRecentExports(db: Db, householdId: string, limit = 20): Promise<HouseholdExportRow[]> {
  const { rows } = await db.query<HouseholdExportRow>(
    `SELECT ${EXPORT_COLUMNS} FROM household_exports WHERE household_id=$1 ORDER BY requested_at DESC LIMIT $2`,
    [householdId, limit],
  );
  return rows;
}

/** CAS: running -> failed, but only for a row whose background job is no
 * longer actually working on it. Stage 6A / Defects D10-D11 follow-up:
 * lib/jobs/queue.ts's recoverExpiredLeases() already reclaims a crashed
 * worker's LEASE so a live retry can happen, and
 * generateAndStoreHouseholdExport()'s own catch block already marks the
 * row `failed` on every attempt that runs long enough to throw a
 * catchable error -- but neither converges the row if every attempt
 * dies before that catch block runs (a hard process crash, not a thrown
 * JS error): the background job eventually reaches `dead_letter` while
 * the row itself is never told. The same is true, with no retries at
 * all, for the narrower race in app/api/household/export/route.ts's
 * POST handler: markExportRunning()'s CAS can commit and then the very
 * next call, enqueueHouseholdExport(), can throw -- leaving `running`
 * with zero background_jobs row ever created for it.
 *
 * A row is only reaped once `requested_at` is older than `staleAfterMs`
 * (comfortably longer than the brief window between that CAS and the
 * following enqueue call actually committing, but far short of
 * "forever") AND no background_jobs row for this export is in an
 * actively-working state (`queued`/`processing`/`failed_retryable`) --
 * so a legitimately in-progress or still-retrying export is never
 * raced. The `error` recorded is the same safe, generic, non-internal
 * message markExportFailed()'s own callers already use -- never a raw
 * job status or error string. */
export const DEFAULT_STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export async function reapStaleRunningExports(
  db: Db,
  staleAfterMs: number = DEFAULT_STALE_RUNNING_THRESHOLD_MS,
): Promise<HouseholdExportRow[]> {
  const { rows } = await db.query<HouseholdExportRow>(
    `UPDATE household_exports he
     SET status='failed', error=$1, completed_at=now()
     WHERE he.status='running'
       AND he.requested_at < now() - ($2 || ' milliseconds')::interval
       AND NOT EXISTS (
         SELECT 1 FROM background_jobs bj
         WHERE bj.job_type='household_export'
           AND bj.idempotency_key = he.id::text
           AND bj.status IN ('queued','processing','failed_retryable')
       )
     RETURNING ${EXPORT_COLUMNS}`,
    ["Export generation did not complete. Please try again.", staleAfterMs],
  );
  for (const row of rows) {
    await appendExportAudit(db, {
      householdId: row.household_id,
      exportId: row.id,
      actor: null,
      action: "generation_failed",
      detail: "reaped: stuck running with no actively-working background job",
    });
  }
  return rows;
}

export type ExportAuditAction = "requested" | "generated" | "generation_failed" | "downloaded" | "expired" | "deleted";

export async function appendExportAudit(
  db: Db,
  entry: { householdId: string; exportId: string | null; actor: string | null; action: ExportAuditAction; detail?: string },
): Promise<void> {
  await db.query(`INSERT INTO household_export_audit_log(household_id, export_id, actor, action, detail) VALUES ($1,$2,$3,$4,$5)`, [
    entry.householdId,
    entry.exportId,
    entry.actor,
    entry.action,
    entry.detail ?? null,
  ]);
}

/** Lazy expiry: if `row` is `ready` and past its `expires_at`, deletes its
 * storage object (via `deleteObject`, so the caller supplies the right
 * driver -- local or Supabase -- without this module needing to know
 * which), flips it to `expired` via a CAS (safe if two requests both
 * trigger this for the same row at once: only one UPDATE actually
 * matches `status='ready'`), records an audit row, and returns the
 * updated row. A row that is not ready, or not yet past expiry, is
 * returned unchanged. Called from both the status endpoint and the
 * download endpoint, so an expired export is *never* servable regardless
 * of which route notices first -- this is the feature's primary cleanup
 * path; scripts/household-export-cleanup.ts (a proactive sweep for
 * exports nobody ever polls again) is the secondary one. */
export async function expireIfPast(
  db: Db,
  row: HouseholdExportRow,
  deleteObject: (storageKey: string) => Promise<void>,
  now: number = Date.now(),
): Promise<HouseholdExportRow> {
  if (row.status !== "ready" || !row.expires_at) return row;
  if (now < Date.parse(row.expires_at)) return row;

  if (row.storage_key) {
    try {
      await deleteObject(row.storage_key);
    } catch {
      // If deletion fails here, the row still flips to `expired` below
      // (so it is never served again) and the object becomes an orphan
      // candidate for the general storage-cleanup sweep
      // (lib/storage/cleanup.ts's `household-export` domain) to catch --
      // never left servable just because its own cleanup step hiccuped.
    }
  }
  const { rows } = await db.query<HouseholdExportRow>(
    `UPDATE household_exports SET status='expired', storage_key=NULL WHERE id=$1 AND status='ready' RETURNING ${EXPORT_COLUMNS}`,
    [row.id],
  );
  if (rows[0]) {
    await appendExportAudit(db, { householdId: row.household_id, exportId: row.id, actor: null, action: "expired" });
    return rows[0];
  }
  // The CAS matched zero rows -- a concurrent call (another request that
  // also read this row while it was still `ready`) already flipped it.
  // Re-read the current, authoritative state rather than returning our
  // now-stale `row` argument, which would otherwise still claim `ready`
  // (with a storage_key that has already been deleted out from under it)
  // even though the database has already moved on.
  const { rows: fresh } = await db.query<HouseholdExportRow>(`SELECT ${EXPORT_COLUMNS} FROM household_exports WHERE id=$1`, [row.id]);
  return fresh[0] ?? row;
}
