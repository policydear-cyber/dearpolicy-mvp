/**
 * V1.4 (after s50-live-2): whom an endorsement applies to, relative to one household member. An endorsement shares a
 * policy number with the schedule it amends; on a group scheme that number covers every insured person, so the shared
 * number alone never says whose cover a person-specific endorsement changes. Its scope is read from its AMENDING
 * clauses (the lines that change something: "… for Ong Li Ting, Michelle is amended to …"), not from headers, addresses
 * or the policyholder line:
 *  1. an amending clause names this member                     -> applies;
 *  2. the wording states a scheme-wide scope ("all Insured Persons") -> applies;
 *  3. amending clauses name only other household members       -> other: it supports no conclusion about this member
 *                                                                 (no amendment, caveat, uncertainty or conflict);
 *  4. an amending clause is person-specific but names no household member (a masked ID, "the Insured Person
 *     <name>" not in the household)                             -> unresolved: reported as "does not establish whom it
 *                                                                 applies to", attributed to nobody;
 *  5. otherwise (no person-specific clause)                    -> applies to the policy as a whole.
 * The household's links of the endorsement document to members are not used: an endorsement is usually linked to the
 * policyholder, which says nothing about whose cover it amends.
 */
import { memberNamedIn } from "./tables";

export type EndorsementScope = { scope: "applies" | "other" | "unresolved"; basis: string; namedIds: string[] };
export const ALL_INSURED = /\b(?:all|every|each)\s+(?:of\s+the\s+)?(?:insured\s+persons?|insured\s+members?|members?|employees?|officers?|covered\s+persons?|persons?\s+insured|insureds?)\b|\bapplies\s+to\s+all\b|\bscheme-?wide\b/i;
const AMENDING = /\b(?:is|are|has been|have been|hereby|shall be)\s+(?:amended|revised|increased|reduced|changed|altered|replaced|deleted|added)\b|\bamended\s+to\b|\bwith effect from\b|\bw\.?e\.?f\.?\b/i;
const PERSON_SPECIFIC = /\b[A-Z]\*{3,}\d{2,4}[A-Z]\b|\b(?:for|of|in respect of)\s+(?:the\s+)?insured\s+person\b|\binsured\s+person\s*:/i;

export function endorsementScope(a: { text: string; linkedMemberIds?: string[]; subjectId: string; household: { id: string; names: string[] }[] }): EndorsementScope {
  const clauses = a.text.split(/\n+|(?<=[.;])\s+/).filter((l) => AMENDING.test(l));
  const named = new Set<string>();
  for (const line of clauses) for (const m of a.household) { const id = memberNamedIn(line, [m]); if (id) named.add(id); }
  const namedIds = [...named];
  if (named.has(a.subjectId)) return { scope: "applies", basis: "its amending clause names this person", namedIds };
  if (ALL_INSURED.test(a.text)) return { scope: "applies", basis: "its wording applies to all insured persons", namedIds };
  if (namedIds.length) return { scope: "other", basis: "its amending clause names only another household member", namedIds };
  if (clauses.some((l) => PERSON_SPECIFIC.test(l))) return { scope: "unresolved", basis: "its amending clause is for one insured person but does not establish which household member", namedIds };
  return { scope: "applies", basis: "it amends the policy as a whole (no person-specific clause)", namedIds };
}
