-- Shared, cross-instance rate-limit counters, backing
-- lib/http/db-rate-limit.ts.
--
-- lib/http/rate-limit.ts's original in-memory limiter is a per-instance
-- brake only -- this app runs as one or more independent serverless
-- instances with no shared memory between them, so an attacker spread
-- across many cold-started instances is not fully stopped by a Map that
-- lives inside just one of them (see that file's own header comment for
-- the full reasoning). This table gives the same fixed-window algorithm a
-- single counter every instance reads and writes, for the handful of
-- state-changing, unauthenticated-or-early-authenticated routes that rely
-- on it: login, signup, signin, password reset, invitation accept/create.
--
-- `limiter_name` keeps independent limiters (one per route today) from
-- sharing a bucket just because two different routes happened to see the
-- same key (e.g. the same client IP hitting both /api/auth/signin and
-- /api/auth/signup) -- each createDbRateLimiter({name: ...}) call gets its
-- own namespace, matching how each in-memory createRateLimiter() call
-- already got its own private Map.
--
-- Idempotent (safe to re-run against a real Supabase project). No RLS
-- policy is defined here deliberately: this table is abuse-prevention
-- infrastructure, not household- or user-owned data, and -- like every
-- other table in this codebase -- is only ever queried through the app's
-- own unscoped `pool` (lib/db/client.ts), never through a per-request
-- RLS-scoped client (see lib/db/authz-client.ts's own doc comment on that
-- boundary).

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  limiter_name text NOT NULL,
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (limiter_name, bucket_key)
);

-- Supports the periodic best-effort cleanup sweep in
-- lib/http/db-rate-limit.ts, which deletes buckets whose window closed
-- long ago so the table doesn't grow without bound under a flood of
-- distinct (e.g. spoofed X-Forwarded-For) keys.
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start ON rate_limit_buckets(window_start);
