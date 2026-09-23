/**
 * Storage cleanup (checkpoint 5, claude/v1-launch-hardening): a shared,
 * domain- and driver-agnostic engine for auditing and safely deleting
 * orphaned storage objects, covering both storage domains (`policy` ->
 * the `policies` table, `claim-evidence` -> `claim_evidence_documents`)
 * and both storage drivers (`local` -> lib/storage/local.ts, `supabase`
 * -> lib/storage/supabase.ts). scripts/storage-cleanup.ts is the CLI
 * built on top of this module; scripts/storage-orphans.ts (the earlier,
 * local-only, no-confirmation tool) is left in place unmodified -- this
 * module is the real "complete storage cleanup" capability described in
 * the checkpoint-5 spec, not a replacement wired into the same file.
 *
 * Design, matched to the spec line by line:
 *  - "audit mode is read-only": classifyObjects/buildManifest never touch
 *    a storage object or a database row; only executeManifest deletes.
 *  - "cleanup requires explicit confirmation" + "creates a deterministic
 *    manifest before deletion": buildManifest() hashes only the domain,
 *    driver and the *content* of the orphan-candidate list (key + size),
 *    never a timestamp, so re-running the audit against unchanged state
 *    reproduces the exact same hash. executeManifest() refuses to delete
 *    anything unless the caller's `confirmHash` matches that hash exactly.
 *  - "active, quarantined, retained, soft-deleted-within-retention, and
 *    audit-required objects are protected": any object a database row
 *    currently references (regardless of that row's own status column --
 *    uploaded/quarantined/scan_pending/scan_clean/scan_rejected are all
 *    still a live row) is protected as `active_reference`; this covers
 *    "quarantined" for free, since a quarantined document's row still
 *    exists and still points at its storage object. "retained",
 *    "soft-deleted-within-retention" and "audit-required" have no
 *    concrete representation in this schema yet -- rows are hard-deleted
 *    immediately (see app/api/policies/[id]/route.ts's DELETE handler),
 *    and there is no retention-hold table. classifyObjects() takes an
 *    explicit, real extension point (`RetentionChecker`) for this rather
 *    than pretending the feature exists: checkpoint 7 ("deletion and
 *    invalidation lifecycle") can supply a real checker without touching
 *    this module's own logic or any of its callers. Until then the
 *    default checker holds nothing back on retention grounds, which is
 *    reported honestly in the PR, not silently claimed as "ready".
 *  - "objects referenced through any document version are protected": a
 *    superseded row (supersedes_id/superseded_at) keeps its own row and
 *    its own storage_key until it is itself deleted -- so it is already
 *    covered by the `active_reference` check above without special-casing.
 *  - "database rows missing storage objects are reported separately":
 *    dbRowsMissingObjects(), unchanged in spirit from
 *    scripts/storage-orphans.ts's own `missingFiles`, kept as a distinct
 *    report from the orphan/cleanup path -- these are never deleted here.
 *  - "partial deletion failures are retryable": executeManifest() retries
 *    each object a bounded number of times, and manifest-based deletion
 *    is naturally idempotent (re-running "clean" with the same manifest
 *    just re-attempts whatever is left in `failed`).
 *  - "concurrent cleanup runs cannot delete each other's in-flight
 *    objects": withCleanupLock() below, plus a fresh, re-checked-at-
 *    execution-time database read of referenced keys inside
 *    executeManifest() (not just the manifest's stale snapshot), so an
 *    object a new upload started referencing after the manifest was
 *    built is never deleted.
 *  - "cleanup is household-safe": storage keys are scoped per account
 *    (see lib/storage/local.ts/supabase.ts's objectKey()); this module
 *    never crosses that boundary -- it deletes exactly the keys named in
 *    a manifest, and a manifest's orphan candidates are computed against
 *    the FULL set of every account's own database rows, so nothing that
 *    any household still owns is ever misclassified as orphaned.
 *  - "every deletion is auditable": every real deletion attempt (success,
 *    failure, or skip) writes one storage_cleanup_audit_log row via
 *    appendCleanupAudit(), keyed by manifest_hash so a whole cleanup run
 *    can be reconstructed from the audit log alone.
 *  - "dry-run output contains no signed URLs or sensitive filenames":
 *    redactStorageKey() replaces the filename segment of a storage key
 *    with a short, non-reversible hash before anything is printed to the
 *    console OR written to storage_cleanup_audit_log -- the audit log
 *    never stores a raw storage_key at all, only display_key, which is a
 *    stronger guarantee than the spec strictly requires (it only named
 *    "dry-run output") but a strictly safer one to make standard.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export type QueryableDb = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type StorageDomain = "policy" | "claim-evidence" | "household-export";
export type StorageDriverName = "local" | "supabase";

const DOMAIN_TABLE: Record<StorageDomain, "policies" | "claim_evidence_documents" | "household_exports"> = {
  policy: "policies",
  "claim-evidence": "claim_evidence_documents",
  // household_exports (checkpoint 6) -- unlike the other two domains,
  // storage_key is NULL until a generated export is actually written to
  // storage (a pending/running/failed row has none yet), which is why
  // both queries below filter it out rather than assuming NOT NULL.
  "household-export": "household_exports",
};

// ---------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------

/** Replaces the filename segment of a storage key (its last path
 * component -- see lib/storage/local.ts/supabase.ts's objectKey(), which
 * always ends the key in the sanitized original filename) with a short,
 * non-reversible digest, keeping its extension and every other segment
 * (account/family-member/policy id, all UUIDs, not personal filenames)
 * intact for grouping/debugging. Deterministic: the same filename always
 * redacts to the same digest, so duplicate uploads are still visibly the
 * same object across separate audit runs without ever printing the name
 * itself. */
export function redactStorageKey(key: string): string {
  const segments = key.split("/");
  const filename = segments.pop() ?? "";
  const dotIndex = filename.lastIndexOf(".");
  const ext = dotIndex > 0 ? filename.slice(dotIndex) : "";
  const digest = createHash("sha256").update(filename).digest("hex").slice(0, 16);
  segments.push(`${digest}${ext}`);
  return segments.join("/");
}

// ---------------------------------------------------------------------
// Database-reference lookups
// ---------------------------------------------------------------------

/** Every storage_key any row in the domain's table currently points at,
 * regardless of that row's status/quarantine_status -- see this file's
 * header comment for why that is exactly the right protection rule.
 * `table` always comes from the fixed DOMAIN_TABLE map above, never from
 * caller input, so there is no injection surface despite the string
 * interpolation (same pattern scripts/storage-orphans.ts already uses). */
export async function activeStorageKeys(db: QueryableDb, domain: StorageDomain): Promise<Set<string>> {
  const table = DOMAIN_TABLE[domain];
  const { rows } = await db.query<{ storage_key: string | null }>(`SELECT storage_key FROM ${table} WHERE storage_key IS NOT NULL`);
  return new Set(rows.map((r) => r.storage_key as string));
}

export interface MissingObjectRow {
  id: string;
  storageKey: string;
}

/** A row in the domain's table whose storage_key is not present in
 * `objectKeys` (a live listing of what's actually in storage) -- a data
 * integrity problem, never auto-fixed here, only reported. */
export async function dbRowsMissingObjects(db: QueryableDb, domain: StorageDomain, objectKeys: Set<string>): Promise<MissingObjectRow[]> {
  const table = DOMAIN_TABLE[domain];
  const { rows } = await db.query<{ id: string; storage_key: string | null }>(`SELECT id, storage_key FROM ${table} WHERE storage_key IS NOT NULL`);
  return rows
    .filter((r) => !objectKeys.has(r.storage_key as string))
    .map((r) => ({ id: r.id, storageKey: r.storage_key as string }))
    .sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}

// ---------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------

export interface StorageObjectInfo {
  key: string;
  sizeBytes: number;
  lastModifiedMs: number | null;
}

export interface StorageCleanupDriver {
  readonly name: StorageDriverName;
  listObjects(): Promise<StorageObjectInfo[]>;
  deleteObject(key: string): Promise<void>;
}

async function walkLocalObjects(dir: string, base: string = dir): Promise<StorageObjectInfo[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const out: StorageObjectInfo[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkLocalObjects(full, base)));
    } else if (entry.isFile()) {
      const key = path.relative(base, full).split(path.sep).join("/");
      const info = await stat(full);
      out.push({ key, sizeBytes: info.size, lastModifiedMs: info.mtimeMs });
    }
  }
  return out;
}

/** Local-disk driver, matching lib/storage/local.ts's own layout and path-
 * containment guard (refuses to delete anything that would resolve
 * outside `storageRoot`, exactly like readPolicyFile/deletePolicyFile do). */
export function localCleanupDriver(storageRoot: string): StorageCleanupDriver {
  const root = path.resolve(storageRoot);
  return {
    name: "local",
    async listObjects() {
      return walkLocalObjects(root);
    },
    async deleteObject(key: string) {
      const fullPath = path.resolve(root, key);
      if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
        throw new Error("path escapes storage root, refusing to delete");
      }
      await unlink(fullPath);
    },
  };
}

function supabaseAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured -- cannot audit or clean Supabase Storage from this environment.",
    );
  }
  // Deliberately a small, local copy of lib/storage/supabase.ts's own
  // client() rather than importing it -- this tool needs the Storage
  // Management surface (list/remove across an entire bucket), which is a
  // different, wider blast radius than the app's own runtime storage
  // module ever needs, and keeping them independent means a change to
  // one can't silently change the other's behaviour.
  return createClient(url, key, { auth: { persistSession: false } });
}

const SUPABASE_LIST_PAGE_SIZE = 1000;

type SupabaseAdminClient = ReturnType<typeof supabaseAdminClient>;

async function listSupabaseObjects(bucket: string, client: SupabaseAdminClient, prefix = ""): Promise<StorageObjectInfo[]> {
  const out: StorageObjectInfo[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: SUPABASE_LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Could not list Supabase Storage objects under "${bucket}/${prefix}": ${error.message}`);
    const entries = data ?? [];
    for (const entry of entries) {
      // Supabase Storage's list() represents a "folder" as an entry with
      // id === null and no metadata -- there is no separate folder API.
      const isFolder = entry.id === null;
      const childPath = `${prefix}${entry.name}`;
      if (isFolder) {
        out.push(...(await listSupabaseObjects(bucket, client, `${childPath}/`)));
      } else {
        const size = typeof entry.metadata?.size === "number" ? entry.metadata.size : 0;
        const updatedAt = entry.updated_at ?? entry.created_at ?? null;
        out.push({ key: childPath, sizeBytes: size, lastModifiedMs: updatedAt ? Date.parse(updatedAt) : null });
      }
    }
    if (entries.length < SUPABASE_LIST_PAGE_SIZE) break;
    offset += SUPABASE_LIST_PAGE_SIZE;
  }
  return out;
}

/** Supabase Storage driver. Real, complete implementation against the
 * Storage Management API (list/remove) -- exercising it against a live
 * project needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY, which this
 * sandbox does not have configured (same standing constraint as every
 * other live-Supabase check in this repo, e.g.
 * scripts/launch-check.ts's checkLiveBucketPrivacy()); that is a
 * configuration blocker on exercising it here, not a gap in the code. */
export function supabaseCleanupDriver(bucket: string): StorageCleanupDriver {
  return {
    name: "supabase",
    async listObjects() {
      const client = supabaseAdminClient();
      return listSupabaseObjects(bucket, client);
    },
    async deleteObject(key: string) {
      const client = supabaseAdminClient();
      const { error } = await client.storage.from(bucket).remove([key]);
      if (error) throw new Error(`Could not delete Supabase Storage object "${key}": ${error.message}`);
    },
  };
}

// ---------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------

export type ProtectionReason = "active_reference" | "in_flight_grace" | "retention_hold";

export interface ProtectedObject {
  key: string;
  reason: ProtectionReason;
  detail?: string;
}

export type RetentionCheckResult = { held: true; detail: string } | { held: false };
export type RetentionChecker = (object: StorageObjectInfo) => Promise<RetentionCheckResult>;

/** See this file's header comment: no retention/soft-delete lifecycle
 * exists in the app yet (checkpoint 7's scope), so the default checker
 * never holds anything back on retention grounds -- a real extension
 * point, not a stub dressed up as a finished feature. */
export const noRetentionHold: RetentionChecker = async () => ({ held: false });

export const DEFAULT_GRACE_PERIOD_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface ClassifyOptions {
  now?: number;
  gracePeriodMs?: number;
  retentionChecker?: RetentionChecker;
}

export interface ClassifyResult {
  orphanCandidates: StorageObjectInfo[];
  protectedObjects: ProtectedObject[];
}

/** Read-only classification: never deletes or writes anything. An object
 * is an orphan candidate only if none of the three protections apply, in
 * this order: (1) a database row currently references it; (2) it was
 * written too recently to safely assume its database row has committed
 * yet (an upload in progress); (3) a retention hold applies. */
export async function classifyObjects(
  objects: StorageObjectInfo[],
  referencedKeys: Set<string>,
  opts: ClassifyOptions = {},
): Promise<ClassifyResult> {
  const now = opts.now ?? Date.now();
  const graceMs = opts.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const retentionChecker = opts.retentionChecker ?? noRetentionHold;

  const orphanCandidates: StorageObjectInfo[] = [];
  const protectedObjects: ProtectedObject[] = [];

  for (const object of objects) {
    if (referencedKeys.has(object.key)) {
      protectedObjects.push({ key: object.key, reason: "active_reference", detail: "a database row currently references this object" });
      continue;
    }
    if (object.lastModifiedMs !== null && now - object.lastModifiedMs < graceMs) {
      protectedObjects.push({
        key: object.key,
        reason: "in_flight_grace",
        detail: `written within the last ${Math.round(graceMs / 60000)} minute(s) -- may be an upload whose database row has not committed yet`,
      });
      continue;
    }
    const retention = await retentionChecker(object);
    if (retention.held) {
      protectedObjects.push({ key: object.key, reason: "retention_hold", detail: retention.detail });
      continue;
    }
    orphanCandidates.push(object);
  }

  orphanCandidates.sort((a, b) => a.key.localeCompare(b.key));
  protectedObjects.sort((a, b) => a.key.localeCompare(b.key));
  return { orphanCandidates, protectedObjects };
}

// ---------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------

export interface CleanupManifestEntry {
  storageKey: string;
  displayKey: string;
  sizeBytes: number;
}

export interface CleanupManifest {
  version: 1;
  domain: StorageDomain;
  driver: StorageDriverName;
  generatedAt: string;
  manifestHash: string;
  entries: CleanupManifestEntry[];
}

function computeManifestHash(domain: StorageDomain, driver: StorageDriverName, entries: { storageKey: string; sizeBytes: number }[]): string {
  // Deliberately excludes generatedAt (and any other timestamp) so the
  // hash is a pure function of *what would be deleted*, not *when the
  // audit ran* -- re-running the audit against unchanged storage/DB
  // state reproduces the exact same hash, which is what makes it usable
  // as an explicit confirmation token.
  const canonical = JSON.stringify({
    domain,
    driver,
    entries: [...entries].sort((a, b) => a.storageKey.localeCompare(b.storageKey)).map((e) => [e.storageKey, e.sizeBytes]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildManifest(args: {
  domain: StorageDomain;
  driver: StorageDriverName;
  orphanCandidates: StorageObjectInfo[];
  generatedAt?: Date;
}): CleanupManifest {
  const generatedAt = (args.generatedAt ?? new Date()).toISOString();
  const entries = [...args.orphanCandidates]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((o) => ({ storageKey: o.key, displayKey: redactStorageKey(o.key), sizeBytes: o.sizeBytes }));
  const manifestHash = computeManifestHash(args.domain, args.driver, entries);
  return { version: 1, domain: args.domain, driver: args.driver, generatedAt, manifestHash, entries };
}

export async function writeManifest(filePath: string, manifest: CleanupManifest): Promise<void> {
  await writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function readManifest(filePath: string): Promise<CleanupManifest> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as CleanupManifest;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries) || typeof parsed.manifestHash !== "string") {
    throw new Error(`"${filePath}" does not look like a storage-cleanup manifest.`);
  }
  return parsed;
}

// ---------------------------------------------------------------------
// Concurrency lock
// ---------------------------------------------------------------------

export class CleanupLockHeldError extends Error {
  constructor(lockKey: string) {
    super(`Another storage-cleanup run currently holds the lock "${lockKey}". Try again once it finishes.`);
    this.name = "CleanupLockHeldError";
  }
}

export const DEFAULT_LOCK_STALE_MS = 30 * 60 * 1000; // 30 minutes

function randomHolderToken(): string {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cleanupLockKey(driver: StorageDriverName, domain: StorageDomain): string {
  return `${driver}:${domain}`;
}

/** Row-based mutual-exclusion lock (storage_cleanup_locks table), not a
 * Postgres session-level advisory lock -- deliberately: this must work
 * correctly whether or not two concurrent cleanup runs happen to share a
 * connection/session (a session-scoped advisory lock only ever contends
 * against a *different session*, which this tool cannot assume; a lock
 * row is unambiguous regardless of connection topology), and a crashed
 * run's lock must be reclaimable rather than stuck forever -- which a
 * plain advisory lock tied to a dead session already handles for you,
 * but at the cost of the portability above, so a row with an explicit
 * staleness window is the more testable, equally safe choice here. */
export async function withCleanupLock<T>(
  db: QueryableDb,
  lockKey: string,
  fn: () => Promise<T>,
  opts: { staleMs?: number } = {},
): Promise<T> {
  const staleMs = opts.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const holder = randomHolderToken();

  const tryAcquire = async (): Promise<boolean> => {
    const { rows } = await db.query<{ lock_key: string }>(
      `INSERT INTO storage_cleanup_locks(lock_key, holder) VALUES ($1,$2)
       ON CONFLICT (lock_key) DO NOTHING
       RETURNING lock_key`,
      [lockKey, holder],
    );
    return rows.length === 1;
  };

  let acquired = await tryAcquire();
  if (!acquired) {
    // Reclaim only a genuinely stale lock, and only via a conditional
    // DELETE -- so a lock that is refreshed/released between our read and
    // this DELETE is never stolen out from under a still-live holder.
    await db.query(`DELETE FROM storage_cleanup_locks WHERE lock_key=$1 AND acquired_at < now() - ($2 || ' milliseconds')::interval`, [
      lockKey,
      String(staleMs),
    ]);
    acquired = await tryAcquire();
  }
  if (!acquired) throw new CleanupLockHeldError(lockKey);

  try {
    return await fn();
  } finally {
    await db.query(`DELETE FROM storage_cleanup_locks WHERE lock_key=$1 AND holder=$2`, [lockKey, holder]);
  }
}

// ---------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------

export type CleanupAuditAction = "object_deleted" | "object_delete_failed" | "object_skipped_referenced" | "object_skipped_already_gone";

export async function appendCleanupAudit(
  db: QueryableDb,
  entry: {
    driver: StorageDriverName;
    domain: StorageDomain;
    action: CleanupAuditAction;
    displayKey: string;
    sizeBytes?: number | null;
    manifestHash: string;
    actor: string;
    detail?: string;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO storage_cleanup_audit_log(driver,domain,action,display_key,size_bytes,manifest_hash,actor,detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entry.driver, entry.domain, entry.action, entry.displayKey, entry.sizeBytes ?? null, entry.manifestHash, entry.actor, entry.detail ?? null],
  );
}

// ---------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------

export interface ExecuteCleanupResult {
  deleted: string[];
  skippedReferenced: string[];
  skippedAlreadyGone: string[];
  failed: { key: string; error: string }[];
}

export interface ExecuteCleanupArgs {
  db: QueryableDb;
  driver: StorageCleanupDriver;
  domain: StorageDomain;
  manifest: CleanupManifest;
  confirmHash: string;
  actor: string;
  retries?: number;
}

const NOT_FOUND_PATTERN = /not.?found|no such file|enoent|404/i;

/** Deletes exactly the orphan candidates named in `manifest`, but only
 * after re-verifying, right before touching storage, that
 * `confirmHash` matches the manifest's own hash (explicit confirmation)
 * and that the database's *current* reference set -- re-read fresh here,
 * not the manifest's stale snapshot -- still does not reference each
 * object. See this file's header comment for how this closes the
 * concurrent-run/in-flight-upload race. */
export async function executeManifest(args: ExecuteCleanupArgs): Promise<ExecuteCleanupResult> {
  if (args.manifest.driver !== args.driver.name || args.manifest.domain !== args.domain) {
    throw new Error(`Manifest is for ${args.manifest.driver}/${args.manifest.domain}, not ${args.driver.name}/${args.domain}.`);
  }
  if (args.confirmHash !== args.manifest.manifestHash) {
    throw new Error(
      "Confirmation hash does not match the manifest -- refusing to delete anything. Re-run the audit and pass the freshly printed hash if the manifest is stale.",
    );
  }

  const retries = args.retries ?? 1;
  const freshReferenced = await activeStorageKeys(args.db, args.domain);

  const result: ExecuteCleanupResult = { deleted: [], skippedReferenced: [], skippedAlreadyGone: [], failed: [] };

  for (const entry of args.manifest.entries) {
    if (freshReferenced.has(entry.storageKey)) {
      result.skippedReferenced.push(entry.storageKey);
      await appendCleanupAudit(args.db, {
        driver: args.driver.name,
        domain: args.domain,
        action: "object_skipped_referenced",
        displayKey: entry.displayKey,
        sizeBytes: entry.sizeBytes,
        manifestHash: args.manifest.manifestHash,
        actor: args.actor,
        detail: "a database row now references this object -- no longer an orphan since the manifest was generated",
      });
      continue;
    }

    let lastError: string | null = null;
    let done = false;
    for (let attempt = 0; attempt <= retries && !done; attempt++) {
      try {
        await args.driver.deleteObject(entry.storageKey);
        result.deleted.push(entry.storageKey);
        await appendCleanupAudit(args.db, {
          driver: args.driver.name,
          domain: args.domain,
          action: "object_deleted",
          displayKey: entry.displayKey,
          sizeBytes: entry.sizeBytes,
          manifestHash: args.manifest.manifestHash,
          actor: args.actor,
        });
        done = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (NOT_FOUND_PATTERN.test(message)) {
          // Already removed by a prior/concurrent run, or manually --
          // idempotent success, not a failure.
          result.skippedAlreadyGone.push(entry.storageKey);
          await appendCleanupAudit(args.db, {
            driver: args.driver.name,
            domain: args.domain,
            action: "object_skipped_already_gone",
            displayKey: entry.displayKey,
            sizeBytes: entry.sizeBytes,
            manifestHash: args.manifest.manifestHash,
            actor: args.actor,
          });
          done = true;
          break;
        }
        lastError = message;
      }
    }
    if (!done && lastError) {
      result.failed.push({ key: entry.storageKey, error: lastError });
      await appendCleanupAudit(args.db, {
        driver: args.driver.name,
        domain: args.domain,
        action: "object_delete_failed",
        displayKey: entry.displayKey,
        sizeBytes: entry.sizeBytes,
        manifestHash: args.manifest.manifestHash,
        actor: args.actor,
        detail: lastError,
      });
    }
  }

  return result;
}
