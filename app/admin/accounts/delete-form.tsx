"use client";

import { useActionState } from "react";
import { deleteAccountAction, type DeleteAccountState } from "./actions";

/** The typed-email confirmation for deleting an account. The server decides everything; this only collects it. */
export function DeleteAccountForm({ userId, email, needsAcknowledgement, sharedWith }: { userId: string; email: string; needsAcknowledgement: boolean; sharedWith: string[] }) {
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, { done: null });
  const done = state.done;
  if (done?.ok) {
    return (
      <div className="alert success" role="status" data-testid="admin-delete-done">
        <strong>Account deleted.</strong> {done.householdsDeleted} household{done.householdsDeleted === 1 ? "" : "s"} deleted with their documents and files;
        {" "}{done.membershipsRemoved} membership{done.membershipsRemoved === 1 ? "" : "s"} removed; the sign-in is gone.
        {" "}{done.storage.verified ? "Stored files were checked and none are left." : `Some stored files could not be confirmed removed (${done.storage.stillQueued} still queued); they are retried automatically.`}
      </div>
    );
  }
  return (
    <form action={action} className="danger-zone" data-testid="admin-delete-form">
      <h2>Delete this account</h2>
      <p>This can&rsquo;t be undone. Type <strong>{email}</strong> to confirm.</p>
      <input type="hidden" name="userId" value={userId} />
      <div className="field">
        <label htmlFor="confirmEmail">Email address</label>
        <input id="confirmEmail" name="confirmEmail" type="email" autoComplete="off" required />
      </div>
      {needsAcknowledgement && (
        <p>
          <label>
            <input type="checkbox" name="acknowledgeShared" /> {sharedWith.join(", ")} will lose access to the household and everything in it.
          </label>
        </p>
      )}
      {done && !done.ok && <p className="alert error" role="alert">{done.reason}</p>}
      <button type="submit" className="button danger" disabled={pending}>{pending ? "Deleting…" : "Delete account permanently"}</button>
    </form>
  );
}
