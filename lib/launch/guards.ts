/**
 * Production launch-safety guards.
 *
 * Every function here is a real, testable condition over environment state
 * -- never a source-text grep -- and every one that fails returns
 * `ok: false` with a human-readable reason. `assertProductionSafe()` throws
 * when any guard fails, so importing it from instrumentation.ts (which
 * Next.js runs once, automatically, before the server starts handling
 * requests) turns an unsafe production configuration into a startup crash
 * instead of a silent, exploitable default. The same guards back
 * `npm run launch:check` (scripts/launch-check.ts) so the same logic
 * decides both "should this deploy start" and "is this deploy ready".
 */

export type GuardResult = { ok: boolean; message: string };
export type Guard = (env: NodeJS.ProcessEnv) => GuardResult;

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|on|yes)$/i.test(value?.trim() ?? "");
}

/** lib/auth/gate.ts's shared-password gate and lib/db/client.ts's
 * DEV_ACCOUNT_ID fallback are both development-only and are gated behind
 * this single flag. It must never be set in production. */
export function checkDevAuthNotInProduction(env: NodeJS.ProcessEnv = process.env): GuardResult {
  if (isProduction(env) && truthy(env.DEV_AUTH_ENABLED)) {
    return {
      ok: false,
      message:
        "DEV_AUTH_ENABLED=true in a production environment (NODE_ENV=production). The shared-household-" +
        "password gate and the DEV_ACCOUNT_ID identity fallback are development-only and must never " +
        "authenticate production traffic. Remove DEV_AUTH_ENABLED from production configuration.",
    };
  }
  return { ok: true, message: "DEV_AUTH_ENABLED is not set in production." };
}

export function checkDevAccountIdNotInProduction(env: NodeJS.ProcessEnv = process.env): GuardResult {
  if (isProduction(env) && env.DEV_ACCOUNT_ID?.trim()) {
    return {
      ok: false,
      message:
        "DEV_ACCOUNT_ID is set in a production environment. Account identity must come from an " +
        "authenticated session, never a fixed development id. Remove DEV_ACCOUNT_ID from production configuration.",
    };
  }
  return { ok: true, message: "DEV_ACCOUNT_ID is not set in production." };
}

export function checkDatabaseTlsIsSecure(env: NodeJS.ProcessEnv = process.env): GuardResult {
  if (!isProduction(env)) return { ok: true, message: "Not production; TLS check skipped." };
  if (/^(0|false|off)$/i.test(env.DATABASE_SSL?.trim() ?? "")) {
    return { ok: false, message: "DATABASE_SSL=off in production disables TLS to the database entirely." };
  }
  if (truthy(env.DATABASE_SSL_INSECURE)) {
    return {
      ok: false,
      message:
        "DATABASE_SSL_INSECURE=true in production disables certificate verification (rejectUnauthorized: " +
        "false), which defeats TLS's protection against a man-in-the-middle. Use DATABASE_SSL_CA / " +
        "DATABASE_SSL_CA_PATH instead if a custom CA bundle is required.",
    };
  }
  return { ok: true, message: "Database TLS is configured to verify certificates in production." };
}

const REQUIRED_PRODUCTION_SECRETS = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"] as const;

export function checkRequiredProductionSecrets(env: NodeJS.ProcessEnv = process.env): GuardResult {
  if (!isProduction(env)) return { ok: true, message: "Not production; required-secret check skipped." };
  const missing = REQUIRED_PRODUCTION_SECRETS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    return { ok: false, message: `Missing required production secret(s): ${missing.join(", ")}.` };
  }
  return { ok: true, message: "All required production secrets are present." };
}

export function checkServiceRoleKeyNotPublic(env: NodeJS.ProcessEnv = process.env): GuardResult {
  const leaked = Object.keys(env).filter(
    (key) => key.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE/i.test(key),
  );
  if (leaked.length > 0) {
    return {
      ok: false,
      message: `Found service-role-looking secret(s) exposed to the browser bundle via NEXT_PUBLIC_*: ${leaked.join(", ")}.`,
    };
  }
  return { ok: true, message: "No service-role key is exposed under a NEXT_PUBLIC_* name." };
}

/** Guards that must hold for the server to start at all. Checked by both
 * instrumentation.ts (production runtime) and launch:check (pre-deploy). */
export const PRODUCTION_STARTUP_GUARDS: Guard[] = [
  checkDevAuthNotInProduction,
  checkDevAccountIdNotInProduction,
  checkDatabaseTlsIsSecure,
  checkRequiredProductionSecrets,
  checkServiceRoleKeyNotPublic,
];

export function runGuards(guards: Guard[], env: NodeJS.ProcessEnv = process.env): GuardResult[] {
  return guards.map((guard) => guard(env));
}

/** Throws (crashing server startup under Next.js's instrumentation hook) if
 * any production startup guard fails. */
export function assertProductionSafe(env: NodeJS.ProcessEnv = process.env): void {
  const failures = runGuards(PRODUCTION_STARTUP_GUARDS, env).filter((r) => !r.ok);
  if (failures.length > 0) {
    throw new Error(
      "Refusing to start: unsafe production configuration detected.\n" +
        failures.map((f) => `  - ${f.message}`).join("\n"),
    );
  }
}
