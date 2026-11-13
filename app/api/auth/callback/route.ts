import { NextResponse } from "next/server";
import { safeInviteNext } from "@/lib/auth/invite-return";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { secureFirstProof, signupMode, SignupClosedError } from "@/lib/auth/signup-gate";

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
  // Invite-only sign-up (lib/auth/signup-gate.ts): the code exchange proves the person opened a link sent to this
  // address. Before a household is made for it, any password set before this proof is replaced and every other session
  // signed out (someone may have pre-registered the address), and the owner then sets their own password.
  const inviteOnly = signupMode() === "invite";
  let made = false;
  try {
    await ensureDefaultHousehold(data.user.id, `${(data.user.email ?? "my").split("@")[0]}'s household`, undefined, {
      email: data.user.email,
      emailProven: true,
      beforeCreate: inviteOnly ? async () => { await secureFirstProof(supabase.auth); made = true; } : undefined,
    });
  } catch (e) {
    await supabase.auth.signOut().catch(() => {});
    if (e instanceof SignupClosedError) return NextResponse.redirect(new URL("/login?error=invite_only", url.origin));
    if (inviteOnly) return NextResponse.redirect(new URL("/login?error=invalid_or_expired_link", url.origin));
    throw e;
  }

  // First proof of an invited address: they set their own password first, then go on to the invitation's join page
  // when they came from one (lib/auth/invite-return.ts; any other `next` is not carried past the password step).
  const inviteNext = safeInviteNext(url.searchParams.get("next"));
  if (made) return NextResponse.redirect(new URL("/update-password?first=1" + (inviteNext ? `&next=${encodeURIComponent(inviteNext)}` : ""), url.origin));
  return NextResponse.redirect(new URL(next, url.origin));
}
