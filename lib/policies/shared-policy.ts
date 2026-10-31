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
  // One sum only when every sum this person has on the policy is the same: a person with two covers on it (a base plan and
  // a rider) has no one "own sum", and the safe sentence is shown instead (Critic M1).
  const sums = new Set(against.flatMap((a) => a ?? []).filter((c) => (c.ownerId ? c.ownerId === selected.id : c.owner === selected.name) && c.amount).map((c) => c.amount!));
  const ownSum = sums.size === 1 ? [...sums][0] : null;
  return { others, ownSum };
}

/** "Ng Siew Lan", "A and B", "A, B and C". */
export function namesList(names: string[]) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentence a person view shows with a shared policy: under its heading on Benefits ("an amount printed below"),
 * under one of its figures on a cover's page ("this figure"). */
export function sharedPolicyText(note: SharedPolicyNote, person: string, what = "an amount printed below") {
  return `This policy also covers ${namesList(note.others)}. ` + (note.ownSum
    ? `${person}'s own sum insured on it is ${note.ownSum}; ${what} may be for another person on it.`
    : `${what.charAt(0).toUpperCase()}${what.slice(1)} may be for another person on it.`);
}
