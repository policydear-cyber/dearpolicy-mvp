/**
 * Supabase Auth configuration, resolved as pure functions of an explicit env
 * input (never a bare `process.env` read at call time) so every branch --
 * including "misconfigured" ones -- is unit-testable without process.env
 * mutation tricks, matching the pattern already used by
 * lib/db/client.ts's sslConfig() and lib/launch/guards.ts's guards.
 */

export type SupabaseEnvInput = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  supabaseServiceRoleKey?: string;
};

export type SupabaseClientEnv = { url: string; anonKey: string };

export class SupabaseConfigError extends Error {}

/** Public configuration needed for any Auth-facing Supabase client (browser
 * or server, cookie-bound). Throws with an actionable message rather than
 * constructing a client against `undefined` and failing later with an
 * opaque fetch error deep inside supabase-js. */
export function requireSupabaseClientEnv(input: SupabaseEnvInput = {}): SupabaseClientEnv {
  const url = (input.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const anonKey = (input.supabaseAnonKey ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !anonKey) {
    throw new SupabaseConfigError(
      "Supabase Auth is not configured: SUPABASE_URL and SUPABASE_ANON_KEY (or their NEXT_PUBLIC_ variants) " +
        "must both be set. See lib/launch/guards.ts's checkRequiredProductionSecrets for the production gate.",
    );
  }
  return { url, anonKey };
}

/** Service-role configuration. Deliberately a SEPARATE function from
 * requireSupabaseClientEnv() above -- callers that only need the anon-key
 * client can never accidentally end up holding a service-role key, and
 * `grep -rn requireSupabaseServiceEnv` is a complete, accurate audit of
 * every place in the codebase that touches the service-role key. */
export function requireSupabaseServiceEnv(input: SupabaseEnvInput = {}): SupabaseClientEnv {
  const url = (input.supabaseUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const serviceRoleKey = (input.supabaseServiceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !serviceRoleKey) {
    throw new SupabaseConfigError(
      "Service-role Supabase access is not configured: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
    );
  }
  return { url, anonKey: serviceRoleKey };
}
