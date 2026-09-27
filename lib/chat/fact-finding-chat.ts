/**
 * Attaches the deterministic fact-finding plan (lib/claims/fact-finding.ts)
 * to a live-chat claim answer: per family member and claim category, the
 * status, the next small group of questions, the documents and reviewer
 * decisions still needed, and which earlier answers are stale, conflicting
 * or uncertain. Contains no amounts; a figure the family stated is listed
 * only as "recorded, not used".
 *
 * Two behaviours come from the household's own data, not a generic list:
 * - It fires on any turn that DESCRIBES an event ("X died in a car
 *   accident"), not only turns the intent classifier labelled a claim, so a
 *   reported death is always met with the questions that decide it.
 * - The plan's questions are enriched from the policies' own STORED
 *   exclusions (read once at upload): if an uploaded policy excludes
 *   alcohol-related events, the chat asks about alcohol; if none does, it
 *   never brings it up. Best-effort -- a failed conditions read only means
 *   fewer questions, never a failed answer.
 */
import { categoriesFor, conditionDrivenQuestions, planFactFinding } from "@/lib/claims/fact-finding";
import { loadCoverConditions } from "@/lib/policies/condition-catalog";
import { describesAScenario } from "@/lib/policies/benefit-catalog";
import { query } from "@/lib/db/client";
import type { CoverCondition } from "@/lib/insurance/cover-conditions";
import type { ChatAnswer } from "@/types";
import type { ConversationState } from "./types";

async function householdConditions(accountId: string): Promise<CoverCondition[]> {
  try {
    const policies = await query<{ id: string }>(
      `SELECT id FROM policies WHERE account_id=$1 AND processing_status='ready' AND superseded_at IS NULL AND lifecycle_state='active'`,
      [accountId],
    );
    if (!policies.rows.length) return [];
    return await loadCoverConditions(accountId, policies.rows.map((row) => row.id));
  } catch {
    return []; /* Fewer questions, never a failed answer. */
  }
}

export async function applyFactFinding(
  answer: ChatAnswer,
  state: ConversationState,
  people: { id: string; display_name: string }[],
  opts?: { accountId?: string; question?: string },
): Promise<void> {
  const claimTurn = state.intent === "claim" || answer.mode !== "answer" || (!!opts?.question && describesAScenario(opts.question));
  if (!claimTurn) { delete answer.factFinding; return; }
  const conditions = opts?.accountId ? await householdConditions(opts.accountId) : [];
  const plans: NonNullable<ChatAnswer["factFinding"]> = [];
  for (const person of people) {
    const facts = state.subjects[person.id] ?? {};
    const signals = new Set<string>((state.scenarios?.[person.id] ?? []).flatMap((s) => [...s.traits, s.family]));
    for (const category of categoriesFor(signals, facts)) {
      const plan = planFactFinding({ subjectId: person.id, category, facts });
      if (plan.status === "information_needed" || plan.status === "evidence_needed") {
        const asked = new Set(plan.nextQuestions.map((q) => q.factKey));
        for (const extra of conditionDrivenQuestions({ category, conditions, facts })) {
          if (asked.has(extra.factKey) || plan.nextQuestions.length >= 5) continue;
          asked.add(extra.factKey);
          plan.nextQuestions.push(extra);
        }
      }
      plans.push({ ...plan, subjectName: person.display_name });
    }
  }
  if (plans.length) answer.factFinding = plans.slice(0, 8);
  else delete answer.factFinding;
}
