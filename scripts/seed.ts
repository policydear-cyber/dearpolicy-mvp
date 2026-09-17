import path from "node:path";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* .env.local is optional outside local dev */ }

async function main() {
  const { pool, devAccountId } = await import("../lib/db/client");
  const accountId = devAccountId();
  await pool.query(`INSERT INTO accounts(id,name) VALUES($1,'Local DearPolicy Family') ON CONFLICT(id) DO NOTHING`, [accountId]);
  const existing = await pool.query(`SELECT count(*)::int AS count FROM family_members WHERE account_id=$1`, [accountId]);
  if (Number(existing.rows[0].count) === 0) {
    await pool.query(`INSERT INTO family_members(account_id,display_name,relationship) VALUES($1,$2,$3)`, [accountId, "My profile", "self"]);
  }
  console.log("DearPolicy local account is ready. Add real family names from the Family page.");
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
