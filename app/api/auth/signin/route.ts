import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { SIGNUP_CLOSED_MESSAGE, SignupClosedError } from "@/lib/auth/signup-gate";
import { clientKey } from "@/lib/http/rate-limit";
import { createDbRateLimiter } from "@/lib/http/db-rate-limit";
import { isReviewerOnlyAccount } from "@/lib/claims/reviewers/boundary";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

const signinAttempts = createDbRateLimiter({ name: "signin", windowMs: 15 * 60 * 1000, max: 20 });

export async function POST(request: Request) {
  const attempt = await signinAttempts.attempt(clientKey(request));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(attempt.retryAfterMs / 1000)) } },
    );
  }

  // V1.1 (UX): the sign-in form also posts natively (method=post) so a
  // submit made before the page's scripts load still signs in, with a
  // redirect instead of JSON. The JSON contract used by the page's script is
  // unchanged.
  const contentType = request.headers.get("content-type") ?? "";
  const nativeForm = /application\/x-www-form-urlencoded|multipart\/form-data/i.test(contentType);
  let body: Record<string, unknown> = {};
  if (nativeForm) {
    const form = await request.formData().catch(() => null);
    body = { email: form?.get("email"), password: form?.get("password"), next: form?.get("next") };
  } else {
    body = await request.json().catch(() => ({}));
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const next = typeof body.next === "string" && body.next.startsWith("/") && !body.next.startsWith("//") && !body.next.startsWith("/\\") ? body.next : null;
  const formRedirect = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);
  const backToLogin = (error: string) => formRedirect(`/login?error=${error}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  if (!email || !password) {
    if (nativeForm) return backToLogin("missing_credentials");
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // One generic message for "no such account" and "wrong password" alike
    // -- distinguishing them would let an attacker enumerate registered
    // emails one guess at a time.
    if (nativeForm) return backToLogin("invalid_credentials");
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  // Idempotent -- a pre-existing household is returned untouched; this only
  // does real work for an account that somehow reached sign-in without one
  // (e.g. it was provisioned before this code existed).
  //
  // A DearPolicy staff reviewer who belongs to no household is sent to the
  // reviewer area instead, and never gets a household of their own.
  if (await isReviewerOnlyAccount(data.user.id)) {
    if (nativeForm) return formRedirect("/reviewer");
    return NextResponse.json({ ok: true, destination: "/reviewer" });
  }
  try {
    await ensureDefaultHousehold(data.user.id, `${email.split("@")[0]}'s household`, undefined, { email: data.user.email ?? email });
  } catch (e) {
    // Invite-only sign-up (lib/auth/signup-gate.ts): an account with no household that is not invited gets no session.
    if (!(e instanceof SignupClosedError)) throw e;
    await supabase.auth.signOut().catch(() => {});
    if (nativeForm) return backToLogin("invite_only");
    return NextResponse.json({ error: SIGNUP_CLOSED_MESSAGE }, { status: 403 });
  }
  if (nativeForm) return formRedirect(next ?? "/");
  return NextResponse.json({ ok: true, destination: null });
}
