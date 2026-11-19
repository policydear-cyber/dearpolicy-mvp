/**
 * What the plan badge and the upgrade prompts may show (DC, 19 Nov 2026): every signed-in page names the household's
 * plan beside the light/dark switch, and a household's owner on Free sees one short upgrade prompt at a natural moment.
 *
 * Pure: no database, no network. app/api/plan/route.ts feeds it; components/plan-status.tsx draws it.
 *
 * - Only the owner can upgrade (members view and ask), so a member never sees a prompt.
 * - A paid household never sees one.
 * - No prompt while payments are switched off (DEARPOLICY_BILLING): the plans page could only say "Upgrades open soon",
 *   and a prompt that leads nowhere is clutter.
 */
import { PLANS, documentsLabel, type PlanId } from "@/lib/plans/catalogue";

export type PlanStatus = {
  plan: PlanId;
  name: string;
  /** True only for the household's owner, on Free, while payments are on. */
  upgrade: boolean;
  /** Whether the signed-in person is the household's owner (only the owner can upgrade). */
  owner: boolean;
  /** Counts against the plan, sent only when `upgrade` is true (prompts are the only thing that use them). */
  documentsKept?: number;
  questionsThisMonth?: number;
};

export function mayPromptUpgrade(input: { planId: PlanId; isOwner: boolean; billingEnabled: boolean }): boolean {
  return input.planId === "free" && input.isOwner && input.billingEnabled;
}

export function planStatus(input: { planId: PlanId; isOwner: boolean; billingEnabled: boolean; documentsKept?: number; questionsThisMonth?: number }): PlanStatus {
  const upgrade = mayPromptUpgrade(input);
  const status: PlanStatus = { plan: input.planId, name: PLANS[input.planId].name, upgrade, owner: input.isOwner };
  if (upgrade) {
    if (typeof input.documentsKept === "number") status.documentsKept = input.documentsKept;
    if (typeof input.questionsThisMonth === "number") status.questionsThisMonth = input.questionsThisMonth;
  }
  return status;
}

/** Ask's prompt shows once this share of the month's questions is used, never earlier. */
export const QUESTIONS_NEAR_LIMIT = 0.8;

export function questionsNearLimit(status: PlanStatus | null): boolean {
  if (!status?.upgrade || typeof status.questionsThisMonth !== "number") return false;
  return status.questionsThisMonth >= Math.ceil(PLANS[status.plan].questionsPerMonth * QUESTIONS_NEAR_LIMIT);
}

export type UpgradePlace = "home" | "documents" | "ask";

/** The words for each place, or null when this place has nothing to say. */
export function upgradeLine(place: UpgradePlace, status: PlanStatus | null): { lead: string; detail: string; plan: "plus" | "family" } | null {
  if (!status?.upgrade) return null;
  const free = PLANS.free, plus = PLANS.plus, family = PLANS.family;
  if (place === "home") return { lead: `Upgrade to ${family.name}.`, detail: `${documentsLabel(family)} and ${family.questionsPerMonth} questions a month.`, plan: "family" };
  if (place === "documents") {
    // Not on an empty page: a new household's first step is its first upload, not a plan (TE F2).
    if (typeof status.documentsKept !== "number" || status.documentsKept < 1) return null;
    return { lead: `${Math.min(status.documentsKept, free.documents)} of ${free.documents} documents on ${free.name}.`, detail: `${plus.name} keeps ${plus.documents}.`, plan: "plus" };
  }
  if (!questionsNearLimit(status)) return null;
  return { lead: `${Math.min(status.questionsThisMonth ?? 0, free.questionsPerMonth)} of ${free.questionsPerMonth} questions used this month.`, detail: `${plus.name} gives ${plus.questionsPerMonth}.`, plan: "plus" };
}

