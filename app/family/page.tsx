"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { customerMessage } from "@/components/customer-text";
import { AccountTabs } from "@/components/account-tabs";
import { Icon } from "@/components/icons";
import { HouseholdAccess } from "@/components/household-access";
import { kindsOfTable, ledgerKindsByPerson, namedCoverKinds, type KindRow, type ScheduleLine, type TableKindCover, type TableKindRow } from "@/components/cover-kinds";

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
/** What a family member's details still lack (the same list as lib/household/member-profile.ts profileGaps). */
function missingDetails(m: Pick<Member, "date_of_birth" | "sex">, sexField: boolean): string[] {
  const gaps: string[] = [];
  if (!m.date_of_birth) gaps.push("date of birth");
  if (sexField && !m.sex) gaps.push("sex");
  return gaps;
}

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
  /** Whether a sex can be saved yet (the database update for it is in place). Until then it is not asked for. */
  const [sexField, setSexField] = useState(false);
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
    setSexField(data.profile?.sexField === true);
    setBaseline(Object.fromEntries(members.map((m) => [m.id, m])));
    // A household on the benefit table: its rows say what each person is covered for (its Coverage rows stopped updating).
    // Optional, like the Coverage rows: the page works without it.
    void fetch("/api/benefit-table", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null)
      .then((table: { enabled?: boolean; people?: { id: string; rows?: TableKindRow[]; covers?: TableKindCover[]; scheduleLines?: { policyId: string; category: string }[] }[] } | null) => {
        // Not loaded (an error, offline): nothing is shown, never the stale Coverage rows (Critic R199-3).
        if (!table) return;
        if (table.enabled) { return setKinds(Object.fromEntries((table.people ?? []).map((p) => [p.id, kindsOfTable(p.rows ?? [], p.covers ?? [], p.scheduleLines ?? [])]))); }
        return fetch("/api/ledger", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((l: { rows?: (KindRow & { familyMemberId: string; status: string })[]; scheduleLines?: ScheduleLine[] } | null) => {
          if (!l) return;
          setKinds(ledgerKindsByPerson(l.rows ?? [], l.scheduleLines ?? []));
        });
      }).catch(() => undefined);
  }
  useEffect(() => { void refresh(); }, []);

  async function add(event: FormEvent) {
    event.preventDefault(); setStatus("");
    if (!dob) return setStatus("Add their date of birth.");
    if (dob > todayIso()) return setStatus("A date of birth can't be in the future.");
    if (dob < "1900-01-01") return setStatus("Check the year of that date of birth.");
    if (sexField && !sex) return setStatus("Choose female, male or prefer not to say.");
    const response = await fetch("/api/family", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: name, relationship, dateOfBirth: dob, preferredName: preferred || null, ...(sexField ? { sex } : {}) }) });
    const payload = await response.json();
    if (!response.ok) return setStatus(customerMessage(payload.error, "This family member couldn't be added. Try again in a moment."));
    setName(""); setDob(""); setPreferred(""); setSex(""); setRelationship(""); setStatus("Family member added."); await refresh();
  }

  async function save(member: Member) {
    if (member.date_of_birth && member.date_of_birth > todayIso()) return setStatus("A date of birth can't be in the future.");
    if (member.date_of_birth && member.date_of_birth < "1900-01-01") return setStatus("Check the year of that date of birth.");
    const response = await fetch(`/api/family/${member.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: member.display_name, relationship: member.relationship, dateOfBirth: member.date_of_birth, preferredName: member.preferred_name, notes: member.notes, ...(sexField ? { sex: member.sex ?? null } : {}) }) });
    const payload = await response.json();
    setStatusFor(member.id);
    setStatusIsError(!response.ok);
    if (response.ok) setEditing(null);
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
              {/* At a glance: who, how they are linked to documents, and what they are covered for. */}
              <div className="profile-summary">
                <div className="avatar profile-avatar">{(baseline[member.id]?.display_name ?? member.display_name).slice(0,1).toUpperCase()}</div>
                <div><strong>{baseline[member.id]?.display_name ?? member.display_name}</strong><small>{[relationshipLabel(baseline[member.id]?.relationship ?? member.relationship),
                  ((a) => a == null ? null : `${a} ${a === 1 ? "year" : "years"} old`)(ageToday(baseline[member.id]?.date_of_birth ?? null, today)),
                  baseline[member.id]?.sex === "unspecified" ? null : sexLabel(baseline[member.id]?.sex),
                  baseline[member.id]?.preferred_name ? `goes by ${baseline[member.id]?.preferred_name}` : null].filter(Boolean).join(" · ")}</small></div>
              </div>
              <div className="profile-glance">
                {/* Details still missing (people added before they were asked for): one plain line and a way to add them. */}
                {(() => { const gaps = missingDetails(baseline[member.id] ?? member, sexField); if (!gaps.length || editing === member.id) return null;
                  const who = baseline[member.id]?.display_name ?? member.display_name;
                  return <p className="profile-missing" data-testid="profile-missing">Add {who}&rsquo;s {gaps.join(" and ")}. {[gaps.includes("date of birth") ? "A date of birth tells adult cover from child cover" : null, gaps.includes("sex") ? "sex tells \u201cmy son\u201d from \u201cmy daughter\u201d" : null].filter(Boolean).join(", and ").replace(/^s/, "S")}. <button type="button" className="text-link" onClick={() => setEditing(member.id)}>Add now</button></p>; })()}
                <p>{member.policy_count ? <Link className="text-link" href={`/policies?person=${member.id}`}><b>{member.policy_count === 1 ? "1 document" : `${member.policy_count} documents`}</b>&nbsp;linked →</Link> : <>No documents linked yet. <Link className="text-link" href="/policies">Link one on Documents →</Link></>}</p>
                {/* Never "Covered for Other": only named kinds are listed, and cover whose kind nothing names yet is said in
                    words, as on Documents (namedCoverKinds). */}
                {(() => { const { named, unknownOnly, unknownToConfirm } = namedCoverKinds(kinds[member.id] ?? []); const name = baseline[member.id]?.display_name ?? member.display_name;
                  const see = <a className="text-link" href={`/ledger?member=${member.id}`}>See {name}&rsquo;s cover →</a>;
                  return named.length ? <p data-testid="family-covered-for"><b>Covered for</b> {named.join(" · ")}. {see}</p>
                    : unknownOnly ? <p data-testid="family-covered-for"><b>Found</b> cover for {name}, but not yet what kind of cover it is. {see}</p>
                    : unknownToConfirm ? <p data-testid="family-covered-for"><b>Possible cover</b> for {name}, still to confirm: not yet what kind of cover it is. {see}</p>
                    : null; })() ?? (member.policy_count ? <p>No cover found in {member.policy_count === 1 ? "this document" : "these documents"} yet. You can still ask about {member.policy_count === 1 ? "it" : "them"} in <Link className="text-link" href="/chat">Ask DearPolicy</Link>.</p> : null)}
              </div>
              <div className="profile-fields" id={`fm-${member.id}-details`} hidden={editing !== member.id && !isDirty(member)}>
                <div className="field"><label htmlFor={`fm-${member.id}-name`}>Full name</label><input id={`fm-${member.id}-name`} value={member.display_name} onChange={(e) => update(member.id,{ display_name:e.target.value })} /></div>
                <div className="field"><label htmlFor={`fm-${member.id}-relationship`}>Relationship</label><select id={`fm-${member.id}-relationship`} value={member.relationship} onChange={(e) => update(member.id,{ relationship:e.target.value })}>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{relationshipLabel(r)}</option>)}</select></div>
                <div className="field"><label htmlFor={`fm-${member.id}-dob`}>Date of birth</label><input id={`fm-${member.id}-dob`} type="date" min="1900-01-01" max={today} value={member.date_of_birth ?? ""} onChange={(e) => update(member.id,{ date_of_birth:e.target.value || null })} /></div>
                {sexField ? <div className="field"><label htmlFor={`fm-${member.id}-sex`}>Sex</label><select id={`fm-${member.id}-sex`} value={member.sex ?? ""} onChange={(e) => update(member.id,{ sex:e.target.value || null })}><option value="" disabled>Choose…</option>{SEXES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div> : null}
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

      {/* The people come first: a returning household opens this page to see or change them, and adds someone rarely. */}
      <section className="profile-add-panel" aria-label="Add a family member">
        {family.length ? <h3>Add a family member</h3> : null}
        <form onSubmit={add} className="profile-add-grid">
          <div className="field wide"><label htmlFor="fm-new-name">Full name, as on their policies</label><input id="fm-new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Alex Chen Wei Ming" autoComplete="off" required /></div>
          <div className="field"><label htmlFor="fm-new-relationship">Relationship to you</label><select id="fm-new-relationship" value={relationship} onChange={(e) => setRelationship(e.target.value)} required><option value="" disabled>Choose…</option>{RELATIONSHIPS.map((r) => <option key={r} value={r}>{relationshipLabel(r)}</option>)}</select></div>
          <div className="field"><label htmlFor="fm-new-dob">Date of birth</label><input id="fm-new-dob" type="date" min="1900-01-01" max={today} value={dob} onChange={(e) => setDob(e.target.value)} required /></div>
          {sexField ? <div className="field"><label htmlFor="fm-new-sex">Sex</label><select id="fm-new-sex" value={sex} onChange={(e) => setSex(e.target.value)} required><option value="" disabled>Choose…</option>{SEXES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div> : null}
          <div className="field"><label htmlFor="fm-new-preferred">Preferred name (optional)</label><input id="fm-new-preferred" value={preferred} onChange={(e) => setPreferred(e.target.value)} placeholder="For example, Alex" autoComplete="off" /></div>
          <p className="profile-add-why">The date of birth tells adult cover from child cover, and sex tells &ldquo;my son&rdquo; from &ldquo;my daughter&rdquo; in Ask DearPolicy. What a policy prints always comes first.</p>
          <button className="button primary" type="submit" disabled={!name.trim() || !relationship || !dob || (sexField && !sex)}>+ Add person</button>
        </form>
        {status && <div className="upload-status" role="status">{status}</div>}
      </section>

      <HouseholdAccess />
    </div>
  );
}
