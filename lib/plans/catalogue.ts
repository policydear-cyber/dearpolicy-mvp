/**
 * DearPolicy's plans (DC approved, 18 Nov 2026; /mnt/project-files/marketing/PRICING.md).
 *
 * One place for every number a household sees or the server enforces: the landing page's pricing section, Plan usage,
 * and the document and question limits all read this table. Pure data and pure functions: no database, no network.
 *
 * - Documents: the documents a household keeps (not deleted, not replaced by a newer copy, not unreadable).
 * - Questions: messages a household sends to Ask DearPolicy in a calendar month (UTC).
 * - People are never limited: linking every family member costs nothing and is the product's core promise.
 * - "Unlimited" documents on Family has a fair-use ceiling, so a runaway upload loop can't read thousands of files.
 */
export type PlanId = "free" | "plus" | "family";
export type BillingInterval = "month" | "year";

export type Plan = {
  id: PlanId;
  name: string;
  /** S$ a month and a year; 0 for Free. Final prices (no GST while DearPolicy isn't GST-registered). */
  priceMonthlySgd: number;
  priceYearlySgd: number;
  /** The most documents a household on this plan keeps. */
  documents: number;
  /** True when the plan is sold as "Unlimited documents" (documents is then the fair-use ceiling). */
  unlimitedDocuments: boolean;
  questionsPerMonth: number;
  /** One short line for the pricing card. */
  tagline: string;
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", priceMonthlySgd: 0, priceYearlySgd: 0, documents: 5, unlimitedDocuments: false, questionsPerMonth: 10, tagline: "Try it with one person’s main policies." },
  plus: { id: "plus", name: "Plus", priceMonthlySgd: 7.9, priceYearlySgd: 79, documents: 20, unlimitedDocuments: false, questionsPerMonth: 60, tagline: "A couple or a young family." },
  family: { id: "family", name: "Family", priceMonthlySgd: 14.9, priceYearlySgd: 149, documents: 100, unlimitedDocuments: true, questionsPerMonth: 150, tagline: "Big families and parents’ policies too." },
};
export const PLAN_ORDER: readonly PlanId[] = ["free", "plus", "family"];
export const PAID_PLANS: readonly Exclude<PlanId, "free">[] = ["plus", "family"];

export function isPlanId(value: unknown): value is PlanId {
  return value === "free" || value === "plus" || value === "family";
}

/** "S$7.90", "S$79", "S$0". */
export function formatSgd(amount: number): string {
  return "S$" + (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
}

/** "20 documents", "Unlimited documents". */
export function documentsLabel(plan: Plan): string {
  return plan.unlimitedDocuments ? "Unlimited documents" : `${plan.documents} documents`;
}

/** The first day of next month (UTC), when the question count starts again: "1 December". */
export function questionsResetLabel(now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString("en-SG", { day: "numeric", month: "long", timeZone: "UTC" });
}

/** The next plan up, or null on the top plan. */
export function nextPlanUp(id: PlanId): PlanId | null {
  const i = PLAN_ORDER.indexOf(id);
  return i >= 0 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
}

export type LimitCheck = { allowed: true } | { allowed: false; message: string; code: "document_limit" | "question_limit" };

/** Whether one more document may be kept. `kept` is the household's current count. */
export function checkDocumentLimit(planId: PlanId, kept: number, canBuy = true): LimitCheck {
  const plan = PLANS[planId];
  if (kept < plan.documents) return { allowed: true };
  const up = nextPlanUp(planId);
  const message = plan.unlimitedDocuments
    ? `Your household keeps ${kept} documents, the most a Family plan holds. Delete a document you no longer need, then upload this one again.`
    : `Your ${plan.name} plan keeps up to ${plan.documents} documents, and your household has ${kept}. ` +
      (up ? (canBuy ? `Upgrade to ${PLANS[up].name} for ${documentsLabel(PLANS[up]).toLowerCase()}, or delete a document you no longer need.` : `${PLANS[up].name} is coming soon. For now, delete a document you no longer need.`) : "Delete a document you no longer need, then upload this one again.");
  return { allowed: false, message, code: "document_limit" };
}

/** Whether one more question may be asked this month. `asked` is this month's count for the household. */
export function checkQuestionLimit(planId: PlanId, asked: number, now: Date = new Date(), canBuy = true): LimitCheck {
  const plan = PLANS[planId];
  if (asked < plan.questionsPerMonth) return { allowed: true };
  const up = nextPlanUp(planId);
  const message = `Your household has asked this month’s ${plan.questionsPerMonth} questions on the ${plan.name} plan. ` +
    `Questions start again on ${questionsResetLabel(now)}.` +
    (up ? (canBuy ? ` Upgrade to ${PLANS[up].name} for ${PLANS[up].questionsPerMonth} questions a month.` : ` ${PLANS[up].name} is coming soon.`) : "") +
    " Your documents and earlier answers are still here.";
  return { allowed: false, message, code: "question_limit" };
}

/** The same refusal for someone who isn't the household's owner: only the owner can upgrade (members view and ask;
 * DC, 18 Nov), so a member is told who can, never asked to upgrade (DC, 19 Nov). */
export function limitForMember(check: LimitCheck): LimitCheck {
  if (check.allowed) return check;
  return { ...check, message: check.message.replace(/\bUpgrade to /g, "The household’s owner can upgrade to ") };
}
