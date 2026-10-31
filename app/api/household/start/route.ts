import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/session";
import { routeErrorResponse } from "@/lib/auth/request-context";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { CONFIRM_EMAIL_MESSAGE, SIGNUP_CLOSED_MESSAGE, SignupClosedError } from "@/lib/auth/signup-gate";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const ROUTE_AUTH = "authenticated" as const;

const Schema = z.object({ name: z.string().trim().max(200).optional() });

/**
 * Round 5 (item 2): after "Permanently delete household" the account has
 * no household; this starts a fresh, empty one with the caller as its sole
 * owner. ensureDefaultHousehold() is idempotent -- an account that already
 * belongs to a household gets that household back, never a second one.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    const body = Schema.parse(await request.json().catch(() => ({})));
    const fallback = user.email ? `${user.email.split("@")[0]}'s household` : "My household";
    // Invite-only sign-up (lib/auth/signup-gate.ts): a session proves nothing about the address; only the emailed link
    // does, so an invited person is sent one and the household is made when they open it (app/api/auth/callback).
    const householdId = await ensureDefaultHousehold(user.id, body.name || fallback, undefined, { email: user.email });
    return NextResponse.json({ ok: true, householdId });
  } catch (error) {
    if (error instanceof SignupClosedError && error.reason === "unproven") {
      const user = await requireCurrentUser().catch(() => null);
      if (user?.email) {
        const supabase = await createSupabaseServerClient();
        await supabase.auth.signInWithOtp({ email: user.email, options: { emailRedirectTo: `${new URL(request.url).origin}/api/auth/callback`, shouldCreateUser: false } }).catch(() => {});
      }
      return NextResponse.json({ error: CONFIRM_EMAIL_MESSAGE }, { status: 403 });
    }
    if (error instanceof SignupClosedError) return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "That household name is too long." }, { status: 400 });
    const response = routeErrorResponse(error, { request, route: "/api/household/start" });
    if (response.status === 500) return NextResponse.json({ error: "Could not start a new household. Please try again." }, { status: 500 });
    return response;
  }
}
