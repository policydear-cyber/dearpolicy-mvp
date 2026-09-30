import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { listHouseholdMembers } from "@/lib/household/repo";
import { pool } from "@/lib/db/client";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-member" as const;

/** Sign-in emails for this household's own members only (Round 5: members
 * were shown as "Member 1a2b3c4d"). Read from Supabase Auth's users table on
 * the trusted connection, and only for user ids the RLS-scoped roster above
 * already returned; absent (local development without Supabase Auth), the
 * caller's own session email is still known. */
async function memberEmails(userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (!userIds.length) return emails;
  try {
    const present = await pool.query<{ present: boolean }>(`SELECT to_regclass('auth.users') IS NOT NULL AS present`);
    if (!present.rows[0]?.present) return emails;
    const rows = await pool.query<{ id: string; email: string | null }>(`SELECT id::text, email FROM auth.users WHERE id = ANY($1::uuid[])`, [userIds]);
    for (const row of rows.rows) if (row.email) emails.set(row.id, row.email);
  } catch {
    // Names are a convenience; the roster itself never depends on them.
  }
  return emails;
}

/** Lists every member of the caller's active household. Any member (not
 * just the owner) can see the roster -- household_members_select's RLS
 * policy grants read access to every current member, matching the "who's
 * in this household" visibility every member reasonably needs. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const members = await listHouseholdMembers(ctx.userId, ctx.householdId);
    const emails = await memberEmails(members.map((m) => m.userId));
    if (ctx.user.email) emails.set(ctx.userId, ctx.user.email);
    return NextResponse.json({ members: members.map((m) => ({ ...m, email: emails.get(m.userId) ?? null, isSelf: m.userId === ctx.userId })) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
