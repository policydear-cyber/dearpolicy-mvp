/**
 * Round 7: text read from a scanned (image-only) page by OCR carries the
 * scanner's noise -- stray bars and quote marks, "$$50,000" for "S$50,000",
 * runs like "PE Ps eee ee". Shown as it was read, that is rubbish in front
 * of a household. Before a line from such a page is shown it is cleaned
 * here: noise tokens are dropped and a misread Singapore-dollar sign is
 * repaired only where the line is clearly about money. The figures and
 * words themselves are never changed; a line that is still mostly noise
 * after cleaning is not shown at all (null), and the caller says the page
 * was a scan that could not be read clearly.
 */
const SHORT_WORDS = new Set(("a an as at be by do go if in is it me my no of on or so to up us we " +
  "and are but can day due for has her his its may max min nil not now off one our out per pay see she six ten the two who why yes you " +
  "ci pa gp icu tcm tpd ilp ghs gpa gtl hfmd sgd usd dob nric no. jan feb mar apr jun jul aug sep sept oct nov dec age").split(/\s+/));
const NOISE_CHARS = /[|“”‘’"'`~^_=*°«»<>{}\\]/g;

function tokenOk(token: string): boolean {
  const t = token.replace(/^[(\[]+|[)\],.;:!?]+$/g, "");
  if (!t) return false;
  if (/^(?:S\$|US\$|\$)?\d[\d,]*(?:\.\d+)?%?$/.test(t)) return true;          // numbers and money
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(t)) return true;                 // dates
  if (/^[A-Z]{2,5}-[A-Z0-9-]{2,}$/.test(t)) return true;                       // policy numbers
  if (!/^[A-Za-z][A-Za-z-]*$/.test(t)) return false;
  if (SHORT_WORDS.has(t.toLowerCase())) return true;
  if (t.length <= 2) return false;
  if (/^(.)\1+$/i.test(t)) return false;                                       // "eee"
  if (t.length === 3) return SHORT_WORDS.has(t.toLowerCase()) || /[aeiouy]/i.test(t);
  if (!/[aeiouy]/i.test(t)) return false;                                      // "wsx", "trtl"
  return true;
}

/** Fraction of tokens that are noise. */
export function ocrNoiseShare(text: string): number {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  return tokens.filter((t) => !tokenOk(t.replace(NOISE_CHARS, "")) || /[|“”]/.test(t)).length / tokens.length;
}

/** A line of a scanned page, cleaned for display; null when it is mostly noise. */
export function cleanScannedLine(text: string): string | null {
  let t = text.replace(/(^|[\s(])(?:\$\$|5\$|S5|SS)(?=\d)/g, "$1S$").replace(/(S\$\d{1,3}(?:,\d{3})*),(\d{2})(?![\d,])/g, "$1.$2").replace(/:\s*\./g, ": ").replace(/([A-Za-z])'(\d{4})\b/g, "$1 $2");
  // (Punctuation on its own -- " - ", " ; " -- is neither a word nor noise.)
  const tokens = t.replace(NOISE_CHARS, " ").split(/\s+/).filter((tok) => tok && /[\p{L}\p{N}]/u.test(tok));
  const kept = tokens.filter((tok) => tokenOk(tok));
  if (kept.length < 2 || kept.length / Math.max(1, tokens.length) < 0.5) return null;
  t = kept.join(" ").replace(/\s+([,.;:)])/g, "$1").replace(/^[,.;:\-\s]+|[,;:\-\s]+$/g, "").replace(/(?:\s+(?:[A-Za-z]|\d))+$/, "").trim();
  return t.length >= 6 ? t : null;
}

/** True when a line reads like OCR noise rather than printed text. */
export function looksScanned(text: string): boolean {
  // (A quotation's own marks -- “Overdue premium received: S$1,140.00” -- are not scanner noise.)
  const tokens = text.split(/\s+/).filter(Boolean).map((t) => t.replace(/^“(?=[\p{L}\p{N}])/u, "").replace(/(?<=[\p{L}\p{N}.%)])”$/u, "")).filter((t) => t && !/^[·•—–-]$/.test(t));
  const noisy = tokens.filter((t) => !tokenOk(t.replace(NOISE_CHARS, "")) || /[|“”]/.test(t)).length;
  return /[|]|\$\$\d|\b([A-Za-z])\1{2,}\b/.test(text) || (noisy >= 2 && noisy / Math.max(1, tokens.length) >= 0.3);
}
