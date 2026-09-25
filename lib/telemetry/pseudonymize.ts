/**
 * Checkpoint 9 (claude/v1-launch-hardening): pseudonymous identifiers.
 *
 * A telemetry event needs SOME way to group "these events are about the
 * same household/resource" without ever emitting the real database id (a
 * raw household_id is itself an identifier a telemetry vendor -- or
 * anyone with vendor access -- could correlate back to a real person/
 * household). pseudonymizeId() runs a keyed HMAC-SHA256 over the raw id,
 * truncated to 32 hex characters: keyed (not a bare hash of the id) so
 * that even a predictable id (this codebase's ids are UUIDs, so this
 * matters less here than it would for sequential ids, but the requirement
 * is explicit) cannot be dictionary/rainbow-table reversed by anyone who
 * doesn't hold TELEMETRY_PSEUDONYM_SECRET, and the SAME raw id always
 * produces the SAME pseudonym within one environment (stable within an
 * environment, because that's what makes "group these events by
 * household" useful), while two environments/secrets produce unrelated
 * pseudonyms for the same underlying id.
 */
import { createHmac } from "node:crypto";

// A fixed, clearly-marked non-production fallback so local dev/tests never
// crash for lack of a configured secret -- checkTelemetryPseudonymSecretConfigured()
// (lib/launch/guards.ts) is what turns "still using this fallback in
// production" into a launch blocker, the same pattern this codebase
// already uses for every other production-required secret.
const INSECURE_DEV_FALLBACK_SECRET = "dev-insecure-telemetry-pseudonym-secret-do-not-use-in-production";

export function isUsingInsecurePseudonymSecret(env: NodeJS.ProcessEnv = process.env): boolean {
  return !(env.TELEMETRY_PSEUDONYM_SECRET ?? "").trim();
}

function secret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.TELEMETRY_PSEUDONYM_SECRET ?? "").trim();
  return configured || INSECURE_DEV_FALLBACK_SECRET;
}

/** Returns null for a nullish input (so callers can pass an optional id
 * straight through without an extra branch), otherwise a stable 32-hex-
 * character pseudonym. */
export function pseudonymizeId(rawId: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!rawId) return null;
  return createHmac("sha256", secret(env)).update(rawId).digest("hex").slice(0, 32);
}
