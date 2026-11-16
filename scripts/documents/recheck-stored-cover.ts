/** Re-runs the plain-code fact check on documents already read, from their stored page text and stored reading, so a
 * fix to the check reaches them with no model call and no re-read (lib/documents/recheck-stored-cover.ts).
 * Changes only whether a cover line is proven ("Covered" vs "On file, please confirm"); never an amount or a currency.
 *
 *   npm run -s documents:recheck-stored-cover -- --household <account id> [--document <policy id>]            (dry run)
 *   npm run -s documents:recheck-stored-cover -- --household <account id> [--document <policy id>] --apply    (writes)
 *   ... --apply --allow-downgrade   also applies proven -> unproven (always reported; left proven without this flag)
 *
 * Dry run is the default and writes nothing; it prints the counts of lines that would change and in which direction.
 * Safe to run again: a second run finds nothing to change. */
import path from "node:path";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  try { process.loadEnvFile(path.resolve(".env.local")); } catch { /* optional outside local dev */ }
  const household = arg("--household"), document = arg("--document");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!household || !uuid.test(household) || (document && !uuid.test(document))) {
    console.error("Usage: --household <account id> [--document <policy id>] [--apply] [--allow-downgrade]");
    process.exit(2);
  }
  // Nothing here reads with a model: no request may leave the machine except to the database.
  globalThis.fetch = (async () => { throw new Error("recheck-stored-cover makes no network or model call"); }) as typeof fetch;
  const { recheckStoredCover, recheckSummary } = await import("@/lib/documents/recheck-stored-cover");
  const { pool } = await import("@/lib/db/client");
  const report = await recheckStoredCover({ accountId: household, policyId: document }, { apply: process.argv.includes("--apply"), allowDowngrade: process.argv.includes("--allow-downgrade") });
  console.log(recheckSummary(report));
  for (const c of report.changes) console.log(`  ${c.from ? "confirmed -> unconfirmed" : "unconfirmed -> confirmed"}${c.applied ? "" : c.held ? ` (not written: ${c.held})` : " (not written)"}: document ${c.policyId}, line ${c.coverageId}, ${c.category}${c.sourcePage ? `, page ${c.sourcePage}` : ""}`);
  await pool.end();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
