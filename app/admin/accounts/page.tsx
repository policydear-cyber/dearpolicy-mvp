import Link from "next/link";
import { requireAdminOrNotFound } from "@/lib/admin/access";
import { planAccountDeletion } from "@/lib/admin/account-deletion";
import { plural, when } from "@/lib/admin/format";
import { DeleteAccountForm } from "./delete-form";

export const dynamic = "force-dynamic";

/** Look an account up by email and, after a clear summary, delete it. Admin only; the delete itself is a checked server action. */
export default async function AdminAccountsPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const admin = await requireAdminOrNotFound();
  const { email } = await searchParams;
  const typed = typeof email === "string" ? email.trim() : "";
  const lookup = typed ? await planAccountDeletion(typed, admin).catch(() => ({ found: false as const, reason: "The account couldn’t be looked up just now." })) : null;
  const plan = lookup?.found ? lookup.plan : null;
  const deleting = plan?.households.filter((h) => h.action === "delete_household") ?? [];

  return (
    <div className="page admin" data-testid="admin-accounts">
      <header className="page-header compact"><div>
        <div className="eyebrow"><Link className="text-link" href="/admin">Admin console</Link> · Delete an account</div>
        <h1>Delete an account</h1>
        <p className="lead">Removes the sign-in and every household it owns alone, with their people, documents, readings, chats and stored files.</p>
      </div></header>

      <form method="get" className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="email">Account email</label>
        <input id="email" name="email" type="email" defaultValue={typed} required />
        <button type="submit" className="button primary">Look up</button>
      </form>

      {lookup && !lookup.found && <p className="admin-unavailable" role="status">{lookup.reason}</p>}

      {plan && (
        <section className="section" aria-labelledby="plan-h" data-testid="admin-delete-plan">
          <h2 id="plan-h">{plan.email}</h2>
          <p className="admin-note">Created {when(plan.createdAt)} · last sign-in {when(plan.lastSignInAt)}</p>
          {plan.blockers.map((b) => <p key={b} className="alert error" role="alert">{b}</p>)}
          {plan.warnings.map((w) => <p key={w} className="alert" role="status">{w}</p>)}

          <h3 className="admin-subhead">What will be deleted</h3>
          <ul>
            <li>The sign-in for {plan.email}, and every record that names it: memberships, invitations it sent or received, exports it made, reviewer records</li>
            {deleting.map((h) => (
              <li key={h.householdId}>
                Household <strong>{h.name}</strong>: {plural(h.people, "person")}, {plural(h.documents, "document")} ({h.documentsRead} read),
                {" "}{plural(h.claimDocuments, "claim document")}, {plural(h.conversations, "saved chat")}, {plural(h.storedFiles, "stored file")}, and every reading made from them, plus usage and job records and every stored file.
                {h.otherMembers.length > 0 && <> <strong className="admin-flag warn">Others belong to it: {h.otherMembers.join(", ")}</strong></>}
              </li>
            ))}
            {!deleting.length && <li>No household: this account owns nothing.</li>}
          </ul>
          {plan.households.filter((h) => h.action === "leave").length > 0 && (
            <>
              <h3 className="admin-subhead">What stays</h3>
              <ul>{plan.households.filter((h) => h.action === "leave").map((h) => <li key={h.householdId}>Household <strong>{h.name}</strong> stays; only this account leaves it. {h.note}</li>)}</ul>
            </>
          )}

          {!plan.blockers.length && (
            <DeleteAccountForm userId={plan.userId} email={plan.email} needsAcknowledgement={plan.needsSharedAcknowledgement}
              sharedWith={[...new Set(deleting.flatMap((h) => h.otherMembers))]} />
          )}
        </section>
      )}
    </div>
  );
}
