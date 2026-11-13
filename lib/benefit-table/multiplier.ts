import { moneyFiguresIn } from "@/lib/chat/answer-verification";

/** A row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid at double the
 * Section 3 amount, still subject to the GBP 1,500 maximum"). Harbourline family PA test, 13 Nov: "It was a compound
 * fracture." still showed the single 2% of the sum beside prose saying it is doubled.
 * The model judges, the server computes (PR #472 gates 1-2: word rules for who and when a case applies kept leaking, through
 * pronouns, earlier events, quoted policy words and traits). The model names the note in an amount statement's
 * "multiplierNote" only when the household said its case applies to this person in this event. The server applies it only
 * when the note is one of the row's own printed conditions, pays one plain multiple (no negation, "up to", "at most", or
 * another section's or another row's case), and the server's own reading of the household's words does not veto it
 * (vetoed: below); within the printed maximum as before. The veto only ever turns a multiplied card into no amount, never
 * makes one (PR #472 round 3: one wrong note from the model showed a wrong amount). A named note failing any check gives
 * no amount (never the single one); no note named gives main's card, whatever the household's words. Read by the row step
 * (lib/benefit-table/chat.ts) and again by the chat's checks (lib/simple-chat/verify.ts serverFigureChecked). */
export type Multiplier = { times: number; condition: string; keepsCap: boolean };
/** What a row brings to its note: its own words (benefit and quote), its section, its printed maximum, and the benefit
 * names of the person's other rows (a note with no section number naming one of them is that row's, not this one's). */
export type RowFacts = { own: string; section: string | null; cap: number | null; others?: string; scope?: string | null };

const TIMES: Record<string, number> = { double: 2, doubled: 2, twice: 2, treble: 3, trebled: 3, triple: 3, tripled: 3, half: 0.5, halved: 0.5,
  two: 2, three: 3, four: 4, five: 5 };
/** Only a multiple said of the amount itself: "paid at double", "is doubled", "twice the ... amount", "3 times the
 * benefit", "150% of the ... amount". "a double room", "claimed twice for the same benefit" or "2% of the Sum Insured" is
 * never one. */
const MULTIPLE = new RegExp([
  String.raw`\b(?:paid|payable|pays|paying|is|are|be)\s+(?:out\s+)?(?:at\s+)?(double|twice|treble|triple|half)\b`,
  String.raw`\b(doubled|trebled|tripled|halved)\b`,
  String.raw`\b(twice|double|treble|triple|half)\s+(?:the|its|this|that)\s+(?:[\w-]+\s+){0,3}?(?:amount|benefit|sum\s+payable|figure|rate)\b`,
  String.raw`(?<![\d.])(\d+(?:\.\d+)?|two|three|four|five)\s+times\s+(?:the|its|this|that)\s+(?:[\w-]+\s+){0,3}?(?:amount|benefit|sum\s+payable|figure|rate)\b`,
  String.raw`(?<![\d.])(\d+(?:\.\d+)?)\s?(?:%|per\s?cent)\s+of\s+(?:the|its|this|that)\s+(?:[\w-]+\s+){0,3}?(?:amount|benefit|sum\s+payable)\b`,
].join("|"), "gi");
/** A note whose multiple is not plainly paid: a negation anywhere in it ("is not doubled", "except"), or a limit word
 * governing the multiple ("up to double", "at most twice", "a maximum of 3 times"). */
const NOTE_NEGATION = /\b(?:not|no|never|none|except|excluding|unless|cannot|neither|nor)\b|n['’]t\b/i;
const LIMIT_BEFORE = /\b(?:up\s+to|at\s+most|maximum\s+of|not\s+exceeding|no\s+more\s+than|limited\s+to|capped\s+at)\s+(?:[\w-]+\s+){0,2}$/i;

/** The one multiple a condition prints, with its words left once it is taken out, and whether the note pays it plainly;
 * "unsure" when it prints two different ones; null when none (or 1: "100% of the benefit" is the amount itself). */
export function multipleIn(text: string): { times: number; rest: string; plain: boolean } | "unsure" | null {
  const found = [...text.matchAll(MULTIPLE)].map((m) => {
    const w = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").toLowerCase();
    return { at: m, times: m[5] != null ? Number(m[5]) / 100 : TIMES[w] ?? Number(w) };
  }).filter((x) => Number.isFinite(x.times) && x.times > 0 && Math.abs(x.times - 1) > 1e-9);
  if (!found.length) return null;
  if (new Set(found.map((x) => x.times)).size > 1) return "unsure";
  let rest = text;
  for (const x of found) rest = rest.replace(x.at[0], " , ");
  const plain = !NOTE_NEGATION.test(text) && !found.some((x) => LIMIT_BEFORE.test(text.slice(Math.max(0, x.at.index! - 40), x.at.index!)));
  return { times: found[0].times, rest, plain };
}

/** A condition that keeps the row's printed maximum on the multiplied amount: it prints only that maximum's figure, or says
 * the same maximum still applies ("still subject to the GBP 1,500 maximum", "subject to the same limit"). Otherwise
 * whether the maximum is multiplied too is not said, so a multiplied amount above it is never shown. */
export function keepsCapIn(text: string, cap: number | null): boolean {
  const figs = moneyFiguresIn(text);
  if (cap != null && figs.length && figs.every((f) => Math.abs(f.value - cap) < 0.005)) return true;
  return !figs.length && /\bstill\s+subject\s+to\b|\bsubject\s+to\s+the\s+same\b|\bthe\s+same\s+(?:maximum|limit|cap)\b|\b(?:maximum|limit|cap)\s+(?:still\s+)?applies\b/i.test(text);
}

/** A section, item or benefit number a note names ("the Section 3 amount", "item 4", "Benefit 2(a)"). */
const SECTION_REF = /\b(?:section|item|benefit|clause|part|table\s+item|no\.?)\s*(\d+[a-z]?|\b[ivx]{1,4}\b)(?:\s*\(\s*([a-z0-9]+)\s*\))?/gi;
const sectionKey = (s: string) => s.toLowerCase().replace(/^\s*(?:section|item|benefit|clause|part|no\.?)\s*/i, "").replace(/[^a-z0-9]/g, "");

/** Words that never name the case a multiple is paid in: grammar, how a benefit is paid, money and insurance words. The
 * row's own benefit and quote words are taken out as well (caseParts). */
const NOT_CASE = new Set(("a an the and or of to in on at by for from with within without as is are was were be been being it its this that these those " +
  "which who whom whose where when while if unless until any each every per all such than then there their his her our your my " +
  "paid pay pays payable paying payment amount amounts benefit benefits sum sums insured assured figure rate section sections table schedule " +
  "note notes maximum minimum max limit limits limited cap capped subject still same applies apply applied up only also further " +
  "claim claims claimed policy cover covered insurer person persons life lives member members event events case cases " +
  "happen happens happened occur occurs occurred result results resulting resulted caused cause due suffered suffer sustained " +
  "injury injuries injured accident accidents accidental bodily illness item items total year years day days time times " +
  "can will shall may must would should has have had does did").split(" "));
/** Words about who the person is (age, family place, sex, work, school) or a count: a note keyed on them is never applied,
 * whoever the model says it is for (the household's words about someone's age or children say nothing of this person's;
 * PR #472 H3, R2-H4, W8, W9). */
const TRAIT = new Set(("age aged ages old older elder elderly senior seniors over under above below younger young youth " +
  "child children childs kid kids minor minors infant infants baby babies juvenile juveniles adult adults teen teens teenager teenagers " +
  "student students pupil pupils school schools male males female females man men woman women boy boys girl girls pregnant pregnancy " +
  "occupation occupations occupational employee employees employed employment worker workers job jobs retired retiree retirees retirement " +
  "pensioner pensioners pension spouse spouses partner partners husband husbands wife wives son sons daughter daughters grandchild grandchildren " +
  "grandson grandsons granddaughter granddaughters sibling siblings brother brothers sister sisters mother mothers father fathers mum mums mom moms dad dads " +
  "parent parents dependant dependants dependent dependents policyholder policyholders holder holders proposer proposers " +
  "two three four five six seven eight nine ten multiple several").split(" "));
/** Short words kept in a case's phrase when they come right before it ("at work", "on public transport", "while abroad"). */
const LEAD = new Set(["at", "on", "in", "while", "during", "inside", "outside", "abroad", "from", "by"]);
const tokens = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w));
const allTokens = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const stem = (w: string) => w.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/** One case a note's multiple is paid in: its words, and its whole phrase as the note prints it (from the word before it
 * when that is "at", "on", "while" ...), which the household's sentence must hold in that order (R2-H5: "at work" is not
 * "on her way to work"). */
type CasePart = { words: string[]; phrase: string[] };
/** The cases of a note's words once its multiple is taken out: split at "or" and commas, each part's words that are not
 * NOT_CASE and not the row's own words; "trait" when any word is about who the person is or a count. Section numbers and
 * money figures are taken out first; other digits stay ("aged 70 or over" is a trait). */
export function caseParts(rest: string, own: string): CasePart[] | "trait" {
  let text = rest.replace(/^\s*note\s*(?:\([a-z0-9]+\)|[a-z0-9]+)?\s*[:.-]\s*/i, "").replace(SECTION_REF, " ");
  for (const f of moneyFiguresIn(text)) if (f.raw) text = text.replace(f.raw, " ");
  if (tokens(text).some((w) => TRAIT.has(w) || TRAIT.has(stem(w)) || /^\d+$/.test(w))) return "trait";
  const mine = new Set(tokens(own).map(stem));
  const out: CasePart[] = [];
  for (const part of text.split(/\bor\b|[,;/()]|\band\/or\b/i)) {
    const words = [...new Set(tokens(part).map(stem).filter((w) => !NOT_CASE.has(w) && !mine.has(w)))];
    if (!words.length) continue;
    const seq = allTokens(part).map(stem);
    const at = seq.map((w, i) => (words.includes(w) ? i : -1)).filter((i) => i >= 0);
    const from = at[0] > 0 && LEAD.has(seq[at[0] - 1]) ? at[0] - 1 : at[0];
    out.push({ words, phrase: seq.slice(from, at[at.length - 1] + 1) });
  }
  return out;
}
/** The case words of a note (tests and the section check): caseParts' words, or "trait". */
export function caseWords(rest: string, own: string): string[][] | "trait" {
  const parts = caseParts(rest, own);
  return parts === "trait" ? parts : parts.map((p) => p.words);
}

/** A note as the model copies it and as the row prints it, compared without case, spacing, its "Note (a):" mark, end
 * punctuation or the table's escaping ("&lt;"); a note the table shows joined to another with "; " is matched as its whole
 * part. */
export const sameNote = (said: string, printed: string) => {
  const n = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/^\s*note\s*(?:\([a-z0-9]+\)|[a-z0-9]+)?\s*[:.-]\s*/i, "")
    .replace(/[\s.;:,]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = n(said);
  return a.length > 0 && (a === n(printed) || (a.length >= 12 && printed.split(";").some((p) => n(p) === a)));
};

/** A clause that does not plainly say the case happened: a negation, a contrast, a condition, a guess or a question ("the
 * doctor ruled out a compound fracture", "but it is a simple fracture", "would it pay more if ...?") (H2, W5), or that says
 * nothing happened ("both arms are fine and nothing is fractured", Y5b). Read on the clause holding the case words only
 * (round 4, L10, L15: "a compound fracture, not a simple one"; "..., how much?"). */
const HEDGE = /\b(?:not|no|never|none|nor|nothing|neither|fine|without|ruled?\s+out|ruling\s+out|exclud\w*|unlikely|whether|if|would|could|might|may|maybe|perhaps|possibl[ey]|probabl[ey]|suspect\w*|unsure|unclear|unknown|uncertain|but|however|although|though|instead|rather|unless|except|yet|suppos\w*|hypothetical\w*|cannot|wonder\w*|await\w*|pending)\b|n['’]t\b|\?/i;
/** A sentence about an earlier event (R2-H2, W6): "last year", "in 2023", "previously", "it healed", "already claimed". */
const PAST = /\b(?:last\s+(?:year|month|week|time|summer|winter|spring|autumn|fall)|previous(?:ly)?|before|ago|earlier|in\s+(?:19|20)\d\d|healed|already|again|used\s+to)\b/i;
/** A sentence quoting or paraphrasing the policy, or saying the multiple itself (R2-H3, W7): "our policy says a compound
 * fracture is paid at double". "said", "confirmed" count only with the policy's words as their subject: a doctor's or a
 * hospital's is a fact (round 4, L5). */
const QUOTING = /\b(?:polic(?:y|ies)|schedule|wording|documents?|notes?|insurer|terms|brochure|cover|plan)\b[^.!?]{0,30}?\b(?:says?|said|states?|stated|confirm\w*|reads?|mentions?)\b|\baccording\s+to\b|\b(?:double|doubled|twice|treble|trebled|triple|tripled|times|half|halved)\b|%/i;
/** A case clause about the policy, or reported or general talk, is never the household's own event (Y4b, Y4c: "the policy
 * covers compound fractures better", "read online that compound fractures get more from insurers"). */
const QUOTING_CLAUSE = /\b(?:polic(?:y|ies)|insurers?|insurance|insured|plans?|covers?|coverage|documents?|brochures?|schedules?|wordings?|terms|notes?|read|heard|online|internet|website|forum|article|according)\b|\b(?:gets?|pays?|paid|getting|paying)\s+more\b/i;
/** First-person and family words: whom they mean cannot be told from the words (R2-H1: "I have a compound fracture", "my
 * husband has a compound fracture"), except a family word right before this person's name ("my wife Grace", round 4 L6). */
const WHO_WORDS = /\b(?:i|im|me|my|mine|myself|we|us|our|ours|husband|wife|son|daughter|mum|mom|mother|dad|father|brother|sister|child|children|kids?|baby|grand\w+|partner|spouse|siblings?|parents?|aunt|uncle|cousin|nephew|niece)\b/i;
const FAMILY = String.raw`(?:husband|wife|son|daughter|mum|mom|mother|dad|father|brother|sister|partner|spouse|child|kid|baby|grandson|granddaughter|grandchild)`;
/** People who are not members (closed list): a case clause naming one, or a sentence a pronoun leans back on that does, is
 * not this person's (Y6, Y6b-d, Y7b-c: "her colleague fell at work. He has ...", "the other driver has ..."). */
const NON_MEMBER = /\b(?:colleagues?|co-?workers?|friends?|drivers?|cyclists?|pedestrians?|passengers?|neighbou?rs?|boss|someone|somebody|anyone|stranger|strangers|guests?|man|men|woman|women|boy|boys|girl|girls|person|people|other|others|another|who|they|them|their|team-?mates?|classmates?)\b/i;
/** Words after "Grace's" that keep it Grace's own: body parts and injuries ("Grace's fracture is compound", L3); after
 * anything else ("Grace's colleague", "Grace's friend") the name is not the subject (Y6b, Y6c). */
const OWN_THING = new Set(("arm arms leg legs wrist wrists hand hands foot feet ankle ankles knee knees hip hips elbow elbows shoulder shoulders finger fingers " +
  "toe toes thumb thumbs head skull spine back neck rib ribs eye eyes face nose jaw collarbone pelvis bone bones fracture fractures break breaks injury " +
  "injuries burn burns wound wounds cut cuts sight hearing x-ray xray scan").split(" "));
/** A word before a name that makes it the object, not the subject ("the cyclist who hit Grace", Y7c). */
const OBJECT_BEFORE = /\b(?:by|with|hit|hits|struck|strikes|saw|sees|helped|helps|treated|treats|told|tells|to|for|of|from|about|than|behind|beside|near|against|knocked|pushed|drove|carried|visited|met)\s+$/i;
/** A clause whose subject is "it/this/that" or a bare "he/she": the only clauses a chat's own member, or a household of
 * one, can be the subject of when no member is named before them. */
const PRONOUN_SUBJECT = /^(?:yes\s+|so\s+|and\s+|well\s+|actually\s+)*(?:it|it['’]s|its|this|that|he|he['’]s|she|she['’]s)\b/i;

/** The household's words for one note: the current message, the earlier ones latest first, the row's person, how members
 * are named, and whom the conversation is for (its chosen member, or a household of one), if anyone. */
export type Heard = { current: string; earlier: readonly string[]; person: string; namedIn: (text: string) => string[]; scope?: string | null };
/** The sentences of a message (lines and sentence ends), and a sentence's clauses (commas, semicolons, colons, dashes). */
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clausesOf = (s: string) => s.split(/[,;:]|\s[-–—]\s/).map((c) => c.trim()).filter(Boolean);
const holds = (seq: string[], phrase: string[]) => phrase.length > 0 && seq.some((_, i) => phrase.every((w, j) => seq[i + j] === w));
/** A case of two or more words said in another order, all within a few words ("fractured both arms" for "both arms are
 * fractured", L21; never "fractured her leg and both arms are bruised", Y5c). */
const near = (seq: string[], words: string[]) => { const span = Math.max(4, words.length + 1);
  return words.length >= 2 && seq.some((_, i) => words.every((w) => seq.slice(i, i + span).includes(w))); };
/** The members a sentence names as its subject: a name said after "not", "instead of" or "rather than" is left out ("Actually
 * it was Grace, not Daniel." names Grace), so is one after a verb or preposition that makes it the object, and "Grace's X"
 * counts as Grace only when X is her own body part, injury or the case's own word. */
function subjects(s: string, h: Heard, caseWords: Set<string>): string[] {
  let t = s.replace(/\b(?:not|instead\s+of|rather\s+than)\s+[A-Za-z'’-]+/gi, " ");
  t = t.replace(/\b([A-Za-z][A-Za-z-]*)['’]s\s+([A-Za-z-]+)/g, (_m, name: string, next: string) =>
    OWN_THING.has(next.toLowerCase()) || caseWords.has(stem(next.toLowerCase())) ? `${name} ${next}` : ` ${next}`);
  const members = h.namedIn(t);
  return members.filter((m) => {
    const words = m.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
    // The member is the subject when some mention of them is not right after an object-making word.
    return [...t.matchAll(/[A-Za-z][A-Za-z'’-]*/g)].some((x) => words.includes(x[0].toLowerCase()) && !OBJECT_BEFORE.test(t.slice(0, x.index)));
  });
}

/** How the household's words read a note's case, for this row's person (the server's veto on the model's note):
 * - "absent": no clause holds every word of one of its cases;
 * - "other": each clause that does is about another member only;
 * - "stated": one says the case plainly for this person, and every other one is about another member;
 * - else "unsure".
 * A clause says it plainly when it holds the case (its whole phrase in order; or, for a case of two or more words, all of
 * them within a few words, L21) with no hedge, no quoting or reported words, no non-member person word, and no first-person
 * or family word but one right before this person's name; its sentence has no past-time or quoting words; and its sentence
 * names this person only as its subject, or names no member at all (not even as an object) and is about this person: the
 * latest member named before it in
 * the conversation, unless that sentence (or one between) speaks of a non-member, else, for a clause whose subject is
 * "it/this/that/he/she" with no non-member before it in the message, the conversation's own member (X1-X8, Y1-Y7, L1-L21).
 * `turn` is the index of the message in `all` (oldest first) whose clauses are read. */
function heardIn(parts: CasePart[], all: string[], turn: number, h: Heard): "absent" | "other" | "unsure" | "stated" {
  const flat = all.flatMap((t, i) => sentencesOf(t).map((s) => ({ s, i })));
  const caseWordSet = new Set(parts.flatMap((p) => p.words));
  const reads: { other: boolean; ok: boolean }[] = [];
  flat.forEach(({ s, i }, k) => {
    if (i !== turn) return;
    const clauses = clausesOf(s).filter((c) => { const seq = allTokens(c).map(stem), have = new Set(seq);
      return parts.some((p) => p.words.every((w) => have.has(w))); });
    if (!clauses.length) return;
    let about = subjects(s, h, caseWordSet);
    // A sentence naming a member only as an object or another's possession ("As for Daniel: ...", "the cyclist who hit
    // Grace") is about someone it cannot settle: never read back to an earlier member (Y3).
    let leans = !about.length && h.namedIn(s.replace(/\b(?:not|instead\s+of|rather\s+than)\s+[A-Za-z'’-]+/gi, " ")).length > 0;
    if (!about.length && !leans) for (let j = k - 1; j >= 0; j--) {
      const named = subjects(flat[j].s, h, caseWordSet);
      if (NON_MEMBER.test(flat[j].s)) { leans = true; break; }
      if (named.length) { about = named; break; }
    }
    if (!about.length && !leans && h.scope && clauses.some((c) => PRONOUN_SUBJECT.test(c))
      && !flat.slice(0, k + 1).some((x) => x.i === turn && NON_MEMBER.test(x.s))) about = [h.scope];
    const mine = !leans && about.length === 1 && about[0] === h.person;
    const names = h.person.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3).join("|");
    const unnamed = (c: string) => names ? c.replace(new RegExp(String.raw`\b(?:my|our)\s+${FAMILY}\s+(?:${names})\b`, "gi"), " ") : c;
    const plainSentence = !PAST.test(s) && !QUOTING.test(s);
    // Hedges, quoting, non-member and first-person or family words are read in the clause holding the case ("..., how
    // much do we get?" is another clause, L15).
    const said = clauses.some((c) => {
      const seq = allTokens(c).map(stem);
      return !HEDGE.test(c) && !QUOTING_CLAUSE.test(c) && !NON_MEMBER.test(c) && !WHO_WORDS.test(unnamed(c))
        && parts.some((p) => holds(seq, p.phrase) || near(seq, p.words));
    });
    reads.push({ other: !leans && about.length > 0 && !about.includes(h.person), ok: plainSentence && said && mine });
  });
  if (!reads.length) return "absent";
  if (reads.every((r) => r.other)) return "other";
  return reads.some((r) => r.ok) && reads.every((r) => r.ok || r.other) ? "stated" : "unsure";
}


/** The multiple a note the model named pays for this row, or null (no amount is then shown). Only ever a veto on the model's
 * choice, never a trigger: the note pays one plain multiple; names no section but the row's own (a row with no section of
 * its own cannot be told apart) and, with no section number, no case word of another of the person's benefits (W4); is not
 * keyed on who the person is; and the household's own words state its case plainly for this person (heardIn) in the current
 * message, or in the latest earlier message that speaks of it. */
export function noteMultiple(note: string, row: RowFacts, h: Heard): Multiplier | null {
  const m = multipleIn(note);
  if (!m || m === "unsure" || !m.plain) return null;
  const refs = [...note.matchAll(SECTION_REF)].map((x) => sectionKey(x[1]));
  const own = row.section ? sectionKey(row.section) : "";
  if (refs.length && (!own || refs.some((r) => r !== own))) return null;
  const parts = caseParts(m.rest, row.own);
  if (parts === "trait" || !parts.length) return null;
  if (!refs.length && row.others) {
    const theirs = new Set(tokens(row.others).map(stem).filter((w) => !NOT_CASE.has(w)));
    if (parts.some((p) => p.words.some((w) => theirs.has(w)))) return null;
  }
  // The conversation oldest first: the earlier messages (given latest first), then the current one.
  const all = [...h.earlier].reverse().concat(h.current);
  for (let t = all.length - 1; t >= 0; t--) {
    const read = heardIn(parts, all, t, h);
    if (read === "absent") continue;
    return read === "stated" ? { times: m.times, condition: note, keepsCap: keepsCapIn(note, row.cap) } : null;
  }
  return null;
}

/** "double", "3 times", "150%": the multiple as the card's working says it. */
export const timesWords = (t: number) => t === 2 ? "double" : t === 3 ? "treble" : t === 0.5 ? "half" : Number.isInteger(t) ? `${t} times` : `${Math.round(t * 1000) / 10}%`;
