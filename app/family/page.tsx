"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { customerMessage } from "@/components/customer-text";
import { AccountTabs } from "@/components/account-tabs";
import { Icon } from "@/components/icons";
import { HouseholdAccess } from "@/components/household-access";
import { profileGaps, PROFILE_GAP_FIELD } from "@/lib/household/member-profile";

type Member = {
  id: string; display_name: string; relationship: string; date_of_birth: string | null;
  preferred_name: string | null; notes: string | null; policy_count: number;
  /** female, male or unspecified (chose not to say); null when not answered yet. */
  sex?: string | null;
};

const RELATIONSHIPS = ["self","spouse","parent","child","sibling","grandparent","dependant","other"];
/** How a relationship reads on screen ("self" is the person using DearPolicy). */
const relationshipLabel = (r: string) => r === "self" ? "Me" : r.charAt(0).toUpperCase() + r.slice(1);
const SEXES: [string, string][] = [["female", "Female"], ["male", "Male"], ["unspecified", "Prefer not to say"]];
const sexLabel = (s: string | null | undefined) => SEXES.find(([v]) => v === s)?.[1] ?? null;
/** Whole years old today, from a YYYY-MM-DD date of birth (null when there is none). */
function ageToday(dob: string | null, today: string | undefined): number | null {
  if (!dob || !today) return null;
  const [y, m, d] = dob.split("-").map(Number), [Y, M, D] = today.split("-").map(Number);
  const age = Y - y - (M < m || (M === m && D < d) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
}
/** "a, b and c" */
function listWords(words: string[]) { return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`; }

/** The marker on a required field's label. Screen readers hear "required" from the field itself. */
const Req = () => <span className="field-required" aria-hidden="true">*</span>;
/** A field's own "Required" line, shown only after Add or Save was pressed with it empty. */
const Missing = ({ id, show }: { id: string; show: boolean }) => show ? <small className="error" id={`${id}-error`}>Required</small> : null;
/** Ties a field to its "Required" line while it shows. */
const invalid = (id: string, show: boolean) => show ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};

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
  const [sex, setSex] = useState("");
  /** Add was pressed with a field empty: each empty field now says "Required" (until it is filled). */
  const [newTried, setNewTried] = useState(false);
  /** Save was pressed on these people with a detail empty: each empty field now says "Required". */
  const [editTried, setEditTried] = useState<Record<string, boolean>>({});
  /** Whether a sex can be saved yet (the database update for it is in place). Until then it is not asked for. */
  const [sexField, setSexField] = useState(false);
  /** The family list (and whether a sex can be saved) has loaded: until then the form can't know which fields it needs. */
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /** The person the last save or removal was about, so its outcome is also shown on their card (not only at the top). */
  const [statusFor, setStatusFor] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  /** Whose details are open for editing: the card shows who they are first, and the form only when asked for. */
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    const data = await fetch("/api/family").then((r) => r.json());
    const members: Member[] = data.family ?? [];
    setFamily(members);
    setSexField(data.profile?.sexField === true);
    setLoaded(true);
    setBaseline(Object.fromEntries(members.map((m) => [m.id, m])));
  }
  useEffect(() => { void refresh(); }, []);

  async function add(event: FormEvent) {
    event.preventDefault(); setStatus(""); setStatusFor(null); setStatusIsError(false);
    const empty = newEmpty.find(([, isEmpty]) => isEmpty);
    if (empty) { setNewTried(true); document.getElementById(`fm-new-${empty[0]}`)?.focus(); return; }
    if (dob > todayIso()) return setStatus("A date of birth can't be in the future.");
    if (dob < "1900-01-01") return setStatus("Check the year of that date of birth.");
    const response = await fetch("/api/family", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name, relationship, dateOfBirth: dob, preferredName: preferred.trim(), ...(sexField ? { sex } : {}) }) });
    const payload = await response.json();
    if (!response.ok) return setStatus(customerMessage(payload.error, "This family member couldn't be added. Try again in a moment."));
    setName(""); setDob(""); setPreferred(""); setSex(""); setRelationship(""); setNewTried(false); setStatus("Family member added."); await refresh();
  }

  async function save(member: Member) {
    const empty = editEmpty(member).find(([, isEmpty]) => isEmpty);
    if (empty) { setEditTried((t) => ({ ...t, [member.id]: true })); document.getElementById(`fm-${member.id}-${empty[0]}`)?.focus(); return; }
    if (member.date_of_birth && member.date_of_birth > todayIso()) return setStatus("A date of birth can't be in the future.");
    if (member.date_of_birth && member.date_of_birth < "1900-01-01") return setStatus("Check the year of that date of birth.");
    const response = await fetch(`/api/family/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: member.display_name, relationship: member.relationship, dateOfBirth: member.date_of_birth, preferredName: member.preferred_name, notes: member.notes, ...(sexField ? { sex: member.sex ?? null } : {}) }) });
    const payload = await response.json();
    setStatusFor(member.id);
    setStatusIsError(!response.ok);
    if (response.ok) { setEditing(null); setEditTried((t) => ({ ...t, [member.id]: false })); }
    setStatus(response.ok ? `Saved ${member.display_name}.` : (customerMessage(payload.error, "Your changes couldn't be saved. Try again in a moment.")));
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
      (original.date_of_birth ?? null) !== (member.date_of_birth ?? null) || (original.preferred_name ?? null) !== (member.preferred_name ?? null) ||
      (original.sex ?? null) !== (member.sex ?? null);
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
    setStatus(response.ok ? `Removed ${member.display_name}.` : (customerMessage(payload.error, "This family member couldn't be removed. Try again in a moment.")));
    if (response.ok) await refresh();
  }

  /** Which add-form fields are empty, by field id, in screen order. */
  const newEmpty: [string, boolean][] = [["name", !name.trim()], ["relationship", !relationship], ["dob", !dob], ["sex", sexField && !sex], ["preferred", !preferred.trim()]];
  const newShows = (field: string) => newTried && newEmpty.some(([f, isEmpty]) => f === field && isEmpty);
  /** Which of a person's details are empty, by field id: the full name, and the details profileGaps asks for. */
  function editEmpty(member: Member): [string, boolean][] {
    const gaps = profileGaps(member, sexField).map((g) => PROFILE_GAP_FIELD[g]);
    return [["name", !member.display_name.trim()], ...["relationship", "dob", "sex", "preferred"].map((f): [string, boolean] => [f, gaps.includes(f)])];
  }
  const editShows = (member: Member, field: string) => !!editTried[member.id] && editEmpty(member).some(([f, isEmpty]) => f === field && isEmpty);

  function update(id: string, patch: Partial<Member>) { setFamily((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item)); }

  return (
    <div className="page">
      <header className="page-header compact"><div><h1><span className="title-icon"><Icon name="family"/></span>Account settings</h1></div></header>
      <AccountTabs />
      <div className="section-heading"><div><h2>Your family</h2><p>The people your policies cover. Use each person&rsquo;s full name as their documents print it. DearPolicy uses it to match each document to the people it covers.</p></div></div>

      <section className="section">
        <div className="profile-list">
          {family.map((member, i) => (
            <div className="profile-card" key={member.id} data-testid="profile-card" data-person={i % 4}>
              {/* Kept simple (DC, 18 Nov): who they are. Their name opens their cover; documents and kinds of cover live there. */}
              <div className="profile-summary">
                <div className="avatar profile-avatar">{(baseline[member.id]?.display_name ?? member.display_name).slice(0,1).toUpperCase()}</div>
                <div><strong><a className="profile-name" href={`/ledger?member=${member.id}`} data-testid="family-see-cover" aria-label={`See ${baseline[member.id]?.display_name ?? member.display_name}’s cover`}>{baseline[member.id]?.display_name ?? member.display_name}<span className="profile-name-go" aria-hidden="true">→</span></a></strong><small>{[relationshipLabel(baseline[member.id]?.relationship ?? member.relationship),
                  ((a) => a == null ? null : `${a} ${a === 1 ? "year" : "years"} old`)(ageToday(baseline[member.id]?.date_of_birth ?? null, today)),
                  baseline[member.id]?.sex === "unspecified" ? null : sexLabel(baseline[member.id]?.sex),
                  baseline[member.id]?.preferred_name ? `goes by ${baseline[member.id]?.preferred_name}` : null].filter(Boolean).join(" · ")}</small></div>
              </div>
              <div className="profile-glance">
                {/* Details still missing (people added before they were asked for): one plain line and a way to add them. */}
                {(() => { const gaps = profileGaps(baseline[member.id] ?? member, sexField); if (!gaps.length || editing === member.id) return null;
                  const who = baseline[member.id]?.display_name ?? member.display_name;
                  return <p className="profile-missing" data-testid="profile-missing">Add {who}&rsquo;s {listWords(gaps)}. <button type="button" className="text-link" onClick={() => { setEditing(member.id); setTimeout(() => document.getElementById(`fm-${member.id}-${PROFILE_GAP_FIELD[gaps[0]]}`)?.focus(), 0); }}>Add now</button></p>; })()}
              </div>
              <div className="profile-fields" id={`fm-${member.id}-details`} hidden={editing !== member.id && !isDirty(member)}>
                <div className="field"><label htmlFor={`fm-${member.id}-name`}>Full name <Req /></label><input id={`fm-${member.id}-name`} required value={member.display_name} onChange={(e) => update(member.id,{ display_name:e.target.value })} {...invalid(`fm-${member.id}-name`, editShows(member, "name"))} /><Missing id={`fm-${member.id}-name`} show={editShows(member, "name")} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-relationship`}>Relationship <Req /></label><select id={`fm-${member.id}-relationship`} required value={member.relationship ?? ""} onChange={(e) => update(member.id,{ relationship:e.target.value })} {...invalid(`fm-${member.id}-relationship`, editShows(member, "relationship"))}><option value="" disabled>Choose…</option>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{relationshipLabel(r)}</option>)}</select><Missing id={`fm-${member.id}-relationship`} show={editShows(member, "relationship")} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-dob`}>Date of birth <Req /></label><input id={`fm-${member.id}-dob`} required type="date" min="1900-01-01" max={today} value={member.date_of_birth ?? ""} onChange={(e) => update(member.id,{ date_of_birth:e.target.value || null })} {...invalid(`fm-${member.id}-dob`, editShows(member, "dob"))} /><Missing id={`fm-${member.id}-dob`} show={editShows(member, "dob")} /></div>
                {sexField ? <div className="field"><label htmlFor={`fm-${member.id}-sex`}>Sex <Req /></label><select id={`fm-${member.id}-sex`} required value={member.sex ?? ""} onChange={(e) => update(member.id,{ sex:e.target.value || null })} {...invalid(`fm-${member.id}-sex`, editShows(member, "sex"))}><option value="" disabled>Choose…</option>{SEXES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><Missing id={`fm-${member.id}-sex`} show={editShows(member, "sex")} /></div> : null}
                <div className="field"><label htmlFor={`fm-${member.id}-preferred`}>Preferred name <Req /></label><input id={`fm-${member.id}-preferred`} required placeholder="What you call them" value={member.preferred_name ?? ""} onChange={(e) => update(member.id,{ preferred_name:e.target.value || null })} {...invalid(`fm-${member.id}-preferred`, editShows(member, "preferred"))} /><Missing id={`fm-${member.id}-preferred`} show={editShows(member, "preferred")} /></div>
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
                  <button className="button secondary" onClick={() => { update(member.id, baseline[member.id]); setEditing(null); setEditTried((t) => ({ ...t, [member.id]: false })); }}>{isDirty(member) ? "Undo changes" : "Close"}</button>
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

      {/* The people come first: a returning household opens this page to see or change them, and adds someone rarely. */}
      <section className="profile-add-panel" aria-label="Add a family member">
        {family.length ? <h3>Add a family member</h3> : null}
        <form onSubmit={add} noValidate className="profile-add-grid" onChange={() => { if (status) { setStatus(""); setStatusFor(null); } }}>
          <div className="field wide"><label htmlFor="fm-new-name">Full name, as on their policies <Req /></label><input id="fm-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Alex Chen" autoComplete="off" required {...invalid("fm-new-name", newShows("name"))} /><Missing id="fm-new-name" show={newShows("name")} /></div>
          <div className="field"><label htmlFor="fm-new-relationship">Relationship to you <Req /></label><select id="fm-new-relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} required {...invalid("fm-new-relationship", newShows("relationship"))}><option value="" disabled>Choose…</option>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{relationshipLabel(r)}</option>)}</select><Missing id="fm-new-relationship" show={newShows("relationship")} /></div>
          <div className="field"><label htmlFor="fm-new-dob">Date of birth <Req /></label><input id="fm-new-dob" type="date" min="1900-01-01" max={today} value={dob} onChange={(e) => setDob(e.target.value)} required {...invalid("fm-new-dob", newShows("dob"))} /><Missing id="fm-new-dob" show={newShows("dob")} /></div>
          {sexField ? <div className="field"><label htmlFor="fm-new-sex">Sex <Req /></label><select id="fm-new-sex" value={sex} onChange={(e) => setSex(e.target.value)} required {...invalid("fm-new-sex", newShows("sex"))}><option value="" disabled>Choose…</option>{SEXES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><Missing id="fm-new-sex" show={newShows("sex")} /></div> : null}
          <div className="field"><label htmlFor="fm-new-preferred">Preferred name <Req /></label><input id="fm-new-preferred" value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="For example, Alex" autoComplete="off" required {...invalid("fm-new-preferred", newShows("preferred"))} /><Missing id="fm-new-preferred" show={newShows("preferred")} /></div>
          {/* Never disabled once loaded: pressing Add with a field empty marks each empty field "Required". */}
          <button className="button primary" type="submit" disabled={!loaded}>+ Add person</button>
        </form>
        {status && <div className="upload-status" role="status">{status}</div>}
      </section>

      <HouseholdAccess />
    </div>
  );
}
