/**
 * Pure UI-state classification for a policy document's quarantine status --
 * shared between app/policies/page.tsx (which renders it) and this
 * repository's regression suite (which can then actually test the "UI
 * state mapping" requirement instead of duplicating this logic inline in a
 * client component where it isn't importable from a plain Node script).
 */
export type PolicyQuarantineUiInput = { quarantine_status: string; scan_result_detail: string | null };

const HOLD_STATUSES = new Set(["uploaded", "quarantined", "scan_pending"]);

export function isPolicyQuarantineHeld(policy: PolicyQuarantineUiInput): boolean {
  return HOLD_STATUSES.has(policy.quarantine_status);
}

export function isPolicyScanRejected(policy: PolicyQuarantineUiInput): boolean {
  return policy.quarantine_status === "scan_rejected";
}

export function policyQuarantineLabel(policy: PolicyQuarantineUiInput): string {
  if (policy.quarantine_status === "scan_rejected") return "Rejected by malware scan";
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

export function userFacingScanResultDetail(policy: PolicyQuarantineUiInput): string | null {
  const raw = policy.scan_result_detail;
  if (policy.quarantine_status === "scan_rejected") return SCAN_REJECTED_DETAIL;
  if (policy.quarantine_status !== "scan_pending" || !raw) return null;
  if (raw.toLowerCase().includes("no malware-scanning adapter")) return NO_SCANNER_CONFIGURED_DETAIL;
  return SCAN_DID_NOT_COMPLETE_DETAIL;
}
