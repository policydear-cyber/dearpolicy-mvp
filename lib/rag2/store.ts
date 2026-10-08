/**
 * Conversational RAG: the household-scoped reads every lib/rag2 tool goes through. Every read is filtered by the
 * account id, the lifecycle predicate (lib/lifecycle/scopes.ts activePredicate) and -- for document text -- the
 * read-side trust predicate (released by the document-safety gate, current version, finished reading:
 * lib/policies/trusted.ts). A document that is deleted, pending, scan-rejected or superseded supplies nothing.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";

export type DocRow = {
  id: string; ownerId: string; insurer: string | null; productName: string | null; policyNumber: string | null; groupPolicyNumber: string | null;
  policyType: string | null; documentRole: string | null; personalCoverageConfirmed: boolean; status: string | null;
  fileHash: string | null; effectiveDate: string | null; expiryDate: string | null; documentDate: string | null; createdAt: string | null; pageCount: number | null;
};
export type MemberRow = { id: string; displayName: string; preferredName: string | null; relationship: string; notes: string | null; dateOfBirth: string | null };
export type LinkRow = { policyId: string; memberId: string; source: string | null; tier: string | null };
export type PageRow = { policyId: string; page: number; text: string };

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** The household's readable documents: active, released, current and read. `policyIds` narrows them. */
export async function loadDocs(accountId: string, policyIds?: string[] | null): Promise<DocRow[]> {
  const narrow = policyIds && policyIds.length ? policyIds : null;
  const rows = (await query<Record<string, unknown>>(
    `SELECT p.id::text AS id, p.family_member_id::text AS owner_id, p.insurer, p.product_name, p.policy_number,
            to_jsonb(p)->>'group_policy_number' AS group_policy_number, p.policy_type, p.document_role, p.personal_coverage_confirmed,
            p.status, to_jsonb(p)->>'file_hash' AS file_hash, to_jsonb(p)->>'effective_date' AS effective_date,
            to_jsonb(p)->>'renewal_or_expiry_date' AS expiry_date, to_jsonb(p)->>'document_date' AS document_date, p.created_at, p.page_count
       FROM policies p
      WHERE p.account_id=$1 AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} AND p.processing_status='ready'
        AND ($2::text[] IS NULL OR p.id::text = ANY($2::text[]))
      ORDER BY p.created_at, p.id`, [accountId, narrow])).rows;
  return rows.map((r) => ({
    id: String(r.id), ownerId: String(r.owner_id), insurer: (r.insurer as string) ?? null, productName: (r.product_name as string) ?? null,
    policyNumber: (r.policy_number as string) ?? null, groupPolicyNumber: (r.group_policy_number as string) ?? null, policyType: (r.policy_type as string) ?? null,
    documentRole: (r.document_role as string) ?? null, personalCoverageConfirmed: !!r.personal_coverage_confirmed, status: (r.status as string) ?? null,
    fileHash: (r.file_hash as string) ?? null, effectiveDate: iso(r.effective_date), expiryDate: iso(r.expiry_date), documentDate: iso(r.document_date),
    createdAt: r.created_at == null ? null : r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at), pageCount: r.page_count == null ? null : Number(r.page_count),
  }));
}

/** The household's active people. */
export async function loadMembers(accountId: string): Promise<MemberRow[]> {
  const rows = (await query<Record<string, unknown>>(
    `SELECT f.id::text AS id, f.display_name, f.preferred_name, f.relationship, f.notes, f.date_of_birth
       FROM family_members f WHERE f.account_id=$1 AND ${activePredicate("f")} ORDER BY f.created_at, f.id`, [accountId])).rows;
  return rows.map((r) => ({ id: String(r.id), displayName: String(r.display_name ?? ""), preferredName: (r.preferred_name as string) ?? null, relationship: String(r.relationship ?? ""), notes: (r.notes as string) ?? null, dateOfBirth: iso(r.date_of_birth) }));
}

/** Who each readable document is linked to (policy_members), with the column / tier recorded for them. */
export async function loadLinks(accountId: string, policyIds: string[]): Promise<LinkRow[]> {
  if (!policyIds.length) return [];
  const rows = (await query<Record<string, unknown>>(
    `SELECT pm.policy_id::text AS policy_id, pm.family_member_id::text AS member_id, pm.source, to_jsonb(pm)->>'benefit_tier' AS tier
       FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")}
      WHERE pm.account_id=$1 AND pm.policy_id::text = ANY($2::text[])`, [accountId, policyIds])).rows;
  return rows.map((r) => ({ policyId: String(r.policy_id), memberId: String(r.member_id), source: (r.source as string) ?? null, tier: (r.tier as string) ?? null }));
}

/** Stored page text of readable documents only (the trust predicate is re-applied on the join). */
export async function loadPages(accountId: string, policyIds: string[], pages?: number[] | null): Promise<PageRow[]> {
  if (!policyIds.length) return [];
  const rows = (await query<{ policy_id: string; page_number: number; text: string }>(
    `SELECT pp.policy_id::text AS policy_id, pp.page_number, pp.text
       FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id AND p.account_id=pp.account_id
      WHERE pp.account_id=$1 AND pp.policy_id::text = ANY($2::text[]) AND ($3::int[] IS NULL OR pp.page_number = ANY($3::int[]))
        AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} AND p.processing_status='ready'
      ORDER BY pp.policy_id, pp.page_number`, [accountId, policyIds, pages && pages.length ? pages : null])).rows;
  return rows.map((r) => ({ policyId: r.policy_id, page: Number(r.page_number), text: r.text ?? "" }));
}

/** Pages of one document as a page-number -> text map. */
export async function pageMap(accountId: string, policyId: string): Promise<Map<number, string>> {
  return new Map((await loadPages(accountId, [policyId])).map((p) => [p.page, p.text]));
}
