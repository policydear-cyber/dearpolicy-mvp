"use client";
import { useEffect, useState } from "react";

type ServiceState = { ok: boolean; label: string; detail: string; fix?: string };

/** Live service status (database, reading/answering model, semantic
 * search) -- operator-only; households never see this. */
export function OperatorStatusPanel() {
  const [services, setServices] = useState<ServiceState[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        // Checked too often from this address (lib/http/open-endpoint-limit.ts): say so instead of "not answering".
        if (response.status === 429) { if (!cancelled) setError("Checking too often. Try again shortly."); return; }
        const payload = await response.json();
        if (!cancelled) { setServices(payload.services ?? []); setError(""); }
      } catch {
        if (!cancelled) setError("The app server is not answering.");
      }
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!services) return <p className="muted">Checking services…</p>;
  return (
    <div className="schedule-table-scroll"><table className="schedule-table" data-testid="operator-status">
      <thead><tr><th>Service</th><th>State</th><th>Detail</th><th>Fix</th></tr></thead>
      <tbody>{services.map((s) => <tr key={s.label}><td><strong>{s.label}</strong></td><td>{s.ok ? "OK" : "Down"}</td><td>{s.detail}</td><td>{s.fix ?? ""}</td></tr>)}</tbody>
    </table></div>
  );
}
