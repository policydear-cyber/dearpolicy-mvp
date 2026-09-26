/**
 * Attaches the deterministic fact-finding plan (lib/claims/fact-finding.ts)
 * to a live-chat claim answer: per family member and claim category, the
 * status, the next small group of questions, the documents and reviewer
 * decisions still needed, and which earlier answers are stale, conflicting
 * or uncertain. Contains no amounts; a figure the family stated is listed
 * only as "recorded, not used".
 */
import { categoriesFor, planFactFinding } from "@/lib/claims/fact-finding";
import type { ChatAnswer } from "@/types";
import type { ConversationState } from "./types";

export function applyFactFinding(answer: ChatAnswer, state: ConversationState, people: { id: string; display_name: string }[]): void {
  const claimTurn = state.intent === "claim" || answer.mode !== "answer";
  if (!claimTurn) { delete answer.factFinding; return; }
  const plans: NonNullable<ChatAnswer["factFinding"]> = [];
  for (const person of people) {
    const facts = state.subjects[person.id] ?? {};
    const signals = new Set<string>((state.scenarios?.[person.id] ?? []).flatMap((s) => [...s.traits, s.family]));
    for (const category of categoriesFor(signals, facts)) plans.push({ ...planFactFinding({ subjectId: person.id, category, facts }), subjectName: person.display_name });
  }
  if (plans.length) answer.factFinding = plans.slice(0, 8);
  else delete answer.factFinding;
}
