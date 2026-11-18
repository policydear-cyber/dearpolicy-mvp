/**
 * Which plan a household is on, and whether it may keep one more document or ask one more question
 * (lib/billing/plans.ts holds the numbers).
 *
 * The plan lives in household_plans (sql/household-plans.sql), written only by the server. A household with no row,
 * or a database without the table yet, is on Free.
 *
 * Limits are enforced only when DEARPOLICY_PLAN_LIMITS=on. Off (the default), Plan usage still shows the plan and its
 * meters, and nothing is refused: so the table can be created, and the owner's own household given a complimentary
 * plan, before any household is held to a limit.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { checkDocumentLimit, checkQuestionLimit, isPlanId, type BillingInterval, type LimitCheck, type PlanId } from "@/lib/billing/plans";

/** Stripe subscription statuses that keep a paid plan, plus 'complimentary' (a plan given without payment). A failed
 * renewal (past_due) keeps the plan while Stripe retries; anything else (canceled, unpaid, incomplete...) is Free. */
const PLAN_KEEPING_STATUSES = new Set(["active", "trialing", "past_due", "complimentary"]);

export function planLimitsEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(env.DEARPOLICY_PLAN_LIMITS?.trim() ?? "");
}

export type HouseholdPlan = {
  planId: PlanId;
  status: string | null;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  /** Whether the household has a Stripe customer, so "Manage subscription" can open. */
  hasBillingAccount: boolean;
  /** False when the plans table isn't there yet (sql/household-plans.sql not applied). */
  stored: boolean;
};

const FREE: HouseholdPlan = { planId: "free", status: null, interval: null, currentPeriodEnd: null, hasBillingAccount: false, stored: false };

/** Thrown when the plan or a count can't be read while limits are on: nothing is refused or allowed on a guess. */
export class PlanCheckUnavailable extends Error {
  constructor(cause?: unknown) {
    super("DearPolicy couldn’t check your plan just now, so nothing was sent. Please try again shortly.");
    this.name = "PlanCheckUnavailable";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const isMissingTable = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";

export async function readHouseholdPlan(householdId: string): Promise<HouseholdPlan> {
  let row: { plan: string; status: string; billing_interval: string | null; current_period_end: string | null; stripe_customer_id: string | null } | undefined;
  try {
    row = (await query<{ plan: string; status: string; billing_interval: string | null; current_period_end: string | null; stripe_customer_id: string | null }>(
      `SELECT plan,status,billing_interval,current_period_end::text,stripe_customer_id FROM household_plans WHERE account_id=$1`, [householdId])).rows[0];
  } catch (error) {
    if (isMissingTable(error)) return FREE;
    throw new PlanCheckUnavailable(error);
  }
  if (!row) return { ...FREE, stored: true };
  const keeps = PLAN_KEEPING_STATUSES.has(row.status) && isPlanId(row.plan);
  return {
    planId: keeps ? (row.plan as PlanId) : "free",
    status: row.status,
    interval: row.billing_interval === "month" || row.billing_interval === "year" ? row.billing_interval : null,
    currentPeriodEnd: row.current_period_end,
    hasBillingAccount: Boolean(row.stripe_customer_id),
    stored: true,
  };
}

/** Documents that count towards the plan: kept (not deleted), current (not replaced by a newer copy) and not unreadable. */
export async function keptDocumentCount(householdId: string): Promise<number> {
  try {
    const row = (await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM policies WHERE account_id=$1 AND superseded_at IS NULL AND processing_status<>'failed' AND ${activePredicate()}`,
      [householdId])).rows[0];
    return Number(row?.count ?? 0);
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
}

/** Messages the household has sent to Ask DearPolicy this calendar month (UTC), every member together. */
export async function questionsThisMonth(householdId: string): Promise<number> {
  try {
    const row = (await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
        WHERE c.account_id=$1 AND m.role='user' AND m.created_at>=date_trunc('month',now())`, [householdId])).rows[0];
    return Number(row?.count ?? 0);
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
}

/** May this household keep one more document? Always yes while limits are off, and for a replacement copy. */
export async function mayAddDocument(householdId: string, opts: { replacing?: boolean } = {}): Promise<LimitCheck> {
  if (!planLimitsEnforced() || opts.replacing) return { allowed: true };
  const [plan, kept] = await Promise.all([readHouseholdPlan(householdId), keptDocumentCount(householdId)]);
  return checkDocumentLimit(plan.planId, kept);
}

/** May this household ask one more question this month? Always yes while limits are off. */
export async function mayAskQuestion(householdId: string): Promise<LimitCheck> {
  if (!planLimitsEnforced()) return { allowed: true };
  const [plan, asked] = await Promise.all([readHouseholdPlan(householdId), questionsThisMonth(householdId)]);
  return checkQuestionLimit(plan.planId, asked);
}
