"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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
  original_filename: string;
  page_count: number | null;
  processing_error: string | null;
  linked_people: LinkedPerson[];
  detected_people: DetectedPerson[];
};
type Filter = "all" | "personal" | "reference" | "review";

const ACTIVE_STATUSES = new Set(["queued", "uploaded", "extracting", "indexing"]);
function isProcessing(policy: Policy) { return ACTIVE_STATUSES.has(policy.processing_status); }
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
  const [memberId, setMemberId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const previousActiveCount = useRef(0);

  async function refresh() {
    const [f, p] = await Promise.all([
      fetch("/api/family", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setFamily(f.family ?? []);
    setPolicies(p.policies ?? []);
  }

  useEffect(() => { void refresh(); }, []);

  const activeCount = policies.filter(isProcessing).length;
  useEffect(() => {
    if (!activeCount) return;
    const timer = window.setInterval(() => { void refresh(); }, 1400);
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
    setBusy(true);
    setStatus("Uploading PDF…");
    try {
      const form = new FormData();
      form.set("file", file);
      if (memberId) form.set("familyMemberId", memberId);
      if (pdfPassword) form.set("pdfPassword", pdfPassword);
      const response = await fetch("/api/policies/upload", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error("Upload failed");
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
      if (!response.ok) throw new Error("Re-analysis failed");
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
      if (!response.ok) throw new Error("Could not save that");
      setStatus(`Saved — this policy is ${who}'s. Its benefits will now be used in answers. Upload a schedule or statement when you have one to confirm the amounts.`);
      await refresh();
    } catch {
      setStatus("Could not save that. Please try again in a moment.");
    }
  }

  async function linkPerson(policyId: string, detectedName: string, familyMemberId: string) {
    try {
      const response = await fetch("/api/policies/link-person", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId, detectedName, familyMemberId }),
      });
      if (!response.ok) throw new Error("Could not link person");
      setStatus(`Linked ${detectedName} to the selected family profile.`);
      await refresh();
    } catch {
      setStatus("Could not link person. Please try again in a moment.");
    }
  }

  async function deleteDocument(policy: Policy) {
    if (isProcessing(policy)) return;
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
      if (!response.ok) throw new Error("Could not delete document");
      setStatus(`${label} was deleted. The portfolio has been recalculated.`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete document");
    } finally {
      setDeletingId(null);
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

    {activeCount > 0 && <div className="processing-banner"><span className="processing-spinner"/><div><strong>DearPolicy is working on {activeCount} document{activeCount === 1 ? "" : "s"}</strong><small>Progress updates automatically. You can continue using the app while local processing runs.</small></div></div>}

    <section className="upload-panel">
      <form onSubmit={upload} className="upload-form">
        <div className="field"><label>Profile hint <span>(optional)</span></label><select value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">Let DearPolicy detect names</option>{family.map((m) => <option value={m.id} key={m.id}>{m.display_name} · {m.relationship}</option>)}</select></div>
        <div className="field"><label>Insurance PDF</label><input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></div>
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
        const processing = isProcessing(policy);
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

          <div className="document-meta"><span>{policy.page_count ? `${policy.page_count} pages` : "—"}</span>{policy.policy_number && <span>Policy {policy.policy_number}</span>}{policy.group_policy_number && <span>Group {policy.group_policy_number}</span>}<span className={`status ${policy.processing_status}`}>{stageLabel(policy.processing_stage, policy.processing_status)}</span><button className="mini-button" disabled={processing || busy || !!deletingId || !!reprocessingId} onClick={() => reprocess(policy)}>{reprocessingId === policy.id ? "Queuing…" : "Re-analyse"}</button><button className="mini-button danger" disabled={processing || busy || !!deletingId} onClick={() => deleteDocument(policy)}>{deletingId === policy.id ? "Deleting…" : confirmDeleteId === policy.id ? "Confirm delete" : "Delete"}</button>{confirmDeleteId === policy.id && <button className="mini-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button>}</div>

          {processing && <div className="document-progress" aria-live="polite">
            <div className="document-progress-copy"><strong>{policy.processing_message ?? "Analysis in progress…"}</strong><span>{pct}%</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(2, pct)}%` }}/></div>
            <small>{policy.processing_status === "queued" ? "Waiting for the current analysis job to finish." : "DearPolicy saves each completed stage before moving to the next one."}</small>
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
