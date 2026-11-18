/**
 * Which plan a household is on, and whether it may keep one more document or ask one more question
 * (lib/plans/catalogue.ts holds the numbers).
 *
 * The plan lives in household_plans (sql/household-plans.sql), written only by the server. A household with no row is
 * on Free. A database without the table yet reads as Free only while limits are off; with limits on, a missing table
 * refuses nothing and allows nothing on a guess (PlanCheckUnavailable), so switching limits on before the table and the
 * owner's complimentary row exist can't drop every household, the owner's included, to Free (Critic, 18 Nov).
 *
 * Questions are counted in household_question_counts when each one is accepted, not from chat_messages: deleting
 * chats must never give a household its questions back (Critic, 18 Nov).
 *
 * Limits are enforced only when DEARPOLICY_PLAN_LIMITS=on. Off (the default), Plan usage still shows the plan and its
 * meters, and nothing is refused: so the table can be created, and the owner's own household given a complimentary
 * plan, before any household is held to a limit.
 */
import { pool, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { PLANS, checkDocumentLimit, checkQuestionLimit, isPlanId, type BillingInterval, type LimitCheck, type PlanId } from "@/lib/plans/catalogue";

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

/** Where a read runs: the shared pool, or the connection of a transaction that holds the plan lock (a second pool
 * connection taken while holding it could wait forever on a small pool). */
type Reader = { query: <T extends Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }> };
const shared: Reader = { query: (text, params) => query(text, params ?? []) as never };

const isMissingTable = (error: unknown) => (error as { code?: string } | null)?.code === "42P01";

export async function readHouseholdPlan(householdId: string, db: Reader = shared): Promise<HouseholdPlan> {
  let row: { plan: string; status: string; billing_interval: string | null; current_period_end: string | null; stripe_customer_id: string | null } | undefined;
  try {
    row = (await db.query<{ plan: string; status: string; billing_interval: string | null; current_period_end: string | null; stripe_customer_id: string | null }>(
      `SELECT plan,status,billing_interval,current_period_end::text,stripe_customer_id FROM household_plans WHERE account_id=$1`, [householdId])).rows[0];
  } catch (error) {
    if (isMissingTable(error) && !planLimitsEnforced()) return FREE;
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
export async function keptDocumentCount(householdId: string, db: Reader = shared): Promise<number> {
  try {
    const row = (await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM policies WHERE account_id=$1 AND superseded_at IS NULL AND processing_status<>'failed' AND ${activePredicate()}`,
      [householdId])).rows[0];
    return Number(row?.count ?? 0);
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
}

/** Questions the household has asked Ask DearPolicy this calendar month (UTC), every member together. While limits
 * are on, the count kept in household_question_counts (deleting chats never gives questions back). While limits are
 * off nothing is counted on the chat path (no extra query per question), so the messages still on file are shown
 * instead; the kept count starts on the day limits are switched on. */
export async function questionsThisMonth(householdId: string): Promise<number> {
  if (planLimitsEnforced()) {
    try {
      const row = (await query<{ questions: number }>(
        `SELECT questions FROM household_question_counts WHERE account_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date`, [householdId])).rows[0];
      return Number(row?.questions ?? 0);
    } catch (error) {
      throw new PlanCheckUnavailable(error);
    }
  }
  try {
    const row = (await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
        WHERE c.account_id=$1 AND m.role='user' AND m.created_at>=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [householdId])).rows[0];
    return Number(row?.count ?? 0);
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
}

/** Whether a document counts towards the plan now (this household's, kept, current and not unreadable). */
async function documentCounts(householdId: string, policyId: string, db: Reader = shared): Promise<boolean> {
  try {
    return (await db.query(
      `SELECT 1 FROM policies WHERE id=$1 AND account_id=$2 AND superseded_at IS NULL AND processing_status<>'failed' AND ${activePredicate()}`,
      [policyId, householdId])).rows.length > 0;
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
}

/** Another current copy already replaces this document (TE F7): its place is taken, until the old one is marked
 * replaced a moment after that copy is recorded. */
async function alreadyReplaced(householdId: string, policyId: string, db: Reader): Promise<boolean> {
  try {
    return (await db.query(
      `SELECT 1 FROM policies WHERE supersedes_id=$1 AND account_id=$2 AND superseded_at IS NULL AND ${activePredicate()}`,
      [policyId, householdId])).rows.length > 0;
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
}

/** May this household keep one more document? Always yes while limits are off. A newer copy of a document that already
 * counts takes its place; a newer copy of one that doesn't (unreadable, or not this household's) is one more (TE F4, F5).
 * `rereading`: an unreadable document read again would start to count (TE F3); a counted one already does. */
export async function mayAddDocument(householdId: string, opts: { replacingPolicyId?: string | null; rereadingPolicyId?: string | null } = {}, db: Reader = shared): Promise<LimitCheck> {
  if (!planLimitsEnforced()) return { allowed: true };
  const existing = opts.replacingPolicyId ?? opts.rereadingPolicyId ?? null;
  if (existing && /^[0-9a-f-]{36}$/i.test(existing) && await documentCounts(householdId, existing, db)
    && !(opts.replacingPolicyId && await alreadyReplaced(householdId, opts.replacingPolicyId, db))) return { allowed: true };
  const plan = await readHouseholdPlan(householdId, db);
  const kept = await keptDocumentCount(householdId, db);
  return checkDocumentLimit(plan.planId, kept);
}

/** Takes one of this month's questions for the household, or refuses when they are used up. One statement counts and
 * checks together, so questions sent at the same moment can't all slip past the limit. While limits are off it does nothing:
 * nothing is refused or counted, and Plan usage counts the messages on file instead. */
export async function takeQuestion(householdId: string): Promise<LimitCheck> {
  // Limits off: nothing is counted or read, so a question costs no extra query (r10 perf budgets).
  if (!planLimitsEnforced()) return { allowed: true };
  const plan = await readHouseholdPlan(householdId);
  const limit = PLANS[plan.planId].questionsPerMonth;
  let taken: number | null;
  try {
    taken = (await query<{ questions: number }>(
      `INSERT INTO household_question_counts(account_id,month,questions) VALUES($1,date_trunc('month',now() AT TIME ZONE 'UTC')::date,1)
       ON CONFLICT (account_id,month) DO UPDATE SET questions=household_question_counts.questions+1
       WHERE household_question_counts.questions<$2
       RETURNING questions`, [householdId, limit])).rows[0]?.questions ?? null;
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
  return taken == null ? checkQuestionLimit(plan.planId, limit) : { allowed: true };
}

type Executor = { query: (text: string, params?: unknown[]) => Promise<unknown> };

/** Inside a transaction the caller has open on `client`: takes the household's document lock (held until that
 * transaction ends) and checks the limit on the same connection. Every path that can make a document start to count
 * (a new upload, a newer copy, reading an unreadable one again) goes through this, so requests sent together are
 * checked one after another (TE F6, F8). Always allowed, with no lock, while limits are off. */
export async function mayAddDocumentUnderLock(client: Executor, householdId: string, opts: { replacingPolicyId?: string | null; rereadingPolicyId?: string | null }): Promise<LimitCheck> {
  if (!planLimitsEnforced()) return { allowed: true };
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dearpolicy-plan-documents:' || $1::text))", [householdId]);
  } catch (error) {
    throw new PlanCheckUnavailable(error);
  }
  return mayAddDocument(householdId, opts, client as unknown as Reader);
}

/** Records a new document only if the household's plan still has room, with the count and the insert under one
 * per-household lock: uploads sent at the same moment can't all pass the limit (TE F6). `insert` runs inside the
 * transaction on its connection; a failure rolls it back and is thrown on. While limits are off it runs as before, with
 * no lock. */
export async function insertWithinDocumentLimit(householdId: string, opts: { replacingPolicyId?: string | null }, insert: (db: Executor) => Promise<void>): Promise<LimitCheck> {
  if (!planLimitsEnforced()) {
    await insert(pool);
    return { allowed: true };
  }
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    let check: LimitCheck;
    try {
      check = await mayAddDocumentUnderLock(client, householdId, opts);
    } catch (error) {
      await client.query("ROLLBACK");
      open = false;
      throw error;
    }
    if (!check.allowed) {
      await client.query("ROLLBACK");
      open = false;
      return check;
    }
    await insert(client);
    await client.query("COMMIT");
    open = false;
    return { allowed: true };
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
