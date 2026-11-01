/**
 * Round 5 (privacy): deleted documents' files are actually removed.
 *
 * Deleting a document soft-deletes its row (the lifecycle needs the row and
 * its audit trail) and used to leave the stored file for a "later storage-
 * cleanup pass" that only an operator script ran; deleting a household
 * removed its rows and left every file behind. The UI promises permanent
 * deletion, so:
 *
 *  - every storage object of a deleted document, claim-evidence document or
 *    household is recorded in storage_purge_queue (no foreign key: the keys
 *    survive a household's cascade), and
 *  - drainStoragePurge() removes them with the existing storage-cleanup
 *    drivers (lib/storage/cleanup.ts: local disk or Supabase Storage),
 *    right after the deletion completes and again from the request drain,
 *    so a failure is retried automatically.
 *
 * Idempotent and retry-safe: enqueueing is ON CONFLICT DO NOTHING; an object
 * already gone counts as removed; a key an active row still references (a
 * shared object) is never removed; failures back off and retry, bounded.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/lib/db/client";
import { localCleanupDriver, supabaseCleanupDriver, type StorageCleanupDriver, type StorageDomain, type StorageDriverName } from "./cleanup";

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> };
const dbOf = (db?: Db): Db => db ?? (pool as unknown as Db);

type PurgeGlobals = { __dearpolicyStoragePurgeSchema?: Promise<void> };
export async function ensureStoragePurgeSchema(db?: Db) {
  const state = globalThis as PurgeGlobals;
  if (db) { await db.query(await readFile(path.join(process.cwd(), "sql/storage-purge.sql"), "utf8")); return; }
  state.__dearpolicyStoragePurgeSchema ??= (async () => {
    await dbOf().query(await readFile(path.join(process.cwd(), "sql/storage-purge.sql"), "utf8"));
  })().catch((error) => { delete state.__dearpolicyStoragePurgeSchema; throw error; });
  await state.__dearpolicyStoragePurgeSchema;
}

export function activeStorageDriverName(env: NodeJS.ProcessEnv = process.env): StorageDriverName {
  const explicit = (env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (explicit === "local" || explicit === "supabase") return explicit;
  return env.SUPABASE_URL ? "supabase" : "local";
}
/** The same roots and buckets lib/storage/local.ts / supabase.ts write to. */
export function purgeDriverFor(domain: StorageDomain, env: NodeJS.ProcessEnv = process.env): StorageCleanupDriver {
  if (activeStorageDriverName(env) === "supabase")
    return supabaseCleanupDriver(domain === "policy" ? env.SUPABASE_STORAGE_BUCKET ?? "policy-files" : domain === "claim-evidence" ? env.SUPABASE_CLAIM_EVIDENCE_BUCKET ?? "claim-evidence-files" : env.SUPABASE_HOUSEHOLD_EXPORT_BUCKET ?? "household-exports");
  return localCleanupDriver(domain === "policy" ? env.LOCAL_STORAGE_DIR ?? "./data/storage" : domain === "claim-evidence" ? env.LOCAL_CLAIM_EVIDENCE_DIR ?? "./data/claim-evidence" : env.LOCAL_HOUSEHOLD_EXPORT_DIR ?? "./data/household-exports");
}

export type PurgeItem = { domain: StorageDomain; storageKey: string };
export async function enqueueStoragePurge(items: PurgeItem[], reason: string, db?: Db) {
  const unique = [...new Map(items.filter((i) => i.storageKey).map((i) => [i.domain + "|" + i.storageKey, i])).values()];
  if (!unique.length) return 0;
  await ensureStoragePurgeSchema(db);
  const r = await dbOf(db).query(
    `INSERT INTO storage_purge_queue(storage_domain,storage_key,reason)
     SELECT * FROM unnest($1::text[],$2::text[],$3::text[])
     ON CONFLICT (storage_domain,storage_key) DO UPDATE
       SET purged_at=NULL, attempts=0, last_error=NULL, next_attempt_at=now(), reason=EXCLUDED.reason
       WHERE storage_purge_queue.purged_at IS NOT NULL`,
    [unique.map((i) => i.domain), unique.map((i) => i.storageKey), unique.map(() => reason)]);
  return r.rowCount ?? 0;
}
/** Every stored object of a household, collected before its rows cascade
 * away. `inTransaction`: each read runs under a savepoint so a missing
 * optional table cannot abort the caller's transaction. */
export async function householdStorageKeys(householdId: string, db?: Db, inTransaction = false): Promise<PurgeItem[]> {
  const q = dbOf(db);
  const rows = async (table: string, owner: string, domain: StorageDomain) => {
    if (inTransaction) await q.query(`SAVEPOINT purge_keys`);
    try {
      const r = await q.query<{ storage_key: string }>(`SELECT storage_key FROM ${table} WHERE ${owner}=$1 AND storage_key IS NOT NULL`, [householdId]);
      if (inTransaction) await q.query(`RELEASE SAVEPOINT purge_keys`);
      return r.rows.map((x) => ({ domain, storageKey: x.storage_key }));
    } catch {
      if (inTransaction) await q.query(`ROLLBACK TO SAVEPOINT purge_keys`);
      return [];
    }
  };
  return [...await rows("policies", "account_id", "policy"), ...await rows("claim_evidence_documents", "account_id", "claim-evidence"), ...await rows("household_exports", "household_id", "household-export")];
}
/** Deleted (non-active) document rows whose objects are not yet queued --
 * this also catches everything deleted before this module existed. */
export async function enqueueDeletedDocuments(db?: Db) {
  await ensureStoragePurgeSchema(db);
  const q = dbOf(db);
  let added = 0;
  for (const [table, domain] of [["policies", "policy"], ["claim_evidence_documents", "claim-evidence"]] as const) {
    const r = await q.query(
      `INSERT INTO storage_purge_queue(storage_domain,storage_key,reason)
       SELECT DISTINCT $1::text, d.storage_key, 'document_deleted' FROM ${table} d
        WHERE d.storage_key IS NOT NULL AND d.lifecycle_state IN ('soft_deleted','permanently_deleted','audit_tombstone')
          AND d.storage_key NOT LIKE 'deleted/%'
          AND NOT EXISTS (SELECT 1 FROM storage_purge_queue s WHERE s.storage_domain=$1 AND s.storage_key=d.storage_key)
       ON CONFLICT (storage_domain,storage_key) DO NOTHING`, [domain]).catch(() => ({ rowCount: 0 }));
    added += r.rowCount ?? 0;
  }
  return added;
}

export const PURGE_MAX_ATTEMPTS = 12;
const NOT_FOUND = /not.?found|no such file|enoent|404/i;
export type PurgeResult = { removed: number; alreadyGone: number; keptReferenced: number; failed: number };
/** Removes queued objects (bounded batch). Safe to run concurrently without
 * row locks: two passes may both attempt the same key, and the second sees
 * "not found", which counts as already removed. */
export async function drainStoragePurge(opts: { limit?: number; db?: Db; driverFor?: (domain: StorageDomain) => StorageCleanupDriver } = {}): Promise<PurgeResult> {
  const q = dbOf(opts.db);
  await ensureStoragePurgeSchema(opts.db);
  await enqueueDeletedDocuments(opts.db);
  const result: PurgeResult = { removed: 0, alreadyGone: 0, keptReferenced: 0, failed: 0 };
  const due = await q.query<{ id: string; storage_domain: StorageDomain; storage_key: string; attempts: number }>(
    `SELECT id::text AS id,storage_domain,storage_key,attempts FROM storage_purge_queue
      WHERE purged_at IS NULL AND next_attempt_at<=now() AND attempts<$1 ORDER BY id LIMIT $2`, [PURGE_MAX_ATTEMPTS, opts.limit ?? 50]);
  const driverFor = opts.driverFor ?? ((domain: StorageDomain) => purgeDriverFor(domain));
  for (const row of due.rows) {
    // A key an active document still points at is not removed (and not
    // retried): the queue entry is closed without touching the object.
    // (A household export is live while its row exists; its own expiry
    // cleanup owns it until the household is deleted.)
    const liveSql = row.storage_domain === "policy" ? `SELECT count(*)::int AS n FROM policies WHERE storage_key=$1 AND lifecycle_state IN ('active','pending_deletion')`
      : row.storage_domain === "claim-evidence" ? `SELECT count(*)::int AS n FROM claim_evidence_documents WHERE storage_key=$1 AND lifecycle_state IN ('active','pending_deletion')`
      : `SELECT count(*)::int AS n FROM household_exports WHERE storage_key=$1`;
    {
      const live = await q.query<{ n: number }>(liveSql, [row.storage_key]).catch(() => ({ rows: [{ n: 0 }] }));
      if (Number(live.rows[0]?.n ?? 0) > 0) {
        await q.query(`UPDATE storage_purge_queue SET purged_at=now(),last_error='kept: still referenced by an active document' WHERE id=$1`, [row.id]);
        result.keptReferenced++; continue;
      }
    }
    try {
      await driverFor(row.storage_domain).deleteObject(row.storage_key);
      await q.query(`UPDATE storage_purge_queue SET purged_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1`, [row.id]);
      result.removed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (NOT_FOUND.test(message)) {
        await q.query(`UPDATE storage_purge_queue SET purged_at=now(),attempts=attempts+1,last_error=NULL WHERE id=$1`, [row.id]);
        result.alreadyGone++; continue;
      }
      // Back off: 1, 2, 4 … minutes, capped at a day. No raw key or
      // provider text leaves this table.
      await q.query(`UPDATE storage_purge_queue SET attempts=attempts+1,last_error=$2,next_attempt_at=now()+least(interval '1 day', (interval '1 minute')*power(2,attempts)) WHERE id=$1`,
        [row.id, message.slice(0, 300)]);
      result.failed++;
    }
  }
  return result;
}
/** Runs a purge pass without ever failing the caller (a deletion that has
 * completed must not report failure because a file could not be removed yet;
 * the queue keeps it and the next pass retries). */
export async function purgeSoon(opts: { db?: Db } = {}) {
  try { return await drainStoragePurge({ limit: 50, db: opts.db }); }
  catch (error) { console.warn("storage purge pass failed:", error instanceof Error ? error.name : "unknown"); return null; }
}
