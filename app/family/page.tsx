"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { customerMessage } from "@/components/customer-text";
import { COVER_KINDS, isToConfirm, kindOfRow, type KindRow } from "@/components/cover-kinds";
import { personColour } from "@/components/person-colour";

type Member = {
  id: string; display_name: string; relationship: string; date_of_birth: string | null;
  preferred_name: string | null; notes: string | null; policy_count: number;
};

const RELATIONSHIPS = ["self","spouse","parent","child","sibling","grandparent","dependant","other"];
/** How a relationship reads on screen ("self" is the person using DearPolicy). */
const relationshipLabel = (r: string) => r === "self" ? "Me" : r.charAt(0).toUpperCase() + r.slice(1);

/** Today as YYYY-MM-DD in the person's own time zone (a birth date can't be later). */
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function FamilyPage() {
  // Set after hydration: the server's "today" (and time zone) can differ.
  const [today, setToday] = useState<string | undefined>(undefined);
  useEffect(() => { setToday(todayIso()); }, []);
  const [family, setFamily] = useState<Member[]>([]);
  const [baseline, setBaseline] = useState<Record<string, Member>>({});
  const [name, setName] = useState("");
  // No default: a guessed "parent" was silently saved for people added in a hurry.
  const [relationship, setRelationship] = useState("");
  const [dob, setDob] = useState("");
  const [preferred, setPreferred] = useState("");
  const [status, setStatus] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** The person the last save or removal was about, so its outcome is also shown on their card (not only at the top). */
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  /** Whose details are open for editing: the card shows who they are first, and the form only when asked for. */
  const [editing, setEditing] = useState<string | null>(null);
  /** What each person is covered for, by kind, from the Coverage rows. Optional: the page works without it. */
  const [kinds, setKinds] = useState<Record<string, string[]>>({});

  async function refresh() {
    const data = await fetch("/api/family").then((r) => r.json());
    const members: Member[] = data.family ?? [];
    setFamily(members);
    setBaseline(Object.fromEntries(members.map((m) => [m.id, m])));
    void fetch("/api/ledger", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((l: { rows?: (KindRow & { familyMemberId: string; status: string })[] } | null) => {
      if (!l) return;
      // Per person, each kind found and whether any of its rows is confirmed; a kind only a schedule line suggests is "to confirm".
      const by: Record<string, Map<string, boolean>> = {};
      for (const r of l.rows ?? []) if (r.status !== "rejected") {
        const kinds = by[r.familyMemberId] ??= new Map(), id = kindOfRow(r).id;
        kinds.set(id, kinds.get(id) === true || !isToConfirm(r));
      }
      setKinds(Object.fromEntries(Object.entries(by).map(([id, found]) => [id, COVER_KINDS.filter((k) => found.has(k.id)).map((k) => found.get(k.id) ? k.label : `${k.label} (to confirm)`)])));
    }).catch(() => undefined);
  }
  useEffect(() => { void refresh(); }, []);

  async function add(event: FormEvent) {
    event.preventDefault(); setStatus("");
    if (dob && dob > todayIso()) return setStatus("A date of birth can't be in the future.");
    const response = await fetch("/api/family", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name, relationship, dateOfBirth: dob || null, preferredName: preferred || null }) });
    const payload = await response.json();
    if (!response.ok) return setStatus(customerMessage(payload.error, "Could not add this profile. Please try again in a moment."));
    setName(""); setDob(""); setPreferred(""); setStatus("Profile added."); await refresh();
  }

  async function save(member: Member) {
    if (member.date_of_birth && member.date_of_birth > todayIso()) return setStatus("A date of birth can't be in the future.");
    const response = await fetch(`/api/family/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: member.display_name, relationship: member.relationship, dateOfBirth: member.date_of_birth, preferredName: member.preferred_name, notes: member.notes }) });
    const payload = await response.json();
    setStatusFor(member.id);
    setStatusIsError(!response.ok);
    if (response.ok) setEditing(null);
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
    setConfirmId(null); setStatusFor(member.id);
    const response = await fetch(`/api/family/${member.id}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    setStatusIsError(!response.ok);
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
          <div className="field"><label htmlFor="fm-new-relationship">Relationship</label><select id="fm-new-relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} required><option value="" disabled>Choose…</option>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{relationshipLabel(r)}</option>)}</select></div>
          <div className="field"><label htmlFor="fm-new-dob">Date of birth (optional)</label><input id="fm-new-dob" type="date" max={today} value={dob} onChange={(e) => setDob(e.target.value)} /></div>
          <div className="field"><label htmlFor="fm-new-preferred">Preferred name (optional)</label><input id="fm-new-preferred" value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="e.g. Desmond" /></div>
          <button className="button primary" type="submit" disabled={!name.trim() || !relationship}>+ Add person</button>
        </form>
        {status && <div className="upload-status" role="status">{status}</div>}
      </section>

      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">HOUSEHOLD</div><h2>Your profiles</h2></div></div>
        <div className="profile-list">
          {family.map((member) => (
            <div className="profile-card" key={member.id} data-testid="profile-card">
              {/* At a glance: who, how they are linked to documents, and what they are covered for. */}
              <div className="profile-summary">
                <div className="avatar profile-avatar person-coloured" style={personColour(member.id,family)}>{(baseline[member.id]?.display_name ?? member.display_name).slice(0,1).toUpperCase()}</div>
                <div><strong>{baseline[member.id]?.display_name ?? member.display_name}</strong><small>{relationshipLabel(baseline[member.id]?.relationship ?? member.relationship)}{baseline[member.id]?.preferred_name ? ` · goes by ${baseline[member.id]?.preferred_name}` : ""}</small></div>
              </div>
              <div className="profile-glance">
                <p>{member.policy_count ? <Link className="text-link" href={`/policies?person=${member.id}`}><b>{member.policy_count === 1 ? "1 document" : `${member.policy_count} documents`}</b>&nbsp;linked →</Link> : <>No documents linked yet. <Link className="text-link" href="/policies">Link one on Documents →</Link></>}</p>
                {kinds[member.id]?.length ? <p><b>Covered for</b> {kinds[member.id].join(" · ")}. <a className="text-link" href={`/ledger?member=${member.id}`}>See {baseline[member.id]?.display_name ?? member.display_name}&rsquo;s cover →</a></p>
                  : member.policy_count ? <p>Nothing found in your uploaded documents for them yet. <a className="text-link" href={`/ledger?member=${member.id}`}>See cover →</a></p> : null}
              </div>
              <div className="profile-fields" id={`fm-${member.id}-details`} hidden={editing !== member.id && !isDirty(member)}>
                <div className="field"><label htmlFor={`fm-${member.id}-name`}>Full name</label><input id={`fm-${member.id}-name`} value={member.display_name} onChange={(e) => update(member.id,{ display_name:e.target.value })} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-relationship`}>Relationship</label><select id={`fm-${member.id}-relationship`} value={member.relationship} onChange={(e) => update(member.id,{ relationship:e.target.value })}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{relationshipLabel(r)}</option>)}</select></div>
                <div className="field"><label htmlFor={`fm-${member.id}-dob`}>Date of birth</label><input id={`fm-${member.id}-dob`} type="date" max={today} value={member.date_of_birth ?? ""} onChange={(e) => update(member.id,{ date_of_birth:e.target.value || null })} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-preferred`}>Preferred name</label><input id={`fm-${member.id}-preferred`} value={member.preferred_name ?? ""} onChange={(e) => update(member.id,{ preferred_name:e.target.value || null })} /></div>
              </div>
              {/* Removing someone says what happens before it is confirmed: a person still on a document can't be
                  removed (untick them there first; answers that used their cover are then marked out of date). */}
              {confirmId === member.id && <div className="profile-remove-warning" role="alert">{member.policy_count
                ? <><strong>{baseline[member.id]?.display_name ?? member.display_name} is still linked to {member.policy_count === 1 ? "a document" : `${member.policy_count} documents`}.</strong> Untick them on {member.policy_count === 1 ? "it" : "each one"} on the Documents page first. Saved answers that used their cover are then marked out of date when reopened.</>
                : <><strong>Remove {baseline[member.id]?.display_name ?? member.display_name} from your household?</strong> This can&rsquo;t be undone. Saved answers that used their cover are marked out of date when reopened. If DearPolicy still has chats or claims about them, it keeps them and says so.</>}</div>}
              {statusFor === member.id && status && confirmId !== member.id ? <p className={`profile-status${statusIsError ? " error" : ""}`} role={statusIsError ? "alert" : undefined}>{status}</p> : null}
              <div className="profile-actions">
                {editing === member.id || isDirty(member) ? <>
                  <button className="button secondary" disabled={!isDirty(member)} onClick={() => save(member)}>{isDirty(member) ? "Save" : "Saved"}</button>
                  <button className="button secondary" onClick={() => { update(member.id, baseline[member.id]); setEditing(null); }}>{isDirty(member) ? "Undo changes" : "Close"}</button>
                </> : <button className="button secondary" aria-expanded={false} aria-controls={`fm-${member.id}-details`} onClick={() => setEditing(member.id)}>Edit details</button>}
                {/* Someone still on a document can't be removed, so they are sent where the next step is, not offered a delete that fails. */}
                {confirmId === member.id && member.policy_count
                  ? <Link className="button primary" href="/policies">Go to Documents</Link>
                  : <button className={`button secondary${confirmId === member.id ? " danger" : ""}`} onClick={() => remove(member)} aria-label={confirmId === member.id ? `Confirm delete ${member.display_name}` : `Delete ${member.display_name}`}>{confirmId === member.id ? "Confirm delete" : "Delete"}</button>}
                {confirmId === member.id && <button className="button secondary" onClick={() => setConfirmId(null)}>Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
