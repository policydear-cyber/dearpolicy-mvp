import { TERMS, type LearnTerm } from "./content";

/** The most library links shown under one answer, so they stay a hint, not a second answer. */
export const MAX_LEARN_LINKS = 3;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One case-insensitive whole-word pattern per term, built once. A phrase's spaces and hyphens match either. */
const PATTERNS: Array<{ term: LearnTerm; pattern: RegExp }> = TERMS.filter((term) => term.match.length).map((term) => ({
  term,
  pattern: new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${term.match.map((m) => escape(m).replace(/[\s-]+/g, "[\\s-]+")).join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  ),
}));

/**
 * The glossary terms an answer uses, in the order they first appear in it, at most MAX_LEARN_LINKS.
 * Pure text matching on what the household was already shown: no model call, no household data read.
 * It only chooses which general explanations to offer; it never changes the answer.
 */
export function learnTermsIn(texts: Array<string | null | undefined>, max = MAX_LEARN_LINKS): LearnTerm[] {
  const text = texts.filter((t): t is string => typeof t === "string" && t.length > 0).join("\n");
  if (!text) return [];
  return PATTERNS.map(({ term, pattern }) => ({ term, at: text.search(pattern) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, max))
    .map((hit) => hit.term);
}
