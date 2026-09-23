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
  if (policy.quarantine_status === "scan_pending") return "Waiting for malware scan";
  return "Waiting to start malware scan";
}
