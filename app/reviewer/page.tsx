"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Assignment = {
  id: string; claimSessionId: string; evidenceDocumentId: string | null; expiresAt: string;
  memberName: string; eventType: string | null; eventSummary: string | null; documentCount: number;
};

/** DearPolicy's internal reviewer area: only the signed-in reviewer's own
 * active assignments. Not part of household navigation. */
export default function ReviewerHomePage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/reviewer/assignments").then(async (res) => {
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "This area is only for assigned DearPolicy reviewers."); return; }
      setLabel(json.reviewer?.displayLabel ?? "");
      setAssignments(json.assignments ?? []);
    }).catch(() => setError("Could not load your assignments."));
  }, []);

  if (error) return <div className="page"><div className="alert error" role="alert"><strong>{error}</strong></div></div>;
  if (!assignments) return <div className="page"><div className="empty-card">Loading assignments…</div></div>;

  return (
    <div className="page">
      <header className="page-header"><div>
        <div className="eyebrow">DEARPOLICY REVIEWER</div>
        <h1>Assigned reviews</h1>
        <p className="lead">Signed in as {label}. You can open only the claims assigned to you, and only until each assignment ends.</p>
      </div></header>
      <section className="section">
        {assignments.length === 0 ? <div className="empty-card">No active assignments.</div> : assignments.map((a) => (
          <Link key={a.id} href={`/reviewer/assignments/${a.id}`} className="action-card" style={{ gridTemplateColumns: "1fr", marginBottom: 12, display: "grid" }}>
            <div>
              <strong>{a.memberName}</strong> <span className="status">{a.eventType ?? "claim"}</span>{" "}
              <span className="status">{a.evidenceDocumentId ? "one document" : `${a.documentCount} document${a.documentCount === 1 ? "" : "s"}`}</span>
              {a.eventSummary && <p>{a.eventSummary}</p>}
              <p className="muted">Assignment ends {new Date(a.expiresAt).toLocaleString()}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
