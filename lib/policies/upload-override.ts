/**
 * When the names printed in a document put it with someone other than the person chosen at upload, the card says so
 * beside the way to change it (new-household audit, 3 Nov: uploaded "for Bella", it prints Alex's name, and it moved to
 * Alex silently). Pure, so the policies page and its tests share one rule; any names, any household.
 */
export type OverrideInput = {
  uploadChoice?: string | null;
  linkedIds: string[];
  /** Printed names and who each was matched to (null when nobody). */
  named: { name: string; memberId: string | null }[];
};

/** The line to show, or null. Shown only when the chosen person is still in the household, is not covered by the
 * document, and at least one printed name was matched to someone else. */
export function uploadOverrideLine(input: OverrideInput, family: { id: string; display_name: string }[]): string | null {
  const chosen = input.uploadChoice ? family.find((m) => m.id === input.uploadChoice) : undefined;
  if (!chosen || input.linkedIds.includes(chosen.id)) return null;
  const matched = input.named.filter((p) => p.memberId);
  const others = [...new Map(matched.filter((p) => p.memberId !== chosen.id)
    .map((p) => [p.memberId as string, family.find((m) => m.id === p.memberId)?.display_name]))]
    .filter((entry): entry is [string, string] => !!entry[1]).map(([, name]) => name);
  if (!others.length) return null;
  const several = matched.length > 1;
  return `You uploaded this for ${chosen.display_name}. The ${several ? "names" : "name"} printed in it ${several ? "match" : "matches"} ${listNames(others)}, so it is used for ${others.length > 1 ? "them" : others[0]}.`;
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
