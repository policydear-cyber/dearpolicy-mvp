import { NextResponse } from "next/server";
import { sameSitePath } from "@/lib/auth/same-site-path";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { finishEmailLink } from "@/lib/auth/finish-email-link";
import { isMissingCodeVerifier, otherBrowserDestination } from "@/lib/auth/email-link";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

// Only ever redirect within this app. `next` is attacker-controlled query
// input (an email link's query string can be tampered with before it's
// clicked), and returning it verbatim to NextResponse.redirect would be an
// open-redirect vulnerability if it ever contained an absolute/protocol-
// relative URL.
function sanitizeNext(next: string | null): string {
  return sameSitePath(next) ?? "/";
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
    // Supabase sends a spent or out-of-date link back here with error_code (e.g. otp_expired) and no code: that link
    // has expired, it is not "incomplete".
    if (url.searchParams.get("error_code") || url.searchParams.get("error")) {
      return NextResponse.redirect(new URL(next === "/update-password" ? "/reset-password?error=expired" : "/login?error=invalid_or_expired_link", url.origin));
    }
    return NextResponse.redirect(new URL("/login?error=missing_code", url.origin));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    // Opened in another browser than the one that asked for the link (lib/auth/email-link.ts): Supabase has already
    // confirmed the address, only this browser cannot finish signing in. Say so, instead of "expired".
    if (isMissingCodeVerifier(error)) return NextResponse.redirect(new URL(otherBrowserDestination(next), url.origin));
    return NextResponse.redirect(new URL("/login?error=invalid_or_expired_link", url.origin));
  }

  // The household, the invite-only proof and where to go next: shared with app/api/auth/confirm (lib/auth/finish-email-link.ts).
  const destination = await finishEmailLink(supabase.auth, data.user, next, url.searchParams.get("next"));
  return NextResponse.redirect(new URL(destination, url.origin));
}
