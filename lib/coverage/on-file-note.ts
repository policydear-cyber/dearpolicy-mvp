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
