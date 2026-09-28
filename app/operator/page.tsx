import Link from "next/link";
import { budgetConfig, startOfMonth, usageByOperationAndModel, type UsageReport } from "@/lib/ai/usage";
import { OperatorStatusPanel } from "./status-panel";

export const dynamic = "force-dynamic";

const usd = (v: number) => "$" + v.toFixed(v > 0 && v < 0.1 ? 4 : 2);

/** Operator overview: service status and this month's recorded model usage
 * and cost, by operation and model, for the whole provider account (all
 * households, aggregated -- no household names or contents). Recorded usage
 * comes from model_executions (lib/ai/usage.ts); nothing here is estimated. */
export default async function OperatorOverviewPage() {
  const since = startOfMonth();
  let report: UsageReport | null = null;
  let usageError = "";
  try {
    report = await usageByOperationAndModel(null, since);
  } catch (error) {
    usageError = error instanceof Error ? error.message : String(error);
  }
  const budget = budgetConfig();
  const owner = budget.ownerProviderBudget;
  const spent = report?.costUsd ?? 0;
  const ownerPct = owner.amountUsd ? Math.min(100, Math.round((spent / owner.amountUsd) * 100)) : null;
  const month = since.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="page" data-testid="operator-overview">
      <header className="page-header compact"><div>
        <div className="eyebrow">OPERATOR</div>
        <h1>System overview</h1>
        <p className="lead">Service status, and recorded model usage and cost for {month}. This area is for DearPolicy staff only; none of it is shown to households.</p>
      </div></header>

      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">SERVICES</div><h2>Status</h2></div></div>
        <OperatorStatusPanel />
      </section>

      <section className="section" data-testid="operator-budget">
        <div className="section-heading"><div><div className="eyebrow">BUDGETS</div><h2>Model spend against budgets</h2></div></div>
        <div className="schedule-summary">
          <div><strong>{usd(spent)}</strong><span>recorded model cost this month, all households</span></div>
          <div><strong>{owner.amountUsd != null ? usd(owner.amountUsd) : "Not set"}</strong><span>owner&rsquo;s monthly provider budget{ownerPct != null ? ` · ${ownerPct}% used` : ""}</span></div>
          <div><strong>{usd(budget.householdLimit.amountUsd)}</strong><span>DearPolicy per-household monthly stop</span></div>
        </div>
        {owner.amountUsd != null && <div className="progress-track" aria-label="Spend against the owner's provider budget"><div className="progress-fill" style={{ width: `${Math.max(1, ownerPct ?? 0)}%` }} /></div>}
        <ul className="muted">
          <li><b>Owner&rsquo;s provider budget</b> ({owner.source === "owner_setting" ? "owner setting OWNER_PROVIDER_BUDGET_USD" : "not configured"}): the monthly cap set on the model provider account. The provider enforces it; DearPolicy does not and cannot. This page only compares recorded spend with it, so a provider-side charge DearPolicy did not record would not appear here.</li>
          <li><b>Per-household stop</b>: enforced by DearPolicy before every hosted model call, for the household the call is for.</li>
          <li><b>Subscription price</b> is separate from both: it is what a household pays DearPolicy, not a limit on model spend.</li>
        </ul>
      </section>

      <section className="section" data-testid="operator-usage">
        <div className="section-heading"><div><div className="eyebrow">USAGE</div><h2>By operation and model</h2></div>
          {report && <small>{report.calls} call{report.calls === 1 ? "" : "s"} · {report.failedCalls} failed · {report.unpricedCalls} without a price</small>}</div>
        {usageError ? <div className="alert error" role="alert">Usage could not be read: {usageError}</div> : null}
        {report && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Operation</th><th>Role</th><th>Provider</th><th>Model</th><th>Calls</th><th>Failed</th><th>Tokens in</th><th>Tokens out</th><th>Cached</th><th>Cost</th></tr></thead>
            <tbody>
              {report.rows.map((r) => <tr key={`${r.operation}|${r.role}|${r.provider}|${r.model}`}>
                <td><strong>{r.operation}</strong></td><td>{r.role}</td><td>{r.provider}</td><td>{r.model}</td><td>{r.calls}</td><td>{r.failedCalls}</td>
                <td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td><td>{r.cachedTokens.toLocaleString()}</td>
                <td className="pays-cell">{usd(r.costUsd)}{r.unpricedCalls ? ` (+${r.unpricedCalls} unpriced)` : ""}</td>
              </tr>)}
              {!report.rows.length && <tr><td colSpan={10}><em>No model calls recorded since {since.toISOString().slice(0, 10)}.</em></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><div className="eyebrow">TOOLS</div><h2>Extraction review and diagnostics</h2></div></div>
        <p className="muted">These act on the household you are signed in to.</p>
        <ul>
          <li><Link className="text-link" href="/operator/documents">Document processing</Link> — processing stages, raw errors, re-analysis, search index.</li>
          <li><Link className="text-link" href="/operator/benefits">Benefit extraction</Link> — every extracted benefit rule, table-heading confirmations, corrections, re-reading.</li>
          <li><Link className="text-link" href="/operator/coverage">Coverage rows</Link> — the coverage ledger rows, their origin, fixes and manual rows.</li>
        </ul>
      </section>
    </div>
  );
}
