import type { PolicyQuarantineStatus } from "./types";

/**
 * Deterministic state machine for a policy document's quarantine gate:
 *
 *   uploaded -> quarantined -> scan_pending -> scan_clean | scan_rejected
 *
 * "processing"/"processed" from the checkpoint-3 specification are NOT
 * separate values of THIS state machine -- they are the pre-existing
 * `processing_status` column's own 'extracting'/'indexing'/'ready' values
 * (lib/rag/ingest.ts's processPolicy()), reused rather than duplicated
 * here (the governing instruction: "use the repository's naming
 * conventions if equivalent states already exist, but preserve these
 * semantics"). This state machine's only job is the GATE in front of that
 * existing pipeline: nothing may reach `processing_status` beyond
 * 'uploaded'/'queued' until quarantine_status is 'scan_clean' -- see
 * ./store.ts's runPolicyQuarantineGate(), the single choke point
 * lib/rag/ingest.ts's processPolicy() calls at its own entry point before
 * any OCR, parsing, extraction, embedding or indexing runs.
 *
 * scan_pending is a stable resting state, not a transient one: a
 * scan_unavailable, still-pending, timed-out, missing or malformed verdict
 * leaves a document here indefinitely -- exactly like claim-evidence's
 * "quarantined" (lib/claims/evidence/state-machine.ts) -- never silently
 * promoted to scan_clean. Both scan_clean and scan_rejected are terminal
 * except for `deleted`, reachable from every non-deleted state (a document
 * can be removed at any point in its lifecycle) and itself terminal -- a
 * corrected re-upload creates a NEW row (supersedes_id/superseded_at)
 * rather than reopening a deleted or superseded one.
 */
const ALLOWED_TRANSITIONS: Record<PolicyQuarantineStatus, PolicyQuarantineStatus[]> = {
  uploaded: ["quarantined", "deleted"],
  quarantined: ["scan_pending", "deleted"],
  scan_pending: ["scan_clean", "scan_rejected", "deleted"],
  scan_clean: ["deleted"],
  scan_rejected: ["deleted"],
  deleted: [],
};

export function isValidPolicyQuarantineTransition(from: PolicyQuarantineStatus, to: PolicyQuarantineStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidPolicyQuarantineTransitionError extends Error {
  constructor(public readonly from: PolicyQuarantineStatus, public readonly to: PolicyQuarantineStatus) {
    super(`Cannot move policy document quarantine status from "${from}" to "${to}" -- that transition is not allowed.`);
  }
}

/** Throws rather than returning a boolean -- every call site is a place
 * that WANTS to fail loudly (a status update on a real row), never one
 * that is merely asking "is this legal". */
export function assertValidPolicyQuarantineTransition(from: PolicyQuarantineStatus, to: PolicyQuarantineStatus): void {
  if (!isValidPolicyQuarantineTransition(from, to)) throw new InvalidPolicyQuarantineTransitionError(from, to);
}
