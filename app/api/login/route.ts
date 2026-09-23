import { NextResponse } from "next/server";
import { AUTH_COOKIE, checkPassword, expectedToken } from "@/lib/auth/gate";
import { clientKey, createRateLimiter } from "@/lib/http/rate-limit";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

// One shared household password has no per-account lockout to fall back on.
// The fixed per-attempt delay below slows a single sequential guesser; this
// caps how many guesses a given source can even queue up in parallel within
// a window, which the delay alone does not stop. Per warm-instance only --
// see lib/http/rate-limit.ts.
const loginAttempts = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

export async function POST(request: Request) {
  const attempt = loginAttempts.attempt(clientKey(request));
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(attempt.retryAfterMs / 1000)) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!(await checkPassword(password))) {
    // A shared password has no per-person lockout to fall back on, so the
    // only cheap brake on guessing it is slowing every wrong answer down.
    await new Promise((resolve) => setTimeout(resolve, 700));
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  const token = await expectedToken();
  const response = NextResponse.json({ ok: true });
  if (token) response.cookies.set(AUTH_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 180 });
  return response;
}
