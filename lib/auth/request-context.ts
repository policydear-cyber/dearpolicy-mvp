/**
 * The one place every protected API route should resolve "who is making
 * this request, and which household are they acting as" -- replacing the
 * client-controlled/fixed-dev-account pattern (lib/db/client.ts's
 * devAccountId()) route-by-route as each route migrates (see the "API
 * authorization audit" section of the PR description for the full
 * inventory and migration status).
 *
 * A route handler that needs a signed-in household member should do:
 *
 *   const ctx = await requireHouseholdContext();
 *   // ctx.userId, ctx.householdId are both server-resolved -- NEVER take
 *   // either from a client-supplied body/query/header field.
 *   return createUserSupabaseClient(ctx.userId, async (client) => { ... });
 *
 * and catch failures with routeErrorResponse() (below) so every route
 * returns the same shape of 401/403/404 for the same failure, rather than
 * each route inventing its own.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthenticatedError, type SessionUser } from "@/lib/auth/session";
import { resolveActiveHouseholdId, ForbiddenError, NotFoundError, ConflictError } from "@/lib/household/repo";

/** The active-household cookie set by POST /api/household/switch. Plain
 * (non-httpOnly) is fine -- it names which household the UI is currently
 * showing, not a credential; resolveActiveHouseholdId() below always
 * re-verifies real membership server-side before trusting it, so a forged
 * or stale cookie value can, at worst, fall back to the caller's own first
 * household, never grant access to someone else's. */
export const ACTIVE_HOUSEHOLD_COOKIE = "dp_household";

export class NoHouseholdError extends Error {}

export type HouseholdContext = { userId: string; householdId: string; user: SessionUser };

/** Resolves the signed-in user and their active household for this
 * request, in one call, every protected route can rely on:
 *  1. Authenticates (throws UnauthenticatedError if not signed in).
 *  2. Reads the requested household id from a cookie -- NEVER from a body,
 *     query string, or header, which a client could set to any value.
 *  3. Verifies the caller is a genuine current member of that household
 *     (resolveActiveHouseholdId() re-checks membership server-side on
 *     every call; a removed or never-a-member caller cannot use a stale
 *     cookie to keep pointing at a household they don't belong to).
 *  4. Falls back to the caller's own oldest household if the cookie is
 *     missing/stale, or throws NoHouseholdError if they have none. */
export async function requireHouseholdContext(): Promise<HouseholdContext> {
  const user = await requireCurrentUser();
  const cookieStore = await cookies();
  const requested = cookieStore.get(ACTIVE_HOUSEHOLD_COOKIE)?.value ?? null;
  const householdId = await resolveActiveHouseholdId(user.id, requested);
  if (!householdId) {
    throw new NoHouseholdError("This account has no household yet.");
  }
  return { userId: user.id, householdId, user };
}

/** Maps every error class the authorization/household layer can throw to
 * the response a route should return. A foreign or forbidden object and a
 * genuinely missing one deliberately produce the SAME 404 here (per the
 * "return indistinguishable not-found/unauthorized responses for foreign
 * objects" requirement) -- callers must not use ForbiddenError to leak
 * that an object exists but belongs to someone else. */
export function routeErrorResponse(error: unknown): NextResponse {
  if (error instanceof UnauthenticatedError) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (error instanceof NoHouseholdError) {
    return NextResponse.json({ error: "No household" }, { status: 404 });
  }
  if (error instanceof ForbiddenError || error instanceof NotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  throw error;
}
