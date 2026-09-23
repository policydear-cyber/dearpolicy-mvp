import { NextResponse, type NextRequest } from "next/server";
import { requireHouseholdContext, routeErrorResponse } from "@/lib/auth/request-context";
import { listInvitations, createInvitation, type Role } from "@/lib/household/repo";
import { clientKey, createRateLimiter } from "@/lib/http/rate-limit";

export const runtime = "nodejs";
export const ROUTE_AUTH = "household-owner" as const;

// Per-warm-instance brake on invitation creation -- see
// lib/http/rate-limit.ts for why this isn't yet a real distributed limit
// (Priority 5). Bounds how fast an owner account (or a compromised
// session) can spam invitation emails.
const inviteAttempts = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 20 });

function isRole(value: unknown): value is Role {
  return value === "owner" || value === "member" || value === undefined;
}

/** Owner-only: lists pending invitations for the active household. RLS
 * itself enforces the owner requirement (a member's query would just
 * return zero rows), but the classification here still labels this
 * "household-owner" so the route inventory reflects intent. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const invitations = await listInvitations(ctx.userId, ctx.householdId);
    return NextResponse.json({ invitations });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Owner-only: creates an invitation and returns the plaintext token once
 * (see createInvitation()'s doc comment -- only its hash is ever stored).
 * The caller is responsible for delivering the token to the invitee (e.g.
 * embedding it in an emailed accept link); this route does not send email
 * itself yet (tracked in the PR description -- invitation delivery is
 * currently a manual/out-of-band step). */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireHouseholdContext(request);
    const attempt = inviteAttempts.attempt(`${ctx.userId}:${clientKey(request)}`);
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: "Too many invitations sent. Try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(attempt.retryAfterMs / 1000)) } },
      );
    }
    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === "string" ? body.email : "";
    if (!isRole(body.role)) {
      return NextResponse.json({ error: "role must be \"owner\" or \"member\"." }, { status: 400 });
    }
    const { token, expiresAt } = await createInvitation(ctx.userId, ctx.householdId, email, body.role ?? "member");
    return NextResponse.json({ token, expiresAt }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
