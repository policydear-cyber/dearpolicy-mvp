"use client";

import { useCallback, useEffect, useState } from "react";
import type { IndicativeEstimateView } from "@/lib/claims/indicative-assessment";

/** The indicative estimate for this claim, computed fresh on the server
 * through the evidence-gated engine every time it is shown. A benefit that
 * is not fully evidenced is listed without an amount, with the reason.
 * Totals are per currency; nothing is added across currencies. */
export function IndicativeEstimatePanel({ claimSessionId, refreshKey }: { claimSessionId: string; refreshKey: string }) {
  const [estimate, setEstimate] = useState<IndicativeEstimateView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const res = await fetch(`/api/claims/${claimSessionId}/indicative`, { cache: "no-store" });
    if (!res.ok) { setError("The claim assessment could not be loaded. Please try again."); return; }
    setError("");
    setEstimate(((await res.json()) as { estimate: IndicativeEstimateView }).estimate);
  }, [claimSessionId]);
  useEffect(() => { void load(); }, [load, refreshKey]);

  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (!estimate) return <p className="muted">Checking the reviewed evidence…</p>;
  return (
    <div data-testid="indicative-estimate" data-has-estimate={estimate.hasEstimate ? "yes" : "no"}>
      <p className="muted" data-testid="indicative-estimate-notice">{estimate.notice}</p>
      {!estimate.hasEstimate && <p data-testid="indicative-no-estimate">No estimate yet: the evidence on file does not yet support an amount for any benefit. The reasons are listed below.</p>}
      <ul className="indicative-benefits">
        {estimate.benefits.map((b, i) => (
          <li key={i} data-testid="indicative-benefit" data-status={b.status} data-currency={b.currency ?? ""}>
            <strong>{b.title}</strong>{" "}
            {b.status === "included" ? <span className="indicative-amount">{b.amountText}</span> : <span className="status">No amount</span>}
            <div className="muted">{b.reason}</div>
            {b.citations.length > 0 && <div className="muted indicative-citation">Policy wording: {b.citations.map((c) => (c.pageStart == null ? `${c.policyName}, page not recorded` : `${c.policyName}, page ${c.pageStart}${c.pageEnd != null && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""}`)).join("; ")}</div>}
          </li>
        ))}
      </ul>
      {estimate.totalsByCurrency.length > 0 && (
        <div data-testid="indicative-totals">
          <small>Indicative total, per currency (currencies are never added together)</small>
          <ul>{estimate.totalsByCurrency.map((t) => <li key={t.currency} data-testid="indicative-total" data-currency={t.currency}>{t.currency}: {t.amountText}</li>)}</ul>
        </div>
      )}
      {estimate.outstandingQuestions.length > 0 && <ul className="muted">{estimate.outstandingQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>}
    </div>
  );
}
