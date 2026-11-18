/** Signing out from the app's Sign out ends this browser's session only. Supabase's signOut() defaults to the "global"
 * scope, which revokes every session of the account: signing out on a phone also signed the person out on their laptop,
 * and in a household where two people share one sign-in, out of the other's device (live 18 Nov). "local" revokes this
 * session's refresh token and clears its cookies; every other device stays signed in. */
export type SignOutAuth = { signOut(options: { scope: "local" }): Promise<{ error: unknown }> };

export async function signOutThisDevice(auth: SignOutAuth): Promise<{ error: unknown }> {
  // As before, an error never blocks signing out: the auth client clears this browser's session cookies whatever the
  // service answers (an expired session, the service down), and the person is shown as signed out.
  return auth.signOut({ scope: "local" });
}
