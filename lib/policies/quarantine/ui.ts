/**
 * Pure UI-state classification for a policy document's quarantine status --
 * shared between app/policies/page.tsx (which renders it) and this
 * repository's regression suite (which can then actually test the "UI
 * state mapping" requirement instead of duplicating this logic inline in a
 * client component where it isn't importable from a plain Node script).
 */
export type PolicyQuarantineUiInput = { quarantine_status: string; scan_result_detail: string | null };

/** Which document-safety mode this deployment is running: a real malware
 * scanner, or the prototype mode where scanning is intentionally disabled
 * and documents are recorded as not scanned. The policies API reports it so
 * the UI never shows malware-scan language in prototype mode. */
export type DocumentSafetyMode = "malware_scan" | "not_scanned_prototype";

/** The prototype UI's only acknowledgement wording. It deliberately claims
 * nothing about safety, scanning or approval. */
export const PROTOTYPE_RECEIVED_MESSAGE = "Document received — reading and extracting information.";

const HOLD_STATUSES = new Set(["uploaded", "quarantined", "scan_pending"]);

export function isPolicyQuarantineHeld(policy: PolicyQuarantineUiInput): boolean {
  return HOLD_STATUSES.has(policy.quarantine_status);
}

export function isPolicyScanRejected(policy: PolicyQuarantineUiInput): boolean {
  return policy.quarantine_status === "scan_rejected";
}

export function policyQuarantineLabel(policy: PolicyQuarantineUiInput, mode: DocumentSafetyMode = "malware_scan"): string {
  if (policy.quarantine_status === "scan_rejected") return "Rejected by malware scan";
  // Prototype mode: a held document is simply queued for reading -- no
  // malware-scan language, and never any claim that a scan passed.
  if (mode === "not_scanned_prototype") return PROTOTYPE_RECEIVED_MESSAGE;
  if (policy.quarantine_status === "scan_pending" && policy.scan_result_detail?.toLowerCase().includes("no malware-scanning adapter")) {
    return "On hold: malware scanning unavailable";
  }
  if (policy.quarantine_status === "scan_pending" && policy.scan_result_detail === SCAN_DID_NOT_COMPLETE_DETAIL) {
    return "On hold: malware scan did not complete";
  }
  if (policy.quarantine_status === "scan_pending") return "Waiting for malware scan";
  return "Waiting to start malware scan";
}

/**
 * The ONLY scan_result_detail values a household member's browser may ever
 * receive. The persisted column is operator-facing: a real scanner adapter
 * (lib/scanning/adapters/virustotal.ts) writes provider-internal text there
 * -- the VirusTotal analysis id and per-engine counts, or its retry/poll-
 * budget diagnostics -- which must never reach a user. Everything the UI
 * needs is a category, so the API maps the raw detail onto one of these
 * fixed strings (or null) via userFacingScanResultDetail() below.
 */
export const NO_SCANNER_CONFIGURED_DETAIL = "No malware-scanning adapter is configured in this environment.";
export const SCAN_DID_NOT_COMPLETE_DETAIL = "The malware scan did not complete. The document stays on hold until it is scanned successfully.";
export const SCAN_REJECTED_DETAIL = "This file was flagged by malware scanning and cannot be processed.";
/** Prototype document-safety mode: the honest record that no scan happened.
 * Never phrased as safe, clean, scanned or approved. */
export const PROTOTYPE_NOT_SCANNED_DETAIL = "Not scanned: malware scanning is intentionally disabled in this prototype build.";

export function userFacingScanResultDetail(policy: PolicyQuarantineUiInput): string | null {
  const raw = policy.scan_result_detail;
  if (policy.quarantine_status === "scan_rejected") return SCAN_REJECTED_DETAIL;
  if (policy.quarantine_status === "not_scanned_prototype") return PROTOTYPE_NOT_SCANNED_DETAIL;
  if (policy.quarantine_status !== "scan_pending" || !raw) return null;
  if (raw.toLowerCase().includes("no malware-scanning adapter")) return NO_SCANNER_CONFIGURED_DETAIL;
  return SCAN_DID_NOT_COMPLETE_DETAIL;
}

/**
 * The value WRITTEN to policies.scan_result_detail for a scanner outcome.
 * That column is household-readable (RLS SELECT on policies for the
 * household's own rows), so provider-internal text -- a VirusTotal analysis
 * id, engine counts, retry or poll-budget diagnostics -- is never stored in
 * it; only the fixed category strings above. The raw provider detail goes to
 * the server log instead (lib/policies/quarantine/store.ts), which only
 * operators can read.
 */
export function persistableScanResultDetail(outcome: "clean" | "infected" | "scan_unavailable" | "not_scanned_prototype", raw: string | null | undefined): string | null {
  if (outcome === "infected") return SCAN_REJECTED_DETAIL;
  if (outcome === "not_scanned_prototype") return PROTOTYPE_NOT_SCANNED_DETAIL;
  if (outcome === "clean") return null;
  if (raw && raw.toLowerCase().includes("no malware-scanning adapter")) return NO_SCANNER_CONFIGURED_DETAIL;
  return SCAN_DID_NOT_COMPLETE_DETAIL;
}

/** The only processing_error value the policy list API returns: the raw
 * pipeline error (provider responses, storage paths) stays server-side. */
export const POLICY_PROCESSING_STOPPED_MESSAGE = "Analysis stopped. DearPolicy kept the uploaded PDF; use Re-analyse to try again.";
