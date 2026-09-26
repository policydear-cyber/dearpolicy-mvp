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

/** Shared truthy-env-var parser -- also used by lib/claims/evidence/
 * scan-adapter.ts's production scanner-configuration guard, so both
 * "truthy" boolean flags in this codebase parse identically. */
export function truthy(value: string | undefined): boolean {
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

const REQUIRED_PRODUCTION_SECRETS = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "TELEMETRY_PSEUDONYM_SECRET"] as const;

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
/** Checkpoint 9: lib/telemetry/index.ts's default adapter in production
 * is NoopTelemetryAdapter (lib/telemetry/adapters.ts) until a real
 * production destination is wired in and this flag is explicitly set --
 * there is no live vendor configured in this environment to build one
 * against, so this guard is EXPECTED to fail in a from-scratch
 * production environment (an external-configuration blocker, not a code
 * gap) until that adapter and this flag are both provided. For a prototype or
 * internal test, TELEMETRY_INTENTIONALLY_DISABLED=true is the explicit,
 * acknowledged alternative: exactly one of the two must be set. */
export function checkTelemetryProductionAdapterConfigured(env: NodeJS.ProcessEnv = process.env): GuardResult {
  if (!isProduction(env)) return { ok: true, message: "Not production; telemetry-adapter check skipped." };
  const configured = truthy(env.TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED);
  const disabled = truthy(env.TELEMETRY_INTENTIONALLY_DISABLED);
  if (configured && disabled) {
    return {
      ok: false,
      message:
        "Both TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED and TELEMETRY_INTENTIONALLY_DISABLED are set. They contradict each " +
        "other; set exactly one.",
    };
  }
  if (disabled) {
    return { ok: true, message: TELEMETRY_INTENTIONALLY_DISABLED_WARNING };
  }
  if (!configured) {
    return {
      ok: false,
      message:
        "No production telemetry adapter is configured (TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED is not set). " +
        "lib/telemetry/index.ts is silently using NoopTelemetryAdapter -- every recordEvent() call succeeds but " +
        "nothing is actually emitted anywhere. Wire a real TelemetryAdapter (lib/telemetry/adapters.ts) for the " +
        "production destination and set this flag once it is verified working, or -- for a prototype or internal " +
        "test only -- set TELEMETRY_INTENTIONALLY_DISABLED=true to knowingly run without operational telemetry.",
    };
  }
  return { ok: true, message: "A production telemetry adapter has been confirmed configured." };
}

/** Privacy-safe by construction: a fixed string, no environment values. */
export const TELEMETRY_INTENTIONALLY_DISABLED_WARNING =
  "TELEMETRY_INTENTIONALLY_DISABLED=true: this deployment is running WITHOUT operational telemetry. recordEvent() " +
  "calls are still redacted and still reach the NoopTelemetryAdapter, which emits nothing, so no alert (scan " +
  "failures, stuck quarantine, dead letters, failed exports or deletions, rejected calculations, authorization " +
  "failures) can fire. Acceptable only for a prototype or internal testing, never for real users.";

/** True when production is knowingly running without telemetry (exactly the
 * acknowledged state checkTelemetryProductionAdapterConfigured() accepts). */
export function telemetryIntentionallyDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isProduction(env) && truthy(env.TELEMETRY_INTENTIONALLY_DISABLED) && !truthy(env.TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED);
}

/** Minimum CRON_SECRET length; shorter values are treated as not configured.
 * Shared with lib/jobs/cron-runner.ts's authorizeJobRunner() so the startup
 * guard and the endpoint agree on what "configured" means. */
export const MIN_CRON_SECRET_LENGTH = 16;

/** The background-job runner (app/api/internal/jobs/run) authenticates every
 * call with `Authorization: Bearer <CRON_SECRET>` and refuses all calls
 * without it -- so a production deployment without a usable CRON_SECRET would
 * start, accept uploads, and silently never process them. Refuse to start
 * instead. Never reports the value or its length. */
export function checkCronSecretConfigured(env: NodeJS.ProcessEnv = process.env): GuardResult {
  if (!isProduction(env)) return { ok: true, message: "Not production; CRON_SECRET check skipped." };
  if ((env.CRON_SECRET?.trim() ?? "").length < MIN_CRON_SECRET_LENGTH) {
    return {
      ok: false,
      message:
        `CRON_SECRET is missing or shorter than ${MIN_CRON_SECRET_LENGTH} characters. The background-job runner ` +
        "(/api/internal/jobs/run) refuses every call without it, so uploads, evidence, exports and chat analysis " +
        "would stay queued forever. Set a long random CRON_SECRET in Production (Sensitive).",
    };
  }
  return { ok: true, message: "CRON_SECRET is configured for the background-job runner." };
}

export const PRODUCTION_STARTUP_GUARDS: Guard[] = [
  checkDevAuthNotInProduction,
  checkDevAccountIdNotInProduction,
  checkDatabaseTlsIsSecure,
  checkRequiredProductionSecrets,
  checkServiceRoleKeyNotPublic,
  checkTelemetryProductionAdapterConfigured,
  checkCronSecretConfigured,
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
