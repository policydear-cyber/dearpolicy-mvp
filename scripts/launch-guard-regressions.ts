/**
 * Regression suite proving the production launch guards actually change
 * behaviour through the real application path -- not just that a checker
 * function returns false. Each assertion here exercises the real exported
 * function (lib/auth/gate.ts's expectedToken()/checkPassword(),
 * lib/db/client.ts's devAccountId(), lib/launch/guards.ts's individual
 * guards and assertProductionSafe()) with NODE_ENV genuinely set to
 * "production" for the duration of the check, not a string comparison
 * against a mocked value.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  checkDevAuthNotInProduction,
  checkDevAccountIdNotInProduction,
  checkRequiredProductionSecrets,
  checkServiceRoleKeyNotPublic,
  checkTelemetryProductionAdapterConfigured,
  telemetryIntentionallyDisabled,
  TELEMETRY_INTENTIONALLY_DISABLED_WARNING,
  assertProductionSafe,
} from "@/lib/launch/guards";

async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) original[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runGateProductionRegressions() {
  await withEnv({ NODE_ENV: "production", SITE_PASSWORD: "correct horse battery staple" }, async () => {
    const { expectedToken, checkPassword } = await import("@/lib/auth/gate");
    const expected = await expectedToken();
    assert.notEqual(expected, null, "the gate must appear \"active\" in production, never open-access");
    // No real login flow can ever satisfy it: checkPassword() itself always
    // returns false in production, so nothing can ever mint the cookie
    // value expectedToken() demands.
    assert.equal(await checkPassword("correct horse battery staple"), false, "checkPassword must always reject in production, even the real configured password");
    assert.equal(await checkPassword(""), false, "checkPassword must reject in production regardless of input");
  });
  console.log("lib/auth/gate.ts production-disable regressions passed.");
}

async function runDevAccountIdProductionRegressions() {
  await withEnv({ NODE_ENV: "production", DEV_ACCOUNT_ID: "00000000-0000-0000-0000-000000000001" }, async () => {
    const { devAccountId } = await import("@/lib/db/client");
    assert.throws(() => devAccountId(), /production/i, "devAccountId() must throw in production, never fall back to the fixed dev id");
  });
  console.log("lib/db/client.ts devAccountId() production-disable regression passed.");
}

function runGuardRegressions() {
  const prodBase: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@db.example.supabase.co:5432/postgres",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    SUPABASE_ANON_KEY: "anon-key",
    TELEMETRY_PSEUDONYM_SECRET: "test-pseudonym-secret-32-bytes-min",
    TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: "true",
  };

  assert.equal(checkDevAuthNotInProduction(prodBase).ok, true, "DEV_AUTH_ENABLED unset in production must pass");
  assert.equal(
    checkDevAuthNotInProduction({ ...prodBase, DEV_AUTH_ENABLED: "true" }).ok,
    false,
    "DEV_AUTH_ENABLED=true in production must fail the guard",
  );
  assert.equal(checkDevAuthNotInProduction({ ...prodBase, NODE_ENV: "development", DEV_AUTH_ENABLED: "true" }).ok, true, "DEV_AUTH_ENABLED=true outside production must pass");

  assert.equal(checkDevAccountIdNotInProduction(prodBase).ok, true, "DEV_ACCOUNT_ID unset in production must pass");
  assert.equal(
    checkDevAccountIdNotInProduction({ ...prodBase, DEV_ACCOUNT_ID: "00000000-0000-0000-0000-000000000001" }).ok,
    false,
    "DEV_ACCOUNT_ID set in production must fail the guard",
  );

  assert.equal(checkRequiredProductionSecrets(prodBase).ok, true, "all required secrets present must pass");
  const { SUPABASE_ANON_KEY: _omit, ...missingAnon } = prodBase;
  assert.equal(checkRequiredProductionSecrets(missingAnon).ok, false, "a missing required secret must fail the guard");

  assert.equal(checkServiceRoleKeyNotPublic(prodBase).ok, true, "no NEXT_PUBLIC_* service-role key must pass");
  assert.equal(
    checkServiceRoleKeyNotPublic({ ...prodBase, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "leaked" }).ok,
    false,
    "a service-role key under a NEXT_PUBLIC_* name must fail the guard",
  );

  assert.equal(
    checkTelemetryProductionAdapterConfigured(prodBase).ok,
    true,
    "TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED=true in production must pass",
  );
  const { TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: _omitAdapter, ...missingAdapterFlag } = prodBase;
  assert.equal(
    checkTelemetryProductionAdapterConfigured(missingAdapterFlag).ok,
    false,
    "no production telemetry adapter configured must fail the guard -- this is a launch blocker",
  );
  assert.equal(
    checkTelemetryProductionAdapterConfigured({ ...missingAdapterFlag, NODE_ENV: "development" }).ok,
    true,
    "the telemetry-adapter guard must be a no-op outside production",
  );

  // Telemetry: exactly one of TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED and
  // TELEMETRY_INTENTIONALLY_DISABLED must be set in production.
  {
    const neither = missingAdapterFlag;
    const both = { ...prodBase, TELEMETRY_INTENTIONALLY_DISABLED: "true" };
    const configuredOnly = prodBase;
    const disabledOnly = { ...missingAdapterFlag, TELEMETRY_INTENTIONALLY_DISABLED: "true" };

    assert.equal(checkTelemetryProductionAdapterConfigured(neither).ok, false, "telemetry: neither flag set must fail");
    assert.throws(() => assertProductionSafe(neither), /Refusing to start/, "telemetry: neither flag set must refuse startup");

    const bothResult = checkTelemetryProductionAdapterConfigured(both);
    assert.equal(bothResult.ok, false, "telemetry: both flags set must fail");
    assert.match(bothResult.message, /set exactly one/, "telemetry: both flags set must say why");
    assert.throws(() => assertProductionSafe(both), /Refusing to start/, "telemetry: both flags set must refuse startup");
    assert.equal(telemetryIntentionallyDisabled(both), false, "telemetry: both set is not the acknowledged-disabled state");

    assert.equal(checkTelemetryProductionAdapterConfigured(configuredOnly).ok, true, "telemetry: adapter configured only must pass");
    assert.doesNotThrow(() => assertProductionSafe(configuredOnly), "telemetry: adapter configured only must start");
    assert.equal(telemetryIntentionallyDisabled(configuredOnly), false, "telemetry: configured is not disabled");

    const disabledResult = checkTelemetryProductionAdapterConfigured(disabledOnly);
    assert.equal(disabledResult.ok, true, "telemetry: intentionally disabled only must pass");
    assert.equal(disabledResult.message, TELEMETRY_INTENTIONALLY_DISABLED_WARNING, "telemetry: disabled state must carry the warning");
    assert.doesNotThrow(() => assertProductionSafe(disabledOnly), "telemetry: intentionally disabled only must start");
    assert.equal(telemetryIntentionallyDisabled(disabledOnly), true, "telemetry: disabled-only is the acknowledged-disabled state");
    assert.equal(telemetryIntentionallyDisabled({ ...disabledOnly, NODE_ENV: "development" }), false, "telemetry: never 'disabled' outside production");

    // The warning is privacy-safe by construction: it must not embed any
    // environment value (secrets, URLs, ids).
    for (const value of Object.values(prodBase)) {
      if (value && value !== "production" && value !== "true") {
        assert.ok(!TELEMETRY_INTENTIONALLY_DISABLED_WARNING.includes(value), "telemetry warning must not contain environment values");
      }
    }
  }

  // launch:check must never report telemetry as ready while it is
  // intentionally disabled (or unconfigured, or contradictory).
  for (const [label, env, expected] of [
    ["intentionally disabled", { TELEMETRY_INTENTIONALLY_DISABLED: "true", TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: "" }, "blocked_by_external_configuration"],
    ["neither set", { TELEMETRY_INTENTIONALLY_DISABLED: "", TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: "" }, "blocked_by_external_configuration"],
    ["both set", { TELEMETRY_INTENTIONALLY_DISABLED: "true", TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: "true" }, "blocked_by_external_configuration"],
    ["adapter configured", { TELEMETRY_INTENTIONALLY_DISABLED: "", TELEMETRY_PRODUCTION_ADAPTER_CONFIGURED: "true" }, "ready"],
  ] as const) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/launch-check.ts", "--only=operational_telemetry", "--json"], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `launch-check --only=operational_telemetry (${label}) must exit 0; stderr:\n${run.stderr}`);
    const item = (JSON.parse((run.stdout ?? "").trim().split("\n").pop() ?? "[]") as { id: string; status: string }[]).find((r) => r.id === "operational_telemetry");
    assert.ok(item, `launch-check must report operational_telemetry (${label})`);
    assert.equal(item.status, expected, `operational_telemetry (${label}) must be ${expected}, got ${item.status}`);
  }

  assert.doesNotThrow(() => assertProductionSafe(prodBase), "a fully safe production configuration must not throw");
  assert.throws(
    () => assertProductionSafe(missingAdapterFlag),
    /Refusing to start/,
    "assertProductionSafe() must throw when no production telemetry adapter is configured",
  );
  assert.throws(
    () => assertProductionSafe({ ...prodBase, DEV_AUTH_ENABLED: "true" }),
    /Refusing to start/,
    "assertProductionSafe() must throw (crashing startup) for an unsafe production configuration",
  );
  assert.doesNotThrow(
    () => assertProductionSafe({ NODE_ENV: "development", DEV_AUTH_ENABLED: "true", DEV_ACCOUNT_ID: "x" }),
    "assertProductionSafe() must be a no-op outside production, even with dev-only flags set",
  );

  console.log("lib/launch/guards.ts regressions passed.");
}

async function main() {
  runGuardRegressions();
  await runGateProductionRegressions();
  await runDevAccountIdProductionRegressions();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
