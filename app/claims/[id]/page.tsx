"use client";
import { useEffect, useCallback, useState } from "react";
import { useParams } from "next/navigation";
import {
  DOCUMENT_TYPE_GROUPS, DOCUMENT_TYPE_OPTIONS, buildEvidenceUploadForm, defaultDocumentTypeFor, documentTypeGroup, documentTypeLabel, evidenceStatusDisplay,
  POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE,
} from "@/lib/claims/evidence/document-catalogue";
import { BILL_REVIEW_NOTICE, billReviewDraftFrom, buildBillReviewRequest, type BillReviewDraft } from "@/lib/claims/evidence/bill-review";
import { isMedicalClaimEligibleDocumentType, type ClaimEvidenceDocumentType } from "@/lib/claims/evidence/types";

type Claim = { id: string; family_member_id: string; status: string; event_summary: string | null; facts: Record<string, unknown>; decision_packet: { assessments?: { id: string; coverageId?: string; title: string }[] } | null };
type ExtractedFields = {
  deceasedName: string | null; otherNamesMentioned: string[]; personIdentifiers: { label: string; value: string }[];
  dateOfDeath: string | null; statedCauseOfDeath: string | null; mannerOfDeath: string | null; issuingAuthority: string | null;
  documentReference: string | null; documentType: string | null; pageCitations: { field: string; pageStart: number; pageEnd: number; excerpt: string }[];
  confidence: Record<string, number>;
  patientName?: string | null; exactDiagnosis?: string | null; diagnosisDate?: string | null; diseaseStage?: string | null;
  hospitalName?: string | null; hospitalCountry?: string | null; admissionDate?: string | null; dischargeDate?: string | null;
  admissionType?: string | null; wardType?: string | null;
  billLineItems?: { category: string; description: string | null; amountText: string; currency: string | null }[];
  thirdPartyPayments?: { source: string; amountText: string; currency: string | null }[];
};
type Extraction = { id: string; extracted_fields: ExtractedFields; reviewed_fields: Partial<ExtractedFields> | null; identity_conflicts: { code: string; message: string }[] };
type EvidenceDoc = { id: string; document_type: string; original_filename: string; status: string; scan_status: string; identity_status: string; processing_error_code: string | null; created_at: string; extraction: Extraction | null };

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
  const [error, setError] = useState("");
  // Starts empty: only a death claim gets a default (see
  // defaultDocumentTypeFor); anything else must be chosen explicitly.
  const [docType, setDocType] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const claimRes = await fetch(`/api/claims/${claimSessionId}`).then((r) => r.json());
    if (claimRes.error) { setError(claimRes.error); return; }
    setClaim(claimRes.claim);
    setDocType((current) => current || defaultDocumentTypeFor(claimRes.claim.facts?.eventType));
    const familyMemberId = claimRes.claim.family_member_id;
    const docsRes = await fetch(`/api/claims/evidence?familyMemberId=${familyMemberId}&claimSessionId=${claimSessionId}`).then((r) => r.json());
    if (!docsRes.error) setDocuments(docsRes.documents ?? []);
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
    if (!claim) return;
    const built = buildEvidenceUploadForm({ file, fileName: file?.name, familyMemberId: claim.family_member_id, claimSessionId, documentType: docType });
    if (!built.ok) { setUploadError(built.message); return; }
    setUploadError("");
    setBusy(true);
    const res = await fetch("/api/claims/evidence/upload", { method: "POST", body: built.form }).then((r) => r.json());
    setBusy(false);
    if (res.error) { setUploadError(res.error); return; }
    fileInput.value = "";
    await load();
  }

  async function handleReject(id: string) {
    if (!claim) return;
    await fetch(`/api/claims/evidence/${id}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ familyMemberId: claim.family_member_id, claimSessionId, reason: "Rejected by reviewer." }) });
    await load();
  }

  if (error) return <div className="page"><div className="alert error" role="alert"><strong>{error}</strong></div></div>;
  if (!claim) return <div className="page"><div className="empty-card">Loading claim…</div></div>;

  return (
    <div className="page">
      <header className="page-header"><div><div className="eyebrow">CLAIM EVIDENCE</div><h1>{claim.event_summary ?? "Claim evidence"}</h1><p className="lead">Upload the documents for this claim -- death records, medical evidence, or bills and receipts -- and review what DearPolicy read from them. Nothing here is used to estimate an amount until it has been reviewed, and the insurer makes the final decision on any claim.</p></div></header>

      <section className="section">
        <h2>Upload a document</h2>
        <form onSubmit={handleUpload} className="field" style={{ display: "grid", gap: 10, maxWidth: 480 }}>
          <label>Document type
            <select value={docType} onChange={(e) => setDocType(e.target.value)} required>
              <option value="" disabled>Choose what this document is…</option>
              {DOCUMENT_TYPE_GROUPS.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          {(() => {
            const option = DOCUMENT_TYPE_OPTIONS.find((o) => o.value === docType);
            const group = DOCUMENT_TYPE_GROUPS.find((g) => g.id === option?.group);
            return option && group
              ? <p className="muted"><b>{group.label}:</b> {group.guidance} {option.description}</p>
              : <p className="muted">Pick the closest match. Death records, medical evidence and bills are each read differently.</p>;
          })()}
          <label>PDF file<input type="file" name="file" accept="application/pdf" required /></label>
          {uploadError && <div className="alert error" role="alert">{uploadError}</div>}
          <button className="button primary" type="submit" disabled={busy || !docType}>{busy ? "Uploading…" : "Upload"}</button>
        </form>
      </section>

      <section className="section">
        <h2>Documents</h2>
        {documents.length === 0 ? <div className="empty-card">No claim-evidence documents uploaded yet.</div> : documents.map((doc) => (
          <div key={doc.id} className="action-card" style={{ gridTemplateColumns: "1fr", marginBottom: 12 }}>
            <div>
              {(() => {
                const display = evidenceStatusDisplay(doc);
                return (<>
                  <strong>{doc.original_filename}</strong> <span className={`status ${doc.status}`}>{display.label}</span>{" "}
                  <span className="status">{documentTypeLabel(doc.document_type)}</span>{" "}
                  <span className="status">identity: {doc.identity_status.replace(/_/g, " ")}</span>
                  <p><em>{display.detail}</em></p>
                </>);
              })()}

              {doc.extraction && documentTypeGroup(doc.document_type) === "cause_of_death" && (
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

              {doc.extraction && documentTypeGroup(doc.document_type) === "medical_evidence" && (
                <div style={{ marginTop: 8 }}>
                  <p>Patient: <b>{String(reviewedValue(doc, "patientName") ?? "—")}</b></p>
                  <p>Diagnosis as stated: <b>{String(reviewedValue(doc, "exactDiagnosis") ?? "—")}</b></p>
                  <p>Stage as stated: <b>{String(reviewedValue(doc, "diseaseStage") ?? "—")}</b></p>
                  <p>Diagnosis date: <b>{String(reviewedValue(doc, "diagnosisDate") ?? "—")}</b></p>
                </div>
              )}

              {/* Whether evidence satisfies a policy's own definition (cause of
                  death, critical illness, disability, travel) is never a
                  household decision -- see the *-match routes. */}
              {["needs_review", "matched"].includes(doc.status) && documentTypeGroup(doc.document_type) !== "bills_and_settlements" && (
                <p className="muted"><b>{POLICY_DEFINITION_REVIEW_REQUIRED_MESSAGE}</b></p>
              )}

              {doc.extraction && ["needs_review", "matched"].includes(doc.status) && isMedicalClaimEligibleDocumentType(doc.document_type as ClaimEvidenceDocumentType) && (
                doc.identity_status === "confirmed"
                  ? <BillReview doc={doc} familyMemberId={claim.family_member_id} claimSessionId={claimSessionId} onSaved={load} />
                  : <p className="muted">DearPolicy has not confirmed this document is about this family member, so its bill details cannot be reviewed yet.</p>
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

const SCALAR_FIELDS: { key: "patientName" | "hospitalName" | "hospitalCountry" | "admissionDate" | "dischargeDate" | "admissionType" | "wardType"; label: string; placeholder?: string }[] = [
  { key: "patientName", label: "Patient name" },
  { key: "hospitalName", label: "Hospital or clinic" },
  { key: "hospitalCountry", label: "Country" },
  { key: "admissionDate", label: "Admission date", placeholder: "YYYY-MM-DD" },
  { key: "dischargeDate", label: "Discharge date", placeholder: "YYYY-MM-DD" },
  { key: "admissionType", label: "Admission type" },
  { key: "wardType", label: "Ward type" },
];

/** Household review of the facts printed on one bill document. Amounts are
 * edited and sent as the printed text; this component never converts or
 * adds them up -- the server parses them and the calculators decide any
 * amount. */
function BillReview({ doc, familyMemberId, claimSessionId, onSaved }: { doc: EvidenceDoc; familyMemberId: string; claimSessionId: string; onSaved: () => Promise<void> | void }) {
  const [draft, setDraft] = useState<BillReviewDraft>(() => billReviewDraftFrom(doc.extraction?.extracted_fields ?? {}, doc.extraction?.reviewed_fields));
  const [confirmed, setConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const citations = doc.extraction?.extracted_fields.pageCitations ?? [];
  const pagesFor = (field: string) => citations.filter((c) => c.field === field)
    .map((c) => (c.pageStart === c.pageEnd ? `page ${c.pageStart}` : `pages ${c.pageStart}-${c.pageEnd}`)).join(", ");
  const errorFor = (path: string) => fieldErrors[path] ? <small role="alert" style={{ color: "var(--critical, crimson)" }}>{fieldErrors[path]}</small> : null;
  const setScalar = (key: (typeof SCALAR_FIELDS)[number]["key"], value: string) =>
    setDraft((d) => { const next = { ...d }; next[key] = value; return next; });
  const setLine = (index: number, patch: Partial<BillReviewDraft["billLineItems"][number]>) =>
    setDraft((d) => ({ ...d, billLineItems: d.billLineItems.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));
  const setPayment = (index: number, patch: Partial<BillReviewDraft["thirdPartyPayments"][number]>) =>
    setDraft((d) => ({ ...d, thirdPartyPayments: d.thirdPartyPayments.map((row, i) => (i === index ? { ...row, ...patch } : row)) }));

  async function save() {
    const built = buildBillReviewRequest({ draft, familyMemberId, claimSessionId, confirmed });
    if (!built.ok) { setMessage(built.message); return; }
    setSaving(true); setMessage(""); setFieldErrors({});
    const res = await fetch(`/api/claims/evidence/${doc.id}/medical-bill-review`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body),
    }).then((r) => r.json()).catch(() => ({ error: "Could not save the review. Please try again." }));
    setSaving(false);
    if (res.error) { setFieldErrors(res.fieldErrors ?? {}); setMessage(res.error); return; }
    setConfirmed(false);
    await onSaved();
  }

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 8, maxWidth: 640 }}>
      <h3 style={{ margin: 0 }}>Check the bill details</h3>
      <p className="muted">{BILL_REVIEW_NOTICE} Compare each detail with the{" "}
        <a href={`/api/claims/evidence/${doc.id}/file?familyMemberId=${familyMemberId}&claimSessionId=${claimSessionId}`} target="_blank" rel="noreferrer">original document</a>
        {" "}and correct anything that does not match what is printed.</p>
      {SCALAR_FIELDS.map((f) => (
        <label key={f.key} style={{ display: "grid", gap: 2 }}>
          <span>{f.label}{pagesFor(f.key) && <small className="muted"> ({pagesFor(f.key)})</small>}</span>
          <input value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => setScalar(f.key, e.target.value)} />
          {errorFor(f.key)}
        </label>
      ))}
      <fieldset style={{ display: "grid", gap: 6 }}>
        <legend>Bill lines (amounts exactly as printed){pagesFor("billLineItems") && <small className="muted"> ({pagesFor("billLineItems")})</small>}</legend>
        {draft.billLineItems.length === 0 && <p className="muted">No bill lines were read from this document.</p>}
        {draft.billLineItems.map((row, i) => (
          <div key={i} style={{ display: "grid", gap: 4, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            <label>What for<input value={row.category} onChange={(e) => setLine(i, { category: e.target.value })} />{errorFor(`billLineItems.${i}.category`)}</label>
            <label>Description<input value={row.description} onChange={(e) => setLine(i, { description: e.target.value })} />{errorFor(`billLineItems.${i}.description`)}</label>
            <label>Amount as printed<input inputMode="decimal" value={row.amountText} onChange={(e) => setLine(i, { amountText: e.target.value })} />{errorFor(`billLineItems.${i}.amountText`)}</label>
            <label>Currency<input value={row.currency} maxLength={3} onChange={(e) => setLine(i, { currency: e.target.value })} />{errorFor(`billLineItems.${i}.currency`)}</label>
          </div>
        ))}
      </fieldset>
      <fieldset style={{ display: "grid", gap: 6 }}>
        <legend>Already paid by others (insurers, MediShield, employer)</legend>
        {draft.thirdPartyPayments.length === 0 && <p className="muted">None were read from this document.</p>}
        {draft.thirdPartyPayments.map((row, i) => (
          <div key={i} style={{ display: "grid", gap: 4, gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
            <label>Paid by<input value={row.source} onChange={(e) => setPayment(i, { source: e.target.value })} />{errorFor(`thirdPartyPayments.${i}.source`)}</label>
            <label>Amount as printed<input inputMode="decimal" value={row.amountText} onChange={(e) => setPayment(i, { amountText: e.target.value })} />{errorFor(`thirdPartyPayments.${i}.amountText`)}</label>
            <label>Currency<input value={row.currency} maxLength={3} onChange={(e) => setPayment(i, { currency: e.target.value })} />{errorFor(`thirdPartyPayments.${i}.currency`)}</label>
          </div>
        ))}
      </fieldset>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>I have checked these details against the document and they match what is printed.</span>
      </label>
      {message && <div className="alert error" role="alert">{message}</div>}
      <button className="button primary" type="button" disabled={saving || !confirmed} onClick={save}>{saving ? "Saving…" : doc.status === "matched" ? "Save corrected review" : "Confirm bill details"}</button>
      <p className="muted">If the details were read wrongly and cannot be fixed here, reject the document below and upload a clearer copy.</p>
    </div>
  );
}
