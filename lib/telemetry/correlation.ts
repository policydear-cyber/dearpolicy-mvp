/**
 * Checkpoint 9 (claude/v1-launch-hardening): correlation IDs.
 *
 * A correlation ID ties one logical operation's telemetry events together
 * (a route request, the durable job it enqueues, the model call that job
 * makes, the audit-log row a lifecycle transition writes) without ever
 * being trusted as an authorization or database identifier -- it is
 * accepted from the caller (a client-supplied `x-correlation-id` header,
 * or a caller-forwarded one when this codebase makes its own downstream
 * calls) ONLY under a strict format/length check, and generated fresh
 * with a cryptographically strong random source otherwise. Never used in
 * a WHERE clause, an RLS predicate, or anywhere identity/ownership is
 * decided -- lib/auth/request-context.ts's requireHouseholdContext() is
 * what actually resolves who's making a request, entirely independent of
 * whatever correlation id came in on the header.
 */
// Deliberately permissive enough to accept a UUID (this codebase's own
// randomUUID() output) or a short alphanumeric trace id from an upstream
// proxy, but bounded and character-restricted so it can never carry an
// injection payload, a header-splitting sequence, or anything resembling
// a secret/token itself.
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export const CORRELATION_ID_HEADER = "x-correlation-id";

/** Accepts an incoming correlation id only if it matches the strict
 * format/length rule above; otherwise (missing, malformed, too long,
 * containing disallowed characters) generates a fresh one. Never throws --
 * a malformed correlation id is not the caller's problem to see, it's
 * simply replaced. */
export function resolveCorrelationId(incoming: string | null | undefined): string {
  const trimmed = (incoming ?? "").trim();
  if (trimmed && CORRELATION_ID_PATTERN.test(trimmed)) return trimmed;
  // Web Crypto is available in both the Node and Edge runtimes. Keeping
  // this shared middleware dependency runtime-neutral avoids bundling a
  // Node-only module into Vercel's Edge middleware.
  return globalThis.crypto.randomUUID();
}

export function isValidCorrelationId(value: string): boolean {
  return CORRELATION_ID_PATTERN.test(value);
}
