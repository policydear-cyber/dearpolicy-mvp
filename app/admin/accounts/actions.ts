"use server";

import { getCurrentUser, requireRecentAuthentication } from "@/lib/auth/session";
import { isAdminUser } from "@/lib/admin/access";
import { deleteAccount, type DeleteAccountResult } from "@/lib/admin/account-deletion";

export type DeleteAccountState = { done: DeleteAccountResult | null };

/**
 * Deletes one account from the admin console. A server action is a public POST endpoint, so the allow-list is checked
 * again here (the page's own check doesn't cover it), and the admin must have signed in recently, as for an owner
 * deleting their own household. Only the account id and the typed confirmation come from the browser.
 */
export async function deleteAccountAction(_previous: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  const user = await getCurrentUser().catch(() => null);
  if (!isAdminUser(user)) return { done: { ok: false, reason: "Not allowed." } };
  try {
    requireRecentAuthentication(user!);
  } catch {
    return { done: { ok: false, reason: "Please sign in again to confirm it's you, then try again." } };
  }
  const userId = String(form.get("userId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { done: { ok: false, reason: "No account selected." } };
  const done = await deleteAccount(
    { id: user!.id, email: user!.email! },
    { userId, confirmEmail: String(form.get("confirmEmail") ?? ""), acknowledgeSharedHouseholds: form.get("acknowledgeShared") === "on" },
  );
  return { done };
}
