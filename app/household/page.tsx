"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { HouseholdExportPanel } from "./export-panel";
import { AccountTabs } from "@/components/account-tabs";
import { customerMessage } from "@/components/customer-text";

type Member = { householdId: string; userId: string; role: "owner" | "member"; createdAt: string; email?: string | null; isSelf?: boolean };

export default function HouseholdPage() {
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [callerUserId, setCallerUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");



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
      // Only to know whether the caller owns it (who may rename, export or delete); the list itself is on People.
      const membersRes = await fetch("/api/household/members").then((r) => r.json()).catch(() => ({ members: [] }));
      setMembers(membersRes.members ?? []);
    } else {
      setMembers([]);
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
      // -- is gone the instant this succeeds. Every household page would
      // now fail, so land on a confirmation with the real next steps.
      window.location.href = "/household/deleted";
    } finally {
      setDeleting(false);
    }
  }

  if (!loaded) return <div className="page"><p className="lead">Loading your household…</p></div>;

  return (
    <div className="page">
      <header className="page-header compact">
        <div>
          <h1>Account settings</h1>
        </div>
      </header>
      <AccountTabs />

      {!householdName && <p className="lead">You&apos;re not part of a household yet. If someone invited you, open the invitation link they sent you.</p>}

      {householdName !== null && (
        <>
          <section className="section">
            <div className="section-heading"><div><h2>Household name</h2></div></div>
            <form onSubmit={saveName} className="profile-add-grid">
              <div className="field"><label htmlFor="hh-name">Name</label><input id="hh-name" value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={200} required disabled={!isOwner} /></div>
              {isOwner && <button className="button primary" type="submit" disabled={!nameInput.trim() || nameInput.trim() === householdName}>Save name</button>}
            </form>
            {!isOwner && <p className="lead" style={{ marginTop: 8 }}>Only an owner of this household can change its name.</p>}
            {status && <div className="upload-status">{status}</div>}
          </section>

          {isOwner && <HouseholdExportPanel />}

          {isOwner && (
            <section className="section danger-zone">
              <div className="section-heading"><div><h2>Delete this household</h2></div></div>
              <p className="lead">
                This deletes every family member, document, claim and chat in this household. It can&apos;t be undone. You can download a copy first, above.
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
