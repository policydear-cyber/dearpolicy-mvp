export type ClaimPerson = { id: string; display_name: string; preferred_name: string | null; relationship: string };
export type ClaimPersonResolution =
  | { status: "resolved"; person: ClaimPerson; explicit: boolean }
  | { status: "ambiguous"; candidates: ClaimPerson[] }
  | { status: "unknown"; name: string; candidates: ClaimPerson[] };

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function includesName(message: string, name: string) {
  return name.length > 0 && ` ${message} `.includes(` ${name} `);
}

// Cheap edit distance, used only to forgive a short typo in a name someone
// clearly already told us (Charmine/Charmaine) — never to invent a match
// that wasn't reasonably close.
function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[a.length][b.length];
}
function fuzzyIncludesName(message: string, name: string) {
  // Too short to safely guess at: "long" is one letter from "Ling" and "Wong".
  if (name.length < 5) return false;
  const tolerance = name.length >= 8 ? 2 : 1;
  return ` ${message} `.split(" ").some(word => word.length >= 3 && Math.abs(word.length - name.length) <= tolerance && editDistance(word, name) <= tolerance);
}

function subjectName(text: string) {
  const subject = text.match(/(?:^|[.!?,]\s*)(?:unfortunately\s+|sadly\s+)?([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,5})\s+(?:(?:has|had|was|is)\s+(?:been\s+)?)?(?:died|passed away|deceased|killed|murdered|assassinated|diagnosed|caught|contracted|came down with|tested positive for|suffers from|suffering from|got|(?:had|got into|was in) an? (?:motorbike |motorcycle |car |road traffic )?accident|broke|fractured|hospitalised|hospitalized|admitted|warded|rushed to (?:the )?hospital|kept in hospital|receiving treatment|being treated(?: for)?|down with|in (?:the )?icu|on a ventilator|in a coma|poisoned)\b/iu)?.[1]
    ?? text.match(/\b(?:what (?:can|could|does|did)|can|could)\s+([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,4})\s+(?:claim|have|own)\b/iu)?.[1];
  if (!subject) return null;
  // Fillers and corrections are not part of a name ("actually she was
  // admitted", "sorry, it was her right arm", "oh and he").
  const name = subject.replace(/^(?:(?:actually|sorry|oh|and|but|so|also|um+|uh+|well|ok(?:ay)?|btw|anyway|then)\s+)+/i, "").replace(/^(?:today|yesterday)\s+/i, "").replace(/\s+(?:has|was|is|had|been|just|recently)(?:\s+(?:been|just|recently))*$/i, "");
  if (/^(i|i am|i['’]m|we|he|she|they|someone|a person|my (?:mother|father|mum|mom|dad|sister|brother|wife|husband|son|daughter|parent|child|spouse|sibling))$/i.test(name)) return null;
  if (/^(?:his|her|their)\s+\S+$/i.test(name) || /['’]s\s+(?:wife|husband|spouse|son|daughter|child|kid|mother|father|mum|mom|dad|parent|sister|brother)$/i.test(name)) return null;
  // The chat's own question, sent back with its answer ("On what date was it
  // diagnosed: Not sure"), names no one: a question is not a subject.
  if (/^(?:on |at |in |from |since )?(?:what|when|where|which|who|whom|how|why)\b/i.test(name) || /\b(?:it|this|that)$/i.test(name)) return null;
  return name;
}

/** Words that are never a person's name in a question like "Does X have ...". */
const NOT_A_NAME = /^(?:i|me|my|mine|you|your|we|us|our|he|him|his|she|her|they|them|their|it|its|this|that|these|those|there|anyone|someone|everyone|everybody|anybody|nobody|the|a|an|family|household|company|employer|insurer|agent|policy|policies|plan|plans|shield|rider|travel|hospital|group|child|kid|kids|baby|wife|husband|spouse|son|daughter|mother|father|mum|mom|dad|parent|parents|sibling|brother|sister|grandma|grandpa|grandmother|grandfather|ah|ma|gong|what|which|who|when|how|does|do|is|are|can|will|much|many|about|and|or|also|so|then|now|today|tomorrow|yesterday|pls|please|lah|leh|still|really|already|ever|not|no|yes|all|both|each|other|else|any|some|one|two)$/i;
/** Things a policy covers, never a person's name. */
const COVER_WORD = /^(?:icu|tcm|gp|ci|tpd|pa|surgery|surgical|dental|maternity|pregnancy|cancer|stroke|covid|dengue|outpatient|inpatient|physio(?:therapy)?|chemo(?:therapy)?|ambulance|x-?ray|mri|scan|treatment|ward|hospital(?:isation|ization)?|rider|fracture|dialysis|baggage|luggage|delay|cancellation|accident|death|disability|illness|medical|dentist|specialist|clinic|evacuation|vaccination|checkup|check-up|screening)$/i;
/** Relations a household on DearPolicy never holds (no stored relationship). */
const OUTSIDE_RELATION = /^(?:cousin|uncle|aunt|auntie|friend|colleague|boss|neighbou?r|nephew|niece|helper|maid|landlord|tenant|classmate|boyfriend|girlfriend)$/i;
/** The person a policy QUESTION is about ("What is Ah Beng covered for?",
 * "Does my brother Kumar have insurance?", "my neighbour's life cover"), so a
 * name that is not in the household is recognised instead of silently
 * answering about whoever is selected. */
export function questionSubjectName(text: string): string | null {
  const t = text.replace(/[?!.,]+/g, " ").replace(/\s+/g, " ");
  const rel = "(?:my\\s+(?:brother|sister|cousin|uncle|aunt|auntie|friend|colleague|boss|neighbou?r|nephew|niece|helper|maid|landlord|classmate|boyfriend|girlfriend)\\s*)";
  const m = t.match(new RegExp("\\b(?:is|are|does|do|did|has|have|for|about)\\s+(" + rel + "?[\\p{L}][\\p{L}'’-]*(?:\\s+[\\p{L}][\\p{L}'’-]*){0,3}?)\\s+(?:covered|insured|have|has|got|own|owns)\\b", "iu"))
    ?? t.match(new RegExp("\\b((?:my\\s+)?[\\p{L}][\\p{L}'’-]*(?:\\s+[\\p{L}][\\p{L}'’-]*){0,2})['’]s\\s+(?:polic(?:y|ies)|plans?|insurance|cover(?:age)?|life|hospital|shield|premiums?|deductible|travel|riders?|car|motor|company|accident|critical)\\b", "iu"))
    ?? t.match(new RegExp("\\b(my\\s+(?:cousin|uncle|aunt|auntie|friend|colleague|boss|neighbou?r|nephew|niece|helper|maid|landlord|classmate|boyfriend|girlfriend))\\b", "iu"));
  if (!m) return null;
  let name = m[1].trim().replace(/^(?:(?:is|are|does|do|did|has|have|for|about|what|how|much|and|tell|me|show|the|then)\s+)+/i, "");
  const relation = name.match(/^my\s+(\p{L}+)(?:\s+(.+))?$/iu);
  if (relation) {
    if (relation[2]) name = relation[2];
    else return OUTSIDE_RELATION.test(relation[1]) ? "your " + relation[1].toLowerCase() : null;
  }
  const words = name.split(/\s+/).filter(Boolean);
  if (!words.length || words.every((w) => NOT_A_NAME.test(w))) return null;
  // What a policy covers is not a person ("Is ICU covered", "Is TCM covered for him").
  if (words.some((w) => /^[A-Z]{2,5}$/.test(w) || COVER_WORD.test(w))) return null;
  // Product names (\"ShieldCare\", \"TermSecure 20\") and codes are not people.
  if (words.some((w) => /^[A-Z][a-z]+[A-Z]/.test(w) || /\d/.test(w))) return null;
  return name;
}

const RELATIVE = /\b(?:(his|her|their)|([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,3})['’]s)\s+(wife|husband|spouse|partner|son|daughter|child|children|kids?|mother|father|mum|mom|mummy|mommy|dad|daddy|papa|mama|parents?|sister|brother|sibling)\b/iu;
type RelationGroup = "spouse" | "child" | "parent" | "sibling";
function relationGroup(word: string): RelationGroup {
  return /wife|husband|spouse|partner/i.test(word) ? "spouse" : /son|daughter|child|kid/i.test(word) ? "child"
    : /sister|brother|sibling/i.test(word) ? "sibling" : "parent";
}
/** Family relationships are stored relative to the account holder ("self");
 * "his wife" / "Xin Yi's mum" is relative to another person. */
function relativesOf(anchor: ClaimPerson, group: RelationGroup, family: ClaimPerson[]): ClaimPerson[] {
  const rel = (p: ClaimPerson) => normalized(p.relationship);
  const of = (...rels: string[]) => family.filter((p) => p.id !== anchor.id && rels.includes(rel(p)));
  switch (rel(anchor)) {
    case "self": return group === "spouse" ? of("spouse") : group === "child" ? of("child") : group === "parent" ? of("parent") : of("sibling");
    case "spouse": return group === "spouse" ? of("self") : group === "child" ? of("child") : [];
    case "child": return group === "parent" ? of("self", "spouse") : group === "sibling" ? of("child") : [];
    case "parent": return group === "child" ? of("self", "sibling") : group === "spouse" ? of("parent") : [];
    case "sibling": return group === "sibling" ? of("self", "sibling") : group === "parent" ? of("parent") : [];
    default: return [];
  }
}
/** "and his wife?" after a question about Wei Jie, or "Xin Yi's mum": the
 * person is found through the named (or previous) person's relationship. */
export function resolveRelativePerson(text: string, family: ClaimPerson[], anchorId: string): ClaimPersonResolution | null {
  const m = text.match(RELATIVE);
  if (!m) return null;
  let anchor: ClaimPerson | undefined;
  if (m[1]) anchor = family.find((p) => p.id === anchorId);
  else {
    const named = normalized(m[2]);
    const words = named.split(" ");
    for (let i = 0; i < words.length && !anchor; i++) {
      const tail = words.slice(i).join(" ");
      anchor = family.find((p) => includesName(normalized(p.display_name), tail) || normalized(p.preferred_name ?? "") === tail);
    }
  }
  if (!anchor) return null;
  const candidates = relativesOf(anchor, relationGroup(m[3]), family);
  if (candidates.length === 1) return { status: "resolved", person: candidates[0], explicit: true };
  if (candidates.length > 1) return { status: "ambiguous", candidates };
  return { status: "unknown", name: (anchor.preferred_name || anchor.display_name) + "’s " + m[3].toLowerCase(), candidates: family };
}

/** Explicit names take precedence over the UI selection; ambiguity never loads policies. */
export function resolveClaimPerson(text: string, family: ClaimPerson[], selectedId: string): ClaimPersonResolution {
  const relative = resolveRelativePerson(text, family, selectedId);
  if (relative) return relative;
  const subject = subjectName(text) ?? questionSubjectName(text);
  const message = normalized(subject ?? text);
  const subjectNormalized = subject ? normalized(subject) : "";
  // A known name elsewhere in the sentence cannot make an unknown subject
  // safe. A close typo of a real family member's name is not "unknown"
  // though — "Charmine" for "Charmaine" is not a stranger, it's a typo.
  if (subject && !family.some(p => includesName(subjectNormalized, normalized(p.display_name)) ||
    includesName(normalized(p.display_name), subjectNormalized) ||
    includesName(subjectNormalized, normalized(p.preferred_name ?? "")) ||
    [normalized(p.display_name), normalized(p.preferred_name ?? ""), ...normalized(p.display_name).split(" ")]
      .filter(Boolean).some(name => fuzzyIncludesName(subjectNormalized, name)))) {
    return { status: "unknown", name: subject, candidates: family };
  }
  const matches = family.flatMap(person => {
    const full = normalized(person.display_name);
    const preferred = normalized(person.preferred_name ?? "");
    if (includesName(message, full)) return [{ person, rank: 3, length: full.length }];
    if (includesName(message, preferred)) return [{ person, rank: 2, length: preferred.length }];
    const partials = full.split(" ").filter(word => word.length >= 3 && includesName(message, word));
    if (partials.length) return [{ person, rank: 1, length: Math.max(...partials.map(word => word.length)) }];
    // A typo of a real name (misspelled by one or two letters) still counts,
    // just ranked below an exact match so a genuine exact match always wins.
    const fuzzyNames = [full, preferred, ...full.split(" ")].filter(name => name.length >= 4);
    const fuzzy = fuzzyNames.some(name => fuzzyIncludesName(message, name));
    return fuzzy ? [{ person, rank: 0.5, length: full.length }] : [];
  });
  if (matches.length) {
    const rank = Math.max(...matches.map(m => m.rank));
    let strongest = matches.filter(m => m.rank === rank);
    // "it was Xin Yi, not Mei Ling": the person named after "not" is the one it is NOT about.
    if (strongest.length === 2) {
      const negated = strongest.filter(m => [m.person.display_name, m.person.preferred_name ?? ""].filter(Boolean)
        .some(name => new RegExp("\\bnot\\s+(?:about\\s+|for\\s+)?" + normalized(name).replace(/\s+/g, "\\s+") + "\\b").test(message)));
      if (negated.length === 1) strongest = strongest.filter(m => m !== negated[0]);
    }
    // Ignore a surname-only overlap when the complete subject identifies one person.
    if (strongest.length === 1) return { status: "resolved", person: strongest[0].person, explicit: true };
    return { status: "ambiguous", candidates: strongest.map(m => m.person) };
  }
  // "grandma" / "ah ma" (not "my grandmother") in a household with children is
  // the children's grandparent: the account holder's parent.
  if (!/\bmy (?:grand|ah )/.test(message) && /\b(?:grandma|grandmother|grandpa|grandfather|ah ma|ah mah|ama|popo|nai nai|ah gong|ye ye)\b/.test(message) && family.some((p) => normalized(p.relationship) === "child")) {
    const parents = family.filter((p) => normalized(p.relationship) === "parent");
    if (parents.length === 1) return { status: "resolved", person: parents[0], explicit: true };
    if (parents.length > 1) return { status: "ambiguous", candidates: parents };
  }
  const relation = message.match(/\bmy (mother|father|mum|mom|dad|parent|sister|brother|sibling|wife|husband|spouse|son|daughter|child|grandmother|grandfather|grandparent)\b/)?.[1];
  if (relation) {
    const group = /mother|father|mum|mom|dad|^parent$/.test(relation) && !relation.startsWith("grand") ? "parent"
      : /sister|brother|sibling/.test(relation) ? "sibling"
      : /wife|husband|spouse/.test(relation) ? "spouse"
      : /son|daughter|child/.test(relation) ? "child" : "grandparent";
    const candidates = family.filter(p => normalized(p.relationship) === group);
    if (candidates.length === 1) return { status: "resolved", person: candidates[0], explicit: true };
    return candidates.length ? { status: "ambiguous", candidates } : { status: "unknown", name: `your ${relation}`, candidates: family };
  }
  // First-person statements identify the account holder even when no UI
  // profile was selected. If an imported household has no unique "self"
  // record, ask rather than borrowing another person's cover.
  const firstPersonSubject=/\bi\s+(?:(?:was|am|have been|had been)\s+(?:diagnosed|hospitalised|hospitalized|admitted|injured|hurt|discharged)|(?:caught|contracted|tested positive for|came down with|suffer from|suffered from|broke|fractured|died|own|have)\b)|\b(?:what|how much|can|could|do)\s+i\s+(?:claim|have|own)\b|\bmy\s+(?:policy|policies|plan|plans|cover|coverage|flight|trip|car|vehicle|home|house|diagnosis|hospital stay|medical bill)\b|\bfor\s+me\b|\bmyself\b/i.test(text);
  if (firstPersonSubject) {
    const candidates = family.filter(p => normalized(p.relationship) === "self");
    if (candidates.length === 1) return { status: "resolved", person: candidates[0], explicit: true };
    if (candidates.length > 1) return { status: "ambiguous", candidates };
  }
  const selected = family.find(p => p.id === selectedId);
  return selected ? { status: "resolved", person: selected, explicit: false } : { status: "unknown", name: "this person", candidates: family };
}
