/**
 * Direct-upload intent (Round 5, item 1): a short-lived, HMAC-signed
 * statement, minted by /api/policies/upload/start AFTER the session and the
 * family member were authorized, of exactly which object the browser may
 * write and later ask to have accepted. Nothing in it can be chosen by the
 * browser: the household, user, family member, policy id and storage key
 * are all server-derived. The finalize step re-checks the session against
 * it, re-validates the stored bytes and inserts the policy row under the
 * token's policy id -- a second finalize of the same token hits that
 * row's primary key and is refused, so a token is single-use.
 *
 * Stateless on purpose (no table): an upload that is never finalized just
 * leaves an unreferenced object, which the storage cleanup engine
 * (lib/storage/cleanup.ts, 6-hour in-flight grace) already removes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type UploadIntent = {
  v: 1;
  householdId: string;
  userId: string;
  familyMemberId: string;
  explicitFamilyMember: boolean;
  policyId: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  supersedesPolicyId: string | null;
  driver: "local" | "supabase";
  expiresAt: number;
};

export const UPLOAD_INTENT_TTL_MS = 2 * 60 * 60 * 1000; // matches Supabase's signed upload URL lifetime

let devKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.UPLOAD_INTENT_SECRET || process.env.TELEMETRY_PSEUDONYM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.CRON_SECRET;
  if (secret) return createHash("sha256").update(`dearpolicy-upload-intent:${secret}`).digest();
  if (process.env.NODE_ENV === "production") throw new Error("No server secret is configured for upload intents.");
  // Local development only: one random key per server process.
  devKey ??= randomBytes(32);
  return devKey;
}

export function signUploadIntent(intent: UploadIntent): string {
  const body = Buffer.from(JSON.stringify(intent)).toString("base64url");
  const mac = createHmac("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyUploadIntent(token: unknown, now = Date.now()): UploadIntent | null {
  if (typeof token !== "string" || token.length > 8192) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", key()).update(body).digest();
  let given: Buffer;
  try { given = Buffer.from(mac, "base64url"); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const intent = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadIntent;
    if (intent.v !== 1 || typeof intent.expiresAt !== "number" || intent.expiresAt < now) return null;
    return intent;
  } catch {
    return null;
  }
}
