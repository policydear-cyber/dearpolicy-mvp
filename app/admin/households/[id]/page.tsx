import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminOrNotFound } from "@/lib/admin/access";
import {
  readHouseholdDetail, readHouseholdDocuments, readHouseholdFailures, readHouseholdJobs, readHouseholdMembers, readHouseholdQuestions,
  readHouseholdUsage, type Section,
} from "@/lib/admin/console";
import { plural, shortId, usd, when } from "@/lib/admin/format";
import { PLANS } from "@/lib/plans/catalogue";

export const dynamic = "force-dynamic";

function Unavailable({ s }: { s: Section<unknown> }) {
  return s.ok ? null : <div className="empty-card" role="status">{s.reason}</div>;
}

const STATUS_LABEL: Record<string, string> = {
  ready: "Read", failed: "Couldn’t be read", uploaded: "Uploaded", queued: "Waiting", extracting: "Reading", indexing: "Indexing",
};
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ");

/** One household: members, plan, usage, documents (metadata and read status only) and recent failures. Read-only. */
export default async function AdminHouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminOrNotFound();
  const { id } = await params;
  const found = await readHouseholdDetail(id).catch(() => null);
  if (!found) notFound();
  const household = found;
  const [members, documents, failures, jobs, questions, usage] = await Promise.all([
    readHouseholdMembers(id), readHouseholdDocuments(id), readHouseholdFailures(id), readHouseholdJobs(id), readHouseholdQuestions(id), readHouseholdUsage(id),
  ]);
  const current = documents.ok ? documents.data.filter((d) => !d.replaced) : [];
  const plan = PLANS[household.plan];

  return (
    <div className="page" data-testid="admin-household">
      <header className="page-header compact"><div>
        <div className="eyebrow"><Link className="text-link" href="/admin">ADMIN</Link> · HOUSEHOLD {shortId(household.id)}</div>
        <h1>{household.name || "Unnamed household"}</h1>
        <p className="lead">Created {when(household.createdAt)}. Document contents, file names and chats are not shown here.</p>
      </div></header>

      <section className="section">
        <div className="schedule-summary">
          <div><strong>{plan.name}</strong><span>plan{household.planStatus ? ` · ${household.planStatus.replace(/_/g, " ")}` : ""}{household.plansStored ? "" : " · plans table not set up"}</span></div>
          <div><strong>{household.people}</strong><span>{household.people === 1 ? "person" : "people"} on the account</span></div>
          <div><strong>{current.length}</strong><span>current documents (plan allows {plan.unlimitedDocuments ? "unlimited" : plan.documents})</span></div>
          <div><strong>{questions.ok ? questions.data.questions : "—"}</strong><span>questions this month (plan allows {plan.questionsPerMonth}){questions.ok && questions.data.source === "messages_on_file" ? " · on file" : ""}</span></div>
          <div><strong>{usage.ok ? usd(usage.data.costUsd) : "—"}</strong><span>model spend this month{usage.ok ? ` · ${plural(usage.data.calls, "call")}` : ""}</span></div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Members</h2></div></div>
        <Unavailable s={members} />
        {members.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th>Email confirmed</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {members.data.map((m, i) => (
                <tr key={`${m.email}-${i}`}>
                  <td>{m.email ?? <em>—</em>}</td><td>{m.role === "owner" ? "Owner" : "Member"}</td><td>{when(m.joinedAt)}</td>
                  <td>{m.confirmed == null ? "—" : m.confirmed ? "Yes" : <span className="schedule-flag">Not yet</span>}</td><td>{when(m.lastSignInAt)}</td>
                </tr>
              ))}
              {!members.data.length && <tr><td colSpan={5}><em>No members.</em></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Documents</h2></div>
          {documents.ok && <small>{plural(current.length, "current document")}{documents.data.length > current.length ? ` · ${documents.data.length - current.length} replaced` : ""}</small>}</div>
        <Unavailable s={documents} />
        {documents.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Insurer</th><th>Product</th><th>Kind</th><th>Status</th><th>Pages</th><th>Uploaded</th><th>Finished</th></tr></thead>
            <tbody>
              {documents.data.map((d) => (
                <tr key={d.id} className={d.needsReview ? "needs-review" : undefined}>
                  <td>{d.insurer ?? <em>Not read</em>}</td>
                  <td>{d.product ?? <em>Not read</em>}</td>
                  <td>{d.documentRole ? d.documentRole.replace(/_/g, " ") : "—"}</td>
                  <td>
                    <span className={`status ${d.status}`}>{statusLabel(d.status)}</span>
                    {d.replaced && <span className="schedule-flag">Replaced</span>}
                    {d.quarantine && d.quarantine !== "scan_clean" && <span className="schedule-flag">{d.quarantine.replace(/_/g, " ")}</span>}
                    {d.needsReview && <span className="schedule-flag">Needs review</span>}
                  </td>
                  <td>{d.pages ?? "—"}</td><td>{when(d.uploadedAt)}</td><td>{when(d.readAt)}</td>
                </tr>
              ))}
              {!documents.data.length && <tr><td colSpan={7}><em>No documents uploaded.</em></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Processing failures</h2></div></div>
        <p className="muted">Codes and error types only; raw error text isn&rsquo;t shown.</p>
        <Unavailable s={failures} />
        {failures.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>When</th><th>What</th><th>Item</th><th>Failure</th><th>Error type</th></tr></thead>
            <tbody>
              {failures.data.map((f, i) => (
                <tr key={`${f.resourceId}-${i}`}><td>{when(f.occurredAt)}</td><td>{f.resourceType.replace(/_/g, " ")}</td><td>{shortId(f.resourceId)}</td><td><code>{f.failureCode}</code></td><td>{f.errorClass ?? "—"}</td></tr>
              ))}
              {!failures.data.length && <tr><td colSpan={5}><em>None.</em></td></tr>}
            </tbody>
          </table></div>
        )}
        <h3>Background jobs not finished</h3>
        <Unavailable s={jobs} />
        {jobs.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Job</th><th>State</th><th>Attempts</th><th>Error category</th><th>Updated</th></tr></thead>
            <tbody>
              {jobs.data.map((j, i) => (
                <tr key={`${j.jobType}-${i}`}><td>{j.jobType}</td><td>{j.status.replace(/_/g, " ")}</td><td>{j.attempts}</td><td>{j.errorCategory ?? "—"}</td><td>{when(j.updatedAt)}</td></tr>
              ))}
              {!jobs.data.length && <tr><td colSpan={5}><em>None.</em></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Model usage this month</h2></div>
          {usage.ok && <small>{plural(usage.data.calls, "call")} · {usage.data.failedCalls} failed</small>}</div>
        <Unavailable s={usage} />
        {usage.ok && (
          <div className="schedule-table-scroll"><table className="schedule-table">
            <thead><tr><th>Operation</th><th>Model</th><th>Calls</th><th>Failed</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead>
            <tbody>
              {usage.data.rows.map((r) => (
                <tr key={`${r.operation}|${r.role}|${r.provider}|${r.model}`}>
                  <td>{r.operation}</td><td>{r.model}</td><td>{r.calls}</td><td>{r.failedCalls}</td>
                  <td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td>
                  <td>{usd(r.costUsd)}{r.unpricedCalls ? ` (+${r.unpricedCalls} unpriced)` : ""}</td>
                </tr>
              ))}
              {!usage.data.rows.length && <tr><td colSpan={7}><em>No model calls this month.</em></td></tr>}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
