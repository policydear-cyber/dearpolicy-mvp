/**
 * `npm run launch:check` -- validates actual configuration and, where a
 * database connection is available, actual database state, against every
 * critical launch requirement. This is deliberately NOT a collection of
 * source-text checks: every item below either evaluates the real exported
 * guard functions from lib/launch/guards.ts against a simulated production
 * environment, or (for RLS) runs a real query against pg_policies/pg_class
 * over a real connection.
 *
 * Every item is reported as one of:
 *   READY                          -- verified safe/present
 *   BLOCKED_BY_CODE                -- a code change is required
 *   BLOCKED_BY_EXTERNAL_CONFIG     -- needs a secret/setting only an operator
 *                                      can supply (a real production
 *                                      DATABASE_URL, Supabase keys, etc.)
 *
 * Exit code is always 0 in plain report mode (this is meant to run safely in
 * CI against a non-production environment, where missing production secrets
 * are expected, not a failure of this branch's code). Pass --strict to fail
 * (exit 1) on any BLOCKED_BY_CODE item -- the category a real code change
 * could and should have fixed before merge.
 */
import { Client } from "pg";
import {
  PRODUCTION_STARTUP_GUARDS,
  checkDevAuthNotInProduction,
  checkDevAccountIdNotInProduction,
  checkDatabaseTlsIsSecure,
  checkRequiredProductionSecrets,
  checkServiceRoleKeyNotPublic,
} from "@/lib/launch/guards";

type Status = "READY" | "BLOCKED_BY_CODE" | "BLOCKED_BY_EXTERNAL_CONFIG";
type Item = { name: string; status: Status; detail: string };

const results: Item[] = [];
function report(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
}

// Evaluate every startup guard as if this were a production boot, using
// whatever real configuration this process actually has -- so a developer
// can run `NODE_ENV=production npm run launch:check` locally against their
// real .env.local/Vercel-pulled env to get a true answer before deploying.
const prodEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };

function reportGuard(name: string, guard: (env: NodeJS.ProcessEnv) => { ok: boolean; message: string }, externalConfig: boolean) {
  const result = guard(prodEnv);
  if (result.ok) {
    report(name, "READY", result.message);
  } else {
    report(name, externalConfig ? "BLOCKED_BY_EXTERNAL_CONFIG" : "BLOCKED_BY_CODE", result.message);
  }
}

reportGuard("Development/shared authentication disabled in production", checkDevAuthNotInProduction, true);
reportGuard("DEV_ACCOUNT_ID not used in production", checkDevAccountIdNotInProduction, true);
reportGuard("Database TLS verifies certificates in production", checkDatabaseTlsIsSecure, true);
reportGuard("Required production secrets present", checkRequiredProductionSecrets, true);
reportGuard("No service-role key exposed to the browser bundle", checkServiceRoleKeyNotPublic, false);

async function checkRlsState() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1/.test(url)) {
    report(
      "RLS enabled with real policies (live database check)",
      "BLOCKED_BY_EXTERNAL_CONFIG",
      "No production DATABASE_URL configured in this environment -- cannot verify real database state. " +
        "This does NOT mean RLS is fine; it means this check has nothing to check against here.",
    );
    return;
  }
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    const disabled = await client.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false`,
    );
    const noPolicies = await client.query<{ tablename: string }>(
      `select c.relname as tablename from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)`,
    );
    const anonGrants = await client.query<{ table_name: string }>(
      `select table_name from information_schema.role_table_grants
       where grantee = 'anon' and table_schema = 'public'`,
    );
    const problems: string[] = [];
    if (disabled.rows.length > 0) problems.push(`RLS disabled on: ${disabled.rows.map((r) => r.relname).join(", ")}`);
    if (noPolicies.rows.length > 0) problems.push(`RLS enabled but zero policies exist on: ${noPolicies.rows.map((r) => r.tablename).join(", ")}`);
    if (anonGrants.rows.length > 0) problems.push(`anon role still has table grants on: ${anonGrants.rows.map((r) => r.table_name).join(", ")}`);
    if (problems.length > 0) {
      report("RLS enabled with real policies (live database check)", "BLOCKED_BY_CODE", problems.join("; "));
    } else {
      report("RLS enabled with real policies (live database check)", "READY", "Every public table has RLS enabled with at least one real policy, and anon has no table grants.");
    }
  } catch (error) {
    report(
      "RLS enabled with real policies (live database check)",
      "BLOCKED_BY_EXTERNAL_CONFIG",
      `Could not connect to verify: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  await checkRlsState();

  const strict = process.argv.includes("--strict");
  const byStatus = (status: Status) => results.filter((r) => r.status === status);

  console.log("\nLaunch readiness report\n========================");
  for (const item of results) {
    console.log(`[${item.status}] ${item.name}\n    ${item.detail}`);
  }
  console.log(
    `\n${byStatus("READY").length} ready, ${byStatus("BLOCKED_BY_CODE").length} blocked by code, ` +
      `${byStatus("BLOCKED_BY_EXTERNAL_CONFIG").length} blocked by external configuration.`,
  );

  const blockedByCode = byStatus("BLOCKED_BY_CODE");
  if (blockedByCode.length > 0) {
    console.log("\nStill missing from this pass (not implemented in this pass, or a real regression -- see the PR description for the honest full list):");
    console.log(
      "  Supabase Auth (individual sessions/login/signup), the API authorization layer, storage security " +
        "hardening, data-lifecycle flows, reliability/idempotency infrastructure, observability/redaction, " +
        "model governance persistence, and the V1 end-to-end journey test are NOT covered by this command " +
        "and remain Missing -- launch:check only covers the items it explicitly lists above.",
    );
  }

  if (strict && blockedByCode.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
