"use client";

import { FormEvent, useEffect, useState } from "react";
import { customerMessage } from "@/components/customer-text";

type Member = {
  id: string; display_name: string; relationship: string; date_of_birth: string | null;
  preferred_name: string | null; notes: string | null; policy_count: number;
};

const RELATIONSHIPS = ["self","spouse","parent","child","sibling","grandparent","dependant","other"];

export default function FamilyPage() {
  const [family, setFamily] = useState<Member[]>([]);
  const [baseline, setBaseline] = useState<Record<string, Member>>({});
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("parent");
  const [dob, setDob] = useState("");
  const [preferred, setPreferred] = useState("");
  const [status, setStatus] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function refresh() {
    const data = await fetch("/api/family").then((r) => r.json());
    const members: Member[] = data.family ?? [];
    setFamily(members);
    setBaseline(Object.fromEntries(members.map((m) => [m.id, m])));
  }
  useEffect(() => { void refresh(); }, []);

  async function add(event: FormEvent) {
    event.preventDefault(); setStatus("");
    const response = await fetch("/api/family", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name, relationship, dateOfBirth: dob || null, preferredName: preferred || null }) });
    const payload = await response.json();
    if (!response.ok) return setStatus(customerMessage(payload.error, "Could not add this profile. Please try again in a moment."));
    setName(""); setDob(""); setPreferred(""); setStatus("Profile added."); await refresh();
  }

  async function save(member: Member) {
    const response = await fetch(`/api/family/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: member.display_name, relationship: member.relationship, dateOfBirth: member.date_of_birth, preferredName: member.preferred_name, notes: member.notes }) });
    const payload = await response.json();
    setStatus(response.ok ? `Saved ${member.display_name}.` : (customerMessage(payload.error, "Could not save this profile. Please try again in a moment.")));
    if (response.ok) await refresh();
  }

  // A freshly-added or untouched profile has nothing to save -- showing an
  // always-on Save button next to it reads as "did this actually save?"
  // Comparing against the last-fetched/last-saved snapshot lets the button
  // disable itself (and say so) until there is a real edit to persist.
  function isDirty(member: Member) {
    const original = baseline[member.id];
    if (!original) return false;
    return original.display_name !== member.display_name || original.relationship !== member.relationship ||
      (original.date_of_birth ?? null) !== (member.date_of_birth ?? null) || (original.preferred_name ?? null) !== (member.preferred_name ?? null);
  }

  async function remove(member: Member) {
    // A native confirm() blocks the whole tab's event loop until dismissed --
    // an inline arm-then-confirm click avoids that (and the jarring OS-styled
    // popup) while still requiring a deliberate second click before anything
    // irreversible happens.
    if (confirmId !== member.id) { setConfirmId(member.id); return; }
    setConfirmId(null);
    const response = await fetch(`/api/family/${member.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    setStatus(response.ok ? `Removed ${member.display_name}.` : (customerMessage(payload.error, "Could not remove this profile. Please try again in a moment.")));
    if (response.ok) await refresh();
  }

  function update(id: string, patch: Partial<Member>) { setFamily((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  return (
    <div className="page">
      <header className="page-header compact"><div><div className="eyebrow">FAMILY PROFILES</div><h1>Tell DearPolicy who is in your family.</h1><p className="lead">Use full legal names where possible. When a certificate contains several insured people, DearPolicy uses these names to link the same document to everyone it covers.</p></div></header>

      <section className="profile-add-panel">
        <form onSubmit={add} className="profile-add-grid">
          <div className="field"><label htmlFor="fm-new-name">Full name</label><input id="fm-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tan Yi Chuen, Desmond" required /></div>
          <div className="field"><label htmlFor="fm-new-relationship">Relationship</label><select id="fm-new-relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          <div className="field"><label htmlFor="fm-new-dob">Date of birth (optional)</label><input id="fm-new-dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
          <div className="field"><label htmlFor="fm-new-preferred">Preferred name (optional)</label><input id="fm-new-preferred" value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="e.g. Desmond" /></div>
          <button className="button primary" type="submit" disabled={!name.trim()}>+ Add person</button>
        </form>
        {status && <div className="upload-status" role="status">{status}</div>}
      </section>

      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">HOUSEHOLD</div><h2>Your profiles</h2></div></div>
        <div className="profile-list">
          {family.map((member) => (
            <div className="profile-card" key={member.id}>
              <div className="avatar profile-avatar">{member.display_name.slice(0,1).toUpperCase()}</div>
              <div className="profile-fields">
                <div className="field"><label htmlFor={`fm-${member.id}-name`}>Full name</label><input id={`fm-${member.id}-name`} value={member.display_name} onChange={(e) => update(member.id,{ display_name:e.target.value })} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-relationship`}>Relationship</label><select id={`fm-${member.id}-relationship`} value={member.relationship} onChange={(e) => update(member.id,{ relationship:e.target.value })}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
                <div className="field"><label htmlFor={`fm-${member.id}-dob`}>Date of birth</label><input id={`fm-${member.id}-dob`} type="date" value={member.date_of_birth ?? ""} onChange={(e) => update(member.id,{ date_of_birth:e.target.value || null })} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-preferred`}>Preferred name</label><input id={`fm-${member.id}-preferred`} value={member.preferred_name ?? ""} onChange={(e) => update(member.id,{ preferred_name:e.target.value || null })} /></div>
              </div>
              <div className="profile-actions">
                <span>{member.policy_count} linked documents</span>
                <button className="button secondary" disabled={!isDirty(member)} onClick={() => save(member)}>{isDirty(member) ? "Save" : "Saved"}</button>
                <button className="button secondary" onClick={() => remove(member)} aria-label={confirmId === member.id ? `Confirm delete ${member.display_name}` : `Delete ${member.display_name}`}>{confirmId === member.id ? "Confirm delete" : "Delete"}</button>
                {confirmId === member.id && <button className="button secondary" onClick={() => setConfirmId(null)}>Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
