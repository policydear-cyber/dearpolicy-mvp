/**
 * Which documents' pages a simple-chat question is sent with (live 8 Nov: one question about one person cost US$1.01,
 * because every document's pages were sent). A question that names exactly one household member, and no one else, is
 * sent only that person's documents in full; every other document is still listed (its name, insurer, product and
 * people), with its pages left out. Anything less certain sends every document, as before.
 *
 * Conservative by design (allow-list, default: everything):
 * - exactly one member is named, by their whole name or whole recorded preferred name (two words or more), and no other
 *   word of any member's name is said: one name word ("Max", "May") never scopes (Critic P393 B);
 * - no word asks for the speaker, several people, a relative or a comparison ("my", "we", "wife", "both", "too", "also",
 *   "compare", "anyone": a closed list), so "my wife" or "Alex and me" is never scoped;
 * - it is worked out from the household's current message only, so a correction to another person ("it is for Ben") scopes
 *   to that person, and a message that names nobody sends everything, whatever earlier messages named.
 * A document is left out only when it belongs to one other member alone: linked to (or uploaded for) exactly one person,
 * who is not the person asked about, with no row of the benefit table for anyone else, and pages that neither name the
 * person nor print words for dependants, a spouse, children or family (Critic P393 A). A shared or family policy, a
 * document linked to nobody, or one that holds a row for the person asked about, is always sent in full.
 */
import type { Household, HouseholdDocument } from "./library";

export type ChatScope = { person: string; keep: Set<string> };
/** The rows the scope reads: whose row it is, and the documents it is printed in (lib/benefit-table/chat.ts ChatRow). */
export type ScopeRow = { person: string; source: { documentId: string }; baseSource?: { documentId: string } | null; capSource?: { documentId: string } | null };

/** A member's name without a preferred name in brackets ("Jane Doe (JD)" is "Jane Doe"). */
const baseName = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();
const norm = (s: string) => baseName(s).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const wordsOf = (s: string) => s.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/** Words that mean the question may be about someone other than one named member, or more than one person (closed list):
 * the speaker, several people, a relative, a comparison or an addition. Any of them sends everything. */
const NOT_ONE_PERSON = /\b(?:i|me|my|mine|myself|i'm|im|i've|i'd|i'll|we|us|our|ours|ourselves|both|all|each|every|everyone|everybody|either|neither|anyone|anybody|someone|somebody|whoever|who|whose|whom|people|persons|members?|family|families|household|together|too|also|as\s+well|compare\w*|comparison|versus|vs|than|same|other|others|else|between|wife|husband|spouse|partner|hubby|wifey|son|sons|daughter|daughters|child|children|kid|kids|baby|babies|mother|father|mum|mom|dad|mummy|daddy|parents?|brother|brothers|sister|sisters|sibling|siblings|grandma|grandpa|grandmother|grandfather|grandparents?|aunt|uncle|cousin|nephew|niece|helper|maid|employee|dependants?|dependents?)\b/i;

/** The one member the message names, or null. Only a member's whole name, or whole recorded preferred name, of two words or
 * more, said as written ("Jane Doe", any case), names them: never one word of it, since a name word is often an
 * ordinary word ("max", "low", "bill", "may": Critic P393 B) or shared by two members. Null when no whole name is
 * said, when two are, when any other word of any member's name is also said ("Jane Doe and Ann"), or when any
 * NOT_ONE_PERSON word is. */
export function onePersonNamed(message: string, household: Household): string | null {
  const text = message.normalize("NFKC").replace(/[’`]/g, "'");
  if (NOT_ONE_PERSON.test(text)) return null;
  const named = new Set<string>();
  let rest = ` ${wordsOf(text).join(" ")} `;
  for (const m of household.members) {
    for (const whole of namesOf(m.name)) {
      if (!rest.includes(` ${whole} `)) continue;
      named.add(m.name);
      rest = rest.split(` ${whole} `).join("  ");
    }
  }
  if (named.size !== 1) return null;
  // Any word of any member's name left over may name someone else (or be an ordinary word): unsure, so everything.
  const left = new Set(rest.split(" ").filter(Boolean));
  if (household.members.some((m) => wordsOf(m.name).some((w) => left.has(w)))) return null;
  return [...named][0];
}
/** A member's whole name and whole recorded preferred name, as lower-case words, when two words or more. */
const namesOf = (name: string) => [baseName(name), /\(([^)]*)\)\s*$/.exec(name)?.[1] ?? ""].map((n) => wordsOf(n).join(" ")).filter((n) => n.includes(" "));
/** Whether a document's pages name the person (every word of their name or of a preferred name, in any order, as words,
 * "DOE JANE" for "Jane Doe"), or print words for people covered beside the policyholder (dependants, a spouse,
 * children, family members, insured persons): a dependant named only in a plan's text is never cut off (Critic P393 A). */
const COVERS_OTHERS = /\b(?:dependants?|dependents?|spouses?|wife|husband|child|children|son|daughter|famil(?:y|ies)|insured\s+persons|persons\s+insured|lives\s+(?:assured|insured)|members?\s+covered|covered\s+members?)\b/i;
function pagesName(d: HouseholdDocument, person: string): boolean {
  const names = [baseName(person), /\(([^)]*)\)\s*$/.exec(person)?.[1] ?? ""].map(wordsOf).filter((w) => w.length);
  return d.pages.some((p) => {
    if (COVERS_OTHERS.test(p.text)) return true;
    const heard = new Set(wordsOf(p.text));
    return names.some((n) => n.every((w) => heard.has(w)));
  });
}

/** The people a document is for: those linked to it and the one it was uploaded for. */
const peopleOf = (d: HouseholdDocument) => new Set([...d.linkedPeople, ...(d.uploadedFor ? [d.uploadedFor] : [])].map(norm));

/** The documents sent in full for a question that names exactly one member (onePersonNamed), or null: send everything. */
export function scopeFor(message: string, household: Household, rows: readonly ScopeRow[] | null = null): ChatScope | null {
  const person = onePersonNamed(message, household);
  if (!person) return null;
  const me = norm(person);
  const memberNames = new Set(household.members.map((m) => norm(m.name)));
  const rowPeople = new Map<string, Set<string>>();
  for (const r of rows ?? []) for (const s of [r.source, r.baseSource, r.capSource]) {
    if (!s) continue;
    rowPeople.set(s.documentId, new Set([...(rowPeople.get(s.documentId) ?? []), norm(r.person)]));
  }
  const keep = new Set<string>();
  for (const d of household.documents) {
    const people = peopleOf(d);
    const rowsFor = rowPeople.get(d.policyId) ?? new Set<string>();
    const other = people.size === 1 ? [...people][0] : null;
    // Left out only when it is one other member's alone: one person, a household member, not the person asked about, and
    // every row the table prints from it is that person's.
    const othersAlone = other !== null && other !== me && memberNames.has(other) && [...rowsFor].every((p) => p === other) && !pagesName(d, person);
    if (!othersAlone) keep.add(d.policyId);
  }
  return { person, keep };
}

/** Said in the library when a question is scoped: which documents' pages are sent, and that the rest are only listed. */
export const scopeNote = (person: string) =>
  `This question names only ${person}. The pages of ${person}'s documents, and of every shared, family or unlinked document, are sent below. Documents that belong to another household member alone are listed with their details but their pages are left out: never say from them what ${person} has or does not have, and if the question turns out to be about someone else, say the answer needs that person's documents and ask the household to name them.`;
/** The note on a document whose pages were left out by the scope. */
export const SCOPED_OUT = "this document belongs to another household member alone; its pages are left out for a question about one other person";
