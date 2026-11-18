/**
 * An overview answer reads as a list, not one long bold sentence (DC, 18 Nov 2026, "Tell me what charmaine has": the
 * bottom line ran five policies and their descriptions together in one bold paragraph, then "She is also linked to the
 * Home Protection Scheme, CareShield Life, an Information Booklet…").
 *
 * A bottom line whose first sentence names three or more things after its subject ("Charmaine has A (…), B (…) and C
 * (…).") keeps only its subject ("Charmaine has:"), and each thing becomes a point of its own, in the answer's order and
 * the model's own words, shown in normal weight as a list. Nothing is reworded and nothing is added: the items are the
 * bottom line's own words, which the checks already passed (no figure ever reaches a bottom line).
 *
 * A sentence that only lists the other documents linked to the person ("She is also linked to …") is taken out of the
 * bottom line and of any point that is not an amount: the policies are the answer; the Documents page lists the rest.
 *
 * Run once, before the answer is saved, so the answer shown, saved and reopened is the same.
 */
import type { AnswerStatement } from "@/components/answer-cards";
import { sentences } from "./verify";

/** The id prefix of a point made from an item of the bottom line (the cards draw consecutive ones as one list). */
export const LEAD_ITEM_ID = "lead-item";

type Listable = { bottomLine?: string | null; summary?: string; statements?: AnswerStatement[] };

/** "She is also linked to …", "He is also linked in DearPolicy to …", "Also linked to her: …": what it names follows. */
const ALSO_LINKED = /^(?:(?:she|he|they|it|[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,3})\s+(?:is|are)\s+also\s+linked\b|also\s+linked\s+to\b)/iu;
/** What a document that holds no cover is called: an "also linked" sentence goes only when everything it names is one. A
 * scheme or plan it names (CareShield Life, a home protection scheme) is cover, and the sentence stays (Critic #546 MED-3). */
const NOT_COVER = /\b(?:booklets?|summar(?:y|ies)|brochures?|guides?|letters?|notices?|illustrations?|forms?|receipts?|fact ?sheets?|leaflets?)\b/i;
/** A part that names cover, whatever else it says: a scheme, a plan, a policy, a rider ("the Kestrel Shield policy
 * document", "the Critical Illness Endorsement", "CareShield Life"; TE #546 F1). */
const NAMES_COVER = /\b(?:schemes?|shields?|plans?|policy|policies|covers?|insurance|assurance|riders?|endorsements?|protect(?:or|ion)|life|care)\b/i;
/** A first sentence that denies, contrasts or limits is never a list: "has no cover for A, B and C" would read as has A,
 * B and C (Critic #546 HIGH-1). */
const NOT_A_LIST = /\b(?:no|not|none|without|except|but|neither|nor|only|never|unless|excluded?|excludes)\b|n['’]t\b/i;
/** An item that starts as a clause, not a name: "but no accident cover", "none of which…", "which pays…". */
const CLAUSE_START = /^(?:but|none|which|who|whose|where|except|or|so|yet|though|although|while|with|including)\b/i;

/** The subject the list belongs to: a member's name (full or any of its words), a pronoun or "your", then has/have/holds. */
function leadOf(sentence: string, names: string[]): { lead: string; rest: string } | null {
  const m = /^(.{1,60}?)\s+(has|have|holds?)\s*:?\s+(.+?)[.!]?$/u.exec(sentence.trim());
  if (!m) return null;
  const subject = m[1].trim();
  // A preferred name in brackets ("Tan Hui Min (Charmaine)") counts as the person too (TE #546 F4).
  const words = new Set(names.flatMap((n) => n.replace(/[()]/g, " ").split(/\s+/)).filter((w) => w.length >= 2).map((w) => w.toLowerCase()));
  const person = /^(?:she|he|they|you|i|we)$/i.test(subject)
    || subject.split(/\s+/).length <= 4 && subject.split(/\s+/).every((w) => words.has(w.replace(/['’]s$/i, "").toLowerCase()));
  return person ? { lead: `${subject} ${m[2]}`, rest: m[3] } : null;
}

/** The parts of a list at the top level (never inside brackets): "A (x, y), B (z) and the C (w)" -> A (x, y) | B (z) |
 * the C (w). The last part is split at "and" only straight after a closing bracket ("B (z) and C (w)"), so a name with
 * "and" in it ("Hospital and Surgical Plan") is never cut (Critic #546 MED-2). */
function itemsOf(rest: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (depth === 0 && (c === "," || c === ";")) { parts.push(rest.slice(start, i)); start = i + 1; }
  }
  parts.push(rest.slice(start));
  // In every part, "and" straight after a closing bracket joins two items ("B (z) and C (w)"; TE #546 F2).
  return parts.flatMap((p) => splitAfterBracket(p.trim().replace(/^and\s+/i, ""))).map((p) => p.trim()).filter(Boolean);
}

/** "B (z) and C (w)" -> B (z) | C (w), only at the top level: "Plan (life (death) and TPD)" is one item (TE #550 N1). */
function splitAfterBracket(part: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) {
      depth--;
      const m = depth === 0 ? /^\s+and\s+/i.exec(part.slice(i + 1)) : null;
      if (m) { out.push(part.slice(start, i + 1)); start = i + 1 + m[0].length; i = start - 1; }
    }
  }
  out.push(part.slice(start));
  return out;
}

/** The parts of a list of names, split at every top-level comma and "and": for telling whether everything an "also
 * linked" sentence names holds no cover (TE #546 F1). */
function namesOf(rest: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (depth === 0 && (c === "," || c === ";")) { parts.push(rest.slice(start, i)); start = i + 1; }
    else if (depth === 0 && rest.slice(i, i + 5).toLowerCase() === " and ") { parts.push(rest.slice(start, i)); start = i + 5; i += 4; }
  }
  parts.push(rest.slice(start));
  return parts.map((p) => p.trim().replace(/^and\s+/i, "").trim()).filter(Boolean);
}

/** Takes the list out of an overview's bottom line, and the "also linked to" sentences that name only documents out of the
 * answer (not when the question is about the documents themselves: then they are the answer). `names`: the household's
 * members. Returns the sentences taken out (the turn's report keeps them). */
export function listFromBottomLine(answer: Listable, opts: { names: string[]; aboutDocuments?: boolean; products?: string[] }): string[] {
  const removed: string[] = [];
  // A product whose own name is a document that holds no cover ("Information Booklet") never keeps a sentence (TE #550 N2).
  const products = (opts.products ?? []).map((p) => p.trim().toLowerCase()).filter((p) => p.length >= 3 && !(NOT_COVER.test(p) && !NAMES_COVER.test(p)));
  const filler = (s: string) => {
    if (opts.aboutDocuments || !ALSO_LINKED.test(s.trim())) return false;
    const named = namesOf(s.trim().replace(/^.*?\blinked\b(?:\s+in\s+DearPolicy)?(?:\s+to\b)?\s*:?\s*/i, "").replace(/[.!]$/, ""));
    // Every part a document that holds no cover, and none naming cover or a cover-holding product of the household.
    return named.length > 0 && named.every((n) => NOT_COVER.test(n) && !NAMES_COVER.test(n) && !products.some((p) => n.toLowerCase().includes(p)));
  };
  answer.statements ??= [];
  const bottom = (answer.bottomLine ?? "").trim();
  const kept = sentences(bottom).filter((s) => {
    if (filler(s)) { removed.push(s); return false; }
    return true;
  });
  let lead = kept.join(" ");
  const items: string[] = [];
  let after = "";
  const first = (kept[0] ?? "").trim();
  const m = NOT_A_LIST.test(first) ? null : leadOf(first, opts.names);
  if (m) {
    const parts = itemsOf(m.rest);
    // Three or more named things, each short enough to be a name with its description and none a clause: a list.
    // Anything else stays as the model wrote it.
    // Every item is a name with its description in brackets, as the overview rule asks: a sentence about amounts that
    // happens to have commas ("death cover under his group term life, …, the amounts are below") is never cut into
    // fragments (Live site tester, post-#546). So a trailing remark ("all in force") or a name cut at a
    // comma never becomes an item; a colon means the list is something else's (TE #546 F2, F3).
    const described = parts.filter((p) => /[)\]]$/.test(p)).length;
    if (parts.length >= 3 && !m.rest.includes(":") && described === parts.length
      && parts.every((p) => p.length <= 160 && !CLAUSE_START.test(p) && !/[.!?]/.test(p.replace(/\([^)]*\)/g, "").replace(/\b(?:Pte|Ltd|Co|Inc|No|St)\./g, "")))) {
      items.push(...parts);
      // The lead introduces the list only: what else the bottom line says follows the list, as a point (Critic #546 LOW-1).
      lead = `${m.lead}:`;
      after = kept.slice(1).join(" ").trim();
    }
  }
  if (lead !== bottom) {
    answer.bottomLine = lead;
    if (answer.summary != null) answer.summary = lead;
  }
  if (answer.statements) {
    answer.statements = answer.statements.flatMap((s) => {
      // A point with its own source is the documents' words, never filler (TE #546 F1).
      if (s.amount || s.table || s.source) return [s];
      const all = sentences(s.text);
      const left = all.filter((x) => !filler(x));
      if (left.length === all.length) return [s];
      removed.push(...all.filter((x) => filler(x)));
      if (!left.length && !(s.conditions ?? []).length) return [];
      const text = left.join(" ");
      return [{ ...s, text, fullText: s.fullText ? text : s.fullText }];
    });
    if (items.length) answer.statements = [
      ...items.map((text, i) => ({ id: `${LEAD_ITEM_ID}-${i + 1}`, kind: "fact", text, fullText: text, conditions: [] } as AnswerStatement)),
      ...(after ? [{ id: "lead-after", kind: "fact", text: after, fullText: after, conditions: [] } as AnswerStatement] : []),
      ...answer.statements,
    ];
  }
  return removed;
}
