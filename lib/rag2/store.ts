/**
 * Conversational RAG: the household-scoped reads every lib/rag2 tool goes through. Every read is filtered by the
 * account id, the lifecycle predicate (lib/lifecycle/scopes.ts activePredicate) and -- for document text -- the
 * read-side trust predicate (released by the document-safety gate, current version, finished reading:
 * lib/policies/trusted.ts). A document that is deleted, pending, scan-rejected or superseded supplies nothing.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { trustedPolicyStatePredicate } from "@/lib/policies/trusted";
import { amendmentRemovalsFor, isAmendmentRole, type AmendmentRemoval, type DocMeta } from "@/lib/claims/person";

export type DocRow = {
  id: string; ownerId: string; insurer: string | null; productName: string | null; policyNumber: string | null; groupPolicyNumber: string | null;
  policyType: string | null; documentRole: string | null; personalCoverageConfirmed: boolean; status: string | null;
  fileHash: string | null; effectiveDate: string | null; expiryDate: string | null; documentDate: string | null; createdAt: string | null; pageCount: number | null;
  /** Lifecycle version + last-update stamp of the document row: any change to the row (reprocess, relink, supersede, restore) changes it. */
  rev?: string | null;
};
export type MemberRow = { id: string; displayName: string; preferredName: string | null; relationship: string; notes: string | null; dateOfBirth: string | null };
export type LinkRow = { policyId: string; memberId: string; source: string | null; tier: string | null };
export type PageRow = { policyId: string; page: number; text: string };

const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

// ---------------------------------------------------------------------------------------------------------------
// Death-journey release (item 4): the TURN STORE.
//
// Measured (scripts/reliable-chat-latency-death.ts): one broad death turn issued 20 reads of the household's documents and 20 reads
// of ALL their page text (12.5 MB of text for a 19-document library) -- person_benefits resolved a person twice, every search
// loaded and tokenised the whole library again, and so did each page read, evaluation and verification. The documents do not
// change within a turn; what must still be checked is WHICH documents are readable (lifecycle, release, version).
//
// So inside one turn (runLoop opens the scope) the reads are kept, with the checks preserved:
//   * the readable-document list, the members and the policy links are re-read at the start of every tool call and model
//     step (`newRound`), so a document deleted, superseded or unreleased while the turn runs drops out at the next step;
//   * page text is kept per document VERSION (id + file hash + page count + status) and only for documents the current
//     round's list still calls readable, so a new version is a different key and an unreadable document supplies nothing;
//   * results derived from them (a person's benefit view, a search's tokenised passages) are kept under a key that includes
//     the fingerprint of the readable documents, links and members they were derived from.
// Nothing is shared across turns, households or processes; outside runLoop the readers behave exactly as before.
// ---------------------------------------------------------------------------------------------------------------
type TurnStoreState = {
  accountId: string; docs: DocRow[] | null; members: MemberRow[] | null; metaDigest: string | null; links: Map<string, LinkRow[]>;
  pages: Map<string, PageRow[]>; memo: Map<string, unknown>;
  stats: { docsSql: number; docsServed: number; membersSql: number; linksSql: number; pagesSql: number; pagesServed: number; pageChars: number; memoHits: number; memoMisses: number; rounds: number };
};
const turnStore = new AsyncLocalStorage<TurnStoreState>();
const activeTurn = (accountId: string): TurnStoreState | null => { const t = turnStore.getStore(); return t && t.accountId === accountId ? t : null; };
export function withTurnStore<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  // (re-entrant: the turn's outer scope -- the chat hook, which also covers the answer's citations, verification and saving -- is joined, not replaced)
  if (activeTurn(accountId)) return fn();
  return turnStore.run({ accountId, docs: null, members: null, metaDigest: null, links: new Map(), pages: new Map(), memo: new Map(),
    stats: { docsSql: 0, docsServed: 0, membersSql: 0, linksSql: 0, pagesSql: 0, pagesServed: 0, pageChars: 0, memoHits: 0, memoMisses: 0, rounds: 0 } }, fn);
}
/** The start of a tool call or model step: the readable documents, members and links are read again on next use. */
export function newToolRound(): void {
  const t = turnStore.getStore();
  if (!t) return;
  t.docs = null; t.members = null; t.metaDigest = null; t.links.clear(); t.stats.rounds++;
}
export function turnStoreStats(): TurnStoreState["stats"] | null { return turnStore.getStore()?.stats ?? null; }
const docKey = (d: DocRow) => [d.id, d.fileHash ?? "", d.pageCount ?? "", d.status ?? "", d.createdAt ?? "", d.documentRole ?? "", d.productName ?? "", d.rev ?? ""].join("|");
/** What a result derived from the household's documents depends on: the readable documents (version and role), the policy
 * links and the members. Part of every memo key. */
export async function derivedFingerprint(accountId: string): Promise<string | null> {
  const t = activeTurn(accountId);
  if (!t) return null;
  const docs = await loadDocs(accountId), members = await loadMembers(accountId), links = await loadLinks(accountId, docs.map((d) => d.id));
  // EVERY field a benefit resolution reads is part of the fingerprint (not only identity): the owner, insurer, product and policy
  // numbers (policy families), type, role, confirmation flag, dates, version stamp; each member's name, relation, notes and date of
  // birth; each link's person, tier and source; and the household's removed / superseded document metadata (an amendment that was
  // deleted or reversed changes what a policy's terms are even though it is no longer a readable document).
  if (t.metaDigest == null) t.metaDigest = (await loadDocMeta(accountId)).map((m) => [m.id, m.role ?? "", m.policyNumber ?? "", m.groupPolicyNumber ?? "", m.active ? 1 : 0, m.superseded ? 1 : 0, m.supersededById ?? "", m.removedOn ?? "", m.effectiveDate ?? "", m.documentDate ?? ""].join(":")).sort().join(",");
  return [docs.map((d) => JSON.stringify([d.id, d.ownerId, d.insurer, d.productName, d.policyNumber, d.groupPolicyNumber, d.policyType, d.documentRole, d.personalCoverageConfirmed, d.status, d.fileHash, d.effectiveDate, d.expiryDate, d.documentDate, d.createdAt, d.pageCount, d.rev ?? null])).join(","),
    members.map((m) => JSON.stringify([m.id, m.displayName, m.preferredName, m.relationship, m.notes, m.dateOfBirth])).join(","),
    links.map((l) => JSON.stringify([l.policyId, l.memberId, l.tier, l.source])).sort().join(","), t.metaDigest].join("#");
}
/** A result derived from ONE document version (its parsed tables, say), kept for the turn: independent of who it is read for. */
export function turnMemoByDoc<T>(accountId: string, d: DocRow, key: string, build: () => T): T {
  const t = activeTurn(accountId);
  if (!t) return build();
  const k = `doc|${key}|${docKey(d)}`;
  if (t.memo.has(k)) { t.stats.memoHits++; return t.memo.get(k) as T; }
  t.stats.memoMisses++;
  const v = build();
  t.memo.set(k, v);
  return v;
}
/** A derived result kept for the rest of the turn under `key` (null fingerprint = no turn scope: built every time). */
export async function turnMemo<T>(accountId: string, key: string, build: () => Promise<T>): Promise<T> {
  const t = activeTurn(accountId);
  const fp = t ? await derivedFingerprint(accountId) : null;
  if (!t || fp == null) return build();
  const k = `${key}@${fp}`;
  if (t.memo.has(k)) { t.stats.memoHits++; return t.memo.get(k) as T; }
  t.stats.memoMisses++;
  const v = await build();
  t.memo.set(k, v);
  return v;
}

/** The household's readable documents: active, released, current and read. `policyIds` narrows them. */
export async function loadDocs(accountId: string, policyIds?: string[] | null): Promise<DocRow[]> {
  const t = activeTurn(accountId);
  if (t) {
    if (!t.docs) { t.docs = await queryDocs(accountId, null); t.stats.docsSql++; }
    t.stats.docsServed++;
    const only = policyIds && policyIds.length ? new Set(policyIds) : null;
    return only ? t.docs.filter((d) => only.has(d.id)) : [...t.docs];
  }
  return queryDocs(accountId, policyIds);
}
async function queryDocs(accountId: string, policyIds?: string[] | null): Promise<DocRow[]> {
  const narrow = policyIds && policyIds.length ? policyIds : null;
  const rows = (await query<Record<string, unknown>>(
    `SELECT p.id::text AS id, p.family_member_id::text AS owner_id, p.insurer, p.product_name, p.policy_number,
            to_jsonb(p)->>'group_policy_number' AS group_policy_number, p.policy_type, p.document_role, p.personal_coverage_confirmed,
            p.status, to_jsonb(p)->>'file_hash' AS file_hash, to_jsonb(p)->>'effective_date' AS effective_date,
            to_jsonb(p)->>'renewal_or_expiry_date' AS expiry_date, to_jsonb(p)->>'document_date' AS document_date, p.created_at, p.page_count,
            COALESCE(to_jsonb(p)->>'lifecycle_version','') || '@' || COALESCE(to_jsonb(p)->>'updated_at','') AS rev
       FROM policies p
      WHERE p.account_id=$1 AND ${activePredicate("p")} AND ${trustedPolicyStatePredicate("p")} AND p.processing_status='ready'
        AND ($2::text[] IS NULL OR p.id::text = ANY($2::text[]))
      ORDER BY p.created_at, p.id`, [accountId, narrow])).rows;
  return rows.map((r) => ({
    id: String(r.id), ownerId: String(r.owner_id), insurer: (r.insurer as string) ?? null, productName: (r.product_name as string) ?? null,
    policyNumber: (r.policy_number as string) ?? null, groupPolicyNumber: (r.group_policy_number as string) ?? null, policyType: (r.policy_type as string) ?? null,
    documentRole: (r.document_role as string) ?? null, personalCoverageConfirmed: !!r.personal_coverage_confirmed, status: (r.status as string) ?? null,
    fileHash: (r.file_hash as string) ?? null, effectiveDate: iso(r.effective_date), expiryDate: iso(r.expiry_date), documentDate: iso(r.document_date),
    createdAt: r.created_at == null ? null : r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at), pageCount: r.page_count == null ? null : Number(r.page_count), rev: (r.rev as string) ?? null,
  }));
}

/** The household's active people. */
export async function loadMembers(accountId: string): Promise<MemberRow[]> {
  const t = activeTurn(accountId);
  if (t) { if (!t.members) { t.members = await queryMembers(accountId); t.stats.membersSql++; } return [...t.members]; }
  return queryMembers(accountId);
}
async function queryMembers(accountId: string): Promise<MemberRow[]> {
  const rows = (await query<Record<string, unknown>>(
    `SELECT f.id::text AS id, f.display_name, f.preferred_name, f.relationship, f.notes, f.date_of_birth
       FROM family_members f WHERE f.account_id=$1 AND ${activePredicate("f")} ORDER BY f.created_at, f.id`, [accountId])).rows;
  return rows.map((r) => ({ id: String(r.id), displayName: String(r.display_name ?? ""), preferredName: (r.preferred_name as string) ?? null, relationship: String(r.relationship ?? ""), notes: (r.notes as string) ?? null, dateOfBirth: iso(r.date_of_birth) }));
}

/** Who each readable document is linked to (policy_members), with the column / tier recorded for them. */
export async function loadLinks(accountId: string, policyIds: string[]): Promise<LinkRow[]> {
  if (!policyIds.length) return [];
  const t = activeTurn(accountId);
  if (t) {
    const missing = policyIds.filter((id) => !t.links.has(id));
    if (missing.length) {
      const rows = await queryLinks(accountId, missing); t.stats.linksSql++;
      for (const id of missing) t.links.set(id, []);
      for (const r of rows) t.links.get(r.policyId)?.push(r);
    }
    return policyIds.flatMap((id) => t.links.get(id) ?? []);
  }
  return queryLinks(accountId, policyIds);
}
async function queryLinks(accountId: string, policyIds: string[]): Promise<LinkRow[]> {
  const rows = (await query<Record<string, unknown>>(
    `SELECT pm.policy_id::text AS policy_id, pm.family_member_id::text AS member_id, pm.source, to_jsonb(pm)->>'benefit_tier' AS tier
       FROM policy_members pm JOIN family_members f ON f.id=pm.family_member_id AND f.account_id=pm.account_id AND ${activePredicate("f")}
      WHERE pm.account_id=$1 AND pm.policy_id::text = ANY($2::text[])`, [accountId, policyIds])).rows;
  return rows.map((r) => ({ policyId: String(r.policy_id), memberId: String(r.member_id), source: (r.source as string) ?? null, tier: (r.tier as string) ?? null }));
}

/** Stored page text of readable documents only (the trust predicate is re-applied on the join). */
export async function loadPages(accountId: string, policyIds: string[], pages?: number[] | null): Promise<PageRow[]> {
  if (!policyIds.length) return [];
  const t = activeTurn(accountId);
  if (t) {
    // only documents this round's list still calls readable supply text; a document's pages are kept per VERSION
    const readable = new Map((await loadDocs(accountId)).map((d) => [d.id, d]));
    const want = [...new Set(policyIds)].filter((id) => readable.has(id));
    const keyOf = (id: string) => docKey(readable.get(id)!);
    const missing = want.filter((id) => !t.pages.has(keyOf(id)));
    if (missing.length && pages && pages.length) {
      // a page subset of documents not yet kept is read as asked and not kept (a partial read is not the document)
      const rows = await queryPages(accountId, missing, pages); t.stats.pagesSql++;
      const have = want.filter((id) => !missing.includes(id)).flatMap((id) => t.pages.get(keyOf(id))!.filter((p) => pages.includes(p.page)));
      return [...rows, ...have].sort((a, b) => (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : a.page - b.page));
    }
    if (missing.length) {
      const rows = await queryPages(accountId, missing, null); t.stats.pagesSql++;
      for (const id of missing) t.pages.set(keyOf(id), []);
      for (const r of rows) { t.pages.get(keyOf(r.policyId))?.push(r); t.stats.pageChars += r.text.length; }
    }
    const out = want.flatMap((id) => t.pages.get(keyOf(id)) ?? []).filter((p) => !(pages && pages.length) || pages.includes(p.page));
    t.stats.pagesServed += out.length;
    return out.sort((a, b) => (a.policyId < b.policyId ? -1 : a.policyId > b.policyId ? 1 : a.page - b.page));
  }
  return queryPages(accountId, policyIds, pages);
}
async function queryPages(accountId: string, policyIds: string[], pages?: number[] | null): Promise<PageRow[]> {
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

// ---------------------------------------------------------------------------------------------------------------
// V1: documents of one policy, and a tool's document reference
// ---------------------------------------------------------------------------------------------------------------
export const normPolicyNumber = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const isEndorsementDoc = (d: DocRow) => /endorse|alteration|amendment/i.test(d.documentRole ?? "");
/** The readable documents of the same policy as `doc` (itself included): the same policy or group policy number --
 * a schedule and its endorsements. A document without a policy number is a policy of its own. */
export function policyFamily(docs: DocRow[], doc: DocRow): DocRow[] {
  const keys = [normPolicyNumber(doc.policyNumber), normPolicyNumber(doc.groupPolicyNumber)].filter((k) => k.length >= 4);
  if (!keys.length) return [doc];
  const fam = docs.filter((d) => d.id === doc.id || [normPolicyNumber(d.policyNumber), normPolicyNumber(d.groupPolicyNumber)].some((k) => k.length >= 4 && keys.includes(k)));
  return fam.some((d) => d.id === doc.id) ? fam : [doc, ...fam];
}
/** The policy's own document (schedule / certificate) among its family: `doc` itself unless it is an endorsement, else
 * the earliest non-endorsement document; an endorsement alone stands for itself. */
export function familyBase(family: DocRow[], doc: DocRow): DocRow {
  if (!isEndorsementDoc(doc)) return doc;
  const bases = family.filter((d) => !isEndorsementDoc(d)).sort((a, b) => String(a.effectiveDate ?? a.documentDate ?? a.createdAt ?? "").localeCompare(String(b.effectiveDate ?? b.documentDate ?? b.createdAt ?? "")));
  return bases[0] ?? doc;
}
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A tool's `policy_id`: a readable document id, or -- as models also pass -- the policy number, or the insurer /
 * product words of exactly ONE policy (its schedule is used). Anything else is refused with the readable documents
 * listed, and an id that is not readable (another household's, deleted, superseded, not released) stays refused. */
export function resolveDocumentRef(docs: DocRow[], ref: string): { doc: DocRow; by: "id" | "policy_number" | "name" } | { error: string } {
  const r = String(ref ?? "").trim();
  const exact = docs.find((d) => d.id === r);
  if (exact) return { doc: exact, by: "id" };
  const listing = () => docs.map((d) => `${d.id} (${[d.insurer, d.productName, d.documentRole, d.policyNumber].filter(Boolean).join(", ")})`).join("; ");
  if (!r || UUIDISH.test(r)) return { error: "that document is not one of this household's readable documents" + (docs.length ? `; the readable documents are: ${listing()}` : "") };
  const no = normPolicyNumber(r);
  let hits = no.length >= 4 ? docs.filter((d) => normPolicyNumber(d.policyNumber) === no || normPolicyNumber(d.groupPolicyNumber) === no) : [];
  let by: "policy_number" | "name" = "policy_number";
  if (!hits.length) {
    const words = (r.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !["the", "and", "plan", "policy", "insurance", "assurance", "document"].includes(w));
    hits = words.length ? docs.filter((d) => { const hay = [d.insurer, d.productName, d.policyNumber].join(" ").toLowerCase(); return words.every((w) => hay.includes(w)); }) : [];
    by = "name";
  }
  const bases = [...new Map(hits.map((d) => { const b = familyBase(policyFamily(docs, d), d); return [b.id, b] as const; })).values()];
  if (bases.length === 1) return { doc: bases[0], by };
  return { error: `policy_id must be a document id${bases.length > 1 ? ` (“${r}” matches more than one policy)` : ` (“${r}” is not one)`}; the readable documents are: ${listing()}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Round 8: removed amendment documents (metadata only -- a removed document's text is never selected)
// ---------------------------------------------------------------------------------------------------------------
export { loadDocMeta } from "@/lib/lifecycle/amendment-metadata";
import { loadDocMeta } from "@/lib/lifecycle/amendment-metadata";
/** For each readable (active) base document, the removed amendments of its policy and what they mean (see
 * lib/claims/person.ts amendmentRemovalsFor). Only ACTIVE documents' text is read (for an explicit reversal). */
export async function amendmentRemovals(accountId: string, docs: DocRow[]): Promise<Map<string, AmendmentRemoval[]>> {
  const out = new Map<string, AmendmentRemoval[]>();
  const meta = await loadDocMeta(accountId);
  if (!meta.some((m) => isAmendmentRole(m.role) && (!m.active || m.superseded))) return out;
  const texts = new Map<string, string>();
  // (The policy's remaining readable documents -- not only `docs` -- may print a reversal.)
  const readable = meta.filter((m) => m.active && !m.superseded).map((m) => m.id);
  for (const p of await loadPages(accountId, readable)) texts.set(p.policyId, (texts.get(p.policyId) ?? "") + "\n" + p.text);
  for (const d of docs) {
    const base = meta.find((m) => m.id === d.id);
    if (!base) continue;
    const r = amendmentRemovalsFor(base, meta, texts);
    if (r.length) out.set(d.id, r);
  }
  return out;
}
