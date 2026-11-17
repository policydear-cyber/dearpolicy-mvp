"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { HouseholdExportPanel } from "./export-panel";
import { AccountTabs } from "@/components/account-tabs";
import { Icon } from "@/components/icons";
import { customerMessage } from "@/components/customer-text";
import { HOUSEHOLD_CURRENCIES, HOUSEHOLD_CURRENCY_LABELS, NO_HOUSEHOLD_CURRENCY } from "@/lib/documents/household-currency-options";

type Member = { householdId: string; userId: string; role: "owner" | "member"; createdAt: string; email?: string | null; isSelf?: boolean };

export default function HouseholdPage() {
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [callerUserId, setCallerUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  // The household's own currency: what is stored ("" = not chosen, shown as the default) and what is picked.
  const [currencySaved, setCurrencySaved] = useState("");
  const [currencyInput, setCurrencyInput] = useState("");
  const [currencyStatus, setCurrencyStatus] = useState("");



  const [confirmName, setConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [needsReauth, setNeedsReauth] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function refresh() {
    const householdRes = await fetch("/api/household").then((r) => r.json());
    const activeId: string | null = householdRes.activeHouseholdId ?? null;
    setHouseholdName(householdRes.activeHouseholdName ?? null);
    setNameInput(householdRes.activeHouseholdName ?? "");
    setCurrencySaved(householdRes.activeHouseholdCurrency ?? "");
    setCurrencyInput(householdRes.activeHouseholdCurrency ?? "");
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

  async function saveCurrency(event: FormEvent) {
    event.preventDefault();
    setCurrencyStatus("");
    const response = await fetch("/api/household", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currency: currencyInput }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return setCurrencyStatus(customerMessage(payload.error, "Could not save the currency. Please try again in a moment."));
    setCurrencyStatus((payload.withdrawn ? "Saved. Amounts that used your previous choice are no longer shown. " : "Saved. ")
      + "Documents you upload from now on use it. For a document already uploaded, choose Read again on the Documents page.");
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
          <h1><span className="title-icon"><Icon name="family"/></span>Account settings</h1>
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

          <section className="section" data-testid="household-currency">
            <div className="section-heading"><div><h2>Policy currency</h2></div></div>
            <p className="lead">When a document prints amounts without any currency, DearPolicy shows them in the currency you choose here. A currency printed in the document always comes first, and amounts printed with only a $ sign are left as they are. Until you choose, DearPolicy doesn't assume a currency for them.</p>
            <form onSubmit={saveCurrency} className="profile-add-grid">
              <div className="field"><label htmlFor="hh-currency">Currency</label>
                <select id="hh-currency" value={currencyInput} onChange={(e) => setCurrencyInput(e.target.value)} disabled={!isOwner}>
                  {!currencySaved && <option value="" disabled>Choose your currency…</option>}
                  {[...HOUSEHOLD_CURRENCIES, NO_HOUSEHOLD_CURRENCY].map((c) => <option key={c} value={c}>{HOUSEHOLD_CURRENCY_LABELS[c]}</option>)}
                </select>
              </div>
              {isOwner && <button className="button primary" type="submit" disabled={!currencyInput || currencyInput === currencySaved}>Save currency</button>}
            </form>
            {!isOwner && <p className="lead" style={{ marginTop: 8 }}>Only an owner of this household can change its currency.</p>}
            {currencyStatus && <div className="upload-status">{currencyStatus}</div>}
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
                <button className="button secondary danger" disabled={confirmName.trim() !== householdName || deleting} onClick={deleteHousehold}>
                  {deleting ? "Deleting…" : "Permanently delete household"}
                </button>
              </div>
              {deleteError && <div className="alert error" role="alert" style={{ marginTop: 12 }}>{deleteError}</div>}
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
