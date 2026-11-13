import { moneyFiguresIn } from "@/lib/chat/answer-verification";

/** A row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid at double the
 * Section 3 amount", "the benefit is doubled while travelling on public transport", "three times the amount"). Harbourline
 * family PA test, 13 Nov: "It was a compound fracture." still showed the single 2% of the sum beside prose saying it is
 * doubled. One general rule for any insurer, wording and currency, with three outcomes (decideMultiple), allow-list first and
 * main's behaviour by default (PR #472 gate, H1-H6):
 * - "apply": the case is stated plainly for this person (applyable), the note is plain (plainNote), and it is this row's;
 * - "unsure": the case is named in the household's words but any of that fails: the card shows no amount, the note is said
 *   as its condition and the household hears an amount was left out;
 * - null: everything else, the card exactly as before (the case never named, a note about another section, a note keyed on
 *   who the person is, an earlier mention about another member).
 * Read by the row step (lib/benefit-table/chat.ts) and decided again by the chat's checks (lib/simple-chat/verify.ts
 * serverFigureChecked) from the stored page and the household's own words, never taken on trust. */
export type Multiplier = { times: number; condition: string; keepsCap: boolean };
export type Decision = { kind: "apply"; m: Multiplier } | { kind: "unsure"; condition: string } | null;

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
 * governing the multiple ("up to double", "at most twice", "a maximum of 3 times"). Its case is then never applied (H4). */
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
const sectionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Words that never name the case a multiple is paid in: grammar, how a benefit is paid, money and insurance words. Closed
 * list, like the file's other word lists; the row's own benefit and quote words are taken out as well (caseWords). */
const NOT_CASE = new Set(("a an the and or of to in on at by for from with within without as is are was were be been being it its this that these those " +
  "which who whom whose where when while if unless until any each every per all such than then there their his her our your my " +
  "paid pay pays payable paying payment amount amounts benefit benefits sum sums insured assured figure rate section sections table schedule " +
  "note notes maximum minimum max limit limits limited cap capped subject still same applies apply applied up only also further " +
  "claim claims claimed policy cover covered insurer person persons life lives member members event events case cases " +
  "happen happens happened occur occurs occurred result results resulting resulted caused cause due suffered suffer sustained " +
  "injury injuries injured accident accidents accidental bodily illness item items total year years day days time times " +
  "can will shall may must would should has have had does did").split(" "));
/** Words about who the person is, or a count, never an event the household's words can state: a note keyed on them is never
 * applied, and never takes away a card (H3, H6). */
const TRAIT = new Set(("age aged ages old older elder elderly senior seniors over under above below younger young youth " +
  "child children childs kid kids minor minors infant infants baby babies juvenile juveniles adult adults teen teens teenager teenagers student students " +
  "male males female females man men woman women boy boys girl girls pregnant pregnancy " +
  "occupation occupations occupational employee employees employed employment worker workers job jobs retired retiree retirees " +
  "spouse spouses partner partners dependant dependants dependent dependents parent parents " +
  "both two three four five six seven eight nine ten multiple several").split(" "));
const tokens = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w));
const stem = (w: string) => w.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/** Each case a condition's multiple is paid in, as the words that name it: its parts split at "or" and commas, each part's
 * words that are not NOT_CASE and not the row's own words; "trait" when any word is about who the person is or a count.
 * "a compound fracture is paid at double the Section 3 amount, still subject to the GBP 1,500 maximum" on a "Fracture of
 * arm, wrist or leg" row gives [["compound"]]. Section numbers and money figures are taken out first; other digits stay
 * ("aged 70 or over" is a trait, never ["aged"], ["over"]). */
export function caseWords(rest: string, own: string): string[][] | "trait" {
  let text = rest.replace(/^\s*note\s*(?:\([a-z0-9]+\)|[a-z0-9]+)?\s*[:.-]\s*/i, "").replace(SECTION_REF, " ");
  for (const f of moneyFiguresIn(text)) if (f.raw) text = text.replace(f.raw, " ");
  if (tokens(text).some((w) => TRAIT.has(w) || TRAIT.has(stem(w)) || /^\d+$/.test(w))) return "trait";
  const mine = new Set(tokens(own).map(stem));
  return text.split(/\bor\b|[,;/()]|\band\/or\b/i)
    .map((part) => [...new Set(tokens(part).map(stem).filter((w) => !NOT_CASE.has(w) && !mine.has(w)))]).filter((p) => p.length > 0);
}

/** A sentence that does not plainly say the case happened: a negation, a contrast, a condition, a guess or a question
 * ("the doctor ruled out a compound fracture", "but it is a simple fracture", "would it pay more if ...?") (H2). */
const HEDGE = /\b(?:not|no|never|none|nor|without|ruled?\s+out|ruling\s+out|exclud\w*|unlikely|whether|if|would|could|might|may|maybe|perhaps|possibl[ey]|probabl[ey]|suspect\w*|unsure|unclear|unknown|uncertain|but|however|although|though|instead|rather|unless|except|yet|suppos\w*|hypothetical\w*|cannot|wonder\w*|await\w*|pending)\b|n['’]t\b|\?/i;
/** The sentences of a message (lines and sentence ends). */
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

export type Heard = { current: string; earlier: string[]; person: string; namedIn: (text: string) => string[] };
/** How one message speaks of the case: "absent" (no sentence names every word of one of its parts); "other" (each sentence
 * that names it is about another member only); "stated" (a sentence names it plainly for this person, `explicit` when it
 * names them, and every other one naming it is about another member); else "unsure". */
function heardIn(parts: string[][], text: string, h: Heard): { how: "absent" | "other" | "unsure" } | { how: "stated"; explicit: boolean } {
  const naming = sentencesOf(text).filter((s) => { const have = new Set(tokens(s).map(stem)); return parts.some((p) => p.every((w) => have.has(w))); });
  if (!naming.length) return { how: "absent" };
  const read = naming.map((s) => { const who = h.namedIn(s);
    return { other: who.length > 0 && !who.includes(h.person), ok: (who.length === 0 || (who.length === 1 && who[0] === h.person)) && !HEDGE.test(s), explicit: who.includes(h.person) }; });
  if (read.every((r) => r.other)) return { how: "other" };
  const stating = read.filter((r) => r.ok);
  return stating.length && read.every((r) => r.ok || r.other) ? { how: "stated", explicit: stating.some((r) => r.explicit) } : { how: "unsure" };
}

export type RowFacts = { own: string; section: string | null; cap: number | null; skip?: (condition: string) => boolean };
/** One condition's outcome (see the file's comment). The current household message decides; when it does not name the case,
 * the latest earlier household message that does decides only when it names this person plainly (a fact carried from the
 * same claim); naming another member only leaves the card as before; naming no one is unsure. */
function decideOne(c: string, row: RowFacts, h: Heard): Decision {
  const m = multipleIn(c);
  if (!m) return null;
  // A note about another section is not this row's (a reader copying notes onto every row, H5); with no section of its
  // own the row cannot be told apart, so it is unsure.
  const refs = [...c.matchAll(SECTION_REF)].map((x) => sectionKey(x[1]));
  const own = row.section ? sectionKey(row.section.replace(/^\s*(?:section|item|benefit|clause|part|no\.?)\s*/i, "")) : "";
  const other = refs.length > 0 && (!own || refs.some((r) => r !== own));
  if (other && own) return null;
  if (row.skip?.(c)) return null;
  const parts = caseWords(m === "unsure" ? c : m.rest, row.own);
  if (parts === "trait" || !parts.length) return null;
  let heard = heardIn(parts, h.current, h);
  if (heard.how === "absent") {
    for (const turn of h.earlier) {
      const e = heardIn(parts, turn, h);
      if (e.how === "absent") continue;
      heard = e.how === "other" ? e : e.how === "stated" && e.explicit ? e : { how: "unsure" };
      break;
    }
    if (heard.how === "other") return null;
  }
  if (heard.how === "absent") return null;
  if (heard.how !== "stated" || m === "unsure" || !m.plain || other) return { kind: "unsure", condition: c };
  return { kind: "apply", m: { times: m.times, condition: c, keepsCap: keepsCapIn(c, row.cap) } };
}

/** The outcome for a row from all its printed conditions: any unsure one, or two different applying multiples, is unsure;
 * one applying multiple applies; else null (the card as before). */
export function decideMultiple(conditions: readonly string[], row: RowFacts, h: Heard): Decision {
  if (!h.current.trim() && !h.earlier.some((t) => t.trim())) return null;
  const outs = conditions.map((c) => decideOne(c, row, h)).filter((d): d is NonNullable<Decision> => d != null);
  const unsure = outs.find((d) => d.kind === "unsure");
  if (unsure) return unsure;
  const apply = outs.filter((d): d is { kind: "apply"; m: Multiplier } => d.kind === "apply");
  if (!apply.length) return null;
  return new Set(apply.map((d) => d.m.times)).size > 1 ? { kind: "unsure", condition: apply[0].m.condition } : apply[0];
}

/** "double", "3 times", "150%": the multiple as the card's working says it. */
export const timesWords = (t: number) => t === 2 ? "double" : t === 3 ? "treble" : t === 0.5 ? "half" : Number.isInteger(t) ? `${t} times` : `${Math.round(t * 1000) / 10}%`;
