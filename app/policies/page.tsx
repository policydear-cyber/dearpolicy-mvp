"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPolicyQuarantineHeld, isPolicyScanRejected, policyQuarantineLabel } from "@/lib/policies/quarantine/ui";
import { customerError, customerMessage } from "@/components/customer-text";
import { MAX_UPLOAD_LABEL, uploadPolicyDocument } from "@/components/upload-document";

/* V1.1: the household library shows what each document is, whose it is and
 * whether it is ready -- never processing stages, page counts, search-index
 * state, raw processing errors or confidence scores. Those, with field
 * corrections, are in the operator area (/operator/documents). Processing
 * failures are retried automatically; a document that stays unreadable gets
 * one plain sentence about what is unavailable, a "Try reading it again"
 * button, and what to do if that fails. */

type Member = { id: string; display_name: string; relationship: string; policy_count: number };
type LinkedPerson = { id: string; name: string; relationship: string; source: string; planTier?: string | null };
type DetectedPerson = { name: string; matchedFamilyMemberId: string | null };
type Policy = {
  id: string;
  insurer: string | null;
  product_name: string | null;
  policy_number: string | null;
  group_policy_number: string | null;
  policy_type: string | null;
  document_role: string | null;
  personal_coverage_confirmed: boolean;
  document_authority: number;
  document_authority_label: string | null;
  needs_review: boolean;
  review_reason: string | null;
  processing_status: string;
  processing_stage: string;
  processing_progress: number;
  processing_message: string | null;
  quarantine_status: string;
  scan_result_detail: string | null;
  original_filename: string;
  page_count: number | null;
  processing_error: string | null;
  processing_stalled?: boolean;
  linked_people: LinkedPerson[];
  detected_people: DetectedPerson[];
  /** Cover tiers the document describes (e.g. Employee / Spouse / Child). */
  tier_options?: string[];
  /** Who the document names, and as which tier. */
  named_tiers?: { name: string; tier: string | null }[];
};
type Filter = "all" | "personal" | "reference";

const ACTIVE_STATUSES = new Set(["queued", "uploaded", "extracting", "indexing"]);
function isProcessing(policy: Policy) { return ACTIVE_STATUSES.has(policy.processing_status); }
const isQuarantineHeld = isPolicyQuarantineHeld;
const isScanRejected = isPolicyScanRejected;
const quarantineLabel = policyQuarantineLabel;
function roleLabel(role: string | null) { return (role ?? "document").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function stageLabel(_stage: string | null, status: string) {
  if (status === "failed") return "Could not be read";
  if (status === "ready") return "Ready";
  return "Reading";
}

export default function PoliciesPage() {
  const [family, setFamily] = useState<Member[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  // "malware_scan" (default) or "not_scanned_prototype" -- reported by the
  // policies API so held documents never show malware-scan language when
  // scanning is intentionally disabled in this prototype build.
  const [documentSafetyMode, setDocumentSafetyMode] = useState<"malware_scan" | "not_scanned_prototype">("malware_scan");
  const [memberId, setMemberId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const previousActiveCount = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Confirmations of actions taken on the library itself (delete, who a
  // document covers, unlocking), shown where the person is looking.
  const [libraryNotice, setLibraryNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  // "Open in Documents" from a chat source lands here with #doc-<id>: once the
  // library has loaded, bring that document into view and outline it.
  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const id = window.location.hash.slice(1);
    if (!id.startsWith("doc-")) return;
    const card = document.getElementById(id);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.classList.add("focused");
    const timer = setTimeout(() => card.classList.remove("focused"), 2400);
    return () => clearTimeout(timer);
  }, [loaded]);

  async function refresh() {
    const [f, p] = await Promise.all([
      fetch("/api/family", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setFamily(f.family ?? []);
    setPolicies(p.policies ?? []);
    setLoaded(true);
    if (p.documentSafetyMode === "not_scanned_prototype" || p.documentSafetyMode === "malware_scan") setDocumentSafetyMode(p.documentSafetyMode);
  }

  useEffect(() => { void refresh(); }, []);

  const activeCount = policies.filter(isProcessing).length;
  // Bounded polling: fast for the first minute, then relaxed, and never
  // infinite -- after ten minutes of continuous activity it stops and asks
  // the person to refresh, instead of hammering the server forever.
  const pollingSince = useRef<number | null>(null);
  const [pollingPaused, setPollingPaused] = useState(false);
  useEffect(() => {
    if (!activeCount) { pollingSince.current = null; setPollingPaused(false); return; }
    pollingSince.current ??= Date.now();
    const elapsed = Date.now() - pollingSince.current;
    if (elapsed > 10 * 60_000) { setPollingPaused(true); return; }
    const timer = window.setInterval(() => { void refresh(); }, elapsed > 60_000 ? 5000 : 1400);
    return () => window.clearInterval(timer);
  }, [activeCount]);

  useEffect(() => {
    if (previousActiveCount.current > 0 && activeCount === 0) {
      const failed = policies.filter((p) => p.processing_status === "failed").length;
      setStatus(failed ? "Finished. One document could not be read — see below." : "Your documents are ready. Your portfolio has been updated.");
    }
    previousActiveCount.current = activeCount;
  }, [activeCount, policies]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setStatus("Uploading document…");
    try {
      // Straight to secure storage (components/upload-document.ts): large
      // scanned booklets never pass through a size-limited server request.
      await uploadPolicyDocument(file, {
        familyMemberId: memberId || null,
        pdfPassword,
        onProgress: (fraction) => setStatus(`Uploading document… ${Math.round(fraction * 100)}%`),
      });
      setStatus("Upload received. DearPolicy is reading it now — you can keep using the app.");
      setFile(null);
      setPdfPassword("");
      if (fileInput.current) fileInput.current.value = "";
      await refresh();
    } catch (err) {
      setStatus(customerError(err, "The upload did not go through. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  /** Reads an unreadable document again from the PDF DearPolicy already
   * kept: nothing is re-uploaded, and it is the same request the locked-PDF
   * form uses, without a password. Offered only when no pages were stored:
   * re-reading a partly stored document rewrites its pages in place, and
   * answers saved from them are not withdrawn (open item C1-3). */
  async function retryReading(policy: Policy) {
    const label = policy.product_name ?? policy.original_filename;
    setRetryingId(policy.id);
    try {
      const response = await fetch("/api/policies/reprocess", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId: policy.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not start reading it again.");
      setLibraryNotice(`Reading ${label} again…`);
      await refresh();
    } catch (err) {
      setLibraryNotice(customerError(err, "Could not start reading it again. Please try later."));
    } finally {
      setRetryingId(null);
    }
  }

  /** Give the password for a locked PDF that is already in the library:
   * it is read again with that password; nothing is re-uploaded. */
  async function unlock(policy: Policy, password: string) {
    const label = policy.product_name ?? policy.original_filename;
    const response = await fetch("/api/policies/reprocess", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyId: policy.id, pdfPassword: password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not read it with that password.");
    setLibraryNotice(`Reading ${label} with the password you entered…`);
    await refresh();
  }

  // Who a document covers: one or several people (a group booklet names
  // the employee, spouse and children), each with the cover tier they hold
  // when the booklet has tiers.
  async function saveCoverage(policy: Policy, assignments: { familyMemberId: string; planTier: string | null }[]) {
    const label = policy.product_name ?? policy.original_filename;
    const response = await fetch("/api/policies/link-person", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyId: policy.id, assignments }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not save that");
    const names = assignments.map((a) => {
      const m = family.find((f) => f.id === a.familyMemberId);
      return m ? `${m.display_name}${a.planTier ? ` (${a.planTier})` : ""}` : null;
    }).filter(Boolean);
    setLibraryNotice(names.length
      ? `Saved — ${label} covers ${names.join(", ")}. Its benefits will now be used in answers for ${names.length === 1 ? "that person" : "each of them"}.`
      : `Saved — ${label} is not linked to anyone.`);
    await refresh();
  }

  async function linkPerson(policyId: string, detectedName: string, familyMemberId: string) {
    try {
      const response = await fetch("/api/policies/link-person", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId, detectedName, familyMemberId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not link person");
      setLibraryNotice(`Linked ${detectedName} to the selected family profile.`);
      await refresh();
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not link that person. Please try again in a moment."));
    }
  }

  async function deleteDocument(policy: Policy) {
    // A document held in quarantine (or rejected by scanning) must still be
    // deletable -- it will otherwise sit at processing_status='queued'
    // (isProcessing()'s raw check) indefinitely, with no other way for the
    // person to remove it. See isQuarantineHeld()/isScanRejected() above.
    if (isProcessing(policy) && !isQuarantineHeld(policy) && !isScanRejected(policy)) return;
    const label = policy.product_name ?? policy.original_filename;
    // A native confirm() blocks the tab's whole event loop until dismissed --
    // an inline arm-then-confirm click (see the Delete button below) avoids
    // that while still requiring a deliberate second click first.
    if (confirmDeleteId !== policy.id) { setConfirmDeleteId(policy.id); return; }
    setConfirmDeleteId(null);
    setDeletingId(policy.id);
    try {
      const response = await fetch(`/api/policies/${policy.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not delete document");
      setLibraryNotice(`Deleted ${label}. It is no longer used in answers, and your portfolio has been updated.`);
      await refresh();
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not delete that document. Please try again in a moment."));
    } finally {
      setDeletingId(null);
    }
  }

  const shown = useMemo(
    () => policies.filter((p) => filter === "all" || filter === "personal" && p.personal_coverage_confirmed || filter === "reference" && !p.personal_coverage_confirmed || false),
    [policies, filter],
  );
  const counts = {
    personal: policies.filter((p) => p.personal_coverage_confirmed).length,
    reference: policies.filter((p) => !p.personal_coverage_confirmed).length,
  };

  return <div className="page">
    <header className="page-header compact"><div><div className="eyebrow">INSURANCE LIBRARY</div><h1>Upload whatever your insurer sent you.</h1><p className="lead">DearPolicy decides what is personal proof, what is legal/reference wording, who is actually insured and which facts are safe to show on the portfolio.</p></div></header>

    <section className="trust-strip"><div><b>1</b><span><strong>Classify</strong><small>Certificate, schedule, wording, summary, receipt…</small></span></div><div><b>2</b><span><strong>Verify</strong><small>Named people, source page and evidence text</small></span></div><div><b>3</b><span><strong>Organise</strong><small>One upload can cover several family members</small></span></div></section>

    {pollingPaused && <div className="processing-banner"><div><strong>Still processing in the background.</strong><small> Automatic updates paused after ten minutes — <button className="mini-button" onClick={() => { pollingSince.current = Date.now(); setPollingPaused(false); void refresh(); }}>Check again</button></small></div></div>}
    {activeCount > 0 && !pollingPaused && <div className="processing-banner"><span className="processing-spinner"/><div><strong>DearPolicy is reading your {activeCount === 1 ? "document" : "documents"}</strong><small>This page updates on its own. You can keep using the app.</small></div></div>}


    <section className="upload-panel">
      <form onSubmit={upload} className="upload-form">
        <div className="field"><label htmlFor="up-profile">Profile hint <span>(optional)</span></label><select id="up-profile" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Not sure — let DearPolicy detect names</option>{family.map((m) => <option value={m.id} key={m.id}>{m.display_name} · {m.relationship}</option>)}</select></div>
        <div className="field"><label htmlFor="up-file">Insurance document <span>(up to {MAX_UPLOAD_LABEL})</span></label><input id="up-file" ref={fileInput} type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/tiff,.tif,.tiff,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></div>
        <div className="field"><label htmlFor="up-password">PDF password <span>(if protected)</span></label><input id="up-password" type="password" autoComplete="off" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="Leave blank if not required"/></div>
        <button disabled={busy || !file} className="button primary" type="submit">{busy ? "Uploading…" : "Upload & analyse"}</button>
      </form>
      <div className="note">The password is used only for this processing job and is not stored. Reference documents do not need to be assigned to a family member.</div>
      {status && <div className="upload-status">{status}</div>}
    </section>

    <section className="section">
      <div className="section-heading"><div><div className="eyebrow">DOCUMENTS</div><h2>Your insurance library</h2></div></div>
      <div className="filter-pills"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <b>{policies.length}</b></button><button className={filter === "personal" ? "active" : ""} onClick={() => setFilter("personal")}>Personal proof <b>{counts.personal}</b></button><button className={filter === "reference" ? "active" : ""} onClick={() => setFilter("reference")}>Reference <b>{counts.reference}</b></button></div>

      {libraryNotice && <div className="upload-status library-notice" role="status" data-testid="library-notice">{libraryNotice}<button type="button" className="mini-button" onClick={() => setLibraryNotice("")} aria-label="Dismiss">✕</button></div>}
      <div className="document-list">{shown.map((policy) => {
        const quarantineHeld = isQuarantineHeld(policy);
        const scanRejected = isScanRejected(policy);
        // A document held in quarantine (or rejected outright) still sits at
        // processing_status='queued' the entire time -- lib/rag/ingest.ts's
        // processPolicy() gate returns before ever touching that column --
        // so it is deliberately excluded from "processing" here. Otherwise
        // the existing "Analysis in progress" bar below and the new
        // quarantine banner would render at the same time and contradict
        // each other.
        const processing = isProcessing(policy) && !quarantineHeld && !scanRejected;
        const unmatched = policy.detected_people.filter((p) => !p.matchedFamilyMemberId);
        const referenceLinks = policy.linked_people.filter((p) => p.source === "scheme_reference_match");
        const personalLinks = policy.linked_people.filter((p) => p.source !== "scheme_reference_match");
        const pct = Math.max(0, Math.min(100, Number(policy.processing_progress ?? 0)));
        return <div className={`document-card ${policy.needs_review ? "needs-review" : ""} ${processing ? "processing" : ""}`} key={policy.id} id={`doc-${policy.id}`} data-policy-id={policy.id}>
          <div className="document-head">
            <div className="policy-logo">{(policy.insurer ?? policy.original_filename).slice(0, 2).toUpperCase()}</div>
            <div className="document-title"><strong>{policy.product_name ?? policy.original_filename}</strong><span>{policy.insurer ?? "Insurer not known yet"} · {processing ? stageLabel(policy.processing_stage, policy.processing_status) : roleLabel(policy.document_role)}</span></div>
            <div className={`document-authority ${processing ? "processing" : policy.personal_coverage_confirmed ? "confirmed" : "reference"}`}>{processing ? "Reading" : policy.document_authority_label ?? (policy.personal_coverage_confirmed ? "Personal proof" : "Reference")}</div>
          </div>

          <div className="document-meta">{policy.policy_number && <span>Policy {policy.policy_number}</span>}{policy.group_policy_number && <span>Group {policy.group_policy_number}</span>}<span className={`status ${policy.processing_status}`}>{stageLabel(policy.processing_stage, policy.processing_status)}</span>{!processing && policy.processing_status === "ready" && <button className="mini-button" onClick={() => setDetailsId(detailsId === policy.id ? null : policy.id)}>{detailsId === policy.id ? "Hide details" : "Details"}</button>}<button className="mini-button danger" disabled={(processing && !policy.processing_stalled) || busy || !!deletingId} onClick={() => deleteDocument(policy)}>{deletingId === policy.id ? "Deleting…" : confirmDeleteId === policy.id ? "Confirm delete" : "Delete"}</button>{confirmDeleteId === policy.id && <button className="mini-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>}</div>

          {detailsId === policy.id && <PolicyDetailsPanel policyId={policy.id} />}

          {(quarantineHeld || scanRejected) && <div className={`accuracy-warning ${scanRejected ? "danger" : ""}`}>
            <b>{scanRejected ? "Rejected" : documentSafetyMode === "not_scanned_prototype" ? "Received" : "Scanning"}</b>
            <span>{quarantineLabel(policy, documentSafetyMode)}{scanRejected ? " — this file will not be analysed or used to answer questions. Delete it and upload the document again." : ""}</span>
          </div>}

          {processing && <div className="document-progress" aria-live="polite">
            <div className="document-progress-copy"><strong>{policy.processing_stalled ? "Taking longer than usual" : "Reading this document…"}</strong></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(4, pct)}%` }}/></div>
            <small>{policy.processing_stalled ? "DearPolicy will keep trying on its own. Nothing is lost, and you do not need to upload it again." : "You can keep using the app while this finishes."}</small>
          </div>}

          {!processing && policy.needs_review && !policy.processing_error && <div className="accuracy-warning"><b>Not fully confirmed</b><span>Some details in this document could not be matched to the page they came from, so DearPolicy does not use them in answers yet.</span></div>}

          {!processing && policy.personal_coverage_confirmed ? <>
            {!!personalLinks.length && <div className="linked-people"><b>Personal coverage linked to</b>{personalLinks.map((p) => <span key={p.id} className="person-tag">{p.name}</span>)}</div>}
            {!!policy.detected_people.length && <div className="detected-block"><b>Named insured people found</b>{policy.detected_people.map((person) => <div className="detected-row" key={person.name}><span>{person.name}</span>{person.matchedFamilyMemberId ? <span className="matched">Matched ✓</span> : <select defaultValue="" onChange={(e) => e.target.value && linkPerson(policy.id, person.name, e.target.value)}><option value="">Match to family profile…</option>{family.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>}</div>)}</div>}
            {!!unmatched.length && <div className="document-warning">{unmatched.length} real name{unmatched.length === 1 ? "" : "s"} from this personalised document still need matching.</div>}
          </> : !processing && policy.processing_status === "ready" ? <CoversPicker policy={policy} family={family} onSave={(a) => saveCoverage(policy, a)} referenceLinks={referenceLinks.map((p) => p.name)} /> : null}

          {!processing && policy.processing_error && (/password/i.test(policy.processing_error)
            ? <LockedPdf policy={policy} onUnlock={(password) => unlock(policy, password)} />
            : <div className="row-error processing-error" data-testid="document-unreadable"><strong>This document could not be read</strong><span>{unreadableReason(policy.processing_error)}</span>{policy.page_count
              ? <small>If you have a clearer copy or the original file, delete this one and upload that instead.</small>
              : <><small>Try reading it again. If it still can’t be read, delete it and upload a clearer copy or the original file.</small><div className="row-error-actions"><button type="button" className="mini-button" disabled={busy || !!deletingId || retryingId === policy.id} onClick={() => void retryReading(policy)}>{retryingId === policy.id ? "Starting…" : "Try reading it again"}</button></div></>}</div>)}
        </div>;
      })}{!shown.length && <div className="empty-card">{!loaded ? "Loading your documents…" : policies.length ? "No documents in this view." : "No documents yet. Upload a policy schedule, certificate, renewal notice or benefits booklet above."}</div>}</div>
    </section>
  </div>;
}

/** The stored reason a document could not be read, in household words. The
 * stored messages name the operator's "Re-analyse" button; the household's
 * card offers "Try reading it again" instead. */
function unreadableReason(error: string | null): string {
  return customerMessage(error, "Its benefits and amounts are not available for answers.")
    .replace(/;?\s*use Re-analyse to try again\.?/i, ".")
    .replace(/\.\.$/, ".");
}

/** A locked PDF already in the library: enter its password here and it is
 * read again -- no delete, no re-upload. Says plainly whether a password
 * was missing or did not work. */
function LockedPdf({ policy, onUnlock }: { policy: Policy; onUnlock: (password: string) => Promise<void> }) {
  const wrong = /incorrect|did not work|didn.t work|wrong/i.test(policy.processing_error ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = `unlock-${policy.id}`;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) { setError("Enter the PDF's password."); return; }
    setBusy(true); setError("");
    try { await onUnlock(password); setPassword(""); }
    catch (err) { setError(customerError(err, "Could not read it with that password. Please try again.")); }
    finally { setBusy(false); }
  }
  return <div className="row-error processing-error locked-pdf" data-testid="document-locked">
    <strong>{wrong ? "The password didn’t work" : "This PDF is password-protected"}</strong>
    <span>{wrong ? "DearPolicy tried the password you gave, but the PDF did not open. Check it (passwords are case-sensitive) and try again." : "Enter the password your insurer gave you for this PDF and DearPolicy will read it."}</span>
    <form onSubmit={submit} className="unlock-form">
      <label htmlFor={id}>PDF password</label>
      <input id={id} type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="mini-button" disabled={busy}>{busy ? "Reading…" : wrong ? "Try again" : "Unlock and read"}</button>
    </form>
    {error && <small role="alert">{error}</small>}
    <small>The password is used only to read this document and is not stored.</small>
  </div>;
}

/** Who a document covers. A booklet can cover several people (employee,
 * spouse, children): each family member is a toggle -- press everyone it
 * covers -- and, when the booklet has cover tiers, each covered person gets
 * a tier. Every change is saved at once and confirmed. People the booklet
 * names are pointed out. */
function CoversPicker({ policy, family, onSave, referenceLinks }: { policy: Policy; family: Member[]; onSave: (assignments: { familyMemberId: string; planTier: string | null }[]) => Promise<void>; referenceLinks: string[] }) {
  const tiers = policy.tier_options ?? [];
  const named = policy.named_tiers ?? [];
  const namedFor = (m: Member) => named.find((n) => {
    const a = n.name.toLowerCase(), b = m.display_name.toLowerCase();
    return a === b || a.includes(b) || b.includes(a);
  });
  const covered = policy.linked_people.filter((p) => p.source !== "scheme_reference_match");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = () => covered.map((p) => ({ familyMemberId: p.id, planTier: p.planTier ?? null }));
  async function save(next: { familyMemberId: string; planTier: string | null }[]) {
    setBusy(true); setError("");
    try { await onSave(next); }
    catch (err) { setError(customerError(err, "Could not save that. Please try again in a moment.")); }
    finally { setBusy(false); }
  }
  function toggle(m: Member) {
    const on = covered.some((p) => p.id === m.id);
    const next = on ? current().filter((a) => a.familyMemberId !== m.id)
      : [...current(), { familyMemberId: m.id, planTier: namedFor(m)?.tier ?? null }];
    void save(next);
  }
  function setTier(memberId: string, tier: string) {
    void save(current().map((a) => a.familyMemberId === memberId ? { ...a, planTier: tier || null } : a));
  }
  return <div className="reference-explainer covers-picker" data-testid="covers-picker"><span className="reference-icon">i</span><div>
    <strong>Who does this document cover?</strong>
    <p>{named.length ? `It names ${named.map((n) => n.name).join(", ")}. ` : ""}Press everyone in your family it covers{tiers.length ? ", then choose the cover each person has" : ""} — one person or several. DearPolicy then uses its benefits when answering questions about them. Amounts printed here stay the document&rsquo;s own figures until a schedule or statement confirms yours.</p>
    <div className="declare-owner" role="group" aria-label="Family members this document covers">{family.map((m) => {
      const on = covered.some((p) => p.id === m.id);
      return <button key={m.id} type="button" className={`button ${on ? "primary" : "secondary"}`} aria-pressed={on} disabled={busy} onClick={() => toggle(m)}>
        {on ? `${m.display_name} \u2713` : m.display_name}{!on && namedFor(m) ? " · named" : ""}
      </button>;
    })}</div>
    {tiers.length > 0 && covered.length > 0 && <div className="covers-list">{covered.map((p) => (
      <div className="covers-row" key={p.id}>
        <label htmlFor={`tier-${policy.id}-${p.id}`}>{p.name}&rsquo;s cover</label>
        <select id={`tier-${policy.id}-${p.id}`} value={p.planTier ?? ""} disabled={busy} onChange={(e) => setTier(p.id, e.target.value)}>
          <option value="">Choose…</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    ))}</div>}
    {error && <small role="alert" className="row-error">{error}</small>}
    {referenceLinks.length > 0 && <small>Also available as matching wording for {referenceLinks.join(", ")}.</small>}
  </div></div>;
}

type PolicyDetailsPayload = {
  document: Record<string, unknown> & { needsReview?: boolean; reviewReason?: string | null };
  linkedMembers: { id: string; display_name: string; source: string; confidence: number | string | null }[];
  detectedPeople: { detected_name: string; matched_family_member_id: string | null; confidence: number | string | null }[];
  coverages: { category: string; amount: number | string | null; currency: string | null; product_name: string | null; source_page: number | null; evidence_text: string | null; evidence_verified: boolean; member_name: string }[];
  referenceCoverages: { category: string; product_name: string | null; source_page: number | null }[];
  premiums: { amount: number | string | null; currency: string | null; frequency: string | null; payment_date: string | null; source_page: number | null }[];
  extracted: { documentType: string | null; documentNotes: string[]; productsMentioned: string[]; keyExclusions: string[]; waitingPeriods: string[]; deductiblesAndCoinsurance: string[]; riders: string[]; premium: { amount: number | null; currency: string | null; frequency: string | null } | null };
  corrections: { field_name: string; corrected_value: unknown; created_at: string }[];
};

/** How an extracted amount is shown on the review screen: with its currency
 * when the document stated one, otherwise honestly without one -- a missing
 * currency is never rendered as SGD. */
function reviewAmount(amount: number | string | null, currency: string | null): string {
  if (amount == null) return "—";
  const numeric = Number(amount);
  return currency ? `${currency} ${numeric.toLocaleString()}` : `${numeric.toLocaleString()} (currency not stated)`;
}
const showValue = (value: unknown) => (value == null || value === "" ? "Not stated in this document" : String(value));

/** What one document establishes, for the household: its identity, whose it
 * is, the cover it confirms (with page and whether the amount was checked
 * against that page) and its conditions. Extraction internals -- confidence
 * scores, stored page counts, field corrections -- are operator-only
 * (/operator/documents). */
function PolicyDetailsPanel({ policyId }: { policyId: string; onCorrected?: () => void }) {
  const [data, setData] = useState<PolicyDetailsPayload | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/policies/${policyId}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error);
      setData(payload);
    } catch (err) { setError(customerError(err, "The details of this document could not be loaded. Please try again.")); }
  }, [policyId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="detail-panel"><span className="row-error">{error}</span></div>;
  if (!data) return <div className="detail-panel">Loading…</div>;
  const d = data.document as Record<string, string | number | boolean | null>;
  const conditions = [...data.extracted.waitingPeriods, ...data.extracted.keyExclusions, ...data.extracted.deductiblesAndCoinsurance];
  return (
    <div className="detail-panel" data-testid="policy-details">
      <div className="detail-grid">
        <div><label>Insurer</label><span data-testid="detail-insurer">{showValue(d.insurer)}</span></div>
        <div><label>Product</label><span data-testid="detail-product">{showValue(d.productName)}</span></div>
        <div><label>Policy number</label><span data-testid="detail-policy-number">{showValue(d.policyNumber)}</span></div>
        <div><label>Effective date</label><span>{showValue(d.effectiveDate)}</span></div>
        <div><label>Expiry / renewal</label><span data-testid="detail-expiry">{showValue(d.renewalOrExpiryDate)}</span></div>
        <div><label>What it is</label><span>{showValue(d.authorityLabel ?? d.documentRole)}</span></div>
      </div>
      {!!data.linkedMembers.length && <div className="detail-section"><b>Whose cover</b>{[...new Map(data.linkedMembers.map((m) => [m.id, m] as const)).values()].map((m) => <div key={m.id}>{m.display_name}</div>)}</div>}
      {!!data.coverages.length && <div className="detail-section"><b>Cover this document confirms</b>{data.coverages.map((c, i) => <div key={i} data-testid="detail-coverage">{c.member_name}: {c.category} · {reviewAmount(c.amount, c.currency)}{c.source_page ? <small> · page {c.source_page}</small> : null}{c.evidence_verified ? <small className="matched"> · source-verified</small> : <small className="muted"> · amount not yet confirmed against the page</small>}</div>)}</div>}
      {!!data.referenceCoverages.length && <div className="detail-section"><b>Benefits it describes</b>{data.referenceCoverages.map((c, i) => <div key={i}>{c.category}{c.product_name ? ` · ${c.product_name}` : ""}{c.source_page ? <small> · page {c.source_page}</small> : null}</div>)}</div>}
      {!!data.premiums.length && <div className="detail-section"><b>Premiums</b>{data.premiums.map((p, i) => <div key={i}>{reviewAmount(p.amount, p.currency)}{p.frequency ? ` · ${p.frequency}` : ""}{p.payment_date ? ` · ${p.payment_date}` : ""}{p.source_page ? <small> · page {p.source_page}</small> : null}</div>)}</div>}
      {!!data.extracted.riders.length && <div className="detail-section"><b>Riders</b>{data.extracted.riders.map((w, i) => <div key={i}>{w}</div>)}</div>}
      {!!conditions.length && <details className="detail-section source-details"><summary>Waiting periods, exclusions and deductibles</summary>{conditions.map((w, i) => <div key={i}>{w}</div>)}</details>}
    </div>
  );
}
