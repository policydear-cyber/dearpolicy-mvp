/**
 * Server-side "who is making this request" resolution. Every protected
 * Route Handler should call getCurrentUser() (or requireCurrentUser()) as
 * its FIRST line of real work -- before any database, storage, model, or
 * processing call -- and use the returned id as the userId argument to
 * lib/db/authz-client.ts's createUserSupabaseClient(), never a
 * client-supplied accountId/userId.
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isProduction } from "@/lib/launch/guards";

export type SessionUser = { id: string; email: string | null; emailConfirmedAt: string | null; lastSignInAt: string | null; createdAt?: string | null };

/** Development-only identity fallback, mirroring lib/db/client.ts's
 * devAccountId() guard exactly: gated behind DEV_AUTH_ENABLED, and
 * unconditionally unavailable in production regardless of any other
 * configuration. Lets local development continue without requiring a real
 * Supabase project to be configured, without ever being reachable in
 * production. */
function devSessionUser(env: NodeJS.ProcessEnv = process.env): SessionUser | null {
  if (isProduction(env)) return null;
  if (!/^(1|true|on|yes)$/i.test(env.DEV_AUTH_ENABLED?.trim() ?? "")) return null;
  const configured = env.DEV_ACCOUNT_ID?.trim();
  // DEV_LAST_SIGN_IN_AT lets regression suites simulate a stale session
  // (for requireRecentAuthentication() below) without a real Supabase
  // project to sign in against; unset, a dev session is always "just
  // signed in" so ordinary local development is never blocked by it.
  const lastSignInAt = env.DEV_LAST_SIGN_IN_AT?.trim() || new Date().toISOString();
  return {
    id: configured || "00000000-0000-0000-0000-000000000001",
    email: "dev@localhost",
    emailConfirmedAt: new Date(0).toISOString(),
    lastSignInAt,
  };
}

/** Resolves the signed-in user from the request's Supabase session cookie
 * (already refreshed by middleware.ts), or null if nobody is signed in. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const dev = devSessionUser();
  if (dev) return dev;

  const supabase = await createSupabaseServerClient({ readonly: true });
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    createdAt: user.created_at ?? null,
    // Supabase Auth's own record of when this user last completed a real
    // sign-in (password, magic link, OAuth...) -- not something this app
    // tracks itself, so it cannot be spoofed by anything short of a
    // genuine sign-in. requireRecentAuthentication() below is what
    // actually gates sensitive actions on it; this is just where it's read.
    lastSignInAt: user.last_sign_in_at ?? null,
  };
}

export class UnauthenticatedError extends Error {}

/** Same as getCurrentUser(), but throws for routes that have no meaningful
 * "not signed in" response other than 401 -- keeps route handlers from
 * forgetting the null check. */
export async function requireCurrentUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError("Not authenticated");
  return user;
}

/** Thrown by requireRecentAuthentication() below -- distinct from
 * UnauthenticatedError (no session at all) so routeErrorResponse() can
 * give the caller a response that specifically says "sign in again",
 * not just "not signed in". */
export class StaleAuthenticationError extends Error {}

export const RECENT_AUTHENTICATION_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

/** Guards a sensitive/destructive action (household export, account
 * deletion, and similar) behind "this session authenticated recently".
 * Built on Supabase Auth's own last_sign_in_at (see getCurrentUser()
 * above), updated only by a genuine sign-in -- never something this app
 * writes itself, so it cannot be spoofed by, say, keeping a browser tab
 * open for days. A session with no recorded sign-in time, or one older
 * than `maxAgeMs`, must not be trusted with an action like "export every
 * record this household holds" -- the caller should ask the person to
 * sign in again first (a real re-authentication step, not implemented by
 * this function itself, which only decides whether one is required). */
export function requireRecentAuthentication(
  user: SessionUser,
  maxAgeMs: number = RECENT_AUTHENTICATION_MAX_AGE_MS,
  now: number = Date.now(),
): void {
  if (!user.lastSignInAt) {
    throw new StaleAuthenticationError("This session has no recorded sign-in time -- please sign in again to continue.");
  }
  const signedInAt = Date.parse(user.lastSignInAt);
  if (!Number.isFinite(signedInAt) || now - signedInAt > maxAgeMs) {
    throw new StaleAuthenticationError("Please sign in again to confirm it's you before continuing.");
  }
}
