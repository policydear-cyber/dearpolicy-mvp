/**
 * A request for the household's catalogue -- the documents on file, or the policies held -- as opposed to a question
 * about what one of them says, or a report of something that happened ("list my docs", "what documents have I
 * uploaded", "show me my files", "which policies do you have for us").
 *
 * Decided from the shape of the whole message, never from a phrase list: it is short, it opens with a request to
 * list or show, it names a set of documents or policies, and every other word is a pronoun, a possessive, a family
 * member's name, an auxiliary or a word about keeping or uploading. One content word outside that ("claim",
 * "cover", "need", "flood", "damaged", a product name) and it is not a catalogue request: it is answered as what it
 * is. Used by lib/chat/workflow.ts so a catalogue request is answered as one even mid-claim, where it used to be read
 * as the claim's next message.
 */
export type CatalogueRequest = {
  /** "documents": the uploads on file; "policies": the cover held. */
  noun: "documents" | "policies";
  /** Whose: "my", "our", "his", "her", "their", a family member's name with "’s", or null for the household. */
  scope: string | null;
  /** The same request in the words the catalogue answerer reads ("list my documents"). */
  canonical: string;
};

const DOCUMENT_NOUNS = new Set(["docs", "documents", "files", "uploads", "pdfs", "papers", "paperwork", "records", "attachments", "scans"]);
const POLICY_NOUNS = new Set(["policies", "plans", "insurances"]);
/** Words a request opens with when it asks for a list. */
const OPENERS = new Set(["list", "show", "see", "view", "display", "give", "tell", "what", "which", "how", "can", "could", "would", "may", "pls", "please", "plz", "kindly", "hey", "hi", "ok", "okay", "so", "and", "then", "now", "i", "lemme", "let"]);
/** Every other word a catalogue request may hold. */
const GLUE = new Set([
  // asking
  "list", "show", "see", "view", "display", "give", "tell", "what", "which", "how", "many", "can", "could", "would", "may", "will", "want", "wanna", "like", "to", "let", "lemme", "me", "us",
  "pls", "please", "plz", "kindly", "thanks", "thank", "hey", "hi", "ok", "okay", "so", "and", "then", "now", "again", "just", "also", "lah", "leh", "ah", "lor", "quickly",
  // pronouns, possessives, determiners
  "i", "we", "you", "he", "she", "they", "it", "them", "my", "our", "your", "his", "her", "their", "mine", "ours", "the", "a", "an", "all", "every", "each", "of", "any", "these", "those", "that", "this",
  "everything", "ones", "one", "kinds", "kind", "types", "type", "list", "names", "name",
  // auxiliaries
  "do", "does", "did", "have", "has", "had", "got", "gotten", "are", "is", "were", "was", "be", "been", "am", "there", "here",
  // keeping, uploading
  "hold", "holding", "holds", "keep", "keeping", "kept", "store", "stored", "saved", "save", "upload", "uploaded", "sent", "send", "added", "add", "put", "given", "gave", "provided", "shared",
  "on", "in", "into", "with", "for", "about", "under", "file", "record", "account", "app", "system", "dearpolicy", "so", "far", "currently", "already", "ever", "yet", "far", "now", "today",
  "family", "household", "home", "available", "far",
]);
/** Words a catalogue request would not hold even though they look like glue in another sentence. */
const NOT_A_CATALOGUE = /\b(?:if|when|whether|why|should|need\w*|requir\w*|claim\w*|cover\w*|pays?|paid|payout|benefits?|excess|deductible|limit|premium|missing|lost|stolen|damaged|deleted?|removed?|wrong|expired|lapsed|ended|cancel\w*|renew\w*|insurer|hospital|accident|sick)\b/i;

const words = (text: string) => text.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

export function catalogueRequest(message: string, names: string[] = []): CatalogueRequest | null {
  const text = message.trim();
  if (!text || text.length > 140 || NOT_A_CATALOGUE.test(text)) return null;
  const tokens = words(text);
  if (!tokens.length || tokens.length > 14 || !OPENERS.has(tokens[0])) return null;
  const nameWords = new Set(names.flatMap((n) => words(n)));
  let noun: CatalogueRequest["noun"] | null = null;
  let scope: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const possessive = /'s?$/.test(raw) && raw.length > 2;
    const t = raw.replace(/'s?$/, "");
    if (DOCUMENT_NOUNS.has(t) || POLICY_NOUNS.has(t)) {
      // One set per request: "list my policies and files" is still the catalogue, of documents.
      noun = DOCUMENT_NOUNS.has(t) ? "documents" : noun ?? "policies";
      continue;
    }
    if (nameWords.has(t)) {
      if (possessive || tokens[i - 1] === "for") scope = scope ?? names.find((n) => words(n).includes(t))!.trim() + "’s";
      continue;
    }
    if (!GLUE.has(t)) return null;
    if (!scope && /^(?:my|our|his|her|their)$/.test(t) && i + 1 < tokens.length) scope = t;
    if (!scope && t === "us" && tokens[i - 1] === "for") scope = "our";
    if (!scope && t === "me" && tokens[i - 1] === "for") scope = "my";
  }
  if (!noun) return null;
  // "what's on the list", "show me" alone are not catalogue requests: the set must be named in the plural above, and
  // the request must open as one ("list", "show", "what/which ... ", "how many ...", or a polite "can you ...").
  const opener = tokens.find((t) => !/^(?:pls|please|plz|kindly|hey|hi|ok|okay|so|and|then|now|can|could|would|may|you|i|lemme|let|me|us|to|want|wanna|like)$/.test(t));
  if (!opener || !/^(?:list|show|see|view|display|give|tell|what|which|how)$/.test(opener)) return null;
  // "What documents have I uploaded": the asker's own; "what plans do we have": the household's.
  const whose = scope ?? (tokens.some((t) => t === "i" || t === "me") && !tokens.some((t) => t === "we" || t === "us") ? "my" : tokens.some((t) => t === "we" || t === "us") ? "our" : "all the");
  return { noun, scope, canonical: "list " + whose + " " + (noun === "documents" ? "documents" : "policies") };
}
