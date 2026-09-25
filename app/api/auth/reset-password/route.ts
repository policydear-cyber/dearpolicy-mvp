import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientKey } from "@/lib/http/rate-limit";
import { createDbRateLimiter } from "@/lib/http/db-rate-limit";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

const resetAttempts = createDbRateLimiter({ name: "reset-password", windowMs: 60 * 60 * 1000, max: 5 });

export async function POST(request: Request) {
  const attempt = await resetAttempts.attempt(clientKey(request));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(attempt.retryAfterMs / 1000)) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  if (email) {
    const origin = new URL(request.url).origin;
    const supabase = await createSupabaseServerClient();
    // Errors are intentionally swallowed -- see the comment on the response
    // below for why this endpoint never reveals whether the email matched.
    await supabase.auth
      .resetPasswordForEmail(email, { redirectTo: `${origin}/api/auth/callback?next=/update-password` })
      .catch(() => {});
  }

  // Identical response whether or not the email matches an account.
  // Distinguishing the two here would let an attacker enumerate which
  // emails have DearPolicy accounts, one request at a time.
  return NextResponse.json({ ok: true, message: "If that email has an account, a reset link has been sent." });
}
