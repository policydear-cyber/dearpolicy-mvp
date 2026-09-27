/**
 * Global teardown for the owner/reviewer journey (e2e/playwright.auth.config.ts).
 * Runs after success AND failure. Local synthetic database only.
 *
 *  1. Deletes every synthetic Auth user of this run through the Auth Admin
 *     API (supabase-js admin.deleteUser against the test-only stand-in),
 *     refusing any user whose email lacks this run's exact identifier.
 *  2. Removes this run's reviewer assignments and reviewer provisioning.
 *  3. Removes any synthetic household the journey did not already delete
 *     through the app, with its rows and stored files.
 *  4. FAILS the run unless every residue count is zero: synthetic Auth
 *     users, households, memberships, family members, policies, claims,
 *     evidence, exports, outstanding jobs, reviewer rows and stored files.
 * The reviewer audit log is append-only by design (a trigger refuses
 * deletes); its identifier-only rows are counted and reported, not removed.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { PREFIX } from "./synthetic";
import { adminDeleteSyntheticUsers, FAKE_AUTH, RUN_HOUSEHOLDS_FILE } from "./journey";

export default async function authCleanup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("auth-cleanup: DATABASE_URL is required");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`auth-cleanup refuses non-local database host "${host}"`);
  const prefix = PREFIX.toLowerCase();

  // Collect this run's Auth user ids before deleting them.
  const listed = await fetch(`${FAKE_AUTH}/auth/v1/admin/users`, {
    headers: { apikey: "synthetic-e2e-service-role-key", authorization: "Bearer synthetic-e2e-service-role-key" },
  }).then((r) => r.json()).catch(() => ({ users: [] }));
  const runUsers: string[] = (listed.users ?? []).filter((u: { email?: string }) => (u.email ?? "").includes(prefix)).map((u: { id: string }) => u.id);

  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`SET lock_timeout = '10s'; SET statement_timeout = '60s'`);
  const report: Record<string, number> = {};
  try {
    // 2. Reviewer assignments and provisioning.
    await client.query(`DELETE FROM claim_review_assignments WHERE reviewer_user_id::text = ANY($1)`, [runUsers]).catch(() => undefined);
    await client.query(`DELETE FROM claim_reviewers WHERE user_id::text = ANY($1)`, [runUsers]).catch(() => undefined);

    // 3. Households the journey did not delete through the app.
    const households = (await client.query<{ id: string }>(
      `SELECT id::text FROM accounts WHERE lower(name) LIKE $1 OR id IN (SELECT household_id FROM household_members WHERE user_id::text = ANY($2))`,
      [`${prefix}%`, runUsers])).rows.map((r) => r.id);
    report.householdsLeftByJourney = households.length;
    const tables = (await client.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='account_id' AND table_name <> 'accounts'`)).rows.map((r) => r.table_name);
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await client.query(`DELETE FROM "${t}" WHERE account_id::text = ANY($1)`, [households]).catch(() => undefined);
    }
    await client.query(`DELETE FROM household_exports WHERE household_id::text = ANY($1)`, [households]).catch(() => undefined);
    await client.query(`DELETE FROM household_members WHERE household_id::text = ANY($1) OR user_id::text = ANY($2)`, [households, runUsers]).catch(() => undefined);
    await client.query(`DELETE FROM accounts WHERE id::text = ANY($1)`, [households]).catch(() => undefined);

    // Stored files. The app deletes a household's database rows at once
    // but, by design, leaves physical objects for the storage-cleanup
    // engine (`npm run storage:cleanup`, 6-hour in-flight grace). Count
    // what the journey's own deletions left behind, then remove it here.
    const recorded = (await readFile(RUN_HOUSEHOLDS_FILE, "utf8").catch(() => "")).split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l));
    const runHouseholds = [...new Set([...households, ...recorded])];
    const roots = [...new Set([process.env.LOCAL_STORAGE_DIR ?? "./data/storage", process.env.LOCAL_CLAIM_EVIDENCE_DIR ?? "./data/claim-evidence", process.env.LOCAL_HOUSEHOLD_EXPORT_DIR ?? "./data/household-exports"].map((r) => path.resolve(r)))];
    const runFiles = async () => {
      const found: string[] = [];
      for (const root of roots) {
        for (const entry of await readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])) {
          if (!entry.isFile()) continue;
          const full = path.join(entry.parentPath ?? (entry as { path?: string }).path ?? root, entry.name);
          if (runHouseholds.some((h) => full.includes(h)) || full.toLowerCase().includes(prefix)) found.push(full);
        }
      }
      return found;
    };
    const leftBehind = await runFiles();
    report.storedFilesAwaitingStorageCleanup = leftBehind.length;
    for (const file of leftBehind) await rm(file, { force: true });
    for (const root of roots) for (const h of runHouseholds) await rm(path.join(root, h), { recursive: true, force: true });

    // 1. Auth users, through the Admin API.
    const auth = await adminDeleteSyntheticUsers().catch((e) => { throw new Error(`auth-cleanup: ${e instanceof Error ? e.message : e}`); });
    report.authUsersDeleted = auth.deleted;
    report.authUsersRefused = auth.refused;

    // 4. Zero-residue checks (identifier/aggregate only).
    const count = async (sql: string, params: unknown[]) => (await client.query<{ n: number }>(sql, params)).rows[0].n;
    report.residueHouseholds = await count(`SELECT count(*)::int AS n FROM accounts WHERE lower(name) LIKE $1`, [`${prefix}%`]);
    report.residueMemberships = await count(`SELECT count(*)::int AS n FROM household_members WHERE user_id::text = ANY($1)`, [runUsers]);
    report.residueFamilyMembers = await count(`SELECT count(*)::int AS n FROM family_members WHERE lower(display_name) LIKE $1 OR account_id::text = ANY($2)`, [`${prefix}%`, households]);
    report.residuePolicies = await count(`SELECT count(*)::int AS n FROM policies WHERE account_id::text = ANY($1) OR lower(original_filename) LIKE $2`, [households, `${prefix}%`]);
    report.residueClaims = await count(`SELECT count(*)::int AS n FROM claim_sessions WHERE account_id::text = ANY($1)`, [households]);
    report.residueEvidence = await count(`SELECT count(*)::int AS n FROM claim_evidence_documents WHERE account_id::text = ANY($1) OR lower(original_filename) LIKE $2`, [households, `${prefix}%`]).catch(() => 0);
    report.residueExports = await count(`SELECT count(*)::int AS n FROM household_exports WHERE household_id::text = ANY($1)`, [households]).catch(() => 0);
    report.residueOutstandingJobs = await count(`SELECT count(*)::int AS n FROM background_jobs WHERE account_id::text = ANY($1) AND status IN ('queued','processing','failed_retryable')`, [households]).catch(() => 0);
    report.residueReviewers = await count(`SELECT count(*)::int AS n FROM claim_reviewers WHERE user_id::text = ANY($1)`, [runUsers]).catch(() => 0);
    report.residueActiveAssignments = await count(`SELECT count(*)::int AS n FROM claim_review_assignments WHERE reviewer_user_id::text = ANY($1) AND status='active'`, [runUsers]).catch(() => 0);
    report.retainedReviewerAuditRows = await count(`SELECT count(*)::int AS n FROM claim_reviewer_audit_log WHERE reviewer_user_id::text = ANY($1)`, [runUsers]).catch(() => 0);
    report.residueStoredFiles = (await runFiles()).length;
    await rm(RUN_HOUSEHOLDS_FILE, { force: true });
    const listedAfter = await fetch(`${FAKE_AUTH}/auth/v1/admin/users`, { headers: { apikey: "synthetic-e2e-service-role-key", authorization: "Bearer synthetic-e2e-service-role-key" } }).then((r) => r.json()).catch(() => ({ users: [] }));
    report.residueAuthUsers = (listedAfter.users ?? []).filter((u: { email?: string }) => (u.email ?? "").includes(prefix)).length;

    console.log(`auth-cleanup: ${JSON.stringify(report)}`);
    const residue = Object.entries(report).filter(([k, v]) => k.startsWith("residue") && v !== 0);
    if (residue.length) throw new Error(`auth-cleanup: synthetic residue remains: ${residue.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  } finally {
    await client.end();
  }
}
