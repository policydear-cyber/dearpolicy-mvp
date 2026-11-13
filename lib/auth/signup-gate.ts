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
 * The email must also be PROVEN, by this code itself, whatever the auth service's "Confirm email" setting is: an
 * invited address (or any address at an invited domain) is worth nothing if anyone can type it. Proven means the person
 * came back through a link emailed to that address (app/api/auth/callback's code exchange); nothing else counts, not
 * even the auth service's own confirmation stamp, which "Confirm email" off sets at sign-up. A password sign-in or
 * sign-up is sent such a link instead.
 *
 * And the proof secures the account before a household is made (secureFirstProof): someone could have pre-registered
 * the invited address with a password of their own before its owner ever opened the link. So the first time an address
 * is proven, the password set before the proof is replaced and every other session is signed out, then the owner sets
 * their own password. If either step fails, no household is made.
 *
 * It fails closed: in invite mode, no email, an unproven email, an unreadable setting or an error while checking
 * invitations means no new household. Any value of DEARPOLICY_SIGNUP_MODE other than unset/"open" counts as invite-only.
 */
import type { ScopedDbClient } from "@/lib/db/authz-client";

export class SignupClosedError extends Error {
  /** "not_invited": no invitation for this email. "unproven": invited, but the email is not yet proven to be theirs. */
  constructor(readonly reason: "not_invited" | "unproven" = "not_invited") {
    super(reason === "unproven" ? "Confirm your email first." : "DearPolicy is open by invitation only at the moment.");
    this.name = "SignupClosedError";
  }
}

/** What an invited person sees while their email is not yet proven: a link has been (or will be) emailed to them. */
export const CONFIRM_EMAIL_MESSAGE = "Check your email. We sent you a link to confirm your address. Open it, then sign in.";

/** The auth calls secureFirstProof needs, on the session the emailed link just opened. */
export type ProofAuth = {
  updateUser(attributes: { password: string }): Promise<{ error: unknown }>;
  signOut(options: { scope: "others" }): Promise<{ error: unknown }>;
};

/**
 * Run when an address is first proven by its emailed link, before its household is made (see the module note):
 * the password set before the proof is replaced by a random one nobody knows, and every other session is signed out.
 * Throws when either fails, so no household is made (fails closed). The owner then sets their own password.
 */
export async function secureFirstProof(auth: ProofAuth, randomPassword: () => string = defaultRandomPassword): Promise<void> {
  const rotated = await auth.updateUser({ password: randomPassword() }).catch((error: unknown) => ({ error }));
  if (rotated.error) throw new Error("Could not replace the password set before the address was proven.");
  const others = await auth.signOut({ scope: "others" }).catch((error: unknown) => ({ error }));
  if (others.error) throw new Error("Could not sign out the other sessions of this account.");
}

function defaultRandomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
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
  return (await householdGate(email, true, client, env)) === "ok";
}

/** The gate itself: "ok", or why not. `proven` says whether the email is proven to be the person's (see above). */
export async function householdGate(
  email: string | null | undefined,
  proven: boolean,
  client: Pick<ScopedDbClient, "query"> | null,
  env: Record<string, string | undefined> = process.env,
): Promise<"ok" | "not_invited" | "unproven"> {
  if (signupMode(env) === "open") return "ok";
  const invited = await isInvited(email, client, env);
  if (!invited) return "not_invited";
  return proven === true ? "ok" : "unproven";
}

async function isInvited(email: string | null | undefined, client: Pick<ScopedDbClient, "query"> | null, env: Record<string, string | undefined>): Promise<boolean> {
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
