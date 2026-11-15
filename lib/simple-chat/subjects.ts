/** Who a chat turn is about, read from the household's own messages in this conversation, oldest first. Pure.
 *
 * Default: main's behaviour. `people: null` means the chat's other person checks decide (lib/simple-chat/verify.ts
 * askedAbout, the rows' own person checks), exactly as before this module. Only one thing ever narrows the people (drops
 * someone): an explicit replacement between two household members, each written as a name (capitalised and standing on
 * its own, never inside a longer capitalised phrase such as "Mount Elizabeth" or "Gold Max"), or written in full:
 * - "<A>, not <B>" ("actually it's Daniel, not Grace", "Daniel who broke his arm, not Grace");
 * - "not <B>, <A>" ("not Grace - Daniel", "not Grace but Daniel");
 * - "I meant <A>" (or "I mean <A>") right after a turn about B.
 * Then the turn, and the turns after it, are about A; earlier answers with B's figures (and none of A's) are out of date.
 * After a replacement, any later message can only add people: one naming another member adds them; a relationship word
 * or the speaker ("my husband", "I") goes back to the other checks. Nothing else (an addition, "what about Daniel?",
 * "actually"/"sorry" alone, a negation) ever drops anyone.
 * "Who did you mean?" is asked only for "<X>, not <member>" where X is written as a name and is no member.
 * Nothing here knows any household: names come from the household's own member list. */
import type { Household } from "./library";

export type SubjectChange = "replace" | "add" | "new" | "same";
export type Subjects = {
  /** The members (full names as the household lists them, without a bracketed note) the turn may show figures for; null
   * when the messages do not settle it (the default: the other person checks decide). */
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

/** Words that add people to the ones already asked about (closed list). */
const ADDS = /\b(?:too|also|as\s+well|both|in\s+addition|additionally|as\s+well\s+as)\b/i;
/** "both", "the two of them": every one of two people. */
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
type Mention = { person: string; start: number; end: number };
const CAPITALISED = /^\p{Lu}[\p{Ll}'-]*$/u;

/** A member's mentions written as a name: their full name in any case, or one of their own name words capitalised and
 * standing on its own: the words joined to it by spaces are only their other name words or closed-list words ("Actually
 * Daniel", "I meant Daniel"), never another capitalised word ("Mount Elizabeth", "Tan Tock Seng", "HealthShield Gold Max"). */
function nameMentions(text: string, household: Household): Mention[] {
  const out: Mention[] = [];
  const tokens = [...text.matchAll(/\p{L}[\p{L}'-]*/gu)].map((m) => ({ word: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const spaced = (a: { end: number }, b: { start: number }) => /^ +$/.test(text.slice(a.end, b.start));
  for (const [person, own] of ownWords(household)) {
    const all = nameWords(person);
    // The whole name, in any case.
    if (all.length > 1) for (const m of text.matchAll(new RegExp(String.raw`(?<![\p{L}])${all.map(escape).join(String.raw`\s+`)}(?![\p{L}])`, "giu")))
      out.push({ person, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    tokens.forEach((t, i) => {
      const lower = t.word.replace(/'s$/i, "").toLowerCase();
      if (!own.includes(lower) || !CAPITALISED.test(t.word.replace(/'s$/i, "")) || out.some((m) => m.start <= t.start && t.end <= m.end)) return;
      const joined = (n: { word: string } | undefined) => !!n && CAPITALISED.test(n.word.replace(/'s$/i, "")) && !all.includes(n.word.replace(/'s$/i, "").toLowerCase()) && !NOT_NAMES.has(n.word.toLowerCase());
      if ((i > 0 && spaced(tokens[i - 1], t) && joined(tokens[i - 1])) || (i + 1 < tokens.length && spaced(t, tokens[i + 1]) && joined(tokens[i + 1]))) return;
      out.push({ person, start: t.start, end: t.end });
    });
  }
  return out.sort((a, b) => a.start - b.start);
}
/** Every member whose own name word appears in any case: only ever used to add people. */
function looselyNamed(text: string, household: Household): string[] {
  const lower = ` ${text.toLowerCase()} `;
  return [...ownWords(household)].filter(([, own]) => own.some((w) => new RegExp(String.raw`(?<![\p{L}])${escape(w)}(?![\p{L}])`, "u").test(lower))).map(([p]) => p);
}

/** Between A and "not B": "A, not B", "A - not B", "A who broke his arm, not B", "A after all, not B". */
const A_NOT_B = /^(?:'s)?\s*(?:(?:,|-)\s*|\s+(?:after\s+all|instead|then|this\s+time)\s*,?\s*|\s+who\s[^.!?]{0,60}?,?\s+)(?:and\s+)?not\s+(?:for\s+|about\s+)?$/iu;
/** Between "not B" and A: "not B, A", "not B - A", "not B but A", "not B, it's A". */
const NOT_B_A = /^(?:'s)?\s*(?:[,;-]\s*|\s+but\s+)(?:(?:it'?s|it\s+was|it\s+is)\s+)?$/iu;
const NOT_BEFORE = /(?:^|[^\p{L}])not\s+(?:for\s+|about\s+)?$/iu;

/** An explicit replacement in one message: the members it is now about (A) and those taken back (B). */
function replacement(text: string, mentions: Mention[], previous: string[]): { a: string[]; b: string[] } | null {
  for (const ma of mentions) for (const mb of mentions) {
    if (ma.person === mb.person) continue;
    if (ma.end <= mb.start && A_NOT_B.test(text.slice(ma.end, mb.start))) return { a: [ma.person], b: [mb.person] };
    if (mb.end <= ma.start && NOT_BEFORE.test(text.slice(0, mb.start)) && NOT_B_A.test(text.slice(mb.end, ma.start))) return { a: [ma.person], b: [mb.person] };
  }
  // "I meant A" right after a turn about other members.
  for (const ma of mentions) {
    if (!/(?:^|[^\p{L}])I\s+mean(?:t)?\s+$/iu.test(text.slice(0, ma.start)) || !/^(?:'s)?\s*(?:[.!?,;]|-|$|not\b)/u.test(text.slice(ma.end))) continue;
    const b = previous.filter((p) => p !== ma.person);
    if (b.length && !previous.includes(ma.person)) return { a: [ma.person], b };
  }
  return null;
}

/** "<X>, not <member>" with X written as a name that is no member, no closed-list word, no family word and no word the
 * household's documents print: the only shape that asks who they meant. */
function unknownName(text: string, mentions: Mention[], household: Household): string | null {
  const printed = new Set(household.documents.flatMap((d) => [d.name, d.insurer ?? "", d.productName ?? "", ...d.pages.map((p) => p.text)])
    .join(" ").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2));
  const known = new Set(household.members.flatMap((m) => nameWords(m.name)));
  for (const mb of mentions) {
    const m = /(?:^|[^\p{L}])(\p{Lu}\p{Ll}+)(\s*(?:,|-)\s*(?:and\s+)?not\s+(?:for\s+|about\s+)?)$/u.exec(text.slice(0, mb.start));
    if (!m) continue;
    const word = m[1], lower = word.toLowerCase();
    // Standing on its own: no capitalised word joined to it before ("Mount Elizabeth, not Grace").
    const before = text.slice(0, mb.start - m[2].length - word.length);
    if (/\p{Lu}[\p{L}'-]* +$/u.test(before) && !NOT_NAMES.has((/(\p{L}[\p{L}'-]*) +$/u.exec(before)?.[1] ?? "").toLowerCase())) continue;
    if (NOT_NAMES.has(lower) || known.has(lower) || printed.has(lower) || POINTS_AT_PEOPLE.test(lower)) continue;
    return word;
  }
  return null;
}

/** The people each message so far settles, oldest first; the result is for the latest message (the first of `said`).
 * `said`: the household's messages in this conversation, the latest first (as the chat passes them). */
export function resolveSubjects(household: Household, said: readonly string[]): Subjects {
  const members = household.members.map((m) => baseName(m.name));
  let people: string[] | null = null;
  let previous: string[] = [];
  let last: Subjects = { people: null, change: "same", replaced: [], unknown: null };
  for (const raw of [...said].reverse()) {
    const text = norm(raw);
    const mentions = nameMentions(text, household);
    const before: string[] | null = people;
    const about = before ?? previous;
    let change: SubjectChange = "same", replaced: string[] = [], unknown: string | null = null;
    const swap = replacement(text, mentions, about);
    if (swap) {
      // The only narrowing: an explicit replacement between two members.
      people = [...new Set(swap.a)];
      replaced = [...new Set([...swap.b, ...about])].filter((p) => !people!.includes(p));
      change = "replace";
    } else if ((unknown = unknownName(text, mentions, household))) {
      // "Wei, not Grace": nobody's figures until the household says who they mean; nothing is superseded.
      people = [];
      change = "new";
    } else if (before) {
      // After a replacement: only ever more people. A relationship word or the speaker goes back to the other checks.
      if (POINTS_AT_PEOPLE.test(text) || FIRST_PERSON.test(text.replace(ASKING, " "))) { people = null; change = "new"; }
      else {
        const more: string[] = [...new Set([...before, ...looselyNamed(text, household), ...(BOTH.test(text) && members.length === 2 ? members : [])])];
        if (more.length > before.length) change = "add";
        people = more;
      }
    } else {
      people = null;
      if (ADDS.test(text) && looselyNamed(text, household).length) change = "add";
    }
    // Never zero people, except when asking who they meant.
    if (people && !people.length && !unknown) people = null;
    previous = mentions.length ? [...new Set(mentions.map((m) => m.person))] : people ?? previous;
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
 * a replaced person, until one that showed figures for other people only. Answers that showed no figures are passed over;
 * an answer that already showed a figure for someone the turn is now about (`kept`) is never out of date, and ends the walk.
 * `turns`: each earlier answer's id and the people its figures were for, oldest first. */
export function supersededBy(replaced: readonly string[], turns: readonly { answerId?: string | null; people?: readonly string[] | null }[], kept: readonly string[] = []): string[] {
  if (!replaced.length) return [];
  const out: string[] = [];
  for (const t of [...turns].reverse()) {
    const people = t.people ?? [];
    if (!people.length) continue;
    if (people.some((p) => kept.includes(p)) || !people.some((p) => replaced.includes(p))) break;
    if (t.answerId) out.push(t.answerId);
  }
  return out;
}
