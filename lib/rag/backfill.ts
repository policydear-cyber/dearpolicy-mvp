import { query } from "@/lib/db/client";
import { countPolicyPassages, indexPolicyPassages, pineconeEnabled } from "@/lib/rag/pinecone";

/** Indexing documents that were read before there was anywhere to put vectors.
 *
 * Every passage of every document is already stored in Postgres, with the text
 * exactly as the reading model saw it. So catching up on semantic search does
 * not mean reading those documents again: it means sending text that is already
 * on hand to Pinecone. That matters because re-analysing costs a hosted model
 * call per page and can change benefit rows that are already right -- a bad
 * trade for something the database can answer on its own.
 *
 * Whether a document is already indexed is asked of Pinecone rather than
 * tracked in a column, so the answer stays true even if the index is deleted,
 * rebuilt, or the household moves to a different one. */

export type SemanticIndexState = {
  enabled: boolean;
  /** Documents that are ready and have passages worth indexing. */
  total: number;
  indexed: number;
  pending: number;
};

type IndexableDocument = { id: string; label: string; chunks: number };

async function indexableDocuments(accountId: string): Promise<IndexableDocument[]> {
  const result = await query<{ id: string; label: string; chunks: number }>(
    `SELECT p.id, COALESCE(p.product_name, p.original_filename) AS label,
            (SELECT count(*)::int FROM policy_chunks c WHERE c.account_id=p.account_id AND c.policy_id=p.id) AS chunks
       FROM policies p
      WHERE p.account_id=$1 AND p.processing_status='ready'
      ORDER BY p.created_at`,
    [accountId],
  );
  return result.rows.map((row) => ({ ...row, chunks: Number(row.chunks) || 0 })).filter((row) => row.chunks > 0);
}

export async function semanticIndexState(accountId: string): Promise<SemanticIndexState> {
  if (!pineconeEnabled()) return { enabled: false, total: 0, indexed: 0, pending: 0 };
  const documents = await indexableDocuments(accountId);
  let indexed = 0;
  for (const document of documents) {
    const count = await countPolicyPassages({ accountId, policyId: document.id });
    if (count > 0) indexed += 1;
  }
  return { enabled: true, total: documents.length, indexed, pending: documents.length - indexed };
}

/** Sends every not-yet-indexed document's stored passages to Pinecone. No model
 * is called and nothing already extracted is touched, so this is safe to run
 * again at any time: a document already in the index is skipped. */
export async function backfillSemanticIndex(accountId: string) {
  if (!pineconeEnabled()) throw new Error("Semantic search is not configured");
  const documents = await indexableDocuments(accountId);
  const indexedNow: string[] = [];
  const failed: { label: string; reason: string }[] = [];
  let alreadyIndexed = 0;

  for (const document of documents) {
    try {
      if (await countPolicyPassages({ accountId, policyId: document.id })) { alreadyIndexed += 1; continue; }
      const passages = await query<{ id: string; page_start: number; page_end: number; heading: string | null; text: string }>(
        `SELECT id, page_start, page_end, heading, text FROM policy_chunks
          WHERE account_id=$1 AND policy_id=$2 ORDER BY page_start, id`,
        [accountId, document.id],
      );
      if (!passages.rows.length) continue;
      await indexPolicyPassages({
        accountId, policyId: document.id,
        passages: passages.rows.map((row) => ({
          chunkId: row.id, policyId: document.id, pageStart: row.page_start,
          pageEnd: row.page_end, heading: row.heading, text: row.text,
        })),
      });
      indexedNow.push(document.label);
    } catch (error) {
      // One document failing must not stop the rest: the point of this is to
      // close a gap, and closing most of it beats closing none of it.
      failed.push({ label: document.label, reason: error instanceof Error ? error.message : "Unknown indexing error" });
    }
  }
  return { indexed: indexedNow, alreadyIndexed, failed, total: documents.length };
}
