/**
 * Orphan-storage audit (and, opt-in, cleanup) for the `local` storage driver
 * (lib/storage/local.ts) -- read-only by default; nothing is deleted unless
 * explicitly told to be.
 *
 * "Orphaned" here means two distinct, opposite things, both worth surfacing
 * and neither implying the other:
 *  - **orphaned files**: bytes sitting under LOCAL_STORAGE_DIR/
 *    LOCAL_CLAIM_EVIDENCE_DIR that no `policies`/`claim_evidence_documents`
 *    row's `storage_key` points at. These accumulate when a file write
 *    succeeds (lib/storage/local.ts's savePolicyFile/saveClaimEvidenceFile)
 *    but the DB insert that was meant to follow it never lands -- a crashed
 *    request, a thrown validation error after the write, a failed
 *    transaction. Deleting these is safe: nothing in the app can ever read
 *    a storage_key the database doesn't have.
 *  - **missing files**: a DB row whose `storage_key` points at a file that
 *    is NOT on disk -- the opposite failure mode (the DB insert landed, the
 *    write didn't, or something external removed the file). This is a data
 *    integrity problem, not a storage-cleanliness one, and this tool never
 *    deletes or touches the DB row for it -- only reports it, so a human can
 *    decide whether to re-request the document or accept the loss.
 *
 * Supabase Storage (lib/storage/supabase.ts, the production driver) is
 * explicitly OUT of scope here: listing/deleting objects in a live Supabase
 * bucket needs the Storage Management API against a real project, which
 * this sandbox has no credentials for and which must not be exercised
 * without your explicit approval (same standing constraint as the RLS
 * migration itself). Auditing/cleaning the `supabase` driver in production
 * remains real, unstarted scope -- see the CLI's own driver check below,
 * which refuses to claim a clean bill of health when it can't actually see
 * the objects in question.
 *
 * Design note: `auditStorage`/`deleteOrphanedFiles` take a minimal
 * `{ query() }` object rather than importing lib/db/client.ts's real `pool`
 * directly, so scripts/storage-orphans-regressions.ts can exercise the real
 * logic against a disposable PGlite database instead of a live one -- see
 * that file for the regression suite. Only the CLI entry point at the
 * bottom (gated by the import.meta.url check, so importing this module for
 * its exports never runs it) touches the real pool.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

export type QueryableDb = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type OrphanTable = "policies" | "claim_evidence_documents";

const ALLOWED_TABLES: readonly OrphanTable[] = ["policies", "claim_evidence_documents"];

export interface OrphanAuditOptions {
  db: QueryableDb;
  table: OrphanTable;
  storageRoot: string;
}

export interface OrphanAuditResult {
  table: OrphanTable;
  storageRoot: string;
  totalFilesOnDisk: number;
  totalRowsInDb: number;
  /** On disk, referenced by no row in `table`. Safe to delete. */
  orphanedFiles: string[];
  /** A row in `table` whose storage_key is not on disk. Never auto-deleted. */
  missingFiles: { id: string; storageKey: string }[];
}

/** Every regular file under `dir`, as paths relative to `base` with forward
 * slashes -- the same shape lib/storage/local.ts's own savePolicyFile/
 * saveClaimEvidenceFile return and store as `storage_key`. A missing root
 * directory (nothing has ever been uploaded yet) is zero files, not an
 * error. */
async function walkFiles(dir: string, base: string = dir): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return files;
}

export async function auditStorage(opts: OrphanAuditOptions): Promise<OrphanAuditResult> {
  if (!ALLOWED_TABLES.includes(opts.table)) {
    throw new Error(`Refusing to audit unrecognized table "${opts.table}" -- must be one of ${ALLOWED_TABLES.join(", ")}.`);
  }
  const storageRoot = path.resolve(opts.storageRoot);
  const filesOnDisk = await walkFiles(storageRoot);
  const onDiskSet = new Set(filesOnDisk);

  const { rows } = await opts.db.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM ${opts.table}`,
  );
  const referencedSet = new Set(rows.map((r) => r.storage_key));

  const orphanedFiles = filesOnDisk.filter((f) => !referencedSet.has(f)).sort();
  const missingFiles = rows
    .filter((r) => !onDiskSet.has(r.storage_key))
    .map((r) => ({ id: r.id, storageKey: r.storage_key }))
    .sort((a, b) => a.storageKey.localeCompare(b.storageKey));

  return {
    table: opts.table,
    storageRoot,
    totalFilesOnDisk: filesOnDisk.length,
    totalRowsInDb: rows.length,
    orphanedFiles,
    missingFiles,
  };
}

export interface DeleteOrphansResult {
  deleted: string[];
  failed: { file: string; error: string }[];
}

/** Deletes exactly the given files (expected to be an audit's own
 * `orphanedFiles` list -- never `missingFiles`, which are DB rows, not
 * files, and are never touched by this function). Mirrors the same
 * containment guard lib/storage/local.ts's own read/delete functions use:
 * refuses anything that would resolve outside `storageRoot`, rather than
 * trusting the caller's paths blindly. */
export async function deleteOrphanedFiles(storageRoot: string, orphanedFiles: string[]): Promise<DeleteOrphansResult> {
  const root = path.resolve(storageRoot);
  const deleted: string[] = [];
  const failed: { file: string; error: string }[] = [];
  for (const relative of orphanedFiles) {
    const fullPath = path.resolve(root, relative);
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
      failed.push({ file: relative, error: "path escapes storage root, refusing to delete" });
      continue;
    }
    try {
      await rm(fullPath, { force: true });
      deleted.push(relative);
    } catch (error) {
      failed.push({ file: relative, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}

async function main() {
  const path2 = await import("node:path");
  try {
    process.loadEnvFile(path2.resolve(".env.local"));
  } catch {
    /* .env.local is optional outside local dev */
  }

  const deleteRequested = process.argv.includes("--delete");

  const explicitDriver = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  const effectiveDriver = explicitDriver === "local" || explicitDriver === "supabase" ? explicitDriver : process.env.SUPABASE_URL ? "supabase" : "local";
  if (effectiveDriver !== "local") {
    console.warn(
      `STORAGE_DRIVER resolves to "${effectiveDriver}", not "local" -- this tool only walks local disk. ` +
        `It is NOT evidence of a clean Supabase Storage bucket either way; auditing/cleaning the supabase ` +
        `driver is separate, unstarted scope. Proceeding to audit local disk anyway (harmless: any leftover ` +
        `local-driver uploads from before a driver switch, e.g. local dev, are still worth finding).`,
    );
  }

  const { pool } = await import("../lib/db/client");

  const targets: { table: OrphanTable; storageRoot: string }[] = [
    { table: "policies", storageRoot: process.env.LOCAL_STORAGE_DIR ?? "./data/storage" },
    { table: "claim_evidence_documents", storageRoot: process.env.LOCAL_CLAIM_EVIDENCE_DIR ?? "./data/claim-evidence" },
  ];

  let anyOrphans = false;
  let anyMissing = false;

  for (const target of targets) {
    const result = await auditStorage({ db: pool, table: target.table, storageRoot: target.storageRoot });
    console.log(`\n${result.table} (${result.storageRoot}):`);
    console.log(`  ${result.totalFilesOnDisk} file(s) on disk, ${result.totalRowsInDb} row(s) in the database.`);
    if (result.orphanedFiles.length === 0) {
      console.log("  No orphaned files.");
    } else {
      anyOrphans = true;
      console.log(`  ${result.orphanedFiles.length} orphaned file(s) (on disk, no DB row references them):`);
      for (const f of result.orphanedFiles) console.log(`    - ${f}`);
    }
    if (result.missingFiles.length === 0) {
      console.log("  No rows pointing at a missing file.");
    } else {
      anyMissing = true;
      console.log(`  ${result.missingFiles.length} row(s) pointing at a MISSING file (data integrity issue, not auto-fixed):`);
      for (const m of result.missingFiles) console.log(`    - ${target.table}.id=${m.id} storage_key=${m.storageKey}`);
    }

    if (deleteRequested && result.orphanedFiles.length > 0) {
      const outcome = await deleteOrphanedFiles(target.storageRoot, result.orphanedFiles);
      console.log(`  Deleted ${outcome.deleted.length}/${result.orphanedFiles.length} orphaned file(s).`);
      if (outcome.failed.length > 0) {
        for (const f of outcome.failed) console.log(`    FAILED to delete ${f.file}: ${f.error}`);
      }
    }
  }

  if (!deleteRequested && anyOrphans) {
    console.log("\nDry run (default): no files were deleted. Re-run with --delete to remove the orphaned files listed above.");
  }
  if (anyMissing) {
    console.log("\nMissing-file rows above are never deleted by this tool -- review them by hand.");
  }

  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
