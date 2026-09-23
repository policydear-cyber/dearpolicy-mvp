import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireCurrentUser, UnauthenticatedError } from "@/lib/auth/session";

export const runtime = "nodejs";

/** Sets a new password for the CURRENTLY SIGNED-IN session only -- either an
 * ordinary authenticated user changing their password, or the short-lived
 * recovery session middleware.ts already accepted after
 * app/api/auth/callback/route.ts exchanged a password-reset link's code.
 * There is no separate "reset token" accepted here: Supabase's own
 * short-lived recovery session IS the authorization, which is why this
 * route is deliberately NOT in middleware.ts's OPEN_PATHS allowlist. */
export async function POST(request: Request) {
  try {
    await requireCurrentUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    throw error;
  }

  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
