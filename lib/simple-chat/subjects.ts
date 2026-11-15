/** Who a chat turn is about, read from the household's own messages in this conversation, oldest first. Pure.
 *
 * A follow-up can change the people a scenario is about:
 * - a replacement ("actually it's Daniel, not Grace", "sorry, I meant Daniel", "not Grace - Daniel"): the turn is about the
 *   new person only, and earlier answers about the person replaced are out of date;
 * - an addition ("Daniel too", "and Daniel also broke his arm", "both of them"): the turn is about everyone so far;
 * - a new question naming someone ("what about Daniel?"): about that person only; earlier answers stand for their own
 *   question;
 * - a message naming no one ("how much would that be?"): about the same people as before.
 * A message that names someone the household does not have ("actually it's Wei") is about nobody the household can be
 * told about: no amount is shown, and the household is asked who they mean.
 *
 * Allow-list: `people` is the only set of members whose figures the turn may show. `people: null` means the messages do
 * not settle it (a relationship word, "we", nothing named yet): the chat's other person checks decide, as before.
 * Nothing here knows any household: names come from the household's own member list. */
import type { Household } from "./library";

export type SubjectChange = "replace" | "add" | "new" | "same";
export type Subjects = {
  /** The members (full names as the household lists them, without a bracketed note) the turn may show figures for; null
   * when the messages do not settle it. */
  people: string[] | null;
  /** How the latest message changed the people. */
  change: SubjectChange;
  /** Members a replacement in the latest message took out: earlier answers with their figures are out of date. */
  replaced: string[];
  /** A name in the latest message that is no member of the household (as written), or null. */
  unknown: string | null;
};

const baseName = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, "").trim();
const norm = (s: string) => s.normalize("NFKC").replace(/[’‘`]/g, "'").replace(/[—–]/g, " - ");
const nameWords = (n: string) => baseName(n).toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words that point at one member only: a word of their name no other member's name has (at least two letters). */
function ownWords(household: Household): Map<string, string[]> {
  const people = household.members.map((m) => baseName(m.name));
  return new Map(people.map((p) => [p, nameWords(p).filter((w) => !people.some((o) => o !== p && nameWords(o).includes(w)))]));
}

/** Words that say "instead of" just before a name (closed list). */
const NEGATED_BEFORE = String.raw`(?:not|isn't|wasn't|isnt|wasnt|instead\s+of|rather\s+than|no\s+longer|nothing\s+(?:for|about))\s+(?:for\s+|about\s+|to\s+|with\s+|it'?s\s+|its\s+)?`;
/** Words that add people to the ones already asked about (closed list). */
const ADDS = /\b(?:too|also|as\s+well|both|in\s+addition|additionally|as\s+well\s+as)\b/i;
/** Words that take back what was said before (closed list). */
const CORRECTS = /\b(?:actually|sorry|i\s+meant|i\s+mean|meant\s+to\s+say|my\s+mistake|my\s+bad|correction|wrong\s+person|i\s+got\s+(?:it|that)\s+wrong|oops)\b/i;
/** "both", "the two of them", "both of us": every one of two people. */
const BOTH = /\b(?:both|the\s+two\s+of\s+(?:them|us))\b/i;
/** Words that point at people without naming them: relationships and the household as a whole (closed list). The other
 * person checks decide for these (lib/simple-chat/verify.ts askedAbout, spouseMeant). */
const POINTS_AT_PEOPLE = /\b(?:husband|wife|spouse|partner|son|sons|daughter|daughters|child|children|kids?|baby|babies|mother|mum|mom|father|dad|parents?|brother|sister|siblings?|grand(?:mother|father|ma|pa|son|daughter|child|children|parents?)|in-laws?|mummy|mommy|mama|daddy|papa|helper|maid|nanny|auntie|aunty|aunt|uncle|cousin|niece|nephew|fianc[eé]e?|boyfriend|girlfriend|family|we|us|our|everyone|everybody|all\s+of\s+us|each\s+of\s+us)\b|妻子|老婆|丈夫|老公|儿子|兒子|女儿|女兒|孩子|妈妈|媽媽|爸爸|父亲|父親|母亲|母親/i;

/** The speaker alone ("I", "me", "my"): the account's own member, whom the chat's other checks resolve (closed list). */
const FIRST_PERSON = /\b(?:i|me|my|mine|myself|i'm|im|i've|i'd|i'll)\b/i;

/** "I" that only asks or corrects, about no one ("I meant", "can I claim", "tell me"): not the speaker as the subject. */
const ASKING = /\b(?:i\s+meant|i\s+mean|i\s+think|i\s+guess|i\s+wonder|i\s+want\s+to\s+know|i'?m\s+asking|i\s+was\s+asking|can\s+i|could\s+i|do\s+i|should\s+i|would\s+i|will\s+i|(?:tell|show|give|let)\s+me|my\s+(?:mistake|bad))\b/gi;

/** Capitalised words a household writes that are never a person's name (closed list): sentence openers, pronouns, question
 * and function words, titles, days and months. */
const NOT_NAMES = new Set(`a about actually after again also am an and any anyway are as at be because been before both but by can could
did do does doing done during each either for from had has have he her hers him his how i i'd i'll i'm i've if in is it it's its just
let like may maybe me meant mine more most mr mrs ms dr madam sir my never no nor not now of oh ok okay on once one only or our ours
oops please plus she should since so sorry such than thank thanks that the their them then there these they this those though to too
two under until up us very was wait we well were what what's when where which while who whom whose why will with would yes yet you
your hi hello hey hmm um uh correction mistake also again instead rather still both either neither then also
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
today tomorrow yesterday s sgd usd myr rm hkd`.split(/\s+/).filter(Boolean));

/** Where a name stands in a message that changes who it is about: "I meant X", "it's X", "not Grace - X", "what about X",
 * "X too", "and X also ...", "X broke ...". Each captures one word. */
const NAME_SLOTS: RegExp[] = [
  /\b(?:meant|mean|actually|(?:what|how|and)\s+about|it'?s|its|it\s+was|it\s+is)\s+(?=(\p{L}[\p{L}'-]*))/giu,
  /\s-\s*(\p{L}[\p{L}'-]*)\s*[.!?]*\s*$/gu,
  /(?:^|[.!?,]\s*|\band\s+)(?=(\p{Lu}[\p{L}'-]*)\s+(?:too|also|as\s+well|broke|breaks|hurt|injured|fell|was|is|has|had|got|needs|did)\b)/gu,
];

/** Whether a word is a name the household might have meant but does not have: capitalised as a name is, or standing in a
 * strong correction slot ("I meant wei"), never a word the household's documents print, a member's name word, a family
 * word or a closed-list word. */
function unknownName(message: string, household: Household): string | null {
  const known = new Set(household.members.flatMap((m) => nameWords(m.name)));
  const printed = new Set(household.documents.flatMap((d) => [d.name, d.insurer ?? "", d.productName ?? "", ...d.pages.map((p) => p.text)])
    .join(" ").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2));
  const text = norm(message);
  for (const re of NAME_SLOTS) {
    for (const m of text.matchAll(re)) {
      const word = m[1].replace(/'s$/i, "").replace(/['-]+$/, "");
      const lower = word.toLowerCase();
      if (word.length < 2 || NOT_NAMES.has(lower) || known.has(lower) || printed.has(lower) || POINTS_AT_PEOPLE.test(lower)) continue;
      // A lower-case word is a name only in a correction slot ("I meant wei", "actually it's wei") that ends the clause.
      if (!/^\p{Lu}/u.test(word)) {
        const after = text.slice((m.index ?? 0) + m[0].length + m[1].length);
        if (!/\b(?:meant|mean|actually|it'?s|it\s+was|it\s+is)\s+$/iu.test(m[0]) || !/^\s*(?:[,.!?]|-|$|not\b|instead\b|too\b|also\b)/i.test(after)) continue;
      }
      return word;
    }
  }
  return null;
}

/** The members a message names, and those it names only to take them back ("not Grace"). */
function namedIn(message: string, household: Household): { named: string[]; negated: string[] } {
  const text = ` ${norm(message).toLowerCase()} `;
  const named: string[] = [], negated: string[] = [];
  for (const [person, words] of ownWords(household)) {
    const hits = words.filter((w) => new RegExp(String.raw`(?<![\p{L}])${escape(w)}(?![\p{L}])`, "u").test(text));
    if (!hits.length) continue;
    named.push(person);
    // Taken back when every mention of the person is in a "not ..." slot.
    const mentions = [...text.matchAll(new RegExp(String.raw`(?<![\p{L}])(?:${hits.map(escape).join("|")})(?![\p{L}])`, "gu"))];
    const before = (i: number) => text.slice(Math.max(0, i - 40), i);
    // The person's whole name may stand in the slot ("not Grace Tern"): the words before this one that are also theirs are skipped.
    const all = nameWords(person).map(escape).join("|");
    if (mentions.every((m) => new RegExp(String.raw`${NEGATED_BEFORE}(?:(?:${all})\s+)*$`, "u").test(before(m.index ?? 0)))) negated.push(person);
  }
  return { named, negated };
}

/** The people each message so far settles, oldest first; the result is for the latest message (the first of `said`).
 * `said`: the household's messages in this conversation, the latest first (as the chat passes them). */
export function resolveSubjects(household: Household, said: readonly string[]): Subjects {
  const members = household.members.map((m) => baseName(m.name));
  let people: string[] | null = null;
  let last: Subjects = { people: null, change: "same", replaced: [], unknown: null };
  const mentioned: string[] = [];
  const messages = [...said].reverse();
  for (const raw of messages) {
    const message = norm(raw);
    const { named, negated } = namedIn(message, household);
    for (const n of named) { const i = mentioned.indexOf(n); if (i >= 0) mentioned.splice(i, 1); mentioned.push(n); }
    const positive = named.filter((n) => !negated.includes(n));
    const unknown = unknownName(message, household);
    const before = people as string[] | null;
    const prev: string[] = before ?? [];
    let change: SubjectChange = "same";
    let replaced: string[] = [];
    if (unknown) {
      // Someone the household does not have: nobody's figures, until the household says who they mean.
      // Earlier answers are out of date only when the household takes someone back ("not Grace", "sorry, I meant ...").
      people = [];
      replaced = [...new Set([...negated, ...(CORRECTS.test(message) ? prev : [])])];
      change = replaced.length ? "replace" : "new";
    } else if (negated.length) {
      // "Daniel, not Grace", "not Grace - Daniel": the people named now, or the ones before without those taken back.
      people = positive.length ? positive : prev.filter((p) => !negated.includes(p));
      change = "replace";
      replaced = [...new Set([...prev.filter((p) => !people!.includes(p)), ...negated])];
    } else if (BOTH.test(message) && !positive.length) {
      // "Both of them": the two people of a two-person household, or the two last named.
      const two = members.length === 2 ? members : mentioned.length >= 2 ? mentioned.slice(-2) : null;
      if (two) { people = [...new Set([...prev, ...two])]; change = "add"; }
      else people = null;
    } else if (positive.length && ADDS.test(message)) {
      people = [...new Set([...prev, ...positive])];
      change = "add";
    } else if (positive.length && POINTS_AT_PEOPLE.test(message)) {
      // "Grace's husband", "Daniel and the kids": a relationship word may point at someone not named. The other checks decide.
      people = null;
      change = "new";
    } else if (positive.length && CORRECTS.test(message)) {
      people = positive;
      change = "replace";
      replaced = prev.filter((p) => !positive.includes(p));
    } else if (positive.length) {
      people = positive;
      change = before && before.length === positive.length && before.every((p) => positive.includes(p)) ? "same" : "new";
    } else if (POINTS_AT_PEOPLE.test(message) || FIRST_PERSON.test(message.replace(ASKING, " "))) {
      // "My husband", "I broke my arm": someone not named, whom the other checks resolve.
      people = null;
      change = "new";
    }
    last = { people: people ? [...people] : null, change, replaced, unknown };
  }
  return last;
}

/** The fixed reply when the household names someone it does not have: who is in the household, and the question back.
 * No figures, and no model call. */
export function unknownPersonAnswer(household: Household, name: string) {
  const members = household.members.map((m) => baseName(m.name));
  const list = members.length > 1 ? `${members.slice(0, -1).join(", ")} and ${members.at(-1)}` : members[0] ?? "";
  return {
    bottomLine: members.length
      ? `I can't find anyone called “${name}” in your household, so I haven't shown any amounts. The people in your household are ${list}.`
      : `I can't find anyone called “${name}” in your household, so I haven't shown any amounts.`,
    statements: [],
    nextSteps: ["If they are not in your household yet, add them on the Family page and link their documents."],
    question: members.length ? `Who did you mean: ${members.length > 1 ? `${members.slice(0, -1).join(", ")} or ${members.at(-1)}` : members[0]}?` : "Who did you mean?",
  };
}

/** What the model is told about a change of people, so its answer is about the right ones. */
export function subjectsNote(s: Subjects): string {
  if (!s.people || s.unknown) return "";
  const who = s.people.join(" and ");
  if (s.change === "replace" && s.replaced.length) return `(The household corrected who this is about: it is about ${who} only, not ${s.replaced.join(" or ")}. Answer for ${who} from ${s.people.length > 1 ? "their" : "their own"} documents only; earlier answers about ${s.replaced.join(" or ")} no longer apply.) `;
  if (s.change === "add") return `(This is now about ${who}: give each person's own answer from their own documents, separately.) `;
  if (s.change === "new") return `(This question is about ${who} only.) `;
  return "";
}

/** The earlier answers a replacement makes out of date: walking back from the latest, every answer that showed figures for
 * a replaced person, until one that showed figures for other people only. Answers that showed no figures are passed over.
 * `turns`: each earlier answer's id and the people its figures were for, oldest first. */
export function supersededBy(replaced: readonly string[], turns: readonly { answerId?: string | null; people?: readonly string[] | null }[]): string[] {
  if (!replaced.length) return [];
  const out: string[] = [];
  for (const t of [...turns].reverse()) {
    const people = t.people ?? [];
    if (!people.length) continue;
    if (!people.some((p) => replaced.includes(p))) break;
    if (t.answerId) out.push(t.answerId);
  }
  return out;
}
