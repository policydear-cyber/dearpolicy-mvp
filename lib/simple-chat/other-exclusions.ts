/** "What does my policy not cover?" in a household with several policies. The model answers from the pages it is sent and
 * may name the exclusions of one policy only, so a household reads them as all there are (Live tester, 26 Nov: five
 * insurers, one policy's exclusions, the others' documented exclusions never mentioned). This says, from the household's
 * own stored pages and never the model's words, which other policies print exclusions the answer did not name, and how to
 * see them. It adds no figure and no claim; it points. Any insurer, any wording; nothing known about any household. Pure. */
import { NO_COVER_READING_ROLES } from "@/lib/documents/messy";
import type { Household, HouseholdDocument } from "./library";

export const OTHER_EXCLUSIONS_ID = "other-exclusions";
/** The longest list of policies named; the rest are counted. */
const MOST_NAMED = 4;

/** A question about what is left out of cover, not one about an amount or a claim. */
export function asksWhatIsNotCovered(message: string): boolean {
  // "Why won't it pay for my claim?" is about a decision, not about what the policies leave out.
  if (/\bwhy\b|\bclaim(?:s|ed|ing)?\b/i.test(message)) return false;
  return /(?:\bnot|n['’]t|\bnever)\s+(?:be\s+)?(?:cover(?:ed|s)?|pay(?:s|ed)?)\b|\bexclu(?:de[ds]?|sions?)\b|\bwhat(?:'s| is| are)?\s+(?:left\s+out|missing)\b|\bdoes(?:n['’]?t| not)\s+(?:it\s+)?cover\b|\bnot\s+covered\b|\bwon['’]?t\s+(?:it\s+)?pay\b/i.test(message);
}

/** A page that prints an exclusion: a heading or clause saying what the policy does not cover or will not pay. */
const EXCLUSION_PAGE = /\bexclusions?\b|\b(?:general\s+)?exceptions?\s+(?:to\s+cover|and\s+limitations)\b|\b(?:we|the\s+company|the\s+insurer)\s+(?:will\s+not|shall\s+not|won['’]?t|does\s+not|do\s+not)\s+(?:pay|cover)\b|\bnot\s+covered\b/i;

/** "Exclusions: none", "No exclusions apply" and "see the exclusions section" print no exclusion. */
const NO_EXCLUSION = /\bexclusions?\s*[:\-–—]?\s*(?:none|nil|n\/a|not\s+applicable|nothing(?:\s+is)?(?:\s+excluded)?|do(?:es)?\s+not\s+apply)\b|\bno\s+(?:general\s+)?exclusions?\b|\b(?:see|refer\s+to|read|subject\s+to|as\s+(?:listed|set\s+out)\s+in|under)\s+(?:the\s+)?(?:section\s+(?:on\s+)?|clause\s+(?:on\s+)?)?(?:general\s+)?exclusions?\b[^.\n]*/gi;
export const printsExclusion = (text: string) => EXCLUSION_PAGE.test(text.replace(NO_EXCLUSION, " "));
/** A name as a whole phrase: "Plan D" is not found inside "Plan Delta", nor "War" inside "warranty". */
const hasPhrase = (text: string, phrase: string) => !!phrase && new RegExp(`(?<![\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);
const LONGEST_NAME = 60;

const plain = (label: string) => label.replace(/\s*[\(\[][^)\]]*[\)\]]\s*$/, "").trim();
const base = (label: string) => plain(label).toLowerCase();

/** The note, or null when there is none to say: not a question about what is not covered, one policy only, or every
 * other policy with exclusions already named by the answer. `people` is the people the chat is about (null: everyone). */
export function otherExclusionsNote(household: Household, message: string, answerText: string, label: (d: HouseholdDocument) => string, people: string[] | null = null): string | null {
  if (!asksWhatIsNotCovered(message)) return null;
  // The household already named a policy ("What does Alpha Plan not cover?", the question this note suggests): it is the
  // answer to that, and the note would say the same thing again.
  const namedInQuestion = (d: HouseholdDocument) => hasPhrase(message, plain(label(d))) || hasPhrase(message, d.productName?.trim() ?? "");
  if (household.documents.some((d) => !d.supersededAt && namedInQuestion(d))) return null;
  const aboutThem = (d: HouseholdDocument) => !people?.length || d.linkedPeople.some((p) => people.some((q) => samePerson(p, q)));
  const withExclusions = household.documents.filter((d) => !d.supersededAt && !NO_COVER_READING_ROLES.includes(d.documentRole ?? "") && aboutThem(d)
    && !(d.unreadablePages ?? []).length && d.pages.some((p) => printsExclusion(p.text))
    // Named only by a product name the household can recognise: not a generic or file-derived label, nor an unbounded one.
    && !!d.productName?.trim() && plain(label(d)).length >= 2 && plain(label(d)).length <= LONGEST_NAME);
  // Two documents of one policy are one policy.
  const seen = new Set<string>();
  const named = withExclusions.map((d) => ({ d, name: plain(label(d)) })).filter((x) => {
    const key = base(x.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (named.length < 2) return null;
  const left = named.filter((x) => !hasPhrase(answerText, x.name) && !hasPhrase(answerText, x.d.productName?.trim() ?? ""));
  if (!left.length) return null;
  const shown = left.slice(0, MOST_NAMED).map((x) => x.name);
  const more = left.length - shown.length;
  const list = shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
  return `Your documents print exclusions for ${list}, which this answer does not list. Ask “What does ${shown[0]} not cover?” to see ${left.length === 1 ? "them" : "one policy's at a time"}.`;
}

const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const tokens = (t: string) => fold(t).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** The members the message may be naming: any word of a member's name (two letters or more, shared or not, an ordinary
 * word or not) written whole, accents and case folded. Deliberately loose: a name that is also a word ("Will", "May"),
 * two members who share a name, an accent or a short name all count as named, and the note then says nothing rather than
 * guess whose policies are meant. */
export function membersMentioned(household: Household, message: string): string[] {
  const said = new Set(tokens(message));
  return household.members.map((m) => m.name).filter((n) => tokens(n.replace(/\s*\([^)]*\)\s*$/, "")).some((w) => w.length >= 2 && said.has(w)));
}
/** The same person written two ways (accents, case, a bracketed note). */
export const samePerson = (a: string, b: string) => fold(plain(a)) === fold(plain(b));
