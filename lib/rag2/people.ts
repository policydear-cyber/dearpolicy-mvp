/**
 * Conversational RAG: who a mention means. resolvePerson() maps "my daughter", "Mei", "my wife's mother", "she" or
 * "me" to one active household member -- or says it cannot: `ambiguous` (the options and one question to ask) or
 * `unknown` (nobody in the household fits). It never silently picks: a stepson is not "my son", a mother-in-law is
 * not "my mother", a helper is not family, and a pronoun means only the person the conversation was last about.
 */
import { loadMembers, type MemberRow } from "./store";

export type RelationClass = "self" | "spouse" | "child" | "step_child" | "child_in_law" | "parent" | "step_parent" | "parent_in_law" | "sibling" | "sibling_in_law" | "grandparent" | "grandchild" | "helper" | "dependant" | "other";
export type Gender = "f" | "m" | null;
export type Person = { id: string; name: string; preferredName: string | null; relationship: string; relation: RelationClass; gender: Gender; dateOfBirth: string | null };
export type ConversationContext = {
  /** The household member who is speaking ("me" / "my"); defaults to the member whose relationship is self. */
  speakerId?: string | null;
  /** The person the conversation was last about (what "she" / "he" / "they" can mean). */
  lastSubjectId?: string | null;
  /** People mentioned recently, newest first (used only to detect that a pronoun is ambiguous). */
  recentSubjectIds?: string[] | null;
};
export type PersonResolution =
  | { status: "ok"; person: Person; via: "self" | "pronoun" | "name" | "relation" | "name+relation" | "ordinal" }
  | { status: "ambiguous"; options: Person[]; question: string; reason: string }
  | { status: "unknown"; reason: string; question: string };

type RelWord = { re: RegExp; cls: RelationClass; g: Gender; word: string };
// Compound relation words first: "mother-in-law" must never be read as "mother", "stepson" never as "son".
const REL_WORDS: RelWord[] = [
  { re: /\b(?:wife|husband|spouse|partner)['’]s\s+(?:mother|mum|mom)\b|\bmother[- ]in[- ]law\b|\bmil\b/i, cls: "parent_in_law", g: "f", word: "mother-in-law" },
  { re: /\b(?:wife|husband|spouse|partner)['’]s\s+(?:father|dad)\b|\bfather[- ]in[- ]law\b|\bfil\b/i, cls: "parent_in_law", g: "m", word: "father-in-law" },
  { re: /\b(?:wife|husband|spouse|partner)['’]s\s+parents?\b|\bparents?[- ]in[- ]law\b|\bin-?laws\b/i, cls: "parent_in_law", g: null, word: "parent-in-law" },
  { re: /\bson[- ]in[- ]law\b/i, cls: "child_in_law", g: "m", word: "son-in-law" },
  { re: /\bdaughter[- ]in[- ]law\b/i, cls: "child_in_law", g: "f", word: "daughter-in-law" },
  { re: /\bbrother[- ]in[- ]law\b/i, cls: "sibling_in_law", g: "m", word: "brother-in-law" },
  { re: /\bsister[- ]in[- ]law\b/i, cls: "sibling_in_law", g: "f", word: "sister-in-law" },
  { re: /\bstep[- ]?son\b/i, cls: "step_child", g: "m", word: "stepson" },
  { re: /\bstep[- ]?daughter\b/i, cls: "step_child", g: "f", word: "stepdaughter" },
  { re: /\bstep[- ]?(?:child|children|kids?)\b/i, cls: "step_child", g: null, word: "stepchild" },
  { re: /\bstep[- ]?(?:mother|mum|mom)\b/i, cls: "step_parent", g: "f", word: "stepmother" },
  { re: /\bstep[- ]?(?:father|dad)\b/i, cls: "step_parent", g: "m", word: "stepfather" },
  { re: /\bstep[- ]?parents?\b/i, cls: "step_parent", g: null, word: "step-parent" },
  { re: /\b(?:domestic\s+)?helper\b|\bmaid\b|\bdomestic worker\b|\bnanny\b|\bcaregiver\b|\bfdw\b/i, cls: "helper", g: null, word: "helper" },
  { re: /\bgrand(?:mother|ma|mum|mom|ma)\b|\bnai\s?nai\b|\bpo\s?po\b/i, cls: "grandparent", g: "f", word: "grandmother" },
  { re: /\bgrand(?:father|pa|dad)\b|\bye\s?ye\b|\bgong\s?gong\b/i, cls: "grandparent", g: "m", word: "grandfather" },
  { re: /\bgrandparents?\b/i, cls: "grandparent", g: null, word: "grandparent" },
  { re: /\bgrandson\b/i, cls: "grandchild", g: "m", word: "grandson" },
  { re: /\bgranddaughter\b/i, cls: "grandchild", g: "f", word: "granddaughter" },
  { re: /\bgrand(?:child|children|kids?)\b/i, cls: "grandchild", g: null, word: "grandchild" },
  { re: /\bwife\b/i, cls: "spouse", g: "f", word: "wife" },
  { re: /\bhusband\b|\bhubby\b/i, cls: "spouse", g: "m", word: "husband" },
  { re: /\bspouse\b|\bpartner\b|\bother half\b/i, cls: "spouse", g: null, word: "spouse" },
  { re: /\bsons?\b|\bboy\b/i, cls: "child", g: "m", word: "son" },
  { re: /\bdaughters?\b|\bgirl\b/i, cls: "child", g: "f", word: "daughter" },
  { re: /\bchild(?:ren)?\b|\bkids?\b|\bbaby\b|\btoddler\b/i, cls: "child", g: null, word: "child" },
  { re: /\bmother\b|\bmum(?:my)?\b|\bmom(?:my)?\b|\bmama\b|\bmummy\b/i, cls: "parent", g: "f", word: "mother" },
  { re: /\bfather\b|\bdad(?:dy)?\b|\bpapa\b/i, cls: "parent", g: "m", word: "father" },
  { re: /\bparents?\b/i, cls: "parent", g: null, word: "parent" },
  { re: /\bbrother\b/i, cls: "sibling", g: "m", word: "brother" },
  { re: /\bsister\b/i, cls: "sibling", g: "f", word: "sister" },
  { re: /\bsiblings?\b/i, cls: "sibling", g: null, word: "sibling" },
];
/** Classes that are close to, but never the same as, a mentioned class: offered as a question, never picked. */
const NEAR: Partial<Record<RelationClass, RelationClass[]>> = {
  child: ["step_child", "child_in_law", "dependant", "grandchild"], step_child: ["child"],
  parent: ["step_parent", "parent_in_law"], step_parent: ["parent"], parent_in_law: ["parent"],
  sibling: ["sibling_in_law"], sibling_in_law: ["sibling"], spouse: [], helper: [],
};
const SELF = /^(?:i|me|my|myself|mine|my own|myself only|self|own)$/i;
const THIRD = /^(?:he|him|his|she|her|hers|they|them|their|theirs)$/i;
const GROUP = /^(?:we|us|our|ours|everyone|the family|family|all of us)$/i;
const FEMALE = /\b(?:mother|mum|mom|wife|daughter|sister|grandmother|grandma|aunt|niece|female|girl|woman)\b/i;
const MALE = /\b(?:father|dad|husband|son|brother|grandfather|grandpa|uncle|nephew|male|boy|man)\b/i;

/** The fine relation of a stored member: relationship plus what their notes say ("mother-in-law", "stepson", "helper"). */
export function relationOf(m: Pick<MemberRow, "relationship" | "notes">): { relation: RelationClass; gender: Gender } {
  const rel = (m.relationship ?? "").toLowerCase().trim(), notes = (m.notes ?? "").toLowerCase();
  const both = rel + " " + notes;
  const g: Gender = FEMALE.test(both) && !MALE.test(both) ? "f" : MALE.test(both) && !FEMALE.test(both) ? "m" : null;
  if (rel === "helper" || /\bhelper\b|\bmaid\b|\bdomestic\b|\bnanny\b|\bcaregiver\b/.test(both)) return { relation: "helper", gender: g };
  if (/in[- ]law/.test(both)) {
    if (/\b(?:mother|father|parent)s?[- ]in[- ]law\b/.test(both) || rel === "parent") return { relation: "parent_in_law", gender: g };
    if (/\b(?:son|daughter)[- ]in[- ]law\b/.test(both) || rel === "child") return { relation: "child_in_law", gender: g };
    return { relation: "sibling_in_law", gender: g };
  }
  if (/\bstep[- ]?/.test(both)) {
    if (rel === "parent" || /\bstep[- ]?(?:mother|father|mum|dad|parent)/.test(both)) return { relation: "step_parent", gender: g };
    return { relation: "step_child", gender: g };
  }
  const map: Record<string, RelationClass> = { self: "self", spouse: "spouse", wife: "spouse", husband: "spouse", partner: "spouse", child: "child", son: "child", daughter: "child", parent: "parent", mother: "parent", father: "parent", sibling: "sibling", brother: "sibling", sister: "sibling", grandparent: "grandparent", dependant: "dependant", dependent: "dependant" };
  return { relation: map[rel] ?? "other", gender: g };
}

export function toPerson(m: MemberRow): Person {
  const { relation, gender } = relationOf(m);
  return { id: m.id, name: m.displayName, preferredName: m.preferredName, relationship: m.relationship, relation, gender, dateOfBirth: m.dateOfBirth };
}
const label = (p: Person) => p.preferredName && p.preferredName !== p.name ? `${p.name} (${p.preferredName})` : p.name;
const listOf = (ps: Person[]) => ps.length <= 1 ? ps.map(label).join("") : ps.slice(0, -1).map(label).join(", ") + " or " + label(ps[ps.length - 1]);
const RELATION_NOUN: Record<RelationClass, string> = { self: "you", spouse: "spouse", child: "child", step_child: "stepchild", child_in_law: "child-in-law", parent: "parent", step_parent: "step-parent", parent_in_law: "parent-in-law", sibling: "sibling", sibling_in_law: "sibling-in-law", grandparent: "grandparent", grandchild: "grandchild", helper: "helper", dependant: "dependant", other: "household member" };
const nameWords = (s: string) => (s.toLowerCase().normalize("NFKC").match(/[\p{L}]+/gu) ?? []).filter((w) => w.length >= 2);
const COMMON = new Set("my the a an and of for is are was who whom about our your his her their do does did has have can how what which with to in on at mr mrs ms miss dr eldest oldest elder older youngest younger middle first second third little baby".split(" "));

/** Who `mention` means in this household. */
export async function resolvePerson(args: { accountId: string; mention: string; conversationContext?: ConversationContext | null }): Promise<PersonResolution> {
  const people = (await loadMembers(args.accountId)).map(toPerson);
  return resolvePersonAmong(people, args.mention, args.conversationContext ?? null);
}

/** resolvePerson() over an already-loaded household (pure). */
export function resolvePersonAmong(people: Person[], mentionRaw: string, ctx: ConversationContext | null): PersonResolution {
  const mention = (mentionRaw ?? "").trim().replace(/[?.!,]+$/g, "");
  if (!people.length) return { status: "unknown", reason: "the household has no people on file", question: "Who would you like to ask about? You can add them on the Family page." };
  if (!mention) return { status: "ambiguous", options: people, question: `Who do you mean — ${listOf(people)}?`, reason: "no person was named" };
  const byId = (id?: string | null) => (id ? people.find((p) => p.id === id) ?? null : null);
  const speaker = byId(ctx?.speakerId) ?? (people.filter((p) => p.relation === "self").length === 1 ? people.find((p) => p.relation === "self")! : null);
  if (SELF.test(mention)) {
    if (speaker) return { status: "ok", person: speaker, via: "self" };
    const selves = people.filter((p) => p.relation === "self");
    return selves.length ? { status: "ambiguous", options: selves, question: `Which of these is you — ${listOf(selves)}?`, reason: "more than one member is recorded as self" }
      : { status: "unknown", reason: "no household member is recorded as you", question: "Which member of the household are you?" };
  }
  if (GROUP.test(mention)) return { status: "ambiguous", options: people, question: `Who in the household do you mean — ${listOf(people)}, or everyone?`, reason: "the mention is the whole household" };
  if (THIRD.test(mention)) {
    const last = byId(ctx?.lastSubjectId);
    const g: Gender = /^(?:she|her|hers)$/i.test(mention) ? "f" : /^(?:he|him|his)$/i.test(mention) ? "m" : null;
    if (!last) return { status: "ambiguous", options: people.filter((p) => p.id !== speaker?.id), question: `Who do you mean by “${mention}”?`, reason: "the conversation has not been about anyone yet" };
    if (g && last.gender && last.gender !== g) {
      const others = (ctx?.recentSubjectIds ?? []).map(byId).filter((p): p is Person => !!p && (!p.gender || p.gender === g));
      return { status: "ambiguous", options: others.length ? others : people.filter((p) => p.id !== speaker?.id), question: `Who do you mean by “${mention}”?`, reason: `the conversation was last about ${last.name}, who is not referred to as “${mention}”` };
    }
    return { status: "ok", person: last, via: "pronoun" };
  }

  // Relation words (compound ones first, each consumed so "stepson" is not also "son").
  let rest = " " + mention + " ";
  let rel: RelWord | null = null;
  for (const w of REL_WORDS) { const m = rest.match(w.re); if (m) { if (!rel) rel = w; rest = rest.replace(w.re, " "); } }
  const ordinal = /\b(?:eldest|oldest|elder|older|first)\b/i.test(mention) ? "old" : /\b(?:youngest|younger|baby|little)\b/i.test(mention) && rel?.cls === "child" ? "young" : null;
  const words = nameWords(rest).filter((w) => !COMMON.has(w));
  const nameScore = (p: Person) => {
    const full = [p.name, p.preferredName].filter(Boolean).map((n) => n!.toLowerCase());
    if (full.some((n) => n.length >= 3 && (" " + mention.toLowerCase() + " ").includes(" " + n + " "))) return 3;
    const own = new Set([...nameWords(p.name), ...nameWords(p.preferredName ?? "")]);
    const hits = words.filter((w) => w.length >= 3 && own.has(w)).length;
    return hits ? 1 + Math.min(hits, 1) : 0;
  };
  const named = words.length ? people.map((p) => ({ p, s: nameScore(p) })).filter((x) => x.s > 0) : [];
  const best = named.length ? Math.max(...named.map((x) => x.s)) : 0;
  const byName = named.filter((x) => x.s === best).map((x) => x.p);
  const relFits = (p: Person) => !!rel && p.relation === rel.cls && (!rel.g || !p.gender || p.gender === rel.g);
  const relNear = (p: Person) => !!rel && (NEAR[rel.cls] ?? []).includes(p.relation) && (!rel.g || !p.gender || p.gender === rel.g);

  if (rel) {
    const pool = byName.length ? byName : people;
    let exact = pool.filter(relFits);
    if (byName.length && !exact.length) {
      const near = byName.filter(relNear);
      if (near.length) return { status: "ambiguous", options: near, question: `Do you mean ${listOf(near)}? ${near.length === 1 ? "They are" : "They are each"} recorded as your ${near.map((p) => RELATION_NOUN[p.relation]).join(" / ")}, not your ${rel.word}.`, reason: `nobody named so is recorded as your ${rel.word}` };
      return { status: "ambiguous", options: byName, question: `${listOf(byName)} ${byName.length === 1 ? "is" : "are"} not recorded as your ${rel.word}. Do you mean ${byName.length === 1 ? "them" : "one of them"}, or someone else?`, reason: `the name and the relation “${rel.word}” do not fit the same person` };
    }
    if (exact.length > 1 && ordinal) {
      const dated = exact.filter((p) => p.dateOfBirth);
      if (dated.length === exact.length) { const sorted = [...dated].sort((a, b) => a.dateOfBirth!.localeCompare(b.dateOfBirth!)); return { status: "ok", person: ordinal === "old" ? sorted[0] : sorted[sorted.length - 1], via: "ordinal" }; }
    }
    if (exact.length === 1) return { status: "ok", person: exact[0], via: byName.length ? "name+relation" : "relation" };
    if (exact.length > 1) return { status: "ambiguous", options: exact, question: `Which ${rel.word} do you mean — ${listOf(exact)}?`, reason: `more than one household member fits “${rel.word}”` };
    const near = people.filter(relNear);
    if (near.length) return { status: "ambiguous", options: near, question: `I don't have a ${rel.word} on file. Do you mean ${listOf(near)} (your ${[...new Set(near.map((p) => RELATION_NOUN[p.relation]))].join(" / ")})?`, reason: `no household member is recorded as your ${rel.word}; the closest relations are offered, never assumed` };
    return { status: "unknown", reason: `no household member is recorded as your ${rel.word}`, question: `I don't have your ${rel.word} in the household. Who do you mean?` };
  }
  if (byName.length === 1) return { status: "ok", person: byName[0], via: "name" };
  if (byName.length > 1) return { status: "ambiguous", options: byName, question: `Which do you mean — ${listOf(byName)}?`, reason: "more than one household member has that name" };
  return { status: "unknown", reason: `nobody in the household is called “${mention}”`, question: `I can't find “${mention}” in your household. Who do you mean?` };
}
