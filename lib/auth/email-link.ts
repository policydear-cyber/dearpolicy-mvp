/**
 * Emailed auth links (sign-up confirmation, magic sign-in link, password reset) that work in ANY browser.
 *
 * Why (live 18 Nov): the default Supabase links use the PKCE flow. Supabase confirms the address, then sends the
 * browser to /api/auth/callback?code=..., and turning that code into a session needs a "code verifier" cookie that only
 * the browser which asked for the link holds. A household that signs up in Safari and opens the email in Gmail's own
 * browser (or on another device) has no such cookie: the address WAS confirmed, but the callback failed and said "That
 * link has expired or has already been used". Auth log: /verify 303 (user_signedup), then no /token call at all.
 *
 * The fix that works in every browser is a token_hash link (Supabase's documented server-side pattern): the email
 * template links to /confirm?token_hash=...&type=..., and the server calls verifyOtp() itself. No cookie is needed.
 * /confirm shows one button and only the button's POST spends the one-time token, so a mail scanner or link preview
 * that fetches the link cannot use it up.
 *
 * Pure: no I/O.
 */
import { sameSitePath } from "@/lib/auth/same-site-path";

/** The emailed link types this app sends. "email" covers sign-up confirmation and the magic sign-in link. */
export type EmailLinkType = "email" | "signup" | "magiclink" | "recovery";
const LINK_TYPES: readonly EmailLinkType[] = ["email", "signup", "magiclink", "recovery"];

export function parseEmailLinkType(value: unknown): EmailLinkType | null {
  return typeof value === "string" && (LINK_TYPES as readonly string[]).includes(value) ? (value as EmailLinkType) : null;
}

/** A token hash as Supabase prints it into a template: hex (pkce_ prefixed in some versions). Anything else is refused. */
export function parseTokenHash(value: unknown): string | null {
  return typeof value === "string" && /^(pkce_)?[A-Za-z0-9_-]{16,256}$/.test(value) ? value : null;
}

/**
 * Where to go after the link: a path on this site, or null. The template may pass `next={{ .RedirectTo }}`, which is the
 * full address the app asked Supabase to return to (e.g. https://<this site>/api/auth/callback?next=/invite?token=...);
 * then the path inside its own `next` is used. Only this site's own callback or confirm page is unwrapped, so this can
 * never send anyone off the site.
 */
export function emailLinkNext(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith("/")) return sameSitePath(value);
  try {
    const url = new URL(value);
    if (url.origin !== origin) return null;
    if (url.pathname !== "/api/auth/callback" && url.pathname !== "/confirm") return null;
    return sameSitePath(url.searchParams.get("next"));
  } catch {
    return null;
  }
}

/**
 * True when a code exchange failed only because this browser holds no code verifier: the link was opened in a browser
 * other than the one that asked for it. Supabase has already confirmed the address by then (it only sends a `code`
 * after a successful verify), so the honest message is "confirmed, now sign in", not "expired".
 */
export function isMissingCodeVerifier(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; name?: unknown };
  return e.code === "pkce_code_verifier_not_found" || e.name === "AuthPKCECodeVerifierMissingError";
}

/** The sign-in page's address after a link opened in another browser (see isMissingCodeVerifier). */
export function otherBrowserDestination(next: string | null): string {
  return next === "/update-password" ? "/reset-password?error=other_browser" : "/login?notice=email_confirmed";
}
