import { NextResponse } from "next/server";
import { requireCurrentUser, UnauthenticatedError } from "@/lib/auth/session";
import { acceptInvitation, ForbiddenError, NotFoundError } from "@/lib/household/repo";
import { ACTIVE_HOUSEHOLD_COOKIE } from "@/lib/auth/request-context";
import { clientKey } from "@/lib/http/rate-limit";
import { createDbRateLimiter } from "@/lib/http/db-rate-limit";

export const runtime = "nodejs";
// "authenticated" rather than "household-member": accepting an invitation
// is precisely how a user WITHOUT membership in the target household
// gains it -- requireHouseholdContext() would reject them before they
// could ever accept.
export const ROUTE_AUTH = "authenticated" as const;

// A guessed/brute-forced token is the only way this endpoint could be
// abused (the token itself is 256 bits of randomness, so brute force is
// already infeasible, but rate limiting is a cheap, standard second layer
// against any single caller hammering this route).
const acceptAttempts = createDbRateLimiter({ name: "invitations-accept", windowMs: 15 * 60 * 1000, max: 20 });

/** Accepts a household invitation for the signed-in caller. The caller
 * authenticates first (requireCurrentUser()); acceptInvitation() then does
 * every remaining check server-side against the REAL session identity and
 * email -- never anything the client could set to a different value -- and
 * sets the newly-joined household as active so the next page load lands
 * the person in it. A user must not gain access merely by knowing a
 * household ID or invitation ID: this route only ever accepts a `token`,
 * which is never returned by any GET/list endpoint. */
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    const attempt = await acceptAttempts.attempt(clientKey(request));
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(attempt.retryAfterMs / 1000)) } },
      );
    }
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token : "";
    if (!token) return NextResponse.json({ error: "A token is required." }, { status: 400 });
    if (!user.email) {
      // Shouldn't normally happen (Supabase Auth requires a verified
      // email for password-based signup), but acceptInvitation()'s
      // email-match check needs a real email to compare against.
      return NextResponse.json({ error: "Your account has no verified email." }, { status: 400 });
    }
    const householdId = await acceptInvitation(token, user.id, user.email);
    const response = NextResponse.json({ ok: true, householdId });
    response.cookies.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
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
    if (error instanceof ForbiddenError || error instanceof NotFoundError) {
      // Deliberately the same generic message/status for "no such token",
      // "expired", "already used", and "wrong email" -- distinguishing
      // them would let an attacker probe which reason applies to a given
      // guessed token.
      return NextResponse.json({ error: "This invitation link is invalid or has expired." }, { status: 400 });
    }
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
