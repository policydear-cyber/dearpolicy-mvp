/**
 * CLI for lib/storage/cleanup.ts -- the complete (local + Supabase) orphan
 * audit and confirmed-cleanup tool for checkpoint 5. Read-only by default
 * ("audit"); deletion ("clean") only ever touches exactly the objects
 * named in a manifest the caller passes back, together with that
 * manifest's own hash as explicit confirmation.
 *
 * Usage:
 *   node --import tsx scripts/storage-cleanup.ts [audit] [--driver=local|supabase|both] [--manifest-out=<dir>]
 *   node --import tsx scripts/storage-cleanup.ts clean --manifest=<path> --confirm=<hash> [--actor=<name>]
 *
 * "audit" (the default subcommand) is read-only: it lists what a "clean"
 * run against the same state would delete, prints a redacted summary, and
 * writes one manifest file per (domain, driver) pair actually checked.
 * Nothing is deleted until "clean" is run with that exact manifest and its
 * printed hash. scripts/storage-orphans.ts (the earlier, local-only,
 * bare-flag tool) is left in place and still works; this tool supersedes
 * it in capability, not in place.
 */
import os from "node:os";
import path from "node:path";
import {
  activeStorageKeys,
  buildManifest,
  classifyObjects,
  cleanupLockKey,
  dbRowsMissingObjects,
  executeManifest,
  localCleanupDriver,
  readManifest,
  redactStorageKey,
  supabaseCleanupDriver,
  withCleanupLock,
  writeManifest,
  type CleanupManifest,
  type StorageCleanupDriver,
  type StorageDomain,
  type StorageDriverName,
  type StorageObjectInfo,
} from "@/lib/storage/cleanup";

const DOMAINS: StorageDomain[] = ["policy", "claim-evidence"];

function resolveLocalRoot(domain: StorageDomain): string {
  return domain === "policy" ? (process.env.LOCAL_STORAGE_DIR ?? "./data/storage") : (process.env.LOCAL_CLAIM_EVIDENCE_DIR ?? "./data/claim-evidence");
}

function resolveSupabaseBucket(domain: StorageDomain): string {
  return domain === "policy" ? (process.env.SUPABASE_STORAGE_BUCKET ?? "policy-files") : (process.env.SUPABASE_CLAIM_EVIDENCE_BUCKET ?? "claim-evidence-files");
}

function driverFor(domain: StorageDomain, name: StorageDriverName): StorageCleanupDriver {
  return name === "local" ? localCleanupDriver(resolveLocalRoot(domain)) : supabaseCleanupDriver(resolveSupabaseBucket(domain));
}

function resolveActiveDriver(): StorageDriverName {
  const explicit = (process.env.STORAGE_DRIVER ?? "").trim().toLowerCase();
  if (explicit === "local" || explicit === "supabase") return explicit;
  return process.env.SUPABASE_URL ? "supabase" : "local";
}

type Db = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };

async function runAudit(db: Db, domain: StorageDomain, driverName: StorageDriverName, manifestOutDir: string): Promise<CleanupManifest | null> {
  const driver = driverFor(domain, driverName);
  let objects: StorageObjectInfo[];
  try {
    objects = await driver.listObjects();
  } catch (error) {
    console.log(`\n${domain} / ${driverName}: could not list objects -- ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  const referenced = await activeStorageKeys(db, domain);
  const missing = await dbRowsMissingObjects(db, domain, new Set(objects.map((o) => o.key)));
  const { orphanCandidates, protectedObjects } = await classifyObjects(objects, referenced);
  const manifest = buildManifest({ domain, driver: driverName, orphanCandidates });

  console.log(`\n${domain} / ${driverName}:`);
  console.log(`  ${objects.length} object(s) found in storage, ${referenced.size} row(s) reference storage in the database.`);
  const graceHeld = protectedObjects.filter((p) => p.reason === "in_flight_grace").length;
  if (graceHeld > 0) {
    console.log(`  ${graceHeld} object(s) protected as possibly in-flight (written too recently to safely treat as orphaned yet).`);
  }
  if (missing.length > 0) {
    console.log(`  ${missing.length} row(s) point at a MISSING object (data integrity issue, never auto-fixed):`);
    for (const m of missing) console.log(`    - ${domain}.id=${m.id} storage_key=${redactStorageKey(m.storageKey)}`);
  } else {
    console.log(`  No rows pointing at a missing object.`);
  }
  if (orphanCandidates.length === 0) {
    console.log(`  No orphaned objects -- nothing to clean.`);
    return manifest;
  }
  console.log(`  ${orphanCandidates.length} orphan candidate(s) (redacted):`);
  for (const e of manifest.entries) console.log(`    - ${e.displayKey} (${e.sizeBytes} bytes)`);
  const manifestPath = path.join(manifestOutDir, `storage-cleanup-manifest-${domain}-${driverName}.json`);
  await writeManifest(manifestPath, manifest);
  console.log(`  Manifest written to: ${manifestPath}`);
  console.log(`  Confirmation hash (pass as --confirm to "clean" exactly this manifest): ${manifest.manifestHash}`);
  return manifest;
}

async function runClean(db: Db, manifestPath: string, confirmHash: string, actor: string): Promise<void> {
  const manifest = await readManifest(manifestPath);
  const driver = driverFor(manifest.domain, manifest.driver);
  const lockKey = cleanupLockKey(manifest.driver, manifest.domain);
  const result = await withCleanupLock(db, lockKey, () => executeManifest({ db, driver, domain: manifest.domain, manifest, confirmHash, actor }));

  console.log(`\nCleanup complete for ${manifest.domain} / ${manifest.driver}:`);
  console.log(`  Deleted: ${result.deleted.length}`);
  console.log(`  Skipped (now referenced by a new row): ${result.skippedReferenced.length}`);
  console.log(`  Skipped (already gone): ${result.skippedAlreadyGone.length}`);
  if (result.failed.length > 0) {
    console.log(`  FAILED: ${result.failed.length} -- retryable; re-run "clean" with the same --manifest/--confirm to retry just these:`);
    for (const f of result.failed) console.log(`    - ${redactStorageKey(f.key)}: ${f.error}`);
    process.exitCode = 1;
  }
}

function parseFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const a of args) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) flags.set(m[1], m[2]);
  }
  return flags;
}

async function main() {
  try {
    process.loadEnvFile(path.resolve(".env.local"));
  } catch {
    /* .env.local is optional outside local dev */
  }

  const { pool } = await import("../lib/db/client");
  const args = process.argv.slice(2);
  const subcommand = args[0] && !args[0].startsWith("--") ? args[0] : "audit";
  const flags = parseFlags(args);

  if (subcommand === "audit") {
    const driverFlag = flags.get("driver");
    const manifestOutDir = flags.get("manifest-out") ?? os.tmpdir();
    const driversToCheck: StorageDriverName[] =
      driverFlag === "both" ? ["local", "supabase"] : driverFlag === "local" || driverFlag === "supabase" ? [driverFlag] : [resolveActiveDriver()];
    if (!driverFlag) {
      console.log(
        `No --driver given -- auditing the currently active driver only (${driversToCheck[0]}, from STORAGE_DRIVER/SUPABASE_URL). ` +
          `Pass --driver=both to also check the inactive driver (e.g. leftover local-disk uploads from before a switch to Supabase).`,
      );
    }
    for (const domain of DOMAINS) {
      for (const driverName of driversToCheck) {
        await runAudit(pool, domain, driverName, manifestOutDir);
      }
    }
  } else if (subcommand === "clean") {
    const manifestPath = flags.get("manifest");
    const confirmHash = flags.get("confirm");
    const actor = flags.get("actor") ?? process.env.USER ?? "storage-cleanup-cli";
    if (!manifestPath || !confirmHash) {
      console.error('clean requires --manifest=<path> and --confirm=<hash> (both printed by "audit"). Nothing was deleted.');
      process.exitCode = 1;
    } else {
      await runClean(pool, manifestPath, confirmHash, actor);
    }
  } else {
    console.error(`Unknown subcommand "${subcommand}". Use "audit" (default, read-only) or "clean".`);
    process.exitCode = 1;
  }

  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
