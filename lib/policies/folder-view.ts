/** What the Documents page shows for policy folders (components/policy-folders.tsx), worked out from the folders and the
 * documents the page already has. Client-safe: no server imports. */
import type { FolderSlot } from "@/lib/policies/folders";

export type FolderView = {
  id: string;
  name: string | null;
  complete: boolean;
  people: { id: string; name: string }[];
  documents: { policyId: string; slot: FolderSlot | null }[];
  /** Documents a newer copy replaced, with that copy, offered as "Add it" (lib/policies/folders.ts). */
  replacements?: { policyId: string; slot: FolderSlot | null; by: string }[];
};
export type FolderDoc = {
  id: string;
  product_name: string | null;
  insurer: string | null;
  policy_number: string | null;
  linked_people: { id: string; source?: string }[];
};

/** The slots on "Create a policy", in the order asked, with the household's words for each. */
export const SLOT_LABELS: Record<FolderSlot, string> = {
  schedule: "Schedule or certificate",
  wording: "Policy wording or terms",
  rider: "Riders or endorsements",
  other: "Other documents",
};
export const SLOT_HINTS: Record<FolderSlot, string> = {
  schedule: "The pages that show your cover amounts",
  wording: "The booklet that explains the benefits",
  rider: "Add as many as you have",
  other: "Anything else for this policy",
};

/** A folder's name: the household's own; else its schedule's (or first document's) product and insurer as read; else who
 * it is for. Never a guess from another folder. */
export function folderTitle(folder: FolderView, docs: Map<string, FolderDoc>): string {
  if (folder.name) return folder.name;
  const inIt = folder.documents.map((d) => ({ slot: d.slot, doc: docs.get(d.policyId) })).filter((d): d is { slot: FolderSlot | null; doc: FolderDoc } => !!d.doc);
  const named = [...inIt.filter((d) => d.slot === "schedule"), ...inIt].find((d) => d.doc.product_name?.trim());
  if (named) {
    const product = named.doc.product_name!.trim(), insurer = named.doc.insurer?.trim();
    return insurer && !product.toLowerCase().includes(insurer.toLowerCase()) ? `${insurer} ${product}` : product;
  }
  const people = folder.people.map((p) => p.name);
  return people.length ? `Policy for ${people.length <= 2 ? people.join(" and ") : `${people.slice(0, -1).join(", ")} and ${people.at(-1)}`}` : "Policy";
}

const numberKey = (n: string | null) => (n ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();

export type FolderSuggestion = { policyNumber: string; policyIds: string[]; personIds: string[] };
/** Documents that print the same policy number and are linked to the same person, not yet together in one folder: offered
 * as "Make these one policy?", never joined until the household says yes. Only the people every one of them is linked to
 * (by the household or the reading, not by a plan match) are suggested, so a suggestion never puts two people's documents
 * together. Short numbers (under 5 letters and digits) suggest nothing. */
export function folderSuggestions(docs: FolderDoc[], folders: FolderView[]): FolderSuggestion[] {
  const groups = new Map<string, FolderDoc[]>();
  for (const d of docs) {
    const key = numberKey(d.policy_number);
    if (key.length < 5) continue;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const out: FolderSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const insurers = new Set(group.map((d) => d.insurer?.trim().toLowerCase()).filter(Boolean));
    if (insurers.size > 1) continue;
    const own = (d: FolderDoc) => new Set(d.linked_people.filter((p) => p.source !== "scheme_reference_match").map((p) => p.id));
    const shared = [...own(group[0])].filter((id) => group.every((d) => own(d).has(id)));
    if (!shared.length) continue;
    const ids = group.map((d) => d.id);
    if (folders.some((f) => ids.every((id) => f.documents.some((d) => d.policyId === id)))) continue;
    out.push({ policyNumber: group[0].policy_number!.trim(), policyIds: ids, personIds: shared });
  }
  return out;
}
