/**
 * The read-side trust condition for policy documents, applied (in addition
 * to activePredicate()) wherever a policy's coverage or text can reach an
 * estimate, a total or a chat answer: the document must have passed the
 * malware scan and must be the current version. A coverage row's own
 * `confirmed` / `evidence_verified` flags never override this -- so a
 * document that is unscanned, scan-rejected, deleted or superseded
 * contributes nothing, whatever its coverage flags say.
 */
export function trustedPolicyStatePredicate(alias = "p"): string {
  return `${alias}.quarantine_status='scan_clean' AND ${alias}.superseded_at IS NULL`;
}
