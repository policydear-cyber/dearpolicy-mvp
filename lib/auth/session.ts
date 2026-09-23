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

export type SessionUser = { id: string; email: string | null; emailConfirmedAt: string | null };

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
  return {
    id: configured || "00000000-0000-0000-0000-000000000001",
    email: "dev@localhost",
    emailConfirmedAt: new Date(0).toISOString(),
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
  return { id: user.id, email: user.email ?? null, emailConfirmedAt: user.email_confirmed_at ?? null };
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
