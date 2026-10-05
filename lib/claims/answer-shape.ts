/**
 * Round 13: the shape of a claim answer.
 *
 * A claim answer is read top to bottom by someone who has just had something
 * happen, so every sentence in it is said once:
 *
 *  - a short lead (who, what happened, the most relevant possible benefit and
 *    the next action) -- written by lib/chat/fact-finding-chat.ts;
 *  - compact cards: the benefit, what it pays as printed with its page, and at
 *    most two conditions that are specific to that card;
 *  - what applies to several cards ("Before you claim"), said once in the
 *    answer's details;
 *  - one de-duplicated document checklist and one closing line.
 *
 * tidyClaimAnswer() enforces that on any claim answer with cards, whatever
 * path wrote it (the concluded interview, a what-if, a preliminary
 * assessment), and the claim pack (lib/claims/claim-pack.ts) reads the same
 * helpers so the printed sheet never repeats itself either.
 */
import type { ChatAnswer, ClaimItem } from "@/types";

/** One sentence, normalised for comparison (case, punctuation and spacing ignored). */
export function sentenceKey(sentence: string) {
  return sentence.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9$%' ]+/g, " ").replace(/\s+/g, " ").trim();
}
export function sentencesOf(text: string): string[] {
  return String(text ?? "").split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((s) => s.trim()).filter(Boolean);
}
/** A caveat several cards shared, said once for all of them. */
export function forSeveral(sentence: string) {
  return sentence.replace(/\bthis benefit’s\b/g, "these benefits’").replace(/\b([Tt])his benefit\b/g, (_, t) => (t === "T" ? "These" : "these") + " benefits")
    .replace(/\b(these benefits) (pays|applies|responds|needs|depends|has|is|was)\b/gi, (_, b, v) => b + " " + ({ pays: "pay", applies: "apply", responds: "respond", needs: "need", depends: "depend", has: "have", is: "are", was: "were" } as Record<string, string>)[v.toLowerCase()])
    .replace(/\babove this row\b/g, "above each row").replace(/\bthis row\b/g, "each row")
    .replace(/(\bthese benefits\b.*)\b(?:shown|paid|worked out) for it\b/i, (m) => m.replace(/ for it$/, " for them"));
}
/** Sentences several cards' reasons shared, said once below the cards as one line. */
export function sharedReasonLine(sentences: string[]) {
  return sentences.length ? "For all of these benefits: " + sentences.map(forSeveral).join(" ") : null;
}
/** Short sentences ("Pays as charged.") are a card's label, not a repeat. */
const COMPARABLE = 25;
const comparable = (s: string) => s.trim().length >= COMPARABLE;
const shown = (a: Pick<ChatAnswer, "claimItems">) => (a.claimItems ?? []).filter((i) => i.status !== "not_applicable");
/** "Lim Wei Jie · TermSecure 20 — Sum assured - death" -> "Sum assured - death". */
export function benefitName(title: string) {
  const afterPerson = title.split(" · ").slice(1).join(" · ") || title;
  return (afterPerson.includes(" — ") ? afterPerson.split(" — ").slice(1).join(" — ") : afterPerson).trim();
}
const PAGE = /\(page \d+\)|\bpages? \d+/;
const OWN_BASIS = /^(?:Assumes the standard|Not yet verified)/;

/** The page a card's benefit is printed on, from the answer's citations, when only one page can be meant. */
function pageFor(item: ClaimItem, citations: ChatAnswer["citations"]): number | null {
  const own = item.calculationId ? citations.find((c) => c.chunkId === (item.calculationId!.includes(":") ? item.calculationId : "benefit:" + item.calculationId)) : undefined;
  if (own?.pageStart) return own.pageStart;
  const label = (item.coverLabel ?? "").trim();
  const cited = citations.filter((c) => c.pageStart && (label ? c.policyName === label : item.title.includes(c.policyName)));
  const pages = [...new Set(cited.map((c) => c.pageStart!))];
  return pages.length === 1 ? pages[0] : null;
}

/** Repeats removed from a list of lines: a line already said (or each of its sentences already said) is dropped. */
export function withoutRepeats(lines: string[], said = new Set<string>()): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const kept = sentencesOf(line).filter((s) => { const k = sentenceKey(s); if (comparable(s) && said.has(k)) return false; if (comparable(s)) said.add(k); return true; });
    if (kept.length) out.push(kept.join(" "));
  }
  return out;
}

/** "Send these documents for the claim: a; b; c." with each document once. */
export function dedupeChecklistStep(step: string, dedupe: (labels: string[]) => string[]) {
  const m = step.match(/^(Send these documents for the claim|Documents to attach|Gather):\s*(.*?)\.?$/);
  if (!m) return step;
  const docs = dedupe(m[2].split(/;\s*/).map((d) => d.trim()).filter(Boolean));
  return m[1] + ": " + docs.join("; ") + ".";
}

export type TidyOptions = { dedupeDocuments?: (labels: string[]) => string[]; maxConditions?: number };
/**
 * Every sentence of a claim answer said once:
 *  1. a sentence on two or more cards moves off them and is said once below the cards;
 *  2. a card keeps what its benefit pays with the page, and at most two conditions of its own;
 *  3. cards whose whole text would read the same are told apart by the benefit's name;
 *  4. the details, the summary and the next steps never say again what is already said.
 */
export function tidyClaimAnswer(answer: ChatAnswer, options: TidyOptions = {}) {
  const cards = shown(answer);
  if (!cards.length) return answer;
  const maxConditions = options.maxConditions ?? 2;
  // ---------------------------------------------------- within a card
  for (const card of cards) {
    const reason = sentencesOf(card.reason);
    const seen = new Set(reason.map(sentenceKey));
    card.conditions = [...new Set(card.conditions)].filter((c) => { const k = sentenceKey(c); if (seen.has(k)) return false; seen.add(k); return true; });
    // A condition that only repeats a reason sentence in other words is not a condition.
    card.reason = reason.filter((s, i) => reason.findIndex((x) => sentenceKey(x) === sentenceKey(s)) === i).join(" ");
  }
  // ---------------------------------------------------- shared across cards
  const shared: string[] = [];
  if (cards.length > 1) {
    const where = new Map<string, { text: string; cards: Set<ClaimItem>; reason: boolean }>();
    for (const card of cards) for (const [s, reason] of [...sentencesOf(card.reason).slice(1).map((x) => [x, true] as const), ...card.conditions.flatMap(sentencesOf).map((x) => [x, false] as const)]) {
      // What a card's own figure rests on ("Assumes the standard rule …", "Not yet verified …") stays on the card.
      if (!comparable(s) || OWN_BASIS.test(s)) continue;
      const k = sentenceKey(s);
      const entry = where.get(k) ?? { text: s, cards: new Set<ClaimItem>(), reason };
      entry.cards.add(card); where.set(k, entry);
    }
    const moved = new Set([...where].filter(([, e]) => e.cards.size > 1).map(([k]) => k));
    for (const card of cards) {
      const reason = sentencesOf(card.reason);
      card.reason = [reason[0], ...reason.slice(1).filter((s) => !moved.has(sentenceKey(s)))].filter(Boolean).join(" ");
      card.conditions = card.conditions.map((c) => sentencesOf(c).filter((s) => !moved.has(sentenceKey(s))).join(" ")).filter(Boolean);
    }
    const reasons = [...moved].filter((k) => where.get(k)!.reason).map((k) => where.get(k)!.text);
    const line = sharedReasonLine(reasons);
    if (line) shared.push(line);
    for (const k of moved) if (!where.get(k)!.reason) shared.push(forSeveral(where.get(k)!.text));
  }
  // ---------------------------------------------------- the page each card is printed on
  for (const card of cards) {
    if (PAGE.test(card.reason) || card.conditions.some((c) => PAGE.test(c))) continue;
    const page = pageFor(card, answer.citations ?? []);
    if (!page) continue;
    // The page goes with what the card says the benefit pays (its first sentence).
    const [first, ...rest] = sentencesOf(card.reason);
    card.reason = [(first ?? "Listed in the policy").replace(/[.\s]+$/, "") + " (page " + page + ").", ...rest].join(" ");
  }
  // ---------------------------------------------------- at most two conditions per card
  const overflow: string[] = [];
  for (const card of cards) {
    if (card.conditions.length <= maxConditions) continue;
    // What is still needed for this card stays on it first.
    const weight = (c: string) => (OWN_BASIS.test(c) ? 2 : 0) + (/^Still needed:/.test(c) ? 1 : 0);
    const ranked = [...card.conditions].sort((a, b) => weight(b) - weight(a));
    const keep = new Set(ranked.slice(0, maxConditions));
    for (const c of card.conditions) if (!keep.has(c)) overflow.push(benefitName(card.title) + ": " + c.replace(/^./, (x) => x.toLowerCase()));
    card.conditions = card.conditions.filter((c) => keep.has(c));
  }
  // ---------------------------------------------------- cards that would read the same
  // Two cards that open with the same sentence ("This plan pays the actual cost, up to the policy limit.") are told apart by their names.
  const bodyKey = (card: ClaimItem) => sentenceKey(sentencesOf(card.reason)[0] ?? "");
  const bodies = new Map<string, ClaimItem[]>();
  for (const card of cards) { const k = bodyKey(card); bodies.set(k, [...(bodies.get(k) ?? []), card]); }
  for (const [k, same] of bodies) {
    if (same.length < 2) continue;
    void k;
    for (const card of same) {
      const name = benefitName(card.title);
      if (!name || sentenceKey(card.reason).startsWith(sentenceKey(name))) continue;
      card.reason = name + ": " + card.reason.replace(/^./, (x) => x.toLowerCase());
    }
  }
  // ---------------------------------------------------- said once across the answer
  const said = new Set<string>();
  for (const s of sentencesOf(answer.summary)) if (comparable(s)) said.add(sentenceKey(s));
  for (const card of cards) for (const s of [...sentencesOf(card.reason), ...card.conditions.flatMap(sentencesOf)]) if (comparable(s)) said.add(sentenceKey(s));
  const details = withoutRepeats([...answer.details, ...shared.filter((s) => !answer.details.some((d) => sentenceKey(d).includes(sentenceKey(s)))), ...overflow], said);
  // A sentence another one already says in full ("The payout rule … not been fully verified." inside
  // "DearPolicy has withheld the amount: The payout rule … not been fully verified.") is not said again.
  const everything = [...said, ...details.flatMap(sentencesOf).map(sentenceKey)];
  answer.details = details.map((line) => sentencesOf(line).filter((x) => { const k = sentenceKey(x); return !comparable(x) || !everything.some((o) => o !== k && o.length > k.length && o.includes(k)); }).join(" ")).filter(Boolean);
  const steps = (answer.nextSteps ?? []).map((s) => options.dedupeDocuments ? dedupeChecklistStep(s, options.dedupeDocuments) : s);
  // A "Gather:" or "Attach:" line whose documents are all in the checklist already says nothing new.
  const checklist = steps.find((s) => /^Send these documents for the claim:/.test(s));
  const listed = new Set((checklist?.replace(/^[^:]*:\s*/, "").replace(/\.$/, "").split(/;\s*/) ?? []).map((d) => sentenceKey(d)));
  answer.nextSteps = withoutRepeats(steps.filter((s, i) => steps.indexOf(s) === i).filter((s) => {
    const m = s.match(/^(?:Gather|Attach):\s*(.*?)\.?$/);
    return !m || !checklist || m[1].split(/;\s*/).some((d) => !listed.has(sentenceKey(d)));
  }), said);
  return answer;
}

/** Words a household reads in the answer's own text (summary, details, next steps). */
export function claimAnswerWords(answer: Pick<ChatAnswer, "summary" | "details" | "nextSteps">) {
  return [answer.summary, ...answer.details, ...answer.nextSteps].join(" ").split(/\s+/).filter(Boolean).length;
}
