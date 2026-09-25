"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  REVIEWER_DECISION_CHOICES, buildReviewerDecisionRequest, type ReviewerDecisionChoice, type ReviewerDecisionTarget,
} from "@/lib/claims/reviewers/decision-request";

type Citation = { field: string; pageStart: number; pageEnd: number; excerpt: string };
type DocumentView = {
  id: string; documentTypeLabel: string; originalFilename: string; status: string; identityStatus: string;
  fields: Record<string, unknown> | null; citations: Citation[]; modelReadingVerified: boolean;
};
type Definition = ReviewerDecisionTarget & {
  label: string; quote: string; citation: { policyName: string | null; pageStart: number | null; pageEnd: number | null; label: string | null };
};
type HistoryEntry = {
  id: string; evidenceDocumentId: string; contractId: string; result: string; reason: string | null;
  reviewedBy: string; reviewedAt: string; supersededAt: string | null; supersededReason: string | null;
  benefitCode: string | null; illnessName: string | null; matchKey: string | null; legacyUnverified?: boolean;
};
type Workspace = {
  assignment: { id: string; expiresAt: string; singleDocument: boolean };
  reviewer: { displayLabel: string; identity: string };
  claim: { memberName: string; eventType: string | null; eventSummary: string | null };
  documents: DocumentView[];
  coverages: { id: string; policyId: string; category: string; productName: string | null; insurer: string | null; policyName: string | null; policyNumber: string | null }[];
  definitions: Definition[];
  definitionErrors: string[];
  history: HistoryEntry[];
  notice: string;
};

const FACT_LABELS: [string, string][] = [
  ["deceasedName", "Deceased name"], ["dateOfDeath", "Date of death"], ["statedCauseOfDeath", "Stated cause of death"], ["mannerOfDeath", "Manner of death"],
  ["patientName", "Patient"], ["exactDiagnosis", "Diagnosis as stated"], ["diseaseStage", "Stage as stated"], ["diagnosisDate", "Diagnosis date"],
  ["hospitalName", "Hospital"], ["admissionDate", "Admission date"], ["dischargeDate", "Discharge date"], ["issuingAuthority", "Issuing authority"],
];
const pages = (start: number | null, end: number | null) => (start == null ? "" : start === end || end == null ? `page ${start}` : `pages ${start}-${end}`);

/** One assigned claim. Read-only apart from recording a decision: the
 * reviewer cannot change policy wording, amounts, formulas or provenance
 * here, and every decision goes through the server's reviewer boundary. */
export default function ReviewerAssignmentPage() {
  const { id } = useParams<{ id: string }>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/reviewer/assignments/${id}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(res.status === 404 ? "This assignment has ended or is not yours." : json.error ?? "Could not load this assignment."); return; }
    setWorkspace(json);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="page"><div className="alert error" role="alert"><strong>{error}</strong></div><p><Link href="/reviewer">Back to assigned reviews</Link></p></div>;
  if (!workspace) return <div className="page"><div className="empty-card">Loading assignment…</div></div>;

  return (
    <div className="page">
      <header className="page-header"><div>
        <div className="eyebrow">DEARPOLICY REVIEWER · <Link href="/reviewer">Assigned reviews</Link></div>
        <h1>{workspace.claim.memberName} — {workspace.claim.eventType ?? "claim"}</h1>
        {workspace.claim.eventSummary && <p className="lead">{workspace.claim.eventSummary}</p>}
        <p className="muted">Assignment ends {new Date(workspace.assignment.expiresAt).toLocaleString()}. Decisions are recorded as {workspace.reviewer.displayLabel}.</p>
        <div className="alert" role="note"><strong>{workspace.notice}</strong></div>
      </div></header>

      <section className="section">
        <h2>Policies and definitions</h2>
        {workspace.coverages.length === 0 && <div className="empty-card">This family member has no confirmed coverage.</div>}
        {workspace.definitions.length === 0 && <p className="muted">No policy definition wording has been verified for this family member yet, so no decision can be recorded.</p>}
        {workspace.definitionErrors.length > 0 && <p className="muted">Some definitions could not be loaded: {workspace.definitionErrors.join(", ")}.</p>}
        {workspace.definitions.map((d) => {
          const coverage = workspace.coverages.find((c) => c.id === d.coverageId);
          return (
            <div key={`${d.route}:${d.coverageId}:${d.benefitCode ?? ""}:${d.illnessName ?? d.matchKey ?? ""}`} className="action-card" style={{ gridTemplateColumns: "1fr", marginBottom: 10 }}>
              <div>
                <strong>{d.label}</strong>{" "}
                <span className="status">{coverage ? `${coverage.insurer ?? ""} ${coverage.policyName ?? coverage.productName ?? ""}`.trim() : d.contractId}</span>
                <blockquote style={{ margin: "8px 0" }}>{d.quote}</blockquote>
                <p className="muted">{d.citation.policyName ?? "Policy document"}, {pages(d.citation.pageStart, d.citation.pageEnd)}</p>
              </div>
            </div>
          );
        })}
      </section>

      <section className="section">
        <h2>Documents</h2>
        {workspace.documents.length === 0 && <div className="empty-card">No current documents in this assignment.</div>}
        {workspace.documents.map((doc) => (
          <div key={doc.id} className="action-card" style={{ gridTemplateColumns: "1fr", marginBottom: 14 }}>
            <div>
              <strong>{doc.originalFilename}</strong> <span className="status">{doc.documentTypeLabel}</span>{" "}
              <span className="status">{doc.status.replace(/_/g, " ")}</span> <span className="status">identity: {doc.identityStatus.replace(/_/g, " ")}</span>{" "}
              <span className="status">{doc.modelReadingVerified ? "reading provenance verified" : "reading provenance NOT verified — no amount can follow"}</span>
              <p><a href={`/api/reviewer/assignments/${workspace.assignment.id}/documents/${doc.id}`} target="_blank" rel="noreferrer">Open the original document</a></p>
              {doc.fields && (
                <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 12px" }}>
                  {FACT_LABELS.filter(([key]) => doc.fields?.[key] != null && doc.fields?.[key] !== "").map(([key, label]) => (
                    <div key={key} style={{ display: "contents" }}><dt>{label}</dt><dd>{String(doc.fields?.[key])}</dd></div>
                  ))}
                </dl>
              )}
              {doc.citations.length > 0 && (
                <ul className="muted">{doc.citations.map((c, i) => <li key={i}>{c.field}: {pages(c.pageStart, c.pageEnd)} — “{c.excerpt}”</li>)}</ul>
              )}
              {workspace.definitions.length > 0 && <DecisionForm assignmentId={workspace.assignment.id} documentId={doc.id} definitions={workspace.definitions} onSaved={load} />}
              <History entries={workspace.history.filter((h) => h.evidenceDocumentId === doc.id)} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function DecisionForm({ assignmentId, documentId, definitions, onSaved }: { assignmentId: string; documentId: string; definitions: Definition[]; onSaved: () => Promise<void> }) {
  const [targetIndex, setTargetIndex] = useState(0);
  const [choice, setChoice] = useState<ReviewerDecisionChoice | "">("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const built = buildReviewerDecisionRequest({ assignmentId, evidenceDocumentId: documentId, target: definitions[targetIndex], choice, reason });
    if (!built.ok) { setMessage(built.message); return; }
    setSaving(true); setMessage("");
    const res = await fetch(built.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(built.body) })
      .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }))
      .catch(() => ({ ok: false, json: { error: "Could not record the decision. Please try again." } }));
    setSaving(false);
    if (!res.ok) { setMessage(res.json.error ?? "Could not record the decision."); return; }
    setChoice(""); setReason("");
    await onSaved();
  }

  return (
    <fieldset style={{ display: "grid", gap: 8, maxWidth: 640, marginTop: 10 }}>
      <legend>Record a decision for this document</legend>
      <label>Definition
        <select value={targetIndex} onChange={(e) => setTargetIndex(Number(e.target.value))}>
          {definitions.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
        </select>
      </label>
      {REVIEWER_DECISION_CHOICES.map((c) => (
        <label key={c.value} style={{ display: "flex", gap: 8 }}>
          <input type="radio" name={`decision-${documentId}`} value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} />{c.label}
        </label>
      ))}
      <label>Reason (required, kept internal)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={2000} required />
      </label>
      {message && <div className="alert error" role="alert">{message}</div>}
      <button className="button primary" type="button" disabled={saving || !choice || reason.trim().length < 3} onClick={save}>{saving ? "Recording…" : "Record decision"}</button>
    </fieldset>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <p className="muted">No decisions recorded for this document yet.</p>;
  return (
    <div style={{ marginTop: 10 }}>
      <h3 style={{ margin: 0 }}>Decision history</h3>
      <ul>
        {entries.map((h) => (
          <li key={h.id}>
            <b>{h.result.replace(/_/g, " ")}</b>{h.illnessName ? ` — ${h.illnessName}` : ""}{h.matchKey ? ` — ${h.matchKey}` : ""} · {new Date(h.reviewedAt).toLocaleString()} · {h.reviewedBy}
            {h.legacyUnverified && <span className="status"> legacy — recorded without the exact wording; not usable, needs re-review</span>}
            {h.supersededAt ? <span className="status"> superseded {new Date(h.supersededAt).toLocaleString()}{h.supersededReason ? ` (${h.supersededReason})` : ""}</span> : <span className="status"> current</span>}
            {h.reason && <div className="muted">{h.reason}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
