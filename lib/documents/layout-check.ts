/** Checking a page's text before anything reads it (Charmaine's new documents, 24 Oct: two Prudential schedules whose
 * text came out with every label first and every value after, and neighbouring figures glued together, so no row could
 * be tied to its amount).
 *
 * A page whose text shows those signs is read a second time from its image. The page is used only when both readings
 * agree line by line: the same figures, and each figure beside the same label in both. The text reading, the document's
 * own words, is what is stored; the image reading only confirms it. A page they do not agree on, or one whose text puts no
 * label beside its figures (one reading of the pairing is not two), is "unchecked": its text stays searchable, but
 * nothing reads an amount from it, and the document says it was read in part. Nothing here uses a model. */

/** "50,000.0050,000.00": a complete decimal amount with another digit straight after it. */
const GLUED = /\d\.\d{2}\d/;
const FIGURE = /\d[\d,]*\.\d{2}\b|\d{1,3}(?:,\d{3})+\b/g;
const NUMBERS_ONLY = /^[\s\d,.\-–—%$SGDU]*\d[\s\d,.\-–—%$SGDU]*$/;
const LABEL_ONLY = (line: string) => line.length >= 3 && line.length <= 60 && !/\d/.test(line) && /[A-Za-z]{3}/.test(line);

/** Signs that a page's table text came out scrambled: glued figures, or a run of labels with no figures followed by a run
 * of lines holding only figures (labels read before values). */
export function scrambleSigns(text: string): string[] {
  const signs: string[] = [];
  if (GLUED.test(text)) signs.push("figures printed side by side came out glued together");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let labels = 0;
    while (i + labels < lines.length && LABEL_ONLY(lines[i + labels])) labels++;
    let values = 0;
    while (i + labels + values < lines.length && NUMBERS_ONLY.test(lines[i + labels + values])) values++;
    if (labels >= 3 && values >= 3) { signs.push("labels came out before their values"); break; }
    i += Math.max(0, labels - 1);
  }
  return signs;
}
export const looksScrambled = (text: string) => scrambleSigns(text).length > 0;

const figuresIn = (text: string) => (text.replace(/(\d\.\d{2})(?=\d)/g, "$1 ").match(FIGURE) ?? []).map((f) => Number(f.replace(/,/g, ""))).filter((n) => n > 0);
const words = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, " ").trim().split(" ").filter((w) => w.length >= 3);

/** Each line that prints a figure: its label's words and its figures in order. */
function figureLines(text: string) {
  return text.split("\n").map((line) => ({ label: words(line.replace(/(?:S\$|US\$|SGD|USD|\$)?\s*\d[\d,]*(?:\.\d+)?%?/g, " ")), figures: figuresIn(line) }))
    .filter((l) => l.figures.length);
}
const sameFigures = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) < 0.005);
/** Whether the page's image reading agrees with its text reading: the same figures (as many times each, reading glued ones
 * apart), and every line of each that prints figures has a line in the other with the same figures in the same order
 * beside the same label words. A figure line with no label in the text reading has nothing to agree on. */
export function readingsAgree(textReading: string, imageReading: string): { agree: true } | { agree: false; why: string } {
  const a = figuresIn(textReading).sort((x, y) => x - y), b = figuresIn(imageReading).sort((x, y) => x - y);
  if (!b.length) return { agree: false, why: "the image reading prints no figures" };
  if (!sameFigures(a, b)) return { agree: false, why: "the two readings print different figures" };
  const text = figureLines(textReading), image = figureLines(imageReading);
  const beside = (l: { label: string[]; figures: number[] }, other: typeof text) =>
    other.some((o) => sameFigures(o.figures, l.figures) && l.label.every((w) => o.label.includes(w)) && o.label.every((w) => l.label.includes(w)));
  for (const l of text) {
    if (!l.label.length) return { agree: false, why: `the text reading prints ${l.figures.join(", ")} with no label beside it` };
    if (!beside(l, image)) return { agree: false, why: `the image reading does not print ${l.figures.join(", ")} beside "${l.label.join(" ")}"` };
  }
  for (const l of image) if (!beside(l, text)) return { agree: false, why: `the text reading does not print ${l.figures.join(", ")} beside "${l.label.join(" ")}"` };
  return { agree: true };
}

/** The note a document gets when some pages could not be checked. */
export function uncheckedPagesNote(pageNumbers: number[]): string | null {
  if (!pageNumbers.length) return null;
  const list = pageNumbers.length === 1 ? `Page ${pageNumbers[0]}` : `Pages ${pageNumbers.slice(0, -1).join(", ")} and ${pageNumbers[pageNumbers.length - 1]}`;
  return `Read in part. ${list} could not be checked: ${pageNumbers.length === 1 ? "its" : "their"} table text came out scrambled, and a second reading from the page image did not agree with it, so no amount on ${pageNumbers.length === 1 ? "it" : "them"} is used.`;
}
export const READ_IN_PART = /^Read in part\b/;
