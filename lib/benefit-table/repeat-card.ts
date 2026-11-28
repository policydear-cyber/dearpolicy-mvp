/**
 * A group certificate covers several people, so the same cover card is shown once under each of them. The second and
 * later copies keep their header (name, sum, premium, page) and any note, and fold only the benefit list when it is
 * the very same list: every field of the cover (bar whose it is) and of every row matches the copy shown earlier.
 * Nothing is dropped, only moved behind one tap. A card that differs in any field, an empty card, or a person who
 * shares their name with the earlier one is never folded.
 */
export type RepeatCover = { personId: string; [key: string]: unknown };

export function cardSignature(cover: RepeatCover, rows: unknown[]): string | null {
  if (!rows.length) return null;
  const { personId: _personId, ...rest } = cover;
  return JSON.stringify([rest, rows]);
}

/** For each person's covers in order: the name of the person whose identical card is shown earlier, or null. */
export function repeatedCards(
  people: { id: string; name: string; covers: RepeatCover[] }[],
  rowsOf: (person: { id: string }, cover: RepeatCover) => unknown[],
): Map<string, string | null> {
  const first = new Map<string, string>();
  const out = new Map<string, string | null>();
  for (const person of people) {
    person.covers.forEach((cover, i) => {
      const sig = cardSignature(cover, rowsOf(person, cover));
      const earlier = sig ? first.get(sig) : undefined;
      out.set(`${person.id}:${i}`, earlier && earlier !== person.name ? earlier : null);
      if (sig && !first.has(sig)) first.set(sig, person.name);
    });
  }
  return out;
}
