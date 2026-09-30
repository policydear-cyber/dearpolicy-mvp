import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* .env.local is optional outside local dev */ }

// Every table-creating migration, in dependency order, plus the household
// membership schema and RLS policies last (household-rls.sql references
// every table above it, and is written to be a no-op for any table that
// doesn't exist yet -- see its own header comment). Previously this script
// only applied schema.sql + chat-upgrade.sql, silently leaving the claim-
// evidence/composition/critical-illness/disability/cover-conditions/model-
// usage/coverage-ledger tables (and all RLS) missing from a fresh local
// database.
const MIGRATIONS = [
  "sql/schema.sql",
  "sql/benefit-catalog.sql",
  "sql/claim-evidence.sql",
  "sql/claim-composition.sql",
  "sql/critical-illness.sql",
  "sql/disability.sql",
  "sql/cover-conditions.sql",
  "sql/model-usage.sql",
  "sql/chat-upgrade.sql",
  "sql/coverage-ledger.sql",
  "sql/lifecycle.sql",
  "sql/claim-reviewers.sql",
  "sql/processing-failure-diagnostics.sql",
  "sql/storage-purge.sql",
  "sql/household-rls.sql",
];

async function main() {
  const { pool } = await import("../lib/db/client");
  let connected = false;
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await pool.query("SELECT 1");
      connected = true;
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ECONNREFUSED" || attempt === 20) {
        if (code === "ECONNREFUSED") {
          throw new Error([
            "DearPolicy could not reach PostgreSQL on port 5432.",
            "1. Open Docker Desktop and wait until it says it is running.",
            "2. Run: npm run db:start",
            "3. Run: npm run db:status",
            "4. When the database shows healthy, run: npm run db:setup",
            "Do not run 'docker compose down -v' because -v deletes the database volume.",
          ].join("\n"));
        }
        throw error;
      }
      if (attempt === 1) console.log("Waiting for PostgreSQL to become ready…");
      await wait(1_000);
    }
  }
  if (!connected) throw new Error("PostgreSQL did not become ready.");
  for (const file of MIGRATIONS) {
    const sql = await readFile(path.resolve(file), "utf8");
    await pool.query(sql);
  }
  console.log("DearPolicy database schema is ready (including household membership + RLS).");
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
