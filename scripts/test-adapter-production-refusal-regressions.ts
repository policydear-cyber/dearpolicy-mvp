/**
 * Test-only adapters can never start in production.
 *
 * Proves, against the real code:
 *  1. lib/launch/guards.ts checkTestAdaptersNotInProduction() refuses the
 *     test Auth adapter flag and loopback Auth/scanner endpoints whenever
 *     NODE_ENV=production or the server is Vercel-hosted; the local
 *     production-mode proof exemption only applies off Vercel with a local
 *     database, and never to the Auth adapter flag. Messages name variables,
 *     never their values.
 *  2. The guard is one of PRODUCTION_STARTUP_GUARDS, and the real startup
 *     hook (instrumentation.ts register()) throws "Refusing to start" for a
 *     production environment carrying the adapter -- the same call Next.js
 *     makes before serving the first request.
 *  3. The test Auth/Admin stand-in itself (e2e/support/fake-auth.mjs) exits
 *     without listening unless explicitly enabled, and always under
 *     NODE_ENV=production or on Vercel; enabled locally it serves only
 *     loopback and rejects calls without the synthetic project key.
 * A real `next start` refusal is proven separately by the production
 * topology run (.github/workflows/production-topology.yml).
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import {
  checkTestAdaptersNotInProduction,
  PRODUCTION_STARTUP_GUARDS,
  TEST_AUTH_ADAPTER_FLAG,
  LOCAL_PRODUCTION_PROOF_FLAG,
  LOCAL_PRODUCTION_PROOF_VALUE,
} from "@/lib/launch/guards";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const LOCAL_DB = "postgresql://synthetic:synthetic@127.0.0.1:5432/synthetic";
const REMOTE_DB = "postgresql://synthetic:synthetic@db.synthetic-project.example:5432/postgres";
const REMOTE_AUTH = "https://synthetic-project.example";

function guardCases() {
  const ok = (e: Record<string, string>, why: string) => assert.equal(checkTestAdaptersNotInProduction(env(e)).ok, true, why);
  const refused = (e: Record<string, string>, why: string) => {
    const r = checkTestAdaptersNotInProduction(env(e));
    assert.equal(r.ok, false, why);
    assert.match(r.message, /A test-only adapter is configured/, why);
    for (const value of Object.values(e)) if (/^https?:|^postgres/.test(value)) assert.ok(!r.message.includes(value), `${why}: message must not echo a value`);
    return r.message;
  };

  ok({ NODE_ENV: "development", [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue", SUPABASE_URL: "http://127.0.0.1:4020" }, "local development may use the test Auth adapter");
  ok({ NODE_ENV: "test", VIRUSTOTAL_API_BASE_URL: "http://127.0.0.1:4010/vt" }, "tests may use the fake scanner");
  ok({ NODE_ENV: "production", SUPABASE_URL: REMOTE_AUTH, DATABASE_URL: REMOTE_DB }, "a real production configuration passes");

  assert.match(refused({ NODE_ENV: "production", [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue", SUPABASE_URL: REMOTE_AUTH }, "production with the adapter flag"), new RegExp(TEST_AUTH_ADAPTER_FLAG));
  refused({ NODE_ENV: "production", [TEST_AUTH_ADAPTER_FLAG]: "anything" }, "any value of the adapter flag is refused");
  refused({ NODE_ENV: "development", VERCEL: "1", [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue" }, "Vercel-hosted non-production builds are refused too");
  refused({ NODE_ENV: "development", VERCEL_ENV: "preview", SUPABASE_URL: "http://localhost:4020" }, "a Vercel preview pointed at a loopback Auth");
  assert.match(refused({ NODE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:4020", DATABASE_URL: REMOTE_DB }, "production with a loopback Auth URL"), /SUPABASE_URL \(loopback address\)/);
  refused({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://[::1]:4020", DATABASE_URL: REMOTE_DB }, "IPv6 loopback Auth URL");
  refused({ NODE_ENV: "production", VIRUSTOTAL_API_BASE_URL: "http://localhost:4010/vt", SUPABASE_URL: REMOTE_AUTH, DATABASE_URL: REMOTE_DB }, "production with a loopback scanner URL");

  // The local production-mode proof exemption.
  const proof = { NODE_ENV: "production", [LOCAL_PRODUCTION_PROOF_FLAG]: LOCAL_PRODUCTION_PROOF_VALUE, DATABASE_URL: LOCAL_DB, SUPABASE_URL: "http://127.0.0.1:4010/synthetic-supabase", VIRUSTOTAL_API_BASE_URL: "http://127.0.0.1:4010/vt" };
  ok(proof, "a declared local production proof with a local database may use local fakes");
  refused({ ...proof, DATABASE_URL: REMOTE_DB }, "the proof exemption needs a local database");
  refused({ ...proof, [LOCAL_PRODUCTION_PROOF_FLAG]: "yes" }, "the proof exemption needs its exact value");
  refused({ ...proof, VERCEL: "1" }, "the proof exemption never applies on Vercel");
  refused({ ...proof, [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue" }, "the proof exemption never allows the test Auth adapter");

  assert.ok(PRODUCTION_STARTUP_GUARDS.includes(checkTestAdaptersNotInProduction), "the guard runs at production startup");
  console.log("checkTestAdaptersNotInProduction: guard cases passed.");
}

async function startupHookCases() {
  const base: Record<string, string> = {
    NODE_ENV: "production", DATABASE_URL: REMOTE_DB, SUPABASE_URL: REMOTE_AUTH, SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    TELEMETRY_PSEUDONYM_SECRET: "synthetic-pseudonym-secret-0000000000", TELEMETRY_INTENTIONALLY_DISABLED: "true", CRON_SECRET: "synthetic-cron-secret-0000000000",
    MALWARE_SCANNER_PROVIDER: "virustotal", VIRUSTOTAL_API_KEY: "synthetic-vt-key",
  };
  const run = (extra: Record<string, string>) => {
    const child = spawnSync(process.execPath, ["--import", "tsx", "-e", `import("./instrumentation.ts").then(m=>(m.register??m.default.register)()).then(()=>{console.log("STARTED")},e=>{console.log(String(e&&e.message));process.exit(3)})`], {
      cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...base, ...extra } as unknown as NodeJS.ProcessEnv, timeout: 120_000,
    });
    return { status: child.status, out: `${child.stdout}\n${child.stderr}` };
  };
  const control = run({});
  assert.equal(control.status, 0, `control: a clean synthetic production env starts\n${control.out.slice(-800)}`);
  assert.match(control.out, /STARTED/);
  for (const [label, extra] of [
    ["adapter flag", { [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue" }],
    ["loopback Auth URL", { SUPABASE_URL: "http://127.0.0.1:4020" }],
  ] as const) {
    const r = run(extra);
    assert.equal(r.status, 3, `${label}: startup must be refused\n${r.out.slice(-800)}`);
    assert.match(r.out, /Refusing to start: unsafe production configuration detected/, label);
    assert.match(r.out, /A test-only adapter is configured/, label);
  }
  console.log("instrumentation.ts register(): refuses production startup with a test adapter.");
}

async function fakeAuthCases() {
  const script = path.resolve("e2e/support/fake-auth.mjs");
  const basic = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", FAKE_AUTH_PORT: "4097" };
  for (const [label, extra] of [
    ["without the adapter flag", {}],
    ["with a wrong flag value", { [TEST_AUTH_ADAPTER_FLAG]: "yes" }],
    ["under NODE_ENV=production", { [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue", NODE_ENV: "production" }],
    ["on Vercel", { [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue", VERCEL: "1" }],
    ["in a Vercel environment", { [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue", VERCEL_ENV: "production" }],
  ] as const) {
    const r = spawnSync(process.execPath, [script], { env: { ...basic, ...extra } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 15_000 });
    assert.equal(r.status, 78, `fake-auth ${label} must refuse to start (exit ${r.status})`);
    assert.match(r.stderr, /refusing to start/, label);
    assert.doesNotMatch(r.stdout, /listening/, label);
  }

  const child = spawn(process.execPath, [script], { env: { ...basic, [TEST_AUTH_ADAPTER_FLAG]: "fake-gotrue", NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fake-auth did not start")), 15_000);
      child.stdout.on("data", (d) => { if (String(d).includes("listening on 127.0.0.1:4097")) { clearTimeout(timer); resolve(); } });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`fake-auth exited ${code}`)); });
    });
    const health = await fetch("http://127.0.0.1:4097/__health").then((r) => r.json());
    assert.equal(health.testOnly, true);
    const noKey = await fetch("http://127.0.0.1:4097/auth/v1/user");
    assert.equal(noKey.status, 401, "calls without the synthetic project key are rejected");
    const notAdmin = await fetch("http://127.0.0.1:4097/auth/v1/admin/users", { headers: { apikey: "synthetic-e2e-anon-key", authorization: "Bearer synthetic-e2e-anon-key" } });
    assert.equal(notAdmin.status, 403, "the Admin API refuses the anon key");
  } finally {
    child.kill("SIGTERM");
  }
  console.log("e2e/support/fake-auth.mjs: refuses to start outside explicit local test use.");
}

async function main() {
  guardCases();
  await startupHookCases();
  await fakeAuthCases();
  console.log("Test-adapter production-refusal regressions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
