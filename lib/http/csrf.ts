/**
 * Origin-header CSRF defense for state-changing requests -- the piece of
 * Priority 5 that was entirely missing before this checkpoint (see
 * middleware.ts, which wires checkRequestOrigin() in ahead of every other
 * check on every /api/* request).
 *
 * ## Why an Origin/Referer check, not a synchronizer token
 * This app authenticates with a cookie-based session (Supabase Auth's own
 * cookies, set by lib/supabase/middleware.ts) with no separate CSRF token
 * anywhere in its forms or fetch calls today -- adding one would mean a
 * new token-issuing endpoint, storing/rotating it, and threading it through
 * every client-side POST/PATCH/DELETE call, a much larger surface to get
 * right. An Origin check is the defense OWASP's own CSRF cheat sheet lists
 * as sufficient on its own for exactly this shape of app: it needs no
 * server-side state, no client changes, and modern browsers make it
 * reliable -- per the Fetch spec, a browser attaches the `Origin` header to
 * every non-GET/HEAD request regardless of whether it's cross-origin, and
 * an attacker's page cannot forge or suppress it (unlike `Referer`, which
 * some privacy settings strip). This module trusts `Origin` first and
 * falls back to `Referer` only when `Origin` is absent, matching Chrome's
 * own fallback behavior for older/edge-case requests.
 *
* ## Deliberately fails CLOSED, unlike lib/http/db-rate-limit.ts
 * A request with neither header is rejected, not allowed through. This is
 * the opposite trade-off from db-rate-limit.ts's fail-open choice, and
 * deliberately so: rate limiting is one layer of defense in depth behind
 * real authorization checks, so a rate-limiter outage doesn't create a new
 * hole. A CSRF check IS the authorization boundary being enforced here --
 * failing it open would mean the one request shape a forged cross-site
 * form submission naturally produces (no Origin, an absent or stripped
 * Referer) sails straight through. Every browser-facing route in this app
 * requires a browser-set session cookie via requireHouseholdContext()/
 * requireCurrentUser() or is itself a browser-facing auth form endpoint,
 * so rejecting an Origin-less request costs nothing for those.
 *
 * ## The one exception: authenticated server-to-server callbacks
 * checkpoint 4 (claude/v1-launch-hardening) added a real webhook receiver
 * (a scan-provider callback, app/api/policies/scan-callback/route.ts) that
 * is never sent by a browser and so never carries an Origin/Referer header
 * at all. middleware.ts exempts that route -- by exact path, via its own
 * INTERNAL_CALLBACK_PATHS set, checked BEFORE this module's check ever
 * runs -- rather than weakening checkRequestOrigin() itself, which stays
 * exactly as strict as before for every route not on that explicit list.
 * The exempted route is not unauthenticated: it verifies an HMAC
 * signature, a bounded timestamp and a single-use event id instead (see
 * lib/scanning/callback-auth.ts), which an Origin header could not provide
 * anyway (an attacker fully controls what Origin their own server sends).
 */

export const CSRF_CHECKED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type OriginCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "missing_origin" | "cross_origin" };

type HeaderSource = { get(name: string): string | null };

function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Compares two origin strings by parsing both through URL rather than a
 * raw string compare, so equivalent-but-differently-formatted values still
 * match, and so a malformed or non-URL value (including the literal string
 * "null", which browsers send as Origin from a sandboxed iframe or a
 * cross-origin redirect) safely resolves to "not equal" instead of
 * throwing. */
function originsEqual(a: string, b: string): boolean {
  try {
    return new URL(a).origin.toLowerCase() === new URL(b).origin.toLowerCase();
  } catch {
    return false;
  }
}

/** `expectedOrigin` is this deployment's own origin -- callers pass
 * `request.nextUrl.origin` (the convention already used elsewhere in this
 * codebase, e.g. app/api/auth/signup/route.ts's `new URL(request.url).origin`),
 * which reflects the Host header Vercel/Next.js resolved the request
 * against, not a hardcoded value. Only methods in CSRF_CHECKED_METHODS are
 * examined; every other method (GET, HEAD, OPTIONS, ...) is always
 * allowed, since Origin-based CSRF defense only needs to gate
 * state-changing requests. */
export function checkRequestOrigin(request: { method: string; headers: HeaderSource }, expectedOrigin: string): OriginCheckResult {
  if (!CSRF_CHECKED_METHODS.has(request.method.toUpperCase())) return { allowed: true };

  const origin = request.headers.get("origin");
  const candidate = origin ?? originFromReferer(request.headers.get("referer"));

  if (candidate === null) return { allowed: false, reason: "missing_origin" };
  if (!originsEqual(candidate, expectedOrigin)) return { allowed: false, reason: "cross_origin" };
  return { allowed: true };
}
