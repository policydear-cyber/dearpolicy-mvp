/**
 * Conversational RAG: who a mention means. resolvePerson() maps "my daughter", "Mei", "my wife's mother", "she" or
 * "me" to one active household member -- or says it cannot: `ambiguous` (the options and one question to ask) or
 * `unknown` (nobody in the household fits). It never silently picks: a stepson is never silently taken as "my son"
 * (nor silently left out of it), a mother-in-law is not "my mother", a helper is not family, and a pronoun means only
 * the person the conversation was last about.
 *
 * Why a stepson used to be omitted from "my son" (fixed here): the relation lookup matched only the exact relation
 * class (`child`), and offered the step class (`step_child`) only when NO exact match existed. So with one or more
 * sons on file, "my son" was answered from the sons alone -- one son was picked outright, two were offered -- and a
 * stepson, whom many households call "my son", was silently excluded. Now the commonly-shared step relation (child ->
 * step_child, parent -> step_parent) is offered BESIDE the exact matches, each candidate labelled with its recorded
 * relation ("your son", "your stepson"), and the household is asked which one they mean. Who a policy covers is a
 * separate question, answered by policies_for only after the person is resolved.
 */
import { loadMembers, type MemberRow } from "./store";

import { memberRelation, type MemberGender, type MemberRelation } from "@/lib/claims/person";
export type RelationClass = MemberRelation;
export type Gender = MemberGender;
export type Person = { id: string; name: string; preferredName: string | null; relationship: string; relation: RelationClass; gender: Gender; dateOfBirth: string | null;
  /** The recorded relation in words, from the speaker's side ("son", "stepson", "mother-in-law"), for labelling options. */
  relationLabel?: string };
export type ConversationContext = {
  /** The household member who is speaking ("me" / "my"); defaults to the member whose relationship is self. */
  speakerId?: string | null;
  /** True when the person typing was SAID or ASKED (the household answered who is typing); false when speakerId is only inferred from the single "self" member. */
  speakerConfirmed?: boolean;
  /** The person the conversation was last about (what "she" / "he" / "they" can mean). */
  lastSubjectId?: string | null;
  /** People mentioned recently, newest first (used only to detect that a pronoun is ambiguous). */
  recentSubjectIds?: string[] | null;
};
export type PersonResolution =
  | { status: "ok"; person: Person; via: "self" | "pronoun" | "name" | "relation" | "name+relation" | "ordinal" | "name_spelling" }
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
/** Step relations households commonly name with the plain word ("my son" for a stepson, "my mum" for a stepmother):
 * offered beside the exact class, labelled, and asked about -- never silently excluded and never silently picked. */
const ALSO: Partial<Record<RelationClass, RelationClass[]>> = { child: ["step_child"], parent: ["step_parent"] };
/** Classes that are close to, but never the same as, a mentioned class: offered as a question, never picked. */
const NEAR: Partial<Record<RelationClass, RelationClass[]>> = {
  child: ["step_child", "child_in_law", "dependant", "grandchild"], step_child: ["child"],
  parent: ["step_parent", "parent_in_law"], step_parent: ["parent"], parent_in_law: ["parent"],
  sibling: ["sibling_in_law"], sibling_in_law: ["sibling"], spouse: [], helper: [],
};
const SELF = /^(?:i|me|my|myself|mine|my own|myself only|self|own)$/i;
const THIRD = /^(?:he|him|his|she|her|hers|they|them|their|theirs)$/i;
const GROUP = /^(?:we|us|our|ours|everyone|the family|family|all of us)$/i;

/** The fine relation of a stored member: relationship plus what their notes say ("mother-in-law", "stepson", "helper"). */
export function relationOf(m: Pick<MemberRow, "relationship" | "notes">): { relation: RelationClass; gender: Gender } {
  return memberRelation(m.relationship, m.notes);
}

const REL_LABEL: Record<RelationClass, [string, string, string]> = {
  self: ["you", "you", "you"], spouse: ["wife", "husband", "spouse"], child: ["daughter", "son", "child"], step_child: ["stepdaughter", "stepson", "stepchild"],
  child_in_law: ["daughter-in-law", "son-in-law", "child-in-law"], parent: ["mother", "father", "parent"], step_parent: ["stepmother", "stepfather", "step-parent"],
  parent_in_law: ["mother-in-law", "father-in-law", "parent-in-law"], sibling: ["sister", "brother", "sibling"], sibling_in_law: ["sister-in-law", "brother-in-law", "sibling-in-law"],
  grandparent: ["grandmother", "grandfather", "grandparent"], grandchild: ["granddaughter", "grandson", "grandchild"], helper: ["helper", "helper", "helper"],
  dependant: ["dependant", "dependant", "dependant"], other: ["household member", "household member", "household member"],
};
/** The relation of a member in words ("son", "stepson", "mother-in-law"). */
export function relationWord(relation: RelationClass, gender: Gender): string { const l = REL_LABEL[relation]; return gender === "f" ? l[0] : gender === "m" ? l[1] : l[2]; }

export function toPerson(m: MemberRow): Person {
  const { relation, gender } = relationOf(m);
  return { id: m.id, name: m.displayName, preferredName: m.preferredName, relationship: m.relationship, relation, gender, dateOfBirth: m.dateOfBirth, relationLabel: relationWord(relation, gender) };
}
const label = (p: Person) => p.preferredName && p.preferredName !== p.name ? `${p.name} (${p.preferredName})` : p.name;
const relLabel = (p: Person) => `${p.name} (${p.preferredName && p.preferredName !== p.name ? p.preferredName + ", " : ""}your ${p.relationLabel ?? relationWord(p.relation, p.gender)})`;
const listRel = (ps: Person[]) => ps.length <= 1 ? ps.map(relLabel).join("") : ps.slice(0, -1).map(relLabel).join(", ") + " or " + relLabel(ps[ps.length - 1]);
const listOf = (ps: Person[]) => ps.length <= 1 ? ps.map(label).join("") : ps.slice(0, -1).map(label).join(", ") + " or " + label(ps[ps.length - 1]);
const RELATION_NOUN: Record<RelationClass, string> = { self: "you", spouse: "spouse", child: "child", step_child: "stepchild", child_in_law: "child-in-law", parent: "parent", step_parent: "step-parent", parent_in_law: "parent-in-law", sibling: "sibling", sibling_in_law: "sibling-in-law", grandparent: "grandparent", grandchild: "grandchild", helper: "helper", dependant: "dependant", other: "household member" };
const nameWords = (s: string) => (s.toLowerCase().normalize("NFKC").match(/[\p{L}]+/gu) ?? []).filter((w) => w.length >= 2);
/** Edit distance with adjacent transpositions ("meilign" -> "meiling" is 1). */
function typoDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
/** A mistyped name word: same first letter, one slip in a word of 5+ letters (two in 9+). */
const misspelt = (typed: string, name: string) => typed !== name && typed[0] === name[0] && Math.min(typed.length, name.length) >= 5 && typoDistance(typed, name) <= (Math.min(typed.length, name.length) >= 9 ? 2 : 1);
const COMMON = new Set("my the a an and of for is are was who whom about our your his her their do does did has have can how what which with to in on at mr mrs ms miss dr eldest oldest elder older youngest younger middle first second third little baby".split(" "));

/** Who `mention` means in this household. */
export async function resolvePerson(args: { accountId: string; mention: string; conversationContext?: ConversationContext | null }): Promise<PersonResolution> {
  const people = (await loadMembers(args.accountId)).map(toPerson);
  return resolvePersonAmong(people, args.mention, args.conversationContext ?? null);
}

/** resolvePerson() over an already-loaded household (pure). */
export function resolvePersonAmong(peopleIn: Person[], mentionRaw: string, ctx: ConversationContext | null): PersonResolution {
  let people = peopleIn;
  const mention = (mentionRaw ?? "").trim().replace(/[?.!,]+$/g, "");
  if (!people.length) return { status: "unknown", reason: "the household has no people on file", question: "Who would you like to ask about? You can add them under Account settings > People." };
  if (!mention) return { status: "ambiguous", options: people, question: `Who do you mean — ${listOf(people)}?`, reason: "no person was named" };
  const byId = (id?: string | null) => (id ? people.find((p) => p.id === id) ?? null : null);
  const speaker = byId(ctx?.speakerId) ?? (people.filter((p) => p.relation === "self").length === 1 ? people.find((p) => p.relation === "self")! : null);
  if (SELF.test(mention)) {
    if (speaker) return { status: "ok", person: speaker, via: "self" };
    // A shared household login: who is typing is not known. Ask once, offering the members who could be typing (those
    // recorded as self, else the adults), never assume.
    const selves = people.filter((p) => p.relation === "self");
    const adults = people.filter((p) => !["child", "step_child", "grandchild", "helper"].includes(p.relation));
    const options = selves.length >= 2 ? selves : adults.length >= 2 ? adults : people;
    if (options.length >= 2) return { status: "ambiguous", options, question: `Who is asking — ${listOf(options)}?`, reason: selves.length >= 2 ? "more than one member is recorded as self, and the person typing has not said who they are" : "no household member is recorded as you, and the person typing has not said who they are" };
    return { status: "unknown", reason: "no household member is recorded as you", question: "Which member of the household are you?" };
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
  // Relations are recorded from the household's "self" member's side. When the person typing is that member's spouse,
  // "my mother" is the self member's mother-in-law (and so on): the speaker's relation word is translated before
  // matching, and candidates are labelled from the speaker's side.
  if (rel && speaker && speaker.relation === "spouse") {
    const SWAP: Partial<Record<RelationClass, RelationClass>> = { parent: "parent_in_law", parent_in_law: "parent", sibling: "sibling_in_law", sibling_in_law: "sibling" };
    const to = SWAP[rel.cls];
    if (to) rel = { ...rel, cls: to };
    people = people.map((p) => { const back = SWAP[p.relation]; return back ? { ...p, relationLabel: relationWord(back, p.gender) } : p; });
  }
  const relFits = (p: Person) => !!rel && p.relation === rel.cls && (!rel.g || !p.gender || p.gender === rel.g);
  const relNear = (p: Person) => !!rel && (NEAR[rel.cls] ?? []).includes(p.relation) && (!rel.g || !p.gender || p.gender === rel.g);

  const relAlso = (p: Person) => !!rel && (ALSO[rel.cls] ?? []).includes(p.relation) && (!rel.g || !p.gender || p.gender === rel.g);

  if (rel) {
    const pool = byName.length ? byName : people;
    let exact = pool.filter(relFits);
    // The step relation the household may also mean ("my son" -> sons AND stepsons): offered beside the exact
    // matches, each labelled with its recorded relation, and asked about -- never left out, never picked.
    const also = byName.length ? [] : pool.filter(relAlso);
    if (exact.length && also.length) {
      const options = [...exact, ...also];
      return { status: "ambiguous", options, question: `Which ${rel.word} do you mean — ${listRel(options)}?`, reason: `more than one household member may be meant by “${rel.word}” (including a ${also.map((p) => p.relationLabel ?? relationWord(p.relation, p.gender)).filter((w, i, a) => a.indexOf(w) === i).join(" / ")})` };
    }
    // The relation word is stated from the SPEAKER's side, and the speaker is unknown when it was only inferred from the
    // household's "self" label (no explicit speaker in the conversation). If the one person the name matches IS that
    // inferred "self" member, a relation word that cannot describe oneself ("my husband Daniel") does not contradict the
    // name: the typist is someone else, and the name picks the person. No question is asked and nobody is guessed.
    if (byName.length === 1 && !exact.length && !ctx?.speakerConfirmed && byName[0].relation === "self" && rel.cls !== "self" && speaker?.id === byName[0].id) {
      return { status: "ok", person: byName[0], via: "name" };
    }
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
  // No exact name: one household member whose name the mention misspells ("Mei Lign" for Mei Ling) is that member;
  // a slip that fits more than one member is asked about.
  if (!byName.length && words.length) {
    const spelt = people.filter((p) => { const own = [...nameWords(p.name), ...nameWords(p.preferredName ?? "")]; return words.some((w) => own.some((n) => misspelt(w, n))); });
    if (spelt.length === 1) return { status: "ok", person: spelt[0], via: "name_spelling" };
    if (spelt.length > 1) return { status: "ambiguous", options: spelt, question: `Which do you mean — ${listOf(spelt)}?`, reason: `“${mention}” is close to more than one household member's name` };
  }
  if (byName.length > 1) return { status: "ambiguous", options: byName, question: `Which do you mean — ${listOf(byName)}?`, reason: "more than one household member has that name" };
  // V1.3: "my cover", "my personal accident policy": what is possessed is a thing, not a person -- the speaker is meant.
  if (speaker && !byName.length && /^my\s/i.test(mention) && /\b(?:cover|coverage|policy|policies|plan|plans|insurance|benefits?|claims?|certificates?|documents?|sum (?:insured|assured))$/i.test(mention)) return { status: "ok", person: speaker, via: "self" };
  return { status: "unknown", reason: `nobody in the household is called “${mention}”`, question: `I can't find “${mention}” in your household. Who do you mean?` };
}


// Agent G: applicability classes (who a column is printed for, which class a person is in) live in lib/claims/person.ts
// so the save-time gate (lib/chat) can use them without importing lib/rag2; re-exported here for the rag2 tools.
export { columnApplicability, columnFitProblem, personApplicability } from "@/lib/claims/person";
export type { ApplicabilityClass, ColumnApplicability, ColumnClass, PersonApplicability } from "@/lib/claims/person";
