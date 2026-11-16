/**
 * What the household sees of an answer is the answer, not the checks behind it (DC, 16 Nov 2026: "non-value adding
 * answers that clutter the answers and do not give a clear answer to the user").
 *
 * The checks themselves are untouched: an amount the server could not tie to a printed row is still left out, and amounts
 * from separate covers are still never added up. Only the sentences that narrate those internal decisions to the
 * household go: "I left out an amount I couldn't find printed in your documents", "These are separate covers. The pages
 * I used don't say whether one affects the other, so the insurer decides. They are not added up.", and the generic
 * "waiting periods ... can be printed on pages not used for this answer" line under every amount. What was left out is
 * still recorded with the turn (the turn report keeps every dropped amount and sentence).
 *
 * An amount card is never touched here: its own text, basis and conditions always stay with its figure. Run once, before
 * the answer is saved, so the answer shown, saved and reopened is the same.
 */
import type { AnswerStatement } from "@/components/answer-cards";
import { LEFT_OUT_AMOUNT, LEFT_OUT_FACT } from "./verify";
import { NARROWED_PAGES_NOTE } from "@/lib/benefit-table/chat";

/** Server notes that only narrate a check: the ids the server gives them. */
export const NARRATION_IDS: ReadonlySet<string> = new Set(["left-out-amount", "left-out-fact", "narrowed-pages"]);

const flat = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").toLowerCase();
const SERVER_NOTES = new Set([LEFT_OUT_AMOUNT, LEFT_OUT_FACT, NARROWED_PAGES_NOTE].map(flat));

/** One sentence that only narrates a check or says amounts from separate covers are not added up. Matched as a whole
 * sentence, so a sentence that also says something of its own (a deadline, a condition, a rule the documents print)
 * always stays. */
const NARRATION: RegExp[] = [
  // "I left out an amount / a point / a statement ..." in any of the server's or the model's own wordings.
  // Only in the notes' own wording (Critic #505 M1: "Left out amounts are those under the rider..." is the model's own point).
  /^i(?:'ve| have)? left out (?:an? |one |some )?(?:amount|figure|point|statement)s? (?:that )?i (?:couldn't|could not|can't|cannot) (?:find|match|confirm)\b[^.]*$/,
  /^i(?:'ve| have)? left out a statement your documents (?:don't|do not) support$/,
  // The separate-covers line, whole or any of its three sentences.
  /^these are separate covers$/,
  /^the pages i used (?:don't|do not) say whether one affects the other,? so the insurer decides$/,
  /^they are not added up$/,
  /^these are separate covers\. the pages i used (?:don't|do not) say whether one affects the other,? so the insurer decides\. they are not added up$/,
];
/** A sentence about what the app shows ("No amount card is shown for it…", "The pages shown do not give an amount for it
 * that can be shown here"): it says no amount is shown, and names a card or what is shown here (DECL-20261116-B/C). */
const aboutTheDisplay = (f: string) => /\b(?:amount|figure)s?\b/.test(f) && /\b(?:no|not|n't|never)\b/.test(f) && /\b(?:cards?|shown here|can be shown|could be shown|be shown here)\b/.test(f);
/** Words after the display clause that carry a point of the documents' own (Critic #505 b70e90b M1). */
const CARRIES_A_POINT = /\b(?:because|since|as|but|except|only|limited|up to|covers?)\b|[;:]/;
const isNarration = (sentence: string) => { const f = flat(sentence); return !!f && (SERVER_NOTES.has(f) || NARRATION.some((r) => r.test(f))); };

/** One sentence as shown: unchanged, rewritten without its display clause ("No amount card is shown for it, as the stay
 * would need to follow an accident." -> "The stay would need to follow an accident."), or null when it only narrates. */
function asShown(sentence: string): { text: string | null; display: boolean } {
  if (isNarration(sentence)) return { text: null, display: false };
  const f = flat(sentence);
  if (!f || !aboutTheDisplay(f)) return { text: sentence, display: false };
  if (!CARRIES_A_POINT.test(f)) return { text: null, display: true };
  // The display clause first, then its reason: only the reason stays, in the sentence's own words.
  const m = /^(.+?)(?:,?\s+(?:as|because|since)\s+|\s*[;:]\s*)(.+)$/.exec(sentence.trim());
  if (m && aboutTheDisplay(flat(m[1])) && !aboutTheDisplay(flat(m[2]))) {
    const rest = m[2].trim();
    return { text: rest.charAt(0).toUpperCase() + rest.slice(1), display: true };
  }
  return { text: sentence, display: false };
}

/** Sentences split at a full stop, ! or ? followed by a capital or an opening quote (as the answer cards split them). */
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map((s) => s.trim()).filter(Boolean);
/** The text with every narrating sentence taken out (or its display clause, when the rest says something); the rest
 * exactly as written. */
export function withoutNarration(text: string): string {
  const all = sentencesOf(text);
  const shown = all.map(asShown);
  if (shown.every((x, i) => x.text === all[i])) return text;
  return shown.flatMap((x) => (x.text ? [x.text] : [])).join(" ");
}

/** Said as a step when an amount was left out and none is shown. */
export const CONFIRM_AMOUNT_STEP = "Ask the insurer to confirm the amount.";
/** Said as a step when an amount was left out and others are shown. */
export const CONFIRM_OTHER_AMOUNT_STEP = "Ask the insurer to confirm whether any other amount applies.";

type Declutterable = { summary?: string; bottomLine?: string | null; details?: string[]; nextSteps?: string[]; statements?: AnswerStatement[] };

/** Takes the narration out of an answer in place. Returns the sentences taken out (for the turn's report). */
export function declutterAnswer(answer: Declutterable): string[] {
  const removed: string[] = [];
  let displayNote = false;
  const clean = (text: string) => {
    const out = withoutNarration(text);
    if (out !== text) for (const s of sentencesOf(text)) { const x = asShown(s); if (x.text !== s) { removed.push(s); if (x.display) displayNote = true; } }
    return out;
  };
  if (answer.statements) {
    answer.statements = answer.statements.filter((s) => {
      if (NARRATION_IDS.has(s.id)) { removed.push(s.text); return false; }
      // An amount card keeps every word: nothing that qualifies a figure is ever taken off it.
      if (s.amount) return true;
      const text = clean(s.text);
      const fullText = s.fullText ? withoutNarration(s.fullText) : s.fullText;
      if (!text.trim() && !(s.conditions ?? []).length) return false;
      s.text = text.trim() ? text : (fullText ?? "");
      s.fullText = fullText;
      return !!s.text.trim() || !!(s.conditions ?? []).length;
    });
  }
  if (typeof answer.bottomLine === "string") answer.bottomLine = clean(answer.bottomLine);
  if (typeof answer.summary === "string") answer.summary = clean(answer.summary);
  if (answer.details) answer.details = answer.details.map(clean).filter((d) => d.trim());
  if (answer.nextSteps) answer.nextSteps = answer.nextSteps.map(clean).filter((d) => d.trim());
  // When an amount was left out, the one thing the household can do about it is said as a step, not as a note about the
  // check. With other amounts still shown, the step says another may apply, so the cards never read as all there is
  // (Critic #505 M2).
  // A sentence saying no amount is shown here is a left-out amount in the model's words: the same step is said.
  const leftOutAmount = removed.some((r) => flat(r) === flat(LEFT_OUT_AMOUNT)) || displayNote;
  if (leftOutAmount && answer.statements) {
    const step = answer.statements.some((s) => s.amount) ? CONFIRM_OTHER_AMOUNT_STEP : CONFIRM_AMOUNT_STEP;
    answer.nextSteps = [...(answer.nextSteps ?? [])];
    if (!answer.nextSteps.some((n) => /\bconfirm\b[^.]*\bamount\b/i.test(n))) answer.nextSteps.push(step);
  }
  return removed;
}
