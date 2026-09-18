import { NextResponse } from "next/server";
import { AUTH_COOKIE, checkPassword, expectedToken } from "@/lib/auth/gate";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
