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
  nullFileScanAdapter, type FileScanAdapter, type FileScanResult,
} from "@/lib/scanning/adapter";

export type ScanResult = { status: ClaimEvidenceScanStatus; detail?: string };

export interface EvidenceScanAdapter {
  readonly name: string;
  scanFile(bytes: Uint8Array): Promise<ScanResult>;
}

/** The shared registry's FileScanStatus ("clean"|"infected"|"scan_unavailable")
 * is a strict subset of ClaimEvidenceScanStatus (which also has
 * "pending_scan", a DB-default-only value no adapter ever emits), so this
 * mapping is total and lossless. */
function toEvidenceScanStatus(result: FileScanResult): ClaimEvidenceScanStatus {
  return result.status;
}

function wrapAdapter(inner: FileScanAdapter): EvidenceScanAdapter {
  return {
    name: inner.name,
    async scanFile(bytes: Uint8Array): Promise<ScanResult> {
      const result = await inner.scanFile(bytes);
      return { status: toEvidenceScanStatus(result), detail: result.detail };
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
