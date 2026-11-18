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

/** "She is also linked to …", "He is also linked in DearPolicy to …", "Also linked to her: …". */
const ALSO_LINKED = /^(?:(?:she|he|they|it|[\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,3})\s+(?:is|are)\s+also\s+linked\b|also\s+linked\s+to\b)/iu;

/** A subject and its verb, then the things it names: "Charmaine has", "Desmond's policies are", "Her cover includes". */
const LEAD = /^(.{1,80}?\b(?:has|have|holds?|is covered by|is insured (?:under|by|with)|includes?|are|consists? of)(?:\s+(?:these|the following))?)\s*:?\s+(.+?)[.!]?$/u;

/** The parts of a list at the top level (never inside brackets): "A (x, y), B and the C (z)" -> A (x, y) | B | the C (z).
 * Only the last part is split at "and", at its first one: "B and Hospital and Surgical Plan" -> B | Hospital and Surgical
 * Plan, so a name with "and" in it stays whole unless it is the second of the last pair. */
function itemsOf(rest: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth > 0) depth--;
    else if (depth === 0 && (c === "," || c === ";")) { parts.push(rest.slice(start, i)); start = i + 1; }
  }
  const last = rest.slice(start).trim();
  if (/^and\s+/i.test(last)) parts.push(last);
  else {
    // The first "and" outside brackets in the last part.
    let d = 0, cut = -1;
    for (let i = 0; i < last.length && cut < 0; i++) {
      const c = last[i];
      if (c === "(" || c === "[") d++;
      else if ((c === ")" || c === "]") && d > 0) d--;
      else if (d === 0 && last.slice(i, i + 5).toLowerCase() === " and ") cut = i;
    }
    if (cut >= 0 && parts.length) parts.push(last.slice(0, cut), last.slice(cut + 5));
    else parts.push(last);
  }
  return parts.map((p) => p.trim().replace(/^and\s+/i, "").trim()).filter(Boolean);
}

/** Takes the list out of an overview's bottom line, and the "also linked to" sentences out of the answer. Returns the
 * sentences taken out (the turn's report keeps them). */
export function listFromBottomLine(answer: Listable): string[] {
  const removed: string[] = [];
  const bottom = (answer.bottomLine ?? "").trim();
  const kept = sentences(bottom).filter((s) => {
    if (ALSO_LINKED.test(s.trim())) { removed.push(s); return false; }
    return true;
  });
  let lead = kept.join(" ");
  const items: string[] = [];
  const first = kept[0] ?? "";
  const m = LEAD.exec(first.trim());
  if (m) {
    const parts = itemsOf(m[2]);
    // Three or more named things, each short enough to be a name with its description: a list. Anything else (a sentence
    // with a clause, two things) stays as the model wrote it.
    if (parts.length >= 3 && parts.every((p) => p.length <= 160 && !/[.!?]/.test(p.replace(/\([^)]*\)/g, "").replace(/\b(?:Pte|Ltd|Co|Inc|No|St)\./g, "")))) {
      items.push(...parts);
      lead = [`${m[1].trim()}:`, ...kept.slice(1)].join(" ");
    }
  }
  if (lead !== bottom) {
    answer.bottomLine = lead;
    if (answer.summary != null) answer.summary = lead;
  }
  if (answer.statements) {
    answer.statements = answer.statements.flatMap((s) => {
      if (s.amount || s.table) return [s];
      const all = sentences(s.text);
      const left = all.filter((x) => !ALSO_LINKED.test(x.trim()));
      if (left.length === all.length) return [s];
      removed.push(...all.filter((x) => ALSO_LINKED.test(x.trim())));
      if (!left.length && !(s.conditions ?? []).length) return [];
      const text = left.join(" ");
      return [{ ...s, text, fullText: s.fullText ? text : s.fullText }];
    });
    if (items.length) answer.statements = [
      ...items.map((text, i) => ({ id: `${LEAD_ITEM_ID}-${i + 1}`, kind: "fact", text, fullText: text, conditions: [] } as AnswerStatement)),
      ...answer.statements,
    ];
  }
  return removed;
}
