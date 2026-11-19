/** What the Documents page shows for policy folders (components/policy-folders.tsx), worked out from the folders and the
 * documents the page already has. Client-safe: no server imports. */
import type { FolderSlot } from "@/lib/policies/folders";
import { insurerShortName, isCodeName } from "@/lib/policies/document-name";

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
  /** What the reading found the document to be ("personal_schedule", "policy_wording", ...), when the page has it. */
  document_role?: string | null;
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

/** One word that is a system's code, not a name: joined by underscores ("SGGRP_COI_APP"), letters and digits together
 * ("PW9", "COI2026", "POL.SCHED.V2", an id), or capitals joined by hyphens or dots ("SGGRP-COI-APP"). One-word names a
 * person reads ("Eldershield", "MINDEF", "Kestrel-Care") are kept. */
const codeWord = (t: string) => !/\s/.test(t) && (isCodeName(t) || (/\d/.test(t) && /[a-z]/i.test(t)) || /^[A-Z0-9]+(?:[-.][A-Z0-9]+)+$/.test(t));
/** A product name a person reads: not a system's code or a file name ("SGGRP_COI_APP", "cert_v2.pdf"). */
const plainName = (name: string | null | undefined) => {
  const t = name?.trim();
  return t && !codeWord(t) && !/\.(pdf|jpe?g|png|webp|tiff?|heic|docx?)$/i.test(t) ? t : null;
};

/** An insurer's short name a person reads ("Osprey Life" from "Osprey Life Pte. Ltd."), or null: never a code, a file
 * name, or only a legal suffix ("Pte. Ltd.", which insurerShortName gives back whole when nothing else is left). */
const plainInsurer = (insurer: string | null | undefined) => {
  if (!insurer?.trim() || /^(?:[\s,.&()]*(?:pte|pty|private|pvt|sdn|ltd|limited|berhad|bhd|plc|inc|llc|co|company)\b)+[\s,.&()]*$/i.test(insurer)) return null;
  return plainName(insurerShortName(insurer));
};

/** A folder's name: the household's own; else the insurer's plain product name from any document in it, the schedule's
 * first ("Singapore Life MINDEF & MHA Group Insurance", never "SGGRP_COI_APP"); else who it is for. Never a code, a file
 * name, or a guess from another folder. */
export function folderTitle(folder: FolderView, docs: Map<string, FolderDoc>): string {
  if (folder.name) return folder.name;
  const inIt = folder.documents.map((d) => ({ slot: d.slot, doc: docs.get(d.policyId) })).filter((d): d is { slot: FolderSlot | null; doc: FolderDoc } => !!d.doc);
  const named = [...inIt.filter((d) => d.slot === "schedule"), ...inIt].find((d) => plainName(d.doc.product_name));
  if (named) {
    const product = plainName(named.doc.product_name)!;
    const insurer = plainInsurer(named.doc.insurer);
    return insurer && !product.toLowerCase().includes(insurer.toLowerCase()) ? `${insurer} ${product}` : product;
  }
  // No plain product name: the insurer, when one was read, tells two such policies apart ("Osprey Life policy for Jane").
  const insurer = [...inIt.filter((d) => d.slot === "schedule"), ...inIt].map((d) => plainInsurer(d.doc.insurer)).find(Boolean);
  const people = folder.people.map((p) => p.name);
  const whose = people.length ? ` for ${people.length <= 2 ? people.join(" and ") : `${people.slice(0, -1).join(", ")} and ${people.at(-1)}`}` : "";
  return insurer ? `${insurer} policy${whose}` : `Policy${whose}`;
}

const insurerKey = (n: string | null) => (n?.trim() ? insurerShortName(n) : "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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
    // One insurer however its name was printed: "FWD Singapore Pte Ltd" and "FWD Singapore Pte. Ltd." are the same.
    const insurers = new Set(group.map((d) => insurerKey(d.insurer)).filter(Boolean));
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

/** The roles that are a policy's own schedule or certificate: the document a policy starts from. */
const SCHEDULE_ROLES = new Set(["personal_schedule", "schedule", "certificate"]);
/** The slot a document goes in by what it was read as; a guide only, as when the household picks it. */
export function slotForRole(role: string | null | undefined): FolderSlot {
  if (role && SCHEDULE_ROLES.has(role)) return "schedule";
  if (role === "policy_wording") return "wording";
  if (role === "rider" || role === "endorsement") return "rider";
  return "other";
}
const ownPeople = (d: FolderDoc) => new Set(d.linked_people.filter((p) => p.source !== "scheme_reference_match").map((p) => p.id));

export type PolicyStarter = { scheduleId: string; documents: { policyId: string; slot: FolderSlot }[]; personIds: string[] };
/** Existing documents offered as ready-made policies, so a household with documents on file sees its folders in a tap each:
 * every schedule or certificate in no folder yet starts one, for the people it is linked to (by the household or the reading,
 * not by a plan match), with any other document in no folder that prints the same policy number, from the same insurer, for
 * those same people. Nothing is made until the household taps; a document linked to nobody starts nothing. */
export function policyStarters(docs: FolderDoc[], folders: FolderView[], handled: ReadonlySet<string> = new Set()): PolicyStarter[] {
  const filed = new Set(folders.flatMap((f) => f.documents.map((d) => d.policyId)));
  // A document already made into a folder, or one the household took out of one, never starts or joins one again.
  const free = docs.filter((d) => !filed.has(d.id) && !handled.has(d.id));
  const out: PolicyStarter[] = [], taken = new Set<string>();
  for (const schedule of free) {
    if (!schedule.document_role || !SCHEDULE_ROLES.has(schedule.document_role) || taken.has(schedule.id)) continue;
    const people = [...ownPeople(schedule)];
    if (!people.length) continue;
    const key = numberKey(schedule.policy_number), insurer = insurerKey(schedule.insurer);
    const companions = key.length < 5 ? [] : free.filter((d) => d.id !== schedule.id && !taken.has(d.id) && numberKey(d.policy_number) === key
      && (!insurer || !insurerKey(d.insurer) || insurerKey(d.insurer) === insurer));
    // A companion joins only when it is the own document of everyone the schedule is for: the folder keeps all of the
    // schedule's people (a joint policy keeps both), and never takes in a document of someone else's.
    const joined = companions.filter((c) => people.every((id) => ownPeople(c).has(id)));
    const group = [schedule, ...joined];
    group.forEach((d) => taken.add(d.id));
    out.push({ scheduleId: schedule.id, personIds: people, documents: group.map((d) => ({ policyId: d.id, slot: d.id === schedule.id ? "schedule" : slotForRole(d.document_role) })) });
  }
  return out;
}
