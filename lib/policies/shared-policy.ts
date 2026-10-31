/**
 * One person's view of a policy that covers several people in the household (a group scheme's certificate, a family
 * plan). The page lists the policy's own benefits as it prints them, and a figure printed there may be another person's:
 * the person view says whom else the policy covers and, where it is known, this person's own sum insured on it, so a
 * line printed for someone else is never read as theirs. Any insurer, any market: names and sums come from the household's
 * own links and readings. Pure: safe for client components.
 */
export type SharedPolicyNote = { others: string[]; ownSum: string | null };

/** `owners`: the household members linked to the policy (names). `selected`: the person whose view this is (null: everyone).
 * `against`: each benefit's per-person sums on this policy (the API sends only the selected person's in a person view, by
 * name; by id where it gives one). */
export function sharedPolicyNote(owners: string[], selected: { id: string; name: string } | null,
  against: ({ ownerId?: string; owner?: string; amount: string | null }[] | null | undefined)[]): SharedPolicyNote | null {
  if (!selected) return null;
  const at = owners.indexOf(selected.name);
  if (at < 0) return null;
  const others = owners.filter((_, i) => i !== at);
  if (!others.length) return null;
  const ownSum = against.flatMap((a) => a ?? []).find((c) => (c.ownerId ? c.ownerId === selected.id : c.owner === selected.name) && c.amount)?.amount ?? null;
  return { others, ownSum };
}

/** "Ng Siew Lan", "A and B", "A, B and C". */
export function namesList(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentence the person view shows under a shared policy's heading. */
export function sharedPolicyText(note: SharedPolicyNote, person: string) {
  return `This policy also covers ${namesList(note.others)}. ` + (note.ownSum
    ? `${person}'s own sum insured on it is ${note.ownSum}; an amount printed below may be for another person on it.`
    : "An amount printed below may be for another person on it.");
}
