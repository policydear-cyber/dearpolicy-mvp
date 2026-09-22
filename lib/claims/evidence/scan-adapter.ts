import type { ClaimEvidenceScanStatus } from "./types";

/**
 * Malware-scanning extension point.
 *
 * No real scanner is wired into this deployment. `scanFile()` below is a
 * documented, deliberately honest stand-in: it NEVER returns "clean" --
 * doing so would be lying about a scan that never happened. It returns
 * "scan_unavailable" every time, so a document's `scan_status` stays
 * visibly "scan_unavailable" through its whole lifecycle rather than being
 * silently marked as scanned.
 *
 * The pipeline (./pipeline.ts) deliberately does NOT block processing on
 * `scan_status` being anything other than "infected" -- with no real
 * scanner, blocking on "not yet scanned" would mean nothing could ever be
 * reviewed, which defeats the feature entirely. This is a known,
 * documented limitation for production deployment: before this goes live
 * with real users, replace `scanFile` below with a call to a real
 * anti-malware service (e.g. an S3/GCS-integrated scanner, ClamAV, or a
 * vendor API) that can genuinely return "clean" or "infected".
 */
export type ScanResult = { status: ClaimEvidenceScanStatus; detail?: string };

export interface EvidenceScanAdapter {
  scanFile(bytes: Uint8Array): Promise<ScanResult>;
}

export const nullScanAdapter: EvidenceScanAdapter = {
  async scanFile(): Promise<ScanResult> {
    return { status: "scan_unavailable", detail: "No malware-scanning adapter is configured in this environment." };
  },
};

export function currentScanAdapter(): EvidenceScanAdapter {
  // A future adapter would be selected here (e.g. by an env var), mirroring
  // how lib/storage/index.ts picks its backend -- left as a single seam so
  // wiring in a real scanner later never requires touching the pipeline.
  return nullScanAdapter;
}
