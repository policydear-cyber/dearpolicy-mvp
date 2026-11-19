/**
 * Read-only data for the admin console (/admin). Called only from app/admin pages, after requireAdminOrNotFound().
 * It writes nothing: readHouseholdUsage() checks model_executions exists, then runs the shared usage query with
 * ensureSchema: false, so no page view runs DDL.
 *
 * Runs on the trusted server connection (lib/db/client.ts), which is how it can see every household; nothing here is
 * reachable from a browser role, and no household's RLS or grants change. It reads counts, statuses and metadata
 * only: never document text, extracted figures, chat messages, file names, policy numbers or storage paths, and never
 * the raw error detail a failure kept (provider responses can quote a document). Failure codes and error classes are
 * shown instead.
 *
 * Each section is read on its own, so a table that isn't there yet (a migration not applied) shows as "not available"
 * on that section instead of breaking the page.
 */
import { isUuid, query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { pseudonymizeId } from "@/lib/telemetry/pseudonymize";
import { effectivePlanId, planLimitsEnforced } from "@/lib/billing/household-plan";
import { startOfMonth, usageByOperationAndModel, type UsageReport } from "@/lib/ai/usage";
import type { PlanId } from "@/lib/plans/catalogue";
import { ADMIN_TIME_ZONE } from "./format";

const HOUSEHOLD_LIMIT = 500;
const ERROR_WINDOW_DAYS = 7;

export type Section<T> = { ok: true; data: T } | { ok: false; reason: string };

const isMissingRelation = (e: unknown) => (e as { code?: string } | null)?.code === "42P01";
async function section<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    // A short, fixed reason; never the driver's message (it can quote SQL and values).
    return { ok: false, reason: isMissingRelation(e) ? "Not set up in the database yet." : "Couldn’t be read just now." };
  }
}

async function authUsersPresent(): Promise<boolean> {
  try {
    const { rows } = await query<{ present: boolean }>(`SELECT to_regclass('auth.users') IS NOT NULL AS present`);
    return Boolean(rows[0]?.present);
  } catch {
    return false;
  }
}

const num = (v: unknown) => Number(v ?? 0) || 0;

// ---------------------------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------------------------

export type Totals = {
  households: number;
  accounts: number | null;
  confirmedAccounts: number | null;
  signups7d: number | null;
  /** Sign-ups in the 7 days before the last 7, to show the change. */
  signupsPrev7d: number | null;
  signups30d: number | null;
  /** Households where a member signed in during the last 30 days. */
  activeHouseholds30d: number | null;
  documents: number;
  documentsRead: number;
  documentsUnreadable: number;
  documentsInProgress: number;
};

export async function readTotals(): Promise<Section<Totals>> {
  return section(async () => {
    const hh = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM accounts WHERE ${activePredicate()}`)).rows[0];
    const docs = (await query<{ total: number; ready: number; failed: number }>(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE p.processing_status='ready')::int AS ready,
              count(*) FILTER (WHERE p.processing_status='failed')::int AS failed
         FROM policies p JOIN accounts a ON a.id = p.account_id AND ${activePredicate("a")}
        WHERE p.superseded_at IS NULL AND ${activePredicate("p")}`)).rows[0];
    let accounts: number | null = null, confirmed: number | null = null, s7: number | null = null, p7: number | null = null, s30: number | null = null;
    let active: number | null = null;
    if (await authUsersPresent()) {
      const u = (await query<{ total: number; confirmed: number; s7: number; p7: number; s30: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE email_confirmed_at IS NOT NULL)::int AS confirmed,
                count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS s7,
                count(*) FILTER (WHERE created_at >= now() - interval '14 days' AND created_at < now() - interval '7 days')::int AS p7,
                count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS s30
           FROM auth.users`)).rows[0];
      accounts = num(u?.total); confirmed = num(u?.confirmed); s7 = num(u?.s7); p7 = num(u?.p7); s30 = num(u?.s30);
      active = num((await query<{ n: number }>(
        `SELECT count(DISTINCT a.id)::int AS n FROM accounts a JOIN household_members hm ON hm.household_id = a.id
           JOIN auth.users u ON u.id = hm.user_id
          WHERE ${activePredicate("a")} AND u.last_sign_in_at >= now() - interval '30 days'`)).rows[0]?.n);
    }
    const total = num(docs?.total), ready = num(docs?.ready), failed = num(docs?.failed);
    return { households: num(hh?.n), accounts, confirmedAccounts: confirmed, signups7d: s7, signupsPrev7d: p7, signups30d: s30, activeHouseholds30d: active,
      documents: total, documentsRead: ready, documentsUnreadable: failed, documentsInProgress: Math.max(0, total - ready - failed) };
  });
}

export const TREND_DAYS = 30;

/** One value per day, oldest first; null for a series whose table isn't there. */
export type Trends = {
  days: string[];
  accounts: number[] | null;
  households: number[];
  questions: number[] | null;
  spendUsd: number[] | null;
};

/** The last 30 days (Singapore time), one point per day: new accounts (Supabase Auth), new households, questions
 * households sent to Ask DearPolicy (chat messages still on file), and recorded model spend. */
export async function readTrends(): Promise<Section<Trends>> {
  return section(async () => {
    const days = (await query<{ day: string }>(
      `SELECT generate_series((now() AT TIME ZONE $1)::date - ($2::int - 1), (now() AT TIME ZONE $1)::date, interval '1 day')::date::text AS day`,
      [ADMIN_TIME_ZONE, TREND_DAYS])).rows.map((r) => r.day);
    const from = days[0];
    const byDay = async (sql: string): Promise<number[] | null> => {
      try {
        const m = new Map((await query<{ day: string; v: string }>(sql, [ADMIN_TIME_ZONE, from])).rows.map((r) => [r.day, Number(r.v) || 0]));
        return days.map((d) => m.get(d) ?? 0);
      } catch (e) {
        if (isMissingRelation(e)) return null;
        throw e;
      }
    };
    const accounts = (await authUsersPresent())
      ? await byDay(`SELECT (created_at AT TIME ZONE $1)::date::text AS day, count(*)::text AS v FROM auth.users
                      WHERE (created_at AT TIME ZONE $1)::date >= $2::date GROUP BY 1`)
      : null;
    const households = (await byDay(`SELECT (a.created_at AT TIME ZONE $1)::date::text AS day, count(*)::text AS v FROM accounts a
                      WHERE (a.created_at AT TIME ZONE $1)::date >= $2::date AND ${activePredicate("a")} GROUP BY 1`)) ?? days.map(() => 0);
    const questions = await byDay(`SELECT (m.created_at AT TIME ZONE $1)::date::text AS day, count(*)::text AS v
                      FROM chat_messages m JOIN accounts a ON a.id = m.account_id AND ${activePredicate("a")}
                     WHERE m.role = 'user' AND (m.created_at AT TIME ZONE $1)::date >= $2::date GROUP BY 1`);
    const spendUsd = await byDay(`SELECT (created_at AT TIME ZONE $1)::date::text AS day, coalesce(sum(cost_usd), 0)::text AS v FROM model_executions
                      WHERE (created_at AT TIME ZONE $1)::date >= $2::date GROUP BY 1`);
    return { days, accounts, households, questions, spendUsd };
  });
}

export type RecentSignup = { email: string | null; createdAt: string; confirmed: boolean; lastSignInAt: string | null; householdId: string | null };

export async function readRecentSignups(limit = 20): Promise<Section<RecentSignup[] | null>> {
  return section(async () => {
    if (!(await authUsersPresent())) return null;
    const { rows } = await query<{ email: string | null; created_at: string; confirmed: boolean; last_sign_in_at: string | null; household_id: string | null }>(
      `SELECT u.email, u.created_at::text AS created_at, (u.email_confirmed_at IS NOT NULL) AS confirmed, u.last_sign_in_at::text AS last_sign_in_at,
              (SELECT hm.household_id::text FROM household_members hm JOIN accounts a ON a.id = hm.household_id AND ${activePredicate("a")}
                WHERE hm.user_id = u.id ORDER BY hm.created_at LIMIT 1) AS household_id
         FROM auth.users u ORDER BY u.created_at DESC LIMIT $1`, [limit]);
    return rows.map((r) => ({ email: r.email, createdAt: r.created_at, confirmed: r.confirmed, lastSignInAt: r.last_sign_in_at, householdId: r.household_id }));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Households
// ---------------------------------------------------------------------------------------------------------------

export type HouseholdRow = {
  id: string;
  name: string;
  createdAt: string;
  ownerEmail: string | null;
  members: number;
  people: number;
  documents: number;
  documentsRead: number;
  documentsUnreadable: number;
  documentsInProgress: number;
  lastSignInAt: string | null;
  questionsThisMonth: number | null;
  plan: PlanId;
  planStatus: string | null;
  /** Null when the model-usage table isn't there: shown as "—", never 0. */
  spendUsd: number | null;
  modelCalls: number | null;
};

export type HouseholdList = {
  rows: HouseholdRow[];
  truncated: boolean;
  /** False when sql/household-plans.sql isn't applied: every household reads as Free. */
  plansStored: boolean;
  /** Where "questions this month" comes from (limits on: the kept count; off: messages still on file). */
  questionsSource: "kept_count" | "messages_on_file";
  /** False when that source table isn't there: the column shows "—", never 0. */
  questionsAvailable: boolean;
  /** False when the model-usage table isn't there: spend shows "—", never US$0.00. */
  spendAvailable: boolean;
  spendUnattributedUsd: number;
  spendTotalUsd: number;
};

export async function readHouseholds(): Promise<Section<HouseholdList>> {
  return section(async () => {
    const withUsers = await authUsersPresent();
    const ownerEmail = withUsers
      ? `(SELECT u.email FROM household_members hm JOIN auth.users u ON u.id = hm.user_id WHERE hm.household_id = a.id AND hm.role = 'owner' ORDER BY hm.created_at LIMIT 1)`
      : `NULL::text`;
    const lastSignIn = withUsers
      ? `(SELECT max(u.last_sign_in_at)::text FROM household_members hm JOIN auth.users u ON u.id = hm.user_id WHERE hm.household_id = a.id)`
      : `NULL::text`;
    const { rows } = await query<{ id: string; name: string; created_at: string; owner_email: string | null; members: number; people: number;
      documents: number; ready: number; failed: number; last_sign_in_at: string | null }>(
      `SELECT a.id::text AS id, a.name, a.created_at::text AS created_at, ${ownerEmail} AS owner_email,
              (SELECT count(*)::int FROM household_members hm WHERE hm.household_id = a.id) AS members,
              (SELECT count(*)::int FROM family_members fm WHERE fm.account_id = a.id AND ${activePredicate("fm")}) AS people,
              (SELECT count(*)::int FROM policies p WHERE p.account_id = a.id AND p.superseded_at IS NULL AND ${activePredicate("p")}) AS documents,
              (SELECT count(*)::int FROM policies p WHERE p.account_id = a.id AND p.superseded_at IS NULL AND p.processing_status = 'ready' AND ${activePredicate("p")}) AS ready,
              (SELECT count(*)::int FROM policies p WHERE p.account_id = a.id AND p.superseded_at IS NULL AND p.processing_status = 'failed' AND ${activePredicate("p")}) AS failed,
              ${lastSignIn} AS last_sign_in_at
         FROM accounts a WHERE ${activePredicate("a")}
        ORDER BY a.created_at DESC LIMIT $1`, [HOUSEHOLD_LIMIT + 1]);
    const truncated = rows.length > HOUSEHOLD_LIMIT;
    const list = rows.slice(0, HOUSEHOLD_LIMIT);

    // Plans: one read for every household; a missing table means everyone is on Free.
    const plans = new Map<string, { plan: string; status: string }>();
    let plansStored = true;
    try {
      for (const r of (await query<{ account_id: string; plan: string; status: string }>(`SELECT account_id::text AS account_id, plan, status FROM household_plans`)).rows) plans.set(r.account_id, r);
    } catch (e) {
      if (!isMissingRelation(e)) throw e;
      plansStored = false;
    }

    // Questions: the kept count while limits are on (deleting chats never gives questions back), else messages on file.
    const kept = new Map<string, number>();
    const questionsSource = planLimitsEnforced() ? "kept_count" as const : "messages_on_file" as const;
    const onFile = new Map<string, number>();
    let questionsAvailable = true;
    if (questionsSource === "messages_on_file") {
      try {
        for (const r of (await query<{ account_id: string; n: number }>(
          `SELECT c.account_id::text AS account_id, count(*)::int AS n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
            WHERE m.role = 'user' AND m.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') GROUP BY 1`)).rows) onFile.set(r.account_id, num(r.n));
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
        questionsAvailable = false;
      }
    }
    if (questionsSource === "kept_count") {
      try {
        for (const r of (await query<{ account_id: string; questions: number }>(
          `SELECT account_id::text AS account_id, questions FROM household_question_counts WHERE month = date_trunc('month', now() AT TIME ZONE 'UTC')::date`)).rows) kept.set(r.account_id, num(r.questions));
      } catch (e) {
        if (!isMissingRelation(e)) throw e;
        questionsAvailable = false;
      }
    }

    // Model spend this month: model_executions keeps a keyed pseudonym of the household, never its id.
    const spend = await spendByHouseholdRef(startOfMonth());
    const byRef = new Map(spend.rows.map((r) => [r.ref, r]));
    let attributed = 0;
    const out: HouseholdRow[] = list.map((r) => {
      const ref = pseudonymizeId(r.id);
      const s = ref ? byRef.get(ref) : undefined;
      if (s) attributed += s.usd;
      const p = plans.get(r.id);
      return {
        id: r.id, name: r.name, createdAt: r.created_at, ownerEmail: r.owner_email, members: num(r.members), people: num(r.people),
        documents: num(r.documents), documentsRead: num(r.ready), documentsUnreadable: num(r.failed),
        documentsInProgress: Math.max(0, num(r.documents) - num(r.ready) - num(r.failed)), lastSignInAt: r.last_sign_in_at,
        questionsThisMonth: !questionsAvailable ? null : questionsSource === "kept_count" ? (kept.get(r.id) ?? 0) : (onFile.get(r.id) ?? 0),
        plan: effectivePlanId(p?.plan, p?.status), planStatus: p?.status ?? null,
        spendUsd: spend.available ? (s?.usd ?? 0) : null, modelCalls: spend.available ? (s?.calls ?? 0) : null,
      };
    });
    // Households beyond the list limit also fall into "unattributed" here, which the page says when it's truncated.
    return { rows: out, truncated, plansStored, questionsSource, questionsAvailable, spendAvailable: spend.available,
      spendTotalUsd: round6(spend.totalUsd), spendUnattributedUsd: round6(Math.max(0, spend.totalUsd - attributed)) };
  });
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

async function spendByHouseholdRef(since: Date): Promise<{ rows: { ref: string | null; usd: number; calls: number }[]; totalUsd: number; available: boolean }> {
  try {
    const { rows } = await query<{ ref: string | null; usd: string; calls: number }>(
      `SELECT household_ref AS ref, coalesce(sum(cost_usd), 0)::text AS usd, count(*)::int AS calls
         FROM model_executions WHERE created_at >= $1 GROUP BY household_ref`, [since.toISOString()]);
    const out = rows.map((r) => ({ ref: r.ref, usd: Number(r.usd) || 0, calls: num(r.calls) }));
    return { rows: out, totalUsd: out.reduce((n, r) => n + r.usd, 0), available: true };
  } catch (e) {
    if (isMissingRelation(e)) return { rows: [], totalUsd: 0, available: false };
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// One household
// ---------------------------------------------------------------------------------------------------------------

export type HouseholdMember = { email: string | null; role: string; joinedAt: string; confirmed: boolean | null; lastSignInAt: string | null };
export type HouseholdDocument = {
  id: string; insurer: string | null; product: string | null; documentRole: string | null; status: string; stage: string | null;
  pages: number | null; uploadedAt: string; readAt: string | null; replaced: boolean; quarantine: string | null; needsReview: boolean;
};
export type HouseholdFailure = { occurredAt: string; resourceType: string; resourceId: string; failureCode: string; errorClass: string | null };
export type HouseholdJob = { jobType: string; status: string; attempts: number; errorCategory: string | null; updatedAt: string };

export type HouseholdDetail = {
  id: string; name: string; createdAt: string; people: number;
  plan: PlanId; planStatus: string | null; plansStored: boolean;
};

/** null when there is no such active household. */
export async function readHouseholdDetail(id: string): Promise<HouseholdDetail | null> {
  if (!isUuid(id)) return null;
  const { rows } = await query<{ id: string; name: string; created_at: string; people: number }>(
    `SELECT a.id::text AS id, a.name, a.created_at::text AS created_at,
            (SELECT count(*)::int FROM family_members fm WHERE fm.account_id = a.id AND ${activePredicate("fm")}) AS people
       FROM accounts a WHERE a.id = $1 AND ${activePredicate("a")}`, [id]);
  const r = rows[0];
  if (!r) return null;
  let plan: { plan: string; status: string } | undefined, plansStored = true;
  try {
    plan = (await query<{ plan: string; status: string }>(`SELECT plan, status FROM household_plans WHERE account_id = $1`, [id])).rows[0];
  } catch (e) {
    if (!isMissingRelation(e)) throw e;
    plansStored = false;
  }
  return { id: r.id, name: r.name, createdAt: r.created_at, people: num(r.people), plan: effectivePlanId(plan?.plan, plan?.status), planStatus: plan?.status ?? null, plansStored };
}

export async function readHouseholdMembers(id: string): Promise<Section<HouseholdMember[]>> {
  return section(async () => {
    const withUsers = await authUsersPresent();
    const { rows } = await query<{ email: string | null; role: string; joined_at: string; confirmed: boolean | null; last_sign_in_at: string | null }>(
      withUsers
        ? `SELECT u.email, hm.role, hm.created_at::text AS joined_at, CASE WHEN u.id IS NULL THEN NULL ELSE (u.email_confirmed_at IS NOT NULL) END AS confirmed, u.last_sign_in_at::text AS last_sign_in_at
             FROM household_members hm LEFT JOIN auth.users u ON u.id = hm.user_id WHERE hm.household_id = $1 ORDER BY hm.role = 'owner' DESC, hm.created_at`
        : `SELECT NULL::text AS email, hm.role, hm.created_at::text AS joined_at, NULL::boolean AS confirmed, NULL::text AS last_sign_in_at
             FROM household_members hm WHERE hm.household_id = $1 ORDER BY hm.role = 'owner' DESC, hm.created_at`, [id]);
    return rows.map((m) => ({ email: m.email, role: m.role, joinedAt: m.joined_at, confirmed: m.confirmed, lastSignInAt: m.last_sign_in_at }));
  });
}

/** Every kept document (newest first), current and replaced: metadata and read status only. */
export async function readHouseholdDocuments(id: string): Promise<Section<HouseholdDocument[]>> {
  return section(async () => {
    const { rows } = await query<{ id: string; insurer: string | null; product_name: string | null; document_role: string | null; processing_status: string;
      processing_stage: string | null; page_count: number | null; created_at: string; processing_completed_at: string | null; replaced: boolean;
      quarantine_status: string | null; needs_review: boolean | null }>(
      `SELECT p.id::text AS id, p.insurer, p.product_name, p.document_role, p.processing_status, p.processing_stage, p.page_count,
              p.created_at::text AS created_at, p.processing_completed_at::text AS processing_completed_at, (p.superseded_at IS NOT NULL) AS replaced,
              p.quarantine_status, p.needs_review
         FROM policies p WHERE p.account_id = $1 AND ${activePredicate("p")} ORDER BY p.created_at DESC LIMIT 300`, [id]);
    return rows.map((d) => ({ id: d.id, insurer: d.insurer, product: d.product_name, documentRole: d.document_role, status: d.processing_status,
      stage: d.processing_stage, pages: d.page_count, uploadedAt: d.created_at, readAt: d.processing_completed_at, replaced: d.replaced,
      quarantine: d.quarantine_status, needsReview: Boolean(d.needs_review) }));
  });
}

export async function readHouseholdFailures(id: string): Promise<Section<HouseholdFailure[]>> {
  return section(async () => {
    const { rows } = await query<{ occurred_at: string; resource_type: string; resource_id: string; failure_code: string; error_class: string | null }>(
      `SELECT occurred_at::text AS occurred_at, resource_type, resource_id::text AS resource_id, failure_code, error_class
         FROM processing_failure_diagnostics WHERE account_id = $1 ORDER BY occurred_at DESC LIMIT 50`, [id]);
    return rows.map((f) => ({ occurredAt: f.occurred_at, resourceType: f.resource_type, resourceId: f.resource_id, failureCode: f.failure_code, errorClass: f.error_class }));
  });
}

export async function readHouseholdJobs(id: string): Promise<Section<HouseholdJob[]>> {
  return section(async () => {
    const { rows } = await query<{ job_type: string; status: string; attempt_count: number; last_error_category: string | null; updated_at: string }>(
      `SELECT job_type, status, attempt_count, last_error_category, updated_at::text AS updated_at
         FROM background_jobs WHERE account_id = $1 AND status <> 'succeeded' ORDER BY updated_at DESC LIMIT 30`, [id]);
    return rows.map((j) => ({ jobType: j.job_type, status: j.status, attempts: num(j.attempt_count), errorCategory: j.last_error_category, updatedAt: j.updated_at }));
  });
}

export async function readHouseholdQuestions(id: string): Promise<Section<{ questions: number; source: HouseholdList["questionsSource"] }>> {
  return section(async () => {
    if (planLimitsEnforced()) {
      try {
        const row = (await query<{ questions: number }>(
          `SELECT questions FROM household_question_counts WHERE account_id = $1 AND month = date_trunc('month', now() AT TIME ZONE 'UTC')::date`, [id])).rows[0];
        return { questions: num(row?.questions), source: "kept_count" as const };
      } catch (e) {
        throw e; // shown as "Not set up in the database yet." rather than a made-up 0
      }
    }
    const row = (await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM chat_messages m JOIN chat_conversations c ON c.id = m.conversation_id
        WHERE c.account_id = $1 AND m.role = 'user' AND m.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [id])).rows[0];
    return { questions: num(row?.n), source: "messages_on_file" as const };
  });
}

/** usageByOperationAndModel() first runs ensureProvenanceSchema() (CREATE ... IF NOT EXISTS). A page view must not
 * create tables, so a database without model_executions shows "Not set up" instead of calling it. */
export async function readHouseholdUsage(id: string): Promise<Section<UsageReport>> {
  return section(async () => {
    const present = (await query<{ present: boolean }>(`SELECT to_regclass('public.model_executions') IS NOT NULL AS present`)).rows[0]?.present;
    if (!present) throw Object.assign(new Error("model_executions missing"), { code: "42P01" });
    return usageByOperationAndModel(id, startOfMonth(), { ensureSchema: false });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Recent errors (last 7 days, every household)
// ---------------------------------------------------------------------------------------------------------------

export type ProcessingFailureRow = HouseholdFailure & { householdId: string };
export type FailedModelCalls = { operation: string; errorCategory: string | null; calls: number; lastAt: string };
export type StuckJobs = { jobType: string; status: string; errorCategory: string | null; jobs: number; lastAt: string };

export const ERROR_WINDOW_LABEL = `last ${ERROR_WINDOW_DAYS} days`;

export async function readRecentProcessingFailures(): Promise<Section<ProcessingFailureRow[]>> {
  return section(async () => {
    const { rows } = await query<{ account_id: string; occurred_at: string; resource_type: string; resource_id: string; failure_code: string; error_class: string | null }>(
      `SELECT d.account_id::text AS account_id, d.occurred_at::text AS occurred_at, d.resource_type, d.resource_id::text AS resource_id, d.failure_code, d.error_class
         FROM processing_failure_diagnostics d JOIN accounts a ON a.id = d.account_id AND ${activePredicate("a")}
        WHERE d.occurred_at >= now() - ($1::int * interval '1 day') ORDER BY d.occurred_at DESC LIMIT 50`, [ERROR_WINDOW_DAYS]);
    return rows.map((f) => ({ householdId: f.account_id, occurredAt: f.occurred_at, resourceType: f.resource_type, resourceId: f.resource_id, failureCode: f.failure_code, errorClass: f.error_class }));
  });
}

export async function readFailedModelCalls(): Promise<Section<FailedModelCalls[]>> {
  return section(async () => {
    const { rows } = await query<{ operation: string; error_category: string | null; calls: number; last_at: string }>(
      `SELECT operation, error_category, count(*)::int AS calls, max(created_at)::text AS last_at
         FROM model_executions WHERE status = 'failed' AND created_at >= now() - ($1::int * interval '1 day')
        GROUP BY 1, 2 ORDER BY calls DESC, last_at DESC LIMIT 30`, [ERROR_WINDOW_DAYS]);
    return rows.map((r) => ({ operation: r.operation, errorCategory: r.error_category, calls: num(r.calls), lastAt: r.last_at }));
  });
}

export async function readStuckJobs(): Promise<Section<StuckJobs[]>> {
  return section(async () => {
    const { rows } = await query<{ job_type: string; status: string; last_error_category: string | null; jobs: number; last_at: string }>(
      `SELECT job_type, status, last_error_category, count(*)::int AS jobs, max(updated_at)::text AS last_at
         FROM background_jobs WHERE status IN ('dead_letter', 'failed_retryable') AND updated_at >= now() - ($1::int * interval '1 day')
        GROUP BY 1, 2, 3 ORDER BY jobs DESC, last_at DESC LIMIT 30`, [ERROR_WINDOW_DAYS]);
    return rows.map((r) => ({ jobType: r.job_type, status: r.status, errorCategory: r.last_error_category, jobs: num(r.jobs), lastAt: r.last_at }));
  });
}
