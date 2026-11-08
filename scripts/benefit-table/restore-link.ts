/**
 * Puts one section of a household's documents back under one of its covers (lib/benefit-table/service.ts restoreLink),
 * after a link was lost (7 Nov: a new upload re-sorted every section and moved one section to no cover).
 *
 * Read-only by default: prints the section's current link and how many rows each person shows now and would show
 * after (counts only). Changes data only with --apply, which saves the link as the household's own, so no later
 * reading or re-link changes it. Running it against production is the owner's call.
 *
 *   npm run benefit-table:restore-link -- --account <id> --section '<section key>' --cover '<cover key>'           # dry run
 *   npm run benefit-table:restore-link -- --account <id> --section '<section key>' --cover '<cover key>' --apply   # write
 */
import { appDb } from "@/lib/benefit-table/app";
import { restoreLink } from "@/lib/benefit-table/service";
import { pool } from "@/lib/db/client";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] ?? null : null; };

async function main() {
  const account = arg("account"), section = arg("section"), cover = arg("cover"), apply = process.argv.includes("--apply");
  if (!account || section == null || !cover) throw new Error("usage: --account <id> --section <section key> --cover <cover key> [--apply]");
  const r = await restoreLink(appDb, account, section, cover, apply);
  console.log(`section now: ${r.current ? `${r.current.cover ?? "no cover"} (set by ${r.current.chosenBy})` : "not linked"}`);
  for (const name of Object.keys(r.rowsAfter)) console.log(`${name}: ${r.rowsNow[name] ?? 0} rows now, ${r.rowsAfter[name]} after`);
  console.log(`rows added in all: ${r.added}`);
  console.log(apply ? "applied: the section is now linked to that cover, as the household's own link" : "dry run: nothing changed (add --apply to write it)");
}
main().catch((e) => { console.error(e instanceof Error ? e.name + ": " + e.message : e); process.exitCode = 1; }).finally(() => pool.end?.().catch(() => undefined));
