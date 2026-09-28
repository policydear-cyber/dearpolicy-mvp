"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { HouseholdExportPanel } from "./export-panel";
import { customerMessage } from "@/components/customer-text";

type Member = { householdId: string; userId: string; role: "owner" | "member"; createdAt: string };
type Invitation = { id: string; household_id: string; email: string; role: "owner" | "member"; invited_by: string; created_at: string; expires_at: string };

export default function HouseholdPage() {
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [callerUserId, setCallerUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");

  const [confirmMemberId, setConfirmMemberId] = useState<string | null>(null);
  const [confirmInvitationId, setConfirmInvitationId] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "owner">("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState("");

  const [confirmName, setConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    const householdRes = await fetch("/api/household").then((r) => r.json());
    const activeId: string | null = householdRes.activeHouseholdId ?? null;
    setHouseholdName(householdRes.activeHouseholdName ?? null);
    setNameInput(householdRes.activeHouseholdName ?? "");
    // Every entry in `memberships` belongs to the caller (listMemberships()
    // is scoped by the caller's own user id), so the entry for the active
    // household names the caller's own user id too -- no separate
    // "who am I" endpoint needed just to know which member row is "you".
    const mine = (householdRes.memberships ?? []).find((m: Member) => m.householdId === activeId);
    setCallerUserId(mine?.userId ?? null);

    if (activeId) {
      const [membersRes, invitationsRes] = await Promise.all([
        fetch("/api/household/members").then((r) => r.json()).catch(() => ({ members: [] })),
        fetch("/api/household/invitations").then((r) => r.json()).catch(() => ({ invitations: [] })),
      ]);
      setMembers(membersRes.members ?? []);
      setInvitations(invitationsRes.invitations ?? []);
    } else {
      setMembers([]);
      setInvitations([]);
    }
    setLoaded(true);
  }
  useEffect(() => { void refresh(); }, []);

  const isOwner = members.find((m) => m.userId === callerUserId)?.role === "owner";

  async function saveName(event: FormEvent) {
    event.preventDefault();
    setStatus("");
    const response = await fetch("/api/household", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: nameInput }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setStatus(customerMessage(payload.error, "Could not rename the household. Please try again in a moment."));
    setStatus("Household name saved.");
    await refresh();
  }

  async function removeMember(member: Member) {
    // A second, deliberate click is required before anything happens --
    // same arm-then-confirm pattern as the family page's own delete button.
    if (confirmMemberId !== member.userId) { setConfirmMemberId(member.userId); return; }
    setConfirmMemberId(null);
    setStatus("");
    const response = await fetch(`/api/household/members/${member.userId}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    const isSelf = member.userId === callerUserId;
    setStatus(response.ok
      ? (isSelf ? "You left the household." : "Member removed.")
      : (customerMessage(payload.error, "Could not complete this action. Please try again in a moment.")));
    if (response.ok) await refresh();
  }

  async function createInvitation(event: FormEvent) {
    event.preventDefault();
    setInviteError("");
    setInviteLink(null);
    const response = await fetch("/api/household/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setInviteError(customerMessage(payload.error, "Could not create this invitation. Please try again in a moment."));
    // createInvitation() only ever returns the plaintext token once -- it
    // is never retrievable again after this response, so the link is
    // shown here for the owner to copy and send themselves (there is no
    // automated delivery yet).
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setInviteLink(`${origin}/invite?token=${encodeURIComponent(payload.token)}`);
    setInviteEmail("");
    await refresh();
  }

  async function revokeInvitation(invitation: Invitation) {
    if (confirmInvitationId !== invitation.id) { setConfirmInvitationId(invitation.id); return; }
    setConfirmInvitationId(null);
    setStatus("");
    const response = await fetch(`/api/household/invitations/${invitation.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    setStatus(response.ok ? `Invitation to ${invitation.email} revoked.` : (customerMessage(payload.error, "Could not revoke this invitation. Please try again in a moment.")));
    if (response.ok) await refresh();
  }

  async function deleteHousehold() {
    setDeleteError("");
    setNeedsReauth(false);
    setDeleting(true);
    try {
      const response = await fetch("/api/household", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmName }),
      });
      if (response.status === 401) {
        setNeedsReauth(true);
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDeleteError(customerMessage(payload.error, "Could not delete this household. Please try again in a moment."));
        return;
      }
      // Everything this household owned -- including this page's own data
      // -- is gone the instant this succeeds. Land somewhere that still
      // makes sense with no household selected.
      window.location.href = "/";
    } finally {
      setDeleting(false);
    }
  }

  if (!loaded) return <div className="page"><p className="lead">Loading your household…</p></div>;

  return (
    <div className="page">
      <header className="page-header compact">
        <div>
          <div className="eyebrow">HOUSEHOLD</div>
          <h1>Household settings</h1>
          <p className="lead">Manage who&apos;s in your household, invite people to join it, and (if you&apos;re the owner) rename or permanently delete it.</p>
        </div>
      </header>

      {!householdName && <p className="lead">You don&apos;t belong to a household yet.</p>}

      {householdName !== null && (
        <>
          <section className="section">
            <div className="section-heading"><div><div className="eyebrow">NAME</div><h2>Household name</h2></div></div>
            <form onSubmit={saveName} className="profile-add-grid">
              <div className="field"><label htmlFor="hh-name">Name</label><input id="hh-name" value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={200} required disabled={!isOwner} /></div>
              {isOwner && <button className="button primary" type="submit" disabled={!nameInput.trim() || nameInput.trim() === householdName}>Save name</button>}
            </form>
            {!isOwner && <p className="lead" style={{ marginTop: 8 }}>Only the household owner can rename it.</p>}
            {status && <div className="upload-status">{status}</div>}
          </section>

          <section className="section">
            <div className="section-heading"><div><div className="eyebrow">PEOPLE</div><h2>Members</h2></div></div>
            <div className="profile-list">
              {members.map((member) => {
                const isSelf = member.userId === callerUserId;
                // Only the owner may remove someone else (RLS's own
                // household_members_delete policy is the real enforcement
                // either way -- this just avoids offering a button that
                // would only come back as a 404).
                const canAct = isSelf || isOwner;
                return (
                  <div className="profile-card" key={member.userId}>
                    <div className="avatar profile-avatar">{member.userId.slice(0, 1).toUpperCase()}</div>
                    <div className="profile-fields">
                      <div className="field"><label>User</label><span>{isSelf ? "You" : `Member ${member.userId.slice(0, 8)}`}</span></div>
                      <div className="field"><label>Role</label><span>{member.role}</span></div>
                      <div className="field"><label>Joined</label><span>{new Date(member.createdAt).toLocaleDateString()}</span></div>
                    </div>
                    <div className="profile-actions">
                      {canAct && (
                        <button className="mini-button danger" onClick={() => removeMember(member)}>
                          {confirmMemberId === member.userId ? "Confirm" : isSelf ? "Leave" : "Remove"}
                        </button>
                      )}
                      {confirmMemberId === member.userId && <button className="mini-button" onClick={() => setConfirmMemberId(null)}>Cancel</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {isOwner && (
            <section className="section">
              <div className="section-heading"><div><div className="eyebrow">INVITATIONS</div><h2>Invite someone</h2></div></div>
              <form onSubmit={createInvitation} className="profile-add-grid">
                <div className="field"><label htmlFor="hh-invite-email">Email</label><input id="hh-invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@example.com" required /></div>
                <div className="field"><label htmlFor="hh-invite-role">Role</label><select id="hh-invite-role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as "member" | "owner")}><option value="member">Member</option><option value="owner">Owner</option></select></div>
                <button className="button primary" type="submit" disabled={!inviteEmail.trim()}>Send invitation</button>
              </form>
              {inviteError && <div className="document-warning" style={{ marginTop: 12 }}>{inviteError}</div>}
              {inviteLink && (
                <div className="upload-status" style={{ marginTop: 12 }}>
                  Share this link with them -- it won&apos;t be shown again: <br />
                  <code style={{ wordBreak: "break-all" }}>{inviteLink}</code>
                </div>
              )}

              {invitations.length > 0 && (
                <div className="profile-list" style={{ marginTop: 16 }}>
                  {invitations.map((invitation) => (
                    <div className="profile-card" key={invitation.id}>
                      <div className="avatar profile-avatar">{invitation.email.slice(0, 1).toUpperCase()}</div>
                      <div className="profile-fields">
                        <div className="field"><label>Email</label><span>{invitation.email}</span></div>
                        <div className="field"><label>Role</label><span>{invitation.role}</span></div>
                        <div className="field"><label>Expires</label><span>{new Date(invitation.expires_at).toLocaleDateString()}</span></div>
                      </div>
                      <div className="profile-actions">
                        <button className="mini-button danger" onClick={() => revokeInvitation(invitation)}>
                          {confirmInvitationId === invitation.id ? "Confirm" : "Revoke"}
                        </button>
                        {confirmInvitationId === invitation.id && <button className="mini-button" onClick={() => setConfirmInvitationId(null)}>Cancel</button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="section">
            <div className="section-heading"><div><div className="eyebrow">PLAN</div><h2>Plan usage</h2></div></div>
            <p className="lead">See how much of this month&apos;s plan your household has used. <Link className="text-link" href="/usage">Plan usage →</Link></p>
          </section>

          {isOwner && <HouseholdExportPanel />}

          {isOwner && (
            <section className="section danger-zone">
              <div className="section-heading"><div><div className="eyebrow">DANGER ZONE</div><h2>Delete this household</h2></div></div>
              <p className="lead">
                This permanently deletes every policy, claim, family member, and document this household owns. It cannot be undone.
                To confirm, type the household&apos;s exact name (<strong>{householdName}</strong>) below.
              </p>
              <div className="profile-add-grid">
                <div className="field"><label htmlFor="hh-delete-confirm">Household name</label><input id="hh-delete-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} placeholder={householdName ?? ""} /></div>
                <button className="button secondary" style={{ borderColor: "var(--critical-line)", color: "var(--critical)" }} disabled={confirmName.trim() !== householdName || deleting} onClick={deleteHousehold}>
                  {deleting ? "Deleting…" : "Permanently delete household"}
                </button>
              </div>
              {deleteError && <div className="document-warning" style={{ marginTop: 12 }}>{deleteError}</div>}
              {needsReauth && (
                <div className="document-warning" style={{ marginTop: 12 }}>
                  Please sign in again to confirm it&apos;s you before continuing. <Link href={`/login?next=${encodeURIComponent("/household")}`}>Sign in again</Link>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
