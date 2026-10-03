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
    const text = f.text.replace(/\bnot a promise[^.]*\./gi, "").replace(/\bLetters? of Guarantee\b/gi, "LOG");
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
