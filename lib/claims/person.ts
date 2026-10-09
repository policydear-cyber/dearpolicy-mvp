export type ClaimPerson = { id: string; display_name: string; preferred_name: string | null; relationship: string };
export type ClaimPersonResolution =
  | { status: "resolved"; person: ClaimPerson; explicit: boolean }
  | { status: "ambiguous"; candidates: ClaimPerson[] }
  | { status: "unknown"; name: string; candidates: ClaimPerson[]; /** Round 9: on file under the relation, but not known to be the one named ("my dad", a "parent"). */ unsure?: ClaimPerson[] };

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
  // ", not admitted", ", never warded": a negation, not a person.
  if (/^(?:not|never|no|nobody|none|wasn['’]?t|isn['’]?t|but not)$/i.test(name)) return null;
  // Round 9: "outpatient got cover?", "surgery got cover?": a kind of cover, not a person.
  if (name.split(/\s+/).every((w) => COVER_WORD.test(w) || NOT_A_NAME.test(w))) return null;
  if (/^(?:his|her|their)\s+\S+$/i.test(name) || /['’]s\s+(?:wife|husband|spouse|son|daughter|child|kid|mother|father|mum|mom|dad|parent|sister|brother)$/i.test(name)) return null;
  // The chat's own question, sent back with its answer ("On what date was it
  // diagnosed: Not sure"), names no one: a question is not a subject.
  if (/^(?:on |at |in |from |since )?(?:what|when|where|which|who|whom|how|why)\b/i.test(name) || /\b(?:it|this|that)$/i.test(name)) return null;
  return name;
}

/** Words that are never a person's name in a question like "Does X have ...". */
const NOT_A_NAME = /^(?:i|me|my|mine|you|your|we|us|our|he|him|his|she|her|they|them|their|it|its|this|that|these|those|there|anyone|someone|everyone|everybody|anybody|nobody|the|a|an|family|household|company|employer|insurer|agent|policy|policies|plan|plans|shield|rider|travel|hospital|group|child|kid|kids|baby|wife|husband|spouse|son|daughter|mother|father|mum|mom|dad|parent|parents|sibling|brother|sister|grandma|grandpa|grandmother|grandfather|ah|ma|gong|what|which|who|when|how|does|do|is|are|can|will|much|many|about|and|or|also|so|then|now|today|tomorrow|yesterday|pls|please|lah|leh|still|really|already|ever|not|no|yes|all|both|each|other|else|any|some|one|two)$/i;
/** Things a policy covers, never a person's name. */
const COVER_WORD = /^(?:icu|tcm|gp|ci|tpd|pa|surgery|surgical|dental|maternity|pregnancy|cancer|stroke|covid|dengue|outpatient|inpatient|physio(?:therapy)?|chemo(?:therapy)?|ambulance|x-?ray|mri|scan|treatment|ward|hospital(?:isation|ization)?|rider|fracture|dialysis|baggage|luggage|delay|cancellation|accident|death|disability|illness|medical|dentist|specialist|clinic|evacuation|vaccination|checkup|check-up|screening|heart|attack|conditions?|pre-?existing|angioplasty|bypass|kidney|knee|hip|cataract|arthritis|osteoarthritis|diabetes|asthma|injury|injuries|fall|falls|loan|bonus|premiums?|bills?|fees?|expenses?|charges?|costs?|claims?|pre-?hospital\w*|post-?hospital\w*|room|board|consultations?|visits?|medicines?|drugs?|tests?|procedures?|operations?|spectacles|glasses|lenses|vaccines?|jabs?|therapy|injections?|implants?|belongings|valuables|jewellery|jewelry|contents|renovations?|windscreen|damage|theft|laptop|phone|bags?|trips?|flights?|overseas|abroad|emergenc(?:y|ies)|items?|scans?|deductible|co-?insurance|co-?payment|excess|limit|payouts?)$/i;
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
 * "his wife" / "Kai Ting's mum" is relative to another person. */
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
/** "and his wife?" after a question about Wei Jie, or "Kai Ting's mum": the
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

/** Round 7: everyday words that are never part of a person's name. The
 * subject finders above read the words before "'s policy" or "was admitted";
 * in "What's my dad's hospital plan", "cash portion for dad's insurance" or
 * "Airline went bust and my trip got cancelled" those words are not a name,
 * and calling them a stranger ("I can't find anyone called 'portion for
 * dad'") was the commonest wrong answer an independent battery found. */
const COMMON_WORD = /^(?:what|whats|what's|who|whose|when|where|why|how|which|is|are|was|were|be|been|being|am|do|does|did|done|has|have|had|having|can|could|will|would|shall|should|may|might|must|got|get|gets|go|goes|going|went|gone|come|came|need|needs|want|wants|use|used|pay|paid|claim|claims|make|made|take|took|see|say|said|tell|know|feel|feeling|keep|still|just|also|very|too|so|only|if|then|than|that|this|these|those|there|here|it|it's|its|of|for|from|to|in|on|at|by|with|without|about|after|before|during|since|until|till|into|onto|over|under|between|and|or|but|nor|not|no|yes|a|an|the|some|any|all|both|each|every|few|many|much|more|most|less|other|another|same|such|own|my|mine|me|i|i'm|i've|i'd|i'll|we|us|our|you|your|he|she|they|them|their|his|her|him|she'll|he'll|they'll|she's|he's|we're|one|two|three|first|last|next|new|old|now|today|yesterday|tomorrow|week|weeks|month|months|year|years|day|days|night|nights|hour|hours|time|times|money|cash|portion|part|amount|total|cost|bill|bills|fee|fees|price|house|home|flat|car|trip|flight|flights|airline|hotel|luggage|baggage|bag|job|work|company|boss|office|school|bust|cancelled|canceled|delayed|lost|stolen|flooded|broken|condition|conditions|heart|knee|hip|arm|leg|back|teeth|tooth|eye|head|replacement|income|while|warded|admitted|hospital|hospitalised|hospitalized|policy|policies|plan|plans|insurance|insurans|cover|coverage|covered|premium|premiums|benefit|benefits|rider|riders|schedule|document|documents|endowment|whole|life|term|shield|careshield|medishield|medisave|deductible|braces|crowns|suicide|maturity|payout|ilp|gtl|gpa|ghs|tpd|ci|pa|nominee|lapse|lapsed|reinstated|ok|okay|sorry|actually|please|pls|lah|leh|lor|ah|meh|hor|anot|wah|eh)$/i;
/** The words of a subject candidate as written, with any leading or trailing
 * filler dropped; null when what is left cannot be a person's name. */
function plausibleName(candidate: string | null, original: string, family: ClaimPerson[]): string | null {
  if (!candidate) return null;
  const words = candidate.trim().split(/\s+/).filter(Boolean);
  while (words.length && COMMON_WORD.test(words[0]) && !/^(?:ah|siti|nur|mohd|muhammad)$/i.test(words[0])) words.shift();
  while (words.length && COMMON_WORD.test(words[words.length - 1])) words.pop();
  if (!words.length || words.length > 4) return null;
  const name = words.join(" ");
  const n = normalized(name);
  // A family member's name, or a close typo of one, is always a name.
  if (family.some((p) => [p.display_name, p.preferred_name ?? ""].some((x) => x && (includesName(normalized(x), n) || includesName(n, normalized(x)) || fuzzyIncludesName(n, normalized(x)))))) return name;
  if (words.some((w) => COMMON_WORD.test(w) && !/^ah$/i.test(w))) return null;
  // Round 15: "my flight from Tokyo got delayed", "warded in Gleneagles": a place after a preposition, not a person.
  if (new RegExp("\\b(?:from|to|in|at|via|near|around|inside|outside|into|towards?)\\s+" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(original)) return null;
  // "dad", "papa", "my wife" name a relationship, resolved further on.
  if (words.every((w) => /^(?:my|our|the)$/i.test(w) || RELATION_WORD.test(w.replace(/['’]s$/i, "")))) return null;
  // Someone who writes in sentence case capitalises a name ("Siti Hajar",
  // "Ah Beng"); all-lowercase words in such a message are not one.
  const usesCase = /[A-Z]/.test(original.replace(/^\s*\S/, "").replace(/\bI\b/g, ""));
  if (usesCase && words.every((w) => /^[a-z]/.test(w))) return null;
  return name;
}
/** Relationship words, with or without "my" ("dad's plan", "Papa admitted",
 * "my hubby"), relative to the account holder. */
const RELATION_WORD = /(?:^|[^\p{L}'’])(?:(?:my|our|the)\s+)?(dad|daddy|papa|father|mum|mom|mummy|mommy|mama|mother|wife|husband|hubby|spouse|missus|son|daughter|kids|children|brother|sister)(?:['’]s)?(?![\p{L}-])/iu;
function relationGroupOf(word: string): "parent" | "spouse" | "child" | "sibling" {
  return /dad|papa|father|mum|mom|mama|mother/i.test(word) ? "parent" : /wife|husband|hubby|spouse|missus/i.test(word) ? "spouse" : /son|daughter|kids|children/i.test(word) ? "child" : "sibling";
}
/** Is the question about that relative's OWN cover ("my sister's policies",
 * "is my mum covered", "a policy covering my sister")? Otherwise a relative
 * outside the household is the cause of a claim, not its subject ("my trip
 * was cancelled because my mum was hospitalised"). */
function aboutRelativesCover(text: string, word: string) {
  const w = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("\\b" + w + "['’]s\\s+(?:\\w+\\s+){0,2}(?:polic(?:y|ies)|plans?|insurance|cover(?:age)?|premiums?|benefits?)\\b|\\b(?:is|are|was)\\s+my\\s+" + w + "\\s+(?:covered|insured)\\b|\\bcover(?:s|ing)?\\s+(?:for\\s+)?my\\s+" + w + "\\b|\\bmy\\s+" + w + "\\s+(?:covered|insured)\\b", "i").test(text);
}
const FIRST_PERSON = /\b(?:i|i['’]m|im|i['’]ve|i['’]d|i['’]ll|me|my|mine|myself)\b/i;

/** Explicit names take precedence over the UI selection; ambiguity never loads policies. */
export function resolveClaimPerson(text: string, family: ClaimPerson[], selectedId: string): ClaimPersonResolution {
  // Round 15: "Mrs Ong" when Ong is the account holder's family name and not the spouse's own: the spouse, by marriage.
  const mrs = text.match(/\bmrs\.?\s+(\p{L}{2,})\b/iu)?.[1]?.toLowerCase();
  if (mrs) {
    const holder = family.filter((p) => /^self$/i.test(p.relationship ?? ""));
    const spouses = family.filter((p) => /^(?:spouse|wife|husband)$/i.test(p.relationship ?? ""));
    const has = (p: ClaimPerson) => normalized(p.display_name).split(" ").includes(mrs);
    if (holder.length === 1 && has(holder[0]) && spouses.length === 1 && !has(spouses[0])) return { status: "resolved", person: spouses[0], explicit: true };
  }
  const relative = resolveRelativePerson(text, family, selectedId);
  if (relative) return relative;
  const subject = plausibleName(subjectName(text), text, family) ?? plausibleName(questionSubjectName(text), text, family);
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
    // "it was Kai Ting, not Mei Ling": the person named after "not" is the one it is NOT about.
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
  // "Mrs Ong" in the Ongs' household is the account holder's spouse.
  const self = family.filter((p) => normalized(p.relationship) === "self");
  const title = text.match(/\b(?:mrs|madam|mdm)\.?\s+([\p{L}]+)/iu)?.[1];
  if (title && self.length === 1 && normalized(self[0].display_name).split(" ").includes(normalized(title))) {
    const spouses = family.filter((p) => normalized(p.relationship) === "spouse");
    if (spouses.length === 1) return { status: "resolved", person: spouses[0], explicit: true };
  }
  // "Dad's plan", "papa admitted", "my hubby": relative to the account holder.
  const bare = text.match(RELATION_WORD)?.[1];
  // ("me as his wife", "her husband's plan": a relation of someone else, not of the account holder.)
  if (bare && !/\bmy (?:grand|ah )/i.test(text) && !new RegExp("\\b(?:his|her|their|[\\p{L}]+['’]s)\\s+" + bare + "\\b", "iu").test(text)) {
    const group = relationGroupOf(bare);
    const candidates = family.filter(p => normalized(p.relationship) === group);
    if (candidates.length === 1) return { status: "resolved", person: candidates[0], explicit: true };
    if (candidates.length > 1 && !/^(?:kids|children)$/i.test(bare)) return { status: "ambiguous", candidates };
    if (!candidates.length && aboutRelativesCover(text, bare)) return { status: "unknown", name: `your ${bare.toLowerCase()}`, candidates: family };
  }
  const relation = message.match(/\bmy (mother|father|mum|mom|dad|parent|sister|brother|sibling|wife|husband|spouse|son|daughter|child|grandmother|grandfather|grandparent)\b/)?.[1];
  if (relation) {
    const group = /mother|father|mum|mom|dad|^parent$/.test(relation) && !relation.startsWith("grand") ? "parent"
      : /sister|brother|sibling/.test(relation) ? "sibling"
      : /wife|husband|spouse/.test(relation) ? "spouse"
      : /son|daughter|child/.test(relation) ? "child" : "grandparent";
    const candidates = family.filter(p => normalized(p.relationship) === group);
    if (candidates.length === 1) return { status: "resolved", person: candidates[0], explicit: true };
    if (candidates.length) return { status: "ambiguous", candidates };
    // A relative outside the household is the subject only when the question
    // is about their own cover; otherwise they are the reason for the
    // household member's own claim (a trip cancelled for a parent's illness).
    if (aboutRelativesCover(text, relation) || !FIRST_PERSON.test(text.replace(new RegExp("\\bmy\\s+" + relation + "\\b", "gi"), ""))) return { status: "unknown", name: `your ${relation}`, candidates: family };
  }
  // First-person statements identify the account holder even when no UI
  // profile was selected. If an imported household has no unique "self"
  // record, ask rather than borrowing another person's cover.
  const firstPersonSubject=/\bi\s+(?:(?:was|am|have been|had been)\s+(?:diagnosed|hospitalised|hospitalized|admitted|injured|hurt|discharged)|(?:caught|contracted|tested positive for|came down with|suffer from|suffered from|broke|fractured|died|own|have)\b)|\b(?:what|how much|can|could|do)\s+i\s+(?:claim|have|own)\b|\bmy\s+(?:policy|policies|plan|plans|cover|coverage|flight|trip|car|vehicle|home|house|diagnosis|hospital stay|medical bill)\b|\bfor\s+me\b|\bmyself\b/i.test(text);
  // Round 11: any other first-person words ("my luggage was lost", "if I injure another driver", "ambulance fee for me")
    // are the speaker too -- a relative or a name was already looked for above.
  const speakerOnly = !firstPersonSubject && !family.some((p) => p.id === selectedId) && /\b(?:i|me|my|myself|mine)\b/i.test(text.replace(/\bi\.e\.?/gi, " ")
      // "i dont know", "I think so": an answer, not who it is about.
      .replace(/\bi\s*(?:do\s*n['’]?t|dont|really don['’]?t|am not|['’]?m not|have no idea|can['’]?t|cannot|think|guess|believe|suppose|reckon|forgot|forget|remember|recall|mean|dunno)\b/gi, " ")
      // "the photo I uploaded", "the notes I typed": the one who uploaded, not who it is about.
      .replace(/\b(?:that |which )?i (?:have |had |just )?(?:uploaded|upload|sent|added|scanned|took|attached|typed|saved|gave|put)\b/gi, " "));
  if (firstPersonSubject || speakerOnly) {
    const candidates = family.filter(p => normalized(p.relationship) === "self");
    // Only the speaker's words, not a statement about them: a plan named in the question can still say whose it is ("is my HerCare still ok").
    if (candidates.length === 1) return { status: "resolved", person: candidates[0], explicit: !speakerOnly };
    if (candidates.length > 1) return { status: "ambiguous", candidates };
  }
  const selected = family.find(p => p.id === selectedId);
  if (selected) return { status: "resolved", person: selected, explicit: false };
  // A household of one: there is nobody else it can be about.
  if (family.length === 1) return { status: "resolved", person: family[0], explicit: false };
  return { status: "unknown", name: "this person", candidates: family };
}

/** Someone the household names who is not in it ("my colleague Ravi", "my
 * uncle Ah Huat"): their own policies are not on DearPolicy, so no family
 * member is offered in their place. Null when a household member is the
 * subject instead. */
export function outsideHouseholdSubject(text: string, family: ClaimPerson[]): { relation: string; name: string | null } | null {
  // Round 11: "Wei Jie's grandmother passed away": a relative of a household member who is not in the household herself
  // (a child's grandparent is the household's own parent, and stays theirs).
  const kin = text.match(/\b([\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){0,2})['’]s\s+(grandmother|grandfather|grandma|grandpa|grandparents?|aunt|auntie|uncle|cousin|colleague|friend|boss|neighbou?r|godmother|godfather)\b/iu);
  if (kin) {
    const named = normalized(kin[1]);
    const anchor = family.find((p) => [p.display_name, p.preferred_name ?? ""].filter(Boolean).some((n) => normalized(n) === named || named.endsWith(" " + normalized(n))));
    if (anchor && !(normalized(anchor.relationship) === "child" && /^grand/i.test(kin[2])))
      return { relation: kin[2].toLowerCase(), name: (anchor.preferred_name || anchor.display_name) + "’s " + kin[2].toLowerCase() };
  }
  const m = text.match(/\bmy\s+(colleague|co-?worker|uncle|aunt|auntie|friend|best friend|neighbou?r|cousin|boss|nephew|niece|helper|maid|domestic helper|classmate|boyfriend|girlfriend|(?:father|mother|brother|sister)-in-law|grand(?:uncle|aunt))\b(?:\s+((?:ah\s+)?[A-Z][\p{L}'’-]*(?:\s+[A-Z][\p{L}'’-]*)?))?/iu);
  if (!m) return null;
  // Round 9: "my helper" when the household's own helper is on file is that person, not someone outside it.
  const relation = m[1].toLowerCase();
  const rel = (p: ClaimPerson) => (p.relationship ?? "").toLowerCase();
  if (/helper|maid/.test(relation) ? family.some((p) => /helper|maid|domestic/.test(rel(p))) : family.some((p) => rel(p) === relation)) return null;
  const before = text.slice(0, m.index ?? 0);
  // "Wei Jie's colleague" is still not in the household, but "Kai Ting and my friend" names Kai Ting.
  const named = family.some((p) => [p.display_name, p.preferred_name].filter(Boolean).some((n) => new RegExp("\\b" + normalized(n!).replace(/\s+/g, "\\s+") + "\\b(?!['’]s)").test(normalized(before))));
  if (named) return null;
  // Round 9: a name is written with a capital ("my colleague just got cancer" names nobody).
  const name = m[2] && /^(?:ah\s+)?\p{Lu}/u.test(m[2]) && !/^(?:was|is|has|had|died|passed|fell|got|broke|just|also|who|said|says|told|already|recently)$/i.test(m[2].split(/\s+/)[0]) ? m[2].replace(/\s+(?:was|is|has|had|died|passed|fell|got|broke)\b.*$/i, "").trim() : null;
  return { relation: m[1].toLowerCase(), name };
}


// ---------------------------------------------------------------------------------------------------------------
// Agent G: a member's recorded relation (relationship plus notes), shared with the conversational path's people module.
// ---------------------------------------------------------------------------------------------------------------
export type MemberRelation = "self" | "spouse" | "child" | "step_child" | "child_in_law" | "parent" | "step_parent" | "parent_in_law" | "sibling" | "sibling_in_law" | "grandparent" | "grandchild" | "helper" | "dependant" | "other";
export type MemberGender = "f" | "m" | null;
const FEMALE_WORD = /\b(?:mother|mum|mom|wife|daughter|sister|grandmother|grandma|aunt|niece|female|girl|woman)\b/i;
const MALE_WORD = /\b(?:father|dad|husband|son|brother|grandfather|grandpa|uncle|nephew|male|boy|man)\b/i;
/** The fine relation of a stored member: relationship plus what their notes say ("mother-in-law", "stepson", "helper"). */
export function memberRelation(relationship: string | null | undefined, notesIn: string | null | undefined): { relation: MemberRelation; gender: MemberGender } {
  const rel = (relationship ?? "").toLowerCase().trim(), notes = (notesIn ?? "").toLowerCase();
  const both = rel + " " + notes;
  // Gender from the relation words, reading "stepson" / "step-daughter" as son / daughter.
  const plain = both.replace(/\bstep[- ]?/g, "");
  const g: MemberGender = FEMALE_WORD.test(plain) && !MALE_WORD.test(plain) ? "f" : MALE_WORD.test(plain) && !FEMALE_WORD.test(plain) ? "m" : null;
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
  const map: Record<string, MemberRelation> = { self: "self", spouse: "spouse", wife: "spouse", husband: "spouse", partner: "spouse", child: "child", son: "child", daughter: "child", parent: "parent", mother: "parent", father: "parent", sibling: "sibling", brother: "sibling", sister: "sibling", grandparent: "grandparent", dependant: "dependant", dependent: "dependant" };
  return { relation: map[rel] ?? "other", gender: g };
}
const MEMBER_RELATION_NOUN: Record<MemberRelation, string> = { self: "you", spouse: "spouse", child: "child", step_child: "stepchild", child_in_law: "child-in-law", parent: "parent", step_parent: "step-parent", parent_in_law: "parent-in-law", sibling: "sibling", sibling_in_law: "sibling-in-law", grandparent: "grandparent", grandchild: "grandchild", helper: "helper", dependant: "dependant", other: "household member" };

// ---------------------------------------------------------------------------------------------------------------
// Agent G: applicability classes -- who a table column is printed for, and which class a person is in.
// ---------------------------------------------------------------------------------------------------------------

/** The class a person is in for an Adult / Child column: established from the policy's own insured-persons category
 * when one is recorded, else the date of birth, else the relationship -- and "unknown" when none of them establishes
 * it (a sibling or "other" member with no date of birth, a son aged 18 to 25 whose policy may still count him as a
 * child). Unknown never passes against a class-specific column. */
export type ApplicabilityClass = "adult" | "child" | "unknown";
export type PersonApplicability = { cls: ApplicabilityClass; relation: MemberRelation; age: number | null; basis: "category" | "date_of_birth" | "relationship" | "none"; detail: string };
/** Who a column's values are printed for. "none": the column names no class of person (one value for everyone, a plan,
 * tier, ward or version); "ambiguous": it names more than one class; "unrecognised": it names people in words that
 * map to no known class ("Insured persons", "Junior", "Family"). */
export type ColumnClass = "adult" | "child" | "spouse" | "owner" | "parent" | "dependant";
export type ColumnApplicability = { kind: "none" } | { kind: "class"; cls: ColumnClass } | { kind: "ambiguous"; classes: ColumnClass[] } | { kind: "unrecognised"; words: string };

const COL_CLASS: [ColumnClass, RegExp][] = [
  ["child", /\b(?:child(?:ren)?|kids?|juveniles?|minors?|infants?|sons?|daughters?)\b/i],
  ["adult", /\badults?\b|\bgrown-?ups?\b/i],
  ["spouse", /\b(?:spouses?|wife|wives|husbands?|partners?)\b/i],
  ["parent", /\b(?:parents?|fathers?|mothers?)\b/i],
  ["owner", /\b(?:policy ?holders?|policy ?owners?|life (?:assured|insured)|main insured|principal(?: insured)?|employees?|staff|self|proposer|(?<!family )members?(?! of))\b/i],
  ["dependant", /\bdependa?n[ct]s?\b/i],
];
/** Words that name people without naming a class this code knows. ("Sum insured" / "amount insured" are amounts.) */
const PERSONISH = /\b(?:insured|assured|covered|persons?|people|individuals?|famil(?:y|ies)|category|categories|relationship|juniors?|youths?|teen\w*|seniors?|elderly|students?|retirees?|beneficiar\w*|nominees?|helpers?|domestic|named)\b/i;
const AMOUNT_PHRASE = /\b(?:sum|amount|value)s? (?:insured|assured|covered)\b|\b(?:insured|assured|covered) (?:sum|amount|value)s?\b/gi;

const FAMILY_AGGREGATE = /\bfamily (?:maximum|max|limit|aggregate|total|plan|cover|sum insured)\b|\b(?:per|whole|entire) family\b/i;

export function columnApplicability(header: string | null | undefined): ColumnApplicability {
  const h = String(header ?? "").replace(AMOUNT_PHRASE, " ").replace(/\s+/g, " ").trim();
  if (!h) return { kind: "none" };
  // Integration (round 3): a whole-family aggregate or plan column ("Family maximum", "Family plan", "per family") is
  // one limit for the family, not a class of person -- like a tier, it names nobody (r6: the family maximum for trip
  // cancellation). "Family members" still names people without a known class.
  if (FAMILY_AGGREGATE.test(h) && !COL_CLASS.some(([, re]) => re.test(h.replace(new RegExp(FAMILY_AGGREGATE.source, "gi"), " ")))) return { kind: "none" };
  let classes = COL_CLASS.filter(([, re]) => re.test(h)).map(([c]) => c);
  if (/\bfamily members?\b/i.test(h)) classes = classes.filter((c) => c !== "owner");
  // A dependant child is a child; a dependant spouse is a spouse.
  if (classes.length > 1 && classes.includes("dependant")) classes = classes.filter((c) => c !== "dependant");
  const uniq = [...new Set(classes)];
  if (uniq.length === 1) return { kind: "class", cls: uniq[0] };
  if (uniq.length > 1) return { kind: "ambiguous", classes: uniq };
  const p = h.match(PERSONISH);
  return p ? { kind: "unrecognised", words: h } : { kind: "none" };
}

const CHILD_RELATIONS: MemberRelation[] = ["child", "step_child", "grandchild"];
const ADULT_RELATIONS: MemberRelation[] = ["self", "spouse", "parent", "parent_in_law", "step_parent", "grandparent", "sibling_in_law", "child_in_law", "helper"];
const ageAt = (dob: string, asOf: string) => { const [y, m, d] = dob.slice(0, 10).split("-").map(Number), [Y, M, D] = asOf.slice(0, 10).split("-").map(Number); return Y - y - (M < m || (M === m && D < d) ? 1 : 0); };

/** The person's class for Adult / Child columns (see ApplicabilityClass). `category` is a policy insured-persons
 * category recorded for them (a benefit tier, the category the document lists them under). */
export function personApplicability(m: { relationship: string | null; notes?: string | null; dateOfBirth?: string | null }, opts: { asOf?: string | null; category?: string | null } = {}): PersonApplicability {
  const { relation } = memberRelation(m.relationship, m.notes);
  const asOf = (opts.asOf ?? new Date().toISOString()).slice(0, 10);
  const age = m.dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(m.dateOfBirth) ? ageAt(m.dateOfBirth, asOf) : null;
  const cat = opts.category ? columnApplicability(opts.category) : null;
  if (cat?.kind === "class" && (cat.cls === "child" || cat.cls === "adult")) return { cls: cat.cls, relation, age, basis: "category", detail: `listed by the policy as ${opts.category}` };
  if (age != null) {
    if (age < 18) return { cls: "child", relation, age, basis: "date_of_birth", detail: `aged ${age}` };
    if (age >= 26 || !CHILD_RELATIONS.includes(relation)) return { cls: "adult", relation, age, basis: "date_of_birth", detail: `aged ${age}` };
    return { cls: "unknown", relation, age, basis: "none", detail: `aged ${age}: an adult by age, but the policy's own definition decides whether a ${MEMBER_RELATION_NOUN[relation]} of that age is still covered as a child` };
  }
  if (CHILD_RELATIONS.includes(relation)) return { cls: "child", relation, age, basis: "relationship", detail: `recorded as ${MEMBER_RELATION_NOUN[relation]}` };
  if (ADULT_RELATIONS.includes(relation)) return { cls: "adult", relation, age, basis: "relationship", detail: `recorded as ${relation === "self" ? "you" : MEMBER_RELATION_NOUN[relation]}` };
  return { cls: "unknown", relation, age, basis: "none", detail: "no date of birth or relationship on file says whether they are an adult or a child" };
}

/** Why a value printed in a column of class `col` cannot be used for this person (null when it can). `isOwner`: the
 * person is the document's policyholder / main insured (null when not known). */
export function columnFitProblem(col: ColumnApplicability, p: PersonApplicability, ctx: { isOwner: boolean | null; header?: string | null }): string | null {
  const where = ctx.header ? `the “${ctx.header}” column` : "the column";
  if (col.kind === "none") return null;
  if (col.kind === "ambiguous") return `${where} is printed for more than one class of person (${col.classes.join(" / ")}), so it does not say it applies to this person`;
  if (col.kind === "unrecognised") return `${where} does not say which class of person it applies to`;
  switch (col.cls) {
    case "adult": case "child":
      if (p.cls === "unknown") return `${where} is printed for ${col.cls === "adult" ? "adults" : "children"}, and whether this person is an adult or a child is not established (${p.detail})`;
      return p.cls === col.cls ? null : `${where} is printed for ${col.cls === "adult" ? "adults" : "children"}, not for this person (${p.detail})`;
    case "spouse":
      return p.relation === "spouse" && p.cls !== "child" ? null : `${where} is printed for a spouse, and this person is not recorded as the spouse`;
    case "owner":
      return ctx.isOwner === true ? null : `${where} is printed for the policyholder / main insured, and this person is not the document's policyholder`;
    case "parent":
      return ["parent", "parent_in_law", "step_parent"].includes(p.relation) ? null : `${where} is printed for parents, and this person is not recorded as a parent`;
    case "dependant":
      return ctx.isOwner === false && p.relation !== "other" ? null : `${where} is printed for dependants, and this person is not established as a dependant on this document`;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Table dimensions: what a value column is printed FOR. A column can carry more than one dimension at once
// ("Adult / After", "Gold – Revised"): the person or category it is for, the plan / tier / ward, the version of the
// schedule (before / after an endorsement or alteration), the benefit stage (early / advanced, first / subsequent),
// and words that name none of these. A figure is usable only when EVERY dimension its column carries is resolved for
// the person and the date it is stated for. A version column is never read as a person.
// ---------------------------------------------------------------------------------------------------------------

export type VersionSide = "before" | "after";
export type ColumnDimensions = {
  /** The person / category dimension (kind "none" when the column names no person). */
  person: ColumnApplicability;
  /** Plan, tier, ward class or option the column is printed for ("Plan B", "Gold", "Ward class A"). */
  plan: string | null;
  /** The schedule version (only meaningful when the table prints both sides -- see versionPairOf). */
  version: { side: VersionSide; words: string; effective: string | null } | null;
  /** The benefit stage / occurrence the column is printed for ("Early stage", "Subsequent claim"). */
  stage: string | null;
};

const MONTH_NO: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Every calendar date a text prints, as ISO dates ("01 Jul 2026", "1 July 2026", "2026-07-01", "July 1, 2026";
 * a month and year alone -- "June 2026" -- is its first day). */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  const t = String(text ?? "");
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200;
  const taken: [number, number][] = [];
  const push = (y: number, m: number, d: number, at: number, len: number) => { if (ok(y, m, d) && !taken.some(([a, b]) => at < b && at + len > a)) { out.push(`${y}-${pad(m)}-${pad(d)}`); taken.push([at, at + len]); } };
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(+m[1], +m[2], +m[3], m.index!, m[0].length);
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/g)) { const mo = MONTH_NO[m[2].toLowerCase()]; if (mo) push(+m[3], mo, +m[1], m.index!, m[0].length); }
  for (const m of t.matchAll(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) { const mo = MONTH_NO[m[1].toLowerCase()]; if (mo) push(+m[3], mo, +m[2], m.index!, m[0].length); }
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) push(+m[3], +m[2], +m[1], m.index!, m[0].length);
  for (const m of t.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/g)) { const w = m[1].toLowerCase(); const mo = MONTH_NO[w.slice(0, 3)]; if (mo && (w.length === 3 || /^(?:january|february|march|april|may|june|july|august|september|sept|october|november|december)$/.test(w))) push(+m[2], mo, 1, m.index!, m[0].length); }
  return out;
}

const VERSION_BEFORE = /^(?:before|previous(?:ly)?|prior|old|original|existing|current|from|was|pre[- ]?(?:endorsement|alteration|amendment|change))\b|\b(?:before|prior to) (?:the )?(?:endorsement|alteration|amendment|change)\b|\b(?:previous|old|original|existing|former) (?:limit|benefit|amount|value|schedule|terms?|cover)\b/i;
const VERSION_AFTER = /^(?:after|revised|new|amended|now|to|updated|changed|replacement|post[- ]?(?:endorsement|alteration|amendment|change))\b|\b(?:after|following) (?:the )?(?:endorsement|alteration|amendment|change)\b|\b(?:revised|amended|new|updated) (?:limit|benefit|amount|value|schedule|terms?|cover)\b|\b(?:with effect from|w\.?e\.?f\.?|effective (?:from|on)?)\b/i;
const STAGE = /\b(?:early|intermediate|advanced|late|severe|mild|moderate|critical)(?:[ -]stage)?\b|\bstage\s*(?:[0-9]+|[ivx]+)\b|\b(?:first|subsequent|second|third|initial|further|additional|repeat)\s+(?:claims?|diagnos[ie]s|occurrences?|events?|payouts?|admissions?|surger(?:y|ies)|treatments?|episodes?)\b|^(?:first|subsequent|initial|repeat)$/i;
const PLAN = /\bplan\s*[a-z0-9]{1,4}\b|\b(?:gold|silver|bronze|platinum|diamond|basic|standard|premier|deluxe|essential|enhanced|classic|prestige|elite)\b|\bward\b|\bclass [a-c]\d?\b|\bprivate hospital\b|\brestructured\b|\b(?:tier|option|grade|level|band)\s*[a-z0-9]/i;

/** Splits a combined header ("Adult – Before", "Adult / After", "Gold (Revised)") into its parts. */
const headerParts = (h: string) => h.split(/\s+[\/–—|-]\s+|\s*[()]\s*|\s*:\s+/).map((p) => p.trim()).filter(Boolean);

/** The dimensions of one column header (heading and leaf joined, e.g. "Insured Adult / Before"). */
export function columnDimensions(header: string | null | undefined): ColumnDimensions {
  const h = String(header ?? "").replace(/\s+/g, " ").trim();
  const parts = headerParts(h);
  let version: ColumnDimensions["version"] = null;
  const rest: string[] = [];
  for (const p of parts.length ? parts : [h]) {
    const after = VERSION_AFTER.test(p), before = VERSION_BEFORE.test(p);
    if (!version && (after || before) && !(after && before)) {
      // "Revised with effect from 01 Jul 2026": the column's own effective date.
      const d = datesIn(p);
      version = { side: after ? "after" : "before", words: p, effective: after && d.length === 1 ? d[0] : null };
      // The rest of the part (if any) still counts: "Revised Adult limit".
      const left = p.replace(after ? VERSION_AFTER : VERSION_BEFORE, " ").replace(/\b(?:with effect from|effective|from|on)\b|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|\d{4}-\d{2}-\d{2}/gi, " ").trim();
      if (left && /[a-z]{3}/i.test(left)) rest.push(left);
      continue;
    }
    rest.push(p);
  }
  const remainder = rest.join(" / ");
  const stage = rest.map((p) => p.match(STAGE)?.[0] ?? null).find(Boolean) ?? null;
  const plan = rest.map((p) => (PLAN.test(p) ? p : null)).find(Boolean) ?? null;
  return { person: columnApplicability(remainder), plan, version, stage };
}

/** Whether a table's headers print a before / after PAIR (a version dimension is real only then: a lone "Current" or
 * "New" heading is not a version). */
export function versionPairOf(headers: (string | null | undefined)[]): boolean {
  const sides = new Set(headers.map((h) => columnDimensions(h).version?.side).filter(Boolean));
  return sides.has("before") && sides.has("after");
}

/** Which version applies on `asOf` given the date the change takes effect (and, for the amended version, the date it
 * ends). Null with a reason when it cannot be told. */
export function versionInForce(asOf: string, effective: string | null, ends: string | null = null): { side: VersionSide; reason: string } | { side: null; reason: string } {
  if (!effective) return { side: null, reason: "the table prints a before and an after value, and the date the change takes effect is not printed or recorded" };
  if (asOf < effective) return { side: "before", reason: `the change takes effect on ${effective}, after ${asOf}` };
  if (ends && asOf > ends) return { side: null, reason: `the amended terms (effective ${effective}) ended on ${ends}, before ${asOf}` };
  return { side: "after", reason: `the change took effect on ${effective}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Row codes and row-level categories: a schedule's first column is often an item code ("A", "B", "1", "2a") with the
// benefit's name in the next column, and some tables print WHO a row is for in a cell of its own ("Category: Child
// (each)") rather than in the column headings. The code is never the benefit's name; the category cell is a person
// dimension of that row.
// ---------------------------------------------------------------------------------------------------------------
/** An item code printed in a table's first column ("A", "B2", "1", "2a", "(iii)", "4."). */
export function isRowCode(text: string | null | undefined): boolean {
  const t = String(text ?? "").trim();
  return /^\(?(?:[A-Z]{1,2}\d{0,2}|\d{1,3}[a-z]?|[ivx]{1,5})[.)]?$/.test(t);
}
/** A heading for an item-code column. */
export const CODE_HEADER = /^(?:no\.?|item(?:\s*no\.?)?|#|s\/?n|ref\.?|code|clause)$/i;
/** A heading for a column that says, per row, who the row is printed for. */
export const CATEGORY_HEADER = /^(?:category|insured(?: person)?|class(?: of insured)?|cover type|person(?: covered)?|relationship|member(?: type)?|applies to|for)$/i;
/** The benefit's own name in a table row's cells: the first cell that is neither an item code nor a figure. */
export function rowLabelOf(cells: string[]): string {
  const i = cells.findIndex((c) => !isRowCode(c) && !/^(?:S\$|SGD|US\$|\$)?\s?\d[\d,]*(?:\.\d+)?\b/.test(c.trim()));
  return i >= 0 ? cells[i] : cells[0] ?? "";
}

// ---------------------------------------------------------------------------------------------------------------
// Removed amendment documents. Deleting an uploaded endorsement does not mean the insurer reversed it: the policy's
// current terms are then unknown from the library. Decided from document METADATA only (role, policy number,
// lifecycle state, dates, the supersedes link) -- a removed document's text is never read -- plus, for an explicit
// reversal, the text of the policy's REMAINING (active) documents.
// ---------------------------------------------------------------------------------------------------------------
/** A document row's metadata (no text). */
export type DocMeta = { id: string; role: string | null; policyNumber: string | null; groupPolicyNumber?: string | null; active: boolean; superseded: boolean;
  supersededById?: string | null; removedOn?: string | null; effectiveDate?: string | null; documentDate?: string | null; createdAt?: string | null };
/** What a removed amendment means for the policy: (a) the current terms may differ; (d) a remaining document says the
 * change was reversed / cancelled. (b) an unrelated document and (c) one replaced by a newer valid amendment yield no
 * entry at all. */
export type AmendmentRemoval =
  | { kind: "amendment_removed"; documentId: string; documentRole: string; policyNumber: string | null; removal: "deleted" | "superseded"; removedOn: string | null; effectiveDate: string | null; note: string }
  | { kind: "amendment_reversed"; documentId: string; documentRole: string; policyNumber: string | null; reversedBy: string; reversalText: string; note: string };
export const isAmendmentRole = (role: string | null | undefined) => /endorse|alteration|amendment|rider|addendum/i.test(role ?? "");
const polKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const REVERSAL = /\b(?:endorsement|amendment|alteration)\b[^.\n]{0,120}?\b(?:is|are|has been|have been|was|were|hereby)\s+(?:cancel+ed|revoked|reversed|rescinded|withdrawn|voided|annulled)\b|\b(?:cancel+ation|reversal|revocation|withdrawal|rescission) of (?:the |our )?(?:endorsement|amendment|alteration)\b/i;
/** The removed amendments of `base`'s policy (same policy / group number) and what they mean on `asOf`.
 * `docs`: every document row of the household (active or not, metadata only); `activeTexts`: page text of ACTIVE
 * documents only (for an explicit reversal). */
export function amendmentRemovalsFor(base: DocMeta, docs: DocMeta[], activeTexts: Map<string, string> = new Map()): AmendmentRemoval[] {
  if (isAmendmentRole(base.role)) return [];
  const keys = [polKey(base.policyNumber), polKey(base.groupPolicyNumber)].filter((k) => k.length >= 4);
  if (!keys.length) return [];
  const same = (d: DocMeta) => d.id !== base.id && [polKey(d.policyNumber), polKey(d.groupPolicyNumber)].some((k) => k.length >= 4 && keys.includes(k));
  const family = docs.filter(same);
  const liveAmendments = family.filter((d) => d.active && !d.superseded && isAmendmentRole(d.role));
  const out: AmendmentRemoval[] = [];
  for (const r of family.filter((d) => isAmendmentRole(d.role) && (!d.active || d.superseded))) {
    // (c) replaced: a live document supersedes it, or a live amendment of the same policy takes effect on or after it.
    if (r.supersededById && docs.some((d) => d.id === r.supersededById && d.active && !d.superseded)) continue;
    const rEff = r.effectiveDate ?? r.documentDate ?? null;
    if (liveAmendments.some((a) => { const aEff = a.effectiveDate ?? a.documentDate ?? null; return !!aEff && (!rEff || aEff >= rEff) && (a.createdAt ?? "") >= (r.createdAt ?? ""); })) continue;
    const role = r.role ?? "amendment";
    // (d) explicit reversal printed by a remaining document of the policy.
    const rev = [base, ...family.filter((d) => d.active && !d.superseded)].map((d) => { const t = activeTexts.get(d.id) ?? ""; const m = t.match(REVERSAL); return m ? { id: d.id, text: (t.split("\n").find((l) => REVERSAL.test(l)) ?? m[0]).trim() } : null; }).find(Boolean);
    if (rev) { out.push({ kind: "amendment_reversed", documentId: r.id, documentRole: role, policyNumber: r.policyNumber, reversedBy: rev.id, reversalText: rev.text, note: `A remaining document of this policy says the change was reversed: “${rev.text}”.` }); continue; }
    const removal = !r.active ? "deleted" as const : "superseded" as const;
    out.push({ kind: "amendment_removed", documentId: r.id, documentRole: role, policyNumber: r.policyNumber, removal, removedOn: r.removedOn ? r.removedOn.slice(0, 10) : null, effectiveDate: rEff ? rEff.slice(0, 10) : null,
      note: `An amendment document (${role}) for policy ${r.policyNumber ?? "this policy"} was ${removal === "deleted" ? "removed from the library" : "replaced"}${r.removedOn ? ` on ${r.removedOn.slice(0, 10)}` : ""}${rEff ? `; it took effect on ${rEff.slice(0, 10)}` : ""}. The remaining schedule shows the terms as issued; the current amounts may differ. Do not say the policy has no amendments, and do not present a schedule amount as confirmed current cover without saying this.` });
  }
  return out;
}
/** Words that state the limitation: an amendment document was removed, or the current amount may differ. */
export const STATES_REMOVAL_LIMITATION = /\b(?:amend\w*|endorse\w*|alteration|change (?:letter|document))\b[^.;]{0,120}?\b(?:removed|deleted|no longer (?:in|available|on file))\b|\b(?:removed|deleted)\b[^.;]{0,120}?\b(?:amend\w*|endorse\w*|alteration)\b|\b(?:may|might|could)\s+(?:now\s+|since\s+)?(?:differ|be different|have changed|not (?:be|reflect) (?:the |your )?current)\b|\bmay not reflect\b|\bnot (?:confirmed|able to confirm) (?:as )?(?:the )?current\b/i;
/** A sentence that says the policy has not been amended (what a removed amendment does NOT establish). */
export const SAYS_NOT_AMENDED = /\bno (?:recorded |other |current )?(?:amendments?|endorsements?|alterations?|changes)\b|\b(?:has|have|was|were) not been (?:amended|endorsed|altered|changed)\b|\b(?:did|does|has) not change(?:d)? anything\b/i;
