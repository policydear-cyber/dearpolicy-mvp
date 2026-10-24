"use client";

import { useState } from "react";

type ExportState = { id: string; status: "pending" | "running" | "ready" | "failed" | "expired"; byteSize: number | null; expiresAt: string | null };

const statusCopy: Record<ExportState["status"], string> = {
  pending: "Preparing your download…",
  running: "Preparing your download…",
  ready: "Your download is ready.",
  failed: "The download could not be prepared. Please try again.",
  expired: "This download has expired. Prepare a new one.",
};

/** Owner-only household data export, using the existing authorised export
 * routes (app/api/household/export/*): one idempotent request per click, the
 * status polled, then a download link served by the owner-only download
 * route. Never shows file paths or storage details. */
export function HouseholdExportPanel() {
  const [state, setState] = useState<ExportState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function poll(id: string) {
    for (let i = 0; i < 150; i++) {
      const res = await fetch(`/api/household/export/${id}`, { cache: "no-store" });
      if (res.ok) {
        const row = (await res.json()) as ExportState;
        setState(row);
        if (row.status === "ready" || row.status === "failed" || row.status === "expired") return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    setMessage("Still preparing. Check back in a few minutes.");
  }

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/household/export", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) { setMessage("Please sign in again, then prepare the download."); return; }
      if (res.status === 403) { setMessage("Only the household owner can download the household's data."); return; }
      if (!res.ok) { setMessage("The download could not be started. Please try again."); return; }
      setState(body as ExportState);
      await poll((body as ExportState).id);
    } finally {
      setBusy(false);
    }
  }

  const size = state?.byteSize ? ` (${Math.max(1, Math.round(state.byteSize / 1024))} KB)` : "";
  return (
    <section className="section" data-testid="household-export">
      <div className="section-heading"><div><h2>Download your household&apos;s data</h2><p>A copy of everything this household has stored in DearPolicy: family members, policy details and claims. It is prepared in the background and can be downloaded once.</p></div></div>
      <div className="settings-panel">
      <button className="button secondary" type="button" onClick={() => void start()} disabled={busy}>{busy ? "Preparing…" : "Prepare my download"}</button>
      {state && <p className="lead" data-testid="household-export-status">{statusCopy[state.status]}</p>}
      {state?.status === "ready" && <p><a className="button primary" data-testid="household-export-download" href={`/api/household/export/${state.id}/download`} download>Download{size}</a>{state.expiresAt ? <small> Available until {new Date(state.expiresAt).toLocaleString()}.</small> : null}</p>}
      {message && <p className="lead">{message}</p>}
      </div>
    </section>
  );
}
