/**
 * One-off catch-up for documents deleted before late writes were re-checked (lib/lifecycle/content-scrub.ts). The
 * ordinary scrub only re-checks documents scrubbed in the last LEFTOVER_WINDOW_HOURS; a document scrubbed earlier
 * whose still-running reading wrote pages, passages, benefit lines, premiums or its own fields afterwards is cleaned
 * only by this pass, which has no window.
 *
 * Read-only by default: prints how many deleted documents still hold something read from them (a count only, never
 * any content). Changes data only with --apply, which runs the scrub without a window until nothing is left.
 * Running it against production is the owner's call.
 *
 *   npm run lifecycle:deleted-leftovers-sweep            # dry run: the count
 *   npm run lifecycle:deleted-leftovers-sweep -- --apply # clean them
 */
import { countDeletedDocumentLeftovers, scrubDeletedDocuments } from "@/lib/lifecycle/content-scrub";
import { purgeSoon } from "@/lib/storage/purge";
import { pool } from "@/lib/db/client";

async function main() {
  const apply = process.argv.includes("--apply");
  const before = await countDeletedDocumentLeftovers();
  console.log(`deleted documents still holding content read from them: ${before}`);
  if (!apply) { console.log("dry run: nothing changed (add --apply to clean them)"); return; }
  // A document that fails (or whose search passages could not be removed) is left out of later rounds, so a block of
  // stuck ones never hides the rest; the final count still reports them.
  const skip = new Set<string>();
  let total = 0, failed = 0, pending = 0;
  for (let round = 0; round < 1000; round++) {
    const r = await scrubDeletedDocuments({ leftoverWindowHours: null, limit: 25, skipPolicyIds: [...skip] });
    total += r.scrubbed; failed += r.failed; pending += r.searchIndexPending.length;
    const stuck = [...r.failedIds, ...r.searchIndexPending];
    stuck.forEach((id) => skip.add(id));
    if (r.scrubbed === 0 && stuck.length === 0) break;
  }
  await purgeSoon();
  const after = await countDeletedDocumentLeftovers();
  console.log(`cleaned: ${total}, failed: ${failed}, search-index removal pending: ${pending}, still holding content: ${after}`);
  if (after > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.name + ": " + e.message : e); process.exitCode = 1; }).finally(() => pool.end?.().catch(() => undefined));
