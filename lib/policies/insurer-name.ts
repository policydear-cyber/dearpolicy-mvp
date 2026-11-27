/** One insurer, however its documents print its name: for matching a policy to its wording, in any market. Letters and
 * digits only, without the words that name only a legal form ("Zurich Insurance Company Ltd" and "Zurich Insurance
 * Company Limited" are one insurer). A rebrand printed under both names is one insurer: "Singapore Life Ltd" is
 * Singlife, while "Aviva" alone is another insurer elsewhere and is left as it is. */
const LEGAL_FORM = new Set(["ltd", "limited", "pte", "pvt", "sdn", "pty", "gmbh", "plc", "inc", "incorporated", "llc", "berhad", "bhd", "co", "company", "corp", "corporation", "sa", "ag", "nv", "the"]);
const REBRANDS: Record<string, string> = { singaporelife: "singlife", singlifewithaviva: "singlife", singaporelifesinglife: "singlife" };

export function canonicalInsurer(value: string | null | undefined): string | null {
  const words = (value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length) return null;
  // "Private" is a legal form only before "Limited" ("Example Assurance Private Limited"): "Private Health Mutual" is a name.
  const name = words.filter((w, i) => !LEGAL_FORM.has(w) && !(w === "private" && /^(?:limited|ltd)$/.test(words[i + 1] ?? ""))).join("") || words.join("");
  return REBRANDS[name] ?? name;
}

/** The insurer as a household should see it, or null when the stored value is not a name. A reading can pick up a slogan, a
 * sentence or a placeholder from a cover page ("Protecting what matters most to you!", "N/A"); naming that as the insurer is
 * worse than saying the insurer is not known yet. Only what no company name looks like is dropped: a placeholder, a question
 * mark, a semicolon, a closing exclamation mark after three or more words, two sentence ends or a phrase of four or more words ending in a full stop, or thirteen or more words outside brackets and a
 * ", ... Branch" clause. Bracketed clauses ("(formerly ...)", "(Reg. No. ...)"), a branch clause, a one- or two-word brand
 * ending in "!" ("Yahoo!") and a mid-name "!" ("Yahoo! Insurance") are part of real names and stay. */
const PLACEHOLDER = /^(?:n\/?a|none|nil|null|undefined|unknown|not (?:applicable|stated|known|available|provided)|[-–—.?]+)$/i;
export function shownInsurer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  const outside = name.replace(/\([^)]*\)?/g, " ").replace(/,[^,]*\bbranch\b[^,]*$/i, " ").replace(/\s+/g, " ").trim();
  if (!outside || PLACEHOLDER.test(outside) || /[?;]/.test(name) || outside.split(" ").length > 12) return null;
  // Sentences: "Better Protection. For All. For Life." is a slogan. Full stops that end an abbreviation ("Co.", "Ltd.", "Pte.", "S.A.")
  // belong to real names and are not counted; two sentence ends, or one ending a phrase of four or more words, is not a name.
  const bare = outside.replace(/\b(?:[a-z]\.){2,}/gi, " ").replace(/\b(?:co|ltd|pte|pvt|inc|corp|bhd|sdn|plc|llc|no|reg|ag|sa|nv)\./gi, " ").replace(/\s+/g, " ").trim();
  const ends = (bare.match(/[a-z0-9)]\.(?=\s|$)/gi) ?? []).length;
  if (ends >= 2 || (ends === 1 && /\.$/.test(bare) && bare.split(" ").length >= 4)) return null;
  if (/!$/.test(name) && outside.split(" ").length > 2) return null;
  return name;
}
