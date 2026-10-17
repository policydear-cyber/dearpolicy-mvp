/**
 * Grader v9 -- a SEPARATE, revised assessment (PR #55 follow-up). The original verdicts (v8, v8.2: structured-check.ts)
 * are never edited: this file re-reads the same saved answers with two product rules recorded first in
 * docs/rag-migration/reliable-chat/EXPECTED-structured-answers.md (Round 3):
 *   R2  a next step is required only when the household asks what to do, or an unresolved issue needs an external action;
 *       a direct numerical correction may end with the corrected illustration and the withdrawal of the earlier one;
 *   R3  an honest NEGATED statement about the two documents ("not established as payable together") is not a total.
 * Everything else (every other check) is the original grader's result, unchanged. Both versions are reported side by side.
 */
import { STRUCTURED_GRADERS, type Graded } from "./structured-check";

export const REGRADE_VERSION = "v9";
const lines = (v: string) => v.split("\n").filter(Boolean);
const visibleOf = (a: any) => [a?.summary, ...(a?.details ?? []), ...((a?.questions ?? []) as any[]).map((q) => q.text), ...(a?.nextSteps ?? [])].filter(Boolean).join("\n");
const CONTACT = /Contact Aldermoor Life Ltd/;
/** R2(a): the household asks what to do / what is needed / how to claim / whom to contact. */
export const ASKS_WHAT_TO_DO = /\b(?:what (?:should|do|can|must) (?:we|i)\b|what (?:do|would|will) (?:we|i) need|how (?:do|can|should) (?:we|i) (?:claim|file|apply|go about)|what (?:documents?|paperwork|forms?)\b|(?:who|where) (?:should|do|can) (?:we|i) (?:contact|call|write|ask)|next steps?|what happens next)\b/i;
/** R2(c): a direct numerical correction ("sorry, it was his hip ... what could it be worth / become?"). */
export const DIRECT_NUMERIC_CORRECTION = /\b(?:correction|sorry|actually|i meant|i had that wrong|not (?:his|her|the)\b|it was (?:his|her|the))\b[\s\S]*\b(?:become|worth|pay|amount|work out|illustration|how much)\b/i;
/** R2(b): the answer itself leaves an issue only the insurer or another party can settle. */
export const NEEDS_EXTERNAL_ACTION = /\b(?:neither document says|do(?:es)? not establish|has not (?:been )?(?:established|confirmed)|only the insurer|insurer (?:to confirm|must confirm|decides?)|ask the insurer)\b/i;
export function nextStepRequired(userMessage: string, answerText: string): boolean {
  if (ASKS_WHAT_TO_DO.test(userMessage)) return true;
  if (DIRECT_NUMERIC_CORRECTION.test(userMessage)) return false;
  return NEEDS_EXTERNAL_ACTION.test(answerText);
}
/** R3: remove honest negations of "together" claims before looking for a total. */
export const NEGATED_TOGETHER = /(?:do(?:es)? not|cannot|can't|can not|should not|should never|never|not)\b[^.\n]{0,100}\b(?:claimed together|payable together|paid together|added(?: together| up)?|combined|added to|a total)\b/gi;
export function claimsATotal(text: string): boolean {
  const t = text.replace(/never a total|or adds to the other/gi, "").replace(NEGATED_TOGETHER, "");
  return /S\$302,500|in total|combined|together|\bplus\b|sum of the two|add(?:ed)? up|added/i.test(t);
}

function swap(g: Graded, id: string, ok: boolean, name: string, detail: string): Graded {
  const checks = g.checks.map((c) => (c.id === id ? { ...c, ok, name: `${name} [v9; ${c.ok ? "v8.2 also passed" : "v8.2 failed"}]`, detail } : c));
  return { ...g, checks, verdict: g.verdict === "PASS" || g.verdict === "FAIL" ? (checks.every((c) => c.ok) ? "PASS" : "FAIL") : g.verdict };
}
/** Grade one scenario by v9: the v8.2 result with U1 (correction journeys), Q6 (ambiguity journeys) and C3 (comparison) revised. */
export function gradeV9(scenario: string, conv: any): Graded {
  const base = STRUCTURED_GRADERS[scenario](scenario, conv);
  const turns = (conv?.loaded?.turns ?? []) as any[];
  const users = ((conv?.turns ?? []) as any[]).map((t) => String(t?.user ?? ""));
  const lastUser = users.at(-1) ?? "", lastText = visibleOf(turns.at(-1)?.answer);
  let g = base;
  if (g.checks.some((c) => c.id === "U1")) {
    const need = nextStepRequired(lastUser, lastText);
    g = swap(g, "U1", !(turns.at(-1)?.answer?.questions ?? []).length && (!need || CONTACT.test(lastText)), `final turn: no pending question; a contact step only where R2 requires one (required here: ${need})`, lastText.slice(0, 700));
  }
  if (g.checks.some((c) => c.id === "Q6")) {
    const need = nextStepRequired(lastUser, lastText);
    g = swap(g, "Q6", !(turns.at(-1)?.answer?.questions ?? []).length && (!need || CONTACT.test(lastText)), `turn 2: the question is not asked again; a contact step only where R2 requires one (required here: ${need})`, lastText.slice(0, 700));
  }
  if (g.checks.some((c) => c.id === "C3")) {
    g = swap(g, "C3", !claimsATotal(lastText) && /(?:neither document says|do not establish|does not say|unclear|not established)/i.test(lastText), "the two figures are alternatives from separate documents, never added, combined or said payable together without evidence", lastText.slice(0, 900));
  }
  void lines;
  return g;
}
