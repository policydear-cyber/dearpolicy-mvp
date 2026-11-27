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

/** The insurer as a household should see it, or null when the stored value is not a name. A reading can pick up a slogan or a
 * sentence from a cover page ("Protecting what matters most to you!"); naming that as the insurer is worse than saying the
 * insurer is not known yet. Only what no company name looks like is dropped: a question or exclamation mark, a semicolon, or
 * nine or more words. Legal-form words and full stops ("Co. Ltd.") stay a name. */
export function shownInsurer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || /[!?;]/.test(name) || name.split(" ").length > 8) return null;
  return name;
}
