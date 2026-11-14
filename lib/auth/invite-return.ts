/**
 * Keeping an invitation link's token through sign-in and sign-up, so an invited family member who is not signed in
 * still lands on the join page with the token filled in.
 *
 * Only one destination is ever carried this way: exactly "/invite?token=<token>", where the token has the shape
 * createInvitation() issues (lib/household/repo.ts: 32 random bytes, base64url). Anything else is dropped, so this can
 * never become an open redirect, and the token is only ever sent back to /invite. Pure: no I/O.
 */
const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
const INVITE_NEXT = /^\/invite\?token=([A-Za-z0-9_-]{20,128})$/;

/** The join page's address for a token from an invitation link, or null when the token is missing or malformed. */
export function inviteReturnPath(token: string | null | undefined): string | null {
  const t = token?.trim() ?? "";
  return TOKEN.test(t) ? `/invite?token=${t}` : null;
}

/** `value` when it is exactly a join-page address carrying a well-formed token, otherwise null. */
export function safeInviteNext(value: unknown): string | null {
  return typeof value === "string" && INVITE_NEXT.test(value) ? value : null;
}
