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
  return s.ok ? null : <p className="admin-unavailable" role="status">{s.reason}</p>;
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "critical" }) {
  return (
    <div className={`admin-kpi${tone ? " " + tone : ""}`}>
      <span className="admin-kpi-label">{label}</span>
      <strong className="admin-kpi-value">{value}</strong>
      {note ? <span className="admin-kpi-note">{note}</span> : null}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  ready: "Read", failed: "Couldn’t be read", uploaded: "Uploaded", queued: "Waiting", extracting: "Reading", indexing: "Indexing",
};
/** Only the malware-scan states worth flagging; a clean or not-yet-scanned upload adds nothing to its status. */
const QUARANTINE_FLAG: Record<string, string> = { scan_pending: "Scan pending", scan_rejected: "Blocked by scan", deleted: "Deleted" };
/** Read is good, failed is critical, everything else is still in progress. The word is always shown with the colour. */
const STATUS_TONE: Record<string, "good" | "critical"> = { ready: "good", failed: "critical" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s.replace(/_/g, " ");

/** One household: members, plan, usage, documents (metadata and read status only) and recent failures. Read-only. */
export default async function AdminHouseholdPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminOrNotFound();
  const { id } = await params;
  const found = await readHouseholdDetail(id).catch(() => null);
  if (!found) notFound();
  const household = found;
  // Every later read uses the id as stored, never the address as typed (an upper-case id would miss the spend lookup).
  const hid = household.id;
  const [members, documents, failures, jobs, questions, usage] = await Promise.all([
    readHouseholdMembers(hid), readHouseholdDocuments(hid), readHouseholdFailures(hid), readHouseholdJobs(hid), readHouseholdQuestions(hid), readHouseholdUsage(hid),
  ]);
  const current = documents.ok ? documents.data.filter((d) => !d.replaced) : [];
  const plan = PLANS[household.plan];
  const unreadable = current.filter((d) => d.status === "failed").length;

  return (
    <div className="page admin" data-testid="admin-household">
      <header className="page-header compact"><div>
        <div className="eyebrow"><Link className="text-link" href="/admin">Admin console</Link> · Household {shortId(household.id)}</div>
        <h1>{household.name || "Unnamed household"}</h1>
        <p className="lead">Created {when(household.createdAt)}. Document contents, file names and chats are not shown here.</p>
      </div></header>

      <section aria-labelledby="hh-kpi-h">
        <h2 id="hh-kpi-h" className="sr-only">Headline numbers</h2>
        <div className="admin-kpis">
          <Kpi label="Plan" value={plan.name} note={[household.planStatus?.replace(/_/g, " "), household.plansStored ? "" : "plans table not set up"].filter(Boolean).join(" · ") || undefined} />
          <Kpi label="People on the account" value={household.people.toLocaleString()} />
          <Kpi label="Current documents" value={documents.ok ? current.length.toLocaleString() : "—"} note={`Plan allows ${plan.unlimitedDocuments ? "unlimited" : plan.documents}`} />
          <Kpi label="Couldn’t be read" value={documents.ok ? unreadable.toLocaleString() : "—"} tone={unreadable ? "critical" : undefined} note={unreadable ? "Documents that need a look" : "None"} />
          <Kpi label="Questions this month" value={questions.ok ? questions.data.questions.toLocaleString() : "—"}
            note={`Plan allows ${plan.questionsPerMonth}${questions.ok && questions.data.source === "messages_on_file" ? " · on file" : ""}`} />
          <Kpi label="Model spend this month" value={usage.ok ? usd(usage.data.costUsd) : "—"} note={usage.ok ? plural(usage.data.calls, "call") : undefined} />
        </div>
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Members</h2></div></div>
        <Unavailable s={members} />
        {members.ok && (
          <div className="admin-panel admin-table-panel"><div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Email</th><th>Role</th><th>Joined</th><th>Email confirmed</th><th>Last sign-in</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {members.data.map((m, i) => (
                <tr key={`${m.email}-${i}`}>
                  <td>{m.email ?? <span className="muted">—</span>}</td><td>{m.role === "owner" ? "Owner" : "Member"}</td><td>{when(m.joinedAt)}</td>
                  <td>{m.confirmed == null ? "—" : m.confirmed ? "Yes" : <span className="admin-flag warn">Not yet</span>}</td><td>{when(m.lastSignInAt)}</td>
                  <td>{m.email ? <Link className="admin-row-link" href={`/admin/accounts?email=${encodeURIComponent(m.email)}`}>Delete…</Link> : null}</td>
                </tr>
              ))}
              {!members.data.length && <tr><td colSpan={6} className="admin-empty-row"><span>No members.</span></td></tr>}
            </tbody>
          </table></div></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Documents</h2></div>
          {documents.ok && <small>{plural(current.length, "current document")}{documents.data.length > current.length ? ` · ${documents.data.length - current.length} replaced` : ""}</small>}</div>
        <Unavailable s={documents} />
        {documents.ok && (
          <div className="admin-panel admin-table-panel"><div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Insurer</th><th>Product</th><th>Kind</th><th>Status</th><th>Pages</th><th>Uploaded</th><th>Finished</th></tr></thead>
            <tbody>
              {documents.data.map((d) => (
                <tr key={d.id}>
                  <td>{d.insurer ?? <span className="muted">Not read</span>}</td>
                  <td>{d.product ?? <span className="muted">Not read</span>}</td>
                  <td>{d.documentRole ? d.documentRole.replace(/_/g, " ") : "—"}</td>
                  <td>
                    <span className={`admin-flag ${STATUS_TONE[d.status] ?? "info"}`}>{statusLabel(d.status)}</span>
                    {(d.replaced || (d.quarantine && QUARANTINE_FLAG[d.quarantine]) || d.needsReview) && (
                      <span className="admin-flags">
                        {d.replaced && <span className="admin-flag info">Replaced</span>}
                        {d.quarantine && QUARANTINE_FLAG[d.quarantine] && <span className="admin-flag warn">{QUARANTINE_FLAG[d.quarantine]}</span>}
                        {d.needsReview && <span className="admin-flag warn">Needs review</span>}
                      </span>
                    )}
                  </td>
                  <td>{d.pages ?? "—"}</td><td>{when(d.uploadedAt)}</td><td>{when(d.readAt)}</td>
                </tr>
              ))}
              {!documents.data.length && <tr><td colSpan={7} className="admin-empty-row"><span>No documents uploaded.</span></td></tr>}
            </tbody>
          </table></div></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Processing failures</h2></div></div>
        <p className="admin-note">Codes and error types only; raw error text isn&rsquo;t shown.</p>
        <Unavailable s={failures} />
        {failures.ok && (
          <div className="admin-panel admin-table-panel"><div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>When</th><th>What</th><th>Item</th><th>Failure</th><th>Error type</th></tr></thead>
            <tbody>
              {failures.data.map((f, i) => (
                <tr key={`${f.resourceId}-${i}`}><td>{when(f.occurredAt)}</td><td>{f.resourceType.replace(/_/g, " ")}</td><td>{shortId(f.resourceId)}</td><td><code>{f.failureCode}</code></td><td>{f.errorClass ?? "—"}</td></tr>
              ))}
              {!failures.data.length && <tr><td colSpan={5} className="admin-empty-row"><span>None.</span></td></tr>}
            </tbody>
          </table></div></div>
        )}
        <h3 className="admin-subhead">Background jobs not finished</h3>
        <Unavailable s={jobs} />
        {jobs.ok && (
          <div className="admin-panel admin-table-panel"><div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Job</th><th>State</th><th>Attempts</th><th>Error category</th><th>Updated</th></tr></thead>
            <tbody>
              {jobs.data.map((j, i) => (
                <tr key={`${j.jobType}-${i}`}><td>{j.jobType}</td><td>{j.status.replace(/_/g, " ")}</td><td>{j.attempts}</td><td>{j.errorCategory ?? "—"}</td><td>{when(j.updatedAt)}</td></tr>
              ))}
              {!jobs.data.length && <tr><td colSpan={5} className="admin-empty-row"><span>None.</span></td></tr>}
            </tbody>
          </table></div></div>
        )}
      </section>

      <section className="section">
        <div className="section-heading"><div><h2>Model usage this month</h2></div>
          {usage.ok && <small>{plural(usage.data.calls, "call")} · {usage.data.failedCalls} failed</small>}</div>
        <Unavailable s={usage} />
        {usage.ok && (
          <div className="admin-panel admin-table-panel"><div className="admin-table-scroll"><table className="admin-table">
            <thead><tr><th>Operation</th><th>Model</th><th>Calls</th><th>Failed</th><th>Tokens in</th><th>Tokens out</th><th>Cost</th></tr></thead>
            <tbody>
              {usage.data.rows.map((r) => (
                <tr key={`${r.operation}|${r.role}|${r.provider}|${r.model}`}>
                  <td>{r.operation}</td><td>{r.model}</td><td>{r.calls}</td><td>{r.failedCalls}</td>
                  <td>{r.inputTokens.toLocaleString()}</td><td>{r.outputTokens.toLocaleString()}</td>
                  <td>{usd(r.costUsd)}{r.unpricedCalls ? ` (+${r.unpricedCalls} unpriced)` : ""}</td>
                </tr>
              ))}
              {!usage.data.rows.length && <tr><td colSpan={7} className="admin-empty-row"><span>No model calls this month.</span></td></tr>}
            </tbody>
          </table></div></div>
        )}
      </section>
    </div>
  );
}
