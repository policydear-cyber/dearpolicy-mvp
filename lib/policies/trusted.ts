/**
 * The read-side trust condition for policy documents, applied (in addition
 * to activePredicate()) wherever a policy's coverage or text can reach an
 * estimate, a total or a chat answer: the document must have been released
 * by the document-safety gate and must be the current version. Released
 * means either quarantine_status 'scan_clean' (a real malware scan passed)
 * or 'not_scanned_prototype' (malware scanning intentionally disabled via
 * MALWARE_SCANNING_INTENTIONALLY_DISABLED -- the state records honestly
 * that no scan happened; it is never presented as clean). A coverage row's
 * own `confirmed` / `evidence_verified` flags never override this -- so a
 * document that is still pending, scan-rejected, deleted or superseded
 * contributes nothing, whatever its coverage flags say.
 */
export function trustedPolicyStatePredicate(alias = "p"): string {
  return `${alias}.quarantine_status IN ('scan_clean','not_scanned_prototype') AND ${alias}.superseded_at IS NULL`;
}
