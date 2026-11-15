/** Who a chat turn is about, read from the household's own messages in this conversation, oldest first. Pure.
 *
 * Default: main's behaviour. `people: null` means the chat's other person checks decide (lib/simple-chat/verify.ts
 * askedAbout, the rows' own person checks), exactly as before this module. Only one thing ever narrows the people (drops
 * someone): an explicit replacement between two household members, each written as a name (capitalised and standing on
 * its own, never inside a longer capitalised phrase such as "Mount Elizabeth" or "Gold Max"), or written in full, as the
 * whole message or its opening clause:
 * - "<A>, not <B>" ("Daniel, not Grace", "Actually it's Daniel, not Grace - how much?");
 * - "not <B>, <A>" ("Not Grace, Daniel", "not Grace - Daniel");
 * - "I meant <A>" (or "I mean <A>") right after a turn about B.
 * Only a short question may follow, and it must not name B. Mid-sentence ("Pay it to Daniel, not Grace"), with a
 * description ("Daniel who was driving, not Grace") or as a question ("Daniel, not Grace?") it is no replacement.
 * The replacement narrows its own turn only; earlier answers with B's figures (and none of A's) are out of date, stay so,
 * and are never read to the model again. Every other turn is main's behaviour.
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
  /** The members a replacement is now about (A), even when `people` is left to the other checks (a pronoun after the
   * correction): an earlier answer that showed one of them is never superseded. */
  kept?: string[];
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
/** Words that point at people without naming them: relationships and the household as a whole (closed list). The other
 * person checks decide for these (lib/simple-chat/verify.ts askedAbout, spouseMeant). */
const POINTS_AT_PEOPLE = /\b(?:husband|wife|spouse|partner|son|sons|daughter|daughters|child|children|kids?|baby|babies|mother|mum|mom|father|dad|parents?|brother|sister|siblings?|grand(?:mother|father|ma|pa|son|daughter|child|children|parents?)|in-laws?|mummy|mommy|mama|daddy|papa|helper|maid|nanny|auntie|aunty|aunt|uncle|cousin|niece|nephew|fianc[eé]e?|boyfriend|girlfriend|family|we|us|our|everyone|everybody|all\s+of\s+us|each\s+of\s+us)\b|妻子|老婆|丈夫|老公|儿子|兒子|女儿|女兒|孩子|妈妈|媽媽|爸爸|父亲|父親|母亲|母親/i;
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

/** Words that may open a correction ("Actually it's", "Sorry,", "No, it was"), closed list. */
const OPENER = String.raw`(?:(?:actually|sorry|oops|no|wait|correction|my\s+mistake|my\s+bad)\s*[,!.:;-]?\s*)*(?:(?:it'?s|it\s+was|it\s+is|that'?s|that\s+was)\s+)?`;
/** A member as a placeholder in the marked text (marked()): \u0001<index>\u0002. */
const P = String.raw`\u0001(\d+)\u0002`;
/** What may follow the correction: nothing, an end of sentence and anything, or a short question after a comma or dash
 * ("Daniel, not Grace - how much?"). Never a description ("Daniel - not Grace - was driving") and never the correction
 * itself as a question ("Daniel, not Grace?"). */
const TAIL = /^(?:'s)?\s*(?:$|[.!]+(?:\s|$)|(?:,|\s-)\s*(?:how|what|which|when|is|are|does|do|did|can|could|will|would|so|then|and\s+(?:how|what))\b)/iu;

/** The message with each member mention (nameMentions) replaced by a placeholder for that member, and the members by index. */
function marked(text: string, mentions: Mention[], household: Household): { m: string; people: string[] } {
  const people = household.members.map((x) => baseName(x.name));
  let out = "", at = 0;
  for (const x of mentions) {
    if (x.start < at) continue;
    // A possessive stays outside the placeholder ("Daniel's" -> placeholder + "'s"), so a shape can see it.
    const raw = text.slice(x.start, x.end), poss = /'s$/i.test(raw) && !nameWords(x.person).includes(raw.toLowerCase());
    out += text.slice(at, x.start) + `\u0001${people.indexOf(x.person)}\u0002${poss ? "'s" : ""}`; at = x.end;
  }
  return { m: out + text.slice(at), people };
}
/** Whether what follows the correction is allowed (TAIL) and never names B again, in any form ("How much does Grace get?"). */
function tailOk(rest: string, b: string[], household: Household, people: string[]): boolean {
  if (!TAIL.test(rest)) return false;
  const plain = rest.replace(new RegExp(P, "gu"), (_, i: string) => ` ${people[Number(i)]} `);
  return !looselyNamed(plain, household).some((n) => b.includes(n));
}

/** An explicit replacement, only as the whole message or its opening clause (round 3): "Daniel, not Grace", "Actually it's
 * Daniel, not Grace - how much?", "Not Grace, Daniel", "Sorry, I meant Daniel" (right after a turn about B), each with A and
 * B members written as names. Anything after it may only be a short question that does not name B. */
function replacement(text: string, mentions: Mention[], previous: string[], household: Household): { a: string[]; b: string[]; pronoun: boolean } | null {
  const { m, people } = marked(text.trim(), mentions, household);
  // A possessive in either slot ("Daniel's, not Grace's") may answer "whose policy?" as well as correct the person: never
  // a replacement (round 4, R4-2). The shapes match it so that it is refused rather than read some other way.
  const POSS = String.raw`('s)?`;
  const shapes: [RegExp, (g: RegExpExecArray) => { a: string; b: string | null; poss?: boolean }][] = [
    [new RegExp(String.raw`^${OPENER}${P}${POSS}\s*(?:,|\s-)\s*not\s+${P}${POSS}`, "iu"), (g) => ({ a: g[1], b: g[3], poss: !!(g[2] || g[4]) })],
    [new RegExp(String.raw`^${OPENER}not\s+${P}${POSS}\s*(?:,|\s-)\s*(?:(?:it'?s|it\s+was|it\s+is)\s+)?${P}${POSS}`, "iu"), (g) => ({ a: g[3], b: g[1], poss: !!(g[2] || g[4]) })],
    [new RegExp(String.raw`^(?:(?:sorry|oops|no|actually)\s*[,!.]?\s*)*I\s+mean(?:t)?\s+${P}(?:\s*(?:,|\s-)\s*not\s+${P})?`, "iu"), (g) => ({ a: g[1], b: g[2] ?? null })],
  ];
  for (const [re, pick] of shapes) {
    const g = re.exec(m);
    if (!g) continue;
    const { a: ai, b: bi, poss } = pick(g);
    if (poss) return null;
    const a = people[Number(ai)];
    const b = bi != null ? [people[Number(bi)]] : previous.filter((x) => x !== a);
    if (!a || !b.length || b.includes(a) || (bi == null && previous.includes(a))) return null;
    const rest = m.slice(g[0].length);
    // A third-person pronoun after the correction may still mean B: supersede, but leave the turn's people to the other
    // checks (round 4, R4-1).
    return tailOk(rest, b, household, people) ? { a: [a], b, pronoun: PRONOUN.test(rest) } : null;
  }
  return null;
}

const PRONOUN = /\b(?:she|her|hers|herself|he|him|his|himself|they|them|their|theirs|themselves)\b/i;

/** "<X>, not <member>" as the whole message or its opening clause, with X written as a name that is no member, no
 * closed-list word, no family word and no word the household's documents print: the only shape that asks who they meant. */
function unknownName(text: string, mentions: Mention[], household: Household): string | null {
  const { m, people } = marked(text.trim(), mentions, household);
  // Case-insensitive for the opener; the word itself must be written as a name (checked on its own below).
  const gi = new RegExp(String.raw`^${OPENER}(\p{L}+)\s*(?:,|\s-)\s*not\s+${P}`, "iu").exec(m);
  if (!gi || !/^\p{Lu}\p{Ll}+$/u.test(gi[1])) return null;
  const word = gi[1], lower = word.toLowerCase();
  const printed = new Set(household.documents.flatMap((d) => [d.name, d.insurer ?? "", d.productName ?? "", ...d.pages.map((p) => p.text)])
    .join(" ").toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 2));
  const known = new Set(household.members.flatMap((x) => nameWords(x.name)));
  if (NOT_NAMES.has(lower) || known.has(lower) || printed.has(lower) || POINTS_AT_PEOPLE.test(lower)) return null;
  return tailOk(m.slice(gi[0].length), [people[Number(gi[2])]], household, people) ? word : null;
}

/** Who the latest message (the first of `said`) is about; the one before it settles only who "I meant <A>" takes back.
 * A replacement narrows its own turn only: later turns go back to the other checks (round 3), while the answers it
 * superseded stay superseded and are never read to the model again. `said`: the household's messages, latest first. */
/** `opts.askedBefore`: the answer just before ended with a question; a reply in a replacement's shape ("Daniel, not Grace")
 * then answers it (who was driving, whose name the policy is in), and corrects nothing (round 4, R4-3). */
export function resolveSubjects(household: Household, said: readonly string[], opts: { askedBefore?: boolean } = {}): Subjects {
  const latest = norm(said[0] ?? "");
  const previousText = said[1] != null ? norm(said[1]) : "";
  const previous = [...new Set(nameMentions(previousText, household).map((x) => x.person))];
  const mentions = nameMentions(latest, household);
  const swap = opts.askedBefore ? null : replacement(latest, mentions, previous, household);
  if (swap) return { people: swap.pronoun ? null : swap.a, change: "replace", replaced: swap.b.filter((p) => !swap.a.includes(p)), unknown: null, kept: swap.a };
  const unknown = unknownName(latest, mentions, household);
  if (unknown) return { people: [], change: "new", replaced: [], unknown };
  return { people: null, change: ADDS.test(latest) && looselyNamed(latest, household).length ? "add" : "same", replaced: [], unknown: null };
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
