/**
 * Invite-only sign-up (launch readiness for an invite-only beta).
 *
 * Off by default: with DEARPOLICY_SIGNUP_MODE unset (or "open") anyone can create an account, exactly as before. With
 * DEARPOLICY_SIGNUP_MODE=invite, a NEW household is created only for an email that is invited:
 *   - listed in DEARPOLICY_INVITED_EMAILS (comma, semicolon, space or newline separated; an entry "@example.com" invites
 *     every address at that domain), or
 *   - holding a pending household invitation (not accepted, not revoked, not expired) sent from inside the app.
 *
 * The gate sits where a household is created (lib/household/repo.ts ensureDefaultHousehold), not only on the sign-up
 * form, so an account made any other way (for example straight against the auth service) still gets no household and
 * so no access. A person who already belongs to a household is never affected.
 *
 * It fails closed: in invite mode, no email, an unreadable setting or an error while checking invitations means no
 * new household. Any value of DEARPOLICY_SIGNUP_MODE other than unset/"open" counts as invite-only.
 */
import type { ScopedDbClient } from "@/lib/db/authz-client";

export class SignupClosedError extends Error {
  constructor() { super("DearPolicy is open by invitation only at the moment."); this.name = "SignupClosedError"; }
}

/** What a person sees when sign-up is closed to them. Says nothing about whether the email exists. */
export const SIGNUP_CLOSED_MESSAGE = "DearPolicy is open by invitation only at the moment. If you were invited, use the email address the invitation was sent to.";

export type SignupMode = "open" | "invite";

export function signupMode(env: Record<string, string | undefined> = process.env): SignupMode {
  const raw = env.DEARPOLICY_SIGNUP_MODE;
  if (raw == null || raw.trim() === "" || raw.trim().toLowerCase() === "open") return "open";
  return "invite";
}

/** The invited addresses and "@domain" entries, lower-cased. */
export function invitedEntries(env: Record<string, string | undefined> = process.env): string[] {
  return String(env.DEARPOLICY_INVITED_EMAILS ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function normalEmail(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/** True when the email is on the invited list itself (exact address, or an "@domain" entry for its whole domain). */
export function onInvitedList(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  const e = normalEmail(email);
  if (!e) return false;
  const domain = e.slice(e.lastIndexOf("@"));
  return invitedEntries(env).some((entry) => entry === e || (entry.startsWith("@") && entry === domain));
}

/**
 * May a new household be created for this email? Always yes in open mode. In invite mode, only for an invited email;
 * any error while checking is a no.
 */
export async function mayCreateHousehold(
  email: string | null | undefined,
  client: Pick<ScopedDbClient, "query"> | null,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  if (signupMode(env) === "open") return true;
  const e = normalEmail(email);
  if (!e) return false;
  if (onInvitedList(e, env)) return true;
  if (!client) return false;
  try {
    const { rows } = await client.query(
      `select 1 from household_invitations where lower(email) = $1 and accepted_at is null and revoked_at is null and expires_at > now() limit 1`,
      [e],
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}
