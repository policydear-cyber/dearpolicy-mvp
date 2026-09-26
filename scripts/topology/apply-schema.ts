/**
 * Applies the repository's sql/*.sql to a LOCAL, empty CI database for the
 * production-topology proof. Refuses any non-local host.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const FILES = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/claim-evidence.sql", "sql/claim-composition.sql",
  "sql/critical-illness.sql", "sql/disability.sql", "sql/cover-conditions.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/coverage-ledger.sql", "sql/background-jobs.sql", "sql/rate-limit.sql",
  "sql/lifecycle.sql", "sql/claim-reviewers.sql", "sql/model-provenance.sql", "sql/household-rls.sql",
  "sql/processing-failure-diagnostics.sql",
  "sql/infrastructure-rls.sql",
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`apply-schema refuses non-local database host "${host}"`);
  const client = new Client({ connectionString: url });
  await client.connect();
  for (const file of FILES) {
    await client.query(await readFile(path.resolve(file), "utf8"));
    console.log(`applied ${file}`);
  }
  await client.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
