"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPolicyQuarantineHeld, isPolicyScanRejected, policyQuarantineLabel } from "@/lib/policies/quarantine/ui";
import { customerError, customerMessage } from "@/components/customer-text";
import { MAX_UPLOAD_LABEL, uploadPolicyDocument } from "@/components/upload-document";
import type { ReadingDocument } from "@/components/reading-status";

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
/** What a household calls a document: its product, else its file name, never blank. */
function documentName(policy: Pick<Policy, "product_name" | "original_filename">) {
  return policy.product_name?.trim() || policy.original_filename?.trim() || "Untitled document";
}
function roleLabel(role: string | null) { const t = (role ?? "document").replaceAll("_", " "); return t.charAt(0).toUpperCase() + t.slice(1); }
/** "a, b and 2 more": what a document was found to pay for, in a line. */
function foundLine(labels: string[]) {
  const l = labels;
  return l.length <= 3 ? l.join(l.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, " and $1") : `${l.slice(0, 3).join(", ")} and ${l.length - 3} more`;
}
const NOT_FAMILY_KEY = "dearpolicy.notFamily";
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
  // An upload that failed or was refused is shown as an error, never in the
  // same box (and colour) as a successful one.
  const [statusIsError, setStatusIsError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  /** Family's "N documents linked" opens this page as /policies?person=<id>: only that person's documents. */
  const [personId, setPersonId] = useState<string | null>(null);
  useEffect(() => { setPersonId(new URLSearchParams(window.location.search).get("person")); }, []);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const previousActiveCount = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  // Confirmations of actions taken on the library itself (delete, who a
  // document covers, unlocking), shown where the person is looking.
  const [libraryNotice, setLibraryNotice] = useState("");
  /** Names the household said are not in the family. The server remembers this answer and leaves those names out of
   * detected_people; until its table is applied it answers remembered: false, and the answer is then kept on this
   * device only, and the page says so. */
  const [notFamily, setNotFamily] = useState<string[]>([]);
  useEffect(() => { try { setNotFamily(JSON.parse(localStorage.getItem(NOT_FAMILY_KEY) || "[]")); } catch { /* storage unavailable */ } }, []);
  /** The last "Not in my family" answer, so the notice can offer to undo it. */
  const [undoNotFamily, setUndoNotFamily] = useState<{ policyId: string; detectedName: string; notice: string } | null>(null);
  function saveNotFamily(next: string[]) {
    setNotFamily(next);
    try { localStorage.setItem(NOT_FAMILY_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  }
  async function postNotFamily(policyId: string, detectedName: string, notFamily: boolean) {
    const response = await fetch("/api/policies/link-person", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ policyId, detectedName, notFamily }),
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, remembered: payload.remembered === true, error: payload.error as string | undefined };
  }
  /** Returns false when the answer was not taken, so the question stays as it was. */
  async function markNotFamily(policyId: string, detectedName: string): Promise<boolean> {
    try {
      const result = await postNotFamily(policyId, detectedName, true);
      if (result.status === 409) {
        setLibraryNotice(`${detectedName} is already linked to someone in your family. To change who this document covers, use “Change” on the document.`);
        return false;
      }
      if (!result.ok) throw new Error(result.error || "Could not save that answer");
      let notice = `Noted: ${detectedName} is not in your family, so nothing in this document is used for them.`;
      if (!result.remembered) {
        saveNotFamily([...new Set([...notFamily, `${policyId}:${detectedName}`])]);
        notice += " This is remembered on this device only for now, so DearPolicy may ask again elsewhere.";
      }
      setUndoNotFamily({ policyId, detectedName, notice });
      setLibraryNotice(notice);
      if (result.remembered) await refresh();
      return true;
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not save that answer. Please try again in a moment."));
      return false;
    }
  }
  async function undoMarkNotFamily() {
    if (!undoNotFamily) return;
    const { policyId, detectedName } = undoNotFamily;
    try {
      const result = await postNotFamily(policyId, detectedName, false);
      if (!result.ok) throw new Error(result.error || "Could not undo that answer");
      saveNotFamily(notFamily.filter((k) => k !== `${policyId}:${detectedName}`));
      setUndoNotFamily(null);
      setLibraryNotice("");
      await refresh();
    } catch (error) {
      setLibraryNotice(customerError(error, "Could not undo that. Please try again in a moment."));
    }
  }
  const [loaded, setLoaded] = useState(false);
  // Arriving from Family with ?person=, the filtered list is what they came for, so it is brought into view.
  useEffect(() => { if (loaded && personId) document.querySelector("[data-testid=person-filter]")?.scrollIntoView({ block: "start" }); }, [loaded, personId]);
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

  // What each document was found to pay for (Coverage rows by document), and documents whose benefits are still
  // being read, or could not be read, for Coverage (reading.documents). Neither is needed for the page to work.
  const [found, setFound] = useState<Record<string, string[]>>({});
  const [benefitReading, setBenefitReading] = useState<Record<string, ReadingDocument>>({});
  async function refresh() {
    const [f, p] = await Promise.all([
      fetch("/api/family", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()),
    ]);
    void fetch("/api/ledger", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((l: { rows?: { policyId: string | null; eventLabel: string; status: string }[]; reading?: { documents?: ReadingDocument[] } } | null) => {
      if (!l) return;
      const byDoc: Record<string, string[]> = {};
      for (const r of l.rows ?? []) if (r.policyId && r.status !== "rejected" && !(byDoc[r.policyId] ??= []).includes(r.eventLabel)) byDoc[r.policyId].push(r.eventLabel);
      setFound(byDoc);
      setBenefitReading(Object.fromEntries((l.reading?.documents ?? []).map((d) => [d.policyId, d])));
    }).catch(() => undefined);
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
      setStatusIsError(!!failed);
      setStatus(failed ? `Finished. ${failed === 1 ? "One document" : `${failed} documents`} could not be read — see below.` : "Your documents are ready. Your portfolio has been updated.");
    }
    previousActiveCount.current = activeCount;
  }, [activeCount, policies]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setStatusIsError(false);
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
      setStatusIsError(true);
      setStatus(customerError(err, "The upload did not go through. Please try again.").replace(/\s--\s/g, " — "));
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
    const label = documentName(policy);
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
    const label = documentName(policy);
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
    const label = documentName(policy);
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
    const label = documentName(policy);
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

  const forPerson = useMemo(() => policies.filter((p) => !personId || p.linked_people.some((l) => l.id === personId)), [policies, personId]);
  const shown = useMemo(
    () => forPerson.filter((p) => filter === "all" || filter === "personal" && p.personal_coverage_confirmed || filter === "reference" && !p.personal_coverage_confirmed || false),
    [forPerson, filter],
  );
  const counts = {
    personal: forPerson.filter((p) => p.personal_coverage_confirmed).length,
    reference: forPerson.filter((p) => !p.personal_coverage_confirmed).length,
  };


  return <div className="page">
    <header className="page-header compact"><div><div className="eyebrow">INSURANCE LIBRARY</div><h1>Upload whatever your insurer sent you.</h1><p className="lead">Upload any policy, certificate, schedule or summary. DearPolicy reads it and works out who it covers.</p></div></header>


    {pollingPaused && <div className="processing-banner"><div><strong>Still processing in the background.</strong><small> Automatic updates paused after ten minutes — <button className="mini-button" onClick={() => { pollingSince.current = Date.now(); setPollingPaused(false); void refresh(); }}>Check again</button></small></div></div>}
    {activeCount > 0 && !pollingPaused && <div className="processing-banner"><span className="processing-spinner"/><div><strong>DearPolicy is reading your {activeCount === 1 ? "document" : "documents"}</strong><small>This page updates on its own. You can keep using the app.</small></div></div>}


    <section className="upload-panel">
      <form onSubmit={upload} className="upload-form">
        <div className="field"><label htmlFor="up-profile">Who is this for? <span>(optional)</span></label><select id="up-profile" value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Not sure: DearPolicy checks the names</option>{family.map((m) => <option value={m.id} key={m.id}>{m.display_name} · {m.relationship}</option>)}</select></div>
        <div className="field"><label htmlFor="up-file">Insurance document <span>(a PDF, a scan or a photo, up to {MAX_UPLOAD_LABEL})</span></label><input id="up-file" ref={fileInput} type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/tiff,.tif,.tiff,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></div>
        <div className="field"><label htmlFor="up-password">PDF password <span>(if protected)</span></label><input id="up-password" type="password" autoComplete="off" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="Leave blank if not required"/></div>
        <button disabled={busy || !file} className="button primary" type="submit">{busy ? "Uploading…" : "Upload & analyse"}</button>
      </form>
      <div className="note">The password is used only for this processing job and is not stored. Link a reference document, such as a product summary or policy wording, to the people it applies to.</div>
      {status && <div className={`upload-status${statusIsError ? " error" : ""}`} role={statusIsError ? "alert" : "status"}>{statusIsError && !/^Finished/.test(status) && <strong>Not uploaded. </strong>}{status}{/^Your documents are ready/.test(status) && <> <Link className="text-link" href="/chat">Ask anything about them →</Link></>}</div>}
    </section>

    <section className="trust-strip" aria-label="What DearPolicy does with an upload"><div><b>1</b><span><strong>Classify</strong><small>Certificate, schedule, wording, summary, receipt…</small></span></div><div><b>2</b><span><strong>Verify</strong><small>Named people, source page and evidence text</small></span></div><div><b>3</b><span><strong>Organise</strong><small>One upload can cover several family members</small></span></div></section>

    <section className="section">
      <div className="section-heading"><div><div className="eyebrow">DOCUMENTS</div><h2>Your insurance library</h2></div></div>
      <div className="filter-pills"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <b>{forPerson.length}</b></button><button className={filter === "personal" ? "active" : ""} onClick={() => setFilter("personal")}>Personal proof <b>{counts.personal}</b></button><button className={filter === "reference" ? "active" : ""} onClick={() => setFilter("reference")}>Reference <b>{counts.reference}</b></button></div>
      {personId && <p className="document-person-filter" data-testid="person-filter">Showing documents linked to <b>{family.find((m) => m.id === personId)?.display_name ?? "one person"}</b>. <button type="button" className="text-link" onClick={() => { setPersonId(null); window.history.replaceState(null, "", "/policies"); }}>Show all documents</button></p>}

      {libraryNotice && <div className="upload-status library-notice" role="status" data-testid="library-notice">{libraryNotice}{undoNotFamily?.notice === libraryNotice && <button type="button" className="mini-button" onClick={undoMarkNotFamily}>Undo</button>}<button type="button" className="mini-button" onClick={() => { setLibraryNotice(""); setUndoNotFamily(null); }} aria-label="Dismiss">✕</button></div>}
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
        const unmatched = policy.detected_people.filter((p) => !p.matchedFamilyMemberId && !notFamily.includes(`${policy.id}:${p.name}`));
        const referenceLinks = policy.linked_people.filter((p) => p.source === "scheme_reference_match");
        const personalLinks = policy.linked_people.filter((p) => p.source !== "scheme_reference_match");
        const pct = Math.max(0, Math.min(100, Number(policy.processing_progress ?? 0)));
        return <div className={`document-card ${policy.needs_review ? "needs-review" : ""} ${processing ? "processing" : ""}`} key={policy.id} id={`doc-${policy.id}`} data-policy-id={policy.id}>
          <div className="document-head">
            <div className="policy-logo">{(policy.insurer ?? policy.original_filename).slice(0, 2).toUpperCase()}</div>
            <div className="document-title"><strong>{documentName(policy)}</strong>{policy.processing_status === "failed" && !processing ? null : <span>{processing ? "Usually ready in under a minute" : [policy.insurer ?? "Insurer not known yet", roleLabel(policy.document_role), policy.document_authority_label ?? (policy.personal_coverage_confirmed ? "Personal proof" : "Reference")].join(" · ")}</span>}
              {!processing && !quarantineHeld && !scanRejected && <em className={`status ${policy.processing_status}`}>{policy.processing_status === "ready" ? "Ready" : stageLabel(policy.processing_stage, policy.processing_status)}</em>}</div>
          </div>

          {/* Whose it is, then what was found in it: the two things a person checks first. */}
          {!processing && policy.personal_coverage_confirmed && !!personalLinks.length && <p className="document-for"><b>For</b> {personalLinks.map((p) => p.name).join(", ")}</p>}


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
            {/* Names printed in it: matched ones in one quiet line; each unmatched one asks who it is. */}
            {policy.detected_people.some((p) => p.matchedFamilyMemberId) && <p className="document-names">Named in it: {policy.detected_people.filter((p) => p.matchedFamilyMemberId).map((p) => `${p.name} (${family.find((m) => m.id === p.matchedFamilyMemberId)?.display_name ?? "matched"})`).join(", ")}</p>}
            {!!unmatched.length && <div className="detected-block">{unmatched.map((person) => <div className="detected-row" key={person.name}>
              <label htmlFor={`who-${policy.id}-${person.name}`}>&ldquo;{person.name}&rdquo; is named in it. Who is this?</label>
              <select id={`who-${policy.id}-${person.name}`} defaultValue="" onChange={(e) => { const select = e.target; if (select.value === "__not_family") void markNotFamily(policy.id, person.name).then((taken) => { if (!taken) select.value = ""; }); else if (select.value) void linkPerson(policy.id, person.name, select.value); }}><option value="">Choose a family member…</option>{family.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}<option value="__not_family">Not in my family</option></select>
            </div>)}<small className="muted">Until you choose, nothing in it is used for that person.</small></div>}
          </> : !processing && policy.processing_status === "ready" ? <CoversPicker policy={policy} family={family} onSave={(a) => saveCoverage(policy, a)} referenceLinks={referenceLinks.map((p) => p.name)} /> : null}

          {!processing && policy.processing_status === "ready" && (() => {
            const state = benefitReading[policy.id];
            const labels = found[policy.id] ?? [];
            if (state && (state.state === "failed" || state.state === "backed_off")) return <p className="document-found warn" data-testid="document-found">Its benefits couldn&rsquo;t be read for Coverage yet{state.reason ? `: ${state.reason.charAt(0).toLowerCase()}${state.reason.slice(1).replace(/\.?\s*$/, ".")}` : "."}{state.state === "backed_off" && state.retryAfter ? " DearPolicy tries again later on its own." : ""} You can still ask about it.</p>;
            if (state) return <p className="document-found" data-testid="document-found">Reading its benefits for Coverage…</p>;
            if (labels.length) return <p className="document-found" data-testid="document-found"><b>Found</b> {foundLine(labels)}. <Link className="text-link" href="/ledger">See in Coverage →</Link></p>;
            return null;
          })()}
          {!processing && policy.processing_error && (/password/i.test(policy.processing_error)
            ? <LockedPdf policy={policy} onUnlock={(password) => unlock(policy, password)} />
            : <div className="row-error processing-error" data-testid="document-unreadable"><strong>This document could not be read</strong><span>{unreadableReason(policy.processing_error)}</span>{policy.page_count
              ? <small>If you have a clearer copy or the original file, delete this one and upload that instead.</small>
              : <><small>Try reading it again. If it still can’t be read, delete it and upload a clearer copy or the original file.</small><div className="row-error-actions"><button type="button" className="mini-button" disabled={busy || !!deletingId || retryingId === policy.id} onClick={() => void retryReading(policy)}>{retryingId === policy.id ? "Starting…" : "Try reading it again"}</button></div></>}</div>)}

          {/* Its numbers and the actions on it come last. */}
          <div className="document-meta">{policy.policy_number && <span>Policy {policy.policy_number}</span>}{policy.group_policy_number && <span>Group {policy.group_policy_number}</span>}{!processing && policy.processing_status === "ready" && <button className="mini-button" onClick={() => setDetailsId(detailsId === policy.id ? null : policy.id)}>{detailsId === policy.id ? "Hide details" : "Details"}</button>}<button className="mini-button danger" disabled={(processing && !policy.processing_stalled) || busy || !!deletingId} onClick={() => deleteDocument(policy)}>{deletingId === policy.id ? "Deleting…" : confirmDeleteId === policy.id ? "Confirm delete" : "Delete"}</button>{confirmDeleteId === policy.id && <button className="mini-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>}</div>

          {detailsId === policy.id && <PolicyDetailsPanel policyId={policy.id} />}
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
  const [saved, setSaved] = useState(false);
  const current = () => covered.map((p) => ({ familyMemberId: p.id, planTier: p.planTier ?? null }));
  async function save(next: { familyMemberId: string; planTier: string | null }[]) {
    setBusy(true); setError("");
    try { await onSave(next); setSaved(true); }
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
  const [open, setOpen] = useState(covered.length === 0);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(false), 2500); return () => clearTimeout(t); }, [saved]);
  const summary = covered.map((p) => p.planTier ? `${p.name} (${p.planTier})` : p.name).join(", ");
  const planMissing = tiers.length > 0 && covered.some((p) => !p.planTier);
  // Collapsed to one line once someone is linked; opened by "Change", or
  // open from the start when nobody is linked yet (that is the next step).
  if (!open) return <div className="covers-summary" data-testid="covers-picker">
    <span><b>Covers</b> {summary}{planMissing && <small className="covers-plan-missing"> · plan not chosen yet</small>}</span>
    {saved && <span className="covers-saved" role="status">Saved</span>}
    <button type="button" className="mini-button" onClick={() => setOpen(true)} aria-expanded={false}>Change</button>
  </div>;
  return <div className="reference-explainer covers-picker" data-testid="covers-picker"><span className="reference-icon">i</span><div>
    <strong>Who does this document cover?</strong>
    <p>Tap everyone it covers. DearPolicy then uses it when you ask about them.{named.length ? ` It names ${named.map((n) => n.name).join(", ")}.` : ""}</p>
    <div className="declare-owner covers-chips" role="group" aria-label="Family members this document covers">{family.map((m) => {
      const on = covered.some((p) => p.id === m.id);
      return <button key={m.id} type="button" className={`chip-toggle${on ? " on" : ""}`} aria-pressed={on} disabled={busy} onClick={() => { setSaved(false); toggle(m); }}>
        <span className="chip-check" aria-hidden="true">{on ? "\u2713" : ""}</span>{m.display_name}{!on && namedFor(m) ? <small> · named in it</small> : null}
      </button>;
    })}</div>
    {tiers.length > 0 && covered.length > 0 && <div className="covers-list">{covered.map((p) => (
      <div className="covers-row" key={p.id}>
        <label htmlFor={`tier-${policy.id}-${p.id}`}>{p.name}&rsquo;s cover (which plan?)</label>
        <select id={`tier-${policy.id}-${p.id}`} value={p.planTier ?? ""} disabled={busy} onChange={(e) => { setSaved(false); setTier(p.id, e.target.value); }}>
          <option value="">Not sure</option>
          {tiers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    ))}</div>}
    <p className="covers-note">Amounts in it stay the document&rsquo;s own figures until a schedule or statement confirms yours.</p>
    {error && <small role="alert" className="row-error">{error}</small>}
    {referenceLinks.length > 0 && <small>Also available as matching wording for {referenceLinks.join(", ")}.</small>}
    <div className="covers-actions">{covered.length > 0 && <button type="button" className="mini-button" onClick={() => setOpen(false)} disabled={busy}>Done</button>}{busy ? <span className="covers-saved" role="status">Saving…</span> : saved && !error ? <span className="covers-saved" role="status">Saved</span> : null}</div>
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
