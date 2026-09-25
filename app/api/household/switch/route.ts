import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthenticatedError } from "@/lib/auth/session";
import { resolveActiveHouseholdId } from "@/lib/household/repo";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";

export const runtime = "nodejs";
// "authenticated" rather than "household-member": the whole point of this
// route is to change which household is active, so it must work for a
// caller whose *previous* active household they're switching away from --
// requireHouseholdContext() isn't the right gate here.
export const ROUTE_AUTH = "authenticated" as const;

/** Switches the caller's active household. `householdId` is client-supplied
 * (it has to be -- that's the whole request), but it is NEVER trusted on
 * its own: resolveActiveHouseholdId() re-verifies real, current membership
 * server-side before the cookie is set, so a request naming a household
 * the caller doesn't belong to silently falls back to their own household
 * instead of ever taking effect -- the same "never trust a client-supplied
 * household id without a membership check" rule every other route follows. */
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const body = await request.json().catch(() => ({}));
    const requested = typeof body.householdId === "string" ? body.householdId : null;
    const resolved = await resolveActiveHouseholdId(user.id, requested);
    if (!resolved) {
      return NextResponse.json({ error: "No household" }, { status: 404 });
    }
    const response = NextResponse.json({ ok: true, activeHouseholdId: resolved });
    response.cookies.set(ACTIVE_HOUSEHOLD_COOKIE, resolved, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
