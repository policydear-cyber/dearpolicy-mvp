/** A single shared password for the whole household -- not a login system,
 * just a lock on the front door so a stranger with the URL can't read or
 * change a family's insurance and health records. The password itself is
 * never stored in the cookie: only a SHA-256 digest of it, so the cookie
 * value alone can't be used to derive the password. */
export const AUTH_COOKIE = "dp_auth";

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cookie value a signed-in visitor should be carrying, or null when no
 * SITE_PASSWORD is configured -- in that case the gate lets everyone through
 * rather than locking the household out of its own app. */
export async function expectedToken(): Promise<string | null> {
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
