/** The note an answer carries when cover may be missing from it (lib/simple-chat/verify.ts noteCoverNotCounted).
 * Kept here, free of server code, so the page can tell the note from the answer's own words.
 *
 * Today the note is one short line, the answer's last point (id COVER_NOTE_ID): "Kestrel Whole Life is not fully read, so
 * some details may be missing." or "Three documents are not fully read, so some details may be missing (the Documents
 * page shows which)." or "... is still being read, so its details are not included yet." (DC, 18 Nov 2026). Its subject
 * is only ever a count of documents or the household's own product names, so only those sentences are matched: never a
 * sentence of the model's own that ends the same way ("..., but it is not fully read, ...": Critic #539 MED1).
 *
 * COVER_NOTE also matches the note as answers saved before then wrote it, inside the bottom line: "This may not be all of
 * X's cover: <documents> ..., so any cover in them is not counted here and the amounts shown are not a total." and "The
 * cover shown from <document> may be incomplete (...), so the amounts shown may not be a total." A bottom line the model
 * repeats from an earlier turn has either taken out. */
export const COVER_NOTE_ID = "cover-note";
const COUNT = String.raw`(?:One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|\d{1,3}) documents?`;
const TAIL = String.raw` (?:is|are) (?:not fully read, so some details may be missing(?: \(the Documents page shows which\))?|still being read, so (?:its|their) details are not included yet)\.`;
const OLD = String.raw`This may not be all of [^:.]{1,200}?(?:’|')s cover: [\s\S]*?, so any cover in (?:it|them) is not counted here and the amounts shown are not a total\.|The cover shown from [^.]{1,300}? may be incomplete \([^)]{1,200}\), so the amounts shown may not be a total\.`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The note in any of its wordings, for a household whose product names are `names` (none: the count form only). */
export function coverNotePattern(names: readonly string[] = []): RegExp {
  const named = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length).map(escape);
  const one = named.length ? `(?:${named.join("|")})` : null;
  const subject = one ? `(?:${COUNT}|${one}(?: and ${one})?)` : COUNT;
  return new RegExp(String.raw`\s*(?:${OLD}|(?<=^|[.!?]\s*)${subject}${TAIL})`, "g");
}
export const COVER_NOTE = coverNotePattern();
/** Whether a point says nothing but the note (in any wording): one the model repeated from an earlier turn. */
export const isCoverNote = (text: string, names: readonly string[] = []) => !!text.trim() && !text.replace(coverNotePattern(names), "").trim();
