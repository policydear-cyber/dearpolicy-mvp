/**
 * What the chat page shows for one assistant message (Round 6): the message body, then each question once, as its
 * card (question + why it matters), then the rest of the answer. The question card is the ONE place a question is
 * presented: the answer's body never carries it (lib/rag2/loop/hook.ts), and bodyWithoutQuestions removes a copy an
 * older saved message still has in its text. renderedAssistantText is the same view as plain text -- used by the
 * live-smoke checker and the transcripts, so they grade what the household actually sees.
 */
import type { ChatAnswer } from "@/types";
import { answerText } from "@/components/answer-text";

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/** The message body without a question that is shown as a card (a copy kept in older saved messages). */
export function bodyWithoutQuestions(body: string, questions: { text: string }[] = []): string {
  let out = body ?? "";
  for (const q of questions) {
    const text = squash(q?.text ?? "");
    if (!text) continue;
    const at = squash(out).lastIndexOf(text);
    if (at < 0) continue;
    out = squash(out);
    out = (out.slice(0, at) + out.slice(at + text.length)).replace(/\s{2,}/g, " ").trim();
  }
  return out;
}

/** True when the answer's other parts belong under "Show full assessment" (a claim assessment or a fact-finding
 * plan), not beside its question. */
export function hasAssessment(a: Partial<ChatAnswer>): boolean {
  return !!(a.factFinding?.length || a.claimItems?.length || a.composition || a.mode === "claim_assessment");
}

/** The assistant message as the chat page renders it, as plain text (one part per line). */
export function renderedAssistantText(content: string | null | undefined, a: Partial<ChatAnswer> & Record<string, any>): string {
  const questions = (a.questions ?? []) as { text: string; why?: string }[];
  const parts = [
    bodyWithoutQuestions(content ?? a.summary ?? "", questions),
    ...(a.details ?? []),
    ...questions.flatMap((q) => [q?.text ?? "", q?.why ?? ""]),
    ...(questions.length ? [] : (a.nextSteps ?? []).slice(0, 1)),
    a.disclaimer ?? "",
  ];
  return parts.filter((x) => typeof x === "string" && x.trim()).map((x) => answerText(x)).join("\n");
}
