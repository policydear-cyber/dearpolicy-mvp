import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL is not configured. Database-backed routes will fail until .env.local is set.");
}

const globalForDb = globalThis as unknown as { dearPolicyPool?: Pool };

// Supabase (and most managed Postgres) requires TLS, and its own certificate
// chain is not always in Node's default trust store on every host — verify
// when a CA is supplied, accept without one otherwise, same as Supabase's own
// connection examples. DATABASE_SSL=off disables this for a plain local
// Postgres (e.g. the docker-compose database) that speaks no TLS at all.
function sslConfig() {
  if (/^(0|false|off)$/i.test(process.env.DATABASE_SSL?.trim() ?? "")) return undefined;
  if (!connectionString || /localhost|127\.0\.0\.1/.test(connectionString)) return undefined;
  return { rejectUnauthorized: false };
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
if (process.env.NODE_ENV !== "production") globalForDb.dearPolicyPool = pool;

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export function devAccountId() {
  // An env var that exists but is blank (e.g. a placeholder saved empty in a
  // hosting dashboard) must not become "" here — Postgres rejects "" as a uuid
  // with a raw, confusing error, so treat blank the same as unset.
  const configured = process.env.DEV_ACCOUNT_ID?.trim();
  return configured || "00000000-0000-0000-0000-000000000001";
}
