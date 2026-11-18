/** The note an answer carries when cover may be missing from it (lib/simple-chat/verify.ts noteCoverNotCounted).
 * Kept here, free of server code, so the page can tell the note from the answer's own words.
 *
 * Today the note is one short line, the answer's last point (id COVER_NOTE_ID): "Kestrel Whole Life is not fully read, so
 * some details may be missing." or "Three documents are not fully read, so some details may be missing (the Documents
 * page shows which)." or "... is still being read, so its details are not included yet." (DC, 18 Nov 2026).
 *
 * COVER_NOTE also matches the note as answers saved before then wrote it, inside the bottom line: "This may not be all of
 * X's cover: <documents> ..., so any cover in them is not counted here and the amounts shown are not a total." and "The
 * cover shown from <document> may be incomplete (...), so the amounts shown may not be a total." A bottom line the model
 * repeats from an earlier turn has either taken out. */
export const COVER_NOTE_ID = "cover-note";
const NOW = String.raw`[A-Z][^.!?]{0,300}? (?:is|are) (?:not fully read, so some details may be missing(?: \(the Documents page shows which\))?|still being read, so (?:its|their) details are not included yet)\.`;
export const COVER_NOTE = new RegExp(String.raw`\s*(?:This may not be all of [^:.]{1,200}?(?:’|')s cover: [\s\S]*?, so any cover in (?:it|them) is not counted here and the amounts shown are not a total\.|The cover shown from [^.]{1,300}? may be incomplete \([^)]{1,200}\), so the amounts shown may not be a total\.|(?<=^|[.!?]\s*)${NOW})`, "g");
/** Whether a point says nothing but the note (in either wording): one the model repeated from an earlier turn. */
export const isCoverNote = (text: string) => !!text.trim() && !text.replace(COVER_NOTE, "").trim();
