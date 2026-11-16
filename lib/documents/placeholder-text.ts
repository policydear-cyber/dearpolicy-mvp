/**
 * A page whose OCR text is only a reader's placeholder or noise was NOT read (journey retest TE-ACC-20261116, HIGH 2:
 * a blurred scanned page came back as "[illegible] [illegible] …", was stored as read, and was never named to the
 * household). Any OCR engine's output goes through this one rule: the hosted AI reader (lib/documents/ocr-hosted.ts)
 * marks such a page unreadable, so it is named like any other unread page; Baidu (lib/documents/ocr-baidu.ts) does not
 * accept it, so the AI reader gets its chance exactly as for a page Baidu returned empty.
 *
 * The rule, narrow on purpose (never a page with a real word or a figure):
 *  1. Placeholder markers are removed: a bracketed note -- [..], (..), <..> or {..} -- whose words are all from the
 *     short English list below and at least one is a marker ("[illegible]", "(unreadable text)", "[image: logo]",
 *     "<blank page>"), or a bracket holding only punctuation ("[...]", "[?]").
 *  2. What is left must hold real content: a digit (a table of figures is read), a run of two or more letters (a word),
 *     or a character of a script written without spaces (Chinese, Japanese, Korean, Thai), where one character is a word.
 *  3. A page with no such content -- only markers, repeated punctuation, or single stray letters -- is not read.
 * An empty page is left to the reader's own verdict (a blank page stays blank, as before): only non-empty text is judged.
 * The text itself is never changed here: a page with real words and an inline "[illegible]" keeps every word.
 */

/** Words that make a bracketed note a reader's placeholder. */
const MARKERS = [
  "illegible", "unreadable", "unintelligible", "indecipherable", "unclear", "unrecognized", "unrecognised", "blank", "empty",
  "image", "images", "picture", "photo", "photograph", "graphic", "figure", "logo", "diagram", "chart", "signature", "stamp", "seal",
  "blurred", "blurry", "smudged", "faded", "obscured", "redacted", "handwriting", "handwritten", "scribble", "unknown", "cut", "missing", "omitted",
];
/** Words allowed beside a marker inside the same note ("[illegible text]", "[page left blank]", "[text cut off]"). */
const FILLERS = [
  "text", "word", "words", "line", "lines", "section", "area", "region", "content", "page", "part", "here", "no", "not",
  "legible", "readable", "left", "intentionally", "off", "too", "to", "read", "cannot", "be", "is", "of", "a", "an", "the",
  "and", "or", "with", "embedded", "scanned", "scan",
];
const MARKER_SET = new Set(MARKERS);
const ALLOWED = new Set([...MARKERS, ...FILLERS]);

const BRACKETED = /\[([^\[\]\n]{0,60})\]|\(([^()\n]{0,60})\)|<([^<>\n]{0,60})>|\{([^{}\n]{0,60})\}/g;

function isPlaceholderNote(inner: string): boolean {
  const body = inner.trim();
  // "[...]", "[?]", "[ ]": nothing but punctuation inside.
  if (!/[\p{L}\p{N}]/u.test(body)) return true;
  if (/[^\p{L}\s:,.\-–—/]/u.test(body)) return false;
  const words = body.toLowerCase().split(/[\s:,.\-–—/]+/).filter(Boolean);
  return words.length > 0 && words.length <= 6 && words.every((w) => ALLOWED.has(w)) && words.some((w) => MARKER_SET.has(w));
}

/** The text with every placeholder note taken out (for the check only: never stored). */
export function withoutPlaceholders(text: string): string {
  return String(text ?? "").replace(BRACKETED, (whole, a, b, c, d) => (isPlaceholderNote(a ?? b ?? c ?? d ?? "") ? " " : whole));
}

/** Real content: a digit, a word of two or more letters, or a character of a script written without spaces. */
const REAL_CONTENT = /\p{N}|\p{L}{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** True when a reader's page text is not empty but holds no real content once placeholders are removed: the page was
 * not read. False for empty text (the reader's own blank/unreadable verdict decides that page, as before). */
export function ocrTextIsPlaceholderOnly(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  return !REAL_CONTENT.test(withoutPlaceholders(raw));
}
