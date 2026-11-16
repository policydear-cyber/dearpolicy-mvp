/**
 * The live chat's side of "Replaced" (TE-ACC-20261116 journey 4): when a correcting answer arrives ("Actually it was
 * Daniel, not Grace"), the earlier answer it replaced is marked on screen at once, exactly as the reopened chat marks it.
 *
 * The server decides which earlier answers are replaced, from the chat's saved state with the same rule the reopened
 * chat uses (lib/chat/stale-answers.ts replacedEarlierAnswers -> correctedAnswers -> supersededIn), and sends each one's
 * replacement with the finished answer. This module only matches them to the answers on screen: no rule of its own.
 * Plain data, no server imports, so the page can use it.
 */
import type { ChatAnswer } from "@/types";

/** One earlier answer a later turn replaced: its key (answerKey) and the answer as the reopened chat serves it. */
export type ReplacedAnswer = { key: string; answer: ChatAnswer };

/** What identifies a saved answer on screen and on the server: its answerId, else its first worked calculation's id. */
export function answerKey(a: Partial<ChatAnswer> | null | undefined): string | null {
  if (!a || typeof a !== "object") return null;
  if (typeof a.answerId === "string" && a.answerId) return `answer:${a.answerId}`;
  const calc = (Array.isArray(a.calculations) ? a.calculations : []).find((c) => typeof c?.id === "string" && c.id);
  return calc ? `calc:${calc.id}` : null;
}

/** The messages on screen with each replaced answer swapped for the server's replacement, and its text for the
 * replacement's (as the reopened chat shows a replaced answer's notice, never its old text). Anything else is kept as is. */
export function applyReplaced<M extends { content: string; answer?: ChatAnswer }>(messages: M[], replaced: ReplacedAnswer[] | null | undefined): M[] {
  if (!Array.isArray(replaced) || !replaced.length) return messages;
  const by = new Map(replaced.filter((r) => r && typeof r.key === "string" && r.answer).map((r) => [r.key, r.answer]));
  return messages.map((m) => {
    const key = answerKey(m.answer);
    const next = key ? by.get(key) : undefined;
    return next ? { ...m, answer: next, content: typeof next.summary === "string" ? next.summary : m.content } : m;
  });
}
