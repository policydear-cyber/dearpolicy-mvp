import { Pool, type QueryResultRow } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL is not configured. Database-backed routes will fail until .env.local is set.");
}

const globalForDb = globalThis as unknown as { dearPolicyPool?: Pool };

export const pool =
  globalForDb.dearPolicyPool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.dearPolicyPool = pool;

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}

export function devAccountId() {
  return process.env.DEV_ACCOUNT_ID ?? "00000000-0000-0000-0000-000000000001";
}
