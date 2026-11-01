/**
 * Invite-only sign-up (lib/auth/signup-gate.ts): may this email make a new account at all? Asked by the public sign-up
 * route before any account is made. Always yes unless DEARPOLICY_SIGNUP_MODE=invite. Service-mediated because the
 * person has no account yet, and it reads only whether a pending invitation exists for this one email; any error is a no.
 * The real gate is still where a household is created (lib/household/repo.ts ensureDefaultHousehold).
 */
import type { Pool } from "pg";
import { withServiceTransaction } from "@/lib/db/authz-client";
import { mayCreateHousehold, signupMode } from "@/lib/auth/signup-gate";

export async function invitedToSignUp(email: string, poolOverride?: Pick<Pool, "connect">): Promise<boolean> {
  if (signupMode() === "open") return true;
  return withServiceTransaction((client) => mayCreateHousehold(email, client), poolOverride).catch(() => false);
}
