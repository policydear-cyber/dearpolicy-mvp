/**
 * What happens once an emailed link has given this browser a session, whichever way it arrived: the PKCE code
 * exchange (app/api/auth/callback) or the token_hash check (app/api/auth/confirm, lib/auth/email-link.ts). Returns the
 * path to send the person to. Moved here unchanged from app/api/auth/callback/route.ts so both routes do the same.
 */
import type { User } from "@supabase/supabase-js";
import { safeInviteNext } from "@/lib/auth/invite-return";
import { ensureDefaultHousehold } from "@/lib/household/repo";
import { secureFirstProof, signupMode, SignupClosedError, type ProofAuth } from "@/lib/auth/signup-gate";

type LinkAuth = ProofAuth & { signOut(options?: { scope?: "global" | "local" | "others" }): Promise<{ error: unknown }> };

/** `next`: the already-checked destination (a path on this site). `rawNext`: the link's own `next`, for the invitation. */
export async function finishEmailLink(auth: LinkAuth, user: User, next: string, rawNext: string | null): Promise<string> {
  // Idempotent -- see app/api/auth/signup/route.ts for why this needs to run here too (email-confirmation-required
  // accounts have no household yet).
  // Invite-only sign-up (lib/auth/signup-gate.ts): opening the link proves the person can read mail sent to this
  // address. Before a household is made for it, any password set before this proof is replaced and every other session
  // signed out (someone may have pre-registered the address), and the owner then sets their own password.
  const inviteOnly = signupMode() === "invite";
  let made = false;
  try {
    await ensureDefaultHousehold(user.id, `${(user.email ?? "my").split("@")[0]}'s household`, undefined, {
      email: user.email,
      emailProven: true,
      beforeCreate: inviteOnly ? async () => { await secureFirstProof(auth); made = true; } : undefined,
    });
  } catch (e) {
    await auth.signOut().catch(() => {});
    if (e instanceof SignupClosedError) return "/login?error=invite_only";
    if (inviteOnly) return "/login?error=invalid_or_expired_link";
    throw e;
  }

  // First proof of an invited address: they set their own password first, then go on to the invitation's join page
  // when they came from one (lib/auth/invite-return.ts; any other `next` is not carried past the password step).
  const inviteNext = safeInviteNext(rawNext);
  if (made) return "/update-password?first=1" + (inviteNext ? `&next=${encodeURIComponent(inviteNext)}` : "");
  return next;
}
