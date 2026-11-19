/** What a household calls each of its documents in a sentence, labelled over the household's whole current library
 * (every active document, superseded copies included), so a document reads the same in every answer whichever people or
 * documents the answer is about (Critic L1). Never a file name (DC 18 Nov). */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { documentLabels } from "./document-name";

export async function householdDocumentLabels(accountId: string): Promise<Map<string, string>> {
  return (await householdDocumentNames(accountId)).labels;
}

/** Each document's label (told apart from its twins) and its title on its own (no twin tells): both built without the
 * file name -- a part of a multi-policy file is judged by the file it came from, a nameless upload reads "Photo uploaded
 * <day>" (TE #564 F1: the inventory's `name` must never be made from the file name either). */
export async function householdDocumentNames(accountId: string): Promise<{ labels: Map<string, string>; titles: Map<string, string> }> {
  const rows = (await query<{ id: string; original_filename: string | null; product_name: string | null; insurer: string | null; document_role: string | null; policy_number: string | null; created_at: string | null }>(
    `SELECT p.id::text AS id, p.original_filename, p.product_name, p.insurer, p.document_role, p.policy_number, p.created_at::text AS created_at
       FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} ORDER BY p.created_at, p.id`, [accountId])).rows;
  return { labels: documentLabels(rows, { describeUnnamed: true }), titles: new Map(rows.map((r) => [r.id, documentLabels([r], { describeUnnamed: true }).get(r.id)!])) };
}
