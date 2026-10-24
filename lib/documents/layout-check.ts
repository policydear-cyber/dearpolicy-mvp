/** Checking a page's text before anything reads it (Charmaine's new documents, 24 Oct: two Prudential schedules whose
 * text came out with every label first and every value after, and neighbouring figures glued together, so no row could
 * be tied to its amount).
 *
 * A page whose text shows those signs is read a second time from its image. Its figures are used only when both readings
 * agree: every figure and every label the image reading prints beside a figure is in the text reading too, and the two
 * print the same figures. Otherwise the page is "unchecked": its text stays searchable, but nothing reads an amount from
 * it, and the document says it was read in part. Nothing here uses a model. */

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

/** Whether the page's image reading agrees with its text reading: the same figures (as many times each, reading glued ones
 * apart), and every word of each label the image reading prints beside a figure also in the text reading. Null with the
 * reason when they do not. */
export function readingsAgree(textReading: string, imageReading: string): { agree: true } | { agree: false; why: string } {
  const a = figuresIn(textReading).sort((x, y) => x - y), b = figuresIn(imageReading).sort((x, y) => x - y);
  if (!b.length) return { agree: false, why: "the image reading prints no figures" };
  if (a.length !== b.length || a.some((n, i) => Math.abs(n - b[i]) > 0.005)) return { agree: false, why: "the two readings print different figures" };
  const printed = new Set(words(textReading));
  for (const line of imageReading.split("\n")) {
    if (!/\d/.test(line)) continue;
    const label = line.replace(/(?:S\$|US\$|SGD|USD|\$)?\s*\d[\d,]*(?:\.\d+)?%?/g, " ");
    const missing = words(label).filter((w) => !printed.has(w));
    if (missing.length) return { agree: false, why: `the image reading prints "${missing.slice(0, 3).join(" ")}" beside a figure, and the text reading does not` };
  }
  return { agree: true };
}

/** The note a document gets when some pages could not be checked. */
export function uncheckedPagesNote(pageNumbers: number[]): string | null {
  if (!pageNumbers.length) return null;
  const list = pageNumbers.length === 1 ? `Page ${pageNumbers[0]}` : `Pages ${pageNumbers.slice(0, -1).join(", ")} and ${pageNumbers[pageNumbers.length - 1]}`;
  return `Read in part. ${list} could not be checked: ${pageNumbers.length === 1 ? "its" : "their"} table text came out scrambled, and a second reading from the page image did not agree with it, so no amount on ${pageNumbers.length === 1 ? "it" : "them"} is used.`;
}
export const READ_IN_PART = /^Read in part\b/;
