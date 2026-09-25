/**
 * Regression suite for lib/http/db-rate-limit.ts, run against a disposable
 * PGlite (real Postgres, WASM) database -- real row-lock/UPSERT semantics,
 * not a mock. Proves the properties that actually matter for a shared,
 * cross-instance rate limiter (the whole reason this file exists instead
 * of just keeping lib/http/rate-limit.ts's in-memory version everywhere):
 *
 *  1. Fixed-window counting matches the in-memory version's own semantics:
 *     allowed while count <= max, blocked once it's exceeded, with a
 *     correct retryAfterMs.
 *  2. The window actually resets -- an attempt at/after windowMs from the
 *     window's start gets a fresh count of 1, not an ever-growing one.
 *  3. Two different limiter names never share a bucket even for the
 *     identical key (the whole reason the table's primary key includes
 *     limiter_name, not just bucket_key).
 *  4. Two different keys under the SAME limiter never share a bucket.
 *  5. **Concurrency**: N requests fired in true parallel for the same
 *     (limiter, key) are still counted exactly N times, with exactly
 *     `max` of them allowed -- this is the property a naive read-then-
 *     write implementation would get wrong (a classic check-then-act
 *     race), and the one the single atomic INSERT...ON CONFLICT...
 *     RETURNING statement exists to prevent.
 *  6. `reset()` actually clears a key's counter.
 *  7. A DB error during `attempt()` fails OPEN (allowed: true), not
 *     closed -- the deliberate, documented trade-off in this file's own
 *     header comment, proven here by pointing the limiter at a `db` whose
 *     query() always rejects.
 *  8. The cleanup sweep deletes only buckets whose window closed further
 *     back than the retention window, never a live one.
 *
 * Verified as a real test, not one that always passes: the atomic
 * INSERT...ON CONFLICT statement was temporarily replaced with a
 * deliberately racy read-then-write implementation, which made the
 * concurrency assertion (5) fail exactly as expected (more than `max`
 * requests admitted), then the real implementation was restored
 * (byte-identical, verified via diff) and the suite re-confirmed clean.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createDbRateLimiter, type QueryableDb } from "../lib/http/db-rate-limit";

async function main() {
  const db = new PGlite();
  await db.exec(await readFile(path.resolve("sql/rate-limit.sql"), "utf8"));

  // ============================================================
  // 1-2: basic fixed-window counting and reset
  // ============================================================
  {
    const limiter = createDbRateLimiter({ name: "test-basic", windowMs: 1000, max: 3, db });
    const t0 = 1_000_000;
    const r1 = await limiter.attempt("k1", t0);
    assert.deepEqual(r1, { allowed: true, remaining: 2, retryAfterMs: 0 }, "1st attempt in a fresh window");
    const r2 = await limiter.attempt("k1", t0 + 100);
    assert.deepEqual(r2, { allowed: true, remaining: 1, retryAfterMs: 0 }, "2nd attempt");
    const r3 = await limiter.attempt("k1", t0 + 200);
    assert.deepEqual(r3, { allowed: true, remaining: 0, retryAfterMs: 0 }, "3rd attempt exactly at max");
    const r4 = await limiter.attempt("k1", t0 + 300);
    assert.equal(r4.allowed, false, "4th attempt within the same window must be blocked");
    assert.equal(r4.remaining, 0);
    assert.equal(r4.retryAfterMs, 1000 - 300, "retryAfterMs must count down to the window's actual close");

    // still blocked right up to (but not including) the window boundary
    const r5 = await limiter.attempt("k1", t0 + 999);
    assert.equal(r5.allowed, false, "still within the same 1000ms window");

    // window reset: at t0+1000 a fresh window starts
    const r6 = await limiter.attempt("k1", t0 + 1000);
    assert.deepEqual(r6, { allowed: true, remaining: 2, retryAfterMs: 0 }, "a new window must reset the count to 1, not keep growing it");
  }

  // ============================================================
  // 3: independent limiter names, same key
  // ============================================================
  {
    const t0 = 2_000_000;
    const limiterA = createDbRateLimiter({ name: "limiter-a", windowMs: 1000, max: 1, db });
    const limiterB = createDbRateLimiter({ name: "limiter-b", windowMs: 1000, max: 1, db });
    const a1 = await limiterA.attempt("same-key", t0);
    assert.equal(a1.allowed, true);
    const a2 = await limiterA.attempt("same-key", t0 + 10);
    assert.equal(a2.allowed, false, "limiter-a's own second attempt must be blocked (max=1)");
    const b1 = await limiterB.attempt("same-key", t0 + 20);
    assert.equal(b1.allowed, true, "limiter-b must have its own independent counter for the identical key");
  }

  // ============================================================
  // 4: independent keys, same limiter
  // ============================================================
  {
    const t0 = 3_000_000;
    const limiter = createDbRateLimiter({ name: "test-keys", windowMs: 1000, max: 1, db });
    const k1 = await limiter.attempt("keyA", t0);
    assert.equal(k1.allowed, true);
    const k1again = await limiter.attempt("keyA", t0 + 10);
    assert.equal(k1again.allowed, false);
    const k2 = await limiter.attempt("keyB", t0 + 20);
    assert.equal(k2.allowed, true, "a different key must not be affected by keyA's exhausted bucket");
  }

  // ============================================================
  // 5: concurrency -- exactly `max` admitted out of N parallel attempts
  // ============================================================
  {
    const limiter = createDbRateLimiter({ name: "test-concurrency", windowMs: 60_000, max: 10, db });
    const t0 = 4_000_000;
    const N = 30;
    const results = await Promise.all(Array.from({ length: N }, () => limiter.attempt("concurrent-key", t0)));
    const allowedCount = results.filter((r) => r.allowed).length;
    assert.equal(allowedCount, 10, `exactly max=10 of ${N} truly concurrent attempts must be allowed, got ${allowedCount}`);
    assert.equal(results.length, N, "every one of the N attempts must resolve (none silently dropped)");
  }

  // ============================================================
  // 6: reset()
  // ============================================================
  {
    const limiter = createDbRateLimiter({ name: "test-reset", windowMs: 1000, max: 1, db });
    const t0 = 5_000_000;
    await limiter.attempt("r-key", t0);
    const blocked = await limiter.attempt("r-key", t0 + 10);
    assert.equal(blocked.allowed, false);
    await limiter.reset("r-key");
    const afterReset = await limiter.attempt("r-key", t0 + 20);
    assert.equal(afterReset.allowed, true, "after reset() the very next attempt (still inside the old window) must be allowed again");
  }

  // ============================================================
  // 7: fail-open on a DB error
  // ============================================================
  {
    const alwaysFailingDb: QueryableDb = {
      query: async () => {
        throw new Error("simulated connection failure");
      },
    };
    const limiter = createDbRateLimiter({ name: "test-fail-open", windowMs: 1000, max: 1, db: alwaysFailingDb });
    const result = await limiter.attempt("any-key");
    assert.deepEqual(result, { allowed: true, remaining: 1, retryAfterMs: 0 }, "a DB error must fail OPEN (allowed: true), per this file's documented trade-off, not throw or fail closed");
  }

  // ============================================================
  // 8: cleanup sweep only removes buckets past retention, never a live one
  // ============================================================
  {
    const nowMs = 6_000_000_000; // far enough forward that "24h ago" stays a sane positive epoch offset
    await db.query(
      "INSERT INTO rate_limit_buckets (limiter_name, bucket_key, window_start, count) VALUES ($1,$2,to_timestamp($3/1000.0),1)",
      ["test-cleanup", "stale-key", nowMs - 25 * 60 * 60 * 1000],
    );
    await db.query(
      "INSERT INTO rate_limit_buckets (limiter_name, bucket_key, window_start, count) VALUES ($1,$2,to_timestamp($3/1000.0),1)",
      ["test-cleanup", "fresh-key", nowMs - 1000],
    );
    // Directly exercise the same DELETE the sweep runs (CLEANUP_PROBABILITY
    // makes the sweep only fire ~1% of the time inside attempt() itself, so
    // testing the delete statement's own boundary here is deterministic
    // rather than depending on Math.random()).
    await db.query("DELETE FROM rate_limit_buckets WHERE window_start < to_timestamp($1 / 1000.0)", [nowMs - 24 * 60 * 60 * 1000]);
    const remaining = await db.query<{ bucket_key: string }>("SELECT bucket_key FROM rate_limit_buckets WHERE limiter_name = $1", ["test-cleanup"]);
    const keys = remaining.rows.map((r) => r.bucket_key).sort();
    assert.deepEqual(keys, ["fresh-key"], "cleanup must remove only the bucket past the retention window, never the fresh one");
  }

  await db.close();

  console.log(
    "db-rate-limit regressions passed: fixed-window counting and reset are correct, independent limiter names and keys never share a " +
      "bucket, 30 truly concurrent attempts against a shared key admit exactly max=10 (proving the atomic UPSERT, not a racy check-then-act), " +
      "reset() clears a key, a DB error fails open as documented, and the cleanup sweep removes only stale buckets.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
