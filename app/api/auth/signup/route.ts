import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { clientKey, createRateLimiter } from "@/lib/http/rate-limit";

export const runtime = "nodejs";

// Per-warm-instance brake on account creation -- see lib/http/rate-limit.ts
// for why this is not yet a real distributed limit (Priority 5).
const signupAttempts = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const attempt = signupAttempts.attempt(clientKey(request));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(attempt.retryAfterMs / 1000)) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const householdName = typeof body.householdName === "string" ? body.householdName.trim().slice(0, 200) : "";

  if (!isValidEmail(email) || password.length < 8) {
    return NextResponse.json({ error: "Enter a valid email and a password of at least 8 characters." }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/api/auth/callback` },
  });

  if (error) {
    // Supabase's own message here (e.g. "User already registered") describes
    // only THIS attempt's outcome, not a separate lookup -- it doesn't leak
    // anything an attacker couldn't already infer from the attempt itself.
    return NextResponse.json({ error: error.message }, { status: error.status && error.status < 500 ? error.status : 400 });
  }

  // A household must exist before the person can do anything in the app.
  // Creating it here (rather than waiting for first sign-in) means it also
  // exists under email-confirmation-required configurations, where no
  // session comes back from signUp() yet. ensureDefaultHousehold() is
  // idempotent, so calling it again at sign-in/callback is always safe.
  if (data.user) {
    await ensureDefaultHousehold(data.user.id, householdName || `${email.split("@")[0]}'s household`);
  }

  return NextResponse.json({
    ok: true,
    // Supabase returns a null session when email confirmation is required;
    // the client uses this to show "check your email" instead of redirecting.
    needsEmailConfirmation: !data.session,
  });
}
