import Link from "next/link";
import { requireAdminOrNotFound } from "@/lib/admin/access";
import {
  ERROR_WINDOW_LABEL, readFailedModelCalls, readHouseholds, readRecentProcessingFailures, readRecentSignups, readSignupsByDay,
  readStuckJobs, readTotals, type Section,
} from "@/lib/admin/console";
import { day, plural, shortId, usd, when } from "@/lib/admin/format";
import { PLANS } from "@/lib/plans/catalogue";

export const dynamic = "force-dynamic";

function Unavailable({ s }: { s: Section<unknown> }) {
  return s.ok ? null : <div className="empty-card" role="status">{s.reason}</div>;
}

const count = (n: number | null) => (n == null ? "—" : n.toLocaleString());

/** Admin overview: every household at a glance. Read-only; see lib/admin/console.ts for what is and isn't read. */
export default async function AdminOverviewPage() {
  await requireAdminOrNotFound();
  const [totals, signups, recent, households, failures, modelFailures, jobs] = await Promise.all([
    readTotals(), readSignupsByDay(), readRecentSignups(), readHouseholds(), readRecentProcessingFailures(), readFailedModelCalls(), readStuckJobs(),
  ]);
  const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const peak = signups.ok ? Math.max(1, ...signups.data.map((d) => Math.max(d.accounts ?? 0, d.households))) : 1;
  const planCounts = households.ok
    ? (["free", "plus", "family"] as const).map((id) => ({ id, n: households.data.rows.filter((h) => h.plan === id).length }))
    : [];

  return (
    <div className="page" data-testid="admin-overview">
      <header className="page-header compact"><div>
        <div className="eyebrow">ADMIN</div>
        <h1>Admin console</h1>
        <p className="lead">Every household on DearPolicy: sign-ups, plans, usage, documents and recent errors. Read-only. Times are Singapore time.</p>
      </div></header>

      <section className="section" data-testid="admin-totals">
        <div className="section-heading"><div><h2>At a glance</h2></div></div>
        <Unavailable s={totals} />
        {totals.ok && (
          <div className="schedule-summary">
            <div><strong>{count(totals.data.households)}</strong><span>households</span></div>
            <div><strong>{count(totals.data.accounts)}</strong><span>accounts{totals.data.confirmedAccounts != null ? ` · ${count(totals.data.confirmedAccounts)} confirmed` : ""}</span></div>
            <div><strong>{count(totals.data.signups7d)}</strong><span>sign-ups, last 7 days</span></div>
            <div><strong>{count(totals.data.signups30d)}</strong><span>sign-ups, last 30 days</span></div>
            <div><strong>{count(totals.data.documents)}</strong><span>current documents</span></div>
            <div><strong>{count(totals.data.documentsRead)}</strong><span>read</span></div>
            <div className={totals.data.documentsUnreadable ? "warn" : undefined}><strong>{count(totals.data.documentsUnreadable)}</strong><span>couldn&rsquo;t be read</span></div>
            <div><strong>{count(totals.data.documentsInProgress)}</strong><span>still being read or on hold</span></div>
            {households.ok && <div><strong>{usd(households.data.spendTotalUsd)}</strong><span>model spend in {month}</span></div>}
          </div>
        )}
      </section>

      <section className="section" data-testid="admin-signups">
        <div className="section-heading"><div><h2>Sign-ups, last 14 days</h2></div></div>
        <Unavailable s={signups} />
        {signups.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Day</th><th>New accounts</th><th>New households</th><th aria-hidden="true"></th></tr></thead>
            <tbody>
              {[...signups.data].reverse().map((d) => (
                <tr key={d.day}>
                  <td>{day(d.day)}</td><td>{count(d.accounts)}</td><td>{d.households}</td>
                  <td style={{ minWidth: 120 }} aria-hidden="true">
                    <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(((d.accounts ?? d.households) / peak) * 100)}%` }} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {recent.ok && !recent.data && <p className="muted">Newest accounts aren&rsquo;t available: Supabase Auth&rsquo;s user list can&rsquo;t be read from this database.</p>}
        {recent.ok && recent.data && (
          <>
            <h3>Newest accounts</h3>
            <div className="schedule-table-scroll"><table className="schedule-table">
              <thead><tr><th>Email</th><th>Signed up</th><th>Email confirmed</th><th>Last sign-in</th><th>Household</th></tr></thead>
              <tbody>
                {recent.data.map((u, i) => (
                  <tr key={`${u.email}-${i}`}>
                    <td>{u.email ?? <em>No email</em>}</td><td>{when(u.createdAt)}</td>
                    <td>{u.confirmed ? "Yes" : <span className="schedule-flag">Not yet</span>}</td>
                    <td>{when(u.lastSignInAt)}</td>
                    <td>{u.householdId ? <Link className="text-link" href={`/admin/households/${u.householdId}`}>{shortId(u.householdId)}</Link> : <em>None</em>}</td>
                  </tr>
                ))}
                {!recent.data.length && <tr><td colSpan={5}><em>No accounts yet.</em></td></tr>}
              </tbody>
            </table></div>
          </>
        )}
      </section>

      <section className="section" data-testid="admin-households">
        <div className="section-heading"><div><h2>Households</h2></div>
          {households.ok && <small>{plural(households.data.rows.length, "household")}{households.data.truncated ? " (newest 500 shown)" : ""}</small>}</div>
        <Unavailable s={households} />
        {households.ok && (
          <>
            <p className="muted">
              Plans: {planCounts.map((p) => `${PLANS[p.id].name} ${p.n}`).join(" · ")}.
              {!households.data.plansStored && " The plans table isn’t set up yet, so every household shows as Free."}
              {" "}{!households.data.questionsAvailable ? "Questions this month aren’t available: the table they come from isn’t set up yet." : households.data.questionsSource === "kept_count" ? "Questions this month are the counted questions plan limits use." : "Questions this month are the questions still on file (plan limits are off, so nothing is counted yet)."}
              {households.data.spendUnattributedUsd > 0 && ` ${usd(households.data.spendUnattributedUsd)} of this month’s model spend isn’t tied to a listed household (sign-in, background or test calls${households.data.truncated ? ", or households beyond the list" : ""}).`}
            </p>
            <div className="schedule-table-scroll"><table className="schedule-table">
              <thead><tr><th>Household</th><th>Owner</th><th>Created</th><th>Plan</th><th>Members</th><th>People</th><th>Documents</th><th>Read</th><th>Unreadable</th><th>Questions</th><th>Model spend</th><th>Last sign-in</th></tr></thead>
              <tbody>
                {households.data.rows.map((h) => (
                  <tr key={h.id}>
                    <td><Link className="text-link" href={`/admin/households/${h.id}`}><strong>{h.name || shortId(h.id)}</strong></Link><br /><small className="muted">{shortId(h.id)}</small></td>
                    <td>{h.ownerEmail ?? <em>—</em>}</td>
                    <td>{when(h.createdAt)}</td>
                    <td>{PLANS[h.plan].name}{h.planStatus && h.planStatus !== "active" ? <><br /><small className="muted">{h.planStatus.replace(/_/g, " ")}</small></> : null}</td>
                    <td>{h.members}</td><td>{h.people}</td><td>{h.documents}</td><td>{h.documentsRead}</td>
                    <td>{h.documentsUnreadable ? <span className="status failed">{h.documentsUnreadable}</span> : 0}</td>
                    <td>{h.questionsThisMonth ?? "—"}</td>
                    <td>{usd(h.spendUsd)}</td>
                    <td>{when(h.lastSignInAt)}</td>
                  </tr>
                ))}
                {!households.data.rows.length && <tr><td colSpan={12}><em>No households yet.</em></td></tr>}
              </tbody>
            </table></div>
          </>
        )}
      </section>

      <section className="section" data-testid="admin-errors">
        <div className="section-heading"><div><h2>Recent errors</h2></div><small>{ERROR_WINDOW_LABEL}</small></div>
        <p className="muted">Codes and categories only; raw error text can quote a document, so it isn&rsquo;t shown here. Server crashes outside these lists are in Vercel&rsquo;s runtime logs.</p>

        <h3>Documents that stopped being read</h3>
        <Unavailable s={failures} />
        {failures.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>When</th><th>Household</th><th>What</th><th>Failure</th><th>Error type</th></tr></thead>
            <tbody>
              {failures.data.map((f, i) => (
                <tr key={`${f.resourceId}-${i}`}>
                  <td>{when(f.occurredAt)}</td>
                  <td><Link className="text-link" href={`/admin/households/${f.householdId}`}>{shortId(f.householdId)}</Link></td>
                  <td>{f.resourceType.replace(/_/g, " ")}</td><td><code>{f.failureCode}</code></td><td>{f.errorClass ?? "—"}</td>
                </tr>
              ))}
              {!failures.data.length && <tr><td colSpan={5}><em>None.</em></td></tr>}
            </tbody>
          </table></div>
        )}

        <h3>Failed model calls</h3>
        <Unavailable s={modelFailures} />
        {modelFailures.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Operation</th><th>Error category</th><th>Calls</th><th>Last</th></tr></thead>
            <tbody>
              {modelFailures.data.map((m) => (
                <tr key={`${m.operation}|${m.errorCategory}`}><td>{m.operation}</td><td>{m.errorCategory ?? "—"}</td><td>{m.calls}</td><td>{when(m.lastAt)}</td></tr>
              ))}
              {!modelFailures.data.length && <tr><td colSpan={4}><em>None.</em></td></tr>}
            </tbody>
          </table></div>
        )}

        <h3>Background jobs that failed</h3>
        <Unavailable s={jobs} />
        {jobs.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Job</th><th>State</th><th>Error category</th><th>Jobs</th><th>Last</th></tr></thead>
            <tbody>
              {jobs.data.map((j) => (
                <tr key={`${j.jobType}|${j.status}|${j.errorCategory}`}>
                  <td>{j.jobType}</td><td>{j.status === "dead_letter" ? "Gave up" : "Will retry"}</td><td>{j.errorCategory ?? "—"}</td><td>{j.jobs}</td><td>{when(j.lastAt)}</td>
                </tr>
              ))}
              {!jobs.data.length && <tr><td colSpan={5}><em>None.</em></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>

    </div>
  );
}
