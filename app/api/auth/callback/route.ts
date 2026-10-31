import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { SignupClosedError } from "@/lib/auth/signup-gate";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

// Only ever redirect within this app. `next` is attacker-controlled query
// input (an email link's query string can be tampered with before it's
// clicked), and returning it verbatim to NextResponse.redirect would be an
// open-redirect vulnerability if it ever contained an absolute/protocol-
// relative URL.
function sanitizeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

/** Handles every Supabase Auth email-link flow that lands back in this app
 * with a `code` to exchange for a session: signup confirmation, magic link,
 * and password-reset (which sets `next=/update-password`, see
 * app/api/auth/reset-password/route.ts). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNext(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=invalid_or_expired_link", url.origin));
  }

  // Idempotent -- see app/api/auth/signup/route.ts for why this needs to run
  // here too (email-confirmation-required accounts have no household yet).
  try {
    await ensureDefaultHousehold(data.user.id, `${(data.user.email ?? "my").split("@")[0]}'s household`, undefined, { email: data.user.email });
  } catch (e) {
    // Invite-only sign-up (lib/auth/signup-gate.ts): not invited, so no household and no session.
    if (!(e instanceof SignupClosedError)) throw e;
    await supabase.auth.signOut().catch(() => {});
    return NextResponse.redirect(new URL("/login?error=invite_only", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
