import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { clientKey } from "@/lib/http/rate-limit";
import { createDbRateLimiter } from "@/lib/http/db-rate-limit";

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

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    // One generic message for "no such account" and "wrong password" alike
    // -- distinguishing them would let an attacker enumerate registered
    // emails one guess at a time.
    return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
  }

  // Idempotent -- a pre-existing household is returned untouched; this only
  // does real work for an account that somehow reached sign-in without one
  // (e.g. it was provisioned before this code existed).
  await ensureDefaultHousehold(data.user.id, `${email.split("@")[0]}'s household`);
  return NextResponse.json({ ok: true });
}
