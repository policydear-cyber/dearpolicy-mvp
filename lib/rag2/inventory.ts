/**
 * V1.3: the household's document inventory for "what policies does my family have?" -- the existing structured
 * household/document lookup (lib/chat/household-status.ts documentsByPerson), grouped by person, plus documents
 * linked to nobody. Household-scoped and lifecycle-filtered by those queries (active, not superseded). Each readable
 * document carries the evidence of its own title line, so what is said about it is cited to the document itself.
 * No figure is read or stated here.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { documentsByPerson, isGroupGuide, type PersonDocument } from "@/lib/chat/household-status";
import { documentName } from "@/lib/policies/inventory";
import { evidenceAt, type EvidenceRef } from "./evidence";
import { loadDocs, loadMembers, loadPages } from "./store";

export type InventoryDoc = { policyId: string; name: string; insurer: string | null; filename: string; role: string | null;
  kind: "personal" | "reference" | "linked_unconfirmed" | "unlinked"; readable: "ready" | "processing" | "password" | "unreadable"; reason?: string | null; evidence?: EvidenceRef | null };
export type Inventory = { people: { id: string; name: string; short: string; documents: InventoryDoc[] }[]; unlinked: InventoryDoc[] };

const UNREADABLE_WHY: Record<string, string> = {
  password: "it is password protected and was uploaded without its password",
  photo: "the photo is too blurred, dark or faint to read",
  incomplete: "the PDF is incomplete (it stops part-way)",
  unopenable: "the file could not be opened",
  scan: "no text could be read from it",
};

export async function householdDocuments(accountId: string): Promise<Inventory> {
  const members = await loadMembers(accountId);
  const people = members.map((m) => ({ id: m.id, display_name: m.displayName, preferred_name: m.preferredName, relationship: m.relationship }));
  const byPerson = await documentsByPerson(accountId, people);
  const unlinkedRows = (await query<{ id: string; product_name: string | null; insurer: string | null; original_filename: string; document_role: string | null; processing_status: string; policy_number: string | null }>(
    `SELECT p.id::text AS id, p.product_name, p.insurer, p.original_filename, p.document_role, p.processing_status, p.policy_number
       FROM policies p
      WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.superseded_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id)
      ORDER BY p.created_at, p.id`, [accountId])).rows;
  const all = [...[...byPerson.values()].flat().filter((d) => d.status === "ready").map((d) => d.id), ...unlinkedRows.filter((r) => r.processing_status === "ready").map((r) => r.id)];
  const pages = all.length ? await loadPages(accountId, [...new Set(all)], [1]) : [];
  const hashes = new Map((await loadDocs(accountId)).map((d) => [d.id, d.fileHash]));
  const titleOf = (policyId: string): EvidenceRef | null => {
    const page = pages.find((p) => p.policyId === policyId && p.page === 1);
    if (!page) return null;
    const m = /\S[^\n]*/.exec(page.text);
    return m ? evidenceAt({ policyId, documentHash: hashes.get(policyId) ?? null, page: 1, pageText: page.text, start: m.index, end: m.index + m[0].length }) : null;
  };
  const kindOf = (d: PersonDocument): InventoryDoc["kind"] => (d.confirmed ? "personal" : isGroupGuide(d) ? "reference" : "linked_unconfirmed");
  const toDoc = (d: PersonDocument): InventoryDoc => ({ policyId: d.id, name: d.name, insurer: d.insurer ?? null, filename: d.filename, role: d.role, kind: kindOf(d), readable: d.status,
    reason: d.status === "password" ? UNREADABLE_WHY.password : d.status === "unreadable" ? UNREADABLE_WHY[d.reason ?? "scan"] ?? UNREADABLE_WHY.scan : d.status === "processing" ? "it is still being read" : null, evidence: d.status === "ready" ? titleOf(d.id) : null });
  return {
    people: members.map((m) => ({ id: m.id, name: m.displayName, short: m.preferredName?.trim() || m.displayName.split(/\s+/)[0], documents: (byPerson.get(m.id) ?? []).map(toDoc) })),
    unlinked: unlinkedRows.map((r) => ({ policyId: r.id, name: documentName(r), insurer: r.insurer?.trim() || null, filename: r.original_filename, role: r.document_role, kind: "unlinked" as const,
      readable: r.processing_status === "ready" ? "ready" as const : r.processing_status === "failed" ? "unreadable" as const : "processing" as const, reason: null, evidence: r.processing_status === "ready" ? titleOf(r.id) : null })),
  };
}

/** The inventory as sentences, one per person (and one for documents linked to nobody): names, insurers, roles and
 * whether each file could be read -- no figures. */
export function inventorySentences(inv: Inventory): { text: string; evidence: EvidenceRef[] }[] {
  const said = (d: InventoryDoc) => {
    if (d.readable !== "ready") return `${d.filename} could not be read (${d.reason ?? "it could not be read"})`;
    const who = d.insurer ? `${d.insurer}, ` : "";
    const what = d.kind === "personal" ? "a personal policy document" : d.kind === "reference" ? "reference wording for the scheme, not a personal policy document" : d.kind === "unlinked" ? "not linked to anyone" : "linked, but not confirmed as a personal policy document";
    return `${d.name} (${who}${what})`;
  };
  const out: { text: string; evidence: EvidenceRef[] }[] = [];
  for (const p of inv.people) {
    if (!p.documents.length) { out.push({ text: `${p.short}: no documents on file.`, evidence: [] }); continue; }
    out.push({ text: `${p.short}: ${p.documents.map(said).join("; ")}.`, evidence: p.documents.map((d) => d.evidence).filter((e): e is EvidenceRef => !!e) });
  }
  // V1.5: a readable document linked to nobody can be used for a person once linked; a file whose contents could not be
  // read cannot be used at all, linked or not -- linking a file and reading its contents are separate.
  const readable = inv.unlinked.filter((d) => d.readable === "ready"), unreadable = inv.unlinked.filter((d) => d.readable !== "ready");
  if (readable.length) out.push({ text: `Not linked to anyone in the household: ${readable.map((d) => `${d.name}${d.insurer ? ` (${d.insurer})` : ""}`).join("; ")} -- link it to a person so it can be used for them.`, evidence: readable.map((d) => d.evidence).filter((e): e is EvidenceRef => !!e) });
  if (unreadable.length) out.push({ text: `Not linked to anyone in the household, and its contents could not be read: ${unreadable.map((d) => d.filename).join("; ")}. Nothing in ${unreadable.length > 1 ? "these files" : "it"} can be used; linking ${unreadable.length > 1 ? "them" : "it"} to a person would not change that -- ${unreadable.length > 1 ? "they" : "it"} would first have to be read successfully.`, evidence: unreadable.map((d) => d.evidence).filter((e): e is EvidenceRef => !!e) });
  return out;
}
