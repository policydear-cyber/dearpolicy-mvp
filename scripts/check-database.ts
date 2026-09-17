import path from "node:path";

try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* optional outside local dev */ }

/** Answers "why did DearPolicy just return a 500?" in one command.
 *
 * A dashboard error is almost always one of three things: PostgreSQL is not
 * running, .env.local is not pointing at it, or a schema upgrade was never
 * applied. Read-only — it changes nothing. */
const REQUIRED: Record<string, string[]> = {
  accounts: ["id"], family_members: ["id", "display_name"],
  policies: ["id", "personal_coverage_confirmed", "document_authority", "processing_status", "effective_date", "renewal_or_expiry_date", "benefits_indexed_at"],
  policy_members: ["policy_id", "family_member_id", "source"],
  policy_pages: ["policy_id", "page_number", "text"],
  policy_chunks: ["policy_id", "embedding", "search_vector"],
  policy_coverages: ["policy_id", "family_member_id", "confirmed", "evidence_verified"],
  policy_reference_coverages: ["policy_id"], policy_detected_people: ["policy_id"],
  premium_records: ["policy_id", "amount", "currency"],
  chat_conversations: ["id", "revision", "state"], chat_messages: ["conversation_id"],
  chat_analysis_jobs: ["id", "status"], chat_history_epochs: ["scope_key"],
  policy_analysis_cache: ["cache_key"],
  model_usage: ["account_id", "role", "cost_usd"],
  policy_benefits: ["policy_id", "benefit_name", "traits", "formula_kind", "quote", "reviewed_at", "basis_inferred", "requires"],
};
async function main() {
  const { pool } = await import("../lib/db/client");
  const target = (process.env.DATABASE_URL ?? "").replace(/:\/\/[^@]*@/, "://***@");
  console.log("DearPolicy database check");
  console.log("DATABASE_URL: " + (target || "NOT SET in .env.local"));
  if (!target) { console.log("\nFix: copy .env.example to .env.local and set DATABASE_URL."); process.exit(1); }
  try { await pool.query("SELECT 1"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    console.log("\nCannot reach PostgreSQL: " + (error instanceof Error ? error.message : error));
    console.log(code === "ECONNREFUSED"
      ? "\nFix, in order:\n  1. Open Docker Desktop and wait until it says running.\n  2. npm run db:start\n  3. npm run db:status   (wait for healthy)\n  4. npm run db:check"
      : "\nCheck the host, port, user and password in .env.local.");
    process.exit(1);
  }
  console.log("PostgreSQL: reachable\n");
  const tables = new Set((await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")).rows.map(r => r.table_name));
  const columns = await pool.query<{ table_name: string; column_name: string }>(
    "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'");
  const have = new Map<string, Set<string>>();
  for (const row of columns.rows) {
    if (!have.has(row.table_name)) have.set(row.table_name, new Set());
    have.get(row.table_name)!.add(row.column_name);
  }
  const problems: string[] = [];
  for (const [table, needed] of Object.entries(REQUIRED)) {
    if (!tables.has(table)) { problems.push("table " + table + " is missing"); console.log("  MISSING  " + table); continue; }
    const missing = needed.filter(column => !have.get(table)?.has(column));
    if (missing.length) { problems.push(table + " is missing: " + missing.join(", ")); console.log("  PARTIAL  " + table + " (no " + missing.join(", ") + ")"); }
    else console.log("  ok       " + table);
  }
  const extensions = new Set((await pool.query<{ extname: string }>("SELECT extname FROM pg_extension")).rows.map(r => r.extname));
  for (const extension of ["vector", "pgcrypto"]) {
    if (extensions.has(extension)) console.log("  ok       extension " + extension);
    else { problems.push("extension " + extension + " is not installed"); console.log("  MISSING  extension " + extension); }
  }
  if (problems.length) {
    console.log("\n" + problems.length + " problem(s) found. Fix with:\n\n   npm run db:setup\n");
    console.log("That is additive and repeatable: it adds what is missing and deletes nothing.");
    process.exit(1);
  }
  const counts = await pool.query<{ policies: number; benefits: number; people: number }>(
    "SELECT (SELECT count(*)::int FROM policies) AS policies,(SELECT count(*)::int FROM policy_benefits) AS benefits,(SELECT count(*)::int FROM family_members) AS people");
  const row = counts.rows[0];
  console.log("\nEverything the app needs is present.");
  console.log("  family profiles: " + row.people + "   documents: " + row.policies + "   indexed benefit rules: " + row.benefits);
  if (row.policies > 0 && row.benefits === 0) console.log("\n  No benefit rules are stored yet. Open the Benefits page and press \"Read them now\" (or run: npm run policies:index).");
  await pool.end();
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
