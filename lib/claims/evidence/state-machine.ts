import type { ClaimEvidenceStatus } from "./types";

/**
 * Deterministic state machine for a claim-evidence document:
 *
 *   uploaded -> quarantined -> processing -> extracted -> needs_review -> matched | rejected | failed
 *
 * "quarantined" and "processing" both sit at the same step of that chain --
 * see ./scan-adapter.ts for why: this deployment has no real malware
 * scanner wired in, so a document passes through "quarantined" as an
 * explicit, honest bookkeeping state (never silently skipped, never marked
 * "clean") on its way to "processing" rather than being blocked there
 * forever. "failed" is reachable from most in-flight states, since
 * extraction or storage can fail at any step, and "failed" -> "processing"
 * is allowed so a retry can resume the pipeline without forking a new
 * document row. "rejected" is reachable from most non-terminal states too
 * -- a reviewer can reject a document outright (wrong file, unreadable,
 * unrelated) at any point they are looking at it, not only once it reaches
 * needs_review. Every OTHER edge is a strict one-way move forward: nothing
 * here allows a document to skip a review step (e.g. straight from
 * "uploaded" or "extracted" to "matched"), and "rejected" itself is
 * terminal -- a corrected re-upload supersedes it instead of reopening it.
 */
const ALLOWED_TRANSITIONS: Record<ClaimEvidenceStatus, ClaimEvidenceStatus[]> = {
  uploaded: ["quarantined", "rejected", "failed"],
  quarantined: ["processing", "rejected", "failed"],
  processing: ["extracted", "needs_review", "rejected", "failed"],
  extracted: ["needs_review", "rejected", "failed"],
  needs_review: ["matched", "rejected", "needs_review", "failed"],
  matched: ["needs_review", "rejected"],
  rejected: [],
  failed: ["processing", "quarantined", "rejected"],
};

export function isValidEvidenceTransition(from: ClaimEvidenceStatus, to: ClaimEvidenceStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidEvidenceTransitionError extends Error {
  constructor(public readonly from: ClaimEvidenceStatus, public readonly to: ClaimEvidenceStatus) {
    super(`Cannot move claim evidence from "${from}" to "${to}" -- that transition is not allowed.`);
  }
}

/** Throws InvalidEvidenceTransitionError rather than returning a boolean --
 * every call site should be a place that WANTS to fail loudly (a status
 * update on a real row), never one that is merely asking "is this legal". */
export function assertValidEvidenceTransition(from: ClaimEvidenceStatus, to: ClaimEvidenceStatus): void {
  if (!isValidEvidenceTransition(from, to)) throw new InvalidEvidenceTransitionError(from, to);
}
