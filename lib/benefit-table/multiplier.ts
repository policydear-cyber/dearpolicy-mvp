import { moneyFiguresIn } from "@/lib/chat/answer-verification";

/** A row's own printed condition that pays a multiple of its amount in one case ("a compound fracture is paid at double the
 * Section 3 amount, still subject to the GBP 1,500 maximum"). Harbourline family PA test, 13 Nov: "It was a compound
 * fracture." still showed the single 2% of the sum beside prose saying it is doubled.
 * The model judges, the server computes (PR #472 gates 1-2: word rules for who and when a case applies kept leaking, through
 * pronouns, earlier events, quoted policy words and traits). The model names the note in an amount statement's
 * "multiplierNote" only when the household said its case applies to this person in this event. The server applies it only
 * when the note is one of the row's own printed conditions, pays one plain multiple (no negation, "up to", "at most", or
 * another section's amount), and its case words are somewhere in the household's own messages (a sanity check, never the
 * decision); within the printed maximum as before. A named note failing any check gives no amount (never the single one);
 * no note named gives main's card, whatever the household's words. Read by the row step (lib/benefit-table/chat.ts) and
 * again by the chat's checks (lib/simple-chat/verify.ts serverFigureChecked) from the stored page. */
export type Multiplier = { times: number; condition: string; keepsCap: boolean };
/** What a row brings to its note: its own words (benefit and quote), its section, its printed maximum. */
export type RowFacts = { own: string; section: string | null; cap: number | null };

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
 * row's own benefit and quote words are taken out as well (caseWords). Only for the sanity check below. */
const NOT_CASE = new Set(("a an the and or of to in on at by for from with within without as is are was were be been being it its this that these those " +
  "which who whom whose where when while if unless until any each every per all such than then there their his her our your my " +
  "paid pay pays payable paying payment amount amounts benefit benefits sum sums insured assured figure rate section sections table schedule " +
  "note notes maximum minimum max limit limits limited cap capped subject still same applies apply applied up only also further " +
  "claim claims claimed policy cover covered insurer person persons life lives member members event events case cases " +
  "happen happens happened occur occurs occurred result results resulting resulted caused cause due suffered suffer sustained " +
  "injury injuries injured accident accidents accidental bodily illness item items total year years day days time times " +
  "can will shall may must would should has have had does did").split(" "));
const tokens = (s: string) => s.toLowerCase().replace(/['’]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 || /^\d+$/.test(w));
const stem = (w: string) => w.length > 4 && /(?:ch|sh|x|ss|z)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/** Each case a condition's multiple is paid in, as the words that name it: its parts split at "or" and commas, each part's
 * words that are not NOT_CASE and not the row's own words. "a compound fracture is paid at double the Section 3 amount,
 * still subject to the GBP 1,500 maximum" on a "Fracture of arm, wrist or leg" row gives [["compound"]]. Section numbers
 * and money figures are taken out first. */
export function caseWords(rest: string, own: string): string[][] {
  let text = rest.replace(/^\s*note\s*(?:\([a-z0-9]+\)|[a-z0-9]+)?\s*[:.-]\s*/i, "").replace(SECTION_REF, " ");
  for (const f of moneyFiguresIn(text)) if (f.raw) text = text.replace(f.raw, " ");
  const mine = new Set(tokens(own).map(stem));
  return text.split(/\bor\b|[,;/()]|\band\/or\b/i)
    .map((part) => [...new Set(tokens(part).map(stem).filter((w) => !NOT_CASE.has(w) && !mine.has(w)))]).filter((p) => p.length > 0);
}

/** A note as the model copies it and as the row prints it, compared without case, spacing, its "Note (a):" mark or end
 * punctuation. */
export const sameNote = (a: string, b: string) => {
  const n = (s: string) => s.replace(/^\s*note\s*(?:\([a-z0-9]+\)|[a-z0-9]+)?\s*[:.-]\s*/i, "").replace(/[\s.;:,]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return n(a).length > 0 && n(a) === n(b);
};

/** The multiple a note the model named pays for this row, or null (no amount is then shown): the note pays one plain
 * multiple, names no section but the row's own (a row with no section of its own cannot be told apart: null), and every
 * word of one of its cases is in the household's own messages. Whether the case applies to this person in this event is
 * the model's to judge; this is only the server's check that it can be the case. */
export function noteMultiple(note: string, row: RowFacts, heard: readonly string[]): Multiplier | null {
  const m = multipleIn(note);
  if (!m || m === "unsure" || !m.plain) return null;
  const refs = [...note.matchAll(SECTION_REF)].map((x) => sectionKey(x[1]));
  const own = row.section ? sectionKey(row.section) : "";
  if (refs.length && (!own || refs.some((r) => r !== own))) return null;
  const parts = caseWords(m.rest, row.own);
  const said = new Set(heard.flatMap((t) => tokens(t).map(stem)));
  if (!parts.some((p) => p.every((w) => said.has(w)))) return null;
  return { times: m.times, condition: note, keepsCap: keepsCapIn(note, row.cap) };
}

/** "double", "3 times", "150%": the multiple as the card's working says it. */
export const timesWords = (t: number) => t === 2 ? "double" : t === 3 ? "treble" : t === 0.5 ? "half" : Number.isInteger(t) ? `${t} times` : `${Math.round(t * 1000) / 10}%`;
