import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import { DOCUMENT_READ_IN_PART_MESSAGE } from "@/lib/documents/processing-errors";
import { BENEFIT_READ_FAILURE_KEY, readingCacheReady } from "@/lib/policies/read-failures";
import { documentCardTitle } from "@/lib/policies/document-name";

/** A person's documents (linked to them, or uploaded for them and not linked to anyone yet) whose reading did not finish: a failed read, a document read in part (pages that could not be
 * checked give no amounts), or a document whose cover reading stopped. Cover in them may be missing from Home and
 * Coverage, so "Not found" there must say so instead of reading as "you have no such cover". Documents still being
 * read are not counted here (Home already says so), and neither is a superseded copy. A receipt or letter whose cover
 * reading stopped is not counted: intake never reads cover from those. */
export type NotFullyRead = { count: number; names: string[]; ids: string[] };

export async function notFullyRead(accountId: string, familyMemberId: string): Promise<NotFullyRead> {
  try {
    const cache = await readingCacheReady();
    const rows = await query<{ id: string; product_name: string | null; original_filename: string | null; insurer: string | null; document_role: string | null; policy_number: string | null }>(
      `SELECT p.id::text AS id,p.product_name,p.original_filename,p.insurer,p.document_role,p.policy_number FROM policies p
        WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL
          AND (EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id AND pm.family_member_id=$2)
            OR (p.family_member_id=$2 AND NOT EXISTS(SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)))
          AND (p.processing_status='failed'
            OR (p.processing_status='ready' AND (p.processing_message ~ '^Read in part\\M' OR p.processing_message=$3
              ${cache ? `OR (p.reading_cache ? $4 AND NOT (coalesce(p.document_role,'')=ANY($5::text[])))` : ""})))
        ORDER BY p.created_at`,
      cache ? [accountId, familyMemberId, DOCUMENT_READ_IN_PART_MESSAGE, BENEFIT_READ_FAILURE_KEY, [...NO_COVER_READING_ROLES]] : [accountId, familyMemberId, DOCUMENT_READ_IN_PART_MESSAGE]);
    return { count: rows.rows.length, names: rows.rows.map((r) => documentCardTitle(r)), ids: rows.rows.map((r) => r.id) };
  } catch (error) {
    console.warn("Could not count documents not fully read:", error instanceof Error ? error.message : error);
    return { count: 0, names: [], ids: [] };
  }
}

/** The line a "Not found" tile (short) or Coverage answer adds when some of the person's documents were not fully read. */
export function notFullyReadNote(n: Pick<NotFullyRead, "count">, person: string, short = false): string | null {
  if (!n.count) return null;
  const head = `${n.count === 1 ? "One" : n.count} of ${person}’s documents ${n.count === 1 ? "was" : "were"} not fully read`;
  return short ? head + "." : `${head}, so cover in ${n.count === 1 ? "it" : "them"} may be missing here. Documents shows which and what to do.`;
}
