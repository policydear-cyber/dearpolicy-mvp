import Link from "next/link";
import { requireAdminOrNotFound } from "@/lib/admin/access";
import {
  ERROR_WINDOW_LABEL, TREND_DAYS, readFailedModelCalls, readHouseholds, readRecentProcessingFailures, readRecentSignups, readStuckJobs,
  readTotals, readTrends, type Section,
} from "@/lib/admin/console";
import { plural, shortId, usd, when } from "@/lib/admin/format";
import { PLANS, PLAN_ORDER } from "@/lib/plans/catalogue";
import { HouseholdsTable } from "./_components/households-table";
import { TrendChart } from "./_components/trend-chart";

export const dynamic = "force-dynamic";

function Unavailable({ s }: { s: Section<unknown> }) {
  return s.ok ? null : <p className="admin-unavailable" role="status">{s.reason}</p>;
}

const count = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const sum = (xs: number[] | null) => (xs ? xs.reduce((a, b) => a + b, 0) : null);

/** "3 more than the week before", "2 fewer than…", "the same as…". */
function weekChange(now: number | null, before: number | null): string {
  if (now == null || before == null) return "";
  const d = now - before;
  if (d === 0) return "Same as the week before";
  return `${Math.abs(d).toLocaleString()} ${d > 0 ? "more" : "fewer"} than the week before`;
}

function Kpi({ label, value, note, tone, testId }: { label: string; value: string; note?: React.ReactNode; tone?: "critical" | "warn"; testId?: string }) {
  return (
    <div className={`admin-kpi${tone ? " " + tone : ""}`} data-testid={testId}>
      <span className="admin-kpi-label">{label}</span>
      <strong className="admin-kpi-value">{value}</strong>
      {note ? <span className="admin-kpi-note">{note}</span> : null}
    </div>
  );
}

/** Admin overview: headline numbers, 30-day trends, then every household in a table you can search, sort and download.
 * View only; lib/admin/console.ts says what is and isn't read. */
export default async function AdminOverviewPage() {
  await requireAdminOrNotFound();
  const [totals, trends, recent, households, failures, modelFailures, jobs] = await Promise.all([
    readTotals(), readTrends(), readRecentSignups(), readHouseholds(), readRecentProcessingFailures(), readFailedModelCalls(), readStuckJobs(),
  ]);
  const now = Date.now();
  const month = new Date(now).toLocaleDateString("en-GB", { month: "long", timeZone: "Asia/Singapore" });
  const t = totals.ok ? totals.data : null;
  const h = households.ok ? households.data : null;

  const questionsThisMonth = h && h.questionsAvailable ? h.rows.reduce((n, r) => n + (r.questionsThisMonth ?? 0), 0) : null;
  const askingHouseholds = h && h.questionsAvailable ? h.rows.filter((r) => (r.questionsThisMonth ?? 0) > 0).length : null;
  const readPct = t && t.documents ? Math.round((t.documentsRead / t.documents) * 100) : null;
  const errorCount = (failures.ok ? failures.data.length : 0)
    + (modelFailures.ok ? modelFailures.data.reduce((n, m) => n + m.calls, 0) : 0)
    + (jobs.ok ? jobs.data.reduce((n, j) => n + j.jobs, 0) : 0);
  const errorsKnown = failures.ok || modelFailures.ok || jobs.ok;
  const failuresCapped = failures.ok && failures.data.length >= 50;

  const tr = trends.ok ? trends.data : null;
  const accounts30 = tr ? sum(tr.accounts) : null;
  const questions30 = tr ? sum(tr.questions) : null;
  const spend30 = tr ? sum(tr.spendUsd) : null;

  const planCounts = h ? PLAN_ORDER.map((id) => ({ id, n: h.rows.filter((r) => r.plan === id).length })) : [];
  const planTotal = planCounts.reduce((n, p) => n + p.n, 0);
  const whenLabels = Object.fromEntries((h?.rows ?? []).map((r) => [r.id, { created: when(r.createdAt), lastSignIn: when(r.lastSignInAt) }]));

  return (
    <div className="page admin" data-testid="admin-overview">
      <header className="page-header compact"><div>
        <h1>Admin console</h1>
        <p className="lead">Everything across DearPolicy&rsquo;s households, at a glance. View only. Times are Singapore time.</p>
      </div></header>

      <nav className="admin-seg admin-jump" aria-label="Sections">
        <a className="admin-seg-item" href="#trends">Trends</a>
        <a className="admin-seg-item" href="#households">Households</a>
        <a className="admin-seg-item" href="#accounts">New accounts</a>
        <a className="admin-seg-item" href="#errors">Errors</a>
      </nav>

      <section aria-labelledby="kpi-h" data-testid="admin-totals">
        <h2 id="kpi-h" className="sr-only">Headline numbers</h2>
        <Unavailable s={totals} />
        <div className="admin-kpis">
          <Kpi testId="kpi-signups" label="New accounts, last 7 days" value={count(t?.signups7d)} note={weekChange(t?.signups7d ?? null, t?.signupsPrev7d ?? null) || (t?.accounts != null ? `${count(t.accounts)} accounts in all` : undefined)} />
          <Kpi testId="kpi-households" label="Households" value={count(t?.households)} note={t?.activeHouseholds30d != null ? `${count(t.activeHouseholds30d)} signed in during the last 30 days` : undefined} />
          <Kpi testId="kpi-documents" label="Documents kept" value={count(t?.documents)}
            note={t ? <>{readPct != null ? `${readPct}% read` : "None yet"}{t.documentsInProgress ? ` · ${count(t.documentsInProgress)} still being read` : ""}</> : undefined} />
          <Kpi testId="kpi-unreadable" label="Couldn’t be read" value={count(t?.documentsUnreadable)} tone={t?.documentsUnreadable ? "critical" : undefined}
            note={t?.documentsUnreadable ? "Documents that need a look" : "None"} />
          <Kpi testId="kpi-questions" label={`Questions asked in ${month}`} value={count(questionsThisMonth)}
            note={askingHouseholds != null ? `from ${plural(askingHouseholds, "household")}` : "The table they come from isn’t set up yet"} />
          <Kpi testId="kpi-spend" label={`Model spend in ${month}`} value={h ? usd(h.spendTotalUsd) : "—"} note={h && t?.households ? `about ${usd(h.spendTotalUsd / Math.max(1, t.households))} per household` : undefined} />
          <Kpi testId="kpi-errors" label={`Errors, ${ERROR_WINDOW_LABEL}`} value={errorsKnown ? `${errorCount.toLocaleString()}${failuresCapped ? "+" : ""}` : "—"} tone={errorCount ? "warn" : undefined}
            note={errorCount ? <a className="text-link" href="#errors">See what failed</a> : "Nothing failed"} />
        </div>
      </section>

      <section id="trends" className="section" aria-labelledby="trends-h">
        <div className="section-heading"><h2 id="trends-h">Last {TREND_DAYS} days</h2></div>
        <Unavailable s={trends} />
        {tr && (
          <div className="admin-charts">
            <TrendChart testId="chart-accounts" title="New accounts per day" summary={accounts30 == null ? "—" : `${accounts30.toLocaleString()} in ${TREND_DAYS} days`} days={tr.days} values={tr.accounts}
              unavailable="Sign-ups come from Supabase Auth, which can’t be read from this database." />
            <TrendChart testId="chart-questions" title="Questions per day" summary={questions30 == null ? "—" : `${questions30.toLocaleString()} in ${TREND_DAYS} days`} days={tr.days} values={tr.questions}
              unavailable="Questions come from the chat tables, which aren’t set up yet." />
            <TrendChart testId="chart-spend" title="Model spend per day" summary={spend30 == null ? "—" : `${usd(spend30)} in ${TREND_DAYS} days`} days={tr.days} values={tr.spendUsd} format={usd}
              unavailable="Spend comes from the model-usage table, which isn’t set up yet." />
          </div>
        )}
        <div className="admin-split">
          {t && (
            <section className="admin-panel" data-testid="admin-doc-status">
              <header className="admin-panel-head"><h3>Document reading</h3><strong className="admin-chart-summary">{count(t.documents)} kept</strong></header>
              {t.documents ? (
                <>
                  <div className="admin-stack" role="img" aria-label={`${t.documentsRead} read, ${t.documentsInProgress} still being read, ${t.documentsUnreadable} couldn't be read`}>
                    {t.documentsRead > 0 && <span className="admin-stack-seg good" style={{ flexGrow: t.documentsRead }} />}
                    {t.documentsInProgress > 0 && <span className="admin-stack-seg info" style={{ flexGrow: t.documentsInProgress }} />}
                    {t.documentsUnreadable > 0 && <span className="admin-stack-seg critical" style={{ flexGrow: t.documentsUnreadable }} />}
                  </div>
                  <ul className="admin-legend">
                    <li><span className="admin-dot good" aria-hidden="true" />Read <b>{count(t.documentsRead)}</b></li>
                    <li><span className="admin-dot info" aria-hidden="true" />Still being read or on hold <b>{count(t.documentsInProgress)}</b></li>
                    <li><span className="admin-dot critical" aria-hidden="true" />Couldn&rsquo;t be read <b>{count(t.documentsUnreadable)}</b></li>
                  </ul>
                </>
              ) : <p className="muted">No documents uploaded yet.</p>}
            </section>
          )}
          {h && (
            <section className="admin-panel" data-testid="admin-plans">
              <header className="admin-panel-head"><h3>Plans</h3><strong className="admin-chart-summary">{plural(planTotal, "household")}</strong></header>
              <ul className="admin-bars">
                {planCounts.map((p) => (
                  <li key={p.id}>
                    <span>{PLANS[p.id].name}</span>
                    <span className="admin-hbar" aria-hidden="true"><span style={{ width: `${planTotal ? Math.max(p.n ? 2 : 0, Math.round((p.n / planTotal) * 100)) : 0}%` }} /></span>
                    <b>{p.n.toLocaleString()}</b>
                  </li>
                ))}
              </ul>
              {!h.plansStored && <p className="admin-note">The plans table isn&rsquo;t set up yet, so every household shows as Free.</p>}
            </section>
          )}
        </div>
      </section>

      <section id="households" className="section" aria-labelledby="hh-h">
        <div className="section-heading"><h2 id="hh-h">Households</h2></div>
        <Unavailable s={households} />
        {h && (
          <>
            <HouseholdsTable rows={h.rows} now={now} whenLabels={whenLabels} />
            <p className="admin-note">
              Questions and spend are for {month}.{" "}
              {!h.questionsAvailable ? "Questions aren’t available: the table they come from isn’t set up yet." : h.questionsSource === "kept_count" ? "Questions are the counted questions plan limits use." : "Questions are the ones still on file (plan limits are off, so nothing is counted yet)."}
              {h.truncated ? " Only the newest 500 households are listed." : ""}
              {h.spendUnattributedUsd > 0 ? ` ${usd(h.spendUnattributedUsd)} of this month’s spend isn’t tied to a listed household (sign-in, background or test calls${h.truncated ? ", or households beyond the list" : ""}).` : ""}
            </p>
          </>
        )}
      </section>

      <section id="accounts" className="section" aria-labelledby="acc-h">
        <div className="section-heading"><h2 id="acc-h">Newest accounts</h2></div>
        <Unavailable s={recent} />
        {recent.ok && !recent.data && <p className="admin-unavailable">Newest accounts aren&rsquo;t available: Supabase Auth&rsquo;s user list can&rsquo;t be read from this database.</p>}
        {recent.ok && recent.data && (
          <div className="admin-panel admin-table-panel"><div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Email</th><th>Signed up</th><th>Email confirmed</th><th>Last sign-in</th><th>Household</th></tr></thead>
            <tbody>
              {recent.data.map((u, i) => (
                <tr key={`${u.email}-${i}`}>
                  <td className="admin-email">{u.email ?? "—"}</td><td>{when(u.createdAt)}</td>
                  <td>{u.confirmed ? <span className="admin-flag good">Confirmed</span> : <span className="admin-flag warn">Not yet</span>}</td>
                  <td>{when(u.lastSignInAt)}</td>
                  <td>{u.householdId ? <Link className="admin-row-link" href={`/admin/households/${u.householdId}`}>{shortId(u.householdId)}</Link> : <span className="muted">None</span>}</td>
                </tr>
              ))}
              {!recent.data.length && <tr><td colSpan={5} className="admin-empty-row">No accounts yet.</td></tr>}
            </tbody>
          </table></div></div>
        )}
      </section>

      <section id="errors" className="section" aria-labelledby="err-h">
        <div className="section-heading"><h2 id="err-h">Errors, {ERROR_WINDOW_LABEL}</h2></div>
        <p className="admin-note">Codes and categories only: raw error text can quote a document, so it isn&rsquo;t shown. Server crashes outside these lists are in Vercel&rsquo;s runtime logs.</p>
        <div className="admin-errors">
          <section className="admin-panel admin-table-panel">
            <header className="admin-panel-head"><h3>Documents that stopped being read</h3><strong className="admin-chart-summary">{failures.ok ? `${failures.data.length}${failuresCapped ? "+" : ""}` : "—"}</strong></header>
            <Unavailable s={failures} />
            {failures.ok && (failures.data.length ? (
              <div className="admin-table-scroll"><table className="admin-table">
                <thead><tr><th>When</th><th>Household</th><th>What</th><th>Failure</th><th>Error type</th></tr></thead>
                <tbody>
                  {failures.data.map((f, i) => (
                    <tr key={`${f.resourceId}-${i}`}>
                      <td>{when(f.occurredAt)}</td>
                      <td><Link className="admin-row-link" href={`/admin/households/${f.householdId}`}>{shortId(f.householdId)}</Link></td>
                      <td>{f.resourceType.replace(/_/g, " ")}</td><td><code>{f.failureCode}</code></td><td>{f.errorClass ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            ) : <p className="admin-ok">Nothing failed.</p>)}
          </section>
          <section className="admin-panel admin-table-panel">
            <header className="admin-panel-head"><h3>Failed model calls</h3><strong className="admin-chart-summary">{modelFailures.ok ? modelFailures.data.reduce((n, m) => n + m.calls, 0).toLocaleString() : "—"}</strong></header>
            <Unavailable s={modelFailures} />
            {modelFailures.ok && (modelFailures.data.length ? (
              <div className="admin-table-scroll"><table className="admin-table">
                <thead><tr><th>Operation</th><th>Error category</th><th className="num">Calls</th><th>Last</th></tr></thead>
                <tbody>{modelFailures.data.map((m) => <tr key={`${m.operation}|${m.errorCategory}`}><td>{m.operation}</td><td>{m.errorCategory ?? "—"}</td><td className="num">{m.calls}</td><td>{when(m.lastAt)}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="admin-ok">Nothing failed.</p>)}
          </section>
          <section className="admin-panel admin-table-panel">
            <header className="admin-panel-head"><h3>Background jobs that failed</h3><strong className="admin-chart-summary">{jobs.ok ? jobs.data.reduce((n, j) => n + j.jobs, 0).toLocaleString() : "—"}</strong></header>
            <Unavailable s={jobs} />
            {jobs.ok && (jobs.data.length ? (
              <div className="admin-table-scroll"><table className="admin-table">
                <thead><tr><th>Job</th><th>State</th><th>Error category</th><th className="num">Jobs</th><th>Last</th></tr></thead>
                <tbody>{jobs.data.map((j) => <tr key={`${j.jobType}|${j.status}|${j.errorCategory}`}><td>{j.jobType}</td><td>{j.status === "dead_letter" ? "Gave up" : "Will retry"}</td><td>{j.errorCategory ?? "—"}</td><td className="num">{j.jobs}</td><td>{when(j.lastAt)}</td></tr>)}</tbody>
              </table></div>
            ) : <p className="admin-ok">Nothing failed.</p>)}
          </section>
        </div>
      </section>
    </div>
  );
}
