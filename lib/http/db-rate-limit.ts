/**
 * Postgres-backed rate limiter: the same fixed-window algorithm as
 * lib/http/rate-limit.ts's in-memory createRateLimiter(), but backed by
 * sql/rate-limit.sql's `rate_limit_buckets` table so every serverless
 * instance shares one counter instead of each instance keeping its own --
 * see that file's header comment for why the in-memory version is only a
 * per-instance brake. This is the production-grade limiter Priority 5
 * calls for; the in-memory one stays in lib/http/rate-limit.ts unchanged
 * (still exercised by scripts/security-regressions.ts) since nothing about
 * it is wrong for a use that genuinely doesn't need a cross-instance
 * guarantee.
 *
 * ## Atomicity
 * A single `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` statement does
 * the whole read-check-increment-write cycle in one round trip, taking a
 * row lock on the (limiter_name, bucket_key) row for its duration --
 * concurrent requests for the same key serialize through Postgres rather
 * than racing the way two separate read-then-write steps would (two
 * concurrent requests both reading count=19 and both then writing
 * count=20, silently admitting one more request than `max` allows).
 * `now` is passed in by the caller (defaulting to the real clock) rather
 * than read from Postgres's own `now()`, so scripts/db-rate-limit-
 * regressions.ts can drive fixed-window transitions deterministically
 * without a real wall-clock sleep.
 *
 * ## Fail-open on a DB error, by design -- NOT the same choice the
 * in-memory version makes
 * lib/http/rate-limit.ts's in-memory attempt() never skips the counter --
 * a deliberate fail-closed choice, documented in that file, and easy to
 * keep since incrementing a Map cannot itself fail. This version cannot
 * make the same promise: it is now a real network call that can fail on
 * its own (a connection pool exhausted, a transient drop) independently
 * of whether the caller is a real attacker. Every route that calls this
 * already depends on the same database for its actual work (Supabase
 * auth, household/session lookups) with no top-level try/catch of its own
 * on several of them today (see app/api/login, app/api/auth/{signup,
 * signin,reset-password}/route.ts) -- letting a rate-limiter-specific DB
 * hiccup throw would turn a transient blip into an inconsistent raw HTML
 * 500 on exactly these routes and nowhere else, while every other part of
 * the app degrades the same way regardless. So a DB error here is logged
 * and the attempt is allowed through rather than thrown: rate limiting is
 * one layer of defense in depth on top of the real authorization checks
 * (password verification, Supabase Auth, RLS), not the only one, and an
 * attacker during a genuine DB outage is already blocked by those same
 * routes' real work failing too.
 */
import { pool } from "@/lib/db/client";

export type QueryableDb = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export type DbRateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the current window resets; 0 when allowed. */
  retryAfterMs: number;
};

// Runs on a random fraction of attempts rather than every one, so the
// cleanup sweep's own cost doesn't land on every single request.
const CLEANUP_PROBABILITY = 0.01;
// Buckets whose window closed this long ago are stale for every limiter
// this app defines today (the longest window is reset-password's 1 hour)
// -- a full day is a comfortable margin, not a tight tuning.
const CLEANUP_RETENTION_MS = 24 * 60 * 60 * 1000;

export function createDbRateLimiter(args: { name: string; windowMs: number; max: number; db?: QueryableDb }) {
  const db = args.db ?? pool;

  async function cleanupExpired(nowMs: number) {
    if (Math.random() >= CLEANUP_PROBABILITY) return;
    try {
      await db.query("DELETE FROM rate_limit_buckets WHERE window_start < to_timestamp($1 / 1000.0)", [nowMs - CLEANUP_RETENTION_MS]);
    } catch (error) {
      console.error(`db-rate-limit(${args.name}): cleanup sweep failed`, error);
    }
  }

  return {
    /** Records one attempt for `key` at `now` and reports whether it is
     * within the allowed rate, against the shared Postgres-backed
     * counter. See this file's header for the deliberate fail-open
     * behavior on a DB error. */
    async attempt(key: string, now: number = Date.now()): Promise<DbRateLimitResult> {
      try {
        const { rows } = await db.query<{ count: number; window_start_ms: number }>(
          `INSERT INTO rate_limit_buckets (limiter_name, bucket_key, window_start, count)
           VALUES ($1, $2, to_timestamp($3 / 1000.0), 1)
           ON CONFLICT (limiter_name, bucket_key) DO UPDATE SET
             count = CASE WHEN $3 - (extract(epoch FROM rate_limit_buckets.window_start) * 1000) >= $4
                          THEN 1 ELSE rate_limit_buckets.count + 1 END,
             window_start = CASE WHEN $3 - (extract(epoch FROM rate_limit_buckets.window_start) * 1000) >= $4
                          THEN to_timestamp($3 / 1000.0) ELSE rate_limit_buckets.window_start END
           RETURNING count, extract(epoch FROM window_start) * 1000 AS window_start_ms`,
          [args.name, key, now, args.windowMs],
        );
        const row = rows[0];
        const count = Number(row.count);
        const windowStartMs = Number(row.window_start_ms);
        const elapsed = now - windowStartMs;
        const allowed = count <= args.max;
        await cleanupExpired(now);
        return {
          allowed,
          remaining: Math.max(0, args.max - count),
          retryAfterMs: allowed ? 0 : Math.max(0, args.windowMs - elapsed),
        };
      } catch (error) {
        console.error(`db-rate-limit(${args.name}): DB error, failing open for this attempt`, error);
        return { allowed: true, remaining: args.max, retryAfterMs: 0 };
      }
    },
    /** Test/administrative escape hatch -- not called from request handling. */
    async reset(key: string) {
      try {
        await db.query("DELETE FROM rate_limit_buckets WHERE limiter_name = $1 AND bucket_key = $2", [args.name, key]);
      } catch (error) {
        console.error(`db-rate-limit(${args.name}): reset failed`, error);
      }
    },
  };
}
