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
/** Words that take back what was said before (closed list). "Actually" and "sorry" count only right before the name
 * ("actually it's Daniel", "sorry, Daniel"): "Sorry, how much does Daniel get?" corrects nothing. */
const CORRECTS = /\b(?:i\s+meant|i\s+mean|meant\s+to\s+say|my\s+mistake|my\s+bad|correction|wrong\s+person|i\s+got\s+(?:it|that)\s+wrong)\b/i;
function correction(message: string, positive: string[], household: Household): boolean {
  if (CORRECTS.test(message)) return true;
  const own = ownWords(household);
  const words = positive.flatMap((p) => own.get(p) ?? []).map(escape).join("|");
  return !!words && new RegExp(String.raw`\b(?:actually|sorry|oops)\b\s*,?\s*(?:(?:it'?s|it\s+was|it\s+is|its|that'?s|that\s+was)\s+)?(?:${words})\b`, "iu").test(message);
}
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

/** Given names that are also ordinary English words ("will", "may", "a grace period", "the bill rose"), closed list: such a
 * name word counts as a mention only when written as a name (lib/simple-chat/subjects.ts nameMentioned). */
const WORD_NAMES = new Set(`will may mark rose grace hope joy faith june april august bill pat sue jack rob art frank gene dawn summer autumn
ray sky amber ruby crystal iris lily daisy ivy jade pearl olive violet holly heather robin wren sunny chase hunter max sterling don guy carol
sandy rich miles drew gray grey cliff dean earl glen lane mason page reed rock sage stone star wade warren young king penny buck chip chuck
nick pierce price ward bob sonny victor patience prudence charity mercy honor honour constance felicity destiny harmony melody river rain
storm brook brooke forest heath moss fern hazel ginger sandy cherry coco bunny precious lucky happy blessing gift noble rich will`.split(/\s+/).filter(Boolean));
/** What may follow a name that opens a sentence ("Will broke his arm", "Mark's plan"), closed list. */
const NAME_FOLLOWS = /^(?:'s\b|\s*(?:[,.!?]|$)|\s+(?:broke|breaks|hurt|injured|fell|was|is|has|had|got|needs|did|also|too|and|as\s+well|after\s+all|not|instead)\b)/u;

/** Whether the word at `index` of `text` (as the household wrote it) is a mention of a member: any form for a name word that
 * is not an ordinary word; for one that is (WORD_NAMES), only written as a name: capitalised, and either inside a sentence
 * or opening one with a verb or "'s" after it. */
function nameMentioned(text: string, index: number, word: string): boolean {
  if (!WORD_NAMES.has(word)) return true;
  const at = text.slice(index, index + word.length);
  if (!/^\p{Lu}/u.test(at)) return false;
  const before = text.slice(0, index).replace(/["“'(\s]+$/u, "");
  const opens = !before || /[.!?:;]$/.test(before) || /^(?:actually|sorry|oh|ok|okay|and|but|so|wait)\s*,?$/i.test(before.split(/[.!?]\s*/).pop() ?? "");
  return !opens || NAME_FOLLOWS.test(text.slice(index + word.length));
}

/** A member's mentions in a message: where each of their own name words (or their whole name) is written as a name. */
function mentionsOf(text: string, person: string, words: string[]): number[] {
  const out: number[] = [];
  const whole = new RegExp(String.raw`(?<![\p{L}])${nameWords(person).map(escape).join(String.raw`\s+`)}(?![\p{L}])`, "giu");
  const wholeAt = new Set<number>();
  if (nameWords(person).length > 1) for (const m of text.matchAll(whole)) { out.push(m.index ?? 0); wholeAt.add(m.index ?? 0); }
  for (const w of words) for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}])${escape(w)}(?![\p{L}])`, "giu"))) {
    const i = m.index ?? 0;
    if (!wholeAt.has(i) && nameMentioned(text, i, w)) out.push(i);
  }
  return out.sort((x, y) => x - y);
}

/** Words that say a member is named only as the owner of a policy ("Daniel's policy", "under Daniel's plan"). */
const POLICY_AFTER = /^(?:'s|s')\s+(?:own\s+)?(?:polic(?:y|ies)|plans?|cover|coverage|insurance|schemes?|certificate|schedule|documents?|benefits?)\b/iu;

/** A name the household does not have, only in a strict replacement shape: "Wei, not Grace", "it's Wei, not Grace", "not
 * Grace - Wei" (the message takes a member back and names no other), or "I meant Wei" (the message names no member and no
 * relationship). The word must be written as a name (a capital, then lower case), and never a closed-list word, a member's
 * name word, a family word or a word the household's documents print. */
function unknownName(message: string, household: Household, named: string[], negated: string[]): string | null {
  const positive = named.filter((n) => !negated.includes(n));
  if (positive.length || POINTS_AT_PEOPLE.test(message)) return null;
  const slots: RegExp[] = [];
  if (negated.length) slots.push(/(?:^|[\s,])(\p{Lu}\p{Ll}+)\s*,?\s*(?:-\s*)?not\s/gu, /\bnot\s+[^.!?]*?(?:\s-\s*|,\s*)(\p{Lu}\p{Ll}+)\s*[.!?]*\s*$/gu);
  else if (!named.length) slots.push(/\b[Ii]\s+meant\s+(\p{Lu}\p{Ll}+)\s*(?:[.!?,]|$)/gu);
  if (!slots.length) return null;
  const known = new Set(household.members.flatMap((m) => nameWords(m.name)));
  const printed = new Set(household.documents.flatMap((d) => [d.name, d.insurer ?? "", d.productName ?? "", ...d.pages.map((p) => p.text)])
    .join(" ").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2));
  for (const re of slots) for (const m of message.matchAll(re)) {
    const word = m[1], lower = word.toLowerCase();
    if (word.length < 2 || NOT_NAMES.has(lower) || known.has(lower) || printed.has(lower) || POINTS_AT_PEOPLE.test(lower)) continue;
    return word;
  }
  return null;
}

/** The members a message names (as names: mentionsOf), those it names only to take them back ("not Grace"), and those it
 * names only as a policy's owner ("Does Daniel's policy cover her?"). */
function namedIn(message: string, household: Household): { named: string[]; negated: string[]; owners: string[] } {
  const text = ` ${norm(message)} `;
  const named: string[] = [], negated: string[] = [], owners: string[] = [];
  for (const [person, words] of ownWords(household)) {
    const mentions = mentionsOf(text, person, words);
    if (!mentions.length) continue;
    named.push(person);
    const before = (i: number) => text.slice(Math.max(0, i - 40), i).toLowerCase();
    // The person's whole name may stand in the slot ("not Grace Tern"): the words before this one that are also theirs are skipped.
    const all = nameWords(person).map(escape).join("|");
    if (mentions.every((i) => new RegExp(String.raw`${NEGATED_BEFORE}(?:(?:${all})\s+)*$`, "u").test(before(i)))) negated.push(person);
    else if (mentions.every((i) => POLICY_AFTER.test(text.slice(i).replace(new RegExp(String.raw`^(?:(?:${all})\s*)+`, "iu"), "")))) owners.push(person);
  }
  return { named, negated, owners };
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
    const { named, negated, owners } = namedIn(message, household);
    for (const n of named) { const i = mentioned.indexOf(n); if (i >= 0) mentioned.splice(i, 1); mentioned.push(n); }
    const positive = named.filter((n) => !negated.includes(n) && !owners.includes(n));
    const unknown = unknownName(message, household, named, negated);
    const before = people as string[] | null;
    const prev: string[] = before ?? [];
    let change: SubjectChange = "same";
    let replaced: string[] = [];
    if (unknown) {
      // Someone the household does not have: nobody's figures, until the household says who they mean. No earlier answer is
      // out of date: who it is about now is not a member (only a resolved replacement supersedes).
      people = [];
      change = "new";
    } else if (negated.length && positive.length) {
      // "Daniel, not Grace", "not Grace - Daniel": the people named now. Earlier answers for those taken back are out of date.
      people = positive;
      change = "replace";
      replaced = [...new Set([...prev.filter((p) => !positive.includes(p)), ...negated])];
    } else if (negated.length) {
      // "Not Grace" alone: the ones before without her, when they were settled; otherwise the other checks decide. Nothing is
      // superseded until the household says who it is about.
      people = before ? before.filter((p) => !negated.includes(p)) : null;
      change = "new";
    } else if (!positive.length && owners.length) {
      // "Does Daniel's policy cover her?": the people stay, with the policy's owner beside them; unsettled stays unsettled.
      people = before ? [...new Set([...before, ...owners])] : null;
      change = before ? "add" : "same";
    } else if (BOTH.test(message) && !positive.length) {
      // "Both of them": the two people of a two-person household, or the two last named.
      const two = members.length === 2 ? members : mentioned.length >= 2 ? mentioned.slice(-2) : null;
      if (two) { people = [...new Set([...prev, ...two])]; change = "add"; }
      else people = null;
    } else if (positive.length && ADDS.test(message)) {
      // An addition to people the messages never settled ("My wife broke her arm", then "and Daniel too") is left to the
      // other checks: it must never narrow the turn to the new name.
      people = before ? [...new Set([...before, ...positive, ...owners])] : null;
      change = "add";
    } else if (positive.length && POINTS_AT_PEOPLE.test(message)) {
      // "Grace's husband", "Daniel and the kids": a relationship word may point at someone not named. The other checks decide.
      people = null;
      change = "new";
    } else if (positive.length && correction(message, positive, household)) {
      people = [...new Set([...positive, ...owners])];
      change = "replace";
      // Before the people were settled, those taken out are every other member: only answers that showed their figures go.
      replaced = (before ?? members).filter((p) => !positive.includes(p));
    } else if (positive.length) {
      people = [...new Set([...positive, ...owners])];
      change = before && before.length === people.length && before.every((p) => people!.includes(p)) ? "same" : "new";
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
