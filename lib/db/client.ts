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

let devAccountEnsured = false;

// Every write in this single-household app hangs off one account_id via a
// foreign key, so a missing accounts row (a fresh database, or a
// DEV_ACCOUNT_ID that does not match any seeded row) turns every insert into
// an opaque 500 -- this happened in production once already. Ensuring the
// row exists before the app's first real query, once per warm instance,
// makes that failure mode self-healing instead of a silent outage.
async function ensureDevAccountRow() {
  // Tests and scripts point `pool.query` at an in-memory database or a
  // strict fixture mock instead of a real DATABASE_URL; either already
  // seeds what it needs, so this only has to run against a real connection.
  if (devAccountEnsured || !connectionString) return;
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

export function devAccountId() {
  // An env var that exists but is blank (e.g. a placeholder saved empty in a
  // hosting dashboard) must not become "" here — Postgres rejects "" as a uuid
  // with a raw, confusing error, so treat blank the same as unset.
  const configured = process.env.DEV_ACCOUNT_ID?.trim();
  return configured || "00000000-0000-0000-0000-000000000001";
}
