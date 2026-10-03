/**
 * Round 7: who a household means, in the household's own words.
 *
 * The claim-person resolver (lib/claims/person.ts) knows English kinship
 * words and the names on file. Households also say "mak", "my maid", "our
 * helper", "my son" when there are two children, write "binti" for "binte",
 * drop the apostrophe in "D'Souza", or name a policy ("the Golden Lotus")
 * instead of a person. This resolves only what those words settle beyond
 * doubt and returns null otherwise, so the existing resolver (and its
 * "Who is this about?" card) decides everything else.
 */
import type { ClaimPerson, ClaimPersonResolution } from "@/lib/claims/person";

/** Comparable form of a name: accents, apostrophes and hyphens dropped, binti/bte/bt = binte. */
export function nameKey(value: string) {
  return " " + value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]s\b/g, "").replace(/['’`]/g, "").replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\b(?:binti|bte|bt)\b/g, "binte").replace(/\s+/g, " ").trim() + " ";
}
type Gender = "f" | "m" | null;
/** A Malay patronymic says whether someone is a son (bin, s/o) or a daughter (binte/binti, d/o). */
function genderOf(p: ClaimPerson): Gender {
  const k = nameKey(p.display_name);
  return / (?:binte|d\/o) /.test(k) ? "f" : / (?:bin|s\/o) /.test(k) ? "m" : null;
}
const rel = (p: ClaimPerson) => (p.relationship ?? "").toLowerCase().trim();
const KIN: { re: RegExp; group: (p: ClaimPerson) => boolean; gender: Gender; label: string }[] = [
  { re: /\b(?:mak|emak|ibu|mum|mom|mummy|mommy|mother|mama)\b/i, group: (p) => rel(p) === "parent", gender: "f", label: "mother" },
  { re: /\b(?:ayah|abah|bapa|dad|daddy|father|papa)\b/i, group: (p) => rel(p) === "parent", gender: "m", label: "father" },
  { re: /\b(?:son|anak lelaki|boy)\b/i, group: (p) => rel(p) === "child", gender: "m", label: "son" },
  { re: /\b(?:daughter|anak perempuan|girl)\b/i, group: (p) => rel(p) === "child", gender: "f", label: "daughter" },
  { re: /\b(?:brother|abang|adik lelaki)\b/i, group: (p) => rel(p) === "sibling", gender: "m", label: "brother" },
  { re: /\b(?:sister|adik perempuan)\b/i, group: (p) => rel(p) === "sibling", gender: "f", label: "sister" },
  { re: /\b(?:helper|maid|domestic (?:helper|worker)|fdw|amah)\b/i, group: (p) => /helper|maid|domestic/.test(rel(p)), gender: null, label: "helper" },
];
/** "my car", "my home insurance", "my deductible": the speaker's own policy, whoever else the sentence mentions. */
const OWN_THING = /\bmy (?:own )?(?:car|vehicle|motor|home|house|flat|hdb|ilp|shield|mediguard|hospital plan|polic(?:y|ies)|plans?|insurance|excess|deductible|premiums?|rider)\b/i;
/** Another person's relative ("his wife", "Aisyah's mother", "her brother"): the claims resolver anchors those. */
const RELATIVE_OF = /\b(?:his|her|their|(?!(?:what|that|it|who|there|here|he|she|let|where|how)['’]s)[\p{L}]+['’]s)\s+(?:mak|emak|ibu|mum|mom|mother|mama|dad|father|son|daughter|brother|sister|helper|maid|wife|husband)\b/iu;

export function householdPersonFromWords(message: string, family: ClaimPerson[], products: string[] = [], selectedId = ""): ClaimPersonResolution | null {
  const text = nameKey(message);
  // 1. A full name as the household writes it ("Nur Aisyah binti Rahman", "Maria D'Souza-Reyes").
  const full = family.filter((p) => text.includes(nameKey(p.display_name)));
  if (full.length) {
    const longest = full.sort((a, b) => nameKey(b.display_name).length - nameKey(a.display_name).length);
    const others = longest.slice(1).filter((p) => !nameKey(longest[0].display_name).includes(nameKey(p.display_name).trim()));
    return others.length ? null : { status: "resolved", person: longest[0], explicit: true };
  }
  // A name or preferred name in the message is the existing resolver's to settle.
  const named = family.some((p) => [p.preferred_name ?? "", ...p.display_name.split(/\s+/)].map((w) => nameKey(w).trim())
    .some((w) => w.length >= 3 && !/^(?:bin|binte|nur|muhammad|mohamed|mohd|siti)$/.test(w) && text.includes(" " + w + " ")));
  if (named) return null;
  // "Is termite damage covered?", "Is ICU covered for her?": a thing a policy covers is not a person's name.
  const thing = message.match(/^\s*(?:is|are)\s+([\p{L} -]{2,40}?)\s+covered\b/iu)?.[1];
  const selected = family.find((p) => p.id === selectedId);
  if (thing && selected && !family.some((p) => nameKey(thing).trim().split(" ").some((w) => w.length >= 3 && nameKey(p.display_name + " " + (p.preferred_name ?? "")).includes(" " + w + " ")))
    && !/\b(?:my|our|his|her|their)\s+(?:mak|mum|mom|mother|dad|father|son|daughter|brother|sister|helper|maid|wife|husband)\b/i.test(thing)) return { status: "resolved", person: selected, explicit: false };
  if (RELATIVE_OF.test(message)) return null;
  const selfPeople = family.filter((p) => rel(p) === "self");
  // "and me?", "what about mine?", "back to my ILP", "what's my deductible?": the speaker.
  if (selfPeople.length === 1 && !KIN.some((k) => k.re.test(message))
    && (/^(?:ok(?:ay)?[,\s]+)?(?:and|what about|how about|now)\s+(?:me|mine|myself)\b/i.test(message.trim()) || OWN_THING.test(message) || /\b(?:am i|do i|have i|i have|i am|i['’]m|for me)\b/i.test(message)))
    return { status: "resolved", person: selfPeople[0], explicit: true };
  // 2. Kinship and household words.
  const kin = KIN.filter((k) => k.re.test(message));
  // "my brother Kumar": a name is given, and it is the existing resolver's to check.
  if (kin.some((k) => new RegExp("(?:" + k.re.source + ")\\s+[A-Z][\\p{Ll}]+", "u").test(message))) return null;
  if (!kin.length) return unknownPossessive(message, family, products);
  const possessiveKin = kin.some((k) => new RegExp("(?:" + k.re.source + ")['’]s", "i").test(message));
  if (OWN_THING.test(message) && !possessiveKin) {
    const self = family.filter((p) => rel(p) === "self");
    return self.length === 1 ? { status: "resolved", person: self[0], explicit: true } : null;
  }
  // The last kinship word said is the one meant ("not him, my brother"; "no, I meant my mother").
  const last = kin.map((k) => ({ k, at: Math.max(...[...message.matchAll(new RegExp(k.re.source, "gi"))].map((m) => m.index ?? 0)) })).sort((a, b) => b.at - a.at)[0].k;
  let candidates = family.filter(last.group);
  if (candidates.length > 1 && last.gender) { const g = candidates.filter((p) => genderOf(p) === last.gender); if (g.length) candidates = g; }
  return candidates.length === 1 ? { status: "resolved", person: candidates[0], explicit: true } : null;
}

/** "Show me Ong Siew Hwa's term plan": a capitalised name that is nobody in this household and no policy on file. */
function unknownPossessive(message: string, family: ClaimPerson[], products: string[]): ClaimPersonResolution | null {
  const m = message.match(/\b([A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’-]+){1,3})['’]s\b/u);
  if (!m) return null;
  const tokens = nameKey(m[1]).trim().split(" ");
  const known = new Set(family.flatMap((p) => nameKey(p.display_name + " " + (p.preferred_name ?? "")).trim().split(" ")));
  const productWords = new Set(products.flatMap((p) => nameKey(p).trim().split(" ")));
  if (tokens.some((t) => known.has(t) || productWords.has(t))) return null;
  return { status: "unknown", name: m[1], candidates: family };
}

/** The one person who holds every policy the message names by its product name ("the Golden Lotus", "HelperCare"). */
export function productOwner(message: string, holdings: { productName: string; ownerIds: string[] }[], commonWord: RegExp): string | null {
  const owners = new Set<string>();
  let matched = 0;
  for (const h of holdings) {
    const tokens = h.productName.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 5 && !/\d/.test(t) && !commonWord.test(t) && !/^(?:insurance|policy|plan)$/i.test(t));
    if (!tokens.some((t) => new RegExp("\\b" + t + "\\b", "i").test(message))) continue;
    matched++;
    for (const o of h.ownerIds) owners.add(o);
  }
  return matched && owners.size === 1 ? [...owners][0] : null;
}
