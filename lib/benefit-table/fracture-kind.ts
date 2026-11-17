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

/** The kinds of fracture said in the household's words ("a simple fracture", "it was compound", "closed break"). */
export function kindsSaid(text: string): Set<string> {
  const out = new Set<string>();
  // Only a kind word said of the fracture itself: "other" or "simple" alone ("any other benefits?") says nothing.
  for (const m of text.matchAll(new RegExp(String.raw`\b(${KIND_WORDS})\s+(?:fractures?|breaks?|broken)\b`, "gi"))) out.add(m[1].toLowerCase());
  for (const m of text.matchAll(new RegExp(String.raw`\b(?:fracture|break)\s+(?:was|is|is\s+a|was\s+a)\s+(${KIND_WORDS})\b`, "gi"))) out.add(m[1].toLowerCase());
  return out;
}
