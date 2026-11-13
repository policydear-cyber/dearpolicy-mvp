"use client";
import { FormEvent, useEffect, useState } from "react";
import { customerMessage } from "@/components/customer-text";
import { sgDate } from "@/components/format-date";

type Member = { householdId: string; userId: string; role: "owner" | "member"; createdAt: string; email?: string | null; isSelf?: boolean };
type Invitation = { id: string; householdId: string; email: string; role: "owner" | "member"; invitedBy: string; createdAt: string; expiresAt: string };

/** Who can sign in to this household, and (for its owner) invitations. Lives on the People page next to the
 * family profiles, so "the people in my household" is one place, not a Family page and a Household > Members list. */
export function HouseholdAccess() {
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

  async function refresh() {
    const householdRes = await fetch("/api/household").then((r) => r.json()).catch(() => ({}));
    const activeId: string | null = householdRes.activeHouseholdId ?? null;
    // Every entry in `memberships` belongs to the caller, so the entry for the active household names the
    // caller's own user id -- no separate "who am I" endpoint needed just to know which member row is "you".
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

  if (!loaded || !members.length) return null;
  return (
    <>
      <section className="section">
        <div className="section-heading"><div><h2>Who can sign in</h2><p>People with their own DearPolicy sign-in for this household. They see the same documents and family.</p></div></div>
        <div className="profile-list" data-testid="household-access">
          {members.map((member) => {
            const isSelf = member.userId === callerUserId;
            // Only the owner may remove someone else (RLS's own
            // household_members_delete policy is the real enforcement
            // either way -- this just avoids offering a button that
            // would only come back as a 404).
            // The only owner cannot leave: the household would be left
            // with nobody able to manage or delete it.
            const soleOwner = isSelf && member.role === "owner" && members.filter((m) => m.role === "owner").length === 1;
            const canAct = (isSelf || isOwner) && !soleOwner;
            const who = member.email ?? (isSelf ? "You" : "Household member");
            return (
              <div className="profile-card" key={member.userId}>
                <div className="avatar profile-avatar" aria-hidden="true">{(member.email ?? "?").slice(0, 1).toUpperCase()}</div>
                <div className="profile-fields">
                  <div className="field"><label>Member</label><span>{who}{isSelf && member.email ? " (you)" : ""}</span></div>
                  <div className="field"><label>Role</label><span>{member.role === "owner" ? "Owner" : "Member"}</span></div>
                  <div className="field"><label>Joined</label><span>{sgDate(member.createdAt)}</span></div>
                </div>
                <div className="profile-actions">
                  {canAct && (
                    <button className="mini-button danger" onClick={() => removeMember(member)}>
                      {confirmMemberId === member.userId ? "Confirm" : isSelf ? "Leave" : "Remove"}
                    </button>
                  )}
                  {confirmMemberId === member.userId && <button className="mini-button" onClick={() => setConfirmMemberId(null)}>Cancel</button>}
                  {soleOwner && <small className="muted">You are the only owner. To leave, make someone else an owner first, or delete the household on the Household tab.</small>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isOwner && (
        <section className="section">
          <div className="section-heading"><div><h2>Invite someone to sign in</h2></div></div>
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
                    <div className="field"><label>Expires</label><span>{sgDate(invitation.expiresAt)}</span></div>
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
      {status && <div className="upload-status" role="status">{status}</div>}
    </>
  );
}
