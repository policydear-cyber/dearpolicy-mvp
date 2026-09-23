import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientKey, createRateLimiter } from "@/lib/http/rate-limit";

export const runtime = "nodejs";

const resetAttempts = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });

export async function POST(request: Request) {
  const attempt = resetAttempts.attempt(clientKey(request));
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
