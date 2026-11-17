/** The note an answer's bottom line carries when cover may be missing from it (lib/simple-chat/verify.ts
 * noteCoverNotCounted): "This may not be all of X's cover: <documents> ..., so any cover in them is not counted here and the
 * amounts shown are not a total." and "The cover shown from <document> may be incomplete (...), so the amounts shown may not
 * be a total." Kept here, free of server code, so the page can tell the note from the answer's own words. */
export const COVER_NOTE = /\s*(?:This may not be all of [^:.]{1,200}?(?:’|')s cover: [\s\S]*?, so any cover in (?:it|them) is not counted here and the amounts shown are not a total\.|The cover shown from [^.]{1,300}? may be incomplete \([^)]{1,200}\), so the amounts shown may not be a total\.)/g;
