/** Where one unread document stands, as GET /api/ledger (reading.documents) and GET /api/benefits/index (documents)
 * report it. Benefits only knows waiting and failed; Coverage also knows reading and backed_off (resting until
 * retryAfter). Every field may be missing on an older server, which keeps the plain stalled banner. */
export type ReadingDocument = {
  policyId: string;
  name: string | null;
  state: "waiting" | "reading" | "failed" | "backed_off";
  reasonCode?: string | null;
  /** Plain words, safe to show. */
  reason?: string | null;
  attempts?: number;
  lastFailedAt?: string | null;
  retryAfter?: string | null;
};

export const stuckDocuments = (documents: ReadingDocument[] | undefined) =>
  (documents ?? []).filter((d) => d.state === "failed" || d.state === "backed_off");

/** A document that rests until retryAfter cannot be read sooner, so "Try again" only helps one that failed outright. */
export const canRetryNow = (stuck: ReadingDocument[]) => stuck.some((d) => d.state === "failed" || !d.retryAfter || Date.parse(d.retryAfter) <= Date.now());

const when = (iso: string) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const time = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return t.toDateString() === new Date().toDateString() ? `after ${time}` : `after ${t.toLocaleDateString(undefined, { day: "numeric", month: "short" })}, ${time}`;
};

const label = (d: ReadingDocument) => d.name?.trim() || "Untitled document";

export const stuckTitle = (stuck: ReadingDocument[], page: string) =>
  stuck.length === 1 ? `“${label(stuck[0])}” couldn’t be read for ${page} yet.` : `${stuck.length} documents couldn’t be read for ${page} yet.`;

/** One line per stuck document: its name (linking to it in Documents), why, and when it is tried again. */
export function StuckDocuments({ stuck }: { stuck: ReadingDocument[] }) {
  return <ul className="stuck-docs" data-testid="stuck-documents">{stuck.map((d) => {
    const retry = d.state === "backed_off" && d.retryAfter ? when(d.retryAfter) : null;
    return <li key={d.policyId}>
      <a href={`/policies#doc-${d.policyId}`}>{label(d)}</a>
      {d.reason ? <span>{d.reason.replace(/\.?\s*$/, ".")}</span> : null}
      {retry ? <span className="stuck-retry">DearPolicy tries again {retry}.</span> : null}
    </li>;
  })}</ul>;
}
