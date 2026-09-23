/**
 * Regression suite for lib/db/client.ts's sslConfig() -- the database TLS
 * decision -- and lib/launch/guards.ts's checkDatabaseTlsIsSecure(). Neither
 * needs a live database: sslConfig() is a pure function of its (optional)
 * input (see its comment for why), so every branch, including the
 * production-throws branches, is exercised directly here.
 */
import assert from "node:assert/strict";
import { sslConfig } from "@/lib/db/client";
import { checkDatabaseTlsIsSecure } from "@/lib/launch/guards";

function assertThrows(fn: () => unknown, pattern: RegExp, message: string) {
  try {
    fn();
    throw new Error(`expected a throw but none occurred: ${message}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    assert.match(text, pattern, `${message} (got: ${text})`);
  }
}

function runSslConfigRegressions() {
  const remoteUrl = "postgresql://user:pass@db.example.supabase.co:5432/postgres";
  const localUrl = "postgresql://user:pass@localhost:5432/dev";

  assert.equal(sslConfig({ databaseUrl: localUrl, nodeEnv: "development" }), undefined, "a localhost DATABASE_URL never needs TLS");
  assert.equal(sslConfig({ databaseUrl: undefined, nodeEnv: "development" }), undefined, "no DATABASE_URL configured means no TLS to configure");

  assert.deepEqual(
    sslConfig({ databaseUrl: remoteUrl, nodeEnv: "development" }),
    { rejectUnauthorized: true },
    "a remote DATABASE_URL defaults to certificate verification ON, even outside production",
  );
  assert.deepEqual(
    sslConfig({ databaseUrl: remoteUrl, nodeEnv: "production" }),
    { rejectUnauthorized: true },
    "a correctly configured production connection verifies certificates",
  );

  assert.deepEqual(
    sslConfig({ databaseUrl: remoteUrl, nodeEnv: "development", databaseSslInsecure: "true" }),
    { rejectUnauthorized: false },
    "DATABASE_SSL_INSECURE=true is honoured outside production (an explicit, documented dev-only escape hatch)",
  );
  assertThrows(
    () => sslConfig({ databaseUrl: remoteUrl, nodeEnv: "production", databaseSslInsecure: "true" }),
    /not permitted in production/i,
    "DATABASE_SSL_INSECURE=true must throw in production rather than silently disabling certificate verification",
  );

  assertThrows(
    () => sslConfig({ databaseUrl: remoteUrl, nodeEnv: "production", databaseSsl: "off" }),
    /not permitted in production/i,
    "DATABASE_SSL=off must throw in production rather than silently disabling TLS entirely",
  );
  assert.equal(
    sslConfig({ databaseUrl: remoteUrl, nodeEnv: "development", databaseSsl: "off" }),
    undefined,
    "DATABASE_SSL=off is honoured outside production",
  );

  assert.deepEqual(
    sslConfig({ databaseUrl: remoteUrl, nodeEnv: "production", databaseSslCa: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----" }),
    { rejectUnauthorized: true, ca: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----" },
    "a supplied CA bundle is used with certificate verification still ON",
  );

  assert.deepEqual(
    sslConfig({
      databaseUrl: remoteUrl,
      nodeEnv: "production",
      databaseSslCaPath: "/etc/ssl/supabase-ca.pem",
      readCaFile: (path) => {
        assert.equal(path, "/etc/ssl/supabase-ca.pem");
        return "pem-contents";
      },
    }),
    { rejectUnauthorized: true, ca: "pem-contents" },
    "DATABASE_SSL_CA_PATH reads the file and verifies with it",
  );
  assertThrows(
    () =>
      sslConfig({
        databaseUrl: remoteUrl,
        nodeEnv: "production",
        databaseSslCaPath: "/does/not/exist.pem",
        readCaFile: () => {
          throw new Error("ENOENT: no such file");
        },
      }),
    /could not be read/i,
    "an unreadable DATABASE_SSL_CA_PATH must fail loudly, not silently fall back to an insecure connection",
  );

  console.log("sslConfig() regressions passed.");
}

function runGuardRegressions() {
  const base = { ...process.env } as NodeJS.ProcessEnv;

  assert.equal(checkDatabaseTlsIsSecure({ ...base, NODE_ENV: "development" }).ok, true, "the guard is a no-op outside production");
  assert.equal(
    checkDatabaseTlsIsSecure({ ...base, NODE_ENV: "production", DATABASE_SSL_INSECURE: "true" }).ok,
    false,
    "the guard must flag DATABASE_SSL_INSECURE=true in production",
  );
  assert.equal(
    checkDatabaseTlsIsSecure({ ...base, NODE_ENV: "production", DATABASE_SSL: "off" }).ok,
    false,
    "the guard must flag DATABASE_SSL=off in production",
  );
  assert.equal(
    checkDatabaseTlsIsSecure({ ...base, NODE_ENV: "production", DATABASE_SSL_INSECURE: undefined, DATABASE_SSL: undefined }).ok,
    true,
    "the guard passes for an unconfigured (default-secure) production TLS setup",
  );

  console.log("checkDatabaseTlsIsSecure() regressions passed.");
}

runSslConfigRegressions();
runGuardRegressions();
