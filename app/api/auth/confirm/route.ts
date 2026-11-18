import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { finishEmailLink } from "@/lib/auth/finish-email-link";
import { emailLinkNext, parseEmailLinkType, parseTokenHash } from "@/lib/auth/email-link";

export const runtime = "nodejs";
export const ROUTE_AUTH = "public" as const;

/**
 * The button on /confirm: checks an emailed link's token_hash with the auth service and signs this browser in. Unlike
 * the code exchange in app/api/auth/callback it needs nothing stored in the browser beforehand, so the link works in
 * whatever browser opens it (lib/auth/email-link.ts). POST only: opening the link never spends the token.
 */
export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  const form = await request.formData().catch(() => null);
  const tokenHash = parseTokenHash(form?.get("token_hash"));
  const type = parseEmailLinkType(form?.get("type"));
  const rawNext = emailLinkNext(form?.get("next"), origin);
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303);

  if (!tokenHash || !type) return go("/login?error=missing_code");
  const reset = type === "recovery";

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !data.user) return go(reset ? "/reset-password?error=expired" : "/login?error=invalid_or_expired_link");

  // A reset link always goes on to choosing a new password, whatever `next` says.
  const next = reset ? "/update-password" : rawNext ?? "/";
  return go(await finishEmailLink(supabase.auth, data.user, next, rawNext));
}
