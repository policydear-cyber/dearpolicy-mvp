import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* .env.local is optional outside local dev */ }

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
  const sql = await readFile(path.resolve("sql/schema.sql"), "utf8");
  await pool.query(sql);
  await pool.query(await readFile(path.resolve("sql/chat-upgrade.sql"),"utf8"));
  console.log("DearPolicy database schema is ready.");
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
