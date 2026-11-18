"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { customerError } from "@/components/customer-text";
import { uploadPolicyDocument } from "@/components/upload-document";
import { documentReadLabel } from "@/lib/documents/upload-problems";
import { folderSuggestions, folderTitle, SLOT_HINTS, SLOT_LABELS, type FolderDoc, type FolderSuggestion, type FolderView } from "@/lib/policies/folder-view";
import type { FolderSlot } from "@/lib/policies/folders";

/* Policy folders on the Documents page (sql/policy-folders.sql, app/api/policies/folders). The household puts the documents
 * of one policy into one folder: who it is for, its schedule or certificate, its wording, its riders and anything else, and
 * then answers "Are these all the documents for this policy?". Each policy shows as a folder with Add a document and Remove.
 * Nothing is guessed: a shared policy number only offers "Make these one policy?". Only the household's owner changes
 * folders; a member sees them. Until the folders table exists this shows nothing at all. */

export type FolderPageDoc = FolderDoc & {
  original_filename: string;
  document_role: string | null;
  processing_status: string;
  processing_message: string | null;
};
type Member = { id: string; display_name: string; relationship: string };
type Props = {
  documents: FolderPageDoc[];
  family: Member[];
  name: (doc: FolderPageDoc) => string;
  /** Called after anything changes the library (an upload), so the page reloads its documents. */
  onLibraryChanged: () => Promise<void> | void;
  /** The folders, for the page's "In policy" line on each document. */
  onFolders?: (folders: FolderView[], title: (f: FolderView) => string) => void;
};
const SLOTS: FolderSlot[] = ["schedule", "wording", "rider", "other"];
/** What a document in a folder is: the slot the household put it in, else its kind as read, else "Document". */
function kindLabel(slot: FolderSlot | null, doc: FolderPageDoc | undefined) {
  if (slot) return SLOT_LABELS[slot];
  const role = doc?.document_role;
  if (role === "personal_schedule" || role === "schedule") return "Policy schedule";
  if (!role || role === "unknown") return "Document";
  const t = role.replaceAll("_", " "); return t.charAt(0).toUpperCase() + t.slice(1);
}
/** A document's name, with its file name when the two differ, so two copies of one product can be told apart. */
function withFile(doc: FolderPageDoc, name: (d: FolderPageDoc) => string) {
  const n = name(doc), file = doc.original_filename?.trim();
  return file && file !== n ? `${n} · ${file}` : n;
}
const ACCEPT = "application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/tiff,.tif,.tiff,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx";

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "That didn't save.");
  return payload;
}

/** Uploads files one at a time; returns the documents made and the names of any that did not upload. */
async function uploadAll(files: { file: File; slot: FolderSlot }[], memberId: string | null, progress: (text: string) => void) {
  const made: { policyId: string; slot: FolderSlot }[] = [];
  const failed: string[] = [];
  for (const [i, { file, slot }] of files.entries()) {
    progress(files.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${files.length}…`);
    try {
      const { policyId } = await uploadPolicyDocument(file, { familyMemberId: memberId });
      made.push({ policyId, slot });
    } catch (error) {
      failed.push(`${file.name} (${customerError(error, "the upload did not go through").replace(/\.$/, "")})`);
    }
  }
  return { made, failed };
}

export function PolicyFolders({ documents, family, name, onLibraryChanged, onFolders }: Props) {
  const [ready, setReady] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [folders, setFolders] = useState<FolderView[]>([]);
  const [creating, setCreating] = useState<{ people: string[]; existing: string[] } | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const docs = useMemo(() => new Map(documents.map((d) => [d.id, d])), [documents]);
  const title = useCallback((f: FolderView) => folderTitle(f, docs), [docs]);

  const load = useCallback(async () => {
    const r = await fetch("/api/policies/folders", { cache: "no-store" }).then((x) => x.ok ? x.json() : null).catch(() => null) as { ready?: boolean; canManage?: boolean; folders?: FolderView[] } | null;
    setReady(r?.ready === true);
    setCanManage(r?.canManage === true);
    setFolders(r?.folders ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { onFolders?.(folders, title); }, [folders, title, onFolders]);

  const suggestions = useMemo(() => folderSuggestions(documents, folders), [documents, folders]);
  if (!ready) return null;

  const changed = async (text: string, error = false) => { setNotice({ text, error }); await load(); };
  const startFrom = (s?: FolderSuggestion) => { setNotice(null); setCreating({ people: s?.personIds ?? (family.length === 1 ? [family[0].id] : []), existing: s?.policyIds ?? [] }); };

  return <section className="section policy-folders" data-testid="policy-folders">
    <div className="section-heading">
      <div className="icon-heading"><span className="title-icon"><Icon name="folder"/></span><h2>Your policies</h2></div>
      {canManage && !creating && <button type="button" className="button primary" onClick={() => startFrom()} data-testid="create-policy"><Icon name="plus"/> Create a policy</button>}
    </div>
    {!canManage && <p className="muted" data-testid="owner-only-note">Only the household owner can change policies.</p>}
    {notice && <div className={`upload-status${notice.error ? " error" : ""}`} role={notice.error ? "alert" : "status"} data-testid="folder-notice">{notice.text}<button type="button" className="mini-button" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button></div>}

    {creating && <CreatePolicy family={family} documents={documents} name={name} folders={folders} title={title} initial={creating}
      onCancel={() => setCreating(null)}
      onDone={async (text, error) => { setCreating(null); await onLibraryChanged(); await changed(text, error); }} />}

    {canManage && !creating && suggestions.map((s) => <div className="folder-suggestion" key={s.policyIds.join()} data-testid="folder-suggestion">
      <span>{s.policyIds.length} documents print policy number {s.policyNumber}. Make them one policy?</span>
      <button type="button" className="mini-button" onClick={() => startFrom(s)}>Make one policy</button>
    </div>)}

    {!folders.length && !creating && <p className="muted" data-testid="no-policies">{canManage ? "No policies yet. Create one to keep its schedule, wording and riders together." : "No policies yet."}</p>}

    <div className="folder-list">{folders.map((f) => <Folder key={f.id} folder={f} title={title(f)} allFolders={folders} titleOf={title} docs={docs} documents={documents} family={family} name={name}
      canManage={canManage} onChanged={changed} onLibraryChanged={onLibraryChanged} />)}</div>
  </section>;
}

function DocLine({ doc, name }: { doc: FolderPageDoc | undefined; name: (d: FolderPageDoc) => string }) {
  if (!doc) return <span className="muted">A document no longer on file</span>;
  const read = documentReadLabel(doc);
  return <><a className="text-link" href={`#doc-${doc.id}`}>{withFile(doc, name)}</a>{read.tone !== "ready" && <small className={`folder-doc-state ${read.tone}`}> · {read.tone === "reading" ? "Reading…" : read.label}</small>}</>;
}

function Folder({ folder, title, allFolders, titleOf, docs, documents, family, name, canManage, onChanged, onLibraryChanged }: {
  folder: FolderView; title: string; allFolders: FolderView[]; titleOf: (f: FolderView) => string; docs: Map<string, FolderPageDoc>; documents: FolderPageDoc[]; family: Member[]; name: (d: FolderPageDoc) => string;
  canManage: boolean; onChanged: (text: string, error?: boolean) => Promise<void>; onLibraryChanged: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const patch = async (body: unknown, done: string) => {
    setBusy(true);
    try { await send(`/api/policies/folders/${folder.id}`, "PATCH", body); await onChanged(done); }
    catch (e) { await onChanged(customerError(e, "That didn't save. Please try again."), true); }
    finally { setBusy(false); setArmed(null); }
  };
  const remove = async () => {
    setBusy(true);
    try { await send(`/api/policies/folders/${folder.id}`, "DELETE"); await onChanged(`Deleted the folder for ${title}. Its documents are still on file.`); }
    catch (e) { await onChanged(customerError(e, "That didn't delete. Please try again."), true); }
    finally { setBusy(false); setArmed(null); }
  };
  const forWhom = folder.people.map((p) => p.name).join(", ");
  return <div className={`document-card policy-folder${folder.complete ? "" : " unfinished"}`} data-testid="policy-folder" data-folder-id={folder.id}>
    <div className="document-head">
      <div className="policy-logo"><Icon name="folder"/></div>
      <div className="document-title"><strong>{title}</strong><span>{forWhom ? `For ${forWhom}` : "Not linked to anyone yet"}</span></div>
      <em className={`status ${folder.complete ? "ready" : "partial"}`} data-testid="folder-status">{folder.complete ? <><Icon name="check"/> All documents added</> : "Not finished"}</em>
    </div>
    {folder.documents.length ? <ul className="folder-docs">{folder.documents.map((d) => <li key={d.policyId} data-testid="folder-document">
      <span className="folder-doc-kind">{kindLabel(d.slot, docs.get(d.policyId))}</span>
      <span className="folder-doc-name"><DocLine doc={docs.get(d.policyId)} name={name}/></span>
      {canManage && (armed === d.policyId
        ? <span className="folder-doc-actions"><button type="button" className="mini-button danger" disabled={busy} onClick={() => void patch({ remove: [d.policyId] }, `Removed it from ${title}. It is still on file.`)}>Remove from this policy</button><button type="button" className="mini-button" onClick={() => setArmed(null)}>Keep</button></span>
        : <button type="button" className="mini-button" disabled={busy} onClick={() => setArmed(d.policyId)}>Remove</button>)}
    </li>)}</ul> : <p className="muted" data-testid="folder-empty">No documents in it yet.</p>}

    {canManage && !folder.complete && folder.documents.length > 0 && !adding && <div className="folder-confirm" data-testid="folder-confirm">
      <span>Are these all the documents for this policy?</span>
      <button type="button" className="mini-button" disabled={busy} onClick={() => void patch({ complete: true }, `Saved. ${title} has all its documents.`)}>Yes</button>
      <button type="button" className="mini-button" disabled={busy} onClick={() => setAdding(true)}>No, add more</button>
    </div>}

    {canManage && adding && <AddDocuments folder={folder} folders={allFolders} title={titleOf} documents={documents} family={family} name={name} onCancel={() => setAdding(false)}
      onDone={async (text, error) => { setAdding(false); await onLibraryChanged(); await onChanged(text, error); }} />}

    {canManage && !adding && <div className="folder-actions">
      <button type="button" className="mini-button" disabled={busy} onClick={() => setAdding(true)} data-testid="folder-add"><Icon name="plus"/> Add a document</button>
      {armed === "__folder"
        ? <><button type="button" className="mini-button danger" disabled={busy} onClick={() => void remove()}>Delete folder, keep documents</button><button type="button" className="mini-button" onClick={() => setArmed(null)}>Keep</button></>
        : <button type="button" className="mini-button" disabled={busy} onClick={() => setArmed("__folder")}>Delete folder</button>}
    </div>}
  </div>;
}

/** Files chosen per slot, and documents already on file. */
function useChoice(initialExisting: string[] = []) {
  const [files, setFiles] = useState<Record<FolderSlot, File[]>>({ schedule: [], wording: [], rider: [], other: [] });
  const [existing, setExisting] = useState<string[]>(initialExisting);
  const chosen = SLOTS.flatMap((slot) => files[slot].map((file) => ({ file, slot })));
  return { files, setFiles, existing, setExisting, chosen, count: chosen.length + existing.length };
}

function SlotPicker({ slot, files, onChange }: { slot: FolderSlot; files: File[]; onChange: (f: File[]) => void }) {
  const id = `slot-${slot}-${useId()}`;
  return <div className="field folder-slot">
    <label htmlFor={id}>{SLOT_LABELS[slot]} <span>{SLOT_HINTS[slot]}</span></label>
    <input id={id} type="file" multiple accept={ACCEPT} data-testid={`slot-${slot}`} onChange={(e) => onChange([...files, ...Array.from(e.target.files ?? [])])}/>
    {!!files.length && <ul className="folder-chosen">{files.map((f, i) => <li key={`${f.name}-${i}`}>{f.name}<button type="button" className="mini-button" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>✕</button></li>)}</ul>}
  </div>;
}

function OnFile({ documents, skip, chosen, onChange, name, folders, title }: { documents: FolderPageDoc[]; skip: Set<string>; chosen: string[]; onChange: (ids: string[]) => void; name: (d: FolderPageDoc) => string; folders?: FolderView[]; title?: (f: FolderView) => string }) {
  const list = documents.filter((d) => !skip.has(d.id));
  if (!list.length) return null;
  return <fieldset className="field folder-onfile" data-testid="folder-onfile">
    <legend>Already on file</legend>
    {list.map((d) => {
      const inFolders = (folders ?? []).filter((f) => f.documents.some((x) => x.policyId === d.id));
      return <label key={d.id} className="folder-check"><input type="checkbox" checked={chosen.includes(d.id)} onChange={(e) => onChange(e.target.checked ? [...chosen, d.id] : chosen.filter((x) => x !== d.id))}/>
        <span>{withFile(d, name)}{inFolders.length && title ? <small className="muted"> · in {inFolders.map(title).join(", ")}</small> : null}</span></label>;
    })}
  </fieldset>;
}

function CreatePolicy({ family, documents, name, folders, title, initial, onCancel, onDone }: {
  family: Member[]; documents: FolderPageDoc[]; name: (d: FolderPageDoc) => string; folders: FolderView[]; title: (f: FolderView) => string;
  initial: { people: string[]; existing: string[] }; onCancel: () => void; onDone: (text: string, error?: boolean) => Promise<void>;
}) {
  const [people, setPeople] = useState<string[]>(initial.people);
  const choice = useChoice(initial.existing);
  const [errors, setErrors] = useState<{ people?: string; documents?: string }>({});
  const [progress, setProgress] = useState("");
  const busy = !!progress;

  async function save(complete: boolean) {
    const next = { people: people.length ? undefined : "Required", documents: complete && !choice.count ? "Add at least one document" : undefined };
    setErrors(next);
    if (next.people || next.documents) return;
    const { made, failed } = await uploadAll(choice.chosen, people.length === 1 ? people[0] : null, setProgress);
    setProgress("Saving…");
    try {
      await send("/api/policies/folders", "POST", { people, complete: complete && !failed.length,
        documents: [...choice.existing.map((policyId) => ({ policyId })), ...made] });
      const lost = failed.length ? ` ${failed.join(", ")} didn't upload. Use Add a document to try again.` : "";
      await onDone(`Saved the policy.${made.length ? " DearPolicy is reading its new documents now." : ""}${lost}`, failed.length > 0);
    } catch (e) {
      setProgress("");
      await onDone(customerError(e, "The policy didn't save. Your documents are on file. Please try again.") + (made.length ? " The documents that uploaded are on file." : ""), true);
    }
  }

  return <div className="upload-panel folder-create" data-testid="create-policy-form">
    <h3>Create a policy</h3>
    <fieldset className="field" aria-describedby={errors.people ? "folder-people-error" : undefined}>
      <legend>Who is this policy for?</legend>
      {family.map((m) => <label key={m.id} className="folder-check"><input type="checkbox" checked={people.includes(m.id)} onChange={(e) => setPeople(e.target.checked ? [...people, m.id] : people.filter((x) => x !== m.id))}/><span>{m.display_name}</span></label>)}
      {errors.people && <small className="error" id="folder-people-error">{errors.people}</small>}
    </fieldset>
    {SLOTS.map((slot) => <SlotPicker key={slot} slot={slot} files={choice.files[slot]} onChange={(f) => choice.setFiles({ ...choice.files, [slot]: f })}/>)}
    <OnFile documents={documents} skip={new Set()} chosen={choice.existing} onChange={choice.setExisting} name={name} folders={folders} title={title}/>
    {errors.documents && <small className="error" role="alert">{errors.documents}</small>}
    <div className="folder-confirm final">
      <span>Are these all the documents for this policy?</span>
      <button type="button" className="button primary" disabled={busy} onClick={() => void save(true)} data-testid="create-yes">Yes, save</button>
      <button type="button" className="button" disabled={busy} onClick={() => void save(false)} data-testid="create-not-yet">Not yet, save for now</button>
      <button type="button" className="mini-button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
    {progress && <div className="upload-status" role="status">{progress}</div>}
  </div>;
}

function AddDocuments({ folder, folders, title, documents, family, name, onCancel, onDone }: {
  folder: FolderView; folders: FolderView[]; title: (f: FolderView) => string; documents: FolderPageDoc[]; family: Member[]; name: (d: FolderPageDoc) => string; onCancel: () => void; onDone: (text: string, error?: boolean) => Promise<void>;
}) {
  const [slot, setSlot] = useState<FolderSlot>("other");
  const choice = useChoice();
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const people = folder.people.map((p) => p.id).filter((id) => family.some((m) => m.id === id));
  async function add() {
    if (!choice.count) { setError("Choose a document"); return; }
    setError("");
    const { made, failed } = await uploadAll(choice.chosen, people.length === 1 ? people[0] : null, setProgress);
    setProgress("Saving…");
    try {
      if (made.length || choice.existing.length) await send(`/api/policies/folders/${folder.id}`, "PATCH", { add: [...choice.existing.map((policyId) => ({ policyId })), ...made] });
      await onDone(`Added.${made.length ? " DearPolicy is reading it now." : ""}${failed.length ? ` ${failed.join(", ")} didn't upload. Please try again.` : ""}`, failed.length > 0);
    } catch (e) {
      setProgress("");
      await onDone(customerError(e, "That didn't save. Please try again."), true);
    }
  }
  const inFolder = new Set(folder.documents.map((d) => d.policyId));
  return <div className="folder-add" data-testid="folder-add-form">
    <div className="field"><label htmlFor={`kind-${folder.id}`}>What is it?</label>
      <select id={`kind-${folder.id}`} value={slot} onChange={(e) => { const s = e.target.value as FolderSlot; choice.setFiles({ schedule: [], wording: [], rider: [], other: [], [s]: SLOTS.flatMap((k) => choice.files[k]) }); setSlot(s); }}>
        {SLOTS.map((s) => <option key={s} value={s}>{SLOT_LABELS[s]}</option>)}
      </select></div>
    <SlotPicker slot={slot} files={choice.files[slot]} onChange={(f) => choice.setFiles({ ...choice.files, [slot]: f })}/>
    <OnFile documents={documents} skip={inFolder} chosen={choice.existing} onChange={choice.setExisting} name={name} folders={folders} title={title}/>
    {error && <small className="error" role="alert">{error}</small>}
    <div className="folder-actions">
      <button type="button" className="button primary" disabled={!!progress} onClick={() => void add()} data-testid="folder-add-save">Add</button>
      <button type="button" className="mini-button" disabled={!!progress} onClick={onCancel}>Cancel</button>
    </div>
    {progress && <div className="upload-status" role="status">{progress}</div>}
  </div>;
}
