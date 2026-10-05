/**
 * Round 7 claim-conversation detectors, on top of the Round 6 rubbish
 * detectors (scripts/r6/detectors.ts). Pure functions; no I/O.
 */
import type { ChatAnswer, ClaimItem } from "@/types";
import { visibleFields, type Hit } from "../r6/detectors";

export const GROUP_CARD = /\bPossible cover through\b/;
export const shownCards = (a: ChatAnswer) => (a.claimItems ?? []).filter((i) => i.status !== "not_applicable");
export const isGroupCard = (i: ClaimItem) => GROUP_CARD.test(i.title);
const PROSE = /^(summary|details|nextSteps|question|claim\[\d+\]\.(?:reason|condition)|planQuestion|disclaimer)/;

/** Documents in "Send these documents for the claim: a; b; c." */
export function checklist(a: ChatAnswer): string[] {
  const line = (a.nextSteps ?? []).find((s) => /^Send these documents\b/.test(s));
  if (!line) return [];
  return line.replace(/^[^:]*:\s*/, "").replace(/\.$/, "").split(/;\s*/).map((s) => s.trim()).filter(Boolean);
}
const STOP = new Set(["the", "a", "an", "of", "or", "and", "for", "to", "it", "if", "any", "where", "one", "was", "is", "showing", "stating", "that", "with", "on", "in", "date", "made", "supporting", "confirming", "describing", "issued"]);
const SYN: [RegExp, string][] = [[/histopathology|histology|biopsy|pathology/g, "histo"], [/specialist['’]s|specialist/g, "specialist"], [/receipts?/g, "receipt"], [/bills?/g, "bill"], [/reports?/g, "report"], [/results?/g, "result"]];
function words(s: string) {
  let t = s.toLowerCase();
  for (const [re, w] of SYN) t = t.replace(re, w);
  return new Set(t.replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
/** Two checklist entries asking for the same document in different words. */
export function sameDocument(a: string, b: string) {
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / Math.min(x.size, y.size) >= 0.75 || inter / new Set([...x, ...y]).size >= 0.5;
}

/* ------------------------------------------------------------------------
 * Round 13: the shape of every claim answer with cards, in every suite that
 * runs the Round 6 detectors (scripts/r6/detectors.ts calls this for each
 * claim answer): a short main text, bounded cards, every sentence said once,
 * and every card citing the page its benefit is printed on.
 * ---------------------------------------------------------------------- */
export const CLAIM_MAIN_WORDS = 220;
export const CLAIM_TOTAL_WORDS = 450;
const countWords = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ").split(/\s+/).filter(Boolean).length;
/** One sentence, normalised: case, punctuation and spacing ignored. */
export const normalSentence = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9$%' ]+/g, " ").replace(/\s+/g, " ").trim();
export function claimAnswerParts(a: ChatAnswer) {
  const cards = shownCards(a);
  const main = [a.summary, ...(a.details ?? []), ...(a.nextSteps ?? [])];
  const cardText = cards.flatMap((i) => [i.title, i.amountText, i.reason, ...(i.conditions ?? [])]);
  const limits = (a.policyStatedLimits ?? []).map((l) => (l.ownerName ? l.ownerName + " · " : "") + l.benefitTitle + " " + l.amountText);
  return { cards, mainWords: countWords(main), totalWords: countWords([...main, ...cardText, ...limits]) };
}
/** Sentences said more than once in one answer (summary, details, next steps and every card), normalised. */
export function repeatedSentences(a: ChatAnswer): string[] {
  const seen = new Map<string, number>();
  const prose = [a.summary, ...(a.details ?? []), ...(a.nextSteps ?? []), ...shownCards(a).flatMap((i) => [i.reason, ...(i.conditions ?? [])])];
  for (const text of prose) for (const raw of String(text ?? "").split(/(?<=[.!?])\s+/)) {
    if (raw.trim().length < 25) continue;
    const k = normalSentence(raw);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen].filter(([, n]) => n > 1).map(([s, n]) => n + "x: " + s);
}
export function detectClaimAnswerShape(a: ChatAnswer): Hit[] {
  if (a.mode !== "claim_assessment") return [];
  const { cards, mainWords, totalWords } = claimAnswerParts(a);
  if (!cards.length) return [];
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  if (mainWords > CLAIM_MAIN_WORDS) hit("claim answer too long", mainWords + " words in the answer text (ceiling " + CLAIM_MAIN_WORDS + "): " + a.summary.slice(0, 160));
  if (totalWords > CLAIM_TOTAL_WORDS) hit("claim answer too long with its cards", totalWords + " words with the cards (ceiling " + CLAIM_TOTAL_WORDS + "): " + a.summary.slice(0, 160));
  for (const r of repeatedSentences(a)) hit("repeated sentence in a claim answer", r);
  for (const i of cards) if (!/\(page \d+\)|\bpages? \d+/.test([i.reason, ...(i.conditions ?? [])].join(" "))) hit("claim card without its page", i.title + " — " + i.reason);
  const body = (i: ClaimItem) => normalSentence(i.reason) + "|" + (i.conditions ?? []).map(normalSentence).join("|");
  for (let x = 0; x < cards.length; x++) for (let y = x + 1; y < cards.length; y++)
    if (body(cards[x]) === body(cards[y])) hit("claim card with no distinguishing content", cards[x].title + " ~ " + cards[y].title + ": " + cards[x].reason);
  for (const i of cards) if (!normalSentence(i.reason.replace(/\(page \d+\)/g, ""))) hit("claim card with no distinguishing content", i.title + ": empty reason");
  return hits;
}

export type ClaimTurn = { death?: boolean; serious?: boolean; deny?: RegExp; first: boolean };
export function detectClaimTurn(a: ChatAnswer, t: ClaimTurn): Hit[] {
  const hits: Hit[] = [];
  const hit = (rule: string, text: string) => hits.push({ rule, text: text.slice(0, 260) });
  const fields = visibleFields(a);
  const prose = fields.filter((f) => PROSE.test(f.where));
  // ---------------------------------------------------- one question per turn
  // An example in quotes (“What does my hospital plan pay?”) is not a question put to the family.
  const summaryAsks = (a.summary.replace(/“[^”]*”/g, "").match(/\?/g) ?? []).length;
  if (summaryAsks > 1) hit("more than one question in a turn", a.summary);
  const planQs = (a.factFinding ?? []).flatMap((p) => p.nextQuestions);
  if (!(a.questions ?? []).length && planQs.length && summaryAsks) hit("more than one question in a turn", a.summary + " | " + planQs[0].text);
  // ---------------------------------------------------- promises
  for (const f of prose) {
    const text = f.text.replace(/\bnot a promise[^.]*\./gi, "").replace(/\bLetters?\s+of\s+Guarantee\b/gi, "LOG");
    const m = text.match(/\b(?:you|she|he|they|we|the family) (?:will|would) (?:definitely )?(?:get|receive|be paid)\b|\bguaranteed?\b|\bdefinitely (?:get|be paid|covered|claim)\b|\b(?:is|are|will be|has been) approved\b|\bentitled to\b|\bwill (?:surely|certainly) pay\b|\bconfirm(?:ed)? (?:that )?(?:you|she|he|they) will be paid\b/i);
    if (m && !/\b(?:not|never|cannot|can[’']t|no one can)\b[^.]{0,40}$/i.test(text.slice(0, m.index))) hit("payout promised", f.where + ": " + f.text);
  }
  // ---------------------------------------------------- tone
  if ((t.death || t.serious) && /\b(?:great|good news|awesome|yay|congrat\w*|happy to|glad to|fantastic|exciting|lucky)\b|!/i.test(a.summary)) hit("cheerful wording on a serious event", a.summary);
  if (t.death && t.first && !/\bsorry\b/i.test(a.summary)) hit("no condolence on a death", a.summary);
  // ---------------------------------------------------- cards
  const cards = shownCards(a);
  const titles = cards.map((i) => i.title.replace(/^[^·]*·\s*/, "").toLowerCase());
  const dupTitle = titles.find((x, i) => titles.indexOf(x) !== i);
  if (dupTitle) hit("duplicate card", dupTitle);
  if (t.deny) for (const i of cards) if (t.deny.test(i.title)) hit("benefit that does not fit the event", i.title + " — " + i.reason);
  if (a.mode === "claim_assessment" && cards.length && !(a.questions ?? []).length) {
    for (const i of cards) if (!/\(page \d+\)|pages? \d+/.test(i.reason) && !(a.citations ?? []).length) hit("card without a citation", i.title);
    // Round 13: every card cites its own page (scripts/r6/detectors.ts runs detectClaimAnswerShape on every claim answer).
    if (!(a.citations ?? []).length) hit("claim answer with cards but no citation", a.summary);
  }
  for (const i of cards) if (i.amountText && isGroupCard(i)) hit("group booklet figure shown as a personal amount", i.title + " " + i.amountText);
  // ---------------------------------------------------- checklist
  const docs = checklist(a);
  for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++)
    if (sameDocument(docs[i], docs[j])) hit("duplicate document in checklist", docs[i] + " ~ " + docs[j]);
  const steps = a.nextSteps ?? [];
  const dupStep = steps.find((s, i) => steps.indexOf(s) !== i);
  if (dupStep) hit("duplicate next step", dupStep);
  // ---------------------------------------------------- garbled or unhelpful fallbacks
  if (/\b(?:didn[’']t|did not) find\b[^.]{0,40}\b(?:i|we|my|me|our)\b[^.]{0,40}\bin the parts\b/i.test(a.summary)) hit("garbled echo of the question", a.summary);
  if (/\bmatches what you described\b/i.test(a.summary)) hit("generic 'couldn't find a benefit' for a described event", a.summary);
  if (/\bResponds to what happened as described\b|\bfor what happened, (?:your|[A-Z][a-z]+(?: [A-Z][a-z]+)?’s) policies\b/i.test(a.summary)) hit("event not named in the answer", a.summary);
  // ---------------------------------------------------- summary echoes
  if (/\b(?:Thanks|Thank you)\b[^.]*\.\s*(?:Thanks|Thank you)\b/.test(a.summary)) hit("repeated thanks", a.summary);
  if (/\bsorry for your loss\b[\s\S]*\bsorry for your loss\b/i.test(a.summary)) hit("repeated condolence", a.summary);
  return hits;
}
