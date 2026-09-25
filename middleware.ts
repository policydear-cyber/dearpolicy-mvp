import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";
import { isProduction } from "@/lib/launch/guards";
import { checkRequestOrigin } from "@/lib/http/csrf";
import { CORRELATION_ID_HEADER, resolveCorrelationId } from "@/lib/telemetry/correlation";

/** Routes reachable before a visitor has a session: the sign-in/sign-up
 * pages and their APIs, the invitation-acceptance and password-reset/
 * callback flows (which authenticate the visitor as their own first step),
 * and the health check the sidebar polls before anyone has signed in.
 *
 * The household's former shared-password gate (lib/auth/gate.ts,
 * app/api/login/route.ts) is intentionally NOT in this allowlist and is no
 * longer consulted anywhere below -- real per-user Supabase Auth sessions
 * are now the only authentication mechanism this middleware recognizes, in
 * every environment, not just production. lib/auth/gate.ts's functions
 * still exist (and are still hard-disabled in production, still covered by
 * scripts/launch-guard-regressions.ts) only because app/api/login/route.ts
 * itself has not been deleted yet -- neither is reachable through any
 * protected page or API any more. */
const OPEN_PATHS = new Set([
  "/login",
  "/signup",
  "/reset-password",
  "/api/auth/signup",
  "/api/auth/signin",
  "/api/auth/callback",
  "/api/auth/reset-password",
  "/api/health",
]);

/** Server-to-server callback routes (checkpoint 4, claude/v1-launch-
 * hardening) -- a real scan-provider webhook, unlike every other route in
 * this app, is never sent by a browser and carries no Origin/Referer
 * header at all, so lib/http/csrf.ts's Origin check would reject it
 * outright (it fails closed on a missing Origin by design). These routes
 * are exempt from BOTH the CSRF Origin check and the Supabase-session
 * requirement below -- they are not unauthenticated: each one verifies an
 * HMAC signature, a bounded timestamp and a single-use event id itself
 * (see lib/scanning/callback-auth.ts's verifyAndConsumeCallback()), a
 * STRONGER authentication than an Origin header check would provide. This
 * updates the invariant lib/http/csrf.ts's own module comment used to
 * document ("no webhooks, no server-to-server caller") -- see that file's
 * regression suite for the explicit proof this exemption is scoped to
 * exactly these paths and nothing else. */
const INTERNAL_CALLBACK_PATHS = new Set([
  "/api/policies/scan-callback",
  // Vercel Cron's background-job runner: a GET carrying
  // `Authorization: Bearer <CRON_SECRET>`, verified in constant time by
  // lib/jobs/cron-runner.ts's authorizeJobRunner(); refuses every call when
  // CRON_SECRET is not configured.
  "/api/internal/jobs/run",
]);

function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isProduction(env)) return false;
  return /^(1|true|on|yes)$/i.test(env.DEV_AUTH_ENABLED?.trim() ?? "");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Checkpoint 9: resolved once, here, for every request this middleware
  // sees (matching this file's own `config.matcher` below) -- accepted
  // from the incoming header only under lib/telemetry/correlation.ts's
  // strict format/length rule, generated fresh otherwise. Attached to
  // EVERY response this function returns (including the CSRF-block and
  // unauthenticated-401 short-circuits below) via withCorrelationId() so
  // a caller always gets one back, whether or not the request succeeded.
  // Never used for authorization or as a database identifier anywhere --
  // see that module's doc comment.
  const correlationId = resolveCorrelationId(request.headers.get(CORRELATION_ID_HEADER));
  const withCorrelationId = <T extends NextResponse>(res: T): T => {
    res.headers.set(CORRELATION_ID_HEADER, correlationId);
    return res;
  };

  // Checked first, before session refresh or the auth-gate below, and
  // regardless of OPEN_PATHS -- a forged cross-site request against an
  // unauthenticated endpoint (e.g. login/signup CSRF) is exactly as much
  // this check's job as one against an authenticated route. See
  // lib/http/csrf.ts for the full reasoning (Origin-first, Referer
  // fallback, fails closed).
  const isInternalCallback = INTERNAL_CALLBACK_PATHS.has(pathname);
  if (isApi && !isInternalCallback) {
    const originCheck = checkRequestOrigin(request, request.nextUrl.origin);
    if (!originCheck.allowed) {
      return withCorrelationId(NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 }));
    }
  }

  let response: NextResponse = NextResponse.next({ request });
  let user: { id: string } | null = null;
  try {
    const refreshed = await refreshSupabaseSession(request);
    response = refreshed.response;
    user = refreshed.user;
  } catch {
    // Supabase Auth isn't configured yet (e.g. local development before a
    // real Supabase project is wired up). Production can't reach this
    // branch: instrumentation.ts's assertProductionSafe() refuses to boot
    // without SUPABASE_URL/SUPABASE_ANON_KEY configured. Falls through to
    // the dev-auth-enabled check below.
  }

  // Every /api/* response can carry a household's private insurance, health
  // and financial data. Next.js's own default for a dynamic route handler
  // ("public, max-age=0, must-revalidate") still lets a shared cache or
  // proxy between here and the browser store the response; setting this
  // explicitly closes that off instead of relying on the framework default.
  if (isApi) response.headers.set("Cache-Control", "private, no-store");

  // isInternalCallback routes authenticate themselves (see the comment on
  // INTERNAL_CALLBACK_PATHS above) and are never reachable via a Supabase
  // session at all -- exempt from the session requirement below for the
  // same reason they are exempt from the CSRF check above.
  if (OPEN_PATHS.has(pathname) || isInternalCallback) return withCorrelationId(response);
  if (user) return withCorrelationId(response);
  if (devAuthEnabled()) return withCorrelationId(response);

  if (isApi) return withCorrelationId(NextResponse.json({ error: "Not authenticated" }, { status: 401 }));
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return withCorrelationId(NextResponse.redirect(url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png).*)"] };
