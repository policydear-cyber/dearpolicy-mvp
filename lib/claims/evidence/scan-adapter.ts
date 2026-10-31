/**
 * Thin, domain-specific wrapper around the shared @/lib/scanning/adapter.ts
 * registry. This file used to own its own adapter registry/selection logic
 * directly; it is now kept only so the 3 existing call sites (pipeline.ts's
 * currentScanAdapter, scripts/launch-check.ts's checkMalwareScannerConfigured,
 * instrumentation.ts's dynamic import) do not need to change, and so a
 * ClaimEvidenceScanStatus-shaped result keeps flowing through
 * transitionEvidenceStatus exactly as before. See lib/scanning/adapter.ts's
 * module doc comment for why the actual registry now lives there, shared
 * with the policy-document quarantine gate (lib/policies/quarantine/store.ts),
 * instead of being duplicated here a second time.
 */
import type { ClaimEvidenceScanStatus } from "./types";
import {
  currentFileScanAdapter, selectedFileScanAdapterName, checkFileScannerConfigured,
  nullFileScanAdapter, registeredFileScanAdapterNames, type FileScanAdapter, type FileScanResult, type ScanRetryHint,
} from "@/lib/scanning/adapter";

export type ScanResult = { status: ClaimEvidenceScanStatus; detail?: string; retry?: ScanRetryHint };

export interface EvidenceScanAdapter {
  readonly name: string;
  scanFile(bytes: Uint8Array): Promise<ScanResult>;
}

/** The shared registry's FileScanStatus maps onto ClaimEvidenceScanStatus
 * (which also has "pending_scan", a DB-default-only value no adapter ever
 * emits): "not_scanned" is recorded as "not_scanned_prototype", the not-scanned
 * state; the rest map to themselves. */
function toEvidenceScanStatus(result: FileScanResult): ClaimEvidenceScanStatus {
  // Not scanned (a hash lookup with no record): the same recorded state as scanning switched off, never "clean".
  return result.status === "not_scanned" ? "not_scanned_prototype" : result.status;
}

function wrapAdapter(inner: FileScanAdapter): EvidenceScanAdapter {
  return {
    name: inner.name,
    async scanFile(bytes: Uint8Array): Promise<ScanResult> {
      const result = await inner.scanFile(bytes);
      return { status: toEvidenceScanStatus(result), detail: result.detail, ...(result.status === "scan_unavailable" && result.retry ? { retry: result.retry } : {}) };
    },
  };
}

export const nullScanAdapter: EvidenceScanAdapter = wrapAdapter(nullFileScanAdapter);

const wrapperCache = new Map<string, EvidenceScanAdapter>();

export function selectedScanAdapterName(env: NodeJS.ProcessEnv = process.env): string {
  return selectedFileScanAdapterName(env);
}

export function currentScanAdapter(env: NodeJS.ProcessEnv = process.env): EvidenceScanAdapter {
  const name = selectedFileScanAdapterName(env);
  const inner = currentFileScanAdapter(env);
  const cached = wrapperCache.get(name);
  if (cached && cached.name === inner.name) return cached;
  const wrapped = wrapAdapter(inner);
  wrapperCache.set(name, wrapped);
  return wrapped;
}

export function checkMalwareScannerConfigured(env: NodeJS.ProcessEnv = process.env): { ok: boolean; message: string } {
  return checkFileScannerConfigured(env);
}

/** Checkpoint 14h: re-exported so scripts/launch-check.ts's
 * malware_scanning_configuration verifier can inspect the real shared
 * registry through this same thin wrapper it already imports from,
 * rather than reaching past it into lib/scanning/adapter.ts directly. */
export function registeredScanAdapterNames(): string[] {
  return registeredFileScanAdapterNames();
}
