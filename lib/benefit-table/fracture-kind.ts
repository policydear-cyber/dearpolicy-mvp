/** Kinds of fracture, as a benefit's name prints them: shared by the rag2 statement renderer and the benefit-table chat. */

/** The words that name a kind of fracture (medicine's own closed vocabulary, not a policy's wording): never a body site ("Hip") or
 * a joining word ("or"; Critic on #516, M1, M3). */
export const KIND_WORDS = "simple|compound|open|closed|complicated|uncomplicated|other|major|minor|multiple|comminuted|displaced|undisplaced|non-displaced|stress|hairline|greenstick|complete|incomplete|pathological";
const KIND = new RegExp(String.raw`^(?:${KIND_WORDS})$`, "i");

/** The kinds of fracture a benefit's own name prints: "Simple Fracture or Compound Fracture due to Accident", "Simple and Compound
 * Fractures" -> simple, compound. */
export function namedKinds(benefit: string): Set<string> {
  const out = new Set<string>();
  for (const m of benefit.matchAll(new RegExp(String.raw`\b((?:(?:${KIND_WORDS})\s*(?:,|\/|\band\b|\bor\b)\s*)*(?:${KIND_WORDS}))\s+Fractures?\b`, "gi")))
    for (const k of m[1].toLowerCase().split(/\s*(?:,|\/|\band\b|\bor\b)\s*/)) if (k) out.add(k);
  return out;
}

/** The one kind of fracture a benefit-table row pays for, from its own name, or null when it names none or several:
 * - a closing bracket that names the kind: "Arm, Elbow, Wrist or Ribs (Other Fracture)", "Wrist (Compound)" under a name that
 *   prints two kinds or more;
 * - otherwise the name prints exactly one kind: "Simple Fracture due to Accident: Arm, Elbow, Wrist or Ribs".
 * "Simple Fracture or Other Fracture: Arm" with no bracket names two, so no one kind. */
export function rowFractureKind(benefit: string): string | null {
  if (!/\bfractures?\b/i.test(benefit)) return null;
  const b = /\(\s*([A-Za-z-]+)(?:\s+fractures?)?\s*\)\s*$/i.exec(benefit.trim());
  if (b && KIND.test(b[1]) && (/\bfractures?\s*\)\s*$/i.test(benefit.trim()) || namedKinds(benefit).size >= 2)) return b[1].toLowerCase();
  const kinds = namedKinds(benefit);
  return kinds.size === 1 ? [...kinds][0] : null;
}

/** The kinds of fracture said in the household's words ("a simple fracture", "it was compound", "closed break", or a
 * reply that is only the kind: "Simple", "It was simple."). Words that deny it or leave it open never say it. */
export function kindsSaid(text: string): Set<string> {
  const out = new Set<string>();
  // Words before the kind that deny it or leave it open ("not a simple fracture", "I don't know if it was simple",
  // "whether it was a compound break"): that kind is not said (Critic on #518, NEW-HIGH 2, 3).
  // So do words that put it in another time or on someone else ("last year he had a simple fracture", "his sister had a
  // simple fracture"): a kind said only counts for the injury asked about.
  const open = /(?:\b(?:not|never|no|unsure|whether|if|maybe|perhaps|might|could|possibly|probably|hardly|ruled|suspects?|suspected|thought|or|than|unless|last|previous(?:ly)?|before|earlier|ago|once|used\s+to|history|(?:his|her|their)\s+\w+)\b|n't\b)[^.?!]{0,30}$/i;
  const add = (kind: string, before: string, after: string) => { if (!open.test(before) && !/^\s*(?:fractures?|breaks?|broken)?\s*(?:,\s*)?or\b/i.test(after)) out.add(kind.toLowerCase()); };
  // Only a kind word said of the fracture itself: "other" or "simple" alone ("any other benefits?") says nothing.
  for (const m of text.matchAll(new RegExp(String.raw`\b(${KIND_WORDS})\s+(?:fractures?|breaks?|broken)\b`, "gi")))
    add(m[1], text.slice(Math.max(0, m.index! - 40), m.index!), text.slice(m.index! + m[1].length));
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:fracture|break)\s+(?:was|is|is\s+a|was\s+a)\s+(${KIND_WORDS})\b`, "gi")))
    add(m[1], text.slice(Math.max(0, m.index! - 40), m.index!) + m[0].slice(0, m[0].length - m[1].length), text.slice(m.index! + m[0].length));
  const only = KIND_ANSWER.exec(text);
  if (only) out.add(only[1].toLowerCase());
  return out;
}

/** Words that tell of an injury: a new one, or the same one told again ("broke his arm", "also hurt his wrist"). */
const INJURY = /\b(?:broke|broken|break(?:s|ing)?|fractur(?:e|es|ed|ing)|cracked|hurt|injur\w*|sprain\w*|dislocat\w*|wound\w*|burn(?:s|ed|t)?|bruis\w*)\b/i;
/** The messages about the injury the conversation is on now, oldest first: from the latest one that tells of an injury
 * without saying a kind ("Desmond broke his arm", "Desmond broke his arm too", "He also hurt his wrist"). A message that
 * only moves the injury to another person ("actually it was Charmaine") tells of none, so what was said before stays. */
function sinceInjury(messages: string[]): string[] {
  let from = 0;
  messages.forEach((m, i) => { if (INJURY.test(m) && kindsSaid(m).size === 0) from = i; });
  return messages.slice(from);
}
/** The kinds said about the injury the conversation is on now (kindsSaid, from sinceInjury). They only put that kind's
 * card first: words around a kind can be misread ("my sister had a simple fracture", "how much for a simple fracture?"). */
export function kindsForInjury(messages: string[]): Set<string> {
  const out = new Set<string>();
  for (const m of sinceInjury(messages)) for (const k of kindsSaid(m)) out.add(k);
  return out;
}
/** A message that is only an answer giving the kind: "Simple", "It was a simple fracture.", "Just a simple one". No
 * question, denial, doubt or person can be in it, since nothing else is. */
const KIND_ANSWER = new RegExp(String.raw`^\s*(?:(?:it|that|this)\s+(?:was|is)\s+|it's\s+|its\s+|was\s+)?(?:(?:just|only)\s+)?(?:an?\s+)?(${KIND_WORDS})(?:\s+(?:one|fracture|break))?\s*[.!]?\s*$`, "i");
/** The one kind the household settled for the injury the conversation is on now: said as a whole answer (KIND_ANSWER)
 * after it was told, and never another kind after it. Only this rules other kinds' amounts out (Critic on #520, NEW-HIGH 3). */
export function kindSettled(messages: string[]): string | null {
  const kinds = new Set<string>();
  for (const m of sinceInjury(messages)) { const a = KIND_ANSWER.exec(m); if (a) { kinds.clear(); kinds.add(a[1].toLowerCase()); } else for (const k of kindsSaid(m)) if (!kinds.has(k) && kinds.size) kinds.add(k); }
  return kinds.size === 1 ? [...kinds][0] : null;
}
