"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isPolicyQuarantineHeld, isPolicyScanRejected, policyQuarantineLabel } from "@/lib/policies/quarantine/ui";

type Member = { id: string; display_name: string; relationship: string; policy_count: number };
type LinkedPerson = { id: string; name: string; relationship: string; source: string };
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
};
type Filter = "all" | "personal" | "reference" | "review";

const ACTIVE_STATUSES = new Set(["queued", "uploaded", "extracting", "indexing"]);
function isProcessing(policy: Policy) { return ACTIVE_STATUSES.has(policy.processing_status); }
const isQuarantineHeld = isPolicyQuarantineHeld;
const isScanRejected = isPolicyScanRejected;
const quarantineLabel = policyQuarantineLabel;
function roleLabel(role: string | null) { return (role ?? "document").replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()); }
function stageLabel(stage: string | null, status: string) {
  if (status === "failed") return "Analysis stopped";
  if (status === "ready") return "Ready";
  const value = stage || status || "queued";
  return value.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
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
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const previousActiveCount = useRef(0);
  const [searchIndex, setSearchIndex] = useState<{ enabled: boolean; total: number; indexed: number; pending: number } | null>(null);
  const [indexing, setIndexing] = useState(false);

  async function refresh() {
    const [f, p] = await Promise.all([
      fetch("/api/family", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setFamily(f.family ?? []);
    setPolicies(p.policies ?? []);
    if (p.documentSafetyMode === "not_scanned_prototype" || p.documentSafetyMode === "malware_scan") setDocumentSafetyMode(p.documentSafetyMode);
    // Semantic search is a separate store from the database, so a document can
    // be fully analysed and still be invisible to it -- every document read
    // before Pinecone was connected is. Ask, rather than assume.
    const search = await fetch("/api/policies/reindex", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    setSearchIndex(search && typeof search.pending === "number" ? search : null);
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
      setStatus(failed ? "Processing finished. A document needs attention below." : "Analysis complete. Your insurance library and portfolio have been updated.");
    }
    previousActiveCount.current = activeCount;
  }, [activeCount, policies]);

  async function upload(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    // The server enforces the same limit, but an oversized body can be cut
    // off by the platform before it ever reaches the route (leaving only a
    // generic network failure), so the useful message has to come from here.
    if (file.size > 50 * 1024 * 1024) {
      setStatus("Files must be 50 MB or smaller. Split the document or export it at a lower resolution, then upload it again.");
      return;
    }
    setBusy(true);
    setStatus("Uploading document…");
    try {
      const form = new FormData();
      form.set("file", file);
      if (memberId) form.set("familyMemberId", memberId);
      if (pdfPassword) form.set("pdfPassword", pdfPassword);
      const response = await fetch("/api/policies/upload", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}) as { error?: string });
      // The backend already returns a specific, actionable reason (e.g. "Create
      // at least one family profile before uploading documents.", "This exact
      // document is already in DearPolicy...", the 50MB limit). Discarding it
      // for a generic "Upload failed" hid exactly the information a person
      // needs to fix the problem themselves.
      if (!response.ok) throw new Error(payload.error || "Upload failed");
      setStatus("Upload received. DearPolicy is analysing it in the background; live progress appears below.");
      setFile(null);
      setPdfPassword("");
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function reprocess(policy: Policy) {
    if (isProcessing(policy)) return;
    setReprocessingId(policy.id);
    setStatus(`Queued ${policy.product_name ?? policy.original_filename} for re-analysis.`);
    try {
      const response = await fetch("/api/policies/reprocess", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId: policy.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Re-analysis failed");
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Re-analysis failed. Password-protected PDFs should be uploaded again with the password.");
    } finally {
      setReprocessingId(null);
    }
  }

  // Uploading your own welcome booklet says you hold that cover. Asking who it
  // belongs to is the one question the document itself cannot answer.
  async function declareOwner(policyId: string, familyMemberId: string) {
    const who = family.find((m) => m.id === familyMemberId)?.display_name ?? "that profile";
    try {
      const response = await fetch("/api/policies/link-person", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId, familyMemberId, declared: true }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save that");
      setStatus(`Saved — this policy is ${who}'s. Its benefits will now be used in answers. Upload a schedule or statement when you have one to confirm the amounts.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save that. Please try again in a moment.");
    }
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
      setStatus(`Linked ${detectedName} to the selected family profile.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not link person. Please try again in a moment.");
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
      setStatus(`${label} was deleted. The portfolio has been recalculated.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete document");
    } finally {
      setDeletingId(null);
    }
  }

  // No model is called and nothing already extracted is touched: this only
  // sends passages the database already holds. Re-analysing would cost a
  // hosted model call per page and could disturb benefit rows that are right.
  async function indexForSearch() {
    setIndexing(true);
    setStatus("Adding your documents to semantic search\u2026");
    try {
      const response = await fetch("/api/policies/reindex", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not build the search index");
      const done = payload.indexed?.length ?? 0;
      const failed = payload.failed?.length ?? 0;
      setStatus(failed
        ? `${done} document${done === 1 ? "" : "s"} added to semantic search. ${failed} could not be added: ${payload.failed.map((f: { label: string }) => f.label).join(", ")}.`
        : done
          ? `${done} document${done === 1 ? "" : "s"} added to semantic search. Questions can now match wording rather than exact keywords.`
          : "Every document was already in semantic search.");
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not build the search index");
    } finally {
      setIndexing(false);
    }
  }

  const shown = useMemo(
    () => policies.filter((p) => filter === "all" || filter === "personal" && p.personal_coverage_confirmed || filter === "reference" && !p.personal_coverage_confirmed || filter === "review" && p.needs_review),
    [policies, filter],
  );
  const counts = {
    personal: policies.filter((p) => p.personal_coverage_confirmed).length,
    reference: policies.filter((p) => !p.personal_coverage_confirmed).length,
    review: policies.filter((p) => p.needs_review).length,
  };

  return <div className="page">
    <header className="page-header compact"><div><div className="eyebrow">INSURANCE LIBRARY</div><h1>Upload whatever your insurer sent you.</h1><p className="lead">DearPolicy decides what is personal proof, what is legal/reference wording, who is actually insured and which facts are safe to show on the portfolio.</p></div></header>

    <section className="trust-strip"><div><b>1</b><span><strong>Classify</strong><small>Certificate, schedule, wording, summary, receipt…</small></span></div><div><b>2</b><span><strong>Verify</strong><small>Named people, source page and evidence text</small></span></div><div><b>3</b><span><strong>Organise</strong><small>One upload can cover several family members</small></span></div></section>

    {pollingPaused && <div className="processing-banner"><div><strong>Still processing in the background.</strong><small> Automatic updates paused after ten minutes — <button className="mini-button" onClick={() => { pollingSince.current = Date.now(); setPollingPaused(false); void refresh(); }}>Check again</button></small></div></div>}
    {activeCount > 0 && !pollingPaused && <div className="processing-banner"><span className="processing-spinner"/><div><strong>DearPolicy is working on {activeCount} document{activeCount === 1 ? "" : "s"}</strong><small>Progress updates automatically. You can continue using the app while local processing runs.</small></div></div>}

    {!!searchIndex?.enabled && searchIndex.pending > 0 && activeCount === 0 && <div className="processing-banner"><div><strong>{searchIndex.pending} of your {searchIndex.total} document{searchIndex.total === 1 ? " is" : "s are"} not in semantic search yet</strong><small>They were read before semantic search was connected, so questions about them match keywords only &mdash; &ldquo;hospital&rdquo; but not &ldquo;admitted for three nights&rdquo;. Adding them uses text DearPolicy already has: no re-reading, no cost, and nothing already extracted changes.</small></div><button className="button secondary" disabled={indexing || busy} onClick={indexForSearch}>{indexing ? "Adding\u2026" : "Add to semantic search"}</button></div>}


    <section className="upload-panel">
      <form onSubmit={upload} className="upload-form">
        <div className="field"><label>Profile hint <span>(optional)</span></label><select value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Not sure — let DearPolicy detect names</option>{family.map((m) => <option value={m.id} key={m.id}>{m.display_name} · {m.relationship}</option>)}</select></div>
        <div className="field"><label>Insurance document</label><input type="file" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp,image/tiff,.tif,.tiff,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></div>
        <div className="field"><label>PDF password <span>(if protected)</span></label><input type="password" value={pdfPassword} onChange={(e) => setPdfPassword(e.target.value)} placeholder="Leave blank if not required"/></div>
        <button disabled={busy || !file} className="button primary" type="submit">{busy ? "Uploading…" : "Upload & analyse"}</button>
      </form>
      <div className="note">The password is used only for this processing job and is not stored. Reference documents do not need to be assigned to a family member.</div>
      {status && <div className="upload-status">{status}</div>}
    </section>

    <section className="section">
      <div className="section-heading"><div><div className="eyebrow">DOCUMENTS</div><h2>Your insurance library</h2></div></div>
      <div className="filter-pills"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <b>{policies.length}</b></button><button className={filter === "personal" ? "active" : ""} onClick={() => setFilter("personal")}>Personal proof <b>{counts.personal}</b></button><button className={filter === "reference" ? "active" : ""} onClick={() => setFilter("reference")}>Reference <b>{counts.reference}</b></button><button className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>Needs review <b>{counts.review}</b></button></div>

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
        return <div className={`document-card ${policy.needs_review ? "needs-review" : ""} ${processing ? "processing" : ""}`} key={policy.id}>
          <div className="document-head">
            <div className="policy-logo">{(policy.insurer ?? policy.original_filename).slice(0, 2).toUpperCase()}</div>
            <div className="document-title"><strong>{policy.product_name ?? policy.original_filename}</strong><span>{policy.insurer ?? "Insurer pending"} · {processing ? stageLabel(policy.processing_stage, policy.processing_status) : roleLabel(policy.document_role)}</span></div>
            <div className={`document-authority ${processing ? "processing" : policy.personal_coverage_confirmed ? "confirmed" : "reference"}`}>{processing ? `${pct}%` : policy.document_authority_label ?? (policy.personal_coverage_confirmed ? "Personal proof" : "Reference")}</div>
          </div>

          <div className="document-meta"><span>{policy.page_count ? `${policy.page_count} pages` : "—"}</span>{policy.policy_number && <span>Policy {policy.policy_number}</span>}{policy.group_policy_number && <span>Group {policy.group_policy_number}</span>}<span className={`status ${policy.processing_status}`}>{stageLabel(policy.processing_stage, policy.processing_status)}</span><button className="mini-button" onClick={() => setDetailsId(detailsId === policy.id ? null : policy.id)}>{detailsId === policy.id ? "Hide details" : "Details"}</button><button className="mini-button" disabled={(processing && !policy.processing_stalled) || quarantineHeld || scanRejected || busy || !!deletingId || !!reprocessingId} onClick={() => reprocess(policy)}>{reprocessingId === policy.id ? "Queuing…" : "Re-analyse"}</button><button className="mini-button danger" disabled={processing || busy || !!deletingId} onClick={() => deleteDocument(policy)}>{deletingId === policy.id ? "Deleting…" : confirmDeleteId === policy.id ? "Confirm delete" : "Delete"}</button>{confirmDeleteId === policy.id && <button className="mini-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>}</div>

          {detailsId === policy.id && <PolicyDetailsPanel policyId={policy.id} onCorrected={() => void refresh()} />}

          {(quarantineHeld || scanRejected) && <div className={`accuracy-warning ${scanRejected ? "danger" : ""}`}>
            <b>{scanRejected ? "Rejected" : documentSafetyMode === "not_scanned_prototype" ? "Received" : "Scanning"}</b>
            <span>{quarantineLabel(policy, documentSafetyMode)}{scanRejected ? " — this file will not be analysed or used to answer questions. Delete it and upload the document again." : ""}</span>
          </div>}

          {processing && <div className="document-progress" aria-live="polite">
            <div className="document-progress-copy"><strong>{policy.processing_message ?? "Analysis in progress…"}</strong><span>{pct}%</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(2, pct)}%` }}/></div>
            <small>{policy.processing_stalled ? "Analysis stopped partway. Press Re-analyse \u2014 it continues from the last saved page instead of starting over." : policy.processing_status === "queued" ? "Waiting for the current analysis job to finish." : "DearPolicy saves each completed stage before moving to the next one."}</small>
          </div>}

          {!processing && policy.needs_review && <div className="accuracy-warning"><b>Needs review</b><span>{policy.review_reason ?? "Some extracted personal information could not be fully source-verified."}</span></div>}

          {!processing && policy.personal_coverage_confirmed ? <>
            {!!personalLinks.length && <div className="linked-people"><b>Personal coverage linked to</b>{personalLinks.map((p) => <span key={p.id} className="person-tag">{p.name}</span>)}</div>}
            {!!policy.detected_people.length && <div className="detected-block"><b>Named insured people found</b>{policy.detected_people.map((person) => <div className="detected-row" key={person.name}><span>{person.name}</span>{person.matchedFamilyMemberId ? <span className="matched">Matched ✓</span> : <select defaultValue="" onChange={(e) => e.target.value && linkPerson(policy.id, person.name, e.target.value)}><option value="">Match to family profile…</option>{family.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</select>}</div>)}</div>}
            {!!unmatched.length && <div className="document-warning">{unmatched.length} real name{unmatched.length === 1 ? "" : "s"} from this personalised document still need matching.</div>}
          </> : !processing && policy.processing_status === "ready" ? <div className="reference-explainer"><span className="reference-icon">i</span><div>
            <strong>Whose policy is this?</strong>
            <p>This document explains what the plan pays but does not name a policyholder. If it is yours or a family member&rsquo;s, say so and DearPolicy will use its benefits when answering questions. Amounts printed here stay marked as the document&rsquo;s own figures until a schedule or statement confirms yours.</p>
            <div className="declare-owner">{family.map((m) => <button key={m.id} type="button" className="button secondary" onClick={() => declareOwner(policy.id, m.id)}>{policy.linked_people.some((p) => p.id === m.id) ? `${m.display_name} \u2713` : m.display_name}</button>)}</div>
            {!!referenceLinks.length && <small>Also available as matching wording for {referenceLinks.map((p) => p.name).join(", ")}.</small>}
          </div></div> : null}

          {!processing && policy.processing_error && <div className="row-error processing-error"><strong>Analysis stopped</strong><span>DearPolicy hit a problem reading this document.</span><small>DearPolicy kept the uploaded PDF. Use Re-analyse after resolving the issue; you do not need to upload it again.</small></div>}
        </div>;
      })}{!shown.length && <div className="empty-card">No documents in this view.</div>}</div>
    </section>
  </div>;
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

/** The document review screen (prototype flow step 4-5): everything
 * DearPolicy detected and extracted for one document, with page citations,
 * verified/needs-review indicators and a correction control. */
function PolicyDetailsPanel({ policyId, onCorrected }: { policyId: string; onCorrected: () => void }) {
  const [data, setData] = useState<PolicyDetailsPayload | null>(null);
  const [error, setError] = useState("");
  const [field, setField] = useState("insurer");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/policies/${policyId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not load the document details.");
      setData(payload);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load the document details."); }
  }, [policyId]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="detail-panel"><span className="row-error">{error}</span></div>;
  if (!data) return <div className="detail-panel">Loading details…</div>;
  const d = data.document as Record<string, string | number | boolean | null>;
  async function correct(e: React.FormEvent) {
    e.preventDefault();
    setNote("");
    const response = await fetch(`/api/policies/${policyId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ field, value }) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { setNote(payload.error || "Could not save the correction."); return; }
    setNote("Correction saved.");
    setValue("");
    await load();
    onCorrected();
  }
  return (
    <div className="detail-panel" data-testid="policy-details">
      <div className="detail-grid">
        <div><label>Detected type</label><span>{showValue(d.documentRole)}{d.policyType ? ` · ${d.policyType}` : ""}</span></div>
        <div><label>Insurer</label><span data-testid="detail-insurer">{showValue(d.insurer)}</span></div>
        <div><label>Product</label><span data-testid="detail-product">{showValue(d.productName)}</span></div>
        <div><label>Policy number</label><span data-testid="detail-policy-number">{showValue(d.policyNumber)}</span></div>
        <div><label>Effective date</label><span>{showValue(d.effectiveDate)}</span></div>
        <div><label>Expiry / renewal</label><span data-testid="detail-expiry">{showValue(d.renewalOrExpiryDate)}</span></div>
        <div><label>Authority</label><span>{showValue(d.authorityLabel)}</span></div>
        <div><label>Pages stored</label><span>{showValue(d.pageCount)}</span></div>
      </div>
      {Boolean(d.needsReview) && <p className="row-error">Needs review: {showValue(d.reviewReason)}</p>}
      {!!data.linkedMembers.length && <div className="detail-section"><b>Linked family members</b>{data.linkedMembers.map((m) => <div key={m.id + m.source}>{m.display_name} <small>({m.source.replace(/_/g, " ")}{m.confidence != null ? ` · confidence ${Number(m.confidence).toFixed(2)}` : ""})</small></div>)}</div>}
      {!!data.detectedPeople.length && <div className="detail-section"><b>People named in this document</b>{data.detectedPeople.map((p) => <div key={p.detected_name}>{p.detected_name} <small>{p.matched_family_member_id ? `matched · confidence ${Number(p.confidence ?? 0).toFixed(2)}` : "not matched to a profile yet"}</small></div>)}</div>}
      {!!data.coverages.length && <div className="detail-section"><b>Confirmed personal cover</b>{data.coverages.map((c, i) => <div key={i} data-testid="detail-coverage">{c.member_name}: {c.category} · {reviewAmount(c.amount, c.currency)}{c.source_page ? <small> · page {c.source_page}</small> : null}{c.evidence_verified ? <small className="matched"> · source-verified</small> : <small className="row-error"> · not source-verified</small>}</div>)}</div>}
      {!!data.referenceCoverages.length && <div className="detail-section"><b>Benefits described (reference)</b>{data.referenceCoverages.map((c, i) => <div key={i}>{c.category}{c.product_name ? ` · ${c.product_name}` : ""}{c.source_page ? <small> · page {c.source_page}</small> : null}</div>)}</div>}
      {!!data.premiums.length && <div className="detail-section"><b>Premium records</b>{data.premiums.map((p, i) => <div key={i}>{reviewAmount(p.amount, p.currency)}{p.frequency ? ` · ${p.frequency}` : ""}{p.payment_date ? ` · ${p.payment_date}` : ""}{p.source_page ? <small> · page {p.source_page}</small> : null}</div>)}</div>}
      {!!data.extracted.waitingPeriods.length && <div className="detail-section"><b>Waiting periods</b>{data.extracted.waitingPeriods.map((w, i) => <div key={i}>{w}</div>)}</div>}
      {!!data.extracted.keyExclusions.length && <div className="detail-section"><b>Key exclusions</b>{data.extracted.keyExclusions.map((w, i) => <div key={i}>{w}</div>)}</div>}
      {!!data.extracted.deductiblesAndCoinsurance.length && <div className="detail-section"><b>Deductibles & co-insurance</b>{data.extracted.deductiblesAndCoinsurance.map((w, i) => <div key={i}>{w}</div>)}</div>}
      {!!data.extracted.riders.length && <div className="detail-section"><b>Riders</b>{data.extracted.riders.map((w, i) => <div key={i}>{w}</div>)}</div>}
      <form onSubmit={correct} className="detail-correct">
        <b>Correct a detected field</b>
        <div>
          <select value={field} onChange={(e) => setField(e.target.value)} aria-label="Field to correct">
            <option value="insurer">Insurer</option><option value="product_name">Product name</option>
            <option value="policy_number">Policy number</option><option value="policy_type">Policy type</option>
          </select>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Corrected value" aria-label="Corrected value" />
          <button className="mini-button" type="submit" disabled={!value.trim()}>Save correction</button>
        </div>
        {note && <small role="status">{note}</small>}
        {!!data.corrections.length && <small>{data.corrections.length} correction{data.corrections.length === 1 ? "" : "s"} recorded.</small>}
      </form>
    </div>
  );
}
