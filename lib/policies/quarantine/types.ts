/** The policy-document quarantine gate's own state machine -- see
 * sql/schema.sql's migration comment and ./state-machine.ts for the
 * allowed transitions. Deliberately does NOT include "processing" or
 * "processed": those map onto the pre-existing `processing_status` column
 * (lib/rag/ingest.ts), reused rather than duplicated here (see this
 * module's other files for why). */
export type PolicyQuarantineStatus =
  | "uploaded" | "quarantined" | "scan_pending" | "scan_clean" | "scan_rejected" | "deleted";

export const POLICY_QUARANTINE_STATUSES: PolicyQuarantineStatus[] = [
  "uploaded", "quarantined", "scan_pending", "scan_clean", "scan_rejected", "deleted",
];

/** Runtime validation for a value read back from the database -- a
 * malformed, unexpected or hand-edited value must never be silently
 * treated as clean. See isPolicyProcessingAllowed() in ./store.ts, the
 * only place this matters. */
export function isPolicyQuarantineStatus(value: unknown): value is PolicyQuarantineStatus {
  return typeof value === "string" && (POLICY_QUARANTINE_STATUSES as string[]).includes(value);
}

export type PolicyQuarantineRow = {
  id: string;
  account_id: string;
  quarantine_status: string;
  scan_provider: string | null;
  scan_result_detail: string | null;
  scan_event_id: string | null;
  scanned_at: string | null;
  supersedes_id: string | null;
  superseded_at: string | null;
  processing_status: string;
  storage_key: string;
};

export type PolicyDocumentAuditEntry = {
  actor: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  policyId?: string | null;
  reason?: string | null;
  reasonCode?: string | null;
};

export type PolicyDocumentAuditRow = {
  id: string;
  account_id: string;
  actor: string;
  action: string;
  occurred_at: string;
  previous_value: unknown;
  new_value: unknown;
  policy_id: string | null;
  reason: string | null;
  reason_code: string | null;
};

/** Outcome of a scan-result write, returned by ./store.ts's
 * recordPolicyScanResult() so both the pipeline and the regression suite
 * can distinguish "this call actually changed the row" from every kind of
 * safe no-op (the exact distinction checkpoint 4's callback-idempotency
 * requirements need). */
export type PolicyScanResultOutcome =
  | "applied"
  | "duplicate_ignored"
  | "conflicting_ignored"
  | "deleted_or_superseded_ignored"
  | "not_found";
