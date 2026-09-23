import type { ClaimEvidenceScanStatus } from "./types";
import { isProduction, truthy } from "@/lib/launch/guards";

export type ScanResult = { status: ClaimEvidenceScanStatus; detail?: string };

export interface EvidenceScanAdapter {
  readonly name: string;
  scanFile(bytes: Uint8Array): Promise<ScanResult>;
}

/**
 * No malware scanner is wired into this environment. This adapter is
 * honest about that: it always returns "scan_unavailable", never "clean".
 *
 * Nothing downstream is allowed to treat "scan_unavailable" as safe to
 * process -- see ./pipeline.ts's quarantined -> processing gate, which
 * proceeds ONLY on an explicit "clean" result. A document scanned by this
 * adapter therefore stays in `quarantined` indefinitely (the UI states
 * why -- see app/claims/[id]/page.tsx), which is the correct, safe
 * behavior for "no scanner configured", not a bug to route around.
 *
 * Before this goes live with real users, implement a real
 * EvidenceScanAdapter (calling an actual anti-malware service) and
 * register it in SCAN_ADAPTERS below, then select it via
 * MALWARE_SCANNER_PROVIDER. checkMalwareScannerConfigured() below refuses
 * production startup while this adapter is still selected, unless an
 * operator has explicitly acknowledged that with
 * MALWARE_SCANNING_INTENTIONALLY_DISABLED=true.
 */
export const nullScanAdapter: EvidenceScanAdapter = {
  name: "null",
  async scanFile(): Promise<ScanResult> {
    return { status: "scan_unavailable", detail: "No malware-scanning adapter is configured in this environment." };
  },
};

/** Real adapters register here by the name MALWARE_SCANNER_PROVIDER
 * selects. Empty today -- this is the extension point a real
 * malware-scanning integration plugs into. Nothing here may ever return
 * "clean" without a real scanner backing it; that would be fabricating a
 * scan result, which is exactly what this interface exists to prevent. */
const SCAN_ADAPTERS: Record<string, EvidenceScanAdapter> = {
  null: nullScanAdapter,
};

export function selectedScanAdapterName(env: NodeJS.ProcessEnv = process.env): string {
  return env.MALWARE_SCANNER_PROVIDER?.trim() || "null";
}

export function currentScanAdapter(env: NodeJS.ProcessEnv = process.env): EvidenceScanAdapter {
  const name = selectedScanAdapterName(env);
  return SCAN_ADAPTERS[name] ?? nullScanAdapter;
}

/**
 * Production startup guard (wired into lib/launch/guards.ts's
 * PRODUCTION_STARTUP_GUARDS, and into scripts/launch-check.ts's
 * malware_scanning_configuration capability).
 *
 * This does NOT change document safety by itself -- processClaimEvidence()
 * never processes a document whose scan_status isn't "clean" regardless of
 * which adapter is selected (see ./pipeline.ts). It exists so a production
 * deploy that is still on the null scanner fails LOUDLY at startup instead
 * of silently leaving every uploaded document stuck in quarantine forever
 * with no operator aware why -- "production cannot silently use the null
 * scanner" in the launch-hardening spec's own words.
 */
export function checkMalwareScannerConfigured(env: NodeJS.ProcessEnv = process.env): { ok: boolean; message: string } {
  if (!isProduction(env)) {
    return { ok: true, message: "Not production; malware-scanner configuration check skipped." };
  }
  const name = selectedScanAdapterName(env);
  if (name !== "null") {
    return { ok: true, message: `Malware scanner "${name}" is configured for production.` };
  }
  if (truthy(env.MALWARE_SCANNING_INTENTIONALLY_DISABLED)) {
    return {
      ok: true,
      message:
        "No malware scanner is configured, but MALWARE_SCANNING_INTENTIONALLY_DISABLED=true explicitly " +
        "acknowledges this -- every claim-evidence upload will remain quarantined indefinitely until a real " +
        "scanner is configured.",
    };
  }
  return {
    ok: false,
    message:
      "No malware scanner is configured in production (MALWARE_SCANNER_PROVIDER is unset) and " +
      "MALWARE_SCANNING_INTENTIONALLY_DISABLED has not been set to acknowledge it. Every claim-evidence upload " +
      "will be stuck in quarantine with no operator aware why. Configure a real scanner via " +
      "MALWARE_SCANNER_PROVIDER, or set MALWARE_SCANNING_INTENTIONALLY_DISABLED=true if this is intentional.",
  };
}
