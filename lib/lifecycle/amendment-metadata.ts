/**
 * Round 8 (deletion semantics): the household's document rows as METADATA ONLY -- role, policy / group number,
 * whether active or superseded, what superseded it, when it was removed, effective / document dates. Used to tell a
 * policy whose amendment document was deleted or superseded ("its current terms are not confirmed") from one that was
 * never amended, and from an amendment the insurer reversed (lib/claims/person.ts amendmentRemovalsFor).
 *
 * This is the one deliberate read of policies WITHOUT activePredicate() outside the deletion coordinator: a removed
 * document has to be seen to be known as removed. It selects no text, no file, no benefit rows and no person data of
 * a removed document, and nothing it returns is ever shown or cited as evidence.
 */
import { query } from "@/lib/db/client";
import { readIncludingDeletedForInternalUse } from "@/lib/lifecycle/scopes";
import type { DocMeta } from "@/lib/claims/person";

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ts = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

/** Every document row of the household as metadata (no text). */
export async function loadDocMeta(accountId: string): Promise<DocMeta[]> {
  readIncludingDeletedForInternalUse("amendment_removal_metadata", "a deleted / superseded amendment must be known as removed so the policy's current terms are reported as unconfirmed; metadata columns only, never text");
  const rows = (await query<Record<string, unknown>>(
    `SELECT p.id::text AS id, p.document_role AS role, p.policy_number, to_jsonb(p)->>'group_policy_number' AS group_policy_number,
            (p.lifecycle_state='active') AS active, (p.superseded_at IS NOT NULL) AS superseded,
            (SELECT n.id::text FROM policies n WHERE n.account_id=p.account_id AND n.supersedes_id=p.id LIMIT 1) AS superseded_by,
            CASE WHEN p.lifecycle_state<>'active' THEN p.updated_at WHEN p.superseded_at IS NOT NULL THEN p.superseded_at END AS removed_on,
            to_jsonb(p)->>'effective_date' AS effective_date, to_jsonb(p)->>'document_date' AS document_date, p.created_at
       FROM policies p WHERE p.account_id=$1`, [accountId]).catch(() => ({ rows: [] as Record<string, unknown>[] }))).rows;
  return rows.map((r) => ({ id: String(r.id), role: (r.role as string) ?? null, policyNumber: (r.policy_number as string) ?? null, groupPolicyNumber: (r.group_policy_number as string) ?? null,
    active: !!r.active, superseded: !!r.superseded, supersededById: (r.superseded_by as string) ?? null, removedOn: ts(r.removed_on), effectiveDate: iso(r.effective_date), documentDate: iso(r.document_date), createdAt: ts(r.created_at) }));
}
