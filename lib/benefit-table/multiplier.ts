import { moneyFiguresIn } from "@/lib/chat/answer-verification";

/** A row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid at double the
 * Section 3 amount, still subject to the GBP 1,500 maximum"). Harbourline family PA test, 13 Nov: "It was a compound
 * fracture." still showed the single 2% of the sum beside prose saying it is doubled.
 * When the model names the note in an amount statement's "multiplierNote", the card keeps the row's single amount and adds
 * the multiple as a condition in the note's own printed words, with its figure worked out within the printed maximum ('Note
 * (a) on page 2 says: "a compound fracture is paid at double ...". If that applies, this pays £800 (double), within the
 * £1,500 maximum'). That line is true whoever the case is, so the household's words are never read to decide whom it is for: seven
 * gate rounds (PR #472) showed a hand-written reader of who and when cannot be the gate. The server checks only the note:
 * one of the row's own printed conditions, one plain multiple (no negation, "up to", "at most", another section's or
 * another row's case, or a trait). A note failing a check adds nothing; no note named gives main's card. Read by the row
 * step (lib/benefit-table/chat.ts) and again by the chat's checks (lib/simple-chat/verify.ts serverFigureChecked). */
export type Multiplier = { times: number; condition: string; keepsCap: boolean };
/** What a row brings to its note: its own words (benefit and quote), its section, its printed maximum, and the benefit
 * names of the person's other rows (a note with no section number naming one of them is that row's, not this one's). */
export type RowFacts = { own: string; section: string | null; cap: number | null; others?: string };

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
export function multipleIn(text: string): { times: number; rest: string; plain: boolean; at: RegExpMatchArray; count: number } | "unsure" | null {
  const found = [...text.matchAll(MULTIPLE)].map((m) => {
    const w = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").toLowerCase();
    return { at: m, times: m[5] != null ? Number(m[5]) / 100 : TIMES[w] ?? Number(w) };
  }).filter((x) => Number.isFinite(x.times) && x.times > 0 && Math.abs(x.times - 1) > 1e-9);
  if (!found.length) return null;
  if (new Set(found.map((x) => x.times)).size > 1) return "unsure";
  let rest = text;
  for (const x of found) rest = rest.replace(x.at[0], " , ");
  const plain = !NOTE_NEGATION.test(text) && !found.some((x) => LIMIT_BEFORE.test(text.slice(Math.max(0, x.at.index! - 40), x.at.index!)));
  return { times: found[0].times, rest, plain, at: found[0].at, count: found.length };
}

/** Words that change what a multiple is paid on or take something off it ("less any amount already paid", "net of", "the
 * Sum Insured"): a note holding one is never said as a plain multiple of this row's amount (gate round 8). */
const ARITHMETIC = /\b(?:less|minus|deduct\w*|net\s+of|offset\w*|reduc\w*|plus|additional|in\s+addition)\b/i;
const OTHER_BASE = /\bsums?\s+(?:insured|assured)\b|\binsured\s+amount\b|\bcover(?:age)?\s+amount\b|\bpremiums?\b|\bsalar(?:y|ies)\b|\bearnings\b|\bincome\b/i;
/** What a multiple may be of: "the amount", "the Section 3 amount", "the benefit", "its rate", "the fracture benefit". */
const OBJECT = /^(?:the|its|this|that)\s+((?:[\w-]+\s+){0,3}?)(?:amount|benefit|rate|sum\s+payable|figure)\b/i;
/** The only words a note may have after its multiple (gate round 8, an allow-list on the note's shape): "is paid", a case
 * ("if the accident happens at work", "for a fracture of a finger"), the row's maximum kept ("still subject to the GBP
 * 1,500 maximum per accident", "subject to the same limit") and "per accident". */
const AFTER: RegExp[] = [
  /^(?:is|are|will\s+be|shall\s+be)\s+(?:paid|payable)\b/i,
  /^(?:if|when|while|where|for|during|in|on|at)\b[^,;.]*/i,
  /^(?:(?:still|but|and|always)\s+)?subject\s+to\s+(?:the\s+|a\s+)?(?:(?:same|overall|(?:[A-Z]{3}|[£$€]|S\$|RM)\s?\d[\d,]*(?:\.\d+)?)\s+)*(?:maximum|limit|cap)\b(?:\s+(?:per|for\s+each|for\s+any\s+one|of)\s+(?:accident|claim|event|fracture|injury|person|insured\s+person|day))?/i,
  /^per\s+(?:accident|claim|event|fracture|injury|person|day)\b/i,
];
/** Whether a note's words are only a case, its one multiple of this row's own amount, and the row's maximum kept: no other
 * base ("double the Sum Insured"), no deduction ("less any amount already paid") and nothing else after the multiple. */
function plainShape(note: string, m: { at: RegExpMatchArray; count: number }, row: RowFacts): boolean {
  if (m.count !== 1 || ARITHMETIC.test(note) || OTHER_BASE.test(note)) return false;
  const ownSection = row.section ? sectionKey(row.section) : "";
  const mine = new Set(tokens(row.own.split("\n")[0] ?? "").map(stem));
  const ofMine = (mid: string) => tokens(mid).every((w) => (w === "section" && !!ownSection) || w === ownSection || ["benefit", "basic", "daily", "this", "that", "its"].includes(w) || mine.has(stem(w)));
  const said = m.at[0], i = said.search(/\b(?:the|its|this|that)\s/i);
  let rest = note.slice(m.at.index! + said.length);
  if (i >= 0) { const o = OBJECT.exec(said.slice(i)); if (!o || !ofMine(o[1])) return false; }
  else { const o = OBJECT.exec(rest.trimStart()); if (o) { if (!ofMine(o[1])) return false; rest = rest.trimStart().slice(o[0].length); } }
  for (let moved = true; moved;) {
    moved = false;
    rest = rest.replace(/^[\s,;]+/, "");
    for (const p of AFTER) { const x = p.exec(rest); if (x && x[0].length) { rest = rest.slice(x[0].length); moved = true; break; } }
  }
  return /^[\s.;:)]*$/.test(rest);
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

/** The multiple a row's own printed note pays, as a condition the card can say beside its single amount ("If that applies,
 * this pays £800 (double)"), or null (the card is then as before). Only the note's own structure is checked, never whom
 * the household's words are about: the conditional line is true whoever the case is (PR #472 round 7). The note pays one
 * plain multiple (no negation, "up to", "at most") of this row's own amount, with nothing after it but a case, the row's
 * maximum kept and "per accident" (plainShape: never "double the Sum Insured" or "less any amount already paid"); names no section but the row's own (a row with no section of its own
 * cannot be told apart) and, with no section number, no case word of another of the person's benefits (W4); and is not
 * keyed on who the person is (a trait note). */
export function noteMultiple(note: string, row: RowFacts): Multiplier | null {
  const m = multipleIn(note);
  if (!m || m === "unsure" || !m.plain || !plainShape(note, m, row)) return null;
  const refs = [...note.matchAll(SECTION_REF)].map((x) => sectionKey(x[1]));
  const own = row.section ? sectionKey(row.section) : "";
  if (refs.length && (!own || refs.some((r) => r !== own))) return null;
  const parts = caseParts(m.rest, row.own);
  if (parts === "trait" || !parts.length) return null;
  if (!refs.length && row.others) {
    const theirs = new Set(tokens(row.others).map(stem).filter((w) => !NOT_CASE.has(w)));
    if (parts.some((p) => p.words.some((w) => theirs.has(w)))) return null;
  }
  return { times: m.times, condition: note, keepsCap: keepsCapIn(note, row.cap) };
}

/** "double", "3 times", "150%": the multiple as the card's working says it. */
export const timesWords = (t: number) => t === 2 ? "double" : t === 3 ? "treble" : t === 0.5 ? "half" : Number.isInteger(t) ? `${t} times` : `${Math.round(t * 1000) / 10}%`;
