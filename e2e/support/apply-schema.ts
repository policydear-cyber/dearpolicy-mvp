/**
 * Applies the repository's own sql/*.sql to a LOCAL, empty CI/dev database.
 * Refuses anything that is not localhost: this is never pointed at a real
 * DearPolicy database.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const FILES = [
  "sql/schema.sql", "sql/benefit-catalog.sql", "sql/claim-evidence.sql", "sql/claim-composition.sql",
  "sql/critical-illness.sql", "sql/disability.sql", "sql/cover-conditions.sql", "sql/model-usage.sql",
  "sql/chat-upgrade.sql", "sql/coverage-ledger.sql", "sql/background-jobs.sql", "sql/rate-limit.sql",
  "sql/lifecycle.sql", "sql/claim-reviewers.sql", "sql/model-provenance.sql", "sql/household-rls.sql", "sql/policy-member-exclusions.sql", "sql/detected-name-dismissals.sql",
  "sql/processing-failure-diagnostics.sql",
  "sql/storage-purge.sql",
  "sql/infrastructure-rls.sql", "sql/v11-ingestion-evidence.sql",
];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`apply-schema refuses non-local database host "${host}"`);
  const client = new Client({ connectionString: url });
  await client.connect();
  for (const file of FILES) {
    const sql = await readFile(path.resolve(file), "utf8");
    try { await client.query(sql); console.log(`applied ${file}`); }
    catch (error) { console.error(`FAILED ${file}: ${error instanceof Error ? error.message : String(error)}`); throw error; }
  }
  await client.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
