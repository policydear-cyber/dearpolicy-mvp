/**
 * A page whose OCR text is only a reader's "could not read this" placeholders or noise was NOT read (journey retest
 * TE-ACC-20261116, HIGH 2: a blurred scanned page came back as "[illegible] [illegible] …", was stored as read, and was
 * never named to the household). Any OCR engine's output goes through this one rule: the hosted AI reader
 * (lib/documents/ocr-hosted.ts) marks such a page unreadable, so it is named like any other unread page; Baidu
 * (lib/documents/ocr-baidu.ts) does not accept it, so the AI reader gets its chance exactly as for a page Baidu returned
 * empty.
 *
 * The rule, narrow on purpose (never a page with a real word or an amount):
 *  1. Bracketed notes -- [..], (..), <..>, {..}, 【..】, （..）, 「..」 -- made only of the short English word lists below
 *     are placeholders, of two kinds:
 *     - "unreadable" notes ("[illegible]", "(unclear)", "[illeg.]", "[text not legible]", "[cannot read]"): something is
 *       printed there and was not read;
 *     - "nothing to read" notes ("[Page intentionally left blank]", "(blank)", "[Signature]", "[stamp]", "[image]"): the
 *       page is blank on purpose, or holds a signature, stamp or picture. Such a note never makes a page unread.
 *     A bracket holding only punctuation ("[...]", "[?]") is noise.
 *  2. Real content is what is left: a digit, a word of two or more letters (combining marks count as letters, so a short
 *     Devanagari or Bengali word is a word), or a character of a script written without spaces (Chinese, Japanese,
 *     Korean, Thai).
 *  3. With at least one "unreadable" note, page furniture does not count as real content: "Page 3", "Page 3 of 8",
 *     "3/8", a line holding only a page number (up to 3 digits, or a roman numeral), and a policy or reference number
 *     ("Policy No. ABC-12345").
 *  4. A non-empty page is not read when no real content is left AND it has an "unreadable" note or no note at all (pure
 *     noise such as "....", "l ; ' i"). A "nothing to read" note with no "unreadable" note keeps the page as before.
 * An empty page is left to the reader's own verdict (a blank page stays blank, as before): only non-empty text is judged.
 * The text itself is never changed here: a page with real words and an inline "[illegible]" keeps every word.
 */

/** Words that say something printed could not be read. */
const UNREADABLE = [
  "illegible", "illeg", "ilegible", "illegable", "illigible", "illegibly", "unreadable", "unintelligible", "indecipherable",
  "unclear", "unrecognized", "unrecognised", "blurred", "blurry", "smudged", "faded", "obscured", "garbled",
];
/** Words that say there is nothing to read there (blank on purpose, a signature, a stamp, a picture). */
const NOTHING = [
  "blank", "empty", "image", "images", "picture", "photo", "photograph", "graphic", "logo", "diagram", "chart", "figure",
  "signature", "signed", "stamp", "seal", "redacted", "handwriting", "handwritten", "scribble", "missing", "omitted", "unknown",
];
/** Words allowed beside a marker inside the same note ("[illegible text]", "[This page is intentionally left blank]"). */
const FILLERS = [
  "text", "word", "words", "line", "lines", "section", "area", "region", "content", "page", "part", "here", "no", "not",
  "legible", "readable", "left", "intentionally", "cut", "off", "too", "to", "read", "cannot", "can't", "could", "be", "is",
  "of", "a", "an", "the", "and", "or", "with", "embedded", "scanned", "scan", "this", "has", "been", "was",
];
const UNREADABLE_SET = new Set(UNREADABLE);
const NOTHING_SET = new Set(NOTHING);
const ALLOWED = new Set([...UNREADABLE, ...NOTHING, ...FILLERS]);

const BRACKETED = /\[([^\[\]\n]{0,60})\]|\(([^()\n]{0,60})\)|<([^<>\n]{0,60})>|\{([^{}\n]{0,60})\}|【([^【】\n]{0,60})】|（([^（）\n]{0,60})）|「([^「」\n]{0,60})」/g;

type Note = "unreadable" | "nothing" | "noise" | null;
function noteKind(inner: string): Note {
  const body = inner.trim();
  if (!/[\p{L}\p{N}]/u.test(body)) return "noise";
  if (/[^\p{L}\s:,.'’\-–—/]/u.test(body)) return null;
  const words = body.toLowerCase().replace(/’/g, "'").split(/[\s:,.\-–—/]+/).filter(Boolean);
  if (!words.length || words.length > 8 || !words.every((w) => ALLOWED.has(w))) return null;
  // "not legible", "cannot read", "can't be read": an unreadable note without an unreadable word.
  const negated = words.some((w) => w === "not" || w === "cannot" || w === "can't") && words.some((w) => w === "legible" || w === "readable" || w === "read");
  if (words.some((w) => UNREADABLE_SET.has(w)) || negated) return "unreadable";
  if (words.some((w) => NOTHING_SET.has(w))) return "nothing";
  return null;
}

/** The text with every placeholder note taken out, and how many of each kind it held (for the check only: never stored). */
export function withoutPlaceholders(text: string): { rest: string; unreadable: number; nothing: number } {
  let unreadable = 0, nothing = 0;
  const rest = String(text ?? "").replace(BRACKETED, (whole: string, ...groups: unknown[]) => {
    const inner = groups.slice(0, 7).find((g) => typeof g === "string") as string | undefined;
    const kind = noteKind(inner ?? "");
    if (kind === "unreadable") unreadable++;
    else if (kind === "nothing") nothing++;
    return kind ? " " : whole;
  });
  return { rest, unreadable, nothing };
}

/** Page furniture: page numbers and a policy or reference number. Only discounted on a page with an unreadable note. */
function withoutFurniture(text: string): string {
  return text
    .replace(/\bpage\s*\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?\b/giu, " ")
    .replace(/\b(?:policy|certificate|reference|ref|document|doc|member|contract|account)\s*(?:no\.?|number|num\.?|#)?\s*[:#.]?\s*(?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{2,}/giu, " ")
    .split("\n")
    .filter((line) => !/^\s*[-–—]?\s*(?:\d{1,3}|\d{1,3}\s*\/\s*\d{1,3}|[ivxlc]{1,6})\s*[-–—]?\s*$/iu.test(line))
    .join("\n");
}

/** Real content: a digit, a word of two or more letters (with combining marks), or a character of a script written
 * without spaces. */
const REAL_CONTENT = /\p{N}|\p{L}[\p{L}\p{M}]*\p{L}|\p{L}\p{M}+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** True when a reader's page text is not empty but holds no real content once placeholders are removed (see the rule
 * above): the page was not read. False for empty text (the reader's own blank/unreadable verdict decides that page, as
 * before), and false for a page whose only notes say there is nothing to read ("[Page intentionally left blank]"). */
export function ocrTextIsPlaceholderOnly(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const { rest, unreadable, nothing } = withoutPlaceholders(raw);
  if (!unreadable && nothing) return false;
  return !REAL_CONTENT.test(unreadable ? withoutFurniture(rest) : rest);
}
