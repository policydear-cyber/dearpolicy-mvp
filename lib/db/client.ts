import { readFileSync } from "node:fs";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL is not configured. Database-backed routes will fail until .env.local is set.");
}

const globalForDb = globalThis as unknown as { dearPolicyPool?: Pool };

function isProduction() {
  return process.env.NODE_ENV === "production";
}

export type SslConfigInput = {
  databaseUrl?: string;
  nodeEnv?: string;
  databaseSsl?: string;
  databaseSslInsecure?: string;
  databaseSslCa?: string;
  databaseSslCaPath?: string;
  readCaFile?: (path: string) => string;
};

// TLS configuration for the Postgres connection. Supabase (and most managed
// Postgres) requires TLS. Certificate verification must stay ON in
// production: `rejectUnauthorized: false` accepts *any* certificate,
// including one presented by an attacker in a man-in-the-middle position,
// which defeats what TLS is for. This function throws rather than silently
// downgrading when an insecure combination is selected in production --
// lib/db/client.ts is imported by virtually every route, so that throw
// surfaces immediately as a startup failure rather than a runtime surprise,
// and lib/launch/guards.ts checks the same env vars again independently so
// the failure mode doesn't depend on this module having been imported yet.
//
// Pure function of its (optional) input rather than reading process.env
// directly, so scripts/tls-config-regressions.ts can exercise every branch
// -- including the production-throws branches -- without a live database or
// any process.env mutation/module re-import trickery. Called with no
// arguments (falling back to real process.env / the real DATABASE_URL) when
// the connection pool below is actually constructed.
export function sslConfig(input: SslConfigInput = {}): PoolConfig["ssl"] {
  const databaseUrl = input.databaseUrl ?? connectionString;
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV;
  const production = nodeEnv === "production";
  const databaseSsl = input.databaseSsl ?? process.env.DATABASE_SSL;
  const databaseSslInsecure = input.databaseSslInsecure ?? process.env.DATABASE_SSL_INSECURE;
  const databaseSslCa = input.databaseSslCa ?? process.env.DATABASE_SSL_CA;
  const databaseSslCaPath = input.databaseSslCaPath ?? process.env.DATABASE_SSL_CA_PATH;
  const readCaFile = input.readCaFile ?? ((path: string) => readFileSync(path, "utf8"));

  if (/^(0|false|off)$/i.test(databaseSsl?.trim() ?? "")) {
    if (production) {
      throw new Error("DATABASE_SSL=off is not permitted in production: the database connection must use TLS.");
    }
    return undefined;
  }
  if (!databaseUrl || /localhost|127\.0\.0\.1/.test(databaseUrl)) return undefined;

  const insecure = /^(1|true|on|yes)$/i.test(databaseSslInsecure?.trim() ?? "");
  if (insecure) {
    if (production) {
      throw new Error(
        "DATABASE_SSL_INSECURE=true is not permitted in production: it disables certificate verification " +
          "and defeats TLS. Remove it, or set DATABASE_SSL_CA / DATABASE_SSL_CA_PATH instead if a custom " +
          "CA bundle is genuinely required.",
      );
    }
    // Development-only escape hatch (e.g. a local TLS-terminating proxy with
    // a self-signed certificate). Never reachable in production; see above.
    return { rejectUnauthorized: false };
  }

  if (databaseSslCa?.trim()) return { rejectUnauthorized: true, ca: databaseSslCa };

  if (databaseSslCaPath?.trim()) {
    try {
      return { rejectUnauthorized: true, ca: readCaFile(databaseSslCaPath.trim()) };
    } catch (error) {
      throw new Error(
        `DATABASE_SSL_CA_PATH is set to "${databaseSslCaPath}" but that file could not be read: ${(error as Error).message}`,
      );
    }
  }

  // Supabase's connection pooler and direct connection both present a
  // certificate chained to a publicly trusted root (see Supabase's TLS
  // documentation), so Node's default trust store verifies it without a
  // pinned CA bundle in the normal case.
  return { rejectUnauthorized: true };
}

export const pool =
  globalForDb.dearPolicyPool ??
  new Pool({
    connectionString,
    ssl: sslConfig(),
    // Each serverless instance holds its own pool; on Vercel, several
    // instances can run at once, so a small per-instance cap keeps total
    // connections well under a managed Postgres's connection limit even
    // under a burst of concurrent requests. Route DATABASE_URL through
    // Supabase's connection pooler (port 6543, transaction mode) in
    // production so a burst of short-lived serverless connections doesn't
    // exhaust Postgres's own (much lower) direct-connection limit.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 30_000,
  });

// Reused across invocations on the same warm instance either way (the module
// only evaluates once per process); cached on globalThis specifically so
// Next.js dev-mode hot reloads reuse the same pool instead of leaking a new
// one on every file change.
if (!isProduction()) globalForDb.dearPolicyPool = pool;

let devAccountEnsured = false;

// Every write in this single-household app hangs off one account_id via a
// foreign key, so a missing accounts row (a fresh database, or a
// DEV_ACCOUNT_ID that does not match any seeded row) turns every insert into
// an opaque 500 -- this happened in production once already. Ensuring the
// row exists before the app's first real query, once per warm instance,
// makes that failure mode self-healing instead of a silent outage.
//
// devAccountId() itself throws in production (see below), so this function
// never actually runs in production -- the throw happens first and the
// promise this function returns is never reached. It stays scoped to
// non-production on purpose rather than being deleted, since it is still
// exercised by every local/dev/test run.
async function ensureDevAccountRow() {
  // Tests and scripts point `pool.query` at an in-memory database or a
  // strict fixture mock instead of a real DATABASE_URL; either already
  // seeds what it needs, so this only has to run against a real connection.
  if (devAccountEnsured || !connectionString || isProduction()) return;
  await pool.query(`INSERT INTO accounts(id, name) VALUES ($1, 'Household') ON CONFLICT (id) DO NOTHING`, [devAccountId()]);
  devAccountEnsured = true;
}

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  await ensureDevAccountRow();
  return pool.query<T>(text, params);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A malformed id in a URL path (a stale link, a typo, a bot probing routes)
// should read as "not found" or "bad request", never as a database failure --
// Postgres rejects non-uuid text for a uuid column with an opaque driver
// error that would otherwise surface as a scary generic 500.
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// A hand-typed or malformed date (e.g. "not-a-date", "2024-13-45") reaches a
// `date` column as raw text; Postgres's own rejection of it is an opaque
// driver error, not a message a person could act on, so this is checked
// before the query instead of after it fails.
export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Development-only account-identity fallback. Gated behind DEV_AUTH_ENABLED
 * (see lib/launch/guards.ts) and unconditionally disabled in production --
 * account identity in production must come from an authenticated session
 * (lib/auth/session.ts), never a fixed id. This throwing, rather than
 * silently returning the fixed dev id, is the "no production fallback to
 * DEV_ACCOUNT_ID" requirement: every one of the ~32 API routes that still
 * calls this function today will fail loudly in production until each is
 * migrated to real session-derived identity (tracked in the PR description's
 * "API authorization audit" section). */
export function devAccountId(): string {
  if (isProduction()) {
    throw new Error(
      "devAccountId() was called in a production environment. Account identity must come from an " +
        "authenticated session, never a fixed development id. This route has not yet been migrated to " +
        "session-derived identity.",
    );
  }
  // An env var that exists but is blank (e.g. a placeholder saved empty in a
  // hosting dashboard) must not become "" here — Postgres rejects "" as a uuid
  // with a raw, confusing error, so treat blank the same as unset.
  const configured = process.env.DEV_ACCOUNT_ID?.trim();
  return configured || "00000000-0000-0000-0000-000000000001";
}
