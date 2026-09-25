import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { requireCurrentUser, UnauthenticatedError, requireRecentAuthentication } from "@/lib/auth/session";
import { listMemberships, renameHousehold } from "@/lib/household/repo";
import { createUserSupabaseClient } from "@/lib/db/authz-client";
import { requestHouseholdDeletion } from "@/lib/lifecycle/coordinator";
import { activePredicate } from "@/lib/lifecycle/scopes";

export const runtime = "nodejs";
// "authenticated" rather than "household-member": a brand-new user with no
// household yet still needs to be able to call GET to see that (an empty
// list), so this route resolves its own membership context below instead
// of requiring requireHouseholdContext() to succeed first.
export const ROUTE_AUTH = "authenticated" as const;

/** Lists every household the caller belongs to, plus which one is
 * currently active (server-resolved -- see lib/auth/request-context.ts).
 * Never 404s for a user with zero households; that's a valid state for a
 * freshly signed-up account before ensureDefaultHousehold() has run, or
 * (in principle) a user who left every household they were in. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    const memberships = await listMemberships(user.id);
    let activeHouseholdId: string | null = null;
    let activeHouseholdName: string | null = null;
    try {
      activeHouseholdId = (await requireHouseholdContext(request)).householdId;
      const active = await createUserSupabaseClient(user.id, (client) =>
        client.query<{ name: string }>(
          `select name from accounts where id = $1 and ${activePredicate()}`,
          [activeHouseholdId],
        ),
      );
      activeHouseholdName = active.rows[0]?.name ?? null;
    } catch {
      // No household yet -- memberships is simply [] in that case.
    }
    return NextResponse.json({ memberships, activeHouseholdId, activeHouseholdName });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return routeErrorResponse(error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

/** Owner-only: rename the active household. RLS's accounts_update policy
 * (is_household_owner()) is what actually enforces the owner requirement --
 * renameHousehold() surfaces a non-owner's attempt as the same
 * NotFoundError a genuinely missing household would produce (see
 * lib/household/repo.ts's comment on why that's deliberate). */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 200) {
      return NextResponse.json({ error: "Enter a household name up to 200 characters." }, { status: 400 });
    }
    await renameHousehold(ctx.userId, ctx.householdId, name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Owner-only, destructive: permanently deletes the active household and
 * (via ON DELETE CASCADE) every policy, claim, family member, and document
 * record it owns. Requires the caller to type the household's current name
 * as `confirmName` in the request body, AND (D35, Wave 2 adversarial
 * audit) a recently-verified session (requireRecentAuthentication()) --
 * an explicit, deliberate confirmation step for an irreversible action,
 * now with both a re-authentication guard and idempotency/deletion-audit
 * recording via the shared lifecycle coordinator. */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    requireRecentAuthentication(ctx.user);
    const body = await request.json().catch(() => ({}));
    const confirmName = typeof body.confirmName === "string" ? body.confirmName.trim() : "";
    // Re-fetch the real household name to compare against, rather than
    // trusting anything client-supplied for the comparison itself.
    // D2/D29 fix: this read must exclude a non-active household the same
    // way every other ordinary accounts read does (lib/lifecycle/scopes.ts's
    // activePredicate()) -- the lifecycle query-guard scanner previously
    // missed this because it wrote its SQL in lowercase.
    const nameRows = await createUserSupabaseClient(ctx.userId, (client) =>
      client.query<{ name: string }>(`select name from accounts where id = $1 and ${activePredicate()}`, [ctx.householdId]),
    );
    const actualName = nameRows.rows[0]?.name ?? "";
    if (!confirmName || confirmName !== actualName) {
      return NextResponse.json(
        { error: "Type the household's exact name to confirm deletion." },
        { status: 400 },
      );
    }
    const idempotencyKey = request.headers.get("idempotency-key") || `delete:${ctx.householdId}`;
    const outcome = await requestHouseholdDeletion({ actorUserId: ctx.userId, householdId: ctx.householdId, idempotencyKey });
    return NextResponse.json({ ok: true, deletionRequestId: outcome.deletionRequestId, status: outcome.status });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
