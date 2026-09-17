"use client";

import { FormEvent, useEffect, useState } from "react";

type Member = {
  id: string; display_name: string; relationship: string; date_of_birth: string | null;
  preferred_name: string | null; notes: string | null; policy_count: number;
};

const RELATIONSHIPS = ["self","spouse","parent","child","sibling","grandparent","dependant","other"];

export default function FamilyPage() {
  const [family, setFamily] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("parent");
  const [dob, setDob] = useState("");
  const [preferred, setPreferred] = useState("");
  const [status, setStatus] = useState("");

  async function refresh() {
    const data = await fetch("/api/family").then((r) => r.json());
    setFamily(data.family ?? []);
  }
  useEffect(() => { void refresh(); }, []);

  async function add(event: FormEvent) {
    event.preventDefault(); setStatus("");
    const response = await fetch("/api/family", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name, relationship, dateOfBirth: dob || null, preferredName: preferred || null }) });
    const payload = await response.json();
    if (!response.ok) return setStatus("Could not add this profile. Please try again in a moment.");
    setName(""); setDob(""); setPreferred(""); setStatus("Profile added."); await refresh();
  }

  async function save(member: Member) {
    const response = await fetch(`/api/family/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: member.display_name, relationship: member.relationship, dateOfBirth: member.date_of_birth, preferredName: member.preferred_name, notes: member.notes }) });
    const payload = await response.json();
    setStatus(response.ok ? `Saved ${member.display_name}.` : "Could not save this profile. Please try again in a moment.");
    if (response.ok) await refresh();
  }

  function update(id: string, patch: Partial<Member>) { setFamily((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  return (
    <div className="page">
      <header className="page-header compact"><div><div className="eyebrow">FAMILY PROFILES</div><h1>Tell DearPolicy who is in your family.</h1><p className="lead">Use full legal names where possible. When a certificate contains several insured people, DearPolicy uses these names to link the same document to everyone it covers.</p></div></header>

      <section className="profile-add-panel">
        <form onSubmit={add} className="profile-add-grid">
          <div className="field"><label>Full name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tan Yi Chuen, Desmond" required /></div>
          <div className="field"><label>Relationship</label><select value={relationship} onChange={(e) => setRelationship(e.target.value)}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          <div className="field"><label>Date of birth (optional)</label><input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
          <div className="field"><label>Preferred name (optional)</label><input value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="e.g. Desmond" /></div>
          <button className="button primary" type="submit" disabled={!name.trim()}>+ Add person</button>
        </form>
        {status && <div className="upload-status">{status}</div>}
      </section>

      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">HOUSEHOLD</div><h2>Your profiles</h2></div></div>
        <div className="profile-list">
          {family.map((member) => (
            <div className="profile-card" key={member.id}>
              <div className="avatar profile-avatar">{member.display_name.slice(0,1).toUpperCase()}</div>
              <div className="profile-fields">
                <div className="field"><label>Full name</label><input value={member.display_name} onChange={(e) => update(member.id,{ display_name:e.target.value })} /></div>
                <div className="field"><label>Relationship</label><select value={member.relationship} onChange={(e) => update(member.id,{ relationship:e.target.value })}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
                <div className="field"><label>Date of birth</label><input type="date" value={member.date_of_birth ?? ""} onChange={(e) => update(member.id,{ date_of_birth:e.target.value || null })} /></div>
                <div className="field"><label>Preferred name</label><input value={member.preferred_name ?? ""} onChange={(e) => update(member.id,{ preferred_name:e.target.value || null })} /></div>
              </div>
              <div className="profile-actions"><span>{member.policy_count} linked documents</span><button className="button secondary" onClick={() => save(member)}>Save</button></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
