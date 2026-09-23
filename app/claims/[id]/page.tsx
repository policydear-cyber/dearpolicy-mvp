"use client";
import { useEffect, useCallback, useState } from "react";
import { useParams } from "next/navigation";

type Claim = { id: string; family_member_id: string; status: string; event_summary: string | null; facts: Record<string, unknown>; decision_packet: { assessments?: { id: string; coverageId?: string; title: string }[] } | null };
type ExtractedFields = {
  deceasedName: string | null; otherNamesMentioned: string[]; personIdentifiers: { label: string; value: string }[];
  dateOfDeath: string | null; statedCauseOfDeath: string | null; mannerOfDeath: string | null; issuingAuthority: string | null;
  documentReference: string | null; documentType: string | null; pageCitations: { field: string; pageStart: number; pageEnd: number; excerpt: string }[];
  confidence: Record<string, number>;
};
type Extraction = { id: string; extracted_fields: ExtractedFields; reviewed_fields: Partial<ExtractedFields> | null; identity_conflicts: { code: string; message: string }[] };
type EvidenceDoc = { id: string; document_type: string; original_filename: string; status: string; scan_status: string; identity_status: string; processing_error: string | null; created_at: string; extraction: Extraction | null };
type CoverageOption = { id: string; policy_id: string; insurer: string | null; product_name: string | null; policy_number: string | null };

const DOC_TYPES = [
  { value: "death_certificate", label: "Death certificate" },
  { value: "police_report", label: "Police report" },
  { value: "coroners_report", label: "Coroner's report" },
  { value: "medical_examiner_report", label: "Medical examiner's report" },
  { value: "other_official_document", label: "Other official document" },
];
const NON_TERMINAL = new Set(["uploaded", "quarantined", "processing", "extracted"]);

/** Reviewer corrections win over the model's raw proposal -- mirrors
 * lib/claims/evidence/matches.ts's effectiveFields() on the server. */
function reviewedValue(doc: EvidenceDoc, field: keyof ExtractedFields): unknown {
  if (!doc.extraction) return null;
  const reviewed = doc.extraction.reviewed_fields;
  if (reviewed && field in reviewed) return reviewed[field];
  return doc.extraction.extracted_fields[field];
}

export default function ClaimEvidencePage() {
  const params = useParams<{ id: string }>();
  const claimSessionId = params.id;
  const [claim, setClaim] = useState<Claim | null>(null);
  const [documents, setDocuments] = useState<EvidenceDoc[]>([]);
  const [coverages, setCoverages] = useState<CoverageOption[]>([]);
  const [error, setError] = useState("");
  const [docType, setDocType] = useState("death_certificate");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const claimRes = await fetch(`/api/claims/${claimSessionId}`).then((r) => r.json());
    if (claimRes.error) { setError(claimRes.error); return; }
    setClaim(claimRes.claim);
    const familyMemberId = claimRes.claim.family_member_id;
    const [docsRes, coverageRes] = await Promise.all([
      fetch(`/api/claims/evidence?familyMemberId=${familyMemberId}&claimSessionId=${claimSessionId}`).then((r) => r.json()),
      fetch(`/api/coverage?familyMemberId=${familyMemberId}&category=${encodeURIComponent("Personal Accident")}`).then((r) => r.json()),
    ]);
    if (!docsRes.error) setDocuments(docsRes.documents ?? []);
    if (!coverageRes.error) setCoverages(coverageRes.confirmed ?? []);
  }, [claimSessionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!documents.some((d) => NON_TERMINAL.has(d.status))) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [documents, load]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file || !claim) return;
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("familyMemberId", claim.family_member_id);
    body.set("claimSessionId", claimSessionId);
    body.set("documentType", docType);
    const res = await fetch("/api/claims/evidence/upload", { method: "POST", body }).then((r) => r.json());
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    fileInput.value = "";
    await load();
  }

  async function handleReject(id: string) {
    if (!claim) return;
    await fetch(`/api/claims/evidence/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ familyMemberId: claim.family_member_id, claimSessionId, reason: "Rejected by reviewer." }) });
    await load();
  }

  async function handleMatch(doc: EvidenceDoc, coverage: CoverageOption, result: "matches" | "does_not_match" | "needs_review") {
    if (!claim) return;
    const res = await fetch(`/api/claims/evidence/${doc.id}/match`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ familyMemberId: claim.family_member_id, claimSessionId, contractId: coverage.policy_id, coverageId: coverage.id, result }),
    }).then((r) => r.json());
    if (res.error) setError(res.error);
    await load();
  }

  if (error) return <div className="page"><div className="alert error" role="alert"><strong>{error}</strong></div></div>;
  if (!claim) return <div className="page"><div className="empty-card">Loading claim…</div></div>;

  return (
    <div className="page">
      <header className="page-header"><div><div className="eyebrow">CLAIM EVIDENCE</div><h1>{claim.event_summary ?? "Claim evidence"}</h1><p className="lead">Upload official cause-of-death documents, review what DearPolicy read from them, and confirm whether each matches a specific policy&apos;s own accidental-death definition. Nothing here is used to calculate an amount until a reviewer confirms it below.</p></div></header>

      <section className="section">
        <h2>Upload a document</h2>
        <form onSubmit={handleUpload} className="field" style={{ display: "grid", gap: 10, maxWidth: 480 }}>
          <label>Document type
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label>PDF file<input type="file" name="file" accept="application/pdf" required /></label>
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
        </form>
      </section>

      <section className="section">
        <h2>Documents</h2>
        {documents.length === 0 ? <div className="empty-card">No claim-evidence documents uploaded yet.</div> : documents.map((doc) => (
          <div key={doc.id} className="action-card" style={{ gridTemplateColumns: "1fr", marginBottom: 12 }}>
            <div>
              <strong>{doc.original_filename}</strong> <span className={`status ${doc.status}`}>{doc.status.replace(/_/g, " ")}</span>{" "}
              <span className="status">{doc.document_type.replace(/_/g, " ")}</span>{" "}
              <span className="status">identity: {doc.identity_status.replace(/_/g, " ")}</span>
              {doc.processing_error && <p><em>{doc.processing_error}</em></p>}
              {doc.status === "quarantined" && doc.scan_status !== "clean" && (
                <p><em>
                  {doc.scan_status === "scan_unavailable"
                    ? "This document is on hold: malware scanning is not configured in this environment, so it cannot be processed until it is."
                    : "This document is waiting for a malware scan to complete before it can be processed."}
                </em></p>
              )}

              {doc.extraction && (
                <div style={{ marginTop: 8 }}>
                  <p>Deceased name: <b>{String(reviewedValue(doc, "deceasedName") ?? "—")}</b></p>
                  <p>Date of death: <b>{String(reviewedValue(doc, "dateOfDeath") ?? "—")}</b></p>
                  <p>Stated cause of death: <b>{String(reviewedValue(doc, "statedCauseOfDeath") ?? "—")}</b></p>
                  <p>Manner of death: <b>{String(reviewedValue(doc, "mannerOfDeath") ?? "—")}</b></p>
                  <p>Issuing authority: <b>{String(reviewedValue(doc, "issuingAuthority") ?? "—")}</b></p>
                  {doc.extraction.identity_conflicts.length > 0 && (
                    <ul>{doc.extraction.identity_conflicts.map((c) => <li key={c.code} style={{ color: "var(--critical, crimson)" }}>{c.message}</li>)}</ul>
                  )}
                </div>
              )}

              {doc.status === "needs_review" && doc.identity_status === "confirmed" && coverages.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p>Confirm against a specific policy&apos;s accidental-death definition:</p>
                  {coverages.map((c) => (
                    <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span>{c.product_name ?? c.insurer ?? c.policy_number} ({c.insurer})</span>
                      <button className="button secondary compact" onClick={() => handleMatch(doc, c, "matches")}>Matches</button>
                      <button className="button secondary compact" onClick={() => handleMatch(doc, c, "does_not_match")}>Does not match</button>
                      <button className="button secondary compact" onClick={() => handleMatch(doc, c, "needs_review")}>Needs review</button>
                    </div>
                  ))}
                </div>
              )}

              {["needs_review", "extracted", "uploaded", "quarantined", "processing", "matched", "failed"].includes(doc.status) && (
                <button className="button secondary compact" style={{ marginTop: 8 }} onClick={() => handleReject(doc.id)}>Reject document</button>
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
