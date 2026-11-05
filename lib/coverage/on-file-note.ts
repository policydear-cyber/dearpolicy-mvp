/** What Home's "On file, please confirm" tile says under its status (lib/coverage/cover-verdict.ts). It names the
 * documents that mention the cover, so "Open it to check" always says which one; with none known it does not ask the
 * person to open anything (live check, 5 Nov: three tiles said "Open it to check" and named nothing). At most two names,
 * then how many more. No amount, ever. Pure: safe for client components. */
export function onFileNote(documents: readonly string[], person: string): string {
  const names = [...new Set(documents.map((d) => d.trim()).filter(Boolean))];
  const whose = `${person}’s`;
  if (!names.length) return `Something on file mentions this cover, but nothing shows yet that it is ${whose}.`;
  if (names.length === 1) return `${names[0]} mentions this cover, but does not show yet that it is ${whose}. Open it to check.`;
  const shown = names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  return `${shown} mention this cover, but none of them shows yet that it is ${whose}. Open them to check.`;
}

/** What a document covers when it is a policy for something other than the person's own health or life: travel, a home or
 * a vehicle. Said beside its name on a tile for another cover, so wording from a travel policy on the Hospitalisation tile
 * reads as travel cover, for trips, never as hospital cover at home (live check, 5 Nov). Read from the document's own
 * stored type, product and name; nothing for any other kind, or on the tile of its own kind. */
const OWN_KINDS: [RegExp, string, string][] = [
  [/\btravel(?:ling|ler|lers)?\b|\btrip\b/i, "Travel", "travel cover, for trips"],
  [/\b(?:home|household|contents|homeowners?|fire)\s+(?:insurance|policy|cover|protect\w*|plan)\b|\bhome\s+contents\b/i, "Home", "home cover"],
  [/\b(?:motor|car|vehicle|motorcycle)\s+(?:insurance|policy|cover|plan)\b/i, "Motor", "motor cover"],
];
export function documentKindNote(doc: { type: string | null; product: string | null; name: string }, category: string): string | null {
  const text = [doc.type, doc.product, doc.name].filter(Boolean).join(" ");
  const kinds = OWN_KINDS.filter(([re]) => re.test(text));
  // One kind only: a document that reads as two (a "travel and home" bundle) is left as it is named.
  if (kinds.length !== 1) return null;
  const [, kind, note] = kinds[0];
  return kind === category ? null : note;
}
/** The name a tile shows for an on-file document: its own name, with its kind when it is a policy of another kind. */
export function onFileDocumentName(doc: { type: string | null; product: string | null; name: string }, category: string): string {
  const note = documentKindNote(doc, category);
  return note ? `${doc.name} (${note})` : doc.name;
}
