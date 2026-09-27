import { query } from "@/lib/db/client";

/** Per-page checkpoints for the two catalogue passes.
 *
 * The catalogue passes make one model call per prose page. On Vercel Hobby
 * there is no worker: processing advances inside bounded request drains, and
 * an invocation that runs out of its window is simply cut off. Before this
 * file existed the passes accumulated everything in memory and persisted only
 * at the end of the loop, so a cut-off lost every page already read and the
 * retry started again at page 1. A long document could therefore never
 * finish: observed live with a 39-page product summary that reached page 20
 * on one attempt, restarted at page 3 on the next, and was headed for the
 * dead-letter queue.
 *
 * The checkpoint lives in policy_analysis_cache -- an existing service-only
 * key/value table, so no schema change -- and records the next page index to
 * read, the items collected so far and the dedupe keys already seen, guarded
 * by a fingerprint of the page list so a resumed run never continues over
 * different text. Every read and write here is best-effort: a checkpoint
 * failure degrades to the old restart-from-scratch behaviour, never to a
 * failed document. */
export type CatalogCheckpoint<T> = {
  nextIndex: number;
  items: T[];
  seenKeys: string[];
};

export type CatalogCheckpointScope = {
  accountId: string;
  policyId: string;
  stage: "benefits" | "conditions";
};

function cacheKey(scope: CatalogCheckpointScope) {
  return `catalog-progress:${scope.stage}:${scope.policyId}`;
}

/** Cheap, order-sensitive fingerprint of the filtered page list. Not
 * cryptographic: it only needs to notice that a document's pages changed
 * between attempts, in which case resuming would attach results to the wrong
 * text and starting over is the correct thing. */
function pagesFingerprint(pages: { page_number: number; text: string }[]) {
  let hash = 0;
  for (const page of pages) {
    const part = `${page.page_number}:${page.text.length};`;
    for (let i = 0; i < part.length; i++) hash = (hash * 31 + part.charCodeAt(i)) | 0;
  }
  return `${pages.length}:${(hash >>> 0).toString(16)}`;
}

export async function readCatalogCheckpoint<T>(
  scope: CatalogCheckpointScope,
  pages: { page_number: number; text: string }[],
): Promise<CatalogCheckpoint<T> | null> {
  try {
    const r = await query<{ analysis_json: unknown }>(
      "SELECT analysis_json FROM policy_analysis_cache WHERE account_id=$1 AND cache_key=$2",
      [scope.accountId, cacheKey(scope)],
    );
    const raw = r.rows[0]?.analysis_json;
    const record = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as
      | (CatalogCheckpoint<T> & { fingerprint?: string })
      | null;
    if (!record) return null;
    if (record.fingerprint !== pagesFingerprint(pages)) return null;
    if (!Number.isInteger(record.nextIndex) || record.nextIndex < 0 || record.nextIndex > pages.length) return null;
    if (!Array.isArray(record.items) || !Array.isArray(record.seenKeys)) return null;
    return { nextIndex: record.nextIndex, items: record.items, seenKeys: record.seenKeys.map(String) };
  } catch {
    return null; /* No checkpoint is always safe: the pass starts at page 1. */
  }
}

export async function writeCatalogCheckpoint<T>(
  scope: CatalogCheckpointScope,
  pages: { page_number: number; text: string }[],
  checkpoint: CatalogCheckpoint<T>,
) {
  try {
    await query(
      "INSERT INTO policy_analysis_cache(account_id,cache_key,analysis_json) VALUES($1,$2,$3) " +
        "ON CONFLICT(account_id,cache_key) DO UPDATE SET analysis_json=excluded.analysis_json,created_at=now()",
      [scope.accountId, cacheKey(scope), JSON.stringify({ fingerprint: pagesFingerprint(pages), ...checkpoint })],
    );
  } catch {
    /* Best-effort: a missed write only widens the resume window. */
  }
}

export async function clearCatalogCheckpoint(scope: CatalogCheckpointScope) {
  try {
    await query("DELETE FROM policy_analysis_cache WHERE account_id=$1 AND cache_key=$2", [
      scope.accountId,
      cacheKey(scope),
    ]);
  } catch {
    /* A stale row is invalidated by the fingerprint on the next read. */
  }
}
