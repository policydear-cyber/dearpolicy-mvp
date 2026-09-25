/** A single shared password for the whole household -- not a login system,
 * just a lock on the front door so a stranger with the URL can't read or
 * change a family's insurance and health records. The password itself is
 * never stored in the cookie: only a SHA-256 digest of it, so the cookie
 * value alone can't be used to derive the password.
 *
 * This mechanism is DEVELOPMENT-ONLY and is unconditionally disabled in
 * production (NODE_ENV=production), regardless of any other configuration:
 * `expectedToken()` returns a sentinel no cookie can ever equal, and
 * `checkPassword()` always returns false, so /api/login can never succeed in
 * production. This is the "no production fallback to a shared password"
 * requirement -- the mechanism is disabled outright, not merely improved.
 * Real production authentication is Supabase Auth (still being built; see
 * the PR description's "Critical issue" section for status). Until that
 * ships, production deploys of this branch cannot authenticate anyone. */
export const AUTH_COOKIE = "dp_auth";

// No real cookie value can ever equal this -- checkPassword() never issues a
// token derived from it, so this exists purely to make expectedToken()'s
// production branch fail closed (middleware treats a non-null expected token
// as "the gate is active and nothing satisfies it") instead of accidentally
// reading as "no password configured, let everyone through".
const DISABLED_IN_PRODUCTION = "disabled-in-production";

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cookie value a signed-in visitor should be carrying, or null when no
 * SITE_PASSWORD is configured -- in that case the gate lets everyone through
 * rather than locking the household out of its own app. Always non-null
 * (and unsatisfiable) in production; see the module comment above. */
export async function expectedToken(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return DISABLED_IN_PRODUCTION;
  const secret = process.env.SITE_PASSWORD?.trim();
  return secret ? sha256Hex(secret) : null;
}

// A plain `===` comparison returns as soon as it finds a mismatched
// character, so how long it takes leaks how many leading characters of a
// guess were right -- over many requests, that timing difference is a real
// side channel against a single shared password. crypto.timingSafeEqual
// compares in constant time, but only for equal-length buffers (it throws
// otherwise, and its own length check happens before any constant-time
// work); padding both sides out to the same length first means a
// wrong-length guess takes the same code path, and roughly the same time,
// as a right-length one.
export async function checkPassword(candidate: string): Promise<boolean> {
  // Disabled outright in production; see the module comment above.
  if (process.env.NODE_ENV === "production") return false;
  const secret = process.env.SITE_PASSWORD?.trim();
  if (!secret) return true;
  const { timingSafeEqual } = await import("node:crypto");
  const guess = Buffer.from(candidate.trim(), "utf8");
  const actual = Buffer.from(secret, "utf8");
  const length = Math.max(guess.length, actual.length, 1);
  const guessPadded = Buffer.alloc(length);
  const actualPadded = Buffer.alloc(length);
  guess.copy(guessPadded);
  actual.copy(actualPadded);
  return timingSafeEqual(guessPadded, actualPadded) && guess.length === actual.length;
}
