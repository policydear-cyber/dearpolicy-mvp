/**
 * Checkpoint 9 (claude/v1-launch-hardening): recursive redaction for
 * everything that reaches lib/telemetry/index.ts's recordEvent() (and
 * anything else in this codebase that wants a value safe to log/emit).
 *
 * Two independent layers, because a single approach misses different
 * things:
 *  1. KEY-based: an object property whose *name* matches DENIED_KEY_PATTERNS
 *     is dropped wholesale (its value is never even inspected) -- this is
 *     what actually guarantees an `authorization` header, a `cookie`
 *     header, or a `password` field can never leak, regardless of what's
 *     in it.
 *  2. VALUE-based: every surviving string is scanned against
 *     DENIED_VALUE_PATTERNS (emails, phone-shaped numbers, long digit runs
 *     that look like an SSN/NRIC/passport number, bearer/JWT-shaped
 *     tokens, long random-looking tokens) and any URL has its query string
 *     stripped outright (a signed URL's signature lives in the query
 *     string, so this is what actually defeats a signed-URL leak, not a
 *     denylist of parameter names that would miss an unanticipated one).
 *
 * Recurses through nested objects/arrays, Error objects (and their `.cause`
 * chain, recursively -- an Error's own `.message` is replaced with its
 * safe taxonomy text via classifyError() rather than passed through, since
 * a raw message is exactly the kind of raw exception text this checkpoint
 * exists to keep out of telemetry), Map/Set, and Date. Circular references
 * are detected (a WeakSet of visited objects) and replaced rather than
 * looping forever. Depth is capped (DEFAULT_MAX_DEPTH) -- past the cap, a
 * value is replaced with a marker rather than passed through unredacted,
 * so a deeply-nested attempt to smuggle a sensitive value past a shallow
 * scanner is refused, not silently allowed through.
 */
import { classifyError } from "./errors";

export const DEFAULT_MAX_DEPTH = 12;

const REDACTED = "[REDACTED]";
const REDACTED_HEADERS = "[REDACTED:headers]";
const REDACTED_COOKIES = "[REDACTED:cookies]";
const REDACTED_DEPTH = "[REDACTED:max-depth]";
const REDACTED_CIRCULAR = "[REDACTED:circular]";

// Key-name substrings (case-insensitive) that cause a property to be
// dropped wholesale, without inspecting its value at all.
const DENIED_KEY_SUBSTRINGS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "auth_header",
  "cookie",
  "session",
  "credential",
  "service_role",
  "signature",
  "signed_url",
  "ssn",
  "nric",
  "passport",
  "phone",
  "email",
  "medical",
  "diagnosis",
  "symptom",
  "policy_text",
  "policy_wording",
  "chat_text",
  "message_text",
  "document_text",
  "excerpt",
  "filename",
  "raw_sql",
  "sql_params",
  "stack",
  "stacktrace",
  "api_key",
  "apikey",
  "private_key",
];

// Header/cookie *bags* dropped wholesale by exact key name (case-insensitive)
// rather than substring, since "headers"/"cookies" as a whole object is the
// actual shape those values arrive in throughout this codebase (a NextRequest's
// .headers, a route's Cookie header value, etc).
const HEADER_BAG_KEYS = new Set(["headers", "header"]);
const COOKIE_BAG_KEYS = new Set(["cookies", "cookie"]);

function normalizeKey(key: string): string {
  // Strips separators so "policy_wording", "policyWording" and
  // "policy-wording" are all treated identically -- this codebase (and
  // any provider payload it redacts) mixes naming conventions, and a
  // denylist keyed to one convention would silently miss the others.
  return key.toLowerCase().replace(/[_-]/g, "");
}

function isDeniedKey(key: string): "header" | "cookie" | "generic" | null {
  const lower = key.toLowerCase();
  if (HEADER_BAG_KEYS.has(lower)) return "header";
  if (COOKIE_BAG_KEYS.has(lower)) return "cookie";
  const normalized = normalizeKey(key);
  if (DENIED_KEY_SUBSTRINGS.some((s) => normalized.includes(normalizeKey(s)))) return "generic";
  return null;
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const BEARER_PATTERN = /\bBearer\s+\S+/gi;
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\b/g;
// A run of 20+ base64url/hex-alphabet characters is treated as a
// secret/token-or-raw-identifier-shaped value -- API keys, signed tokens,
// session ids, AND raw UUIDs (household/resource/user ids) alike. See
// redactString()'s no-blanket-UUID-exemption comment.
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_-]{20,}\b/g;
// Loose phone-number shape: 8+ digits, allowing separators.
const PHONE_PATTERN = /\+?\d[\d\-\s()]{6,}\d/g;
// A bare run of 9+ digits (SSN/NRIC/passport-shaped) not already caught above.
const LONG_DIGIT_RUN_PATTERN = /\b\d{9,}\b/g;

function stripQueryString(value: string): string {
  // A signed URL's signature/expiry/token lives in the query string, so
  // stripping it outright (rather than denylisting parameter names, which
  // would miss an unanticipated one) is what actually defeats the leak.
  const qIndex = value.indexOf("?");
  if (qIndex === -1) return value;
  return value.slice(0, qIndex) + "?[REDACTED:query]";
}

function redactString(value: string): string {
  let out = value;
  if (/^https?:\/\//i.test(out)) out = stripQueryString(out);
  // No blanket UUID exemption: a raw household/resource/user id is a
  // UUID in this codebase, and "no raw identifiers in emitted events" is
  // an explicit requirement -- the one legitimate UUID-shaped value a
  // TelemetryEvent needs to carry through untouched, correlationId, is
  // carved out and reattached by recordEvent() (lib/telemetry/index.ts)
  // BEFORE this function ever sees it, precisely so this function doesn't
  // need to (and can't be tricked into) treating any other UUID as safe.
  out = out.replace(JWT_PATTERN, "[REDACTED:jwt]");
  out = out.replace(BEARER_PATTERN, "[REDACTED:bearer]");
  out = out.replace(EMAIL_PATTERN, "[REDACTED:email]");
  out = out.replace(PHONE_PATTERN, "[REDACTED:phone]");
  out = out.replace(LONG_DIGIT_RUN_PATTERN, "[REDACTED:id-number]");
  // Long-token pass last, and only against what's left, so it doesn't eat
  // the placeholder text the earlier passes already inserted. Catches
  // UUID-shaped raw identifiers too (see the no-blanket-UUID-exemption
  // comment above) -- a UUID is exactly a 36-character run of hex digits
  // and hyphens, which this pattern's character class matches in full.
  out = out.replace(LONG_TOKEN_PATTERN, "[REDACTED:token]");
  return out;
}

export type RedactOptions = { maxDepth?: number };

export function redactDeep(value: unknown, options: RedactOptions = {}, seen: WeakSet<object> = new WeakSet(), depth = 0): unknown {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (depth > maxDepth) return REDACTED_DEPTH;

  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (value instanceof Date) return value.toISOString();

  if (value instanceof Error) {
    if (seen.has(value)) return REDACTED_CIRCULAR;
    seen.add(value);
    const classified = classifyError(value);
    const ownProps: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (key === "message" || key === "stack") continue; // handled explicitly below
      const denied = isDeniedKey(key);
      if (denied) continue;
      ownProps[key] = redactDeep((value as unknown as Record<string, unknown>)[key], options, seen, depth + 1);
    }
    return {
      errorName: value.name,
      errorCategory: classified.category,
      safeMessage: classified.safeMessage,
      cause: value.cause !== undefined ? redactDeep(value.cause, options, seen, depth + 1) : undefined,
      ...ownProps,
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return REDACTED_CIRCULAR;
    seen.add(value);
    return value.map((item) => redactDeep(item, options, seen, depth + 1));
  }

  if (value instanceof Map) {
    if (seen.has(value)) return REDACTED_CIRCULAR;
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      const key = String(k);
      const denied = isDeniedKey(key);
      if (denied === "header") out[key] = REDACTED_HEADERS;
      else if (denied === "cookie") out[key] = REDACTED_COOKIES;
      else if (denied === "generic") out[key] = REDACTED;
      else out[key] = redactDeep(v, options, seen, depth + 1);
    }
    return out;
  }

  if (value instanceof Set) {
    if (seen.has(value)) return REDACTED_CIRCULAR;
    seen.add(value);
    return Array.from(value).map((item) => redactDeep(item, options, seen, depth + 1));
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return REDACTED_CIRCULAR;
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const denied = isDeniedKey(key);
      if (denied === "header") out[key] = REDACTED_HEADERS;
      else if (denied === "cookie") out[key] = REDACTED_COOKIES;
      else if (denied === "generic") out[key] = REDACTED;
      else out[key] = redactDeep(v, options, seen, depth + 1);
    }
    return out;
  }

  return REDACTED;
}
