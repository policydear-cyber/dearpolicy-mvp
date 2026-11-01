import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { invitedToSignUp } from "@/lib/auth/signup-invited";
import { clientKey } from "@/lib/http/rate-limit";
import { createDbRateLimiter } from "@/lib/http/db-rate-limit";
import { CONFIRM_EMAIL_MESSAGE, signupMode, SIGNUP_CLOSED_MESSAGE, SignupClosedError } from "@/lib/auth/signup-gate";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

// Backed by the shared Postgres counter (lib/http/db-rate-limit.ts), so this
// brake holds across every serverless instance, not just whichever one
// answers a given request.
const signupAttempts = createDbRateLimiter({ name: "signup", windowMs: 15 * 60 * 1000, max: 10 });

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(request: Request) {
  const attempt = await signupAttempts.attempt(clientKey(request));
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

  // Invite-only sign-up (lib/auth/signup-gate.ts): checked before any account is made, so a person who is not invited
  // gets no account at all. Any error while checking is a no.
  if (signupMode() === "invite") {
    if (!(await invitedToSignUp(email).catch(() => false))) return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
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
    try {
      await ensureDefaultHousehold(data.user.id, householdName || `${email.split("@")[0]}'s household`, undefined, {
        // A password proves nothing about the address (lib/auth/signup-gate.ts): only the emailed link does.
        email: data.user.email ?? email,
      });
    } catch (e) {
      if (!(e instanceof SignupClosedError)) throw e;
      if (e.reason === "not_invited") return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
      // Invited, but the address is not proven yet. If the auth service signed them straight in (its "Confirm email" is
      // off), leave no session and email a sign-in link: opening it proves the address (app/api/auth/callback).
      if (data.session) {
        await supabase.auth.signOut().catch(() => {});
        await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${origin}/api/auth/callback`, shouldCreateUser: false } }).catch(() => {});
      }
      return NextResponse.json({ ok: true, needsEmailConfirmation: true, message: CONFIRM_EMAIL_MESSAGE });
    }
  }

  return NextResponse.json({
    ok: true,
    // Supabase returns a null session when email confirmation is required;
    // the client uses this to show "check your email" instead of redirecting.
    needsEmailConfirmation: !data.session,
  });
}
