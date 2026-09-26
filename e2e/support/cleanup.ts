/**
 * Playwright global teardown: removes every synthetic row and stored file
 * this run created, even after a failure, and FAILS the run if anything is
 * left behind. Only touches households whose name starts with
 * SYNTHETIC-DPTEST-<run id>- plus the dev identity's placeholder rows for
 * the two synthetic user ids. Never runs against a non-local database
 * unless E2E_ALLOW_REMOTE_CLEANUP=yes.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { PREFIX } from "./synthetic";

export default async function cleanup() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.log("cleanup: no DATABASE_URL (live mode) -- relying on in-app household deletion only"); return; }
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1"].includes(host) && process.env.E2E_ALLOW_REMOTE_CLEANUP !== "yes") throw new Error(`cleanup refuses non-local database host "${host}"`);
  const users = [process.env.E2E_USER_A, process.env.E2E_USER_B].filter((u): u is string => !!u);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const households = (await client.query<{ id: string }>(`SELECT id::text FROM accounts WHERE name LIKE $1`, [`${PREFIX}-%`])).rows.map((r) => r.id);
    const targets = [...households, ...users];
    // Every table with an account_id column, children first by retrying until stable.
    const tables = (await client.query<{ table_name: string }>(
      `SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='account_id' AND table_name <> 'accounts'`)).rows.map((r) => r.table_name);
    for (let pass = 0; pass < 6; pass++) {
      for (const t of tables) await client.query(`DELETE FROM "${t}" WHERE account_id::text = ANY($1)`, [targets]).catch(() => undefined);
    }
    await client.query(`DELETE FROM household_members WHERE household_id::text = ANY($1) OR user_id::text = ANY($2)`, [households, users]).catch(() => undefined);
    await client.query(`DELETE FROM accounts WHERE id::text = ANY($1)`, [households]).catch(() => undefined);
    await client.query(`DELETE FROM accounts WHERE id::text = ANY($1) AND name = 'Household'`, [users]).catch(() => undefined);
    const left = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM accounts WHERE name LIKE $1 OR (id::text = ANY($2) AND name='Household')`, [`${PREFIX}-%`, users])).rows[0].n;
    const storageRoot = path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./data/storage");
    let leftFiles = 0;
    for (const id of targets) {
      for (const dir of await readdir(storageRoot, { recursive: true }).catch(() => [] as string[])) {
        if (String(dir).includes(id)) { await rm(path.join(storageRoot, String(dir)), { recursive: true, force: true }); leftFiles++; }
      }
    }
    console.log(`cleanup: removed synthetic data for ${households.length} household(s); ${leftFiles} leftover storage path(s) removed; ${left} synthetic account row(s) remain`);
    if (left > 0) throw new Error(`cleanup failed: ${left} synthetic account row(s) remain`);
  } finally {
    await client.end();
  }
}
