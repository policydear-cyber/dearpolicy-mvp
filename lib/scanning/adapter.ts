/**
 * Shared, domain-agnostic malware/file-scan adapter registry.
 *
 * Both the claim-evidence pipeline (lib/claims/evidence/scan-adapter.ts,
 * now a thin wrapper around this module) and the policy-document quarantine
 * gate (lib/policies/quarantine/store.ts) select their scanner through
 * here, and only here. That is deliberate: the claim-evidence quarantine
 * gate previously shipped with a bug where a document could reach
 * processing without ever actually checking its persisted scan result, and
 * the fix for that (checkpoint 2 on this branch) was entirely inside
 * claim-evidence's own copy of this logic. Duplicating that copy a second
 * time for policy documents would risk the exact same class of bug
 * reappearing independently in the second copy. Centralizing the
 * selection/registry/production-guard here means there is only one place
 * that can go stale, and configuring a real scanner (MALWARE_SCANNER_PROVIDER)
 * covers every document pipeline in the app at once.
 */
import { isProduction, truthy } from "@/lib/launch/guards";
import { virusTotalFileScanAdapter } from "./adapters/virustotal";

/** "clean"/"infected" are only ever returned by a REAL adapter that
 * actually scanned the bytes. "scan_unavailable" is the null adapter's
 * honest default -- no caller anywhere in this codebase may treat it as
 * equivalent to "clean". */
export type FileScanStatus = "clean" | "infected" | "scan_unavailable";

/** Why a scan did not complete, when that reason is TRANSIENT -- set only by
 * a real adapter, only on "scan_unavailable". Its presence is what makes a
 * document eligible for a bounded automatic retry (lib/scanning/retry.ts);
 * its absence (no scanner configured, a misconfiguration) means the
 * document stays on hold until a person acts. `retryAfterSeconds` is the
 * provider's own retry metadata when it sent any -- never a guess. */
export type ScanRetryHint = {
  reason: "rate_limited" | "provider_timeout" | "provider_unavailable" | "analysis_pending";
  retryAfterSeconds?: number | null;
};

export type FileScanResult = { status: FileScanStatus; detail?: string; retry?: ScanRetryHint };

export interface FileScanAdapter {
  readonly name: string;
  scanFile(bytes: Uint8Array): Promise<FileScanResult>;
}

export const nullFileScanAdapter: FileScanAdapter = {
  name: "null",
  async scanFile(): Promise<FileScanResult> {
    return { status: "scan_unavailable", detail: "No malware-scanning adapter is configured in this environment." };
  },
};

/** Every scanner this deployment knows how to select, keyed by the name
 * MALWARE_SCANNER_PROVIDER is set to. Adding a real provider means adding
 * ONE entry here -- every document pipeline that reads from this registry
 * (currently claim evidence and policy documents) picks it up for free,
 * with no separate wiring per pipeline. */
const SCAN_ADAPTERS: Record<string, FileScanAdapter> = {
  null: nullFileScanAdapter,
  // Checkpoint 14e: the first REAL entry. Selected via
  // MALWARE_SCANNER_PROVIDER=virustotal + VIRUSTOTAL_API_KEY -- see
  // lib/scanning/adapters/virustotal.ts's module doc comment for the full
  // API contract, verdict mapping, and why the null adapter above remains
  // the fail-closed default for every other/unset value of that env var.
  virustotal: virusTotalFileScanAdapter,
};

/** Test-only seam: registers an adapter under a name so a regression suite
 * can deterministically exercise the "clean"/"infected"/throws-on-scan
 * paths through the REAL gate (lib/policies/quarantine/store.ts's
 * runPolicyQuarantineGate(), lib/claims/evidence/pipeline.ts) without a
 * real scanning provider configured. Not reachable from any route or
 * client input -- only ever called from a script importing this module
 * directly -- so this is not a runtime-configurable bypass. */
export function __registerFileScanAdapterForTests(adapter: FileScanAdapter): void {
  SCAN_ADAPTERS[adapter.name] = adapter;
}

export function selectedFileScanAdapterName(env: NodeJS.ProcessEnv = process.env): string {
  return env.MALWARE_SCANNER_PROVIDER?.trim() || "null";
}

/** Checkpoint 14h (claude/v1-launch-hardening): the real registry's own
 * key list -- what scripts/launch-check.ts's malware_scanning_configuration
 * verifier now inspects directly, instead of trusting a static comment
 * about what SCAN_ADAPTERS currently contains. A real (non-null) entry
 * here means a real adapter implementation exists in code; whether one is
 * actually SELECTED in a given environment is the separate, orthogonal
 * question selectedFileScanAdapterName()/checkFileScannerConfigured()
 * answer. */
export function registeredFileScanAdapterNames(): string[] {
  return Object.keys(SCAN_ADAPTERS);
}

export function currentFileScanAdapter(env: NodeJS.ProcessEnv = process.env): FileScanAdapter {
  const name = selectedFileScanAdapterName(env);
  return SCAN_ADAPTERS[name] ?? nullFileScanAdapter;
}

/** Production startup / launch:check guard. Refuses to boot with the null
 * scanner in production unless MALWARE_SCANNING_INTENTIONALLY_DISABLED=true
 * explicitly acknowledges it -- domain-agnostic, so this one check covers
 * every pipeline that reads from this registry (see this module's own
 * comment above for why that centralization matters). */
export function checkFileScannerConfigured(env: NodeJS.ProcessEnv = process.env): { ok: boolean; message: string } {
  if (!isProduction(env)) {
    return { ok: true, message: "Not production; malware-scanner configuration check skipped." };
  }
  const name = selectedFileScanAdapterName(env);
  if (name !== "null") {
    return { ok: true, message: `Malware scanner "${name}" is configured for production.` };
  }
  if (truthy(env.MALWARE_SCANNING_INTENTIONALLY_DISABLED)) {
    return {
      ok: true,
      message:
        "No malware scanner is configured, but MALWARE_SCANNING_INTENTIONALLY_DISABLED=true explicitly acknowledges " +
        "this -- every claim-evidence and policy-document upload will remain quarantined indefinitely until a real scanner is configured.",
    };
  }
  return {
    ok: false,
    message:
      "No malware scanner is configured in production (MALWARE_SCANNER_PROVIDER is unset) and " +
      "MALWARE_SCANNING_INTENTIONALLY_DISABLED has not been set to acknowledge it. Every claim-evidence and " +
      "policy-document upload will be stuck in quarantine with no operator aware why. Configure a real scanner via " +
      "MALWARE_SCANNER_PROVIDER, or set MALWARE_SCANNING_INTENTIONALLY_DISABLED=true if this is intentional.",
  };
}
