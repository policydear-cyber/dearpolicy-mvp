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
  return /(?:\bnot|n['’]t|\bnever)\s+(?:be\s+)?(?:cover(?:ed|s)?|pay(?:s|ed)?)\b|\bexclu(?:de[ds]?|sions?)\b|\bwhat(?:'s| is| are)?\s+(?:left\s+out|missing)\b|\bdoes(?:n['’]?t| not)\s+(?:it\s+)?cover\b|\bnot\s+covered\b|\bwon['’]?t\s+(?:it\s+)?pay\b/i.test(message);
}

/** A page that prints an exclusion: a heading or clause saying what the policy does not cover or will not pay. */
const EXCLUSION_PAGE = /\bexclusions?\b|\b(?:general\s+)?exceptions?\s+(?:to\s+cover|and\s+limitations)\b|\b(?:we|the\s+company|the\s+insurer)\s+(?:will\s+not|shall\s+not|won['’]?t|does\s+not|do\s+not)\s+(?:pay|cover)\b|\bnot\s+covered\b/i;

const plain = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "").trim();
const base = (label: string) => plain(label).toLowerCase();

/** The note, or null when there is none to say: not a question about what is not covered, one policy only, or every
 * other policy with exclusions already named by the answer. `people` is the people the chat is about (null: everyone). */
export function otherExclusionsNote(household: Household, message: string, answerText: string, label: (d: HouseholdDocument) => string, people: string[] | null = null): string | null {
  if (!asksWhatIsNotCovered(message)) return null;
  // The household already named a policy ("What does Alpha Plan not cover?", the question this note suggests): it is the
  // answer to that, and the note would say the same thing again.
  const asked = message.toLowerCase();
  const namedInQuestion = (d: HouseholdDocument) => { const n = base(label(d)); return (n.length >= 3 && asked.includes(n)) || (!!d.productName && d.productName.trim().length >= 3 && asked.includes(d.productName.trim().toLowerCase())); };
  if (household.documents.some((d) => !d.supersededAt && namedInQuestion(d))) return null;
  const said = answerText.toLowerCase();
  const aboutThem = (d: HouseholdDocument) => !people?.length || d.linkedPeople.some((p) => people.some((q) => base(p) === base(q)));
  const withExclusions = household.documents.filter((d) => !d.supersededAt && !NO_COVER_READING_ROLES.includes(d.documentRole ?? "") && aboutThem(d)
    && !(d.unreadablePages ?? []).length && d.pages.some((p) => EXCLUSION_PAGE.test(p.text)));
  // Two documents of one policy are one policy.
  const seen = new Set<string>();
  const named = withExclusions.map((d) => ({ d, name: label(d) })).filter((x) => {
    const key = base(x.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (named.length < 2) return null;
  const left = named.filter((x) => !said.includes(base(x.name)) && !(x.d.productName && said.includes(x.d.productName.trim().toLowerCase())));
  if (!left.length) return null;
  const shown = left.slice(0, MOST_NAMED).map((x) => x.name);
  const more = left.length - shown.length;
  const list = shown.join(", ") + (more > 0 ? ` and ${more} more` : "");
  return `Your documents print exclusions for ${list}, which this answer does not list. Ask “What does ${plain(shown[0])} not cover?” to see ${left.length === 1 ? "them" : "one policy's at a time"}.`;
}
