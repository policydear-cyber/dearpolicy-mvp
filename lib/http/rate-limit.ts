/** A small in-memory, fixed-window rate limiter keyed by an arbitrary
 * string (e.g. a client IP).
 *
 * Deliberately simple, and deliberately NOT a distributed rate limiter:
 * this app runs as one or more independent serverless instances with no
 * shared cache between them, so a counter here is a per-instance brake,
 * not a global one -- an attacker spread across many cold-started
 * instances is not fully stopped by this alone. That is an acceptable
 * trade for the actual threat model of app/api/login/route.ts: one shared
 * household password, guarded by IP plus a fixed per-attempt delay. This
 * closes the gap that delay alone leaves open -- a guesser firing many
 * requests in parallel isn't slowed by a delay that only applies per
 * request -- by capping how many attempts a given source can even queue up
 * within a window, on whichever instance answers them. */

type Bucket = { count: number; windowStart: number };

// Bounds memory under a flood of distinct (e.g. spoofed X-Forwarded-For)
// keys: once the tracked-key count passes this, the oldest expired buckets
// are dropped before a new one is added.
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Milliseconds until the current window resets; 0 when allowed. */
  retryAfterMs: number;
};

export function createRateLimiter(args: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();

  function evictExpired(now: number) {
    if (buckets.size < MAX_TRACKED_KEYS) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= args.windowMs) buckets.delete(key);
      if (buckets.size < MAX_TRACKED_KEYS) return;
    }
  }

  return {
    /** Records one attempt for `key` at `now` (defaults to the real clock)
     * and reports whether it is within the allowed rate. Every call counts
     * -- there is no key or input that skips the counter, so this fails
     * closed rather than open. */
    attempt(key: string, now: number = Date.now()): RateLimitResult {
      const existing = buckets.get(key);
      if (!existing || now - existing.windowStart >= args.windowMs) {
        evictExpired(now);
        buckets.set(key, { count: 1, windowStart: now });
        return { allowed: true, remaining: args.max - 1, retryAfterMs: 0 };
      }
      if (existing.count >= args.max) {
        return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, args.windowMs - (now - existing.windowStart)) };
      }
      existing.count += 1;
      return { allowed: true, remaining: args.max - existing.count, retryAfterMs: 0 };
    },
    /** Test/administrative escape hatch -- not called from request handling. */
    reset(key: string) {
      buckets.delete(key);
    },
    size() {
      return buckets.size;
    },
  };
}

/** Best-effort client identifier for rate limiting: the first hop in
 * X-Forwarded-For (the platform-set, left-most entry is the original
 * client on Vercel and most reverse proxies), falling back to X-Real-Ip,
 * falling back to a constant shared bucket when neither header is present
 * (local dev without a proxy in front) -- attempts still get counted and
 * limited in that case, just as one shared bucket rather than per-IP. */
export function clientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstHop = forwardedFor?.split(",")[0]?.trim();
  if (firstHop) return firstHop;
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "unknown";
}
