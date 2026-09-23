/**
 * Regression suite for the launch-hardening pass: lib/auth/gate.ts's
 * password check, lib/http/rate-limit.ts's limiter, and the shared
 * lib/claims/evidence/validation.ts looksLikePdf() magic-byte check now
 * also guarding app/api/policies/upload/route.ts.
 *
 * These are small, self-contained pure-function/module tests -- no PGlite,
 * no network -- following the same "assert, throw a descriptive message on
 * failure" style as scripts/claim-smoke.ts rather than the scored-scenario
 * style of scripts/claim-quality-eval.ts, since there is no partial-credit
 * scoring dimension here: each check is either true of the real
 * implementation or it is a regression.
 */
import { createRateLimiter, clientKey } from "@/lib/http/rate-limit";
import { looksLikePdf } from "@/lib/claims/evidence/validation";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- lib/http/rate-limit.ts -------------------------------------------------

function runRateLimiterRegressions() {
  // Fresh limiter per scenario -- the module-level singleton used by the
  // real login route would leak state between these checks otherwise.
  const limiter = createRateLimiter({ windowMs: 1000, max: 3 });
  let now = 0;

  assert(limiter.attempt("ip-a", now).allowed, "1st attempt within the limit should be allowed");
  assert(limiter.attempt("ip-a", now).allowed, "2nd attempt within the limit should be allowed");
  const third = limiter.attempt("ip-a", now);
  assert(third.allowed && third.remaining === 0, "3rd attempt should be allowed and exhaust the budget");
  const fourth = limiter.attempt("ip-a", now);
  assert(!fourth.allowed, "4th attempt within the same window should be blocked");
  assert(fourth.retryAfterMs > 0, "a blocked attempt should report a positive retry-after");

  // A different key must not share the first key's budget -- otherwise one
  // guesser exhausting their own bucket would lock out every other visitor.
  assert(limiter.attempt("ip-b", now).allowed, "a different key must have its own budget");

  // Past the window, the bucket for ip-a resets rather than staying blocked
  // forever.
  now += 1001;
  assert(limiter.attempt("ip-a", now).allowed, "a new window should reset the bucket");

  // clientKey() prefers the left-most X-Forwarded-For hop (the original
  // client on Vercel and most reverse proxies), falls back to X-Real-Ip,
  // and never throws on a request with neither header.
  const withXff = new Request("https://example.com", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
  assert(clientKey(withXff) === "203.0.113.9", "clientKey should take the first X-Forwarded-For hop");
  const withRealIp = new Request("https://example.com", { headers: { "x-real-ip": "203.0.113.10" } });
  assert(clientKey(withRealIp) === "203.0.113.10", "clientKey should fall back to X-Real-Ip");
  const withNeither = new Request("https://example.com");
  assert(clientKey(withNeither) === "unknown", "clientKey should fall back to a shared bucket, never throw, when neither header is present");

  console.log("Rate limiter regressions passed.");
}

// --- lib/auth/gate.ts --------------------------------------------------------

async function runPasswordCheckRegressions() {
  const originalSitePassword = process.env.SITE_PASSWORD;
  try {
    // Re-imported fresh each time isn't necessary -- checkPassword reads
    // process.env.SITE_PASSWORD on every call rather than caching it at
    // module load, so mutating the env var between assertions is enough.
    const { checkPassword } = await import("@/lib/auth/gate");

    process.env.SITE_PASSWORD = "correct horse battery staple";
    assert(await checkPassword("correct horse battery staple"), "the exact configured password should be accepted");
    assert(await checkPassword("  correct horse battery staple  "), "surrounding whitespace on the guess should be trimmed");
    assert(!(await checkPassword("correct horse battery staplee")), "a longer wrong guess must be rejected, not throw");
    assert(!(await checkPassword("correct horse battery stapl")), "a shorter wrong guess must be rejected, not throw");
    assert(!(await checkPassword("")), "an empty guess must be rejected when a password is configured");
    assert(!(await checkPassword("Correct Horse Battery Staple")), "the check must be case-sensitive");

    delete process.env.SITE_PASSWORD;
    assert(await checkPassword("anything at all"), "an unconfigured SITE_PASSWORD should let every guess through (dev mode)");
    assert(await checkPassword(""), "an unconfigured SITE_PASSWORD should let even an empty guess through (dev mode)");
  } finally {
    if (originalSitePassword === undefined) delete process.env.SITE_PASSWORD;
    else process.env.SITE_PASSWORD = originalSitePassword;
  }
  console.log("Password-check regressions passed.");
}

// --- lib/claims/evidence/validation.ts (reused by the policy-upload route) --

function runPdfMagicByteRegressions() {
  const realPdfHeader = new TextEncoder().encode("%PDF-1.7\n%rest of a real pdf...");
  assert(looksLikePdf(realPdfHeader), "bytes starting with the real PDF magic header should pass");

  const renamedExecutable = new TextEncoder().encode("MZ\x90\x00\x03\x00\x00\x00this is not a pdf");
  assert(!looksLikePdf(renamedExecutable), "a renamed non-PDF file (e.g. an executable) must not pass just because its name/MIME claim PDF");

  const empty = new Uint8Array(0);
  assert(!looksLikePdf(empty), "an empty file must not pass");

  const tooShort = new TextEncoder().encode("%PDF");
  assert(!looksLikePdf(tooShort), "bytes shorter than the magic header must not pass");

  console.log("PDF magic-byte regressions passed (now also guarding app/api/policies/upload/route.ts).");
}

runRateLimiterRegressions();
runPdfMagicByteRegressions();
runPasswordCheckRegressions().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
