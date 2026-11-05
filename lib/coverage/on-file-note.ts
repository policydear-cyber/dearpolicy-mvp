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
 * reads as travel cover, for trips, never as hospital cover at home (live check, 5 Nov). Its stored type decides alone when
 * it has one; only when it has none is the product name read, never the file name (Critic #368: "health" with an "Overseas
 * Travel Benefit", or a life policy in "travel-docs-scan.pdf", is not a travel policy). Nothing for any other kind, for a
 * document that reads as two, or on the tile of its own kind. */
const OWN_KINDS: { kind: string; note: string; type: RegExp; product: RegExp }[] = [
  { kind: "Travel", note: "travel cover, for trips", type: /\btravel\b/i, product: /\btravel\s+(?:insurance|policy|cover|protect\w*|plan|guard|shield)\b/i },
  { kind: "Home", note: "home cover", type: /\b(?:home|household|contents|fire|property)\b/i,
    product: /\b(?:home|household|contents|homeowners?|fire)\s+(?:insurance|policy|cover|protect\w*|plan)\b/i },
  { kind: "Motor", note: "motor cover", type: /\b(?:motor|car|vehicle|motorcycle)\b/i, product: /\b(?:motor|car|vehicle|motorcycle)\s+(?:insurance|policy|cover|plan)\b/i },
];
export function documentKindNote(doc: { type: string | null; product: string | null }, category: string): string | null {
  const type = doc.type?.trim();
  const kinds = type ? OWN_KINDS.filter((k) => k.type.test(type)) : OWN_KINDS.filter((k) => k.product.test(doc.product ?? ""));
  // One kind only: a document that reads as two (a "travel and home" bundle) is left as it is named.
  if (kinds.length !== 1) return null;
  return kinds[0].kind === category ? null : kinds[0].note;
}
/** The name a tile shows for an on-file document: its own name, with its kind when it is a policy of another kind. */
export function onFileDocumentName(doc: { type: string | null; product: string | null; name: string }, category: string): string {
  const note = documentKindNote(doc, category);
  return note ? `${doc.name} (${note})` : doc.name;
}
